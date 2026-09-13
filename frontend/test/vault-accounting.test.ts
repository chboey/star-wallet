import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("vault details read live family accounting and label indexed withdrawal totals", () => {
  const details = source("components/home/onchain-details-sheet.tsx");
  assert.match(details, /functionName: "getFamilyAccount"/);
  assert.match(details, /live\?\.availableUsdc/);
  assert.match(details, /live\?\.availableWeth/);
  assert.match(details, /live\?\.totalPrincipalContributed/);
  assert.match(details, /live\?\.totalPrincipalWithdrawn/);
  assert.match(details, /savings\?\.totalUsdcWithdrawn/);
  assert.match(details, /savings\?\.totalWethWithdrawn/);
  assert.match(details, /Ethereum Sepolia \(testnet\)/);
});

test("family overview keeps vault activity and technical details as separate actions", () => {
  const overview = source("components/home/screens/family-overview-screen.tsx");
  assert.match(overview, /View vault activity/);
  assert.match(overview, /On-chain details/);
  assert.match(overview, /onClick=\{openOnchainDetails\}/);
  assert.match(overview, /totalPrincipalContributed/);
});

test("the shared technical drawer is unavailable in child mode", () => {
  const shell = source("components/home/home-app-shell.tsx");
  assert.match(shell, /onchainDetailsOpen && !kidMode/);
  assert.match(shell, /<OnchainDetailsSheet/);
});
