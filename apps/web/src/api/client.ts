import {
  type BatchDTO,
  MAX_UPLOAD_BYTES,
  type ConversionMode,
  type JobDTO,
  type JobStatus,
  type QualityReport,
  type QualityStatus,
  type StatsDTO,
} from "@hwptopdf/shared";

export type JobListFilters = {
  readonly status?: JobStatus;
  readonly qualityStatus?: QualityStatus;
};

export interface SessionInfo {
  user?: { email?: string | null; name?: string | null; image?: string | null };
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  async session(): Promise<SessionInfo | null> {
    const r = await fetch("/api/auth/session");
    if (!r.ok) return null;
    return r.json() as Promise<SessionInfo>;
  },
  listJobs(filters: JobListFilters = {}): Promise<JobDTO[]> {
    const q = new URLSearchParams();
    if (filters.status) q.set("status", filters.status);
    if (filters.qualityStatus) q.set("qualityStatus", filters.qualityStatus);
    const query = q.toString();
    return fetch(`/api/jobs${query ? `?${query}` : ""}`).then((r) => asJson<JobDTO[]>(r));
  },
  getJob(id: string): Promise<JobDTO> {
    return fetch(`/api/jobs/${id}`).then((r) => asJson<JobDTO>(r));
  },
  async getQualityReport(id: string): Promise<QualityReport | null> {
    const r = await fetch(`/api/jobs/${id}/quality`);
    if (r.status === 404 || r.status === 409) return null;
    return asJson<QualityReport>(r);
  },
  getStats(): Promise<StatsDTO> {
    return fetch("/api/stats").then((r) => asJson<StatsDTO>(r));
  },
  getBatch(id: string): Promise<BatchDTO> {
    return fetch(`/api/batches/${encodeURIComponent(id)}`).then((r) => asJson<BatchDTO>(r));
  },
  async upload(file: File, qualityMode: ConversionMode = "precise", batchId?: string): Promise<JobDTO> {
    const fd = new FormData();
    fd.append("file", file);
    const q = new URLSearchParams({ qualityMode });
    if (batchId) q.set("batchId", batchId);
    const r = await fetch(`/api/convert?${q.toString()}`, { method: "POST", body: fd });
    return asJson<JobDTO>(r);
  },
  async retryJob(id: string): Promise<JobDTO> {
    const r = await fetch(`/api/jobs/${id}/retry`, { method: "POST" });
    return asJson<JobDTO>(r);
  },
  async deleteJob(id: string): Promise<void> {
    const r = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new Error(`delete failed: ${r.status}`);
  },
  downloadUrl: (id: string) => `/api/jobs/${id}/download`,
  batchDownloadUrl: (id: string) => `/api/batches/${encodeURIComponent(id)}/download`,
  previewUrl: (id: string) => `/api/jobs/${id}/preview`,
  previewImageUrl: (id: string) => `/api/jobs/${id}/preview.png`,
  signInUrl: () => "/api/auth/signin/google",
  signOutUrl: () => "/api/auth/signout",
};

export const ACCEPTED_EXTENSIONS = [
  ".hwp",
  ".hwpx",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".pptx",
  ".ppt",
];

export { MAX_UPLOAD_BYTES };
