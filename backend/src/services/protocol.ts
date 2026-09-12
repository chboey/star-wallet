import {
  childAccountFactoryAbi,
  familyVaultAbi,
  familyVaultFactoryAbi,
  registryAbi,
  starGoalsAbi,
  starTokenAbi,
} from '@star/contracts/abi';
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  maxUint256,
  parseAbi,
  toBytes,
  zeroAddress,
  type Address,
} from 'viem';
import { sepolia } from 'viem/chains';
import { entryPoint08Address } from 'viem/account-abstraction';
import { sepoliaDeployment } from '@star/contracts/network';
import type { Config, ProtocolAddresses } from '../config.js';
import { protocolAddresses } from '../config.js';
import { HttpError, badRequest, unavailable } from '../errors.js';

const pinnedSepoliaTokens = { usdc: sepoliaDeployment.usdc, weth: sepoliaDeployment.weth };
const pinnedSepoliaFeeds = {
  ethUsd: sepoliaDeployment.ethUsdFeed,
  usdcUsd: sepoliaDeployment.usdcUsdFeed,
};
const erc20MetadataAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);
const swapVmAbi = parseAbi([
  'function AQUA() view returns (address)',
  'function WETH() view returns (address)',
]);
const minterRole = keccak256(toBytes('MINTER_ROLE'));
const burnerRole = keccak256(toBytes('BURNER_ROLE'));
const vaultFactoryRole = keccak256(toBytes('VAULT_FACTORY_ROLE'));

export type ProtocolReadiness = {
  chainId: 11155111;
  checkedBlock: string;
  addresses: ProtocolAddresses;
  roles: {
    factoryCanRegisterVaultMinters: true;
    goalsIsBurner: true;
  };
  factory: {
    emergencyAdmin: Address;
    ethUsdFeed: Address;
    usdcUsdFeed: Address;
    maxStrategyPriceDeviationBps: number;
    maxStrategyLifetimeSeconds: number;
    maxPositionUsdc: string;
    maxPositionWeth: string;
  };
};

export type FamilyVaultResolution = {
  familyId: bigint;
  vault: Address;
  emergencyAdmin: Address;
  paused: boolean;
  positionActive: boolean;
};

export class ProtocolService {
  private readonly client;
  private cached?: { expiresAt: number; promise: Promise<ProtocolReadiness> };

  constructor(private readonly settings: Config) {
    this.client = createPublicClient({ chain: sepolia, transport: http(settings.SEPOLIA_RPC_URL) });
  }

