import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

export function registerStats(app: FastifyInstance, deps: AppDeps) {
  app.get("/api/stats", async (req, reply) => {
    const user = await deps.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    return deps.jobs.stats(user.id);
  });
}
