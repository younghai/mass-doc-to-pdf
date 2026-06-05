import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export function makePrisma(url: string) {
  return new PrismaClient({ datasources: { db: { url } } });
}
