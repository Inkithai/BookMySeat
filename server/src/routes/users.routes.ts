import { Router } from 'express';
import type { Database } from '../db/index.js';
import { actorOf, requireAuth, requireRole } from '../lib/auth.js';
import { parseBody, parseValue } from '../lib/validate.js';
import { createUserSchema, idParamSchema, updateUserSchema } from '../schemas.js';
import { createUser, getUser, listUsers, updateUser } from '../services/users.service.js';

export function usersRouter(db: Database): Router {
  const router = Router();

  // Account management is the administrator's job only.
  router.get('/', requireAuth(db), requireRole('ADMIN'), async (_req, res) => {
    res.json({ users: await listUsers(db) });
  });

  router.post('/', requireAuth(db), requireRole('ADMIN'), async (req, res) => {
    const input = parseBody(createUserSchema, req.body);
    const user = await createUser(db, input, actorOf(req));
    res.status(201).json({ user });
  });

  router.get('/:id', requireAuth(db), requireRole('ADMIN'), async (req, res) => {
    const id = parseValue(idParamSchema, req.params.id, 'user id');
    res.json({ user: await getUser(db, id) });
  });

  router.patch('/:id', requireAuth(db), requireRole('ADMIN'), async (req, res) => {
    const id = parseValue(idParamSchema, req.params.id, 'user id');
    const patch = parseBody(updateUserSchema, req.body);
    const user = await updateUser(db, id, patch, actorOf(req));
    res.json({ user });
  });

  return router;
}
