import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isDryRun, mergeConfiguration } from "../scripts/deployment-utils.mjs";

test("deploy-all checks each available stage and stops on failure, in dependency order", async () => {
  const { scripts } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(scripts["deploy:all:sepolia"].split(" && "), [
    "npm run build",
    "forge test -q",
    "npm run preflight:aqua:sepolia",
    "npm run deploy:aqua:sepolia",
    "npm run preflight:sepolia",
    "npm run deploy:sepolia",
  ]);
});

test("ambiguous dry-run flags cannot accidentally enable broadcast", () => {
  assert.equal(isDryRun("true"), true);
  assert.equal(isDryRun(" true "), true);
  assert.equal(isDryRun("false"), false);
  assert.equal(isDryRun(undefined), false);
  for (const value of ["1", "yes", "TRUE", "tru"])
    assert.throws(() => isDryRun(value), /refusing to broadcast/);
});

test("blank environment entries retain deployment configuration", () => {
  assert.deepEqual(
    mergeConfiguration(
      { configuration: { ADDRESS: "deployed" } },
      { ADDRESS: " ", EXTRA: " value " },
    ),
    { ADDRESS: "deployed", EXTRA: "value" },
  );
});
