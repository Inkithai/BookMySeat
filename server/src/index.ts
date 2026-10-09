import fs from 'node:fs';
import { createApp } from './app.js';
import { openDatabase } from './db/index.js';
import { config, databaseTarget, describeDatabase } from './config.js';
import { ensureSeedData } from './db/seed.js';

let db;
try {
  db = await openDatabase(databaseTarget(), config.databasePoolSize);
} catch (error) {
  console.error(`BookMySeat cannot start: could not open ${describeDatabase()}.`);
  const { message, code } = (error ?? {}) as { message?: string; code?: string };
  console.error(message || code || error);
  process.exit(1);
}
console.log(`Using ${describeDatabase()}`);

if (config.seedDemoData) {
  await ensureSeedData(db);
}

const app = createApp(db);

const server = app.listen(config.port, () => {
  console.log(`BookMySeat is running at http://localhost:${config.port}`);
  if (!fs.existsSync(config.clientDistPath)) {
    console.log('Frontend not built here - this process is serving the API only.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
  });
}
