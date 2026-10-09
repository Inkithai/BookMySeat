import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer, type TestServer } from './helpers.js';

/**
 * Access control. The client's matrix is enforced by the API, not just hidden in
 * the interface, so every one of these checks is a real HTTP status code.
 */

let server: TestServer;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.close();
});

test('signs in with a seeded account and rejects bad credentials', async () => {
  const wrong = await server.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@bookmyseat.test', password: 'not-the-password' },
  });
  assert.equal(wrong.status, 401);
  assert.match(wrong.body.error.message, /does not match an account/);

  const unknown = await server.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'nobody@bookmyseat.test', password: 'Admin123!' },
  });
  assert.equal(unknown.status, 401);

  const invalid = await server.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'not-an-email', password: 'x' },
  });
  assert.equal(invalid.status, 400);
});

test('refuses every endpoint without a session', async () => {
  const paths: [string, string][] = [
    ['GET', '/api/workshops'],
    ['GET', '/api/workshops/1'],
    ['GET', '/api/users'],
    ['GET', '/api/audit'],
  ];
  for (const [method, path] of paths) {
    const response = await server.request(path, { method });
    assert.equal(response.status, 401, `${method} ${path} should require a session`);
  }
});

test('signs out and then rejects the old cookie', async () => {
  const cookie = await server.signIn('manager');
  const before = await server.request('/api/auth/me', { cookie });
  assert.equal(before.status, 200);
  assert.equal(before.body.user.role, 'MANAGER');

  const out = await server.request('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(out.status, 200);

  const after = await server.request('/api/auth/me', { cookie });
  assert.equal(after.status, 401);
});

test('a deactivated account cannot sign in', async () => {
  const admin = await server.signIn('admin');
  const created = await server.request<{ user: { id: number } }>('/api/users', {
    method: 'POST',
    body: {
      name: 'Temp Person',
      email: 'temp.person@example.com',
      role: 'STAFF',
      password: 'Temp12345',
    },
    cookie: admin,
  });
  assert.equal(created.status, 201);

  const deactivated = await server.request(`/api/users/${created.body.user.id}`, {
    method: 'PATCH',
    body: { isActive: false },
    cookie: admin,
  });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.user.isActive, false);

  const signIn = await server.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'temp.person@example.com', password: 'Temp12345' },
  });
  assert.equal(signIn.status, 403);
});

