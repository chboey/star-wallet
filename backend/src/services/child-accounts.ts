import {
  childAccountAbi,
  childAccountFactoryAbi,
  registryAbi,
  starGoalsAbi,
} from '@star/contracts/abi';
import {
  createPublicClient,
  getAddress,
  http,
  namehash,
  zeroHash,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import type { Config } from '../config.js';
import { badRequest } from '../errors.js';
import type { ProtocolService } from './protocol.js';
import { decodeChildCall } from '@star/contracts/child-account';
import { entryPoint08Address } from 'viem/account-abstraction';

export type ChildCredential = { id: string; publicKey: Hex };

/** Public credential metadata only. The passkey's private key never leaves its authenticator. */
export class ChildAccountService {
  private readonly client;

  constructor(
    private readonly settings: Config,
    private readonly protocol: ProtocolService,
  ) {
    this.client = createPublicClient({ chain: sepolia, transport: http(settings.SEPOLIA_RPC_URL) });
  }

  async findByName(familyId: bigint, ensName: string) {
    const { addresses } = await this.protocol.ensureReady();
    const wallet = await this.client.readContract({
      address: addresses.childAccountFactory,
      abi: childAccountFactoryAbi,
      functionName: 'accountByName',
      args: [familyId, namehash(ensName)],
    });
    if (wallet === zeroAddress) return { account: null };
    const account = await this.resolve(wallet);
    return { account: { ...account, familyId: account.familyId.toString() } };
  }

  async prepare(familyId: bigint, ensName: string, credential: ChildCredential) {
    const { addresses } = await this.protocol.ensureReady();
    const family = await this.client.readContract({
      address: addresses.registry,
      abi: registryAbi,
      functionName: 'getFamily',
      args: [familyId],
    });
    if (!family.active) throw badRequest('FAMILY_INACTIVE', 'Reactivate this family first');
    const suffix = `.${family.ensName}`;
    if (
      !family.ensName ||
      !ensName.endsWith(suffix) ||
      ensName.slice(0, -suffix.length).includes('.') ||
      ensName === suffix
    ) {
      throw badRequest('INVALID_CHILD_ENS', 'Use a direct child name under this family ENS name');
    }
    const ensNode = namehash(ensName);
    const wallet = await this.client.readContract({
      address: addresses.childAccountFactory,
      abi: childAccountFactoryAbi,
      functionName: 'predictChildAccount',
      args: [
        familyId,
        ensNode,
        `0x${credential.publicKey.slice(2, 66)}`,
        `0x${credential.publicKey.slice(66)}`,
        credential.id,
      ],
    });
    const deployed = await this.client.readContract({
      address: addresses.childAccountFactory,
      abi: childAccountFactoryAbi,
      functionName: 'isChildAccount',
      args: [wallet],
    });
    const existing = await this.client.readContract({
      address: addresses.childAccountFactory,
      abi: childAccountFactoryAbi,
      functionName: 'accountByName',
      args: [familyId, ensNode],
    });
    if (existing !== zeroAddress && getAddress(existing) !== getAddress(wallet))
      throw badRequest(
        'CREDENTIAL_MISMATCH',
        'This child already has a passkey account. Use its existing passkey; do not create a replacement',
      );
    return { wallet, parent: family.parent, ensNode, deployed, credential };
  }

  async resolve(wallet: Address) {
    const { addresses } = await this.protocol.ensureReady();
    const canonical = await this.client.readContract({
      address: addresses.childAccountFactory,
      abi: childAccountFactoryAbi,
      functionName: 'isChildAccount',
      args: [wallet],
    });
    if (!canonical)
      throw badRequest(
        'UNSUPPORTED_CHILD_ACCOUNT',
        'Create the child passkey account through onboarding first',
      );
    const [familyId, ensNode, publicKeyX, publicKeyY, credentialId] = await Promise.all([
      this.client.readContract({ address: wallet, abi: childAccountAbi, functionName: 'familyId' }),
      this.client.readContract({ address: wallet, abi: childAccountAbi, functionName: 'ensNode' }),
      this.client.readContract({
        address: wallet,
        abi: childAccountAbi,
        functionName: 'publicKeyX',
      }),
      this.client.readContract({
        address: wallet,
        abi: childAccountAbi,
        functionName: 'publicKeyY',
      }),
      this.client.readContract({
        address: wallet,
        abi: childAccountAbi,
        functionName: 'credentialId',
      }),
    ]);
    const family = await this.client.readContract({
      address: addresses.registry,
      abi: registryAbi,
      functionName: 'getFamily',
      args: [familyId],
    });
    return {
      wallet,
      familyId,
      ensNode,
      parent: family.parent,
      active: family.active,
      credential: { id: credentialId, publicKey: `${publicKeyX}${publicKeyY.slice(2)}` as Hex },
      rpId: this.settings.CHILD_ACCOUNT_RP_ID,
    };
  }

  async registration(familyId: bigint, wallet: Address, ensName: string) {
    const account = await this.resolve(wallet);
    const expected = await this.prepare(familyId, ensName, account.credential);
    if (
      getAddress(expected.wallet) !== getAddress(wallet) ||
      account.familyId !== familyId ||
      account.ensNode !== expected.ensNode
    ) {
      throw badRequest(
        'CHILD_ACCOUNT_MISMATCH',
        'The account must belong to this family and child ENS name',
      );
    }
    const { addresses } = await this.protocol.ensureReady();
    const [childId, pendingId] = await Promise.all([
      this.client.readContract({
        address: addresses.registry,
        abi: registryAbi,
        functionName: 'childIdByWallet',
        args: [wallet],
      }),
      this.client.readContract({
        address: addresses.registry,
        abi: registryAbi,
        functionName: 'pendingRegistrationIdByWallet',
        args: [wallet],
      }),
    ]);
    const registrationId = await this.client.readContract({
      address: addresses.registry,
      abi: registryAbi,
      functionName: 'childRegistrationId',
      args: [familyId, wallet, expected.ensNode],
    });
    if (pendingId !== zeroHash && pendingId !== registrationId) {
      throw badRequest(
        'OTHER_REGISTRATION_PENDING',
        'Cancel the other pending registration before continuing',
      );
    }
    return {
      ...account,
      state:
        childId !== 0n
          ? ('ACCEPTED' as const)
          : pendingId !== zeroHash
            ? ('PENDING' as const)
            : ('UNREGISTERED' as const),
    };
  }

  async forAction(kind: 'goal' | 'redemption', id: bigint) {
    const { addresses } = await this.protocol.ensureReady();
    const item =
      kind === 'goal'
        ? await this.client.readContract({
            address: addresses.goals,
            abi: starGoalsAbi,
            functionName: 'getGoal',
            args: [id],
          })
        : await this.client.readContract({
            address: addresses.goals,
            abi: starGoalsAbi,
            functionName: 'getRedemption',
            args: [id],
          });
    const child = await this.client.readContract({
      address: addresses.registry,
      abi: registryAbi,
      functionName: 'getChild',
      args: [item.childId],
    });
    const account = await this.resolve(child.wallet);
    if (account.familyId !== child.familyId)
      throw badRequest('CHILD_ACCOUNT_MISMATCH', 'The child belongs to a different family');
    return account;
  }

  async validateCall(wallet: Address, callData: Hex) {
    const account = await this.resolve(wallet);
    const decoded = decodeChildCall(callData);
    if (decoded.functionName === 'acceptRegistration') {
      const { addresses } = await this.protocol.ensureReady();
      const registration = await this.client.readContract({
        address: addresses.registry,
        abi: registryAbi,
        functionName: 'getChildRegistration',
        args: decoded.args,
      });
      if (
        !account.active ||
        getAddress(registration.childWallet) !== getAddress(wallet) ||
        registration.familyId !== account.familyId ||
        registration.ensNode !== account.ensNode
      )
        throw badRequest(
          'CHILD_ACCOUNT_MISMATCH',
          'Registration does not belong to this active child account',
        );
    } else if (decoded.functionName === 'addStarsToGoal') {
      const expected = await this.forAction('goal', decoded.args[0]);
      if (!account.active || getAddress(expected.wallet) !== getAddress(wallet))
        throw badRequest(
          'CHILD_ACCOUNT_MISMATCH',
          'This goal does not belong to the active child account',
        );
      try {
        // Read-only EntryPoint simulation checks ownership, remaining target and
        // available on-chain Stars before any contribution is offered for signing.
        await this.client.call({ account: entryPoint08Address, to: wallet, data: callData });
      } catch {
        throw badRequest(
          'INVALID_GOAL_CONTRIBUTION',
          'Cannot add these Stars. Check the goal and available Stars, and ensure the contribution contracts are deployed.',
        );
      }
    } else if (
      decoded.functionName === 'requestRedemption' ||
      decoded.functionName === 'cancelRedemption'
    ) {
      const expected = await this.forAction(
        decoded.functionName === 'requestRedemption' ? 'goal' : 'redemption',
        decoded.args[0],
      );
      if (
        getAddress(expected.wallet) !== getAddress(wallet) ||
        (decoded.functionName === 'requestRedemption' && !account.active)
      )
        throw badRequest(
          'CHILD_ACCOUNT_MISMATCH',
          'This request does not belong to the active child account',
        );
    } else if (
      [
        'submitQuest',
        'requestStars',
        'cancelStarRequest',
        'requestGoal',
        'cancelGoalRequest',
      ].includes(decoded.functionName)
    ) {
      try {
        await this.client.call({ account: entryPoint08Address, to: wallet, data: callData });
      } catch {
        throw badRequest(
          decoded.functionName === 'requestGoal' || decoded.functionName === 'cancelGoalRequest'
            ? 'INVALID_GOAL_REQUEST'
            : 'INVALID_QUEST_ACTION',
          'This quest or goal request is unavailable or does not belong to this child',
        );
      }
    } else
      throw badRequest('UNSUPPORTED_CHILD_CALL', 'This method is not allowed for a child account');
  }
}
