import { childAccountAbi, registryAbi, starGoalsAbi } from '@star/contracts/abi';
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  encodeFunctionData,
  http,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import type { Config } from '../config.js';
import { badRequest } from '../errors.js';
import type { ProtocolService } from './protocol.js';
import type { ChildAccountService } from './child-accounts.js';
import type { TransactionIntent } from './intents.js';

export type GoalRequestAction = 'request' | 'approve' | 'reject' | 'cancel';
export type GoalRequestInput = {
  childId: bigint;
  requestId?: bigint;
  title?: string;
  reason?: string;
  icon?: number;
  submissionId?: Hex;
  starCost?: bigint;
};

/** Unsigned plans only. Ownership and request terms come from the contract. */
export class GoalRequestService {
  private readonly client: Pick<ReturnType<typeof createPublicClient>, 'readContract'>;
  constructor(
    settings: Config,
    private readonly protocol: ProtocolService,
    private readonly accounts: ChildAccountService,
    client?: Pick<ReturnType<typeof createPublicClient>, 'readContract'>,
  ) {
    this.client =
      client ?? createPublicClient({ chain: sepolia, transport: http(settings.SEPOLIA_RPC_URL) });
  }
  async capability() {
    const { addresses } = await this.protocol.ensureReady();
    try {
      const version = await this.client.readContract({
        address: addresses.goals,
        abi: starGoalsAbi,
        functionName: 'goalRequestsVersion',
      });
      return { supported: version === 1n, goalsAddress: addresses.goals };
    } catch (error) {
      // Legacy immutable contracts lack this selector. RPC outages remain errors.
      if (error instanceof BaseError) {
        const cause = error.walk(
          (item) =>
            item instanceof ContractFunctionRevertedError ||
            item instanceof ContractFunctionZeroDataError,
        );
        if (
          cause instanceof ContractFunctionRevertedError ||
          cause instanceof ContractFunctionZeroDataError
        )
          return { supported: false, goalsAddress: addresses.goals };
      }
      throw error;
    }
  }
  async prepare(action: GoalRequestAction, input: GoalRequestInput) {
    if (!(await this.capability()).supported)
      throw badRequest(
        'GOAL_REQUESTS_NOT_DEPLOYED',
        'Goal requests need the updated goal and child-account contracts. No request was sent.',
      );
    const { addresses } = await this.protocol.ensureReady();
    const child = await this.client.readContract({
      address: addresses.registry,
      abi: registryAbi,
      functionName: 'getChild',
      args: [input.childId],
    });
    if (action === 'request' || action === 'approve') {
      const family = await this.client.readContract({
        address: addresses.registry,
        abi: registryAbi,
        functionName: 'getFamily',
        args: [child.familyId],
      });
      if (!family.active || !child.active)
        throw badRequest(
          'FAMILY_OR_CHILD_INACTIVE',
          'Reactivate this family and child before requesting or approving a goal.',
        );
    }
    const tx = (
      signerRole: 'CHILD' | 'PARENT',
      to: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
      summary: string,
    ): TransactionIntent => ({
      chainId: sepolia.id,
      signerRole,
      to,
      data: encodeFunctionData({ abi, functionName, args }),
      value: '0',
      summary,
    });
    let intent: TransactionIntent;
    if (action === 'request') {
      const used = await this.client.readContract({
        address: addresses.goals,
        abi: starGoalsAbi,
        functionName: 'usedGoalSubmissionIds',
        args: [child.wallet, input.submissionId!],
      });
      if (used)
        throw badRequest(
          'SUBMISSION_ALREADY_RECORDED',
          'This goal request was already sent. Check your waiting requests before trying again.',
        );
      intent = tx(
        'CHILD',
        child.wallet,
        childAccountAbi,
        'requestGoal',
        [input.title!, input.reason!, input.icon!, input.submissionId!],
        'Confirm your goal request with your passkey',
      );
    } else {
      const request = await this.client.readContract({
        address: addresses.goals,
        abi: starGoalsAbi,
        functionName: 'getGoalRequest',
        args: [input.requestId!],
      });
      if (request.childId !== input.childId)
        throw badRequest('WRONG_CHILD', 'This goal request belongs to another child.');
      if (request.status !== 0)
        throw badRequest('INVALID_REQUEST_STATE', 'This goal request has already been resolved.');
      intent =
        action === 'cancel'
          ? tx(
              'CHILD',
              child.wallet,
              childAccountAbi,
              'cancelGoalRequest',
              [input.requestId!],
              'Cancel your goal request',
            )
          : action === 'approve'
            ? tx(
                'PARENT',
                addresses.goals,
                starGoalsAbi,
                'approveGoalRequest',
                [input.requestId!, input.starCost!],
                `Approve “${request.title}” with a ${input.starCost} Star target`,
              )
            : tx(
                'PARENT',
                addresses.goals,
                starGoalsAbi,
                'rejectGoalRequest',
                [input.requestId!],
                'Decline this goal request',
              );
    }
    if (intent.signerRole === 'CHILD') await this.accounts.validateCall(child.wallet, intent.data);
    return { intents: [intent] };
  }
}
