"use client";

import { useRef, useState, type HTMLAttributes } from "react";
import {
  VerticalSectionPaging,
  type SectionPagingState,
} from "@/lib/vertical-section-paging";

/** A nested pager owns its gestures, including at its first and last page. */
export function useVerticalSectionPaging({
  enabled,
  index,
  count,
  busy,
  onChange,
}: {
  enabled: boolean;
  index: number;
  count: number;
  busy: boolean;
  onChange: (index: number) => void;
}) {
  const regionRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const paging = useRef(new VerticalSectionPaging());
  const [direction, setDirection] = useState<"next" | "previous" | null>(null);

  const changePage = (next: number, time: number) => {
    if (!enabled || busy || next === index || next < 0 || next >= count) return;
    if (scrollRef.current?.contains(document.activeElement))
      regionRef.current?.focus({ preventScroll: true });
    paging.current.lock(time);
    setDirection(next > index ? "next" : "previous");
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    onChange(next);
  };

  const ownsEvent = (target: EventTarget) =>
    enabled && target instanceof Element && regionRef.current?.contains(target);

  const stateFor = (target: EventTarget): SectionPagingState | null => {
    if (
      !ownsEvent(target) ||
      (target as Element).closest(
        "input, select, textarea, [contenteditable='true']",
      )
    )
      return null;
    const scroll = scrollRef.current;
    if (!scroll) return null;
    return {
      index,
      count,
      busy,
      atTop: scroll.scrollTop <= 2,
      atBottom:
        scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2,
    };
  };

  const handlers: HTMLAttributes<HTMLDivElement> = {
    onWheel(event) {
      if (!ownsEvent(event.target)) return;
      event.stopPropagation();
      if (event.ctrlKey) return;
      const state = stateFor(event.target);
      if (!state) return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? scrollRef.current!.clientHeight
            : 1;
      const next = paging.current.wheel(
        event.deltaX * unit,
        event.deltaY * unit,
        event.timeStamp,
        state,
      );
      if (next !== null) changePage(next, event.timeStamp);
    },
    onTouchStart(event) {
      if (!ownsEvent(event.target)) return;
      event.stopPropagation();
      const touch = event.touches[0];
      const state = stateFor(event.target);
      if (event.touches.length !== 1 || !touch || !state) {
        paging.current.cancelTouch();
        return;
      }
      paging.current.startTouch(touch.clientX, touch.clientY, state);
    },
    onTouchMove(event) {
      if (!ownsEvent(event.target)) return;
      event.stopPropagation();
      if (event.touches.length !== 1) paging.current.cancelTouch();
    },
    onTouchCancel(event) {
      if (!ownsEvent(event.target)) return;
      event.stopPropagation();
      paging.current.cancelTouch();
    },
    onTouchEnd(event) {
      if (!ownsEvent(event.target)) return;
      event.stopPropagation();
      const touch = event.changedTouches[0];
      const state = stateFor(event.target);
      if (!touch || !state) {
        paging.current.cancelTouch();
        return;
      }
      const next = paging.current.endTouch(
        touch.clientX,
        touch.clientY,
        event.timeStamp,
        state,
      );
      if (next !== null) changePage(next, event.timeStamp);
    },
    onKeyDown(event) {
      if (!ownsEvent(event.target) || event.target !== event.currentTarget)
        return;
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key))
        return;
      event.stopPropagation();
      event.preventDefault();
      changePage(
        index + (event.key === "ArrowUp" || event.key === "PageUp" ? -1 : 1),
        event.timeStamp,
      );
    },
  };

  return { regionRef, scrollRef, direction, changePage, handlers };
}
