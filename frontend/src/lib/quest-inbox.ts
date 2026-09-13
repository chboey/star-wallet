import type { InboxPage, InboxView } from "./quest-types";

export type InboxScope = "all" | "quests" | "stars";

export function selectInboxItems(
  items: Pick<InboxPage, "quests" | "requests">,
  scope: InboxScope,
  view?: InboxView,
  initialRequestId?: string,
) {
  const requests =
    view === "available"
      ? []
      : items.requests.filter((request) =>
          scope === "all"
            ? true
            : scope === "quests"
              ? !!request.quest
              : !request.quest,
        );
  const representedQuests = new Set(
    requests.map((request) => request.quest?.id),
  );
  return {
    quests:
      scope === "stars" || view === "waiting"
        ? []
        : items.quests.filter(
            (quest) =>
              view !== "history" ||
              quest.status === "CANCELLED" ||
              (quest.status === "COMPLETED" &&
                !representedQuests.has(quest.id)),
          ),
    // A dashboard entry opens its exact request first, not an unrelated card.
    requests: initialRequestId
      ? [
          ...requests.filter((request) => request.id === initialRequestId),
          ...requests.filter((request) => request.id !== initialRequestId),
        ]
      : requests,
  };
}
