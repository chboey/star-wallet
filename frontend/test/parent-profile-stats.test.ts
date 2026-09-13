import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("parent family totals keep only Stars given and Portfolio value in two equal cards", () => {
  const screen = readFileSync(
    new URL("../src/components/home/screens/profile-screen.tsx", import.meta.url),
    "utf8",
  );
  const totals = screen.match(/<section className="profile-totals-section">([\s\S]*?)<\/section>/)?.[1] ?? "";
  assert.equal((totals.match(/className="profile-stat-illustration(?: [^"]*)?"/g) ?? []).length, 2);
  assert.match(totals, /<small>Stars given<\/small>/);
  assert.match(totals, /<small>Portfolio value<\/small>/);
  assert.doesNotMatch(totals, /Principal contributed|profile-stat-currency|profile\/wallet\.png/);
  assert.match(totals, /starsGiven\.toString\(\)/);
  assert.match(totals, /formatUsd18\(portfolio\?\.currentPortfolioValue\.amount\)/);

  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  const stats = css.match(/\.profile-stats\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(stats, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("portfolio arrow uses theme purple while keeping the existing illustration shape", () => {
  const screen = readFileSync(
    new URL("../src/components/home/screens/profile-screen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(screen, /className="profile-stat-illustration profile-portfolio-icon"/);
  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  const icon = css.match(/\.profile-portfolio-icon\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(icon, /background:\s*var\(--purple\)/);
  assert.match(icon, /mask:\s*url\("\/illustrations\/profile\/graph\.png"\)/);
});
