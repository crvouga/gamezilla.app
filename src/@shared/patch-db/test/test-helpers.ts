import { getPGliteTestInstance, stopPGliteTestInstance } from "../../postgres/pglite-test-instance";
import { SqlClientImplBunPostgres } from "../../sql-client/impl-bun-postgres";
import { SqlClientImplBunSqlite } from "../../sql-client/impl-bun-sqlite";
import type { SqlClient } from "../../sql-client/interface";
import { PatchDbImplPostgres } from "../impl-postgres/impl-postgres";
import { PatchDbImplSqlite } from "../impl-sqlite/impl-sqlite";
import type { PatchesDb, PatchInput } from "../interface";

export type DbFactory = () => Promise<{ db: PatchesDb; teardown: () => Promise<void> }>;

let cachedPostgresClient: InstanceType<typeof SqlClientImplBunPostgres> | null = null;

/** Truncate patch-db tables on our connection. Avoids DROP SCHEMA which invalidates other connections. */
async function truncatePatchDbTables(client: InstanceType<typeof SqlClientImplBunPostgres>): Promise<void> {
    await client.run("TRUNCATE snapshots, patches CASCADE");
}

let savedDatabaseUrl: string | undefined;

export async function createPostgresFactory(): Promise<{ db: PatchesDb; teardown: () => Promise<void> }> {
    const pg = await getPGliteTestInstance(25433);
    savedDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = pg.connectionUrl;
    if (!cachedPostgresClient) {
        await pg.wipe();
        cachedPostgresClient = SqlClientImplBunPostgres.connect(pg.connectionUrl);
        await cachedPostgresClient.connect();
    } else {
        await truncatePatchDbTables(cachedPostgresClient);
    }
    const db = new PatchDbImplPostgres(cachedPostgresClient);
    await db.migrate();
    return { db, teardown: async () => { } };
}

export async function teardownPostgresTests(): Promise<void> {
    if (savedDatabaseUrl !== undefined) {
        process.env.DATABASE_URL = savedDatabaseUrl;
    } else {
        delete process.env.DATABASE_URL;
    }
    if (cachedPostgresClient) {
        await cachedPostgresClient.disconnect();
        cachedPostgresClient = null;
    }
    await stopPGliteTestInstance();
}

export async function createSqliteFactory(): Promise<{ db: PatchesDb; teardown: () => Promise<void> }> {
    const client: SqlClient = SqlClientImplBunSqlite.open(":memory:");
    await client.connect();
    const db = new PatchDbImplSqlite(client);
    await db.migrate();
    return { db, teardown: () => client.disconnect() };
}

export const implementations: { name: string; factory: DbFactory }[] = [
    { name: "PatchDbImplSqlite", factory: createSqliteFactory },
    ...(process.env.SKIP_POSTGRES_TESTS !== "1"
        ? [{ name: "PatchDbImplPostgres", factory: createPostgresFactory }]
        : []),
];

/** Fixture data for where-clause tests: t1 (score 10, tag a), t2 (20, b), t3 (30, a), t4 (40, no tag) */
export const whereClauseFixtures: PatchInput[] = [
    {
        entityId: "t1",
        entityType: "item",
        attributes: { name: "Alpha Widget", score: 10, tag: "a" },
    },
    {
        entityId: "t2",
        entityType: "item",
        attributes: { name: "Beta Gadget", score: 20, tag: "b" },
    },
    {
        entityId: "t3",
        entityType: "item",
        attributes: { name: "Gamma Tool", score: 30, tag: "a" },
    },
    {
        entityId: "t4",
        entityType: "item",
        attributes: { name: "Delta Device", score: 40 },
    },
];
