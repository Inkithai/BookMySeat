import { Router } from 'express';
import type { Database } from '../db/index.js';
import { actorOf, requireAuth, requireRole } from '../lib/auth.js';
import { parseBody, parseQuery, parseValue } from '../lib/validate.js';
import {
  createWorkshopSchema,
  idParamSchema,
  registerAttendeeSchema,
  updateWorkshopSchema,
  workshopFiltersSchema,
} from '../schemas.js';
import { createWorkshop, getWorkshopDetail, listWorkshops, updateWorkshop } from '../services/workshops.service.js';
import { registerAttendee } from '../services/registrations.service.js';

export function workshopsRouter(db: Database): Router {
  const router = Router();

  // Reading the catalogue is for the people who work with attendees.
  router.get('/', requireAuth(db), requireRole('MANAGER', 'STAFF'), async (req, res) => {
    const filters = parseQuery(workshopFiltersSchema, req.query);
    res.json({ workshops: await listWorkshops(db, filters) });
  });

  // Adding and editing workshops is the programme manager's job.
  router.post('/', requireAuth(db), requireRole('MANAGER'), async (req, res) => {
    const input = parseBody(createWorkshopSchema, req.body);
    const workshop = await createWorkshop(db, input, actorOf(req));
    res.status(201).json({ workshop });
  });

  router.get('/:id', requireAuth(db), requireRole('MANAGER', 'STAFF'), async (req, res) => {
    const id = parseValue(idParamSchema, req.params.id, 'workshop id');
    res.json({ workshop: await getWorkshopDetail(db, id) });
  });

  router.patch('/:id', requireAuth(db), requireRole('MANAGER'), async (req, res) => {
    const id = parseValue(idParamSchema, req.params.id, 'workshop id');
    const patch = parseBody(updateWorkshopSchema, req.body);
    const workshop = await updateWorkshop(db, id, patch, actorOf(req));
    res.json({ workshop });
  });

  // Front desk staff and managers register attendees.
  router.post('/:id/registrations', requireAuth(db), requireRole('MANAGER', 'STAFF'), async (req, res) => {
    const workshopId = parseValue(idParamSchema, req.params.id, 'workshop id');
    const input = parseBody(registerAttendeeSchema, req.body);
    const result = await registerAttendee(db, { ...input, workshopId }, actorOf(req));
    res.status(201).json({
      registration: result.registration,
      seatsRemaining: result.seatsRemaining,
      waitlisted: result.waitlisted,
    });
  });

  return router;
}
