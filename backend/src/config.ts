import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { getAddress, isAddress, type Address } from 'viem';
import { normalize } from 'viem/ens';
import { z } from 'zod';
import { sepoliaDeployment } from '@star/contracts/network';

const optionalAddress = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z
    .string()
    .refine((value) => isAddress(value) && !/^0x0{40}$/i.test(value), 'Invalid EVM address')
    .transform((value) => getAddress(value))
    .optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.string().url().optional(),
);

const optionalBytes32 = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid bytes32 value')
    .transform((value) => value.toLowerCase() as `0x${string}`)
    .optional(),
);

const ensName = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        normalize(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid ENS name' },
  )
  .transform((value) => normalize(value));

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.string().default('info'),
    TRUST_PROXY: booleanString,
    CHAIN_ID: z.coerce
      .number()
      .refine((value) => value === 11155111, 'CHAIN_ID must be Ethereum Sepolia 11155111')
      .default(11155111),
    SEPOLIA_RPC_URL: z.string().url().default(sepoliaDeployment.rpcUrl),
    ENS_ROOT_REGISTRY_ADDRESS: optionalAddress.default(sepoliaDeployment.ensRootRegistry),
    ENS_ETH_REGISTRY_ADDRESS: optionalAddress.default(sepoliaDeployment.ensEthRegistry),
    ENS_UNIVERSAL_RESOLVER_ADDRESS: optionalAddress.default(sepoliaDeployment.ensUniversalResolver),
    ENS_VERIFIABLE_FACTORY_ADDRESS: optionalAddress.default(sepoliaDeployment.ensVerifiableFactory),
    ENS_USER_REGISTRY_IMPLEMENTATION_ADDRESS: optionalAddress.default(
      sepoliaDeployment.ensUserRegistryImplementation,
    ),
    ENS_PERMISSIONED_RESOLVER_IMPLEMENTATION_ADDRESS: optionalAddress.default(
      sepoliaDeployment.ensPermissionedResolverImplementation,
    ),
    ENS_PARENT_NAME: ensName.default('starwallet.eth'),
    STAR_ENS_REGISTRAR_ADDRESS: optionalAddress,
    STAR_ENS_REGISTRAR_RUNTIME_CODE_HASH: optionalBytes32,
    DEPLOYMENT_FILE: z.string().optional(),
    STAR_SUBGRAPH_URL: optionalUrl,
    STAR_SUBGRAPH_DEPLOYMENT_ID: z.string().trim().min(1).optional(),
    STAR_SUBGRAPH_MAX_BLOCK_LAG: z.coerce.number().int().min(1).max(10_000).default(20),
    STAR_REGISTRY_ADDRESS: optionalAddress,
    STAR_TOKEN_ADDRESS: optionalAddress,
    STAR_GOALS_ADDRESS: optionalAddress,
    STAR_FAMILY_VAULT_FACTORY_ADDRESS: optionalAddress,
    STAR_CHILD_ACCOUNT_FACTORY_ADDRESS: optionalAddress,
    USDC_ADDRESS: optionalAddress.default(sepoliaDeployment.usdc),
    WETH_ADDRESS: optionalAddress.default(sepoliaDeployment.weth),
    AQUA_ADDRESS: optionalAddress,
    AQUA_SWAP_VM_ADDRESS: optionalAddress,
    STAR_REGISTRY_RUNTIME_CODE_HASH: optionalBytes32,
    STAR_TOKEN_RUNTIME_CODE_HASH: optionalBytes32,
    STAR_GOALS_RUNTIME_CODE_HASH: optionalBytes32,
    STAR_FAMILY_VAULT_FACTORY_RUNTIME_CODE_HASH: optionalBytes32,
    STAR_CHILD_ACCOUNT_FACTORY_RUNTIME_CODE_HASH: optionalBytes32,
    AQUA_RUNTIME_CODE_HASH: optionalBytes32,
    AQUA_SWAP_VM_RUNTIME_CODE_HASH: optionalBytes32,
    CHILD_ACCOUNT_RP_ID: z
      .string()
      .max(253)
      .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)
      .default('localhost'),
    CHILD_BUNDLER_RPC_URL: optionalUrl,
    CHILD_PAYMASTER_RPC_URL: optionalUrl,
    CHILD_PAYMASTER_POLICY_ID: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid paymaster policy ID')
      .optional(),
    // Operational abuse counters only; chain/subgraph remain the family-state authority.
    CHILD_SECURITY_DB_PATH: z.string().trim().min(1).optional(),
    CHILD_RPC_PER_MINUTE: z.coerce.number().int().min(10).max(600).default(60),
    CHILD_RPC_PER_HOUR: z.coerce.number().int().min(10).max(10_000).default(360),
    CHILD_SPONSORED_OPERATIONS_PER_DAY: z.coerce.number().int().min(1).max(1_000).default(60),
    CHILD_GLOBAL_SPONSORED_OPERATIONS_PER_DAY: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(600),
    CHILD_SPONSOR_BUDGET_WEI_PER_DAY: z.coerce
      .bigint()
      .positive()
      .max(10n ** 18n)
      .default(50_000_000_000_000_000n),
    CHILD_GLOBAL_SPONSOR_BUDGET_WEI_PER_DAY: z.coerce
      .bigint()
      .positive()
      .max(10n ** 19n)
      .default(500_000_000_000_000_000n),
    CHAINLINK_ETH_USD_FEED_ADDRESS: optionalAddress.default(sepoliaDeployment.ethUsdFeed),
    CHAINLINK_USDC_USD_FEED_ADDRESS: optionalAddress.default(sepoliaDeployment.usdcUsdFeed),
    CHAINLINK_ETH_USD_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(3_600),
    CHAINLINK_USDC_USD_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(90_000),
    AQUA_DEFAULT_PRICE_BAND_BPS: z.coerce.number().int().min(25).max(2_500).default(500),
    AQUA_MAX_PRICE_DEVIATION_BPS: z.coerce.number().int().min(25).max(2_500).default(1_000),
    AQUA_DEFAULT_STRATEGY_LIFETIME_SECONDS: z.coerce
      .number()
      .int()
      .min(120)
      .max(86_400)
      .default(900),
    AQUA_MAX_STRATEGY_LIFETIME_SECONDS: z.coerce.number().int().min(120).max(86_400).default(1_800),
    AQUA_MAX_POSITION_USDC_UNITS: z.coerce.bigint().positive().default(1_000_000_000n),
    AQUA_MAX_POSITION_WETH_UNITS: z.coerce.bigint().positive().default(500_000_000_000_000_000n),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== 'test' && value.CHILD_SECURITY_DB_PATH === ':memory:') {
      context.addIssue({
        code: 'custom',
        path: ['CHILD_SECURITY_DB_PATH'],
        message: 'Security counters must persist outside tests',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.CHILD_PAYMASTER_POLICY_ID &&
      (!value.CHILD_SECURITY_DB_PATH || !isAbsolute(value.CHILD_SECURITY_DB_PATH))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['CHILD_SECURITY_DB_PATH'],
        message: 'Production sponsorship requires an absolute path on a persistent local volume',
      });
    }
    if (value.CHILD_SPONSOR_BUDGET_WEI_PER_DAY > value.CHILD_GLOBAL_SPONSOR_BUDGET_WEI_PER_DAY) {
      context.addIssue({
        code: 'custom',
        path: ['CHILD_SPONSOR_BUDGET_WEI_PER_DAY'],
        message: 'Account sponsorship budget cannot exceed the global budget',
      });
    }
    if (value.AQUA_DEFAULT_PRICE_BAND_BPS > value.AQUA_MAX_PRICE_DEVIATION_BPS) {
      context.addIssue({
        code: 'custom',
        path: ['AQUA_DEFAULT_PRICE_BAND_BPS'],
        message: 'Default Aqua price band cannot exceed the on-chain maximum deviation',
      });
    }
    if (value.AQUA_DEFAULT_STRATEGY_LIFETIME_SECONDS > value.AQUA_MAX_STRATEGY_LIFETIME_SECONDS) {
      context.addIssue({
        code: 'custom',
        path: ['AQUA_DEFAULT_STRATEGY_LIFETIME_SECONDS'],
        message: 'Default Aqua strategy lifetime cannot exceed the on-chain maximum lifetime',
      });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  for (const name of [
    'ENS_REGISTRY_ADDRESS',
    'ENS_NAME_WRAPPER_ADDRESS',
    'ENS_PUBLIC_RESOLVER_ADDRESS',
    'ENS_PARENT_WRAPPED',
  ]) {
    if (environment[name]?.trim())
      throw new Error(`${name} is an obsolete ENSv1 setting; use the Sepolia ENSv2 example`);
  }
  return schema.parse(withDeploymentConfiguration(environment));
}

