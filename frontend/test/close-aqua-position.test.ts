import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeFunctionData, type Hash } from "viem";
import { familyVaultAbi } from "@star/contracts/abi";
import {
  validateClosePositionState,
  validateDockSavingsIntents,
  type AquaPositionSnapshot,
} from "../src/lib/aqua-position";
import type { IntentEnvelope } from "../src/lib/star-api.types";
import { CloseAquaPositionContent } from "../src/components/home/close-aqua-position-content";
import { AquaPositionOptions } from "../src/components/home/aqua-position-options";

const vault = "0x0000000000000000000000000000000000000001" as const;
const other = "0x0000000000000000000000000000000000000002" as const;
const hash: Hash = `0x${"ab".repeat(32)}`;
const otherHash: Hash = `0x${"cd".repeat(32)}`;
const selected = { vault, strategyHash: hash } as const;
const state: AquaPositionSnapshot = {
  ...selected,
  positionActive: true,
  paused: false,
  blockNumber: 100n,
  maxUsdc: 1_000_000_000n,
  maxWeth: 500_000_000_000_000_000n,
  positionUsdc: 1_000_000n,
  positionWeth: 100_000_000_000_000n,
  availableUsdc: 3_000_000n,
  availableWeth: 0n,
  totalPrincipalContributed: 4_000_000n,
  totalPrincipalWithdrawn: 0n,
  totalUsdcWithdrawn: 0n,
  totalWethWithdrawn: 0n,
  positionOpeningUsdc: 1_000_000n,
  positionOpeningWeth: 100_000_000_000_000n,
  positionSqrtPriceMin: 0n,
  positionSqrtPriceMax: 0n,
  positionFeeBps: 30,
  positionSalt: 1n,
  positionDeadline: 1000,
  positionOracleRawPrice: 1n,
};
const source = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const plan: IntentEnvelope = {
  intents: [
    {
      chainId: 11155111,
      signerRole: "PARENT",
      to: vault,
      value: "0",
      summary: "Close position",
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "dockSavingsPosition",
      }),
    },
  ],
};
const defaults = {
  busy: false,
  complete: false,
  checking: false,
  disabled: false,
  onConfirm() {},
  onDone() {},
  onRefresh() {},
};
const render = (
  props: Partial<Parameters<typeof CloseAquaPositionContent>[0]> = {},
) =>
  decodeURIComponent(
    renderToStaticMarkup(
      createElement(CloseAquaPositionContent, { ...defaults, ...props }),
    ),
  );

test("closing requires the selected vault and active strategy, while Aqua pause does not prevent exit", () => {
  validateClosePositionState(state, selected);
  validateClosePositionState({ ...state, paused: true }, selected);
  assert.throws(
    () => validateClosePositionState({ ...state, vault: other }, selected),
    /vault has changed/,
  );
  assert.throws(
    () =>
      validateClosePositionState({ ...state, positionActive: false }, selected),
    /no longer active/,
  );
  assert.throws(
    () =>
      validateClosePositionState(
        { ...state, strategyHash: otherHash },
        selected,
      ),
    /position has changed/,
  );
});

test("close plans allow only the exact parent dock call with zero value to the selected vault", () => {
  validateDockSavingsIntents(plan, vault);
  for (const change of [
    { to: other },
    { signerRole: "CHILD" as const },
    { chainId: 1 },
    { value: "1" },
    { data: `${plan.intents[0].data}00` as Hash },
    {
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "withdrawStrategyWeth",
        args: [1n, other],
      }),
    },
    {
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "replaceSavingsPosition",
        args: ["0x12", 1n, 1n],
      }),
    },
    { data: "0x" as const },
  ])
    assert.throws(
      () =>
        validateDockSavingsIntents(
          { intents: [{ ...plan.intents[0], ...change }] },
          vault,
        ),
      /does not match/,
    );
  for (const intents of [[], [...plan.intents, ...plan.intents]])
    assert.throws(
      () => validateDockSavingsIntents({ intents }, vault),
      /does not match/,
    );
});

test("the updated vault supports close, replacement and a scoped top-up, not generic execution", () => {
  const names = familyVaultAbi
    .filter((entry) => entry.type === "function")
    .map((entry) => entry.name);
  assert.ok(names.includes("dockSavingsPosition"));
  assert.ok(names.includes("replaceSavingsPosition"));
  assert.ok(names.includes("shipSavingsPosition"));
  assert.ok(names.includes("addToSavingsPosition"));
  assert.ok(names.includes("savingsTopUpsVersion"));
  assert.ok(!names.some((name) => /push|execute/i.test(name)));
});

test("confirmation uses the requested illustration and wording, with one full-width Close action", () => {
  assert.ok(
    existsSync(
      new URL(
        "../public/illustrations/profile/exclaimation_mark.png",
        import.meta.url,
      ),
    ),
  );
  const html = render();
  assert.match(html, /\/illustrations\/profile\/exclaimation_mark.png/);
  assert.match(html, /Are you sure you want to close this position\?/);
  assert.match(
    html,
    /This won’t withdraw funds to your wallet or change any Stars/,
  );
  assert.match(
    html,
    /class="filled-action-button"[^>]*>Close this position<\/button>/,
  );
  assert.equal((html.match(/<button /g) ?? []).length, 1);
  assert.doesNotMatch(html, /spin|Tx hash :/);
});

