import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  namehash,
  type Hex,
} from "viem";
import { ensRegistrarAbi } from "@star/contracts/abi";
import { registerFamilyEns } from "../src/lib/family-ens";
import { createStarApi, type EnsFamilyPlan } from "../src/lib/star-api";

const parent = "0x0000000000000000000000000000000000001234";
const registrar = "0x0000000000000000000000000000000000005678";
const name = "tan.starwallet.eth";
const ready = {
  status: "READY",
  name,
  checkedAtBlock: "1",
  transaction: null,
  step: null,
  requiresConfirmation: false,
} as const;
const waiting = { ...ready, status: "WAITING", readyAt: "123" } as const;
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function transaction(
  step: "COMMIT_FAMILY_NAME" | "REGISTER_FAMILY_NAME",
  secret: Hex,
): EnsFamilyPlan {
  const hash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "string" },
        { type: "address" },
        { type: "bytes32" },
      ],
      [11155111n, registrar, namehash("starwallet.eth"), "tan", parent, secret],
    ),
  );
  return {
    ...ready,
    status: "TRANSACTION_REQUIRED",
    requiresConfirmation: true,
    step,
    transaction: {
      chainId: 11155111,
      from: parent,
      to: registrar,
      value: "0",
      data:
        step === "COMMIT_FAMILY_NAME"
          ? encodeFunctionData({
              abi: ensRegistrarAbi,
              functionName: "commit",
              args: [hash],
            })
          : encodeFunctionData({
              abi: ensRegistrarAbi,
              functionName: "registerFamily",
              args: ["tan", secret],
            }),
    },
  };
}

for (const resume of [false, true])
  test(`parent-signed family claim persists its secret and resumes safely (${resume})`, async () => {
    const saved = storage();
    const secrets: string[] = [];
    const signed: string[] = [];
    let phase = 0;
    let interrupted = false;
    const api = createStarApi(async (url, options) => {
      assert.ok(String(url).endsWith("ens/families"));
      const input = JSON.parse(String(options?.body));
      assert.equal(input.signer.toLowerCase(), parent.toLowerCase());
      assert.equal(input.label, "tan");
      secrets.push(input.secret);
      assert.equal(
        saved.values.size,
        1,
        "Secret must exist before any signature",
      );
      return Response.json(
        phase === 0
          ? transaction("COMMIT_FAMILY_NAME", input.secret)
          : phase === 1
            ? waiting
            : phase === 2
              ? transaction("REGISTER_FAMILY_NAME", input.secret)
              : ready,
      );
    });
    const run = () =>
      registerFamilyEns({
        name,
        parent,
        api,
        storage: saved,
        onMessage: () => {},
        wait: async () => {
          phase = 2;
        },
        send: async (intent) => {
          assert.equal(intent.signerRole, "PARENT");
          assert.equal(intent.to, registrar);
          signed.push(intent.data);
          phase++;
          if (resume && !interrupted) {
            interrupted = true;
            throw new Error("Receipt temporarily unavailable");
          }
        },
      });
    if (resume) {
      await assert.rejects(run(), /Receipt temporarily unavailable/);
      assert.equal(saved.values.size, 1);
    }
    await run();
    assert.equal(signed.length, 2);
    assert.equal(
      new Set(secrets).size,
      1,
      "Never regenerate after an uncertain transaction",
    );
    assert.equal(saved.values.size, 0);
  });

test("family endpoint refuses admin plans and malformed waiting responses", async () => {
  const input = {
    signer: parent,
    label: "tan",
    secret: `0x${"42".repeat(32)}`,
  };
  for (const response of [
    { ...waiting, readyAt: "not-time" },
    { ...waiting, transaction: { from: parent } },
    {
      ...transaction("COMMIT_FAMILY_NAME", input.secret as Hex),
      step: "AUTHORIZE_FAMILY_REGISTRAR",
    },
  ]) {
    const api = createStarApi(async () => Response.json(response));
    await assert.rejects(api.prepareEnsFamily(input), /invalid|unexpected/i);
  }
});

test("onboarding refuses changed labels and substituted calldata before signing", async () => {
  for (const tamper of ["name", "data"]) {
    let signatures = 0;
    const api = createStarApi(async (_url, options) => {
      const { secret } = JSON.parse(String(options?.body));
      const plan = transaction("REGISTER_FAMILY_NAME", secret);
      if (tamper === "name") plan.name = "other.starwallet.eth";
      else if (plan.transaction)
        plan.transaction.data = encodeFunctionData({
          abi: ensRegistrarAbi,
          functionName: "registerFamily",
          args: ["other", secret],
        });
      return Response.json(plan);
    });
    await assert.rejects(
      registerFamilyEns({
        name,
        parent,
        api,
        storage: storage(),
        onMessage: () => {},
        send: async () => {
          signatures++;
        },
      }),
      /match|Unexpected/,
    );
    assert.equal(signatures, 0);
  }
});
