# HWP/Office → PDF Conversion Web App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A full-stack web app where a user signs in with Google, uploads a document (HWP/HWPX/DOCX/XLSX/PPTX/legacy Office), the server converts it to PDF, and a dashboard shows every job — file name, date, file properties, success/fail status (with a per-case view), and the overall conversion success rate.

**Architecture:** A **pnpm-workspace monorepo** with three packages: `apps/api` (Fastify backend — auth, conversion routing, persistence, storage, stats), `apps/web` (React + Vite dashboard SPA), and `packages/shared` (DTO types shared by both). The API detects the upload's format and routes it through a pluggable `Converter` registry (commercial-first: Aspose/Hancom; free fallback: Gotenberg/LibreOffice+H2Orestart), all behind containerized backends. Uploads and result PDFs live in **S3-compatible storage (MinIO)**; job metadata, users, and sessions live in **SQLite via Prisma**. Auth is **Google OAuth via `@auth/core` + `@auth/prisma-adapter`** bridged into Fastify.

**Tech Stack:** Node 20+ (ESM), TypeScript, pnpm@10.32.1 (shared store), Vitest + React Testing Library, Fastify 5 + `@fastify/multipart` + `@fastify/cookie`, `@auth/core` + `@auth/prisma-adapter`, Prisma + SQLite, AWS SDK v3 S3 client (→ MinIO), React 18 + Vite + React Router + TanStack Query + Recharts, Docker Compose (web + api + gotenberg + hwp-sidecar + minio).

**Key design rules:** DRY · YAGNI (single-file convert; batch/queue is a later plan) · TDD (test-first every task) · frequent commits. Unit tests are hermetic (inject fakes; no network/db where possible, SQLite temp file where a real DB is needed); real backends run only under a gated e2e.

---

## Conventions used in every task

- **Test-first.** Write the failing test → run it → watch it fail for the right reason → implement → green → commit.
- **Commands.** API/shared tests: `pnpm --filter @hwptopdf/api test -- <path>`. Web tests: `pnpm --filter @hwptopdf/web test -- <path>`. Whole repo: `pnpm -r test`.
- **Commit** after every green step with a Conventional Commit message.
- **No faked success.** Engines/services without credentials throw a clear, typed error; their real contract tests are `it.skip`-gated on env vars.

---

# PHASE A — Monorepo + conversion core

## Task 0: Monorepo scaffolding (pnpm workspace)

**Files:**
- Create: `package.json` (root), `pnpm-workspace.yaml`, `.npmrc`, `.gitignore`, `.dockerignore`, `tsconfig.base.json`
- Create: `packages/shared/{package.json,tsconfig.json,src/index.ts}`
- Create: `apps/api/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Create: `apps/web/` (scaffolded in Task 15 — placeholder package.json only here)

**Step 1: git init**

```bash
cd /Users/young/Downloads/personal_project/hwptopdf
git init
```

**Step 2: Root `package.json`**

```json
{
  "name": "hwptopdf",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.32.1",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "build": "pnpm -r build"
  }
}
```

**Step 3: `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

**Step 4: `.npmrc`** (shared store per workspace policy)

```
store-dir=/Users/young/Downloads/personal_project/.pnpm-store
```

**Step 5: `.gitignore`**

```
node_modules/
dist/
*.log
.env
.env.*
.DS_Store
tmp/
apps/api/prisma/*.db
apps/web/dist/
```

**Step 6: `.dockerignore`**

```
**/node_modules
**/dist
.git
tmp
*.log
```

**Step 7: `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

**Step 8: `packages/shared`**

`packages/shared/package.json`:

```json
{
  "name": "@hwptopdf/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.6" }
}
```

`packages/shared/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src/**/*.ts"] }
```

`packages/shared/src/index.ts`:

```ts
export type DocFormat = "office" | "hwp";
export type JobStatus = "pending" | "success" | "failed";

export interface JobDTO {
  id: string;
  filename: string;
  format: DocFormat;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  status: JobStatus;
  engine: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string; // ISO
}

export interface StatsDTO {
  total: number;
  success: number;
  failed: number;
  pending: number;
  successRate: number; // 0..1, success / (success+failed)
}
```

**Step 9: `apps/api` package files**

`apps/api/package.json`:

```json
{
  "name": "@hwptopdf/api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "prisma:migrate": "prisma migrate dev",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "@auth/core": "^0.37.4",
    "@auth/prisma-adapter": "^2.7.4",
    "@aws-sdk/client-s3": "^3.700.0",
    "@fastify/cookie": "^11.0.1",
    "@fastify/multipart": "^9.0.1",
    "@hwptopdf/shared": "workspace:*",
    "@prisma/client": "^6.1.0",
    "fastify": "^5.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "prisma": "^6.1.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.6"
  }
}
```

`apps/api/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src/**/*.ts"] }
```

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
```

`apps/api/src/index.ts`:

```ts
export const API_NAME = "hwptopdf-api";
```

**Step 10: Install + sanity check**

Run: `pnpm install`
Expected: workspace links resolve, `pnpm-lock.yaml` created, no `package-lock.json`.
Run: `pnpm --filter @hwptopdf/shared build`
Expected: `packages/shared/dist` produced.
Run: `node /Users/young/Downloads/personal_project/scripts/node-policy-check.mjs`
Expected: passes.

**Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo (api + shared + workspace config)"
```

---

## Task 1: Format detection (`office` vs `hwp`)

**Files:** Create `apps/api/src/detect/detectFormat.ts`; Test `apps/api/src/detect/detectFormat.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { detectFormat, fileMeta } from "./detectFormat.js";

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

