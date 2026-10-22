export interface ExtractedPage {
  readonly pageNumber: number;
  readonly text: string;
}

export interface ExtractedPdf {
  readonly totalPages: number;
  readonly pages: readonly ExtractedPage[];
  readonly omittedPages: readonly number[];
}

export interface PdfTextExtractor {
  extract(pdf: Buffer): Promise<ExtractedPdf>;
}

export interface ProviderHit {
  readonly key: string;
  readonly text: string;
  readonly score: number;
}

export interface SearchProvider {
  /** Stable non-secret account/namespace/instance identity; cleanup must use the same scope. */
  readonly scope: string;
  checkConfiguration(): Promise<void>;
  /** Must recover an existing deterministic key before attempting another upload. */
  ensureItem(key: string, text: string): Promise<{ readonly id: string }>;
  itemStatus(id: string): Promise<"pending" | "ready" | "failed">;
  /** Delete every item with this exact key, including uploads whose response was lost. */
  deleteKey(key: string): Promise<void>;
  search(input: { readonly query: string; readonly folder: string; readonly rewrite: boolean; readonly rerank: boolean }): Promise<readonly ProviderHit[]>;
  /** Receives only application-authorized results. Cite [S1], [S2], etc.; no fresh retrieval. */
  answer(query: string, sources: readonly { readonly citationId: string; readonly text: string }[]): Promise<string>;
}
