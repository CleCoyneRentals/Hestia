-- AlterTable: add auth_id column as nullable first, then enforce NOT NULL.
-- This two-step pattern is safe for both empty and non-empty tables:
-- ADD COLUMN succeeds regardless of existing rows; SET NOT NULL only fails if
-- nulls exist (they won't on a fresh database). A backfill step can be added
-- between the two statements if migrating a table with existing users.
ALTER TABLE "users" ADD COLUMN "auth_id" TEXT;

-- Backfill step (uncomment if migrating a table with existing rows):
-- UPDATE "users" SET "auth_id" = id WHERE "auth_id" IS NULL;

ALTER TABLE "users" ALTER COLUMN "auth_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_id_key" ON "users"("auth_id");
