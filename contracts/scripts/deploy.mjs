import { existsSync } from "node:fs";
import { sepoliaDeployment } from "../network.js";
import {
  readManifest,
  mergeConfiguration,
  assertCompiledRuntime,
  isDryRun,
} from "./deployment-utils.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const root = resolve(import.meta.dirname, "..");
const dryRun = isDryRun(process.env.DRY_RUN);
const deploymentPath = resolve(root, "deployments/sepolia.json");
if (existsSync(deploymentPath))
  throw new Error(
    `${deploymentPath} already exists; preserve/reuse the deployment`,
  );
const aquaDeployment = await readManifest(
  resolve(
    root,
    process.env.AQUA_DEPLOYMENT_FILE?.trim() || "deployments/sepolia-aqua.json",
  ),
);
const settings = mergeConfiguration(aquaDeployment, process.env);
const required = [
  "SEPOLIA_RPC_URL",
  "DEPLOYER_PRIVATE_KEY",
  "USDC_ADDRESS",
  "WETH_ADDRESS",
  "AQUA_ADDRESS",
  "AQUA_SWAP_VM_ADDRESS",
  "AQUA_RUNTIME_CODE_HASH",
  "AQUA_SWAP_VM_RUNTIME_CODE_HASH",
  "CHAINLINK_ETH_USD_FEED_ADDRESS",
  "CHAINLINK_USDC_USD_FEED_ADDRESS",
  "CHAINLINK_ETH_USD_MAX_AGE_SECONDS",
  "CHAINLINK_USDC_USD_MAX_AGE_SECONDS",
  "AQUA_MAX_PRICE_DEVIATION_BPS",
  "AQUA_MAX_STRATEGY_LIFETIME_SECONDS",
  "AQUA_MAX_POSITION_USDC_UNITS",
  "AQUA_MAX_POSITION_WETH_UNITS",
];
for (const name of required) {
  if (!settings[name]) throw new Error(`${name} is required`);
}

const childAccountRpId = settings.CHILD_ACCOUNT_RP_ID?.trim();
const ensParentName = settings.ENS_PARENT_NAME?.trim() || "starwallet.eth";
if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]\.eth$/.test(ensParentName))
  throw new Error(
    "ENS_PARENT_NAME must be a canonical ASCII second-level .eth name",
  );
const ensRegistrarArgs = [
  sepoliaDeployment.ensEthRegistry,
  ensParentName.slice(0, -4),
  sepoliaDeployment.ensVerifiableFactory,
  sepoliaDeployment.ensUserRegistryImplementation,
  sepoliaDeployment.ensPermissionedResolverImplementation,
];
if (
  !childAccountRpId ||
  childAccountRpId.length > 253 ||
  !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(childAccountRpId)
) {
  throw new Error(
    "CHILD_ACCOUNT_RP_ID must be the app hostname (localhost for local development), without scheme or port",
  );
}

const artifact = async (name) =>
  JSON.parse(await readFile(resolve(root, `artifacts/${name}.json`), "utf8"));
const [registry, token, goals, vault, factory, childFactory, ensRegistrar] =
  await Promise.all([
    artifact("StarRegistry"),
    artifact("StarToken"),
    artifact("StarGoals"),
    artifact("StarFamilyVault"),
    artifact("StarFamilyVaultFactory"),
    artifact("StarChildAccountFactory"),
    artifact("StarEnsRegistrar"),
  ]);
for (const contract of [
  registry,
  token,
  goals,
  vault,
  factory,
  childFactory,
  ensRegistrar,
]) {
  if (!contract.bytecode || contract.bytecode === "0x") {
    throw new Error(
      `${contract.contractName} has no deployment bytecode; run npm run build first`,
    );
  }
  const initCodeBytes = (contract.bytecode.length - 2) / 2;
  const runtimeCodeBytes = (contract.deployedBytecode.length - 2) / 2;
  if (initCodeBytes > 49_152) {
    throw new Error(
      `${contract.contractName} init code is ${initCodeBytes} bytes; maximum is 49152`,
    );
  }
  if (runtimeCodeBytes > 24_576) {
    throw new Error(
      `${contract.contractName} runtime is ${runtimeCodeBytes} bytes; maximum is 24576`,
    );
  }
}

