import assert from "node:assert/strict";
import test from "node:test";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ParentAttentionList } from "../src/components/home/parent-attention-list";
import { ActionStatus } from "../src/components/home/action-status";
import {
  parentAttentionItems,
  type ParentAttentionItem,
} from "../src/lib/parent-attention";
import { selectInboxItems } from "../src/lib/quest-inbox";
import type { StarRequest } from "../src/lib/quest-types";
import type { GoalRequest } from "../src/lib/goal-requests";
import type { StarRedemption } from "../src/lib/star-api.types";
import { createStarApi } from "../src/lib/star-api";

const child = {
  id: "1",
  wallet: "0x0000000000000000000000000000000000000001",
  ensName: "jasmine.tan.eth",
} as const;
const otherChild = { ...child, id: "2", ensName: "alex.tan.eth" };
const stars: StarRequest = {
  id: "workflow-1",
  requestId: "1",
  workflow: child.wallet,
  child,
  quest: null,
  stars: "10",
  reason: "Please add Stars",
  submissionId: "0x01",
  status: "PENDING",
  reward: null,
  createdAt: "10",
  updatedAt: "10",
  creationTransactionHash: "0x01",
  resolutionTransactionHash: null,
};
const quest: StarRequest = {
  ...stars,
  id: "workflow-2",
  requestId: "2",
  child: otherChild,
  createdAt: "30",
  quest: { id: "quest-1", questId: "1", title: "Finish homework" },
};
const goal: GoalRequest = {
  id: "1",
  title: "A bicycle",
  reason: "Go riding",
  icon: 0,
  child,
  status: "PENDING",
  goal: null,
  submissionId: "0x01",
  requestedAt: "40",
  resolvedAt: null,
  requestTransactionHash: "0x01",
  resolutionTransactionHash: null,
};
const redemption: StarRedemption = {
  id: "1",
  child: otherChild,
  reservedStars: "50",
  status: "PENDING",
  goal: { id: "2", title: "Books", starCost: "50", status: "ACTIVE" },
  requestedAt: "20",
  requestTransactionHash: "0x01",
};
const input = {
  starRequests: [stars, quest],
  goalRequests: [goal],
  redemptions: [redemption],
};
const defaults = {
  items: parentAttentionItems(input),
  childProfiles: [child, otherChild],
  loading: false,
  error: null,
  onOpen: () => {},
  onRetry: () => {},
};
const indexing = {
  deployment: "test",
  block: { number: 100, hash: `0x${"12".repeat(32)}` },
  hasIndexingErrors: false,
  currentBlock: 101,
  blockLag: 1,
  maximumBlockLag: 120,
};

test("needs attention includes all four child approval types across children, newest first", () => {
  const items = parentAttentionItems(input);
  assert.deepEqual(
    items.map((item) => item.kind),
    ["goal", "quest", "redemption", "stars"],
  );
  assert.equal(items[0].request, goal);
  assert.equal(items[1].request, quest);
  assert.equal(items[2].request, redemption);
  assert.equal(items[3].request, stars);
  // Numeric identifiers in independent workflows must not hide each other.
  assert.equal(goal.id, redemption.id);
  const html = renderToStaticMarkup(
    createElement(ParentAttentionList, defaults),
  );
  for (const label of [
    "New goal request",
    "Quest ready for review",
    "Reward request",
    "Star request",
    "Jasmine",
    "Alex",
  ])
    assert.ok(html.includes(label), label);
  assert.match(html, /href="\/wallet\/rewards\/1"/);
  assert.doesNotMatch(html, /No data for this section/);
});

test("approved, rejected, and child-cancelled requests leave attention; duplicate requests appear once", () => {
  for (const status of ["APPROVED", "REJECTED", "CANCELLED"] as const)
    assert.deepEqual(
      parentAttentionItems({
        starRequests: [
          { ...stars, status },
          { ...quest, status },
        ],
        goalRequests: [{ ...goal, status }],
        redemptions: [{ ...redemption, status }],
      }),
      [],
    );
  assert.equal(
    parentAttentionItems({ ...input, starRequests: [stars, quest, quest] })
      .length,
    4,
  );
  assert.deepEqual(input.starRequests, [stars, quest]);
});

function buttons(node: ReactNode): ReactElement<{ onClick: () => void }>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    if (child.type === ActionStatus)
      return buttons(
        ActionStatus(child.props as Parameters<typeof ActionStatus>[0]),
      );
    return child.type === "button"
      ? [child as ReactElement<{ onClick: () => void }>]
      : buttons(child.props.children);
  });
}

