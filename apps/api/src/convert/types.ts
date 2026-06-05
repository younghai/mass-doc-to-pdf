export interface ConvertInput {
  filename: string;
  data: Buffer;
}

export interface Converter {
  readonly name: string;
  convert(input: ConvertInput): Promise<Buffer>;
}

export type FetchFn = typeof fetch;

/**
 * Convert a Node Buffer into an ArrayBuffer-backed Uint8Array suitable for
 * `new File([...])`. Avoids the Buffer<ArrayBufferLike> vs BlobPart type clash
 * that arises once DOM-style File/Blob typings are in scope.
 */
export function toFilePart(data: Buffer): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(data.byteLength);
  const view = new Uint8Array(ab);
  view.set(data);
  return view;
}

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
