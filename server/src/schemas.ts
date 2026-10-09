import { z } from 'zod';
import { isValidDate, isValidLocalDateTime, normalizeLocalDateTime } from './lib/datetime.js';
import {
  AUDIT_ENTITY_TYPES,
  ROLES,
  WORKSHOP_STATUSES,
} from './types.js';

/**
 * Request schemas. Everything that arrives from the outside world is parsed
 * here, so the services can trust their inputs.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const roleSchema = z.enum(ROLES);

const workshopStatusSchema = z.enum(WORKSHOP_STATUSES);

const dateSchema = z
  .string()
  .regex(DATE, 'Use the date format YYYY-MM-DD, for example 2026-03-14.')
  .refine(isValidDate, 'That is not a real date - check the month and day.');

/** "2026-03-14T10:00" as produced by a datetime-local input. */
const localDateTimeSchema = z
  .string()
  .refine(isValidLocalDateTime, 'Enter a date and time, for example 2026-03-14 at 10:00.')
  .transform(normalizeLocalDateTime);

/** Short uppercase code such as POT-101, unique per workshop. */
const workshopCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,15}$/, 'Use 2-16 letters, digits or dashes, for example POT-101.');

const emailSchema = z
  .email('Enter a valid email address, for example sam@example.com.')
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => value.length <= 160, 'That email address is too long.');

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(80, 'That name is too long.');

const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Use at most 72 characters.');

export const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

const workshopCore = {
  code: workshopCodeSchema,
  title: z.string().trim().min(2, 'Enter a title.').max(120, 'That title is too long.'),
  instructor: nameSchema,
  startsAt: localDateTimeSchema,
  durationMinutes: z.coerce.number().int().min(15, 'Use at least 15 minutes.').max(480, 'Use at most 8 hours.'),
  capacity: z.coerce.number().int().min(1, 'A workshop needs at least one seat.').max(500, 'That capacity is too large.'),
  status: workshopStatusSchema,
  location: z.string().trim().max(120, 'That location is too long.'),
  notes: z.string().trim().max(1000, 'Those notes are too long.'),
};

export const createWorkshopSchema = z.object({
  ...workshopCore,
  status: workshopStatusSchema.default('SCHEDULED'),
  location: z.string().trim().max(120, 'That location is too long.').default(''),
  notes: z.string().trim().max(1000, 'Those notes are too long.').default(''),
});

export const updateWorkshopSchema = z.object(workshopCore).partial();

export const registerAttendeeSchema = z.object({
  attendeeName: nameSchema,
  attendeeEmail: emailSchema,
});

export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: roleSchema,
  password: passwordSchema,
});

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Choose at least one thing to change.',
  });

/**
 * A boolean that arrives in a query string.
 *
 * `z.coerce.boolean()` is wrong here: it turns any non-empty string, including
 * "false", into true. Only the two literal values are accepted, so a typo is a
 * validation error rather than a silently ignored filter.
 */
const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const workshopFiltersSchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: workshopStatusSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  hasSeats: booleanQuerySchema.optional(),
});

export const auditFiltersSchema = z.object({
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Numeric path parameter such as /workshops/:id. */
export const idParamSchema = z.coerce.number().int().positive('That id is not valid.');
