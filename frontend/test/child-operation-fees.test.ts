import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, custom, type Hex } from "viem";
import { sepolia } from "viem/chains";
import {
  createBundlerClient,
  entryPoint08Abi,
  entryPoint08Address,
  toSmartAccount,
} from "viem/account-abstraction";
import { estimateChildOperationFees } from "../src/lib/child-operation-fees";
import { createPasskeyGasStub } from "@star/contracts/child-account";

function feeClients(baseFee: unknown, priorityFee: unknown) {
  const client = createPublicClient({
    chain: sepolia,
    transport: custom(
      {
        request: async ({ method, params }) => {
          assert.equal(method, "eth_getBlockByNumber");
          assert.deepEqual(params, ["latest", false]);
          return { baseFeePerGas: baseFee };
        },
      },
      { retryCount: 0 },
    ),
  });
  const bundler = createPublicClient({
    transport: custom(
      {
        request: async ({ method, params }) => {
          assert.equal(method, "rundler_maxPriorityFeePerGas");
          assert.deepEqual(params, []);
          return priorityFee;
        },
      },
      { retryCount: 0 },
    ),
  });
  return { client, bundler };
}

test("child fees use the bundler tip and a rounded-up 50% base-fee buffer", async () => {
  const { client, bundler } = feeClients("0x3e9", "0x5f5e100");
  assert.deepEqual(await estimateChildOperationFees(client, bundler), {
    maxPriorityFeePerGas: 100_000_000n,
    maxFeePerGas: 100_001_502n,
  });
});

test("invalid or excessive child fees stop instead of falling back to network fees", async () => {
  for (const [base, tip] of [
    ["0x1", null],
    ["0x1", {}],
    ["0x1", "100000000"],
    ["0x1", "0x00"],
    ["0x1", "0x"],
    ["0x1", "0x" + "f".repeat(65)],
    [null, "0x1"],
    [undefined, "0x1"],
    ["0x1", "0xffffffffffff"],
    ["0xffffffffffff", "0x1"],
  ]) {
    const { client, bundler } = feeClients(base, tip);
    await assert.rejects(
      estimateChildOperationFees(client, bundler),
      /invalid fee estimate|safety cap/,
    );
  }
});

test("viem finalizes fresh bundler fees before both paymaster stages and signing", async () => {
  const sender = "0x0000000000000000000000000000000000001234";
  const paymaster = "0x0000000000000000000000000000000000005678";
  const calls: string[] = [];
  let priorityFee = 100_000_000n;
  let feeUnavailable = false;
  const client = createPublicClient({
    chain: sepolia,
    transport: custom(
      {
        request: async ({ method }) => {
          if (method === "eth_getCode") return "0x01";
          assert.equal(
            method,
            "eth_getBlockByNumber",
            "never use ordinary network fee estimates",
          );
          return { baseFeePerGas: "0x3b9aca00" }; // 1 gwei
        },
      },
      { retryCount: 0 },
    ),
  });
  const account = await toSmartAccount({
    client,
    entryPoint: {
      address: entryPoint08Address,
      abi: entryPoint08Abi,
      version: "0.8",
    },
    getAddress: async () => sender,
    getFactoryArgs: async () => ({}),
    getNonce: async () => 0n,
    encodeCalls: async () => "0x12345678",
    getStubSignature: async () => createPasskeyGasStub("localhost"),
    signMessage: async () => assert.fail("unexpected message signature"),
    signTypedData: async () => assert.fail("unexpected typed-data signature"),
    signUserOperation: async (operation) => {
      calls.push("sign");
      assert.equal(operation.maxPriorityFeePerGas, priorityFee);
      assert.equal(operation.maxFeePerGas, 1_500_000_000n + priorityFee);
      assert.equal(operation.verificationGasLimit, 90_000n);
      assert.equal(operation.preVerificationGas, 55_000n);
      assert.equal(operation.paymasterData, "0x1234");
      return "0x02";
    },
  });
  const bundler = createBundlerClient({
    account,
    client,
    chain: sepolia,
    paymaster: true,
    userOperation: {
      estimateFeesPerGas: ({ bundlerClient }) =>
        estimateChildOperationFees(client, bundlerClient),
    },
    transport: custom(
      {
        request: async ({ method, params }) => {
          calls.push(method);
          if (method === "rundler_maxPriorityFeePerGas") {
            if (feeUnavailable)
              throw new Error("Bundler fee estimate unavailable");
            return `0x${priorityFee.toString(16)}`;
          }
          const operation = params?.[0];
          assert.equal(BigInt(operation.maxPriorityFeePerGas), priorityFee);
          assert.equal(
            BigInt(operation.maxFeePerGas),
            1_500_000_000n + priorityFee,
          );
          if (method.startsWith("pm_"))
            return {
              paymaster,
              paymasterData: "0x1234",
              paymasterVerificationGasLimit: "0x7ab9",
              paymasterPostOpGasLimit: "0x0",
            };
          if (method === "eth_estimateUserOperationGas") {
            assert.equal(
              operation.signature,
              createPasskeyGasStub("localhost"),
            );
            assert.equal(operation.verificationGasLimit, "0x0");
            assert.equal(operation.preVerificationGas, "0x0");
            return {
              callGasLimit: "0x3b70b",
              verificationGasLimit: "0x15f90",
              preVerificationGas: "0xd6d8",
            };
          }
          assert.equal(method, "eth_sendUserOperation");
          assert.equal(operation.signature, "0x02");
          return `0x${"ab".repeat(32)}` as Hex;
        },
      },
      { retryCount: 0 },
    ),
  });
  for (const tip of [100_000_000n, 200_000_000n]) {
    priorityFee = tip;
    calls.length = 0;
    await bundler.sendUserOperation({
      callData: "0x12345678",
    });
    assert.deepEqual(calls, [
      "rundler_maxPriorityFeePerGas",
      "pm_getPaymasterStubData",
      "eth_estimateUserOperationGas",
      "pm_getPaymasterData",
      "sign",
      "eth_sendUserOperation",
    ]);
  }
  feeUnavailable = true;
  calls.length = 0;
  await assert.rejects(
    bundler.sendUserOperation({
      callData: "0x12345678",
    }),
    /Bundler fee estimate unavailable/,
  );
  assert.deepEqual(
    calls,
    ["rundler_maxPriorityFeePerGas"],
    "failed fees must stop before sponsorship or signing",
  );
});
