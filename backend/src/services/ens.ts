import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  namehash,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { normalize } from 'viem/ens';
import { sepolia } from 'viem/chains';
import { sepoliaDeployment as deployment } from '@star/contracts/network';
import { ensRegistrarAbi } from '@star/contracts/abi';
import type { Config } from '../config.js';
import { HttpError, badRequest, unavailable } from '../errors.js';
import {
  ENS_OWNER_ROLES,
  ENS_REGISTRAR_ROLE,
  ENS_SET_SUBREGISTRY_ROLE,
  ensFactoryAbi,
  ensProxyAddress,
  ensRegistryAbi,
  ensResolverAbi,
  type EnsPlan,
  type EnsFamilyPlan,
} from './ens-v2.js';

type Snapshot = { number: bigint; timestamp: bigint };
type Namespace = {
  name: string;
  label: string;
  registry: Address;
  owner: Address;
  tokenId: bigint;
  expiresAt: bigint;
  subregistry: Address;
};

/** ENSv2 reads and unsigned, simulated registration steps. This service never signs. */
export class EnsService {
  private readonly client;
  private readonly parentName: string;

  constructor(private readonly settings: Config) {
    this.client = createPublicClient({
      chain: sepolia,
      transport: http(settings.SEPOLIA_RPC_URL),
      ccipRead: false,
    });
    this.parentName = normalizedName(settings.ENS_PARENT_NAME);
    if (!this.parentName.endsWith('.eth')) throw new Error('ENS_PARENT_NAME must be under .eth');
    // Never silently target a substituted factory or implementation.
    for (const [actual, expected] of [
      [settings.ENS_ROOT_REGISTRY_ADDRESS, deployment.ensRootRegistry],
      [settings.ENS_ETH_REGISTRY_ADDRESS, deployment.ensEthRegistry],
      [settings.ENS_UNIVERSAL_RESOLVER_ADDRESS, deployment.ensUniversalResolver],
      [settings.ENS_VERIFIABLE_FACTORY_ADDRESS, deployment.ensVerifiableFactory],
      [settings.ENS_USER_REGISTRY_IMPLEMENTATION_ADDRESS, deployment.ensUserRegistryImplementation],
      [
        settings.ENS_PERMISSIONED_RESOLVER_IMPLEMENTATION_ADDRESS,
        deployment.ensPermissionedResolverImplementation,
      ],
    ] as const) {
      if (!actual || !same(actual, expected))
        throw new Error('ENSv2 addresses must match the pinned Sepolia deployment');
    }
  }

  async inspect(name: string, expectedAddress?: Address) {
    const normalized = normalizedName(name);
    return this.withSnapshot(async (block) => {
      const resolvedAddress = await this.client.getEnsAddress({
        name: normalized,
        universalResolverAddress: deployment.ensUniversalResolver,
        blockNumber: block.number,
      });
      return {
        name: normalized,
        node: namehash(normalized),
        resolvedAddress,
        expectedAddress,
        matchesExpected: expectedAddress
          ? !!resolvedAddress && same(resolvedAddress, expectedAddress)
          : undefined,
        underConfiguredParent: this.isManagedName(normalized, true),
      };
    });
  }

  requireManagedName(name: string, allowParentName = false): string {
    const normalized = normalizedName(name);
    if (!this.isManagedName(normalized, allowParentName))
      throw badRequest(
        'ENS_OUTSIDE_CONFIGURED_NAMESPACE',
        `${normalized} must be a subname of ${this.parentName}`,
      );
    return normalized;
  }

  async namespace(name = this.parentName) {
    const normalized = this.requireManagedName(name, true);
    return this.withSnapshot(async (block) => {
      const state = await this.readNamespace(normalized, block);
      return {
        chainId: sepolia.id,
        name: state.name,
        owner: state.owner,
        registry: state.registry,
        tokenId: state.tokenId.toString(),
        expiresAt: state.expiresAt.toString(),
        subregistry: state.subregistry,
        setupRequired: same(state.subregistry, zeroAddress),
        checkedAtBlock: block.number.toString(),
      };
    });
  }

