CREATE TABLE "SearchDocument" (
  "jobId" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "outputKey" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "generation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "totalPages" INTEGER NOT NULL DEFAULT 0,
  "indexedPages" INTEGER NOT NULL DEFAULT 0,
  "omittedPages" TEXT NOT NULL DEFAULT '[]',
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseUntil" DATETIME,
  "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "SearchDocument_status_nextAttemptAt_leaseUntil_idx" ON "SearchDocument"("status", "nextAttemptAt", "leaseUntil");
CREATE INDEX "SearchDocument_userId_status_idx" ON "SearchDocument"("userId", "status");
CREATE TABLE "SearchPage" (
  "jobId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "key" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "providerId" TEXT,
  "indexed" BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY ("jobId", "pageNumber"),
  CONSTRAINT "SearchPage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SearchDocument"("jobId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SearchPage_key_key" ON "SearchPage"("key");
