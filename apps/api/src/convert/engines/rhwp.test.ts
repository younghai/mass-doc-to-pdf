import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConversionError } from "../types.js";
import { RhwpCliConverter, RhwpConverter } from "./rhwp.js";

async function fakeRhwpCli(dir: string): Promise<{ readonly cliPath: string; readonly logPath: string }> {
  const cliPath = join(dir, "rhwp");
  const logPath = join(dir, "rhwp.log");
  await writeFile(
    cliPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" > ${JSON.stringify(logPath)}
if [ -e "$PWD/ttfs/hwp/0-fonts" ]; then printf 'font-linked\\n' >> ${JSON.stringify(logPath)}; fi
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift 2; continue; fi
  shift
done
printf '%s' '%PDF-fake-rhwp' > "$out"
`,
  );
  await chmod(cliPath, 0o755);
  return { cliPath, logPath };
}

async function fakeRhwpCliWithOverflow(dir: string): Promise<string> {
  const cliPath = join(dir, "rhwp-overflow");
  await writeFile(
    cliPath,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift 2; continue; fi
  shift
done
printf 'LAYOUT_OVERFLOW: page=1 para=1\\n' >&2
printf '%s' '%PDF-fake-rhwp' > "$out"
`,
  );
  await chmod(cliPath, 0o755);
  return cliPath;
}

async function fakeRhwpWorkerWithOverflow(dir: string): Promise<string> {
  const workerPath = join(dir, "rhwp-worker.py");
  await writeFile(
    workerPath,
    `import pathlib
import sys
pathlib.Path(sys.argv[2]).write_bytes(b"%PDF-fake-rhwp")
sys.stderr.write("LAYOUT_OVERFLOW: page=1 para=1\\n")
`,
  );
  return workerPath;
}

// Records what the worker observed (RHWP_FONT_PATHS env + cwd-relative ttfs/hwp
// link) so the test can assert font wiring after the run dir is torn down.
async function fakeRhwpWorkerProbe(
  dir: string,
): Promise<{ readonly workerScript: string; readonly logPath: string }> {
  const workerScript = join(dir, "rhwp-worker-probe.py");
  const logPath = join(dir, "probe.log");
  await writeFile(
    workerScript,
    `import json
import os
import pathlib
import sys
font_paths = os.environ.get("RHWP_FONT_PATHS", "")
link = os.path.isdir(os.path.join(os.getcwd(), "ttfs", "hwp"))
pathlib.Path(${JSON.stringify(logPath)}).write_text(
    json.dumps({"font_env": font_paths, "font_link": link})
)
pathlib.Path(sys.argv[2]).write_bytes(b"%PDF-fake-rhwp")
`,
  );
  return { workerScript, logPath };
}

describe("RhwpCliConverter", () => {
  it("runs rhwp export-pdf and returns PDF bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rhwp-cli-test-"));
    const fontDir = join(dir, "fonts");
    await mkdir(fontDir);
    const { cliPath, logPath } = await fakeRhwpCli(dir);
    const c = new RhwpCliConverter({
      enabled: true,
      cliPath,
      timeoutMs: 10_000,
      fontPaths: [fontDir],
      mode: "pdf",
    });

    const pdf = await c.convert({ filename: "sample.hwp", data: Buffer.from("hwp") });

    expect(pdf.toString()).toBe("%PDF-fake-rhwp");
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("export-pdf");
    expect(log).toContain("-o");
    expect(log).toContain("font-linked");
  });

  it("rejects disabled CLI renderer before launching", async () => {
    const c = new RhwpCliConverter({
      enabled: false,
      cliPath: "rhwp",
      timeoutMs: 10_000,
      fontPaths: [],
      mode: "pdf",
    });

    await expect(c.convert({ filename: "sample.hwp", data: Buffer.from("hwp") })).rejects.toThrow(
      ConversionError,
    );
  });

  it("rejects CLI output when rhwp reports layout overflow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rhwp-cli-test-"));
    const cliPath = await fakeRhwpCliWithOverflow(dir);
    const c = new RhwpCliConverter({
      enabled: true,
      cliPath,
      timeoutMs: 10_000,
      fontPaths: [],
      mode: "pdf",
    });

    await expect(c.convert({ filename: "sample.hwp", data: Buffer.from("hwp") })).rejects.toThrow(
      /layout overflow/,
    );
  });

  it("keeps raster mode gated until image-PDF composition is implemented", async () => {
    const c = new RhwpCliConverter({
      enabled: true,
      cliPath: "rhwp",
      timeoutMs: 10_000,
      fontPaths: [],
      mode: "raster",
    });

    await expect(c.convert({ filename: "sample.hwp", data: Buffer.from("hwp") })).rejects.toThrow(
      /raster PDF mode is not implemented/,
    );
  });
});

describe("RhwpConverter", () => {
  it("rejects Python worker output when rhwp reports layout overflow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rhwp-worker-test-"));
    const workerScript = await fakeRhwpWorkerWithOverflow(dir);
    const c = new RhwpConverter({
      enabled: true,
      pythonPath: "python3",
      workerScript,
      timeoutMs: 10_000,
      fontPaths: [],
    });

    await expect(c.convert({ filename: "sample.hwp", data: Buffer.from("hwp") })).rejects.toThrow(
      /layout overflow/,
    );
  });

  it("links the font dir and passes RHWP_FONT_PATHS to the python worker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rhwp-worker-test-"));
    const fontDir = join(dir, "fonts");
    await mkdir(fontDir);
    const { workerScript, logPath } = await fakeRhwpWorkerProbe(dir);
    const c = new RhwpConverter({
      enabled: true,
      pythonPath: "python3",
      workerScript,
      timeoutMs: 10_000,
      fontPaths: [fontDir],
    });

    const pdf = await c.convert({ filename: "sample.hwp", data: Buffer.from("hwp") });

    expect(pdf.toString()).toBe("%PDF-fake-rhwp");
    const log = JSON.parse(await readFile(logPath, "utf8")) as {
      font_env: string;
      font_link: boolean;
    };
    // The temp run dir is torn down after convert(); the worker records what it saw.
    expect(log.font_env).toBe(fontDir);
    expect(log.font_link).toBe(true);
  });
});
