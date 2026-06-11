import type { ConversionMode, DocFormat } from "@hwptopdf/shared";
import type { Converter } from "./types.js";
import { GotenbergConverter } from "./engines/gotenberg.js";
import { BuiltinOfficeConverter, H2OrestartConverter } from "./engines/h2orestart.js";
import { HancomConverter, type HancomConfig } from "./engines/hancom.js";
import { AsposeConverter, type AsposeConfig } from "./engines/aspose.js";
import { QualityFallbackConverter } from "./engines/qualityFallback.js";
import { RhwpCliConverter, RhwpConverter, type RhwpCliConfig, type RhwpConfig } from "./engines/rhwp.js";

export interface EngineConfig {
  gotenbergUrl: string;
  hwpSidecarUrl: string;
  // Client-side abort for the HWP/Office sidecar. Defaults to the converter's
  // own 150s when omitted; kept above the sidecar's internal 120s soffice cap.
  hwpSidecarTimeoutMs?: number;
  officeEngine: "gotenberg" | "hwp-sidecar" | "builtin";
  rhwp: RhwpConfig;
  rhwpCli: RhwpCliConfig;
  hancom?: HancomConfig;
  aspose?: AsposeConfig;
  // Set by the boot-time preflight; builtin needs python3 + headless chrome in
  // the runtime image. Unspecified (=true) keeps existing tests and the inline
  // path unaffected.
  builtinAvailable?: boolean;
}

export interface Registry {
  forFormat(format: DocFormat, options?: { readonly qualityMode?: ConversionMode }): Converter;
}

export function buildRegistry(
  cfg: EngineConfig,
  overrides?: Partial<Record<DocFormat, Converter>>,
): Registry {
  const hwp: Converter =
    overrides?.hwp ??
    hwpConverter(cfg, "precise");

  const table: Record<DocFormat, Converter> = { office: overrides?.office ?? officeConverter(cfg, "precise"), hwp };
  return {
    forFormat: (format, options) =>
      format === "hwp" && !overrides?.hwp
        ? hwpConverter(cfg, options?.qualityMode ?? "precise")
        : format === "office" && !overrides?.office
          ? officeConverter(cfg, options?.qualityMode ?? "precise")
        : table[format],
  };
}

function officeConverter(cfg: EngineConfig, mode: ConversionMode): Converter {
  if (cfg.aspose && mode === "precise") {
    return new AsposeConverter(cfg.aspose);
  }
  switch (cfg.officeEngine) {
    case "hwp-sidecar":
      return new H2OrestartConverter(cfg.hwpSidecarUrl, undefined, cfg.hwpSidecarTimeoutMs);
    case "builtin":
      if (mode === "precise") {
        return new QualityFallbackConverter("office-quality-chain", "office", mode, [
          new H2OrestartConverter(cfg.hwpSidecarUrl, undefined, cfg.hwpSidecarTimeoutMs),
          ...(cfg.builtinAvailable !== false ? [new BuiltinOfficeConverter()] : []),
        ]);
      }
      // Operator explicitly chose builtin quick mode; honor it even when the
      // preflight flagged it unavailable (logEnginePreflight emits an error).
      return new BuiltinOfficeConverter();
    case "gotenberg":
      return new GotenbergConverter(cfg.gotenbergUrl);
  }
}

// Administratively disabled engines are excluded from the chain entirely: a
// "disabled" failure attempt would push every conversion's quality status to
// review, flooding operators with false positives on servers that simply
// don't install the optional renderers.
// Unimplemented engines are also never registered: the raster renderer is not
// yet implemented, so it is excluded here regardless of configuration to
// prevent a guaranteed-failure attempt from corrupting quality status.
function hwpConverter(cfg: EngineConfig, mode: ConversionMode): Converter {
  if (mode === "quick") {
    return new QualityFallbackConverter("hwp-quick-chain", "hwp", mode, [
      ...(cfg.builtinAvailable !== false ? [new BuiltinOfficeConverter()] : []),
      new H2OrestartConverter(cfg.hwpSidecarUrl, undefined, cfg.hwpSidecarTimeoutMs),
      ...(cfg.rhwp.enabled ? [new RhwpConverter(cfg.rhwp)] : []),
    ]);
  }
  return new QualityFallbackConverter("hwp-quality-chain", "hwp", mode, [
    ...(cfg.hancom ? [new HancomConverter(cfg.hancom)] : []),
    ...(cfg.rhwpCli.enabled ? [new RhwpCliConverter({ ...cfg.rhwpCli, mode: "pdf" })] : []),
    ...(cfg.rhwp.enabled ? [new RhwpConverter(cfg.rhwp)] : []),
    new H2OrestartConverter(cfg.hwpSidecarUrl, undefined, cfg.hwpSidecarTimeoutMs),
    ...(cfg.builtinAvailable !== false ? [new BuiltinOfficeConverter()] : []),
  ]);
}
