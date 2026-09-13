import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestReviewContent } from "../src/components/home/request-review-sheet";
import type { StarRequest } from "../src/lib/quest-types";

const hash = `0x${"ab".repeat(32)}` as const;

test("Home attention opens the review directly, while manual Stars and Quests keep their lists", () => {
  const source = readFileSync(
    new URL(
      "../src/components/home/screens/home-dashboard.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const attentionHandler = source.slice(
    source.indexOf("onOpen={(item) =>"),
    source.indexOf("</section>", source.indexOf("onOpen={(item) =>")),
  );
  assert.match(attentionHandler, /setAttentionRequest\(item.request\)/);
  assert.match(attentionHandler, /setRewardPanel\(null\)/);
  assert.match(attentionHandler, /setQuestInboxOpen\(false\)/);
  assert.doesNotMatch(
    attentionHandler,
    /setRewardPanel\("requests"\)|setQuestInboxOpen\(true\)/,
  );
  assert.match(
    source,
    /<RequestReviewSheet[\s\S]*?request=\{attentionRequest\}/,
  );
  assert.doesNotMatch(source, /initialRequestId=/);
  assert.match(
    source,
    /rewardPanel !== null &&[\s\S]*?<ParentRewardStarsSheet/,
  );
  assert.match(source, /questInboxOpen &&[\s\S]*?<ParentQuestInboxSheet/);
});
const request: StarRequest = {
  id: "request-1",
  requestId: "1",
  workflow: "0x1111111111111111111111111111111111111111",
  child: {
    id: "child-1",
    wallet: "0x2222222222222222222222222222222222222222",
    ensName: "amelia.starwallet.eth",
  },
  quest: { id: "quest-1", questId: "1", title: "Finish homework" },
  stars: "4",
  reason: "Please add 4 Stars",
  submissionId: hash,
  status: "PENDING",
  reward: null,
  createdAt: "1",
  updatedAt: "1",
  creationTransactionHash: hash,
  resolutionTransactionHash: null,
};
type Props = ComponentProps<typeof RequestReviewContent>;
const render = (overrides: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(RequestReviewContent, {
      request,
      pending: null,
      decision: null,
      operation: { state: "idle" },
      approveDisabled: false,
      onDecide: () => {},
      onDone: () => {},
      ...overrides,
    }),
  );

test("review uses mapped quest artwork and distinct Star request artwork", () => {
  for (const [title, image] of [
    ["Finish homework", "pencil"],
    ["Read for 30 minutes", "book"],
    ["Clean your room", "bed"],
  ]) {
    const html = decodeURIComponent(
      render({ request: { ...request, quest: { ...request.quest!, title } } }),
    );
    assert.ok(html.includes(`/kid/${image}.png`));
    assert.match(html, />Reject<\/button>/);
    assert.match(html, />Approve<\/button>/);
    assert.doesNotMatch(html, /Tx hash|<details|<summary/);
  }
  assert.match(
    decodeURIComponent(render({ request: { ...request, quest: null } })),
    /star_sparkle.png/,
  );
});

test("finished quest review combines the child and task with a labelled reward", () => {
  const html = render();
  assert.match(
    html,
    /<strong>Amelia<\/strong> has completed the following task:<br\/><strong>Finish homework<\/strong> 🎉/,
  );
  assert.match(html, /class="request-review-reward"/);
  assert.match(html, /<span>Reward:<\/span>/);
  assert.match(html, /\+4/);
  assert.doesNotMatch(html, /<h3>Finish homework<\/h3>|<p>Amelia<\/p>/);
  assert.doesNotMatch(
    render({ request: { ...request, quest: null } }),
    /has completed the following task/,
  );
});

test("both approval and rejection lock both controls and spin only the pressed button", () => {
  for (const pending of ["approve", "reject"] as const) {
    const html = render({
      pending,
      operation: {
        state: "signing",
        message: "Waiting",
        transactionHashes: [hash],
      },
    });
    const buttons = [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map(
      (match) => match[0],
    );
    assert.equal(buttons.length, 2);
    for (const button of buttons) {
      assert.match(button, /disabled=""/);
      assert.equal(
        button.includes('aria-busy="true"'),
        button.includes(pending === "approve" ? "Approve" : "Reject"),
      );
    }
    assert.equal((html.match(/class="[^"]*spin/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Tx hash/);
  }
});

test("confirmed outcomes show the full explorer link above Done, failures keep review actions", () => {
  for (const decision of ["approved", "rejected"] as const) {
    const html = render({
      decision,
      operation: {
        state: "success",
        indexed: false,
        message: "Confirmed",
        transactionHashes: [hash],
      },
    });
    assert.ok(html.includes(`href="https://sepolia.etherscan.io/tx/${hash}"`));
    assert.ok(html.indexOf("Tx hash") < html.indexOf("<button"));
    assert.match(html, />Done<\/button>/);
    assert.equal((html.match(/<button/g) ?? []).length, 1);
  }
  const failed = render({
    operation: {
      state: "error",
      message: "Rejected by wallet",
      transactionHashes: [hash],
    },
  });
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(failed, /Tx hash/);
  assert.match(failed, />Approve<\/button>/);
});

test("review preserves the request snapshot through indexing and finishes only after execution", () => {
  const source = readFileSync(
    new URL("../src/components/home/request-review-sheet.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /"Finished Quests" : "Star request"/);
  assert.match(
    source,
    /lock.current = true;[\s\S]*?await execute\([\s\S]*?setDecision\(approved/,
  );
  assert.match(
    source,
    /finally \{\s*lock.current = false;\s*setPending\(null\);\s*onBusyChange\(false\)/,
  );
});
