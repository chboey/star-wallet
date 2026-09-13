import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  Children,
  createElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FamilyVaultCard } from "../src/components/home/family-vault-card";
import { formatTokenAmount } from "../src/lib/star-format";

const defaults = {
  familyName: "Tan",
  usdc: "14",
  weth: "0.001234",
  onOpenActivity: () => {},
  onAddWeth: () => {},
};

test("vault card shows the actual inline USDC plus WETH balance and existing safe illustration", () => {
  const html = renderToStaticMarkup(createElement(FamilyVaultCard, defaults));
  assert.match(html, /Tan&#x27;s family vault/);
  assert.match(html, /family-vault-usdc">14 <small>USDC<\/small>/);
  assert.match(html, /family-vault-weth">\+ 0.001234 <small>WETH<\/small>/);
  assert.match(html, /family%2Fsafe.png|family\/safe.png/);
  assert.match(html, /family-vault-add-weth/);
  assert.match(html, /lucide-plus/);
  assert.doesNotMatch(html, /<p>|chevron-down/);
  const changed = renderToStaticMarkup(
    createElement(FamilyVaultCard, {
      ...defaults,
      usdc: "29.5",
      weth: "0",
    }),
  );
  assert.match(changed, /family-vault-usdc">29.5 /);
  assert.match(changed, /family-vault-weth">\+ 0 /);
});

test("allocating savings removes those amounts from the displayed available vault balance", () => {
  const before = {
    availableUsdc: 4_000_000n,
    availableWeth: 100_000_000_000_000n,
  };
  const after = { availableUsdc: 3_000_000n, availableWeth: 0n };
  for (const [balance, usdc, weth] of [
    [before, "4", "0.0001"],
    [after, "3", "0"],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(FamilyVaultCard, {
        ...defaults,
        usdc: formatTokenAmount(balance.availableUsdc, 6, 2),
        weth: formatTokenAmount(balance.availableWeth, 18, 6),
      }),
    );
    assert.ok(html.includes(`family-vault-usdc">${usdc} <small>USDC</small>`));
    assert.ok(
      html.includes(`family-vault-weth">+ ${weth} <small>WETH</small>`),
    );
  }
});

test("family overview wires the vault to live available funds, never combined or stale portfolio totals", () => {
  const source = readFileSync(
    new URL(
      "../src/components/home/screens/family-overview-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const card = source.match(/<FamilyVaultCard[\s\S]*?\/>/)?.[0] ?? "";
  assert.match(card, /usdc=\{usdcAvailable\}/);
  assert.match(card, /weth=\{wethAvailable\}/);
  assert.match(
    source,
    /const usdcAvailable = formatTokenAmount\(position.data\?\.availableUsdc, 6, 2\)/,
  );
  assert.match(
    source,
    /const wethAvailable = formatTokenAmount\(position.data\?\.availableWeth, 18, 6\)/,
  );
  assert.match(
    source,
    /const usdcPosition = formatTokenAmount\(position.data\?\.positionUsdc/,
  );
  assert.match(
    source,
    /const wethPosition = formatTokenAmount\(position.data\?\.positionWeth/,
  );
  assert.doesNotMatch(
    source,
    /totalAmount|usdcTotal|wethTotal|family && portfolio/,
  );
});

test("unknown available balances stay unknown instead of appearing funded or zero", () => {
  const html = renderToStaticMarkup(
    createElement(FamilyVaultCard, {
      ...defaults,
      usdc: formatTokenAmount(undefined, 6, 2),
      weth: formatTokenAmount(undefined, 18, 6),
    }),
  );
  assert.match(html, /family-vault-usdc">— /);
  assert.match(html, /family-vault-weth">\+ — /);
});

function buttons(node: ReactNode): ReactElement<{
  className: string;
  onClick: () => void;
  disabled?: boolean;
}>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    if (child.type === "button")
      return [
        child as ReactElement<{
          className: string;
          onClick: () => void;
          disabled?: boolean;
        }>,
      ];
    return buttons(child.props.children);
  });
}

test("the funding shortcut and the rest of the card invoke separate popup actions", () => {
  let activity = 0;
  let funding = 0;
  const card = FamilyVaultCard({
    ...defaults,
    onOpenActivity: () => {
      activity++;
    },
    onAddWeth: () => {
      funding++;
    },
  });
  assert.equal(card.type, "section");
  const actions = buttons(card);
  assert.equal(actions.length, 2);
  actions
    .find((button) => button.props.className === "family-vault-add-weth")!
    .props.onClick();
  assert.equal(funding, 1);
  assert.equal(activity, 0);
  actions
    .find((button) => button.props.className === "wallet-activity-trigger")!
    .props.onClick();
  assert.equal(activity, 1);
  assert.equal(funding, 1);
});

test("funding is disabled for an unavailable vault while its activity remains accessible", () => {
  const actions = buttons(
    FamilyVaultCard({ ...defaults, fundingDisabled: true }),
  );
  assert.equal(
    actions.find(
      (button) => button.props.className === "family-vault-add-weth",
    )!.props.disabled,
    true,
  );
  assert.notEqual(
    actions.find(
      (button) => button.props.className === "wallet-activity-trigger",
    )!.props.disabled,
    true,
  );
});
