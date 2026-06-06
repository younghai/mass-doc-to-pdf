import type { DocFormat } from "@hwptopdf/shared";
import type { Converter } from "./types.js";
import { GotenbergConverter } from "./engines/gotenberg.js";
import { BuiltinOfficeConverter, H2OrestartConverter } from "./engines/h2orestart.js";
import { HancomConverter, type HancomConfig } from "./engines/hancom.js";
import { AsposeConverter, type AsposeConfig } from "./engines/aspose.js";

export interface EngineConfig {
  gotenbergUrl: string;
  hwpSidecarUrl: string;
  officeEngine: "gotenberg" | "hwp-sidecar" | "builtin";
  hancom?: HancomConfig;
  aspose?: AsposeConfig;
}

export interface Registry {
  forFormat(format: DocFormat): Converter;
}

export function buildRegistry(
  cfg: EngineConfig,
  overrides?: Partial<Record<DocFormat, Converter>>,
): Registry {
  const office: Converter =
    overrides?.office ??
    (cfg.aspose
      ? new AsposeConverter(cfg.aspose)
      : officeConverter(cfg));

  const hwp: Converter =
    overrides?.hwp ??
    (cfg.hancom ? new HancomConverter(cfg.hancom) : hwpConverter(cfg));

  const table: Record<DocFormat, Converter> = { office, hwp };
  return { forFormat: (format) => table[format] };
}

function officeConverter(cfg: EngineConfig): Converter {
  switch (cfg.officeEngine) {
    case "hwp-sidecar":
      return new H2OrestartConverter(cfg.hwpSidecarUrl);
    case "builtin":
      return new BuiltinOfficeConverter();
    case "gotenberg":
      return new GotenbergConverter(cfg.gotenbergUrl);
  }
}

function hwpConverter(cfg: EngineConfig): Converter {
  switch (cfg.officeEngine) {
    case "builtin":
      return new BuiltinOfficeConverter();
    case "hwp-sidecar":
    case "gotenberg":
      return new H2OrestartConverter(cfg.hwpSidecarUrl);
  }
}
