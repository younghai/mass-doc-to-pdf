import type { Prisma } from "@prisma/client";

/** Keep the manifest after deletion so an interrupted upload can still be removed. */
export async function tombstoneSearch(tx: Prisma.TransactionClient, userId: string, jobId: string): Promise<void> {
  const document = await tx.searchDocument.findFirst({ where: { jobId, userId } });
  if (!document || document.status === "deleted" || document.status === "deleting") return;
  const settleAfter = Math.max(Date.now(), document.leaseUntil?.getTime() ?? 0) + 60_000;
  await tx.searchDocument.update({
    where: { jobId },
    data: { status: "deleting", error: null, attempts: 0, nextAttemptAt: new Date(settleAfter) },
  });
  await tx.searchPage.updateMany({ where: { jobId }, data: { text: "" } });
}
