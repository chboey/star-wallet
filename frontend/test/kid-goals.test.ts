import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  kidGoalsHref,
  kidGoalState,
  kidGoalTab,
  kidGoalTabs,
} from "../src/lib/kid-goals";
import { KidGoalTabs } from "../src/components/home/kid-goal-feedback";
import type {
  StarChild,
  StarGoal,
  StarRedemption,
} from "../src/lib/star-api.types";

const goal: StarGoal = {
  id: "1",
  title: "Game",
  starCost: "10",
  allocatedStars: "0",
  status: "ACTIVE",
  createdAt: "1",
  updatedAt: "1",
  child: { id: "9" },
};
const child: StarChild = {
  id: "9",
  wallet: "0x0000000000000000000000000000000000000009",
  ensName: "kid.star.eth",
  ensNode: "0x00",
  active: true,
  starBalance: "10",
  reservedStars: "0",
  totalStarsIssued: "10",
  totalStarsBurned: "0",
  totalPrincipalContributed: "0",
};
const redemption = (status: StarRedemption["status"]): StarRedemption => ({
  id: "claim-1",
  goal,
  child: { id: child.id },
  reservedStars: "10",
  status,
  requestedAt: "1",
  requestTransactionHash: "0x00",
});
test("Goals exposes exactly Ongoing, Ready to claim and Completed", () => {
  assert.deepEqual(
    kidGoalTabs.map(({ label }) => label),
    ["Ongoing", "Ready to claim", "Completed"],
  );
  for (const { id, label } of kidGoalTabs) {
    const html = renderToStaticMarkup(createElement(KidGoalTabs, { tab: id }));
    assert.equal((html.match(/<button/g) ?? []).length, 3);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.match(html, new RegExp(`aria-pressed="true">${label}</button>`));
    assert.doesNotMatch(html, /Rewards|Available/);
  }
});

test("goal tabs invoke the matching selection", () => {
  const selected: string[] = [];
  const tabs = KidGoalTabs({
    tab: "ongoing",
    onChange: (id) => selected.push(id),
  });
  for (const button of tabs.props.children) button.props.onClick();
  assert.deepEqual(selected, ["ongoing", "ready", "completed"]);
});

test("active goals use explicit on-chain allocation, never automatically fill from available Stars", () => {
  const ongoing = kidGoalState(
    { ...goal, allocatedStars: "8" },
    {
      ...child,
      starBalance: "14",
      reservedStars: "6",
    },
  )!;
  assert.equal(ongoing.tab, "ongoing");
  assert.equal(ongoing.progress, 8n);
  assert.equal(ongoing.percentage, 80);
  assert.equal(ongoing.canRequest, false);
  const ready = kidGoalState(
    { ...goal, allocatedStars: "10" },
    { ...child, reservedStars: "10" },
  )!;
  assert.equal(ready.tab, "ready");
  assert.equal(ready.canRequest, true);
  assert.equal(ready.progress, 10n);
  const untouched = kidGoalState(goal, { ...child, starBalance: "30" })!;
  assert.equal(untouched.progress, 0n);
  assert.equal(untouched.percentage, 0);
  assert.equal(untouched.tab, "ongoing");
  assert.equal(untouched.canRequest, false);
  assert.equal(
    kidGoalState({ ...goal, allocatedStars: undefined }, child)?.progress,
    0n,
  );
});

test("requesting and approving a claim move one goal through the appropriate tabs", () => {
  const snapshots = [
    kidGoalState(goal, { ...child, starBalance: "4" }),
    kidGoalState(
      { ...goal, allocatedStars: "10" },
      { ...child, reservedStars: "10" },
    ),
    kidGoalState(goal, {
      ...child,
      reservedStars: "10",
      redemptions: [redemption("PENDING")],
    }),
    kidGoalState(goal, {
      ...child,
      starBalance: "0",
      redemptions: [redemption("APPROVED")],
    }),
  ];
  assert.deepEqual(
    snapshots.map((state) => state?.tab),
    ["ongoing", "ready", "ready", "completed"],
  );
  const pending = snapshots[2]!;
  assert.equal(pending.stars, 0n);
  assert.equal(
    pending.progress,
    10n,
    "Reserved Stars must not make this goal look unfunded",
  );
  assert.equal(pending.percentage, 100);
  assert.equal(pending.waiting, true);
  assert.equal(pending.canRequest, false);
  assert.equal(pending.reservedStars, "10");
  const completed = snapshots[3]!;
  assert.equal(
    completed.completed,
    true,
    "An approved redemption is authoritative even before goal metadata updates",
  );
  assert.equal(completed.waiting, false);
  assert.equal(completed.canRequest, false);
});

