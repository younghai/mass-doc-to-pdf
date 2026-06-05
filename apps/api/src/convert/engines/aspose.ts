import { ConversionError, type Converter, type ConvertInput, type FetchFn } from "../types.js";

export interface AsposeConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Aspose Cloud adapter (commercial, high Office fidelity, Office-free engine).
 * OAuth + per-product conversion endpoints are finalized against a real
 * subscription; unconfigured instances refuse clearly.
 */
export class AsposeConverter implements Converter {
  readonly name = "aspose";
  constructor(
    private readonly cfg: AsposeConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async convert({ filename }: ConvertInput): Promise<Buffer> {
    if (!this.cfg.baseUrl || !this.cfg.clientId || !this.cfg.clientSecret) {
      throw new ConversionError(
        this.name,
        "not configured — set ASPOSE_BASE_URL, ASPOSE_CLIENT_ID, ASPOSE_CLIENT_SECRET to enable",
      );
    }
    // Real impl: OAuth token -> POST to the format-appropriate Words/Cells/Slides endpoint.
    // Left behind the config guard until a subscription is wired in.
    throw new ConversionError(this.name, `conversion of ${filename} not yet wired to Aspose Cloud`);
  }
}
