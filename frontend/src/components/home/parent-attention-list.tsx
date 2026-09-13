import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ParentAttentionItem } from "@/lib/parent-attention";
import { displayEnsName, goalIllustration } from "@/lib/star-format";
import { goalIconAsset } from "@/lib/goal-requests";
import { questIllustration } from "@/lib/quest-templates";
import { ActionStatus } from "./action-status";
import { SectionEmptyState } from "./home-ui";
import { KidIllustration } from "./kid-ui";

export function ParentAttentionList({
  items,
  childProfiles,
  loading,
  refreshing = loading,
  error,
  onOpen,
  onRetry,
}: {
  items: readonly ParentAttentionItem[];
  childProfiles: readonly { id: string; ensName: string }[];
  loading: boolean;
  refreshing?: boolean;
  error: Error | null;
  onOpen: (item: ParentAttentionItem) => void;
  onRetry: () => void;
}) {
  return (
    <div className="attention-list" aria-busy={loading}>
      {items.map((item) => {
        const { request } = item;
        const child = childProfiles.find(
          (child) => child.id === request.child?.id,
        );
        const name = displayEnsName(
          child?.ensName ??
            (request.child && "ensName" in request.child
              ? request.child.ensName
              : undefined),
          "Child",
        );
        let title: string;
        let detail: string;
        let illustration: string;
        if (item.kind === "goal") {
          title = "New goal request";
          detail = item.request.title;
          illustration = goalIconAsset(item.request.icon);
        } else if (item.kind === "redemption") {
          title = "Reward request";
          detail = item.request.goal.title;
          illustration = goalIllustration(detail, item.request.goal.icon);
        } else {
          title =
            item.kind === "quest" ? "Quest ready for review" : "Star request";
          detail =
            item.kind === "quest"
              ? `${item.request.quest?.title ?? item.request.reason} · ${item.request.stars} Stars`
              : item.request.reason;
          illustration = questIllustration(item.request.quest?.title ?? "");
        }
        const content = (
          <>
            <KidIllustration name={illustration} alt="" size={48} />
            <span>
              <strong>{title}</strong>
              <small>
                {name} · {detail}
              </small>
            </span>
            <ChevronRight size={17} aria-hidden="true" />
          </>
        );
        return item.kind === "redemption" ? (
          <Link
            className="attention-request"
            href={`/wallet/rewards/${request.id}`}
            key={`${item.kind}:${request.id}`}
          >
            {content}
          </Link>
        ) : (
          <button
            className="attention-request"
            type="button"
            key={`${item.kind}:${request.id}`}
            onClick={() => onOpen(item)}
          >
            {content}
          </button>
        );
      })}
      {error ? (
        <ActionStatus
          state="error"
          message="Couldn’t load all requests. Please try again."
          onRefresh={onRetry}
          refreshing={refreshing}
          refreshLabel="Refresh requests"
        />
      ) : loading ? (
        <ActionStatus state="working" message="Checking requests…" />
      ) : !items.length ? (
        <SectionEmptyState />
      ) : null}
    </div>
  );
}
