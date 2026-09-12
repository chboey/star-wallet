import { childAccountAbi } from '@star/contracts/abi';
import {
  createPasskeyGasStub,
  passkeyGasChallenge,
  parentSessionPrefix,
  decodeParentSessionSignature,
  createParentSessionGasStub,
} from '@star/contracts/child-account';
import {
  childValidationProbeAbi,
  childValidationProbeCode,
} from '@star/contracts/child-validation-probe';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  sha256,
  stringToHex,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { entryPoint08Address, toPackedUserOperation } from 'viem/account-abstraction';
import { sepolia } from 'viem/chains';
import type { Config } from '../config.js';
import { unavailable } from '../errors.js';

export type ChildGasOperation = {
  sender: Address;
  nonce: string;
  callData: string;
  signature?: string;
  callGasLimit?: string;
  verificationGasLimit?: string;
  preVerificationGas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  paymaster?: string;
  paymasterData?: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
};
type ProbeClient = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'readContract' | 'call'>;

/** Complements, never replaces, the bundler's EntryPoint/nonce/paymaster estimate.
 * The deployed validator exits before P256 when the operation hash is not signed.
 * Measure the missing execution on that exact account using eth_call only. The
 * account code/storage and authorization checks are never overridden.
 */
export class ChildGasEstimator {
  private readonly client: ProbeClient;
  constructor(
    private readonly settings: Config,
    client?: ProbeClient,
  ) {
    this.client =
      client ??
      createPublicClient({
        chain: sepolia,
        transport: http(settings.SEPOLIA_RPC_URL, { retryCount: 0 }),
      });
  }

  stub(operation: ChildGasOperation): ChildGasOperation {
    if (operation.signature?.startsWith(parentSessionPrefix)) {
      return {
        ...operation,
        signature: createParentSessionGasStub(
          decodeParentSessionSignature(operation.signature as Hex),
        ),
      };
    }
    return { ...operation, signature: createPasskeyGasStub(this.settings.CHILD_ACCOUNT_RP_ID) };
  }

  async verificationGasDelta(operation: ChildGasOperation): Promise<bigint> {
    try {
      if ((await this.client.getChainId()) !== sepolia.id) throw new Error('Wrong probe chain');
      const blockNumber = await this.client.getBlockNumber({ cacheTime: 0 });
      const rpIdHash = await this.client.readContract({
        address: operation.sender,
        abi: childAccountAbi,
        functionName: 'rpIdHash',
        blockNumber,
      });
      if (rpIdHash !== sha256(stringToHex(this.settings.CHILD_ACCOUNT_RP_ID)))
        throw new Error('RP ID mismatch');
      if (operation.signature?.startsWith(parentSessionPrefix)) {
        const grant = decodeParentSessionSignature(operation.signature as Hex);
        const valid = await this.client.readContract({
          address: operation.sender,
          abi: childAccountAbi,
          functionName: 'isParentAuthorizationValid',
          args: [grant.deviceKeyX, grant.deviceKeyY, grant.epoch, grant.parentSignature],
          blockNumber,
        });
        if (!valid) throw new Error('Parent authorization missing or revoked');
        // The real parent proof is preserved in the stub: both parent WebAuthn
        // and device P256 verification execute fully in the bundler estimate.
        return 0n;
      }
      const packed = toPackedUserOperation({
        sender: operation.sender,
        nonce: BigInt(operation.nonce),
        callData: operation.callData as Hex,
        signature: createPasskeyGasStub(this.settings.CHILD_ACCOUNT_RP_ID),
        callGasLimit: BigInt(operation.callGasLimit ?? '0x0'),
        verificationGasLimit: BigInt(operation.verificationGasLimit ?? '0x0'),
        preVerificationGas: BigInt(operation.preVerificationGas ?? '0x0'),
        maxFeePerGas: BigInt(operation.maxFeePerGas ?? '0x0'),
        maxPriorityFeePerGas: BigInt(operation.maxPriorityFeePerGas ?? '0x0'),
        ...(operation.paymaster
          ? {
              paymaster: operation.paymaster as Address,
              paymasterData: (operation.paymasterData ?? '0x') as Hex,
              paymasterVerificationGasLimit: BigInt(
                operation.paymasterVerificationGasLimit ?? '0x0',
              ),
              paymasterPostOpGasLimit: BigInt(operation.paymasterPostOpGasLimit ?? '0x0'),
            }
          : {}),
      });
      const measure = async (hash: Hex) => {
        const validationCall = encodeFunctionData({
          abi: childAccountAbi,
          functionName: 'validateUserOp',
          args: [packed, hash, 0n],
        });
        const result = await this.client.call({
          to: entryPoint08Address,
          data: encodeFunctionData({
            abi: childValidationProbeAbi,
            functionName: 'measure',
            args: [operation.sender, validationCall],
          }),
          blockNumber,
          // A read-only simulation ceiling, NOT a UserOperation gas allowance.
          gas: 1_000_000n,
          stateOverride: [{ address: entryPoint08Address, code: childValidationProbeCode }],
        });
        if (!result.data) throw new Error('Missing gas measurement');
        const [gas, validationData] = decodeFunctionResult({
          abi: childValidationProbeAbi,
          functionName: 'measure',
          data: result.data,
        });
        // Both dummy signatures must remain invalid, even along the full P256 path.
        if (validationData !== 1n || gas <= 0n || gas > 500_000n)
          throw new Error('Unexpected validation result');
        return gas;
      };
      // Separate calls preserve identical cold/warm state; intrinsic calldata gas
      // and EIP-7623 floors cannot distort a gasleft() execution measurement.
      const [shortPath, fullPath] = await Promise.all([
        measure(zeroHash),
        measure(passkeyGasChallenge),
      ]);
      if (fullPath <= shortPath) throw new Error('Full authentication was not measured');
      // EIP-150: enough additional caller gas to forward the entire measured delta.
      return ((fullPath - shortPath) * 64n + 62n) / 63n;
    } catch {
      throw unavailable(
        'CHILD_GAS_ESTIMATION_UNAVAILABLE',
        'Could not measure full passkey validation. The Sepolia RPC must support eth_call state overrides and native P256 verification. No operation was submitted.',
      );
    }
  }
}