test("the close action spins and locks while submitting, and checking/error states do not permit signing", () => {
  for (const props of [
    { busy: true },
    { checking: true },
    { disabled: true, error: "RPC unavailable" },
  ]) {
    const html = render(props);
    assert.match(html, /class="filled-action-button"[^>]*disabled=""/);
    assert.equal(
      html.includes("lucide-loader-circle"),
      Boolean(props.busy || props.checking),
    );
    if (props.error) assert.match(html, /RPC unavailable/);
  }
});

test("close hashes stay hidden while pending or failed and appear above Done after completion", () => {
  for (const props of [
    { busy: true },
    { error: "Close reverted" },
    { complete: true },
  ]) {
    const html = render({ ...props, transactionHashes: [hash] });
    if (!props.complete) {
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
    if (props.complete) {
      assert.match(html, /Position closed/);
      assert.match(html, /\/illustrations\/kid\/purple_tick.png/);
      assert.match(html, />Done<\/button>/);
      assert.doesNotMatch(html, /Close this position|exclaimation_mark|spin/);
    }
  }
});

test("Close and Done dispatch their own callbacks without auto-submitting on render", () => {
  let confirmed = 0;
  let done = 0;
  const props = {
    ...defaults,
    onConfirm: () => confirmed++,
    onDone: () => done++,
  };
  const confirm = CloseAquaPositionContent(props);
  assert.equal(confirmed, 0);
  confirm.props.children[1].props.children[2].props.onClick();
  assert.equal(confirmed, 1);
  const success = CloseAquaPositionContent({ ...props, complete: true });
  success.props.children[1].props.children[2].props.onClick();
  assert.equal(done, 1);
  assert.equal(confirmed, 1);
});

test("the options menu replaces refresh and exposes Add and Close only for a verified parent position", () => {
  for (const disabled of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(AquaPositionOptions, {
        disabled,
        onClosePosition() {},
        onAddPosition() {},
      }),
    );
    assert.match(html, /aria-label="Position options"/);
    assert.match(html, /aria-haspopup="menu"/);
    assert.match(html, /aria-expanded="false"/);
    assert.equal(html.includes('disabled=""'), disabled);
  }
  const menu = source("components/home/aqua-position-options.tsx");
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /Close position/);
  assert.match(menu, /Add into existing position/);
  assert.match(menu, /onAddPosition\(\)/);
  assert.doesNotMatch(menu, /replaceSavings|shipSavings/);
  assert.match(menu, /event.key === "Escape"/);
  assert.match(menu, /event.stopPropagation\(\)/);
  assert.match(menu, /trigger.current\?\.focus\(\)/);
  assert.match(menu, /document.addEventListener\("pointerdown", outside\)/);
  const details = source("components/home/onchain-details-sheet.tsx");
  assert.doesNotMatch(details, /Refresh wallet|RefreshCw/);
  assert.match(
    details,
    /disabled=\{busy \|\| live.isError \|\| !live.data\?\.positionActive\}/,
  );
  assert.match(
    details,
    /if \(\(closingPosition \|\| addingPosition\) && canManage\) return;/,
  );
  assert.match(details, /<CloseAquaPositionSheet/);
  assert.match(
    source("components/home/home-app-shell.tsx"),
    /canManage=\{!kidMode\}/,
  );
});

test("closing stays locked through confirmation, validates the actual parent call, and refreshes live position state", () => {
  const sheet = source("components/home/close-aqua-position-sheet.tsx");
  assert.match(sheet, /lock.current = true;\s*setBusy\(true\)/);
  assert.match(
    sheet,
    /await execute\(\s*"dockSavings",[\s\S]*?expectedPosition: selected[\s\S]*?setComplete\(true\)/,
  );
  assert.match(sheet, /finally \{\s*lock.current = false;\s*setBusy\(false\)/);
  assert.match(sheet, /if \(lock.current\) return;/);
  assert.match(sheet, /if \(complete\) onDone\(\);\s*else onClose\(\)/);
  assert.match(sheet, /family.parent.toLowerCase\(\)/);
  assert.doesNotMatch(
    sheet,
    /family\?\.active|state.paused|position.data\?\.paused|setInterval|setTimeout/,
  );
  const intents = source("components/home/use-star-intents.ts");
  assert.match(
    intents,
    /action === "dockSavings"[\s\S]*?signerRole !== "PARENT"/,
  );
  assert.match(
    intents,
    /validateDockSavingsIntents\(envelope, family.vault.id\)/,
  );
  assert.match(
    intents,
    /validateClosePositionState\(state, options.expectedPosition\)/,
  );
  assert.match(
    intents,
    /await publicClient.simulateContract\(\{[\s\S]*?functionName: "dockSavingsPosition"/,
  );
  assert.match(
    intents,
    /action === "dockSavings"[\s\S]*?action === "addSavings"[\s\S]*?aquaPositionKey\(family.vault.id\)[\s\S]*?aquaTopUpKey\(family.vault.id\)[\s\S]*?queryClient.invalidateQueries/,
  );
});
