import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.argv.includes("--help")) {
  console.log("Usage: pnpm dev\nStarts local web :5173, API :8000, converter :8080 and queue worker.\nData: tmp/local-dev; runtime: tmp/local-runtime; overrides: .env.local.\nStop all services with Ctrl+C. Only tmp/local-dev/app.db is migrated; original databases are preserved.");
  process.exit(0);
}
if (process.argv.length > 2) {
  console.error("Unknown argument. Run pnpm dev --help.");
  process.exit(1);
}
const localEnv = join(root, ".env.local");
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
const dataRoot = join(root, "tmp/local-dev");
const python = join(root, "tmp/local-runtime/bin/python");
const runtimeBin = process.env.HWPTOPDF_BIN_DIR;
const env = {
  ...process.env,
  PATH: [dirname(python), runtimeBin, process.env.PATH].filter(Boolean).join(delimiter),
  NODE_ENV: "development",
  AUTH_SECRET: randomBytes(32).toString("base64url"),
  DEV_AUTH: "1",
  HOST: "127.0.0.1",
  PORT: "8000",
  WEB_ORIGIN: "http://localhost:5173",
  TRUST_PROXY: "0",
  DATABASE_URL: `file:${join(dataRoot, "app.db")}`,
  STORAGE_DRIVER: "local",
  LOCAL_STORAGE_ROOT: join(dataRoot, "objects"),
  USE_QUEUE: "1",
  DATA_RETENTION_DAYS: "365000",
  OFFICE_ENGINE: "hwp-sidecar",
  HWP_SIDECAR_URL: "http://127.0.0.1:8080",
  RHWP_PYTHON: python,
  RHWP_ENABLED: "1",
  RHWP_CLI_ENABLED: "0",
  HANCOM_BASE_URL: "",
  ASPOSE_BASE_URL: "",
  VITE_ENABLE_MEETINGS: "0",
};
const children = [];
const processGroups = new Set();
let stopping = false;
function forceStop() {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    try {
      if (processGroups.has(child.pid)) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
    }
  }
}
function stop(code) {
  if (stopping) return forceStop();
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(forceStop, 5000).unref();
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, { cwd: root, env, stdio: "inherit" });
    children.push(child);
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`pnpm ${args.join(" ")} exited ${code}`)));
  });
}
function start(service) {
  const child = spawn(service.command, service.args, {
    cwd: join(root, service.cwd), env, stdio: "inherit", detached: true,
  });
  children.push(child);
  if (child.pid) processGroups.add(child.pid);
  child.once("error", (error) => {
    console.error(`${service.name}: ${error.message}`);
    stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error(`${service.name} stopped (${code}); stopping local services.`);
      stop(1);
    }
  });
}
async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Port ${port} is in use. Stop the existing local service before starting.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    await delay(500);
  }
  throw new Error(`Service did not become ready: ${url}`);
}
try {
  if (!existsSync(python)) throw new Error("Install the local Python runtime first; see docs/local-development.md.");
  await Promise.all([5173, 8000, 8080].map(assertPortFree));
  mkdirSync(join(dataRoot, "objects"), { recursive: true });
  await run(["--filter", "@hwptopdf/api", "exec", "prisma", "generate"]);
  await run(["--filter", "@hwptopdf/api", "exec", "prisma", "migrate", "deploy"]);
  await run(["--filter", "@hwptopdf/api...", "build"]);
  if (!stopping) {
    start({ name: "converter", command: python, args: ["-m", "gunicorn", "--bind", "127.0.0.1:8080", "--workers", "2", "--timeout", "180", "--control-socket", join(dataRoot, "gunicorn.ctl"), "app:app"], cwd: "hwp-sidecar" });
    await waitFor("http://127.0.0.1:8080/health");
    start({ name: "API", command: process.execPath, args: ["dist/server.js"], cwd: "apps/api" });
    await waitFor("http://127.0.0.1:8000/health");
    start({ name: "worker", command: process.execPath, args: ["dist/queue/worker-main.js"], cwd: "apps/api" });
    start({ name: "web", command: process.execPath, args: ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--strictPort"], cwd: "apps/web" });
    await waitFor("http://127.0.0.1:5173/api/auth/session");
    console.log("\nLocal service ready: http://localhost:5173/service\nPress Ctrl+C to stop.\n");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop(1);
}
