/** Domain types shared by the services, routes and (mirrored) the frontend. */

export const ROLES = ['ADMIN', 'MANAGER', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const WORKSHOP_STATUSES = ['SCHEDULED', 'CANCELLED', 'COMPLETED'] as const;
export type WorkshopStatus = (typeof WORKSHOP_STATUSES)[number];

export const REGISTRATION_STATUSES = ['REGISTERED', 'WAITLISTED', 'CANCELLED'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const AUDIT_ENTITY_TYPES = ['WORKSHOP', 'USER', 'REGISTRATION'] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** Who performed an action, as embedded in registration and audit rows. */
export type ActorRef = {
  id: number;
  name: string;
  email: string;
};

export type UserSummary = {
  id: number;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  createdByName: string | null;
};

/** A user row including the password hash - never leaves the service layer. */
export type UserRecord = UserSummary & {
  passwordHash: string;
};

export type WorkshopSummary = {
  id: number;
  code: string;
  title: string;
  instructor: string;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  status: WorkshopStatus;
  location: string;
  notes: string;
  registeredCount: number;
  waitlistCount: number;
  seatsRemaining: number;
  createdAt: string;
  updatedAt: string | null;
};

export type Registration = {
  id: number;
  workshopId: number;
  attendeeName: string;
  attendeeEmail: string;
  status: RegistrationStatus;
  /** Position in the waitlist; null unless the registration is WAITLISTED. */
  waitlistPosition: number | null;
  registeredAt: string;
  registeredBy: ActorRef;
  cancelledAt: string | null;
  cancelledBy: ActorRef | null;
};

export type WorkshopDetail = WorkshopSummary & {
  registrations: Registration[];
  recentActivity: AuditEntry[];
};

export type AuditEntry = {
  id: number;
  entityType: AuditEntityType;
  entityId: number | null;
  action: string;
  summary: string;
  detail: Record<string, unknown> | null;
  actor: ActorRef;
  createdAt: string;
};
