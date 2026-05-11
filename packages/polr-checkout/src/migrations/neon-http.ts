import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

import * as schema from "../database/schema";
import { getMigrationCount, getMigrationsConfig, getPendingCount } from "./common";

export async function migrateDatabase(connection: string): Promise<void> {
  await migrate(drizzle(connection, { schema }), getMigrationsConfig(import.meta.url));
}

export async function getPendingMigrationCount(connection: string): Promise<number> {
  const totalMigrations = getMigrationCount(import.meta.url);

  try {
    const query = neon(connection);
    const rows = await query`SELECT count(*)::int AS count FROM public.polr_migrations`;
    const appliedCount = Number((rows[0] as { count?: number | string } | undefined)?.count ?? 0);
    return getPendingCount(totalMigrations, appliedCount);
  } catch {
    return totalMigrations;
  }
}
