import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeAbiParameters } from "viem";

const apiKey = process.env.ETHERSCAN_API_KEY;
if (!apiKey) throw new Error("ETHERSCAN_API_KEY is required");

const root = resolve(import.meta.dirname, "..");
const deploymentPath = resolve(
  root,
  process.env.DEPLOYMENT_FILE?.trim() || "deployments/sepolia.json",
);
const [deployment, compilerInput] = await Promise.all([
  readJson(deploymentPath),
  readJson(resolve(root, "artifacts/standard-json-input.json")),
]);
if (deployment.chainId !== 11155111) {
  throw new Error(
    `Deployment chain is ${deployment.chainId}; expected Sepolia 11155111`,
  );
}

const compilerMatch = deployment.compilerVersion?.match(
  /^\d+\.\d+\.\d+\+commit\.[0-9a-fA-F]{8}/,
);
if (!compilerMatch)
  throw new Error("Deployment manifest has no exact Solidity compiler version");
const compilerVersion = `v${compilerMatch[0]}`;
const apiUrl = "https://api.etherscan.io/v2/api";
const verificationTargets = [
  [
    "StarEnsRegistrar",
    [
      { type: "address" },
      { type: "string" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
    ],
  ],
  ["Aqua", []],
  [
    "AquaSwapVMRouter",
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "string" },
      { type: "string" },
    ],
  ],
  ["StarRegistry", []],
  ["StarToken", [{ type: "address" }]],
  ["StarGoals", [{ type: "address" }, { type: "address" }]],
  [
    "StarChildAccountFactory",
    [
      { type: "address" },
      { type: "address" },
      { type: "string" },
      { type: "address" },
    ],
  ],
  [
    "StarFamilyVaultFactory",
    [
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
  ],
];

for (const [name, constructorTypes] of verificationTargets) {
  const contract = deployment.contracts[name];
  if (!contract)
    throw new Error(`${name} is missing from the deployment manifest`);
  const constructorArguments =
    constructorTypes.length === 0
      ? ""
      : encodeAbiParameters(
          constructorTypes,
          contract.constructorArguments,
        ).slice(2);
  const submission = await etherscanRequest(
    {
      module: "contract",
      action: "verifysourcecode",
      contractaddress: contract.address,
      sourceCode: JSON.stringify(compilerInput),
      codeformat: "solidity-standard-json-input",
      contractname: `${contract.sourceName}:${name}`,
      compilerversion: compilerVersion,
      optimizationUsed: deployment.optimizer?.enabled ? "1" : "0",
      runs: String(deployment.optimizer?.runs ?? 500),
      constructorArguments,
      evmVersion: deployment.evmVersion ?? "default",
      ...(name.startsWith("Star") ? { licenseType: "3" } : {}),
    },
    "POST",
  );

  if (
    submission.status === "0" &&
    /already verified/i.test(submission.result)
  ) {
    console.log(
      `${name}: already verified at ${explorerUrl(contract.address)}`,
    );
    continue;
  }
  if (submission.status !== "1") {
    throw new Error(
      `${name} verification submission failed: ${submission.result}`,
    );
  }

  await waitForVerification(name, contract.address, submission.result);
}

async function waitForVerification(name, address, guid) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if (attempt > 1)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
    const status = await etherscanRequest({
      module: "contract",
      action: "checkverifystatus",
      guid,
    });
    if (status.status === "1") {
      console.log(`${name}: verified at ${explorerUrl(address)}`);
      return;
    }
    if (!/pending|queue|in progress/i.test(status.result)) {
      throw new Error(`${name} verification failed: ${status.result}`);
    }
  }
  throw new Error(`${name} verification timed out; GUID ${guid}`);
}

async function etherscanRequest(parameters, method = "GET") {
  const params = new URLSearchParams({
    apikey: apiKey,
    chainid: String(deployment.chainId),
    ...parameters,
  });
  const response =
    method === "POST"
      ? await fetch(apiUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: params,
        })
      : await fetch(`${apiUrl}?${params}`);
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
