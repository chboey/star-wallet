import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApproveRewardButton,
  RewardApprovalSuccess,
} from "../src/components/home/reward-approval-feedback";

test("Approve reward shows a spinner inside its disabled purple button only while approving", () => {
  for (const approving of [true, false]) {
    for (const disabled of [true, false]) {
      const html = renderToStaticMarkup(
        createElement(ApproveRewardButton, {
          approving,
          disabled,
          onApprove() {},
        }),
      );
      assert.match(html, /^<button class="filled-action-button"/);
      assert.match(html, />Approve reward<\/button>/);
      assert.equal(html.includes('aria-busy="true"'), approving);
      assert.equal(html.includes('disabled=""'), approving || disabled);
      assert.equal(html.includes("lucide-loader-circle"), approving);
      if (approving) assert.match(html, /<svg[^>]*class="[^"]*spin/);
      assert.doesNotMatch(
        html,
        /action-status|Preparing|Transaction confirmed/,
      );
    }
  }
});

test("successful approval is popup content with a tick and one Done button", () => {
  let navigations = 0;
  const props = {
    onDone: () => {
      navigations++;
    },
  };
  const html = decodeURIComponent(
    renderToStaticMarkup(createElement(RewardApprovalSuccess, props)),
  );
  assert.ok(
    existsSync(
      new URL("../public/illustrations/kid/purple_tick.png", import.meta.url),
    ),
  );
  assert.match(html, /\/illustrations\/kid\/purple_tick\.png/);
  assert.match(html, /<h2>Reward approved on-chain<\/h2>/);
  assert.match(html, /role="status"/);
  assert.match(
    html,
    /class="filled-action-button" type="button">Done<\/button>/,
  );
  assert.equal((html.match(/<button /g) ?? []).length, 1);
  assert.doesNotMatch(
    html,
    /Reserved for this reward|Requested by|Approval burns|detail-info-banner|approval-result|Go back home|lucide-check/,
  );
  RewardApprovalSuccess(props).props.children[2].props.onClick();
  assert.equal(navigations, 1);
});

test("approval success uses muted text and its purple Done button spans the available width", () => {
  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  const heading =
    css.match(/\.reward-approval-success-content h2\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(heading, /color:\s*var\(--muted\);/);
  const button =
    css.match(
      /\.reward-approval-success-sheet > \.filled-action-button\s*\{([^}]+)\}/,
    )?.[1] ?? "";
  assert.match(button, /width:\s*100%;/);
  assert.match(button, /min-height:\s*54px;/);
});

test("approval locks before execution and hands its hashes to the Home popup", () => {
  const source = readFileSync(
    new URL(
      "../src/components/home/screens/reward-approval-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /decisionLock.current \|\|\s*decision \|\|/);
  assert.match(
    source,
    /decisionLock.current = true;\s*setPendingDecision\(approved \? "approved" : "rejected"\);\s*try/,
  );
  assert.match(source, /onTransactionHashes:[\s\S]*?approvalHashes = hashes/);
  assert.match(
    source,
    /finally \{\s*decisionLock.current = false;\s*setPendingDecision\(null\)/,
  );
  const errorHandler = source.match(/\} catch \{([^]*?)\} finally/)?.[1] ?? "";
  assert.doesNotMatch(errorHandler, /setDecision|router\./);
  assert.match(
    source,
    /setRedirecting\(true\);\s*router\.replace\(rewardApprovalHref\(approvalHashes\)\)/,
  );
  assert.match(source, /return <FullScreenLoader \/>/);
  assert.doesNotMatch(source, /<RewardApprovalSuccess/);
  assert.match(
    source,
    /approving=\{pendingDecision === "approved"\}\s*disabled=\{busy\}/,
  );
  assert.match(source, /redemption.status === "PENDING" \|\| busy/);
});
