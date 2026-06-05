import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { Auth, type AuthConfig } from "@auth/core";

export interface SessionUser {
  id: string;
  email: string | null;
}

declare module "fastify" {
  interface FastifyInstance {
    getSessionUser(req: FastifyRequest): Promise<SessionUser | null>;
  }
}

function originOf(req: FastifyRequest): string {
  return `${req.protocol}://${req.headers.host ?? "localhost"}`;
}

function toWebRequest(req: FastifyRequest): Request {
  const url = `${originOf(req)}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const method = req.method;
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD" && req.body != null) {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }
  return new Request(url, { method, headers, body });
}

async function copyResponse(res: Response, reply: import("fastify").FastifyReply) {
  reply.code(res.status);
  const setCookies = res.headers.getSetCookie?.() ?? [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
  });
  for (const c of setCookies) reply.header("set-cookie", c);
  const text = await res.text();
  reply.send(text.length ? text : null);
}

const authPluginImpl: FastifyPluginAsync<{ config: AuthConfig }> = async (app, opts) => {
  const { config } = opts;

  // Auth.js posts use form-urlencoded; keep the raw string so the bridge can forward it.
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) => done(null, body),
    );
  }

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (req, reply) => {
      const res = await Auth(toWebRequest(req), config);
      await copyResponse(res, reply);
    },
  });

  app.decorate("getSessionUser", async (req: FastifyRequest): Promise<SessionUser | null> => {
    try {
      const sessionReq = new Request(`${originOf(req)}/api/auth/session`, {
        headers: { cookie: req.headers.cookie ?? "" },
      });
      const res = await Auth(sessionReq, config);
      if (res.status !== 200) return null;
      const data = (await res.json().catch(() => null)) as
        | { user?: { id?: string; email?: string } }
        | null;
      if (!data?.user) return null;
      return { id: data.user.id ?? data.user.email ?? "", email: data.user.email ?? null };
    } catch {
      return null;
    }
  });
};

// Wrap with fastify-plugin so decorations (getSessionUser) and the /api/auth/*
// routes are added to the parent instance rather than an encapsulated child.
export const authPlugin = fp(authPluginImpl, { name: "auth" });
