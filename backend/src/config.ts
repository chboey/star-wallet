import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAddress, isAddress, type Address } from 'viem';
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

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
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
  DEPLOYMENT_FILE: z.string().optional(),
  STAR_REGISTRY_ADDRESS: optionalAddress,
  STAR_TOKEN_ADDRESS: optionalAddress,
  STAR_GOALS_ADDRESS: optionalAddress,
  STAR_FAMILY_VAULT_FACTORY_ADDRESS: optionalAddress,
  STAR_CHILD_ACCOUNT_FACTORY_ADDRESS: optionalAddress,
  USDC_ADDRESS: optionalAddress.default(sepoliaDeployment.usdc),
  WETH_ADDRESS: optionalAddress.default(sepoliaDeployment.weth),
  AQUA_ADDRESS: optionalAddress,
  AQUA_SWAP_VM_ADDRESS: optionalAddress,
});

export type Config = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
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
