import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { authPlugin } from "./plugin.js";

function appWith() {
  const app = Fastify();
  app.register(authPlugin, {
    config: {
      secret: "test-secret-test-secret-test-secret",
      providers: [],
      trustHost: true,
      session: { strategy: "jwt" },
    },
  });
  app.get("/me", async (req, reply) => {
    const user = await app.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    return { user };
  });
  return app;
}

describe("authPlugin", () => {
  it("rejects a protected route without a session", async () => {
    const app = appWith();
    const res = await app.inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
  });

  it("mounts the auth handler under /api/auth (not 404)", async () => {
    const app = appWith();
    const res = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect([200, 302, 400]).toContain(res.statusCode);
  });
});
