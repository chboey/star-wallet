import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  childAccountAbi,
  familyVaultAbi,
  questsAbi,
  registryAbi,
  starGoalsAbi,
  starTokenAbi,
} from '@star/contracts/abi';
import { encodePasskeySignature, createPasskeyGasStub } from '@star/contracts/child-account';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  http,
  parseAbi,
  parseEventLogs,
  toHex,
  type Hex,
  type LocalAccount,
} from 'viem';
import {
  entryPoint08Abi,
  entryPoint08Address,
  getUserOperationHash,
  toPackedUserOperation,
  type UserOperation,
} from 'viem/account-abstraction';
import { sepolia } from 'viem/chains';
import type { Config } from '../src/config.js';
import { ChildAccountService } from '../src/services/child-accounts.js';
import { IntentService, type TransactionIntent } from '../src/services/intents.js';
import type { ProtocolService } from '../src/services/protocol.js';
import { QuestService } from '../src/services/quests.js';
import { ChildGasEstimator } from '../src/services/child-gas.js';

/** Real EntryPoint on a disposable fork; synthetic passkey signatures, no physical authenticator. */
export async function exerciseChildAccount(
  settings: Config,
  protocol: ProtocolService,
  parent: LocalAccount,
) {
  assert.equal(new URL(settings.SEPOLIA_RPC_URL).hostname, '127.0.0.1');
  const transport = http(settings.SEPOLIA_RPC_URL);
  const client = createPublicClient({ chain: sepolia, transport, pollingInterval: 20 });
  const wallet = createWalletClient({ account: parent, chain: sepolia, transport });
  const testClient = createTestClient({ mode: 'anvil', chain: sepolia, transport });
  const accounts = new ChildAccountService(settings, protocol);
  const gasEstimator = new ChildGasEstimator(settings);
  const intents = new IntentService(settings);
  const { addresses } = await protocol.ensureReady();
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = key.publicKey.export({ format: 'jwk' });
  const credential = {
    id: 'integration-child-passkey',
    publicKey:
      `0x${Buffer.from(publicKey.x!, 'base64url').toString('hex')}${Buffer.from(publicKey.y!, 'base64url').toString('hex')}` as Hex,
  };
  const ensName = 'child.local.starwallet.eth';
  const prepared = await accounts.prepare(1n, ensName, credential);
  const sendParent = async (intent: TransactionIntent) => {
    assert.equal(intent.signerRole, 'PARENT');
    const hash = await wallet.sendTransaction({
      to: intent.to,
      data: intent.data,
      value: BigInt(intent.value),
    });
    assert.equal((await client.waitForTransactionReceipt({ hash })).status, 'success');
  };
  for (const intent of intents.createChildAccount({ familyId: 1n, ensName, ...prepared }).intents)
    await sendParent(intent);
  const metadata = await accounts.resolve(prepared.wallet);
  assert.deepEqual(metadata.credential, credential);
  assert.equal((await accounts.prepare(1n, ensName, credential)).deployed, true);
  const registration = intents.registerChild({
    familyId: 1n,
    childWallet: prepared.wallet,
    ensName,
    state: 'UNREGISTERED',
  });
  await sendParent(registration.intents[0]!);
  assert.equal((await accounts.registration(1n, prepared.wallet, ensName)).state, 'PENDING');
  // Parent sponsors gas by depositing on this fork. Production uses the configured paymaster.
  const deposit = await wallet.writeContract({
    address: entryPoint08Address,
    abi: entryPoint08Abi,
    functionName: 'depositTo',
    args: [prepared.wallet],
    value: 100_000_000_000_000_000n,
  });
  await client.waitForTransactionReceipt({ hash: deposit });

  const sendChild = async (intent: TransactionIntent) => {
    assert.equal(intent.signerRole, 'CHILD');
    await accounts.validateCall(prepared.wallet, intent.data);
    const nonce = await client.readContract({
      address: entryPoint08Address,
      abi: entryPoint08Abi,
      functionName: 'getNonce',
      args: [prepared.wallet, 0n],
    });
    const op: UserOperation<'0.8'> = {
      sender: prepared.wallet,
      nonce,
      callData: intent.data,
      callGasLimit: 350_000n,
      verificationGasLimit: 0n,
      preVerificationGas: 100_000n,
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      signature: '0x',
    };
    // Reproduce a bundler estimating an invalid stub through the REAL EntryPoint.
    // Binary-search the short validation path instead of masking it with 400k gas.
    const shortPathFits = async (verificationGasLimit: bigint) => {
      try {
        await client.simulateContract({
          account: parent.address,
          address: entryPoint08Address,
          abi: entryPoint08Abi,
          functionName: 'handleOps',
          args: [
            [
              toPackedUserOperation({
                ...op,
                verificationGasLimit,
                signature: createPasskeyGasStub(settings.CHILD_ACCOUNT_RP_ID),
              }),
            ],
            parent.address,
          ],
          gas: 3_000_000n,
        });
        assert.fail('An estimation stub must never authorize a real operation');
      } catch (error) {
        const reverted =
          error instanceof BaseError
            ? error.walk((cause) => cause instanceof ContractFunctionRevertedError)
            : undefined;
        const reason =
          reverted instanceof ContractFunctionRevertedError ? reverted.data?.args?.[1] : undefined;
        if (typeof reason === 'string' && reason.includes('AA24')) return true;
        if (typeof reason === 'string' && /AA23|AA26/.test(reason)) return false;
        throw error;
      }
    };
    let low = 0n;
    let high = 500_000n; // Test search ceiling, not an operation allowance.
    assert.equal(await shortPathFits(high), true);
    while (high - low > 1n) {
      const middle = (high + low) / 2n;
      if (await shortPathFits(middle)) high = middle;
      else low = middle;
    }
    const delta = await gasEstimator.verificationGasDelta({
      sender: op.sender,
      nonce: toHex(op.nonce),
      callData: op.callData,
    });
    op.verificationGasLimit = high + delta;
    assert.ok(op.verificationGasLimit < 500_000n);
    const hash = getUserOperationHash({
      userOperation: op,
      entryPointAddress: entryPoint08Address,
      entryPointVersion: '0.8',
      chainId: sepolia.id,
    });
    assert.equal(
      hash,
      await client.readContract({
        address: entryPoint08Address,
        abi: entryPoint08Abi,
        functionName: 'getUserOpHash',
        args: [toPackedUserOperation(op)],
      }),
    );
    const signHash = (hash: Hex) => {
      const maximumSize = nonce % 2n === 1n;
      const fields = {
        type: 'webauthn.get',
        challenge: Buffer.from(hash.slice(2), 'hex').toString('base64url'),
        origin: 'http://localhost:3001',
        crossOrigin: false,
      };
      // Exercise both normal browser assertions and the supported size ceilings.
      const json = maximumSize
        ? JSON.stringify({
            ...fields,
            padding: ' '.repeat(
              1024 - Buffer.byteLength(JSON.stringify({ ...fields, padding: '' })),
            ),
          })
        : JSON.stringify(fields);
      const auth = Buffer.concat([
        createHash('sha256').update('localhost').digest(),
        Buffer.from([5, 0, 0, 0, 0]),
        ...(maximumSize ? [Buffer.alloc(512 - 37, 255)] : []),
      ]);
      const signature = sign(
        'sha256',
        Buffer.concat([auth, createHash('sha256').update(json).digest()]),
        { key: key.privateKey, dsaEncoding: 'ieee-p1363' },
      );
      return encodePasskeySignature({
        signature: `0x${signature.toString('hex')}`,
        challengeIndex: json.indexOf('"challenge"'),
        typeIndex: json.indexOf('"type"'),
        authenticatorData: `0x${auth.toString('hex')}`,
        clientDataJSON: json,
      });
    };
    op.signature = signHash(hash);
    const packed = toPackedUserOperation(op);
    const underestimated = { ...op, verificationGasLimit: high };
    underestimated.signature = signHash(
      getUserOperationHash({
        userOperation: underestimated,
        entryPointAddress: entryPoint08Address,
        entryPointVersion: '0.8',
        chainId: sepolia.id,
      }),
    );
    await assert.rejects(
      client.simulateContract({
        account: parent.address,
        address: entryPoint08Address,
        abi: entryPoint08Abi,
        functionName: 'handleOps',
        args: [[toPackedUserOperation(underestimated)], parent.address],
        gas: 3_000_000n,
      }),
      (error: unknown) => {
        const reverted =
          error instanceof BaseError
            ? error.walk((cause) => cause instanceof ContractFunctionRevertedError)
            : undefined;
        const reason =
          reverted instanceof ContractFunctionRevertedError ? reverted.data?.args?.[1] : undefined;
        assert.match(
          String(reason),
          /AA23|AA26/,
          'the uncorrected estimate fails on gas, not an invalid signature',
        );
        return true;
      },
    );
    const invalid = { ...packed, signature: `0x${'00'.repeat(256)}` as Hex };
    await assert.rejects(
      client.simulateContract({
        account: parent.address,
        address: entryPoint08Address,
        abi: entryPoint08Abi,
        functionName: 'handleOps',
        args: [[invalid], parent.address],
      }),
    );
    const tx = await wallet.writeContract({
      address: entryPoint08Address,
      abi: entryPoint08Abi,
      functionName: 'handleOps',
      args: [[packed], parent.address],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: tx });
    assert.equal(receipt.status, 'success');
    const result = parseEventLogs({
      abi: entryPoint08Abi,
      logs: receipt.logs,
      eventName: 'UserOperationEvent',
    });
    assert.equal(result.length, 1);
    assert.equal(
      result[0]!.args.success,
      true,
      'The operation itself, not just the bundle, must succeed',
    );
    assert.equal(
      await client.readContract({
        address: entryPoint08Address,
        abi: entryPoint08Abi,
        functionName: 'getNonce',
        args: [prepared.wallet, 0n],
      }),
      nonce + 1n,
    );
    await assert.rejects(
      client.simulateContract({
        account: parent.address,
        address: entryPoint08Address,
        abi: entryPoint08Abi,
        functionName: 'handleOps',
        args: [[packed], parent.address],
      }),
    );
  };
  await sendChild(registration.intents[1]!);
  assert.equal((await accounts.registration(1n, prepared.wallet, ensName)).state, 'ACCEPTED');
  const childId = await client.readContract({
    address: addresses.registry,
    abi: registryAbi,
    functionName: 'childIdByWallet',
    args: [prepared.wallet],
  });
  assert.ok(childId > 0n);

  const usdcAbi = parseAbi([
    'function masterMinter() view returns (address)',
    'function configureMinter(address,uint256) returns (bool)',
    'function mint(address,uint256) returns (bool)',
  ]);
  const minter = await client.readContract({
    address: addresses.usdc,
    abi: usdcAbi,
    functionName: 'masterMinter',
  });
  await testClient.impersonateAccount({ address: minter });
  await testClient.setBalance({ address: minter, value: 10n ** 18n });
  const minterWallet = createWalletClient({ account: minter, chain: sepolia, transport });
  const configured = await minterWallet.writeContract({
    address: addresses.usdc,
    abi: usdcAbi,
    functionName: 'configureMinter',
    args: [parent.address, 20_000_000n],
  });
  await client.waitForTransactionReceipt({ hash: configured });
  await testClient.stopImpersonatingAccount({ address: minter });
  const minted = await wallet.writeContract({
    address: addresses.usdc,
    abi: usdcAbi,
    functionName: 'mint',
    args: [parent.address, 20_000_000n],
  });
  await client.waitForTransactionReceipt({ hash: minted });
  const vault = await protocol.resolveChildVault(childId);
  for (const intent of intents.reward({
    childId,
    stars: 10n,
    reason: 'Child account integration',
    vault: vault.vault,
  }).intents)
    await sendParent(intent);
  for (const intent of intents.createGoal({ childId, title: 'Book', starCost: 5n }).intents)
    await sendParent(intent);
  await assert.rejects(
    client.simulateContract({
      account: parent.address,
      address: prepared.wallet,
      abi: childAccountAbi,
      functionName: 'requestRedemption',
      args: [1n],
    }),
  );
  await sendChild(intents.addStarsToGoal(1n, 5n, prepared.wallet).intents[0]!);
  await sendChild(intents.requestRedemption(1n, prepared.wallet).intents[0]!);
  assert.equal(
    await client.readContract({
      address: addresses.goals,
      abi: starGoalsAbi,
      functionName: 'reservedStars',
      args: [childId],
    }),
    5n,
  );
  await sendChild(intents.cancelRedemption(1n, prepared.wallet).intents[0]!);
  await sendChild(intents.addStarsToGoal(1n, 5n, prepared.wallet).intents[0]!);
  await sendChild(intents.requestRedemption(1n, prepared.wallet).intents[0]!);
  await assert.rejects(
    accounts.validateCall(
      prepared.wallet,
      encodeFunctionData({ abi: starGoalsAbi, functionName: 'approveRedemption', args: [2n] }),
    ),
  );
  for (const intent of intents.resolveRedemption(2n, true).intents) await sendParent(intent);
  assert.equal(
    await client.readContract({
      address: addresses.token,
      abi: starTokenAbi,
      functionName: 'balanceOf',
      args: [prepared.wallet],
    }),
    5n,
  );
  const workflow = await client.readContract({
    address: vault.vault,
    abi: familyVaultAbi,
    functionName: 'quests',
  });
  const quests = new QuestService(settings, protocol, accounts);
  for (const intent of (
    await quests.prepare('create', { childId, stars: 3n, text: 'Read together' })
  ).intents)
    await sendParent(intent);
  const questNonce = toHex(1n, { size: 32 });
  await sendChild(
    (await quests.prepare('submit', { childId, id: 1n, submissionId: questNonce })).intents[0]!,
  );
  await assert.rejects(quests.prepare('submit', { childId, id: 1n, submissionId: questNonce }), {
    code: 'SUBMISSION_ALREADY_RECORDED',
  });
  await assert.rejects(quests.prepare('approve', { childId, id: 1n, stars: 99n }), {
    code: 'REWARD_MISMATCH',
  });
  for (const intent of (await quests.prepare('approve', { childId, id: 1n, stars: 3n })).intents)
    await sendParent(intent);
  assert.equal(
    (
      await client.readContract({
        address: workflow,
        abi: questsAbi,
        functionName: 'getQuest',
        args: [1n],
      })
    ).status,
    2,
  );
  await assert.rejects(quests.prepare('approve', { childId, id: 1n, stars: 3n }), {
    code: 'INVALID_REQUEST_STATE',
  });
  assert.equal(
    await client.readContract({
      address: addresses.token,
      abi: starTokenAbi,
      functionName: 'balanceOf',
      args: [prepared.wallet],
    }),
    8n,
  );
  await sendChild(
    (
      await quests.prepare('request', {
        childId,
        stars: 2n,
        text: 'Tidied up',
        submissionId: toHex(2n, { size: 32 }),
      })
    ).intents[0]!,
  );
  await sendChild((await quests.prepare('cancel-request', { childId, id: 2n })).intents[0]!);
  assert.equal(
    (
      await client.readContract({
        address: workflow,
        abi: questsAbi,
        functionName: 'getRequest',
        args: [2n],
      })
    ).status,
    3,
  );
  await sendChild(
    (
      await quests.prepare('request', {
        childId,
        stars: 2n,
        text: 'Helped out',
        submissionId: toHex(3n, { size: 32 }),
      })
    ).intents[0]!,
  );
  for (const intent of (await quests.prepare('reject', { childId, id: 3n })).intents)
    await sendParent(intent);
  assert.equal(
    (
      await client.readContract({
        address: workflow,
        abi: questsAbi,
        functionName: 'getRequest',
        args: [3n],
      })
    ).status,
    2,
  );
  assert.equal(
    await client.readContract({
      address: addresses.token,
      abi: starTokenAbi,
      functionName: 'balanceOf',
      args: [prepared.wallet],
    }),
    8n,
  );
}
