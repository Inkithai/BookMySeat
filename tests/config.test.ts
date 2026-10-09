import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Environment configuration.
 *
 * `config.ts` stops the process when a value is unusable, so these checks run
 * it in a child process: a mistyped SESSION_TTL_DAYS used to become NaN and
 * break every sign-in with a 500, and a mistyped PORT crashed on listen.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const configEntry = path.join(repoRoot, 'server', 'src', 'config.ts');

function loadConfig(overrides: Record<string, string | undefined>): {
  status: number | null;
  stderr: string;
} {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const key of ['SESSION_TTL_DAYS', 'PORT', 'SEED_DEMO_DATA', 'DATABASE_URL', 'DATABASE_POOL_SIZE']) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) env[key] = value;
  }

  const result = spawnSync(tsxBin, ['--disable-warning=ExperimentalWarning', configEntry], {
    encoding: 'utf8',
    env,
  });
  return { status: result.status, stderr: result.stderr };
}

test('unset variables keep the documented defaults', () => {
  const run = loadConfig({});
  assert.equal(run.status, 0, run.stderr);
});

test('a non-numeric session lifetime stops the process with a clear message', () => {
  for (const value of ['abc', '14.5', '-5', '0', '99999', '14 days']) {
    const run = loadConfig({ SESSION_TTL_DAYS: value });
    assert.notEqual(run.status, 0, `${value} must not start`);
    assert.match(run.stderr, /SESSION_TTL_DAYS/);
    assert.match(run.stderr, /BookMySeat cannot start/);
  }
});

test('a non-numeric port stops the process with a clear message', () => {
  for (const value of ['abc', '0', '-1', '70000']) {
    const run = loadConfig({ PORT: value });
    assert.notEqual(run.status, 0, `${value} must not start`);
    assert.match(run.stderr, /PORT/);
  }
});

test('valid numbers are accepted', () => {
  assert.equal(loadConfig({ SESSION_TTL_DAYS: '30', PORT: '4001' }).status, 0);
});

test('only recognised booleans disable the demo seed', () => {
  for (const value of ['false', 'FALSE', '0', 'no', 'off']) {
    assert.equal(loadConfig({ SEED_DEMO_DATA: value }).status, 0, value);
  }
  const bogus = loadConfig({ SEED_DEMO_DATA: 'maybe' });
  assert.notEqual(bogus.status, 0);
  assert.match(bogus.stderr, /SEED_DEMO_DATA/);
});

test('a bad pool size stops the process instead of becoming NaN', () => {
  assert.equal(loadConfig({ DATABASE_POOL_SIZE: '10' }).status, 0);
  for (const value of ['abc', '0', '1000']) {
    const run = loadConfig({ DATABASE_POOL_SIZE: value });
    assert.notEqual(run.status, 0, value);
    assert.match(run.stderr, /DATABASE_POOL_SIZE/);
  }
});

test('DATABASE_URL must be a PostgreSQL connection string', () => {
  assert.equal(
    loadConfig({ DATABASE_URL: 'postgresql://postgres:secret@db.example.com:5432/postgres' }).status,
    0,
  );
  const bogus = loadConfig({ DATABASE_URL: 'mysql://root@localhost/bookmyseat' });
  assert.notEqual(bogus.status, 0);
  assert.match(bogus.stderr, /DATABASE_URL/);
});

/** The environment for a child process using an embedded database at `target`. */
function embeddedEnv(target: string, extra: Record<string, string> = {}): Record<string, string> {
  const env = { ...process.env, DATABASE_PATH: target, ...extra } as Record<string, string>;
  delete env.DATABASE_URL;
  return env;
}

test('the seed command refuses to reset a database holding real accounts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmyseat-seed-'));
  const target = path.join(dir, 'guarded');
  try {
    const first = spawnSync(tsxBin, ['--disable-warning=ExperimentalWarning', path.join(repoRoot, 'server', 'src', 'db', 'seed-cli.ts')], {
      encoding: 'utf8',
      env: embeddedEnv(target, { FORCE_SEED: 'true' }),
    });
    assert.equal(first.status, 0, first.stderr);

    const addUser = `
      import { openDatabase } from ${JSON.stringify(path.join(repoRoot, 'server', 'src', 'db', 'index.ts'))};
      (async () => {
        const db = await openDatabase(${JSON.stringify(target)});
        await db.run("INSERT INTO users (email, name, role, password_hash, created_at) VALUES ('real.person@example.com', 'Real Person', 'STAFF', 'x', '2030-01-01T00:00:00Z')");
        await db.close();
      })();
    `;
    const insert = spawnSync(tsxBin, ['--disable-warning=ExperimentalWarning', '--eval', addUser], {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    assert.equal(insert.status, 0, insert.stderr);

    const refused = spawnSync(
      tsxBin,
      ['--disable-warning=ExperimentalWarning', path.join(repoRoot, 'server', 'src', 'db', 'seed-cli.ts')],
      {
        encoding: 'utf8',
        env: embeddedEnv(target),
      },
    );
    assert.equal(refused.status, 1, 'the command must fail rather than wipe the database');
    assert.match(refused.stderr + refused.stdout, /Refusing to reset/);
    assert.match(refused.stderr + refused.stdout, /real\.person@example\.com/);

    const forced = spawnSync(
      tsxBin,
      ['--disable-warning=ExperimentalWarning', path.join(repoRoot, 'server', 'src', 'db', 'seed-cli.ts')],
      {
        encoding: 'utf8',
        env: embeddedEnv(target, { FORCE_SEED: 'true' }),
      },
    );
    assert.equal(forced.status, 0, forced.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
