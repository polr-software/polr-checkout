import { drizzle } from "drizzle-orm/neon-http";

import { drizzleDatabase } from "./drizzle-store";
import * as schema from "./schema";
import type { PolrDatabase, PolrDatabaseAdapter } from "./store";

export function neonHttpDatabase(connection: string): PolrDatabaseAdapter {
  return drizzleDatabase(drizzle(connection, { schema }) as PolrDatabase);
}
