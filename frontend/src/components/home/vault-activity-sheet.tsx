"use client";

import {
  FullScreenLoader,
  HomeIllustration,
  SectionEmptyState,
} from "./home-ui";
import {
  isVaultActivity,
  presentActivity,
  type ActivityPresentation,
} from "./star-activity";
import { useStarData } from "./star-data-provider";
import { useFamilyActivity } from "./use-family-activity";
import { ParentActionSheet } from "./parent-action-sheet";

export function VaultActivitySheet({ onClose }: { onClose: () => void }) {
  const { family } = useStarData();
  const { activities, loading, loadingMore, hasMore, loadMore, error } =
    useFamilyActivity();
  const rows = family
    ? activities
        .filter(isVaultActivity)
        .map((activity) => presentActivity(activity, family))
    : [];

  return (
    <ParentActionSheet
      title="Vault Activity"
      className="wallet-activity-sheet"
      onClose={onClose}
    >
      <VaultActivityContent
        rows={rows}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        error={error?.message}
        onLoadMore={() => void loadMore()}
      />
    </ParentActionSheet>
  );
}

export function VaultActivityContent({
  rows,
  loading,
  loadingMore,
  hasMore,
  error,
  onLoadMore,
}: {
  rows: ActivityPresentation[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error?: string;
  onLoadMore: () => void;
}) {
  return (
    <>
      {loading && !rows.length && <FullScreenLoader />}
      <div className="vault-activity-content">
        {loading && !rows.length ? null : error && !rows.length ? (
          <p className="sheet-empty-state">{error}</p>
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
            onClick={onLoadMore}
          >
            {loadingMore ? "Loading…" : "Load older activity"}
          </button>
        )}
      </div>
    </>
  );
}
