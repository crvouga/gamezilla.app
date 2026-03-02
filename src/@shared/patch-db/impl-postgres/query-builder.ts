import type { PatchesDbQuery, PatchesDbQueryWhereClause } from "../interface";

export type WhereFragment = { sql: string; params: unknown[] };

export function sanitizeIdentifier(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name)) {
        throw new Error(`Invalid attribute name: ${name}`);
    }
    return name;
}

/**
 * PGlite/Bun may store JSONB as a string (double-encoded). Use #>> '{}' to extract
 * the root, then ::jsonb to parse, so we get the actual object for attribute access.
 */
function jsonbAttrs(prefix = ""): string {
    return `(${prefix}attributes #>> '{}')::jsonb`;
}

/** Use literal key (sanitized) for JSONB access - avoids parameter binding issues with dynamic keys */
function jsonAttrLiteral(attr: string, prefix = ""): string {
    const safe = sanitizeIdentifier(attr);
    return `${jsonbAttrs(prefix)}->>'${safe}'`;
}

/** Escape string for safe SQL literal */
function escapeSqlLiteral(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/** Build equality using ->> (returns text) with literal - PGlite has issues with jsonb param binding */
function jsonEqualsLiteral(attr: string, value: unknown, prefix = ""): string {
    const val =
        typeof value === "string"
            ? `'${escapeSqlLiteral(value)}'`
            : typeof value === "number"
              ? `'${String(value)}'`
              : `'${escapeSqlLiteral(JSON.stringify(value))}'`;
    return `(${jsonAttrLiteral(attr, prefix)}) = ${val}`;
}

export function buildWhereClause(clause: PatchesDbQueryWhereClause, prefix = ""): WhereFragment {
    switch (clause.type) {
        case "=":
            return { sql: jsonEqualsLiteral(clause.attribute, clause.value, prefix), params: [] };
        case "!=":
            return { sql: `NOT (${jsonEqualsLiteral(clause.attribute, clause.value, prefix)})`, params: [] };
        case "gt":
            return { sql: `(${jsonAttrLiteral(clause.attribute, prefix)})::numeric > ?::numeric`, params: [clause.value] };
        case "gte":
            return { sql: `(${jsonAttrLiteral(clause.attribute, prefix)})::numeric >= ?::numeric`, params: [clause.value] };
        case "lt":
            return { sql: `(${jsonAttrLiteral(clause.attribute, prefix)})::numeric < ?::numeric`, params: [clause.value] };
        case "lte":
            return { sql: `(${jsonAttrLiteral(clause.attribute, prefix)})::numeric <= ?::numeric`, params: [clause.value] };
        case "contains":
            return { sql: `${jsonAttrLiteral(clause.attribute, prefix)} LIKE '%' || ? || '%'`, params: [clause.value] };
        case "in": {
            const placeholders = clause.values.map(() => "?::text").join(", ");
            return {
                sql: `${jsonAttrLiteral(clause.attribute, prefix)} IN (${placeholders})`,
                params: [...clause.values],
            };
        }
        case "not_in": {
            const placeholders = clause.values.map(() => "?::text").join(", ");
            return {
                sql: `${jsonAttrLiteral(clause.attribute, prefix)} NOT IN (${placeholders})`,
                params: [...clause.values],
            };
        }
        case "exists":
            return { sql: `${jsonbAttrs(prefix)}->'${sanitizeIdentifier(clause.attribute)}' IS NOT NULL`, params: [] };
        case "not_exists":
            return { sql: `${jsonbAttrs(prefix)}->'${sanitizeIdentifier(clause.attribute)}' IS NULL`, params: [] };
        case "and": {
            const parts = clause.clauses.map(c => buildWhereClause(c, prefix));
            return { sql: `(${parts.map(p => p.sql).join(" AND ")})`, params: parts.flatMap(p => p.params) };
        }
        case "or": {
            const parts = clause.clauses.map(c => buildWhereClause(c, prefix));
            return { sql: `(${parts.map(p => p.sql).join(" OR ")})`, params: parts.flatMap(p => p.params) };
        }
        case "not": {
            const inner = buildWhereClause(clause.clause, prefix);
            return { sql: `NOT (${inner.sql})`, params: inner.params };
        }
    }
}

export function buildSnapshotConditions(query: PatchesDbQuery, tablePrefix = ""): { conditions: string[]; params: unknown[] } {
    const conditions: string[] = [`${tablePrefix}entity_type = ?`];
    const params: unknown[] = [query.entityType];

    if (query.entityId != null) {
        if (Array.isArray(query.entityId)) {
            const placeholders = query.entityId.map(() => "?").join(", ");
            conditions.push(`${tablePrefix}entity_id IN (${placeholders})`);
            params.push(...query.entityId);
        } else {
            conditions.push(`${tablePrefix}entity_id = ?`);
            params.push(query.entityId);
        }
    }

    if (query.where) {
        const fragment = buildWhereClause(query.where, tablePrefix);
        conditions.push(fragment.sql);
        params.push(...fragment.params);
    }

    return { conditions, params };
}

export function buildOrderSQL(query: PatchesDbQuery, defaultOrder: string, attributePrefix = ""): string {
    if (query.orderBy && query.orderBy.length > 0) {
        const attrsExpr = jsonbAttrs(attributePrefix);
        return (
            "ORDER BY " +
            query.orderBy
                .map(o => {
                    const attr = sanitizeIdentifier(o.attribute);
                    const dir = o.direction === "desc" ? "DESC" : "ASC";
                    return `${attrsExpr}->>'${attr}' ${dir}`;
                })
                .join(", ")
        );
    }
    return defaultOrder;
}

export function buildLimitSQL(query: PatchesDbQuery): { sql: string; params: unknown[] } {
    let sql = "";
    const params: unknown[] = [];
    if (query.limit != null) {
        sql += " LIMIT ?";
        params.push(query.limit);
    }
    if (query.offset != null) {
        sql += " OFFSET ?";
        params.push(query.offset);
    }
    return { sql, params };
}
