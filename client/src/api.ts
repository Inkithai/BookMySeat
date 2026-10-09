/**
 * Thin typed wrapper around the API.
 *
 * All responses are JSON; authentication rides on the httpOnly session cookie,
 * so `credentials` is always same-origin and no token is ever stored in
 * JavaScript where a script injection could read it.
 */

import type {
  AuditEntry,
  NewWorkshop,
  Registration,
  Role,
  User,
  Workshop,
  WorkshopDetail,
  WorkshopFilters,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const payload = await response.json().catch(() => null);

  if (response.status === 401) {
    // The session is gone or was never there; start again at the sign-in page.
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign('/login');
    }
    // Keep the server's wording: on the sign-in form it says *why* (for
    // example a wrong password), not just "please sign in".
    const message = (payload as { error?: { message?: string } } | null)?.error?.message;
    throw new ApiError(message ?? 'Please sign in to continue.', 'UNAUTHORIZED');
  }

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      error?.message ??
        (response.status >= 500
          ? 'The server is not responding yet. If it was asleep, wait a few seconds and try again.'
          : 'Something went wrong. Please try again.'),
      error?.code,
      error?.details,
    );
  }
  return payload as T;
}

function toQuery(filters: WorkshopFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.hasSeats) params.set('hasSeats', 'true');
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const api = {
  signIn: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signOut: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  me: () => request<{ user: User }>('/auth/me'),

  listWorkshops: (filters: WorkshopFilters) =>
    request<{ workshops: Workshop[] }>(`/workshops${toQuery(filters)}`),

  getWorkshop: (id: number) => request<{ workshop: WorkshopDetail }>(`/workshops/${id}`),

  createWorkshop: (input: NewWorkshop) =>
    request<{ workshop: WorkshopDetail }>('/workshops', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateWorkshop: (id: number, patch: Partial<NewWorkshop>) =>
    request<{ workshop: WorkshopDetail }>(`/workshops/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  registerAttendee: (workshopId: number, attendeeName: string, attendeeEmail: string) =>
    request<{ registration: Registration; seatsRemaining: number; waitlisted: boolean }>(
      `/workshops/${workshopId}/registrations`,
      { method: 'POST', body: JSON.stringify({ attendeeName, attendeeEmail }) },
    ),

  cancelRegistration: (id: number) =>
    request<{ registration: Registration; promoted: Registration | null }>(`/registrations/${id}`, {
      method: 'DELETE',
    }),

  promoteRegistration: (id: number) =>
    request<{ registration: Registration }>(`/registrations/${id}/promote`, { method: 'POST' }),

  listUsers: () => request<{ users: User[] }>('/users'),

  createUser: (input: { name: string; email: string; role: Role; password: string }) =>
    request<{ user: User }>('/users', { method: 'POST', body: JSON.stringify(input) }),

  updateUser: (
    id: number,
    patch: { name?: string; role?: Role; isActive?: boolean; password?: string },
  ) => request<{ user: User }>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listAudit: (entityType?: string) =>
    request<{ audit: AuditEntry[] }>(`/audit${entityType ? `?entityType=${entityType}` : ''}`),
};