test("confirmed-but-unindexed requests stay Ready and cannot be requested twice", () => {
  const state = kidGoalState(goal, child, true)!;
  assert.equal(state.tab, "ready");
  assert.equal(state.waiting, true);
  assert.equal(state.canRequest, false);
  assert.equal(state.progress, 10n);
});

test("cancelled or rejected claims release a goal back to the correct non-completed tab", () => {
  for (const status of ["CANCELLED", "REJECTED"] as const) {
    const released = { ...child, redemptions: [redemption(status)] };
    const ongoing = kidGoalState(goal, released)!;
    assert.equal(ongoing.tab, "ongoing");
    assert.equal(ongoing.waiting, false);
    assert.equal(ongoing.canRequest, false);
    assert.equal(ongoing.progress, 0n);
    assert.equal(
      kidGoalState({ ...goal, allocatedStars: "10" }, released)?.tab,
      "ready",
    );
    assert.equal(
      kidGoalState(goal, { ...released, starBalance: "4" })?.tab,
      "ongoing",
    );
  }
});

test("completed goals stay Completed after Stars are burned and ignore stale pending state", () => {
  const completed = { ...goal, status: "COMPLETED" as const };
  assert.equal(
    kidGoalState(completed, { ...child, starBalance: "0" })?.tab,
    "completed",
  );
  const state = kidGoalState(
    goal,
    {
      ...child,
      redemptions: [
        redemption("PENDING"),
        { ...redemption("APPROVED"), id: "claim-2" },
      ],
    },
    true,
  )!;
  assert.equal(state.tab, "completed");
  assert.equal(state.waiting, false);
  assert.equal(state.pending, undefined);
  assert.equal(state.canRequest, false);
});

test("cancelled goals and other children's records never become claimable entries", () => {
  assert.equal(kidGoalState({ ...goal, status: "CANCELLED" }, child), null);
  assert.equal(kidGoalState({ ...goal, child: { id: "10" } }, child), null);
  for (const status of ["PENDING", "APPROVED"] as const) {
    const sibling = { ...redemption(status), child: { id: "10" } };
    const unrelated = {
      ...redemption(status),
      id: "claim-2",
      goal: { ...goal, id: "2" },
    };
    const state = kidGoalState(goal, {
      ...child,
      starBalance: "0",
      redemptions: [sibling, unrelated],
    })!;
    assert.equal(state.tab, "ongoing");
    assert.equal(state.waiting, false);
  }
});

test("inactive accounts and zero-cost goals cannot submit a claim", () => {
  assert.equal(
    kidGoalState({ ...goal, allocatedStars: "10" }, { ...child, active: false })
      ?.canRequest,
    false,
  );
  assert.equal(
    kidGoalState(
      { ...goal, allocatedStars: "10" },
      {
        ...child,
        family: { id: "7", ensNode: "0x00", active: false },
      },
    )?.canRequest,
    false,
  );
  const state = kidGoalState({ ...goal, starCost: "0" }, child)!;
  assert.equal(state.canRequest, false);
  assert.equal(state.percentage, 0);
});

test("Goals links preserve the selected goal and status without accepting invalid tabs", () => {
  assert.equal(kidGoalsHref(), "/wallet/kid/journey?section=goals");
  const url = new URL(
    kidGoalsHref({ goalId: "7:1 & 2", tab: "completed" }),
    "https://example.test",
  );
  assert.equal(url.searchParams.get("section"), "goals");
  assert.equal(url.searchParams.get("tab"), "completed");
  assert.equal(url.searchParams.get("goal"), "7:1 & 2");
  assert.equal(kidGoalTab("ready"), "ready");
  assert.equal(kidGoalTab("completed"), "completed");
  for (const value of [
    undefined,
    "ongoing",
    "available",
    "rewards",
    "nonsense",
  ])
    assert.equal(kidGoalTab(value), "ongoing");
});
