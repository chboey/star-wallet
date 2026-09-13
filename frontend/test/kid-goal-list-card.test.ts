import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StarGoal } from "../src/lib/star-api.types";
import { KidGoalListCard } from "../src/components/home/kid-goal-list-card";

const goal: StarGoal = {
  id: "1",
  title: "Game",
  icon: 4,
  starCost: "10",
  status: "COMPLETED",
  createdAt: "1",
  updatedAt: "1",
};
const render = (props: Partial<Parameters<typeof KidGoalListCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(KidGoalListCard, {
      goal,
      stars: 0n,
      onOpen() {},
      ...props,
    }),
  );

test("completed goal cards show only their illustration, title and navigation arrow", () => {
  for (const stars of [0n, 4n, 100n]) {
    for (const pending of [false, true]) {
      const html = render({ stars, pending });
      assert.match(
        html,
        /illustrations%2Fkid%2Fconsole.png|illustrations\/kid\/console.png/,
      );
      assert.match(html, /<strong>Game<\/strong>/);
      assert.match(html, /lucide-chevron-right/);
      assert.doesNotMatch(
        html,
        /Completed|<small>|kid-mini-progress|lucide-check|lucide-clock|Waiting for parent|Stars to go|Ready to claim|\d+ \/ \d+/,
      );
      assert.equal((html.match(/<svg\b/g) ?? []).length, 1);
    }
  }
});

test("ongoing goals retain their progress and pending-parent feedback", () => {
  const activeGoal = { ...goal, status: "ACTIVE" as const };
  const ongoing = render({ goal: activeGoal, stars: 4n });
  assert.match(ongoing, /6 Stars to go/);
  assert.match(ongoing, /kid-mini-progress/);
  assert.match(ongoing, /width:40%/);
  assert.match(ongoing, /4 \/ 10/);
  const pending = render({ goal: activeGoal, stars: 10n, pending: true });
  assert.match(pending, /Waiting for parent/);
  assert.doesNotMatch(pending, /kid-mini-progress/);
  assert.match(render({ goal: activeGoal, stars: 15n }), /Ready to claim/);
});

test("the simplified completed card still opens the selected goal", () => {
  let opened = false;
  KidGoalListCard({
    goal,
    stars: 0n,
    onOpen: () => {
      opened = true;
    },
  }).props.onClick();
  assert.equal(opened, true);
});

test("an approved redemption keeps the card minimal while goal metadata catches up", () => {
  const html = render({ goal: { ...goal, status: "ACTIVE" }, completed: true });
  assert.match(html, /<strong>Game<\/strong>/);
  assert.match(html, /lucide-chevron-right/);
  assert.doesNotMatch(
    html,
    /<small>|kid-mini-progress|lucide-check|lucide-clock/,
  );
});
