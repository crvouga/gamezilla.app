import { getPGliteTestInstance } from "../src/@shared/postgres/pglite-test-instance";
import { SqlClientImplBunPostgres } from "../src/@shared/sql-client/impl-bun-postgres";
import { PatchDbImplPostgres } from "../src/@shared/patch-db/impl-postgres/impl-postgres";
import { whereClauseFixtures } from "../src/@shared/patch-db/test/test-helpers";

const pg = await getPGliteTestInstance(25434);
await pg.wipe();

const client = SqlClientImplBunPostgres.connect(pg.connectionUrl);
await client.connect();

const db = new PatchDbImplPostgres(client);
await db.migrate();
await db.write(whereClauseFixtures);

const all = await db.entities({ entityType: "item" });
console.log("All entities:", all.data.length, all.data.map(e => e.entityId));

const filtered = await db.entities({
    entityType: "item",
    where: { type: "=", attribute: "tag", value: "a" },
});
console.log("Filtered (tag=a):", filtered.data.length, filtered.data.map(e => e.entityId));

await client.disconnect();
