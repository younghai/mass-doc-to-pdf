import { ConversionError, type Converter, type ConvertInput, type FetchFn } from "../types.js";

export class H2OrestartConverter implements Converter {
  readonly name = "h2orestart";
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async convert({ filename, data }: ConvertInput): Promise<Buffer> {
    const form = new FormData();
    form.append("file", new File([data], filename));
    const url = `${this.baseUrl}/convert`;
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: "POST", body: form });
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
