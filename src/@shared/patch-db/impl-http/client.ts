import type {
    Entity,
    Patch,
    PatchesDb,
    PatchesDbQuery,
    PatchesDbResult,
    PatchInput,
} from "../interface";
import { ENTITIES_QUERY, PATCHES_QUERY, PATCHES_QUERY_BATCH, PATCHES_WRITE } from "./shared";

export class PatchDbImplHttp implements PatchesDb {
    constructor(private baseUrl: string) { }

    private async post<T>(path: string, body: unknown): Promise<T> {
        const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text}`);
        }
        return res.json() as Promise<T>;
    }

    async patches(query: PatchesDbQuery): Promise<PatchesDbResult<Patch>> {
        return this.post<PatchesDbResult<Patch>>(PATCHES_QUERY, { query });
    }

    async patchesBatch(queries: PatchesDbQuery[]): Promise<PatchesDbResult<Patch>[]> {
        if (queries.length === 0) return [];
        return this.post<PatchesDbResult<Patch>[]>(PATCHES_QUERY_BATCH, { queries });
    }

    async entities(query: PatchesDbQuery): Promise<PatchesDbResult<Entity>> {
        return this.post<PatchesDbResult<Entity>>(ENTITIES_QUERY, { query });
    }

    async patch(patches: PatchInput[]): Promise<Patch[]> {
        return this.post<Patch[]>(PATCHES_WRITE, { patches });
    }
}
