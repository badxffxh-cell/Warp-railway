import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PrismaClient, type Prisma } from '@prisma/client';
import { z } from 'zod';
import type { WebSocket } from 'ws';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { serverSchema, channelSchema, messageSchema, type RealtimeEvent } from '@warp/shared';
import type { Config } from './config.js';
import { installSocial } from './social.js';
import { HttpError, newToken, hashToken } from './security.js';

const uuid = z.string().uuid();
const authorSelect = { id: true, username: true, displayName: true, avatarVersion: true } as const;
type Author = Prisma.UserGetPayload<{ select: typeof authorSelect }>;
const publicUser = (u: Author) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarUrl: u.avatarVersion ? `/v1/users/${u.id}/avatar?v=${u.avatarVersion}` : null,
});
const includeAuthor = { author: { select: authorSelect } } as const;
type Message = Prisma.MessageGetPayload<{ include: typeof includeAuthor }>;
const messageDto = (m: Message) => ({
  id: m.id,
  sequence: m.sequence.toString(),
  channelId: m.channelId,
  clientId: m.clientId,
  content: m.deletedAt ? '' : m.content,
  author: m.author ? publicUser(m.author) : null,
  createdAt: m.createdAt.toISOString(),
  editedAt: m.editedAt?.toISOString() ?? null,
  deletedAt: m.deletedAt?.toISOString() ?? null,
});
type Peer = {
  socket: WebSocket;
  userId?: string;
  sessionId?: string;
  channelId?: string;
  alive: boolean;
  busy: boolean;
  window: number;
  count: number;
  typingAt: number;
};

