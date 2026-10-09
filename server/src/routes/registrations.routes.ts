import { Router } from 'express';
import type { Database } from '../db/index.js';
import { actorOf, requireAuth, requireRole } from '../lib/auth.js';
import { parseValue } from '../lib/validate.js';
import { idParamSchema } from '../schemas.js';
import { cancelRegistration, promoteWaitlisted } from '../services/registrations.service.js';

export function registrationsRouter(db: Database): Router {
  const router = Router();

  // Cancelling frees the seat but keeps the record, so history stays readable.
  router.delete('/:id', requireAuth(db), requireRole('MANAGER', 'STAFF'), async (req, res) => {
    const id = parseValue(idParamSchema, req.params.id, 'registration id');
    const { registration, promoted } = await cancelRegistration(db, id, actorOf(req));
    res.json({ registration, promoted });
  });

  // Offering a free seat to a specific person on the waitlist.
  router.post('/:id/promote', requireAuth(db), requireRole('MANAGER', 'STAFF'), async (req, res) => {
    const id = parseValue(idParamSchema, req.params.id, 'registration id');
    const registration = await promoteWaitlisted(db, id, actorOf(req));
    res.json({ registration });
  });

  return router;
}
