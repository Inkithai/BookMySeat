import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer, type TestServer } from './helpers.js';

/**
 * The capacity rule and the registration history - the two things the client
 * said matter most.
 */

let server: TestServer;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.close();
});

async function register(cookie: string, workshopId: number, index: number) {
  return server.request<{
    registration: { status: string; waitlistPosition: number | null };
    seatsRemaining: number;
    waitlisted: boolean;
  }>(`/api/workshops/${workshopId}/registrations`, {
    method: 'POST',
    body: {
      attendeeName: `Attendee ${index}`,
      attendeeEmail: `attendee${index}@example.com`,
    },
    cookie,
  });
}

test('never exceeds capacity when many registrations arrive at the same moment', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const workshop = await server.createWorkshop(manager, { code: 'RACE-001', capacity: 3 });
  assert.equal(workshop.capacity, 3);

  // The "two of us promised the last seat at the same time" scenario: 25 front
  // desk requests fired together for a 3-seat workshop.
  const attempts = Array.from({ length: 25 }, (_, index) => register(staff, workshop.id, index));
  const results = await Promise.all(attempts);

  assert.ok(results.every((result) => result.status === 201), 'every request should be accepted');

  const attending = results.filter((result) => result.body.registration.status === 'REGISTERED');
  const waiting = results.filter((result) => result.body.registration.status === 'WAITLISTED');
  assert.equal(attending.length, 3, 'exactly three attendees may hold a seat');
  assert.equal(waiting.length, 22, 'everyone else is queued');

  const detail = await server.request<{ workshop: { registeredCount: number; seatsRemaining: number } }>(
    `/api/workshops/${workshop.id}`,
    { cookie: manager },
  );
  assert.equal(detail.body.workshop.registeredCount, 3);
  assert.equal(detail.body.workshop.seatsRemaining, 0);
});

test('frees the seat on cancellation and offers it to the longest-waiting attendee', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const workshop = await server.createWorkshop(manager, { code: 'WAIT-001', capacity: 2 });
  for (let index = 0; index < 4; index += 1) {
    await register(staff, workshop.id, index);
  }

  let detail = await server.request<{
    workshop: {
      registeredCount: number;
      waitlistCount: number;
      registrations: { id: number; attendeeName: string; status: string; waitlistPosition: number | null }[];
    };
  }>(`/api/workshops/${workshop.id}`, { cookie: manager });

  assert.equal(detail.body.workshop.registeredCount, 2);
  assert.equal(detail.body.workshop.waitlistCount, 2);
  const queue = detail.body.workshop.registrations.filter((row) => row.status === 'WAITLISTED');
  assert.deepEqual(
    queue.map((row) => [row.attendeeName, row.waitlistPosition]),
    [
      ['Attendee 2', 1],
      ['Attendee 3', 2],
    ],
    'the waitlist is ordered by who asked first',
  );

  const seatHolder = detail.body.workshop.registrations.find((row) => row.status === 'REGISTERED');
  assert.ok(seatHolder);

  const cancelled = await server.request<{
    registration: { status: string };
    promoted: { attendeeName: string } | null;
  }>(`/api/registrations/${seatHolder.id}`, { method: 'DELETE', cookie: staff });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.registration.status, 'CANCELLED');
  assert.equal(cancelled.body.promoted?.attendeeName, 'Attendee 2');

  detail = await server.request(`/api/workshops/${workshop.id}`, { cookie: manager });
  assert.equal(detail.body.workshop.registeredCount, 2, 'the seat is taken again straight away');
  assert.equal(detail.body.workshop.waitlistCount, 1);
});

