import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  getAddress,
  getContractAddress,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { sepoliaDeployment } from "../network.js";
import {
  assertAddress,
  assertCompiledRuntime,
  isDryRun,
} from "./deployment-utils.mjs";

const root = resolve(import.meta.dirname, "..");
const dryRun = isDryRun(process.env.DRY_RUN);
const output = resolve(root, "deployments/sepolia-aqua.json");
if (existsSync(output))
  throw new Error(`${output} already exists; preserve/reuse this deployment`);
const rpcUrl = process.env.SEPOLIA_RPC_URL;
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl || !/^0x[0-9a-fA-F]{64}$/.test(key ?? ""))
  throw new Error(
    "SEPOLIA_RPC_URL and a test-only DEPLOYER_PRIVATE_KEY are required",
  );
const account = privateKeyToAccount(key);
const owner = getAddress(
  process.env.AQUA_ROUTER_OWNER_ADDRESS?.trim() || account.address,
);
if (/^0x0{40}$/i.test(owner))
  throw new Error("Aqua router owner must be nonzero");
const weth = getAddress(
  process.env.WETH_ADDRESS?.trim() || sepoliaDeployment.weth,
);
assertAddress("Sepolia WETH", weth, sepoliaDeployment.weth);
const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
const wallet = createWalletClient({
  account,
  chain: sepolia,
  transport: http(rpcUrl),
});
if ((await client.getChainId()) !== sepolia.id)
  throw new Error("RPC is not Ethereum Sepolia (11155111)");
const wethCode = await client.getCode({ address: weth });
if (!wethCode || wethCode === "0x")
  throw new Error("Sepolia WETH is not deployed");
const decimals = await client.readContract({
  address: weth,
  abi: parseAbi(["function decimals() view returns (uint8)"]),
  functionName: "decimals",
});
if (decimals !== 18) throw new Error("Sepolia WETH must have 18 decimals");
const artifacts = await Promise.all(
  ["Aqua", "AquaSwapVMRouter"].map(async (name) =>
    JSON.parse(await readFile(resolve(root, `artifacts/${name}.json`), "utf8")),
  ),
);
for (const item of artifacts) {
  if (!item.bytecode || item.bytecode === "0x")
    throw new Error("Run npm run build first");
  if ((item.deployedBytecode.length - 2) / 2 > 24_576)
    throw new Error(`${item.contractName} exceeds EIP-170`);
}
const nonce = BigInt(
  await client.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  }),
);
const predictedAqua = getContractAddress({ from: account.address, nonce });
const routerArgs = [predictedAqua, weth, owner, "SwapVM", "1"];
if (dryRun) {
  const gas = await Promise.all(
    artifacts.map((artifact, index) =>
      client.estimateGas({
        account: account.address,
        data: encodeDeployData({
          abi: artifact.abi,
          bytecode: artifact.bytecode,
          args: index ? routerArgs : [],
        }),
      }),
    ),
  );
  console.log(
    JSON.stringify(
      {
        chainId: sepolia.id,
        dryRun: true,
        predictedAqua,
        routerOwner: owner,
        deploymentGas: gas.map(String),
        note: "No transactions broadcast; predictions depend on the current pending nonce.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const records = {};
for (let index = 0; index < artifacts.length; index++) {
  const artifact = artifacts[index];
  const args = index ? [records.Aqua.address, weth, owner, "SwapVM", "1"] : [];
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`${artifact.contractName} deployment failed: ${hash}`);
  console.error(
    `${artifact.contractName}: ${receipt.contractAddress} (${hash})`,
  );
  const runtimeCodeHash = assertCompiledRuntime(
    artifact,
    await client.getCode({ address: receipt.contractAddress }),
  );
  records[artifact.contractName] = {
    address: receipt.contractAddress,
    sourceName: artifact.sourceName,
    constructorArguments: args,
    blockNumber: String(receipt.blockNumber),
    transactionHash: hash,
    runtimeCodeHash,
  };
}
const router = {
  address: records.AquaSwapVMRouter.address,
  abi: artifacts[1].abi,
};
assertAddress(
  "router Aqua",
  await client.readContract({ ...router, functionName: "AQUA" }),
  records.Aqua.address,
);
assertAddress(
  "router WETH",
  await client.readContract({ ...router, functionName: "WETH" }),
  weth,
);
assertAddress(
  "router owner",
  await client.readContract({ ...router, functionName: "owner" }),
  owner,
);
const manifest = {
  schemaVersion: 5,
  network: "sepolia",
  chainId: sepolia.id,
  compilerVersion: artifacts[0].compilerVersion,
  optimizer: artifacts[0].optimizer,
  evmVersion: artifacts[0].evmVersion,
  contracts: records,
  configuration: {
    CHAIN_ID: String(sepolia.id),
    USDC_ADDRESS: sepoliaDeployment.usdc,
    WETH_ADDRESS: weth,
    AQUA_ADDRESS: records.Aqua.address,
    AQUA_START_BLOCK: records.Aqua.blockNumber,
    AQUA_RUNTIME_CODE_HASH: records.Aqua.runtimeCodeHash,
    AQUA_SWAP_VM_ADDRESS: records.AquaSwapVMRouter.address,
    AQUA_SWAP_VM_START_BLOCK: records.AquaSwapVMRouter.blockNumber,
    AQUA_SWAP_VM_RUNTIME_CODE_HASH: records.AquaSwapVMRouter.runtimeCodeHash,
  },
};
await mkdir(resolve(root, "deployments"), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: "wx",
});
console.log(`Sepolia Aqua deployment saved to ${output}`);
