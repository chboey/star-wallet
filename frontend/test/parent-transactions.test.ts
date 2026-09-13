import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Hash, PublicClient, TransactionReceipt } from "viem";
import {
  appendTransactionHash,
  copyTransactionHash,
  waitForParentTransaction,
} from "../src/lib/parent-transactions";
import { ParentTransactionDetails } from "../src/components/home/parent-transaction-details";
import { RewardApprovalSuccess } from "../src/components/home/reward-approval-feedback";
import { QuestAssignedSuccess } from "../src/components/home/quest-form-feedback";
import { WethFundingContent } from "../src/components/home/weth-funding-form";
import { AquaPositionSetupContent } from "../src/components/home/aqua-position-setup-content";

const first: Hash = `0x${"ab".repeat(32)}`;
const second: Hash = `0x${"cd".repeat(32)}`;
const address = "0x0000000000000000000000000000000000000001";
const receipt: TransactionReceipt = {
  transactionHash: first,
  blockHash: second,
  blockNumber: 100n,
  contractAddress: null,
  cumulativeGasUsed: 21_000n,
  effectiveGasPrice: 1n,
  from: address,
  gasUsed: 21_000n,
  logs: [],
  logsBloom: `0x${"00".repeat(256)}`,
  status: "success",
  to: address,
  transactionIndex: 0,
  type: "eip1559",
};
type Client = Pick<PublicClient, "waitForTransactionReceipt">;
type WaitInput = Parameters<Client["waitForTransactionReceipt"]>[0];
type Replacement = Parameters<NonNullable<WaitInput["onReplaced"]>>[0];
const source = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("parent hashes are tracked internally after broadcast and retained through confirmation", async () => {
  let hashes: Hash[] = [];
  let finish!: (value: TransactionReceipt) => void;
  const client: Client = {
    waitForTransactionReceipt: async ({ hash, timeout }) => {
      assert.equal(hash, first);
      assert.equal(
        timeout,
        0,
        "Receipt polling must not expire after broadcast",
      );
      assert.deepEqual(
        hashes,
        [first],
        "Hash must be recorded internally before waiting",
      );
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const pending = waitForParentTransaction(client, first, (hash) => {
    hashes = appendTransactionHash(hashes, hash);
  });
  assert.deepEqual(hashes, [first]);
  finish(receipt);
  assert.equal(await pending, receipt);
  assert.deepEqual(
    hashes,
    [first],
    "Receipt must not duplicate the submitted hash",
  );
});

test("all MetaMask receipt waits disable Viem's default deadline", () => {
  assert.match(
    source("lib/parent-transactions.ts"),
    /waitForTransactionReceipt\(\{[\s\S]*?hash,[\s\S]*?timeout: 0,/,
  );
  assert.match(
    source("components/onboarding/onboarding-flow.tsx"),
    /waitForTransactionReceipt\(\{[\s\S]*?hash,[\s\S]*?timeout: 0,/,
  );
});

test("receipt errors and reverted transactions do not lose the submitted hash", async () => {
  const hashes: Hash[] = [];
  const client: Client = {
    waitForTransactionReceipt: async () => {
      throw new Error("RPC unavailable");
    },
  };
  await assert.rejects(
    waitForParentTransaction(client, first, (hash) => hashes.push(hash)),
    /RPC unavailable/,
  );
  assert.deepEqual(hashes, [first]);
  client.waitForTransactionReceipt = async () => ({
    ...receipt,
    status: "reverted",
  });
  assert.equal(
    (
      await waitForParentTransaction(client, second, (hash) =>
        hashes.push(hash),
      )
    ).status,
    "reverted",
  );
  assert.ok(hashes.includes(second));
  assert.match(
    source("components/home/use-star-intents.ts"),
    /receipt.status !== "success"/,
  );
});

test("repricing exposes the replacement hash and cancellation or different replacement cannot become success", async () => {
  for (const reason of ["repriced", "cancelled", "replaced"] as const) {
    let hashes: Hash[] = [];
    const client: Client = {
      waitForTransactionReceipt: async ({ onReplaced }) => {
        onReplaced?.({
          reason,
          transactionReceipt: { ...receipt, transactionHash: second },
        } as Replacement);
        return { ...receipt, transactionHash: second };
      },
    };
    const pending = waitForParentTransaction(client, first, (hash) => {
      hashes = appendTransactionHash(hashes, hash);
    });
    if (reason === "repriced")
      assert.equal((await pending).transactionHash, second);
    else await assert.rejects(pending, /cancelled|replaced/);
    assert.deepEqual(hashes, [first, second]);
  }
});

test("multi-step hashes are immutable, ordered and deduplicated without truncation", () => {
  const original = [first];
  const next = appendTransactionHash(original, second);
  assert.deepEqual(original, [first]);
  assert.deepEqual(next, [first, second]);
  assert.deepEqual(appendTransactionHash(next, `0x${"AB".repeat(32)}`), next);
});

test("copy writes the entire transaction hash and handles unavailable or denied clipboard access", async () => {
  const copied: string[] = [];
  await copyTransactionHash(first, {
    writeText: async (value) => {
      copied.push(value);
    },
  });
  assert.deepEqual(copied, [first]);
  await assert.rejects(
    copyTransactionHash(first, undefined),
    /Select the transaction hash/,
  );
  await assert.rejects(
    copyTransactionHash(first, {
      writeText: async () => {
        throw new Error("Permission denied");
      },
    }),
    /Permission denied/,
  );
  await assert.rejects(
    copyTransactionHash(address, {
      writeText: async () => {
        assert.fail("An invalid hash must not reach the clipboard");
      },
    }),
    /Invalid transaction hash/,
  );
  assert.deepEqual(copied, [first]);
});

test("the transaction panel only links completed hashes to Sepolia, without copy buttons", () => {
  const render = (hashes: Hash[], completed = true) =>
    renderToStaticMarkup(
      createElement(ParentTransactionDetails, { hashes, completed }),
    );
  assert.equal(
    render([first, second], false),
    "",
    "Pending hashes and explorer links must remain hidden",
  );
  assert.equal(render([]), "");
  assert.equal(render([address]), "");
  const html = render([first, second, first]);
  assert.equal((html.match(/Tx hash : /g) ?? []).length, 2);
  assert.doesNotMatch(html, /On-chain Transaction/);
  for (const hash of [first, second]) {
    assert.ok(
      html.includes(
        `<span class="parent-transaction-hash">${hash.slice(0, 8)}....${hash.slice(-6)}</span>`,
      ),
    );
    assert.ok(html.includes(`href="https://sepolia.etherscan.io/tx/${hash}"`));
    assert.ok(
      html.includes(
        `aria-label="View transaction ${hash} on Sepolia Etherscan (opens in a new tab)"`,
      ),
    );
  }
  assert.doesNotMatch(html, /filled-action-button/);
  assert.doesNotMatch(html, /<button|Copy transaction hash/);
  assert.equal(
    (html.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length,
    2,
  );
  assert.equal(
    (html.match(/class="parent-transaction-entry"/g) ?? []).length,
    2,
  );
  const css = source("components/home/home.css");
  assert.match(
    css,
    /\.parent-transaction-entry\s*\{[^}]*flex: 0 0 auto;[^}]*width: fit-content;[^}]*max-width: 100%;/,
  );
  assert.match(
    css,
    /\.parent-transaction-entry\s*\{[^}]*padding: 8px;[^}]*border: 1px solid #e8e4f5;[^}]*border-radius: 10px;[^}]*background: transparent;/,
  );
  const wrapper = css.match(/\.parent-transaction-details\s*\{[^}]*\}/)?.[0];
  assert.ok(wrapper);
  assert.doesNotMatch(wrapper, /background:|padding:|border:/);
  assert.match(wrapper, /gap: 6px;/);
  assert.match(
    wrapper,
    /display: flex;[^}]*flex-wrap: wrap;[^}]*justify-content: center;/,
  );
  assert.match(wrapper, /text-align: center;/);
  assert.match(
    css,
    /\.parent-transaction-link\s*\{[^}]*color: var\(--purple\);[^}]*text-decoration: underline;/,
  );
  assert.match(
    css,
    /\.parent-transaction-details \.parent-transaction-row > p\s*\{[^}]*font-size: 10px;[^}]*line-height: 1.4;[^}]*text-align: center;[^}]*white-space: nowrap;[^}]*user-select: text;/,
  );
  assert.match(css, /\.parent-transaction-hash\s*\{[^}]*user-select: all;/);
  const component = source("components/home/parent-transaction-details.tsx");
  assert.doesNotMatch(
    component,
    /navigator.clipboard|copyTransactionHash|parent-transaction-copy/,
  );
});

