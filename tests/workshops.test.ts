import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer, type TestServer } from './helpers.js';

/** The workshop catalogue: filters, edits and the capacity guard. */

let server: TestServer;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.close();
});

test('lists workshops with seat counts and puts upcoming ones first', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const workshop = await server.createWorkshop(manager, { code: 'LIST-001', capacity: 4 });
  for (let index = 1; index <= 3; index += 1) {
    const response = await server.request(`/api/workshops/${workshop.id}/registrations`, {
      method: 'POST',
      body: { attendeeName: `Person ${index}`, attendeeEmail: `person${index}@example.com` },
      cookie: staff,
    });
    assert.equal(response.status, 201);
  }

  const list = await server.request<{
    workshops: { code: string; registeredCount: number; seatsRemaining: number; status: string }[];
  }>('/api/workshops', { cookie: manager });

  const mine = list.body.workshops.find((row) => row.code === 'LIST-001');
  assert.ok(mine, 'the new workshop is listed');
  assert.equal(mine.registeredCount, 3);
  assert.equal(mine.seatsRemaining, 1);

  // Scheduled workshops come before completed and cancelled ones.
  const statuses = list.body.workshops.map((row) => row.status);
  const lastScheduled = statuses.lastIndexOf('SCHEDULED');
  assert.ok(
    statuses.slice(0, lastScheduled + 1).every((status) => status === 'SCHEDULED'),
    'upcoming workshops are listed first',
  );
});

test('filters by text, status, date range and availability', async () => {
  const manager = await server.signIn('manager');

  await server.createWorkshop(manager, {
    code: 'FILT-001',
    title: 'Pottery Basics',
    startsAt: '2030-03-10T18:00',
    capacity: 2,
  });
  await server.createWorkshop(manager, {
    code: 'FILT-002',
    title: 'Pottery Advanced',
    startsAt: '2030-03-12T18:00',
    capacity: 2,
  });

  const byCode = await server.request<{ workshops: { code: string }[] }>(
    '/api/workshops?q=FILT',
    { cookie: manager },
  );
  assert.deepEqual(
    byCode.body.workshops.map((row) => row.code).sort(),
    ['FILT-001', 'FILT-002'],
  );

  const byTitle = await server.request<{ workshops: { code: string }[] }>(
    '/api/workshops?q=Pottery+Advanced',
    { cookie: manager },
  );
  assert.deepEqual(byTitle.body.workshops.map((row) => row.code), ['FILT-002']);

  const byRange = await server.request<{ workshops: { code: string }[] }>(
    '/api/workshops?from=2030-03-11&to=2030-03-12',
    { cookie: manager },
  );
  assert.deepEqual(byRange.body.workshops.map((row) => row.code), ['FILT-002']);

  const byStatus = await server.request<{ workshops: { code: string }[] }>(
    '/api/workshops?status=COMPLETED',
    { cookie: manager },
  );
  assert.ok(byStatus.body.workshops.every((row) => row.code !== 'FILT-001'));

  // Only workshops that still have a free seat.
  const withSeats = await server.request<{ workshops: { code: string; seatsRemaining: number }[] }>(
    '/api/workshops?hasSeats=true',
    { cookie: manager },
  );
  assert.ok(withSeats.body.workshops.every((row) => row.seatsRemaining > 0));

  const badFilter = await server.request('/api/workshops?from=not-a-date', { cookie: manager });
  assert.equal(badFilter.status, 400);
});

