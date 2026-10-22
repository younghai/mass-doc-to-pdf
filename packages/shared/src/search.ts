export type SearchIndexStatus = "not_indexed" | "queued" | "extracting" | "indexing" | "ready" | "failed" | "deleting" | "deleted";

export interface SearchIndexDTO {
  readonly enabled: boolean;
  readonly status: SearchIndexStatus;
  readonly totalPages: number;
  readonly indexedPages: number;
  readonly omittedPages: readonly number[];
  readonly error: string | null;
  readonly updatedAt: string | null;
}

export interface DocumentSearchRequest {
  readonly query: string;
  readonly rewrite?: boolean;
  readonly rerank?: boolean;
  readonly answer?: boolean;
}

export interface DocumentSearchHit {
  readonly citationId: string;
  readonly jobId: string;
  readonly filename: string;
  readonly pageNumber: number;
  readonly text: string;
  readonly score: number;
}

export interface DocumentSearchResponse {
  readonly query: string;
  readonly results: readonly DocumentSearchHit[];
  readonly answer: string | null;
  readonly warnings: readonly string[];
}
