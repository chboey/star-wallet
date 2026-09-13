import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeFunctionData, erc20Abi, maxUint256 } from "viem";
import { familyVaultAbi } from "@star/contracts/abi";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { aquaPositionKey, aquaTopUpKey } from "../src/lib/aqua-position";
import {
  parseWethAmount,
  refreshWethFundingReads,
  validateWethFundingIntents,
} from "../src/lib/weth-funding";
import { WethFundingContent } from "../src/components/home/weth-funding-form";
import type { IntentEnvelope } from "../src/lib/star-api.types";

const vault = "0x0000000000000000000000000000000000000001";
const weth = "0x0000000000000000000000000000000000000002";
const other = "0x0000000000000000000000000000000000000003";
const amount = 1_000_000_000_000_000n;

test("Done refreshes the live vault and current family's reads, waiting for fresh balances", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const keys = [
    aquaPositionKey(vault),
    aquaTopUpKey(vault),
    ["star", "family", "1"],
    ["star", "portfolio", "1"],
    ["star", "family", "1", "activity"],
  ];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const subscriptions = keys.map((queryKey) =>
    new QueryObserver(client, {
      queryKey,
      initialData: "old balance",
      queryFn: async () => {
        await gate;
        return "updated balance";
      },
    }).subscribe(() => {}),
  );
  client.setQueryData(aquaPositionKey(other), "other vault");
  client.setQueryData(["star", "family", "2"], "other family");
  let finished = false;
  try {
    const pending = refreshWethFundingReads(client, "1", vault).then(() => {
      finished = true;
    });
    await Promise.resolve();
    assert.equal(finished, false);
    release();
    await pending;
    for (const key of keys)
      assert.equal(client.getQueryData(key), "updated balance");
    assert.equal(
      client.getQueryState(aquaPositionKey(other))?.isInvalidated,
      false,
    );
    assert.equal(
      client.getQueryState(["star", "family", "2"])?.isInvalidated,
      false,
    );
  } finally {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    client.clear();
  }
});

test("a failed live balance refresh is reported so Done can retry without another deposit", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const unsubscribe = new QueryObserver(client, {
    queryKey: aquaPositionKey(vault),
    initialData: "old balance",
    queryFn: async () => {
      throw new Error("RPC unavailable");
    },
  }).subscribe(() => {});
  try {
    await assert.rejects(
      refreshWethFundingReads(client, "1", vault),
      /RPC unavailable/,
    );
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("Done locks and spins during refresh, and closes only after the refresh finishes", () => {
  const html = render({ complete: true, busy: true });
  assert.match(html, /type="button" disabled="" aria-busy="true"/);
  assert.match(html, /<svg[^>]*class="[^"]*spin/);
  assert.doesNotMatch(html, /type="submit"/);
  const source = readFileSync(
    new URL("../src/components/home/weth-funding-form.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /if \(lock.current \|\| !complete \|\| !family\?\.vault\) return/,
  );
  assert.match(
    source,
    /await refreshWethFundingReads\(queryClient, family.id, family.vault.id\);\s*onDone\(\)/,
  );
  assert.match(source, /onDone=\{\(\) => void done\(\)\}/);
  const intents = readFileSync(
    new URL("../src/components/home/use-star-intents.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    intents,
    /action === "fundWeth"\) &&[\s\S]*?aquaPositionKey\(family.vault.id\)[\s\S]*?aquaTopUpKey\(family.vault.id\)/,
  );
});

test("WETH amount focus uses the text caret without inner or outer highlight rings", () => {
  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(css, /\.weth-funding-amount:focus-within/);
  assert.match(
    css,
    /\.weth-funding-amount input\s*\{[^}]*caret-color: var\(--navy\);[^}]*cursor: text;/,
  );
  assert.match(
    css,
    /\.weth-funding-amount input:focus-visible\s*\{[^}]*outline: none;[^}]*box-shadow: none;/,
  );
});

const plan: IntentEnvelope = {
  intents: [
    {
      chainId: 11155111,
      signerRole: "PARENT",
      to: weth,
      value: "0",
      summary: "Approve WETH",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [vault, amount],
      }),
    },
    {
      chainId: 11155111,
      signerRole: "PARENT",
      to: vault,
      value: "0",
      summary: "Add WETH",
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "fundStrategyWeth",
        args: [amount],
      }),
    },
  ],
};

test("WETH input preserves exact 18-decimal amounts without floating point rounding", () => {
  assert.equal(parseWethAmount("0.001"), amount);
  assert.equal(parseWethAmount(".001"), amount);
  assert.equal(parseWethAmount(" 1. "), 10n ** 18n);
  assert.equal(parseWethAmount("0.000000000000000001"), 1n);
  assert.equal(
    parseWethAmount("1.123456789012345678"),
    1_123_456_789_012_345_678n,
  );
});

