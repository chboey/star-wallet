import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  isAddressEqual,
} from "viem";
import { sepolia } from "viem/chains";

const apiKey = process.env.ETHERSCAN_API_KEY;
const familyIdInput = process.env.FAMILY_ID?.trim();
if (!apiKey) throw new Error("ETHERSCAN_API_KEY is required");
if (
  !familyIdInput ||
  !/^\d+$/.test(familyIdInput) ||
  BigInt(familyIdInput) === 0n
) {
  throw new Error("FAMILY_ID must be a positive integer");
}
if (!process.env.SEPOLIA_RPC_URL)
  throw new Error("SEPOLIA_RPC_URL is required");

const root = resolve(import.meta.dirname, "..");
const deploymentPath = resolve(
  root,
  process.env.DEPLOYMENT_FILE?.trim() || "deployments/sepolia.json",
);
const [deployment, compilerInput, factoryArtifact] = await Promise.all([
  readJson(deploymentPath),
  readJson(resolve(root, "artifacts/standard-json-input.json")),
  readJson(resolve(root, "artifacts/StarFamilyVaultFactory.json")),
]);
if (deployment.chainId !== sepolia.id) {
  throw new Error(
    `Deployment chain is ${deployment.chainId}; expected Sepolia ${sepolia.id}`,
  );
}
if (!deployment.aquaSafety) {
  throw new Error("Deployment manifest has no Aqua safety configuration");
}

const factory = deployment.contracts.StarFamilyVaultFactory;
if (!factory)
  throw new Error(
    "StarFamilyVaultFactory is missing from the deployment manifest",
  );
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});
const familyId = BigInt(familyIdInput);
if ((await publicClient.getChainId()) !== sepolia.id)
  throw new Error("SEPOLIA_RPC_URL is not Ethereum Sepolia (11155111)");
const vaultAddress = await publicClient.readContract({
  address: factory.address,
  abi: factoryArtifact.abi,
  functionName: "vaultByFamily",
  args: [familyId],
});
if (/^0x0{40}$/i.test(vaultAddress)) {
  throw new Error(`Family ${familyId} has no vault registered in the factory`);
}
if (process.env.FAMILY_VAULT_ADDRESS) {
  const expected = getAddress(process.env.FAMILY_VAULT_ADDRESS);
  if (!isAddressEqual(vaultAddress, expected)) {
    throw new Error(
      `Factory reports ${vaultAddress}; FAMILY_VAULT_ADDRESS is ${expected}`,
    );
  }
}
const code = await publicClient.getCode({ address: vaultAddress });
if (!code || code === "0x")
  throw new Error(`No bytecode exists at family vault ${vaultAddress}`);

const compilerMatch = deployment.compilerVersion?.match(
  /^\d+\.\d+\.\d+\+commit\.[0-9a-fA-F]{8}/,
);
if (!compilerMatch)
  throw new Error("Deployment manifest has no exact Solidity compiler version");
const args = [
  familyId,
  deployment.dependencies.usdc,
  deployment.dependencies.weth,
  deployment.contracts.StarRegistry.address,
  deployment.contracts.StarToken.address,
  deployment.dependencies.aqua,
  deployment.dependencies.swapVm,
  deployment.emergencyAdmin,
  deployment.aquaSafety,
];
const constructorArguments = encodeAbiParameters(
  [
    { type: "uint256" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    {
      type: "tuple",
      components: [
        { name: "ethUsdFeed", type: "address" },
        { name: "usdcUsdFeed", type: "address" },
        { name: "ethUsdMaxAgeSeconds", type: "uint32" },
        { name: "usdcUsdMaxAgeSeconds", type: "uint32" },
        { name: "maxStrategyPriceDeviationBps", type: "uint16" },
        { name: "maxStrategyLifetimeSeconds", type: "uint40" },
        { name: "maxPositionUsdc", type: "uint256" },
        { name: "maxPositionWeth", type: "uint256" },
      ],
    },
  ],
  args,
).slice(2);

const submission = await etherscanRequest({
  module: "contract",
  action: "verifysourcecode",
  contractaddress: vaultAddress,
  sourceCode: JSON.stringify(compilerInput),
  codeformat: "solidity-standard-json-input",
  contractname: "src/StarFamilyVault.sol:StarFamilyVault",
  compilerversion: `v${compilerMatch[0]}`,
  optimizationUsed: deployment.optimizer?.enabled ? "1" : "0",
  runs: String(deployment.optimizer?.runs ?? 500),
  constructorArguments,
  evmVersion: deployment.evmVersion ?? "default",
  licenseType: "3",
});

if (submission.status === "0" && /already verified/i.test(submission.result)) {
  console.log(
    `StarFamilyVault for family ${familyId}: already verified at ${explorerUrl(vaultAddress)}`,
  );
  process.exit(0);
}
if (submission.status !== "1") {
  throw new Error(
    `StarFamilyVault verification submission failed: ${submission.result}`,
  );
}
for (let attempt = 1; attempt <= 60; attempt += 1) {
  if (attempt > 1)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  const status = await etherscanRequest({
    module: "contract",
    action: "checkverifystatus",
    guid: submission.result,
  });
  if (status.status === "1") {
    console.log(
      `StarFamilyVault for family ${familyId}: verified at ${explorerUrl(vaultAddress)}`,
    );
    process.exit(0);
  }
  if (!/pending|queue|in progress/i.test(status.result)) {
    throw new Error(`StarFamilyVault verification failed: ${status.result}`);
  }
}
throw new Error(
  `StarFamilyVault verification timed out; GUID ${submission.result}`,
);

async function etherscanRequest(parameters) {
  const params = new URLSearchParams({
    apikey: apiKey,
    chainid: String(deployment.chainId),
    ...parameters,
  });
  const response = await fetch("https://api.etherscan.io/v2/api", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!response.ok)
    throw new Error(`Etherscan returned HTTP ${response.status}`);
  return response.json();
}

function explorerUrl(address) {
  return `https://sepolia.etherscan.io/address/${address}#code`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
