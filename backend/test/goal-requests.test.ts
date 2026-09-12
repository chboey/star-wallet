import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  zeroHash,
  type Hex,
} from 'viem';
import { childAccountAbi, registryAbi, starGoalsAbi } from '@star/contracts/abi';
import { loadConfig } from '../src/config.js';
import { GoalRequestService } from '../src/services/goal-requests.js';
import type { ProtocolService } from '../src/services/protocol.js';
import type { ChildAccountService } from '../src/services/child-accounts.js';

const registry = '0x0000000000000000000000000000000000000001';
const goals = '0x0000000000000000000000000000000000000002';
const wallet = '0x0000000000000000000000000000000000000003';
const parent = '0x0000000000000000000000000000000000000004';
const submission = `0x${'01'.repeat(32)}` as Hex;

function fixture(
  options: {
    used?: boolean;
    wrongChild?: boolean;
    resolved?: boolean;
    inactive?: boolean;
    legacy?: boolean;
    malformedRpc?: boolean;
  } = {},
) {
  const validated: Hex[] = [];
  const client = createPublicClient({
    transport: custom(
      {
        request: async ({ method, params }) => {
          assert.equal(method, 'eth_call');
          const [call] = params as [{ to: string; data: Hex }];
          if (call.to.toLowerCase() === registry) {
            const decoded = decodeFunctionData({ abi: registryAbi, data: call.data });
            if (decoded.functionName === 'getChild')
              return encodeFunctionResult({
                abi: registryAbi,
                functionName: 'getChild',
                result: {
                  id: 7n,
                  familyId: 8n,
                  wallet,
                  ensName: 'kid.family.eth',
                  ensNode: zeroHash,
                  active: !options.inactive,
                },
              });
            if (decoded.functionName === 'getFamily')
              return encodeFunctionResult({
                abi: registryAbi,
                functionName: 'getFamily',
                result: { id: 8n, parent, ensName: 'family.eth', ensNode: zeroHash, active: true },
              });
          }
          assert.equal(call.to.toLowerCase(), goals);
          const decoded = decodeFunctionData({ abi: starGoalsAbi, data: call.data });
          if (decoded.functionName === 'goalRequestsVersion') {
            if (options.legacy) return '0x';
            if (options.malformedRpc) return '0x12';
            return encodeFunctionResult({
              abi: starGoalsAbi,
              functionName: 'goalRequestsVersion',
              result: 1n,
            });
          }
          if (decoded.functionName === 'usedGoalSubmissionIds') {
            assert.deepEqual(decoded.args, [wallet, submission]);
            return encodeFunctionResult({
              abi: starGoalsAbi,
              functionName: 'usedGoalSubmissionIds',
              result: Boolean(options.used),
            });
          }
          if (decoded.functionName === 'getGoalRequest')
            return encodeFunctionResult({
              abi: starGoalsAbi,
              functionName: 'getGoalRequest',
              result: {
                id: 1n,
                childId: options.wrongChild ? 9n : 7n,
                title: 'Rocket Toy',
                reason: 'Space adventures',
                icon: 6,
                status: options.resolved ? 1 : 0,
                goalId: options.resolved ? 9n : 0n,
                requestedAt: 1n,
                resolvedAt: 0n,
              },
            });
          throw new Error('Unexpected RPC call');
        },
      },
      { retryCount: 0 },
    ),
  });
  const protocol = {
    ensureReady: async () => ({ addresses: { registry, goals } }),
  } as unknown as ProtocolService;
  const accounts = {
    validateCall: async (to: string, data: Hex) => {
      assert.equal(to, wallet);
      validated.push(data);
    },
  } as unknown as ChildAccountService;
  return { service: new GoalRequestService(loadConfig({}), protocol, accounts, client), validated };
}

test('goal requests produce a single child passkey call with the chosen metadata', async () => {
  const { service, validated } = fixture();
  const result = await service.prepare('request', {
    childId: 7n,
    title: 'Rocket Toy',
    reason: 'Space adventures',
    icon: 6,
    submissionId: submission,
  });
  assert.equal(result.intents.length, 1);
  const intent = result.intents[0];
  assert.ok(intent);
  assert.equal(intent.to, wallet);
  assert.equal(intent.value, '0');
  assert.equal(intent.signerRole, 'CHILD');
  assert.deepEqual(decodeFunctionData({ abi: childAccountAbi, data: intent.data }), {
    functionName: 'requestGoal',
    args: ['Rocket Toy', 'Space adventures', 6, submission],
  });
  assert.deepEqual(validated, [intent.data]);
});

test('parent goal approval sets the exact target without preparing USDC approval or a transfer', async () => {
  const { service, validated } = fixture();
  const { intents } = await service.prepare('approve', {
    childId: 7n,
    requestId: 1n,
    starCost: 32n,
  });
  assert.equal(intents.length, 1);
  assert.ok(intents[0]);
  assert.equal(intents[0].to, goals);
  assert.equal(intents[0].signerRole, 'PARENT');
  assert.equal(intents[0].value, '0');
  assert.deepEqual(decodeFunctionData({ abi: starGoalsAbi, data: intents[0].data }), {
    functionName: 'approveGoalRequest',
    args: [1n, 32n],
  });
  assert.equal(validated.length, 0);
});

test('wrong child, duplicate, inactive and resolved requests are rejected before signing', async () => {
  for (const options of [{ wrongChild: true }, { resolved: true }, { inactive: true }]) {
    const { service, validated } = fixture(options);
    await assert.rejects(service.prepare('approve', { childId: 7n, requestId: 1n, starCost: 32n }));
    assert.equal(validated.length, 0);
  }
  const { service, validated } = fixture({ used: true });
  await assert.rejects(
    service.prepare('request', {
      childId: 7n,
      title: 'Rocket Toy',
      reason: '',
      icon: 6,
      submissionId: submission,
    }),
    { code: 'SUBMISSION_ALREADY_RECORDED' },
  );
  assert.equal(validated.length, 0);
});

test('legacy deployments are explicitly unsupported while malformed RPC responses remain errors', async () => {
  const { service } = fixture({ legacy: true });
  assert.deepEqual(await service.capability(), { supported: false, goalsAddress: goals });
  await assert.rejects(service.prepare('request', { childId: 7n }), {
    code: 'GOAL_REQUESTS_NOT_DEPLOYED',
  });
  await assert.rejects(fixture({ malformedRpc: true }).service.capability());
});

test('request cancellation uses the child account and rejection remains a parent action', async () => {
  const { service, validated } = fixture({ inactive: true });
  const cancel = await service.prepare('cancel', { childId: 7n, requestId: 1n });
  assert.ok(cancel.intents[0]);
  assert.equal(cancel.intents[0].signerRole, 'CHILD');
  assert.equal(validated.length, 1);
  const reject = await service.prepare('reject', { childId: 7n, requestId: 1n });
  assert.ok(reject.intents[0]);
  assert.equal(reject.intents[0].signerRole, 'PARENT');
  assert.equal(validated.length, 1);
});
