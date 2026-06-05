import { ConversionError, type Converter, type ConvertInput, type FetchFn } from "../types.js";

export interface HancomConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * Hancom Hwp SDK / Docs Converter adapter (commercial, highest HWP fidelity).
 * Until a licensed endpoint is wired in, an unconfigured instance refuses
 * clearly rather than pretending to succeed.
 */
export class HancomConverter implements Converter {
  readonly name = "hancom";
  constructor(
    private readonly cfg: HancomConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async convert({ filename, data }: ConvertInput): Promise<Buffer> {
    if (!this.cfg.baseUrl || !this.cfg.apiKey) {
      throw new ConversionError(
        this.name,
        "not configured — set HANCOM_BASE_URL and HANCOM_API_KEY to enable the licensed engine",
      );
    }
    const form = new FormData();
    form.append("file", new File([data], filename));
    const url = `${this.cfg.baseUrl}/v1/convert/pdf`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        body: form,
      });
    } catch (cause) {
      throw new ConversionError(this.name, `request to ${url} failed`, cause);
    }
    if (!res.ok) {
      throw new ConversionError(
        this.name,
        `backend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