test('keeps cancelled registrations as history, with who did it and when', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const workshop = await server.createWorkshop(manager, { code: 'HIST-001', capacity: 5 });
  const registered = await register(staff, workshop.id, 1);
  assert.equal(registered.status, 201);

  const cancelled = await server.request<{
    registration: { status: string; cancelledAt: string; cancelledBy: { name: string } | null };
  }>(`/api/registrations/${registered.body.registration.id}`, { method: 'DELETE', cookie: staff });
  assert.equal(cancelled.status, 200);

  const detail = await server.request<{
    workshop: { registrations: { status: string; cancelledBy: { name: string } | null }[] };
  }>(`/api/workshops/${workshop.id}`, { cookie: manager });

  const history = detail.body.workshop.registrations.filter((row) => row.status === 'CANCELLED');
  assert.equal(history.length, 1, 'the cancelled record is still there');
  assert.ok(history[0].cancelledBy, 'and it records who cancelled it');
  assert.ok(cancelled.body.registration.cancelledAt, 'and when');

  const alreadyCancelled = await server.request(`/api/registrations/${registered.body.registration.id}`, {
    method: 'DELETE',
    cookie: staff,
  });
  assert.equal(alreadyCancelled.status, 409);

  // A cancelled attendee may register again, so the seat is genuinely reusable.
  const again = await register(staff, workshop.id, 1);
  assert.equal(again.status, 201);
  assert.equal(again.body.registration.status, 'REGISTERED');
});

test('refuses the same attendee twice for one workshop', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const workshop = await server.createWorkshop(manager, { code: 'DUP-001', capacity: 5 });
  await register(staff, workshop.id, 1);

  // Case is ignored, because it is the same mailbox.
  const duplicate = await server.request(`/api/workshops/${workshop.id}/registrations`, {
    method: 'POST',
    body: { attendeeName: 'Attendee One', attendeeEmail: 'ATTENDEE1@example.com' },
    cookie: staff,
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'ALREADY_REGISTERED');
});

test('rejects a registration for a workshop that is closed', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const completed = await server.createWorkshop(manager, {
    code: 'DONE-001',
    status: 'COMPLETED',
  });
  const afterCompletion = await register(staff, completed.id, 1);
  assert.equal(afterCompletion.status, 409);
  assert.equal(afterCompletion.body.error.code, 'WORKSHOP_CLOSED');

  const cancelledWorkshop = await server.createWorkshop(manager, {
    code: 'OFF-001',
    status: 'CANCELLED',
  });
  const afterCancellation = await register(staff, cancelledWorkshop.id, 2);
  assert.equal(afterCancellation.status, 409);
});

test('validates attendee details', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');
  const workshop = await server.createWorkshop(manager, { code: 'VAL-001', capacity: 5 });

  const noEmail = await server.request(`/api/workshops/${workshop.id}/registrations`, {
    method: 'POST',
    body: { attendeeName: 'No Email', attendeeEmail: 'not-an-email' },
    cookie: staff,
  });
  assert.equal(noEmail.status, 400);
  assert.ok(Array.isArray(noEmail.body.error.details), 'the response says which field is wrong');

  const noName = await server.request(`/api/workshops/${workshop.id}/registrations`, {
    method: 'POST',
    body: { attendeeName: '   ', attendeeEmail: 'someone@example.com' },
    cookie: staff,
  });
  assert.equal(noName.status, 400);

  const missingWorkshop = await register(staff, 999999, 9);
  assert.equal(missingWorkshop.status, 404);
});

test('moves a waitlisted attendee into a seat when one is freed up', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const workshop = await server.createWorkshop(manager, { code: 'PROMO-001', capacity: 1 });
  await register(staff, workshop.id, 1);
  const waiting = await register(staff, workshop.id, 2);
  assert.equal(waiting.body.registration.status, 'WAITLISTED');

  // The seat is taken, so a manual promotion is refused.
  const blocked = await server.request(`/api/registrations/${waiting.body.registration.id}/promote`, {
    method: 'POST',
    cookie: staff,
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'WORKSHOP_FULL');

  // The manager finds a bigger room: now there are free seats and someone waiting.
  const bigger = await server.request(`/api/workshops/${workshop.id}`, {
    method: 'PATCH',
    body: { capacity: 3 },
    cookie: manager,
  });
  assert.equal(bigger.status, 200);

  const promoted = await server.request<{ registration: { status: string } }>(
    `/api/registrations/${waiting.body.registration.id}/promote`,
    { method: 'POST', cookie: staff },
  );
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.registration.status, 'REGISTERED');

  const detail = await server.request<{
    workshop: { registeredCount: number; waitlistCount: number; seatsRemaining: number };
  }>(`/api/workshops/${workshop.id}`, { cookie: manager });
  assert.equal(detail.body.workshop.registeredCount, 2);
  assert.equal(detail.body.workshop.waitlistCount, 0);
  assert.equal(detail.body.workshop.seatsRemaining, 1);

  // Promoting someone who is already sitting down is refused.
  const again = await server.request(`/api/registrations/${waiting.body.registration.id}/promote`, {
    method: 'POST',
    cookie: staff,
  });
  assert.equal(again.status, 409);
});

