import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  createElement,
  type TouchEvent,
  type WheelEvent,
  type KeyboardEvent,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useVerticalSectionPaging } from "../src/components/home/use-vertical-section-paging";

// Exercise the actual React event handlers against just the DOM metrics they use.
class PagingElement {
  scrollTop = 0;
  scrollHeight = 300;
  clientHeight = 300;
  focused = false;
  constructor(
    public parent: PagingElement | null = null,
    public editable = false,
  ) {}
  contains(target: unknown): boolean {
    return (
      target === this ||
      (target instanceof PagingElement && this.contains(target.parent))
    );
  }
  closest(): PagingElement | null {
    return this.editable ? this : (this.parent?.closest() ?? null);
  }
  focus() {
    this.focused = true;
  }
  scrollTo({ top }: { top: number }) {
    this.scrollTop = top;
  }
}

function fixture(
  t: TestContext,
  options: { index?: number; enabled?: boolean; busy?: boolean } = {},
) {
  for (const [name, value] of Object.entries({
    Element: PagingElement,
    document: { activeElement: null },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const changes: number[] = [];
  let result: ReturnType<typeof useVerticalSectionPaging> | undefined;
  function Harness() {
    result = useVerticalSectionPaging({
      enabled: true,
      index: 0,
      count: 2,
      busy: false,
      ...options,
      onChange: (next) => changes.push(next),
    });
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  assert.ok(result);
  const binding = result;
  const region = new PagingElement();
  const scroll = new PagingElement(region);
  binding.regionRef.current = region as unknown as HTMLDivElement;
  binding.scrollRef.current = scroll as unknown as HTMLDivElement;
  const event = (extra: Record<string, unknown> = {}) => ({
    target: scroll,
    currentTarget: region,
    timeStamp: 1000,
    stopped: false,
    prevented: false,
    stopPropagation() {
      this.stopped = true;
    },
    preventDefault() {
      this.prevented = true;
    },
    ...extra,
  });
  const wheel = (dy: number, extra: Record<string, unknown> = {}) => {
    const input = event({
      deltaX: 0,
      deltaY: dy,
      deltaMode: 0,
      ctrlKey: false,
      ...extra,
    });
    binding.handlers.onWheel!(input as unknown as WheelEvent<HTMLDivElement>);
    return input;
  };
  const touch = (
    kind: "onTouchStart" | "onTouchEnd" | "onTouchMove" | "onTouchCancel",
    x: number,
    y: number,
    extra: Record<string, unknown> = {},
  ) => {
    const point = { clientX: x, clientY: y };
    const input = event({
      touches: [point],
      changedTouches: [point],
      ...extra,
    });
    binding.handlers[kind]!(input as unknown as TouchEvent<HTMLDivElement>);
    return input;
  };
  return { binding, changes, region, scroll, event, wheel, touch };
}

test("nested Waiting/Completed wheel events never bubble into Reward Stars, even at page boundaries", (t) => {
  const { changes, wheel } = fixture(t);
  assert.equal(wheel(-100).stopped, true);
  assert.deepEqual(changes, []); // Waiting is the first page, not the Reward Stars page.
  assert.equal(wheel(32, { timeStamp: 1300 }).stopped, true);
  assert.equal(wheel(32, { timeStamp: 1340 }).stopped, true);
  assert.deepEqual(changes, [1]);
});

test("nested pager scrolls long lists first, then resets scroll and moves focus when switching", (t) => {
  const { changes, wheel, scroll, region } = fixture(t);
  scroll.scrollHeight = 900;
  scroll.scrollTop = 200;
  assert.equal(wheel(100).prevented, false); // Keep native list scrolling.
  assert.deepEqual(changes, []);
  scroll.scrollTop = 600;
  Object.defineProperty(document, "activeElement", { value: scroll });
  wheel(100, { timeStamp: 1300 });
  assert.deepEqual(changes, [1]);
  assert.equal(scroll.scrollTop, 0);
  assert.equal(region.focused, true);
});

test("Completed can swipe back to Waiting and blocks repeated trackpad momentum", (t) => {
  const { changes, touch, wheel } = fixture(t, { index: 1 });
  assert.equal(touch("onTouchStart", 100, 100).stopped, true);
  assert.equal(touch("onTouchEnd", 100, 200).stopped, true);
  assert.deepEqual(changes, [0]);
  wheel(-100, { timeStamp: 1050 });
  wheel(-100, { timeStamp: 1250 });
  assert.deepEqual(changes, [0]);
});

test("nested pager ignores sideways, cancelled, multitouch, editable-field and zoom gestures", (t) => {
  const { changes, scroll, wheel, touch } = fixture(t);
  wheel(100, { deltaX: 200 });
  wheel(100, { ctrlKey: true });
  const input = new PagingElement(scroll, true);
  assert.equal(wheel(100, { target: input }).stopped, true);
  touch("onTouchStart", 100, 200);
  touch("onTouchEnd", 250, 150);
  touch("onTouchStart", 100, 200);
  touch("onTouchCancel", 100, 200);
  touch("onTouchEnd", 100, 50);
  touch("onTouchStart", 100, 200);
  touch("onTouchMove", 100, 150, { touches: [{}, {}] });
  touch("onTouchEnd", 100, 50);
  assert.deepEqual(changes, []);
});

test("nested pager stays put during wallet actions and does not intercept portal dialogs", (t) => {
  const { changes, wheel, touch } = fixture(t, { busy: true });
  assert.equal(wheel(100).stopped, true);
  touch("onTouchStart", 100, 200);
  touch("onTouchEnd", 100, 50);
  assert.equal(wheel(100, { target: new PagingElement() }).stopped, false);
  assert.deepEqual(changes, []);
});

test("manual tabs cancel in-flight touch paging and keyboard navigation is available on the region", (t) => {
  const { changes, binding, region, touch, event } = fixture(t);
  touch("onTouchStart", 100, 200);
  binding.changePage(1, 1000);
  touch("onTouchEnd", 100, 50, { timeStamp: 1500 });
  assert.deepEqual(changes, [1]);
  const key = event({ target: region, key: "PageDown", timeStamp: 2000 });
  binding.handlers.onKeyDown!(key as unknown as KeyboardEvent<HTMLDivElement>);
  assert.equal(key.stopped, true);
  assert.equal(key.prevented, true);
  assert.deepEqual(changes, [1, 1]);
});

test("inboxes without nested paging leave their Dreams gestures untouched", (t) => {
  const { changes, wheel, touch } = fixture(t, { enabled: false });
  assert.equal(wheel(100).stopped, false);
  assert.equal(touch("onTouchStart", 100, 200).stopped, false);
  assert.equal(touch("onTouchEnd", 100, 50).stopped, false);
  assert.deepEqual(changes, []);
});
