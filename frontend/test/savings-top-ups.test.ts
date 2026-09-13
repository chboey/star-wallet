import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import {
  ContractFunctionZeroDataError,
  encodeFunctionData,
  maxUint256,
  type Hash,
} from "viem";
import { familyVaultAbi } from "@star/contracts/abi";
import {
  aquaPositionKey,
  aquaTopUpKey,
  parsePositionAmount,
  readAquaTopUpPosition,
  validateTopUpPositionState,
  validateTopUpAmounts,
  validateAddSavingsIntents,
  type AquaPositionSnapshot,
} from "../src/lib/aqua-position";
import { AquaPositionSetupContent } from "../src/components/home/aqua-position-setup-content";
import {
  isVaultActivity,
  presentActivity,
} from "../src/components/home/star-activity";
import { refreshAfterWalletAction } from "../src/lib/wallet-refresh";
import { intentPaths } from "../src/lib/star-api.contract";
import type { IntentEnvelope, StarActivity } from "../src/lib/star-api.types";

const vault = "0x0000000000000000000000000000000000000001" as const;
const other = "0x0000000000000000000000000000000000000002" as const;
const hash: Hash = `0x${"ab".repeat(32)}`;
const otherHash: Hash = `0x${"cd".repeat(32)}`;
const selected = { vault, strategyHash: hash };
const snapshot: AquaPositionSnapshot = {
  ...selected,
  blockNumber: 100n,
  paused: false,
  positionActive: true,
  availableUsdc: 3_000_000n,
  availableWeth: 200_000_000_000_000n,
  maxUsdc: 10_000_000n,
  maxWeth: 500_000_000_000_000n,
  positionUsdc: 8_000_000n,
  positionWeth: 400_000_000_000_000n,
  positionOpeningUsdc: 1_000_000n,
  positionOpeningWeth: 100_000_000_000_000n,
  positionDeadline: 2000,
  positionFeeBps: 50,
  positionSalt: 1n,
  positionSqrtPriceMin: 1n,
  positionSqrtPriceMax: 2n,
  positionOracleRawPrice: 1n,
  totalPrincipalContributed: 4_000_000n,
  totalPrincipalWithdrawn: 0n,
  totalUsdcWithdrawn: 0n,
  totalWethWithdrawn: 0n,
};
const source = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("top-up state pins the selected active, unpaused, unexpired position", () => {
  validateTopUpPositionState(snapshot, selected, 1000);
  for (const change of [
    { vault: other },
    { strategyHash: otherHash },
    { positionActive: false },
    { paused: true },
    { positionDeadline: 1000 },
    { positionDeadline: 999 },
  ])
    assert.throws(() =>
      validateTopUpPositionState({ ...snapshot, ...change }, selected, 1000),
    );
});

test("top-up amounts support either token and cap current holdings, not opening allocations", () => {
  validateTopUpAmounts(snapshot, 1_000_000n, 0n);
  validateTopUpAmounts(snapshot, 0n, 100_000_000_000_000n);
  validateTopUpAmounts(snapshot, 2_000_000n, 100_000_000_000_000n);
  for (const [u, w] of [
    [0n, 0n],
    [-1n, 0n],
    [0n, -1n],
    [maxUint256 + 1n, 0n],
    [2_000_001n, 0n],
    [0n, 100_000_000_000_001n],
    [4_000_000n, 0n],
    [0n, 300_000_000_000_000n],
  ])
    assert.throws(() => validateTopUpAmounts(snapshot, u, w));
  assert.equal(parsePositionAmount("0", "USDC", true), 0n);
  assert.equal(parsePositionAmount("0.000001", "USDC", true), 1n);
  for (const value of ["", "-1", "1e6", "0.0000001"])
    assert.throws(() => parsePositionAmount(value, "USDC", true));
  assert.throws(() => parsePositionAmount("0", "USDC"), /greater than zero/);
});

