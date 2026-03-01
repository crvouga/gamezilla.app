import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SqlClientImplBunSqlite } from "../sql-client/impl-bun-sqlite";
import type { SqlClient } from "../sql-client/interface";
import { PatchDbImplSqlite } from "./impl-sqlite/impl-sqlite";
import type { PatchesDb, Patch } from "./interface";

type DbFactory = () => Promise<{ db: PatchesDb; teardown: () => Promise<void> }>;

function makePatch(overrides: Partial<Patch> & Pick<Patch, "patchId" | "entityId" | "entityType">): Patch {
    return {
        attributes: {},
        createdAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        parentId: "",
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

    test("write patches, merge into entity, null deletes attribute", async () => {
        const p1 = makePatch({
            patchId: "p1",
            entityId: "e1",
            entityType: "task",
            attributes: { title: "Buy milk", priority: "low", status: "open" },
            createdAt: "2025-01-01T00:00:00Z",
            parentId: "",
        });

        const p2 = makePatch({
            patchId: "p2",
            entityId: "e1",
            entityType: "task",
            attributes: { priority: "high", assignee: "alice" },
            createdAt: "2025-01-01T00:01:00Z",
            parentId: "p1",
        });

        const p3 = makePatch({
            patchId: "p3",
            entityId: "e1",
            entityType: "task",
            attributes: { priority: null },
            createdAt: "2025-01-01T00:02:00Z",
            parentId: "p2",
        });

        await db.write([p1, p2, p3]);

        const patchResult = await db.patches({ entityType: "task", entityId: "e1" });
        expect(patchResult.data).toHaveLength(3);
        expect(patchResult.total).toBe(3);

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
});