function withDeploymentConfiguration(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const requestedPath = environment.DEPLOYMENT_FILE?.trim();
  const defaultPath = resolve(
    import.meta.dirname,
    '..',
    '..',
    'contracts',
    'deployments',
    'sepolia.json',
  );
  const deploymentPath = requestedPath ? resolve(requestedPath) : defaultPath;
  const merged: NodeJS.ProcessEnv = {};

  if (existsSync(deploymentPath)) {
    const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8')) as {
      chainId?: number;
      network?: string;
      configuration?: Record<string, string>;
    };
    if (deployment.chainId !== 11155111 || deployment.network !== 'sepolia') {
      throw new Error(
        `Deployment manifest chain is ${deployment.chainId}; expected Sepolia 11155111`,
      );
    }
    Object.assign(merged, deployment.configuration ?? {});
    merged.DEPLOYMENT_FILE = deploymentPath;
  } else if (requestedPath) {
    throw new Error(`DEPLOYMENT_FILE does not exist: ${deploymentPath}`);
  }

  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && value.trim() !== '') merged[name] = value.trim();
  }
  return merged;
}

export type ProtocolAddresses = {
  registry: Address;
  token: Address;
  goals: Address;
  vaultFactory: Address;
  childAccountFactory: Address;
  usdc: Address;
  weth: Address;
  aqua: Address;
  swapVm: Address;
};

