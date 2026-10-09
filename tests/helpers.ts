import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/src/app.js';
import { openDatabase, type Database } from '../server/src/db/index.js';
import { resetAndSeed } from '../server/src/db/seed.js';
import type { WorkshopDetail, Workshop } from '../server/src/types.js';

export const ACCOUNTS = {
  admin: { email: 'admin@bookmyseat.test', password: 'Admin123!' },
  manager: { email: 'manager@bookmyseat.test', password: 'Manager123!' },
  staff: { email: 'staff@bookmyseat.test', password: 'Staff123!' },
};

export type Account = keyof typeof ACCOUNTS;

type ApiResponse<T> = {
  status: number;
  body: T;
  /** "name=value" of the session cookie, when the response set one. */
  cookie: string | null;
};

export async function startServer() {
  const db: Database = await openDatabase(':memory:');
  await resetAndSeed(db);

  const server: Server = await new Promise((resolve, reject) => {
    const listener = createApp(db).listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  async function request<T>(
    path: string,
    options: { method?: string; body?: unknown; cookie?: string | null } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.cookie) headers.Cookie = options.cookie;

    const response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    const setCookie = response.headers.get('set-cookie');
    return {
      status: response.status,
      body: text ? (JSON.parse(text) as T) : (undefined as T),
      cookie: setCookie ? setCookie.split(';')[0] : null,
    };
  }

  async function signIn(account: Account): Promise<string> {
    const result = await request<{ user: { email: string } }>('/api/auth/login', {
      method: 'POST',
      body: ACCOUNTS[account],
    });
    assert.equal(result.status, 200, `sign-in as ${account} failed: ${JSON.stringify(result.body)}`);
    if (!result.cookie) throw new Error(`no session cookie for ${account}`);
    return result.cookie;
  }

  /** Creates a workshop through the API and returns its id. */
  async function createWorkshop(
    cookie: string,
    overrides: Partial<{
      code: string;
      title: string;
      capacity: number;
      status: Workshop['status'];
      startsAt: string;
    }> = {},
  ): Promise<WorkshopDetail> {
    const payload = {
      code: 'TST-001',
      title: 'Test workshop',
      instructor: 'Test Instructor',
      startsAt: '2030-01-15T10:00',
      durationMinutes: 60,
      capacity: 3,
      status: 'SCHEDULED',
      location: 'Test room',
      notes: '',
      ...overrides,
    };
    const result = await request<{ workshop: WorkshopDetail }>('/api/workshops', {
      method: 'POST',
      body: payload,
      cookie,
    });
    assert.equal(result.status, 201, `create workshop failed: ${JSON.stringify(result.body)}`);
    return result.body.workshop;
  }

  return {
    db,
    base,
    request,
    signIn,
    createWorkshop,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await db.close();
    },
  };
}

export type TestServer = Awaited<ReturnType<typeof startServer>>;
