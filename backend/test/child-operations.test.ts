import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicClient, encodeFunctionData, http } from 'viem';
import {
  entryPoint08Address,
  getPaymasterStubData,
  getPaymasterData,
} from 'viem/account-abstraction';
import { childAccountAbi, starGoalsAbi } from '@star/contracts/abi';
import { validateChildRpc, ChildOperationService } from '../src/services/child-operations.js';
import { loadConfig } from '../src/config.js';
import { createPasskeyGasStub } from '@star/contracts/child-account';
import { ChildSecurityLimits } from '../src/services/child-security-limits.js';

const operation = {
  sender: '0x0000000000000000000000000000000000001234',
  nonce: '0x0',
  callData: encodeFunctionData({
    abi: childAccountAbi,
    functionName: 'requestRedemption',
    args: [1n],
  }),
  signature: '0x',
  verificationGasLimit: '0x61a80',
  callGasLimit: '0x30d40',
  preVerificationGas: '0x186a0',
  maxFeePerGas: '0x77359400',
  maxPriorityFeePerGas: '0xf4240',
};
const request = {
  jsonrpc: '2.0',
  id: 1,
  method: 'eth_estimateUserOperationGas',
  params: [operation, entryPoint08Address],
};

test('quest sponsorship accepts canonical narrow calls, not extra calldata or unbounded requests', () => {
  const nonce = `0x${'01'.repeat(32)}` as const;
  const calls = [
    encodeFunctionData({ abi: childAccountAbi, functionName: 'submitQuest', args: [1n, nonce] }),
    encodeFunctionData({
      abi: childAccountAbi,
      functionName: 'requestStars',
      args: [5n, 'Read a book', nonce],
    }),
    encodeFunctionData({ abi: childAccountAbi, functionName: 'cancelStarRequest', args: [1n] }),
  ];
  for (const callData of calls) {
    const valid = { ...request, params: [{ ...operation, callData }, entryPoint08Address] };
    assert.ok(validateChildRpc(valid).operation);
    assert.throws(() =>
      validateChildRpc({
        ...valid,
        params: [{ ...operation, callData: `${callData}00` }, entryPoint08Address],
      }),
    );
  }
  for (const [stars, reason] of [
    [1001n, 'Read'],
    [0n, 'Read'],
    [1n, ''],
    [1n, '🌟'.repeat(33)],
  ] as const) {
    const callData = encodeFunctionData({
      abi: childAccountAbi,
      functionName: 'requestStars',
      args: [stars, reason, nonce],
    });
    assert.throws(() =>
      validateChildRpc({ ...request, params: [{ ...operation, callData }, entryPoint08Address] }),
    );
  }
});

test('goal sponsorship accepts bounded canonical metadata and refuses extra bytes or invalid requests', () => {
  const nonce = `0x${'01'.repeat(32)}` as const;
  for (const callData of [
    encodeFunctionData({
      abi: childAccountAbi,
      functionName: 'requestGoal',
      args: ['Rocket Toy', '', 6, nonce],
    }),
    encodeFunctionData({
      abi: childAccountAbi,
      functionName: 'requestGoal',
      args: ['x'.repeat(64), 'x'.repeat(480), 0, nonce],
    }),
    encodeFunctionData({ abi: childAccountAbi, functionName: 'cancelGoalRequest', args: [1n] }),
  ]) {
    assert.ok(
      validateChildRpc({ ...request, params: [{ ...operation, callData }, entryPoint08Address] })
        .operation,
    );
    assert.throws(() =>
      validateChildRpc({
        ...request,
        params: [{ ...operation, callData: `${callData}00` }, entryPoint08Address],
      }),
    );
  }
  for (const args of [
    ['', '', 0, nonce],
    ['x'.repeat(65), '', 0, nonce],
    ['Toy', 'x'.repeat(481), 0, nonce],
    ['Toy', '', 7, nonce],
    ['Toy', '', 0, `0x${'00'.repeat(32)}`],
  ] as const) {
    const callData = encodeFunctionData({
      abi: childAccountAbi,
      functionName: 'requestGoal',
      args,
    });
    assert.throws(() =>
      validateChildRpc({ ...request, params: [{ ...operation, callData }, entryPoint08Address] }),
    );
  }
});
const policyId = '69d524a7-e932-4214-8673-dcdcba31bb42'; // Public documentation fixture.
const gasSettings = {
  NODE_ENV: 'test',
  CHILD_BUNDLER_RPC_URL: 'https://bundler.invalid/private-secret',
  CHILD_PAYMASTER_RPC_URL: 'https://paymaster.invalid/private-secret',
  CHILD_PAYMASTER_POLICY_ID: policyId,
};