test('a cancelled workshop offers its freed seat to nobody', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const workshop = await server.createWorkshop(manager, { code: 'CLO-001', capacity: 1 });
  await register(staff, workshop.id, 1); // takes the only seat
  const waiting = await register(staff, workshop.id, 2); // goes on the waitlist

  const cancelled = await server.request(`/api/workshops/${workshop.id}`, {
    method: 'PATCH',
    body: { status: 'CANCELLED' },
    cookie: manager,
  });
  assert.equal(cancelled.status, 200);

  // Freeing a seat on a cancelled workshop must not promote anybody.
  const freed = await server.request<{ promoted: unknown; registration: { status: string } }>(
    `/api/registrations/${cancelled.body.workshop.registrations[0].id}`,
    { method: 'DELETE', cookie: staff },
  );
  assert.equal(freed.status, 200);
  assert.equal(freed.body.promoted, null);
  assert.equal(freed.body.registration.status, 'CANCELLED');

  const stillWaiting = await server.request<{ registration: { status: string } }>(
    `/api/registrations/${waiting.body.registration.id}/promote`,
    { method: 'POST', cookie: staff },
  );
  assert.equal(stillWaiting.status, 409);
  assert.equal(stillWaiting.body.error.code, 'WORKSHOP_CLOSED');

  const detail = await server.request<{
    workshop: { registeredCount: number; waitlistCount: number };
  }>(`/api/workshops/${workshop.id}`, { cookie: manager });
  assert.equal(detail.body.workshop.registeredCount, 0);
  assert.equal(detail.body.workshop.waitlistCount, 1, 'the attendee is still waiting');
});

test('a completed workshop offers its freed seat to nobody', async () => {
  const manager = await server.signIn('manager');
  const staff = await server.signIn('staff');

  const workshop = await server.createWorkshop(manager, { code: 'CLO-002', capacity: 2 });
  await register(staff, workshop.id, 1);
  await register(staff, workshop.id, 2); // fills the room
  const waiting = await register(staff, workshop.id, 3);

  const completed = await server.request(`/api/workshops/${workshop.id}`, {
    method: 'PATCH',
    body: { status: 'COMPLETED' },
    cookie: manager,
  });
  assert.equal(completed.status, 200);

  const freed = await server.request<{ promoted: unknown }>(
    `/api/registrations/${completed.body.workshop.registrations[0].id}`,
    { method: 'DELETE', cookie: staff },
  );
  assert.equal(freed.status, 200);
  assert.equal(freed.body.promoted, null);

  const refused = await server.request(`/api/registrations/${waiting.body.registration.id}/promote`, {
    method: 'POST',
    cookie: staff,
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'WORKSHOP_CLOSED');
});

test('a duplicate registration is a controlled 409, never a server error', async () => {
  const staff = await server.signIn('staff');
  const manager = await server.signIn('manager');
  const workshop = await server.createWorkshop(manager, { code: 'DUP-009', capacity: 3 });

  const body = { attendeeName: 'Riley Chase', attendeeEmail: 'riley.chase@example.com' };
  const first = await server.request(`/api/workshops/${workshop.id}/registrations`, {
    method: 'POST',
    cookie: staff,
    body,
  });
  assert.equal(first.status, 201);

  // Case differences count as the same attendee.
  const second = await server.request(`/api/workshops/${workshop.id}/registrations`, {
    method: 'POST',
    cookie: staff,
    body: { ...body, attendeeEmail: 'RILEY.CHASE@example.com' },
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'ALREADY_REGISTERED');

  // Even a simultaneous burst of the same booking stays controlled.
  const burst = await Promise.all(
    Array.from({ length: 6 }, () =>
      server.request(`/api/workshops/${workshop.id}/registrations`, {
        method: 'POST',
        cookie: staff,
        body: { attendeeName: 'Jamie Fox', attendeeEmail: 'jamie.fox@example.com' },
      }),
    ),
  );
  for (const response of burst) {
    assert.ok(response.status === 201 || response.status === 409, `got ${response.status}`);
  }
  const created = burst.filter((response) => response.status === 201).length;
  assert.equal(created, 1, 'exactly one of the burst is created');
});
