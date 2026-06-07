import type { ConversionMode, DocFormat } from "@hwptopdf/shared";
import type { Converter } from "./types.js";
import { GotenbergConverter } from "./engines/gotenberg.js";
import { BuiltinOfficeConverter, H2OrestartConverter } from "./engines/h2orestart.js";
import { HancomConverter, type HancomConfig } from "./engines/hancom.js";
import { AsposeConverter, type AsposeConfig } from "./engines/aspose.js";
import { QualityFallbackConverter } from "./engines/qualityFallback.js";
import { RhwpConverter, type RhwpConfig } from "./engines/rhwp.js";

export interface EngineConfig {
  gotenbergUrl: string;
  hwpSidecarUrl: string;
  officeEngine: "gotenberg" | "hwp-sidecar" | "builtin";
  rhwp: RhwpConfig;
  hancom?: HancomConfig;
  aspose?: AsposeConfig;
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
      return new H2OrestartConverter(cfg.hwpSidecarUrl);
    case "builtin":
      if (mode === "precise") {
        return new QualityFallbackConverter("office-quality-chain", "office", mode, [
          new H2OrestartConverter(cfg.hwpSidecarUrl),
          new BuiltinOfficeConverter(),
        ]);
      }
      return new BuiltinOfficeConverter();
    case "gotenberg":
      return new GotenbergConverter(cfg.gotenbergUrl);
  }
}

function hwpConverter(cfg: EngineConfig, mode: ConversionMode): Converter {
  if (mode === "quick") {
    return new QualityFallbackConverter("hwp-quick-chain", "hwp", mode, [
      new BuiltinOfficeConverter(),
      new H2OrestartConverter(cfg.hwpSidecarUrl),
      new RhwpConverter(cfg.rhwp),
    ]);
  }
  return new QualityFallbackConverter("hwp-quality-chain", "hwp", mode, [
    ...(cfg.hancom ? [new HancomConverter(cfg.hancom)] : []),
    new RhwpConverter(cfg.rhwp),
    new H2OrestartConverter(cfg.hwpSidecarUrl),
    new BuiltinOfficeConverter(),
  ]);
}
