import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppDeps } from "../app.js";

export function registerBatches(app: FastifyInstance, deps: AppDeps) {
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.getSessionUser(req);
    if (!user) {
      reply.code(401).send({ error: "unauthenticated" });
      return null;
    }
    return user;
  };

  app.get<{ Params: { readonly id: string } }>("/api/batches/:id", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const batch = await deps.jobs.getBatch(user.id, req.params.id);
    if (!batch) return reply.code(404).send({ error: "not found" });
    return batch;
  });
}