test('sponsorship budgets gate stub/isFinal quotes, final quotes and direct submission without extra authentication', async (t) => {
  const settings = loadConfig({ ...gasSettings, CHILD_SPONSORED_OPERATIONS_PER_DAY: '1' });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body.method);
    if (body.method === 'eth_chainId') return Response.json({ result: '0xaa36a7' });
    if (body.method === 'eth_supportedEntryPoints')
      return Response.json({ result: [entryPoint08Address] });
    if (body.method.startsWith('pm_'))
      return Response.json({
        result: {
          paymaster: operation.sender,
          paymasterData: '0x1234',
          isFinal: true,
          sponsor: { name: 'Fixture sponsor' },
          paymasterVerificationGasLimit: '0x186a0',
          paymasterPostOpGasLimit: '0x186a0',
        },
      });
    return Response.json({ result: `0x${'ab'.repeat(32)}` });
  });
  const service = new ChildOperationService(settings, { validateCall: async () => {} });
  t.after(() => service.close());
  for (const method of ['pm_getPaymasterStubData', 'pm_getPaymasterData']) {
    const response = await service.rpc({
      ...request,
      method,
      params: [operation, entryPoint08Address, '0xaa36a7'],
    });
    assert.equal((response.result as { isFinal: boolean }).isFinal, true);
  }
  await service.rpc({ ...request, method: 'eth_sendUserOperation' });
  await service.rpc({ ...request, method: 'eth_sendUserOperation' });
  const nextOperation = { ...operation, nonce: '0x1' };
  await assert.rejects(
    service.rpc({
      ...request,
      method: 'pm_getPaymasterStubData',
      params: [nextOperation, entryPoint08Address, '0xaa36a7'],
    }),
    { code: 'CHILD_SPONSORSHIP_LIMIT' },
  );
  const sent = calls.filter((method) => method === 'eth_sendUserOperation').length;
  await assert.rejects(
    service.rpc({
      ...request,
      method: 'eth_sendUserOperation',
      params: [nextOperation, entryPoint08Address],
    }),
    { code: 'CHILD_SPONSORSHIP_LIMIT' },
  );
  assert.equal(calls.filter((method) => method === 'eth_sendUserOperation').length, sent);
  // Receipt polling and reads still work when the child's allowance has been used.
  await service.rpc({
    ...request,
    method: 'eth_getUserOperationReceipt',
    params: [`0x${'ab'.repeat(32)}`],
  });
});

test('account RPC limits stop provider traffic and storage failures fail closed', async (t) => {
  const settings = loadConfig({ ...gasSettings, CHILD_RPC_PER_MINUTE: '10' });
  const limits = new ChildSecurityLimits(settings);
  const service = new ChildOperationService(
    settings,
    { validateCall: async () => {} },
    undefined,
    limits,
  );
  t.after(() => service.close());
  for (let i = 0; i < 10; i++) limits.request(operation.sender);
  t.mock.method(globalThis, 'fetch', async () =>
    assert.fail('must stop before reaching the provider'),
  );
  await assert.rejects(service.rpc(request), { statusCode: 429, code: 'CHILD_REQUEST_RATE_LIMIT' });
  t.mock.method(limits, 'request', () => {
    throw new Error('Storage unavailable');
  });
  await assert.rejects(service.rpc(request), /Storage unavailable/);
});

test('untrusted provider gas fields cannot exceed the budget accounting caps', async (t) => {
  const settings = loadConfig(gasSettings);
  const service = new ChildOperationService(settings, { validateCall: async () => {} });
  t.after(() => service.close());
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.method === 'eth_chainId') return Response.json({ result: '0xaa36a7' });
    if (body.method === 'eth_supportedEntryPoints')
      return Response.json({ result: [entryPoint08Address] });
    return Response.json({
      result: {
        paymaster: operation.sender,
        paymasterData: '0x1234',
        paymasterVerificationGasLimit: '0xfffffff',
      },
    });
  });
  await assert.rejects(
    service.rpc({
      ...request,
      method: 'pm_getPaymasterData',
      params: [operation, entryPoint08Address, '0xaa36a7'],
    }),
    { code: 'GAS_LIMIT_EXCEEDED' },
  );
});

