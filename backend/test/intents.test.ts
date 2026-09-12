import assert from 'node:assert/strict';
import test from 'node:test';
import {
  childAccountAbi,
  childAccountFactoryAbi,
  familyVaultAbi,
  familyVaultFactoryAbi,
  registryAbi,
  starGoalsAbi,
} from '@star/contracts/abi';
import {
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  namehash,
  parseAbi,
  type Hex,
} from 'viem';
import { loadConfig, protocolAddresses } from '../src/config.js';
import type { AquaStrategyInput, BuiltAquaStrategy } from '../src/services/aqua.js';
import { IntentService } from '../src/services/intents.js';

const settings = loadConfig({ SEPOLIA_RPC_URL: 'http://127.0.0.1:8545' });
const addresses = protocolAddresses(settings);
const service = new IntentService(settings);
const childWallet = '0x0000000000000000000000000000000000001001';
const parent = '0x0000000000000000000000000000000000002001';
const publicKey = `0x${'11'.repeat(32)}${'22'.repeat(32)}` as Hex;
const vault = '0x0000000000000000000000000000000000003001';
const erc20Abi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
const strategy = '0x1234' as Hex;
const strategyHash = `0x${'34'.repeat(32)}` as Hex;
const builtStrategy: BuiltAquaStrategy = {
  strategy,
  strategyHash,
  strategyType: 'XYC_CONCENTRATED',
  salt: '1',
  deadline: '1000900',
  priceBandBps: 500,
  oracleRawPrice: '500000000000000000000000000',
  rawPriceMin: '475000000000000000000000000',
  rawPriceMax: '525000000000000000000000000',
  oracleBlockNumber: '100',
  oracleBlockTimestamp: '1000000',
  oracleFeeds: {
    ethUsd: {
      address: settings.CHAINLINK_ETH_USD_FEED_ADDRESS!,
      description: 'ETH / USD',
      decimals: 8,
      roundId: '1',
      answeredInRound: '1',
      startedAt: '999900',
      updatedAt: '999990',
    },
    usdcUsd: {
      address: settings.CHAINLINK_USDC_USD_FEED_ADDRESS!,
      description: 'USDC / USD',
      decimals: 8,
      roundId: '1',
      answeredInRound: '1',
      startedAt: '999900',
      updatedAt: '999990',
    },
  },
};

test('prepares parent-signed family registration with a normalized ENS node', () => {
  const prepared = service.createFamily('family.starwallet.eth');

  assert.equal(prepared.ensName, 'family.starwallet.eth');
  assert.equal(prepared.ensNode, namehash('family.starwallet.eth'));
  assert.equal(prepared.intents.length, 1);
  assert.deepEqual(prepared.intents[0], {
    chainId: 11155111,
    signerRole: 'PARENT',
    to: addresses.registry,
    data: prepared.intents[0]?.data,
    value: '0',
    summary: 'Create a Star family associated with family.starwallet.eth',
  });
  assert.deepEqual(decodeFunctionData({ abi: registryAbi, data: prepared.intents[0]!.data }), {
    functionName: 'createFamily',
    args: ['family.starwallet.eth'],
  });
});

test('rejects invalid family ENS names before preparing calldata', () => {
  assert.throws(() => service.createFamily('.starwallet.eth'), /The ENS name is not valid/);
});

test('prepares the one-vault-per-family factory call', () => {
  const prepared = service.createFamilyVault(42n);

  assert.equal(prepared.familyId, '42');
  assert.deepEqual(prepared.intents[0], {
    chainId: 11155111,
    signerRole: 'PARENT',
    to: addresses.vaultFactory,
    data: prepared.intents[0]?.data,
    value: '0',
    summary: 'Create the isolated vault for family 42',
  });
  assert.deepEqual(
    decodeFunctionData({ abi: familyVaultFactoryAbi, data: prepared.intents[0]!.data }),
    { functionName: 'createFamilyVault', args: [42n] },
  );
});

