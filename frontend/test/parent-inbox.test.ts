import assert from "node:assert/strict";
import test from "node:test";
import { isVisibleActivity } from "../src/components/home/star-activity";
import { selectInboxItems } from "../src/lib/quest-inbox";
import type { Quest, StarRequest } from "../src/lib/quest-types";

test("registration acceptance is hidden without hiding rewards or goal requests", () => {
  const events = [
    { type: "CHILD_REGISTRATION_ACCEPTED" },
    { type: "STARS_REWARDED" },
    { type: "REDEMPTION_REQUESTED" },
  ] as const;
  assert.deepEqual(events.filter(isVisibleActivity), events.slice(1));
});

test("parent inboxes separate direct Star requests from quest completions without changing request IDs", () => {
  const child = {
    id: "1",
    wallet: "0x0000000000000000000000000000000000000001",
    ensName: "kid.family.eth",
  } as const;
  const quest: Quest = {
    id: "quest-1",
    questId: "1",
    workflow: child.wallet,
    child,
    title: "Read",
    stars: "5",
    status: "ACTIVE",
    createdAt: "1",
    updatedAt: "1",
  };
  const request: StarRequest = {
    id: "request-1",
    requestId: "1",
    workflow: child.wallet,
    child,
    quest: null,
    stars: "10",
    reason: "Helped out",
    submissionId: "0x01",
    status: "PENDING",
    reward: null,
    createdAt: "1",
    updatedAt: "1",
    creationTransactionHash: "0x01",
    resolutionTransactionHash: null,
  };
  const completion: StarRequest = {
    ...request,
    id: "request-2",
    requestId: "2",
    quest: { id: quest.id, questId: quest.questId, title: quest.title },
  };
  const items = { quests: [quest], requests: [request, completion] };
  assert.deepEqual(selectInboxItems(items, "quests"), {
    quests: [quest],
    requests: [completion],
  });
  assert.deepEqual(selectInboxItems(items, "stars"), {
    quests: [],
    requests: [request],
  });
  assert.deepEqual(selectInboxItems(items, "all"), items);
  assert.equal(items.requests.length, 2);
  assert.deepEqual(selectInboxItems(items, "quests", "available"), {
    quests: [quest],
    requests: [],
  });
  assert.deepEqual(selectInboxItems(items, "quests", "waiting"), {
    quests: [],
    requests: [completion],
  });
  // Related requests may be on later pages; show the completed quest meanwhile.
  const done: Quest = { ...quest, status: "COMPLETED" };
  assert.deepEqual(
    selectInboxItems({ quests: [done], requests: [] }, "quests", "history"),
    {
      quests: [done],
      requests: [],
    },
  );
  assert.deepEqual(
    selectInboxItems(
      { quests: [done], requests: [completion] },
      "quests",
      "history",
    ),
    {
      quests: [],
      requests: [completion],
    },
  );
});
