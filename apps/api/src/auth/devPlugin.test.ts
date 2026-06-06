import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { devAuthPlugin } from "./devPlugin.js";
import { DEV_AUTH_EMAIL } from "./devAuth.js";

function appWithDevAuth() {
  const app = Fastify();
  app.register(devAuthPlugin, { user: { id: "dev-user", email: DEV_AUTH_EMAIL } });
  app.get("/me", async (req) => ({ user: await app.getSessionUser(req) }));
  return app;
}

describe("devAuthPlugin", () => {
  it("returns a local operator session and protects app routes as authenticated", async () => {
    const app = appWithDevAuth();

    const session = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ user: { email: DEV_AUTH_EMAIL } });

    const me = await app.inject({ method: "GET", url: "/me" });
    expect(me.json()).toMatchObject({ user: { id: "dev-user", email: DEV_AUTH_EMAIL } });
  });
});
