import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { type Hex, type Address, ContractFunctionZeroDataError } from "viem";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ParentAttentionContent } from "../src/components/home/parent-attention-content";
import {
  MasterPinSheet,
  hasMasterPinCredential,
  MASTER_PIN_SESSION_KEY,
  verifyPinCredential,
} from "../src/components/home/master-pin-sheet";
import {
  createDeviceKey,
  deviceAuthorizationStore,
  signWithDevice,
  verifyDeviceKey,
  type AuthorizedDevice,
} from "../src/lib/parent-device-key";
import {
  prepareParentPasskeySetup,
  requireParentAuthorization,
  readParentAuthorization,
  type ParentAuthorizationScope,
} from "../src/lib/parent-authorization";
import {
  parentAuthorizationDigest,
  encodeParentSessionSignature,
  decodeParentSessionSignature,
} from "@star/contracts/child-account";

const wallet = "0x1111111111111111111111111111111111111111" as Address;
const hash = `0x${"a1".repeat(32)}` as Hex;
const proof = `0x${"b2".repeat(256)}` as Hex;
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};
function setup() {
  Object.defineProperty(globalThis, "indexedDB", {
    value: new IDBFactory(),
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: {
      isSecureContext: true,
      location: {
        hostname: "localhost",
        origin: "http://localhost:3001",
        href: "http://localhost:3001/wallet/kid",
      },
      PublicKeyCredential: class {},
      localStorage: storage(),
      sessionStorage: storage(),
      crypto,
      btoa,
      atob,
    },
    configurable: true,
  });
}
function fixture() {
  const state = {
    epoch: 1n,
    supported: true,
    configured: true,
    unavailable: false,
    accepts: true,
    chainId: 11155111,
    reads: 0,
  };
  const client = {
    getChainId: async () => state.chainId,
    getBlockNumber: async () => 100n,
    readContract: async ({
      functionName,
      args,
    }: {
      functionName: string;
      args?: unknown[];
    }) => {
      state.reads++;
      if (state.unavailable) throw new Error("RPC unavailable");
      if (functionName === "parentAuthorizationVersion") {
        if (!state.supported)
          throw new ContractFunctionZeroDataError({ functionName });
        return 1n;
      }
      if (functionName === "parentAuthorizationEpoch") return state.epoch;
      if (functionName === "parentCredentialId")
        return state.configured ? "papa" : "";
      if (
        functionName === "parentPublicKeyX" ||
        functionName === "parentPublicKeyY"
      )
        return hash;
      if (functionName === "isParentAuthorizationValid")
        return state.accepts && args?.[2] === state.epoch;
      throw new Error(functionName);
    },
  } as unknown as ParentAuthorizationScope["client"];
  return {
    state,
    scope: { account: wallet, familyId: 1n, rpId: "localhost", client },
  };
}
async function granted(): Promise<AuthorizedDevice> {
  return {
    ...(await createDeviceKey()),
    version: 1,
    account: wallet,
    epoch: 1n,
    parentSignature: proof,
  };
}
const neverPrompt = async (): Promise<AuthorizedDevice> => {
  throw new Error("Unexpected parent prompt");
};

test("setup rechecks live enrollment and leaves an existing passkey and device approval untouched", async () => {
  setup();
  const { scope, state } = fixture();
  state.configured = false;
  const initial = await readParentAuthorization(scope.client, wallet);
  assert.ok(initial.supported);
  assert.equal(initial.credential.id, "");
  // Another setup can finish after the settings sheet was opened.
  state.configured = true;
  const device = await granted();
  await deviceAuthorizationStore.save(device);
  const result = await prepareParentPasskeySetup(
    scope.client,
    wallet,
    async () => {
      assert.fail("An existing parent passkey must not be recreated");
    },
  );
  assert.equal(result.credential, null);
  assert.equal(result.state.credential.id, "papa");
  assert.equal(result.state.epoch, device.epoch);
  assert.deepEqual(await deviceAuthorizationStore.read(wallet), device);
  await requireParentAuthorization(
    scope,
    neverPrompt,
    new AbortController().signal,
  );
});

test("setup creates a credential only for an account without an enrolled parent passkey", async () => {
  setup();
  const { scope, state } = fixture();
  state.configured = false;
  const credential = {
    id: "new-papa",
    publicKey: `${hash}${hash.slice(2)}` as Hex,
  };
  let creations = 0;
  const result = await prepareParentPasskeySetup(
    scope.client,
    wallet,
    async () => {
      creations++;
      return credential;
    },
  );
  assert.equal(creations, 1);
  assert.equal(result.state.credential.id, "");
  assert.deepEqual(result.credential, credential);
  // Creating a passkey does not itself grant the browser device access.
  assert.equal(await deviceAuthorizationStore.read(wallet), null);
});

