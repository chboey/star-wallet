"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { starApi } from "@/lib/star-api";
import { selectInboxItems, type InboxScope } from "@/lib/quest-inbox";
import type { InboxView } from "@/lib/quest-types";
import { useStarData } from "./star-data-provider";
import { starReadOptions } from "@/lib/wallet-refresh";
import { useReadOnEntry } from "./use-read-on-entry";

export function useQuestInbox(
  view: InboxView,
  childOnly = false,
  scope: InboxScope = "all",
  enabled = true,
  initialRequestId?: string,
) {
  const { familyId, child } = useStarData();
  const childId = childOnly ? child?.id : undefined;
  const query = useInfiniteQuery({
    ...starReadOptions,
    queryKey: ["star", "family", familyId, "inbox", childId, view],
    queryFn: ({ pageParam, signal }) =>
      starApi.inbox(familyId!, { childId, view, skip: pageParam, signal }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    enabled: enabled && Boolean(familyId && (!childOnly || childId)),
  });
  useReadOnEntry(
    ["star", "family", familyId, "inbox", childId, view],
    enabled && Boolean(familyId && (!childOnly || childId)),
  );
  const items = selectInboxItems(
    {
      quests: query.data?.pages.flatMap((p) => p.quests) ?? [],
      requests: query.data?.pages.flatMap((p) => p.requests) ?? [],
    },
    scope,
    view,
    initialRequestId,
  );
  const empty = !items.quests.length && !items.requests.length;
  const locatingRequest = Boolean(
    initialRequestId &&
    view === "waiting" &&
    !items.requests.some((request) => request.id === initialRequestId),
  );
  const needsMore = empty || locatingRequest;
  const { hasNextPage, isFetching, error, fetchNextPage } = query;
  // A page containing only the other inbox's records is not an empty inbox.
  useEffect(() => {
    if (enabled && needsMore && hasNextPage && !isFetching && !error)
      void fetchNextPage();
  }, [enabled, needsMore, hasNextPage, isFetching, error, fetchNextPage]);

  return {
    ...query,
    ...items,
    isPending:
      enabled && (query.isPending || (needsMore && hasNextPage && !error)),
  };
}
