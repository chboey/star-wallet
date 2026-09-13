import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateAquaPositionCard } from "../src/components/home/create-aqua-position-card";

const render = (
  props: Partial<Parameters<typeof CreateAquaPositionCard>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(CreateAquaPositionCard, { onCreate() {}, ...props }),
  );

test("dedicated Aqua creation card has a plus and action label, not generic empty-state text", () => {
  const html = render();
  assert.match(html, /class="create-aqua-position-card"/);
  assert.match(html, /aria-label="Create Aqua position"/);
  assert.match(html, /lucide-plus/);
  assert.match(html, />Create Aqua position<\/span>/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.doesNotMatch(
    html,
    /No data for this section|section-empty-state|disabled=""/,
  );
  let opened = false;
  const card = CreateAquaPositionCard({
    onCreate: () => {
      opened = true;
    },
  });
  card.props.onClick();
  assert.equal(opened, true);
});

test("checking and unavailable states preserve the dedicated card and prevent creation", () => {
  const checking = render({ checking: true });
  assert.match(checking, /aria-busy="true" disabled=""/);
  assert.match(checking, /Checking savings position/);
  assert.doesNotMatch(checking, /No data|wallet-fullscreen-loader/);
  const paused = render({
    disabled: true,
    note: "Aqua is paused for this vault.",
  });
  assert.match(paused, /disabled=""/);
  assert.match(paused, /Aqua is paused for this vault/);
  assert.doesNotMatch(paused, /No data for this section/);
});
