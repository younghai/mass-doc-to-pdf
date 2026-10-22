import { isIP } from "node:net";

const GOOGLE_CALLBACK_PATH = "/api/auth/callback/google";
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export interface GoogleOAuthEnv {
  readonly AUTH_SECRET?: string;
  readonly DEV_AUTH?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly WEB_ORIGIN?: string;
}

export interface GoogleOAuthReadiness {
  readonly ok: boolean;
  readonly redirectUri: string;
  readonly issues: readonly string[];
  readonly warnings: readonly string[];
}

function required(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizedHost(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isLocalhost(hostname: string): boolean {
  return LOCALHOST_HOSTS.has(normalizedHost(hostname).toLowerCase());
}

export function googleOAuthCallbackUri(webOrigin: string): string {
  return `${new URL(webOrigin).origin}${GOOGLE_CALLBACK_PATH}`;
}

export function checkGoogleOAuthReadiness(env: GoogleOAuthEnv): GoogleOAuthReadiness {
  const issues: string[] = [];
  const warnings: string[] = [];
  const rawWebOrigin = required(env.WEB_ORIGIN) || "http://localhost:5173";
  let webOriginUrl: URL;

  try {
    webOriginUrl = new URL(rawWebOrigin);
  } catch (err) {
    if (err instanceof TypeError) {
      issues.push("WEB_ORIGIN must be a valid URL origin.");
      webOriginUrl = new URL("http://localhost:5173");
    } else {
      throw err;
    }
  }

  if (required(env.DEV_AUTH) !== "0") {
    issues.push("DEV_AUTH must be 0 for external Google OAuth operation login.");
  }
  if (!required(env.AUTH_SECRET)) {
    issues.push("AUTH_SECRET is required for Auth.js session signing.");
  }
  if (!required(env.GOOGLE_CLIENT_ID)) {
    issues.push("GOOGLE_CLIENT_ID is required for Google OAuth.");
  }
  if (!required(env.GOOGLE_CLIENT_SECRET)) {
    issues.push("GOOGLE_CLIENT_SECRET is required for Google OAuth.");
  }

  const host = normalizedHost(webOriginUrl.hostname);
  const localhost = isLocalhost(host);
  if (webOriginUrl.protocol !== "https:" && !localhost) {
    issues.push("WEB_ORIGIN must use HTTPS for Google OAuth unless it is localhost.");
  }
  if (isIP(host) !== 0 && !localhost) {
    issues.push(
      "WEB_ORIGIN host must be a DNS name for Google OAuth; raw IP addresses are only allowed for localhost.",
    );
  }
  if (webOriginUrl.pathname !== "/" || webOriginUrl.search || webOriginUrl.hash) {
    warnings.push("WEB_ORIGIN should contain only scheme, host, and optional port; callback path is added by Auth.js.");
  }

  return {
    ok: issues.length === 0,
    redirectUri: `${webOriginUrl.origin}${GOOGLE_CALLBACK_PATH}`,
    issues,
    warnings,
  };
}
