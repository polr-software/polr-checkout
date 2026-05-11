import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const migrationsSchema = "public";
const migrationsTable = "polr_migrations";

export function getMigrationsConfig(importMetaUrl: string) {
  return {
    migrationsFolder: path.resolve(
      path.dirname(fileURLToPath(importMetaUrl)),
      "../database/migrations",
    ),
    migrationsSchema,
    migrationsTable,
  };
}

export function getMigrationCount(importMetaUrl: string): number {
  const journalPath = path.join(
    getMigrationsConfig(importMetaUrl).migrationsFolder,
    "meta",
    "_journal.json",
  );
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
    entries: readonly { tag: string }[];
  };
  return journal.entries.length;
}

export function getPendingCount(totalMigrations: number, appliedCount: number): number {
  return Math.max(0, totalMigrations - appliedCount);
}
