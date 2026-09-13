import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAddress } from "viem";
import { WalletStep } from "../src/components/onboarding/steps/wallet-step";
import { CompleteStep } from "../src/components/onboarding/steps/complete-step";
import { emptyDraft } from "../src/lib/onboarding";
import {
  existingFamilyForWallet,
  returningFamilyDraft,
  draftWithoutIndexedFamily,
  shouldCheckFamily,
  resumeFamilyOnboarding,
  familyForProfiles,
} from "../src/lib/onboarding-entry";
import { needsFamilyOnboarding } from "../src/lib/wallet-context";
import {
  createStarApi,
  type FamiliesByParentResponse,
  type StarFamily,
} from "../src/lib/star-api";

const parent = "0x0000000000000000000000000000000000001234";
const other = "0x000000000000000000000000000000000000abcd";
const indexing = {
  deployment: "test",
  block: { number: 100, hash: `0x${"12".repeat(32)}` as const },
  hasIndexingErrors: false,
  currentBlock: 101,
  blockLag: 1,
  maximumBlockLag: 20,
};
const family: FamiliesByParentResponse["families"][number] = {
  id: "7",
  parent,
  ensName: "tan.starwallet.eth",
  ensNode: `0x${"00".repeat(32)}`,
  active: true,
  childCount: 1,
  createdAt: "1",
  updatedAt: "1",
  vault: { id: other, aquaPaused: false },
};
const draft = { ...emptyDraft, parentAddress: parent, familyId: family.id };

test("Welcome never starts family discovery, including restored connections and completed saved drafts", () => {
  assert.equal(shouldCheckFamily(parent, null, 0), false);
  assert.equal(
    shouldCheckFamily(parent, null, 1),
    false,
    "Get started alone is not wallet confirmation",
  );
  assert.equal(shouldCheckFamily(parent, null, 5), false);
  assert.equal(shouldCheckFamily(parent, parent, 0), false);
  assert.equal(shouldCheckFamily(parent, parent, 1), true);
  assert.equal(shouldCheckFamily(undefined, parent, 1), false);
  assert.equal(
    shouldCheckFamily(other, parent, 1),
    false,
    "Switching wallets requires a new check",
  );
});

test("an empty current-deployment lookup discards stale setup flags, not the connected wallet", () => {
  const saved = {
    ...draft,
    step: 5,
    vaultReady: true,
    childName: "Jasmine",
    childWallet: other,
    childCredential: { id: "old-passkey", publicKey: "0x12" as const },
    registrationId: "old-registration",
    registrationProposed: true,
    registrationAccepted: true,
  };
  const next = draftWithoutIndexedFamily(parent, saved, 100);
  assert.deepEqual(next, { ...emptyDraft, parentAddress: parent, step: 1 });
  assert.equal(
    saved.childCredential.id,
    "old-passkey",
    "The original saved object is not mutated",
  );
  const inProgress = {
    ...emptyDraft,
    parentAddress: parent,
    familyName: "Tan",
    step: 2,
  };
  assert.deepEqual(
    draftWithoutIndexedFamily(parent, inProgress, 100),
    inProgress,
  );
});

test("a confirmed creation ahead of the indexed block keeps its resumable setup", () => {
  const pending = {
    ...draft,
    familyCreationBlock: "101",
    step: 3,
    vaultReady: true,
  };
  assert.equal(draftWithoutIndexedFamily(parent, pending, 100), pending);
  assert.equal(draftWithoutIndexedFamily(parent, pending, 101).familyId, "");
  assert.equal(draftWithoutIndexedFamily(other, pending, 100).familyId, "");
});

test("wallet pages route to onboarding only after a settled successful no-family result", () => {
  const absent = {
    hydrated: true,
    loading: false,
    error: null,
    familyId: null,
  };
  assert.equal(needsFamilyOnboarding(absent), true);
  assert.equal(needsFamilyOnboarding({ ...absent, hydrated: false }), false);
  assert.equal(needsFamilyOnboarding({ ...absent, loading: true }), false);
  assert.equal(needsFamilyOnboarding({ ...absent, familyId: "7" }), false);
  assert.equal(
    needsFamilyOnboarding({ ...absent, familyId: "7", childCount: 0 }),
    true,
  );
  assert.equal(
    needsFamilyOnboarding({ ...absent, familyId: "7", childCount: 1 }),
    false,
  );
  assert.equal(
    needsFamilyOnboarding({
      ...absent,
      familyId: "7",
      childCount: 0,
      loading: true,
    }),
    false,
  );
  for (const message of ["429", "503", "Invalid response", "Wrong deployment"])
    assert.equal(
      needsFamilyOnboarding({ ...absent, error: new Error(message) }),
      false,
    );
});

