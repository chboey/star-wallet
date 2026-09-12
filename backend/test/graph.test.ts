import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { GraphService } from '../src/services/graph.js';

const deployment = 'QmTestDeployment';
const rpcHash = '0x' + '12'.repeat(32);
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

test('goal allocation reads support rolling upgrades without inventing balances or retrying an old schema repeatedly', async () => {
  const queries: string[] = [];
  mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body));
    queries.push(query);
    if (query.includes('allocatedStars'))
      return Response.json({
        errors: [{ message: 'Cannot query field "allocatedStars" on type "Goal".' }],
      });
    return Response.json({
      data: {
        family: { id: '7', goals: [{ id: '1', starCost: '10' }] },
        _meta: { deployment, block: { number: 995, hash: rpcHash }, hasIndexingErrors: false },
      },
    });
  });
  const graph = new GraphService(settings, rpc);
  const result = await graph.family('7', { first: 100, skip: 0 });
  assert.deepEqual(result?.goals, [{ id: '1', starCost: '10' }]);
  assert.equal(queries.length, 2);
  await graph.family('7', { first: 100, skip: 0 });
  assert.equal(queries.length, 3);
  assert.equal(queries[2]?.includes('allocatedStars'), false);
});

test('new subgraphs return actual goal allocations and unrelated schema errors are not silently retried', async () => {
  const upstream = mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    assert.match(JSON.parse(String(init?.body)).query, /allocatedStars/);
    return Response.json({
      data: {
        family: { id: '7', goals: [{ id: '1', starCost: '10', allocatedStars: '4' }] },
        _meta: { deployment, block: { number: 995, hash: rpcHash }, hasIndexingErrors: false },
      },
    });
  });
  const graph = new GraphService(settings, rpc);
  assert.deepEqual((await graph.family('7', { first: 100, skip: 0 }))?.goals, [
    { id: '1', starCost: '10', allocatedStars: '4' },
  ]);
  upstream.mock.mockImplementation(async () =>
    Response.json({ errors: [{ message: 'Cannot query field "missing" on type "Goal".' }] }),
  );
  await assert.rejects(graph.family('7', { first: 100, skip: 0 }), { code: 'SUBGRAPH_ERROR' });
  assert.equal(upstream.mock.callCount(), 2);
});

test('coalesces simultaneous identical Subgraph queries without caching later reads or other families', async () => {
  let resolveResponse!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const upstream = mock.method(globalThis, 'fetch', () => pending);
  const graph = new GraphService(settings, rpc);
  const page = { first: 100, skip: 0 };
  const a = graph.family('7', page);
  const duplicate = graph.family('7', page);
  assert.equal(upstream.mock.callCount(), 1);
  resolveResponse(
    Response.json({
      data: {
        family: { id: '7' },
        _meta: { deployment, block: { number: 995, hash: rpcHash }, hasIndexingErrors: false },
      },
    }),
  );
  assert.deepEqual(await a, await duplicate);
  upstream.mock.mockImplementation(async (_url: unknown, init?: RequestInit) =>
    Response.json({
      data: {
        family: { id: JSON.parse(String(init?.body)).variables.id },
        _meta: { deployment, block: { number: 995, hash: rpcHash }, hasIndexingErrors: false },
      },
    }),
  );
  const [again, other] = await Promise.all([graph.family('7', page), graph.family('8', page)]);
  assert.equal(upstream.mock.callCount(), 3);
  assert.equal(again?.id, '7');
  assert.equal(other?.id, '8');
});

test('plain-text HTTP 429 respects Retry-After across endpoints and resumes only on a later requested read', async () => {
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
  await assert.rejects(graph.family('7', { first: 100, skip: 0 }), {
    statusCode: 429,
    code: 'SUBGRAPH_RATE_LIMITED',
    details: { retryAfterSeconds: 20 },
  });
  assert.equal(upstream.mock.callCount(), 1, 'Cooldown must not call the provider again');
  now += 20_000;
  assert.equal(upstream.mock.callCount(), 1, 'No timer retries when cooldown ends');
  upstream.mock.mockImplementation(async () => graphResponse(995, false));
  assert.equal((await graph.indexingStatus()).block.number, 995);
  assert.equal(upstream.mock.callCount(), 2);
});

