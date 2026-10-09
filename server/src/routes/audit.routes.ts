import { Router } from 'express';
import type { Database } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { parseQuery } from '../lib/validate.js';
import { auditFiltersSchema } from '../schemas.js';
import { listAudit } from '../services/audit.service.js';
import type { AuditEntityType } from '../types.js';

/** Which entity types each role may read history for. */
const VISIBLE_ENTITIES: Record<string, AuditEntityType[]> = {
  ADMIN: ['USER'],
  MANAGER: ['WORKSHOP', 'USER', 'REGISTRATION'],
};

export function auditRouter(db: Database): Router {
  const router = Router();

  router.get('/', requireAuth(db), requireRole('ADMIN', 'MANAGER'), async (req, res) => {
    const filters = parseQuery(auditFiltersSchema, req.query);
    const visible = VISIBLE_ENTITIES[req.user?.role ?? ''];
    const requested = filters.entityType ? [filters.entityType] : undefined;
    const allowed = requested ?? visible;
    // Never widen the filter beyond what the role may see.
    const entityTypes = allowed?.filter((type) => visible.includes(type));
    if (entityTypes && entityTypes.length === 0) {
      res.json({ audit: [] });
      return;
    }
    res.json({ audit: await listAudit(db, { ...filters, entityTypes }) });
  });

  return router;
}
