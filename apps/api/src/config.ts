import type { EngineConfig } from "./convert/registry.js";

export function loadEngineConfig(env: NodeJS.ProcessEnv): EngineConfig {
  const cfg: EngineConfig = {
    gotenbergUrl: env.GOTENBERG_URL ?? "http://localhost:3000",
    hwpSidecarUrl: env.HWP_SIDECAR_URL ?? "http://localhost:8080",
  };

  if (env.HANCOM_BASE_URL && env.HANCOM_API_KEY) {
    cfg.hancom = { baseUrl: env.HANCOM_BASE_URL, apiKey: env.HANCOM_API_KEY };
  }
  if (env.ASPOSE_BASE_URL && env.ASPOSE_CLIENT_ID && env.ASPOSE_CLIENT_SECRET) {
    cfg.aspose = {
      baseUrl: env.ASPOSE_BASE_URL,
      clientId: env.ASPOSE_CLIENT_ID,
      clientSecret: env.ASPOSE_CLIENT_SECRET,
    };
  }
  return cfg;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

export interface AuthConfigValues {
  googleId: string;
  googleSecret: string;
  secret: string;
  devAuth: boolean;
}

export interface AppConfig {
  engines: EngineConfig;
  s3: S3Config;
  auth: AuthConfigValues;
  webOrigin: string;
  port: number;
}

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  if (!env.AUTH_SECRET) {
    throw new Error("AUTH_SECRET is required (generate with: openssl rand -base64 32)");
  }
  return {
    engines: loadEngineConfig(env),
    s3: {
      endpoint: env.S3_ENDPOINT ?? "http://localhost:9000",
      bucket: env.S3_BUCKET ?? "hwptopdf",
      accessKey: env.S3_ACCESS_KEY ?? "minio",
      secretKey: env.S3_SECRET_KEY ?? "minio12345",
      region: env.S3_REGION ?? "us-east-1",
    },
    auth: {
      googleId: env.GOOGLE_CLIENT_ID ?? "",
      googleSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      secret: env.AUTH_SECRET,
      devAuth: env.DEV_AUTH === "1",
    },
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:5173",
    port: Number(env.PORT ?? 8000),
  };
}