test('prepares deterministic child-account creation from the public credential', () => {
  const prepared = service.createChildAccount({
    familyId: 42n,
    ensName: 'jane.family.starwallet.eth',
    wallet: childWallet,
    parent,
    deployed: false,
    credential: { id: 'credential-id', publicKey },
  });

  assert.equal(prepared.childWallet, childWallet);
  assert.equal(prepared.parent, parent);
  assert.equal(prepared.alreadyDeployed, false);
  assert.equal(prepared.intents[0]?.signerRole, 'PARENT');
  assert.equal(prepared.intents[0]?.to, addresses.childAccountFactory);
  assert.deepEqual(
    decodeFunctionData({ abi: childAccountFactoryAbi, data: prepared.intents[0]!.data }),
    {
      functionName: 'createChildAccount',
      args: [
        42n,
        namehash('jane.family.starwallet.eth'),
        `0x${'11'.repeat(32)}`,
        `0x${'22'.repeat(32)}`,
        'credential-id',
      ],
    },
  );

  assert.deepEqual(
    service.createChildAccount({
      familyId: 42n,
      ensName: 'jane.family.starwallet.eth',
      wallet: childWallet,
      parent,
      deployed: true,
      credential: { id: 'credential-id', publicKey },
    }).intents,
    [],
  );
});

test('prepares sequential parent proposal and child consent for registration', () => {
  const prepared = service.registerChild({
    familyId: 42n,
    childWallet,
    ensName: 'jane.family.starwallet.eth',
    state: 'UNREGISTERED',
  });
  const expectedRegistrationId = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
      [addresses.registry, 42n, childWallet, namehash('jane.family.starwallet.eth')],
    ),
  );

  assert.equal(prepared.registrationId, expectedRegistrationId);
  assert.equal(prepared.requiresSequentialConfirmation, true);
  assert.deepEqual(decodeFunctionData({ abi: registryAbi, data: prepared.intents[0]!.data }), {
    functionName: 'proposeChildRegistration',
    args: [42n, childWallet, 'jane.family.starwallet.eth'],
  });
  assert.equal(prepared.intents[0]?.signerRole, 'PARENT');
  assert.deepEqual(decodeFunctionData({ abi: childAccountAbi, data: prepared.intents[1]!.data }), {
    functionName: 'acceptRegistration',
    args: [expectedRegistrationId],
  });
  assert.equal(prepared.intents[1]?.signerRole, 'CHILD');
  assert.equal(prepared.intents[1]?.to, childWallet);
});

test('resumes registration from chain state without repeating confirmed calls', () => {
  const pending = service.registerChild({
    familyId: 42n,
    childWallet,
    ensName: 'jane.family.starwallet.eth',
    state: 'PENDING',
  });
  const accepted = service.registerChild({
    familyId: 42n,
    childWallet,
    ensName: 'jane.family.starwallet.eth',
    state: 'ACCEPTED',
  });

  assert.equal(pending.intents.length, 1);
  assert.equal(pending.intents[0]?.signerRole, 'CHILD');
  assert.deepEqual(accepted.intents, []);
});

test('prepares registration cancellation and parent-managed lifecycle changes', () => {
  const registrationId = `0x${'ab'.repeat(32)}` as Hex;
  const parentCancellation = service.cancelChildRegistration(registrationId);
  const childCancellation = service.cancelChildRegistration(registrationId, 'CHILD');
  const familyStatus = service.setFamilyStatus(42n, false);
  const childStatus = service.setChildStatus(7n, true);

  assert.equal(parentCancellation.intents[0]?.signerRole, 'PARENT');
  assert.equal(childCancellation.intents[0]?.signerRole, 'CHILD');
  assert.deepEqual(
    decodeFunctionData({ abi: registryAbi, data: parentCancellation.intents[0]!.data }),
    { functionName: 'cancelChildRegistration', args: [registrationId] },
  );
  assert.deepEqual(decodeFunctionData({ abi: registryAbi, data: familyStatus.intents[0]!.data }), {
    functionName: 'setFamilyStatus',
    args: [42n, false],
  });
  assert.deepEqual(decodeFunctionData({ abi: registryAbi, data: childStatus.intents[0]!.data }), {
    functionName: 'setChildStatus',
    args: [7n, true],
  });
});

test('prepares USDC approval followed by an atomic Star reward and savings contribution', () => {
  const prepared = service.reward({
    childId: 7n,
    stars: 25n,
    reason: 'Completed weekly chores',
    vault,
  });

  assert.equal(prepared.stars, '25');
  assert.equal(prepared.principalUsdcUnits, '25000000');
  assert.equal(prepared.requiresUsdcAllowance, true);
  assert.equal(prepared.rewardWriteIsAtomic, true);
  assert.equal(prepared.intents[0]?.to, addresses.usdc);
  assert.equal(prepared.intents[0]?.signerRole, 'PARENT');
  assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: prepared.intents[0]!.data }), {
    functionName: 'approve',
    args: [vault, 25_000_000n],
  });
  assert.equal(prepared.intents[1]?.to, vault);
  assert.equal(prepared.intents[1]?.signerRole, 'PARENT');
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: prepared.intents[1]!.data }), {
    functionName: 'rewardStars',
    args: [7n, 25n, 'Completed weekly chores'],
  });
});

