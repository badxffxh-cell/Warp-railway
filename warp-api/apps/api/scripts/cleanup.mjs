import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const db = new PrismaClient();
try {
  const now = new Date();
  const [sessions, tokens] = await db.$transaction([
    db.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { absoluteExpiresAt: { lt: now } }] },
    }),
    db.accountToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] },
    }),
  ]);
  console.log(
    JSON.stringify({ expiredSessionsRemoved: sessions.count, obsoleteTokensRemoved: tokens.count }),
  );
} finally {
  await db.$disconnect();
}
