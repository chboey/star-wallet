import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeFunctionData } from "viem";
import { familyVaultAbi } from "@star/contracts/abi";
import {
  aquaPositionKey,
  parsePositionAmount,
  readAquaPosition,
  validatePositionAmounts,
  validateShipSavingsIntents,
  type AquaPositionSnapshot,
} from "../src/lib/aqua-position";
import { AquaPositionSetupContent } from "../src/components/home/aqua-position-setup-content";
import type { IntentEnvelope } from "../src/lib/star-api.types";

const vault = "0x0000000000000000000000000000000000000001";
const other = "0x0000000000000000000000000000000000000002";
const state: AquaPositionSnapshot = {
  vault,
  blockNumber: 100n,
  paused: false,
  maxUsdc: 20_000_000n,
  maxWeth: 10n ** 16n,
  totalPrincipalContributed: 4_000_000n,
  totalPrincipalWithdrawn: 0n,
  availableUsdc: 4_000_000n,
  availableWeth: 10n ** 14n,
  positionOpeningUsdc: 0n,
  positionOpeningWeth: 0n,
  strategyHash: `0x${"00".repeat(32)}`,
  positionActive: false,
  totalUsdcWithdrawn: 0n,
  totalWethWithdrawn: 0n,
  positionSqrtPriceMin: 0n,
  positionSqrtPriceMax: 0n,
  positionFeeBps: 0,
  positionSalt: 0n,
  positionDeadline: 0,
  positionOracleRawPrice: 0n,
  positionUsdc: 0n,
  positionWeth: 0n,
};

function mockClient(active: boolean) {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const client = {
    async getBlockNumber(args: Record<string, unknown>) {
      calls.push({ method: "block", args });
      return 100n;
    },
    async multicall(args: Record<string, unknown>) {
      calls.push({ method: "multicall", args });
      return [
        {
          ...state,
          positionActive: active,
          positionOpeningUsdc: active ? 2_000_000n : 0n,
        },
        false,
        state.maxUsdc,
        state.maxWeth,
      ];
    },
    async readContract(args: Record<string, unknown>) {
      calls.push({ method: "read", args });
      return [1_500_000n, 2n * 10n ** 14n];
    },
  } as unknown as Parameters<typeof readAquaPosition>[0];
  return { client, calls };
}

test("a funded vault is not an active Aqua position, and inactive balances are never read", async () => {
  const { client, calls } = mockClient(false);
  const result = await readAquaPosition(client, vault);
  assert.equal(result.positionActive, false);
  assert.equal(result.availableUsdc, 4_000_000n);
  assert.equal(result.availableWeth, 10n ** 14n);
  assert.equal(result.positionUsdc, 0n);
  assert.equal(result.positionWeth, 0n);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["block", "multicall"],
  );
  assert.equal(calls[0].args.cacheTime, 0);
  assert.equal(calls[1].args.blockNumber, 100n);
  assert.equal(calls[1].args.allowFailure, false);
});

test("an active position reads current Aqua balances at the same block, not opening allocations", async () => {
  const { client, calls } = mockClient(true);
  const result = await readAquaPosition(client, vault);
  assert.equal(result.positionActive, true);
  assert.equal(result.positionOpeningUsdc, 2_000_000n);
  assert.equal(result.positionUsdc, 1_500_000n);
  assert.equal(result.positionWeth, 2n * 10n ** 14n);
  assert.equal(calls[2].args.functionName, "currentPositionBalances");
  assert.equal(calls[2].args.blockNumber, 100n);
  assert.equal(calls[2].args.address, vault);
});

test("RPC failure stays an error instead of becoming no-position or zero balances", async () => {
  const { client } = mockClient(false);
  client.multicall = async () => {
    throw new Error("RPC unavailable");
  };
  await assert.rejects(readAquaPosition(client, vault), /RPC unavailable/);
});

test("position amounts use exact token precision without rounding or automatic allocation", () => {
  assert.equal(parsePositionAmount("4", "USDC"), 4_000_000n);
  assert.equal(parsePositionAmount(".000001", "USDC"), 1n);
  assert.equal(parsePositionAmount("0.000000000000000001", "WETH"), 1n);
  assert.equal(parsePositionAmount(" 0.0001 ", "WETH"), 10n ** 14n);
  for (const token of ["USDC", "WETH"] as const) {
    for (const value of [
      "",
      "0",
      "-1",
      "1e-3",
      "NaN",
      "Infinity",
      "+1",
      "1,000",
      "9".repeat(80),
    ])
      assert.throws(() => parsePositionAmount(value, token));
  }
  assert.throws(() => parsePositionAmount("1.0000001", "USDC"), /6 decimal/);
  assert.throws(
    () => parsePositionAmount("0.0000000000000000001", "WETH"),
    /18 decimal/,
  );
});

