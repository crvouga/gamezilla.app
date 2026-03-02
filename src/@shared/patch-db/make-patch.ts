import type { PatchInput } from "./interface";

export function makePatchInput(
    overrides: Partial<PatchInput> & Pick<PatchInput, "patchId" | "entityId" | "entityType">
): PatchInput {
    const now = new Date().toISOString();
    return {
        attributes: {},
        createdAt: now,
        recordedAt: now,
        createdBy: "",
        sessionId: "",
        ...overrides,
    };
}
