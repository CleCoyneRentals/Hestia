-- AlterTable
ALTER TABLE "users" ADD COLUMN "clerk_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users"("clerk_user_id");
