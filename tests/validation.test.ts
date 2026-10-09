import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer, type TestServer } from './helpers.js';

/**
 * Input validation and filtering, including the boundary cases that were wrong
 * before: impossible calendar dates, the inclusive end of a date range, the
 * "seats available" filter, and boolean query parameters.
 */

let server: TestServer;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.close();
});

const newWorkshop = (overrides: Record<string, unknown>) => ({
  code: 'VAL-001',
  title: 'Validation probe',
  instructor: 'Someone',
  startsAt: '2030-06-01T10:00',
  durationMinutes: 60,
  capacity: 5,
  status: 'SCHEDULED',
  location: '',
  notes: '',
  ...overrides,
});

test('rejects impossible calendar dates and times', async () => {
  const manager = await server.signIn('manager');

  const impossible = [
    '2030-02-30T10:00', // 30 February does not exist
    '2030-04-31T10:00', // 31 April does not exist
    '2030-02-29T10:00', // 2030 is not a leap year
    '2030-01-15T24:00', // rolls over to the next day
    '2030-01-15T25:00',
    '2030-01-15T10:61',
    '2030-00-10T10:00', // month 0
    '2030-13-10T10:00', // month 13
    '2030-01-00T10:00', // day 0
    'not-a-date',
    '2030-01-15',
  ];

  for (const startsAt of impossible) {
    const response = await server.request('/api/workshops', {
      method: 'POST',
      cookie: manager,
      body: newWorkshop({ code: 'BAD-DATE', startsAt }),
    });
    assert.equal(response.status, 400, `${startsAt} should be rejected`);
  }

  // A real leap day is still fine, and so is an ordinary time.
  const valid = ['2028-02-29T10:00', '2030-01-15T00:00', '2030-01-15T23:59'];
  for (const [index, startsAt] of valid.entries()) {
    const response = await server.request('/api/workshops', {
      method: 'POST',
      cookie: manager,
      body: newWorkshop({ code: `OK-DATE-${index}`, startsAt }),
    });
    assert.equal(response.status, 201, `${startsAt} should be accepted`);
  }
});

test('rejects capacity values that are not positive whole numbers', async () => {
  const manager = await server.signIn('manager');

  for (const capacity of [0, -3, 2.5, 'abc', '1e999', Infinity, NaN, null, '']) {
    const response = await server.request('/api/workshops', {
      method: 'POST',
      cookie: manager,
      body: newWorkshop({ code: 'BAD-CAP', capacity }),
    });
    assert.equal(response.status, 400, `capacity ${String(capacity)} should be rejected`);
  }
});

test('rejects blank and oversized text fields', async () => {
  const manager = await server.signIn('manager');

  const blanks: [string, Record<string, unknown>][] = [
    ['title', { title: '   ' }],
    ['instructor', { instructor: '' }],
    ['code', { code: '   ' }],
    ['code', { code: 'no spaces allowed' }],
    ['durationMinutes', { durationMinutes: 0 }],
  ];
  for (const [label, patch] of blanks) {
    const response = await server.request('/api/workshops', {
      method: 'POST',
      cookie: manager,
      body: newWorkshop({ code: 'BLANK-01', ...patch }),
    });
    assert.equal(response.status, 400, `${label} should be rejected`);
  }
});

test('the date range filter includes both boundary days in full', async () => {
  const manager = await server.signIn('manager');

  await server.createWorkshop(manager, { code: 'RNG-001', startsAt: '2030-08-15T00:00' });
  await server.createWorkshop(manager, { code: 'RNG-002', startsAt: '2030-08-15T23:59:59' });
  await server.createWorkshop(manager, { code: 'RNG-003', startsAt: '2030-08-16T00:00' });
  await server.createWorkshop(manager, { code: 'RNG-004', startsAt: '2030-08-14T23:59:59' });

  const inside = await server.request<{ workshops: { code: string }[] }>(
    '/api/workshops?from=2030-08-15&to=2030-08-15&q=RNG',
    { cookie: manager },
  );
  assert.deepEqual(
    inside.body.workshops.map((row) => row.code).sort(),
    ['RNG-001', 'RNG-002'],
    'a workshop at 23:59:59 on the last day belongs to that day',
  );

  const across = await server.request<{ workshops: { code: string }[] }>(
    '/api/workshops?from=2030-08-15&to=2030-08-16&q=RNG',
    { cookie: manager },
  );
  assert.deepEqual(
    across.body.workshops.map((row) => row.code).sort(),
    ['RNG-001', 'RNG-002', 'RNG-003'],
  );
});