  async readiness() {
    return this.withSnapshot(async (block) => {
      const parent = await this.readNamespace(this.parentName, block);
      if (same(parent.subregistry, zeroAddress))
        throw unavailable(
          'ENS_SETUP_REQUIRED',
          'Set up the ENSv2 child registry using POST /v1/ens/namespace',
        );
      await this.verifyRegistry(parent.subregistry, parent, block);
      const registrar = await this.verifyFamilyRegistrar(parent, block, true);
      return {
        chainId: sepolia.id,
        parentName: this.parentName,
        registry: parent.subregistry,
        registrar,
      };
    });
  }

  async prepareNamespace(signer: Address, name = this.parentName): Promise<EnsPlan> {
    const normalized = this.requireManagedName(name, true);
    nonzero(signer);
    return this.withSnapshot(async (block) => {
      const parent = await this.readNamespace(normalized, block);
      const plan = await this.setup(parent, signer, block);
      if (
        plan.status !== 'READY' ||
        normalized !== this.parentName ||
        !this.settings.STAR_ENS_REGISTRAR_ADDRESS
      )
        return plan;
      const registrar = await this.verifyFamilyRegistrar(parent, block, false);
      const authorized = await this.client.readContract({
        address: parent.subregistry,
        abi: ensRegistryAbi,
        functionName: 'hasRootRoles',
        args: [ENS_REGISTRAR_ROLE, registrar],
        blockNumber: block.number,
      });
      if (authorized) return plan;
      if (!same(parent.owner, signer))
        throw new HttpError(
          403,
          'ENS_OWNER_REQUIRED',
          'Only the namespace owner may authorize the family registrar',
        );
      return this.transaction(
        'AUTHORIZE_FAMILY_REGISTRAR',
        normalized,
        signer,
        parent.subregistry,
        encodeFunctionData({
          abi: ensRegistryAbi,
          functionName: 'grantRootRoles',
          args: [ENS_REGISTRAR_ROLE, registrar],
        }),
        block,
      );
    });
  }

