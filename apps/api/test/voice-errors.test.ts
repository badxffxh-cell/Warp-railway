import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceFailure, voiceRequest } from '../src/voice-errors.js';

for (const [error, code] of [
  [{ status: 401 }, 'LIVEKIT_AUTH'],
  [{ status: 403 }, 'LIVEKIT_AUTH'],
  [{ code: 'permission_denied' }, 'LIVEKIT_AUTH'],
  [{ status: 404 }, 'LIVEKIT_ADDRESS'],
  [{ status: 429 }, 'LIVEKIT_LIMIT'],
  [{ name: 'TimeoutError' }, 'LIVEKIT_TIMEOUT'],
  [{ cause: { code: 'ENOTFOUND' } }, 'LIVEKIT_CONNECTION'],
  [{ name: 'TypeError' }, 'LIVEKIT_CONNECTION'],
  [{ status: 500 }, 'LIVEKIT_SERVICE'],
] as const) {
  test(`voice error maps ${JSON.stringify(error)} to ${code} without secrets`, () => {
    const mapped = voiceFailure({ ...error, message: 'PRIVATE_API_SECRET', metadata: { token: 'PRIVATE_TOKEN' } });
    assert.equal(mapped.code, code);
    assert.ok(mapped.statusCode >= 500);
    assert.doesNotMatch(mapped.message, /PRIVATE/);
  });
}
test('voice request returns success and sanitizes failed provider calls', async () => {
  assert.equal(await voiceRequest(async () => 'room'), 'room');
  await assert.rejects(voiceRequest(async () => { throw { status: 401, message: 'PRIVATE_SECRET' }; }), { code: 'LIVEKIT_AUTH' });
});
