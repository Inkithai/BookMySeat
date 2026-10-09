import { Router } from 'express';
import type { Database } from '../db/index.js';
import { auditRouter } from './audit.routes.js';
import { authRouter } from './auth.routes.js';
import { registrationsRouter } from './registrations.routes.js';
import { usersRouter } from './users.routes.js';
import { workshopsRouter } from './workshops.routes.js';

export function apiRouter(db: Database): Router {
  const router = Router();

  router.use('/auth', authRouter(db));
  router.use('/workshops', workshopsRouter(db));
  router.use('/registrations', registrationsRouter(db));
  router.use('/users', usersRouter(db));
  router.use('/audit', auditRouter(db));

  return router;
}
