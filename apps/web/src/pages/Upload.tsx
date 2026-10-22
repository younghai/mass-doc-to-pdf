import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversionMode, JobDTO } from "@hwptopdf/shared";
import { api, MAX_UPLOAD_BYTES } from "../api/client";
import { Dropzone } from "../components/Dropzone";
import { StatusPill } from "../components/StatusPill";
import { humanSize } from "../format";
import { QUALITY_MODE_HELP, QUALITY_MODE_LABEL } from "../qualityView";

export function Upload() {
  const qc = useQueryClient();
  const [result, setResult] = useState<JobDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qualityMode, setQualityMode] = useState<ConversionMode>("precise");

  async function handle(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setResult(null);
      setError(`파일은 최대 ${humanSize(MAX_UPLOAD_BYTES)}까지 업로드할 수 있습니다.`);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const job = await api.upload(file, qualityMode);
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
      <div className="section-head">
        <div>
          <h2>문서 업로드</h2>
          <p>파일을 등록하면 작업 큐에서 변환 상태가 자동 갱신됩니다.</p>
        </div>
      </div>
      <div className="quality-mode" role="group" aria-label="품질 모드">
        {(["precise", "quick"] as const).map((mode) => (
          <label key={mode} className={qualityMode === mode ? "active" : ""}>
            <input
              type="radio"
              name="qualityMode"
              value={mode}
              aria-label={QUALITY_MODE_LABEL[mode]}
              checked={qualityMode === mode}
              onChange={() => setQualityMode(mode)}
            />
            <strong>{QUALITY_MODE_LABEL[mode]}</strong>
            <span>{QUALITY_MODE_HELP[mode]}</span>
          </label>
        ))}
      </div>
      <Dropzone onFile={handle} disabled={busy} />
      {busy && <p>업로드 중…</p>}
      {error && (
        <p className="error" role="alert">
          업로드 실패: {error}
        </p>
      )}
      {result && (
        <div className="upload-result">
          <StatusPill status={result.status} />
          <span className="filename">{result.filename}</span>
          <span>{QUALITY_MODE_LABEL[qualityMode]}</span>
          {result.status === "running" && <span>작업 큐에서 변환 중입니다.</span>}
          {result.status === "pending" && <span>작업 대기열에 등록됐습니다.</span>}
          {result.status === "failed" && <span className="error">사유: {result.error}</span>}
          <Link to={`/service/jobs/${result.id}`}>상세 보기</Link>
        </div>
      )}
    </section>
  );
}
