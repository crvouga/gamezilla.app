export type Op = 'add' | 'retract';

export type Fact = {
    factId: string;
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

export type FactsDbQueryWhereClause = {
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
    clauses: FactsDbQueryWhereClause[];
} | {
    type: "and";
    clauses: FactsDbQueryWhereClause[];
} | {
    type: "not";
    clause: FactsDbQueryWhereClause;
}

export type FactsDbQueryOrderBy = {
    attribute: string;
    direction: "asc" | "desc";
}

export type FactsDbQuery = {
    entityType: string;
    entityId?: string | string[];       // single or batch entity lookup
    where?: FactsDbQueryWhereClause;
    orderBy?: FactsDbQueryOrderBy[];
    limit?: number;
    offset?: number;
    after?: string;                     // cursor-based pagination
}

export type FactsDbSubscription = {
    unsubscribe: () => void;
}

export type FactsDbResult<T> = {
    data: T[];
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
}


export interface FactsDb {
    // Writes
    write(facts: Fact[]): Promise<void>;
    // Reads
    facts(query: FactsDbQuery): Promise<FactsDbResult<Fact>>;
    entities(query: FactsDbQuery): Promise<FactsDbResult<Entity>>;
}