test('gas proxy checks the provider chain and hides credential-bearing failures', async (t) => {
  const settings = loadConfig(gasSettings);
  let chain = '0x1';
  let checked = 0;
  const mock = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const input = JSON.parse(String(init.body)) as { method: string };
    if (input.method === 'eth_chainId') return Response.json({ result: chain });
    if (input.method === 'eth_supportedEntryPoints')
      return Response.json({ result: [entryPoint08Address] });
    return Response.json({ error: { message: 'private-secret' } });
  });
  const service = new ChildOperationService(settings, {
    validateCall: async () => {
      checked += 1;
    },
  });
  await assert.rejects(service.readiness(), /Sepolia/);
  chain = '0xaa36a7';
  const ready = await service.readiness();
  assert.equal(ready.bundlerSupported, true);
  assert.doesNotMatch(JSON.stringify(ready), new RegExp(policyId));
  const response = await service.rpc(request);
  assert.equal(checked, 1);
  assert.doesNotMatch(JSON.stringify(response), /private-secret/);
  mock.mock.mockImplementation(async () => {
    throw new Error('private-secret');
  });
  await assert.rejects(
    service.rpc(request),
    (error: unknown) => error instanceof Error && !error.message.includes('private-secret'),
  );
});

test('only scoped child UserOperations reach the bundler', () => {
  assert.equal(validateChildRpc(request).operation?.sender.toLowerCase(), operation.sender);
  for (const method of [
    'eth_sendRawTransaction',
    'eth_call',
    'eth_getLogs',
    'debug_traceCall',
    'pm_sponsorUserOperation',
  ])
    assert.throws(() => validateChildRpc({ ...request, method }));
  assert.throws(() => validateChildRpc([request]));
  for (const override of [
    { factory: operation.sender },
    { initCode: '0x1234' },
    { eip7702Auth: {} },
    { value: '0x1' },
    { callGasLimit: '0x100000' },
    { maxFeePerGas: '0xffffffffffff' },
    { nonce: '-1' },
    {
      callData: encodeFunctionData({
        abi: starGoalsAbi,
        functionName: 'approveRedemption',
        args: [1n],
      }),
    },
  ])
    assert.throws(() =>
      validateChildRpc({
        ...request,
        params: [{ ...operation, ...override }, entryPoint08Address],
      }),
    );
  assert.throws(() => validateChildRpc({ ...request, params: [operation, operation.sender] }));
});

test('sponsorship pins chain/entry point and refuses client-selected policies', () => {
  const quote = {
    ...request,
    method: 'pm_getPaymasterData',
    params: [operation, entryPoint08Address, '0xaa36a7'],
  };
  assert.ok(validateChildRpc(quote).operation);
  assert.throws(() =>
    validateChildRpc({ ...quote, params: [operation, entryPoint08Address, '0x1'] }),
  );
  for (const context of [
    { sponsorshipPolicyId: 'other' },
    { policyId: 'other' },
    { policyId },
    { webhookData: 'untrusted' },
    { erc20Context: { tokenAddress: operation.sender } },
    [],
    '',
    '{}',
    false,
    0,
  ])
    assert.throws(() => validateChildRpc({ ...quote, params: [...quote.params, context] }));
  for (const context of [{}, null, undefined])
    assert.ok(validateChildRpc({ ...quote, params: [...quote.params, context] }).operation);
});