  /** Public family claims are caller-bound; parents never get root namespace roles. */
  async prepareFamily(input: {
    signer: Address;
    label: string;
    secret: Hex;
  }): Promise<EnsFamilyPlan> {
    const signer = nonzero(input.signer);
    const label = input.label;
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(label) || label.slice(2, 4) === '--')
      throw badRequest(
        'INVALID_ENS_LABEL',
        'Family labels must be 2–63 lowercase letters, digits or interior hyphens',
      );
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.secret) || /^0x0{64}$/.test(input.secret))
      throw badRequest(
        'INVALID_ENS_COMMITMENT',
        'A nonzero random 32-byte commitment secret is required',
      );
    const name = `${label}.${this.parentName}`;
    return this.withSnapshot(async (block) => {
      const parent = await this.readNamespace(this.parentName, block);
      if (same(parent.subregistry, zeroAddress))
        throw unavailable(
          'ENS_SETUP_REQUIRED',
          'The app owner must finish ENS setup before families can register',
        );
      await this.verifyRegistry(parent.subregistry, parent, block);
      const registry = {
        address: parent.subregistry,
        abi: ensRegistryAbi,
        blockNumber: block.number,
      };
      const tokenId = await this.client.readContract({
        ...registry,
        functionName: 'findTokenId',
        args: [label],
      });
      const state = await this.client.readContract({
        ...registry,
        functionName: 'getState',
        args: [tokenId],
      });
      if (state.status !== 0) {
        if (state.status !== 2 || !same(state.latestOwner, signer))
          throw new HttpError(
            409,
            'ENS_NAME_UNAVAILABLE',
            'This family name is already registered or reserved',
          );
        const resolver = await this.client.readContract({
          ...registry,
          functionName: 'getResolver',
          args: [label],
        });
        await this.verifyResolver(resolver, signer, name, signer, block);
        const resolved = await this.client.getEnsAddress({
          name,
          universalResolverAddress: deployment.ensUniversalResolver,
          blockNumber: block.number,
        });
        if (!resolved || !same(resolved, signer))
          throw unavailable(
            'ENS_RESOLUTION_MISMATCH',
            'The family name does not resolve to its parent',
          );
        return this.ready(name, block);
      }
      const registrar = await this.verifyFamilyRegistrar(parent, block, true);
      const contract = { address: registrar, abi: ensRegistrarAbi, blockNumber: block.number };
      const commitment = await this.client.readContract({
        ...contract,
        functionName: 'makeCommitment',
        args: [label, signer, input.secret],
      });
      const [committedAt, minAge, maxAge] = await Promise.all([
        this.client.readContract({
          ...contract,
          functionName: 'commitments',
          args: [signer, commitment],
        }),
        this.client.readContract({ ...contract, functionName: 'MIN_COMMITMENT_AGE' }),
        this.client.readContract({ ...contract, functionName: 'MAX_COMMITMENT_AGE' }),
      ]);
      if (committedAt === 0n || block.timestamp > committedAt + maxAge)
        return this.transaction(
          'COMMIT_FAMILY_NAME',
          name,
          signer,
          registrar,
          encodeFunctionData({ abi: ensRegistrarAbi, functionName: 'commit', args: [commitment] }),
          block,
        );
      if (block.timestamp < committedAt + minAge)
        return {
          status: 'WAITING',
          name,
          checkedAtBlock: block.number.toString(),
          readyAt: (committedAt + minAge).toString(),
          step: null,
          transaction: null,
          requiresConfirmation: false,
        };
      return this.transaction(
        'REGISTER_FAMILY_NAME',
        name,
        signer,
        registrar,
        encodeFunctionData({
          abi: ensRegistrarAbi,
          functionName: 'registerFamily',
          args: [label, input.secret],
        }),
        block,
      );
    });
  }

  private async verifyFamilyRegistrar(
    parent: Namespace,
    block: Snapshot,
    requireAuthorization: boolean,
  ): Promise<Address> {
    const address = this.settings.STAR_ENS_REGISTRAR_ADDRESS;
    const hash = this.settings.STAR_ENS_REGISTRAR_RUNTIME_CODE_HASH;
    if (!address || !hash)
      throw unavailable(
        'ENS_REGISTRAR_NOT_CONFIGURED',
        'Deploy StarEnsRegistrar and load its deployment manifest',
      );
    const code = await this.client.getCode({ address, blockNumber: block.number });
    if (!code || keccak256(code) !== hash)
      throw unavailable(
        'ENS_REGISTRAR_MISMATCH',
        'Family registrar bytecode does not match the deployment manifest',
      );
    const contract = { address, abi: ensRegistrarAbi, blockNumber: block.number };
    const [ethRegistry, factory, registryImpl, resolverImpl, node] = await Promise.all([
      this.client.readContract({ ...contract, functionName: 'ethRegistry' }),
      this.client.readContract({ ...contract, functionName: 'factory' }),
      this.client.readContract({ ...contract, functionName: 'registryImplementation' }),
      this.client.readContract({ ...contract, functionName: 'resolverImplementation' }),
      this.client.readContract({ ...contract, functionName: 'parentNode' }),
    ]);
    if (
      !same(ethRegistry, deployment.ensEthRegistry) ||
      !same(factory, deployment.ensVerifiableFactory) ||
      !same(registryImpl, deployment.ensUserRegistryImplementation) ||
      !same(resolverImpl, deployment.ensPermissionedResolverImplementation) ||
      node !== namehash(this.parentName)
    )
      throw unavailable(
        'ENS_REGISTRAR_MISMATCH',
        'Family registrar targets a different namespace or ENS deployment',
      );
    if (requireAuthorization) {
      const allowed = await this.client.readContract({
        address: parent.subregistry,
        abi: ensRegistryAbi,
        functionName: 'hasRootRoles',
        args: [ENS_REGISTRAR_ROLE, address],
        blockNumber: block.number,
      });
      if (!allowed)
        throw unavailable(
          'ENS_SETUP_REQUIRED',
          'The app owner must authorize the family registrar once before onboarding',
        );
    }
    return address;
  }

  private async setup(parent: Namespace, signer: Address, block: Snapshot): Promise<EnsPlan> {
    if (!same(parent.subregistry, zeroAddress)) {
      await this.verifyRegistry(parent.subregistry, parent, block);
      return this.ready(parent.name, block);
    }
    if (!same(parent.owner, signer))
      throw new HttpError(
        403,
        'ENS_OWNER_REQUIRED',
        'The current namespace owner must sign its one-time setup',
      );
    const canAttach = await this.client.readContract({
      address: parent.registry,
      abi: ensRegistryAbi,
      functionName: 'hasRoles',
      args: [parent.tokenId, ENS_SET_SUBREGISTRY_ROLE, signer],
      blockNumber: block.number,
    });
    if (!canAttach)
      throw new HttpError(
        403,
        'ENS_SUBREGISTRY_PERMISSION_REQUIRED',
        'The owner lacks permission to attach a child registry',
      );
    const salt = this.salt(
      'star-ens-registry-v2',
      parent.name,
      parent.registry,
      parent.tokenId,
      parent.owner,
      zeroAddress,
    );
    const registry = await this.proxy(signer, salt, block);
    if (!(await this.hasCode(registry, block))) {
      const data = encodeFunctionData({
        abi: ensRegistryAbi,
        functionName: 'initialize',
        args: [parent.owner, ENS_OWNER_ROLES],
      });
      return this.deploy(
        'DEPLOY_REGISTRY',
        parent.name,
        signer,
        deployment.ensUserRegistryImplementation,
        salt,
        data,
        block,
      );
    }
    await this.verifyImplementation(registry, deployment.ensUserRegistryImplementation, block);
    const ownsRegistry = await this.client.readContract({
      address: registry,
      abi: ensRegistryAbi,
      functionName: 'hasRootRoles',
      args: [ENS_OWNER_ROLES, parent.owner],
      blockNumber: block.number,
    });
    if (!ownsRegistry)
      throw new HttpError(
        409,
        'ENS_REGISTRY_OWNER_MISMATCH',
        'The prepared registry no longer grants control to the namespace owner',
      );
    const [linkedRegistry, linkedLabel] = await this.client.readContract({
      address: registry,
      abi: ensRegistryAbi,
      functionName: 'getParent',
      blockNumber: block.number,
    });
    if (same(linkedRegistry, zeroAddress) && linkedLabel === '')
      return this.transaction(
        'SET_REGISTRY_PARENT',
        parent.name,
        signer,
        registry,
        encodeFunctionData({
          abi: ensRegistryAbi,
          functionName: 'setParent',
          args: [parent.registry, parent.label],
        }),
        block,
      );
    await this.verifyRegistry(registry, parent, block);
    return this.transaction(
      'ATTACH_REGISTRY',
      parent.name,
      signer,
      parent.registry,
      encodeFunctionData({
        abi: ensRegistryAbi,
        functionName: 'setSubregistry',
        args: [parent.tokenId, registry],
      }),
      block,
    );
  }

  private async readNamespace(name: string, block: Snapshot): Promise<Namespace> {
    const labels = name.split('.').reverse();
    if (labels.shift() !== 'eth' || labels.length === 0)
      throw badRequest('INVALID_ENS_NAMESPACE', 'A namespace under .eth is required');
    const eth = await this.client.readContract({
      address: deployment.ensRootRegistry,
      abi: ensRegistryAbi,
      functionName: 'getSubregistry',
      args: ['eth'],
      blockNumber: block.number,
    });
    if (!same(eth, deployment.ensEthRegistry))
      throw unavailable(
        'ENS_DEPLOYMENT_CHANGED',
        'The pinned ENSv2 deployment no longer matches the root registry',
      );
    let registry = eth;
    let expiresAt = (1n << 64n) - 1n;
    for (const [index, label] of labels.entries()) {
      const tokenId = await this.client.readContract({
        address: registry,
        abi: ensRegistryAbi,
        functionName: 'findTokenId',
        args: [label],
        blockNumber: block.number,
      });
      const state = await this.client.readContract({
        address: registry,
        abi: ensRegistryAbi,
        functionName: 'getState',
        args: [tokenId],
        blockNumber: block.number,
      });
      if (
        state.status !== 2 ||
        state.expiry <= block.timestamp ||
        same(state.latestOwner, zeroAddress)
      )
        throw new HttpError(
          409,
          'ENS_NAMESPACE_NOT_REGISTERED',
          'The namespace and all its ancestors must be actively registered on Sepolia ENSv2',
        );
      if (state.expiry < expiresAt) expiresAt = state.expiry;
      const subregistry = await this.client.readContract({
        address: registry,
        abi: ensRegistryAbi,
        functionName: 'getSubregistry',
        args: [label],
        blockNumber: block.number,
      });
      const parent = {
        name:
          labels
            .slice(0, index + 1)
            .reverse()
            .join('.') + '.eth',
        label,
        registry,
        owner: state.latestOwner,
        tokenId: state.tokenId,
        expiresAt,
        subregistry,
      };
      if (index === labels.length - 1) return parent;
      if (same(subregistry, zeroAddress))
        throw new HttpError(
          409,
          'ENS_ANCESTOR_SETUP_REQUIRED',
          `Set up the child registry for ${parent.name} first`,
        );
      await this.verifyRegistry(subregistry, parent, block);
      registry = subregistry;
    }
    throw badRequest('INVALID_ENS_NAMESPACE', 'A namespace under .eth is required');
  }

  private async verifyImplementation(proxy: Address, expected: Address, block: Snapshot) {
    const implementation = await this.client.readContract({
      address: deployment.ensVerifiableFactory,
      abi: ensFactoryAbi,
      functionName: 'verifyContract',
      args: [proxy],
      blockNumber: block.number,
    });
    if (!same(implementation, expected))
      throw new HttpError(
        409,
        'ENS_UNSUPPORTED_IMPLEMENTATION',
        'The namespace uses a different ENS implementation; no changes were prepared',
      );
  }

  private async verifyRegistry(registry: Address, parent: Namespace, block: Snapshot) {
    await this.verifyImplementation(registry, deployment.ensUserRegistryImplementation, block);
    const [linkedRegistry, label] = await this.client.readContract({
      address: registry,
      abi: ensRegistryAbi,
      functionName: 'getParent',
      blockNumber: block.number,
    });
    if (!same(linkedRegistry, parent.registry) || label !== parent.label)
      throw new HttpError(
        409,
        'ENS_REGISTRY_PARENT_MISMATCH',
        'The child registry is attached to a different parent',
      );
  }

  private async verifyResolver(
    proxy: Address,
    owner: Address,
    name: string,
    target: Address,
    block: Snapshot,
  ) {
    await this.verifyImplementation(proxy, deployment.ensPermissionedResolverImplementation, block);
    const [permitted, address] = await Promise.all([
      this.client.readContract({
        address: proxy,
        abi: ensResolverAbi,
        functionName: 'hasRootRoles',
        args: [ENS_OWNER_ROLES, owner],
        blockNumber: block.number,
      }),
      this.client.readContract({
        address: proxy,
        abi: ensResolverAbi,
        functionName: 'addr',
        args: [namehash(name)],
        blockNumber: block.number,
      }),
    ]);
    if (!permitted || !same(address, target))
      throw new HttpError(
        409,
        'ENS_RESOLVER_MISMATCH',
        'The resolver owner or address differs from this request',
      );
  }

  private salt(
    tag: string,
    name: string,
    registry: Address,
    tokenId: bigint,
    owner: Address,
    target: Address,
    expiresAt = 0n,
  ) {
    return BigInt(
      keccak256(
        encodeAbiParameters(
          [
            { type: 'string' },
            { type: 'bytes32' },
            { type: 'address' },
            { type: 'uint256' },
            { type: 'address' },
            { type: 'address' },
            { type: 'uint64' },
          ],
          // A child token's version changes DURING expired-name re-registration.
          // Bind resolver identity to the parent incarnation and new lease instead.
          [tag, namehash(name), registry, tokenId, owner, target, expiresAt],
        ),
      ),
    );
  }

  private async proxy(signer: Address, salt: bigint, block: Snapshot) {
    const logic = await this.client.readContract({
      address: deployment.ensVerifiableFactory,
      abi: ensFactoryAbi,
      functionName: 'proxyLogic',
      blockNumber: block.number,
    });
    return ensProxyAddress(deployment.ensVerifiableFactory, logic, signer, salt);
  }

  private async hasCode(address: Address, block: Snapshot) {
    const code = await this.client.getCode({ address, blockNumber: block.number });
    return !!code && code !== '0x';
  }

  private deploy(
    step: 'DEPLOY_REGISTRY' | 'DEPLOY_RESOLVER',
    name: string,
    signer: Address,
    implementation: Address,
    salt: bigint,
    data: Hex,
    block: Snapshot,
  ) {
    return this.transaction(
      step,
      name,
      signer,
      deployment.ensVerifiableFactory,
      encodeFunctionData({
        abi: ensFactoryAbi,
        functionName: 'deployProxy',
        args: [implementation, salt, data],
      }),
      block,
    );
  }

  private async transaction(
    step: NonNullable<EnsPlan['step']>,
    name: string,
    signer: Address,
    to: Address,
    data: Hex,
    block: Snapshot,
  ): Promise<EnsPlan> {
    await this.client.call({ account: signer, to, data, value: 0n, blockNumber: block.number });
    return {
      status: 'TRANSACTION_REQUIRED',
      step,
      name,
      checkedAtBlock: block.number.toString(),
      requiresConfirmation: true,
      transaction: { chainId: sepolia.id, from: signer, to, data, value: '0' },
    };
  }

  private ready(name: string, block: Snapshot): EnsPlan {
    return {
      status: 'READY',
      step: null,
      name,
      checkedAtBlock: block.number.toString(),
      requiresConfirmation: false,
      transaction: null,
    };
  }

  private isManagedName(name: string, allowParentName: boolean): boolean {
    return (allowParentName && name === this.parentName) || name.endsWith(`.${this.parentName}`);
  }

  private async withSnapshot<T>(operation: (block: Snapshot) => Promise<T>): Promise<T> {
    try {
      if ((await this.client.getChainId()) !== sepolia.id)
        throw unavailable('ENS_WRONG_CHAIN', 'ENS requires Ethereum Sepolia (11155111)');
      const block = await this.client.getBlock();
      if (block.number === null) throw unavailable('ENS_UNAVAILABLE', 'A mined block is required');
      return await operation({ number: block.number, timestamp: block.timestamp });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable('ENS_UNAVAILABLE', 'ENSv2 verification or transaction simulation failed', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function same(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}
function nonzero(address: Address): Address {
  if (!isAddress(address) || same(address, zeroAddress))
    throw badRequest('INVALID_ENS_ADDRESS', 'A nonzero EVM address is required');
  return getAddress(address);
}
function normalizedName(name: string): string {
  try {
    const normalized = normalize(name);
    const labels = normalized.split('.');
    if (
      labels.length > 8 ||
      labels.some((label) => !label || Buffer.byteLength(label, 'utf8') > 63) ||
      Buffer.byteLength(normalized, 'utf8') + 2 > 255
    )
      throw new Error('DNS limits exceeded');
    return normalized;
  } catch {
    throw badRequest(
      'INVALID_ENS_NAME',
      'Provide a valid ENS name (up to 8 labels and 63 UTF-8 bytes per label)',
    );
  }
}