test("attention clicks preserve the exact request, type and child for the approval entrypoint", () => {
  const opened: ParentAttentionItem[] = [];
  const tree = ParentAttentionList({
    ...defaults,
    onOpen: (item) => opened.push(item),
  });
  buttons(tree).forEach((button) => button.props.onClick());
  assert.deepEqual(
    opened.map((item) => [item.kind, item.request.id, item.request.child?.id]),
    [
      ["goal", goal.id, child.id],
      ["quest", quest.id, otherChild.id],
      ["stars", stars.id, child.id],
    ],
  );
  const inbox = { quests: [], requests: [stars, quest] };
  assert.equal(
    selectInboxItems(inbox, "all", "waiting", quest.id).requests[0],
    quest,
  );
  assert.deepEqual(
    selectInboxItems(inbox, "stars", "waiting", quest.id).requests,
    [stars],
  );
});

test("attention never calls a failed or unfinished read empty, and cached items remain visible on error", () => {
  const render = (props: Partial<Parameters<typeof ParentAttentionList>[0]>) =>
    renderToStaticMarkup(
      createElement(ParentAttentionList, { ...defaults, ...props }),
    );
  assert.match(render({ items: [] }), /No data for this section/);
  const loading = render({ items: [], loading: true });
  assert.match(loading, /Checking requests/);
  assert.doesNotMatch(loading, /No data for this section/);
  for (const items of [[], defaults.items]) {
    const error = render({ items, error: new Error("Indexer unavailable") });
    assert.match(error, /role="alert"/);
    assert.match(error, /aria-label="Refresh requests"/);
    assert.doesNotMatch(error, /outline-action-button|>Try again</);
    assert.doesNotMatch(error, /No data for this section/);
    if (items.length) assert.match(error, /Quest ready for review/);
  }
  let retries = 0;
  buttons(
    ParentAttentionList({
      ...defaults,
      items: [],
      error: new Error("offline"),
      onRetry: () => retries++,
    }),
  )[0].props.onClick();
  assert.equal(retries, 1);
});

test("parent attention fetches every waiting page for the whole family, pinned to one snapshot", async () => {
  const calls: number[] = [];
  const api = createStarApi(async (input) => {
    const url = new URL(String(input), "https://app.invalid");
    assert.equal(url.pathname, "/api/star/families/7/inbox");
    assert.equal(url.searchParams.get("view"), "waiting");
    assert.equal(url.searchParams.get("childId"), null);
    assert.equal(url.searchParams.get("first"), "100");
    const skip = Number(url.searchParams.get("skip"));
    calls.push(skip);
    assert.equal(
      url.searchParams.get("blockHash"),
      skip ? indexing.block.hash : null,
    );
    return Response.json({
      quests: [],
      requests: skip ? [quest] : [stars],
      nextOffset: skip ? null : 100,
      indexing,
    });
  });
  assert.deepEqual(await api.pendingStarRequests("7"), [stars, quest]);
  assert.deepEqual(calls, [0, 100]);
});

test("failed later pages, malformed requests, stalled cursors and changed snapshots cannot become an empty attention list", async () => {
  let count = 0;
  const failingApi = createStarApi(async () =>
    ++count === 1
      ? Response.json({
          quests: [],
          requests: [stars],
          nextOffset: 100,
          indexing,
        })
      : Response.json({ message: "Indexer unavailable" }, { status: 503 }),
  );
  await assert.rejects(failingApi.pendingStarRequests("7"), { status: 503 });
  for (const patch of [
    { requests: undefined },
    { requests: [{}] },
    { requests: [{ ...stars, status: "APPROVED" }] },
    { nextOffset: 0 },
    { indexing: undefined },
  ]) {
    const api = createStarApi(async () =>
      Response.json({
        quests: [],
        requests: [],
        nextOffset: null,
        indexing,
        ...patch,
      }),
    );
    await assert.rejects(api.pendingStarRequests("7"), {
      code: "STAR_API_INVALID_RESPONSE",
    });
  }
  count = 0;
  const changedApi = createStarApi(async () =>
    Response.json({
      quests: [],
      requests: [stars],
      nextOffset: ++count === 1 ? 100 : null,
      indexing:
        count === 1
          ? indexing
          : { ...indexing, block: { ...indexing.block, number: 101 } },
    }),
  );
  await assert.rejects(changedApi.pendingStarRequests("7"), {
    code: "STAR_API_INVALID_RESPONSE",
  });
  count = 0;
  const malformedLaterPage = createStarApi(async () =>
    Response.json({
      quests: [],
      requests: ++count === 1 ? [] : null,
      nextOffset: count === 1 ? 100 : null,
      indexing,
    }),
  );
  await assert.rejects(malformedLaterPage.pendingStarRequests("7"), {
    code: "STAR_API_INVALID_RESPONSE",
  });
});

test("a complete successful empty inbox is a genuine empty attention list", async () => {
  const api = createStarApi(async () =>
    Response.json({ quests: [], requests: [], nextOffset: null, indexing }),
  );
  assert.deepEqual(await api.pendingStarRequests("7"), []);
});
