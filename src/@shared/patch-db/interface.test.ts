import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SqlClientImplBunSqlite } from "../sql-client/impl-bun-sqlite";
import type { SqlClient } from "../sql-client/interface";
import { PatchDbImplSqlite } from "./impl-sqlite/impl-sqlite";
import type { PatchesDb, PatchInput } from "./interface";

type DbFactory = () => Promise<{ db: PatchesDb; teardown: () => Promise<void> }>;

function makePatch(overrides: Partial<PatchInput> & Pick<PatchInput, "patchId" | "entityId" | "entityType">): PatchInput {
    return {
        attributes: {},
        createdAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        createdBy: "",
        sessionId: "",
        ...overrides,
    };
}

async function createSqliteFactory(): Promise<{ db: PatchesDb; teardown: () => Promise<void> }> {
    const client: SqlClient = SqlClientImplBunSqlite.open(":memory:");
    await client.connect();
    const db = new PatchDbImplSqlite(client);
    await db.migrate();
    return { db, teardown: () => client.disconnect() };
}

const implementations: { name: string; factory: DbFactory }[] = [
    { name: "PatchDbImplSqlite", factory: createSqliteFactory },
];

describe.each(implementations)("$name", ({ factory }) => {
    let db: PatchesDb;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
        const result = await factory();
        db = result.db;
        teardown = result.teardown;
    });

    afterEach(async () => {
        await teardown();
    });

    test("write patches, merge into entity, null deletes attribute, parentId is auto-populated", async () => {
        const p1 = makePatch({
            patchId: "p1",
            entityId: "e1",
            entityType: "task",
            attributes: { title: "Buy milk", priority: "low", status: "open" },
            createdAt: "2025-01-01T00:00:00Z",
        });

        const p2 = makePatch({
            patchId: "p2",
            entityId: "e1",
            entityType: "task",
            attributes: { priority: "high", assignee: "alice" },
            createdAt: "2025-01-01T00:01:00Z",
        });

        const p3 = makePatch({
            patchId: "p3",
            entityId: "e1",
            entityType: "task",
            attributes: { priority: null },
            createdAt: "2025-01-01T00:02:00Z",
        });

        await db.write([p1, p2, p3]);

        const patchResult = await db.patches({ entityType: "task", entityId: "e1" });
        expect(patchResult.data).toHaveLength(3);
        expect(patchResult.total).toBe(3);

        expect(patchResult.data[0].parentId).toBeNull();
        expect(patchResult.data[1].parentId).toBe("p1");
        expect(patchResult.data[2].parentId).toBe("p2");

        const entityResult = await db.entities({ entityType: "task", entityId: "e1" });
        expect(entityResult.data).toHaveLength(1);
        const entity = entityResult.data[0];
        expect(entity.entityId).toBe("e1");
        expect(entity.entityType).toBe("task");
        expect(entity.attributes.title).toBe("Buy milk");
        expect(entity.attributes.assignee).toBe("alice");
        expect(entity.attributes.status).toBe("open");
        expect(entity.attributes).not.toHaveProperty("priority");
    });

    describe("where clauses", () => {
        beforeEach(async () => {
            await db.write([
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
            ]);
        });

        test("where = matches exact value", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "=", attribute: "tag", value: "a" },
            });
            expect(result.data).toHaveLength(2);
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t1", "t3"]);
        });

        test("where != excludes matching value", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "!=", attribute: "tag", value: "a" },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t2"]);
        });

        test("where in matches any of given values", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "in", attribute: "score", values: [10, 30] },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t1", "t3"]);
        });

        test("where not_in excludes given values", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "not_in", attribute: "score", values: [10, 30] },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t2", "t4"]);
        });

        test("where gt matches values greater than", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "gt", attribute: "score", value: 20 },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t3", "t4"]);
        });

        test("where gte matches values greater than or equal", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "gte", attribute: "score", value: 20 },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t2", "t3", "t4"]);
        });

        test("where lt matches values less than", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "lt", attribute: "score", value: 20 },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t1"]);
        });

        test("where lte matches values less than or equal", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "lte", attribute: "score", value: 20 },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t1", "t2"]);
        });

        test("where contains matches substring", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "contains", attribute: "name", value: "Gadget" },
            });
            expect(result.data).toHaveLength(1);
            expect(result.data[0].entityId).toBe("t2");
        });

        test("where exists matches entities that have the attribute", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "exists", attribute: "tag" },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t1", "t2", "t3"]);
        });

        test("where not_exists matches entities missing the attribute", async () => {
            const result = await db.entities({
                entityType: "item",
                where: { type: "not_exists", attribute: "tag" },
            });
            expect(result.data).toHaveLength(1);
            expect(result.data[0].entityId).toBe("t4");
        });

        test("where and requires all clauses to match", async () => {
            const result = await db.entities({
                entityType: "item",
                where: {
                    type: "and",
                    clauses: [
                        { type: "=", attribute: "tag", value: "a" },
                        { type: "gt", attribute: "score", value: 15 },
                    ],
                },
            });
            expect(result.data).toHaveLength(1);
            expect(result.data[0].entityId).toBe("t3");
        });

        test("where or requires any clause to match", async () => {
            const result = await db.entities({
                entityType: "item",
                where: {
                    type: "or",
                    clauses: [
                        { type: "=", attribute: "score", value: 10 },
                        { type: "=", attribute: "score", value: 40 },
                    ],
                },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t1", "t4"]);
        });

        test("where not inverts the clause", async () => {
            const result = await db.entities({
                entityType: "item",
                where: {
                    type: "not",
                    clause: { type: "=", attribute: "tag", value: "a" },
                },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t2"]);
        });

        test("where not combined with exists covers missing attributes", async () => {
            const result = await db.entities({
                entityType: "item",
                where: {
                    type: "or",
                    clauses: [
                        { type: "not", clause: { type: "=", attribute: "tag", value: "a" } },
                        { type: "not_exists", attribute: "tag" },
                    ],
                },
            });
            const ids = result.data.map(e => e.entityId).sort();
            expect(ids).toEqual(["t2", "t4"]);
        });
    });
});
