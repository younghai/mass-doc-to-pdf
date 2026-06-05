import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { JobDTO } from "@hwptopdf/shared";
import { api } from "../api/client";
import { Dropzone } from "../components/Dropzone";
import { StatusPill } from "../components/StatusPill";

export function Upload() {
  const qc = useQueryClient();
  const [result, setResult] = useState<JobDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handle(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const job = await api.upload(file);
      setResult(job);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>문서 업로드</h2>
      <Dropzone onFile={handle} disabled={busy} />
      {busy && <p>변환 중…</p>}
      {error && (
        <p className="error" role="alert">
          업로드 실패: {error}
        </p>
      )}
      {result && (
        <div className="upload-result">
          <StatusPill status={result.status} />
          <span className="filename">{result.filename}</span>
          {result.status === "failed" && <span className="error">사유: {result.error}</span>}
          <Link to={`/jobs/${result.id}`}>상세 보기</Link>
        </div>
      )}
    </section>
  );
}
