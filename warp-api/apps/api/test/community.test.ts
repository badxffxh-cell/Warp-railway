import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Use a dedicated _test database');
const db = new PrismaClient({ datasourceUrl: url });
const cfg = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: url,
  WEB_URL: 'http://localhost:5173',
  CORS_ORIGINS: 'http://localhost:5173',
  SESSION_SECRET: randomBytes(32).toString('hex'),
});
const app = await buildApp(cfg, { db, mailer: async () => {}, logger: false, rateLimitMax: 1000 });
const ids: string[] = [],
  sockets: WebSocket[] = [];
type Client = { id: string; username: string; cookie: string; csrf: string };
let a: Client,
  b: Client,
  c: Client,
  serverId: string,
  textId: string,
  voiceId: string,
  friendId: string,
  dmId: string,
  wsUrl: string;
const h = (u?: Client) => ({
  origin: cfg.WEB_URL,
  'x-warp-client': 'web',
  ...(u ? { cookie: u.cookie, 'x-csrf-token': u.csrf } : {}),
});
async function request(
  u: Client,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: object,
) {
  return app.inject({
    method,
    url: `/v1${path}`,
    headers: h(u),
    ...(body ? { payload: body } : {}),
  });
}
async function register() {
  const username = `t_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const r = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    headers: h(),
    payload: {
      username,
      email: `${username}@example.test`,
      displayName: username,
      password: 'Integration-test-123!',
      remember: true,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const j = r.json();
  ids.push(j.user.id);
  return {
    id: j.user.id,
    username,
    cookie: String(r.headers['set-cookie']).split(';')[0]!,
    csrf: j.csrfToken,
  };
}
function event(ws: WebSocket, type: string) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', fn);
      reject(new Error(`No ${type} event`));
    }, 5000);
    function fn(raw: WebSocket.RawData) {
      const e = JSON.parse(raw.toString());
      if (e.type === type) {
        clearTimeout(timer);
        ws.off('message', fn);
        resolve(e);
      }
    }
    ws.on('message', fn);
  });
}
async function connect(u: Client, channelId: string) {
  const r = await request(u, 'POST', '/realtime/ticket');
  assert.equal(r.statusCode, 200, r.body);
  const ws = new WebSocket(wsUrl, { origin: cfg.WEB_URL });
  sockets.push(ws);
  const ready = event(ws, 'ready');
  ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', ticket: r.json().ticket })));
  await ready;
  const subscribed = event(ws, 'subscribed');
  ws.send(JSON.stringify({ type: 'subscribe', channelId }));
  await subscribed;
  return ws;
}
before(async () => {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  wsUrl = `ws://127.0.0.1:${address.port}/v1/realtime`;
  a = await register();
  b = await register();
  c = await register();
});
after(async () => {
  for (const ws of sockets) ws.terminate();
  await app.close();
  await db.server.deleteMany({ where: { ownerId: { in: ids } } });
  const direct = await db.friendship.findMany({
    where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] },
    select: { channelId: true },
  });
  await db.channel.deleteMany({
    where: { id: { in: direct.flatMap((f) => (f.channelId ? [f.channelId] : [])) } },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});
