import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { childAccountAbi, familyVaultAbi } from "@star/contracts/abi";
import { validateQuestIntents } from "../src/lib/quest-intents";
import { createStarApi } from "../src/lib/star-api";
import type { IntentEnvelope } from "../src/lib/star-api.types";

const vault = "0x0000000000000000000000000000000000000001";
const workflow = "0x0000000000000000000000000000000000000002";
const usdc = "0x0000000000000000000000000000000000000003";
const wallet = "0x0000000000000000000000000000000000000004";
const child = { id: "1", wallet } as const;
const family = {
  children: [child],
  vault: { id: vault, questsAddress: workflow, usdc },
} as const;
const envelope: IntentEnvelope = {
  intents: [
    {
      chainId: 11155111,
      signerRole: "PARENT",
      to: usdc,
      value: "0",
      summary: "Approve",
      data: encodeFunctionData({
        abi: parseAbi(["function approve(address,uint256)"]),
        functionName: "approve",
        args: [vault, 3_000_000n],
      }),
    },
    {
      chainId: 11155111,
      signerRole: "PARENT",
      to: vault,
      value: "0",
      summary: "Reward",
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "approveStarRequest",
        args: [7n],
      }),
    },
  ],
};
test("parent approval plan pins the USDC token, spender, exact amount, vault and request", () => {
  const body = { childId: "1", id: "7", stars: "3" };
  validateQuestIntents("approveStarRequest", body, envelope, family, child);
  for (const edit of [
    (plan: IntentEnvelope) => {
      plan.intents[0].to = wallet;
    },
    (plan: IntentEnvelope) => {
      plan.intents[0].data = encodeFunctionData({
        abi: parseAbi(["function approve(address,uint256)"]),
        functionName: "approve",
        args: [wallet, 3_000_000n],
      });
    },
    (plan: IntentEnvelope) => {
      plan.intents[1].value = "1";
    },
    (plan: IntentEnvelope) => {
      plan.intents[1].signerRole = "CHILD";
    },
    (plan: IntentEnvelope) => {
      plan.intents.reverse();
    },
    (plan: IntentEnvelope) => {
      plan.intents.push(plan.intents[1]);
    },
  ]) {
    const plan = structuredClone(envelope);
    edit(plan);
    assert.throws(() =>
      validateQuestIntents("approveStarRequest", body, plan, family, child),
    );
  }
  assert.throws(() =>
    validateQuestIntents(
      "approveStarRequest",
      { ...body, stars: "4" },
      envelope,
      family,
      child,
    ),
  );
});
test("a child submission pins the selected child, quest and submission identifier", () => {
  const body = {
    childId: "1",
    id: "2",
    submissionId: `0x${"01".repeat(32)}` as const,
  };
  const plan: IntentEnvelope = {
    intents: [
      {
        ...envelope.intents[1],
        signerRole: "CHILD",
        to: wallet,
        data: encodeFunctionData({
          abi: childAccountAbi,
          functionName: "submitQuest",
          args: [2n, body.submissionId],
        }),
      },
    ],
  };
  validateQuestIntents("submitQuest", body, plan, family, child);
  assert.throws(() =>
    validateQuestIntents(
      "submitQuest",
      { ...body, id: "3" },
      plan,
      family,
      child,
    ),
  );
  assert.throws(() =>
    validateQuestIntents("submitQuest", body, plan, family, {
      ...child,
      id: "2",
    }),
  );
});
test("inbox reads use the shared API with child filters and paging", async () => {
  const api = createStarApi(async (url) => {
    assert.equal(
      String(url),
      "/api/star/families/7/inbox?first=50&skip=50&view=waiting&childId=9",
    );
    return Response.json({
      quests: [],
      requests: [],
      nextOffset: null,
      indexing: {},
    });
  });
  assert.deepEqual(
    (
      await api.inbox("7", {
        childId: "9",
        view: "waiting",
        first: 50,
        skip: 50,
      })
    ).requests,
    [],
  );
});