function assertAboveAction(html: string, label: string, hashes = [first]) {
  const action = html.match(
    new RegExp(
      `<button[^>]*class="filled-action-button"[^>]*>[\\s\\S]*?${label}</button>`,
    ),
  );
  assert.ok(action, `Missing purple ${label} action`);
  const actionIndex = html.indexOf(action[0]);
  for (const hash of hashes) {
    const index = html.indexOf(
      `<span class="parent-transaction-hash">${hash.slice(0, 8)}....${hash.slice(-6)}</span>`,
    );
    assert.ok(
      index >= 0 && index < actionIndex,
      `Shortened hash link must be above ${label}`,
    );
  }
}

test("reward approval and quest assignment success keep transaction details above their purple return buttons", () => {
  assertAboveAction(
    renderToStaticMarkup(
      createElement(RewardApprovalSuccess, {
        transactionHashes: [first],
        onDone() {},
      }),
    ),
    "Done",
  );
  assertAboveAction(
    renderToStaticMarkup(
      createElement(QuestAssignedSuccess, {
        childName: "Amelia",
        transactionHashes: [first],
        onDone() {},
      }),
    ),
    "Done",
  );
});

test("WETH approval and deposit hashes stay hidden until the entire funding flow succeeds", () => {
  for (const state of ["signing", "error", "success"] as const) {
    const html = renderToStaticMarkup(
      createElement(WethFundingContent, {
        amount: "0.001",
        walletBalance: 10n ** 18n,
        busy: state === "signing",
        complete: state === "success",
        disabled: false,
        operation: {
          state,
          message: "Transaction status",
          indexed: true,
          transactionHashes: [first, second],
        },
        onAmountChange() {},
        onSubmit() {},
        onDone() {},
      }),
    );
    if (state === "success") assertAboveAction(html, "Done", [first, second]);
    else
      assert.doesNotMatch(
        html,
        /Tx hash :|parent-transaction-details|Copy transaction hash/,
      );
  }
});

