"use client";

import { Ellipsis, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function AquaPositionOptions({
  disabled,
  onClosePosition,
  onAddPosition,
}: {
  disabled: boolean;
  onClosePosition: () => void;
  onAddPosition: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstFocus = useRef(0);
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      [firstFocus.current]?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      ref={root}
      className="aqua-position-options"
      onBlur={(event) => {
        // Mobile Safari can report a null relatedTarget before dispatching the
        // tapped menu item's click. The outside pointer handler still closes
        // the menu, so only act on blur when Safari supplies a real target.
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
          !disabled
        ) {
          event.preventDefault();
          const items =
            root.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]',
            );
          if (!open || !items?.length) {
            firstFocus.current =
              event.key === "ArrowUp" || event.key === "End" ? 1 : 0;
            setOpen(true);
          } else {
            const current = Array.from(items).findIndex(
              (item) => item === document.activeElement,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (current +
                      (event.key === "ArrowUp" ? -1 : 1) +
                      items.length) %
                    items.length;
            items[next]?.focus();
          }
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label="Position options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => {
          firstFocus.current = 0;
          setOpen((value) => !value);
        }}
      >
        <Ellipsis size={20} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="aqua-position-options-menu"
          id={id}
          role="menu"
          aria-label="Position options"
        >
          <button
            className="aqua-position-options-item"
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                setOpen(false);
                onAddPosition();
              }
            }}
          >
            <Plus size={17} aria-hidden="true" />
            Add into existing position
          </button>
          <button
            className="aqua-position-options-item"
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                setOpen(false);
                onClosePosition();
              }
            }}
          >
            <X size={17} aria-hidden="true" />
            Close position
          </button>
        </div>
      )}
    </div>
  );
}
