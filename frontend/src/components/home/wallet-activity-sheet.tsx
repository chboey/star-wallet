"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FullScreenLoader,
  HomeIllustration,
  SectionEmptyState,
} from "./home-ui";
import { isVaultActivity, presentActivity } from "./star-activity";
import { useStarData } from "./star-data-provider";
import { useFamilyActivity } from "./use-family-activity";

export function WalletActivitySheet({ onClose }: { onClose: () => void }) {
  const { family } = useStarData();
  const { activities, loading, loadingMore, hasMore, loadMore, error } =
    useFamilyActivity();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const rows = family
    ? activities
        .filter(isVaultActivity)
        .map((activity) => presentActivity(activity, family))
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
        aria-label="Close wallet activity"
        onClick={onClose}
      />
      <section
        className="onchain-details-sheet wallet-activity-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-sheet-title"
      >
        <header className="add-funds-sheet-header">
          <span aria-hidden="true" />
          <h2 id="wallet-sheet-title">Wallet activity</h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close wallet activity"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        {loading && !rows.length ? null : error && !rows.length ? (
          <p className="sheet-empty-state">{error.message}</p>
        ) : rows.length ? (
          <div className="wallet-activity-list">
            {rows.map((row) => (
              <article className="wallet-activity-row" key={row.id}>
                <HomeIllustration
                  name={row.homeIllustration}
                  alt=""
                  size={44}
                />
                <span className="wallet-activity-copy">
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                </span>
                {row.amount && (
                  <span
                    className={`wallet-activity-amount ${row.incoming ? "is-incoming" : ""}`}
                  >
                    <strong>{row.amount}</strong>
                    <small>{row.currency}</small>
                  </span>
                )}
              </article>
            ))}
          </div>
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