export function protocolAddresses(settings: Config): ProtocolAddresses {
  const entries = [
    ['STAR_REGISTRY_ADDRESS', settings.STAR_REGISTRY_ADDRESS],
    ['STAR_TOKEN_ADDRESS', settings.STAR_TOKEN_ADDRESS],
    ['STAR_GOALS_ADDRESS', settings.STAR_GOALS_ADDRESS],
    ['STAR_FAMILY_VAULT_FACTORY_ADDRESS', settings.STAR_FAMILY_VAULT_FACTORY_ADDRESS],
    ['STAR_CHILD_ACCOUNT_FACTORY_ADDRESS', settings.STAR_CHILD_ACCOUNT_FACTORY_ADDRESS],
    ['USDC_ADDRESS', settings.USDC_ADDRESS],
    ['WETH_ADDRESS', settings.WETH_ADDRESS],
    ['AQUA_ADDRESS', settings.AQUA_ADDRESS],
    ['AQUA_SWAP_VM_ADDRESS', settings.AQUA_SWAP_VM_ADDRESS],
  ] as const;
  const missing = entries.filter(([, value]) => !value).map(([name]) => name);
  if (
    !settings.STAR_REGISTRY_ADDRESS ||
    !settings.STAR_TOKEN_ADDRESS ||
    !settings.STAR_GOALS_ADDRESS ||
    !settings.STAR_FAMILY_VAULT_FACTORY_ADDRESS ||
    !settings.STAR_CHILD_ACCOUNT_FACTORY_ADDRESS ||
    !settings.USDC_ADDRESS ||
    !settings.WETH_ADDRESS ||
    !settings.AQUA_ADDRESS ||
    !settings.AQUA_SWAP_VM_ADDRESS
  ) {
    throw new Error(`Protocol is not configured: ${missing.join(', ')}`);
  }
  return {
    registry: settings.STAR_REGISTRY_ADDRESS,
    token: settings.STAR_TOKEN_ADDRESS,
    goals: settings.STAR_GOALS_ADDRESS,
    vaultFactory: settings.STAR_FAMILY_VAULT_FACTORY_ADDRESS,
    childAccountFactory: settings.STAR_CHILD_ACCOUNT_FACTORY_ADDRESS,
    usdc: settings.USDC_ADDRESS,
    weth: settings.WETH_ADDRESS,
    aqua: settings.AQUA_ADDRESS,
    swapVm: settings.AQUA_SWAP_VM_ADDRESS,
  };
}