describe("detectFormat", () => {
  it("classifies office extensions", () => {
    for (const ext of ["docx", "xlsx", "pptx", "doc", "xls", "ppt"]) {
      expect(detectFormat(`f.${ext}`, ZIP)).toBe("office");
    }
  });
  it("classifies hwp (OLE) and hwpx (zip)", () => {
    expect(detectFormat("a.hwp", OLE)).toBe("hwp");
    expect(detectFormat("a.hwpx", ZIP)).toBe("hwp");
  });
  it("is case-insensitive", () => expect(detectFormat("A.HWP", OLE)).toBe("hwp"));
  it("throws on unsupported ext", () => expect(() => detectFormat("a.png", Buffer.alloc(8))).toThrow(/unsupported/i));
  it("throws on misnamed hwp", () => expect(() => detectFormat("a.hwp", ZIP)).toThrow(/signature/i));
});

describe("fileMeta", () => {
  it("returns extension + mime + format", () => {
    expect(fileMeta("Report.DOCX", ZIP)).toEqual({
      extension: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      format: "office",
    });
  });
});
```

**Step 2: Run → FAIL** (`Cannot find module`).
Run: `pnpm --filter @hwptopdf/api test -- src/detect/detectFormat.test.ts`

**Step 3: Implement**

```ts
import type { DocFormat } from "@hwptopdf/shared";

const OFFICE_EXTS = new Set(["docx","doc","xlsx","xls","pptx","ppt","odt","ods","odp","rtf"]);
const HWP_EXTS = new Set(["hwp","hwpx"]);
const OLE_MAGIC = Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);

const MIME: Record<string,string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation", rtf: "application/rtf",
  hwp: "application/x-hwp", hwpx: "application/hwp+zip",
};

export function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i + 1).toLowerCase();
}

export function detectFormat(filename: string, head: Buffer): DocFormat {
  const ext = extOf(filename);
  if (HWP_EXTS.has(ext)) {
    if (ext === "hwp" && !head.subarray(0, 8).equals(OLE_MAGIC))
      throw new Error(`Invalid HWP signature for "${filename}" (expected OLE compound file)`);
    return "hwp";
  }
  if (OFFICE_EXTS.has(ext)) return "office";
  throw new Error(`Unsupported file extension ".${ext}" for "${filename}"`);
}

export function fileMeta(filename: string, head: Buffer) {
  const extension = extOf(filename);
  const format = detectFormat(filename, head);
  return { extension, mimeType: MIME[extension] ?? "application/octet-stream", format };
}
```

**Step 4: Run → PASS.** **Step 5: Commit** `feat(detect): classify uploads + derive file metadata`.

---

## Task 2: Converter contract

**Files:** Create `apps/api/src/convert/types.ts`; Test `apps/api/src/convert/types.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { ConversionError, type Converter } from "./types.js";

