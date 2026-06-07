import type { InputHTMLAttributes } from "react";
import { forwardRef, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversionMode, QualityReport } from "@hwptopdf/shared";
import { ACCEPTED_EXTENSIONS, api, MAX_UPLOAD_BYTES } from "../api/client";
import { humanSize } from "../format";
import { QUALITY_MODE_HELP, QUALITY_MODE_LABEL, QUALITY_STATUS_LABEL, qualityStatus } from "../qualityView";

const MAX_BATCH_FILES = 1000;

const STATUS_LABEL = {
  ready: "등록 대기",
  uploading: "등록 중",
  queued: "큐 등록",
  success: "성공",
  review: "저품질 의심",
  retryable: "재시도 가능",
  skipped: "제외",
  failed: "실패",
} as const satisfies Record<BatchStatus, string>;

type BatchStatus = "ready" | "uploading" | "queued" | "success" | "review" | "retryable" | "skipped" | "failed";

type BatchItem = {
  readonly key: string;
  readonly file: File;
  readonly path: string;
  readonly status: BatchStatus;
  readonly message: string;
  readonly jobId: string | null;
};

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly directory?: string;
  readonly webkitdirectory?: string;
};

const DirectoryInput = forwardRef<HTMLInputElement, DirectoryInputProps>(function DirectoryInput(props, ref) {
  return <input ref={ref} {...props} />;
});

function accepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function filePath(file: File): string {
  const path = Reflect.get(file, "webkitRelativePath");
  return typeof path === "string" && path.length > 0 ? path : file.name;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "업로드 실패";
}

function initialItem(file: File, index: number): BatchItem {
  const path = filePath(file);
  const key = `${path}:${file.size}:${index}`;
  if (!accepted(file)) {
    return { key, file, path, status: "skipped", message: "지원하지 않는 형식", jobId: null };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { key, file, path, status: "skipped", message: `${humanSize(MAX_UPLOAD_BYTES)} 초과`, jobId: null };
  }
  return { key, file, path, status: "ready", message: "변환 시작 대기", jobId: null };
}

function updateItem(
  items: readonly BatchItem[],
  key: string,
  patch: Pick<BatchItem, "status" | "message" | "jobId">,
): BatchItem[] {
  return items.map((item) => (item.key === key ? { ...item, ...patch } : item));
}

