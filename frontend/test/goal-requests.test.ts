import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { childAccountAbi, starGoalsAbi } from "@star/contracts/abi";
import { encodeFunctionData } from "viem";
import { GoalTypePicker } from "../src/components/home/goal-type-picker";
import { KidAddGoalCard } from "../src/components/home/kid-add-goal-card";
import {
  goalIcons,
  withGoalMetadata,
  type GoalRequest,
} from "../src/lib/goal-requests";
import { submitGoalRequest } from "../src/lib/goal-request-submission";
import { validateGoalRequestIntents } from "../src/lib/goal-request-intents";
import {
  createStarApi,
  StarApiError,
  type IntentEnvelope,
  type IntentInputs,
} from "../src/lib/star-api";

const goals = "0x0000000000000000000000000000000000000001";
const wallet = "0x0000000000000000000000000000000000000002";
const other = "0x0000000000000000000000000000000000000003";
const child = { id: "7", wallet } as const;
const submission = `0x${"01".repeat(32)}` as const;
const input = {
  childId: child.id,
  title: "Rocket Toy",
  reason: "Space adventures",
  icon: 6,
  submissionId: submission,
};
const goalRequest: GoalRequest = {
  id: "1",
  title: input.title,
  reason: input.reason,
  icon: 6,
  submissionId: submission,
  status: "PENDING",
  child: { ...child, ensName: "kid.family.eth" },
  goal: null,
  requestedAt: "1",
  resolvedAt: null,
  requestTransactionHash: submission,
  resolutionTransactionHash: null,
};

