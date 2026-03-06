import type { Patch, PatchesDb, PatchesDbQuery } from "../interface";
import { ENTITIES_QUERY, PATCHES_QUERY, PATCHES_WRITE } from "./shared";

export function createPatchDbHttpHandlers(db: PatchesDb): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
        const url = new URL(req.url);

        if (url.pathname === PATCHES_QUERY && req.method === "POST") {
            const body = (await req.json()) as { queries: PatchesDbQuery[]; knownPatches?: Patch[][] };
            const { queries, knownPatches } = body;
            if (knownPatches?.length) {
                for (const patches of knownPatches) {
                    if (patches.length > 0) await db.write(patches);
                }
            }
            const results = await db.readPatches(queries);
            return Response.json(results);
        }

        if (url.pathname === ENTITIES_QUERY && req.method === "POST") {
            const body = (await req.json()) as { query: PatchesDbQuery };
            const result = await db.readEntities(body.query);
            return Response.json(result);
        }

        if (url.pathname === PATCHES_WRITE && req.method === "POST") {
            const body = (await req.json()) as { patches: Parameters<PatchesDb["write"]>[0] };
            const patches = await db.write(body.patches);
            return Response.json(patches);
        }

        return new Response("Not Found", { status: 404 });
    };
}
