import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { GraphService } from '../src/services/graph.js';

const deployment = 'QmTestDeployment';
const rpcHash = `0x${'12'.repeat(32)}`;
const rpc = {
  getChainId: async () => 11155111,
  getBlockNumber: async () => 1_000n,
  getBlock: async () => ({ hash: rpcHash }),
};
const settings = loadConfig({
  SEPOLIA_RPC_URL: 'http://127.0.0.1:8545',
  STAR_SUBGRAPH_URL: 'https://example.com/subgraph',
  STAR_SUBGRAPH_DEPLOYMENT_ID: deployment,
  STAR_SUBGRAPH_MAX_BLOCK_LAG: '120',
});

afterEach(() => mock.restoreAll());

test('coalesces simultaneous identical indexed reads without caching later requests', async () => {
  let resolveResponse!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const upstream = mock.method(globalThis, 'fetch', () => pending);
  const graph = new GraphService(settings, rpc);
  const first = graph.indexingStatus();
  const duplicate = graph.indexingStatus();

  assert.equal(upstream.mock.callCount(), 1);
  resolveResponse(graphResponse(995, false));
  assert.deepEqual(await first, await duplicate);

  upstream.mock.mockImplementation(async () => graphResponse(995, false));
  await graph.indexingStatus();
  assert.equal(upstream.mock.callCount(), 2);
});

test('applies provider cooldowns without background retries', async () => {
  let now = 1_000_000;
  mock.method(Date, 'now', () => now);
  const upstream = mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('Too many requests', {
        status: 429,
        headers: { 'content-type': 'text/html', 'retry-after': '30' },
      }),
  );
  const graph = new GraphService(settings, rpc);

  await assert.rejects(graph.indexingStatus(), {
    statusCode: 429,
    code: 'SUBGRAPH_RATE_LIMITED',
    details: { retryAfterSeconds: 30 },
  });
  now += 10_000;
  await assert.rejects(graph.indexingStatus(), {
    statusCode: 429,
    code: 'SUBGRAPH_RATE_LIMITED',
    details: { retryAfterSeconds: 20 },
  });
  assert.equal(upstream.mock.callCount(), 1);
  now += 20_000;
  assert.equal(upstream.mock.callCount(), 1);
  upstream.mock.mockImplementation(async () => graphResponse(995, false));
  await graph.indexingStatus();
  assert.equal(upstream.mock.callCount(), 2);
});

test('honors HTTP-date Retry-After and safely defaults malformed values', async () => {
  const now = Date.parse('2026-09-08T00:00:00Z');
  mock.method(Date, 'now', () => now);
  for (const [header, seconds] of [
    [new Date(now + 45_000).toUTCString(), 45],
    [null, 60],
    ['invalid', 60],
  ] as const) {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response('Busy', {
          status: 429,
          headers: header ? { 'retry-after': header } : {},
        }),
    );
    await assert.rejects(new GraphService(settings, rpc).indexingStatus(), {
      statusCode: 429,
      details: { retryAfterSeconds: seconds },
    });
  }
});

test('removes failed coalesced reads so a deliberate retry can recover', async () => {
  const upstream = mock.method(globalThis, 'fetch', async () => {
    throw new Error('offline');
  });
  const graph = new GraphService(settings, rpc);
  await Promise.all([
    assert.rejects(graph.indexingStatus(), { code: 'SUBGRAPH_UNAVAILABLE' }),
    assert.rejects(graph.indexingStatus(), { code: 'SUBGRAPH_UNAVAILABLE' }),
  ]);
  assert.equal(upstream.mock.callCount(), 1);
  upstream.mock.mockImplementation(async () => graphResponse(995, false));
  await graph.indexingStatus();
  assert.equal(upstream.mock.callCount(), 2);
});

test('requires the configured deployment and rejects malformed indexing metadata', async () => {
  const upstream = mock.method(globalThis, 'fetch', async () => graphResponse(995, false));
  await assert.rejects(
    new GraphService({ ...settings, STAR_SUBGRAPH_DEPLOYMENT_ID: undefined }, rpc).indexingStatus(),
    /STAR_SUBGRAPH_DEPLOYMENT_ID are required/,
  );
  assert.equal(upstream.mock.callCount(), 0);
  await assert.rejects(
    new GraphService(
      { ...settings, STAR_SUBGRAPH_DEPLOYMENT_ID: 'another-deployment' },
      rpc,
    ).indexingStatus(),
    /deployment does not match/,
  );
  mock.restoreAll();

  for (const meta of [null, {}, { deployment, block: {}, hasIndexingErrors: false }]) {
    mock.method(globalThis, 'fetch', async () => Response.json({ data: { _meta: meta } }));
    await assert.rejects(new GraphService(settings, rpc).indexingStatus(), { statusCode: 503 });
    mock.restoreAll();
  }
});

test('sanitizes upstream query failures', async () => {
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ errors: [{ message: 'private upstream detail' }] }),
  );
  await assert.rejects(new GraphService(settings, rpc).indexingStatus(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'The Star Subgraph could not serve the query');
    return true;
  });
});

test('reports bounded lag and verifies the indexed Sepolia block hash', async () => {
  mock.method(globalThis, 'fetch', async () => graphResponse(950, false));
  const status = await new GraphService(settings, rpc).indexingStatus();

  assert.equal(status.block.number, 950);
  assert.equal(status.currentBlock, 1_000);
  assert.equal(status.blockLag, 50);
  assert.equal(status.maximumBlockLag, 120);
});

test('rejects indexing errors, stale or future blocks, another chain, and a mismatched hash', async () => {
  const graph = new GraphService(settings, rpc);

  mock.method(globalThis, 'fetch', async () => graphResponse(950, true));
  await assert.rejects(graph.indexingStatus(), /indexing errors/i);
  mock.restoreAll();

  mock.method(globalThis, 'fetch', async () => graphResponse(800, false));
  await assert.rejects(graph.indexingStatus(), /200 blocks behind Sepolia/i);
  mock.restoreAll();

  mock.method(globalThis, 'fetch', async () => graphResponse(1_001, false));
  await assert.rejects(graph.indexingStatus(), /ahead of the configured Sepolia RPC/i);
  mock.restoreAll();

  mock.method(globalThis, 'fetch', async () => graphResponse(995, false));
  await assert.rejects(
    new GraphService(settings, { ...rpc, getChainId: async () => 1 }).indexingStatus(),
    /expected 11155111/,
  );
  await assert.rejects(
    new GraphService(settings, {
      ...rpc,
      getBlock: async () => ({ hash: `0x${'34'.repeat(32)}` }),
    }).indexingStatus(),
    /does not match Sepolia/,
  );
});

function graphResponse(block: number, hasIndexingErrors: boolean): Response {
  return Response.json({
    data: {
      _meta: {
        deployment,
        block: { number: block, hash: rpcHash, timestamp: 1_000_000 },
        hasIndexingErrors,
      },
    },
  });
}