test('both paymaster stages receive only the configured server-side policy', async (t) => {
  const forwarded: { url: unknown; body: typeof request }[] = [];
  let checked = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as typeof request;
    forwarded.push({ url, body });
    if (body.method === 'eth_chainId') return Response.json({ result: '0xaa36a7' });
    if (body.method === 'eth_supportedEntryPoints')
      return Response.json({ result: [entryPoint08Address] });
    return Response.json({ result: { paymaster: operation.sender, paymasterData: '0x1234' } });
  });
  const service = new ChildOperationService(loadConfig(gasSettings), {
    validateCall: async (sender, data) => {
      assert.equal(sender.toLowerCase(), operation.sender);
      assert.equal(data, operation.callData);
      checked += 1;
    },
  });
  for (const method of ['pm_getPaymasterStubData', 'pm_getPaymasterData']) {
    for (const context of [[], [{}], [null]]) {
      const input = {
        ...request,
        method,
        params: [operation, entryPoint08Address, '0xaa36a7', ...context],
      };
      const original = structuredClone(input);
      const response = await service.rpc(input);
      assert.deepEqual(input, original, 'do not mutate the browser request');
      assert.deepEqual(forwarded.at(-1), {
        url: gasSettings.CHILD_PAYMASTER_RPC_URL,
        body: {
          ...request,
          method,
          params: [operation, entryPoint08Address, '0xaa36a7', { policyId }],
        },
      });
      assert.deepEqual(response, {
        jsonrpc: '2.0',
        id: request.id,
        result: { paymaster: operation.sender, paymasterData: '0x1234' },
      });
    }
  }
  assert.equal(checked, 6);
  for (const method of ['eth_sendUserOperation']) {
    const input = { ...request, method };
    await service.rpc(input);
    assert.deepEqual(forwarded.at(-1), { url: gasSettings.CHILD_BUNDLER_RPC_URL, body: input });
  }
});

test('estimation adds measured passkey gas before sponsorship; signed submissions remain unchanged', async (t) => {
  const settings = loadConfig(gasSettings);
  const stub = createPasskeyGasStub(settings.CHILD_ACCOUNT_RP_ID);
  const forwarded: { method: string; params: unknown[] }[] = [];
  let delta = 17_000n;
  let measured = 0;
  let invalidEstimate = false;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    forwarded.push(body);
    if (body.method === 'eth_chainId') return Response.json({ result: '0xaa36a7' });
    if (body.method === 'eth_supportedEntryPoints')
      return Response.json({ result: [entryPoint08Address] });
    if (body.method === 'eth_estimateUserOperationGas')
      return Response.json({
        result: invalidEstimate
          ? {}
          : {
              verificationGasLimit: '0x9dca',
              preVerificationGas: '0x1230c',
              callGasLimit: '0x3b70b',
            },
      });
    return Response.json({ result: `0x${'ab'.repeat(32)}` });
  });
  const service = new ChildOperationService(
    settings,
    { validateCall: async () => {} },
    {
      stub: (op) => ({ ...op, signature: stub }),
      verificationGasDelta: async () => {
        measured += 1;
        return delta;
      },
    },
  );
  const response = await service.rpc(request);
  assert.equal(
    (response.result as { verificationGasLimit: string }).verificationGasLimit,
    '0xe032',
  );
  assert.equal(measured, 1);
  assert.deepEqual(forwarded.at(-1)?.params, [
    { ...operation, signature: stub },
    entryPoint08Address,
  ]);
  const signed = { ...request, method: 'eth_sendUserOperation' };
  await service.rpc(signed);
  assert.deepEqual(forwarded.at(-1), signed);
  assert.equal(measured, 1, 'never change gas or signature after signing');
  await assert.rejects(service.rpc({ ...request, params: [...request.params, { code: '0x' }] }));
  delta = 500_000n;
  await assert.rejects(service.rpc(request), { code: 'GAS_LIMIT_EXCEEDED' });
  invalidEstimate = true;
  await assert.rejects(service.rpc(request), { code: 'INVALID_CHILD_GAS_RESPONSE' });
});

