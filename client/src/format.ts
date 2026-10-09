/**
 * Date and label formatting for the interface.
 *
 * Deliberately duplicated from server/src/lib/datetime.ts: the frontend and
 * backend are separate build targets and these few helpers are not worth a
 * shared package. Workshop times are local wall-clock values with no offset, so
 * they are shown exactly as staff typed them.
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const pad2 = (value: number) => String(value).padStart(2, '0');

function parseLocal(value: string): Date {
  return value.length === 10 ? new Date(`${value}T00:00`) : new Date(value);
}

export function formatDate(value: string): string {
  const date = parseLocal(value);
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatTime(value: string): string {
  const date = parseLocal(value);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "14 Mar 2026, 09:31" */
export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

/** "Today" / "Tomorrow" / "" */
export function relativeDayLabel(date: string): string {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const shift = (days: number) => {
    const copy = new Date(today);
    copy.setDate(copy.getDate() + days);
    return iso(copy);
  };
  if (date === iso(today)) return 'Today';
  if (date === shift(1)) return 'Tomorrow';
  if (date === shift(-1)) return 'Yesterday';
  return '';
}

/** "YYYY-MM-DDTHH:mm" for a datetime-local input value. */
export function toDateTimeInputValue(value: string): string {
  return value.slice(0, 16);
}

export function todayDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const copy = new Date(year, month - 1, day + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${copy.getFullYear()}-${pad(copy.getMonth() + 1)}-${pad(copy.getDate())}`;
}

/**
 * Inclusive date range for the next `days` days, starting today.
 *
 * Both ends are inclusive, so "the next 7 days" is today plus six more days -
 * seven days, not eight.
 */
export function nextDaysRange(days: number): { from: string; to: string } {
  const from = todayDate();
  return { from, to: addDays(from, days - 1) };
}

export const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  REGISTERED: 'Attending',
  WAITLISTED: 'Waiting',
};

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  STAFF: 'Front desk',
};

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
