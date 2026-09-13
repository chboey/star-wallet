import type { GoalRequest } from "./goal-requests";
import type { StarRequest } from "./quest-types";
import type { StarRedemption } from "./star-api.types";

export type ParentAttentionItem =
  | { kind: "stars" | "quest"; request: StarRequest }
  | { kind: "goal"; request: GoalRequest }
  | { kind: "redemption"; request: StarRedemption };

// Current unresolved requests, not historical events. A submitted quest is
// represented by its StarRequest, so it appears once. Registrations await the
// child's acceptance, not a parent's decision, and do not belong in this inbox.
export function parentAttentionItems({
  starRequests,
  goalRequests,
  redemptions,
}: {
  starRequests: readonly StarRequest[];
  goalRequests: readonly GoalRequest[];
  redemptions: readonly StarRedemption[];
}): ParentAttentionItem[] {
  const items: ParentAttentionItem[] = [
    ...starRequests.map((request): ParentAttentionItem => ({
      kind: request.quest ? "quest" : "stars",
      request,
    })),
    ...goalRequests.map((request): ParentAttentionItem => ({
      kind: "goal",
      request,
    })),
    ...redemptions.map((request): ParentAttentionItem => ({
      kind: "redemption",
      request,
    })),
  ];
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = `${item.kind}:${item.request.id}`;
      if (item.request.status !== "PENDING" || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const time = (item: ParentAttentionItem) =>
        BigInt(
          "createdAt" in item.request
            ? item.request.createdAt
            : item.request.requestedAt,
        );
      return time(a) > time(b) ? -1 : time(a) < time(b) ? 1 : 0;
    });
}
