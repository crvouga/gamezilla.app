import { SqlClient } from "../../sql-client/interface";
import { Fact } from "../fact";
import { FactDb } from "./interface";

type FactRow = {
    fact_id: string;
    op: string;
    entity_id: string;
    entity_type: string;
    attributes: string;
    created_at: string;
    recorded_at: string;
    parent_id: string;
    created_by: string;
    session_id: string;
};

const FACT_ROW_KEYS: (keyof FactRow)[] = [
    "fact_id", "op", "entity_id", "entity_type", "attributes",
    "created_at", "recorded_at", "parent_id", "created_by", "session_id",
];

function isFactRow(row: unknown): row is FactRow {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return FACT_ROW_KEYS.every((k) => typeof r[k] === "string");
}

function toFact(row: unknown): Fact {
    if (!isFactRow(row)) throw new Error("Invalid fact row");
    return {
        factId: row.fact_id,
        op: row.op === "add" ? "add" : "retract",
        entityId: row.entity_id,
        entityType: row.entity_type,
        attributes: JSON.parse(row.attributes),
        createdAt: row.created_at,
        recordedAt: row.recorded_at,
        parentId: row.parent_id,
        createdBy: row.created_by,
        sessionId: row.session_id,
    };
}

export const migrations = `
  CREATE TABLE IF NOT EXISTS facts (
    fact_id TEXT PRIMARY KEY,
    op TEXT CHECK (op IN ('add', 'retract')) NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    attributes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now')) NOT NULL,
    parent_id TEXT REFERENCES facts(fact_id),
    created_by TEXT NOT NULL,
    session_id TEXT,
    CONSTRAINT unique_entity_fact UNIQUE(entity_id, op, created_at)
  );

  CREATE INDEX IF NOT EXISTS idx_facts_entity_type_recorded_at ON facts(entity_type, recorded_at);
  CREATE INDEX IF NOT EXISTS idx_facts_entity_id ON facts(entity_id);
  CREATE INDEX IF NOT EXISTS idx_facts_created_by ON facts(created_by);
`;

const INSERT_FACT_SQL = `INSERT INTO facts (fact_id, op, entity_id, entity_type, attributes, created_at, recorded_at, parent_id, created_by, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export class FactDbImplSqlite implements FactDb {
    constructor(private sqlClient: SqlClient) { }

    async migrate(): Promise<void> {
        await this.sqlClient.run(migrations);
    }

    async append(fact: Fact): Promise<void> {
        await this.sqlClient.run(
            INSERT_FACT_SQL,
            [
                fact.factId,
                fact.op,
                fact.entityId,
                fact.entityType,
                JSON.stringify(fact.attributes),
                fact.createdAt,
                fact.recordedAt,
                fact.parentId,
                fact.createdBy,
                fact.sessionId,
            ]
        );
    }

    async listByEntityId(entityId: string): Promise<Fact[]> {
        const rows = await this.sqlClient.query("SELECT * FROM facts WHERE entity_id = ?", [entityId]);
        return rows.map(toFact);
    }
}
