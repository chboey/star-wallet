import { familyVaultFactoryAbi, registryAbi } from '@star/contracts/abi';
import {
  encodeFunctionData,
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
