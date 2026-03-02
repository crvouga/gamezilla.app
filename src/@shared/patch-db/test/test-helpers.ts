import { getPGliteTestInstance, stopPGliteTestInstance } from "../../postgres/pglite-test-instance";
import { SqlClientImplBunPostgres } from "../../sql-client/impl-bun-postgres";
import { SqlClientImplBunSqlite } from "../../sql-client/impl-bun-sqlite";
import type { SqlClient } from "../../sql-client/interface";
import { PatchDbImplPostgres } from "../impl-postgres/impl-postgres";
import { PatchDbImplSqlite } from "../impl-sqlite/impl-sqlite";
import type { PatchesDb, PatchInput } from "../interface";

export type DbFactory = () => Promise<{ db: PatchesDb; teardown: () => Promise<void> }>;

let cachedPostgresClient: SqlClient | null = null;

export async function createPostgresFactory(): Promise<{ db: PatchesDb; teardown: () => Promise<void> }> {
    const pg = await getPGliteTestInstance(25434);
    await pg.wipe();
    if (!cachedPostgresClient) {
        cachedPostgresClient = SqlClientImplBunPostgres.connect(pg.connectionUrl);
        await cachedPostgresClient.connect();
    }
    const db = new PatchDbImplPostgres(cachedPostgresClient);
    await db.migrate();
    return { db, teardown: async () => {} };
}

export async function teardownPostgresTests(): Promise<void> {
    if (cachedPostgresClient) {
        await cachedPostgresClient.disconnect();
        cachedPostgresClient = null;
    }
    await stopPGliteTestInstance();
}

export function makePatch(
    overrides: Partial<PatchInput> & Pick<PatchInput, "patchId" | "entityId" | "entityType">
): PatchInput {
    return {
        attributes: {},
        createdAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        createdBy: "",
        sessionId: "",
        ...overrides,
    };
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
export const whereClauseFixtures = [
    makePatch({
        patchId: "w1",
        entityId: "t1",
        entityType: "item",
        attributes: { name: "Alpha Widget", score: 10, tag: "a" },
        createdAt: "2025-01-01T00:00:00Z",
    }),
    makePatch({
        patchId: "w2",
        entityId: "t2",
        entityType: "item",
        attributes: { name: "Beta Gadget", score: 20, tag: "b" },
        createdAt: "2025-01-01T00:00:00Z",
    }),
    makePatch({
        patchId: "w3",
        entityId: "t3",
        entityType: "item",
        attributes: { name: "Gamma Tool", score: 30, tag: "a" },
        createdAt: "2025-01-01T00:00:00Z",
    }),
    makePatch({
        patchId: "w4",
        entityId: "t4",
        entityType: "item",
        attributes: { name: "Delta Device", score: 40 },
        createdAt: "2025-01-01T00:00:00Z",
    }),
];