test("setup never treats an RPC failure, unsupported account, or wrong chain as a missing passkey", async () => {
  for (const kind of ["network", "deployment", "chain"] as const) {
    const { scope, state } = fixture();
    if (kind === "network") state.unavailable = true;
    if (kind === "deployment") state.supported = false;
    if (kind === "chain") state.chainId = 1;
    await assert.rejects(
      prepareParentPasskeySetup(scope.client, wallet, async () => {
        assert.fail("Failed checks must not trigger passkey creation");
      }),
      /RPC unavailable|not supported|Sepolia/,
    );
  }
});

test("an enrolled passkey is reused for one-time device approval, not mistaken for device permission", async () => {
  setup();
  const { scope } = fixture();
  let prompts = 0;
  let signatures = 0;
  await requireParentAuthorization(
    scope,
    async (authenticate) => {
      prompts++;
      return authenticate();
    },
    new AbortController().signal,
    {
      signPasskey: async (credential) => {
        assert.equal(credential.id, "papa");
        signatures++;
        return proof;
      },
    },
  );
  assert.equal(prompts, 1);
  assert.equal(signatures, 1);
  // Switching profiles does not require another approval of the same device.
  await requireParentAuthorization(
    scope,
    neverPrompt,
    new AbortController().signal,
  );
});

test("device keys are non-exportable, persist through database reopen and sign the exact operation", async () => {
  setup();
  const device = await granted();
  await assert.rejects(crypto.subtle.exportKey("jwk", device.privateKey));
  await deviceAuthorizationStore.save(device);
  const reopened = await deviceAuthorizationStore.read(wallet);
  assert.ok(reopened);
  assert.notEqual(reopened.privateKey, device.privateKey);
  assert.equal(reopened.privateKey.extractable, false);
  await verifyDeviceKey(reopened, hash);
  const signed = encodeParentSessionSignature({
    ...reopened,
    signature: await signWithDevice(reopened, hash),
  });
  assert.deepEqual(decodeParentSessionSignature(signed).parentSignature, proof);
});

test("a valid saved approval has no daily expiry and is checked on chain for every action", async () => {
  setup();
  const { scope, state } = fixture();
  await deviceAuthorizationStore.save(await granted());
  const originalNow = Date.now;
  Date.now = () => originalNow() + 3650 * 86400_000;
  try {
    assert.equal(
      (
        await requireParentAuthorization(
          scope,
          neverPrompt,
          new AbortController().signal,
        )
      ).epoch,
      1n,
    );
    const previousReads = state.reads;
    await requireParentAuthorization(
      scope,
      neverPrompt,
      new AbortController().signal,
    );
    assert.ok(state.reads > previousReads);
  } finally {
    Date.now = originalNow;
  }
});

test("unsupported key storage rejects cleanly instead of hanging the approval spinner", async () => {
  setup();
  const device = await granted();
  await assert.rejects(
    deviceAuthorizationStore.save({
      ...device,
      privateKey: (() => {}) as unknown as CryptoKey,
    }),
    /could not store the device key/,
  );
  assert.equal(await deviceAuthorizationStore.read(wallet), null);
});

test("revocation requests the parent once, binds the fresh proof, and subsequent actions are silent", async () => {
  setup();
  const { scope, state } = fixture();
  await deviceAuthorizationStore.save(await granted());
  state.epoch = 2n;
  let prompts = 0;
  let signatures = 0;
  const result = await requireParentAuthorization(
    scope,
    async (authenticate) => {
      prompts++;
      return authenticate();
    },
    new AbortController().signal,
    {
      signPasskey: async (credential, rpId, digest) => {
        assert.equal(credential.id, "papa");
        assert.equal(rpId, "localhost");
        assert.match(digest, /^0x[0-9a-f]{64}$/);
        signatures++;
        return proof;
      },
    },
  );
  assert.equal(result.epoch, 2n);
  assert.equal(prompts, 1);
  assert.equal(signatures, 1);
  await requireParentAuthorization(
    scope,
    neverPrompt,
    new AbortController().signal,
  );
});

test("lost device storage and mismatched private keys require fresh parent approval", async () => {
  for (const broken of [false, true]) {
    setup();
    if (broken) {
      const original = await granted();
      original.privateKey = (await createDeviceKey()).privateKey;
      await deviceAuthorizationStore.save(original);
    }
    let prompts = 0;
    await requireParentAuthorization(
      fixture().scope,
      async (authenticate) => {
        prompts++;
        return authenticate();
      },
      new AbortController().signal,
      { signPasskey: async () => proof },
    );
    assert.equal(prompts, 1);
  }
});

test("network outages keep the saved grant and never trigger passkey renewal", async () => {
  setup();
  const { scope, state } = fixture();
  await deviceAuthorizationStore.save(await granted());
  state.unavailable = true;
  await assert.rejects(
    requireParentAuthorization(
      scope,
      neverPrompt,
      new AbortController().signal,
    ),
    /RPC unavailable/,
  );
  assert.ok(await deviceAuthorizationStore.read(wallet));
});

