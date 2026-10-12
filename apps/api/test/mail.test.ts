import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createMailer } from '../src/mail.js';
const env = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://test:test@localhost/warp_test',
  WEB_URL: 'https://warp.example.test',
  CORS_ORIGINS: 'https://warp.example.test',
  SESSION_SECRET: 'test-only-secret-32-characters-long',
  MAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 'test-only-api-key',
  MAIL_FROM: 'Warp <warp@example.test>',
};
test('production accepts HTTPS mail provider without SMTP and rejects missing credentials', () => {
  assert.equal(loadConfig(env).MAIL_PROVIDER, 'resend');
  assert.throws(() => loadConfig({ ...env, RESEND_API_KEY: undefined }));
  assert.throws(() => loadConfig({ ...env, DEV_MAIL_DIR: './mail' }));
});
test('HTTPS mail transport sends the required contract and handles acceptance', async () => {
  let calls = 0;
  const send: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options?.method, 'POST');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-only-api-key');
    assert.deepEqual(JSON.parse(String(options?.body)), {
      from: env.MAIL_FROM,
      to: ['recipient@example.test'],
      subject: 'Verification',
      text: 'One-time link',
    });
    assert.ok(options?.signal);
    return new Response(JSON.stringify({ id: 'test-message-id' }), { status: 200 });
  };
  await createMailer(
    loadConfig(env),
    send,
  )({ to: 'recipient@example.test', subject: 'Verification', text: 'One-time link' });
  assert.equal(calls, 1);
});
test('HTTPS mail transport rejects provider failures and malformed acceptance', async () => {
  for (const response of [
    new Response('private provider diagnostic', { status: 403 }),
    new Response('{}', { status: 200 }),
  ]) {
    const send: typeof fetch = async () => response;
    await assert.rejects(
      createMailer(
        loadConfig(env),
        send,
      )({ to: 'recipient@example.test', subject: 'Test', text: 'Test' }),
      (error) => error instanceof Error && !error.message.includes('private provider diagnostic'),
    );
  }
});
