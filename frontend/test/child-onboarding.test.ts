import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, type Hex } from "viem";
import { childAccountAbi } from "@star/contracts/abi";
import { provisionChild } from "../src/lib/child-onboarding";
import { createStarApi } from "../src/lib/star-api";

const parent = "0x0000000000000000000000000000000000001234";
const child = "0x0000000000000000000000000000000000005678";
const hash = `0x${"a".repeat(64)}` as Hex;
const intent = {
  chainId: 11155111,
  signerRole: "PARENT",
  to: parent,
  data: "0x12345678",
  value: "0",
  summary: "Set up",
};

for (const resume of [false, true])
  test(`onboarding routes acceptance to child authentication (resume=${resume})`, async () => {
    const signed: string[] = [];
    let accepted = false;
    const api = createStarApi(async (url) => {
      if (String(url).endsWith("children/account"))
        return Response.json({
          childWallet: child,
          parent,
          alreadyDeployed: resume,
          intents: resume ? [] : [intent],
        });
      if (String(url).endsWith("ens/subdomains"))
        return Response.json({
          name: "child.family.starwallet.eth",
          checkedAtBlock: "1",
          status: "READY",
          step: null,
          transaction: null,
          requiresConfirmation: false,
        });
      return Response.json({
        ensName: "child.family.starwallet.eth",
        ensNode: hash,
        registrationId: hash,
        childWallet: child,
        requiresSequentialConfirmation: true,
        registrationState: accepted
          ? "ACCEPTED"
          : resume
            ? "PENDING"
            : "UNREGISTERED",
        intents: accepted
          ? []
          : [
              ...(resume ? [] : [intent]),
              {
                ...intent,
                signerRole: "CHILD",
                to: child,
                data: encodeFunctionData({
                  abi: childAccountAbi,
                  functionName: "acceptRegistration",
                  args: [hash],
                }),
              },
            ],
      });
    });
    const result = await provisionChild({
      familyId: "1",
      ensName: "child.family.starwallet.eth",
      parent,
      credential: {
        id: "public-credential-id",
        publicKey: `0x${"1".repeat(128)}`,
      },
      api,
      send: async (transaction) => {
        assert.equal(transaction.signerRole, "PARENT");
        signed.push("parent");
      },
      sendChild: async (transaction) => {
        assert.equal(transaction.to, child);
        signed.push("child");
        accepted = true;
      },
      onMessage: () => {},
      onProgress: () => {},
    });
    assert.equal(result.childWallet, child);
    assert.deepEqual(
      signed,
      resume ? ["child"] : ["parent", "parent", "child"],
    );
  });

test("onboarding stops before any signature when the connected parent is wrong", async () => {
  const api = createStarApi(async () =>
    Response.json({
      childWallet: child,
      parent: child,
      alreadyDeployed: false,
      intents: [intent],
    }),
  );
  await assert.rejects(
    provisionChild({
      familyId: "1",
      ensName: "child.family.starwallet.eth",
      parent,
      credential: { id: "public-id", publicKey: `0x${"1".repeat(128)}` },
      api,
      send: async () => assert.fail("must not sign"),
      sendChild: async () => assert.fail("must not sign"),
      onMessage: () => {},
      onProgress: () => {},
    }),
    /parent wallet/,
  );
});