test("capability is checked on the same block, without disabling legacy viewing or closing", async () => {
  const calls: Record<string, unknown>[] = [];
  const client = (version: bigint | Error) =>
    ({
      async getBlockNumber() {
        return 100n;
      },
      async multicall() {
        return [snapshot, false, snapshot.maxUsdc, snapshot.maxWeth];
      },
      async readContract(args: Record<string, unknown>) {
        calls.push(args);
        if (args.functionName === "currentPositionBalances")
          return [snapshot.positionUsdc, snapshot.positionWeth];
        if (version instanceof Error) throw version;
        return version;
      },
    }) as unknown as Parameters<typeof readAquaTopUpPosition>[0];
  assert.deepEqual(await readAquaTopUpPosition(client(1n), vault), snapshot);
  assert.equal(calls.at(-1)?.functionName, "savingsTopUpsVersion");
  assert.ok(
    calls.every((call) => call.blockNumber === 100n && call.address === vault),
  );
  for (const version of [
    0n,
    2n,
    new ContractFunctionZeroDataError({ functionName: "savingsTopUpsVersion" }),
  ])
    await assert.rejects(
      readAquaTopUpPosition(client(version), vault),
      /new vault deployment and migration/,
    );
  const outage = new Error("RPC unavailable");
  await assert.rejects(
    readAquaTopUpPosition(client(outage), vault),
    (error) => error === outage,
  );
  assert.notDeepEqual(aquaTopUpKey(vault), aquaPositionKey(vault));
});

const expected = { ...selected, usdc: 1_000_000n, weth: 0n };
const plan: IntentEnvelope = {
  intents: [
    {
      chainId: 11155111,
      signerRole: "PARENT",
      to: vault,
      value: "0",
      summary: "Add vault funds",
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "addToSavingsPosition",
        args: [hash, expected.usdc, expected.weth],
      }),
    },
  ],
};
test("signing accepts only the reviewed zero-value vault top-up with the same strategy hash", () => {
  validateAddSavingsIntents(plan, expected);
  for (const change of [
    { to: other },
    { signerRole: "CHILD" as const },
    { chainId: 1 },
    { value: "1" },
    { data: `${plan.intents[0].data}00` as Hash },
    {
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "dockSavingsPosition",
      }),
    },
    {
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "addToSavingsPosition",
        args: [otherHash, expected.usdc, 0n],
      }),
    },
    {
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "addToSavingsPosition",
        args: [hash, expected.usdc + 1n, 0n],
      }),
    },
    {
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "addToSavingsPosition",
        args: [hash, expected.usdc, 1n],
      }),
    },
  ])
    assert.throws(
      () =>
        validateAddSavingsIntents(
          { intents: [{ ...plan.intents[0], ...change }] },
          expected,
        ),
      /does not match/,
    );
  for (const intents of [[], [...plan.intents, ...plan.intents]])
    assert.throws(
      () => validateAddSavingsIntents({ intents }, expected),
      /does not match/,
    );
});

const props: Parameters<typeof AquaPositionSetupContent>[0] = {
  mode: "top-up",
  step: "amounts",
  snapshot,
  usdc: "1",
  weth: "0",
  busy: false,
  checking: false,
  disabled: false,
  onRefresh() {},
  onAmountChange() {},
  onFund() {},
  onSubmit() {},
  onDone() {},
  onDetails() {},
};
const render = (changes: Partial<typeof props> = {}) =>
  renderToStaticMarkup(
    createElement(AquaPositionSetupContent, { ...props, ...changes }),
  ).replaceAll("%2F", "/");

test("top-up reuses the amount popup and shows vault balances and remaining position capacity", () => {
  const html = render();
  assert.match(html, /Available: 3 USDC/);
  assert.match(html, /Available: 0.0002 WETH/);
  assert.match(html, /Remaining position capacity: 2 USDC/);
  assert.match(html, /Remaining position capacity: 0.0001 WETH/);
  assert.match(html, /Review &amp; add/);
  assert.doesNotMatch(
    html,
    /Create Aqua position|Your Aqua position is active/,
  );
  const oneToken = render({ snapshot: { ...snapshot, availableWeth: 0n } });
  assert.match(oneToken, /type="submit" aria-busy="false">Continue/);
});

test("Max uses remaining capacity and the popup never submits when its controls render", () => {
  const changes: [string, string][] = [];
  let submitted = 0;
  const tree = AquaPositionSetupContent({
    ...props,
    onAmountChange: (token, amount) => changes.push([token, amount]),
    onSubmit: () => submitted++,
  });
  const tokens = tree.props.children[2].props.children;
  tokens[0].props.children[0].props.children[1].props.children[1].props.onClick();
  tokens[1].props.children[0].props.children[1].props.children[1].props.onClick();
  assert.deepEqual(changes, [
    ["USDC", "2"],
    ["WETH", "0.0001"],
  ]);
  assert.equal(submitted, 0);
  tree.props.onSubmit();
  assert.equal(submitted, 1);
});

test("review uses the existing fee and spins throughout confirmation", () => {
  const html = render({ step: "review", busy: true });
  assert.match(html, /Trading fee<\/dt><dd>0.5%/);
  assert.match(html, /same Aqua position/);
  assert.match(
    html,
    /type="submit" disabled="" aria-busy="true"><svg[^>]*spin/,
  );
  assert.match(html, />Add to this position<\/button>/);
  assert.doesNotMatch(
    html,
    /Create Aqua position|Your Aqua position is active/,
  );
});

