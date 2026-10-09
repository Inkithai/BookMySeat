/**
 * Shapes returned by the API.
 *
 * These mirror server/src/types.ts on purpose: the two halves are deployed
 * separately and the HTTP response is the contract between them.
 */

export type Role = 'ADMIN' | 'MANAGER' | 'STAFF';

export type WorkshopStatus = 'SCHEDULED' | 'CANCELLED' | 'COMPLETED';

export type RegistrationStatus = 'REGISTERED' | 'WAITLISTED' | 'CANCELLED';

export type User = {
  id: number;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  createdByName: string | null;
};

export type Workshop = {
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
  waitlistPosition: number | null;
  registeredAt: string;
  registeredBy: { id: number; name: string; email: string };
  cancelledAt: string | null;
  cancelledBy: { id: number; name: string; email: string } | null;
};

export type AuditEntry = {
  id: number;
  entityType: 'WORKSHOP' | 'USER' | 'REGISTRATION';
  entityId: number | null;
  action: string;
  summary: string;
  detail: Record<string, unknown> | null;
  actor: { id: number; name: string; email: string };
  createdAt: string;
};

export type WorkshopDetail = Workshop & {
  registrations: Registration[];
  recentActivity: AuditEntry[];
};

export type WorkshopFilters = {
  q?: string;
  status?: WorkshopStatus | '';
  from?: string;
  to?: string;
  hasSeats?: boolean;
};

export type NewWorkshop = {
  code: string;
  title: string;
  instructor: string;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  status: WorkshopStatus;
  location: string;
  notes: string;
};
