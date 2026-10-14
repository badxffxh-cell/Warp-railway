-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('TEXT', 'VOICE');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateTable
CREATE TABLE "servers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_members" (
    "serverId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_members_pkey" PRIMARY KEY ("serverId","userId")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "serverId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "channelId" UUID NOT NULL,
    "authorId" UUID,
    "clientId" UUID NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "realtime_tickets" (
    "hash" CHAR(64) NOT NULL,
    "sessionId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realtime_tickets_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "voice_sessions" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "room" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "servers_ownerId_idx" ON "servers"("ownerId");

-- CreateIndex
CREATE INDEX "server_members_userId_idx" ON "server_members"("userId");

-- CreateIndex
CREATE INDEX "channels_serverId_position_idx" ON "channels"("serverId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "invites_codeHash_key" ON "invites"("codeHash");

-- CreateIndex
CREATE INDEX "invites_serverId_idx" ON "invites"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_sequence_key" ON "messages"("sequence");

-- CreateIndex
CREATE INDEX "messages_channelId_sequence_idx" ON "messages"("channelId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "messages_channelId_authorId_clientId_key" ON "messages"("channelId", "authorId", "clientId");

-- CreateIndex
CREATE INDEX "realtime_tickets_expiresAt_idx" ON "realtime_tickets"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "voice_sessions_sessionId_key" ON "voice_sessions"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "voice_sessions_identity_key" ON "voice_sessions"("identity");

-- CreateIndex
CREATE INDEX "voice_sessions_channelId_idx" ON "voice_sessions"("channelId");

-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "servers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realtime_tickets" ADD CONSTRAINT "realtime_tickets_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

