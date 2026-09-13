import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { childAccountAbi } from "@star/contracts/abi";
import {
  encodeFunctionData,
  maxUint256,
  ContractFunctionZeroDataError,
} from "viem";
import {
  contributionAmount,
  contributionLimit,
  validateGoalContributionIntent,
  readGoalContribution,
  applyGoalContributionSnapshots,
  type GoalContributionSnapshot,
} from "../src/lib/goal-contributions";
import { GoalContributionContent } from "../src/components/home/goal-contribution-content";
import type { IntentEnvelope, StarFamily } from "../src/lib/star-api.types";
import { kidGoalState } from "../src/lib/kid-goals";

const wallet = "0x0000000000000000000000000000000000000001" as const;
const goalsAddress = "0x0000000000000000000000000000000000000002" as const;
const star = "0x0000000000000000000000000000000000000003" as const;
const plan: IntentEnvelope = {
  intents: [
    {
      chainId: 11155111,
      signerRole: "CHILD",
      to: wallet,
      value: "0",
      summary: "Add 5 Stars",
      data: encodeFunctionData({
        abi: childAccountAbi,
        functionName: "addStarsToGoal",
        args: [7n, 5n],
      }),
    },
  ],
};
const snapshot: GoalContributionSnapshot = {
  wallet,
  goalsAddress,
  childId: "9",
  goalId: "7",
  blockNumber: 101n,
  target: 10n,
  allocated: 5n,
  available: 10n,
  reservedStars: 5n,
  starBalance: 15n,
  status: 0,
  pendingId: 0n,
};
const source = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("only positive whole uint256 Stars can be selected and the limit respects available Stars and the remaining goal target", () => {
  for (const value of [
    "",
    "0",
    "-1",
    "1.1",
    "1e2",
    "Infinity",
    " 5",
    (maxUint256 + 1n).toString(),
  ])
    assert.equal(contributionAmount(value), null);
  assert.equal(contributionAmount("5"), 5n);
  assert.equal(contributionAmount(maxUint256.toString()), maxUint256);
  assert.equal(contributionLimit(15n, 40n, 32n), 8n);
  assert.equal(contributionLimit(3n, 40n, 32n), 3n);
  assert.equal(contributionLimit(15n, 40n, 40n), 0n);
});

test("the signed contribution pins the goal, amount, child, chain and zero value with exactly one canonical call", () => {
  const input = { wallet, goalId: "7", amount: "5" };
  validateGoalContributionIntent(plan, input);
  for (const change of [
    { to: goalsAddress },
    { value: "1" },
    { chainId: 1 },
    { signerRole: "PARENT" as const },
    {
      data: encodeFunctionData({
        abi: childAccountAbi,
        functionName: "addStarsToGoal",
        args: [8n, 5n],
      }),
    },
    {
      data: encodeFunctionData({
        abi: childAccountAbi,
        functionName: "addStarsToGoal",
        args: [7n, 6n],
      }),
    },
    {
      data: encodeFunctionData({
        abi: childAccountAbi,
        functionName: "requestRedemption",
        args: [7n],
      }),
    },
    { data: `${plan.intents[0].data}00` as `0x${string}` },
  ])
    assert.throws(() =>
      validateGoalContributionIntent(
        { intents: [{ ...plan.intents[0], ...change }] },
        input,
      ),
    );
  for (const intents of [[], [...plan.intents, ...plan.intents]])
    assert.throws(() => validateGoalContributionIntent({ intents }, input));
});

function reader(
  options: { childId?: bigint; version?: bigint; fail?: Error } = {},
) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    async getBlockNumber(args: Record<string, unknown>) {
      calls.push(args);
      return 101n;
    },
    async multicall(args: Record<string, unknown>) {
      calls.push(args);
      if (options.fail) throw options.fail;
      const functions = (args.contracts as { functionName: string }[]).map(
        (item) => item.functionName,
      );
      if (functions[0] === "goals")
        return [goalsAddress, options.version ?? 1n];
      if (functions[0] === "goalContributionsVersion") return [1n, star];
      return [
        { id: 7n, childId: options.childId ?? 9n, starCost: 10n, status: 0 },
        5n,
        10n,
        0n,
        5n,
        15n,
      ];
    },
    async readContract() {
      throw new Error("Unexpected unbatched read");
    },
  } as unknown as Parameters<typeof readGoalContribution>[0];
  return { client, calls };
}

test("popup checks read allocation and available Stars at one fresh block with no polling", async () => {
  const { client, calls } = reader();
  assert.deepEqual(
    await readGoalContribution(client, wallet, "9", "7"),
    snapshot,
  );
  assert.deepEqual(calls[0], { cacheTime: 0 });
  assert.equal(calls.length, 4);
  for (const call of calls.slice(1)) {
    assert.equal(call.blockNumber, 101n);
    assert.equal(call.allowFailure, false);
  }
  await assert.rejects(
    readGoalContribution(reader({ childId: 10n }).client, wallet, "9", "7"),
    /different child/,
  );
  await assert.rejects(
    readGoalContribution(reader({ version: 0n }).client, wallet, "9", "7"),
    /updated goal and child-account contracts/,
  );
  await assert.rejects(
    readGoalContribution(
      reader({
        fail: new ContractFunctionZeroDataError({
          functionName: "goalContributionsVersion",
        }),
      }).client,
      wallet,
      "9",
      "7",
    ),
    /updated goal and child-account contracts/,
  );
  const outage = new Error("RPC unavailable");
  await assert.rejects(
    readGoalContribution(reader({ fail: outage }).client, wallet, "9", "7"),
    (error) => error === outage,
  );
});