test("creation rejects existing positions, pauses, missing funds and per-position caps", () => {
  validatePositionAmounts(state, 2_000_000n, 10n ** 13n);
  validatePositionAmounts(state, state.availableUsdc, state.availableWeth);
  assert.throws(
    () => validatePositionAmounts({ ...state, positionActive: true }, 1n, 1n),
    /already has/,
  );
  assert.throws(
    () => validatePositionAmounts({ ...state, paused: true }, 1n, 1n),
    /paused/,
  );
  assert.throws(
    () => validatePositionAmounts(state, 0n, 1n),
    /greater than zero/,
  );
  assert.throws(
    () => validatePositionAmounts(state, 1n, 0n),
    /greater than zero/,
  );
  assert.throws(
    () => validatePositionAmounts(state, 5_000_000n, 1n),
    /enough USDC/,
  );
  assert.throws(
    () => validatePositionAmounts(state, 1n, 10n ** 15n),
    /enough WETH/,
  );
  assert.throws(
    () => validatePositionAmounts({ ...state, maxUsdc: 1n }, 2n, 1n),
    /USDC.*limit/,
  );
  assert.throws(
    () => validatePositionAmounts({ ...state, maxWeth: 1n }, 1n, 2n),
    /WETH.*limit/,
  );
});

const plan: IntentEnvelope = {
  intents: [
    {
      chainId: 11155111,
      signerRole: "PARENT",
      to: vault,
      value: "0",
      summary: "Create Aqua position",
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "shipSavingsPosition",
        args: ["0x1234", 2_000_000n, 10n ** 13n],
      }),
    },
  ],
};

test("signing plan pins one parent-only ship call to this vault and the reviewed amounts", () => {
  const expected = { vault, usdc: 2_000_000n, weth: 10n ** 13n } as const;
  assert.equal(validateShipSavingsIntents(plan, expected), "0x1234");
  const edits: Array<(copy: IntentEnvelope) => void> = [
    (p) => {
      p.intents = [];
    },
    (p) => {
      p.intents.push(p.intents[0]);
    },
    (p) => {
      p.intents[0].to = other;
    },
    (p) => {
      p.intents[0].chainId = 1;
    },
    (p) => {
      p.intents[0].signerRole = "CHILD";
    },
    (p) => {
      p.intents[0].value = "1";
    },
    (p) => {
      p.intents[0].data = encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "dockSavingsPosition",
      });
    },
    (p) => {
      p.intents[0].data = encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "shipSavingsPosition",
        args: ["0x1234", expected.usdc + 1n, expected.weth],
      });
    },
    (p) => {
      p.intents[0].data = encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "shipSavingsPosition",
        args: ["0x1234", expected.usdc, expected.weth + 1n],
      });
    },
    (p) => {
      p.intents[0].data = encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "shipSavingsPosition",
        args: ["0x", expected.usdc, expected.weth],
      });
    },
  ];
  for (const edit of edits) {
    const copy = structuredClone(plan);
    edit(copy);
    assert.throws(
      () => validateShipSavingsIntents(copy, expected),
      /does not match/,
    );
  }
});

