import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import test from 'node:test';
import { getAddress } from 'viem';
import { sepoliaDeployment } from '@star/contracts/network';
import { familyVaultAbi, familyVaultFactoryAbi } from '@star/contracts/abi';
import { loadConfig } from '../src/config.js';

const example = (path: string) => parseEnv(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('deployment example contains only required inputs and no secrets', () => {
  const env = example('../../contracts/.env.example');
  assert.deepEqual(
    Object.keys(env).sort(),
    [
      'SEPOLIA_RPC_URL',
      'DEPLOYER_PRIVATE_KEY',
      'CHILD_ACCOUNT_RP_ID',
      'CHAINLINK_ETH_USD_FEED_ADDRESS',
      'CHAINLINK_USDC_USD_FEED_ADDRESS',
      'CHAINLINK_ETH_USD_MAX_AGE_SECONDS',
      'CHAINLINK_USDC_USD_MAX_AGE_SECONDS',
      'AQUA_MAX_PRICE_DEVIATION_BPS',
      'AQUA_MAX_STRATEGY_LIFETIME_SECONDS',
      'AQUA_MAX_POSITION_USDC_UNITS',
      'AQUA_MAX_POSITION_WETH_UNITS',
    ].sort(),
  );
  assert.ok(env.DEPLOYER_PRIVATE_KEY === '', 'The deployer key example must be blank');
  assert.ok(!('TOKEN_ADMIN_ADDRESS' in env), 'Token admin is derived from the deployer');
  assert.ok(!('EMERGENCY_ADMIN_ADDRESS' in env), 'Emergency admin is derived from the deployer');
});

test('all environment examples agree on Sepolia and never fabricate deployment addresses', () => {
  const backend = example('../.env.example');
  const contracts = example('../../contracts/.env.example');
  const frontend = example('../../frontend/.env.example');
  const subgraph = example('../../contracts/subgraph/.env.example');
  assert.equal(loadConfig(backend).CHAIN_ID, sepoliaDeployment.chainId);
  for (const env of [backend, contracts]) {
    assert.equal(env.SEPOLIA_RPC_URL, sepoliaDeployment.rpcUrl);
    for (const [name, expected] of Object.entries({
      CHAINLINK_ETH_USD_FEED_ADDRESS: sepoliaDeployment.ethUsdFeed,
      CHAINLINK_USDC_USD_FEED_ADDRESS: sepoliaDeployment.usdcUsdFeed,
    }))
      assert.equal(getAddress(env[name]!), getAddress(expected));
    assert.equal(env.AQUA_RUNTIME_CODE_HASH ?? '', '');
    assert.equal(env.AQUA_SWAP_VM_RUNTIME_CODE_HASH ?? '', '');
  }
  assert.equal(getAddress(backend.USDC_ADDRESS!), getAddress(sepoliaDeployment.usdc));
  assert.equal(getAddress(backend.WETH_ADDRESS!), getAddress(sepoliaDeployment.weth));
  for (const [name, expected] of Object.entries({
    ENS_ROOT_REGISTRY_ADDRESS: sepoliaDeployment.ensRootRegistry,
    ENS_ETH_REGISTRY_ADDRESS: sepoliaDeployment.ensEthRegistry,
    ENS_UNIVERSAL_RESOLVER_ADDRESS: sepoliaDeployment.ensUniversalResolver,
    ENS_VERIFIABLE_FACTORY_ADDRESS: sepoliaDeployment.ensVerifiableFactory,
    ENS_USER_REGISTRY_IMPLEMENTATION_ADDRESS: sepoliaDeployment.ensUserRegistryImplementation,
    ENS_PERMISSIONED_RESOLVER_IMPLEMENTATION_ADDRESS:
      sepoliaDeployment.ensPermissionedResolverImplementation,
  }))
    assert.equal(getAddress(backend[name]!), getAddress(expected));
  for (const env of [backend, contracts, subgraph]) {
    assert.equal(env.AQUA_ADDRESS ?? '', '');
    assert.equal(env.AQUA_SWAP_VM_ADDRESS ?? '', '');
  }
  assert.equal(frontend.NEXT_PUBLIC_SEPOLIA_RPC_URL, sepoliaDeployment.rpcUrl);
  assert.equal(
    frontend.NEXT_PUBLIC_ENS_PARENT_NAME,
    undefined,
    'ENS namespace comes from the backend',
  );
  assert.ok(BigInt(sepoliaDeployment.usdc) < BigInt(sepoliaDeployment.weth));
});

test('generated L1 constructor ABIs retain price safety but require no sequencer', () => {
  for (const abi of [familyVaultAbi, familyVaultFactoryAbi]) {
    const constructor = abi.find((entry) => entry.type === 'constructor');
    assert.ok(constructor);
    const safety = constructor.inputs.find((input) => input.name === 'safety');
    assert.ok(safety && 'components' in safety);
    assert.deepEqual(
      safety.components.map((field) => field.name),
      [
        'ethUsdFeed',
        'usdcUsdFeed',
        'ethUsdMaxAgeSeconds',
        'usdcUsdMaxAgeSeconds',
        'maxStrategyPriceDeviationBps',
        'maxStrategyLifetimeSeconds',
        'maxPositionUsdc',
        'maxPositionWeth',
      ],
    );
  }
});
