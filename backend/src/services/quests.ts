import { childAccountAbi, familyVaultAbi, questsAbi, registryAbi } from '@star/contracts/abi';
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
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

export type QuestAction =
  'create' | 'cancel' | 'submit' | 'request' | 'cancel-request' | 'approve' | 'reject';
export type QuestInput = {
  childId: bigint;
  id?: bigint;
  stars?: bigint;
  text?: string;
  submissionId?: Hex;
};
const erc20Abi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);

/** Unsigned intents only. Canonical request terms and ownership come from Sepolia, never the indexer. */
export class QuestService {
  private readonly client;
  constructor(
    settings: Config,
    private readonly protocol: ProtocolService,
    private readonly accounts: ChildAccountService,
  ) {
    this.client = createPublicClient({ chain: sepolia, transport: http(settings.SEPOLIA_RPC_URL) });
  }

  async prepare(action: QuestAction, input: QuestInput) {
    const { addresses } = await this.protocol.ensureReady();
    const child = await this.client.readContract({
      address: addresses.registry,
      abi: registryAbi,
      functionName: 'getChild',
      args: [input.childId],
    });
    const { vault } = await this.protocol.resolveFamilyVault(child.familyId);
    if (['create', 'request', 'submit', 'approve'].includes(action)) {
      const family = await this.client.readContract({
        address: addresses.registry,
        abi: registryAbi,
        functionName: 'getFamily',
        args: [child.familyId],
      });
      if (!family.active || !child.active)
        throw badRequest(
          'FAMILY_OR_CHILD_INACTIVE',
          'Reactivate this family and child before submitting or rewarding Stars',
        );
    }
    const workflow = await this.client.readContract({
      address: vault,
      abi: familyVaultAbi,
      functionName: 'quests',
    });
    const [boundVault, boundRegistry, boundFamily] = await Promise.all([
      this.client.readContract({ address: workflow, abi: questsAbi, functionName: 'vault' }),
      this.client.readContract({ address: workflow, abi: questsAbi, functionName: 'registry' }),
      this.client.readContract({ address: workflow, abi: questsAbi, functionName: 'familyId' }),
    ]);
    if (
      getAddress(boundVault) !== getAddress(vault) ||
      getAddress(boundRegistry) !== getAddress(addresses.registry) ||
      boundFamily !== child.familyId
    )
      throw badRequest('WORKFLOW_MISMATCH', 'Quest workflow does not match this deployment');
    const tx = (
      role: 'PARENT' | 'CHILD',
      to: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
      summary: string,
    ): TransactionIntent => ({
      chainId: sepolia.id,
      signerRole: role,
      to,
      data: encodeFunctionData({ abi, functionName, args }),
      value: '0',
      summary,
    });
    if (
      input.submissionId &&
      (await this.client.readContract({
        address: workflow,
        abi: questsAbi,
        functionName: 'usedSubmissionIds',
        args: [child.wallet, input.submissionId],
      }))
    )
      throw badRequest(
        'SUBMISSION_ALREADY_RECORDED',
        'This submission is already on-chain. Check Waiting or History before starting another request.',
      );
    let intents: TransactionIntent[];
    if (action === 'create') {
      intents = [
        tx(
          'PARENT',
          workflow,
          questsAbi,
          'createQuest',
          [child.id, input.stars!, input.text!],
          'Assign this quest',
        ),
      ];
    } else if (action === 'request') {
      intents = [
        tx(
          'CHILD',
          child.wallet,
          childAccountAbi,
          'requestStars',
          [input.stars!, input.text!, input.submissionId!],
          'Request Stars with your passkey',
        ),
      ];
    } else {
      const isQuest = action === 'cancel' || action === 'submit';
      const item = isQuest
        ? await this.client.readContract({
            address: workflow,
            abi: questsAbi,
            functionName: 'getQuest',
            args: [input.id!],
          })
        : await this.client.readContract({
            address: workflow,
            abi: questsAbi,
            functionName: 'getRequest',
            args: [input.id!],
          });
      if (item.childId !== child.id)
        throw badRequest('WRONG_CHILD', 'This quest/request belongs to another child');
      if (item.status !== 0)
        throw badRequest(
          'INVALID_REQUEST_STATE',
          'This quest/request has already been submitted or resolved',
        );
      if (action === 'approve' && item.stars !== input.stars)
        throw badRequest('REWARD_MISMATCH', 'The displayed reward does not match this request');
      switch (action) {
        case 'cancel':
          intents = [
            tx('PARENT', workflow, questsAbi, 'cancelQuest', [input.id!], 'Cancel this quest'),
          ];
          break;
        case 'submit':
          intents = [
            tx(
              'CHILD',
              child.wallet,
              childAccountAbi,
              'submitQuest',
              [input.id!, input.submissionId!],
              'Submit quest completion with your passkey',
            ),
          ];
          break;
        case 'cancel-request':
          intents = [
            tx(
              'CHILD',
              child.wallet,
              childAccountAbi,
              'cancelStarRequest',
              [input.id!],
              'Cancel your pending Star request',
            ),
          ];
          break;
        case 'reject':
          intents = [
            tx(
              'PARENT',
              workflow,
              questsAbi,
              'rejectRequest',
              [input.id!],
              'Reject this Star request',
            ),
          ];
          break;
        case 'approve':
          intents = [
            tx(
              'PARENT',
              addresses.usdc,
              erc20Abi,
              'approve',
              [vault, item.stars * 1_000_000n],
              `Approve ${item.stars} USDC for this reward`,
            ),
            tx(
              'PARENT',
              vault,
              familyVaultAbi,
              'approveStarRequest',
              [input.id!],
              `Reward ${item.stars} Stars with matching USDC`,
            ),
          ];
          break;
      }
    }
    if (intents[0]?.signerRole === 'CHILD') {
      await this.accounts.validateCall(child.wallet, intents[0].data);
    }
    return {
      familyId: child.familyId.toString(),
      childId: child.id.toString(),
      vault,
      workflow,
      intents,
    };
  }
}
