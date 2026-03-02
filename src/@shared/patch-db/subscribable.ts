import { InjectionToken } from "../dependency-injection/dependency-injection-container";
import { PubSub, Unsubscribe } from "../pub-sub/interface";
import { Entity, Patch, PatchesDb, PatchesDbQuery, PatchesDbResult, PatchInput } from "./interface";

const PATCHES_DB_TOPIC = "patches-db";

/** Any PatchesDb that exposes subscribe.entities and subscribe.patches (e.g. SubscribablePatchesDb, SyncPatchesDb) */
export type SubscribablePatchesDbLike = PatchesDb & {
    subscribe: {
        patches: (query: PatchesDbQuery, listener: (result: PatchesDbResult<Patch>) => void) => Unsubscribe;
        entities: (query: PatchesDbQuery, listener: (result: PatchesDbResult<Entity>) => void) => Unsubscribe;
    };
};

export const SubscribablePatchesDbToken: InjectionToken<SubscribablePatchesDbLike> = Symbol("SubscribablePatchesDb");

export class SubscribablePatchesDb implements PatchesDb {
    constructor(private db: PatchesDb, private pubSub: PubSub) { }

    async write(patches: PatchInput[]): Promise<void> {
        await this.db.write(patches);
        this.pubSub.publish(PATCHES_DB_TOPIC, { type: "invalidated" });
    }

    read(query: PatchesDbQuery): Promise<PatchesDbResult<Patch>> {
        return this.db.read(query);
    }

    entities(query: PatchesDbQuery): Promise<PatchesDbResult<Entity>> {
        return this.db.entities(query);
    }

    subscribe = {
        patches: (query: PatchesDbQuery, listener: (result: PatchesDbResult<Patch>) => void): Unsubscribe => {
            const notify = async () => {
                const result = await this.db.read(query);
                listener(result);
            };
            void notify();
            return this.pubSub.subscribe(PATCHES_DB_TOPIC, notify);
        },
        entities: (query: PatchesDbQuery, listener: (result: PatchesDbResult<Entity>) => void): Unsubscribe => {
            const notify = async () => {
                const result = await this.db.entities(query);
                listener(result);
            };
            void notify();
            return this.pubSub.subscribe(PATCHES_DB_TOPIC, notify);
        },
    };
}