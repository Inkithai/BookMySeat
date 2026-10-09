/**
 * Date/time helpers.
 *
 * Two kinds of timestamp exist in this app:
 *
 *  - Workshop start times are *local wall-clock* values with no offset
 *    ("2026-03-14T10:00"). The front desk types in 10:00 and expects to read
 *    back 10:00, so these are stored and displayed verbatim.
 *  - Audit timestamps are UTC instants ("2026-03-14T09:31:00.000Z").
 *
 * Display formatting lives in the client (client/src/format.ts). "Today" is
 * the server's local date, so production sets TZ (e.g. Asia/Colombo).
 */

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = (value: number) => String(value).padStart(2, '0');

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * True only when `value` names a real calendar day.
 *
 * `new Date('2030-02-30')` does not fail - JavaScript rolls it over to
 * 2 March - so a plain "is it NaN" check lets impossible dates through. The
 * round-trip comparison below rejects anything that does not survive being
 * parsed and rebuilt.
 */
export function isValidDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

/**
 * True only for a real calendar date and a real time of day. Rebuilding the
 * date also catches 24:00 and 25:00 start times, which roll over to the next
 * day rather than failing to parse.
 */
export function isValidLocalDateTime(value: string): boolean {
  if (!LOCAL_DATETIME.test(value)) return false;

  const [datePart, timePart = ''] = value.split('T');
  if (!isValidDate(datePart)) return false;

  const [hour, minute] = timePart.split(':').map(Number);
  const parsed = new Date(1970, 0, 1, hour, minute);
  return parsed.getHours() === hour && parsed.getMinutes() === minute;
}

/** "2026-03-14T10:00" -> "2026-03-14T10:00:00" so it is comparable and parseable. */
export function normalizeLocalDateTime(value: string): string {
  return value.length === 16 ? `${value}:00` : value;
}

/** "YYYY-MM-DD" for a Date, in local time. */
function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Local-time Date for a "YYYY-MM-DD" string (never UTC, unlike new Date(str)). */
function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: string, days: number): string {
  const result = parseDateOnly(date);
  result.setDate(result.getDate() + days);
  return toIsoDate(result);
}

export function todayDate(): string {
  return toIsoDate(new Date());
}