test('HTTP-date Retry-After is honored and missing or malformed values get a safe cooldown', async () => {
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

test('failed coalesced reads are removed so a deliberate retry can recover', async () => {
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

test('goal requests stay family-scoped and paginate at a pinned block', async () => {
  let variables: Record<string, unknown> = {};
  mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    variables = body.variables;
    assert.match(body.query, /orderBy: requestId/);
    return Response.json({
      data: {
        goalRequests: [{ id: '1', icon: 6 }],
        _meta: { deployment, block: { number: 995, hash: rpcHash }, hasIndexingErrors: false },
      },
    });
  });
  const page = await new GraphService(settings, rpc).goalRequests('8', {
    first: 1,
    skip: 1,
    blockHash: rpcHash,
  });
  assert.equal(variables.family, '8');
  assert.deepEqual(variables.block, { hash: rpcHash });
  assert.equal(page.nextOffset, 2);
  assert.ok(page.requests[0]);
  assert.equal(page.requests[0].icon, 6);
});

test('inbox filtering is scoped to family/child and pagination carries indexing metadata', async () => {
  let variables: Record<string, unknown> = {};
  mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    variables = JSON.parse(String(init?.body)).variables;
    return Response.json({
      data: {
        quests: [],
        starRequests: [{ id: 'workflow-1' }],
        _meta: { deployment, block: { number: 995, hash: rpcHash }, hasIndexingErrors: false },
      },
    });
  });
  const graph = new GraphService(settings, rpc);
  const waiting = await graph.inbox('7', { childId: '9', view: 'waiting', first: 1, skip: 0 });
  assert.deepEqual(variables.requestsWhere, { family: '7', child: '9', status_in: ['PENDING'] });
  assert.equal(waiting.nextOffset, 1);
  assert.equal(waiting.indexing.blockLag, 5);
  await graph.inbox('7', { view: 'history', first: 50, skip: 50 });
  assert.deepEqual(variables.requestsWhere, {
    family: '7',
    status_in: ['APPROVED', 'REJECTED', 'CANCELLED'],
  });
  assert.deepEqual(variables.questsWhere, { family: '7', status_in: ['COMPLETED', 'CANCELLED'] });
});

test('parent attention inbox pins every collection and metadata to the same snapshot', async () => {
  mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.variables.block, { hash: rpcHash });
    assert.deepEqual(body.variables.requestsWhere, { family: '7', status_in: ['PENDING'] });
    assert.match(body.query, /quests\(block: \$block/);
    assert.match(body.query, /starRequests\(block: \$block/);
    assert.match(body.query, /_meta\(block: \$block/);
    return Response.json({
      data: {
        quests: [],
        starRequests: [],
        _meta: { deployment, block: { number: 995, hash: rpcHash }, hasIndexingErrors: false },
      },
    });
  });
  const page = await new GraphService(settings, rpc).inbox('7', {
    view: 'waiting',
    first: 100,
    skip: 100,
    blockHash: rpcHash,
  });
  assert.equal(page.nextOffset, null);
  assert.equal(page.indexing.block.hash, rpcHash);
});

test('parent attention rejects a different snapshot instead of silently losing pending requests', async () => {
  mock.method(globalThis, 'fetch', async () =>
    Response.json({
      data: {
        quests: [],
        starRequests: [],
        _meta: { deployment, block: { number: 995, hash: rpcHash }, hasIndexingErrors: false },
      },
    }),
  );
  await assert.rejects(
    new GraphService(settings, rpc).inbox('7', {
      view: 'waiting',
      first: 100,
      skip: 100,
      blockHash: '0x' + '34'.repeat(32),
    }),
    /different pagination snapshot/,
  );
});

test('refuses unpinned or mismatched deployments, even on the same chain', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => graphResponse(995, false));
  await assert.rejects(
    new GraphService({ ...settings, STAR_SUBGRAPH_DEPLOYMENT_ID: undefined }, rpc).indexingStatus(),
    /STAR_SUBGRAPH_DEPLOYMENT_ID are required/,
  );
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(
    new GraphService(
      { ...settings, STAR_SUBGRAPH_DEPLOYMENT_ID: 'another-deployment' },
      rpc,
    ).indexingStatus(),
    /deployment does not match/,
  );
});

