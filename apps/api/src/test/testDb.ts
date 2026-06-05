import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makePrisma } from "../db.js";

const require = createRequire(import.meta.url);

/**
 * Create a throwaway SQLite database with the current schema applied via
 * `prisma db push`. Robustly resolves the prisma CLI regardless of PATH.
 */
export function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "hwp-db-"));
  const url = `file:${join(dir, "t.db")}`;
  const prismaBin = join(dirname(require.resolve("prisma/package.json")), "build", "index.js");
  execSync(`node "${prismaBin}" db push --skip-generate --accept-data-loss`, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  const prisma = makePrisma(url);
  return {
    prisma,
    async cleanup() {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
