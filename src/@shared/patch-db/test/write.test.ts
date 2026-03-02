import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PatchesDb } from "../interface";
import { implementations, teardownPostgresTests } from "./test-helpers";

describe.each(implementations)("$name", ({ name, factory }) => {
    let db: PatchesDb;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
        const result = await factory();
        db = result.db;
        teardown = result.teardown;
    });

    afterEach(async () => {
        if (teardown) await teardown();
    });

    afterAll(async () => {
        if (name === "PatchDbImplPostgres") await teardownPostgresTests();
    });

    test("write patches, merge into entity, null deletes attribute, parentId is auto-populated", async () => {
        const p1 = {
            entityId: "e1",
            entityType: "task",
            attributes: { title: "Buy milk", priority: "low", status: "open" },
        };

        const p2 = {
            entityId: "e1",
            entityType: "task",
            attributes: { priority: "high", assignee: "alice" },
        };

        const p3 = {
            entityId: "e1",
            entityType: "task",
            attributes: { priority: null },
        };

        const written = await db.patch([p1, p2, p3]);
        expect(written).toHaveLength(3);

        const patchResult = await db.read({ entityType: "task", entityId: "e1" });
        expect(patchResult.data).toHaveLength(3);
        expect(patchResult.total).toBe(3);

        expect(patchResult.data[0].parentId).toBeNull();
        expect(patchResult.data[1].parentId).toBe(written[0].patchId);
        expect(patchResult.data[2].parentId).toBe(written[1].patchId);

        expect(patchResult.data[0].createdAt).toBeDefined();
        expect(patchResult.data[0].recordedAt).toBeDefined();
        expect(typeof patchResult.data[0].createdAt).toBe("string");
        expect(typeof patchResult.data[0].recordedAt).toBe("string");

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