test('"seats available" only reports workshops that can still take bookings', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const scheduled = await server.createWorkshop(manager, { code: 'AVL-001', capacity: 3 });
  await server.createWorkshop(manager, { code: 'AVL-002', capacity: 2, status: 'CANCELLED' });
  await server.createWorkshop(manager, { code: 'AVL-003', capacity: 2, status: 'COMPLETED' });
  const full = await server.createWorkshop(manager, { code: 'AVL-004', capacity: 1 });

  for (const index of [1, 2]) {
    await server.request(`/api/workshops/${scheduled.id}/registrations`, {
      method: 'POST',
      cookie: staff,
      body: { attendeeName: `A${index}`, attendeeEmail: `avl${index}@example.com` },
    });
  }
  await server.request(`/api/workshops/${full.id}/registrations`, {
    method: 'POST',
    cookie: staff,
    body: { attendeeName: 'Solo', attendeeEmail: 'solo@example.com' },
  });

  const available = await server.request<{ workshops: { code: string; seatsRemaining: number }[] }>(
    '/api/workshops?hasSeats=true&q=AVL',
    { cookie: manager },
  );
  assert.deepEqual(
    available.body.workshops.map((row) => row.code),
    ['AVL-001'],
    'cancelled and completed workshops have no seats to sell, and a full one has none either',
  );

  const unfiltered = await server.request<{ workshops: { code: string }[] }>(
    '/api/workshops?hasSeats=false&q=AVL',
    { cookie: manager },
  );
  assert.equal(unfiltered.body.workshops.length, 4, '"false" must not behave like "true"');

  const nonsense = await server.request('/api/workshops?hasSeats=maybe', { cookie: manager });
  assert.equal(nonsense.status, 400, 'an unparseable boolean is a validation error');
});

test('search escapes SQL wildcards and cannot inject', async () => {
  const manager = await server.signIn('manager');
  await server.createWorkshop(manager, { code: 'SRCH-001', title: 'Percent Workshop' });

  for (const q of ['%', '_', "'; DROP TABLE workshops; --", '100%', '\\', '" OR 1=1 --']) {
    const response = await server.request<{ workshops: unknown[] }>(
      `/api/workshops?q=${encodeURIComponent(q)}`,
      { cookie: manager },
    );
    assert.equal(response.status, 200, `${q} should not error`);
    assert.ok(Array.isArray(response.body.workshops));
  }

  const table = await server.request<{ workshops: { code: string }[] }>('/api/workshops?q=SRCH', {
    cookie: manager,
  });
  assert.deepEqual(
    table.body.workshops.map((row) => row.code),
    ['SRCH-001'],
    'the workshops table is intact',
  );
});

test('ordering is deterministic when workshops share a start time', async () => {
  const manager = await server.signIn('manager');
  for (const n of [1, 2, 3]) {
    await server.createWorkshop(manager, {
      code: `TIE-00${n}`,
      title: `Tie ${n}`,
      startsAt: '2030-09-01T10:00',
    });
  }

  const read = async () =>
    (
      await server.request<{ workshops: { code: string }[] }>('/api/workshops?q=TIE-', {
        cookie: manager,
      })
    ).body.workshops.map((row) => row.code);

  const first = await read();
  assert.equal(first.length, 3);
  assert.deepEqual(await read(), first, 'the same query returns the same order every time');
});

test('rejects invalid query parameters with a controlled 400', async () => {
  const manager = await server.signIn('manager');

  for (const query of [
    'from=not-a-date',
    'to=2030-13-45',
    'from=2030-02-30',
    'to=2030-00-10',
    'from=20300101',
    'status=OPEN',
    'q=' + 'x'.repeat(200),
  ]) {
    const response = await server.request(`/api/workshops?${query}`, { cookie: manager });
    assert.equal(response.status, 400, `${query} should be rejected`);
  }

  // An empty search is simply "no search", not an error.
  const empty = await server.request('/api/workshops?q=', { cookie: manager });
  assert.equal(empty.status, 200);
});

test('malformed JSON and unknown routes return controlled errors', async () => {
  const manager = await server.signIn('manager');

  const malformed = await fetch(`${server.base}/api/workshops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: manager },
    body: '{ "code": "BROKEN"',
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get('content-type'), 'application/json; charset=utf-8');

  const noContentType = await fetch(`${server.base}/api/workshops`, {
    method: 'POST',
    headers: { Cookie: manager },
    body: 'code=BROKEN',
  });
  assert.equal(noContentType.status, 400);

  const unknownRoute = await server.request('/api/does-not-exist', { cookie: manager });
  assert.equal(unknownRoute.status, 404);
  assert.equal(unknownRoute.body.error.code, 'NOT_FOUND');

  const unknownMethod = await server.request('/api/workshops/1', { method: 'PUT', cookie: manager });
  assert.equal(unknownMethod.status, 404);
});

test('audit limit values are validated and capped', async () => {
  const manager = await server.signIn('manager');

  for (const limit of ['0', '-5', '1.5', 'abc', '99999']) {
    const response = await server.request(`/api/audit?limit=${limit}`, { cookie: manager });
    assert.equal(response.status, 400, `limit ${limit} should be rejected`);
  }

  const ok = await server.request<{ audit: unknown[] }>('/api/audit?limit=5', { cookie: manager });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.audit.length <= 5);
});

test('sets hardening headers without breaking the JSON contract', async () => {
  const manager = await server.signIn('manager');
  const response = await fetch(`${server.base}/api/workshops`, { headers: { Cookie: manager } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
});
