import Google from "@auth/core/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import type { AuthConfig } from "@auth/core";

export function buildAuthConfig(opts: {
  prisma: PrismaClient;
  googleId: string;
  googleSecret: string;
  secret: string;
}): AuthConfig {
  return {
    secret: opts.secret,
    trustHost: true,
    // PrismaAdapter's generated types can drift from @auth/core; the runtime
    // contract is correct, so we bridge the nominal type mismatch here.
    adapter: PrismaAdapter(opts.prisma) as AuthConfig["adapter"],
    session: { strategy: "database" },
    providers: [Google({ clientId: opts.googleId, clientSecret: opts.googleSecret })],
  };
}
