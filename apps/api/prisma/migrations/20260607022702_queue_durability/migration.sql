-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ConversionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "engine" TEXT,
    "durationMs" INTEGER,
    "error" TEXT,
    "sourceKey" TEXT NOT NULL,
    "outputKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualityMode" TEXT,
    "batchId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    CONSTRAINT "ConversionJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ConversionJob" ("createdAt", "durationMs", "engine", "error", "extension", "filename", "format", "id", "mimeType", "outputKey", "sizeBytes", "sourceKey", "status", "userId") SELECT "createdAt", "durationMs", "engine", "error", "extension", "filename", "format", "id", "mimeType", "outputKey", "sizeBytes", "sourceKey", "status", "userId" FROM "ConversionJob";
DROP TABLE "ConversionJob";
ALTER TABLE "new_ConversionJob" RENAME TO "ConversionJob";
CREATE INDEX "ConversionJob_userId_createdAt_idx" ON "ConversionJob"("userId", "createdAt");
CREATE INDEX "ConversionJob_status_lockedAt_idx" ON "ConversionJob"("status", "lockedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
