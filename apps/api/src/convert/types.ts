export interface ConvertInput {
  filename: string;
  data: Buffer;
}

export interface Converter {
  readonly name: string;
  convert(input: ConvertInput): Promise<Buffer>;
}

export type FetchFn = typeof fetch;

export class ConversionError extends Error {
  constructor(
    public readonly engine: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${engine}] ${message}`);
    this.name = "ConversionError";
  }
}
