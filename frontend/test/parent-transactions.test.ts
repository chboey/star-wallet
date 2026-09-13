import assert from "node:assert/strict";
import test from "node:test";
import type { Hash, PublicClient, TransactionReceipt } from "viem";
import {
  appendTransactionHash,
  copyTransactionHash,
  waitForParentTransaction,
} from "../src/lib/parent-transactions";

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

test("broadcast hashes are retained while receipt polling waits without a deadline", async () => {
  let hashes: Hash[] = [];
  let finish!: (value: TransactionReceipt) => void;
  const client: Client = {
    waitForTransactionReceipt: async ({ hash, timeout }) => {
      assert.equal(hash, first);
      assert.equal(timeout, 0);
      assert.deepEqual(hashes, [first]);
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
  assert.deepEqual(hashes, [first]);
});

test("RPC errors do not lose the already submitted transaction hash", async () => {
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
});

test("replacement hashes are exposed and cancelled replacements cannot succeed", async () => {
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

test("multi-step hashes remain ordered and deduplicated", () => {
  const original = [first];
  const next = appendTransactionHash(original, second);
  assert.deepEqual(original, [first]);
  assert.deepEqual(next, [first, second]);
  assert.deepEqual(appendTransactionHash(next, `0x${"AB".repeat(32)}`), next);
});

test("copy validates and writes the complete transaction hash", async () => {
  const copied: string[] = [];
  await copyTransactionHash(first, {
    writeText: async (value) => {
      copied.push(value);
    },
  });
  assert.deepEqual(copied, [first]);
  await assert.rejects(copyTransactionHash(first, undefined), /Select/);
  await assert.rejects(
    copyTransactionHash(address, { writeText: async () => undefined }),
    /Invalid transaction hash/,
  );
});
