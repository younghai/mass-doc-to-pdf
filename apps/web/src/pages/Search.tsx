import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { DocumentSearchHit, DocumentSearchRequest } from "@hwptopdf/shared";
import { api } from "../api/client";
import { searchApi } from "../api/search";

type SearchOptions = {
  readonly rewrite: boolean;
  readonly rerank: boolean;
  readonly answer: boolean;
};

const INITIAL_OPTIONS: SearchOptions = {
  rewrite: false,
  rerank: false,
  answer: false,
};

function citationToken(citationId: string): string {
  return citationId.startsWith("[") ? citationId : `[${citationId}]`;
}

function resultUrl(hit: DocumentSearchHit): string {
  return `${api.previewUrl(hit.jobId)}#page=${hit.pageNumber}`;
}

function AnswerText({ answer, results }: { readonly answer: string; readonly results: readonly DocumentSearchHit[] }) {
  const citationTargets = new Map(results.map((hit) => [citationToken(hit.citationId), resultUrl(hit)]));
  return answer.split(/(\[S\d+\])/g).map((part, index): ReactNode => {
    const href = citationTargets.get(part);
    return href ? (
      <a key={`${part}-${index}`} href={href} target="_blank" rel="noreferrer">{part}</a>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    );
  });
}

export function Search() {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>(INITIAL_OPTIONS);
  const config = useQuery({
    queryKey: ["search-config"],
    queryFn: searchApi.config,
    retry: false,
  });
  const search = useMutation({ mutationFn: (request: DocumentSearchRequest) => searchApi.search(request) });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery || config.data?.enabled !== true) return;
    search.mutate({ query: normalizedQuery, ...options });
  };

  return (
    <section className="document-search">
      <div className="section-head">
        <div>
          <h2>문서 검색</h2>
          <p>등록한 문서의 페이지 텍스트를 Hybrid RRF 검색으로 찾습니다.</p>
        </div>
      </div>

      {config.isLoading ? <p role="status">검색 설정을 확인하는 중…</p> : null}
      {config.isError ? <p className="error-msg" role="alert">검색 설정을 불러오지 못했습니다.</p> : null}
      {config.data?.enabled === false ? (
        <div className="notice" role="status">문서 검색이 아직 구성되지 않았습니다. 관리자 설정 후 사용할 수 있습니다.</div>
      ) : null}

      <form className="search-form" onSubmit={submit}>
        <label htmlFor="document-search-query">검색어</label>
        <div className="search-query-row">
          <input
            id="document-search-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="문서에서 찾을 내용"
            disabled={config.data?.enabled !== true || search.isPending}
          />
          <button className="btn primary" type="submit" disabled={!query.trim() || config.data?.enabled !== true || search.isPending}>
            {search.isPending ? "검색 중…" : "검색"}
          </button>
        </div>
        <fieldset className="search-options">
          <legend>선택 기능</legend>
          <label>
            <input
              type="checkbox"
              checked={options.rewrite}
              onChange={(event) => setOptions((current) => ({ ...current, rewrite: event.target.checked }))}
            />
            검색어 재작성
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.rerank}
              onChange={(event) => setOptions((current) => ({ ...current, rerank: event.target.checked }))}
            />
            결과 재정렬
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.answer}
              onChange={(event) => setOptions((current) => ({ ...current, answer: event.target.checked }))}
            />
            출처 기반 답변
          </label>
        </fieldset>
      </form>

      {search.isError ? <p className="error-msg" role="alert">검색 요청을 처리하지 못했습니다: {String(search.error)}</p> : null}
      {search.isSuccess && search.data.warnings.length > 0 ? (
        <div className="search-warnings" role="status">
          <strong>검색 안내</strong>
          <ul>{search.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      ) : null}

      {search.isSuccess && search.data.answer ? (
        <section className="search-answer" aria-labelledby="search-answer-title">
          <h3 id="search-answer-title">답변</h3>
          <p><AnswerText answer={search.data.answer} results={search.data.results} /></p>
        </section>
      ) : null}

      {search.isSuccess ? (
        <section className="search-results" aria-labelledby="search-results-title">
          <div className="section-head">
            <h3 id="search-results-title">검색 결과</h3>
            <span>{search.data.results.length}건</span>
          </div>
          {search.data.results.length === 0 ? (
            <p className="empty">일치하는 페이지를 찾지 못했습니다.</p>
          ) : (
            <ol>
              {search.data.results.map((hit) => (
                <li key={`${hit.jobId}-${hit.pageNumber}-${hit.citationId}`} id={`source-${hit.citationId.replace(/[\[\]]/g, "")}`}>
                  <div className="search-result-head">
                    <strong>{citationToken(hit.citationId)} {hit.filename}</strong>
                    <a href={resultUrl(hit)} target="_blank" rel="noreferrer">{hit.pageNumber}페이지 열기</a>
                  </div>
                  <p>{hit.text}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </section>
  );
}