test("top-up transaction hashes appear above the purple button only after successful completion", () => {
  for (const change of [
    { step: "review" as const, busy: true },
    { step: "review" as const, error: "Transaction reverted" },
    { step: "complete" as const },
  ]) {
    const html = render({ ...change, transactionHashes: [hash] });
    if (change.step !== "complete") {
      assert.doesNotMatch(
        html,
        /Tx hash :|parent-transaction-details|Copy transaction hash/,
      );
      continue;
    }
    assert.ok(
      html.includes(
        `<span class="parent-transaction-hash">${hash.slice(0, 8)}....${hash.slice(-6)}</span>`,
      ),
    );
    assert.ok(html.includes(`href="https://sepolia.etherscan.io/tx/${hash}"`));
    assert.doesNotMatch(html, /Copy transaction hash/);
    assert.ok(
      html.indexOf("Tx hash :") <
        html.indexOf('<button class="filled-action-button"'),
    );
    if (change.step === "complete") {
      assert.match(html, /Added to your savings position/);
      assert.match(html, /\/illustrations\/kid\/purple_tick.png/);
      assert.doesNotMatch(html, /<form|spin|Your Aqua position is active/);
    }
  }
});

test("unsupported or failed checks cannot submit, and existing active state cannot fake top-up success", () => {
  const html = render({
    disabled: true,
    error: "This vault does not support adding existing vault funds.",
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /type="submit" disabled=""/);
  const sheet = source("components/home/aqua-position-setup-sheet.tsx");
  assert.match(sheet, /!selected &&\s*!busy/);
  assert.match(sheet, /forTopUp: Boolean\(selected\)/);
  assert.match(
    sheet,
    /await execute\("addSavings"|await execute\(\s*"addSavings"/,
  );
  assert.match(sheet, /expectedStrategyHash: selected.strategyHash/);
  assert.match(sheet, /expectedPosition: selected/);
  assert.match(sheet, /lock.current = true;\s*setBusy\(true\)/);
  assert.match(sheet, /finally \{\s*lock.current = false;\s*setBusy\(false\)/);
  assert.match(sheet, /if \(!lock.current\) onClose\(\)/);
});

test("parent top-ups validate before and after the API, simulate the exact call, and refresh both live reads", () => {
  const code = source("components/home/use-star-intents.ts");
  const api = code.indexOf("await starApi.intent(");
  assert.ok(code.indexOf("await readAquaTopUpPosition(") < api);
  assert.ok(code.lastIndexOf("await readAquaTopUpPosition(") > api);
  assert.match(
    code,
    /signerRole !== "PARENT" \|\|[\s\S]*?body.familyId !== family.id/,
  );
  assert.match(code, /validateAddSavingsIntents\(envelope/);
  assert.match(
    code,
    /simulateContract\(\{[\s\S]*?functionName: "addToSavingsPosition"/,
  );
  assert.match(code, /aquaTopUpKey\(family.vault.id\)/);
  const details = source("components/home/onchain-details-sheet.tsx");
  assert.match(details, /addingPosition && canManage/);
  assert.match(details, /selected=\{addingPosition\}/);
});

test("top-up activity is a savings event, and only the affected family's balances and activity refresh", async () => {
  assert.equal(intentPaths.addSavings, "intents/savings/add");
  const activity: StarActivity = {
    id: hash,
    type: "SAVINGS_POSITION_TOPPED_UP",
    amount: "1000000",
    transactionHash: hash,
    sequence: "100",
    logIndex: "0",
    blockNumber: "1",
    timestamp: "1000",
  };
  assert.equal(isVaultActivity(activity), true);
  const shown = presentActivity(activity, {
    children: [],
    goals: [],
    rewards: [],
  });
  assert.equal(shown.title, "Added to savings position");
  assert.equal(shown.homeIllustration, "wallet");
  assert.equal(shown.amount, null);
  const client = new QueryClient();
  const keys = [
    ["star", "family", "1"],
    ["star", "portfolio", "1"],
    ["star", "family", "1", "activity"],
    ["star", "family", "2"],
    ["star", "family", "1", "inbox"],
  ];
  for (const key of keys) client.setQueryData(key, {});
  await refreshAfterWalletAction(
    client,
    "addSavings",
    { familyId: "1" },
    false,
  );
  assert.deepEqual(
    keys.map((key) => client.getQueryState(key)?.isInvalidated),
    [true, true, true, false, false],
  );
  client.clear();
});
