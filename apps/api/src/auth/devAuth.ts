import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "./plugin.js";

export const DEV_AUTH_EMAIL = "operator@hwptopdf.local";
const DEV_AUTH_NAME = "Local Operator";

export async function ensureDevAuthUser(prisma: PrismaClient): Promise<SessionUser> {
  const user = await prisma.user.upsert({
    where: { email: DEV_AUTH_EMAIL },
    update: { name: DEV_AUTH_NAME },
    create: { email: DEV_AUTH_EMAIL, name: DEV_AUTH_NAME },
  });
  return { id: user.id, email: user.email ?? DEV_AUTH_EMAIL };
}