  ensureReady(): Promise<ProtocolReadiness> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.promise;
    const promise = this.verifyCore().catch((error: unknown) => {
      this.cached = undefined;
      if (error instanceof HttpError) throw error;
      throw unavailable('PROTOCOL_UNAVAILABLE', 'Sepolia protocol verification failed', {
        cause: error instanceof Error ? error.message : String(error),
      });
    });
    this.cached = { expiresAt: Date.now() + 30_000, promise };
    return promise;
  }

  async resolveFamilyVault(familyId: bigint): Promise<FamilyVaultResolution> {
    const { addresses } = await this.ensureReady();
    try {
      const rawVault = await this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'vaultByFamily',
        args: [familyId],
      });
      if (typeof rawVault !== 'string' || getAddress(rawVault) === zeroAddress) {
        throw badRequest(
          'FAMILY_VAULT_NOT_CREATED',
          `Family ${familyId.toString()} does not have a factory-created vault`,
        );
      }
      return await this.verifyFamilyVault(addresses, familyId, getAddress(rawVault));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable('FAMILY_VAULT_UNAVAILABLE', 'Family vault resolution failed', {
        familyId: familyId.toString(),
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async resolveChildVault(childId: bigint): Promise<FamilyVaultResolution> {
    const { addresses } = await this.ensureReady();
    try {
      const child = (await this.client.readContract({
        address: addresses.registry,
        abi: registryAbi,
        functionName: 'getChild',
        args: [childId],
      })) as { familyId?: unknown };
      if (typeof child.familyId !== 'bigint' || child.familyId === 0n) {
        throw new Error('Registry returned an invalid child family ID');
      }
      return await this.resolveFamilyVault(child.familyId);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable('CHILD_VAULT_UNAVAILABLE', 'Child family vault resolution failed', {
        childId: childId.toString(),
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async verifyCore(): Promise<ProtocolReadiness> {
    const addresses = protocolAddresses(this.settings);
    for (const [name, expected] of Object.entries(pinnedSepoliaTokens)) {
      assertAddress(
        `configured Sepolia ${name}`,
        addresses[name as keyof ProtocolAddresses],
        expected,
      );
    }

    const chainId = await this.client.getChainId();
    if (chainId !== sepolia.id) {
      throw new Error(`SEPOLIA_RPC_URL returned chain ${chainId}; expected 11155111`);
    }

    const codeTargets = {
      registry: addresses.registry,
      token: addresses.token,
      goals: addresses.goals,
      vaultFactory: addresses.vaultFactory,
      childAccountFactory: addresses.childAccountFactory,
      entryPoint: entryPoint08Address,
      usdc: addresses.usdc,
      weth: addresses.weth,
      aqua: addresses.aqua,
      swapVm: addresses.swapVm,
    };
    const code = await Promise.all(
      Object.entries(codeTargets).map(
        async ([name, address]) => [name, await this.client.getCode({ address })] as const,
      ),
    );
    for (const [name, bytecode] of code) {
      if (!bytecode || bytecode === '0x') throw new Error(`${name} has no deployed bytecode`);
    }
    const codeByName = Object.fromEntries(code);
    const configuredRuntimeCodeHashes = {
      aqua: this.settings.AQUA_RUNTIME_CODE_HASH,
      swapVm: this.settings.AQUA_SWAP_VM_RUNTIME_CODE_HASH,
      registry: this.settings.STAR_REGISTRY_RUNTIME_CODE_HASH,
      token: this.settings.STAR_TOKEN_RUNTIME_CODE_HASH,
      goals: this.settings.STAR_GOALS_RUNTIME_CODE_HASH,
      vaultFactory: this.settings.STAR_FAMILY_VAULT_FACTORY_RUNTIME_CODE_HASH,
      childAccountFactory: this.settings.STAR_CHILD_ACCOUNT_FACTORY_RUNTIME_CODE_HASH,
    };
    for (const [name, expectedHash] of Object.entries(configuredRuntimeCodeHashes)) {
      if (!expectedHash)
        throw new Error(
          `${name} runtime code hash is required; load the Sepolia deployment manifest`,
        );
      const bytecode = codeByName[name];
      if (!bytecode || keccak256(bytecode).toLowerCase() !== expectedHash) {
        throw new Error(`${name} runtime bytecode does not match the deployment manifest`);
      }
    }

    const [childFactoryRegistry, childFactoryGoals] = await Promise.all([
      this.client.readContract({
        address: addresses.childAccountFactory,
        abi: childAccountFactoryAbi,
        functionName: 'registry',
      }),
      this.client.readContract({
        address: addresses.childAccountFactory,
        abi: childAccountFactoryAbi,
        functionName: 'goals',
      }),
    ]);
    assertAddress('child account factory registry', childFactoryRegistry, addresses.registry);
    assertAddress('child account factory goals', childFactoryGoals, addresses.goals);
    assertAddress(
      'child account vault factory',
      await this.client.readContract({
        address: addresses.childAccountFactory,
        abi: childAccountFactoryAbi,
        functionName: 'vaultFactory',
      }),
      addresses.vaultFactory,
    );
    const rpId = await this.client.readContract({
      address: addresses.childAccountFactory,
      abi: childAccountFactoryAbi,
      functionName: 'rpId',
    });
    if (rpId !== this.settings.CHILD_ACCOUNT_RP_ID)
      throw new Error('Child account RP ID does not match the deployment');

    const [
      factoryRegistry,
      factoryStar,
      factoryUsdc,
      factoryWeth,
      factoryAqua,
      factorySwapVm,
      emergencyAdmin,
      goalsRegistry,
      goalsStar,
      starDecimals,
      usdcDecimals,
      wethDecimals,
      swapVmAqua,
      swapVmWeth,
      factoryHasVaultFactoryRole,
      goalsIsBurner,
      factoryIsNotMinter,
      factoryIsNotBurner,
      goalsIsNotMinter,
    ] = await Promise.all([
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'registry',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'star',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'usdc',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'weth',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'aqua',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'swapVmApp',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'emergencyAdmin',
      }),
      this.client.readContract({
        address: addresses.goals,
        abi: starGoalsAbi,
        functionName: 'registry',
      }),
      this.client.readContract({
        address: addresses.goals,
        abi: starGoalsAbi,
        functionName: 'star',
      }),
      this.client.readContract({
        address: addresses.token,
        abi: starTokenAbi,
        functionName: 'decimals',
      }),
      this.client.readContract({
        address: addresses.usdc,
        abi: erc20MetadataAbi,
        functionName: 'decimals',
      }),
      this.client.readContract({
        address: addresses.weth,
        abi: erc20MetadataAbi,
        functionName: 'decimals',
      }),
      this.client.readContract({ address: addresses.swapVm, abi: swapVmAbi, functionName: 'AQUA' }),
      this.client.readContract({ address: addresses.swapVm, abi: swapVmAbi, functionName: 'WETH' }),
      this.client.readContract({
        address: addresses.token,
        abi: starTokenAbi,
        functionName: 'hasRole',
        args: [vaultFactoryRole, addresses.vaultFactory],
      }),
      this.client.readContract({
        address: addresses.token,
        abi: starTokenAbi,
        functionName: 'hasRole',
        args: [burnerRole, addresses.goals],
      }),
      this.client.readContract({
        address: addresses.token,
        abi: starTokenAbi,
        functionName: 'hasRole',
        args: [minterRole, addresses.vaultFactory],
      }),
      this.client.readContract({
        address: addresses.token,
        abi: starTokenAbi,
        functionName: 'hasRole',
        args: [burnerRole, addresses.vaultFactory],
      }),
      this.client.readContract({
        address: addresses.token,
        abi: starTokenAbi,
        functionName: 'hasRole',
        args: [minterRole, addresses.goals],
      }),
    ]);

    assertAddress('factory registry', factoryRegistry, addresses.registry);
    assertAddress('factory STAR', factoryStar, addresses.token);
    assertAddress('factory USDC', factoryUsdc, addresses.usdc);
    assertAddress('factory WETH', factoryWeth, addresses.weth);
    assertAddress('factory Aqua', factoryAqua, addresses.aqua);
    assertAddress('factory SwapVM', factorySwapVm, addresses.swapVm);
    assertAddress('goals registry', goalsRegistry, addresses.registry);
    assertAddress('goals STAR', goalsStar, addresses.token);
    assertAddress('SwapVM Aqua', swapVmAqua, addresses.aqua);
    assertAddress('SwapVM WETH', swapVmWeth, addresses.weth);
    assertNumber('STAR decimals', starDecimals, 0);
    assertNumber('USDC decimals', usdcDecimals, 6);
    assertNumber('WETH decimals', wethDecimals, 18);
    if (typeof emergencyAdmin !== 'string' || getAddress(emergencyAdmin) === zeroAddress) {
      throw new Error('Factory emergency admin is not configured');
    }

    const [
      factoryEthUsdFeed,
      factoryUsdcUsdFeed,
      factoryEthUsdMaxAge,
      factoryUsdcUsdMaxAge,
      factoryMaxPriceDeviation,
      factoryMaxLifetime,
      factoryMaxPositionUsdc,
      factoryMaxPositionWeth,
    ] = await Promise.all([
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'ethUsdFeed',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'usdcUsdFeed',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'ethUsdMaxAgeSeconds',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'usdcUsdMaxAgeSeconds',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'maxStrategyPriceDeviationBps',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'maxStrategyLifetimeSeconds',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'maxPositionUsdc',
      }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'maxPositionWeth',
      }),
    ]);
    if (
      !this.settings.CHAINLINK_ETH_USD_FEED_ADDRESS ||
      !this.settings.CHAINLINK_USDC_USD_FEED_ADDRESS
    ) {
      throw new Error('Chainlink safety feeds are not configured');
    }
    assertAddress('factory ETH/USD feed', factoryEthUsdFeed, pinnedSepoliaFeeds.ethUsd);
    assertAddress('factory USDC/USD feed', factoryUsdcUsdFeed, pinnedSepoliaFeeds.usdcUsd);
    assertAddress(
      'configured ETH/USD feed',
      this.settings.CHAINLINK_ETH_USD_FEED_ADDRESS,
      pinnedSepoliaFeeds.ethUsd,
    );
    assertAddress(
      'configured USDC/USD feed',
      this.settings.CHAINLINK_USDC_USD_FEED_ADDRESS,
      pinnedSepoliaFeeds.usdcUsd,
    );
    assertNumber(
      'factory ETH/USD maximum age',
      factoryEthUsdMaxAge,
      this.settings.CHAINLINK_ETH_USD_MAX_AGE_SECONDS,
    );
    assertNumber(
      'factory USDC/USD maximum age',
      factoryUsdcUsdMaxAge,
      this.settings.CHAINLINK_USDC_USD_MAX_AGE_SECONDS,
    );
    assertNumber(
      'factory maximum price deviation',
      factoryMaxPriceDeviation,
      this.settings.AQUA_MAX_PRICE_DEVIATION_BPS,
    );
    assertNumber(
      'factory maximum strategy lifetime',
      factoryMaxLifetime,
      this.settings.AQUA_MAX_STRATEGY_LIFETIME_SECONDS,
    );
    assertBigInt(
      'factory maximum position USDC',
      factoryMaxPositionUsdc,
      this.settings.AQUA_MAX_POSITION_USDC_UNITS,
    );
    assertBigInt(
      'factory maximum position WETH',
      factoryMaxPositionWeth,
      this.settings.AQUA_MAX_POSITION_WETH_UNITS,
    );
    if (factoryHasVaultFactoryRole !== true || goalsIsBurner !== true) {
      throw new Error('Required factory/minter-administration or goals/burner role is missing');
    }
    if (
      factoryIsNotMinter !== false ||
      factoryIsNotBurner !== false ||
      goalsIsNotMinter !== false
    ) {
      throw new Error('STAR roles exceed the intended factory/goals authority');
    }

    const checkedBlock = await this.client.getBlockNumber();
    return {
      chainId: 11155111,
      checkedBlock: checkedBlock.toString(),
      addresses,
      roles: { factoryCanRegisterVaultMinters: true, goalsIsBurner: true },
      factory: {
        emergencyAdmin: getAddress(emergencyAdmin),
        ethUsdFeed: getAddress(factoryEthUsdFeed),
        usdcUsdFeed: getAddress(factoryUsdcUsdFeed),
        maxStrategyPriceDeviationBps: factoryMaxPriceDeviation,
        maxStrategyLifetimeSeconds: factoryMaxLifetime,
        maxPositionUsdc: factoryMaxPositionUsdc.toString(),
        maxPositionWeth: factoryMaxPositionWeth.toString(),
      },
    };
  }

  private async verifyFamilyVault(
    addresses: ProtocolAddresses,
    familyId: bigint,
    vault: Address,
  ): Promise<FamilyVaultResolution> {
    const code = await this.client.getCode({ address: vault });
    if (!code || code === '0x') throw new Error(`Family vault ${vault} has no deployed bytecode`);

    const [
      registeredFamilyId,
      reverseFamilyId,
      vaultRegistry,
      vaultStar,
      vaultUsdc,
      vaultWeth,
      vaultAqua,
      vaultSwapVm,
      usdcPerStar,
      maxStrategyFee,
      emergencyAdmin,
      aquaPaused,
      vaultIsMinter,
      vaultIsNotBurner,
      usdcAquaAllowance,
      wethAquaAllowance,
      vaultEthUsdFeed,
      vaultUsdcUsdFeed,
      vaultEthUsdMaxAge,
      vaultUsdcUsdMaxAge,
      vaultMaxPriceDeviation,
      vaultMaxLifetime,
      vaultMaxPositionUsdc,
      vaultMaxPositionWeth,
      familyAccount,
    ] = await Promise.all([
      this.client.readContract({ address: vault, abi: familyVaultAbi, functionName: 'familyId' }),
      this.client.readContract({
        address: addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'familyIdByVault',
        args: [vault],
      }),
      this.client.readContract({ address: vault, abi: familyVaultAbi, functionName: 'registry' }),
      this.client.readContract({ address: vault, abi: familyVaultAbi, functionName: 'star' }),
      this.client.readContract({ address: vault, abi: familyVaultAbi, functionName: 'usdc' }),
      this.client.readContract({ address: vault, abi: familyVaultAbi, functionName: 'weth' }),
      this.client.readContract({ address: vault, abi: familyVaultAbi, functionName: 'aqua' }),
      this.client.readContract({ address: vault, abi: familyVaultAbi, functionName: 'swapVmApp' }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'USDC_PER_STAR',
      }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'MAX_STRATEGY_FEE_BPS',
      }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'emergencyAdmin',
      }),
      this.client.readContract({ address: vault, abi: familyVaultAbi, functionName: 'aquaPaused' }),
      this.client.readContract({
        address: addresses.token,
        abi: starTokenAbi,
        functionName: 'hasRole',
        args: [minterRole, vault],
      }),
      this.client.readContract({
        address: addresses.token,
        abi: starTokenAbi,
        functionName: 'hasRole',
        args: [burnerRole, vault],
      }),
      this.client.readContract({
        address: addresses.usdc,
        abi: erc20MetadataAbi,
        functionName: 'allowance',
        args: [vault, addresses.aqua],
      }),
      this.client.readContract({
        address: addresses.weth,
        abi: erc20MetadataAbi,
        functionName: 'allowance',
        args: [vault, addresses.aqua],
      }),
      this.client.readContract({ address: vault, abi: familyVaultAbi, functionName: 'ethUsdFeed' }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'usdcUsdFeed',
      }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'ethUsdMaxAgeSeconds',
      }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'usdcUsdMaxAgeSeconds',
      }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'maxStrategyPriceDeviationBps',
      }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'maxStrategyLifetimeSeconds',
      }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'maxPositionUsdc',
      }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'maxPositionWeth',
      }),
      this.client.readContract({
        address: vault,
        abi: familyVaultAbi,
        functionName: 'getFamilyAccount',
      }),
    ]);

    assertBigInt('vault family ID', registeredFamilyId, familyId);
    assertBigInt('factory reverse family ID', reverseFamilyId, familyId);
    assertAddress('vault registry', vaultRegistry, addresses.registry);
    assertAddress('vault STAR', vaultStar, addresses.token);
    assertAddress('vault USDC', vaultUsdc, addresses.usdc);
    assertAddress('vault WETH', vaultWeth, addresses.weth);
    assertAddress('vault Aqua', vaultAqua, addresses.aqua);
    assertAddress('vault SwapVM', vaultSwapVm, addresses.swapVm);
    assertBigInt('USDC per STAR', usdcPerStar, 1_000_000n);
    assertNumber('maximum strategy fee', maxStrategyFee, 1_000);
    if (
      !this.settings.CHAINLINK_ETH_USD_FEED_ADDRESS ||
      !this.settings.CHAINLINK_USDC_USD_FEED_ADDRESS
    ) {
      throw new Error('Chainlink safety feeds are not configured');
    }
    assertAddress('vault ETH/USD feed', vaultEthUsdFeed, pinnedSepoliaFeeds.ethUsd);
    assertAddress('vault USDC/USD feed', vaultUsdcUsdFeed, pinnedSepoliaFeeds.usdcUsd);
    assertNumber(
      'vault ETH/USD maximum age',
      vaultEthUsdMaxAge,
      this.settings.CHAINLINK_ETH_USD_MAX_AGE_SECONDS,
    );
    assertNumber(
      'vault USDC/USD maximum age',
      vaultUsdcUsdMaxAge,
      this.settings.CHAINLINK_USDC_USD_MAX_AGE_SECONDS,
    );
    assertNumber(
      'vault maximum price deviation',
      vaultMaxPriceDeviation,
      this.settings.AQUA_MAX_PRICE_DEVIATION_BPS,
    );
    assertNumber(
      'vault maximum strategy lifetime',
      vaultMaxLifetime,
      this.settings.AQUA_MAX_STRATEGY_LIFETIME_SECONDS,
    );
    assertBigInt(
      'vault maximum position USDC',
      vaultMaxPositionUsdc,
      this.settings.AQUA_MAX_POSITION_USDC_UNITS,
    );
    assertBigInt(
      'vault maximum position WETH',
      vaultMaxPositionWeth,
      this.settings.AQUA_MAX_POSITION_WETH_UNITS,
    );
    if (typeof emergencyAdmin !== 'string' || getAddress(emergencyAdmin) === zeroAddress) {
      throw new Error('Vault emergency admin is not configured');
    }
    if (typeof aquaPaused !== 'boolean') throw new Error('Invalid Aqua pause state');
    if (
      typeof familyAccount !== 'object' ||
      familyAccount === null ||
      !('positionActive' in familyAccount) ||
      typeof familyAccount.positionActive !== 'boolean'
    ) {
      throw new Error('Family vault returned an invalid Aqua position state');
    }
    if (vaultIsMinter !== true || vaultIsNotBurner !== false) {
      throw new Error('Family vault STAR roles do not match the intended authority');
    }
    assertVaultAquaAllowance('vault USDC Aqua allowance', usdcAquaAllowance, aquaPaused);
    assertVaultAquaAllowance('vault WETH Aqua allowance', wethAquaAllowance, aquaPaused);

    return {
      familyId,
      vault,
      emergencyAdmin: getAddress(emergencyAdmin),
      paused: aquaPaused,
      positionActive: familyAccount.positionActive,
    };
  }
}

