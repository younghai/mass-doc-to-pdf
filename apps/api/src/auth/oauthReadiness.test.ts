import { describe, expect, it } from "vitest";
import { checkGoogleOAuthReadiness, googleOAuthCallbackUri } from "./oauthReadiness.js";

describe("googleOAuthCallbackUri", () => {
  it("builds the exact Auth.js Google callback URI when WEB_ORIGIN is an origin", () => {
    const redirectUri = googleOAuthCallbackUri("https://pdf.example.com");

    expect(redirectUri).toBe("https://pdf.example.com/api/auth/callback/google");
  });

  it("normalizes a trailing slash without changing the callback path", () => {
    const redirectUri = googleOAuthCallbackUri("https://pdf.example.com/");

    expect(redirectUri).toBe("https://pdf.example.com/api/auth/callback/google");
  });
});

describe("checkGoogleOAuthReadiness", () => {
  it("passes for DEV_AUTH=0 with credentials and a public HTTPS origin", () => {
    const result = checkGoogleOAuthReadiness({
      AUTH_SECRET: "secret",
      DEV_AUTH: "0",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      WEB_ORIGIN: "https://pdf.example.com",
    });

    expect(result).toEqual({
      ok: true,
      redirectUri: "https://pdf.example.com/api/auth/callback/google",
      issues: [],
      warnings: [],
    });
  });

  it("reports actionable issues when production OAuth is pointed at a raw HTTP server IP", () => {
    const result = checkGoogleOAuthReadiness({
      AUTH_SECRET: "secret",
      DEV_AUTH: "0",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      WEB_ORIGIN: "http://172.19.1.151:8081",
    });

    expect(result.ok).toBe(false);
    expect(result.redirectUri).toBe("http://172.19.1.151:8081/api/auth/callback/google");
    expect(result.issues).toEqual([
      "WEB_ORIGIN must use HTTPS for Google OAuth unless it is localhost.",
      "WEB_ORIGIN host must be a DNS name for Google OAuth; raw IP addresses are only allowed for localhost.",
    ]);
  });

  it("requires external OAuth mode and Google credentials for operation login", () => {
    const result = checkGoogleOAuthReadiness({
      AUTH_SECRET: "secret",
      DEV_AUTH: "1",
      WEB_ORIGIN: "https://pdf.example.com",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      "DEV_AUTH must be 0 for external Google OAuth operation login.",
      "GOOGLE_CLIENT_ID is required for Google OAuth.",
      "GOOGLE_CLIENT_SECRET is required for Google OAuth.",
    ]);
  });
});
