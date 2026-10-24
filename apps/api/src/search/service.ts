import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, SearchDocument } from "@prisma/client";
import type { DocumentSearchHit, DocumentSearchRequest, DocumentSearchResponse, SearchIndexDTO, SearchIndexStatus } from "@hwptopdf/shared";
import type { Storage } from "../storage/s3.js";
import type { PdfTextExtractor, SearchProvider } from "./types.js";
import { tombstoneSearch } from "./lifecycle.js";

const LEASE_MS = 180_000;
const INDEX_DEADLINE_MS = 24 * 60 * 60_000;
const ACTIVE_STATES = ["queued", "extracting", "indexing", "deleting"];

export class SearchOperationError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

function ownerFolder(userId: string): string {
  return `owners/${createHash("sha256").update(userId).digest("hex").slice(0, 32)}`;
}

function parseStatus(status: string): SearchIndexStatus {
  switch (status) {
    case "queued": case "extracting": case "indexing": case "ready":
    case "failed": case "deleting": case "deleted": return status;
    default: return "failed";
  }
}

function omittedPages(json: string): readonly number[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((page): page is number => typeof page === "number" && Number.isInteger(page) && page > 0) : [];
  } catch { return []; }
}

function dto(row: SearchDocument | null, enabled: boolean): SearchIndexDTO {
  return {
    enabled, status: row ? parseStatus(row.status) : "not_indexed",
    totalPages: row?.totalPages ?? 0, indexedPages: row?.indexedPages ?? 0,
    omittedPages: omittedPages(row?.omittedPages ?? "[]"),
    error: row?.error ?? null, updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/** Search state is separate from conversion state, including failure and deletion. */
export class DocumentSearchService {
  private readonly activeUsers = new Set<string>();
  private orphanCursor: string | undefined;

  constructor(
    private readonly db: PrismaClient,
    private readonly storage: Storage,
    private readonly extractor: PdfTextExtractor,
    private readonly provider: SearchProvider | null,
  ) {}

  get enabled(): boolean { return this.provider !== null; }

  private requireProvider(): SearchProvider {
    if (!this.provider) throw new SearchOperationError(503, "문서 검색 연결이 설정되지 않았습니다.");
    return this.provider;
  }

  async status(userId: string, jobId: string): Promise<SearchIndexDTO> {
    const job = await this.db.conversionJob.findFirst({ where: { id: jobId, userId }, select: { id: true } });
    if (!job) throw new SearchOperationError(404, "문서를 찾을 수 없습니다.");
    return dto(await this.db.searchDocument.findFirst({ where: { jobId, userId } }), this.enabled);
  }

  async register(userId: string, jobId: string, confirmReview: boolean): Promise<SearchIndexDTO> {
    const provider = this.requireProvider();
    const row = await this.db.$transaction(async (tx) => {
      const job = await tx.conversionJob.findFirst({ where: { id: jobId, userId } });
      if (!job) throw new SearchOperationError(404, "문서를 찾을 수 없습니다.");
      if (job.status !== "success" || !job.outputKey || job.qualityStatus === "failed") {
        throw new SearchOperationError(409, "변환이 완료된 PDF만 검색에 등록할 수 있습니다.");
      }
      if (job.qualityStatus !== "passed" && !confirmReview) {
        throw new SearchOperationError(409, "PDF 품질을 직접 확인한 뒤 검색 등록에 동의해 주세요.");
      }
      const existing = await tx.searchDocument.findUnique({ where: { jobId } });
      if (existing && existing.status !== "deleted") {
        if (existing.providerScope !== provider.scope || existing.outputKey !== job.outputKey) {
          throw new SearchOperationError(409, "기존 검색 색인을 먼저 삭제하고 원격 정리가 완료된 뒤 다시 등록해 주세요.");
        }
        if (existing.status === "deleting") throw new SearchOperationError(409, "원격 검색 데이터 삭제가 진행 중입니다.");
        if (existing.status !== "failed") return existing;
        const hasPages = await tx.searchPage.count({ where: { jobId } }) > 0;
        return tx.searchDocument.update({
          where: { jobId },
          data: { status: hasPages ? "indexing" : "queued", error: null, attempts: 0, startedAt: new Date(), nextAttemptAt: new Date(), leaseToken: null, leaseUntil: null },
        });
      }
      if (await tx.searchDocument.count({ where: { userId, status: { not: "deleted" } } }) >= 100) {
        throw new SearchOperationError(429, "사용자당 검색 문서는 최대 100개입니다. 기존 색인을 삭제한 뒤 다시 시도해 주세요.");
      }
      const data = { userId, outputKey: job.outputKey, providerScope: provider.scope, generation: randomUUID(), status: "queued", totalPages: 0, indexedPages: 0, omittedPages: "[]", error: null, attempts: 0, startedAt: new Date(), nextAttemptAt: new Date(), leaseToken: null, leaseUntil: null };
      return tx.searchDocument.upsert({ where: { jobId }, create: { jobId, ...data }, update: data });
    });
    return dto(row, true);
  }

  async remove(userId: string, jobId: string): Promise<SearchIndexDTO> {
    await this.status(userId, jobId);
    await this.db.$transaction((tx) => tombstoneSearch(tx, userId, jobId));
    return this.status(userId, jobId);
  }

  private async visibleJobs(userId: string, ids: readonly string[]) {
    if (ids.length === 0) return new Map<string, string>();
    const docs = await this.db.searchDocument.findMany({ where: { jobId: { in: [...ids] }, userId, status: "ready", providerScope: this.provider?.scope } });
    const jobs = await this.db.conversionJob.findMany({ where: { id: { in: docs.map((d) => d.jobId) }, userId, status: "success", OR: [{ qualityStatus: null }, { qualityStatus: { not: "failed" } }] } });
    const snapshots = new Map(docs.map((d) => [d.jobId, d.outputKey]));
    return new Map(jobs.filter((j) => j.outputKey === snapshots.get(j.id)).map((j) => [j.id, j.filename]));
  }

  async search(userId: string, input: DocumentSearchRequest): Promise<DocumentSearchResponse> {
    const provider = this.requireProvider();
    if (this.activeUsers.has(userId)) throw new SearchOperationError(429, "진행 중인 검색이 끝난 뒤 다시 시도해 주세요.");
    this.activeUsers.add(userId);
    try {
      await provider.checkConfiguration();
      const candidates = await provider.search({ query: input.query, folder: ownerFolder(userId), rewrite: input.rewrite === true, rerank: input.rerank === true });
      const pages = await this.db.searchPage.findMany({
        where: { key: { in: candidates.slice(0, 50).map((hit) => hit.key) }, indexed: true, document: { userId, status: "ready", providerScope: provider.scope } },
      });
      const byKey = new Map(pages.map((page) => [page.key, page]));
      const visible = await this.visibleJobs(userId, pages.map((page) => page.jobId));
      const results: DocumentSearchHit[] = [];
      const seen = new Set<string>();
      for (const hit of candidates.slice(0, 50)) {
        const page = byKey.get(hit.key);
        if (!page || seen.has(hit.key)) continue;
        const filename = visible.get(page.jobId);
        if (filename === undefined) continue;
        seen.add(hit.key);
        // The provider chooses the page; returned content always comes from our authorized manifest.
        const text = page.text.replace(/\s+/g, " ").trim();
        const start = Math.max(0, text.indexOf(hit.text.replace(/\s+/g, " ").trim().slice(0, 100)));
        results.push({ citationId: `S${results.length + 1}`, jobId: page.jobId, filename, pageNumber: page.pageNumber, text: text.slice(start, start + 2400), score: hit.score });
        if (results.length >= 10) break;
      }
      let answer: string | null = null;
      const warnings: string[] = [];
      if (input.answer && results.length > 0) {
        try {
          const generated = await provider.answer(input.query, results.map(({ citationId, text }) => ({ citationId, text })));
          const citations = [...generated.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
          const allowed = new Set(results.map((hit) => hit.citationId));
          if (citations.length > 0 && citations.every((id) => allowed.has(id))) answer = generated;
          else warnings.push("답변의 출처 표기를 확인할 수 없어 검색 결과만 표시합니다.");
        } catch { warnings.push("답변 생성에 실패했습니다. 검색 결과와 원문을 확인해 주세요."); }
      } else if (input.answer) warnings.push("관련 근거를 찾지 못해 답변을 생성하지 않았습니다.");
      const stillVisible = await this.visibleJobs(userId, results.map((hit) => hit.jobId));
      const currentResults = results.filter((hit) => stillVisible.has(hit.jobId));
      if (currentResults.length !== results.length) {
        answer = null;
        warnings.push("처리 중 문서 상태가 변경되어 일부 결과와 답변을 제외했습니다.");
      }
      if (answer) warnings.push("AI 답변은 오류가 있을 수 있습니다. 출처 페이지에서 내용을 확인해 주세요.");
      return { query: input.query, results: currentResults, answer, warnings };
    } finally { this.activeUsers.delete(userId); }
  }

  /**
   * One bounded page operation per claim. No HTTP request waits for indexing.
   * Returns true when a claim was processed (work happened, more may be
   * queued) so the scheduler can keep a short tick; false when idle.
   */
  async runOnce(): Promise<boolean> {
    const provider = this.provider;
    if (!provider) return false;
    await this.markOrphans();
    const now = new Date();
    const candidate = await this.db.searchDocument.findFirst({
      where: { status: { in: ACTIVE_STATES }, nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      orderBy: { nextAttemptAt: "asc" },
    });
    if (!candidate) return false;
    const token = randomUUID();
    const claim = await this.db.searchDocument.updateMany({
      where: { jobId: candidate.jobId, status: candidate.status, nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
    if (!claim.count) return false;
    try {
      if (candidate.providerScope !== provider.scope) throw new Error("provider scope changed");
      if (candidate.status === "deleting") await this.deleteStep(candidate, token, provider);
      else {
        const job = await this.db.conversionJob.findFirst({ where: { id: candidate.jobId, userId: candidate.userId, status: "success", outputKey: candidate.outputKey } });
        if (!job) {
          await this.db.$transaction((tx) => tombstoneSearch(tx, candidate.userId, candidate.jobId));
          return true;
        }
        if (Date.now() - candidate.startedAt.getTime() > INDEX_DEADLINE_MS) {
          await this.db.searchDocument.updateMany({ where: { jobId: candidate.jobId, leaseToken: token, status: { not: "deleting" } }, data: { status: "failed", error: "색인 준비 시간이 24시간을 초과했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요." } });
          return true;
        }
        await provider.checkConfiguration();
        if (candidate.status === "queued" || candidate.status === "extracting") await this.extract(candidate, token);
        else await this.indexStep(candidate, token, provider);
      }
    } catch {
      const attempts = candidate.attempts + 1;
      await this.db.searchDocument.updateMany({
        where: { jobId: candidate.jobId, leaseToken: token, status: candidate.status === "deleting" ? "deleting" : { not: "deleting" } },
        data: {
          status: candidate.status === "deleting" ? "deleting" : attempts >= 5 ? "failed" : candidate.status,
          attempts, error: candidate.providerScope !== provider.scope
            ? "검색 연결 대상이 변경되었습니다. 이전 연결 설정으로 복구한 뒤 색인을 삭제해 주세요."
            : candidate.status === "deleting" ? "원격 검색 데이터 정리를 재시도하고 있습니다."
            : "텍스트 추출 또는 검색 연결 처리에 실패했습니다. PDF 텍스트와 검색 설정을 확인해 주세요.",
          nextAttemptAt: new Date(Date.now() + Math.min(60 * 60_000, 10_000 * 2 ** Math.min(attempts, 8))),
        },
      });
    } finally {
      await this.db.searchDocument.updateMany({ where: { jobId: candidate.jobId, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
    }
    return true;
  }

  private async extract(doc: SearchDocument, token: string): Promise<void> {
    const current = await this.db.searchDocument.updateMany({ where: { jobId: doc.jobId, leaseToken: token, status: { in: ["queued", "extracting"] } }, data: { status: "extracting" } });
    if (!current.count) return;
    const extracted = await this.extractor.extract(Buffer.from(await this.storage.get(doc.outputKey)));
    await this.db.$transaction(async (tx) => {
      const live = await tx.searchDocument.findFirst({ where: { jobId: doc.jobId, leaseToken: token, status: "extracting" } });
      if (!live) return;
      // Bulk rewrite instead of one upsert per page: a large PDF means hundreds
      // to thousands of sequential queries inside a single write transaction,
      // stalling every other writer on the shared SQLite file. Pages are only
      // consumed after this transaction commits, so replace-all is equivalent
      // to the per-page upsert (extract is atomic — pages are never partial).
      await tx.searchPage.deleteMany({ where: { jobId: doc.jobId } });
      if (extracted.pages.length > 0) {
        await tx.searchPage.createMany({
          data: extracted.pages.map((page) => ({
            jobId: doc.jobId,
            pageNumber: page.pageNumber,
            text: page.text,
            key: `${ownerFolder(doc.userId)}/${doc.generation}/page-${page.pageNumber}.txt`,
          })),
        });
      }
      await tx.searchDocument.update({ where: { jobId: doc.jobId }, data: {
        status: extracted.pages.length ? "indexing" : "failed", totalPages: extracted.totalPages,
        omittedPages: JSON.stringify(extracted.omittedPages), attempts: 0, nextAttemptAt: new Date(),
        error: extracted.pages.length ? null : "검색 가능한 텍스트가 없습니다. 스캔 PDF는 OCR 처리가 필요합니다.",
      } });
    });
  }

  private async indexStep(doc: SearchDocument, token: string, provider: SearchProvider): Promise<void> {
    const page = await this.db.searchPage.findFirst({ where: { jobId: doc.jobId, indexed: false }, orderBy: { pageNumber: "asc" } });
    if (!page) {
      await this.db.searchDocument.updateMany({ where: { jobId: doc.jobId, leaseToken: token, status: "indexing" }, data: { status: "ready", error: null, attempts: 0 } });
      return;
    }
    const item = page.providerId ? { id: page.providerId } : await provider.ensureItem(page.key, page.text);
    const state = await provider.itemStatus(item.id);
    if (state === "failed") {
      // Remove a failed remote item before an explicit or automatic retry.
      await provider.deleteKey(page.key);
      await this.db.searchPage.updateMany({ where: { jobId: doc.jobId, pageNumber: page.pageNumber }, data: { providerId: null } });
      throw new Error("remote item failed");
    }
    await this.db.$transaction(async (tx) => {
      const live = await tx.searchDocument.findFirst({ where: { jobId: doc.jobId, leaseToken: token, status: "indexing" } });
      if (!live) return;
      await tx.searchPage.update({ where: { jobId_pageNumber: { jobId: doc.jobId, pageNumber: page.pageNumber } }, data: { providerId: item.id, indexed: state === "ready" } });
      await tx.searchDocument.update({ where: { jobId: doc.jobId }, data: { indexedPages: { increment: state === "ready" ? 1 : 0 }, attempts: 0, error: null, nextAttemptAt: new Date(Date.now() + (state === "pending" ? 5000 : 0)) } });
    });
  }

  private async deleteStep(doc: SearchDocument, token: string, provider: SearchProvider): Promise<void> {
    const page = await this.db.searchPage.findFirst({ where: { jobId: doc.jobId }, orderBy: { pageNumber: "asc" } });
    if (page) {
      await provider.deleteKey(page.key);
      await this.db.$transaction(async (tx) => {
        if (!await tx.searchDocument.findFirst({ where: { jobId: doc.jobId, leaseToken: token, status: "deleting" } })) return;
        await tx.searchPage.delete({ where: { jobId_pageNumber: { jobId: doc.jobId, pageNumber: page.pageNumber } } });
        await tx.searchDocument.update({ where: { jobId: doc.jobId }, data: { nextAttemptAt: new Date(), attempts: 0, error: null } });
      });
      return;
    }
    await this.db.searchDocument.updateMany({ where: { jobId: doc.jobId, leaseToken: token, status: "deleting" }, data: { status: "deleted", indexedPages: 0, totalPages: 0, omittedPages: "[]", error: null, outputKey: "" } });
  }

  private async markOrphans(): Promise<void> {
    const docs = await this.db.searchDocument.findMany({
      where: { status: { notIn: ["deleted", "deleting"] }, ...(this.orphanCursor ? { jobId: { gt: this.orphanCursor } } : {}) },
      orderBy: { jobId: "asc" }, take: 20,
    });
    this.orphanCursor = docs.length === 20 ? docs[docs.length - 1]?.jobId : undefined;
    const jobs = await this.db.conversionJob.findMany({ where: { id: { in: docs.map((doc) => doc.jobId) } }, select: { id: true, userId: true, status: true, outputKey: true } });
    for (const doc of docs) {
      if (!jobs.some((job) => job.id === doc.jobId && job.userId === doc.userId && job.status === "success" && job.outputKey === doc.outputKey)) {
        await this.db.$transaction((tx) => tombstoneSearch(tx, doc.userId, doc.jobId));
      }
    }
  }
}

export function startSearchWorker(service: DocumentSearchService, onError: () => void): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  // 1s while there is claimable work, 5s once idle: a fixed 1s tick meant the
  // API ran ~3 SQLite queries per second forever on deployments where search is
  // enabled but nothing is being indexed.
  const ACTIVE_DELAY_MS = 1_000;
  const IDLE_DELAY_MS = 5_000;
  const schedule = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      pending = service
        .runOnce()
        .catch(onError)
        .then((worked) => schedule(worked === true ? ACTIVE_DELAY_MS : IDLE_DELAY_MS));
    }, delayMs);
    timer.unref();
  };
  schedule(IDLE_DELAY_MS);
  return async () => { stopped = true; if (timer) clearTimeout(timer); await pending; };
}
