import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makePrisma } from "../db.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../prisma/migrations");

function currentMigrationSql(): string {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"))
    .join("\n");
}

function applyMigrations(dbPath: string): void {
  execFileSync("sqlite3", [dbPath], {
    input: `PRAGMA foreign_keys=ON;\n${currentMigrationSql()}`,
    stdio: ["pipe", "ignore", "pipe"],
  });
}

/**
 * Create a throwaway SQLite database with the current schema applied via
 * committed migrations. This avoids invoking Prisma's schema engine in unit
 * tests while keeping the test DB aligned with deploy-time schema changes.
 */
export function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "hwp-db-"));
  const dbPath = join(dir, "t.db");
  const url = `file:${dbPath}`;
  applyMigrations(dbPath);
  const prisma = makePrisma(url);
  return {
    prisma,
    async cleanup() {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