test("goal form hides the deployment warning without enabling unsupported submissions", () => {
  const source = readFileSync(
    new URL(
      "../src/components/home/screens/kid-goal-request-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /Goal requests need the updated contract deployment|Your request has not been sent/,
  );
  assert.match(source, /const canSend = Boolean\(\s*goalRequestsSupported &&/);
  assert.match(source, /disabled=\{busy \|\| !canSend \|\| !title\.trim\(\)\}/);
  assert.match(source, /lock\.current \|\|\s*!canSend/);
});

test("goal icons keep horizontal scrolling with no visible scrollbar", () => {
  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  const options = css.match(/\.goal-icon-options\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(options, /overflow-x:\s*auto/);
  assert.match(options, /scrollbar-width:\s*none/);
  assert.match(
    css,
    /\.goal-icon-options::-webkit-scrollbar\s*\{\s*display:\s*none;/,
  );
});

test("goal review spaces the input, feedback and actions without relying on a visible status message", () => {
  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  const review = css.match(/\.goal-request-review\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(review, /display:\s*grid/);
  assert.match(review, /gap:\s*20px/);
  assert.match(css, /\.goal-request-review > \*\s*\{\s*min-width:\s*0;/);
  for (const selector of [
    ".goal-request-review .parent-action-field",
    ".goal-request-review-controls > .action-status",
  ]) {
    const rule = css.split(`${selector} {`)[1]?.split("}")[0] ?? "";
    assert.match(rule, /margin:\s*0;/);
  }
  const reason = css.match(/\.goal-request-reason\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.doesNotMatch(reason, /margin/);
  assert.match(reason, /overflow-wrap:\s*anywhere/);
  const controls =
    css.match(/\.goal-request-review-controls\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(controls, /display:\s*grid/);
  assert.match(controls, /gap:\s*16px/);
  assert.match(controls, /padding-top:\s*4px/);
  const component = readFileSync(
    new URL("../src/components/home/goal-request-sheet.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(
    (component.match(/className="goal-request-review-controls"/g) ?? []).length,
    2,
  );
  assert.match(
    component,
    /className="goal-request-review-controls"[\s\S]*Cancel request/,
  );
});

test("goal review gives both parent actions equal width and lets the child cancel action fill the row", () => {
  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  const actions =
    css.match(/\.goal-request-review-actions\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(actions, /display:\s*grid/);
  assert.match(actions, /grid-auto-flow:\s*column/);
  assert.match(actions, /grid-auto-columns:\s*minmax\(0, 1fr\)/);
  assert.match(actions, /gap:\s*12px/);
  const button =
    css.match(/\.goal-request-review-actions > button\s*\{([^}]+)\}/)?.[1] ??
    "";
  assert.match(button, /min-width:\s*0;/);
  assert.match(button, /width:\s*100%;/);
});

test("Approve goal spins inside its disabled button only during approval and clears on success or error", () => {
  const source = readFileSync(
    new URL("../src/components/home/goal-request-sheet.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /const busy = pendingAction !== null/);
  assert.match(source, /lock.current = true;\s*setPendingAction\(action\)/);
  assert.match(
    source,
    /finally \{\s*lock.current = false;\s*setPendingAction\(null\)/,
  );
  const button =
    source.match(
      /<button\s+type="button"\s+className="filled-action-button"[^]*?Approve goal\s*<\/button>/,
    )?.[0] ?? "";
  assert.match(button, /aria-busy=\{pendingAction === "approveGoalRequest"\}/);
  assert.match(button, /disabled=\{\s*busy \|\|/);
  assert.match(
    button,
    /pendingAction === "approveGoalRequest" && \(\s*<LoaderCircle\s+className="spin"/,
  );
  assert.match(button, /size=\{18\}\s+aria-hidden="true"/);
  assert.match(
    button,
    /onClick=\{\(\) => void decide\("approveGoalRequest"\)\}/,
  );
  assert.doesNotMatch(button, /ActionStatus|Preparing|Transaction confirmed/);
});

test("Home opens the goal popup from one slim button with a plain trailing plus", () => {
  let opened = 0;
  const onOpen = () => {
    opened += 1;
  };
  const html = renderToStaticMarkup(createElement(KidAddGoalCard, { onOpen }));
  assert.equal((html.match(/<button /g) ?? []).length, 1);
  assert.match(html, /type="button" aria-haspopup="dialog"/);
  assert.match(html, /Add a new goal/);
  assert.match(html, /kid-new-goal-plus/);
  assert.match(html, /lucide-plus/);
  assert.ok(
    html.indexOf("kid-new-goal-copy") < html.indexOf("kid-new-goal-plus"),
  );
  assert.doesNotMatch(html, /<img|goal-type-grid|<a |href=|goal-add-link/);
  KidAddGoalCard({ onOpen }).props.onClick();
  assert.equal(opened, 1);
});

test("popup goal choices call the selection handler without navigating away", () => {
  const html = renderToStaticMarkup(
    createElement(GoalTypePicker, { onChoose: () => {} }),
  );
  assert.equal((html.match(/<button /g) ?? []).length, 6);
  assert.equal((html.match(/width="64"/g) ?? []).length, 6);
  assert.doesNotMatch(html, /width="96"/);
  assert.match(html, /Bicycle/);
  assert.match(html, /Something else/);
  assert.doesNotMatch(html, /<a |href=/);
});

test("goal picker uses the six existing illustrated choices with no parent-create action", () => {
  const html = renderToStaticMarkup(createElement(GoalTypePicker));
  for (const icon of goalIcons)
    assert.ok(
      existsSync(
        new URL(
          `../public/illustrations/kid/${icon.illustration}.png`,
          import.meta.url,
        ),
      ),
    );
  assert.equal((html.match(/<a /g) ?? []).length, 6);
  assert.match(html, /add-goal\?icon=0/);
  assert.match(html, /Art Set/);
  assert.match(html, /Something else/);
  assert.doesNotMatch(html, /createGoal|No data/);
});

test("selected goal artwork and reason survive parent approval even with a custom title", () => {
  const goal = { id: "9", title: "Rocket Toy", starCost: "32" };
  assert.deepEqual(withGoalMetadata(goal, [goalRequest]), goal);
  const approved = {
    ...goalRequest,
    status: "APPROVED",
    goal: { ...goal, status: "ACTIVE" },
  } as GoalRequest;
  assert.deepEqual(withGoalMetadata(goal, [approved]), {
    ...goal,
    icon: 6,
    description: "Space adventures",
  });
  assert.deepEqual(withGoalMetadata({ ...goal, id: "10" }, [approved]), {
    ...goal,
    id: "10",
  });
});

test("child request signing pins the complete request, recipient, chain and role", () => {
  const envelope: IntentEnvelope = {
    intents: [
      {
        chainId: 11155111,
        signerRole: "CHILD",
        to: wallet,
        value: "0",
        summary: "Request",
        data: encodeFunctionData({
          abi: childAccountAbi,
          functionName: "requestGoal",
          args: [input.title, input.reason, input.icon, submission],
        }),
      },
    ],
  };
  validateGoalRequestIntents(
    "requestGoal",
    input,
    envelope,
    goals,
    [child],
    child,
  );
  for (const mutate of [
    (plan: IntentEnvelope) => {
      plan.intents[0].to = other;
    },
    (plan: IntentEnvelope) => {
      plan.intents[0].value = "1";
    },
    (plan: IntentEnvelope) => {
      plan.intents[0].chainId = 1;
    },
    (plan: IntentEnvelope) => {
      plan.intents[0].signerRole = "PARENT";
    },
    (plan: IntentEnvelope) => {
      plan.intents[0].data = encodeFunctionData({
        abi: childAccountAbi,
        functionName: "requestGoal",
        args: ["Different goal", input.reason, 0, submission],
      });
    },
    (plan: IntentEnvelope) => {
      plan.intents.push(plan.intents[0]);
    },
  ]) {
    const changed = structuredClone(envelope);
    mutate(changed);
    assert.throws(() =>
      validateGoalRequestIntents(
        "requestGoal",
        input,
        changed,
        goals,
        [child],
        child,
      ),
    );
  }
  assert.throws(() =>
    validateGoalRequestIntents("requestGoal", input, envelope, goals, [child], {
      ...child,
      id: "8",
    }),
  );
});

test("parent approval pins the request ID and the exact target, with no token allowance or transfer", () => {
  const body = { childId: child.id, requestId: "1", starCost: "32" };
  const envelope: IntentEnvelope = {
    intents: [
      {
        chainId: 11155111,
        signerRole: "PARENT",
        to: goals,
        value: "0",
        summary: "Approve",
        data: encodeFunctionData({
          abi: starGoalsAbi,
          functionName: "approveGoalRequest",
          args: [1n, 32n],
        }),
      },
    ],
  };
  validateGoalRequestIntents(
    "approveGoalRequest",
    body,
    envelope,
    goals,
    [child],
    null,
  );
  assert.throws(() =>
    validateGoalRequestIntents(
      "approveGoalRequest",
      { ...body, starCost: "33" },
      envelope,
      goals,
      [child],
      null,
    ),
  );
  assert.throws(() =>
    validateGoalRequestIntents(
      "approveGoalRequest",
      { ...body, requestId: "2" },
      envelope,
      goals,
      [child],
      null,
    ),
  );
  assert.throws(() =>
    validateGoalRequestIntents(
      "approveGoalRequest",
      body,
      envelope,
      other,
      [child],
      null,
    ),
  );
});

test("goal submissions retain their ID across unknown outcomes and never auto-retry", async () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  const bodies: IntentInputs["requestGoal"][] = [];
  const args = { ...input, goalsAddress: goals } as const;
  await assert.rejects(
    submitGoalRequest(
      args,
      async (action, body, role) => {
        assert.equal(action, "requestGoal");
        assert.equal(role, "CHILD");
        bodies.push(body);
        throw new Error("Connection lost");
      },
      storage,
    ),
  );
  assert.equal(data.size, 1);
  await submitGoalRequest(
    args,
    async (_action, body) => {
      bodies.push(body);
    },
    storage,
  );
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(data.size, 0);
  await assert.rejects(
    submitGoalRequest(
      args,
      async () => {
        throw new StarApiError("Already sent", {
          code: "SUBMISSION_ALREADY_RECORDED",
        });
      },
      storage,
    ),
  );
  assert.equal(data.size, 0);
  for (const change of [
    { title: "" },
    { title: "🌟".repeat(17) },
    { reason: "x".repeat(481) },
    { icon: 7 },
  ]) {
    await assert.rejects(
      submitGoalRequest(
        { ...args, ...change },
        async () => {
          assert.fail("Must not ask for a signature");
        },
        storage,
      ),
    );
  }
});

test("goal inbox follows snapshot-pinned pages and distinguishes unsupported deployments", async () => {
  const hash = `0x${"12".repeat(32)}`;
  const indexing = {
    deployment: "deployment",
    block: { number: 15, hash },
    hasIndexingErrors: false,
    currentBlock: 15,
    blockLag: 0,
    maximumBlockLag: 120,
  };
  const seen: URL[] = [];
  const api = createStarApi(async (path) => {
    const url = new URL(String(path), "https://local.invalid");
    seen.push(url);
    const skip = Number(url.searchParams.get("skip"));
    return Response.json({
      supported: true,
      goalsAddress: goals,
      requests: [{ ...goalRequest, id: skip ? "2" : "1" }],
      nextOffset: skip ? null : 100,
      indexing,
    });
  });
  const result = await api.allGoalRequests("8");
  assert.deepEqual(
    result.requests.map((item) => item.id),
    ["1", "2"],
  );
  assert.equal(
    seen.length,
    2,
    "Reuse the capability response as the first data page",
  );
  assert.equal(seen[0].searchParams.get("first"), "100");
  assert.equal(seen[1].searchParams.get("blockHash"), hash);
  assert.match(seen[0].pathname, /families\/8\/goal-requests$/);
  const unsupported = await createStarApi(async () =>
    Response.json({
      supported: false,
      goalsAddress: goals,
      requests: [],
      nextOffset: null,
    }),
  ).allGoalRequests("8");
  assert.equal(unsupported.supported, false);
  await assert.rejects(
    createStarApi(async () =>
      Response.json({
        supported: false,
        goalsAddress: goals,
        requests: [goalRequest],
        nextOffset: null,
      }),
    ).allGoalRequests("8"),
  );
});
