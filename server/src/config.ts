import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runtime configuration.
 *
 * Everything is overridable through environment variables so the app can be
 * pointed at a different database file or port without touching code. Bad
 * values stop the process with a plain-language message rather than being
 * silently coerced: a mistyped SESSION_TTL_DAYS used to become NaN and break
 * every sign-in with a 500.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function fail(message: string): never {
  console.error(`BookMySeat cannot start: ${message}`);
  process.exit(1);
}

/** A whole number between 1 and `max`; falls back only when unset or empty. */
function positiveInt(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    fail(`${name} must be a whole number between 1 and ${max}, but it is "${raw}".`);
  }
  return parsed;
}

/** true/false, accepting the usual spellings; an empty value means "not set". */
function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  switch (raw.trim().toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
    case 'on':
      return true;
    case 'false':
    case '0':
    case 'no':
    case 'off':
      return false;
    default:
      return fail(`${name} must be true or false, but it is "${raw}".`);
  }
}

/** DATABASE_URL, if set, must be a PostgreSQL connection string. */
function databaseUrl(): string | null {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return null;
  if (!/^postgres(ql)?:\/\//i.test(raw)) {
    fail('DATABASE_URL must be a PostgreSQL connection string starting with postgresql://.');
  }
  return raw;
}

export const config = {
  /**
   * Repository root. Works both when running TypeScript sources through `tsx`
   * (server/src) and when running the compiled output (server/dist).
   */
  repoRoot: path.resolve(moduleDir, '..', '..'),

  /** Built frontend assets, served by the API in single-process mode. */
  clientDistPath: path.resolve(moduleDir, '..', '..', 'client', 'dist'),

  /**
   * PostgreSQL connection string - in production, the Supabase connection
   * string. When it is not set, an embedded PostgreSQL (PGlite) stored at
   * `databasePath` is used instead, so local development needs no setup.
   */
  databaseUrl: databaseUrl(),

  /** Directory for the embedded database, used only when DATABASE_URL is unset. */
  databasePath:
    process.env.DATABASE_PATH ?? path.join(path.resolve(moduleDir, '..', '..'), 'data', 'pglite'),

  /** Connections the API may open to PostgreSQL. */
  databasePoolSize: positiveInt('DATABASE_POOL_SIZE', 5, 100),

  port: positiveInt('PORT', 4000, 65535),

  isProduction: process.env.NODE_ENV === 'production',

  /** Session cookie lifetime; sessions are stored server-side and revocable. */
  sessionTtlDays: positiveInt('SESSION_TTL_DAYS', 14, 365),
  sessionCookieName: 'bookmyseat_session',

  /** Create demo accounts and workshops the first time a database is initialised. */
  seedDemoData: boolean('SEED_DEMO_DATA', true),
} as const;

/** Where the database lives: a postgres:// URL or the embedded database directory. */
export const databaseTarget = (): string => config.databaseUrl ?? config.databasePath;

/** The target with any password masked, safe for logs. */
export function describeDatabase(): string {
  if (!config.databaseUrl) return `embedded PostgreSQL at ${config.databasePath}`;
  try {
    const url = new URL(config.databaseUrl);
    if (url.password) url.password = '****';
    return url.toString();
  } catch {
    return 'the configured DATABASE_URL';
  }
}
