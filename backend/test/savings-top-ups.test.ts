import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData } from 'viem';
import { familyVaultAbi } from '@star/contracts/abi';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { badRequest } from '../src/errors.js';
import {
  ProtocolService,
  type ProtocolReadiness,
  type FamilyVaultResolution,
} from '../src/services/protocol.js';

const vault = '0x0000000000000000000000000000000000000009';
const resolved: FamilyVaultResolution = {
  vault,
  familyId: 1n,
  emergencyAdmin: vault,
  paused: false,
  positionActive: true,
};
const hash = `0x${'ab'.repeat(32)}`;
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

test('top-up route validates amounts/hash and targets only the resolved family vault with one parent call', async (t) => {
  t.mock.method(ProtocolService.prototype, 'ensureReady', async () => ({}) as ProtocolReadiness);
  const resolve = t.mock.method(
    ProtocolService.prototype,
    'resolveFamilyVault',
    async () => resolved,
  );
  const app = await buildApp(settings);
  t.after(() => app.close());
  const payload = {
    familyId: '1',
    expectedStrategyHash: hash,
    usdcAmountUnits: '1000000',
    wethAmountUnits: '0',
  };
  for (const change of [
    { familyId: '0' },
    { expectedStrategyHash: '0x1234' },
    { expectedStrategyHash: `0x${'00'.repeat(32)}` },
    { usdcAmountUnits: '0' },
    { usdcAmountUnits: '-1' },
    { wethAmountUnits: '1.5' },
    { usdcAmountUnits: '1e6' },
    { wethAmountUnits: (1n << 256n).toString() },
    { usdcAmountUnits: '9'.repeat(79) },
    { usdcAmountUnits: 1 },
    { vault },
    { strategy: '0x1234' },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/intents/savings/add',
          payload: { ...payload, ...change },
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(resolve.mock.callCount(), 0);
  for (const [u, w] of [
    ['1000000', '0'],
    ['0', '1000000000000000'],
    ['1000000', '1000000000000000'],
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/intents/savings/add',
      payload: { ...payload, usdcAmountUnits: u, wethAmountUnits: w },
    });
    assert.equal(response.statusCode, 200, response.body);
    const { intents } = response.json();
    assert.equal(intents.length, 1);
    assert.equal(intents[0].to, vault);
    assert.equal(intents[0].signerRole, 'PARENT');
    assert.equal(intents[0].chainId, 11155111);
    assert.equal(intents[0].value, '0');
    assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: intents[0].data }), {
      functionName: 'addToSavingsPosition',
      args: [hash, BigInt(u!), BigInt(w!)],
    });
  }
  assert.deepEqual(resolve.mock.calls[0]?.arguments, [1n]);
  resolve.mock.mockImplementation(async () => {
    throw badRequest('UNKNOWN_VAULT', 'No verified vault');
  });
  assert.equal(
    (await app.inject({ method: 'POST', url: '/v1/intents/savings/add', payload })).statusCode,
    400,
  );
});

test('close endpoint still prepares exactly one dock call, without a withdrawal or replacement', async (t) => {
  t.mock.method(ProtocolService.prototype, 'ensureReady', async () => ({}) as ProtocolReadiness);
  t.mock.method(ProtocolService.prototype, 'resolveFamilyVault', async () => resolved);
  const app = await buildApp(settings);
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/v1/intents/savings/dock',
    payload: { familyId: '1' },
  });
  assert.equal(response.statusCode, 200);
  const { intents } = response.json();
  assert.equal(intents.length, 1);
  assert.equal(intents[0].to, vault);
  assert.equal(intents[0].signerRole, 'PARENT');
  assert.equal(intents[0].value, '0');
  assert.equal(
    decodeFunctionData({ abi: familyVaultAbi, data: intents[0].data }).functionName,
    'dockSavingsPosition',
  );
});
