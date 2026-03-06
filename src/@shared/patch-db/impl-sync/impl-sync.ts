import type { PubSub, Unsubscribe } from "../../pub-sub/interface";
import type {
    Entity,
    Patch,
    PatchesDb,
    PatchesDbQuery,
    PatchesDbResult,
    PatchInput,
    SyncStatePatchesDb,
} from "../interface";

const PATCHES_DB_TOPIC = "patches-db";

export type SyncPatchesDbOptions = {
    pollIntervalMs?: number;
    pushIntervalMs?: number;
};

type ActiveQuery = {
    query: PatchesDbQuery;
    refCount: number;
};

function getLastRecordedAt(patches: Patch[]): string | null {
    if (patches.length === 0) return null;
    return patches.reduce((max, p) =>
        p.recordedAt > max ? p.recordedAt : max
        , patches[0].recordedAt);
}

export class SyncPatchesDb implements PatchesDb {
    subscribe = {
        patches: (
            query: PatchesDbQuery,
            listener: (result: PatchesDbResult<Patch>) => void
        ): Unsubscribe => this.registerAndSubscribe(query, "patches", listener),
        entities: (
            query: PatchesDbQuery,
            listener: (result: PatchesDbResult<Entity>) => void
        ): Unsubscribe => this.registerAndSubscribe(query, "entities", listener),
    };

    private activeQueries = new Map<string, ActiveQuery>();
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private pushTimer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private local: SyncStatePatchesDb,
        private remote: PatchesDb,
        private pubSub: PubSub,
        private options: SyncPatchesDbOptions = {}
    ) {
        this.ensurePushTimer();
    }

    async patch(patches: PatchInput[]): Promise<Patch[]> {
        const withUnsynced = patches.map((p) => ({
            ...p,
            meta: { ...p.meta, syncedAt: null },
        }));
        const result = await this.local.patch(withUnsynced);
        this.pubSub.publish(PATCHES_DB_TOPIC, { type: "invalidated" });
        return result;
    }

    patches(queries: PatchesDbQuery[], knownPatches?: Patch[][]): Promise<PatchesDbResult<Patch>[]> {
        return this.local.patches(queries, knownPatches);
    }

    entities(query: PatchesDbQuery): Promise<PatchesDbResult<Entity>> {
        return this.local.entities(query);
    }

    private queryKey(query: PatchesDbQuery): string {
        return JSON.stringify(query);
    }

    private registerAndSubscribe<T extends Patch | Entity>(
        query: PatchesDbQuery,
        mode: "patches" | "entities",
        listener: (result: PatchesDbResult<T>) => void
    ): Unsubscribe {
        const key = this.queryKey(query);
        const existing = this.activeQueries.get(key);
        if (existing) {
            existing.refCount++;
        } else {
            this.activeQueries.set(key, { query, refCount: 1 });
            this.ensurePolling();
        }

        const notify = async () => {
                const result =
                    mode === "patches"
                        ? ((await this.local.patches([query]))[0] as PatchesDbResult<T>)
                    : ((await this.local.entities(query)) as PatchesDbResult<T>);
            listener(result);
        };
        void notify();

        const unsub = this.pubSub.subscribe(PATCHES_DB_TOPIC, () => {
            void notify();
        });

        return () => {
            unsub();
            const entry = this.activeQueries.get(key);
            if (entry) {
                entry.refCount--;
                if (entry.refCount <= 0) {
                    this.activeQueries.delete(key);
                    this.maybeStopPolling();
                }
            }
        };
    }

    private ensurePolling(): void {
        if (this.pollTimer != null) return;
        const pollIntervalMs = this.options.pollIntervalMs ?? 5000;
        this.pollTimer = setInterval(() => {
            void this.poll();
        }, pollIntervalMs);
    }

    private maybeStopPolling(): void {
        if (this.activeQueries.size === 0 && this.pollTimer != null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private ensurePushTimer(): void {
        if (this.pushTimer != null) return;
        const pushIntervalMs = this.options.pushIntervalMs ?? 2000;
        this.pushTimer = setInterval(() => {
            void this.pushUnsynced();
        }, pushIntervalMs);
    }

    private async pushUnsynced(): Promise<void> {
        try {
            const patches = await this.local.getUnsyncedPatches();
            if (patches.length === 0) return;
            await this.remote.patch(patches);
            await this.local.markPatchesSynced(patches.map((p) => p.patchId));
            this.pubSub.publish(PATCHES_DB_TOPIC, { type: "invalidated" });
        } catch (err) {
            console.warn("[SyncPatchesDb] push failed:", err);
        }
    }

    private async poll(): Promise<void> {
        const entries = Array.from(this.activeQueries.values());
        if (entries.length === 0) return;

        try {
            const syncQueries: PatchesDbQuery[] = [];
            const knownPatches: Patch[][] = [];
            for (const { query } of entries) {
                const [localResult] = await this.local.patches([query]);
                const lastRecordedAt = getLastRecordedAt(localResult.data);
                syncQueries.push({
                    ...query,
                    after: lastRecordedAt ?? undefined,
                });
                knownPatches.push(localResult.data);
            }

            const results = await this.remote.patches(syncQueries, knownPatches);

            let hasNewPatches = false;
            for (const remoteResult of results) {
                if (remoteResult.data.length > 0) {
                    const withSynced = remoteResult.data.map((p) => ({
                        ...p,
                        meta: { ...p.meta, syncedAt: new Date().toISOString() },
                    }));
                    await this.local.patch(withSynced);
                    hasNewPatches = true;
                }
            }
            if (hasNewPatches) {
                this.pubSub.publish(PATCHES_DB_TOPIC, { type: "invalidated" });
            }
        } catch (err) {
            console.warn("[SyncPatchesDb] poll failed:", err);
        }
    }
}
