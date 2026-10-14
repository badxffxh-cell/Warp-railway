-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- AlterTable
ALTER TABLE "channels" ALTER COLUMN "serverId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "friendships" (
    "id" UUID NOT NULL,
    "userAId" UUID NOT NULL,
    "userBId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "channelId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "userId" UUID NOT NULL,
    "targetId" UUID NOT NULL,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("userId","targetId")
);

-- CreateIndex
CREATE UNIQUE INDEX "friendships_channelId_key" ON "friendships"("channelId");

-- CreateIndex
CREATE INDEX "friendships_userBId_idx" ON "friendships"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "friendships_userAId_userBId_key" ON "friendships"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "user_blocks_targetId_idx" ON "user_blocks"("targetId");

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

