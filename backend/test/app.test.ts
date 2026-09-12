import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { HttpError, unavailable } from '../src/errors.js';

const settings = loadConfig({ NODE_ENV: 'test', SEPOLIA_RPC_URL: 'http://127.0.0.1:1' });

test('safety-limit errors keep a friendly message and Retry-After without triggering auth', async (t) => {
  const app = await buildApp(settings);
  t.after(() => app.close());
  app.post('/test/safety-limit', async () => {
    throw new HttpError(429, 'CHILD_REQUEST_RATE_LIMIT', 'Please wait a minute and try again.', {
      retryAfterSeconds: 60,
    });
  });
  const response = await app.inject({ method: 'POST', url: '/test/safety-limit' });
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['retry-after'], '60');
  assert.equal(response.json().code, 'CHILD_REQUEST_RATE_LIMIT');
  assert.equal(response.json().message, 'Please wait a minute and try again.');
});

test('keeps Fastify client error statuses and hides internal failure details', async (t) => {
  const app = await buildApp(settings);
  t.after(() => app.close());
  app.post('/test/body', async (request) => request.body);
  app.get('/test/unavailable', async () => {
    throw unavailable('UPSTREAM_UNAVAILABLE', 'Temporarily unavailable', {
      cause: 'secret RPC credentials',
    });
  });
  app.get('/test/crash', async () => {
    throw new Error('secret internal error');
  });
  for (const [payload, contentType, status] of [
    ['{bad json', 'application/json', 400],
    ['unrecognized', 'application/octet-stream', 415],
    ['x'.repeat(1_048_577), 'text/plain', 413],
  ] as const) {
    const response = await app.inject({
      method: 'POST',
      url: '/test/body',
      headers: { 'content-type': contentType },
      payload,
    });
    assert.equal(response.statusCode, status);
    assert.ok(response.json().requestId);
  }
  const unavailableResponse = await app.inject('/test/unavailable');
  assert.equal(unavailableResponse.statusCode, 503);
  assert.equal(unavailableResponse.json().details, undefined);
  assert.doesNotMatch(unavailableResponse.body, /secret/);
  const crash = await app.inject('/test/crash');
  assert.equal(crash.statusCode, 500);
  assert.doesNotMatch(crash.body, /secret/);
});

test('validates indexed-read IDs, cursors, pagination and wallet addresses before I/O', async (t) => {
  const app = await buildApp(settings);
  t.after(() => app.close());
  for (const url of [
    '/v1/families/' + '9'.repeat(79),
    '/v1/families/1?skip=2147483648',
    '/v1/families/1?blockHash=invalid',
    '/v1/families/1/inbox?blockHash=invalid',
    '/v1/families/by-parent/0x0000000000000000000000000000000000001234?first=101',
    '/v1/families/1/activity?before=' + (1n << 256n),
    '/v1/children/by-wallet/0x0000000000000000000000000000000000000000',
  ])
    assert.equal((await app.inject(url)).statusCode, 400, url);
});

test('public configuration uses backend ENS settings without requiring RPC or exposing secrets', async (t) => {
  const app = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      ENS_PARENT_NAME: 'different.eth',
      SEPOLIA_RPC_URL: 'http://127.0.0.1:1/secret',
    }),
  );
  t.after(() => app.close());
  const response = await app.inject('/v1/config');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { chainId: 11155111, ensParentName: 'different.eth' });
});
