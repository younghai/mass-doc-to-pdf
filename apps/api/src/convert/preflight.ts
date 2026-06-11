import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EngineConfig } from "./registry.js";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 10_000;

export interface EngineProbe {
  readonly available: boolean;
  readonly reason?: string;
}

export interface EnginePreflight {
  readonly rhwp: EngineProbe;
  readonly rhwpCli: EngineProbe;
  readonly builtin: EngineProbe;
}

/** Injectable runner so tests don't depend on the host's python/chrome. */
export type ProbeRunner = (file: string, args: readonly string[]) => Promise<void>;

const defaultRunner: ProbeRunner = (file, args) =>
  execFileAsync(file, [...args], { timeout: PROBE_TIMEOUT_MS }).then(() => undefined);

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
  }
  return undefined;
}

function errorDetail(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) {
    const stderr = (err as { stderr?: unknown }).stderr;
    if (typeof stderr === "string") {
      const firstLine = stderr.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
      if (firstLine) return firstLine;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "unknown probe failure";
}

async function probeRhwp(cfg: EngineConfig, run: ProbeRunner): Promise<EngineProbe> {
  if (cfg.rhwp.enabled === false) {
    return { available: false, reason: "disabled by RHWP_ENABLED=0" };
  }
  try {
    // `python -c "import rhwp"` exit code is trustworthy: only a clean import
    // (exit 0) marks the engine available. A missing module raises
    // ModuleNotFoundError and exits non-zero.
    await run(cfg.rhwp.pythonPath, ["-c", "import rhwp"]);
    return { available: true };
  } catch (err) {
    if (errorCode(err) === "ENOENT") {
      return { available: false, reason: `python interpreter not found: ${cfg.rhwp.pythonPath}` };
    }
    return { available: false, reason: errorDetail(err) };
  }
}

async function probeRhwpCli(cfg: EngineConfig, run: ProbeRunner): Promise<EngineProbe> {
  if (cfg.rhwpCli.enabled === false) {
    return { available: false, reason: "disabled by RHWP_CLI_ENABLED=0" };
  }
  try {
    await run(cfg.rhwpCli.cliPath, ["--version"]);
    return { available: true };
  } catch (err) {
    // Asymmetric with rhwp on purpose: a present binary may not implement
    // `--version` (CLI conventions are not trustworthy), so only a true ENOENT
    // (binary absent) proves unavailability. Any other failure leaves it enabled.
    if (errorCode(err) === "ENOENT") {
      return { available: false, reason: `binary not found: ${cfg.rhwpCli.cliPath}` };
    }
    return { available: true };
  }
}

async function probeBuiltin(run: ProbeRunner): Promise<EngineProbe> {
  // The builtin engine's HWP path is text-extraction → HTML → headless Chrome
  // render, so it needs both python3 and a Chrome/Chromium binary. (The
  // rhwp-via-builtin branch is moot for availability: the rhwp engine sits ahead
  // of builtin in every chain, so builtin only matters for its own render path.)
  try {
    await run("python3", [
      "-c",
      "import shutil,os,sys; sys.exit(0 if (os.environ.get('GOOGLE_CHROME') or os.environ.get('CHROME_BIN') or shutil.which('google-chrome') or shutil.which('google-chrome-stable') or shutil.which('chromium-browser') or shutil.which('chromium')) else 3)",
    ]);
    return { available: true };
  } catch (err) {
    if (errorCode(err) === "ENOENT") {
      return { available: false, reason: "python3 not found" };
    }
    if (errorCode(err) === "3") {
      return { available: false, reason: "google chrome/chromium not found" };
    }
    return { available: false, reason: errorDetail(err) };
  }
}

/**
 * Boot-time, one-shot probe of the local runtime engines (rhwp, rhwp-cli,
 * builtin). Availability is fixed for the process lifetime, so a single probe at
 * startup is sufficient. Every probe is individually guarded and the whole batch
 * runs under Promise.all — this never throws and never fails boot.
 */
export async function probeEngines(cfg: EngineConfig, run: ProbeRunner = defaultRunner): Promise<EnginePreflight> {
  const [rhwp, rhwpCli, builtin] = await Promise.all([
    probeRhwp(cfg, run),
    probeRhwpCli(cfg, run),
    probeBuiltin(run),
  ]);
  return { rhwp, rhwpCli, builtin };
}

/**
 * Folds preflight results into the effective engine config: an engine stays
 * enabled only if it was configured AND probed available. builtinAvailable is
 * threaded through for the registry's BuiltinOfficeConverter gating.
 */
export function applyPreflight(cfg: EngineConfig, pf: EnginePreflight): EngineConfig {
  return {
    ...cfg,
    rhwp: { ...cfg.rhwp, enabled: cfg.rhwp.enabled && pf.rhwp.available },
    rhwpCli: { ...cfg.rhwpCli, enabled: cfg.rhwpCli.enabled && pf.rhwpCli.available },
    builtinAvailable: pf.builtin.available,
  };
}

export function logEnginePreflight(pf: EnginePreflight, cfg: EngineConfig): void {
  if (cfg.rhwp.enabled && !pf.rhwp.available) {
    console.warn(
      `engine preflight: rhwp unavailable — ${pf.rhwp.reason ?? "unknown"} (excluded from conversion chains)`,
    );
  }
  if (cfg.rhwpCli.enabled && !pf.rhwpCli.available) {
    console.warn(
      `engine preflight: rhwp-cli unavailable — ${pf.rhwpCli.reason ?? "unknown"} (excluded from conversion chains)`,
    );
  }
  if (!pf.builtin.available) {
    console.warn(
      `engine preflight: builtin unavailable — ${pf.builtin.reason ?? "unknown"} (excluded from conversion chains)`,
    );
  }
  // builtin is an explicit operator choice when officeEngine === "builtin": we
  // honor it (no exclusion) but warn loudly because its conversions will fail.
  if (cfg.officeEngine === "builtin" && !pf.builtin.available) {
    console.error(
      `engine preflight: OFFICE_ENGINE=builtin but builtin is unavailable — ${pf.builtin.reason ?? "unknown"}; office conversions will fail`,
    );
  }
}
