import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import {
  matchesWalletReads,
  familyDiscoveryStaleTime,
  refreshAfterWalletAction,
  refreshReadOnEntry,
  starReadOptions,
  walletPageReads,
} from "../src/lib/wallet-refresh";
import { waitForIndexedBlock } from "../src/lib/indexed-transaction";
import { childFromFamily } from "../src/lib/family-child";
import type {
  StarFamily,
  StarChild,
  IndexingMetadata,
} from "../src/lib/star-api.types";

function clientForTest(t: TestContext) {
  const client = new QueryClient({
    defaultOptions: { queries: { ...starReadOptions, gcTime: Infinity } },
  });
  t.after(() => client.clear());
  return client;
}

test("Wallet entry shares fresh discovery but rechecks old or pre-onboarding results once", async (t) => {
  const client = clientForTest(t);
  const calls: string[] = [];
  for (const [wallet, families] of [
    ["returning", [{ id: "7" }]],
    ["old-deployment", [{ id: "7" }]],
    ["new", []],
  ] as const) {
    const key = ["star", "families", wallet];
    client.setQueryData(
      key,
      { families },
      { updatedAt: Date.now() - (wallet === "returning" ? 0 : 60_000) },
    );
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: (query) => familyDiscoveryStaleTime(query.state.data),
      refetchOnMount: true,
      queryFn: async () => {
        calls.push(wallet);
        return { families: [{ id: "7" }] };
      },
    });
    t.after(observer.subscribe(() => {}));
  }
  await Promise.resolve();
  assert.deepEqual(calls, ["old-deployment", "new"]);
});

test("a saved family cache cannot fetch until the user confirms their wallet", async (t) => {
  const client = clientForTest(t);
  const key = ["star", "families", "parent"];
  client.setQueryData(key, { families: [{ id: "old" }] });
  let reads = 0;
  const options = {
    queryKey: key,
    staleTime: 0,
    queryFn: async () => {
      reads++;
      return { families: [] };
    },
  };
  const observer = new QueryObserver(client, { ...options, enabled: false });
  t.after(observer.subscribe(() => {}));
  await Promise.resolve();
  assert.equal(reads, 0);
  observer.setOptions({ ...options, enabled: true });
  assert.equal(reads, 1);
  assert.equal(
    observer.getCurrentResult().isFetching,
    true,
    "Do not navigate using old cached families during the check",
  );
});

test("cached reads stay idle on mount, elapsed time, window focus and reconnect", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const client = clientForTest(t);
  const key = ["star", "family", "7"];
  client.setQueryData(key, "cached");
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => ++calls,
  });
  const unsubscribe = observer.subscribe(() => {});
  client.mount();
  t.after(() => {
    unsubscribe();
    client.unmount();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  });
  t.mock.timers.tick(5 * 60_000);
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  await Promise.resolve();
  assert.equal(calls, 0);
  assert.equal(observer.options.refetchInterval, false);
  assert.equal(client.getQueryData(key), "cached");
});

test("page entry fetches once, coalesces simultaneous consumers, and reuses a just-completed read", async (t) => {
  const client = clientForTest(t);
  const key = ["star", "family", "7", "goal-requests"];
  client.setQueryData(key, "old", { updatedAt: Date.now() - 60_000 });
  const pending = Promise.withResolvers<string>();
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () => {
      calls++;
      return pending.promise;
    },
  });
  t.after(observer.subscribe(() => {}));
  const entering = refreshReadOnEntry(client, key);
  refreshReadOnEntry(client, key);
  assert.equal(calls, 1);
  pending.resolve("fresh");
  await entering;
  await refreshReadOnEntry(client, key);
  assert.equal(calls, 1);
  assert.equal(client.getQueryData(key), "fresh");
  client.setQueryData(key, "aged", { updatedAt: Date.now() - 60_000 });
  await refreshReadOnEntry(client, key);
  assert.equal(calls, 2, "Returning later is another user-triggered read");
});

test("a quest submission updates only its inbox and attention, not balances or other families/children", async (t) => {
  const client = clientForTest(t);
  const keys: Record<string, QueryKey> = {
    family: ["star", "family", "7"],
    goals: ["star", "family", "7", "goal-requests"],
    portfolio: ["star", "portfolio", "7"],
    activity: ["star", "family", "7", "activity"],
    childInbox: ["star", "family", "7", "inbox", "9", "available"],
    parentInbox: ["star", "family", "7", "inbox", undefined, "waiting"],
    attention: ["star", "family", "7", "parent-attention"],
    siblingInbox: ["star", "family", "7", "inbox", "10", "available"],
    otherFamily: ["star", "family", "8", "parent-attention"],
    inactiveHistory: ["star", "family", "7", "inbox", "9", "history"],
  };
  const calls: string[] = [];
  for (const [name, key] of Object.entries(keys)) {
    client.setQueryData(key, "old");
    if (name === "inactiveHistory") continue;
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => {
        calls.push(name);
        return "fresh";
      },
    });
    t.after(observer.subscribe(() => {}));
  }
  await refreshAfterWalletAction(
    client,
    "submitQuest",
    { familyId: "7", childId: "9" },
    true,
  );
  assert.deepEqual(calls.sort(), ["attention", "childInbox", "parentInbox"]);
  assert.equal(client.getQueryState(keys.inactiveHistory)?.isInvalidated, true);
  assert.equal(client.getQueryState(keys.siblingInbox)?.isInvalidated, false);
});