/** Allowances are spendable balances, not immutable vault configuration. */
export function assertVaultAquaAllowance(name: string, actual: unknown, paused: boolean): void {
  if (typeof actual !== 'bigint' || actual < 0n || actual > maxUint256) {
    throw new Error(`${name} is not a valid uint256 allowance`);
  }
  // A paused vault must have revoked both approvals. When unpaused, even an
  // exhausted allowance must not block unrelated Star requests or docking.
  // Aqua/token transferFrom and the funding flow's simulation enforce enough
  // allowance for actual token spending; some tokens decrement max approvals.
  if (paused) assertBigInt(name, actual, 0n);
}

function assertAddress(name: string, actual: unknown, expected: Address): void {
  if (typeof actual !== 'string' || getAddress(actual) !== getAddress(expected)) {
    throw new Error(`${name} is ${String(actual)}; expected ${expected}`);
  }
}

function assertNumber(name: string, actual: unknown, expected: number): void {
  if (typeof actual !== 'number' || actual !== expected) {
    throw new Error(`${name} is ${String(actual)}; expected ${expected}`);
  }
}

function assertBigInt(name: string, actual: unknown, expected: bigint): void {
  if (typeof actual !== 'bigint' || actual !== expected) {
    throw new Error(`${name} is ${String(actual)}; expected ${expected}`);
  }
}
