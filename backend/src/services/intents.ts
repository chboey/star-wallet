import {
  childAccountAbi,
  childAccountFactoryAbi,
  familyVaultAbi,
  familyVaultFactoryAbi,
  registryAbi,
  starGoalsAbi,
} from '@star/contracts/abi';
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  namehash,
  parseAbi,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
} from 'viem';
import { normalize } from 'viem/ens';
import type { Config, ProtocolAddresses } from '../config.js';
import { protocolAddresses } from '../config.js';
import { badRequest } from '../errors.js';
import { AquaStrategyService, type AquaStrategyInput, type BuiltAquaStrategy } from './aqua.js';
import { AquaConnector } from './aqua-connector.js';
import type { ChildCredential } from './child-accounts.js';

const erc20Abi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);

export type SignerRole = 'PARENT' | 'CHILD' | 'EMERGENCY_ADMIN';

export type TransactionIntent = {
  chainId: number;
  signerRole: SignerRole;
  to: Address;
  data: Hex;
  value: '0';
  summary: string;
};

export class IntentService {
  private readonly addresses: ProtocolAddresses;
  private readonly aqua: AquaStrategyService;

  constructor(private readonly settings: Config) {
    this.addresses = protocolAddresses(settings);
    this.aqua = new AquaStrategyService(settings);
  }

  createFamily(ensName: string) {
    const normalized = validEnsName(ensName);
    return {
      ensName: normalized,
      ensNode: namehash(normalized),
      intents: [
        this.intent(
          'PARENT',
          this.addresses.registry,
          registryAbi,
          'createFamily',
          [normalized],
          `Create a Star family associated with ${normalized}`,
        ),
      ],
    };
  }

  createFamilyVault(familyId: bigint) {
    return {
      familyId: familyId.toString(),
      intents: [
        this.intent(
          'PARENT',
          this.addresses.vaultFactory,
          familyVaultFactoryAbi,
          'createFamilyVault',
          [familyId],
          `Create the isolated vault for family ${familyId.toString()}`,
        ),
      ],
    };
  }

  createChildAccount(input: {
    familyId: bigint;
    ensName: string;
    wallet: Address;
    parent: Address;
    deployed: boolean;
    credential: ChildCredential;
  }) {
    return {
      childWallet: input.wallet,
      parent: input.parent,
      alreadyDeployed: input.deployed,
      intents: input.deployed
        ? []
        : [
            this.intent(
              'PARENT',
              this.addresses.childAccountFactory,
              childAccountFactoryAbi,
              'createChildAccount',
              [
                input.familyId,
                namehash(input.ensName),
                `0x${input.credential.publicKey.slice(2, 66)}`,
                `0x${input.credential.publicKey.slice(66)}`,
                input.credential.id,
              ],
              'Create the child passkey account',
            ),
          ],
    };
  }

