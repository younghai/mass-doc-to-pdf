import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { StatCard } from "../components/StatCard";
import { SuccessRateChart } from "../components/SuccessRateChart";
import { JobsTable } from "../components/JobsTable";

export function Dashboard() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api.getStats() });
  const recent = useQuery({ queryKey: ["jobs", "recent"], queryFn: () => api.listJobs() });
  const s = stats.data;

  return (
    <section>
      <div className="dash-head">
        <h2>대시보드</h2>
        <Link to="/upload" className="btn">
          새 변환
        </Link>
      </div>
      <div className="cards">
        <StatCard label="총 변환수" value={s?.total ?? 0} />
        <StatCard label="성공률" value={s ? `${Math.round(s.successRate * 100)}%` : "0%"} />
        <StatCard label="성공" value={s?.success ?? 0} />
        <StatCard label="실패" value={s?.failed ?? 0} />
      </div>
      {s && s.success + s.failed > 0 && (
        <SuccessRateChart success={s.success} failed={s.failed} />
      )}
      <h3>최근 파일</h3>
      <JobsTable jobs={(recent.data ?? []).slice(0, 5)} />
    </section>
  );
}