test('prepares parent-signed goal creation and cancellation', () => {
  const creation = service.createGoal({ childId: 7n, title: 'Art set', starCost: 30n });
  const cancellation = service.cancelGoal(9n);

  assert.equal(creation.intents[0]?.to, addresses.goals);
  assert.equal(creation.intents[0]?.signerRole, 'PARENT');
  assert.deepEqual(decodeFunctionData({ abi: starGoalsAbi, data: creation.intents[0]!.data }), {
    functionName: 'createGoal',
    args: [7n, 'Art set', 30n],
  });
  assert.equal(cancellation.intents[0]?.to, addresses.goals);
  assert.equal(cancellation.intents[0]?.signerRole, 'PARENT');
  assert.deepEqual(decodeFunctionData({ abi: starGoalsAbi, data: cancellation.intents[0]!.data }), {
    functionName: 'cancelGoal',
    args: [9n],
  });
});

test('prepares child-signed goal contributions and redemption requests', () => {
  const contribution = service.addStarsToGoal(9n, 4n, childWallet);
  const redemption = service.requestRedemption(9n, childWallet);

  assert.equal(contribution.intents[0]?.to, childWallet);
  assert.equal(contribution.intents[0]?.signerRole, 'CHILD');
  assert.deepEqual(
    decodeFunctionData({ abi: childAccountAbi, data: contribution.intents[0]!.data }),
    { functionName: 'addStarsToGoal', args: [9n, 4n] },
  );
  assert.equal(redemption.intents[0]?.to, childWallet);
  assert.equal(redemption.intents[0]?.signerRole, 'CHILD');
  assert.deepEqual(
    decodeFunctionData({ abi: childAccountAbi, data: redemption.intents[0]!.data }),
    { functionName: 'requestRedemption', args: [9n] },
  );
});

test('prepares child cancellation and parent approval or rejection of redemptions', () => {
  const cancellation = service.cancelRedemption(12n, childWallet);
  const approval = service.resolveRedemption(12n, true);
  const rejection = service.resolveRedemption(12n, false);

  assert.equal(cancellation.intents[0]?.to, childWallet);
  assert.equal(cancellation.intents[0]?.signerRole, 'CHILD');
  assert.deepEqual(
    decodeFunctionData({ abi: childAccountAbi, data: cancellation.intents[0]!.data }),
    { functionName: 'cancelRedemption', args: [12n] },
  );
  assert.equal(approval.burnsReservedStars, true);
  assert.equal(approval.withdrawsSavings, false);
  assert.deepEqual(decodeFunctionData({ abi: starGoalsAbi, data: approval.intents[0]!.data }), {
    functionName: 'approveRedemption',
    args: [12n],
  });
  assert.equal(rejection.burnsReservedStars, false);
  assert.deepEqual(decodeFunctionData({ abi: starGoalsAbi, data: rejection.intents[0]!.data }), {
    functionName: 'rejectRedemption',
    args: [12n],
  });
});

test('prepares savings withdrawals independently from Star accounting', () => {
  const recipient = '0x0000000000000000000000000000000000004001';
  const prepared = service.withdrawSavings({
    familyId: 42n,
    vault,
    amount: 15_000_000n,
    recipient,
  });

  assert.equal(prepared.independentFromStars, true);
  assert.equal(prepared.intents[0]?.to, vault);
  assert.equal(prepared.intents[0]?.signerRole, 'PARENT');
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: prepared.intents[0]!.data }), {
    functionName: 'withdrawSavings',
    args: [15_000_000n, recipient],
  });
});

test('prepares WETH approval and funding followed by independent withdrawals', () => {
  const recipient = '0x0000000000000000000000000000000000004001';
  const funding = service.fundStrategyWeth({ familyId: 42n, vault, amount: 2_000_000n });
  const withdrawal = service.withdrawStrategyWeth({
    familyId: 42n,
    vault,
    amount: 1_000_000n,
    recipient,
  });

  assert.equal(funding.intents[0]?.to, addresses.weth);
  assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: funding.intents[0]!.data }), {
    functionName: 'approve',
    args: [vault, 2_000_000n],
  });
  assert.equal(funding.intents[1]?.to, vault);
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: funding.intents[1]!.data }), {
    functionName: 'fundStrategyWeth',
    args: [2_000_000n],
  });
  assert.equal(withdrawal.intents[0]?.to, vault);
  assert.equal(withdrawal.intents[0]?.signerRole, 'PARENT');
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: withdrawal.intents[0]!.data }), {
    functionName: 'withdrawStrategyWeth',
    args: [1_000_000n, recipient],
  });
});

