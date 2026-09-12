import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ProtocolService, type ProtocolReadiness } from '../src/services/protocol.js';
import { GoalRequestService } from '../src/services/goal-requests.js';

test('goal request routes validate exact metadata and targets before preparing an intent', async (t) => {
  t.mock.method(ProtocolService.prototype, 'ensureReady', async () => ({}) as ProtocolReadiness);
  const prepare = t.mock.method(GoalRequestService.prototype, 'prepare', async () => ({
    intents: [],
  }));
  const app = await buildApp(loadConfig({ NODE_ENV: 'test' }));
  t.after(() => app.close());
  const payload = {
    childId: '7',
    title: 'Rocket Toy',
    reason: '',
    icon: 6,
    submissionId: `0x${'01'.repeat(32)}`,
  };
  for (const change of [
    { title: '   ' },
    { title: '🌟'.repeat(17) },
    { reason: 'x'.repeat(481) },
    { icon: -1 },
    { icon: 7 },
    { icon: '6' },
    { childId: '0' },
    { submissionId: `0x${'00'.repeat(32)}` },
    { starCost: '20' },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/intents/goal-requests/request',
      payload: { ...payload, ...change },
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(prepare.mock.callCount(), 0);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/v1/intents/goal-requests/request', payload }))
      .statusCode,
    200,
  );
  const body = { childId: '7', requestId: '1', starCost: '32' };
  for (const starCost of ['0', '-1', '1.5', (1n << 256n).toString()]) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/intents/goal-requests/approve',
          payload: { ...body, starCost },
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(prepare.mock.callCount(), 1);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/v1/intents/goal-requests/approve', payload: body }))
      .statusCode,
    200,
  );
  assert.equal(prepare.mock.callCount(), 2);
});

test('unsupported deployments do not query a newer schema or present a successful request', async (t) => {
  const goalsAddress = '0x0000000000000000000000000000000000000001';
  t.mock.method(GoalRequestService.prototype, 'capability', async () => ({
    supported: false,
    goalsAddress,
  }));
  const app = await buildApp(
    loadConfig({ NODE_ENV: 'test', SEPOLIA_RPC_URL: 'http://127.0.0.1:1' }),
  );
  t.after(() => app.close());
  const response = await app.inject('/v1/families/8/goal-requests');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    supported: false,
    goalsAddress,
    requests: [],
    nextOffset: null,
  });
  assert.equal((await app.inject('/v1/families/8/goal-requests?first=101')).statusCode, 400);
});
