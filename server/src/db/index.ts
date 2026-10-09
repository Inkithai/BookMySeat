import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

/**
 * Database access.
 *
 * BookMySeat runs on PostgreSQL. In production that is a hosted database such
 * as Supabase, reached through DATABASE_URL. When no URL is configured (local
 * development, the test suite) an embedded PostgreSQL - PGlite - is used
 * instead, so the app still starts with nothing to install.
 *
 * Both back ends sit behind the same small async interface. SQL is written with
 * `?` placeholders and translated to PostgreSQL's `$1, $2, ...` here, which
 * keeps the service code readable.
 */

export type Row = Record<string, unknown>;
export type Param = string | number | boolean | null;

export interface Database {
  /** All rows of a query. */
  all(sql: string, params?: Param[]): Promise<Row[]>;
  /** The first row of a query, or undefined. */
  get(sql: string, params?: Param[]): Promise<Row | undefined>;
  /** A statement run for its effect; returns the number of rows touched. */
  run(sql: string, params?: Param[]): Promise<number>;
  /** One or more statements without parameters (schema, resets). */
  exec(sql: string): Promise<void>;
  /**
   * Runs `fn` inside a single transaction; any error rolls it all back. Calls
   * made on an already-transactional handle simply join the open transaction.
   */
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const schemaSql = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'),
  'utf8',
);

/** Message raised by the overbooking trigger in schema.sql. */
const CAPACITY_ERROR = 'WORKSHOP_CAPACITY_EXCEEDED';

/** Turns `?` placeholders into `$1, $2, ...`, leaving quoted text alone. */
export function toPositional(sql: string): string {
  let index = 0;
  let out = '';
  let quote: string | null = null;
  for (const char of sql) {
    if (quote) {
      if (char === quote) quote = null;
      out += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      out += char;
    } else if (char === '?') {
      out += `$${++index}`;
    } else {
      out += char;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// node-postgres (Supabase or any PostgreSQL server)
// ---------------------------------------------------------------------------

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

function pgHandle(target: Queryable, inTransaction: boolean, pool: pg.Pool): Database {
  const handle: Database = {
    async all(sql, params = []) {
      return (await target.query(toPositional(sql), params)).rows as Row[];
    },
    async get(sql, params = []) {
      return (await target.query(toPositional(sql), params)).rows[0] as Row | undefined;
    },
    async run(sql, params = []) {
      return (await target.query(toPositional(sql), params)).rowCount ?? 0;
    },
    async exec(sql) {
      await target.query(sql);
    },
    async transaction(fn) {
      if (inTransaction) return fn(handle);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(pgHandle(client, true, pool));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      if (!inTransaction) await pool.end();
    },
  };
  return handle;
}

/**
 * Hosted databases (Supabase included) need TLS; a database on the same
 * machine usually does not. DATABASE_SSL overrides the guess either way.
 */
function sslFor(url: URL): pg.PoolConfig['ssl'] {
  const setting = process.env.DATABASE_SSL?.trim().toLowerCase();
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  const enabled = setting ? !['false', '0', 'no', 'off', 'disable'].includes(setting) : !local;
  // Supabase's pooler presents a certificate node does not ship the CA for, so
  // the connection is encrypted without pinning the chain.
  return enabled ? { rejectUnauthorized: false } : false;
}

function openPostgres(connectionString: string, poolSize: number): Database {
  const url = new URL(connectionString);
  const ssl = sslFor(url);
  // An sslmode in the URL would override the explicit setting above (and
  // `require` now means "verify the certificate" to node-postgres).
  url.searchParams.delete('sslmode');

  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl,
    max: poolSize,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (error) => console.error('Idle database connection failed:', error.message));
  return pgHandle(pool, false, pool);
}

// ---------------------------------------------------------------------------
// PGlite (embedded PostgreSQL for local use and tests)
// ---------------------------------------------------------------------------

type PGliteLike = Pick<PGlite, 'query' | 'exec'>;

function pgliteHandle(target: PGliteLike, inTransaction: boolean, root: PGlite): Database {
  const handle: Database = {
    async all(sql, params = []) {
      return (await target.query<Row>(toPositional(sql), params)).rows;
    },
    async get(sql, params = []) {
      return (await target.query<Row>(toPositional(sql), params)).rows[0];
    },
    async run(sql, params = []) {
      return (await target.query(toPositional(sql), params)).affectedRows ?? 0;
    },
    async exec(sql) {
      await target.exec(sql);
    },
    async transaction(fn) {
      if (inTransaction) return fn(handle);
      return root.transaction((tx) => fn(pgliteHandle(tx, true, root)));
    },
    async close() {
      if (!inTransaction) await root.close();
    },
  };
  return handle;
}

async function openEmbedded(location: string): Promise<Database> {
  let db: PGlite;
  if (location === ':memory:') {
    db = new PGlite();
  } else {
    fs.mkdirSync(path.resolve(location), { recursive: true });
    db = new PGlite(path.resolve(location));
  }
  await db.waitReady;
  return pgliteHandle(db, false, db);
}

// ---------------------------------------------------------------------------

/**
 * Opens the database and makes sure the schema exists.
 *
 * `target` is either a postgres:// connection string or, for the embedded
 * database, a directory path (or ':memory:').
 */
export async function openDatabase(target: string, poolSize = 5): Promise<Database> {
  const db = /^postgres(ql)?:\/\//i.test(target)
    ? openPostgres(target, poolSize)
    : await openEmbedded(target);

  try {
    await db.exec(schemaSql);
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }
  return db;
}

/**
 * Runs `fn` inside a single transaction. Any error rolls the whole unit of work
 * back, so a half-applied registration can never be committed.
 */
export function withTransaction<T>(db: Database, fn: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/** True when a statement was aborted by the capacity trigger. */
export function isCapacityError(error: unknown): boolean {
  return error instanceof Error && error.message === CAPACITY_ERROR;
}

/**
 * True when a UNIQUE constraint rejected a row. PostgreSQL names the violated
 * constraint, so the caller passes the constraint (or index) names it cares about.
 */
export function isUniqueConstraintError(error: unknown, ...constraints: string[]): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (code !== '23505') return false;
  return constraints.length === 0 || (constraint !== undefined && constraints.includes(constraint));
}
