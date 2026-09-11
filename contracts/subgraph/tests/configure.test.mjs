import assert from "node:assert/strict";
import test from "node:test";
import { networkConfiguration } from "../scripts/configure.mjs";
import { sepoliaDeployment } from "../../network.js";

const prefixes = [
  "STAR_REGISTRY",
  "STAR_TOKEN",
  "STAR_GOALS",
  "STAR_FAMILY_VAULT_FACTORY",
  "AQUA",
  "AQUA_SWAP_VM",
];
const configuration = Object.fromEntries(
  prefixes.flatMap((prefix, i) => [
    [`${prefix}_ADDRESS`, `0x${String(i + 1).padStart(40, "0")}`],
    [`${prefix}_START_BLOCK`, String(100 + i)],
  ]),
);
const manifest = {
  chainId: sepoliaDeployment.chainId,
  network: "sepolia",
  configuration: { ...configuration, WETH_ADDRESS: sepoliaDeployment.weth },
};

test("configures all six sources from the deployment and ignores blank overrides", () => {
  const network = networkConfiguration(manifest, { AQUA_ADDRESS: "  " });
  assert.equal(Object.keys(network).length, 6);
  assert.deepEqual(network.Aqua, {
    address: configuration.AQUA_ADDRESS,
    startBlock: 104,
  });
  assert.equal(
    networkConfiguration(undefined, configuration).Aqua.startBlock,
    104,
  );
  assert.equal(
    networkConfiguration(manifest, { AQUA_START_BLOCK: " 99 " }).Aqua
      .startBlock,
    99,
  );
});

test("refuses absent, duplicate or zero sources and malformed deployment blocks", () => {
  assert.throws(() => networkConfiguration(), /must be an EVM address/);
  assert.throws(
    () =>
      networkConfiguration(manifest, { AQUA_ADDRESS: "0x" + "0".repeat(40) }),
    /zero address/,
  );
  assert.throws(
    () =>
      networkConfiguration(manifest, {
        AQUA_ADDRESS: configuration.STAR_TOKEN_ADDRESS,
      }),
    /duplicates/,
  );
  for (const block of ["0", "-1", "0x64", "1e3", "1.5", "9007199254740992"])
    assert.throws(
      () => networkConfiguration(manifest, { AQUA_START_BLOCK: block }),
      /deployment block/,
    );
});

test("rejects another network and manifests using a different WETH", () => {
  assert.throws(
    () => networkConfiguration({ ...manifest, chainId: 1 }),
    /Sepolia deployment/,
  );
  assert.throws(
    () => networkConfiguration({ ...manifest, network: "mainnet" }),
    /Sepolia deployment/,
  );
  assert.throws(
    () =>
      networkConfiguration({
        ...manifest,
        configuration: {
          ...configuration,
          WETH_ADDRESS: configuration.AQUA_ADDRESS,
        },
      }),
    /WETH does not match/,
  );
});
