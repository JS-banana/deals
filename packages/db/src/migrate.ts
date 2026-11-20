import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './index.ts';

const db = createDb();
await migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../migrations') });
await db.$client.end();
console.log('migrations applied');