describe("converter contract", () => {
  it("ConversionError carries engine + cause", () => {
    const e = new ConversionError("gotenberg", "boom", new Error("x"));
    expect(e.engine).toBe("gotenberg");
    expect(e.message).toMatch(/boom/);
  });
  it("implements Converter", async () => {
    const c: Converter = { name: "f", async convert(i){ return Buffer.concat([Buffer.from("P:"), i.data]); } };
    expect((await c.convert({ filename:"a.docx", data: Buffer.from("x") })).toString()).toBe("P:x");
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

```ts
export interface ConvertInput { filename: string; data: Buffer; }
export interface Converter { readonly name: string; convert(input: ConvertInput): Promise<Buffer>; }
export type FetchFn = typeof fetch;
export class ConversionError extends Error {
  constructor(public readonly engine: string, message: string, public readonly cause?: unknown) {
    super(`[${engine}] ${message}`); this.name = "ConversionError";
  }
}
```

**Step 4: Run → PASS.** **Step 5: Commit** `feat(convert): Converter interface + ConversionError`.

---

## Task 3: Gotenberg adapter (Office → PDF)

**Files:** Create `apps/api/src/convert/engines/gotenberg.ts`; Test `…/gotenberg.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { GotenbergConverter } from "./gotenberg.js";
import { ConversionError, type FetchFn } from "../types.js";

describe("GotenbergConverter", () => {
  it("POSTs to /forms/libreoffice/convert and returns bytes", async () => {
    const f = vi.fn<FetchFn>(async () => new Response(Buffer.from("PDF"), { status: 200 }));
    const c = new GotenbergConverter("http://g:3000", f);
    expect((await c.convert({ filename:"r.docx", data: Buffer.from("d") })).toString()).toBe("PDF");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("http://g:3000/forms/libreoffice/convert");
    expect((init!.body as FormData).get("files")).toBeInstanceOf(File);
  });
  it("wraps non-200 in ConversionError", async () => {
    const f = vi.fn<FetchFn>(async () => new Response("no", { status: 500 }));
    await expect(new GotenbergConverter("http://g", f).convert({ filename:"r.docx", data: Buffer.from("x") }))
      .rejects.toBeInstanceOf(ConversionError);
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

```ts
import { ConversionError, type Converter, type ConvertInput, type FetchFn } from "../types.js";
export class GotenbergConverter implements Converter {
  readonly name = "gotenberg";
  constructor(private readonly baseUrl: string, private readonly fetchFn: FetchFn = fetch) {}
  async convert({ filename, data }: ConvertInput): Promise<Buffer> {
    const form = new FormData();
    form.append("files", new File([data], filename));
    const url = `${this.baseUrl}/forms/libreoffice/convert`;
    let res: Response;
    try { res = await this.fetchFn(url, { method: "POST", body: form }); }
    catch (cause) { throw new ConversionError(this.name, `request to ${url} failed`, cause); }
    if (!res.ok) throw new ConversionError(this.name, `backend ${res.status}: ${(await res.text().catch(()=>"")).slice(0,200)}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
```

**Step 4: Run → PASS.** **Step 5: Commit** `feat(convert): Gotenberg office adapter`.

---

## Task 4: H2Orestart adapter (HWP/HWPX → PDF)

Mirror of Task 3 against an HWP sidecar `POST /convert` (field `file`).

**Files:** Create `apps/api/src/convert/engines/h2orestart.ts`; Test `…/h2orestart.test.ts`

**Step 1: Failing test** — same shape as Gotenberg’s but URL `http://hwp:8080/convert`, field `file`, asserting PDF bytes returned and a 422 → `ConversionError`.

**Step 2: Run → FAIL. Step 3: Implement** (copy Task 3, change `name="h2orestart"`, url suffix `/convert`, field `file`). **Step 4: PASS. Step 5: Commit** `feat(convert): H2Orestart HWP adapter`.

---

## Task 5: Commercial seams (Hancom, Aspose) — config-gated

**Files:** Create `apps/api/src/convert/engines/hancom.ts`, `…/aspose.ts`; Test `…/commercial.test.ts`

Same content as the prior plan: each implements `Converter`; unconfigured instances throw `ConversionError(engine, "not configured — set …")`; a real contract test is `it.skip` unless `HANCOM_BASE_URL`/`HANCOM_API_KEY` (resp. `ASPOSE_*`) are set.

- `HancomConfig { baseUrl; apiKey }` → POST multipart `file` with `Authorization: Bearer <key>` to `${baseUrl}/v1/convert/pdf`.
- `AsposeConfig { baseUrl; clientId; clientSecret }` → guarded; real OAuth + Words/Cells/Slides endpoint left behind the config guard (throws "not yet wired" when configured but unimplemented).

**Steps:** failing test → FAIL → implement both → PASS (skipped contract tests) → **Commit** `feat(convert): commercial Hancom/Aspose seams (gated)`.

---

## Task 6: Converter registry (commercial-first, free-fallback)

**Files:** Create `apps/api/src/convert/registry.ts`; Test `…/registry.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildRegistry, type EngineConfig } from "./registry.js";

describe("buildRegistry", () => {
  const base: EngineConfig = { gotenbergUrl: "http://g", hwpSidecarUrl: "http://h" };
  it("defaults office->gotenberg, hwp->h2orestart", () => {
    const r = buildRegistry(base);
    expect(r.forFormat("office").name).toBe("gotenberg");
    expect(r.forFormat("hwp").name).toBe("h2orestart");
  });
  it("prefers commercial when configured", () => {
    const r = buildRegistry({ ...base, hancom:{baseUrl:"h",apiKey:"k"}, aspose:{baseUrl:"a",clientId:"c",clientSecret:"s"} });
    expect(r.forFormat("hwp").name).toBe("hancom");
    expect(r.forFormat("office").name).toBe("aspose");
  });
  it("accepts overrides for tests", () => {
    const fake = { name:"FAKE", async convert(){ return Buffer.from("x"); } };
    expect(buildRegistry(base, { office: fake }).forFormat("office").name).toBe("FAKE");
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** — same as prior plan: `EngineConfig { gotenbergUrl; hwpSidecarUrl; hancom?; aspose? }`, `buildRegistry(cfg, overrides?)` builds `office = overrides.office ?? (cfg.aspose ? Aspose : Gotenberg)` and `hwp = overrides.hwp ?? (cfg.hancom ? Hancom : H2Orestart)`, returns `{ forFormat }`.

**Step 4: PASS. Step 5: Commit** `feat(convert): format→engine registry with commercial-first fallback`.

---

## Task 7: Config loader (env → EngineConfig + app config)

**Files:** Create `apps/api/src/config.ts`; Test `…/config.test.ts`

**Step 1: Failing test** asserts: defaults `gotenbergUrl=http://localhost:3000`, `hwpSidecarUrl=http://localhost:8080`; commercial blocks present only when *all* their env vars are set; plus `loadAppConfig` returns `{ engines, s3:{ endpoint, bucket, accessKey, secretKey }, auth:{ googleId, googleSecret, secret }, webOrigin }` with sensible defaults and required-secret validation (throws if `AUTH_SECRET` missing in production mode).

**Step 2: Run → FAIL.**

**Step 3: Implement** `loadEngineConfig(env)` (as prior plan) and `loadAppConfig(env)` composing engines + S3 + auth + `webOrigin` (default `http://localhost:5173`).

**Step 4: PASS. Step 5: Commit** `feat(config): load engine + app config from env`.

---

# PHASE B — Persistence & storage

## Task 8: Prisma schema (User/Account/Session/ConversionJob) + SQLite

**Files:** Create `apps/api/prisma/schema.prisma`, `apps/api/src/db.ts`; Test `apps/api/src/db.test.ts`

**Step 1: Write `schema.prisma`** (Auth.js-compatible models + our job table)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "sqlite"; url = env("DATABASE_URL") }

model User {
  id            String          @id @default(cuid())
  name          String?
  email         String?         @unique
  emailVerified DateTime?
  image         String?
  accounts      Account[]
  sessions      Session[]
  jobs          ConversionJob[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime
  @@unique([identifier, token])
}

model ConversionJob {
  id          String   @id @default(cuid())
  userId      String
  filename    String
  format      String   // "office" | "hwp"
  extension   String
  mimeType    String
  sizeBytes   Int
  status      String   @default("pending") // pending | success | failed
  engine      String?
  durationMs  Int?
  error       String?
  sourceKey   String   // S3 key of original upload
  outputKey   String?  // S3 key of result PDF
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
}
```

**Step 2: Generate client + create the initial migration**

```bash
cd apps/api
DATABASE_URL="file:./prisma/dev.db" pnpm prisma migrate dev --name init
```
Expected: `prisma/migrations/*/migration.sql` created, client generated.

**Step 3: Write `src/db.ts`** (singleton + test-db helper)

```ts
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
export function makePrisma(url: string) { return new PrismaClient({ datasources: { db: { url } } }); }
```

**Step 4: Failing test** `db.test.ts` — spins a temp SQLite file, runs `prisma migrate deploy` (or `db push`) against it, creates a user + job, reads it back.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePrisma } from "./db.js";

let dir: string, url: string, prisma: ReturnType<typeof makePrisma>;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hwp-db-"));
  url = `file:${join(dir, "t.db")}`;
  execSync("pnpm prisma db push --skip-generate", { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url } });
  prisma = makePrisma(url);
});
afterAll(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

describe("schema", () => {
  it("persists a user and a conversion job", async () => {
    const u = await prisma.user.create({ data: { email: "a@b.c" } });
    const j = await prisma.conversionJob.create({
      data: { userId: u.id, filename: "a.docx", format: "office", extension: "docx",
              mimeType: "application/...", sizeBytes: 10, sourceKey: "src/a" },
    });
    expect(j.status).toBe("pending");
    expect((await prisma.conversionJob.findMany({ where: { userId: u.id } })).length).toBe(1);
  });
});
```

**Step 5: Run → PASS** (`pnpm --filter @hwptopdf/api test -- src/db.test.ts`).
**Step 6: Commit** `feat(db): prisma schema for auth + conversion jobs (sqlite)`.

---

## Task 9: Job service (create/markSuccess/markFailed/list/stats)

Pure data-access layer over Prisma, takes a `PrismaClient` so tests use a temp DB. This is where **success rate** and **file properties** aggregation live.

**Files:** Create `apps/api/src/jobs/jobService.ts`; Test `…/jobService.test.ts`

**Step 1: Failing test** (reuse the temp-DB harness from Task 8)

```ts
// after creating prisma against a temp db + a user `u`:
import { JobService } from "./jobService.js";

const svc = new JobService(prisma);

it("creates a pending job and lists it as a DTO", async () => {
  const job = await svc.create(u.id, { filename:"a.hwp", format:"hwp", extension:"hwp",
    mimeType:"application/x-hwp", sizeBytes: 123, sourceKey:"src/a" });
  expect(job.status).toBe("pending");
  const list = await svc.list(u.id, {});
  expect(list[0]).toMatchObject({ id: job.id, filename:"a.hwp", status:"pending" });
  expect(list[0]).not.toHaveProperty("sourceKey"); // DTO hides storage keys
});

it("marks success/failure and computes success rate", async () => {
  const a = await svc.create(u.id, baseInput("a.docx"));
  const b = await svc.create(u.id, baseInput("b.docx"));
  await svc.markSuccess(a.id, { engine:"gotenberg", durationMs: 900, outputKey:"out/a" });
  await svc.markFailed(b.id, { engine:"gotenberg", durationMs: 200, error:"backend 500" });
  const stats = await svc.stats(u.id);
  expect(stats).toMatchObject({ total:2, success:1, failed:1, pending:0 });
  expect(stats.successRate).toBeCloseTo(0.5);
});

it("filters list by status", async () => {
  expect((await svc.list(u.id, { status:"failed" })).every(j => j.status === "failed")).toBe(true);
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

```ts
import type { PrismaClient } from "@prisma/client";
import type { JobDTO, JobStatus, StatsDTO, DocFormat } from "@hwptopdf/shared";

export interface CreateInput {
  filename: string; format: DocFormat; extension: string;
  mimeType: string; sizeBytes: number; sourceKey: string;
}

function toDTO(j: any): JobDTO {
  return {
    id: j.id, filename: j.filename, format: j.format as DocFormat, extension: j.extension,
    mimeType: j.mimeType, sizeBytes: j.sizeBytes, status: j.status as JobStatus,
    engine: j.engine ?? null, durationMs: j.durationMs ?? null, error: j.error ?? null,
    createdAt: j.createdAt.toISOString(),
  };
}

export class JobService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, input: CreateInput): Promise<JobDTO> {
    return toDTO(await this.prisma.conversionJob.create({ data: { userId, ...input } }));
  }
  async markSuccess(id: string, p: { engine: string; durationMs: number; outputKey: string }) {
    return toDTO(await this.prisma.conversionJob.update({ where: { id }, data: { status: "success", ...p } }));
  }
  async markFailed(id: string, p: { engine: string; durationMs: number; error: string }) {
    return toDTO(await this.prisma.conversionJob.update({ where: { id }, data: { status: "failed", ...p } }));
  }
  async get(userId: string, id: string): Promise<JobDTO | null> {
    const j = await this.prisma.conversionJob.findFirst({ where: { id, userId } });
    return j ? toDTO(j) : null;
  }
  /** Internal: includes storage keys for download/convert flows. */
  async getRaw(userId: string, id: string) {
    return this.prisma.conversionJob.findFirst({ where: { id, userId } });
  }
  async list(userId: string, opts: { status?: JobStatus; take?: number }): Promise<JobDTO[]> {
    const rows = await this.prisma.conversionJob.findMany({
      where: { userId, ...(opts.status ? { status: opts.status } : {}) },
      orderBy: { createdAt: "desc" }, take: opts.take ?? 100,
    });
    return rows.map(toDTO);
  }
  async stats(userId: string): Promise<StatsDTO> {
    const rows = await this.prisma.conversionJob.groupBy({ by: ["status"], where: { userId }, _count: true });
    const c = (s: string) => rows.find((r) => r.status === s)?._count ?? 0;
    const success = c("success"), failed = c("failed"), pending = c("pending");
    const total = success + failed + pending;
    return { total, success, failed, pending, successRate: success + failed ? success / (success + failed) : 0 };
  }
}
```

**Step 4: Run → PASS. Step 5: Commit** `feat(jobs): job service with status transitions, listing, success-rate stats`.

---

## Task 10: S3/MinIO storage adapter

**Files:** Create `apps/api/src/storage/s3.ts`; Test `…/s3.test.ts`

**Step 1: Failing test** — inject a fake S3 client (object with `send`) to assert `put`/`get`/`presraw` build correct commands; plus a gated real-MinIO round-trip behind `RUN_INTEGRATION=1`.

```ts
import { describe, it, expect, vi } from "vitest";
import { S3Storage } from "./s3.js";

describe("S3Storage", () => {
  it("put sends PutObject with key+body, get returns bytes", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({}) // put
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([1,2,3]) } }); // get
    const s = new S3Storage({ send } as any, "bucket");
    await s.put("k1", Buffer.from("hi"), "application/pdf");
    expect(send).toHaveBeenCalledTimes(1);
    const got = await s.get("k1");
    expect(Buffer.from(got)).toEqual(Buffer.from([1,2,3]));
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

```ts
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

export class S3Storage {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return (res.Body as any).transformToByteArray();
  }
}

export function makeS3Client(cfg: { endpoint: string; accessKey: string; secretKey: string; region?: string }) {
  // forcePathStyle is required for MinIO.
  return new (require("@aws-sdk/client-s3").S3Client)({
    endpoint: cfg.endpoint, region: cfg.region ?? "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
}
```

> Replace the `require` with a top-level `import { S3Client }` and `new S3Client(...)`; shown inline only to keep the snippet local. Use the ESM import in the real file.

**Step 4: Run → PASS. Step 5: Commit** `feat(storage): S3/MinIO storage adapter`.

---

# PHASE C — Auth (Google via Auth.js, bridged into Fastify)

## Task 11: Auth.js core + Prisma adapter + Fastify bridge + requireUser guard

Auth.js has no first-class Fastify package, so we bridge `@auth/core`’s `Auth(request, config)` (which takes/returns a Web `Request`/`Response`) through Fastify, and expose a `getSessionUser(req)` guard.

**Files:** Create `apps/api/src/auth/authConfig.ts`, `apps/api/src/auth/plugin.ts`; Test `apps/api/src/auth/plugin.test.ts`

**Step 1: Failing test** (assert the bridge mounts `/api/auth/*` and an unauthenticated `requireUser` returns 401)

```ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { authPlugin } from "./plugin.js";

function appWith() {
  const app = Fastify();
  app.register(authPlugin, { config: {
    secret: "test-secret", providers: [], adapter: undefined as any, // minimal for routing test
  }});
  app.get("/me", async (req, reply) => {
    const user = await app.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    return { user };
  });
  return app;
}

describe("authPlugin", () => {
  it("rejects protected route without a session", async () => {
    const app = appWith();
    const res = await app.inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
  });
  it("exposes the auth handler under /api/auth", async () => {
    const app = appWith();
    const res = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect([200, 302, 400]).toContain(res.statusCode); // handler responded (not 404)
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

`apps/api/src/auth/authConfig.ts`:

```ts
import Google from "@auth/core/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import type { AuthConfig } from "@auth/core";

export function buildAuthConfig(opts: {
  prisma: PrismaClient; googleId: string; googleSecret: string; secret: string;
}): AuthConfig {
  return {
    secret: opts.secret,
    trustHost: true,
    adapter: PrismaAdapter(opts.prisma),
    session: { strategy: "database" },
    providers: [Google({ clientId: opts.googleId, clientSecret: opts.googleSecret })],
  };
}
```

`apps/api/src/auth/plugin.ts`:

```ts
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { Auth, type AuthConfig } from "@auth/core";

declare module "fastify" {
  interface FastifyInstance {
    getSessionUser(req: FastifyRequest): Promise<{ id: string; email: string | null } | null>;
  }
}

function toWebRequest(req: FastifyRequest): Request {
  const url = `${req.protocol}://${req.headers.host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(",") : String(v));
  const method = req.method;
  const body = method === "GET" || method === "HEAD" ? undefined : JSON.stringify(req.body ?? {});
  return new Request(url, { method, headers, body });
}

export const authPlugin: FastifyPluginAsync<{ config: AuthConfig }> = async (app, { config }) => {
  // Mount Auth.js for all /api/auth/* routes.
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (req, reply) => {
      const res = await Auth(toWebRequest(req), config);
      reply.code(res.status);
      res.headers.forEach((value, key) => reply.header(key, value));
      reply.send(res.body ? await res.text() : null);
    },
  });

  // Session guard: ask Auth.js for the current session via its /session endpoint.
  app.decorate("getSessionUser", async (req: FastifyRequest) => {
    const sessionReq = new Request(`${req.protocol}://${req.headers.host}/api/auth/session`, {
      headers: { cookie: req.headers.cookie ?? "" },
    });
    const res = await Auth(sessionReq, config);
    if (res.status !== 200) return null;
    const data = (await res.json().catch(() => null)) as any;
    if (!data?.user) return null;
    return { id: data.user.id ?? data.user.email, email: data.user.email ?? null };
  });
};
```

> Note for the executor: the routing/401 behavior is unit-tested here; the **full Google sign-in round-trip is exercised in the gated e2e (Task 22)** with real `GOOGLE_CLIENT_ID/SECRET`, since it needs Google’s OAuth servers. Do not fake a successful Google login in unit tests.

**Step 4: Run → PASS. Step 5: Commit** `feat(auth): Auth.js Google provider + Prisma adapter bridged into Fastify`.

---

# PHASE D — API endpoints

## Task 12: `POST /api/convert` (auth → store → convert → store → record)

**Files:** Create `apps/api/src/app.ts` (app factory), `apps/api/src/routes/convert.ts`; Test `apps/api/src/routes/convert.test.ts`

**Step 1: Failing test** — build the app with a fake registry, fake storage, real temp-DB JobService, and a stubbed `getSessionUser` returning a fixed user; assert a DOCX upload returns the created job JSON with `status:"success"`, that storage `put` was called twice (source + output), and that a failing engine yields `status:"failed"` (still HTTP 201 — the *job* is recorded; conversion failure is a job outcome, not an API error).

```ts
// pseudo-shape of the key assertions
const res = await uploadDocx(app, "r.docx");
expect(res.statusCode).toBe(201);
expect(res.json()).toMatchObject({ filename: "r.docx", status: "success", engine: "gotenberg" });
expect(storage.put).toHaveBeenCalledTimes(2);

const failRes = await uploadDocx(appWithFailingEngine, "r.docx");
expect(failRes.json()).toMatchObject({ status: "failed", error: expect.stringMatching(/backend/) });
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `app.ts` exposing `buildApp(deps)` where `deps = { registry, storage, jobs, getSessionUser }` (so tests inject fakes), and `routes/convert.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { detectFormat, fileMeta } from "../detect/detectFormat.js";
import { ConversionError } from "../convert/types.js";
import type { AppDeps } from "../app.js";

export function registerConvert(app: FastifyInstance, deps: AppDeps) {
  app.post("/api/convert", async (req, reply) => {
    const user = await deps.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "field 'file' required" });
    const data = await file.toBuffer();

    let meta;
    try { meta = fileMeta(file.filename, data.subarray(0, 8)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }

    const sourceKey = `${user.id}/src/${Date.now()}-${file.filename}`;
    await deps.storage.put(sourceKey, data, meta.mimeType);
    const job = await deps.jobs.create(user.id, {
      filename: file.filename, format: meta.format, extension: meta.extension,
      mimeType: meta.mimeType, sizeBytes: data.length, sourceKey,
    });

    const engine = deps.registry.forFormat(meta.format);
    const started = Date.now();
    try {
      const pdf = await engine.convert({ filename: file.filename, data });
      const outputKey = `${user.id}/out/${job.id}.pdf`;
      await deps.storage.put(outputKey, pdf, "application/pdf");
      const done = await deps.jobs.markSuccess(job.id, { engine: engine.name, durationMs: Date.now() - started, outputKey });
      return reply.code(201).send(done);
    } catch (err) {
      const msg = err instanceof ConversionError ? err.message : (err as Error).message;
      const failed = await deps.jobs.markFailed(job.id, { engine: engine.name, durationMs: Date.now() - started, error: msg });
      return reply.code(201).send(failed);
    }
  });
}
```

**Step 4: Run → PASS. Step 5: Commit** `feat(api): POST /api/convert with storage + job recording`.

---

## Task 13: Jobs list / detail / download

**Files:** Create `apps/api/src/routes/jobs.ts`; Test `…/jobs.test.ts`

**Step 1: Failing test** (fake user + temp-DB JobService + fake storage):
- `GET /api/jobs` → user’s jobs, newest first.
- `GET /api/jobs?status=failed` → only failed (the **fail-case view** feed).
- `GET /api/jobs/:id` → DTO, 404 for another user’s job.
- `GET /api/jobs/:id/download` → `application/pdf` from storage when `outputKey` set; 409 when job not successful.

**Step 2: Run → FAIL.**

**Step 3: Implement**

```ts
import type { FastifyInstance } from "fastify";
import type { JobStatus } from "@hwptopdf/shared";
import type { AppDeps } from "../app.js";

export function registerJobs(app: FastifyInstance, deps: AppDeps) {
  const auth = async (req: any, reply: any) => {
    const user = await deps.getSessionUser(req);
    if (!user) { reply.code(401).send({ error: "unauthenticated" }); return null; }
    return user;
  };

  app.get("/api/jobs", async (req, reply) => {
    const user = await auth(req, reply); if (!user) return;
    const status = (req.query as any).status as JobStatus | undefined;
    return deps.jobs.list(user.id, { status });
  });

  app.get("/api/jobs/:id", async (req, reply) => {
    const user = await auth(req, reply); if (!user) return;
    const job = await deps.jobs.get(user.id, (req.params as any).id);
    if (!job) return reply.code(404).send({ error: "not found" });
    return job;
  });

  app.get("/api/jobs/:id/download", async (req, reply) => {
    const user = await auth(req, reply); if (!user) return;
    const raw = await deps.jobs.getRaw(user.id, (req.params as any).id);
    if (!raw) return reply.code(404).send({ error: "not found" });
    if (raw.status !== "success" || !raw.outputKey) return reply.code(409).send({ error: "not converted" });
    const bytes = await deps.storage.get(raw.outputKey);
    return reply.header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${raw.filename.replace(/\.[^.]+$/, "")}.pdf"`)
      .send(Buffer.from(bytes));
  });
}
```

**Step 4: Run → PASS. Step 5: Commit** `feat(api): jobs list/detail/download with status filter`.

---

## Task 14: `GET /api/stats` (dashboard aggregates)

**Files:** Create `apps/api/src/routes/stats.ts`; Test `…/stats.test.ts`

**Step 1: Failing test** — seed 3 success + 1 failed for the user, assert `GET /api/stats` → `{ total:4, success:3, failed:1, pending:0, successRate: 0.75 }`; 401 unauthenticated.

**Step 2: Run → FAIL.**

**Step 3: Implement** a route delegating to `deps.jobs.stats(user.id)`. Then wire `registerConvert/registerJobs/registerStats` + `authPlugin` + `@fastify/multipart` + `@fastify/cookie` into `buildApp`, and create `src/server.ts` that constructs real deps from `loadAppConfig(process.env)` (Prisma, S3 client, registry, auth config) and listens on `PORT`.

**Step 4: Run the whole API suite + typecheck**

Run: `pnpm --filter @hwptopdf/api test`  → all green.
Run: `pnpm --filter @hwptopdf/api typecheck` → exit 0.

**Step 5: Commit** `feat(api): stats endpoint + server wiring`.

---

# PHASE E — Frontend (React + Vite dashboard)

## Task 15: Web app scaffold (Vite + React + TS + Vitest + RTL)

**Files:** Create `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html,src/main.tsx,src/App.tsx,src/api/client.ts,src/test/setup.ts}`

**Step 1: `apps/web/package.json`**

```json
{
  "name": "@hwptopdf/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@hwptopdf/shared": "workspace:*",
    "@tanstack/react-query": "^5.62.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "recharts": "^2.13.3"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.3",
    "vitest": "^2.1.6"
  }
}
```

**Step 2:** `vite.config.ts` (with `server.proxy` `/api → http://localhost:8000`), `vitest` config (`environment: "jsdom"`, `setupFiles: ["src/test/setup.ts"]`), `tsconfig.json` (jsx `react-jsx`, DOM lib), `index.html`, `src/test/setup.ts` importing `@testing-library/jest-dom`.

