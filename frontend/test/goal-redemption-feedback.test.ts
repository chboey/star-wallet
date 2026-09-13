import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KidGoalFeedback } from "../src/components/home/kid-goal-feedback";
import { kidGoalState, type KidGoalState } from "../src/lib/kid-goals";
import type { StarChild, StarGoal } from "../src/lib/star-api.types";

const goal: StarGoal = {
  id: "1",
  title: "Game",
  starCost: "10",
  allocatedStars: "10",
  status: "ACTIVE",
  createdAt: "1",
  updatedAt: "1",
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
const render = (state: KidGoalState, busy = false) =>
  renderToStaticMarkup(
    createElement(KidGoalFeedback, { state, busy, onRequest() {} }),
  );

const source = readFileSync(
  new URL(
    "../src/components/home/screens/kid-goals-screen.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("the goal redemption action spins inside the purple button while processing", () => {
  const state = kidGoalState(goal, child)!;
  const idle = render(state);
  assert.match(idle, /aria-busy="false"/);
  assert.doesNotMatch(idle, /disabled|lucide-loader-circle/);
  const button = render(state, true);
  assert.match(
    button,
    /<button[^>]*filled-action-button kid-primary-action[^>]*disabled=""[^>]*aria-busy="true"/,
  );
  assert.match(
    button,
    /<svg[^>]*lucide-loader-circle[^>]*spin[^>]*aria-hidden="true"/,
  );
  assert.match(button, /Ask parent to redeem/);
  assert.doesNotMatch(button, /ActionStatus|Preparing|Transaction confirmed/);
  assert.match(source, /<KidGoalFeedback\s+state=\{selected\}\s+busy=\{busy\}/);
  assert.match(
    source,
    /onRequest=\{\(\) => void requestRedemption\(selectedGoal\)\}/,
  );
});

test("the button keeps spinning if indexed state arrives before the request finishes", () => {
  const waiting = kidGoalState(goal, child, true)!;
  const completed = kidGoalState({ ...goal, status: "COMPLETED" }, child)!;
  for (const state of [waiting, completed]) {
    const html = render(state, true);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /lucide-loader-circle/);
    assert.doesNotMatch(html, /Waiting for parent|Redeemed on-chain/);
  }
});

test("waiting goals show reserved Stars and never offer a duplicate claim", () => {
  const html = render(kidGoalState(goal, child, true)!);
  assert.match(html, /Waiting for parent/);
  assert.match(
    html,
    /illustrations%2Fkid%2Fclock\.png|illustrations\/kid\/clock\.png/,
  );
  assert.doesNotMatch(html, /<button|Ask parent to redeem|Need .* more Stars/);
});

test("not-yet-funded goals show a disabled action with the remaining Stars", () => {
  const html = render(kidGoalState({ ...goal, allocatedStars: "4" }, child)!);
  assert.match(html, /disabled=""/);
  assert.match(html, /Add 6 more Stars to this goal/);
  assert.doesNotMatch(html, /lucide-loader-circle/);
});

test("redemption busy feedback covers the entire request and duplicate clicks are locked until it settles", () => {
  assert.match(
    source,
    /if \(requestLock.current\) return;[^]*?requestLock.current = true;\s*setBusy\(true\);\s*try/,
  );
  assert.match(
    source,
    /await execute\("requestRedemption", \{ goalId: goal.id \}, "CHILD"\);\s*setConfirmedRequests[^]*?setRequestSent\(true\)/,
  );
  assert.match(
    source,
    /finally \{\s*requestLock.current = false;\s*setBusy\(false\)/,
  );
  assert.match(
    source,
    /const backToList = \(\) => \{\s*if \(requestLock.current\) return/,
  );
  assert.match(source, /backDisabled=\{busy\}/);
  assert.doesNotMatch(
    source,
    /operation.state === "signing" \|\| operation.state === "indexing"/,
  );
});

test("the unified goal detail keeps redeemed confirmations on one centered line", () => {
  const html = render(kidGoalState({ ...goal, status: "COMPLETED" }, child)!);
  assert.match(html, /class="kid-ready-message kid-redeemed-message"/);
  assert.match(html, /lucide-check[^>]*aria-hidden="true"/);
  assert.match(html, /<\/svg><span>Redeemed on-chain<\/span>/);
  assert.doesNotMatch(html, /<button|lucide-loader-circle|Waiting for parent/);
  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  const redeemed =
    css.match(/\.kid-ready-message\.kid-redeemed-message\s*\{([^}]+)\}/)?.[1] ??
    "";
  assert.match(redeemed, /display: flex/);
  assert.match(redeemed, /align-items: center/);
  assert.match(redeemed, /justify-content: center/);
  assert.match(redeemed, /gap: 6px/);
  assert.match(redeemed, /white-space: nowrap/);
  assert.match(css, /\.kid-redeemed-message > svg\s*\{\s*flex-shrink: 0/);
  const ready = css.match(/\.kid-ready-message\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.doesNotMatch(ready, /white-space: nowrap/);
});