test("Aqua transaction details appear above the purple button only on completion", () => {
  for (const step of ["review", "complete"] as const) {
    const html = renderToStaticMarkup(
      createElement(AquaPositionSetupContent, {
        step,
        usdc: "1",
        weth: "0.001",
        busy: step === "review",
        checking: false,
        disabled: false,
        transactionHashes: [first],
        onRefresh() {},
        onAmountChange() {},
        onFund() {},
        onSubmit() {},
        onDone() {},
        onDetails() {},
      }),
    );
    if (step === "complete") assertAboveAction(html, "Done");
    else
      assert.doesNotMatch(
        html,
        /Tx hash :|parent-transaction-details|Copy transaction hash/,
      );
  }
});

test("parent transaction entry points show completed hashes except authorization settings", () => {
  for (const file of [
    "parent-action-sheets",
    "weth-funding-form",
    "goal-request-sheet",
    "quest-inbox",
    "aqua-position-setup-content",
    "screens/reward-approval-screen",
  ]) {
    assert.match(
      source(`components/home/${file}.tsx`),
      /<ParentTransactionDetails\s+hashes=/,
      file,
    );
  }
  const rewards = source("components/home/parent-action-sheets.tsx");
  assert.equal(
    (rewards.match(/<ParentTransactionDetails/g) ?? []).length,
    2,
    "Reward form and success must both retain hashes",
  );
  const inbox = source("components/home/quest-inbox.tsx");
  assert.match(
    inbox,
    /!childOnly &&\s*!busy &&\s*operation.state === "success" &&\s*Boolean\(operation.transactionHashes\?\.length\)/,
  );
  assert.match(
    inbox,
    /showTransactionResult && \([\s\S]*?<ParentTransactionDetails[^]*?className="filled-action-button"/,
  );
  assert.match(inbox, /transactionHashes=\{operation.transactionHashes\}/);
  const settings = source("components/home/parent-authorization-settings.tsx");
  assert.match(settings, /waitForParentTransaction/);
  assert.doesNotMatch(
    settings,
    /ParentTransactionDetails|transactionHashes|appendTransactionHash/,
  );
  const intent = source("components/home/use-star-intents.ts");
  assert.match(
    intent,
    /setOperation\(\{ \.\.\.next, transactionHashes: \[\.\.\.transactionHashes\] \}\)/,
  );
  assert.match(intent, /updateOperation\(\{ state: "error", message \}\)/);
  assert.match(intent, /updateOperation\(\{\s*state: "success"/);
  assert.match(
    intent,
    /signerRole === "CHILD"\s*\? await sendChildIntent\(intent, authorizeDevice\)\s*: await sendIntent\([^]*?onTransactionHash/,
  );
});

test("child-only screens and onboarding do not acquire parent transaction details", () => {
  for (const file of [
    "goal-contribution-sheet",
    "screens/kid-goals-screen",
    "screens/kid-star-request-screen",
    "screens/kid-goal-request-screen",
  ])
    assert.doesNotMatch(
      source(`components/home/${file}.tsx`),
      /ParentTransactionDetails|waitForParentTransaction/,
    );
  for (const file of ["goal-request-sheet", "quest-inbox"])
    assert.match(
      source(`components/home/${file}.tsx`),
      /!childOnly && \(\s*<ParentTransactionDetails/,
    );
  const directory = new URL("../src/components/onboarding/", import.meta.url);
  for (const file of readdirSync(directory, { recursive: true })
    .map(String)
    .filter((file) => /\.tsx?$/.test(file)))
    assert.doesNotMatch(
      readFileSync(new URL(file, directory), "utf8"),
      /ParentTransactionDetails|waitForParentTransaction|Tx hash :/,
    );
});