test("wrong network, unsupported deployment, and missing enrollment stop before passkey or saving", async () => {
  for (const kind of ["network", "deployment", "enrollment"] as const) {
    setup();
    const { scope, state } = fixture();
    if (kind === "network") state.chainId = 1;
    if (kind === "deployment") state.supported = false;
    if (kind === "enrollment") state.configured = false;
    await assert.rejects(
      requireParentAuthorization(
        scope,
        neverPrompt,
        new AbortController().signal,
      ),
      /Sepolia|deployment|set up Parent authorization/,
    );
    assert.equal(await deviceAuthorizationStore.read(wallet), null);
  }
});

test("cancelling the PIN handoff or passkey prompt cannot persist an authorization", async () => {
  for (const stage of ["pin", "passkey", "navigation"] as const) {
    setup();
    const controller = new AbortController();
    await assert.rejects(
      requireParentAuthorization(
        fixture().scope,
        async (authenticate) => {
          if (stage === "pin") throw new Error("Cancelled at PIN");
          return authenticate();
        },
        controller.signal,
        {
          signPasskey: async () => {
            if (stage === "passkey") throw new Error("Passkey cancelled");
            controller.abort();
            return proof;
          },
        },
      ),
    );
    assert.equal(await deviceAuthorizationStore.read(wallet), null);
  }
});

test("failed parent proof verification and failed persistence do not grant access", async () => {
  for (const stage of ["proof", "storage"] as const) {
    setup();
    const { scope, state } = fixture();
    state.accepts = stage !== "proof";
    await assert.rejects(
      requireParentAuthorization(
        scope,
        (authenticate) => authenticate(),
        new AbortController().signal,
        {
          signPasskey: async () => proof,
          store:
            stage === "storage"
              ? {
                  ...deviceAuthorizationStore,
                  save: async () => {
                    throw new Error("Storage denied");
                  },
                }
              : deviceAuthorizationStore,
        },
      ),
      /verified|Storage denied/,
    );
    assert.equal(await deviceAuthorizationStore.read(wallet), null);
  }
});

test("authorization digest binds account, family, network, epoch and device key", async () => {
  const key = await createDeviceKey();
  const original = {
    ...key,
    account: wallet,
    familyId: 1n,
    chainId: 11155111,
    epoch: 1n,
  };
  const digest = parentAuthorizationDigest(original);
  for (const change of [
    { account: "0x2222222222222222222222222222222222222222" as Address },
    { familyId: 2n },
    { chainId: 1 },
    { epoch: 2n },
    { deviceKeyX: hash },
  ]) {
    assert.notEqual(
      parentAuthorizationDigest({ ...original, ...change }),
      digest,
    );
  }
});

test("parent popup reuses the requested illustration and a purple Continue action, with no daily expiry claim", () => {
  const html = renderToStaticMarkup(
    createElement(ParentAttentionContent, { onContinue: () => {} }),
  );
  assert.match(html, /exclaimation_mark\.png/);
  assert.match(html, /Your parent&#x27;s attention is needed/);
  assert.match(html, /filled-action-button[^>]*>Continue<\/button>/);
  assert.doesNotMatch(html, /24.hour|tomorrow|daily/);
});

test("passkey PIN step cannot create a fresh PIN as approval or switch into the parent profile", () => {
  for (const alreadySet of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(MasterPinSheet, {
        alreadySet,
        verifyOnly: true,
        purpose: "passkey",
        onClose() {},
        onSaved() {},
      }),
    );
    assert.doesNotMatch(html, /Create PIN|Switch to parent/);
    assert.match(
      html,
      alreadySet ? /passkey verification/ : /No master PIN is set up/,
    );
    if (!alreadySet) assert.doesNotMatch(html, /<form|<input/);
  }
});

test("existing master PIN migrates to persistent storage and incorrect or absent PINs fail", async () => {
  setup();
  const salt = new Uint8Array(16).fill(7);
  const source = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("1234"),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
      source,
      256,
    ),
  );
  const credential = JSON.stringify({
    version: 1,
    salt: btoa(String.fromCharCode(...salt)),
    digest: btoa(String.fromCharCode(...digest)),
  });
  window.sessionStorage.setItem(MASTER_PIN_SESSION_KEY, credential);
  assert.equal(hasMasterPinCredential(), true);
  window.sessionStorage.removeItem(MASTER_PIN_SESSION_KEY);
  assert.equal(await verifyPinCredential("1234"), true);
  assert.equal(await verifyPinCredential("4321"), false);
  window.localStorage.removeItem(MASTER_PIN_SESSION_KEY);
  assert.equal(await verifyPinCredential("1234"), false);
});

test("capability detection distinguishes actual absence from other RPC errors", async () => {
  const { scope, state } = fixture();
  state.supported = false;
  assert.deepEqual(await readParentAuthorization(scope.client, wallet), {
    supported: false,
  });
  state.unavailable = true;
  await assert.rejects(
    readParentAuthorization(scope.client, wallet),
    /RPC unavailable/,
  );
});