**Step 3:** `src/api/client.ts` — typed fetch helpers (`listJobs`, `getJob`, `getStats`, `uploadFile`, download URL) hitting `/api/*`, returning the shared DTO types.

**Step 4: Sanity test** `src/App.test.tsx` rendering `<App/>` inside providers and asserting the app shell renders (e.g. brand text). Run `pnpm --filter @hwptopdf/web test` → PASS.

**Step 5: Commit** `chore(web): scaffold Vite + React + RTL + query client`.

---

## Task 16: Login screen (Google sign-in)

**Files:** Create `apps/web/src/auth/useSession.ts`, `apps/web/src/pages/Login.tsx`; Test `…/Login.test.tsx`

**Step 1: Failing test** — render `<Login/>`; assert a “Sign in with Google” button whose link points at `/api/auth/signin/google` (Auth.js sign-in endpoint). `useSession` reads `/api/auth/session`; when unauthenticated the app shows Login, when authenticated it shows the dashboard (test the hook with a mocked fetch).

**Step 2: Run → FAIL.**

**Step 3: Implement** `useSession` (TanStack Query against `/api/auth/session`) and `Login.tsx` (centered card, Google button = `<a href="/api/auth/signin/google">`). Add a `RequireAuth` wrapper that redirects to `/login` when `useSession` is unauthenticated.

