import { Router } from 'express';
import type { Database } from '../db/index.js';
import {
  createSession,
  deleteSession,
  findUserForLogin,
  requireAuth,
  sessionCookieOptions,
  toPublicUser,
  verifyPassword,
} from '../lib/auth.js';
import { config } from '../config.js';
import { parseBody } from '../lib/validate.js';
import { loginSchema } from '../schemas.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export function authRouter(db: Database): Router {
  const router = Router();

  router.post('/login', async (req, res) => {
    const { email, password } = parseBody(loginSchema, req.body);

    const user = await findUserForLogin(db, email);
    // One message for both "no such account" and "wrong password" so the
    // endpoint does not reveal which email addresses exist.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw unauthorized('That email and password combination does not match an account.');
    }
    if (!user.isActive) {
      throw forbidden(
        'That account has been deactivated. Ask an administrator to switch it back on.',
      );
    }

    const token = await createSession(db, user.id);
    res.cookie(config.sessionCookieName, token, sessionCookieOptions(config.sessionTtlDays));
    res.json({ user: toPublicUser(user) });
  });

  router.post('/logout', requireAuth(db), async (req, res) => {
    if (req.sessionToken) await deleteSession(db, req.sessionToken);
    res.clearCookie(config.sessionCookieName, sessionCookieOptions(config.sessionTtlDays));
    res.json({ ok: true });
  });

  router.get('/me', requireAuth(db), async (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
