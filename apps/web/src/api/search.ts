import type {
  DocumentSearchRequest,
  DocumentSearchResponse,
  SearchIndexDTO,
} from "@hwptopdf/shared";

export type SearchConfig = {
  readonly enabled: boolean;
};

class SearchApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`검색 요청에 실패했습니다 (${status})`);
    this.name = "SearchApiError";
    this.status = status;
  }
}

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new SearchApiError(response.status);
  return response.json() as Promise<T>;
}

export const searchApi = {
  config(): Promise<SearchConfig> {
    return fetch("/api/search/config").then((response) => asJson<SearchConfig>(response));
  },
  indexStatus(jobId: string): Promise<SearchIndexDTO> {
    return fetch(`/api/jobs/${encodeURIComponent(jobId)}/search-index`).then((response) =>
      asJson<SearchIndexDTO>(response),
    );
  },
  async createIndex(jobId: string, confirmReview?: boolean): Promise<SearchIndexDTO> {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/search-index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirmReview ? { confirmReview: true } : {}),
    });
    return asJson<SearchIndexDTO>(response);
  },
  async deleteIndex(jobId: string): Promise<SearchIndexDTO> {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/search-index`, {
      method: "DELETE",
    });
    return asJson<SearchIndexDTO>(response);
  },
  async search(request: DocumentSearchRequest): Promise<DocumentSearchResponse> {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return asJson<DocumentSearchResponse>(response);
  },
};