**Step 4: Run → PASS. Step 5: Commit** `feat(web): Google login screen + session hook`.

---

## Task 17: Upload page (drag-and-drop multi-format)

**Files:** Create `apps/web/src/pages/Upload.tsx`, `apps/web/src/components/Dropzone.tsx`; Test `…/Upload.test.tsx`

**Step 1: Failing test** — render `<Upload/>`; simulate selecting an `r.docx` file; mock `uploadFile` to resolve a `success` job; assert a success toast/row appears and the accepted-types hint lists `hwp, hwpx, docx, xlsx, pptx`. Simulate a `failed` job response → assert the failure reason is shown with a “View” link to `/jobs/:id`.

**Step 2: Run → FAIL.**

**Step 3: Implement** `Dropzone` (input + drag handlers, `accept=".hwp,.hwpx,.docx,.doc,.xlsx,.xls,.pptx,.ppt"`) and `Upload.tsx` (calls `uploadFile`, on success invalidates the `jobs`/`stats` queries, shows result inline with status pill).

**Step 4: Run → PASS. Step 5: Commit** `feat(web): upload page with drag-and-drop and result feedback`.

---

## Task 18: Jobs list with success/fail views

**Files:** Create `apps/web/src/pages/Jobs.tsx`, `apps/web/src/components/StatusPill.tsx`, `apps/web/src/components/JobsTable.tsx`; Test `…/Jobs.test.tsx`

