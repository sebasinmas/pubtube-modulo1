import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema.js';

export type DrizzleDb = NodePgDatabase<typeof schema>;
