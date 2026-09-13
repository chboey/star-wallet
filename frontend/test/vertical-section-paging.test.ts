import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  VerticalSectionPaging,
  type SectionPagingState,
} from "../src/lib/vertical-section-paging";

const state = (
  extra: Partial<SectionPagingState> = {},
): SectionPagingState => ({
  index: 0,
  count: 2,
  busy: false,
  atTop: true,
  atBottom: true,
  ...extra,
});

test("wheel scrolling switches Stars sections vertically after a deliberate gesture", () => {
  const paging = new VerticalSectionPaging();
  assert.equal(paging.wheel(0, 32, 1000, state()), null);
  assert.equal(paging.wheel(0, 32, 1040, state()), 1);
  assert.equal(paging.wheel(0, -64, 1500, state({ index: 1 })), 0);
});

test("long forms and request lists scroll normally before paging at their boundaries", () => {
  const paging = new VerticalSectionPaging();
  assert.equal(paging.wheel(0, 200, 1000, state({ atBottom: false })), null);
  assert.equal(paging.wheel(0, 64, 1200, state({ atTop: false })), 1);
  assert.equal(
    paging.wheel(0, -200, 1700, state({ index: 1, atTop: false })),
    null,
  );
  assert.equal(paging.wheel(0, -64, 1900, state({ index: 1 })), 0);
});

test("trackpad momentum cannot immediately switch back and short/sideways gestures do not page", () => {
  const paging = new VerticalSectionPaging();
  assert.equal(paging.wheel(80, 20, 1000, state()), null);
  assert.equal(paging.wheel(0, 40, 1100, state()), null);
  // Isolated small movements are not added together across an idle interval.
  assert.equal(paging.wheel(0, 30, 1400, state()), null);
  assert.equal(paging.wheel(0, 64, 1600, state()), 1);
  for (const time of [1650, 1750, 1850, 1950, 2050]) {
    assert.equal(paging.wheel(0, -100, time, state({ index: 1 })), null);
  }
  assert.equal(paging.wheel(0, -64, 2500, state({ index: 1 })), 0);
});

test("one-finger up/down swipes page using the scroll position at gesture start", () => {
  const paging = new VerticalSectionPaging();
  paging.startTouch(100, 250, state());
  assert.equal(paging.endTouch(105, 150, 1000, state()), 1);
  paging.startTouch(100, 150, state({ index: 1 }));
  assert.equal(paging.endTouch(105, 250, 1500, state({ index: 1 })), 0);
  // Reaching the bottom during a scroll is not a second, implicit page gesture.
  paging.startTouch(100, 250, state({ atBottom: false }));
  assert.equal(paging.endTouch(100, 100, 2000, state()), null);
});

test("horizontal swipes, taps, cancellations and multitouch cancellation do not page", () => {
  const paging = new VerticalSectionPaging();
  for (const [x, y] of [
    [250, 180],
    [100, 180],
  ]) {
    paging.startTouch(100, 200, state());
    assert.equal(paging.endTouch(x, y, 1000, state()), null);
  }
  paging.startTouch(100, 200, state());
  paging.cancelTouch();
  assert.equal(paging.endTouch(100, 0, 2000, state()), null);
});

test("pending wallet actions and stale gestures cannot switch panels", () => {
  const paging = new VerticalSectionPaging();
  assert.equal(paging.wheel(0, 100, 1000, state({ busy: true })), null);
  paging.startTouch(100, 200, state());
  assert.equal(paging.endTouch(100, 0, 2000, state({ busy: true })), null);
  paging.startTouch(100, 200, state());
  assert.equal(paging.endTouch(100, 0, 2500, state({ index: 1 })), null);
  paging.startTouch(100, 200, state());
  paging.lock(3000); // Clicking a tab discards an in-flight touch gesture.
  assert.equal(paging.endTouch(100, 0, 3500, state()), null);
});

test("first and last sections never wrap around", () => {
  const paging = new VerticalSectionPaging();
  assert.equal(paging.wheel(0, -100, 1000, state()), null);
  assert.equal(paging.wheel(0, 100, 1500, state({ index: 1 })), null);
});

test("Stars keeps both panels mounted, scrolls content inside the sheet and pins the reward footer", () => {
  const component = readFileSync(
    new URL("../src/components/home/parent-action-sheets.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL(
      "../src/components/home/parent-reward-sheet.module.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(component, /onWheel=/);
  assert.match(component, /onTouchEnd=/);
  assert.match(component, /hidden=\{panel !== item.id\}/);
  assert.match(component, /inert=\{panel !== item.id\}/);
  assert.match(component, /enabled=\{panel === "requests"\}/);
  assert.match(component, /data-stars-scroll/);
  assert.match(component, /ArrowUp/);
  assert.doesNotMatch(component, /scrollLeft|ArrowLeft|styles.carousel/);
  assert.match(css, /\.panel\s*\{[^}]*overflow-y: auto/s);
  assert.match(css, /\.fields\s*\{[^}]*overflow-y: auto/s);
  assert.match(css, /\.footer\s*\{[^}]*flex-shrink: 0/s);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /scroll-snap-type: x/);
  assert.match(
    css,
    /\.sheet:global\(\.parent-action-sheet\)\s*\{[^}]*height: auto/s,
  );
  assert.match(css, /\.sheet\.requestsSheet\s*\{[^}]*height: min\(520px/s);
  assert.match(css, /\.fields\s*\{[^}]*flex: 0 1 auto/s);
  assert.match(component, /panel === "requests" \? styles.requestsSheet/);
  assert.match(component, /scope="stars"\s+verticalPaging/);
});

test("Waiting and Completed own a full-height scroll area without changing the other inbox screens", () => {
  const component = readFileSync(
    new URL("../src/components/home/quest-inbox.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/components/home/quest-inbox.module.css", import.meta.url),
    "utf8",
  );
  assert.match(component, /verticalPaging = false/);
  assert.match(component, /enabled: verticalPaging && enabled/);
  assert.match(
    component,
    /onChange: \(index\) => changeView\(views\[index\]\)/,
  );
  assert.match(component, /aria-pressed=\{view === tab\}/);
  assert.match(component, /ref=\{regionRef\}/);
  assert.match(component, /ref=\{scrollRef\}/);
  assert.match(component, /\{\.\.\.handlers\}/);
  assert.match(css, /\.inbox\.pagedInbox\s*\{[^}]*height: 100%/s);
  assert.match(css, /\.pagedInbox > \.content\s*\{[^}]*overflow-y: auto/s);
  assert.match(css, /\.pagedInbox > \.content\s*\{[^}]*scrollbar-width: none/s);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("Dreams announces the actual initial section on entry and fades it on the same timer as scroll changes", () => {
  const component = readFileSync(
    new URL(
      "../src/components/home/screens/kid-journey-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/components/home/home.css", import.meta.url),
    "utf8",
  );
  assert.match(component, /useState\(initialSection\)/);
  assert.match(component, /\(\) => \(\{ id: initialSection, sequence: 0 \}\)/);
  assert.match(
    component,
    /window.setTimeout\(\(\) => setSwitchOverlay\(null\), 2_000\)/,
  );
  assert.match(component, /return \(\) => window.clearTimeout\(timer\)/);
  assert.match(component, /\}, \[switchOverlay\]\)/);
  assert.match(
    component,
    /setSwitchOverlay\(\{ id, sequence: overlaySequenceRef.current \}\)/,
  );
  assert.match(css, /animation: kid-journey-overlay 2s/);
});