**Step 1: Failing test** — mock `listJobs` to return mixed statuses; assert the table shows **file name, date, properties (ext · size), status**; clicking the **“실패”** filter calls `listJobs({status:"failed"})` and renders only failed rows; each row links to `/jobs/:id`.

**Step 2: Run → FAIL.**

**Step 3: Implement** filter tabs (전체 / 성공 / 실패) driving the query key, `JobsTable` (columns: 파일명, 날짜, 형식, 크기, 엔진, 상태), `StatusPill` (green/red/grey), human-readable size + locale date formatting.

**Step 4: Run → PASS. Step 5: Commit** `feat(web): jobs list with status filter tabs and properties columns`.

---

## Task 19: Job detail / case view

**Files:** Create `apps/web/src/pages/JobDetail.tsx`; Test `…/JobDetail.test.tsx`

**Step 1: Failing test** — mock `getJob`:
- success job → shows all properties + a **Download PDF** button linking to `/api/jobs/:id/download`.
- failed job → shows the **error reason** prominently and **no** download button.

**Step 2: Run → FAIL.**

**Step 3: Implement** a property grid (파일명, 형식, 확장자, MIME, 크기, 생성일, 엔진, 변환 소요시간) + conditional Download / error panel.

**Step 4: Run → PASS. Step 5: Commit** `feat(web): job detail view with download and failure reason`.

