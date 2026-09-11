import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runStudio, studioArguments } from "../scripts/studio.mjs";

// Synthetic credentials only; never load .env or invoke the real auth/deploy commands.
const key = "1234567890abcdef1234567890abcdef";
const environment = {
  SUBGRAPH_DEPLOY_KEY: key,
  SUBGRAPH_SLUG: "star-wallet-sepolia",
};

test("Studio commands read trimmed environment values and pin the indexed network", () => {
  assert.deepEqual(
    studioArguments(["auth"], { SUBGRAPH_DEPLOY_KEY: ` ${key} ` }),
    ["auth", key],
  );
  assert.deepEqual(
    studioArguments(["deploy"], {
      ...environment,
      SUBGRAPH_SLUG: " star-wallet-sepolia ",
    }),
    [
      "deploy",
      "star-wallet-sepolia",
      "--network",
      "sepolia",
      "--deploy-key",
      key,
    ],
  );
});

test("Studio configuration errors never echo credentials or accept CLI overrides", () => {
  for (const value of [
    undefined,
    "",
    " ",
    "secret-not-a-studio-key",
    `${key}\nextra`,
  ]) {
    assert.throws(
      () => studioArguments(["auth"], { SUBGRAPH_DEPLOY_KEY: value }),
      (error) =>
        /SUBGRAPH_DEPLOY_KEY/.test(error.message) &&
        (!value?.trim() || !error.message.includes(value.trim())),
    );
  }
  for (const slug of [
    undefined,
    "",
    "Star Wallet",
    "--node",
    "../other",
    "https://thegraph.com/studio",
    "a".repeat(256),
  ])
    assert.throws(
      () =>
        studioArguments(["deploy"], { ...environment, SUBGRAPH_SLUG: slug }),
      /SUBGRAPH_SLUG/,
    );
  for (const argv of [
    [],
    ["publish"],
    ["auth", key],
    ["deploy", "--network", "mainnet"],
  ])
    assert.throws(
      () => studioArguments(argv, environment),
      /without arguments/,
    );
});

test("deploy configures sources first and auth does not configure or deploy", async () => {
  const calls = [];
  const dependencies = {
    configureNetwork: async () => calls.push("configure"),
    graph: async (args) => calls.push(args[0]),
  };
  await runStudio(["auth"], environment, dependencies);
  assert.deepEqual(calls, ["auth"]);
  calls.length = 0;
  await runStudio(["deploy"], environment, dependencies);
  assert.deepEqual(calls, ["configure", "deploy"]);
});

test("missing credentials or failed network configuration stop before deployment", async () => {
  const calls = [];
  const dependencies = {
    configureNetwork: async () => {
      calls.push("configure");
      throw new Error("Invalid deployment manifest");
    },
    graph: async () => calls.push("deploy"),
  };
  await assert.rejects(
    runStudio(["deploy"], { SUBGRAPH_DEPLOY_KEY: key }, dependencies),
    /SUBGRAPH_SLUG/,
  );
  assert.deepEqual(calls, []);
  await assert.rejects(
    runStudio(["deploy"], environment, dependencies),
    /Invalid deployment manifest/,
  );
  assert.deepEqual(calls, ["configure"]);
});

test("CLI fails non-interactively with a sanitized error when configuration is missing", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../scripts/studio.mjs", import.meta.url)),
      "deploy",
    ],
    {
      encoding: "utf8",
      env: { SUBGRAPH_DEPLOY_KEY: key },
      timeout: 5_000,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SUBGRAPH_SLUG is required/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(key));
});

test("npm commands load the subgraph .env without expanding credentials in a shell", async () => {
  const { scripts } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    scripts["auth:studio"],
    "node --env-file-if-exists=.env scripts/studio.mjs auth",
  );
  assert.equal(
    scripts["deploy:studio"],
    "node --env-file-if-exists=.env scripts/studio.mjs deploy",
  );
});
