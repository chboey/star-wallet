import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { goalIcons } from "../src/lib/goal-requests";
import type { StarActivity, StarGoal } from "../src/lib/star-api.types";
import { HomeIllustration } from "../src/components/home/home-ui";
import { KidIllustration } from "../src/components/home/kid-ui";
import {
  presentActivity,
  presentRecentActivities,
} from "../src/components/home/star-activity";

const goal: StarGoal = {
  id: "1",
  title: "Game",
  starCost: "1",
  status: "ACTIVE",
  createdAt: "1",
  updatedAt: "1",
  child: { id: "1" },
};
const activity: StarActivity = {
  id: "0x01",
  type: "GOAL_CREATED",
  amount: "1",
  timestamp: "1",
  transactionHash: "0x01",
  blockNumber: "1",
  logIndex: "0",
  sequence: "1",
  child: { id: "1" },
  goal: { id: goal.id },
};
const goalEvents = [
  "GOAL_CREATED",
  "GOAL_STARS_ADDED",
  "GOAL_COMPLETED",
  "GOAL_CANCELLED",
  "REDEMPTION_REQUESTED",
  "REDEMPTION_APPROVED",
  "REDEMPTION_REJECTED",
  "REDEMPTION_CANCELLED",
] as const;
const renderArtwork = (row: ReturnType<typeof presentActivity>) =>
  [
    createElement(HomeIllustration, {
      name: row.homeIllustration,
      collection: row.homeIllustrationCollection,
      alt: "",
      size: 48,
    }),
    createElement(KidIllustration, {
      name: row.kidIllustration,
      alt: "",
      size: 48,
    }),
  ].map((element) => decodeURIComponent(renderToStaticMarkup(element)));

test("all seven goal icons keep their saved artwork through every activity status in both views", () => {
  for (const icon of goalIcons) {
    assert.ok(
      existsSync(
        new URL(
          `../public/illustrations/kid/${icon.illustration}.png`,
          import.meta.url,
        ),
      ),
    );
    for (const type of goalEvents) {
      for (const kidPerspective of [false, true]) {
        const row = presentActivity(
          { ...activity, type },
          {
            children: [],
            rewards: [],
            goals: [{ ...goal, title: "My special wish", icon: icon.id }],
          },
          kidPerspective,
        );
        const context = `${icon.label}: ${type}, kidPerspective=${kidPerspective}`;
        assert.equal(row.homeIllustration, icon.illustration, context);
        assert.equal(row.kidIllustration, icon.illustration, context);
        assert.equal(row.homeIllustrationCollection, "kid", context);
        for (const html of renderArtwork(row)) {
          assert.ok(
            html.includes(`/illustrations/kid/${icon.illustration}.png`),
            context,
          );
          assert.doesNotMatch(
            html,
            /\/illustrations\/home\/|\/tick\.png/,
            context,
          );
        }
      }
    }
  }
});

test("older goals without saved icons keep consistent title-based artwork through the same lifecycle", () => {
  for (const [title, expected] of [
    ["Game", "console"],
    ["New console", "console"],
    ["Books", "books"],
    ["Bicycle", "bicycle_sparkle"],
    ["Toy", "teddy_bear_sparkle"],
    ["Art Set", "paint"],
    ["Rocket", "rocket_sparkle"],
    ["A wish", "star_sparkle"],
  ]) {
    assert.ok(
      existsSync(
        new URL(`../public/illustrations/kid/${expected}.png`, import.meta.url),
      ),
    );
    for (const type of goalEvents) {
      const row = presentActivity(
        { ...activity, type },
        { children: [], rewards: [], goals: [{ ...goal, title }] },
      );
      assert.equal(row.homeIllustration, expected, `${title}: ${type}`);
      assert.equal(row.kidIllustration, expected, `${title}: ${type}`);
      assert.equal(row.homeIllustrationCollection, "kid");
    }
  }
});

test("the Game approved, requested and created preview uses the controller for all three rows", () => {
  const rows = presentRecentActivities(
    [
      { ...activity, id: "0x01", sequence: "1", type: "GOAL_CREATED" },
      {
        ...activity,
        id: "0x02",
        sequence: "2",
        type: "REDEMPTION_REQUESTED",
      },
      {
        ...activity,
        id: "0x03",
        sequence: "3",
        type: "REDEMPTION_APPROVED",
      },
    ],
    { children: [], goals: [{ ...goal, icon: 4 }], rewards: [] },
    true,
  );
  assert.deepEqual(
    rows.map(({ title }) => title),
    ["Game approved", "Game requested", "Game created"],
  );
  assert.deepEqual(
    rows.map(({ amount }) => amount),
    [null, "1", "1"],
  );
  assert.deepEqual(
    rows.map(({ currency }) => currency),
    [null, "STAR", "STAR"],
  );
  assert.ok(
    rows.every(
      (row) =>
        row.homeIllustration === "console" && row.kidIllustration === "console",
    ),
  );
});

test("artwork follows the goal ID, not the first goal or another goal with the same title", () => {
  for (const icon of goalIcons) {
    const row = presentActivity(
      { ...activity, type: "REDEMPTION_APPROVED" },
      {
        children: [],
        rewards: [],
        goals: [
          {
            ...goal,
            id: "other",
            title: "My wish",
            icon: (icon.id + 1) % goalIcons.length,
          },
          { ...goal, title: "My wish", icon: icon.id },
        ],
      },
    );
    assert.equal(row.homeIllustration, icon.illustration);
    assert.equal(row.kidIllustration, icon.illustration);
  }
});

test("unknown goals use a neutral fallback without borrowing another goal's illustration", () => {
  for (const type of goalEvents) {
    const row = presentActivity(
      { ...activity, type, goal: { id: "missing" } },
      {
        children: [],
        goals: [{ ...goal, icon: 4 }],
        rewards: [],
      },
    );
    assert.equal(row.homeIllustration, "star_sparkle");
    assert.equal(row.kidIllustration, "star_sparkle");
    for (const html of renderArtwork(row))
      assert.match(html, /\/illustrations\/kid\/star_sparkle\.png/);
  }
});

test("Star rewards and financial events keep their own artwork", () => {
  for (const [type, expected] of [
    ["STARS_REWARDED", "girl_star"],
    ["PRINCIPAL_CONTRIBUTED", "usdc"],
    ["STRATEGY_WETH_FUNDED", "weth"],
    ["FAMILY_VAULT_CREATED", "wallet"],
  ] as const) {
    const row = presentActivity(
      { ...activity, type },
      { children: [], goals: [{ ...goal, icon: 4 }], rewards: [] },
    );
    assert.equal(row.homeIllustration, expected);
    assert.equal(row.homeIllustrationCollection, undefined);
    assert.equal(row.kidIllustration, "star_sparkle");
    assert.ok(
      renderArtwork(row)[0].includes(`/illustrations/home/${expected}.png`),
    );
  }
});

test("both dashboards and full activity lists render the shared artwork presentation", () => {
  for (const file of [
    "screens/home-dashboard.tsx",
    "parent-activity-sheet.tsx",
  ]) {
    const source = readFileSync(
      new URL(`../src/components/home/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /name=\{row.homeIllustration\}/);
    assert.match(source, /collection=\{row.homeIllustrationCollection\}/);
  }
  for (const file of [
    "screens/kid-home-screen.tsx",
    "kid-activity-sheet.tsx",
  ]) {
    const source = readFileSync(
      new URL(`../src/components/home/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /name=\{row.kidIllustration\}/);
  }
});
