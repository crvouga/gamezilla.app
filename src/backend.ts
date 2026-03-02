import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { createStaticFileHandlerBun } from "./@shared/static-file-server/static-file-server-adapter-bun";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, "..", "dist");
const PORT = process.env.PORT ?? 3000;

const staticHandler = createStaticFileHandlerBun(DIST_DIR);

const server = Bun.serve({
    port: Number(PORT),
    fetch(req: Request) {
        const url = new URL(req.url);

        if (url.pathname === "/health") {
            return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
        }

        return staticHandler(req);
    },
});

console.log(`Serving Expo static assets from ${DIST_DIR}`);
console.log(`Server running at http://localhost:${server.port}`);
