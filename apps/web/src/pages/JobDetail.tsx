import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { StatusPill } from "../components/StatusPill";
import { humanSize, formatDate } from "../format";
import type { QualityReport } from "@hwptopdf/shared";
import { QUALITY_MODE_LABEL, QUALITY_STATUS_LABEL, gradeLabel, qualityAction, qualityStatus, warningLabel } from "../qualityView";

function QualityReportPanel({ report }: { readonly report: QualityReport }) {
  return (
    <section className="quality-report" aria-labelledby="quality-report-title">
      <div className="section-head">
        <h3 id="quality-report-title">품질 리포트</h3>
      </div>
      <dl className="props quality-props">
        <dt>판정</dt>
        <dd>{QUALITY_STATUS_LABEL[qualityStatus(report)]}</dd>
        <dt>품질 모드</dt>
        <dd>{report.mode ? QUALITY_MODE_LABEL[report.mode] : "-"}</dd>
        <dt>등급</dt>
        <dd>{gradeLabel(report.grade)}</dd>
        <dt>선택 엔진</dt>
        <dd>{report.selectedEngine}</dd>
        <dt>PDF 크기</dt>
        <dd>{humanSize(report.checks.pdfBytes)}</dd>
        <dt>페이지</dt>
        <dd>{report.checks.pageCount ?? "-"}</dd>
        <dt>권장 조치</dt>
        <dd>{qualityAction(report)}</dd>
      </dl>
      <div className="quality-list">
        {report.attempts.map((attempt) => (
          <div className="quality-attempt" key={`${attempt.engine}-${attempt.durationMs}`}>
            <strong>{attempt.engine}</strong>
            <span>{attempt.status}</span>
            <span>{attempt.durationMs} ms</span>
            {attempt.error ? <small>{attempt.error}</small> : null}
          </div>
        ))}
      </div>
      {report.warnings.length ? (
        <ul className="quality-warnings">
          {report.warnings.map((warning) => (
            <li key={warning}>{warningLabel(warning)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PdfPreview({ jobId }: { readonly jobId: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const previewUrl = api.previewUrl(jobId);
  const previewImageUrl = api.previewImageUrl(jobId);
  return (
    <section className="pdf-preview" aria-labelledby="pdf-preview-title">
      <div className="section-head">
        <h3 id="pdf-preview-title">PDF 미리보기</h3>
      </div>
      {imageFailed ? (
        <div className="pdf-preview-fallback" role="status">
          <a href={`${previewUrl}#page=1&view=FitH`} target="_blank" rel="noreferrer">
            PDF 미리보기 새 창 열기
          </a>
        </div>
      ) : (
        <a
          className="pdf-preview-image"
          href={`${previewUrl}#page=1&view=FitH`}
          target="_blank"
          rel="noreferrer"
          aria-label="PDF 첫 페이지 원본 열기"
        >
          <img src={previewImageUrl} alt="PDF 첫 페이지 미리보기" onError={() => setImageFailed(true)} />
        </a>
      )}
      <div className="preview-pages" aria-label="첫 3페이지 바로가기">
        {[1, 2, 3].map((page) => (
          <a key={page} href={`${previewUrl}#page=${page}`} target="_blank" rel="noreferrer">
            {page}페이지
          </a>
        ))}
      </div>
    </section>
  );
}

export function JobDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: job, isLoading } = useQuery({
    queryKey: ["job", id],
    queryFn: () => api.getJob(id),
    retry: false,
    refetchInterval: 2_000,
  });
  const { data: qualityReport } = useQuery({
    queryKey: ["job-quality", id],
    queryFn: () => api.getQualityReport(id),
    enabled: job?.status === "success",
    retry: false,
  });

  const retryMutation = useMutation({
    mutationFn: () => api.retryJob(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["job", id] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteJob(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      navigate("/service/jobs");
    },
  });

  if (isLoading) return <p>로딩 중…</p>;
  if (!job) return <p>찾을 수 없습니다.</p>;

  return (
    <section>
      <div className="detail-head">
        <h2>{job.filename}</h2>
        <StatusPill status={job.status} />
      </div>
      <dl className="props">
        <dt>형식</dt>
        <dd>{job.format}</dd>
        <dt>확장자</dt>
        <dd>{job.extension}</dd>
        <dt>MIME</dt>
        <dd>{job.mimeType}</dd>
        <dt>크기</dt>
        <dd>{humanSize(job.sizeBytes)}</dd>
        <dt>엔진</dt>
        <dd>{job.engine ?? "-"}</dd>
        <dt>변환 시간</dt>
        <dd>{job.durationMs != null ? `${job.durationMs} ms` : "-"}</dd>
        <dt>생성일</dt>
        <dd>{formatDate(job.createdAt)}</dd>
      </dl>
      {job.status === "success" ? (
        <>
          <div className="job-actions">
            <a className="btn" href={api.downloadUrl(job.id)}>
              PDF 다운로드
            </a>
            <button
              className="btn ghost"
              type="button"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              삭제
            </button>
          </div>
          <PdfPreview jobId={job.id} />
          {qualityReport ? <QualityReportPanel report={qualityReport} /> : null}
        </>
      ) : job.status === "running" || job.status === "pending" || job.status === "queued" ? (
        <div className="notice" role="status">
          변환 작업이 진행 중입니다. 완료되면 이 화면에 다운로드 버튼이 표시됩니다.
        </div>
      ) : job.status === "failed" ? (
        <>
          <div className="error" role="alert">
            <strong>변환 실패</strong>
            <p>{job.error}</p>
          </div>
          <div className="job-actions">
            <button
              className="btn primary"
              type="button"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
            >
              {retryMutation.isPending ? "재시도 중…" : "다시 변환"}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              삭제
            </button>
          </div>
          {retryMutation.isError ? (
            <p className="error-msg" role="alert">재시도 실패: {String(retryMutation.error)}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