test("completion waits for a real button press and has no decorative spinner or timed redirect", () => {
  let continued = 0;
  const props = {
    draft,
    onContinue: () => {
      continued++;
    },
  };
  const html = renderToStaticMarkup(createElement(CompleteStep, props));
  assert.match(html, /Choose a profile/);
  assert.doesNotMatch(html, /Start over|reset-button/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.doesNotMatch(html, /completion-status|spinner|role="status"/);
  assert.equal(continued, 0);
  CompleteStep(props).props.children[1].props.children[1].props.onClick();
  assert.equal(continued, 1);
  const source = readFileSync(
    new URL(
      "../src/components/onboarding/steps/complete-step.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /setTimeout|useEffect|router\.(replace|push)/);
});

test("a connected returning parent is matched to their existing family; a new wallet has none", () => {
  assert.equal(
    existingFamilyForWallet(
      { families: [family], indexing },
      parent,
      emptyDraft,
    ),
    family,
  );
  assert.equal(
    existingFamilyForWallet({ families: [], indexing }, parent, draft),
    null,
  );
  const mixedCase = { ...family, parent: other } as const;
  assert.equal(
    existingFamilyForWallet(
      { families: [mixedCase], indexing },
      getAddress(other),
      emptyDraft,
    ),
    mixedCase,
  );
});

test("saved family preferences are scoped to the connected parent and must exist in the lookup", () => {
  const newer = { ...family, id: "8" };
  const response = { families: [newer, family], indexing };
  assert.equal(existingFamilyForWallet(response, parent, draft), family);
  assert.equal(
    existingFamilyForWallet(response, parent, {
      ...draft,
      parentAddress: other,
    }),
    newer,
  );
  assert.equal(
    existingFamilyForWallet(response, parent, { ...draft, familyId: "999" }),
    newer,
  );
  const inactive = { ...family, active: false };
  assert.equal(
    existingFamilyForWallet(
      { families: [inactive], indexing },
      parent,
      emptyDraft,
    ),
    inactive,
  );
  assert.equal(
    existingFamilyForWallet(
      { families: [inactive, newer], indexing },
      parent,
      emptyDraft,
    ),
    newer,
  );
});

test("malformed or wrong-parent discovery cannot be treated as no family", () => {
  for (const response of [
    {},
    { families: null },
    { families: [{}] },
    { families: [{ ...family, parent: other }] },
    { families: [{ ...family, id: "0" }] },
    { families: [{ ...family, active: "true" }] },
    ...[undefined, null, "1", -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(
      (childCount) => ({ families: [{ ...family, childCount }] }),
    ),
  ])
    assert.throws(
      () =>
        existingFamilyForWallet(
          response as FamiliesByParentResponse,
          parent,
          draft,
        ),
      { code: "STAR_API_INVALID_RESPONSE" },
    );
});

test("returning navigation restores family metadata without carrying a different family's child credentials", () => {
  const saved = {
    ...draft,
    step: 4,
    childName: "Jasmine",
    childWallet: other,
    childCredential: { id: "saved-passkey", publicKey: "0x12" as const },
  };
  const restored = returningFamilyDraft(parent, family, saved);
  assert.equal(restored.familyId, "7");
  assert.equal(restored.familyName, "Tan");
  assert.equal(restored.familyEnsName, family.ensName);
  assert.equal(restored.vaultReady, true);
  assert.equal(restored.childCredential, saved.childCredential);
  for (const stale of [
    { ...saved, familyId: "8" },
    { ...saved, parentAddress: other },
  ]) {
    const next = returningFamilyDraft(parent, family, stale);
    assert.equal(next.familyId, "7");
    assert.equal(next.parentAddress, parent);
    assert.equal(next.childCredential, null);
    assert.equal(next.childWallet, "");
  }
});

test("connection discovery follows all family pages, reuses the API and fails on an unavailable index", async () => {
  const calls: string[] = [];
  const api = createStarApi(async (input) => {
    const url = new URL(String(input), "https://app.invalid");
    calls.push(String(input));
    assert.equal(url.pathname, `/api/star/families/by-parent/${parent}`);
    const first = url.searchParams.get("skip") === "0";
    if (!first)
      assert.equal(url.searchParams.get("blockHash"), indexing.block.hash);
    return Response.json({
      families: first ? [{ ...family, id: "8" }] : [family],
      indexing,
      nextOffset: first ? 100 : null,
    });
  });
  const response = await api.allFamiliesByParent(parent);
  assert.equal(existingFamilyForWallet(response, parent, draft)?.id, "7");
  assert.equal(calls.length, 2);
  const unavailable = createStarApi(async () =>
    Response.json(
      {
        code: "SUBGRAPH_INVALID_RESPONSE",
        message: "The Star Subgraph returned invalid JSON",
      },
      { status: 503 },
    ),
  );
  await assert.rejects(unavailable.allFamiliesByParent(parent), {
    status: 503,
  });
});

test("a family with no registered children resumes Add child despite stale completion flags", () => {
  const incomplete = { ...family, childCount: 0 };
  const next = resumeFamilyOnboarding(parent, incomplete, {
    ...draft,
    step: 5,
    registrationAccepted: true,
  });
  assert.equal(next.step, 3);
  assert.equal(next.familyId, family.id);
  assert.equal(next.familyEnsName, family.ensName);
  assert.equal(next.vaultReady, true);
  assert.equal(next.registrationAccepted, false);
  assert.equal(resumeFamilyOnboarding(parent, incomplete, emptyDraft).step, 3);
  assert.equal(
    resumeFamilyOnboarding(parent, { ...incomplete, vault: null }, draft).step,
    2,
  );
});

test("unfinished child setup reuses its passkey and confirmation step, never the completion screen", () => {
  const saved = {
    ...draft,
    childName: "Jasmine",
    childEnsName: `jasmine.${family.ensName}`,
    childWallet: other,
    childCredential: {
      id: "saved-passkey",
      publicKey: `0x${"12".repeat(64)}` as const,
    },
    registrationId: `0x${"34".repeat(32)}`,
    registrationProposed: true,
    registrationAccepted: true,
    step: 5,
  };
  const incomplete = { ...family, childCount: 0 };
  const next = resumeFamilyOnboarding(parent, incomplete, saved);
  assert.equal(next.step, 4);
  assert.equal(next.childCredential, saved.childCredential);
  assert.equal(next.childWallet, other);
  assert.equal(next.registrationId, saved.registrationId);
  assert.equal(next.registrationProposed, true);
  assert.equal(next.registrationAccepted, false);
  assert.equal(saved.registrationAccepted, true);
  for (const stale of [
    { ...saved, familyId: "999" },
    { ...saved, parentAddress: other },
    { ...saved, childEnsName: "jasmine.someone-else.starwallet.eth" },
    { ...saved, childCredential: null },
  ])
    assert.equal(resumeFamilyOnboarding(parent, incomplete, stale).step, 3);
});

test("profile entry requires an actual registered child and checks only once per explicit attempt", async () => {
  const complete = {
    ...family,
    children: [{ id: "1", wallet: other, active: true }],
    childRegistrations: [],
    indexing,
  } as unknown as StarFamily;
  for (const response of [
    {
      ...complete,
      childCount: 0,
      children: [],
      childRegistrations: [{ status: "PENDING" }],
    },
    { ...complete, childCount: 1, children: [] },
  ]) {
    let calls = 0;
    await assert.rejects(
      familyForProfiles(parent, family.id, {
        fullFamily: async (id) => {
          calls++;
          assert.equal(id, family.id);
          return response as StarFamily;
        },
      }),
      { code: "CHILD_SETUP_REQUIRED" },
    );
    assert.equal(calls, 1);
  }
  assert.equal(
    await familyForProfiles(parent, family.id, {
      fullFamily: async () => complete,
    }),
    complete,
  );
  for (const response of [
    { ...complete, parent: other },
    { ...complete, id: "8" },
  ] satisfies StarFamily[])
    await assert.rejects(
      familyForProfiles(parent, family.id, {
        fullFamily: async () => response,
      }),
      { code: "STAR_API_INVALID_RESPONSE" },
    );
  const error = new Error("Indexer unavailable");
  await assert.rejects(
    familyForProfiles(parent, family.id, {
      fullFamily: async () => {
        throw error;
      },
    }),
    (actual) => actual === error,
  );
});

test("completion shows real profile-load progress and disables duplicate continuation", () => {
  const html = renderToStaticMarkup(
    createElement(CompleteStep, {
      draft,
      onContinue: () => {},
      operation: {
        state: "working",
        message: "Loading your family’s profiles…",
      },
    }),
  );
  assert.match(html, /Loading your family’s profiles/);
  assert.match(html, /role="status"/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 1);
  const errorHtml = renderToStaticMarkup(
    createElement(CompleteStep, {
      draft,
      onContinue: () => {},
      operation: {
        state: "error",
        message: "Try again once registration is indexed.",
      },
    }),
  );
  assert.match(errorHtml, /Try again once registration is indexed/);
  assert.doesNotMatch(errorHtml, /disabled=""/);
});

test("failed family lookup offers retry and disconnect instead of advancing onboarding", () => {
  let retried = 0;
  const props = {
    address: parent,
    connected: true,
    connecting: false,
    operation: {
      state: "error" as const,
      message: "Couldn’t check whether this wallet already has a family.",
    },
    onConnect: () => {},
    onDisconnect: () => {},
    onContinue: () => {
      retried++;
    },
    continueLabel: "Try again",
  };
  const html = renderToStaticMarkup(createElement(WalletStep, props));
  assert.match(html, /Try again/);
  assert.match(html, /Couldn’t check whether this wallet already has a family/);
  assert.doesNotMatch(html, />Continue</);
  WalletStep(props).props.children[1].props.children.props.onClick();
  assert.equal(retried, 1);
});

test("returning-wallet lookup has no polling/retry loop, routes to profile choice and preserves PIN checks", () => {
  const flow = readFileSync(
    new URL(
      "../src/components/onboarding/onboarding-flow.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const lookup =
    flow.match(/const familyLookup = useQuery\(\{([\s\S]*?)\n  \}\);/)?.[1] ??
    "";
  assert.match(
    lookup,
    /queryKey: \["star", "families", connectedWallet\?\.toLowerCase\(\)/,
  );
  assert.match(lookup, /enabled: lookupEnabled/);
  assert.match(lookup, /retry: false/);
  assert.match(lookup, /refetchOnWindowFocus: false/);
  assert.match(lookup, /refetchOnReconnect: false/);
  assert.doesNotMatch(lookup, /refetchInterval:/);
  assert.match(flow, /router\.replace\("\/wallet\/profiles"\)/);
  assert.match(flow, /if \(family && family.childCount > 0\)/);
  assert.match(flow, /resumeFamilyOnboarding\(/);
  assert.match(flow, /onContinue=\{openProfiles\}/);
  assert.match(flow, /familyForProfiles\(connectedWallet, draft.familyId\)/);
  assert.match(flow, /if \(!familyId\) \{\s*setOperation/);
  assert.match(flow, /shouldCheckFamily\(/);
  assert.match(flow, /if \([\s\S]*?!lookupEnabled/);
  assert.doesNotMatch(flow, /setDraft\(readDraft\(connectedWallet\)\)/);
  assert.match(flow, /if \(!canCreateFamily\) return;/);
  assert.doesNotMatch(flow, /saveActiveProfile\("parent"\)/);
  const picker = readFileSync(
    new URL(
      "../src/components/home/screens/profile-switcher-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    picker,
    /if \(activeProfile === "parent"\) \{\s*switchToParent\(\);\s*return;/,
  );
  assert.match(picker, /setPinOpen\(true\)/);
  assert.match(picker, /if \(!profileLoaded\) return;/);
  assert.equal((picker.match(/disabled=\{!profileLoaded\}/g) ?? []).length, 3);
  assert.match(picker, /verifyOnly/);
  assert.match(picker, /onVerified=\{switchToParent\}/);
});