function family(): StarFamily {
  return {
    id: "1",
    children: [
      { id: "9", wallet, active: true, starBalance: "15", reservedStars: "0" },
    ],
    goals: [
      {
        id: "7",
        child: { id: "9" },
        title: "Game",
        starCost: "10",
        allocatedStars: "0",
        status: "ACTIVE",
      },
    ],
    redemptions: [],
    rewards: [],
    indexing: { block: { number: 100 } },
  } as unknown as StarFamily;
}

test("confirmed contributions update progress and available Stars together while indexing lags, then yield to the indexer", () => {
  const original = family();
  const updated = applyGoalContributionSnapshots(original, [snapshot])!;
  assert.equal(updated.goals[0].allocatedStars, "5");
  assert.equal(updated.children[0].reservedStars, "5");
  const state = kidGoalState(updated.goals[0], updated.children[0])!;
  assert.equal(state.progress, 5n);
  assert.equal(state.stars, 10n);
  assert.equal(state.tab, "ongoing");
  assert.equal(
    original.goals[0].allocatedStars,
    "0",
    "Do not rewrite the indexed snapshot",
  );
  const caughtUp = {
    ...original,
    indexing: {
      ...original.indexing!,
      block: { ...original.indexing!.block, number: 101 },
    },
  };
  assert.equal(applyGoalContributionSnapshots(caughtUp, [snapshot]), caughtUp);
  assert.equal(
    applyGoalContributionSnapshots(original, [{ ...snapshot, wallet: star }]),
    original,
  );
  assert.equal(
    applyGoalContributionSnapshots(original, [{ ...snapshot, childId: "10" }]),
    original,
  );
  const full = applyGoalContributionSnapshots(original, [
    { ...snapshot, allocated: 10n, reservedStars: 10n, available: 5n },
  ])!;
  assert.equal(kidGoalState(full.goals[0], full.children[0])?.tab, "ready");
});

const props: Parameters<typeof GoalContributionContent>[0] = {
  available: 15n,
  maximum: 8n,
  value: "5",
  onChange() {},
  onSubmit() {},
  onDone() {},
  busy: false,
  loading: false,
  disabled: false,
  added: null,
};
const render = (changes: Partial<typeof props> = {}) =>
  renderToStaticMarkup(
    createElement(GoalContributionContent, { ...props, ...changes }),
  );

test("the popup contains only available Stars, the counter and Add X Stars without illustration or balance comparison cards", () => {
  const html = render();
  assert.match(html, /Available Stars/);
  assert.match(html, /<strong>15 /);
  assert.match(html, /value="5"/);
  assert.match(html, /Add 5 Stars/);
  assert.doesNotMatch(
    html,
    /<img|Bicycle|→|lucide-arrow|kid-balance-change|disabled=""/,
  );
  assert.equal((html.match(/<button/g) ?? []).length, 3);
});

test("empty, over-limit and busy amounts cannot submit; the spinner stays inside the Add button", () => {
  for (const changes of [
    { value: "0" },
    { value: "" },
    { value: "9" },
    { maximum: 0n },
    { loading: true },
    { disabled: true },
  ]) {
    assert.match(
      render(changes),
      /<button[^>]*filled-action-button[^>]*disabled=""/,
    );
  }
  const html = render({ busy: true });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /lucide-loader-circle[^>]*spin/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 4);
  const success = render({ added: "5" });
  assert.match(success, /Added 5 Stars/);
  assert.match(success, />Done<\/button>/);
  assert.doesNotMatch(success, /<input|Add more Stars|lucide-loader-circle/);
});

test("counter controls and submit use the displayed selected amount", () => {
  const selected: string[] = [];
  let submitted = 0;
  const tree = GoalContributionContent({
    ...props,
    onChange: (value) => selected.push(value),
    onSubmit: () => submitted++,
  });
  const stepper = tree.props.children[1];
  stepper.props.children[0].props.onClick();
  stepper.props.children[2].props.onClick();
  tree.props.children[2].props.onClick();
  assert.deepEqual(selected, ["4", "6"]);
  assert.equal(submitted, 1);
});

test("Home and Dreams both open the same contribution popup for ongoing goals and retain claim navigation", () => {
  for (const page of ["kid-home-screen", "kid-goals-screen"]) {
    const code = source(`components/home/screens/${page}.tsx`);
    assert.match(code, /<GoalContributionSheet/);
    assert.match(code, /setContributionGoalId\(/);
  }
  assert.match(
    source("components/home/screens/kid-home-screen.tsx"),
    /goalAllocatedStars\(activeGoal\)/,
  );
  assert.match(
    source("components/home/screens/kid-goals-screen.tsx"),
    /if \(tab === "ongoing"\) setContributionGoalId\(goal.id\)/,
  );
  const sheet = source("components/home/goal-contribution-sheet.tsx");
  assert.match(sheet, /await execute\(\s*"addStarsToGoal"/);
  assert.match(sheet, /lock.current = true;\s*setBusy\(true\)/);
  assert.match(sheet, /finally \{\s*lock.current = false;\s*setBusy\(false\)/);
  assert.match(sheet, /if \(!lock.current\) onClose\(\)/);
  assert.doesNotMatch(
    sheet,
    /setInterval|refetchInterval|bicycle|kid-balance-change/,
  );
});
