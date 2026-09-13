import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/home/parent-action-sheets.tsx", import.meta.url),
  "utf8",
);
const form = source.slice(source.indexOf("function RewardStarsForm("));

test("Reward Stars shows a busy spinner inside its disabled submit button, below the transaction hashes", () => {
  const button = form.match(
    /<button\s[^>]*type="submit"[\s\S]*?<\/button>/,
  )?.[0];
  assert.ok(button);
  assert.match(button, /aria-busy=\{busy\}/);
  assert.match(button, /disabled=\{\s*busy \|\|/);
  assert.match(
    button,
    /\{busy && \(\s*<LoaderCircle className="spin" size=\{18\} aria-hidden="true"/,
  );
  assert.match(button, /Reward \{amount\} Stars/);
  assert.ok(
    form.lastIndexOf("<ParentTransactionDetails") < form.indexOf(button),
  );
});

test("Reward Stars keeps busy through the entire approval and reward operation and releases it on failure", () => {
  assert.match(form, /if \(\s*lock.current \|\|/);
  assert.match(
    form,
    /lock.current = true;\s*setBusy\(true\);\s*onBusyChange\(true\);/,
  );
  assert.match(
    form,
    /await execute\(\s*"rewardStars",[\s\S]*?setComplete\(true\)/,
  );
  assert.match(
    form,
    /finally \{\s*lock.current = false;\s*setBusy\(false\);\s*onBusyChange\(false\);/,
  );
});

test("Reward Stars reveals transaction details only after the entire action succeeds", () => {
  const panels = form.match(/<ParentTransactionDetails\b[^>]*\/>/g);
  assert.equal(panels?.length, 2);
  for (const panel of panels ?? []) {
    assert.match(panel, /completed=\{complete && !busy\}/);
  }
});
