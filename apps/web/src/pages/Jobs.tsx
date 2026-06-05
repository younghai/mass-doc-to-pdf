import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { JobStatus } from "@hwptopdf/shared";
import { api } from "../api/client";
import { JobsTable } from "../components/JobsTable";

const TABS: { key: "all" | JobStatus; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "success", label: "성공" },
  { key: "failed", label: "실패" },
];

export function Jobs() {
  const [tab, setTab] = useState<"all" | JobStatus>("all");
  const status = tab === "all" ? undefined : tab;
  const { data, isLoading } = useQuery({
    queryKey: ["jobs", tab],
    queryFn: () => api.listJobs(status),
  });

  return (
    <section>
      <h2>변환 내역</h2>
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
