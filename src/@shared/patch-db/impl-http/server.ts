import type { PatchesDb, PatchesDbQuery } from "../interface";

export function createPatchDbHttpHandlers(db: PatchesDb): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
        const url = new URL(req.url);

        if (url.pathname === "/api/patches/query" && req.method === "POST") {
            const body = (await req.json()) as { query: PatchesDbQuery };
            const result = await db.patches(body.query);
            return Response.json(result);
        }

        if (url.pathname === "/api/entities/query" && req.method === "POST") {
            const body = (await req.json()) as { query: PatchesDbQuery };
            const result = await db.entities(body.query);
            return Response.json(result);
        }

        if (url.pathname === "/api/patches/write" && req.method === "POST") {
            const body = (await req.json()) as { patches: Parameters<PatchesDb["write"]>[0] };
            await db.write(body.patches);
            return Response.json({ ok: true });
        }

        return new Response("Not Found", { status: 404 });
    };
}