test("goal requests and redemptions do not reload the portfolio; reward approval does", async (t) => {
  const client = clientForTest(t);
  const keys = [
    ["star", "family", "7"],
    ["star", "family", "7", "goal-requests"],
    ["star", "portfolio", "7"],
    ["star", "family", "7", "child", "9", "completed-quests"],
  ];
  const run = async (
    action: "requestGoal" | "approveRedemption" | "approveStarRequest",
  ) => {
    keys.forEach((key) => client.setQueryData(key, "old"));
    await refreshAfterWalletAction(
      client,
      action,
      { familyId: "7", childId: "9" },
      true,
    );
    return keys.map((key) => client.getQueryState(key)?.isInvalidated);
  };
  assert.deepEqual(await run("requestGoal"), [false, true, false, false]);
  assert.deepEqual(await run("approveRedemption"), [true, false, false, false]);
  assert.deepEqual(await run("approveStarRequest"), [true, false, true, true]);
});

test("confirmed but unindexed actions mark related data stale without fetching the old snapshot", async (t) => {
  const client = clientForTest(t);
  const key = ["star", "family", "7", "goal-requests"];
  client.setQueryData(key, "old");
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => ++calls,
  });
  t.after(observer.subscribe(() => {}));
  await refreshAfterWalletAction(
    client,
    "requestGoal",
    { familyId: "7" },
    false,
  );
  assert.equal(calls, 0);
  assert.equal(client.getQueryState(key)?.isInvalidated, true);
  await refreshReadOnEntry(client, key);
  assert.equal(calls, 1);
});

test("profile picker, hidden Dreams sections and Add Stars do not fetch unrelated goals/portfolio", () => {
  for (const path of [
    "/wallet/profiles",
    "/wallet/kid/add-stars",
    "/wallet/kid/rewards",
    "/wallet/kid/journey",
  ])
    assert.deepEqual(walletPageReads(path), { goals: false, portfolio: false });
  assert.deepEqual(walletPageReads("/wallet/kid/journey", "goals"), {
    goals: true,
    portfolio: false,
  });
  assert.deepEqual(walletPageReads("/wallet/kid/journey", "rewards"), {
    goals: false,
    portfolio: false,
  });
  assert.deepEqual(walletPageReads("/wallet/family"), {
    goals: false,
    portfolio: true,
  });
  assert.deepEqual(walletPageReads("/wallet"), {
    goals: true,
    portfolio: true,
  });
  assert.equal(
    matchesWalletReads(
      ["star", "families", "0xabc"],
      "7",
      ["discovery"],
      undefined,
      "0xAbc",
    ),
    true,
  );
  assert.equal(
    matchesWalletReads(
      ["star", "families", "0xdef"],
      "7",
      ["discovery"],
      undefined,
      "0xAbc",
    ),
    false,
  );
  assert.equal(matchesWalletReads(["other", "family", "7"], "7"), false);
});

test("the selected child's data is derived from the family snapshot without mixing siblings", () => {
  const child: StarChild = {
    id: "9",
    wallet: "0x0000000000000000000000000000000000000009",
    ensName: "kid.family.star.eth",
    ensNode: "0x00",
    active: true,
    starBalance: "14",
    reservedStars: "4",
    totalStarsIssued: "14",
    totalStarsBurned: "0",
    totalPrincipalContributed: "14000000",
  };
  const scoped = [
    { id: "one", child: { id: "9" } },
    { id: "two", child: { id: "10" } },
  ];
  const family = {
    id: "7",
    ensName: "family.star.eth",
    active: true,
    goals: scoped,
    rewards: scoped,
    redemptions: scoped,
    indexing: { block: { number: 100 } },
  } as unknown as StarFamily;
  const result = childFromFamily(family, child)!;
  assert.equal(result.starBalance, "14");
  assert.equal(result.reservedStars, "4");
  assert.deepEqual(
    result.goals?.map((goal) => goal.id),
    ["one"],
  );
  assert.deepEqual(
    result.rewards?.map((reward) => reward.id),
    ["one"],
  );
  assert.deepEqual(
    result.redemptions?.map((redemption) => redemption.id),
    ["one"],
  );
  assert.equal(result.family?.id, "7");
  assert.equal(result.indexing, family.indexing);
  assert.equal(child.goals, undefined, "Do not mutate the original summary");
  assert.equal(childFromFamily(family, null), null);
});

test("indexing checks happen only after a transaction, are bounded, and stop on rate limits/errors", async () => {
  let reads = 0;
  const delays: number[] = [];
  const status = (number: number) =>
    ({ block: { number } }) as IndexingMetadata;
  const pause = async (ms: number) => {
    delays.push(ms);
  };
  assert.equal(
    await waitForIndexedBlock(
      100n,
      async () => {
        reads++;
        return status(100);
      },
      pause,
    ),
    true,
  );
  assert.equal(reads, 1);
  assert.deepEqual(delays, []);
  reads = 0;
  assert.equal(
    await waitForIndexedBlock(
      100n,
      async () => {
        reads++;
        return status(99);
      },
      pause,
    ),
    false,
  );
  assert.equal(reads, 4);
  assert.deepEqual(delays, [2_000, 4_000, 8_000]);
  reads = 0;
  delays.length = 0;
  assert.equal(
    await waitForIndexedBlock(
      100n,
      async () => {
        reads++;
        throw new Error("429");
      },
      pause,
    ),
    false,
  );
  assert.equal(reads, 1);
  assert.deepEqual(delays, []);
});
