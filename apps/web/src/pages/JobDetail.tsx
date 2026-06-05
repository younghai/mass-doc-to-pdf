import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { StatusPill } from "../components/StatusPill";
import { humanSize, formatDate } from "../format";

export function JobDetail() {
  const { id = "" } = useParams();
  const { data: job, isLoading } = useQuery({
    queryKey: ["job", id],
    queryFn: () => api.getJob(id),
    retry: false,
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
        <a className="btn" href={api.downloadUrl(job.id)}>
          PDF 다운로드
        </a>
      ) : job.status === "failed" ? (
        <div className="error" role="alert">
          <strong>변환 실패</strong>
          <p>{job.error}</p>
        </div>
      ) : null}
    </section>
  );
}
