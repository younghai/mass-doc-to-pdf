import { MAX_UPLOAD_BYTES, type JobDTO, type StatsDTO, type JobStatus } from "@hwptopdf/shared";

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
  listJobs(status?: JobStatus): Promise<JobDTO[]> {
    const q = status ? `?status=${status}` : "";
    return fetch(`/api/jobs${q}`).then((r) => asJson<JobDTO[]>(r));
  },
  getJob(id: string): Promise<JobDTO> {
    return fetch(`/api/jobs/${id}`).then((r) => asJson<JobDTO>(r));
  },
  getStats(): Promise<StatsDTO> {
    return fetch("/api/stats").then((r) => asJson<StatsDTO>(r));
  },
  async upload(file: File): Promise<JobDTO> {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/convert", { method: "POST", body: fd });
    return asJson<JobDTO>(r);
  },
  downloadUrl: (id: string) => `/api/jobs/${id}/download`,
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
