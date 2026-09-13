"use client";

import { ChevronLeft, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ParentActionSheet({
  title,
  onClose,
  onBack,
  className = "",
  backdropClassName = "",
  hideTitle = false,
  children,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  className?: string;
  backdropClassName?: string;
  hideTitle?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPortalRoot(document.querySelector<HTMLElement>(".wallet-app-frame"));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!portalRoot) return;
    closeButtonRef.current?.focus();
  }, [portalRoot]);

  useEffect(() => {
    if (!portalRoot) return;
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeWithEscape);
    return () => document.removeEventListener("keydown", closeWithEscape);
  }, [onClose, portalRoot]);

  if (!portalRoot) return null;

  return createPortal(
    <>
      <button
        className={`add-funds-backdrop ${backdropClassName}`}
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
      />
      <section
        className={`add-funds-sheet parent-action-sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="add-funds-sheet-header">
          {onBack ? (
            <button type="button" aria-label="Go back" onClick={onBack}>
              <ChevronLeft size={19} />
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <h2 id={titleId}>
            <span className={hideTitle ? "sr-only" : undefined}>{title}</span>
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </>,
    portalRoot,
  );
}