test('enforces the permissions matrix on the backend', async () => {
  const admin = await server.signIn('admin');
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const newWorkshop = {
    code: 'PERM-001',
    title: 'Permissions probe',
    instructor: 'Nobody',
    startsAt: '2030-02-01T10:00',
    durationMinutes: 60,
    capacity: 5,
    status: 'SCHEDULED',
    location: '',
    notes: '',
  };

  // Adding and editing workshops is the manager's job.
  const staffCreates = await server.request('/api/workshops', {
    method: 'POST',
    body: newWorkshop,
    cookie: staff,
  });
  assert.equal(staffCreates.status, 403);

  const adminCreates = await server.request('/api/workshops', {
    method: 'POST',
    body: newWorkshop,
    cookie: admin,
  });
  assert.equal(adminCreates.status, 403);

  const managerCreates = await server.request<{ workshop: { id: number } }>('/api/workshops', {
    method: 'POST',
    body: newWorkshop,
    cookie: manager,
  });
  assert.equal(managerCreates.status, 201);
  const workshopId = managerCreates.body.workshop.id;

  const staffEdits = await server.request(`/api/workshops/${workshopId}`, {
    method: 'PATCH',
    body: { title: 'Renamed by staff' },
    cookie: staff,
  });
  assert.equal(staffEdits.status, 403);

  const managerEdits = await server.request(`/api/workshops/${workshopId}`, {
    method: 'PATCH',
    body: { title: 'Renamed by manager' },
    cookie: manager,
  });
  assert.equal(managerEdits.status, 200);
  assert.equal(managerEdits.body.workshop.title, 'Renamed by manager');

  // Admins look after accounts only, so they cannot see the workshop catalogue.
  const adminListsWorkshops = await server.request('/api/workshops', { cookie: admin });
  assert.equal(adminListsWorkshops.status, 403);

  const adminRegisters = await server.request(`/api/workshops/${workshopId}/registrations`, {
    method: 'POST',
    body: { attendeeName: 'Admin Person', attendeeEmail: 'admin.person@example.com' },
    cookie: admin,
  });
  assert.equal(adminRegisters.status, 403);

  // Managers cannot touch accounts.
  const managerListsUsers = await server.request('/api/users', { cookie: manager });
  assert.equal(managerListsUsers.status, 403);

  const managerCreatesUser = await server.request('/api/users', {
    method: 'POST',
    body: {
      name: 'Rogue Account',
      email: 'rogue@example.com',
      role: 'ADMIN',
      password: 'Rogue12345',
    },
    cookie: manager,
  });
  assert.equal(managerCreatesUser.status, 403);

  const staffListsUsers = await server.request('/api/users', { cookie: staff });
  assert.equal(staffListsUsers.status, 403);

  // Front desk staff and managers can both register attendees.
  const staffRegisters = await server.request(`/api/workshops/${workshopId}/registrations`, {
    method: 'POST',
    body: { attendeeName: 'Desk Person', attendeeEmail: 'desk.person@example.com' },
    cookie: staff,
  });
  assert.equal(staffRegisters.status, 201);

  const managerRegisters = await server.request(`/api/workshops/${workshopId}/registrations`, {
    method: 'POST',
    body: { attendeeName: 'Manager Person', attendeeEmail: 'manager.person@example.com' },
    cookie: manager,
  });
  assert.equal(managerRegisters.status, 201);

  // Admins can create accounts and see account history; staff see no audit log.
  const adminCreatesUser = await server.request<{ user: { id: number } }>('/api/users', {
    method: 'POST',
    body: {
      name: 'Second Desk',
      email: 'second.desk@example.com',
      role: 'STAFF',
      password: 'Second12345',
    },
    cookie: admin,
  });
  assert.equal(adminCreatesUser.status, 201);

  const adminAudit = await server.request<{ audit: { entityType: string }[] }>('/api/audit', {
    cookie: admin,
  });
  assert.equal(adminAudit.status, 200);
  assert.ok(
    adminAudit.body.audit.every((entry) => entry.entityType === 'USER'),
    'an administrator should only see account history',
  );

  const staffAudit = await server.request('/api/audit', { cookie: staff });
  assert.equal(staffAudit.status, 403);

  const managerAudit = await server.request<{ audit: { entityType: string }[] }>('/api/audit', {
    cookie: manager,
  });
  assert.equal(managerAudit.status, 200);
  assert.ok(
    managerAudit.body.audit.some((entry) => entry.entityType === 'WORKSHOP'),
    'a manager should see workshop history',
  );
});

test('an administrator cannot lock themselves out', async () => {
  const admin = await server.signIn('admin');
  const me = await server.request<{ user: { id: number } }>('/api/auth/me', { cookie: admin });
  const id = me.body.user.id;

  const demote = await server.request(`/api/users/${id}`, {
    method: 'PATCH',
    body: { role: 'STAFF' },
    cookie: admin,
  });
  assert.equal(demote.status, 403);

  const deactivate = await server.request(`/api/users/${id}`, {
    method: 'PATCH',
    body: { isActive: false },
    cookie: admin,
  });
  assert.equal(deactivate.status, 403);
});

test('API responses are never cacheable by the browser or the Vercel proxy', async () => {
  for (const path of ['/api/health', '/api/auth/me']) {
    const response = await fetch(`${server.base}${path}`);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
  }
});

test('two admins deactivating each other at once still leaves one active admin', async () => {
  const admin = await server.signIn('admin');
  const created = await server.request<{ user: { id: number } }>('/api/users', {
    method: 'POST',
    cookie: admin,
    body: { name: 'Second Admin', email: 'second.admin@example.com', role: 'ADMIN', password: 'Second123!' },
  });
  assert.equal(created.status, 201);
  const login = await server.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'second.admin@example.com', password: 'Second123!' },
  });
  const second = login.cookie;
  assert.ok(second);

  const me = await server.request<{ user: { id: number } }>('/api/auth/me', { cookie: admin });
  const [a, b] = await Promise.all([
    server.request(`/api/users/${created.body.user.id}`, { method: 'PATCH', cookie: admin, body: { isActive: false } }),
    server.request(`/api/users/${me.body.user.id}`, { method: 'PATCH', cookie: second, body: { isActive: false } }),
  ]);
  const succeeded = [a, b].filter((result) => result.status === 200).length;
  assert.ok(succeeded <= 1, 'at most one of the two deactivations may succeed');

  const users = await server.request<{ users: { role: string; isActive: boolean }[] }>('/api/users', {
    cookie: a.status === 200 ? admin : second,
  });
  assert.ok(users.body.users.some((user) => user.role === 'ADMIN' && user.isActive));
});
