import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { Prisma, PrismaClient, type Session, type User, type TokenPurpose } from '@prisma/client';
import { z, ZodError } from 'zod';
import sharp from 'sharp';
import {
  registerSchema,
  loginSchema,
  profileSchema,
  changePasswordSchema,
  resetPasswordSchema,
  tokenSchema,
  emailSchema,
  type UserProfile,
} from '@warp/shared';
import type { Config } from './config.js';
import { createMailer, type Mailer } from './mail.js';
import {
  csrfFor,
  equalSecret,
  hashToken,
  HttpError,
  newToken,
  passwordHash,
  passwordMatches,
} from './security.js';

const HOUR = 3600_000,
  DAY = 24 * HOUR;
const idSchema = z.string().uuid();
type Auth = { user: User; session: Session; token: string };
declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null;
  }
}
const profile = (u: User): UserProfile => ({
  id: u.id,
  email: u.email,
  username: u.username,
  displayName: u.displayName,
  bio: u.bio,
  status: u.status,
  avatarUrl: u.avatarVersion ? `/v1/users/${u.id}/avatar?v=${u.avatarVersion}` : null,
  emailVerified: !!u.emailVerifiedAt,
  createdAt: u.createdAt.toISOString(),
});

export async function buildApp(
  cfg: Config,
  options: { db?: PrismaClient; mailer?: Mailer; logger?: boolean; rateLimitMax?: number } = {},
) {
  const db = options.db ?? new PrismaClient();
  const mailer = options.mailer ?? createMailer(cfg);
  const app = Fastify({
    bodyLimit: 32 * 1024,
    logger: options.logger ?? {
      level: 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
      serializers: {
        req: (req) => ({ method: req.method, url: req.url?.split('?')[0], hostname: req.hostname }),
      },
    },
    trustProxy: false,
  });
  const production = cfg.NODE_ENV === 'production';
  const cookieName = production ? '__Host-warp_session' : 'warp_session';
  const origins = new Set(cfg.CORS_ORIGINS.split(',').map((v) => v.trim()));
  const cookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: cfg.COOKIE_SAME_SITE,
    path: '/',
  } as const;
  const dummyHash = await passwordHash(newToken());
  app.decorateRequest('auth', null);
  await app.register(cookie);
  await app.register(cors, {
    origin: [...origins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Warp-Client'],
  });
  await app.register(helmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(rateLimit, { max: options.rateLimitMax ?? 120, timeWindow: '1 minute' });
  await app.register(multipart, {
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    // All browser mutations require an exact trusted Origin plus a non-simple header.
    if (
      !req.headers.origin ||
      !origins.has(req.headers.origin) ||
      req.headers['x-warp-client'] !== 'web'
    )
      throw new HttpError(403, 'ORIGIN_REJECTED', 'Origem da requisição não autorizada.');
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError)
      return reply
        .code(400)
        .send({
          error: {
            code: 'VALIDATION',
            message: err.issues[0]?.message ?? 'Dados inválidos.',
            requestId: req.id,
          },
        });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      return reply
        .code(409)
        .send({
          error: {
            code: 'CONFLICT',
            message: 'Não foi possível usar estes dados. Tente outros dados ou recupere sua conta.',
            requestId: req.id,
          },
        });
    const failure = err as { statusCode?: number; code?: string; message?: string };
    const status = typeof failure.statusCode === 'number' ? failure.statusCode : 500;
    if (status >= 500) req.log.error({ code: failure.code, requestId: req.id }, 'Request failed');
    return reply
      .code(status)
      .send({
        error: {
          code: status >= 500 ? 'INTERNAL' : (failure.code ?? 'REQUEST_ERROR'),
          message: status >= 500 ? 'Não foi possível concluir. Tente novamente.' : failure.message,
          requestId: req.id,
        },
      });
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.', requestId: req.id } }),
  );
  if (!options.db) app.addHook('onClose', () => db.$disconnect());

  async function authenticate(req: FastifyRequest) {
    const token = req.cookies[cookieName];
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new HttpError(401, 'UNAUTHENTICATED', 'Entre na sua conta para continuar.');
    const session = await db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.expiresAt.getTime() <= Date.now() ||
      session.absoluteExpiresAt.getTime() <= Date.now()
    )
      throw new HttpError(401, 'SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrf = req.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !equalSecret(csrf, csrfFor(token, cfg.SESSION_SECRET)))
        throw new HttpError(403, 'CSRF_REJECTED', 'Atualize a página e tente novamente.');
    }
    req.auth = { session, user: session.user, token };
    if (Date.now() - session.lastSeenAt.getTime() > 60_000)
      await db.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  const authenticated = { preHandler: authenticate };
  const authLimit = {
    config: { rateLimit: { max: options.rateLimitMax ?? 10, timeWindow: '15 minutes' } },
  };
  const sensitiveLimit = { ...authenticated, ...authLimit };
  const audit = (userId: string, action: string) =>
    db.auditLog.create({ data: { userId, action } });
  const setSessionCookie = (reply: FastifyReply, token: string, session: Session) =>
    reply.setCookie(cookieName, token, {
      ...cookieOptions,
      ...(session.persistent ? { expires: session.expiresAt } : {}),
    });
  const authResponse = (user: User, session: Session, token: string) => ({
    user: profile(user),
    csrfToken: csrfFor(token, cfg.SESSION_SECRET),
    expiresAt: session.expiresAt.toISOString(),
  });

  async function createSession(
    user: User,
    remember: boolean,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const token = newToken();
    const session = await db.$transaction(async (tx) => {
      // Serialize login with password resets/deletion so an old verified password
      // cannot create a session after credentials were changed concurrently.
      const rows = await tx.$queryRaw<
        { passwordHash: string }[]
      >`SELECT "passwordHash" FROM users WHERE id=${user.id}::uuid FOR UPDATE`;
      if (rows[0]?.passwordHash !== user.passwordHash)
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenciais alteradas. Entre novamente.');
      return tx.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          device: (req.headers['user-agent'] || 'Cliente desconhecido').slice(0, 256),
          persistent: remember,
          expiresAt: new Date(Date.now() + (remember ? 7 * DAY : 12 * HOUR)),
          absoluteExpiresAt: new Date(Date.now() + (remember ? 30 * DAY : 12 * HOUR)),
        },
      });
    });
    setSessionCookie(reply, token, session);
    return authResponse(user, session, token);
  }
  async function sendAccountMail(user: User, purpose: TokenPurpose) {
    const token = newToken();
    await db.$transaction(async (tx) => {
      await tx.accountToken.updateMany({
        where: { userId: user.id, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.accountToken.create({
        data: {
          userId: user.id,
          purpose,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + (purpose === 'VERIFY_EMAIL' ? DAY : 30 * 60_000)),
        },
      });
    });
    const link = new URL(
      purpose === 'VERIFY_EMAIL' ? '/verify-email' : '/reset-password',
      cfg.WEB_URL,
    );
    // Fragments keep one-time tokens out of server and referrer logs.
    link.hash = `token=${token}`;
    try {
      await mailer({
        to: user.email,
        subject:
          purpose === 'VERIFY_EMAIL' ? 'Confirme seu e-mail no Warp' : 'Redefina sua senha no Warp',
        text: `${purpose === 'VERIFY_EMAIL' ? 'Confirme seu e-mail' : 'Redefina sua senha'} acessando:\n${link.toString()}\n\nSe você não solicitou, ignore esta mensagem.`,
      });
      return true;
    } catch {
      app.log.error({ event: 'account_mail_failed' }, 'SMTP delivery failed');
      return false;
    }
  }
  async function consumeToken(
    token: string,
    purpose: TokenPurpose,
    action: (tx: Prisma.TransactionClient, userId: string) => Promise<unknown>,
  ) {
    await db.$transaction(async (tx) => {
      const record = await tx.accountToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (
        !record ||
        record.purpose !== purpose ||
        record.expiresAt.getTime() <= Date.now() ||
        record.consumedAt
      )
        throw new HttpError(400, 'INVALID_TOKEN', 'Link inválido ou expirado. Solicite um novo.');
      const claimed = await tx.accountToken.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (!claimed.count) throw new HttpError(400, 'INVALID_TOKEN', 'Este link já foi utilizado.');
      await action(tx, record.userId);
    });
  }

  app.get('/health', async (_req, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: 'ok', service: 'warp-api', version: '0.1.0' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.post('/v1/auth/register', authLimit, async (req, reply) => {
    const data = registerSchema.parse(req.body);
    const user = await db.user.create({
      data: {
        email: data.email,
        username: data.username,
        displayName: data.displayName,
        passwordHash: await passwordHash(data.password),
      },
    });
    await audit(user.id, 'account.created');
    const mailSent = await sendAccountMail(user, 'VERIFY_EMAIL');
    return reply
      .code(201)
      .send({ ...(await createSession(user, data.remember, req, reply)), mailSent });
  });
  app.post('/v1/auth/login', authLimit, async (req, reply) => {
    const data = loginSchema.parse(req.body);
    const user = await db.user.findFirst({
      where: { OR: [{ email: data.identifier }, { username: data.identifier }] },
    });
    const valid = await passwordMatches(user?.passwordHash ?? dummyHash, data.password);
    if (!user || !valid)
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail, username ou senha incorretos.');
    await audit(user.id, 'session.created');
    return createSession(user, data.remember, req, reply);
  });
  app.get('/v1/auth/me', authenticated, async (req) => {
    const a = req.auth!;
    return authResponse(a.user, a.session, a.token);
  });
  app.post('/v1/auth/refresh', authenticated, async (req, reply) => {
    const { session, user } = req.auth!,
      token = newToken();
    const expiresAt = new Date(
      Math.min(
        Date.now() + (session.persistent ? 7 * DAY : 12 * HOUR),
        session.absoluteExpiresAt.getTime(),
      ),
    );
    const changed = await db.session.updateMany({
      where: { id: session.id, tokenHash: session.tokenHash },
      data: { tokenHash: hashToken(token), expiresAt, lastSeenAt: new Date() },
    });
    if (!changed.count)
      throw new HttpError(409, 'SESSION_ROTATED', 'Sessão atualizada em outra janela. Recarregue.');
    const renewed = { ...session, expiresAt };
    setSessionCookie(reply, token, renewed);
    return authResponse(user, renewed, token);
  });
  app.post('/v1/auth/logout', authenticated, async (req, reply) => {
    await db.session.deleteMany({ where: { id: req.auth!.session.id } });
    reply.clearCookie(cookieName, cookieOptions);
    return { ok: true };
  });
  app.post('/v1/auth/forgot-password', authLimit, async (req) => {
    const { email } = z.object({ email: emailSchema }).strict().parse(req.body);
    const user = await db.user.findUnique({ where: { email } });
    if (user) await sendAccountMail(user, 'RESET_PASSWORD');
    return { message: 'Se houver uma conta com este e-mail, enviaremos um link de recuperação.' };
  });
  app.post('/v1/auth/reset-password', authLimit, async (req) => {
    const data = resetPasswordSchema.parse(req.body),
      hash = await passwordHash(data.password);
    await consumeToken(data.token, 'RESET_PASSWORD', async (tx, userId) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash: hash } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.accountToken.updateMany({
        where: { userId, purpose: 'RESET_PASSWORD', consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.auditLog.create({ data: { userId, action: 'password.reset' } });
    });
    return { ok: true };
  });
  app.post('/v1/auth/verify-email', authLimit, async (req) => {
    const { token } = tokenSchema.parse(req.body);
    await consumeToken(token, 'VERIFY_EMAIL', async (tx, userId) => {
      await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      await tx.auditLog.create({ data: { userId, action: 'email.verified' } });
    });
    return { ok: true };
  });
  app.post('/v1/auth/resend-verification', sensitiveLimit, async (req) => {
    if (req.auth!.user.emailVerifiedAt) return { ok: true };
    if (!(await sendAccountMail(req.auth!.user, 'VERIFY_EMAIL')))
      throw new HttpError(
        503,
        'MAIL_UNAVAILABLE',
        'E-mail indisponível. Tente novamente mais tarde.',
      );
    return { ok: true };
  });
  app.patch('/v1/users/me', authenticated, async (req) => {
    const data = profileSchema.parse(req.body);
    const user = await db.user.update({ where: { id: req.auth!.user.id }, data });
    return { user: profile(user) };
  });
  app.post('/v1/users/me/password', sensitiveLimit, async (req, reply) => {
    const data = changePasswordSchema.parse(req.body),
      user = req.auth!.user;
    if (!(await passwordMatches(user.passwordHash, data.currentPassword)))
      throw new HttpError(400, 'WRONG_PASSWORD', 'Senha atual incorreta.');
    const hash = await passwordHash(data.newPassword);
    await db.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash: hash },
      });
      if (!changed.count)
        throw new HttpError(409, 'CONFLICT', 'A senha já foi alterada. Entre novamente.');
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.accountToken.deleteMany({ where: { userId: user.id, purpose: 'RESET_PASSWORD' } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'password.changed' } });
    });
    reply.clearCookie(cookieName, cookieOptions);
    return { ok: true };
  });
  app.get('/v1/users/me/sessions', authenticated, async (req) => {
    const sessions = await db.session.findMany({
      where: {
        userId: req.auth!.user.id,
        expiresAt: { gt: new Date() },
        absoluteExpiresAt: { gt: new Date() },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        device: s.device,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        persistent: s.persistent,
        current: s.id === req.auth!.session.id,
      })),
    };
  });
  app.delete('/v1/users/me/sessions/:id', authenticated, async (req, reply) => {
    const id = idSchema.parse((req.params as { id: string }).id);
    await db.session.deleteMany({ where: { id, userId: req.auth!.user.id } });
    await audit(req.auth!.user.id, 'session.revoked');
    if (id === req.auth!.session.id) reply.clearCookie(cookieName, cookieOptions);
    return { ok: true };
  });
  app.post('/v1/users/me/revoke-others', authenticated, async (req) => {
    await db.session.deleteMany({
      where: { userId: req.auth!.user.id, id: { not: req.auth!.session.id } },
    });
    await audit(req.auth!.user.id, 'sessions.revoked');
    return { ok: true };
  });
  app.post('/v1/users/me/avatar', authenticated, async (req) => {
    const file = await req.file();
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
      throw new HttpError(400, 'INVALID_IMAGE', 'Envie uma imagem PNG, JPEG ou WebP de até 2 MB.');
    const input = await file.toBuffer();
    let avatar: Buffer;
    try {
      const image = sharp(input, { limitInputPixels: 16_000_000, animated: false });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
        throw new Error('format');
      avatar = await image
        .rotate()
        .resize(256, 256, { fit: 'cover' })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new HttpError(400, 'INVALID_IMAGE', 'A imagem não é válida. Use PNG, JPEG ou WebP.');
    }
    const user = await db.user.update({
      where: { id: req.auth!.user.id },
      data: { avatar: new Uint8Array(avatar), avatarVersion: newToken().slice(0, 16) },
    });
    return { user: profile(user) };
  });
  app.delete('/v1/users/me/avatar', authenticated, async (req) => ({
    user: profile(
      await db.user.update({
        where: { id: req.auth!.user.id },
        data: { avatar: null, avatarVersion: null },
      }),
    ),
  }));
  app.get('/v1/users/:id/avatar', async (req, reply) => {
    const id = idSchema.parse((req.params as { id: string }).id);
    const user = await db.user.findUnique({ where: { id }, select: { avatar: true } });
    if (!user?.avatar) throw new HttpError(404, 'NOT_FOUND', 'Avatar não encontrado.');
    return reply.type('image/webp').send(Buffer.from(user.avatar));
  });
  app.delete('/v1/users/me', sensitiveLimit, async (req, reply) => {
    const { password } = z
      .object({ password: z.string().min(1).max(128) })
      .strict()
      .parse(req.body);
    const user = req.auth!.user;
    if (!(await passwordMatches(user.passwordHash, password)))
      throw new HttpError(400, 'WRONG_PASSWORD', 'Senha incorreta.');
    await db.$transaction(async (tx) => {
      await tx.auditLog.create({ data: { userId: user.id, action: 'account.deleted' } });
      await tx.user.delete({ where: { id: user.id } });
    });
    reply.clearCookie(cookieName, cookieOptions);
    return { ok: true };
  });
  return app;
}