const account = privateKeyToAccount(settings.DEPLOYER_PRIVATE_KEY);
// The deployment signer retains token administration and all vault emergency authority.
const dependencies = {
  usdc: checkedAddress("USDC_ADDRESS", settings.USDC_ADDRESS),
  weth: checkedAddress("WETH_ADDRESS", settings.WETH_ADDRESS),
  aqua: checkedAddress("AQUA_ADDRESS", settings.AQUA_ADDRESS),
  swapVm: checkedAddress("AQUA_SWAP_VM_ADDRESS", settings.AQUA_SWAP_VM_ADDRESS),
};
assertAddress(
  "manifest Aqua",
  dependencies.aqua,
  aquaDeployment.contracts.Aqua.address,
);
assertAddress(
  "manifest SwapVM",
  dependencies.swapVm,
  aquaDeployment.contracts.AquaSwapVMRouter.address,
);
const safety = {
  ethUsdFeed: checkedAddress(
    "CHAINLINK_ETH_USD_FEED_ADDRESS",
    settings.CHAINLINK_ETH_USD_FEED_ADDRESS,
  ),
  usdcUsdFeed: checkedAddress(
    "CHAINLINK_USDC_USD_FEED_ADDRESS",
    settings.CHAINLINK_USDC_USD_FEED_ADDRESS,
  ),
  ethUsdMaxAgeSeconds: checkedInteger(
    "CHAINLINK_ETH_USD_MAX_AGE_SECONDS",
    settings.CHAINLINK_ETH_USD_MAX_AGE_SECONDS,
    1,
    604_800,
  ),
  usdcUsdMaxAgeSeconds: checkedInteger(
    "CHAINLINK_USDC_USD_MAX_AGE_SECONDS",
    settings.CHAINLINK_USDC_USD_MAX_AGE_SECONDS,
    1,
    604_800,
  ),
  maxStrategyPriceDeviationBps: checkedInteger(
    "AQUA_MAX_PRICE_DEVIATION_BPS",
    settings.AQUA_MAX_PRICE_DEVIATION_BPS,
    1,
    2_500,
  ),
  maxStrategyLifetimeSeconds: checkedInteger(
    "AQUA_MAX_STRATEGY_LIFETIME_SECONDS",
    settings.AQUA_MAX_STRATEGY_LIFETIME_SECONDS,
    120,
    86_400,
  ),
  maxPositionUsdc: checkedBigInt(
    "AQUA_MAX_POSITION_USDC_UNITS",
    settings.AQUA_MAX_POSITION_USDC_UNITS,
  ),
  maxPositionWeth: checkedBigInt(
    "AQUA_MAX_POSITION_WETH_UNITS",
    settings.AQUA_MAX_POSITION_WETH_UNITS,
  ),
};
for (const [name, expected] of Object.entries({
  usdc: sepoliaDeployment.usdc,
  weth: sepoliaDeployment.weth,
})) {
  assertAddress(`configured Sepolia ${name}`, dependencies[name], expected);
}
assertAddress(
  "official Sepolia ETH/USD feed",
  safety.ethUsdFeed,
  sepoliaDeployment.ethUsdFeed,
);
assertAddress(
  "official Sepolia USDC/USD feed",
  safety.usdcUsdFeed,
  sepoliaDeployment.usdcUsdFeed,
);
if (
  new Set(Object.values(dependencies).map((address) => address.toLowerCase()))
    .size !== 4
) {
  throw new Error(
    "USDC, WETH, Aqua, and SwapVM must be four distinct addresses",
  );
}

const transport = http(settings.SEPOLIA_RPC_URL);
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });
const chainId = await publicClient.getChainId();
if (chainId !== sepolia.id)
  throw new Error(
    `SEPOLIA_RPC_URL returned chain ${chainId}; expected Sepolia 11155111`,
  );

