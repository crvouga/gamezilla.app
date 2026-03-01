import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PatchesDb } from "../interface";
import { implementations, makePatch } from "./test-helpers";

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
});