test('rejects missing or malformed indexing metadata with an availability error', async () => {
  for (const meta of [null, {}, { deployment, block: {}, hasIndexingErrors: false }]) {
    mock.method(globalThis, 'fetch', async () => Response.json({ data: { _meta: meta } }));
    await assert.rejects(new GraphService(settings, rpc).indexingStatus(), { statusCode: 503 });
    mock.restoreAll();
  }
});

test('does not expose upstream query errors in the public message', async () => {
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ errors: [{ message: 'private upstream detail' }] }),
  );
  await assert.rejects(new GraphService(settings, rpc).indexingStatus(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'The Star Subgraph could not serve the query');
    return true;
  });
});

test('portfolio reads distinguish zero inventory from missing or malformed balances', async () => {
  const savings = {
    availableUsdc: '120000000',
    availableWeth: '0',
    activePosition: null,
  };
  const reply = (value: unknown) =>
    Response.json({
      data: {
        family: { id: '1', parent: '0x0000000000000000000000000000000000001234', savings: value },
        _meta: {
          deployment,
          block: { number: 995, hash: rpcHash, timestamp: null },
          hasIndexingErrors: false,
        },
      },
    });
  mock.method(globalThis, 'fetch', async () => reply(savings));
  const result = await new GraphService(settings, rpc).portfolioBalances('1');
  assert.equal(result?.availableUsdc, 120_000_000n);
  assert.equal(result?.positionUsdc, 0n);
  assert.equal(result?.indexedTimestamp, undefined);
  mock.restoreAll();
  for (const value of [null, '', '  ', '0x10', '-1', 0, false]) {
    mock.method(globalThis, 'fetch', async () => reply({ ...savings, availableUsdc: value }));
    await assert.rejects(new GraphService(settings, rpc).portfolioBalances('1'), {
      code: 'SUBGRAPH_INVALID_BALANCE',
    });
    mock.restoreAll();
  }
  mock.method(globalThis, 'fetch', async () =>
    reply({ ...savings, activePosition: { currentUsdcAmount: null, currentWethAmount: '0' } }),
  );
  await assert.rejects(new GraphService(settings, rpc).portfolioBalances('1'), {
    code: 'SUBGRAPH_INVALID_BALANCE',
  });
});

test('reports the indexed block and its bounded lag from Sepolia', async () => {
  mock.method(globalThis, 'fetch', async () =>
    Response.json({
      data: {
        _meta: {
          deployment,
          block: { number: 950, hash: rpcHash, timestamp: 1_000_000 },
          hasIndexingErrors: false,
        },
      },
    }),
  );
  const graph = new GraphService(settings, rpc);

  const status = await graph.indexingStatus();

  assert.equal(status.block.number, 950);
  assert.equal(status.currentBlock, 1_000);
  assert.equal(status.blockLag, 50);
  assert.equal(status.maximumBlockLag, 120);
});

test('rejects indexing errors, stale indexes, and indexes ahead of Sepolia', async () => {
  const graph = new GraphService(settings, rpc);

  mock.method(globalThis, 'fetch', async () => graphResponse(950, true));
  await assert.rejects(graph.indexingStatus(), /indexing errors/i);
  mock.restoreAll();

  mock.method(globalThis, 'fetch', async () => graphResponse(800, false));
  await assert.rejects(graph.indexingStatus(), /200 blocks behind Sepolia/i);
  mock.restoreAll();

  mock.method(globalThis, 'fetch', async () => graphResponse(1_001, false));
  await assert.rejects(graph.indexingStatus(), /ahead of the configured Sepolia RPC/i);
});

test('queries families by normalized parent address and returns indexing metadata', async () => {
  let requestBody: { query: string; variables: Record<string, unknown> } | undefined;
  mock.method(
    globalThis,
    'fetch',
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
      return Response.json({
        data: {
          families: [{ id: '7', parent: '0xabc' }],
          _meta: { deployment, block: { number: 990, hash: rpcHash }, hasIndexingErrors: false },
        },
      });
    },
  );
  const graph = new GraphService(settings, rpc);

  const result = await graph.familiesByParent('0xAbC');

  assert.equal(requestBody?.variables.parent, '0xabc');
  assert.match(
    requestBody?.query ?? '',
    /families\(first: \$first, skip: \$skip, block: \$block, where: \{ parent: \$parent \}/,
  );
  assert.equal(result.nextOffset, null);
  assert.equal(result.families[0]?.id, '7');
  assert.equal(result.indexing.blockLag, 10);
});

