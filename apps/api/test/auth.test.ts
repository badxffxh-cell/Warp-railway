import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AccountMail } from '../src/mail.js';
import { hashToken } from '../src/security.js';
import type { AuthResponse } from '@warp/shared';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error(
    'TEST_DATABASE_URL must point to a dedicated database ending in _test. Apply migrations before running.',
  );
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const cfg = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  SESSION_SECRET: randomBytes(32).toString('hex'),
  WEB_URL: 'http://localhost:5173',
  CORS_ORIGINS: 'http://localhost:5173',
  COOKIE_SAME_SITE: 'lax',
});
const mail: AccountMail[] = [],
  ids: string[] = [];
const app = await buildApp(cfg, {
  db,
  mailer: async (m) => {
    mail.push(m);
  },
  logger: false,
  rateLimitMax: 1000,
});
const headers = { origin: cfg.WEB_URL, 'x-warp-client': 'web' };
const password = 'Warp-test-password-123';
type Client = { cookie: string; csrf: string; user: AuthResponse['user']; identifier: string };
async function register(remember = true): Promise<Client> {
  const username = `u_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    headers,
    payload: {
      username,
      email: `${username}@example.test`,
      displayName: 'Pessoa de teste',
      password,
      remember,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const auth = response.json<AuthResponse>();
  ids.push(auth.user.id);
  return {
    cookie: String(response.headers['set-cookie']).split(';')[0]!,
    csrf: auth.csrfToken,
    user: auth.user,
    identifier: username,
  };
}
function h(c: Client) {
  return { ...headers, cookie: c.cookie, 'x-csrf-token': c.csrf };
}
function mailToken(userId: string, kind: 'verify' | 'reset') {
  const user = ids.includes(userId);
  assert.ok(user);
  const message = mail.findLast(
    (m) =>
      m.to.includes(clients.get(userId) ?? '') &&
      m.text.includes(kind === 'verify' ? '/verify-email' : '/reset-password'),
  );
  assert.ok(message);
  const token = message.text.match(/token=([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  return token;
}
const clients = new Map<string, string>();
async function tracked() {
  const c = await register();
  clients.set(c.user.id, c.identifier);
  return c;
}
before(async () => {
  await db.$connect();
});
after(async () => {
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await app.close();
  await db.$disconnect();
});

test('health checks a real PostgreSQL connection', async () => {
  const r = await app.inject('/health');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().status, 'ok');
});
test('register hashes password with Argon2id and stores only token digests', async () => {
  const c = await tracked();
  const u = await db.user.findUniqueOrThrow({ where: { id: c.user.id } });
  assert.match(u.passwordHash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  const s = await db.session.findFirstOrThrow({ where: { userId: u.id } });
  assert.equal(s.tokenHash, hashToken(c.cookie.split('=')[1]!));
  assert.notEqual(s.tokenHash, c.cookie.split('=')[1]);
  assert.equal(c.user.emailVerified, false);
  assert.equal('passwordHash' in c.user, false);
});
test('registration rejects short passwords and invalid usernames', async () => {
  for (const patch of [{ password: 'short' }, { username: '../bad' }]) {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers,
      payload: {
        email: 'valid@example.test',
        username: 'valid',
        displayName: 'Teste',
        password,
        ...patch,
      },
    });
    assert.equal(r.statusCode, 400);
  }
});
test('uniqueness is enforced case insensitively via canonical fields', async () => {
  const c = await register();
  const r = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    headers,
    payload: {
      email: c.user.email.toUpperCase(),
      username: c.identifier.toUpperCase(),
      displayName: 'Teste',
      password,
    },
  });
  assert.equal(r.statusCode, 409);
});
test('login by email and username, invalid credentials return generic error', async () => {
  const c = await register();
  for (const identifier of [c.user.email.toUpperCase(), c.identifier.toUpperCase()]) {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers,
      payload: { identifier, password },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().user.id, c.user.id);
  }
  for (const identifier of [c.identifier, 'unknown']) {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers,
      payload: { identifier, password: 'incorrect-password' },
    });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().error.code, 'INVALID_CREDENTIALS');
  }
});
test('remembered cookies persist, temporary cookies have no expiration attribute', async () => {
  for (const remember of [true, false]) {
    const c = await register(remember);
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers,
      payload: { identifier: c.identifier, password, remember },
    });
    const cookie = String(r.headers['set-cookie']);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.equal(/Expires=/.test(cookie), remember);
  }
});
test('saved session survives a fresh API instance', async () => {
  const c = await register();
  const second = await buildApp(cfg, { db, mailer: async () => {}, logger: false });
  try {
    const r = await second.inject({ url: '/v1/auth/me', headers: { cookie: c.cookie } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().user.id, c.user.id);
  } finally {
    await second.close();
  }
});
test('anonymous, expired and malformed sessions are rejected', async () => {
  for (const cookie of ['', 'warp_session=invalid'])
    assert.equal((await app.inject({ url: '/v1/auth/me', headers: { cookie } })).statusCode, 401);
  const c = await register();
  await db.session.updateMany({ where: { userId: c.user.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: h(c) })).statusCode, 401);
});
test('refresh rotates token and CSRF secret; old credentials stop working', async () => {
  const c = await register();
  const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: h(c) });
  assert.equal(r.statusCode, 200);
  assert.notEqual(r.json().csrfToken, c.csrf);
  const updated = String(r.headers['set-cookie']).split(';')[0]!;
  assert.notEqual(updated, c.cookie);
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: h(c) })).statusCode, 401);
  assert.equal(
    (await app.inject({ url: '/v1/auth/me', headers: { cookie: updated } })).statusCode,
    200,
  );
});
test('refresh cannot extend beyond absolute expiry', async () => {
  const c = await register();
  const max = new Date(Date.now() + 60_000);
  await db.session.updateMany({ where: { userId: c.user.id }, data: { absoluteExpiresAt: max } });
  const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: h(c) });
  assert.equal(r.statusCode, 200);
  assert.equal(new Date(r.json().expiresAt).getTime(), max.getTime());
});
test('CSRF guard rejects missing origin, foreign origin, missing custom header and invalid token', async () => {
  const c = await register();
  const variants = [
    { cookie: c.cookie },
    { ...h(c), origin: 'https://attacker.test' },
    { origin: cfg.WEB_URL, cookie: c.cookie, 'x-csrf-token': c.csrf },
    { ...h(c), 'x-csrf-token': 'bad' },
  ];
  for (const headers of variants) {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers });
    assert.equal(r.statusCode, 403);
  }
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: h(c) })).statusCode, 200);
});
test('CORS allows only configured origins with credentials', async () => {
  for (const origin of [cfg.WEB_URL, 'https://attacker.test']) {
    const r = await app.inject({
      method: 'OPTIONS',
      url: '/v1/auth/login',
      headers: { origin, 'access-control-request-method': 'POST' },
    });
    assert.equal(
      r.headers['access-control-allow-origin'],
      origin === cfg.WEB_URL ? origin : undefined,
    );
  }
});
test('profile updates persist and reject mass assignment', async () => {
  const c = await register();
  const data = { displayName: 'Nova identidade', bio: 'Meu universo', status: 'BUSY' };
  const r = await app.inject({
    method: 'PATCH',
    url: '/v1/users/me',
    headers: h(c),
    payload: data,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().user.displayName, data.displayName);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: c.user.id } })).status, 'BUSY');
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/v1/users/me',
        headers: h(c),
        payload: { ...data, emailVerifiedAt: new Date() },
      })
    ).statusCode,
    400,
  );
});
test('verification consumes hashed single-use token', async () => {
  const c = await tracked(),
    token = mailToken(c.user.id, 'verify');
  assert.ok(await db.accountToken.findUnique({ where: { tokenHash: hashToken(token) } }));
  const r = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email',
    headers,
    payload: { token },
  });
  assert.equal(r.statusCode, 200);
  assert.ok((await db.user.findUniqueOrThrow({ where: { id: c.user.id } })).emailVerifiedAt);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        headers,
        payload: { token },
      })
    ).statusCode,
    400,
  );
});
test('resending verification invalidates previous token', async () => {
  const c = await tracked(),
    old = mailToken(c.user.id, 'verify');
  assert.equal(
    (await app.inject({ method: 'POST', url: '/v1/auth/resend-verification', headers: h(c) }))
      .statusCode,
    200,
  );
  const fresh = mailToken(c.user.id, 'verify');
  assert.notEqual(old, fresh);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        headers,
        payload: { token: old },
      })
    ).statusCode,
    400,
  );
});
test('forgot password returns same response for existing and missing email', async () => {
  const c = await tracked();
  const responses = [];
  for (const email of [c.user.email, 'missing@example.test'])
    responses.push(
      await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        headers,
        payload: { email },
      }),
    );
  assert.equal(responses[0]!.statusCode, 200);
  assert.deepEqual(responses[0]!.json(), responses[1]!.json());
  assert.equal(responses[0]!.body.includes('token'), false);
});
test('password reset invalidates sessions and allows only one concurrent redemption', async () => {
  const c = await tracked();
  await app.inject({
    method: 'POST',
    url: '/v1/auth/forgot-password',
    headers,
    payload: { email: c.user.email },
  });
  const token = mailToken(c.user.id, 'reset');
  const responses = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        headers,
        payload: { token, password: 'Changed-test-password-123' },
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 400]);
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: h(c) })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers,
        payload: { identifier: c.identifier, password: 'Changed-test-password-123' },
      })
    ).statusCode,
    200,
  );
});
test('expired and wrong-purpose tokens cannot reset passwords', async () => {
  const c = await tracked();
  const token = mailToken(c.user.id, 'verify');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        headers,
        payload: { token, password },
      })
    ).statusCode,
    400,
  );
  await db.accountToken.updateMany({
    where: { userId: c.user.id },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        headers,
        payload: { token },
      })
    ).statusCode,
    400,
  );
});
test('change password requires current password and revokes every session', async () => {
  const c = await register();
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/users/me/password',
        headers: h(c),
        payload: { currentPassword: 'bad', newPassword: password },
      })
    ).statusCode,
    400,
  );
  const r = await app.inject({
    method: 'POST',
    url: '/v1/users/me/password',
    headers: h(c),
    payload: { currentPassword: password, newPassword: 'New-test-password-987' },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(await db.session.count({ where: { userId: c.user.id } }), 0);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers,
        payload: { identifier: c.identifier, password },
      })
    ).statusCode,
    401,
  );
});
test('session listing hides token hashes and another user cannot revoke a session', async () => {
  const a = await register(),
    b = await register();
  const r = await app.inject({ url: '/v1/users/me/sessions', headers: h(a) });
  assert.equal(r.statusCode, 200);
  const session = r.json().sessions[0];
  assert.equal(session.current, true);
  assert.equal('tokenHash' in session, false);
  await app.inject({ method: 'DELETE', url: `/v1/users/me/sessions/${session.id}`, headers: h(b) });
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: h(a) })).statusCode, 200);
  await app.inject({ method: 'DELETE', url: `/v1/users/me/sessions/${session.id}`, headers: h(a) });
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: h(a) })).statusCode, 401);
});
test('revoke others preserves the current session only', async () => {
  const c = await register();
  await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers,
    payload: { identifier: c.identifier, password },
  });
  assert.equal(await db.session.count({ where: { userId: c.user.id } }), 2);
  const r = await app.inject({ method: 'POST', url: '/v1/users/me/revoke-others', headers: h(c) });
  assert.equal(r.statusCode, 200);
  assert.equal(await db.session.count({ where: { userId: c.user.id } }), 1);
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: h(c) })).statusCode, 200);
});
test('avatar uploads validate content and re-encode to WebP', async () => {
  const c = await register();
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#7958ff' },
  })
    .png()
    .toBuffer();
  const boundary = 'warp-test-boundary';
  const upload = async (bytes: Buffer, mime: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/users/me/avatar',
      headers: { ...h(c), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="avatar.png"\r\nContent-Type: ${mime}\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  assert.equal((await upload(Buffer.from('<svg/>'), 'image/svg+xml')).statusCode, 400);
  assert.equal((await upload(Buffer.from('not a png'), 'image/png')).statusCode, 400);
  assert.equal((await upload(Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png')).statusCode, 413);
  const r = await upload(image, 'image/png');
  assert.equal(r.statusCode, 200, r.body);
  const img = await app.inject(r.json().user.avatarUrl);
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/webp');
  const metadata = await sharp(img.rawPayload).metadata();
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.equal(
    (await app.inject({ method: 'DELETE', url: '/v1/users/me/avatar', headers: h(c) })).statusCode,
    200,
  );
  assert.equal((await app.inject(`/v1/users/${c.user.id}/avatar`)).statusCode, 404);
});
test('logout revokes session immediately', async () => {
  const c = await register();
  assert.equal(
    (await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: h(c) })).statusCode,
    200,
  );
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: h(c) })).statusCode, 401);
});
test('account deletion requires password and cascades sessions and tokens', async () => {
  const c = await register();
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: '/v1/users/me',
        headers: h(c),
        payload: { password: 'wrong' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: '/v1/users/me',
        headers: h(c),
        payload: { password },
      })
    ).statusCode,
    200,
  );
  assert.equal(await db.user.findUnique({ where: { id: c.user.id } }), null);
  assert.equal(await db.session.count({ where: { userId: c.user.id } }), 0);
  assert.equal(await db.accountToken.count({ where: { userId: c.user.id } }), 0);
});
test('production cookies use Secure and __Host prefix', async () => {
  const prod = await buildApp(
    { ...cfg, NODE_ENV: 'production' },
    { db, mailer: async () => {}, logger: false },
  );
  try {
    const c = await register();
    const r = await prod.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers,
      payload: { identifier: c.identifier, password, remember: true },
    });
    assert.equal(r.statusCode, 200);
    const cookie = String(r.headers['set-cookie']);
    assert.match(cookie, /^__Host-warp_session=/);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; HttpOnly/);
    assert.equal(cookie.includes('Domain='), false);
  } finally {
    await prod.close();
  }
});
test('rate limiter rejects repeated authentication attempts', async () => {
  const limited = await buildApp(cfg, {
    db,
    logger: false,
    mailer: async () => {},
    rateLimitMax: 2,
  });
  try {
    const attempts = [];
    for (let i = 0; i < 3; i++)
      attempts.push(
        await limited.inject({
          method: 'POST',
          url: '/v1/auth/login',
          headers,
          payload: { identifier: 'nonexistent', password },
        }),
      );
    assert.deepEqual(
      attempts.map((r) => r.statusCode),
      [401, 401, 429],
    );
  } finally {
    await limited.close();
  }
});
test('production configuration refuses HTTP and development mail storage', () => {
  assert.throws(() =>
    loadConfig({
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: cfg.SESSION_SECRET,
      WEB_URL: 'http://localhost:5173',
      CORS_ORIGINS: 'http://localhost:5173',
    }),
  );
});
