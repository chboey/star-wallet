import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { HttpError, unavailable } from '../src/errors.js';

const settings = loadConfig({
  NODE_ENV: 'test',
  DEPLOYMENT_FILE: fileURLToPath(new URL('./fixtures/empty-deployment.json', import.meta.url)),
  SEPOLIA_RPC_URL: 'http://127.0.0.1:1',
});

test('exposes health, readiness and OpenAPI documentation without enabling signing', async (t) => {
  const app = await buildApp(settings);
  t.after(() => app.close());
  const health = await app.inject('/health');
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), {
    status: 'ok',
    canonicalState: 'sepolia-contracts',
    chainId: 11155111,
    contractsConfigured: false,
    signingEnabled: false,
    databaseEnabled: false,
  });
  assert.equal((await app.inject('/ready')).statusCode, 200);
  assert.equal((await app.inject('/docs/json')).statusCode, 200);
});

test('preserves controlled errors and hides internal failure details', async (t) => {
  const app = await buildApp(settings);
  t.after(() => app.close());
  app.get('/test/limited', async () => {
    throw new HttpError(429, 'REQUEST_RATE_LIMIT', 'Please wait and try again.', {
      retryAfterSeconds: 60,
    });
  });
  app.get('/test/unavailable', async () => {
    throw unavailable('UPSTREAM_UNAVAILABLE', 'Temporarily unavailable', {
      cause: 'secret RPC credentials',
    });
  });
  app.get('/test/crash', async () => {
    throw new Error('secret internal error');
  });

  const limited = await app.inject('/test/limited');
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['retry-after'], '60');
  assert.equal(limited.json().code, 'REQUEST_RATE_LIMIT');

  const unavailableResponse = await app.inject('/test/unavailable');
  assert.equal(unavailableResponse.statusCode, 503);
  assert.equal(unavailableResponse.json().details, undefined);
  assert.doesNotMatch(unavailableResponse.body, /secret/);

  const crash = await app.inject('/test/crash');
  assert.equal(crash.statusCode, 500);
  assert.doesNotMatch(crash.body, /secret/);
});

test('keeps Fastify client errors and request identifiers', async (t) => {
  const app = await buildApp(settings);
  t.after(() => app.close());
  app.post('/test/body', async (request) => request.body);
  for (const [payload, contentType, statusCode] of [
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
    assert.equal(response.statusCode, statusCode);
    assert.ok(response.json().requestId);
  }
});
