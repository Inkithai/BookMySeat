import { z } from 'zod';
import { badRequest } from './errors.js';

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('Please check the details you entered.', formatIssues(result.error));
  }
  return result.data;
}

export function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.output<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw badRequest('Those filters could not be understood.', formatIssues(result.error));
  }
  return result.data;
}

/** Parses a single value such as a path parameter. */
export function parseValue<T extends z.ZodType>(
  schema: T,
  value: unknown,
  label = 'value',
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(`That ${label} is not valid.`, formatIssues(result.error));
  }
  return result.data;
}

function formatIssues(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** Escapes LIKE wildcards so a search for "100%" is not treated as a pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
