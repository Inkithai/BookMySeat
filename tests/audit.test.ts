import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer, type TestServer } from './helpers.js';

/**
 * The audit trail (bonus): account and role changes, password rotations, and the
 * fact that a rotated password invalidates existing sign-ins.
 */

let server: TestServer;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.close();
});

async function createStaffAccount(admin: string, email: string) {
  const created = await server.request<{ user: { id: number } }>('/api/users', {
    method: 'POST',
    body: { name: 'Audit Subject', email, role: 'STAFF', password: 'Start12345' },
    cookie: admin,
  });
  assert.equal(created.status, 201);
  return created.body.user.id;
}

test('records account and role changes with the before and after values', async () => {
  const admin = await server.signIn('admin');
  const userId = await createStaffAccount(admin, 'audit.subject@example.com');

  const promoted = await server.request(`/api/users/${userId}`, {
    method: 'PATCH',
    body: { role: 'MANAGER', name: 'Audit Subject Renamed' },
    cookie: admin,
  });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.user.role, 'MANAGER');

  const log = await server.request<{
    audit: { action: string; summary: string; detail: Record<string, unknown> | null }[];
  }>('/api/audit?entityType=USER', { cookie: admin });

  const change = log.body.audit.find((entry) => entry.action === 'USER_UPDATED');
  assert.ok(change, 'the change is in the audit log');
  assert.deepEqual(change.detail, {
    role: { from: 'STAFF', to: 'MANAGER' },
    name: { from: 'Audit Subject', to: 'Audit Subject Renamed' },
  });
  assert.match(change.summary, /Updated account audit.subject@example.com/);

  const creation = log.body.audit.find((entry) => entry.action === 'USER_CREATED');
  assert.ok(creation, 'creating the account is audited too');
});

test('rotating a password signs that account out everywhere', async () => {
  const admin = await server.signIn('admin');
  const userId = await createStaffAccount(admin, 'rotate.me@example.com');

  const theirSession = await server.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'rotate.me@example.com', password: 'Start12345' },
  });
  assert.equal(theirSession.status, 200);
  const theirCookie = theirSession.cookie;
  assert.ok(theirCookie);

  const rotated = await server.request(`/api/users/${userId}`, {
    method: 'PATCH',
    body: { password: 'Rotated12345' },
    cookie: admin,
  });
  assert.equal(rotated.status, 200);

  const oldSession = await server.request('/api/auth/me', { cookie: theirCookie });
  assert.equal(oldSession.status, 401, 'the old session no longer works');

  const newSignIn = await server.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'rotate.me@example.com', password: 'Rotated12345' },
  });
  assert.equal(newSignIn.status, 200);

  const oldPassword = await server.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'rotate.me@example.com', password: 'Start12345' },
  });
  assert.equal(oldPassword.status, 401);
});

test('never returns a password hash from any endpoint', async () => {
  const admin = await server.signIn('admin');

  const me = await server.request('/api/auth/me', { cookie: admin });
  assert.equal(me.status, 200);
  assert.ok(!JSON.stringify(me.body).includes('passwordHash'));
  assert.ok(!JSON.stringify(me.body).includes('password_hash'));

  const users = await server.request('/api/users', { cookie: admin });
  assert.ok(!JSON.stringify(users.body).includes('passwordHash'));
});

test('refuses a duplicate email and a weak password', async () => {
  const admin = await server.signIn('admin');

  const duplicate = await server.request('/api/users', {
    method: 'POST',
    body: {
      name: 'Copy Cat',
      email: 'admin@bookmyseat.test',
      role: 'STAFF',
      password: 'Copy12345',
    },
    cookie: admin,
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'EMAIL_TAKEN');

  const weak = await server.request('/api/users', {
    method: 'POST',
    body: { name: 'Weak Password', email: 'weak@example.com', role: 'STAFF', password: 'short' },
    cookie: admin,
  });
  assert.equal(weak.status, 400);
});

test('keeps at least one active administrator', async () => {
  const admin = await server.signIn('admin');
  const me = await server.request<{ user: { id: number } }>('/api/auth/me', { cookie: admin });

  // The seeded admin is the only administrator, so it cannot be switched off.
  const deactivate = await server.request(`/api/users/${me.body.user.id}`, {
    method: 'PATCH',
    body: { isActive: false },
    cookie: admin,
  });
  assert.equal(deactivate.status, 403);
});