const defaults = {
  step: "amounts" as const,
  snapshot: state,
  usdc: "",
  weth: "",
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
const render = (
  props: Partial<Parameters<typeof AquaPositionSetupContent>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(AquaPositionSetupContent, { ...defaults, ...props }),
  );

test("first step asks for both amounts with exact available balances, never auto-fills", () => {
  const html = render();
  assert.match(html, /Position setup progress/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /Choose amounts/);
  assert.match(html, /Available: 4 USDC/);
  assert.match(html, /Available: 0.0001 WETH/);
  assert.equal((html.match(/value=""/g) ?? []).length, 2);
  assert.match(html, /disabled="" aria-busy="false">Continue/);
  assert.doesNotMatch(
    html,
    /Create Aqua position<\/button>|role="alert"|\bspin\b/,
  );
});

test("missing token funding has a way forward and cannot create an empty position", () => {
  const html = render({
    snapshot: { ...state, availableUsdc: 0n, availableWeth: 0n },
    usdc: "1",
    weth: "1",
  });
  assert.match(html, /Rewarding Stars adds USDC/);
  assert.match(html, />Reward Stars<\/button>/);
  assert.match(html, />Add WETH<\/button>/);
  assert.match(html, /disabled="">Max/);
  assert.match(html, /disabled="" aria-busy="false">Continue/);
});

test("review shows chosen allocations, network, fee and a spinner only in the create button", () => {
  const html = render({
    step: "review",
    usdc: "2",
    weth: "0.00001",
    busy: true,
  });
  assert.match(html, /USDC to allocate<\/dt><dd>2 USDC/);
  assert.match(html, /WETH to allocate<\/dt><dd>0.00001 WETH/);
  assert.match(html, /Ethereum Sepolia \(testnet\)/);
  assert.match(html, />0.3%</);
  assert.match(
    html,
    /type="submit" disabled="" aria-busy="true"><svg[^>]*\bspin\b/,
  );
  assert.match(html, /Create Aqua position<\/button>/);
  assert.equal((html.match(/\bspin\b/g) ?? []).length, 1);
  assert.doesNotMatch(
    html,
    /<input|wallet-fullscreen-loader|action-status-working|Preparing your request/,
  );
});

test("failed checks show an inline refresh control, never a full-screen loader", () => {
  const html = render({
    disabled: true,
    error: "Couldn’t check the Aqua position.",
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-label="Refresh Aqua position"/);
  assert.match(html, /disabled="" aria-busy="false">Continue/);
  assert.doesNotMatch(html, /wallet-fullscreen-loader/);
});

test("success replaces the form with tick artwork and a final Done action", () => {
  const html = render({ step: "complete" });
  assert.match(
    html,
    /illustrations%2Fkid%2Fpurple_tick.png|illustrations\/kid\/purple_tick.png/,
  );
  assert.match(html, /Your Aqua position is active/);
  assert.match(html, />Done<\/button>/);
  assert.doesNotMatch(
    html,
    /<form|<input|Create Aqua position<\/button>|\bspin\b/,
  );
});

test("family gate and details use the live active flag, not positive indexed holdings", () => {
  const overview = readFileSync(
    "src/components/home/screens/family-overview-screen.tsx",
    "utf8",
  );
  assert.match(overview, /position\.data\?\.positionActive \? \(/);
  assert.match(overview, /<CreateAquaPositionCard/);
  assert.match(overview, /onCreate=\{\(\) => setSetupOpen\(true\)\}/);
  const savingsSection = overview
    .split("<SectionTitle>Savings position</SectionTitle>")[1]
    .split("</section>")[0];
  assert.doesNotMatch(
    savingsSection,
    /SectionEmptyState|section-empty-state|No data for this section/,
  );
  assert.match(overview, /onClick=\{openOnchainDetails\}/);
  assert.doesNotMatch(
    overview,
    /family\.savings\.activePosition|Held in family vault/,
  );
  const details = readFileSync(
    "src/components/home/onchain-details-sheet.tsx",
    "utf8",
  );
  assert.match(details, /useAquaPosition\(\)/);
  assert.match(details, /live\.data\.positionActive/);
  assert.match(details, /Checked on-chain block/);
  assert.match(details, /Latest indexed transaction/);
  assert.doesNotMatch(details, /<AquaPositionOptions/);
  assert.doesNotMatch(details, /aria-label="Refresh wallet"/);
});

test("submission locks through confirmation and reads on entry/events only, with no polling", () => {
  const source = readFileSync(
    "src/components/home/aqua-position-setup-sheet.tsx",
    "utf8",
  );
  assert.match(source, /lock\.current = true;\s+setBusy\(true\)/);
  assert.match(
    source,
    /await execute\([\s\S]*?"shipSavings"[\s\S]*?"PARENT",?[\s\S]*?setStep\("complete"\)/,
  );
  assert.match(
    source,
    /finally \{\s+lock\.current = false;\s+setBusy\(false\)/,
  );
  const hook = readFileSync("src/components/home/use-aqua-position.ts", "utf8");
  assert.match(hook, /\.\.\.starReadOptions/);
  assert.match(hook, /useReadOnEntry/);
  assert.doesNotMatch(hook, /setInterval|setTimeout|refetchInterval:/);
  const intents = readFileSync(
    "src/components/home/use-star-intents.ts",
    "utf8",
  );
  assert.ok(
    intents.indexOf("await readAquaPosition(") <
      intents.indexOf("await starApi.intent("),
  );
  assert.match(intents, /validateShipSavingsIntents/);
  assert.match(intents, /functionName: "inspectSavingsStrategy"/);
  assert.match(intents, /parameters\.feeBps !==[\s\S]*?body\.feeBps \?\? 30/);
  assert.deepEqual(aquaPositionKey(vault), ["aqua-position", 11155111, vault]);
});
