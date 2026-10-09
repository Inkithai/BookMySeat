import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, nextDaysRange, todayDate } from '../client/src/format.js';
import { isValidDate, isValidLocalDateTime } from '../server/src/lib/datetime.js';

/**
 * Pure date helpers, shared by the frontend filters and the backend
 * validation. They are kept in one place so an off-by-one in a range shows up
 * as a failing test rather than a workshop that is missing from a report.
 */

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29', 'leap years are handled');
  assert.equal(addDays('2030-02-28', 1), '2030-03-01');
  assert.equal(addDays('2026-10-09', 0), '2026-10-09');
});

test('a "next N days" range covers exactly N days', () => {
  const week = nextDaysRange(7);
  assert.equal(week.from, todayDate());
  assert.equal(week.to, addDays(week.from, 6));

  // Both ends inclusive, so the span is 7 calendar days, not 8.
  const days = [];
  for (let cursor = week.from; cursor <= week.to; cursor = addDays(cursor, 1)) days.push(cursor);
  assert.equal(days.length, 7);

  assert.deepEqual(nextDaysRange(1), { from: week.from, to: week.from });
});

test('todayDate is a plain calendar date in local time', () => {
  assert.match(todayDate(), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(isValidDate(todayDate()));
});

test('isValidDate accepts real days only', () => {
  assert.ok(isValidDate('2028-02-29'));
  assert.ok(!isValidDate('2030-02-29'));
  assert.ok(!isValidDate('2030-04-31'));
  assert.ok(!isValidDate('2030-13-01'));
  assert.ok(!isValidDate('2030-01-00'));
  assert.ok(!isValidDate('2030-1-1'));
  assert.ok(!isValidDate('20300101'));
  assert.ok(!isValidDate(''));
});

test('isValidLocalDateTime rejects times that roll over', () => {
  assert.ok(isValidLocalDateTime('2030-01-15T10:00'));
  assert.ok(isValidLocalDateTime('2030-01-15T23:59:59'));
  assert.ok(!isValidLocalDateTime('2030-01-15T24:00'));
  assert.ok(!isValidLocalDateTime('2030-01-15T24:30'));
  assert.ok(!isValidLocalDateTime('2030-01-15T10:60'));
  assert.ok(!isValidLocalDateTime('2030-02-30T10:00'));
  assert.ok(!isValidLocalDateTime('2030-01-15'));
});
