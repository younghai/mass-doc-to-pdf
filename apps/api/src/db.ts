import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export function makePrisma(url: string) {
  return new PrismaClient({ datasources: { db: { url } } });
}

/**
 * Enable WAL + a busy timeout so the API and the worker process can write the
 * conversionJob table concurrently without SQLITE_BUSY. WAL is a no-op on
 * in-memory databases. Call once at process start (API and worker). Failures
 * are logged, not fatal — Postgres deployments simply ignore the SQLite pragmas.
 */
export async function initSqlitePragmas(client: PrismaClient = prisma): Promise<void> {
  try {
    await client.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await client.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
  } catch (err) {
    console.error("failed to set SQLite pragmas (continuing):", err);
  }
}
