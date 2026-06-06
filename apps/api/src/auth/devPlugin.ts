import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { SessionUser } from "./plugin.js";

declare module "fastify" {
  interface FastifyInstance {
    getSessionUser(req: FastifyRequest): Promise<SessionUser | null>;
  }
}

const devAuthPluginImpl: FastifyPluginAsync<{ user: SessionUser }> = async (app, opts) => {
  const { user } = opts;

  app.get("/api/auth/session", async () => ({
    user: {
      id: user.id,
      email: user.email,
      name: "Local Operator",
      image: null,
    },
  }));

  app.get("/api/auth/signin/google", async (_req, reply) => reply.redirect("/"));
  app.get("/api/auth/signout", async (_req, reply) => reply.redirect("/"));

  app.decorate("getSessionUser", async () => user);
};

export const devAuthPlugin = fp(devAuthPluginImpl, { name: "dev-auth" });