test('refuses to lower capacity below the number of booked seats', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const workshop = await server.createWorkshop(manager, { code: 'CAP-001', capacity: 4 });
  for (let index = 1; index <= 3; index += 1) {
    await server.request(`/api/workshops/${workshop.id}/registrations`, {
      method: 'POST',
      body: { attendeeName: `Person ${index}`, attendeeEmail: `cap${index}@example.com` },
      cookie: staff,
    });
  }

  const tooSmall = await server.request(`/api/workshops/${workshop.id}`, {
    method: 'PATCH',
    body: { capacity: 2 },
    cookie: manager,
  });
  assert.equal(tooSmall.status, 409);
  assert.equal(tooSmall.body.error.code, 'CAPACITY_BELOW_BOOKED');

  const justRight = await server.request(`/api/workshops/${workshop.id}`, {
    method: 'PATCH',
    body: { capacity: 3 },
    cookie: manager,
  });
  assert.equal(justRight.status, 200);
  assert.equal(justRight.body.workshop.capacity, 3);

  // With the room full, the next registration is queued rather than seated.
  const queued = await server.request<{ registration: { status: string } }>(
    `/api/workshops/${workshop.id}/registrations`,
    {
      method: 'POST',
      body: { attendeeName: 'Late Person', attendeeEmail: 'late@example.com' },
      cookie: staff,
    },
  );
  assert.equal(queued.body.registration.status, 'WAITLISTED');
});

test('validates new workshops and keeps codes unique', async () => {
  const manager = await server.signIn('manager');
  await server.createWorkshop(manager, { code: 'UNIQ-001' });

  const duplicate = await server.request('/api/workshops', {
    method: 'POST',
    body: {
      code: 'uniq-001',
      title: 'Same code',
      instructor: 'Someone',
      startsAt: '2030-04-01T10:00',
      durationMinutes: 60,
      capacity: 5,
    },
    cookie: manager,
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'CODE_TAKEN');

  const badCode = await server.request('/api/workshops', {
    method: 'POST',
    body: {
      code: 'no spaces allowed',
      title: 'Bad code',
      instructor: 'Someone',
      startsAt: '2030-04-01T10:00',
      durationMinutes: 60,
      capacity: 5,
    },
    cookie: manager,
  });
  assert.equal(badCode.status, 400);

  const badTime = await server.request('/api/workshops', {
    method: 'POST',
    body: {
      code: 'BAD-TIME',
      title: 'Bad time',
      instructor: 'Someone',
      startsAt: 'next tuesday-ish',
      durationMinutes: 60,
      capacity: 5,
    },
    cookie: manager,
  });
  assert.equal(badTime.status, 400);

  const zeroSeats = await server.request('/api/workshops', {
    method: 'POST',
    body: {
      code: 'NO-SEATS',
      title: 'No seats',
      instructor: 'Someone',
      startsAt: '2030-04-01T10:00',
      durationMinutes: 60,
      capacity: 0,
    },
    cookie: manager,
  });
  assert.equal(zeroSeats.status, 400);
});

test('records what changed when a workshop is edited', async () => {
  const manager = await server.signIn('manager');
  const workshop = await server.createWorkshop(manager, { code: 'EDIT-001', capacity: 6 });

  const updated = await server.request<{
    workshop: { title: string; capacity: number; updatedAt: string | null };
  }>(`/api/workshops/${workshop.id}`, {
    method: 'PATCH',
    body: { title: 'Renamed workshop', capacity: 8 },
    cookie: manager,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.workshop.title, 'Renamed workshop');
  assert.ok(updated.body.workshop.updatedAt, 'the edit is timestamped');

  const detail = await server.request<{
    workshop: { recentActivity: { action: string; detail: Record<string, unknown> | null }[] };
  }>(`/api/workshops/${workshop.id}`, { cookie: manager });

  const edit = detail.body.workshop.recentActivity.find((entry) => entry.action === 'WORKSHOP_UPDATED');
  assert.ok(edit, 'the edit is in the activity log');
  assert.deepEqual(edit.detail, {
    title: { from: 'Test workshop', to: 'Renamed workshop' },
    capacity: { from: 6, to: 8 },
  });

  const unchanged = await server.request(`/api/workshops/${workshop.id}`, {
    method: 'PATCH',
    body: { title: 'Renamed workshop' },
    cookie: manager,
  });
  assert.equal(unchanged.status, 200, 'saving the same values again is not an error');
});

test('returns a JSON 404 for a workshop that does not exist', async () => {
  const manager = await server.signIn('manager');
  const missing = await server.request('/api/workshops/424242', { cookie: manager });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');

  const unknownEndpoint = await server.request('/api/does-not-exist', { cookie: manager });
  assert.equal(unknownEndpoint.status, 404);
});
