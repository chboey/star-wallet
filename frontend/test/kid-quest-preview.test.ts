import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  Children,
  createElement,
  isValidElement,
  type ComponentProps,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KidQuestPreview } from "../src/components/home/kid-quest-preview";
import type { Quest } from "../src/lib/quest-types";

const quest: Quest = {
  id: "quest-7",
  questId: "7",
  workflow: "0x1111111111111111111111111111111111111111",
  child: {
    id: "child-2",
    wallet: "0x2222222222222222222222222222222222222222",
    ensName: "jasmine.starwallet.eth",
  },
  title: "Finish homework",
  // The actual reward must win over the preset's suggested four Stars.
  stars: "19",
  status: "ACTIVE",
  createdAt: "1",
  updatedAt: "1",
};

type Props = ComponentProps<typeof KidQuestPreview>;
const defaults: Props = {
  quest,
  started: false,
  busy: false,
  disabled: false,
  onBack: () => {},
  onStart: () => {},
  onSubmit: () => {},
};

const render = (overrides: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(KidQuestPreview, { ...defaults, ...overrides }),
  );

function primaryAction(overrides: Partial<Props> = {}) {
  const preview = KidQuestPreview({ ...defaults, ...overrides });
  const button = Children.toArray(preview.props.children).find(
    (node) => isValidElement(node) && node.type === "button",
  );
  assert.ok(isValidElement<{ onClick: () => void; disabled: boolean }>(button));
  return button.props;
}

test("quest preview shows the existing large illustration, instructions and actual assigned reward", () => {
  const html = render();
  assert.match(html, /pencil/);
  assert.match(html, /width="240"/);
  assert.match(html, /<h2>Finish homework<\/h2>/);
  assert.match(html, /Finish your homework and check your work/);
  assert.match(html, /aria-label="19 Stars"/);
  assert.doesNotMatch(html, /aria-label="4 Stars"/);
  assert.match(html, /kid-screen-header/);
  assert.match(html, /aria-label="Go back"/);
  assert.match(html, />Start Quest<\/button>/);
  assert.doesNotMatch(html, /Request Stars|<details/);
  assert.doesNotMatch(html, /role="timer"|kid-quest-illustration-floating/);
});

test("starting a quest does not submit it; completion uses a separate explicit action", () => {
  let starts = 0;
  let submissions = 0;
  const callbacks = {
    onStart: () => {
      starts += 1;
    },
    onSubmit: () => {
      submissions += 1;
    },
  };
  primaryAction(callbacks).onClick();
  assert.equal(starts, 1);
  assert.equal(submissions, 0);
  primaryAction({ ...callbacks, started: true }).onClick();
  assert.equal(starts, 1);
  assert.equal(submissions, 1);
  const html = render({ started: true });
  assert.match(html, />I&#x27;m done<\/button>/);
  assert.match(html, /role="timer"[^>]*>00:00<\/strong>/);
  assert.match(html, /kid-quest-illustration-floating/);
  assert.doesNotMatch(
    html,
    /When you’re finished|kid-quest-preview-note|aria-label="19 Stars"|>Reward</,
  );
  assert.doesNotMatch(html, />Start Quest<\/button>/);
});

test("the quest timer cleans up on exit and the floating illustration respects reduced motion", () => {
  const source = readFileSync(
    new URL("../src/components/home/kid-quest-preview.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Date.now\(\) - startedAt/);
  assert.match(source, /window.setInterval\(update, 1000\)/);
  assert.match(source, /window.clearInterval\(interval\)/);
  assert.match(
    source,
    /document.removeEventListener\("visibilitychange", update\)/,
  );
  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /animation: kid-quest-hover 3s ease-in-out infinite/);
  assert.match(
    css,
    /prefers-reduced-motion: reduce\)\s*\{\s*\.kid-quest-illustration-floating\s*\{\s*animation: none/,
  );
});

test("busy and unavailable previews disable the action without duplicating the status in its label", () => {
  const html = render({
    started: true,
    busy: true,
  });
  assert.equal(primaryAction({ busy: true }).disabled, true);
  assert.equal(primaryAction({ disabled: true }).disabled, true);
  assert.match(html, /aria-label="Go back" disabled=""/);
  assert.match(html, />I&#x27;m done<\/button>/);
  assert.doesNotMatch(
    html,
    /Preparing your request|Transaction confirmed|Updating your wallet|action-status/,
  );
  const button = html.match(
    /<button class="filled-action-button kid-quest-preview-action"[\s\S]*?<\/button>/,
  )?.[0];
  assert.ok(button);
  assert.match(button, /aria-busy="true"/);
  assert.match(button, /<svg[^>]*class="[^"]*spin/);
  assert.match(button, /disabled=""/);
  assert.equal((html.match(/class="[^"]*\bspin\b/g) ?? []).length, 1);
});

test("quest action clears its spinner after success or error and does not spin just because it is unavailable", () => {
  for (const overrides of [{}, { error: "Try again" }, { disabled: true }]) {
    const html = render({ started: true, ...overrides });
    const button = html.match(
      /<button class="filled-action-button kid-quest-preview-action"[\s\S]*?<\/button>/,
    )?.[0];
    assert.ok(button);
    assert.match(button, /aria-busy="false"/);
    assert.doesNotMatch(button, /<svg|spin/);
  }
});

test("a quest that is no longer active cannot be submitted again", () => {
  for (const status of ["SUBMITTED", "COMPLETED", "CANCELLED"] as const) {
    assert.equal(
      primaryAction({ quest: { ...quest, status }, started: true }).disabled,
      true,
    );
  }
});

test("custom quests retain their title and do not get unrelated preset instructions", () => {
  const html = render({
    quest: { ...quest, title: "Help Grandma" },
    error: "Please try again.",
  });
  assert.match(html, /<h2>Help Grandma<\/h2>/);
  assert.match(html, /star_sparkle/);
  assert.match(html, /Ask them if you need more details/);
  assert.doesNotMatch(html, /check your work|30 minutes/);
  assert.match(html, /role="alert"/);
  assert.match(html, /<span>Please try again\.<\/span>/);
  assert.ok(
    html.indexOf("action-status-error") <
      html.indexOf("kid-quest-preview-action"),
  );
});
