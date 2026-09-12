import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  sha256,
  stringToHex,
  zeroHash,
  type Hex,
} from 'viem';
import { childAccountAbi } from '@star/contracts/abi';
import {
  childValidationProbeAbi,
  childValidationProbeCode,
} from '@star/contracts/child-validation-probe';
import {
  createPasskeyGasStub,
  passkeyGasChallenge,
  createParentSessionGasStub,
  decodeParentSessionSignature,
} from '@star/contracts/child-account';
import { entryPoint08Address } from 'viem/account-abstraction';
import { loadConfig } from '../src/config.js';
import { ChildGasEstimator } from '../src/services/child-gas.js';

const settings = loadConfig({ CHILD_ACCOUNT_RP_ID: 'localhost' });
const operation = {
  sender: '0x0000000000000000000000000000000000001234',
  nonce: '0x0',
  callData: '0x12345678',
} as const;

test('parent device estimation preserves the real parent proof and only skips correction after live validation', async () => {
  const grant = {
    epoch: 2n,
    deviceKeyX: `0x${'ab'.repeat(32)}` as Hex,
    deviceKeyY: `0x${'cd'.repeat(32)}` as Hex,
    parentSignature: createPasskeyGasStub('localhost'),
  };
  const sessionOperation = { ...operation, signature: createParentSessionGasStub(grant) };
  let valid = true;
  const calls: string[] = [];
  const client = createPublicClient({
    transport: custom(
      {
        request: async ({ method, params }) => {
          if (method === 'eth_chainId') return '0xaa36a7';
          if (method === 'eth_blockNumber') return '0x64';
          assert.equal(method, 'eth_call');
          const [tx, block] = params as [{ to: string; data: Hex }, string];
          assert.equal(tx.to, operation.sender);
          assert.equal(block, '0x64');
          const call = decodeFunctionData({ abi: childAccountAbi, data: tx.data });
          calls.push(call.functionName);
          if (call.functionName === 'rpIdHash')
            return encodeFunctionResult({
              abi: childAccountAbi,
              functionName: 'rpIdHash',
              result: sha256(stringToHex('localhost')),
            });
          assert.equal(call.functionName, 'isParentAuthorizationValid');
          assert.deepEqual(call.args, [
            grant.deviceKeyX,
            grant.deviceKeyY,
            grant.epoch,
            grant.parentSignature,
          ]);
          return encodeFunctionResult({
            abi: childAccountAbi,
            functionName: 'isParentAuthorizationValid',
            result: valid,
          });
        },
      },
      { retryCount: 0 },
    ),
  });
  const estimator = new ChildGasEstimator(settings, client);
  assert.equal(
    decodeParentSessionSignature(estimator.stub(sessionOperation).signature as Hex).parentSignature,
    grant.parentSignature,
  );
  assert.equal(await estimator.verificationGasDelta(sessionOperation), 0n);
  assert.deepEqual(calls, ['rpIdHash', 'isParentAuthorizationValid']);
  valid = false;
  await assert.rejects(estimator.verificationGasDelta(sessionOperation), /Could not measure/);
});

function fixture(
  options: {
    wrongChain?: boolean;
    wrongRp?: boolean;
    unsupported?: boolean;
    invalidResult?: boolean;
    noDelta?: boolean;
    excessive?: boolean;
  } = {},
) {
  const calls: Hex[] = [];
  const client = createPublicClient({
    transport: custom(
      {
        request: async ({ method, params }) => {
          if (method === 'eth_chainId') return options.wrongChain ? '0x1' : '0xaa36a7';
          if (method === 'eth_blockNumber') return '0x64';
          assert.equal(method, 'eth_call');
          const [tx, block, overrides] = params as [{ to: string; data: Hex }, string, unknown];
          assert.equal(block, '0x64');
          if (tx.to.toLowerCase() === operation.sender) {
            assert.equal(overrides, undefined);
            return encodeFunctionResult({
              abi: childAccountAbi,
              functionName: 'rpIdHash',
              result: options.wrongRp ? zeroHash : sha256(stringToHex('localhost')),
            });
          }
          assert.equal(tx.to.toLowerCase(), entryPoint08Address.toLowerCase());
          assert.deepEqual(overrides, {
            [entryPoint08Address]: { code: childValidationProbeCode },
          });
          if (options.unsupported) throw new Error('secret RPC URL');
          const probe = decodeFunctionData({ abi: childValidationProbeAbi, data: tx.data });
          assert.equal(probe.functionName, 'measure');
          const [account, validationCall] = probe.args;
          assert.equal(account.toLowerCase(), operation.sender);
          const validation = decodeFunctionData({ abi: childAccountAbi, data: validationCall });
          assert.equal(validation.functionName, 'validateUserOp');
          const [packed, hash, prefund] = validation.args;
          assert.equal(prefund, 0n);
          assert.equal(packed.signature, createPasskeyGasStub('localhost'));
          assert.equal(packed.callData, operation.callData);
          calls.push(hash);
          return encodeFunctionResult({
            abi: childValidationProbeAbi,
            functionName: 'measure',
            result: [
              options.excessive
                ? 500_001n
                : hash === zeroHash || options.noDelta
                  ? 10_000n
                  : 20_000n,
              options.invalidResult ? 0n : 1n,
            ],
          });
        },
      },
      { retryCount: 0 },
    ),
  });
  return { estimator: new ChildGasEstimator(settings, client), calls };
}

test('gas correction measures both paths at one block, without overriding account code or storage', async () => {
  const { estimator, calls } = fixture();
  assert.equal(await estimator.verificationGasDelta(operation), 10_159n);
  assert.deepEqual(new Set(calls), new Set([zeroHash, passkeyGasChallenge]));
  assert.equal(estimator.stub(operation).signature, createPasskeyGasStub('localhost'));
  assert.equal('signature' in operation, false);
});

test('unavailable or unsafe measurements fail closed without a fixed-gas fallback or leaked RPC credentials', async () => {
  for (const options of [
    { wrongChain: true },
    { wrongRp: true },
    { unsupported: true },
    { invalidResult: true },
    { noDelta: true },
    { excessive: true },
  ]) {
    await assert.rejects(
      fixture(options).estimator.verificationGasDelta(operation),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, 'CHILD_GAS_ESTIMATION_UNAVAILABLE');
        assert.doesNotMatch(error.message, /secret/);
        return true;
      },
    );
  }
});
