import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CancelStarRequestButton,
  QuestAssignedSuccess,
  QuestSubmitButton,
} from "../src/components/home/quest-form-feedback";

test("cancel request spins inside its outlined button throughout cancellation", () => {
  const html = renderToStaticMarkup(
    createElement(CancelStarRequestButton, {
      busy: true,
      disabled: false,
      onCancel() {},
    }),
  );
  assert.match(html, /^<button class="outline-action-button"/);
  assert.match(html, /type="button" disabled="" aria-busy="true"/);
  assert.match(html, /<svg[^>]*class="[^"]*spin/);
  assert.ok(html.endsWith("Cancel request</button>"));
  assert.doesNotMatch(html, /action-status|wallet-fullscreen-loader/);
});

test("idle and other disabled request buttons do not spin; cancellation callback stays connected", () => {
  let cancelled = 0;
  const onCancel = () => {
    cancelled++;
  };
  for (const disabled of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(CancelStarRequestButton, {
        busy: false,
        disabled,
        onCancel,
      }),
    );
    assert.match(html, /aria-busy="false"/);
    assert.doesNotMatch(html, /<svg|spin/);
    assert.equal(html.includes('disabled=""'), disabled);
  }
  CancelStarRequestButton({
    busy: false,
    disabled: false,
    onCancel,
  }).props.onClick();
  assert.equal(cancelled, 1);
});

test("only the cancelling request spins, using the existing full-lifecycle operation lock", () => {
  const source = readFileSync(
    new URL("../src/components/home/quest-inbox.tsx", import.meta.url),
    "utf8",
  );
  const button = source.match(/<CancelStarRequestButton[\s\S]*?\/>/)?.[0] ?? "";
  assert.match(
    button,
    /busy=\{\s*busy &&\s*operationTarget ===\s*`request:\$\{request.child.id\}:\$\{request.requestId\}`/,
  );
  assert.match(button, /disabled=\{busy\}/);
  assert.match(button, /onCancel=\{\(\) =>\s*void run\("cancelStarRequest",/);
  assert.match(
    source,
    /if \(lock.current\) return;\s*lock.current = true;\s*setBusy\(true\)/,
  );
  assert.match(
    source,
    /await execute\(action, input, childOnly \? "CHILD" : "PARENT"\)/,
  );
  assert.match(source, /finally \{\s*lock.current = false;\s*setBusy\(false\)/);
});

test("assign quest spins inside the purple submit button only while busy", () => {
  for (const childOnly of [false, true]) {
    const busy = renderToStaticMarkup(
      createElement(QuestSubmitButton, {
        childOnly,
        busy: true,
        disabled: false,
      }),
    );
    assert.match(busy, /^<button class="filled-action-button"/);
    assert.match(busy, /type="submit" disabled="" aria-busy="true"/);
    assert.match(busy, /<svg[^>]*class="[^"]*spin/);
    assert.ok(
      busy.endsWith(`${childOnly ? "Send request" : "Assign quest"}</button>`),
    );
    assert.doesNotMatch(busy, /action-status/);
    for (const disabled of [false, true]) {
      const idle = renderToStaticMarkup(
        createElement(QuestSubmitButton, {
          childOnly,
          busy: false,
          disabled,
        }),
      );
      assert.match(idle, /aria-busy="false"/);
      assert.doesNotMatch(idle, /<svg|spin/);
      assert.equal(idle.includes('disabled=""'), disabled);
    }
  }
});

test("quest success uses the supplied tick illustration and a working Done button, not a status banner", () => {
  let closed = 0;
  const props = {
    childName: "Amelia",
    onDone: () => {
      closed++;
    },
  };
  const html = renderToStaticMarkup(createElement(QuestAssignedSuccess, props));
  assert.ok(
    existsSync(
      new URL("../public/illustrations/kid/purple_tick.png", import.meta.url),
    ),
  );
  assert.match(decodeURIComponent(html), /illustrations\/kid\/purple_tick.png/);
  assert.match(html, /alt="Quest created"/);
  assert.match(html, /width="144" height="144"/);
  assert.match(html, /role="status"/);
  assert.match(html, /Quest has been assigned to Amelia/);
  assert.match(html, />Done<\/button>/);
  assert.doesNotMatch(html, /action-status|spin/);
  assert.equal(closed, 0);
  QuestAssignedSuccess(props).props.children[2].props.onClick();
  assert.equal(closed, 1);
});

test("the quest form wires feedback to its existing submission lock and only shows the tick after success", () => {
  const source = readFileSync(
    new URL("../src/components/home/quest-inbox.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /hideTitle=/);
  assert.match(source, /: done\s*\? "Quest Created"/);
  assert.match(
    source,
    /done && !childOnly \? \(\s*<QuestAssignedSuccess\s+onDone=\{onClose\}\s+transactionHashes=\{operation.transactionHashes\}/,
  );
  assert.match(source, /<QuestSubmitButton[\s\S]*?busy=\{busy\}/);
  assert.match(
    source,
    /<IntentStatus operation=\{operation\} busy=\{busy\} error=\{error\}/,
  );
  assert.match(source, /lock.current = true;\s*setBusy\(true\)/);
  assert.match(source, /finally \{\s*lock.current = false;\s*setBusy\(false\)/);
  const sheet = readFileSync(
    new URL("../src/components/home/parent-action-sheet.tsx", import.meta.url),
    "utf8",
  );
  assert.match(sheet, /aria-labelledby=\{titleId\}/);
  assert.match(sheet, /className=\{hideTitle \? "sr-only" : undefined\}/);
});
