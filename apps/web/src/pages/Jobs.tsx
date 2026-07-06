import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { JobStatus } from "@hwptopdf/shared";
import { api, type JobListFilters } from "../api/client";
import { JobsTable } from "../components/JobsTable";

type JobsTabKey = "all" | JobStatus | "quality-review";

const TABS: { readonly key: JobsTabKey; readonly label: string }[] = [
  { key: "all", label: "전체" },
  { key: "running", label: "진행 중" },
  { key: "pending", label: "대기" },
  { key: "success", label: "성공" },
  { key: "failed", label: "실패" },
  { key: "quality-review", label: "저품질(review)" },
];

function filtersFor(tab: JobsTabKey): JobListFilters {
  switch (tab) {
    case "all":
      return {};
    case "quality-review":
      return { status: "success", qualityStatus: "review" };
    default:
      return { status: tab };
  }
}

export function Jobs() {
  const [tab, setTab] = useState<JobsTabKey>("all");
  const filters = filtersFor(tab);
  const { data, isLoading } = useQuery({
    queryKey: ["jobs", tab],
    queryFn: () => api.listJobs(filters),
    refetchInterval: 2_000,
  });

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>작업 큐</h2>
          <p>진행 중인 변환과 실패 작업을 우선 확인합니다.</p>
        </div>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isLoading ? <p>로딩 중…</p> : <JobsTable jobs={data ?? []} />}
    </section>
  );
}