---

## Task 20: Dashboard (stats cards + success-rate chart + recent files)

**Files:** Create `apps/web/src/pages/Dashboard.tsx`, `apps/web/src/components/StatCard.tsx`, `apps/web/src/components/SuccessRateChart.tsx`; Test `…/Dashboard.test.tsx`

**Step 1: Failing test** — mock `getStats` → `{ total:10, success:8, failed:2, successRate:0.8 }` and `listJobs` → recent rows; assert cards show **총 변환수 10**, **성공률 80%**, **실패 2**, that a chart renders (mock Recharts `ResponsiveContainer`), and a **최근 파일** table lists name + date + status.

**Step 2: Run → FAIL.**

**Step 3: Implement** `StatCard`, `SuccessRateChart` (pie/donut success vs fail via Recharts), `Dashboard.tsx` composing cards + chart + recent-files table (reusing `JobsTable` with `take: 5`).

**Step 4: Run web suite + typecheck**

Run: `pnpm --filter @hwptopdf/web test` → all green.
Run: `pnpm --filter @hwptopdf/web typecheck` → exit 0.

**Step 5: Commit** `feat(web): dashboard with stats cards, success-rate chart, recent files`.

---

# PHASE F — Infra, e2e, docs

## Task 21: Docker Compose (web + api + gotenberg + hwp-sidecar + minio)

**Files:** Create `apps/api/Dockerfile`, `apps/web/Dockerfile` (nginx serving the Vite build + proxy `/api`), `hwp-sidecar/{Dockerfile,app.py}`, `docker-compose.yml`, `.env.example`

**Step 1:** `hwp-sidecar` = `debian:bookworm-slim` + `libreoffice libreoffice-h2orestart fonts-nanum fonts-noto-cjk` + a tiny Flask `POST /convert` that runs `soffice --headless --convert-to pdf` (identical to the prior plan) with `ENV HOME=/tmp`.

