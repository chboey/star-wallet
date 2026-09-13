import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("parent child cards never render a goal icon, progress bar or target count", () => {
  const source = readFileSync(
    new URL(
      "../src/components/home/screens/home-dashboard.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /<article className="child-overview-card" key=\{child.id\}>/,
  );
  assert.doesNotMatch(
    source,
    /goal-progress|progress-track|goal-count|has-goal|homeGoalIllustration|family\?\.goals/,
  );
  assert.match(source, /displayEnsName\(child.ensName, "Child"\)/);
  assert.match(source, /child.active \? "Active" : "Inactive"/);
  assert.match(source, /const available = availableStars\(child\)/);
  assert.match(source, /Available Stars/);
  assert.match(source, /<strong>\{available.toString\(\)\}<\/strong>/);
});

test("removing the child-card goal row leaves no extra row or goal-specific height", () => {
  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    css,
    /\.child-overview-card\.has-goal|\.goal-progress\b|\.progress-track\b|\.goal-count\b/,
  );
  const card = css.match(/\.child-overview-card\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(card, /grid-template-rows:\s*auto;/);
  assert.doesNotMatch(card, /min-height/);
  // Dedicated kid Dreams progress is unrelated to the removed parent overview row.
  assert.match(css, /\.kid-large-goal-progress\s*\{/);
});
