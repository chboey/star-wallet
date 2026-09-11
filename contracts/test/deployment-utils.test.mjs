import assert from "node:assert/strict";
import test from "node:test";
import { isDryRun } from "../scripts/deployment-utils.mjs";

test("ambiguous dry-run flags cannot accidentally enable broadcast", () => {
  assert.equal(isDryRun("true"), true);
  assert.equal(isDryRun(" true "), true);
  assert.equal(isDryRun("false"), false);
  assert.equal(isDryRun(undefined), false);
  for (const value of ["1", "yes", "TRUE", "tru"])
    assert.throws(() => isDryRun(value), /refusing to broadcast/);
});
