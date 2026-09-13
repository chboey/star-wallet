import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FullScreenLoader,
  WalletRefreshStatus,
} from "../src/components/home/home-ui";
import { walletRefreshFilter } from "../src/lib/wallet-refresh";
import WalletLoading from "../src/app/wallet/loading";
import { WalletStep } from "../src/components/onboarding/steps/wallet-step";

test("onboarding keeps its wallet content visible with inline progress, never a full-screen loader", () => {
  for (const message of [
    "Checking your wallet for an existing family…",
    "Opening your family…",
  ]) {
    const html = renderToStaticMarkup(
      createElement(WalletStep, {
        address: "0x0000000000000000000000000000000000001234",
        connected: true,
        connecting: false,
        operation: { state: "working", message },
        onConnect: () => {},
        onContinue: () => {},
        onDisconnect: () => {},
      }),
    );
    assert.match(html, /Connect your wallet/);
    assert.match(html, /Connected wallet/);
    assert.match(
      decodeURIComponent(html),
      /illustrations\/onboarding\/wallet.png/,
    );
    assert.match(html, /operation-message working/);
    assert.match(html, /role="status"/);
    assert.ok(html.includes(message));
    assert.match(html, /class="primary-button"[^>]*disabled=""/);
    assert.doesNotMatch(html, /wallet-fullscreen-loader|onboarding-loading/);
  }
  const flow = readFileSync(
    new URL(
      "../src/components/onboarding/onboarding-flow.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(flow, /operation=\{walletOperation\}/);
  assert.match(flow, /familyLookupFailed \? "Try again"/);
  assert.doesNotMatch(
    flow,
    /OnboardingLoading|FullScreenLoader|onboarding-loading/,
  );
  const ui = readFileSync(
    new URL("../src/components/onboarding/onboarding-ui.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(ui, /FullScreenLoader|OnboardingLoading/);
});

test("initial loading and explicit refreshes use the full-screen spinner; idle background updates do not", () => {
  const page = renderToStaticMarkup(createElement(FullScreenLoader));
  assert.match(page, /role="status" aria-label="Loading"/);
  assert.match(page, /class="[^"]*spin/);
  assert.equal(renderToStaticMarkup(createElement(WalletLoading)), page);
  assert.equal(
    renderToStaticMarkup(
      createElement(WalletRefreshStatus, { requested: false }),
    ),
    "",
  );
  const refresh = renderToStaticMarkup(
    createElement(WalletRefreshStatus, { requested: true }),
  );
  assert.equal(refresh, page);
  assert.doesNotMatch(refresh, /wallet-refresh-status|Refreshing…/);
});

test("cached wallet and quest reads update in the background without requesting a full-screen spinner", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const familyKey = ["star", "family", "1"];
  const inboxKey = ["star", "family", "1", "inbox", "1", "waiting"];
  client.setQueryData(familyKey, { balance: "10" });
  client.setQueryData(inboxKey, { requests: [] });
  const familyResult = Promise.withResolvers<{ balance: string }>();
  const inboxResult = Promise.withResolvers<{ requests: string[] }>();
  const familyFetch = client.fetchQuery({
    queryKey: familyKey,
    queryFn: () => familyResult.promise,
  });
  const inboxFetch = client.fetchQuery({
    queryKey: inboxKey,
    queryFn: () => inboxResult.promise,
  });
  assert.equal(client.isFetching(walletRefreshFilter), 2);
  assert.equal(
    renderToStaticMarkup(
      createElement(WalletRefreshStatus, { requested: false }),
    ),
    "",
  );
  assert.deepEqual(client.getQueryData(familyKey), { balance: "10" });
  familyResult.resolve({ balance: "14" });
  await familyFetch;
  assert.equal(client.isFetching(walletRefreshFilter), 1);
  inboxResult.resolve({ requests: ["approved"] });
  await inboxFetch;
  assert.equal(client.isFetching(walletRefreshFilter), 0);
  assert.deepEqual(client.getQueryData(familyKey), { balance: "14" });
  client.clear();
});

test("initial and unrelated reads are not background refreshes, and failed refreshes stop spinning without erasing cached data", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const first = Promise.withResolvers<string>();
  const unrelated = Promise.withResolvers<string>();
  const initialFetch = client.fetchQuery({
    queryKey: ["star", "child", "1"],
    queryFn: () => first.promise,
  });
  client.setQueryData(["other"], "cached");
  const otherFetch = client.fetchQuery({
    queryKey: ["other"],
    queryFn: () => unrelated.promise,
  });
  assert.equal(client.isFetching(walletRefreshFilter), 0);
  first.resolve("child");
  unrelated.resolve("updated");
  await Promise.all([initialFetch, otherFetch]);
  const failed = Promise.withResolvers<string>();
  const refetch = client.fetchQuery({
    queryKey: ["star", "child", "1"],
    queryFn: () => failed.promise,
  });
  assert.equal(client.isFetching(walletRefreshFilter), 1);
  const rejection = assert.rejects(refetch, /Unavailable/);
  failed.reject(new Error("Unavailable"));
  await rejection;
  assert.equal(client.isFetching(walletRefreshFilter), 0);
  assert.equal(client.getQueryData(["star", "child", "1"]), "child");
  client.clear();
});