  registerChild(input: {
    familyId: bigint;
    childWallet: Address;
    ensName: string;
    state: 'UNREGISTERED' | 'PENDING' | 'ACCEPTED';
  }) {
    const normalized = validEnsName(input.ensName);
    const ensNode = namehash(normalized);
    const registrationId = keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
        [this.addresses.registry, input.familyId, input.childWallet, ensNode],
      ),
    );
    return {
      ensName: normalized,
      ensNode,
      registrationId,
      childWallet: input.childWallet,
      registrationState: input.state,
      requiresSequentialConfirmation: true,
      intents:
        input.state === 'ACCEPTED'
          ? []
          : [
              this.intent(
                'PARENT',
                this.addresses.registry,
                registryAbi,
                'proposeChildRegistration',
                [input.familyId, input.childWallet, normalized],
                `Propose the child smart wallet for family ${input.familyId.toString()}`,
              ),
              this.intent(
                'CHILD',
                input.childWallet,
                childAccountAbi,
                'acceptRegistration',
                [registrationId],
                'Confirm child registration with the child passkey',
              ),
            ].slice(input.state === 'PENDING' ? 1 : 0),
    };
  }

  cancelChildRegistration(registrationId: Hex, signerRole: 'PARENT' | 'CHILD' = 'PARENT') {
    return {
      intents: [
        this.intent(
          signerRole,
          this.addresses.registry,
          registryAbi,
          'cancelChildRegistration',
          [registrationId],
          `${signerRole === 'CHILD' ? 'Reject' : 'Cancel'} pending child registration ${registrationId}`,
        ),
      ],
    };
  }

  setFamilyStatus(familyId: bigint, active: boolean) {
    return {
      intents: [
        this.intent(
          'PARENT',
          this.addresses.registry,
          registryAbi,
          'setFamilyStatus',
          [familyId, active],
          `${active ? 'Reactivate' : 'Deactivate'} family ${familyId.toString()}`,
        ),
      ],
    };
  }

  setChildStatus(childId: bigint, active: boolean) {
    return {
      intents: [
        this.intent(
          'PARENT',
          this.addresses.registry,
          registryAbi,
          'setChildStatus',
          [childId, active],
          `${active ? 'Reactivate' : 'Deactivate'} child ${childId.toString()}`,
        ),
      ],
    };
  }

  reward(input: { childId: bigint; stars: bigint; reason: string; vault: Address }) {
    const principalUsdcUnits = input.stars * 1_000_000n;
    return {
      stars: input.stars.toString(),
      principalUsdcUnits: principalUsdcUnits.toString(),
      requiresUsdcAllowance: true,
      rewardWriteIsAtomic: true,
      intents: [
        this.intent(
          'PARENT',
          this.addresses.usdc,
          erc20Abi,
          'approve',
          [input.vault, principalUsdcUnits],
          `Approve ${input.stars.toString()} USDC for the Star reward`,
        ),
        this.intent(
          'PARENT',
          input.vault,
          familyVaultAbi,
          'rewardStars',
          [input.childId, input.stars, input.reason],
          `Reward ${input.stars.toString()} Stars and contribute matching USDC atomically`,
        ),
      ],
    };
  }

  createGoal(input: { childId: bigint; title: string; starCost: bigint }) {
    return {
      intents: [
        this.intent(
          'PARENT',
          this.addresses.goals,
          starGoalsAbi,
          'createGoal',
          [input.childId, input.title, input.starCost],
          `Create the goal “${input.title}” for ${input.starCost.toString()} Stars`,
        ),
      ],
    };
  }

  cancelGoal(goalId: bigint) {
    return {
      intents: [
        this.intent(
          'PARENT',
          this.addresses.goals,
          starGoalsAbi,
          'cancelGoal',
          [goalId],
          `Cancel goal ${goalId.toString()}`,
        ),
      ],
    };
  }

  requestRedemption(goalId: bigint, childWallet: Address) {
    return {
      intents: [
        this.intent(
          'CHILD',
          childWallet,
          childAccountAbi,
          'requestRedemption',
          [goalId],
          `Request redemption of goal ${goalId.toString()}`,
        ),
      ],
    };
  }

  addStarsToGoal(goalId: bigint, amount: bigint, childWallet: Address) {
    return {
      intents: [
        this.intent(
          'CHILD',
          childWallet,
          childAccountAbi,
          'addStarsToGoal',
          [goalId, amount],
          `Add ${amount.toString()} Stars to goal ${goalId.toString()}`,
        ),
      ],
    };
  }

  cancelRedemption(redemptionId: bigint, childWallet: Address) {
    return {
      intents: [
        this.intent(
          'CHILD',
          childWallet,
          childAccountAbi,
          'cancelRedemption',
          [redemptionId],
          `Cancel redemption request ${redemptionId.toString()}`,
        ),
      ],
    };
  }

  resolveRedemption(redemptionId: bigint, approve: boolean) {
    return {
      burnsReservedStars: approve,
      withdrawsSavings: false,
      intents: [
        this.intent(
          'PARENT',
          this.addresses.goals,
          starGoalsAbi,
          approve ? 'approveRedemption' : 'rejectRedemption',
          [redemptionId],
          `${approve ? 'Approve' : 'Reject'} redemption request ${redemptionId.toString()}`,
        ),
      ],
    };
  }

  withdrawSavings(input: { familyId: bigint; vault: Address; amount: bigint; recipient: Address }) {
    return {
      independentFromStars: true,
      intents: [
        this.intent(
          'PARENT',
          input.vault,
          familyVaultAbi,
          'withdrawSavings',
          [input.amount, input.recipient],
          `Withdraw ${input.amount.toString()} USDC base units from available family savings`,
        ),
      ],
    };
  }

  fundStrategyWeth(input: { familyId: bigint; vault: Address; amount: bigint }) {
    return {
      intents: [
        this.intent(
          'PARENT',
          this.addresses.weth,
          erc20Abi,
          'approve',
          [input.vault, input.amount],
          `Approve ${input.amount.toString()} WETH base units for the family vault`,
        ),
        this.intent(
          'PARENT',
          input.vault,
          familyVaultAbi,
          'fundStrategyWeth',
          [input.amount],
          `Fund family ${input.familyId.toString()} strategy inventory with WETH`,
        ),
      ],
    };
  }

  withdrawStrategyWeth(input: {
    familyId: bigint;
    vault: Address;
    amount: bigint;
    recipient: Address;
  }) {
    return {
      intents: [
        this.intent(
          'PARENT',
          input.vault,
          familyVaultAbi,
          'withdrawStrategyWeth',
          [input.amount, input.recipient],
          `Withdraw ${input.amount.toString()} WETH base units from available strategy inventory`,
        ),
      ],
    };
  }

  async shipSavings(input: {
    familyId: bigint;
    vault: Address;
    usdcAmount: bigint;
    wethAmount: bigint;
    feeBps: number;
    priceBandBps: number;
    validForSeconds: number;
  }) {
    const built = await this.buildAquaStrategy({
      maker: input.vault,
      feeBps: input.feeBps,
      priceBandBps: input.priceBandBps,
      validForSeconds: input.validForSeconds,
    });
    return {
      ...built,
      maker: input.vault,
      app: this.addresses.swapVm,
      intents: [
        this.intent(
          'PARENT',
          input.vault,
          familyVaultAbi,
          'shipSavingsPosition',
          [built.strategy, input.usdcAmount, input.wethAmount],
          `Ship the family vault's ${built.strategyType} Aqua/SwapVM savings position`,
        ),
      ],
    };
  }

  async replaceSavings(input: {
    familyId: bigint;
    vault: Address;
    usdcAmount: bigint;
    wethAmount: bigint;
    feeBps: number;
    priceBandBps: number;
    validForSeconds: number;
  }) {
    const built = await this.buildAquaStrategy({
      maker: input.vault,
      feeBps: input.feeBps,
      priceBandBps: input.priceBandBps,
      validForSeconds: input.validForSeconds,
    });
    return {
      ...built,
      maker: input.vault,
      app: this.addresses.swapVm,
      atomicPositionReplacement: true,
      intents: [
        this.intent(
          'PARENT',
          input.vault,
          familyVaultAbi,
          'replaceSavingsPosition',
          [built.strategy, input.usdcAmount, input.wethAmount],
          `Atomically replace family ${input.familyId.toString()}'s Aqua/SwapVM savings position`,
        ),
      ],
    };
  }

  dockSavings(familyId: bigint, vault: Address) {
    return {
      intents: [
        this.intent(
          'PARENT',
          vault,
          familyVaultAbi,
          'dockSavingsPosition',
          [],
          `Dock family ${familyId.toString()}'s active Aqua position`,
        ),
      ],
    };
  }

  addSavings(input: {
    familyId: bigint;
    vault: Address;
    expectedStrategyHash: Hex;
    usdcAmount: bigint;
    wethAmount: bigint;
  }) {
    return {
      intents: [
        this.intent(
          'PARENT',
          input.vault,
          familyVaultAbi,
          'addToSavingsPosition',
          [input.expectedStrategyHash, input.usdcAmount, input.wethAmount],
          `Add available vault funds to family ${input.familyId.toString()}'s existing Aqua position`,
        ),
      ],
    };
  }

  setAquaPaused(familyId: bigint, vault: Address, paused: boolean, positionActive: boolean) {
    if (!paused && positionActive) {
      throw badRequest(
        'AQUA_POSITION_STILL_ACTIVE',
        'Dock the active Aqua position before resuming token allowances',
      );
    }
    const pauseIntent = this.intent(
      'EMERGENCY_ADMIN',
      vault,
      familyVaultAbi,
      'setAquaPaused',
      [paused],
      `${paused ? 'Pause Aqua and revoke both token allowances for' : 'Resume Aqua for'} family ${familyId.toString()}'s vault`,
    );
    const emergencyDockIntent =
      paused && positionActive
        ? this.intent(
            'EMERGENCY_ADMIN',
            vault,
            familyVaultAbi,
            'emergencyDockSavingsPosition',
            [],
            `Dock family ${familyId.toString()}'s active position after Aqua is paused`,
          )
        : undefined;
    return {
      emergencyAction: true,
      requiresSequentialConfirmation: emergencyDockIntent !== undefined,
      intents: emergencyDockIntent ? [pauseIntent, emergencyDockIntent] : [pauseIntent],
    };
  }

  private async buildAquaStrategy(input: AquaStrategyInput): Promise<BuiltAquaStrategy> {
    try {
      // Validate the router target before returning signable ship/replace intents.
      new AquaConnector(this.addresses);
      return await this.aqua.build(input);
    } catch (error) {
      throw badRequest(
        'INVALID_AQUA_STRATEGY',
        error instanceof Error ? error.message : 'The Aqua strategy parameters are invalid',
      );
    }
  }

  private intent<
    const TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
  >(
    signerRole: SignerRole,
    to: Address,
    abi: TAbi,
    functionName: TFunctionName,
    args: ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
    summary: string,
  ): TransactionIntent {
    return {
      chainId: this.settings.CHAIN_ID,
      signerRole,
      to,
      data: encodeFunctionData({ abi, functionName, args } as never),
      value: '0',
      summary,
    };
  }
}

function validEnsName(name: string): string {
  try {
    return normalize(name);
  } catch {
    throw badRequest('INVALID_ENS_NAME', 'The ENS name is not valid');
  }
}
