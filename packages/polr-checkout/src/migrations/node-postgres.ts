import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import type { Pool } from "pg";

import * as schema from "../database/schema";
import { getMigrationCount, getMigrationsConfig, getPendingCount } from "./common";

export type NodePostgresMigrationInput = string | Pool;

function getPool(input: NodePostgresMigrationInput): { pool: Pool; shouldClose: boolean } {
  if (typeof input === "string") {
    return { pool: new pg.Pool({ connectionString: input }), shouldClose: true };
  }
  return { pool: input, shouldClose: false };
}

export async function migrateDatabase(input: NodePostgresMigrationInput): Promise<void> {
  const { pool, shouldClose } = getPool(input);
  try {
    await migrate(drizzle(pool, { schema }), getMigrationsConfig(import.meta.url));
  } finally {
    if (shouldClose) await pool.end();
  }
}

export async function getPendingMigrationCount(input: NodePostgresMigrationInput): Promise<number> {
  const { pool, shouldClose } = getPool(input);
  const totalMigrations = getMigrationCount(import.meta.url);

  try {
    const result = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.polr_migrations",
    );
    const appliedCount = result.rows[0]?.count ?? 0;
    return getPendingCount(totalMigrations, appliedCount);
  } catch {
    return totalMigrations;
  } finally {
    if (shouldClose) await pool.end();
  }
}
