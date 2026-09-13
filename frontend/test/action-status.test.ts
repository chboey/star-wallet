import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActionStatus,
  IntentStatus,
} from "../src/components/home/action-status";

test("transaction progress is announced without a visible banner or duplicate spinner", () => {
  const html = renderToStaticMarkup(
    createElement(IntentStatus, {
      operation: { state: "indexing", message: "Updating your wallet…" },
      busy: true,
    }),
  );
  assert.match(html, /class="sr-only"/);
  assert.doesNotMatch(html, /action-status|<svg|spin/);
  assert.match(html, /role="status"/);
  assert.equal(html.split("Updating your wallet…").length - 1, 1);
});

test("idle operations are hidden and preparation is announced without a purple banner", () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(IntentStatus, { operation: { state: "idle" } }),
    ),
    "",
  );
  const preparing = renderToStaticMarkup(
    createElement(IntentStatus, { operation: { state: "idle" }, busy: true }),
  );
  assert.match(preparing, /Preparing your request/);
  assert.match(preparing, /class="sr-only"/);
  assert.doesNotMatch(preparing, /action-status/);
});

test("success and sync-lag confirmations are announced without visible status lines", () => {
  const synced = renderToStaticMarkup(
    createElement(IntentStatus, {
      operation: {
        state: "success",
        indexed: true,
        message: "All done! Your wallet is up to date.",
      },
    }),
  );
  assert.match(synced, /class="sr-only"/);
  assert.doesNotMatch(synced, /action-status/);
  const pending = renderToStaticMarkup(
    createElement(IntentStatus, {
      operation: {
        state: "success",
        indexed: false,
        message: "Transaction confirmed. Still syncing.",
      },
    }),
  );
  assert.match(pending, /class="sr-only"/);
  assert.doesNotMatch(pending, /action-status/);
  assert.match(pending, /Transaction confirmed. Still syncing/);
});

test("refresh is a trailing error icon and only runs when pressed, never while busy", () => {
  let refreshes = 0;
  const props = {
    state: "error" as const,
    message: "Couldn’t load requests.",
    onRefresh: () => {
      refreshes++;
    },
    refreshLabel: "Refresh requests",
  };
  const html = renderToStaticMarkup(createElement(ActionStatus, props));
  assert.equal(refreshes, 0);
  assert.match(html, /<span>Couldn’t load requests.<\/span><button/);
  assert.match(html, /class="action-status-refresh"/);
  assert.match(html, /aria-label="Refresh requests"/);
  assert.doesNotMatch(html, /outline-action-button|>Try again</);
  ActionStatus(props)!.props.children[2].props.onClick();
  assert.equal(refreshes, 1);
  ActionStatus({
    ...props,
    refreshing: true,
  })!.props.children[2].props.onClick();
  assert.equal(refreshes, 1);
  const busy = renderToStaticMarkup(
    createElement(ActionStatus, { ...props, refreshing: true }),
  );
  assert.match(busy, /disabled=""/);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /spin/);
  assert.doesNotMatch(
    renderToStaticMarkup(
      createElement(ActionStatus, {
        ...props,
        state: "info",
      }),
    ),
    /<button/,
  );
});

test("errors replace progress, announce an alert, and never keep the spinner running", () => {
  const html = renderToStaticMarkup(
    createElement(IntentStatus, {
      operation: { state: "signing", message: "Confirm transaction" },
      error: "Please retry",
      busy: false,
    }),
  );
  assert.match(html, /action-status-error/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /Confirm transaction|spin/);
  assert.match(
    renderToStaticMarkup(
      createElement(ActionStatus, { state: "success", message: "Done" }),
    ),
    /circle-check/,
  );
});
