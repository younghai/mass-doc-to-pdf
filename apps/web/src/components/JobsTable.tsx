import { Link } from "react-router-dom";
import type { JobDTO } from "@hwptopdf/shared";
import { api } from "../api/client";
import { StatusPill } from "./StatusPill";
import { humanSize, formatDate } from "../format";

export function JobsTable({ jobs }: { jobs: JobDTO[] }) {
  if (!jobs.length) return <p className="empty">변환 내역이 없습니다.</p>;
  return (
    <table className="jobs-table">
      <thead>
        <tr>
          <th>파일명</th>
          <th>형식</th>
          <th>크기</th>
          <th>엔진</th>
          <th>날짜</th>
          <th>상태</th>
          <th>작업</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id}>
            <td>
              <Link to={`/service/jobs/${j.id}`}>{j.filename}</Link>
            </td>
            <td>{j.extension.toUpperCase()}</td>
            <td>{humanSize(j.sizeBytes)}</td>
            <td>{j.engine ?? "-"}</td>
            <td>{formatDate(j.createdAt)}</td>
            <td>
              <StatusPill status={j.status} />
            </td>
            <td className="row-actions">
              <Link to={`/service/jobs/${j.id}`}>상세</Link>
              {j.status === "success" && <a href={api.downloadUrl(j.id)}>다운로드</a>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