test('paginates family activity with the deterministic sequence cursor', async () => {
  let requestBody: { query: string; variables: Record<string, unknown> } | undefined;
  mock.method(
    globalThis,
    'fetch',
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
      return Response.json({
        data: {
          protocolActivities: [
            { id: '0x02', sequence: '200' },
            { id: '0x01', sequence: '150' },
          ],
          _meta: { deployment, block: { number: 995, hash: rpcHash }, hasIndexingErrors: false },
        },
      });
    },
  );
  const graph = new GraphService(settings, rpc);

  const result = await graph.familyActivities('7', 2, '250');

  assert.deepEqual(requestBody?.variables, { familyId: '7', first: 2, before: '250' });
  assert.match(requestBody?.query ?? '', /sequence_lt: \$before/);
  assert.match(requestBody?.query ?? '', /\$familyId: String!/);
  assert.equal(result.nextCursor, '150');
  assert.equal(result.indexing.blockLag, 5);
});

test('looks up a normalized child wallet using an ID variable', async () => {
  let requestBody: { query: string; variables: Record<string, unknown> } | undefined;
  mock.method(
    globalThis,
    'fetch',
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
      return Response.json({
        data: {
          childWallet: { child: { id: '9', wallet: '0xabc' } },
          _meta: { deployment, block: { number: 995, hash: rpcHash }, hasIndexingErrors: false },
        },
      });
    },
  );
  const result = await new GraphService(settings, rpc).childByWallet('0xAbC', {
    first: 10,
    skip: 0,
  });
  assert.deepEqual(requestBody?.variables, { wallet: '0xabc', first: 10, skip: 0 });
  assert.match(requestBody?.query ?? '', /\$wallet: ID!/);
  assert.equal(result?.id, '9');
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

test('family and child reads expose further nested pages pinned to the requested block hash', async () => {
  let items = [{ id: '1' }, { id: '2' }];
  const inputs: { query: string; variables: Record<string, unknown> }[] = [];
  mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body));
    inputs.push(input);
    return Response.json({
      data: {
        family: { id: '7', children: [], savings: { activePosition: { executions: items } } },
        childWallet: { child: { id: '9', goals: items } },
        families: items,
        _meta: {
          deployment,
          block: { number: 995, hash: input.variables.block?.number ? null : rpcHash },
          hasIndexingErrors: false,
        },
      },
    });
  });
  const graph = new GraphService(settings, rpc);
  const page = { first: 2, skip: 0, blockHash: rpcHash };
  assert.equal((await graph.family('7', page))?.nextOffset, 2);
  assert.equal((await graph.childByWallet('0xabc', page))?.nextOffset, 2);
  assert.equal((await graph.familiesByParent('0xabc', page)).nextOffset, 2);
  for (const input of inputs) {
    assert.deepEqual(input.variables.block, { hash: rpcHash });
    assert.match(input.query, /_meta\(block: \$block\)/);
  }
  items = [{ id: '3' }];
  assert.equal((await graph.family('7', { ...page, skip: 2 }))?.nextOffset, null);
  await assert.rejects(graph.family('7', { ...page, blockHash: '0x' + '34'.repeat(32) }), {
    code: 'SUBGRAPH_INVALID_RESPONSE',
  });
});

test('rejects another RPC chain and mismatched indexed block hashes', async () => {
  mock.method(globalThis, 'fetch', async () => graphResponse(995, false));
  await assert.rejects(
    new GraphService(settings, { ...rpc, getChainId: async () => 1 }).indexingStatus(),
    /expected 11155111/,
  );
  await assert.rejects(
    new GraphService(settings, {
      ...rpc,
      getBlock: async () => ({ hash: '0x' + '34'.repeat(32) }),
    }).indexingStatus(),
    /does not match Sepolia/,
  );
});
