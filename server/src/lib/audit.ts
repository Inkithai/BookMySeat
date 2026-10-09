import type { Database } from '../db/index.js';
import { nowIso } from './datetime.js';
import type { ActorRef, AuditEntityType } from '../types.js';

export type AuditWriter = {
  entityType: AuditEntityType;
  entityId: number | null;
  action: string;
  /** Human readable line, e.g. "Cancelled Amara Okafor from Pottery Basics". */
  summary: string;
  /** Structured before/after values for the fields that changed. */
  detail?: Record<string, unknown>;
};

/**
 * Appends a row to the audit trail. Callers pass this through to the service
 * functions so an audit write always lands in the same transaction as the
 * change it describes.
 */
export async function recordAudit(db: Database, actor: ActorRef, entry: AuditWriter): Promise<void> {
  await db.run(
    `INSERT INTO audit_log
       (entity_type, entity_id, action, summary, detail, actor_id, actor_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.summary,
      entry.detail ? JSON.stringify(entry.detail) : null,
      actor.id,
      actor.email,
      nowIso(),
    ],
  );
}
