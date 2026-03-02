const PORT = process.env.PORT ?? 3000;

const server = Bun.serve({
    port: Number(PORT),
    fetch(req: Request) {
        const url = new URL(req.url);

        if (url.pathname === "/health") {
            return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
        }

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`Server running at http://localhost:${server.port}`);