test("invalid, zero, negative, overflowing and over-precise inputs are rejected before signing", () => {
  for (const input of [
    "",
    ".",
    "0",
    "0.000",
    "-1",
    "1e-3",
    "NaN",
    "Infinity",
    "+1",
    "1,000",
    "0.0000000000000000001",
    "1.1234567890123456789",
    "9".repeat(80),
  ])
    assert.throws(() => parseWethAmount(input), /Enter a/);
});

test("funding allows only exact approval followed by the vault WETH deposit", () => {
  validateWethFundingIntents(plan, { vault, weth, amount });
  assert.throws(() =>
    validateWethFundingIntents(plan, { vault, weth, amount: 0n }),
  );
  assert.throws(() =>
    validateWethFundingIntents(plan, { vault, weth, amount: amount + 1n }),
  );
  const edits: ((copy: IntentEnvelope) => void)[] = [
    (p) => {
      p.intents[0].to = other;
    },
    (p) => {
      p.intents[1].to = other;
    },
    (p) => {
      p.intents[0].data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [other, amount],
      });
    },
    (p) => {
      p.intents[0].data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [vault, maxUint256],
      });
    },
    (p) => {
      p.intents[1].data = encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "fundStrategyWeth",
        args: [amount + 1n],
      });
    },
    (p) => {
      p.intents[1].data = encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "dockSavingsPosition",
      });
    },
    (p) => {
      p.intents[0].value = "1";
    },
    (p) => {
      p.intents[1].chainId = 1;
    },
    (p) => {
      p.intents[0].signerRole = "CHILD";
    },
    (p) => {
      p.intents.reverse();
    },
    (p) => {
      p.intents.pop();
    },
    (p) => {
      p.intents.push(p.intents[1]);
    },
  ];
  for (const edit of edits) {
    const copy = structuredClone(plan);
    edit(copy);
    assert.throws(
      () => validateWethFundingIntents(copy, { vault, weth, amount }),
      /does not match/,
    );
  }
});

const defaults = {
  amount: "0.001",
  walletBalance: amount * 10n,
  busy: false,
  complete: false,
  operation: { state: "idle" } as const,
  disabled: false,
  onAmountChange: () => {},
  onSubmit: () => {},
  onDone: () => {},
};
const render = (
  props: Partial<Parameters<typeof WethFundingContent>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(WethFundingContent, { ...defaults, ...props }),
  );

test("funding layout uses the existing WETH illustration, coin animation, amount and fixed token label", () => {
  const html = render();
  assert.match(html, /weth-funding-coin/);
  assert.match(
    html,
    /illustrations%2Fhome%2Fweth.png|illustrations\/home\/weth.png/,
  );
  assert.match(html, /inputMode="decimal"/);
  assert.match(html, /Amount in WETH/);
  assert.match(html, /Wallet balance: 0.01 WETH/);
  assert.match(html, /weth-funding-currency">WETH/);
  assert.doesNotMatch(html, /<select|chevron-down|Request Stars/);
  assert.match(html, />Max<\/button>/);
});

test("busy deposit keeps its button spinner and disabled submission without a purple status banner", () => {
  const html = render({
    busy: true,
    operation: { state: "signing", message: "Step 1 of 2: approve WETH." },
  });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /type="submit" disabled=""/);
  assert.match(html, /<svg[^>]*class="[^"]*\bspin\b/);
  assert.doesNotMatch(html, /action-status-working/);
  assert.match(html, /class="sr-only" role="status">Step 1 of 2: approve WETH/);
  assert.match(html, /value="0.001"/);
});

test("zero WETH and balance failures cannot submit or use Max", () => {
  const html = render({ walletBalance: 0n, disabled: true });
  assert.match(html, /ETH and WETH are different tokens/);
  assert.match(html, /disabled="">Max<\/button>/);
  assert.match(html, /type="submit" disabled=""/);
  const failure = render({
    disabled: true,
    error: "Couldn’t check your WETH balance.",
  });
  assert.match(failure, /role="alert"/);
  assert.doesNotMatch(failure, /<svg[^>]*class="[^"]*\bspin\b/);
});

test("successful funding prevents another submission and completes with Done", () => {
  const html = render({
    complete: true,
    operation: { state: "success", message: "Confirmed!", indexed: true },
  });
  assert.match(html, /WETH added!/);
  assert.match(html, /0.001 WETH is now in your family vault/);
  assert.match(html, />Done<\/button>/);
  assert.doesNotMatch(html, /type="submit"|<svg[^>]*class="[^"]*\bspin\b/);
});