export async function installCommunity(
  app: FastifyInstance,
  db: PrismaClient,
  cfg: Config,
  authenticate: (req: FastifyRequest) => Promise<void>,
) {
  const auth = { preHandler: authenticate };
  const peers = new Set<Peer>();
  const voice =
    cfg.LIVEKIT_URL && cfg.LIVEKIT_API_KEY && cfg.LIVEKIT_API_SECRET
      ? new RoomServiceClient(
          cfg.LIVEKIT_URL.replace(/^ws/, 'http'),
          cfg.LIVEKIT_API_KEY,
          cfg.LIVEKIT_API_SECRET,
        )
      : null;
  const fail = (status: number, code: string, message: string): never => {
    throw new HttpError(status, code, message);
  };
  const param = (req: FastifyRequest, name: string) =>
    uuid.parse((req.params as Record<string, string>)[name]);
  async function member(serverId: string, userId: string, manage = false) {
    const membership = await db.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      include: { server: true },
    });
    if (!membership) return fail(404, 'NOT_FOUND', 'Servidor não encontrado.');
    if (manage && membership.server.ownerId !== userId && membership.role !== 'ADMIN')
      return fail(403, 'FORBIDDEN', 'Você não pode gerenciar este servidor.');
    return membership;
  }
  async function channel(channelId: string, userId: string, manage = false) {
    const found = await db.channel.findUnique({ where: { id: channelId } });
    if (!found) return fail(404, 'NOT_FOUND', 'Canal não encontrado.');
    if (!found.serverId) {
      const f = await db.friendship.findUnique({ where: { channelId } });
      if (
        !f ||
        f.status !== 'ACCEPTED' ||
        ![f.userAId, f.userBId].includes(userId) ||
        (await db.userBlock.count({
          where: {
            OR: [
              { userId: f.userAId, targetId: f.userBId },
              { userId: f.userBId, targetId: f.userAId },
            ],
          },
        }))
      )
        return fail(404, 'NOT_FOUND', 'Conversa indisponível.');
      if (manage) return fail(403, 'FORBIDDEN', 'Esta é uma conversa privada.');
      return { ...found, membership: null };
    }
    const membership = await member(found.serverId, userId, manage);
    return { ...found, membership };
  }
  async function liveSession(sessionId?: string) {
    if (!sessionId) return null;
    const s = await db.session.findUnique({ where: { id: sessionId } });
    return s && s.expiresAt > new Date() && s.absoluteExpiresAt > new Date() ? s : null;
  }
  function send(p: Peer, event: RealtimeEvent) {
    if (p.socket.readyState !== 1) return;
    if (p.socket.bufferedAmount > 256 * 1024) {
      p.socket.close(1013, 'Reconnect');
      return;
    }
    p.socket.send(JSON.stringify(event));
  }
  async function notifyServer(serverId: string, extra: string[] = []) {
    const ids = new Set([
      ...extra,
      ...(await db.serverMember.findMany({ where: { serverId }, select: { userId: true } })).map(
        (m) => m.userId,
      ),
    ]);
    for (const p of peers) if (p.userId && ids.has(p.userId)) send(p, { type: 'servers.changed' });
  }
  async function notifyUsers(ids: string[], event: RealtimeEvent) {
    for (const p of peers)
      if (p.userId && ids.includes(p.userId) && (await liveSession(p.sessionId))) send(p, event);
  }
  async function publish(channelId: string, event: RealtimeEvent) {
    const c = await db.channel.findUnique({ where: { id: channelId }, select: { serverId: true } });
    if (!c) return;
    const f = c.serverId ? null : await db.friendship.findUnique({ where: { channelId } });
    const ids = new Set(
      c.serverId
        ? (
            await db.serverMember.findMany({
              where: { serverId: c.serverId },
              select: { userId: true },
            })
          ).map((m) => m.userId)
        : f?.status === 'ACCEPTED'
          ? [f.userAId, f.userBId]
          : [],
    );
    await Promise.all(
      [...peers]
        .filter((p) => p.channelId === channelId)
        .map(async (p) => {
          if (!p.userId || !ids.has(p.userId) || !(await liveSession(p.sessionId))) {
            p.socket.close(4001, 'Access expired');
            return;
          }
          send(p, event);
        }),
    );
  }
  function background(task: Promise<unknown>) {
    void task.catch(() => app.log.error('Realtime delivery failed'));
  }
  async function removeVoice(where: Prisma.VoiceSessionWhereInput) {
    const sessions = await db.voiceSession.findMany({ where });
    if (sessions.length && !voice)
      return fail(
        503,
        'VOICE_UNAVAILABLE',
        'O serviço de voz precisa estar disponível para encerrar a chamada.',
      );
    for (const s of sessions) {
      try {
        await voice!.removeParticipant(s.room, s.identity);
      } catch (e) {
        if (
          (e as { status?: number }).status !== 404 &&
          (e as { code?: string }).code !== 'not_found'
        )
          throw e;
      }
      await db.voiceSession.deleteMany({ where: { id: s.id } });
    }
  }

  await installSocial(app, db, authenticate, notifyUsers, removeVoice);
  app.post(
    '/v1/channels/:id/call',
    { ...auth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const c = await channel(param(req, 'id'), req.auth!.user.id);
      if (c.serverId) return fail(400, 'CHANNEL_TYPE', 'Selecione uma conversa privada.');
      if (!voice)
        return fail(
          503,
          'VOICE_UNAVAILABLE',
          'O administrador precisa configurar o LiveKit para habilitar chamadas.',
        );
      const f = await db.friendship.findUniqueOrThrow({ where: { channelId: c.id } });
      await notifyUsers(
        [f.userAId, f.userBId].filter((id) => id !== req.auth!.user.id),
        { type: 'call', channelId: c.id, user: publicUser(req.auth!.user) },
      );
      return { ok: true };
    },
  );
  app.get('/v1/servers', auth, async (req) => {
    const memberships = await db.serverMember.findMany({
      where: { userId: req.auth!.user.id },
      include: {
        server: { include: { channels: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } } },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return {
      servers: memberships.map((m) => ({
        ...m.server,
        role: m.server.ownerId === m.userId ? 'OWNER' : m.role,
      })),
    };
  });
  app.post('/v1/servers', auth, async (req, reply) => {
    const data = serverSchema.parse(req.body),
      userId = req.auth!.user.id;
    if ((await db.server.count({ where: { ownerId: userId } })) >= 30)
      return fail(400, 'LIMIT', 'Limite de 30 servidores por conta.');
    const server = await db.$transaction(async (tx) => {
      const s = await tx.server.create({
        data: {
          ...data,
          ownerId: userId,
          members: { create: { userId, role: 'ADMIN' } },
          channels: {
            create: [
              { name: 'geral', kind: 'TEXT' },
              { name: 'Sala de voz', kind: 'VOICE', position: 1 },
            ],
          },
        },
        include: { channels: true },
      });
      await tx.auditLog.create({ data: { userId, action: 'server.created' } });
      return s;
    });
    background(notifyServer(server.id));
    return reply.code(201).send({ server: { ...server, role: 'OWNER' } });
  });
  app.patch('/v1/servers/:id', auth, async (req) => {
    const id = param(req, 'id');
    await member(id, req.auth!.user.id, true);
    const server = await db.server.update({ where: { id }, data: serverSchema.parse(req.body) });
    background(notifyServer(id));
    return { server };
  });
  app.delete('/v1/servers/:id', auth, async (req) => {
    const id = param(req, 'id'),
      m = await member(id, req.auth!.user.id);
    if (m.server.ownerId !== req.auth!.user.id)
      return fail(403, 'FORBIDDEN', 'Somente o proprietário pode excluir.');
    const members = await db.serverMember.findMany({ where: { serverId: id } });
    const channels = await db.channel.findMany({ where: { serverId: id } });
    await removeVoice({ channelId: { in: channels.map((c) => c.id) } });
    await db.server.delete({ where: { id } });
    background(
      notifyServer(
        id,
        members.map((v) => v.userId),
      ),
    );
    return { ok: true };
  });
  app.get('/v1/servers/:id/members', auth, async (req) => {
    const id = param(req, 'id'),
      membership = await member(id, req.auth!.user.id);
    const members = await db.serverMember.findMany({
      where: { serverId: id },
      include: { user: { select: authorSelect } },
      orderBy: { joinedAt: 'asc' },
      take: 500,
    });
    return {
      members: members.map((m) => ({
        user: publicUser(m.user),
        role: membership.server.ownerId === m.userId ? 'OWNER' : m.role,
      })),
    };
  });
  app.patch('/v1/servers/:id/members/:userId', auth, async (req) => {
    const serverId = param(req, 'id'),
      userId = param(req, 'userId'),
      m = await member(serverId, req.auth!.user.id);
    if (m.server.ownerId !== req.auth!.user.id || userId === m.server.ownerId)
      return fail(403, 'FORBIDDEN', 'Somente o proprietário pode alterar outros cargos.');
    const data = z
      .object({ role: z.enum(['ADMIN', 'MEMBER']) })
      .strict()
      .parse(req.body);
    await member(serverId, userId);
    await db.serverMember.update({ where: { serverId_userId: { serverId, userId } }, data });
    background(notifyServer(serverId));
    return { ok: true };
  });
  app.post('/v1/servers/:id/transfer', auth, async (req) => {
    const id = param(req, 'id'),
      m = await member(id, req.auth!.user.id);
    if (m.server.ownerId !== req.auth!.user.id)
      return fail(403, 'FORBIDDEN', 'Somente o proprietário pode transferir.');
    const { userId } = z.object({ userId: uuid }).strict().parse(req.body);
    await member(id, userId);
    await db.server.update({ where: { id }, data: { ownerId: userId } });
    background(notifyServer(id));
    return { ok: true };
  });
  app.delete('/v1/servers/:id/members/:userId', auth, async (req) => {
    const id = param(req, 'id'),
      userId = param(req, 'userId'),
      actor = req.auth!.user.id;
    const m = await member(id, actor, userId !== actor),
      target = await member(id, userId);
    if (m.server.ownerId === userId)
      return fail(400, 'OWNER', 'Transfira a propriedade ou exclua o servidor.');
    if (userId !== actor && target.role === 'ADMIN' && m.server.ownerId !== actor)
      return fail(403, 'HIERARCHY', 'Você não pode expulsar outro administrador.');
    const channels = await db.channel.findMany({ where: { serverId: id } });
    await removeVoice({ userId, channelId: { in: channels.map((c) => c.id) } });
    await db.serverMember.delete({ where: { serverId_userId: { serverId: id, userId } } });
    background(notifyServer(id, [userId]));
    return { ok: true };
  });
  app.post('/v1/servers/:id/invites', auth, async (req, reply) => {
    const id = param(req, 'id');
    await member(id, req.auth!.user.id, true);
    const data = z
      .object({
        hours: z.number().int().min(1).max(168).default(24),
        maxUses: z.number().int().min(1).max(100).default(10),
      })
      .strict()
      .parse(req.body);
    const code = newToken();
    await db.invite.create({
      data: {
        serverId: id,
        codeHash: hashToken(code),
        maxUses: data.maxUses,
        expiresAt: new Date(Date.now() + data.hours * 3600000),
      },
    });
    return reply.code(201).send({ code, url: `${cfg.WEB_URL}/?invite=${code}` });
  });
  app.post('/v1/invites/join', auth, async (req) => {
    const { code } = z
      .object({ code: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(req.body);
    const userId = req.auth!.user.id;
    const serverId = await db.$transaction(async (tx) => {
      const hash = hashToken(code);
      // Lock the invite so parallel joins cannot exceed its usage limit.
      await tx.$queryRaw`SELECT id FROM invites WHERE "codeHash"=${hash} FOR UPDATE`;
      const invite = await tx.invite.findUnique({ where: { codeHash: hash } });
      if (!invite || invite.expiresAt <= new Date())
        return fail(400, 'INVALID_INVITE', 'Convite inválido ou expirado.');
      if (
        await tx.serverMember.findUnique({
          where: { serverId_userId: { serverId: invite.serverId, userId } },
        })
      )
        return invite.serverId;
      if (invite.uses >= invite.maxUses)
        return fail(400, 'INVITE_EXHAUSTED', 'O convite atingiu o limite de usos.');
      await tx.serverMember.create({ data: { serverId: invite.serverId, userId } });
      await tx.invite.update({ where: { id: invite.id }, data: { uses: { increment: 1 } } });
      return invite.serverId;
    });
    background(notifyServer(serverId));
    return { serverId };
  });
  app.post('/v1/servers/:id/channels', auth, async (req, reply) => {
    const id = param(req, 'id');
    await member(id, req.auth!.user.id, true);
    const data = channelSchema.parse(req.body);
    const count = await db.channel.count({ where: { serverId: id } });
    if (count >= 50) return fail(400, 'LIMIT', 'Limite de 50 canais.');
    const created = await db.channel.create({ data: { ...data, serverId: id, position: count } });
    background(notifyServer(id));
    return reply.code(201).send({ channel: created });
  });
  app.patch('/v1/channels/:id', auth, async (req) => {
    const id = param(req, 'id'),
      c = await channel(id, req.auth!.user.id, true);
    const data = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(req.body);
    await db.channel.update({ where: { id }, data });
    background(notifyServer(c.serverId!));
    return { ok: true };
  });
  app.delete('/v1/channels/:id', auth, async (req) => {
    const id = param(req, 'id'),
      c = await channel(id, req.auth!.user.id, true);
    await removeVoice({ channelId: id });
    await db.channel.delete({ where: { id } });
    background(notifyServer(c.serverId!));
    return { ok: true };
  });
  app.get('/v1/channels/:id/messages', auth, async (req) => {
    const id = param(req, 'id'),
      c = await channel(id, req.auth!.user.id);
    if (c.kind !== 'TEXT') return fail(400, 'CHANNEL_TYPE', 'Este canal é de voz.');
    const { before } = z
      .object({
        before: z
          .string()
          .regex(/^\d{1,19}$/)
          .optional(),
      })
      .parse(req.query);
    const messages = await db.message.findMany({
      where: { channelId: id, ...(before ? { sequence: { lt: BigInt(before) } } : {}) },
      orderBy: { sequence: 'desc' },
      take: 51,
      include: includeAuthor,
    });
    const hasMore = messages.length > 50;
    return { messages: messages.slice(0, 50).reverse().map(messageDto), hasMore };
  });
  app.post(
    '/v1/channels/:id/messages',
    {
      ...auth,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => req.auth?.user.id ?? req.ip,
          hook: 'preHandler',
        },
      },
    },
    async (req, reply) => {
      const id = param(req, 'id'),
        userId = req.auth!.user.id,
        c = await channel(id, userId);
      if (c.kind !== 'TEXT') return fail(400, 'CHANNEL_TYPE', 'Escolha um canal de texto.');
      const data = messageSchema.parse(req.body);
      const message = await db.message.upsert({
        where: {
          channelId_authorId_clientId: { channelId: id, authorId: userId, clientId: data.clientId },
        },
        create: { ...data, channelId: id, authorId: userId },
        update: {},
        include: includeAuthor,
      });
      const dto = messageDto(message);
      background(publish(id, { type: 'message', message: dto }));
      return reply.code(201).send({ message: dto });
    },
  );
  async function editable(req: FastifyRequest) {
    const id = param(req, 'id'),
      m = await db.message.findUnique({ where: { id } });
    if (!m) return fail(404, 'NOT_FOUND', 'Mensagem não encontrada.');
    const c = await channel(m.channelId, req.auth!.user.id);
    if (m.deletedAt) return fail(409, 'DELETED', 'Mensagem já excluída.');
    return { m, c };
  }
  app.patch('/v1/messages/:id', auth, async (req) => {
    const { m } = await editable(req);
    if (m.authorId !== req.auth!.user.id)
      return fail(403, 'FORBIDDEN', 'Você só pode editar suas mensagens.');
    const { content } = z
      .object({ content: z.string().trim().min(1).max(4000) })
      .strict()
      .parse(req.body);
    const message = messageDto(
      await db.message.update({
        where: { id: m.id },
        data: { content, editedAt: new Date() },
        include: includeAuthor,
      }),
    );
    background(publish(m.channelId, { type: 'message', message }));
    return { message };
  });
  app.delete('/v1/messages/:id', auth, async (req) => {
    const { m, c } = await editable(req),
      uid = req.auth!.user.id;
    if (
      m.authorId !== uid &&
      c.membership?.server.ownerId !== uid &&
      c.membership?.role !== 'ADMIN'
    )
      return fail(403, 'FORBIDDEN', 'Sem permissão para excluir.');
    const message = messageDto(
      await db.message.update({
        where: { id: m.id },
        data: { content: '', deletedAt: new Date() },
        include: includeAuthor,
      }),
    );
    background(publish(m.channelId, { type: 'message', message }));
    return { message };
  });

  app.post('/v1/realtime/ticket', auth, async (req) => {
    if (!cfg.PUBLIC_API_URL && cfg.NODE_ENV === 'production')
      return fail(
        503,
        'REALTIME_CONFIG',
        'Configure PUBLIC_API_URL na API para ativar o chat ao vivo.',
      );
    const token = newToken();
    await db.realtimeTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.realtimeTicket.create({
      data: {
        hash: hashToken(token),
        sessionId: req.auth!.session.id,
        expiresAt: new Date(Date.now() + 30000),
      },
    });
    return {
      ticket: token,
      url: `${(cfg.PUBLIC_API_URL ?? `http://localhost:${cfg.PORT}`).replace(/^http/, 'ws')}/v1/realtime`,
    };
  });
  app.get('/v1/realtime', { websocket: true }, (socket, req) => {
    const origins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim());
    // Tauri uses the same scoped one-use ticket from its native authenticated transport.
    const origin = req.headers.origin;
    if (
      origin &&
      !origins.includes(origin) &&
      origin !== 'http://tauri.localhost' &&
      origin !== 'tauri://localhost'
    ) {
      socket.close(4003, 'Origin');
      return;
    }
    const p: Peer = { socket, alive: true, busy: false, window: Date.now(), count: 0, typingAt: 0 };
    peers.add(p);
    const deadline = setTimeout(() => {
      if (!p.userId) socket.close(4001, 'Authentication required');
    }, 5000);
    socket.on('pong', () => {
      p.alive = true;
    });
    socket.on('close', () => {
      clearTimeout(deadline);
      peers.delete(p);
    });
    socket.on('error', () => peers.delete(p));
    socket.on('message', (raw) => {
      if (Date.now() - p.window > 10000) {
        p.window = Date.now();
        p.count = 0;
      }
      if (++p.count > 40 || p.busy) {
        socket.close(4008, 'Rate limit');
        return;
      }
      p.busy = true;
      void (async () => {
        const data = z
          .discriminatedUnion('type', [
            z
              .object({ type: z.literal('auth'), ticket: z.string().regex(/^[a-f0-9]{64}$/) })
              .strict(),
            z.object({ type: z.literal('subscribe'), channelId: uuid }).strict(),
            z.object({ type: z.literal('typing') }).strict(),
          ])
          .parse(JSON.parse(raw.toString()));
        if (!p.userId) {
          if (data.type !== 'auth') return socket.close(4001, 'Authentication required');
          const hash = hashToken(data.ticket),
            ticket = await db.realtimeTicket.findUnique({ where: { hash } });
          const claimed = await db.realtimeTicket.deleteMany({
            where: { hash, expiresAt: { gt: new Date() } },
          });
          const session = ticket && claimed.count ? await liveSession(ticket.sessionId) : null;
          if (!session) return socket.close(4001, 'Invalid ticket');
          p.userId = session.userId;
          p.sessionId = session.id;
          clearTimeout(deadline);
          send(p, { type: 'ready' });
          return;
        }
        if (!(await liveSession(p.sessionId))) return socket.close(4001, 'Session expired');
        if (data.type === 'subscribe') {
          const c = await channel(data.channelId, p.userId);
          if (c.kind !== 'TEXT') return fail(400, 'CHANNEL_TYPE', 'Escolha um canal de texto.');
          p.channelId = c.id;
          send(p, { type: 'subscribed', channelId: c.id });
        } else if (data.type === 'typing' && p.channelId && Date.now() - p.typingAt > 2500) {
          await channel(p.channelId, p.userId);
          p.typingAt = Date.now();
          const u = await db.user.findUnique({ where: { id: p.userId }, select: authorSelect });
          if (u)
            await publish(p.channelId, {
              type: 'typing',
              channelId: p.channelId,
              user: publicUser(u),
            });
        }
      })()
        .catch(() => send(p, { type: 'error', message: 'Requisição inválida ou acesso negado.' }))
        .finally(() => {
          p.busy = false;
        });
    });
  });

  app.post('/v1/channels/:id/voice', auth, async (req) => {
    const id = param(req, 'id'),
      c = await channel(id, req.auth!.user.id);
    if (c.serverId && c.kind !== 'VOICE')
      return fail(400, 'CHANNEL_TYPE', 'Escolha um canal de voz.');
    if (!voice)
      return fail(
        503,
        'VOICE_UNAVAILABLE',
        'Voz ainda não configurada. O administrador precisa publicar o LiveKit e configurar a API.',
      );
    const sessionId = req.auth!.session.id,
      identity = `${req.auth!.user.id}:${sessionId}`,
      room = `warp-${id}`;
    await removeVoice({ sessionId });
    await voice.createRoom({ name: room, emptyTimeout: 60, maxParticipants: 20 });
    await db.voiceSession.create({
      data: { sessionId, userId: req.auth!.user.id, channelId: id, room, identity },
    });
    const token = new AccessToken(cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET, {
      identity,
      name: req.auth!.user.displayName,
      ttl: 30,
    });
    token.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: [
        TrackSource.MICROPHONE,
        TrackSource.CAMERA,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ],
    });
    return { url: cfg.LIVEKIT_URL, token: await token.toJwt() };
  });
  app.delete('/v1/voice/current', auth, async (req) => {
    await removeVoice({ sessionId: req.auth!.session.id });
    return { ok: true };
  });
  app.post('/v1/channels/:id/voice/moderate', auth, async (req) => {
    const c = await channel(param(req, 'id'), req.auth!.user.id, true);
    if (!voice) return fail(503, 'VOICE_UNAVAILABLE', 'Voz indisponível.');
    const { identity, action } = z
      .object({ identity: z.string().max(100), action: z.enum(['mute', 'disconnect']) })
      .strict()
      .parse(req.body);
    const target = await db.voiceSession.findUnique({ where: { identity } });
    if (!target || target.channelId !== c.id)
      return fail(404, 'NOT_FOUND', 'Participante não encontrado.');
    const targetMember = await member(c.serverId!, target.userId);
    if (
      target.userId === c.membership!.server.ownerId ||
      (targetMember.role === 'ADMIN' && req.auth!.user.id !== c.membership!.server.ownerId)
    )
      return fail(403, 'HIERARCHY', 'Sem permissão sobre este participante.');
    if (action === 'disconnect') await removeVoice({ identity });
    else {
      const participant = await voice.getParticipant(target.room, identity);
      for (const track of participant.tracks)
        if (track.source === TrackSource.MICROPHONE)
          await voice.mutePublishedTrack(target.room, identity, track.sid, true);
    }
    return { ok: true };
  });
  let sweeping = false;
  const timer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void (async () => {
      for (const p of peers) {
        if (!p.alive || (p.sessionId && !(await liveSession(p.sessionId)))) {
          p.socket.terminate();
          continue;
        }
        p.alive = false;
        p.socket.ping();
      }
      if (voice)
        for (const v of await db.voiceSession.findMany()) {
          const s = await liveSession(v.sessionId);
          const c = await db.channel.findUnique({ where: { id: v.channelId } });
          const allowed =
            s &&
            c &&
            (await channel(c.id, v.userId)
              .then(() => true)
              .catch(() => false));
          if (!allowed) await removeVoice({ id: v.id });
          else if (Date.now() - v.createdAt.getTime() > 90000) {
            const participants = await voice.listParticipants(v.room);
            if (!participants.some((p) => p.identity === v.identity))
              await db.voiceSession.deleteMany({ where: { id: v.id } });
          }
        }
      if (voice)
        for (const room of await voice.listRooms()) {
          if (!room.name.startsWith('warp-')) continue;
          for (const p of await voice.listParticipants(room.name)) {
            const grant = await db.voiceSession.findUnique({ where: { identity: p.identity } });
            if (!grant || grant.room !== room.name)
              await voice.removeParticipant(room.name, p.identity);
          }
        }
    })()
      .catch(() => app.log.error('Realtime maintenance failed'))
      .finally(() => {
        sweeping = false;
      });
  }, 15000);
  timer.unref();
  app.addHook('preClose', async () => {
    clearInterval(timer);
    for (const p of peers) p.socket.terminate();
  });
}