test('sponsorship fails closed when any URL or the policy ID is missing', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    assert.fail('must not contact provider'),
  );
  for (const key of [
    'CHILD_BUNDLER_RPC_URL',
    'CHILD_PAYMASTER_RPC_URL',
    'CHILD_PAYMASTER_POLICY_ID',
  ]) {
    for (const value of ['', '   ', undefined]) {
      const service = new ChildOperationService(loadConfig({ ...gasSettings, [key]: value }), {
        validateCall: async () => assert.fail('unconfigured sponsorship must stop first'),
      });
      assert.equal(service.configured, false);
      await assert.rejects(service.readiness(), { code: 'CHILD_GAS_NOT_CONFIGURED' });
      await assert.rejects(service.rpc(request), { code: 'CHILD_GAS_NOT_CONFIGURED' });
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('viem HTTP paymaster requests with unset context reach the provider with the server policy', async (t) => {
  const browserUrl = 'https://star.invalid/api/star/child-accounts/rpc';
  const browserRequests: { method: string; params: unknown[] }[] = [];
  const providerRequests: { method: string; params: unknown[] }[] = [];
  const callData = encodeFunctionData({
    abi: childAccountAbi,
    functionName: 'acceptRegistration',
    args: [`0x${'42'.repeat(32)}`],
  });
  let authorized = 0;
  const service = new ChildOperationService(loadConfig(gasSettings), {
    validateCall: async (sender, data) => {
      assert.equal(sender.toLowerCase(), operation.sender);
      assert.equal(data, callData);
      authorized += 1;
    },
  });
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    const input = JSON.parse(String(init.body));
    if (String(url) === browserUrl) {
      browserRequests.push(input);
      return Response.json(await service.rpc(input));
    }
    if (input.method === 'eth_chainId') return Response.json({ result: '0xaa36a7' });
    if (input.method === 'eth_supportedEntryPoints')
      return Response.json({ result: [entryPoint08Address] });
    assert.equal(url, gasSettings.CHILD_PAYMASTER_RPC_URL);
    providerRequests.push(input);
    return Response.json({
      result: {
        paymaster: operation.sender,
        paymasterData: '0x1234',
        paymasterVerificationGasLimit: '0x186a0',
        paymasterPostOpGasLimit: '0x186a0',
      },
    });
  });
  const client = createPublicClient({ transport: http(browserUrl, { retryCount: 0 }) });
  for (const action of [getPaymasterStubData, getPaymasterData]) {
    const result = await action(client, {
      chainId: 11155111,
      entryPointAddress: entryPoint08Address,
      sender: operation.sender as `0x${string}`,
      nonce: 0n,
      callData,
      callGasLimit: 0n,
      verificationGasLimit: 400_000n,
      preVerificationGas: 100_000n,
      maxFeePerGas: 2_533_114_550n,
      maxPriorityFeePerGas: 2_000_000n,
    });
    assert.equal(result.paymaster, operation.sender);
    assert.equal(browserRequests.at(-1)?.params[3], null);
    assert.deepEqual(providerRequests.at(-1)?.params[3], { policyId });
    assert.equal(providerRequests.at(-1)?.method, browserRequests.at(-1)?.method);
  }
  assert.equal(authorized, 2);
});

test('policy overrides and unauthorized accounts never reach sponsorship providers', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    assert.fail('must not contact provider'),
  );
  const service = new ChildOperationService(loadConfig(gasSettings), {
    validateCall: async () => {
      throw new Error('Unauthorized child account');
    },
  });
  const quote = {
    ...request,
    method: 'pm_getPaymasterData',
    params: [operation, entryPoint08Address, '0xaa36a7'],
  };
  await assert.rejects(
    service.rpc({ ...quote, params: [...quote.params, { policyId: 'other' }] }),
    {
      code: 'INVALID_CONTEXT',
    },
  );
  for (const context of [[], [null], [{}]])
    await assert.rejects(
      service.rpc({ ...quote, params: [...quote.params, ...context] }),
      /Unauthorized child account/,
    );
  assert.equal(fetch.mock.callCount(), 0);
});

test('receipt and entry-point requests have bounded parameter shapes', () => {
  const receipt = {
    ...request,
    method: 'eth_getUserOperationReceipt',
    params: [`0x${'a'.repeat(64)}`],
  };
  assert.equal(validateChildRpc(receipt).operation, null);
  assert.throws(() => validateChildRpc({ ...receipt, params: ['latest'] }));
  assert.equal(
    validateChildRpc({ ...request, method: 'eth_supportedEntryPoints', params: [] }).operation,
    null,
  );
});