export function BatchUpload() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [qualityMode, setQualityMode] = useState<ConversionMode>("precise");

  const summary = useMemo(
    () => ({
      total: items.length,
      ready: items.filter((item) => item.status === "ready").length,
      queued: items.filter((item) => item.status === "queued").length,
      success: items.filter((item) => item.status === "success").length,
      review: items.filter((item) => item.status === "review").length,
      retryable: items.filter((item) => item.status === "retryable").length,
      skippedOrFailed: items.filter((item) => item.status === "skipped" || item.status === "failed").length,
    }),
    [items],
  );

  async function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function statusFromQuality(report: QualityReport | null): Pick<BatchItem, "status" | "message"> {
    const status = qualityStatus(report);
    if (status === "passed") return { status: "success", message: "변환 완료" };
    if (status === "failed") return { status: "retryable", message: "재시도 가능" };
    return { status: "review", message: report ? QUALITY_STATUS_LABEL[status] : "품질 리포트 확인 필요" };
  }

  async function watchJob(key: string, jobId: string): Promise<void> {
    for (let index = 0; index < 60; index += 1) {
      const job = await api.getJob(jobId);
      if (job.status === "success") {
        const report = await api.getQualityReport(jobId);
        setItems((prev) => updateItem(prev, key, { ...statusFromQuality(report), jobId }));
        return;
      }
      if (job.status === "failed") {
        setItems((prev) => updateItem(prev, key, { status: "retryable", message: job.error ?? "재시도 가능", jobId }));
        return;
      }
      await wait(2_000);
    }
  }

  function handleFiles(fileList: FileList | null) {
    const selected = Array.from(fileList ?? []);
    const limited = selected.slice(0, MAX_BATCH_FILES);
    setWarning(
      selected.length > MAX_BATCH_FILES
        ? `1,000개까지만 등록했습니다. 초과 ${selected.length - MAX_BATCH_FILES}개는 제외했습니다.`
        : null,
    );
    setItems(limited.map((file, index) => initialItem(file, index)));
  }

  async function startBatch() {
    if (running) return;
    setRunning(true);
    let current = items;
    for (const item of items) {
      if (item.status !== "ready") continue;
      current = updateItem(current, item.key, { status: "uploading", message: "작업 큐 등록 중", jobId: null });
      setItems(current);
      try {
        const job = await api.upload(item.file, qualityMode);
        current = updateItem(current, item.key, { status: "queued", message: "작업 큐에 등록됨", jobId: job.id });
        void watchJob(item.key, job.id).catch((error: unknown) => {
          setItems((prev) =>
            updateItem(prev, item.key, { status: "retryable", message: errorMessage(error), jobId: job.id }),
          );
        });
      } catch (error) {
        current = updateItem(current, item.key, { status: "failed", message: errorMessage(error), jobId: null });
      }
      setItems(current);
    }
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    setRunning(false);
  }

  return (
    <section>
      <div className="section-head batch-head">
        <div>
          <h2>폴더 일괄 변환</h2>
          <p>폴더에서 최대 1,000개 문서를 선택해 작업 큐에 순차 등록합니다.</p>
        </div>
        <Link to="/service/jobs" className="btn secondary">
          작업 큐 보기
        </Link>
      </div>

      <div className="batch-panel">
        <DirectoryInput
          ref={inputRef}
          type="file"
          multiple
          directory=""
          webkitdirectory=""
          data-testid="folder-input"
          className="hidden-input"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(event) => handleFiles(event.target.files)}
        />
        <div>
          <strong>폴더 선택</strong>
          <p>지원 형식: hwp, hwpx, docx, xlsx, pptx · 파일당 최대 {humanSize(MAX_UPLOAD_BYTES)}</p>
        </div>
        <div className="quality-mode batch-mode" role="group" aria-label="품질 모드">
          {(["precise", "quick"] as const).map((mode) => (
            <label key={mode} className={qualityMode === mode ? "active" : ""}>
              <input
                type="radio"
                name="batchQualityMode"
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
        <div className="batch-actions">
          <button className="btn" type="button" onClick={() => inputRef.current?.click()} disabled={running}>
            폴더 선택
          </button>
          <button className="btn primary" type="button" onClick={startBatch} disabled={running || summary.ready === 0}>
            변환 시작
          </button>
          <button className="btn ghost" type="button" onClick={() => handleFiles(null)} disabled={running || items.length === 0}>
            초기화
          </button>
        </div>
      </div>

      {warning && (
        <p className="warning" role="alert">
          {warning}
        </p>
      )}

      <div className="batch-summary" aria-label="일괄 변환 요약">
        <div>
          <strong>{summary.total}</strong>
          <span>선택</span>
        </div>
        <div>
          <strong>{summary.ready}</strong>
          <span>등록 가능</span>
        </div>
        <div>
          <strong>{summary.queued}</strong>
          <span>큐 등록</span>
        </div>
        <div>
          <strong>{summary.success}</strong>
          <span>성공</span>
        </div>
        <div>
          <strong>{summary.review}</strong>
          <span>저품질 의심</span>
        </div>
        <div>
          <strong>{summary.retryable}</strong>
          <span>재시도 가능</span>
        </div>
        <div>
          <strong>{summary.skippedOrFailed}</strong>
          <span>제외/실패</span>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="empty">변환할 폴더를 선택하세요.</p>
      ) : (
        <table className="jobs-table batch-table">
          <thead>
            <tr>
              <th>경로</th>
              <th>크기</th>
              <th>상태</th>
              <th>결과</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <td>{item.path}</td>
                <td>{humanSize(item.file.size)}</td>
                <td>
                  <span className={`queue-status queue-status-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                </td>
                <td>{item.jobId ? <Link to={`/service/jobs/${item.jobId}`}>작업 보기</Link> : item.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
