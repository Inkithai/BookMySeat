import { seedFromCli } from './seed.js';
import { databaseTarget, describeDatabase } from '../config.js';

if (!(await seedFromCli(databaseTarget(), describeDatabase()))) {
  process.exit(1);
}

console.log(`Seeded a fresh demo database in ${describeDatabase()}`);
console.log('Sign in with one of the accounts listed in the README, for example:');
console.log('  admin@bookmyseat.test / Admin123!');
