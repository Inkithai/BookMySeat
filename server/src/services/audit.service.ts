import type { Database } from '../db/index.js';
import type { AuditEntityType, AuditEntry } from '../types.js';
import { num, nullableStr, str, type Row } from '../lib/rows.js';

export type AuditFilters = {
  entityType?: AuditEntityType;
  entityId?: number;
  /** Only rows about these entity types - used to keep Admins on USER history. */
  entityTypes?: AuditEntityType[];
  limit?: number;
};

const SELECT_AUDIT = `
  SELECT a.id, a.entity_type, a.entity_id, a.action, a.summary, a.detail, a.created_at,
         actor.id AS actor_id, actor.name AS actor_name, actor.email AS actor_email
  FROM audit_log a
  LEFT JOIN users actor ON actor.id = a.actor_id`;

function toAuditEntry(row: Row): AuditEntry {
  const detail = nullableStr(row.detail);
  return {
    id: num(row.id),
    entityType: str(row.entity_type) as AuditEntityType,
    entityId: row.entity_id == null ? null : num(row.entity_id),
    action: str(row.action),
    summary: str(row.summary),
    detail: detail ? (JSON.parse(detail) as Record<string, unknown>) : null,
    actor: {
      id: num(row.actor_id),
      name: str(row.actor_name),
      email: str(row.actor_email),
    },
    createdAt: str(row.created_at),
  };
}

export async function listAudit(db: Database, filters: AuditFilters = {}): Promise<AuditEntry[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.entityType) {
    conditions.push('a.entity_type = ?');
    params.push(filters.entityType);
  }
  if (filters.entityTypes) {
    conditions.push(`a.entity_type IN (${filters.entityTypes.map(() => '?').join(', ')})`);
    params.push(...filters.entityTypes);
  }
  if (filters.entityId !== undefined) {
    conditions.push('a.entity_id = ?');
    params.push(filters.entityId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.all(
    `${SELECT_AUDIT} ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    [...params, filters.limit ?? 100],
  );
  return rows.map(toAuditEntry);
}

/** Recent activity for a single workshop: its edits plus its registration events. */
export async function listAuditForWorkshop(
  db: Database,
  workshopId: number,
  limit = 12,
): Promise<AuditEntry[]> {
  const rows = await db.all(
      `${SELECT_AUDIT}
       WHERE (a.entity_type = 'WORKSHOP' AND a.entity_id = ?)
          OR (a.entity_type = 'REGISTRATION' AND a.entity_id IN
              (SELECT id FROM registrations WHERE workshop_id = ?))
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
    [workshopId, workshopId, limit],
  );
  return rows.map(toAuditEntry);
}
