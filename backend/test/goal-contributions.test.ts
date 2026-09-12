import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData, encodeFunctionData } from 'viem';
import { entryPoint08Address } from 'viem/account-abstraction';
import { childAccountAbi } from '@star/contracts/abi';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { badRequest } from '../src/errors.js';
import { ChildAccountService } from '../src/services/child-accounts.js';
import { ProtocolService, type ProtocolReadiness } from '../src/services/protocol.js';

const wallet = '0x0000000000000000000000000000000000000009';
const settings = loadConfig({
  NODE_ENV: 'test',
  SEPOLIA_RPC_URL: 'http://127.0.0.1:1',
  STAR_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000001',
  STAR_TOKEN_ADDRESS: '0x0000000000000000000000000000000000000002',
  STAR_GOALS_ADDRESS: '0x0000000000000000000000000000000000000003',
  STAR_FAMILY_VAULT_FACTORY_ADDRESS: '0x0000000000000000000000000000000000000004',
  STAR_CHILD_ACCOUNT_FACTORY_ADDRESS: '0x0000000000000000000000000000000000000005',
  AQUA_ADDRESS: '0x0000000000000000000000000000000000000006',
  AQUA_SWAP_VM_ADDRESS: '0x0000000000000000000000000000000000000007',
});
type Account = Awaited<ReturnType<ChildAccountService['resolve']>>;
const account: Account = {
  wallet,
  active: true,
  familyId: 1n,
  ensNode: `0x${'11'.repeat(32)}`,
  parent: '0x0000000000000000000000000000000000000010',
  credential: { id: 'test-credential', publicKey: `0x${'22'.repeat(64)}` },
  rpId: 'localhost',
};

test('contribution routes validate exact whole-Star amounts and prepare only the registered child account call', async (t) => {
  t.mock.method(ProtocolService.prototype, 'ensureReady', async () => ({}) as ProtocolReadiness);
  const target = t.mock.method(ChildAccountService.prototype, 'forAction', async () => account);
  const validated = t.mock.method(ChildAccountService.prototype, 'validateCall', async () => {});
  const app = await buildApp(settings);
  t.after(() => app.close());
  for (const payload of [
    { goalId: '7', amount: '0' },
    { goalId: '0', amount: '5' },
    { goalId: '7', amount: '-1' },
    { goalId: '7', amount: '1.5' },
    { goalId: '7', amount: '1e2' },
    { goalId: '7', amount: (1n << 256n).toString() },
    { goalId: '7', amount: '5', childWallet: wallet },
  ])
    assert.equal(
      (await app.inject({ method: 'POST', url: '/v1/intents/goals/add-stars', payload }))
        .statusCode,
      400,
    );
  assert.equal(target.mock.callCount(), 0);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/intents/goals/add-stars',
    payload: { goalId: '7', amount: '5' },
  });
  assert.equal(response.statusCode, 200);
  const { intents } = response.json();
  assert.equal(intents.length, 1);
  assert.equal(intents[0].to.toLowerCase(), wallet);
  assert.equal(intents[0].value, '0');
  assert.equal(intents[0].signerRole, 'CHILD');
  assert.equal(intents[0].chainId, 11155111);
  assert.deepEqual(decodeFunctionData({ abi: childAccountAbi, data: intents[0].data }), {
    functionName: 'addStarsToGoal',
    args: [7n, 5n],
  });
  assert.deepEqual(target.mock.calls[0]?.arguments, ['goal', 7n]);
  assert.deepEqual(validated.mock.calls[0]?.arguments, [wallet, intents[0].data]);
  validated.mock.mockImplementation(async () => {
    throw badRequest('INVALID_GOAL_CONTRIBUTION', 'Unavailable');
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/intents/goals/add-stars',
        payload: { goalId: '7', amount: '5' },
      })
    ).statusCode,
    400,
  );
});

test('sponsorship validates contribution ownership and simulates on-chain availability before accepting a call', async (t) => {
  const accounts = new ChildAccountService(settings, {} as ProtocolService);
  const resolve = t.mock.method(accounts, 'resolve', async () => account);
  const expected = t.mock.method(accounts, 'forAction', async () => account);
  const rpc = (accounts as unknown as { client: { call(args: unknown): Promise<unknown> } }).client;
  const simulated = t.mock.method(rpc, 'call', async () => ({}));
  const data = encodeFunctionData({
    abi: childAccountAbi,
    functionName: 'addStarsToGoal',
    args: [7n, 5n],
  });
  await accounts.validateCall(wallet, data);
  assert.deepEqual(simulated.mock.calls[0]?.arguments, [
    { account: entryPoint08Address, to: wallet, data },
  ]);
  resolve.mock.mockImplementation(async () => ({ ...account, active: false }));
  await assert.rejects(accounts.validateCall(wallet, data), { code: 'CHILD_ACCOUNT_MISMATCH' });
  resolve.mock.mockImplementation(async () => account);
  expected.mock.mockImplementation(async () => ({
    ...account,
    wallet: settings.STAR_REGISTRY_ADDRESS!,
  }));
  await assert.rejects(accounts.validateCall(wallet, data), { code: 'CHILD_ACCOUNT_MISMATCH' });
  assert.equal(simulated.mock.callCount(), 1);
  expected.mock.mockImplementation(async () => account);
  simulated.mock.mockImplementation(async () => {
    throw new Error('Insufficient Stars');
  });
  await assert.rejects(accounts.validateCall(wallet, data), { code: 'INVALID_GOAL_CONTRIBUTION' });
});
