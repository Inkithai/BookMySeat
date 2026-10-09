/**
 * Copies the SQL schema next to the compiled server code.
 *
 * TypeScript only emits .ts files, and db/index.ts reads schema.sql from its own
 * directory at runtime, so the file has to travel with the build output.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(repoRoot, 'server', 'src', 'db', 'schema.sql');
const target = join(repoRoot, 'server', 'dist', 'db', 'schema.sql');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Copied schema to ${target}`);
