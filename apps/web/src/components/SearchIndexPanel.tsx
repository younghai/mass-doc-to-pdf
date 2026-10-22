import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QualityStatus, SearchIndexDTO, SearchIndexStatus } from "@hwptopdf/shared";
import { searchApi } from "../api/search";

const ACTIVE_STATUSES: readonly SearchIndexStatus[] = ["queued", "extracting", "indexing", "deleting"];

const STATUS_LABEL: Record<SearchIndexStatus, string> = {
  not_indexed: "등록되지 않음",
  queued: "등록 대기",
  extracting: "페이지 텍스트 추출 중",
  indexing: "검색 색인 생성 중",
  ready: "검색 가능",
  failed: "등록 실패",
  deleting: "삭제 중",
  deleted: "삭제됨",
};

type SearchIndexPanelProps = {
  readonly jobId: string;
  readonly filename: string;
  readonly qualityStatus?: QualityStatus;
};

export function SearchIndexPanel({ jobId, filename, qualityStatus }: SearchIndexPanelProps) {
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: ["search-config"],
    queryFn: searchApi.config,
    retry: false,
  });
  const index = useQuery({
    queryKey: ["search-index", jobId],
    queryFn: () => searchApi.indexStatus(jobId),
    enabled: config.data?.enabled === true,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_STATUSES.includes(status) ? 2_000 : false;
    },
  });
  const create = useMutation({
    mutationFn: () => searchApi.createIndex(jobId, reviewConfirmed || undefined),
    onSuccess: (data) => queryClient.setQueryData<SearchIndexDTO>(["search-index", jobId], data),
  });
  const remove = useMutation({
    mutationFn: () => searchApi.deleteIndex(jobId),
    onSuccess: (data) => queryClient.setQueryData<SearchIndexDTO>(["search-index", jobId], data),
  });

  const status = index.data?.status;
  const needsReviewConfirmation = qualityStatus === "review" || qualityStatus === undefined;
  const canCreate = status === "not_indexed" || status === "deleted" || status === "failed";
  const canDelete = status === "ready" || status === "failed";
  const actionPending = create.isPending || remove.isPending;

  return (
    <section className="search-index-panel" aria-labelledby="search-index-title">
      <div className="section-head">
        <div>
          <h3 id="search-index-title">문서 검색 등록</h3>
          <p>검색은 PDF 다운로드와 별도로 선택해서 등록하거나 삭제할 수 있습니다.</p>
        </div>
        {status ? <span className={`search-status search-status-${status}`}>{STATUS_LABEL[status]}</span> : null}
      </div>

      <div className="search-privacy-notice">
        <strong>등록 전에 확인하세요</strong>
        <p>페이지 텍스트가 검색 처리를 위해 전송되고 Cloudflare에 저장됩니다. 이미지 안의 글자를 읽는 OCR은 지원하지 않습니다.</p>
      </div>

      {config.isLoading ? <p role="status">검색 설정을 확인하는 중…</p> : null}
      {config.isError ? <p className="error-msg" role="alert">검색 설정을 불러오지 못했습니다.</p> : null}
      {config.data?.enabled === false ? (
        <div className="notice" role="status">문서 검색이 아직 구성되지 않았습니다. 관리자 설정 후 사용할 수 있습니다.</div>
      ) : null}

      {config.data?.enabled && index.isLoading ? <p role="status">등록 상태를 확인하는 중…</p> : null}
      {index.isError ? <p className="error-msg" role="alert">검색 등록 상태를 불러오지 못했습니다.</p> : null}

      {index.data ? (
        <>
          <dl className="search-index-stats">
            <div><dt>전체 페이지</dt><dd>{index.data.totalPages}</dd></div>
            <div><dt>등록 페이지</dt><dd>{index.data.indexedPages}</dd></div>
          </dl>
          {index.data.omittedPages.length > 0 ? (
            <p className="search-omitted-pages">
              텍스트가 없어 제외된 페이지: {index.data.omittedPages.join(", ")} (OCR 미지원)
            </p>
          ) : null}
          {index.data.error ? <p className="error-msg" role="alert">{index.data.error}</p> : null}

          {canCreate && needsReviewConfirmation ? (
            <label className="search-review-confirmation">
              <input
                type="checkbox"
                checked={reviewConfirmed}
                onChange={(event) => setReviewConfirmed(event.target.checked)}
              />
              <span>변환 품질을 원본과 검수했으며, “{filename}”의 페이지 텍스트 등록에 동의합니다.</span>
            </label>
          ) : null}

          <div className="job-actions search-index-actions">
            {canCreate ? (
              <button
                className="btn primary"
                type="button"
                disabled={actionPending || (needsReviewConfirmation && !reviewConfirmed)}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "요청 중…" : status === "failed" ? "등록 다시 시도" : "검색에 등록"}
              </button>
            ) : null}
            {canDelete ? (
              <button
                className="btn ghost"
                type="button"
                disabled={actionPending}
                onClick={() => {
                  if (window.confirm(`“${filename}”의 검색 색인을 삭제할까요? PDF 다운로드는 유지됩니다.`)) {
                    remove.mutate();
                  }
                }}
              >
                {remove.isPending ? "삭제 요청 중…" : "검색 등록 삭제"}
              </button>
            ) : null}
          </div>
          {create.isError || remove.isError ? (
            <p className="error-msg" role="alert">검색 등록 요청을 처리하지 못했습니다.</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