test('bundler fee reads accept no parameters and only forward to the configured bundler', async (t) => {
  const input = { ...request, method: 'rundler_maxPriorityFeePerGas', params: [] };
  assert.equal(validateChildRpc(input).operation, null);
  for (const params of [[operation], [entryPoint08Address], [{ policyId }]])
    assert.throws(() => validateChildRpc({ ...input, params }));

  let fee: unknown = '0x5f5e100'; // Alchemy's 0.1 gwei, not the ordinary RPC's 0.002 gwei.
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    assert.equal(url, gasSettings.CHILD_BUNDLER_RPC_URL);
    const body = JSON.parse(String(init.body));
    if (body.method === 'eth_chainId') return Response.json({ result: '0xaa36a7' });
    if (body.method === 'eth_supportedEntryPoints')
      return Response.json({ result: [entryPoint08Address] });
    assert.deepEqual(body, input);
    return Response.json({ result: fee });
  });
  const service = new ChildOperationService(loadConfig(gasSettings), {
    validateCall: async () => assert.fail('a fee read is not an account operation'),
  });
  assert.deepEqual(await service.rpc(input), { jsonrpc: '2.0', id: 1, result: fee });
  for (const invalid of [null, {}, '100000000', '0x00', '0x', '0xffffffffffff']) {
    fee = invalid;
    await assert.rejects(service.rpc(input), { code: 'INVALID_CHILD_FEE' });
  }
});

test('provider rejection codes and reasons survive without leaking credentials or operation data', async (t) => {
  const settings = loadConfig({
    ...gasSettings,
    CHILD_BUNDLER_RPC_URL: 'https://bundler.invalid/v2/bundler-secret?key=query-secret',
    CHILD_PAYMASTER_RPC_URL: 'https://paymaster.invalid/v2/paymaster-secret',
  });
  let status = 200;
  let code = -32602;
  const signature = `0x${'ab'.repeat(100)}`;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.method === 'eth_chainId') return Response.json({ result: '0xaa36a7' });
    if (body.method === 'eth_supportedEntryPoints')
      return Response.json({ result: [entryPoint08Address] });
    return Response.json(
      {
        error: {
          code,
          message: `precheck failed: maxPriorityFeePerGas 2000000 below minimum 100000000. ${settings.CHILD_BUNDLER_RPC_URL} bundler-secret query-secret paymaster-secret ${policyId} ${signature}`,
          data: {
            reason: 'AA24 signature error',
            innerReason: 'Verification rejected',
            operation,
            secret: 'must-not-escape',
          },
        },
      },
      { status },
    );
  });
  const service = new ChildOperationService(settings, { validateCall: async () => {} });
  for (const httpStatus of [200, 400, 429]) {
    status = httpStatus;
    for (const rpcCode of [-32602, -32507]) {
      code = rpcCode;
      const result = await service.rpc({ ...request, method: 'eth_sendUserOperation' });
      assert.ok(result.error);
      assert.equal(result.error.code, code);
      assert.match(result.error.message, /maxPriorityFeePerGas 2000000 below minimum 100000000/);
      assert.match(result.error.message, /AA24 signature error: Verification rejected/);
      assert.doesNotMatch(
        JSON.stringify(result),
        /bundler-secret|query-secret|paymaster-secret|must-not-escape|https:\/\//,
      );
      assert.ok(!JSON.stringify(result).includes(policyId));
      assert.ok(!JSON.stringify(result).includes(signature));
      assert.ok(!('data' in result.error));
    }
  }
});

test('malformed and oversized provider failures remain bounded and safe', async (t) => {
  let response = () => Response.json({ error: { code: -32602, message: 'x'.repeat(5000) } });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.method === 'eth_chainId') return Response.json({ result: '0xaa36a7' });
    if (body.method === 'eth_supportedEntryPoints')
      return Response.json({ result: [entryPoint08Address] });
    return response();
  });
  const service = new ChildOperationService(loadConfig(gasSettings), {
    validateCall: async () => {},
  });
  const result = await service.rpc(request);
  assert.ok(result.error);
  assert.ok(result.error.message.length < 1100);
  response = () => Response.json({ error: { message: 'private-secret' } });
  assert.doesNotMatch(JSON.stringify(await service.rpc(request)), /private-secret/);
  response = () => new Response('private-secret', { status: 502 });
  await assert.rejects(service.rpc(request), { code: 'CHILD_GAS_UNAVAILABLE' });
  response = () => Response.json({ error: { message: 'x'.repeat(200_001) } });
  await assert.rejects(service.rpc(request), { code: 'CHILD_GAS_UNAVAILABLE' });
});