test('prepares canonical ship and atomic replacement calls for the resolved family vault', async () => {
  const aquaService = serviceWithStrategy();
  const input = {
    familyId: 42n,
    vault,
    usdcAmount: 80_000_000n,
    wethAmount: 2_000_000_000_000_000n,
    feeBps: 30,
    priceBandBps: 500,
    validForSeconds: 900,
  } as const;
  const shipped = await aquaService.shipSavings(input);
  const replaced = await aquaService.replaceSavings(input);

  assert.equal(shipped.maker, vault);
  assert.equal(shipped.app, addresses.swapVm);
  assert.equal(shipped.strategyHash, strategyHash);
  assert.equal(shipped.intents[0]?.to, vault);
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: shipped.intents[0]!.data }), {
    functionName: 'shipSavingsPosition',
    args: [strategy, 80_000_000n, 2_000_000_000_000_000n],
  });
  assert.equal(replaced.maker, vault);
  assert.equal(replaced.atomicPositionReplacement, true);
  assert.equal(replaced.intents[0]?.to, vault);
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: replaced.intents[0]!.data }), {
    functionName: 'replaceSavingsPosition',
    args: [strategy, 80_000_000n, 2_000_000_000_000_000n],
  });
});

test('prepares dock and position-identity-checked top-up calls against the resolved vault', () => {
  const docked = service.dockSavings(42n, vault);
  const toppedUp = service.addSavings({
    familyId: 42n,
    vault,
    expectedStrategyHash: strategyHash,
    usdcAmount: 5_000_000n,
    wethAmount: 0n,
  });

  assert.equal(docked.intents[0]?.to, vault);
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: docked.intents[0]!.data }), {
    functionName: 'dockSavingsPosition',
    args: undefined,
  });
  assert.equal(toppedUp.intents[0]?.to, vault);
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: toppedUp.intents[0]!.data }), {
    functionName: 'addToSavingsPosition',
    args: [strategyHash, 5_000_000n, 0n],
  });
});

test('prepares sequential emergency pause and docking while guarding resume', () => {
  const paused = service.setAquaPaused(42n, vault, true, true);
  const resumed = service.setAquaPaused(42n, vault, false, false);

  assert.equal(paused.emergencyAction, true);
  assert.equal(paused.requiresSequentialConfirmation, true);
  assert.equal(paused.intents.length, 2);
  assert.ok(paused.intents.every((intent) => intent.to === vault));
  assert.ok(paused.intents.every((intent) => intent.signerRole === 'EMERGENCY_ADMIN'));
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: paused.intents[0]!.data }), {
    functionName: 'setAquaPaused',
    args: [true],
  });
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: paused.intents[1]!.data }), {
    functionName: 'emergencyDockSavingsPosition',
    args: undefined,
  });
  assert.equal(resumed.requiresSequentialConfirmation, false);
  assert.deepEqual(decodeFunctionData({ abi: familyVaultAbi, data: resumed.intents[0]!.data }), {
    functionName: 'setAquaPaused',
    args: [false],
  });
  assert.throws(
    () => service.setAquaPaused(42n, vault, false, true),
    /Dock the active Aqua position before resuming token allowances/,
  );
});

test('fails closed when canonical Aqua strategy validation fails', async () => {
  const aquaService = serviceWithStrategy(async () => {
    throw new Error('unsafe strategy');
  });

  await assert.rejects(
    aquaService.shipSavings({
      familyId: 42n,
      vault,
      usdcAmount: 1n,
      wethAmount: 1n,
      feeBps: 30,
      priceBandBps: 500,
      validForSeconds: 900,
    }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'INVALID_AQUA_STRATEGY',
  );
});

function serviceWithStrategy(
  build: (input: AquaStrategyInput) => Promise<BuiltAquaStrategy> = async (input) => {
    assert.equal(input.maker, vault);
    return builtStrategy;
  },
) {
  const aquaService = new IntentService(settings);
  Object.assign(aquaService, { aqua: { build } });
  return aquaService;
}