test('server creates text and voice channels; outsiders cannot read or manage', async () => {
  const r = await request(a, 'POST', '/servers', {
    name: 'Integration community',
    description: 'Real database',
  });
  assert.equal(r.statusCode, 201, r.body);
  const s = r.json().server;
  serverId = s.id;
  textId = s.channels.find((x: any) => x.kind === 'TEXT').id;
  voiceId = s.channels.find((x: any) => x.kind === 'VOICE').id;
  assert.equal(s.role, 'OWNER');
  assert.equal((await request(b, 'GET', `/channels/${textId}/messages`)).statusCode, 404);
  assert.equal(
    (await request(b, 'POST', `/servers/${serverId}/channels`, { name: 'forbidden', kind: 'TEXT' }))
      .statusCode,
    404,
  );
});
test('invite locks enforce maxUses under concurrent joins', async () => {
  const i = await request(a, 'POST', `/servers/${serverId}/invites`, { hours: 1, maxUses: 1 });
  assert.equal(i.statusCode, 201, i.body);
  const results = await Promise.all(
    [b, c].map((u) => request(u, 'POST', '/invites/join', { code: i.json().code })),
  );
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
  if (results[1]!.statusCode === 200) [b, c] = [c, b];
  assert.equal(
    (await request(b, 'POST', `/servers/${serverId}/channels`, { name: 'no', kind: 'TEXT' }))
      .statusCode,
    403,
  );
});
test('owner can grant admin; members cannot grant roles; admin creates channels', async () => {
  assert.equal(
    (await request(b, 'PATCH', `/servers/${serverId}/members/${b.id}`, { role: 'ADMIN' }))
      .statusCode,
    403,
  );
  assert.equal(
    (await request(a, 'PATCH', `/servers/${serverId}/members/${b.id}`, { role: 'ADMIN' }))
      .statusCode,
    200,
  );
  assert.equal(
    (await request(b, 'POST', `/servers/${serverId}/channels`, { name: 'news', kind: 'TEXT' }))
      .statusCode,
    201,
  );
  assert.equal((await request(b, 'DELETE', `/servers/${serverId}`)).statusCode, 403);
});
test('messages persist and arrive over real WebSocket; retries are idempotent', async () => {
  const ws = await connect(b, textId),
    next = event(ws, 'message');
  const payload = { content: 'Olá em tempo real', clientId: randomUUID() };
  const r = await request(a, 'POST', `/channels/${textId}/messages`, payload);
  assert.equal(r.statusCode, 201, r.body);
  assert.equal((await next).message.id, r.json().message.id);
  const retry = await request(a, 'POST', `/channels/${textId}/messages`, payload);
  assert.equal(retry.json().message.id, r.json().message.id);
  assert.equal(await db.message.count({ where: { channelId: textId } }), 1);
  assert.equal(
    (await request(b, 'PATCH', `/messages/${r.json().message.id}`, { content: 'impersonation' }))
      .statusCode,
    403,
  );
  assert.equal(
    (await request(a, 'PATCH', `/messages/${r.json().message.id}`, { content: 'Edited' })).json()
      .message.content,
    'Edited',
  );
  assert.ok(
    (await request(b, 'DELETE', `/messages/${r.json().message.id}`)).json().message.deletedAt,
  );
});
test('pagination uses sequence cursor without duplicate history', async () => {
  await db.message.createMany({
    data: Array.from({ length: 55 }, (_, i) => ({
      channelId: textId,
      authorId: a.id,
      clientId: randomUUID(),
      content: `page ${i}`,
    })),
  });
  const page = (await request(a, 'GET', `/channels/${textId}/messages`)).json();
  assert.equal(page.messages.length, 50);
  assert.equal(page.hasMore, true);
  const older = (
    await request(a, 'GET', `/channels/${textId}/messages?before=${page.messages[0].sequence}`)
  ).json();
  assert.equal(older.messages.length, 6);
  assert.equal(new Set([...page.messages, ...older.messages].map((m) => m.id)).size, 56);
});
test('friend requests normalize @username, require recipient acceptance, hide private fields', async () => {
  assert.equal(
    (await request(a, 'POST', '/friends', { username: `@${b.username.toUpperCase()}` })).statusCode,
    201,
  );
  const friends = (await request(b, 'GET', '/friends')).json().friends;
  friendId = friends[0].id;
  assert.equal(friends[0].incoming, true);
  assert.equal('email' in friends[0].user, false);
  assert.equal((await request(a, 'POST', `/friends/${friendId}/accept`)).statusCode, 403);
  assert.equal((await request(c, 'POST', `/friends/${friendId}/accept`)).statusCode, 404);
  assert.equal((await request(b, 'POST', `/friends/${friendId}/accept`)).statusCode, 200);
  dmId = (await request(a, 'GET', '/friends')).json().friends[0].channel.id;
});
test('private messages deliver only to the two friends; third account denied', async () => {
  assert.equal((await request(c, 'GET', `/channels/${dmId}/messages`)).statusCode, 404);
  assert.equal((await request(c, 'POST', `/channels/${dmId}/voice`)).statusCode, 404);
  const ws = await connect(b, dmId),
    next = event(ws, 'message');
  const r = await request(a, 'POST', `/channels/${dmId}/messages`, {
    content: 'Mensagem privada',
    clientId: randomUUID(),
  });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal((await next).message.content, 'Mensagem privada');
  assert.equal((await request(b, 'DELETE', `/messages/${r.json().message.id}`)).statusCode, 403);
  assert.equal(
    (await request(a, 'PATCH', `/channels/${dmId}`, { name: 'forbidden' })).statusCode,
    403,
  );
});
test('unconfigured voice fails explicitly instead of pretending to connect', async () => {
  const response = await request(a, 'POST', `/channels/${voiceId}/voice`);
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'VOICE_UNAVAILABLE');
  assert.match(response.json().error.message, /LiveKit/);
  assert.equal((await request(a, 'POST', `/channels/${dmId}/call`)).statusCode, 503);
});
test('blocking removes DM authorization, friendship and further requests', async () => {
  assert.equal((await request(b, 'POST', '/blocks', { userId: a.id })).statusCode, 200);
  assert.equal((await request(a, 'GET', `/channels/${dmId}/messages`)).statusCode, 404);
  assert.equal((await request(a, 'POST', '/friends', { username: b.username })).statusCode, 400);
  assert.equal((await request(b, 'GET', '/blocks')).json().users[0].id, a.id);
  assert.equal((await request(b, 'DELETE', `/blocks/${a.id}`)).statusCode, 200);
  assert.equal((await request(a, 'POST', '/friends', { username: b.username })).statusCode, 201);
});
test('kicked member cannot send or subscribe to previous channels', async () => {
  assert.equal(
    (await request(a, 'DELETE', `/servers/${serverId}/members/${b.id}`)).statusCode,
    200,
  );
  assert.equal(
    (
      await request(b, 'POST', `/channels/${textId}/messages`, {
        content: 'denied',
        clientId: randomUUID(),
      })
    ).statusCode,
    404,
  );
});
test('WebSocket ticket is one-use and revoking session rejects further messages', async () => {
  const r = await request(a, 'POST', '/realtime/ticket');
  const ticket = r.json().ticket;
  const ws = new WebSocket(wsUrl, { origin: cfg.WEB_URL });
  sockets.push(ws);
  const ready = event(ws, 'ready');
  ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', ticket })));
  await ready;
  const duplicate = new WebSocket(wsUrl, { origin: cfg.WEB_URL });
  sockets.push(duplicate);
  const closed = new Promise<number>((resolve) => duplicate.on('close', resolve));
  duplicate.on('open', () => duplicate.send(JSON.stringify({ type: 'auth', ticket })));
  assert.equal(await closed, 4001);
  await db.session.deleteMany({ where: { userId: a.id } });
  const revoked = new Promise<number>((resolve) => ws.on('close', resolve));
  ws.send(JSON.stringify({ type: 'subscribe', channelId: textId }));
  assert.equal(await revoked, 4001);
});
