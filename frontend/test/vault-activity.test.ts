import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VaultActivityContent } from "../src/components/home/vault-activity-sheet";
import type { ActivityPresentation } from "../src/components/home/star-activity";

const row: ActivityPresentation = {
  id: "contribution-1",
  title: "Principal contributed",
  detail: "Jasmine · Yesterday",
  amount: "+14",
  currency: "USDC",
  incoming: true,
  homeIllustration: "usdc",
  kidIllustration: "star_sparkle",
};
const defaults = {
  rows: [row],
  loading: false,
  loadingMore: false,
  hasMore: false,
  onLoadMore: () => {},
};
const render = (
  props: Partial<Parameters<typeof VaultActivityContent>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(VaultActivityContent, { ...defaults, ...props }),
  );

test("vault activity shows only the existing activity rows, with no carousel or funding controls", () => {
  const html = render();
  assert.match(html, /Principal contributed/);
  assert.match(html, /Jasmine · Yesterday/);
  assert.match(html, /\+14/);
  assert.match(html, /USDC/);
  assert.match(html, /is-incoming/);
  assert.doesNotMatch(
    html,
    /carousel|Vault panels|Add WETH|<form|<input|inert=/,
  );
});

test("empty and failed activity reads keep their existing feedback", () => {
  assert.match(render({ rows: [] }), /No data for this section/);
  assert.match(
    render({ rows: [], error: "Unable to load activity." }),
    /Unable to load activity/,
  );
  assert.doesNotMatch(
    render({ rows: [], error: "Unable to load activity." }),
    /No data for this section/,
  );
});

test("only initial empty activity loading shows the full-screen spinner", () => {
  assert.match(render({ rows: [], loading: true }), /wallet-fullscreen-loader/);
  assert.doesNotMatch(render({ loading: true }), /wallet-fullscreen-loader/);
  assert.match(render({ loading: true }), /Principal contributed/);
});

test("older activity pagination remains available with its disabled loading state", () => {
  assert.doesNotMatch(render(), /Load older activity/);
  assert.match(render({ hasMore: true }), />Load older activity<\/button>/);
  assert.match(
    render({ hasMore: true, loadingMore: true }),
    /disabled="">Loading…<\/button>/,
  );
});
