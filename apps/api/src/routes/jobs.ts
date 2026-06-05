import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { JobStatus } from "@hwptopdf/shared";
import type { AppDeps } from "../app.js";

export function registerJobs(app: FastifyInstance, deps: AppDeps) {
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.getSessionUser(req);
    if (!user) {
      reply.code(401).send({ error: "unauthenticated" });
      return null;
    }
    return user;
  };

  app.get("/api/jobs", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const status = (req.query as { status?: JobStatus }).status;
    return deps.jobs.list(user.id, { status });
  });

  app.get("/api/jobs/:id", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const job = await deps.jobs.get(user.id, (req.params as { id: string }).id);
    if (!job) return reply.code(404).send({ error: "not found" });
    return job;
  });

  app.get("/api/jobs/:id/download", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const raw = await deps.jobs.getRaw(user.id, (req.params as { id: string }).id);
    if (!raw) return reply.code(404).send({ error: "not found" });
    if (raw.status !== "success" || !raw.outputKey) {
      return reply.code(409).send({ error: "not converted" });
    }
    const bytes = await deps.storage.get(raw.outputKey);
    return reply
      .header("content-type", "application/pdf")
      .header(
        "content-disposition",
        `attachment; filename="${raw.filename.replace(/\.[^.]+$/, "")}.pdf"`,
      )
      .send(Buffer.from(bytes));
  });
}
