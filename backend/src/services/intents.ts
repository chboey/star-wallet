import {
  childAccountAbi,
  childAccountFactoryAbi,
  familyVaultFactoryAbi,
  registryAbi,
} from '@star/contracts/abi';
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  namehash,
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

export type SignerRole = 'PARENT' | 'CHILD' | 'EMERGENCY_ADMIN';

export type ChildCredential = { id: string; publicKey: Hex };

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

  constructor(private readonly settings: Config) {
    this.addresses = protocolAddresses(settings);
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
