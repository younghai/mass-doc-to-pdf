import type { FastifyInstance, FastifyReply } from "fastify";
import type { DocumentSearchRequest, SearchIndexDTO } from "@hwptopdf/shared";
import type { AppDeps } from "../app.js";
import { SearchOperationError } from "../search/service.js";

const disabledIndex: SearchIndexDTO = { enabled: false, status: "not_indexed", totalPages: 0, indexedPages: 0, omittedPages: [], error: null, updatedAt: null };
const paramsSchema = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 128 } }, additionalProperties: false };

async function respond<T>(reply: FastifyReply, operation: () => Promise<T>): Promise<T | FastifyReply> {
  reply.header("cache-control", "no-store");
  try { return await operation(); }
  catch (error) {
    if (error instanceof SearchOperationError) return reply.code(error.statusCode).send({ error: error.message });
    return reply.code(503).send({ error: "검색 처리에 실패했습니다. 연결 설정을 확인한 뒤 다시 시도해 주세요." });
  }
}

export function registerSearch(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/search/config", async (req, reply) => {
    if (!await deps.getSessionUser(req)) return reply.code(401).send({ error: "unauthenticated" });
    return reply.header("cache-control", "no-store").send({ enabled: deps.search?.enabled ?? false });
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id/search-index", { schema: { params: paramsSchema } }, async (req, reply) => {
    const user = await deps.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!deps.search) {
      if (!await deps.jobs.get(user.id, req.params.id)) return reply.code(404).send({ error: "not found" });
      return reply.header("cache-control", "no-store").send(disabledIndex);
    }
    return respond(reply, () => deps.search ? deps.search.status(user.id, req.params.id) : Promise.resolve(disabledIndex));
  });

  app.post<{ Params: { id: string }; Body: { confirmReview?: boolean } }>("/api/jobs/:id/search-index", {
    bodyLimit: 1024,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { params: paramsSchema, body: { type: "object", properties: { confirmReview: { type: "boolean" } }, additionalProperties: false } },
  }, async (req, reply) => {
    const user = await deps.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const service = deps.search;
    if (!service) return reply.code(503).send({ error: "문서 검색 연결이 설정되지 않았습니다." });
    return respond(reply, () => service.register(user.id, req.params.id, req.body.confirmReview === true));
  });

  app.delete<{ Params: { id: string } }>("/api/jobs/:id/search-index", { schema: { params: paramsSchema } }, async (req, reply) => {
    const user = await deps.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const service = deps.search;
    if (!service) return reply.code(503).send({ error: "문서 검색 연결이 설정되지 않았습니다." });
    return respond(reply, () => service.remove(user.id, req.params.id));
  });

  app.post<{ Body: DocumentSearchRequest }>("/api/search", {
    bodyLimit: 8192,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { body: {
      type: "object", required: ["query"], additionalProperties: false,
      properties: { query: { type: "string", minLength: 1, maxLength: 1000 }, rewrite: { type: "boolean" }, rerank: { type: "boolean" }, answer: { type: "boolean" } },
    } },
  }, async (req, reply) => {
    const user = await deps.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const service = deps.search;
    if (!service) return reply.code(503).send({ error: "문서 검색 연결이 설정되지 않았습니다." });
    const query = req.body.query.trim();
    if (!query) return reply.code(400).send({ error: "검색어를 입력해 주세요." });
    return respond(reply, () => service.search(user.id, { ...req.body, query }));
  });
}
