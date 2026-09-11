import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sepoliaDeployment } from "../../network.js";

const sources = {
  StarRegistry: "STAR_REGISTRY",
  StarToken: "STAR_TOKEN",
  StarGoals: "STAR_GOALS",
  StarFamilyVaultFactory: "STAR_FAMILY_VAULT_FACTORY",
  Aqua: "AQUA",
  AquaSwapVM: "AQUA_SWAP_VM",
};

export function networkConfiguration(deployment, environment = {}) {
  if (
    deployment &&
    (deployment.chainId !== sepoliaDeployment.chainId ||
      deployment.network !== sepoliaDeployment.network)
  )
    throw new Error(
      "The Subgraph requires an Ethereum Sepolia deployment manifest",
    );
  const configuration = deployment?.configuration ?? {};
  if (
    configuration.WETH_ADDRESS &&
    configuration.WETH_ADDRESS.toLowerCase() !==
      sepoliaDeployment.weth.toLowerCase()
  )
    throw new Error(
      "Deployment WETH does not match the project's configured Sepolia WETH",
    );
  const value = (name) => environment[name]?.trim() || configuration[name];
  const addresses = new Set();
  return Object.fromEntries(
    Object.entries(sources).map(([source, prefix]) => {
      const addressName = `${prefix}_ADDRESS`;
      const blockName = `${prefix}_START_BLOCK`;
      const address = value(addressName);
      const block = value(blockName);
      if (typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address))
        throw new Error(`${addressName} must be an EVM address`);
      if (/^0x0{40}$/i.test(address))
        throw new Error(`${addressName} cannot be the zero address`);
      if (addresses.has(address.toLowerCase()))
        throw new Error(`${addressName} duplicates another data source`);
      addresses.add(address.toLowerCase());
      const startBlock = Number(block);
      if (
        !/^[1-9][0-9]*$/.test(String(block)) ||
        !Number.isSafeInteger(startBlock)
      )
        throw new Error(
          `${blockName} must be a positive decimal deployment block`,
        );
      return [source, { address, startBlock }];
    }),
  );
}

export async function configure() {
  const root = resolve(import.meta.dirname, "..");
  const requestedPath = process.env.DEPLOYMENT_FILE?.trim();
  const deploymentPath = requestedPath
    ? resolve(requestedPath)
    : resolve(root, "../deployments/sepolia.json");
  let deployment;
  try {
    deployment = JSON.parse(await readFile(deploymentPath, "utf8"));
  } catch (error) {
    if (requestedPath || error?.code !== "ENOENT") throw error;
  }
  const sepolia = networkConfiguration(deployment, process.env);
  await writeFile(
    resolve(root, "networks.json"),
    `${JSON.stringify({ sepolia }, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await configure();
