import assert from "node:assert/strict";
import test from "node:test";
import { createStarApi } from "../src/lib/star-api";
import {
  emptyDraft,
  readDraft,
  saveDraft,
  ONBOARDING_STORAGE_KEY,
} from "../src/lib/onboarding";
import { walletContext, selectFamilyId } from "../src/lib/wallet-context";
import { formatTokenAmount, formatUsd18 } from "../src/lib/star-format";
import { presentActivity } from "../src/components/home/star-activity";
import type { StarActivity } from "../src/lib/star-api.types";

const parent = "0x0000000000000000000000000000000000001234";
const other = "0x0000000000000000000000000000000000005678";
const child = "0x000000000000000000000000000000000000abcd";
const indexing = {
  deployment: "QmPinned",
  block: { number: 100, hash: `0x${"ab".repeat(32)}` },
  hasIndexingErrors: false,
};

test("public ENS configuration is backend-owned and wrong networks or malformed names fail closed", async () => {
  const api = createStarApi(async (url) => {
    assert.equal(url, "/api/star/config");
    return Response.json({ chainId: 11155111, ensParentName: "another.eth" });
  });
  assert.equal((await api.config()).ensParentName, "another.eth");
  for (const value of [
    {},
    { chainId: 1, ensParentName: "another.eth" },
    { chainId: 11155111, ensParentName: "bad..eth" },
  ])
    await assert.rejects(
      createStarApi(async () => Response.json(value)).config(),
      { code: "STAR_API_INVALID_RESPONSE" },
    );
});

test("full reads merge all nested pages without truncating at the first 100 records", async () => {
  const urls: URL[] = [];
  const api = createStarApi(async (url) => {
    const parsed = new URL(String(url), "https://app.invalid");
    urls.push(parsed);
    const first = parsed.searchParams.get("skip") === "0";
    const ids = first
      ? Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1) }))
      : [{ id: "101" }];
    if (!first)
      assert.equal(parsed.searchParams.get("blockHash"), indexing.block.hash);
    return Response.json({
      id: "7",
      goals: ids,
      children: first ? [{ id: "9" }] : [],
      families: ids,
      savings: { activePosition: { id: "p", executions: ids } },
      nextOffset: first ? 100 : null,
      indexing,
    });
  });
  const family = await api.fullFamily("7");
  assert.equal(family.goals.length, 101);
  assert.equal(family.children.length, 1);
  assert.equal(family.savings.activePosition?.executions?.length, 101);
  assert.equal((await api.fullChild(child)).goals?.length, 101);
  assert.equal((await api.allFamiliesByParent(parent)).families.length, 101);
  assert.equal(urls.length, 6);
});

test("pagination rejects stalled cursors and changed snapshots instead of silently mixing records", async () => {
  for (const second of [
    { nextOffset: 100, indexing },
    {
      nextOffset: null,
      indexing: { ...indexing, block: { ...indexing.block, number: 101 } },
    },
    { nextOffset: null, indexing: { ...indexing, deployment: "other" } },
    {
      nextOffset: null,
      indexing: {
        ...indexing,
        block: { ...indexing.block, hash: "different" },
      },
    },
  ]) {
    let calls = 0;
    const api = createStarApi(async () =>
      Response.json(++calls === 1 ? { indexing, nextOffset: 100 } : second),
    );
    await assert.rejects(api.fullFamily("7"), {
      code: "STAR_API_INVALID_RESPONSE",
    });
    assert.equal(calls, 2);
  }
});

test("saved family and child selection cannot override a different connected parent", () => {
  const draft = { ...emptyDraft, parentAddress: parent, familyId: "7" };
  assert.deepEqual(walletContext(parent, draft, ""), {
    discoveryAddress: parent,
    storedFamilyId: "7",
  });
  assert.deepEqual(walletContext(other, draft, child), {
    discoveryAddress: other,
    storedFamilyId: null,
  });
  assert.deepEqual(walletContext(undefined, draft, child), {
    discoveryAddress: child,
    storedFamilyId: null,
  });
  assert.deepEqual(walletContext(other, draft, child, true), {
    discoveryAddress: child,
    storedFamilyId: null,
  });
});

test("saved family IDs are used only after they appear in the parent's indexed families", () => {
  assert.equal(selectFamilyId("7", undefined), null);
  assert.equal(selectFamilyId("7", [{ id: "8", active: true }]), "8");
  assert.equal(
    selectFamilyId("7", [
      { id: "8", active: true },
      { id: "7", active: true },
    ]),
    "7",
  );
  assert.equal(selectFamilyId("7", [], "9"), "9");
});

test("onboarding drafts are scoped by parent and legacy drafts survive switching wallets", (t) => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  for (const [key, value] of [
    ["window", {}],
    ["localStorage", storage],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  values.set(
    ONBOARDING_STORAGE_KEY,
    JSON.stringify({ ...emptyDraft, parentAddress: parent, familyId: "7" }),
  );
  assert.equal(readDraft(other).familyId, "");
  saveDraft({ ...emptyDraft, parentAddress: other, familyId: "8" });
  assert.equal(readDraft(parent).familyId, "7");
  assert.equal(readDraft(other).familyId, "8");
  values.set(
    ONBOARDING_STORAGE_KEY,
    JSON.stringify({
      step: 99,
      familyName: 123,
      childCredential: { id: null },
    }),
  );
  assert.deepEqual(readDraft(), emptyDraft);
});

test("missing or malformed financial amounts are not displayed as zero balances", () => {
  for (const amount of [undefined, null, "", "not-a-number", "-1", -1n]) {
    assert.equal(formatTokenAmount(amount, 6), "—");
    assert.equal(formatUsd18(amount), "—");
  }
  assert.equal(formatTokenAmount("0", 6), "0");
  assert.equal(formatTokenAmount("1234567", 6), "1.2345");
  assert.equal(formatUsd18("1000000000000000000"), "$1");
});

test("activity amounts distinguish missing data from real zero-value events", () => {
  const family = { children: [], goals: [], rewards: [] };
  const base = {
    id: "0x01",
    transactionHash: "0x02",
    timestamp: "1",
    blockNumber: "1",
    logIndex: "0",
    sequence: "1",
  } as const;
  for (const type of [
    "STARS_REWARDED",
    "PRINCIPAL_CONTRIBUTED",
    "SAVINGS_USDC_WITHDRAWN",
    "STRATEGY_WETH_FUNDED",
    "STRATEGY_WETH_WITHDRAWN",
    "GOAL_CREATED",
    "REDEMPTION_REQUESTED",
  ] satisfies StarActivity["type"][]) {
    for (const amount of [undefined, null, "invalid", "-1"])
      assert.equal(
        presentActivity({ ...base, type, amount }, family).amount,
        "—",
      );
    assert.match(
      presentActivity({ ...base, type, amount: "0" }, family).amount!,
      /^[+-]?0$/,
    );
  }
  assert.equal(
    presentActivity(
      { ...base, type: "PRINCIPAL_CONTRIBUTED", amount: "1000000" },
      family,
    ).amount,
    "+1",
  );
});
