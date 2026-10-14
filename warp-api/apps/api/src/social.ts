import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { usernameSchema, type RealtimeEvent } from '@warp/shared';
import { HttpError } from './security.js';

const select = { id: true, username: true, displayName: true, avatarVersion: true } as const;
const profile = (u: Prisma.UserGetPayload<{ select: typeof select }>) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarUrl: u.avatarVersion ? `/v1/users/${u.id}/avatar?v=${u.avatarVersion}` : null,
});
export async function installSocial(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (r: FastifyRequest) => Promise<void>,
  notify: (ids: string[], event: RealtimeEvent) => Promise<void>,
  removeVoice: (where: Prisma.VoiceSessionWhereInput) => Promise<void>,
) {
  const auth = { preHandler: authenticate };
  const fail = (status: number, message: string): never => {
    throw new HttpError(status, 'FRIENDSHIP', message);
  };
  const pair = (a: string, b: string) => {
    const [userAId, userBId] = [a, b].sort();
    return { userAId: userAId!, userBId: userBId! };
  };
  const blocked = (tx: Prisma.TransactionClient, a: string, b: string) =>
    tx.userBlock.count({
      where: {
        OR: [
          { userId: a, targetId: b },
          { userId: b, targetId: a },
        ],
      },
    });
  async function lock(tx: Prisma.TransactionClient, a: string, b: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${[a, b].sort().join(':')}))`;
  }
  function changed(a: string, b: string) {
    void notify([a, b], { type: 'friends.changed' }).catch(() =>
      app.log.error('Friend notification failed'),
    );
  }
  app.get('/v1/friends', auth, async (req) => {
    const uid = req.auth!.user.id;
    const rows = await db.friendship.findMany({
      where: { OR: [{ userAId: uid }, { userBId: uid }] },
      include: { userA: { select }, userB: { select }, channel: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      friends: rows.map((f) => ({
        id: f.id,
        user: profile(f.userAId === uid ? f.userB : f.userA),
        status: f.status,
        incoming: f.requestedBy !== uid,
        channel: f.channel
          ? { ...f.channel, name: (f.userAId === uid ? f.userB : f.userA).displayName }
          : null,
      })),
    };
  });
  app.post(
    '/v1/friends',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { username } = z
        .object({
          username: z
            .string()
            .transform((v) => v.trim().replace(/^@/, ''))
            .pipe(usernameSchema),
        })
        .strict()
        .parse(req.body);
      const uid = req.auth!.user.id,
        target = await db.user.findUnique({ where: { username }, select });
      if (!target || target.id === uid)
        return fail(400, 'Não foi possível enviar a solicitação para esse @username.');
      await db.$transaction(async (tx) => {
        await lock(tx, uid, target.id);
        if (await blocked(tx, uid, target.id))
          return fail(400, 'Não foi possível enviar a solicitação para esse @username.');
        const key = pair(uid, target.id);
        if (await tx.friendship.findUnique({ where: { userAId_userBId: key } }))
          return fail(409, 'Já existe uma amizade ou solicitação com essa pessoa.');
        await tx.friendship.create({ data: { ...key, requestedBy: uid } });
      });
      changed(uid, target.id);
      return reply.code(201).send({ ok: true });
    },
  );
  app.post('/v1/friends/:id/accept', auth, async (req) => {
    const id = z
        .string()
        .uuid()
        .parse((req.params as { id: string }).id),
      uid = req.auth!.user.id;
    const initial = await db.friendship.findUnique({ where: { id } });
    if (!initial || ![initial.userAId, initial.userBId].includes(uid))
      return fail(404, 'Solicitação não encontrada.');
    await db.$transaction(async (tx) => {
      await lock(tx, initial.userAId, initial.userBId);
      const f = await tx.friendship.findUnique({ where: { id } });
      if (
        !f ||
        f.status !== 'PENDING' ||
        f.requestedBy === uid ||
        (await blocked(tx, f.userAId, f.userBId))
      )
        return fail(403, 'Esta solicitação não pode ser aceita.');
      await tx.friendship.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          channel: { create: { name: 'Conversa privada', kind: 'TEXT' } },
        },
      });
    });
    changed(initial.userAId, initial.userBId);
    return { ok: true };
  });
  app.delete('/v1/friends/:id', auth, async (req) => {
    const id = z
        .string()
        .uuid()
        .parse((req.params as { id: string }).id),
      uid = req.auth!.user.id;
    const f = await db.friendship.findUnique({ where: { id } });
    if (!f || ![f.userAId, f.userBId].includes(uid)) return fail(404, 'Amizade não encontrada.');
    // Delete authorization first; even a temporary SFU outage cannot restore access.
    const channelId = await db.$transaction(async (tx) => {
      await lock(tx, f.userAId, f.userBId);
      const current = await tx.friendship.findUnique({ where: { id } });
      await tx.friendship.deleteMany({ where: { id } });
      if (current?.channelId) await tx.channel.deleteMany({ where: { id: current.channelId } });
      return current?.channelId;
    });
    if (channelId)
      void removeVoice({ channelId }).catch(() => app.log.error('Voice cleanup pending'));
    changed(f.userAId, f.userBId);
    return { ok: true };
  });
  app.get('/v1/blocks', auth, async (req) => ({
    users: (
      await db.userBlock.findMany({
        where: { userId: req.auth!.user.id },
        include: { target: { select } },
      })
    ).map((b) => profile(b.target)),
  }));
  app.post('/v1/blocks', auth, async (req) => {
    const { userId: targetId } = z.object({ userId: z.string().uuid() }).strict().parse(req.body),
      uid = req.auth!.user.id;
    if (uid === targetId || !(await db.user.findUnique({ where: { id: targetId } })))
      return fail(400, 'Usuário inválido.');
    const channelId = await db.$transaction(async (tx) => {
      await lock(tx, uid, targetId);
      const f = await tx.friendship.findUnique({ where: { userAId_userBId: pair(uid, targetId) } });
      await tx.userBlock.upsert({
        where: { userId_targetId: { userId: uid, targetId } },
        create: { userId: uid, targetId },
        update: {},
      });
      if (f) await tx.friendship.delete({ where: { id: f.id } });
      if (f?.channelId) await tx.channel.deleteMany({ where: { id: f.channelId } });
      return f?.channelId;
    });
    if (channelId)
      void removeVoice({ channelId }).catch(() => app.log.error('Voice cleanup pending'));
    changed(uid, targetId);
    return { ok: true };
  });
  app.delete('/v1/blocks/:id', auth, async (req) => {
    const targetId = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    await db.userBlock.deleteMany({ where: { userId: req.auth!.user.id, targetId } });
    return { ok: true };
  });
}
