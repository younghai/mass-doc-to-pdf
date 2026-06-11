import { describe, it, expect, vi } from "vitest";
import {
  applyPreflight,
  probeEngines,
  type ProbeRunner,
} from "./preflight.js";
import type { EngineConfig } from "./registry.js";

const base: EngineConfig = {
  gotenbergUrl: "http://g",
  hwpSidecarUrl: "http://h",
  officeEngine: "gotenberg",
  rhwp: { enabled: true, pythonPath: "python3", timeoutMs: 120_000 },
  rhwpCli: { enabled: true, cliPath: "rhwp", timeoutMs: 120_000, fontPaths: [], mode: "pdf" },
};

function enoent(message: string): Error {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

describe("probeEngines", () => {
  it("marks every engine available when the runner resolves", async () => {
    const run: ProbeRunner = async () => undefined;
    const pf = await probeEngines(base, run);
    expect(pf.rhwp.available).toBe(true);
    expect(pf.rhwpCli.available).toBe(true);
    expect(pf.builtin.available).toBe(true);
  });

  it("flags rhwp unavailable with the python path when the interpreter is missing", async () => {
    const run: ProbeRunner = async (file) => {
      if (file === base.rhwp.pythonPath) throw enoent("spawn python3 ENOENT");
    };
    const pf = await probeEngines(base, run);
    expect(pf.rhwp.available).toBe(false);
    expect(pf.rhwp.reason).toContain(base.rhwp.pythonPath);
  });

  it("flags rhwp unavailable on a module import error", async () => {
    const run: ProbeRunner = async (file, args) => {
      if (file === base.rhwp.pythonPath && args.includes("import rhwp")) {
        throw Object.assign(new Error("Command failed"), {
          code: 1,
          stderr: "ModuleNotFoundError: No module named 'rhwp'\n",
        });
      }
    };
    const pf = await probeEngines(base, run);
    expect(pf.rhwp.available).toBe(false);
    expect(pf.rhwp.reason).toContain("ModuleNotFoundError");
  });

  it("treats rhwp-cli asymmetrically: ENOENT unavailable, other errors available", async () => {
    const enoentRun: ProbeRunner = async (file) => {
      if (file === base.rhwpCli.cliPath) throw enoent("spawn rhwp ENOENT");
    };
    const enoentPf = await probeEngines(base, enoentRun);
    expect(enoentPf.rhwpCli.available).toBe(false);
    expect(enoentPf.rhwpCli.reason).toContain(base.rhwpCli.cliPath);

    const noVersionRun: ProbeRunner = async (file) => {
      if (file === base.rhwpCli.cliPath) {
        throw Object.assign(new Error("Command failed"), { code: 2, stderr: "unknown flag --version" });
      }
    };
    const noVersionPf = await probeEngines(base, noVersionRun);
    expect(noVersionPf.rhwpCli.available).toBe(true);
  });

  it("flags builtin unavailable when chrome is missing (exit 3)", async () => {
    const run: ProbeRunner = async (file) => {
      if (file === "python3") throw Object.assign(new Error("Command failed: exit 3"), { code: 3 });
    };
    const pf = await probeEngines(base, run);
    expect(pf.builtin.available).toBe(false);
    expect(pf.builtin.reason).toMatch(/chrome|chromium/i);
  });

  it("never invokes the runner for disabled engines", async () => {
    const run = vi.fn<ProbeRunner>(async () => undefined);
    const disabled: EngineConfig = {
      ...base,
      rhwp: { ...base.rhwp, enabled: false },
      rhwpCli: { ...base.rhwpCli, enabled: false },
    };
    const pf = await probeEngines(disabled, run);
    expect(pf.rhwp.available).toBe(false);
    expect(pf.rhwp.reason).toContain("disabled");
    expect(pf.rhwpCli.available).toBe(false);
    expect(pf.rhwpCli.reason).toContain("disabled");
    // Only the builtin python3 probe runs; rhwp/rhwp-cli are short-circuited.
    for (const call of run.mock.calls) {
      expect(call[0]).toBe("python3");
    }
  });
});

describe("applyPreflight", () => {
  it("disables a configured-but-unavailable engine and propagates builtinAvailable", () => {
    const pf = {
      rhwp: { available: false, reason: "ModuleNotFoundError" },
      rhwpCli: { available: true },
      builtin: { available: false, reason: "google chrome/chromium not found" },
    };
    const effective = applyPreflight(base, pf);
    expect(effective.rhwp.enabled).toBe(false);
    expect(effective.rhwpCli.enabled).toBe(true);
    expect(effective.builtinAvailable).toBe(false);
  });
});
