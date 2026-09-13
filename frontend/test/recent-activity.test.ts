import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { StarActivity, StarFamily } from "../src/lib/star-api.types";
import {
  isChildActivity,
  isVisibleActivity,
  presentRecentActivities,
} from "../src/components/home/star-activity";

const family = {
  children: [],
  goals: [],
  rewards: [],
  redemptions: [],
} as unknown as StarFamily;
const event = (
  sequence: string,
  options: Partial<StarActivity> = {},
): StarActivity => ({
  id: `0x${BigInt(sequence).toString(16)}`,
  type: "STARS_REWARDED",
  amount: "10",
  timestamp: "1",
  transactionHash: "0x01",
  blockNumber: "1",
  logIndex: "0",
  sequence,
  child: { id: "1" },
  ...options,
});

test("recent activity shows only the newest three events without truncating or mutating history", () => {
  const events = [event("2"), event("10"), event("3"), event("1"), event("9")];
  const original = structuredClone(events);
  const rows = presentRecentActivities(events, family);
  assert.deepEqual(
    rows.map((row) => row.id),
    [event("10").id, event("9").id, event("3").id],
  );
  assert.deepEqual(events, original);
  assert.equal(events.length, 5);
});

test("event ordering keeps full sequence precision when events share a timestamp", () => {
  const events = [
    event("9007199254740992"),
    event("9007199254740994"),
    event("9007199254740993"),
  ];
  assert.deepEqual(
    presentRecentActivities(events, family).map((row) => row.id),
    [events[1].id, events[2].id, events[0].id],
  );
});

test("short histories show only real events, including an empty feed", () => {
  for (const count of [0, 1, 2, 3]) {
    const events = Array.from({ length: count }, (_, index) =>
      event(String(index + 1)),
    );
    assert.equal(presentRecentActivities(events, family).length, count);
  }
});

test("recent funding activity includes its formatted USDC and WETH amounts", () => {
  const rows = presentRecentActivities(
    [
      event("2", {
        type: "STRATEGY_WETH_FUNDED",
        amount: "100000000000000",
      }),
      event("1", {
        type: "PRINCIPAL_CONTRIBUTED",
        amount: "5000000",
      }),
    ],
    family,
  );

  assert.deepEqual(
    rows.map(({ title, amount, currency }) => ({ title, amount, currency })),
    [
      { title: "WETH funded", amount: "+0.0001", currency: "WETH" },
      { title: "Principal contributed", amount: "+5", currency: "USDC" },
    ],
  );
});

test("goal completion rows are hidden for every goal while approval events and completed state are retained", () => {
  const goals = ["Game", "Bicycle", "Books"].map((title, index) => ({
    id: String(index + 1),
    title,
    status: "COMPLETED" as const,
    starCost: "10",
    allocatedStars: "0",
    createdAt: "1",
    updatedAt: "2",
    child: { id: "1" },
  }));
  const completedFamily = { ...family, goals };
  const original = structuredClone(completedFamily);
  for (const goal of goals) {
    const completion = event("2", {
      type: "GOAL_COMPLETED",
      goal: { id: goal.id },
    });
    const approval = event("1", {
      type: "REDEMPTION_APPROVED",
      goal: { id: goal.id },
    });
    assert.equal(isVisibleActivity(completion), false);
    assert.equal(isVisibleActivity(approval), true);
    for (const kidPerspective of [false, true]) {
      const rows = presentRecentActivities(
        [completion, approval],
        completedFamily,
        kidPerspective,
      );
      assert.deepEqual(
        rows.map((row) => row.title),
        [`${goal.title} approved`],
      );
    }
  }
  assert.deepEqual(completedFamily, original);
});

test("hidden completion rows do not consume any of the three recent activity slots", () => {
  const events = [
    event("7", { type: "GOAL_COMPLETED" }),
    event("6", { type: "CHILD_REGISTRATION_ACCEPTED" }),
    event("5"),
    event("4", { type: "GOAL_COMPLETED" }),
    event("3"),
    event("2"),
    event("1"),
  ];
  const original = structuredClone(events);
  for (const kidPerspective of [false, true]) {
    assert.deepEqual(
      presentRecentActivities(events, family, kidPerspective).map(
        (row) => row.id,
      ),
      [event("5").id, event("3").id, event("2").id],
    );
  }
  assert.deepEqual(events, original);
  assert.deepEqual(
    events.filter(isVisibleActivity).map((item) => item.sequence),
    ["5", "3", "2", "1"],
  );
  const sharedFeed = readFileSync(
    new URL("../src/components/home/use-family-activity.ts", import.meta.url),
    "utf8",
  );
  assert.match(sharedFeed, /\.filter\(isVisibleActivity\)/);
  for (const sheet of ["parent-activity-sheet", "kid-activity-sheet"]) {
    const source = readFileSync(
      new URL(`../src/components/home/${sheet}.tsx`, import.meta.url),
      "utf8",
    );
    assert.match(source, /useFamilyActivity\(\)/);
  }
});

test("visibility and child filters run before the three-event limit", () => {
  const events = [
    event("8", { type: "CHILD_REGISTRATION_ACCEPTED" }),
    event("7", { child: { id: "2" } }),
    event("6", { type: "PRINCIPAL_CONTRIBUTED" }),
    event("5"),
    event("4"),
    event("3"),
    event("2"),
  ];
  const visible = events.filter(isVisibleActivity);
  assert.deepEqual(
    presentRecentActivities(visible, family).map((row) => row.id),
    [event("7").id, event("6").id, event("5").id],
  );
  const childEvents = visible.filter(
    (activity) =>
      activity.type !== "PRINCIPAL_CONTRIBUTED" &&
      isChildActivity(activity, family, "1"),
  );
  const rows = presentRecentActivities(childEvents, family, true);
  assert.deepEqual(
    rows.map((row) => row.id),
    [event("5").id, event("4").id, event("3").id],
  );
  assert.ok(rows.every((row) => row.title === "You received 10 Stars"));
});

test("both home screens render the preview rows and keep See all connected to the full activity sheet", () => {
  for (const [file, input, sheet] of [
    ["home-dashboard", "activities, family", "ParentActivitySheet"],
    ["kid-home-screen", "childActivities, family, true", "KidActivitySheet"],
  ]) {
    const source = readFileSync(
      new URL(`../src/components/home/screens/${file}.tsx`, import.meta.url),
      "utf8",
    );
    assert.ok(source.includes(`presentRecentActivities(${input})`));
    assert.match(source, /recentActivities\.map\(\(row\) =>/);
    assert.match(source, /key=\{row.id\}/);
    assert.match(source, /onClick=\{\(\) => setActivityOpen\(true\)\}/);
    assert.ok(source.includes(`<${sheet} onClose=`));
    assert.doesNotMatch(source, /activities\[0\]|childActivities\[0\]/);
  }
});
