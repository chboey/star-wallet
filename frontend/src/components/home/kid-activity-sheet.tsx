"use client";

import { Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KidIllustration } from "./kid-ui";
import { FullScreenLoader, SectionEmptyState } from "./home-ui";
import { isChildActivity, presentActivity } from "./star-activity";
import { useStarData } from "./star-data-provider";
import { useFamilyActivity } from "./use-family-activity";

export function KidActivitySheet({ onClose }: { onClose: () => void }) {
  const { family, child } = useStarData();
  const { activities, loading, loadingMore, hasMore, loadMore, error } =
    useFamilyActivity();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const rows =
    family && child
      ? activities
          .filter(
            (activity) =>
              activity.type !== "PRINCIPAL_CONTRIBUTED" &&
              isChildActivity(activity, family, child.id),
          )
          .map((activity) => presentActivity(activity, family, true))
      : [];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPortalRoot(document.querySelector<HTMLElement>(".wallet-app-frame"));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!portalRoot) return;
    closeButtonRef.current?.focus();
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeWithEscape);
    return () => document.removeEventListener("keydown", closeWithEscape);
  }, [onClose, portalRoot]);

  if (!portalRoot) return null;
  return createPortal(
    <>
      {loading && !rows.length && <FullScreenLoader />}
      <button
        className="add-funds-backdrop"
        type="button"
        aria-label="Close recent activity"
        onClick={onClose}
      />
      <section
        className="onchain-details-sheet kid-activity-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kid-activity-title"
      >
        <header className="add-funds-sheet-header">
          <span aria-hidden="true" />
          <h2 id="kid-activity-title">Recent activity</h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close recent activity"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        {loading && !rows.length ? null : error && !rows.length ? (
          <p className="sheet-empty-state">{error.message}</p>
        ) : rows.length ? (
          <ul className="kid-activity-sheet-list">
            {rows.map((row) => (
              <li key={row.id}>
                <KidIllustration name={row.kidIllustration} alt="" size={54} />
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                </span>
                {row.amount && (
                  <span className="kid-activity-sheet-stars">
                    {row.amount}
                    {row.currency === "STAR" ? (
                      <Star size={14} fill="currentColor" />
                    ) : (
                      <small>{row.currency}</small>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <SectionEmptyState />
        )}
        {hasMore && (
          <button
            className="activity-load-more"
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Load older activity"}
          </button>
        )}
      </section>
    </>,
    portalRoot,
  );
}
