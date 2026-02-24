export type FactOp = 'add' | 'retract';

export type Fact = {
    factId: string;
    op: FactOp;
    entityId: string;
    entityType: string;
    attributes: Record<string, unknown>;
    createdAt: string;
    recordedAt: string;
    parentId: string;
    createdBy: string;
    sessionId: string;
}
