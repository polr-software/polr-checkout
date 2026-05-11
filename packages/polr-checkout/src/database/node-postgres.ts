import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Pool, PoolConfig } from "pg";

import { drizzleDatabase } from "./drizzle-store";
import * as schema from "./schema";
import type { PolrDatabase, PolrDatabaseAdapter } from "./store";

export type NodePostgresDatabaseInput = string | Pool | PoolConfig;

function isPool(value: NodePostgresDatabaseInput): value is Pool {
  return typeof value === "object" && value !== null && "query" in value && "end" in value;
}

export function nodePostgresDatabase(input: NodePostgresDatabaseInput): PolrDatabaseAdapter {
  const client =
    typeof input === "string"
      ? new pg.Pool({ connectionString: input })
      : isPool(input)
        ? input
        : new pg.Pool(input);

  return drizzleDatabase(drizzle(client, { schema }) as PolrDatabase);
}
