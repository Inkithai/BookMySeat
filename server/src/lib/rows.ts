/**
 * Small helpers for turning database rows into typed domain values without
 * resorting to casts. PostgreSQL returns COUNT(*) as a bigint string, so every
 * number goes through `num`.
 */

export type { Row } from '../db/index.js';

export const num = (value: unknown): number => Number(value);

export const str = (value: unknown): string => (value == null ? '' : String(value));

export const nullableStr = (value: unknown): string | null =>
  value == null ? null : String(value);

export const bool = (value: unknown): boolean => Number(value) === 1;
