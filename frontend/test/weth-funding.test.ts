import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeFunctionData, erc20Abi, maxUint256 } from "viem";
import { familyVaultAbi } from "@star/contracts/abi";
import {
  parseWethAmount,
  validateWethFundingIntents,
} from "../src/lib/weth-funding";
import { WethFundingContent } from "../src/components/home/weth-funding-form";
import type { IntentEnvelope } from "../src/lib/star-api.types";

const vault = "0x0000000000000000000000000000000000000001";
const weth = "0x0000000000000000000000000000000000000002";
const other = "0x0000000000000000000000000000000000000003";
const amount = 1_000_000_000_000_000n;
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

test("WETH amounts retain exact 18-decimal precision", () => {
  assert.equal(parseWethAmount("0.001"), amount);
  assert.equal(parseWethAmount(".001"), amount);
  assert.equal(parseWethAmount("0.000000000000000001"), 1n);
  assert.equal(
    parseWethAmount("1.123456789012345678"),
    1_123_456_789_012_345_678n,
  );
  for (const input of [
    "",
    ".",
    "0",
    "-1",
    "1e-3",
    "NaN",
    "0.0000000000000000001",
    "9".repeat(80),
  ])
    assert.throws(() => parseWethAmount(input), /Enter a/);
});

test("funding permits only the exact approval followed by the vault deposit", () => {
  validateWethFundingIntents(plan, { vault, weth, amount });
  assert.throws(() =>
    validateWethFundingIntents(plan, { vault, weth, amount: amount + 1n }),
  );
  const unlimited = structuredClone(plan);
  unlimited.intents[0].data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [vault, maxUint256],
  });
  assert.throws(
    () => validateWethFundingIntents(unlimited, { vault, weth, amount }),
    /does not match/,
  );
  const wrongVault = structuredClone(plan);
  wrongVault.intents[1].to = other;
  assert.throws(
    () => validateWethFundingIntents(wrongVault, { vault, weth, amount }),
    /does not match/,
  );
});

test("funding feedback keeps progress in the action and shows a final Done state", () => {
  const render = (complete: boolean, busy: boolean) =>
    renderToStaticMarkup(
      createElement(WethFundingContent, {
        amount: "0.001",
        walletBalance: amount * 10n,
        busy,
        complete,
        operation: { state: "idle" },
        disabled: false,
        onAmountChange() {},
        onSubmit() {},
        onDone() {},
      }),
    );
  assert.match(render(false, true), /aria-busy="true"/);
  assert.match(render(false, true), /class="lucide lucide-loader-circle spin"/);
  assert.match(render(true, false), /WETH added!/);
  assert.match(render(true, false), />Done<\/button>/);
});
