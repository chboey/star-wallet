"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { starApi } from "@/lib/star-api";
import { useStarData } from "./star-data-provider";
import { isVisibleActivity } from "./star-activity";
import { starReadOptions } from "@/lib/wallet-refresh";
import { useReadOnEntry } from "./use-read-on-entry";

export function useFamilyActivity() {
  const { family, familyId } = useStarData();
  const query = useInfiniteQuery({
    ...starReadOptions,
    queryKey: ["star", "family", familyId, "activity"],
    queryFn: ({ pageParam, signal }) =>
      starApi.activity(familyId!, { before: pageParam || undefined, signal }),
    initialPageParam: "" as string,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: familyId !== null,
  });
  useReadOnEntry(["star", "family", familyId, "activity"], familyId !== null);

  const activities = (
    query.data?.pages.flatMap((page) => page.items) ??
    family?.activities ??
    []
  ).filter(isVisibleActivity);
  const empty = !activities.length;
  const { hasNextPage, isFetching, error, fetchNextPage } = query;
  useEffect(() => {
    if (empty && hasNextPage && !isFetching && !error) void fetchNextPage();
  }, [empty, hasNextPage, isFetching, error, fetchNextPage]);

  return {
    activities,
    indexing: query.data?.pages[0]?.indexing ?? family?.indexing ?? null,
    loading:
      familyId !== null &&
      (query.isPending || (empty && hasNextPage && !error)),
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    error: query.error as Error | null,
    refresh: query.refetch,
    loadMore: query.fetchNextPage,
  };
}
