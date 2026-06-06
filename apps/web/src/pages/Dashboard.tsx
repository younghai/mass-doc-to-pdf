import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { StatCard } from "../components/StatCard";
import { SuccessRateChart } from "../components/SuccessRateChart";
import { JobsTable } from "../components/JobsTable";

export function Dashboard() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.getStats(),
    refetchInterval: 2_000,
  });
  const recent = useQuery({
    queryKey: ["jobs", "recent"],
    queryFn: () => api.listJobs(),
    refetchInterval: 2_000,
  });
  const s = stats.data;

  return (
    <section>
      <div className="dash-head">
        <div>
          <h2>운영 현황</h2>
          <p>최근 변환 작업의 상태와 실패 여부를 확인합니다.</p>
        </div>
        <Link to="/service/upload" className="btn">
          새 변환
        </Link>
      </div>
      <div className="cards">
        <StatCard label="총 변환수" value={s?.total ?? 0} />
        <StatCard label="진행 중" value={s?.running ?? 0} />
        <StatCard label="대기" value={s?.pending ?? 0} />
        <StatCard label="성공률" value={s ? `${Math.round(s.successRate * 100)}%` : "0%"} />
        <StatCard label="성공" value={s?.success ?? 0} />
        <StatCard label="실패" value={s?.failed ?? 0} />
      </div>
      {s && s.success + s.failed > 0 && (
        <SuccessRateChart success={s.success} failed={s.failed} />
      )}
      <h3>최근 작업</h3>
      <JobsTable jobs={(recent.data ?? []).slice(0, 5)} />
    </section>
  );
}
