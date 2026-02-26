export type Op = 'add' | 'retract';

export type Patch = {
    patchId: string;
    op: Op;
    entityId: string;
    entityType: string;
    attributes: Record<string, unknown>;
    createdAt: string;
    recordedAt: string;
    parentId: string;
    createdBy: string;
    sessionId: string;
}

export type Entity = {
    entityId: string;
    entityType: string;
    attributes: Record<string, unknown>;
}

export type PatchesDbQueryWhereClause = {
    type: "=";
    attribute: string;
    value: unknown;
} | {
    type: "!=";
    attribute: string;
    value: unknown;
} | {
    type: "in";
    attribute: string;
    values: unknown[];
} | {
    type: "not_in";
    attribute: string;
    values: unknown[];
} | {
    type: "gt";
    attribute: string;
    value: unknown;
} | {
    type: "gte";
    attribute: string;
    value: unknown;
} | {
    type: "lt";
    attribute: string;
    value: unknown;
} | {
    type: "lte";
    attribute: string;
    value: unknown;
} | {
    type: "contains";
    attribute: string;
    value: string;
} | {
    type: "exists";
    attribute: string;
} | {
    type: "not_exists";
    attribute: string;
} | {
    type: "or";
    clauses: PatchesDbQueryWhereClause[];
} | {
    type: "and";
    clauses: PatchesDbQueryWhereClause[];
} | {
    type: "not";
    clause: PatchesDbQueryWhereClause;
}

export type PatchesDbQueryOrderBy = {
    attribute: string;
    direction: "asc" | "desc";
}

export type PatchesDbQuery = {
    entityType: string;
    entityId?: string | string[];       // single or batch entity lookup
    where?: PatchesDbQueryWhereClause;
    orderBy?: PatchesDbQueryOrderBy[];
    limit?: number;
    offset?: number;
    after?: string;                     // cursor-based pagination
}

export type PatchesDbSubscription = {
    unsubscribe: () => void;
}

export type PatchesDbResult<T> = {
    data: T[];
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
}


export interface PatchesDb {
    // Writes
    write(patches: Patch[]): Promise<void>;
    // Reads
    patches(query: PatchesDbQuery): Promise<PatchesDbResult<Patch>>;
    entities(query: PatchesDbQuery): Promise<PatchesDbResult<Entity>>;
}
