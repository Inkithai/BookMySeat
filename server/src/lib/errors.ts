/**
 * Errors that carry an HTTP status. Anything thrown from a route or service
 * that is an HttpError is turned into a clean JSON response by the error
 * handler in app.ts; anything else becomes a 500.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Please sign in to continue.') =>
  new HttpError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to do that.') =>
  new HttpError(403, 'FORBIDDEN', message);

export const notFound = (message = 'That record could not be found.') =>
  new HttpError(404, 'NOT_FOUND', message);

export const conflict = (message: string, code = 'CONFLICT') =>
  new HttpError(409, code, message);
