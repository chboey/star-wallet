import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("vault details read live family accounting and label indexed withdrawal totals", () => {
  const details = source("components/home/onchain-details-sheet.tsx");
  const position = source("lib/aqua-position.ts");
  assert.match(position, /functionName: "getFamilyAccount"/);
  assert.match(details, /live\.data\?\.availableUsdc/);
  assert.match(details, /live\.data\?\.availableWeth/);
  assert.match(details, /live\.data\?\.totalPrincipalContributed/);
  assert.match(details, /live\.data\?\.totalPrincipalWithdrawn/);
  assert.match(details, /savings\?\.totalUsdcWithdrawn/);
  assert.match(details, /savings\?\.totalWethWithdrawn/);
  assert.match(details, /Ethereum Sepolia \(testnet\)/);
});

test("family overview keeps vault activity and technical details as separate actions", () => {
  const overview = source("components/home/screens/family-overview-screen.tsx");
  const card = source("components/home/family-vault-card.tsx");
  assert.match(card, /Open family vault activity/);
  assert.match(overview, /setVaultPopup\("activity"\)/);
  assert.match(overview, /On-chain details/);
  assert.match(overview, /onClick=\{openOnchainDetails\}/);
  assert.match(overview, /totalPrincipalContributed/);
});

test("the shared technical drawer is unavailable in child mode", () => {
  const shell = source("components/home/home-app-shell.tsx");
  assert.match(shell, /onchainDetailsOpen && !kidMode/);
  assert.match(shell, /<OnchainDetailsSheet/);
});
