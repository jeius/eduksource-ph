import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(connectionString: string): DrizzleDB {
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema });
}