const dependencyTargets = {
  ...dependencies,
  ethUsdFeed: safety.ethUsdFeed,
  usdcUsdFeed: safety.usdcUsdFeed,
};
const dependencyCode = await Promise.all(
  Object.entries(dependencyTargets).map(async ([name, address]) => [
    name,
    await publicClient.getCode({ address }),
  ]),
);
for (const [name, code] of dependencyCode) {
  if (!code || code === "0x") {
    throw new Error(
      `${name} has no deployed bytecode at ${dependencyTargets[name]}`,
    );
  }
}
const dependencyCodeByName = Object.fromEntries(dependencyCode);
const dependencyRuntimeCodeHashes = {
  aqua: settings.AQUA_RUNTIME_CODE_HASH,
  swapVm: settings.AQUA_SWAP_VM_RUNTIME_CODE_HASH,
};
for (const [name, expectedHash] of Object.entries(
  dependencyRuntimeCodeHashes,
)) {
  const actualHash = keccak256(dependencyCodeByName[name]);
  if (actualHash !== expectedHash) {
    throw new Error(
      `${name} runtime code hash is ${actualHash}; expected ${expectedHash}`,
    );
  }
}

for (const [key, name] of [
  ["aqua", "Aqua"],
  ["swapVm", "AquaSwapVMRouter"],
]) {
  assertCompiledRuntime(await artifact(name), dependencyCodeByName[key]);
}

const erc20MetadataAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
];
const swapVmInspectorAbi = [
  {
    type: "function",
    name: "AQUA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
];
const priceFeedAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "description",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
];
const [usdcDecimals, wethDecimals, swapVmAqua, latestBlock, ethFeed, usdcFeed] =
  await Promise.all([
    publicClient.readContract({
      address: dependencies.usdc,
      abi: erc20MetadataAbi,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: dependencies.weth,
      abi: erc20MetadataAbi,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: dependencies.swapVm,
      abi: swapVmInspectorAbi,
      functionName: "AQUA",
    }),
    publicClient.getBlock({ blockTag: "latest" }),
    readFeed(safety.ethUsdFeed),
    readFeed(safety.usdcUsdFeed),
  ]);
if (usdcDecimals !== 6)
  throw new Error(`USDC reports ${usdcDecimals} decimals; expected 6`);
if (wethDecimals !== 18)
  throw new Error(`WETH reports ${wethDecimals} decimals; expected 18`);
assertAddress("SwapVM Aqua dependency", swapVmAqua, dependencies.aqua);
validateFeed(
  "ETH/USD",
  ethFeed,
  latestBlock.timestamp,
  safety.ethUsdMaxAgeSeconds,
);
validateFeed(
  "USDC/USD",
  usdcFeed,
  latestBlock.timestamp,
  safety.usdcUsdMaxAgeSeconds,
);
if ((await publicClient.getBalance({ address: account.address })) === 0n) {
  throw new Error(
    `Deployer ${account.address} has no native ETH for Sepolia gas`,
  );
}