**Step 2:** `apps/api/Dockerfile` = multi-stage Node build that also runs `prisma generate` and ships `prisma/`; entrypoint runs `prisma migrate deploy` then `node dist/server.js`.

**Step 3:** `docker-compose.yml`:

```yaml
services:
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment: { MINIO_ROOT_USER: minio, MINIO_ROOT_PASSWORD: minio12345 }
    ports: ["9000:9000", "9001:9001"]
    volumes: ["minio-data:/data"]
  createbucket:
    image: minio/mc
    depends_on: [minio]
    entrypoint: >
      /bin/sh -c "until mc alias set m http://minio:9000 minio minio12345; do sleep 1; done;
      mc mb -p m/hwptopdf; mc anonymous set none m/hwptopdf; exit 0;"
  gotenberg:
    image: gotenberg/gotenberg:8
    command: ["gotenberg","--api-timeout=120s"]
    ports: ["3000:3000"]
  hwp-sidecar:
    build: ./hwp-sidecar
    ports: ["8080:8080"]
  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    environment:
      DATABASE_URL: file:/data/app.db
      GOTENBERG_URL: http://gotenberg:3000
      HWP_SIDECAR_URL: http://hwp-sidecar:8080
      S3_ENDPOINT: http://minio:9000
      S3_BUCKET: hwptopdf
      S3_ACCESS_KEY: minio
      S3_SECRET_KEY: minio12345
      AUTH_SECRET: ${AUTH_SECRET}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      WEB_ORIGIN: http://localhost:8081
      PORT: "8000"
    volumes: ["api-data:/data"]
    ports: ["8000:8000"]
    depends_on: [gotenberg, hwp-sidecar, minio, createbucket]
  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    ports: ["8081:80"]
    depends_on: [api]
volumes: { minio-data: {}, api-data: {} }
```

**Step 4:** `.env.example` documenting `AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, and optional `HANCOM_*` / `ASPOSE_*`.

**Step 5: Bring it up + smoke test**

```bash
cp .env.example .env   # fill in Google creds
docker compose up -d --build
curl -sf http://localhost:8000/health
curl -sf http://localhost:8081
```
Expected: API health ok; web served.

**Step 6: Commit** `feat(infra): docker-compose stack (web, api, gotenberg, hwp-sidecar, minio)`.

---

## Task 22: Gated end-to-end + README + final verification

**Files:** Create `e2e/convert.e2e.test.ts` (Playwright, `@playwright/test`), `README.md`

**Step 1: Failing/gated e2e** (skipped unless `RUN_E2E=1`): with the compose stack up and real Google creds, drive the browser: sign in → upload a fixture `min.docx` → see a success row → open detail → download → assert `%PDF`; upload a deliberately broken file → see a failed row with a reason. (Document that Google login in CI needs a test account or a mocked provider; default local run uses a real account.)

**Step 2: Run gated test both ways**

Run (default): `pnpm -r test` → e2e suite skipped; all unit/integration green.
Run (real): `RUN_E2E=1 pnpm --filter e2e test` against the running stack → passes.

**Step 3: Write `README.md`** — overview; supported formats (hwp, hwpx, docx, xlsx, pptx, …); engine matrix (Office→Gotenberg/Aspose, HWP→H2Orestart/Hancom) and **commercial-first env vars**; architecture diagram (web ↔ api ↔ {gotenberg, hwp-sidecar, minio, sqlite}); Google OAuth setup (redirect URI `http://localhost:8000/api/auth/callback/google`); local dev (`pnpm -r dev` style) and `docker compose up`; the API contract (`/api/convert`, `/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/download`, `/api/stats`, `/api/auth/*`); and **fidelity caveats** (LibreOffice/H2Orestart lose ~10–20% on complex HWP; license Hancom SDK for fidelity-grade HWP; HWP v3 unsupported by H2Orestart). Add a **Future Work** section → next plan: 1,000+ batch (queue, warm worker pool, process recycling, autoscale), HWP→HWPX normalization, observability, presigned-URL direct uploads.

**Step 4: Full verification pass**

Run: `pnpm -r test` → all green (gated suites skipped).
Run: `pnpm -r typecheck` → exit 0.
Run: `pnpm -r build` → all packages build.
Run: `node /Users/young/Downloads/personal_project/scripts/node-policy-check.mjs` → passes.

**Step 5: Commit** `docs: README with setup, API contract, and fidelity caveats; add gated e2e`.

---

## Out of scope for this MVP (next plan)

- **1,000+ batch pipeline:** job queue, warm LibreOffice/unoserver worker pool, `maxTasksPerProcess` recycling, per-job timeouts, idempotent retries, horizontal autoscaling (Gotenberg replicas / HPA).
- **Fidelity benchmarking harness** on a real corpus (no public cross-engine benchmark exists — measure your own).
- **HWP→HWPX normalization** pre-step (HWPX = open KS X 6101 standard, KR-gov-mandated from Oct 2026).
- **Presigned direct-to-S3 uploads**, rate limiting, multi-tenant org accounts, observability (metrics/tracing), Postgres migration from SQLite.

---

## Dependency-aware task ordering

```
Task 0 (monorepo)
 ├─ A: 1 detect → 2 types → {3 gotenberg, 4 h2orestart, 5 commercial} → 6 registry → 7 config
 ├─ B: 8 prisma schema → 9 job service ; 10 storage  (8 & 10 independent after 0)
 ├─ C: 11 auth        (needs 8)
 ├─ D: 12 convert (needs 6,7,9,10,11) → 13 jobs → 14 stats (+ server wiring)
 ├─ E: 15 web scaffold → 16 login → 17 upload → 18 jobs list → 19 detail → 20 dashboard
 └─ F: 21 docker (needs D+E) → 22 e2e + README
```

Within Phase A, Tasks 3/4/5 are independent (parallelizable by subagents). Phase E pages 17–20 each depend on 15/16 but are otherwise independent.
```
