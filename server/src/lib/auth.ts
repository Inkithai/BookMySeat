import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, RequestHandler } from 'express';
import type { Database } from '../db/index.js';
import { config } from '../config.js';
import { nowIso } from './datetime.js';
import { forbidden, unauthorized } from './errors.js';
import type { ActorRef, Role, UserRecord, UserSummary } from '../types.js';

// Lets route handlers read `req.user` without repeating a cast.
declare module 'express-serve-static-core' {
  interface Request {
    user?: UserSummary;
    sessionToken?: string;
  }
}

const BCRYPT_COST = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

/** Session tokens are random; only their SHA-256 hash is stored. */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readCookie(req: Request, name: string): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[name];
}

const USER_SUMMARY_COLUMNS = `u.id, u.email, u.name, u.role, u.is_active, u.created_at,
  creator.name AS created_by_name`;

function toUserSummary(row: Record<string, unknown>): UserSummary {
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name),
    role: String(row.role) as Role,
    isActive: Number(row.is_active) === 1,
    createdAt: String(row.created_at),
    createdByName: row.created_by_name == null ? null : String(row.created_by_name),
  };
}

/** Strips the password hash; this is the only shape that leaves the service. */
export function toPublicUser(user: UserRecord): UserSummary {
  const { passwordHash: _hash, ...summary } = user;
  return summary;
}

/** Includes the password hash; used only by the login flow. */
export async function findUserForLogin(db: Database, email: string): Promise<UserRecord | null> {
  const row = await db.get(
    `SELECT u.id, u.email, u.name, u.role, u.is_active, u.created_at,
            u.password_hash, creator.name AS created_by_name
     FROM users u LEFT JOIN users creator ON creator.id = u.created_by
     WHERE lower(u.email) = ?`,
    [email.trim().toLowerCase()],
  );
  return row ? { ...toUserSummary(row), passwordHash: String(row.password_hash) } : null;
}

export async function createSession(db: Database, userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [new Date(now).toISOString()]);
  await db.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [
      hashToken(token),
      userId,
      new Date(now).toISOString(),
      new Date(now + config.sessionTtlDays * 24 * 60 * 60 * 1000).toISOString(),
    ],
  );
  return token;
}

async function findUserForSessionToken(db: Database, token: string): Promise<UserSummary | null> {
  const row = await db.get(
    `SELECT ${USER_SUMMARY_COLUMNS} FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN users creator ON creator.id = u.created_by
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
    [hashToken(token), nowIso()],
  );
  return row ? toUserSummary(row) : null;
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}

export async function deleteSessionsForUser(db: Database, userId: number): Promise<void> {
  await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export function sessionCookieOptions(maxAgeDays: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction,
    path: '/',
    maxAge: maxAgeDays * 24 * 60 * 60 * 1000,
  };
}

/** Rejects the request unless a valid session cookie is present. */
export function requireAuth(db: Database): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req, config.sessionCookieName);
    const user = token ? await findUserForSessionToken(db, token) : null;
    if (!token || !user) {
      next(unauthorized());
      return;
    }
    req.user = user;
    req.sessionToken = token;
    next();
  };
}

/**
 * Rejects the request unless the signed-in user holds one of `roles`.
 *
 * This is the backend half of the permissions matrix: the UI hides what a role
 * cannot do, but the API is what actually refuses it.
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
}

/** The signed-in user as an actor reference for audit rows. */
export function actorOf(req: Request): ActorRef {
  if (!req.user) throw unauthorized();
  return { id: req.user.id, name: req.user.name, email: req.user.email };
}