async function deploy(contract, args = []) {
  const hash = await walletClient.deployContract({
    abi: contract.abi,
    bytecode: contract.bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error(`${contract.contractName} deployment reverted`);
  if (!receipt.contractAddress)
    throw new Error("Deployment did not return an address");
  console.error(
    `${contract.contractName} deployed at ${receipt.contractAddress} (${receipt.transactionHash})`,
  );
  return receipt;
}

async function write(address, abi, functionName, args) {
  const hash = await walletClient.writeContract({
    address,
    abi,
    functionName,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error(`${functionName} transaction reverted`);
  console.error(`${functionName} confirmed (${receipt.transactionHash})`);
  return receipt;
}

async function estimateDeployment(contract, args) {
  return publicClient.estimateGas({
    account: account.address,
    data: encodeDeployData({
      abi: contract.abi,
      bytecode: contract.bytecode,
      args,
    }),
  });
}

if (dryRun) {
  const pendingNonce = BigInt(
    await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    }),
  );
  const predictedRegistry = getContractAddress({
    from: account.address,
    nonce: pendingNonce,
  });
  const predictedToken = getContractAddress({
    from: account.address,
    nonce: pendingNonce + 1n,
  });
  const predictedGoals = getContractAddress({
    from: account.address,
    nonce: pendingNonce + 2n,
  });
  const predictedFactory = getContractAddress({
    from: account.address,
    nonce: pendingNonce + 3n,
  });
  const predictedChildFactory = getContractAddress({
    from: account.address,
    nonce: pendingNonce + 4n,
  });
  const estimates = await Promise.all([
    estimateDeployment(registry, []),
    estimateDeployment(token, [account.address]),
    estimateDeployment(goals, [predictedRegistry, predictedToken]),
    estimateDeployment(factory, [
      predictedRegistry,
      predictedToken,
      dependencies.usdc,
      dependencies.weth,
      dependencies.aqua,
      dependencies.swapVm,
      account.address,
      safety,
    ]),
    estimateDeployment(childFactory, [
      predictedRegistry,
      predictedGoals,
      childAccountRpId,
      getContractAddress({ from: account.address, nonce: pendingNonce + 3n }),
    ]),
    estimateDeployment(ensRegistrar, ensRegistrarArgs),
  ]);
  console.log(
    JSON.stringify(
      {
        readyToDeploy: true,
        architecture: "one-family-one-vault",
        chainId,
        deployer: account.address,
        tokenAdmin: account.address,
        emergencyAdmin: account.address,
        pendingNonce: pendingNonce.toString(),
        predictedAddresses: {
          StarRegistry: predictedRegistry,
          StarToken: predictedToken,
          StarGoals: predictedGoals,
          StarFamilyVaultFactory: predictedFactory,
          StarChildAccountFactory: predictedChildFactory,
          StarEnsRegistrar: getContractAddress({
            from: account.address,
            nonce: pendingNonce + 5n,
          }),
        },
        estimatedDeploymentGas: Object.fromEntries(
          [
            "StarRegistry",
            "StarToken",
            "StarGoals",
            "StarFamilyVaultFactory",
            "StarChildAccountFactory",
            "StarEnsRegistrar",
          ].map((name, index) => [name, estimates[index].toString()]),
        ),
        note: "No transactions were broadcast. Family vaults are deployed later by their registered parent.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const registryReceipt = await deploy(registry);
const registryAddress = registryReceipt.contractAddress;
const tokenReceipt = await deploy(token, [account.address]);
const tokenAddress = tokenReceipt.contractAddress;
const goalsReceipt = await deploy(goals, [registryAddress, tokenAddress]);
const goalsAddress = goalsReceipt.contractAddress;
const factoryArgs = [
  registryAddress,
  tokenAddress,
  dependencies.usdc,
  dependencies.weth,
  dependencies.aqua,
  dependencies.swapVm,
  account.address,
  safety,
];
const factoryReceipt = await deploy(factory, factoryArgs);
const factoryAddress = factoryReceipt.contractAddress;
const childFactoryArgs = [
  registryAddress,
  goalsAddress,
  childAccountRpId,
  factoryAddress,
];
const childFactoryReceipt = await deploy(childFactory, childFactoryArgs);
const childFactoryAddress = childFactoryReceipt.contractAddress;
const ensRegistrarReceipt = await deploy(ensRegistrar, ensRegistrarArgs);
const ensRegistrarAddress = ensRegistrarReceipt.contractAddress;

const DEFAULT_ADMIN_ROLE = `0x${"00".repeat(32)}`;
const MINTER_ROLE = keccak256(toBytes("MINTER_ROLE"));
const BURNER_ROLE = keccak256(toBytes("BURNER_ROLE"));
const VAULT_FACTORY_ROLE = keccak256(toBytes("VAULT_FACTORY_ROLE"));
const roleReceipts = {};
roleReceipts.grantFactoryAuthority = await write(
  tokenAddress,
  token.abi,
  "grantRole",
  [VAULT_FACTORY_ROLE, factoryAddress],
);
roleReceipts.grantGoalsBurner = await write(
  tokenAddress,
  token.abi,
  "grantRole",
  [BURNER_ROLE, goalsAddress],
);

const deployedContracts = {
  StarEnsRegistrar: {
    artifact: ensRegistrar,
    receipt: ensRegistrarReceipt,
    address: ensRegistrarAddress,
    args: ensRegistrarArgs,
  },
  StarChildAccountFactory: {
    artifact: childFactory,
    receipt: childFactoryReceipt,
    address: childFactoryAddress,
    args: childFactoryArgs,
  },
  StarRegistry: {
    artifact: registry,
    receipt: registryReceipt,
    address: registryAddress,
    args: [],
  },
  StarToken: {
    artifact: token,
    receipt: tokenReceipt,
    address: tokenAddress,
    args: [account.address],
  },
  StarGoals: {
    artifact: goals,
    receipt: goalsReceipt,
    address: goalsAddress,
    args: [registryAddress, tokenAddress],
  },
  StarFamilyVaultFactory: {
    artifact: factory,
    receipt: factoryReceipt,
    address: factoryAddress,
    args: factoryArgs,
  },
};

const deployedRuntimeCodeHashes = {};
for (const [name, deployment] of Object.entries(deployedContracts)) {
  const code = await publicClient.getCode({ address: deployment.address });
  if (!code || code === "0x")
    throw new Error(`${name} has no runtime bytecode after deployment`);
  deployedRuntimeCodeHashes[name] = keccak256(code);
}

const reads = await Promise.all([
  publicClient.readContract({
    address: tokenAddress,
    abi: token.abi,
    functionName: "decimals",
  }),
  publicClient.readContract({
    address: tokenAddress,
    abi: token.abi,
    functionName: "totalSupply",
  }),
  publicClient.readContract({
    address: tokenAddress,
    abi: token.abi,
    functionName: "getRoleAdmin",
    args: [MINTER_ROLE],
  }),
  publicClient.readContract({
    address: goalsAddress,
    abi: goals.abi,
    functionName: "registry",
  }),
  publicClient.readContract({
    address: goalsAddress,
    abi: goals.abi,
    functionName: "star",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "registry",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "star",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "usdc",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "weth",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "aqua",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "swapVmApp",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "emergencyAdmin",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "ethUsdFeed",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "usdcUsdFeed",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "ethUsdMaxAgeSeconds",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "usdcUsdMaxAgeSeconds",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "maxStrategyPriceDeviationBps",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "maxStrategyLifetimeSeconds",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "maxPositionUsdc",
  }),
  publicClient.readContract({
    address: factoryAddress,
    abi: factory.abi,
    functionName: "maxPositionWeth",
  }),
]);
const [
  starDecimals,
  starSupply,
  minterRoleAdmin,
  goalsRegistry,
  goalsStar,
  factoryRegistry,
  factoryStar,
  factoryUsdc,
  factoryWeth,
  factoryAqua,
  factorySwapVm,
  factoryEmergencyAdmin,
  factoryEthUsdFeed,
  factoryUsdcUsdFeed,
  factoryEthUsdMaxAge,
  factoryUsdcUsdMaxAge,
  factoryMaxPriceDeviation,
  factoryMaxLifetime,
  factoryMaxPositionUsdc,
  factoryMaxPositionWeth,
] = reads;
assertEqual("STAR decimals", starDecimals, 0);
assertEqual("initial STAR supply", starSupply, 0n);
assertEqual("MINTER role administrator", minterRoleAdmin, VAULT_FACTORY_ROLE);
assertAddress("goals registry", goalsRegistry, registryAddress);
assertAddress("goals STAR", goalsStar, tokenAddress);
assertAddress("factory registry", factoryRegistry, registryAddress);
assertAddress("factory STAR", factoryStar, tokenAddress);
assertAddress("factory USDC", factoryUsdc, dependencies.usdc);
assertAddress("factory WETH", factoryWeth, dependencies.weth);
assertAddress("factory Aqua", factoryAqua, dependencies.aqua);
assertAddress("factory SwapVM", factorySwapVm, dependencies.swapVm);
assertAddress(
  "factory emergency admin",
  factoryEmergencyAdmin,
  account.address,
);
assertAddress("factory ETH/USD feed", factoryEthUsdFeed, safety.ethUsdFeed);
assertAddress("factory USDC/USD feed", factoryUsdcUsdFeed, safety.usdcUsdFeed);
assertEqual(
  "factory ETH/USD maximum age",
  factoryEthUsdMaxAge,
  safety.ethUsdMaxAgeSeconds,
);
assertEqual(
  "factory USDC/USD maximum age",
  factoryUsdcUsdMaxAge,
  safety.usdcUsdMaxAgeSeconds,
);
assertEqual(
  "factory maximum strategy price deviation",
  factoryMaxPriceDeviation,
  safety.maxStrategyPriceDeviationBps,
);
assertEqual(
  "factory maximum strategy lifetime",
  factoryMaxLifetime,
  safety.maxStrategyLifetimeSeconds,
);
assertEqual(
  "factory maximum position USDC",
  factoryMaxPositionUsdc,
  safety.maxPositionUsdc,
);
assertEqual(
  "factory maximum position WETH",
  factoryMaxPositionWeth,
  safety.maxPositionWeth,
);

const hasRole = (role, grantee) =>
  publicClient.readContract({
    address: tokenAddress,
    abi: token.abi,
    functionName: "hasRole",
    args: [role, grantee],
  });
const roleAssertions = {
  factoryHasVaultFactoryRole: await hasRole(VAULT_FACTORY_ROLE, factoryAddress),
  goalsIsBurner: await hasRole(BURNER_ROLE, goalsAddress),
  factoryIsNotMinter: !(await hasRole(MINTER_ROLE, factoryAddress)),
  factoryIsNotBurner: !(await hasRole(BURNER_ROLE, factoryAddress)),
  goalsIsNotMinter: !(await hasRole(MINTER_ROLE, goalsAddress)),
  deployerIsNotMinter: !(await hasRole(MINTER_ROLE, account.address)),
  deployerIsNotBurner: !(await hasRole(BURNER_ROLE, account.address)),
  deployerHasAdminRole: await hasRole(DEFAULT_ADMIN_ROLE, account.address),
};
for (const [assertion, passed] of Object.entries(roleAssertions)) {
  if (!passed)
    throw new Error(`Post-deployment role assertion failed: ${assertion}`);
}

const contractManifest = Object.fromEntries(
  Object.entries(deployedContracts).map(([name, deployment]) => [
    name,
    {
      address: deployment.address,
      transactionHash: deployment.receipt.transactionHash,
      blockNumber: deployment.receipt.blockNumber.toString(),
      sourceName: deployment.artifact.sourceName,
      constructorArguments: deployment.args,
      runtimeCodeHash: deployedRuntimeCodeHashes[name],
    },
  ]),
);
const deployment = {
  schemaVersion: 5,
  architecture: "one-family-one-vault",
  generatedAt: new Date().toISOString(),
  network: "sepolia",
  chainId: sepolia.id,
  compilerVersion: registry.compilerVersion,
  optimizer: registry.optimizer,
  evmVersion: registry.evmVersion,
  deployer: account.address,
  tokenAdmin: account.address,
  emergencyAdmin: account.address,
  dependencies,
  dependencyRuntimeCodeHashes,
  aquaSafety: safety,
  contracts: { ...aquaDeployment.contracts, ...contractManifest },
  roleTransactions: Object.fromEntries(
    Object.entries(roleReceipts).map(([name, receipt]) => [
      name,
      receipt.transactionHash,
    ]),
  ),
  roleAssertions,
  configuration: {
    CHAIN_ID: String(sepolia.id),
    ENS_PARENT_NAME: ensParentName,
    STAR_ENS_REGISTRAR_ADDRESS: ensRegistrarAddress,
    STAR_ENS_REGISTRAR_RUNTIME_CODE_HASH:
      deployedRuntimeCodeHashes.StarEnsRegistrar,
    USDC_ADDRESS: dependencies.usdc,
    WETH_ADDRESS: dependencies.weth,
    AQUA_RUNTIME_CODE_HASH: dependencyRuntimeCodeHashes.aqua,
    AQUA_SWAP_VM_RUNTIME_CODE_HASH: dependencyRuntimeCodeHashes.swapVm,
    STAR_REGISTRY_ADDRESS: registryAddress,
    STAR_REGISTRY_START_BLOCK: registryReceipt.blockNumber.toString(),
    STAR_TOKEN_ADDRESS: tokenAddress,
    STAR_TOKEN_START_BLOCK: tokenReceipt.blockNumber.toString(),
    STAR_GOALS_ADDRESS: goalsAddress,
    STAR_GOALS_START_BLOCK: goalsReceipt.blockNumber.toString(),
    STAR_FAMILY_VAULT_FACTORY_ADDRESS: factoryAddress,
    STAR_CHILD_ACCOUNT_FACTORY_ADDRESS: childFactoryAddress,
    CHILD_ACCOUNT_RP_ID: childAccountRpId,
    STAR_CHILD_ACCOUNT_FACTORY_RUNTIME_CODE_HASH:
      deployedRuntimeCodeHashes.StarChildAccountFactory,
    STAR_FAMILY_VAULT_FACTORY_START_BLOCK:
      factoryReceipt.blockNumber.toString(),
    STAR_REGISTRY_RUNTIME_CODE_HASH: deployedRuntimeCodeHashes.StarRegistry,
    STAR_TOKEN_RUNTIME_CODE_HASH: deployedRuntimeCodeHashes.StarToken,
    STAR_GOALS_RUNTIME_CODE_HASH: deployedRuntimeCodeHashes.StarGoals,
    STAR_FAMILY_VAULT_FACTORY_RUNTIME_CODE_HASH:
      deployedRuntimeCodeHashes.StarFamilyVaultFactory,
    AQUA_ADDRESS: dependencies.aqua,
    AQUA_START_BLOCK: aquaDeployment.configuration.AQUA_START_BLOCK,
    AQUA_SWAP_VM_ADDRESS: dependencies.swapVm,
    AQUA_SWAP_VM_START_BLOCK:
      aquaDeployment.configuration.AQUA_SWAP_VM_START_BLOCK,
    CHAINLINK_ETH_USD_FEED_ADDRESS: safety.ethUsdFeed,
    CHAINLINK_USDC_USD_FEED_ADDRESS: safety.usdcUsdFeed,
    CHAINLINK_ETH_USD_MAX_AGE_SECONDS: safety.ethUsdMaxAgeSeconds.toString(),
    CHAINLINK_USDC_USD_MAX_AGE_SECONDS: safety.usdcUsdMaxAgeSeconds.toString(),
    AQUA_MAX_PRICE_DEVIATION_BPS:
      safety.maxStrategyPriceDeviationBps.toString(),
    AQUA_MAX_STRATEGY_LIFETIME_SECONDS:
      safety.maxStrategyLifetimeSeconds.toString(),
    AQUA_MAX_POSITION_USDC_UNITS: safety.maxPositionUsdc.toString(),
    AQUA_MAX_POSITION_WETH_UNITS: safety.maxPositionWeth.toString(),
  },
};

const deploymentsDirectory = resolve(root, "deployments");
await mkdir(deploymentsDirectory, { recursive: true });
await writeFile(
  deploymentPath,
  `${JSON.stringify(deployment, bigintJson, 2)}\n`,
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    { deploymentFile: deploymentPath, ...deployment },
    bigintJson,
    2,
  ),
);

function checkedAddress(name, value) {
  const address = getAddress(value);
  if (/^0x0{40}$/i.test(address))
    throw new Error(`${name} cannot be the zero address`);
  return address;
}

function checkedInteger(name, value, minimum, maximum) {
  if (!/^\d+$/.test(value))
    throw new Error(`${name} must be an unsigned integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function checkedBigInt(name, value) {
  if (!/^\d+$/.test(value))
    throw new Error(`${name} must be an unsigned integer`);
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed >= 1n << 248n) {
    throw new Error(
      `${name} must be positive and fit in Aqua's uint248 balance`,
    );
  }
  return parsed;
}

async function readFeed(address) {
  const [decimals, description, round] = await Promise.all([
    publicClient.readContract({
      address,
      abi: priceFeedAbi,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address,
      abi: priceFeedAbi,
      functionName: "description",
    }),
    publicClient.readContract({
      address,
      abi: priceFeedAbi,
      functionName: "latestRoundData",
    }),
  ]);
  return { decimals, description, round };
}

function validateFeed(expectedDescription, feed, blockTimestamp, maximumAge) {
  if (
    feed.description.replaceAll(" ", "").toUpperCase() !== expectedDescription
  ) {
    throw new Error(
      `Price feed reports ${feed.description}; expected ${expectedDescription}`,
    );
  }
  if (feed.decimals > 18)
    throw new Error(`${expectedDescription} feed decimals exceed 18`);
  const [roundId, answer, , updatedAt, answeredInRound] = feed.round;
  if (
    answer <= 0n ||
    roundId === 0n ||
    answeredInRound < roundId ||
    updatedAt === 0n
  ) {
    throw new Error(`${expectedDescription} feed returned an incomplete round`);
  }
  if (
    updatedAt > blockTimestamp ||
    blockTimestamp - updatedAt > BigInt(maximumAge)
  ) {
    throw new Error(`${expectedDescription} feed is stale or future-dated`);
  }
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function assertAddress(name, actual, expected) {
  if (getAddress(actual) !== getAddress(expected)) {
    throw new Error(`${name} is ${actual}; expected ${expected}`);
  }
}

function assertEqual(name, actual, expected) {
  if (actual !== expected)
    throw new Error(`${name} is ${actual}; expected ${expected}`);
}
