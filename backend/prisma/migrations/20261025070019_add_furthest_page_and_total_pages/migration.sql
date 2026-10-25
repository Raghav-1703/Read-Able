-- AlterTable
ALTER TABLE "ReadingProgress" ADD COLUMN     "furthestPage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalPages" INTEGER,
ALTER COLUMN "lastPage" SET DEFAULT 1;

-- Backfill existing records furthestPage to match lastPage
UPDATE "ReadingProgress" SET "furthestPage" = "lastPage" WHERE "furthestPage" = 0;
