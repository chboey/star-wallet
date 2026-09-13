import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Node renders the real card; only Next's CSS-module import needs a test loader.
const requireCard = createRequire(import.meta.url);
const previousCssLoader = requireCard.extensions[".css"];
requireCard.extensions[".css"] = (module) => {
  module.exports = Object.fromEntries(
    [
      "questCard",
      "questCopy",
      "questChevron",
      "questSummary",
      "questLink",
      "questDetails",
    ].map((name) => [name, name]),
  );
};
const { QuestCard } = (() => {
  try {
    return requireCard(
      "../src/components/home/quest-card",
    ) as typeof import("../src/components/home/quest-card");
  } finally {
    if (previousCssLoader) requireCard.extensions[".css"] = previousCssLoader;
    else delete requireCard.extensions[".css"];
  }
})();

const render = (props: Partial<Parameters<typeof QuestCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(QuestCard, {
      title: "Please add 10 Stars to my account.",
      stars: "10",
      ...props,
    }),
  );

test("completed-tab request cards are static even with an initially open or leftover child element", () => {
  for (const status of ["APPROVED", "REJECTED", "CANCELLED"]) {
    const html = render({
      subtitle: `Valarie · Star request · ${status.toLowerCase()}`,
      expandable: false,
      initiallyOpen: true,
      children: createElement("span", null, "Old status content"),
    });
    assert.match(html, /<article class="questCard">/);
    assert.match(html, /Please add 10 Stars to my account/);
    assert.ok(html.includes(status.toLowerCase()));
    assert.doesNotMatch(
      html,
      /<details|<summary|questChevron|lucide-chevron|Old status content/,
    );
  }
});

test("empty conditional children do not create a dropdown", () => {
  const html = render({ children: [false, null, undefined, false] });
  assert.match(html, /<article/);
  assert.doesNotMatch(html, /<details|<summary|questChevron/);
});

test("pending actions open a popup from a right-chevron card, never an inline dropdown", () => {
  const pending = render({
    expandable: true,
    initiallyOpen: true,
    children: createElement("button", null, "Cancel request"),
  });
  assert.match(pending, /<button class="questCard questSummary questLink"/);
  assert.match(pending, /questChevron/);
  assert.doesNotMatch(pending, /<details|<summary|Cancel request/);
  const link = render({ onOpen() {} });
  assert.match(link, /<button class="questCard questSummary questLink"/);
  assert.match(link, /questChevron/);
  assert.doesNotMatch(link, /<details/);
});

test("parents review pending requests in a separate sheet and submitted kid quests stay non-cancellable", () => {
  const source = readFileSync(
    new URL("../src/components/home/quest-inbox.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /expandable=\{\s*childOnly &&\s*request.status === "PENDING" &&\s*!request.quest/,
  );
  assert.match(source, /!childOnly && request.status === "PENDING"/);
  assert.match(source, /setReviewRequest\(request\)/);
  assert.match(source, /<RequestReviewSheet[\s\S]*?request=\{reviewRequest\}/);
});
