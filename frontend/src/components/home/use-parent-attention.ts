"use client";

import { useQuery } from "@tanstack/react-query";
import { starApi } from "@/lib/star-api";
import { parentAttentionItems } from "@/lib/parent-attention";
import { starReadOptions } from "@/lib/wallet-refresh";
import { useReadOnEntry } from "./use-read-on-entry";
import { useStarData } from "./star-data-provider";

export function useParentAttention() {
  const {
    familyId,
    family,
    goalRequests,
    goalRequestsError,
    goalRequestsLoading,
    loading,
    refreshing,
    error,
    refresh,
  } = useStarData();
  const requests = useQuery({
    ...starReadOptions,
    queryKey: ["star", "family", familyId, "parent-attention"],
    queryFn: ({ signal }) => starApi.pendingStarRequests(familyId!, { signal }),
    enabled: Boolean(familyId),
  });
  useReadOnEntry(
    ["star", "family", familyId, "parent-attention"],
    Boolean(familyId),
  );
  return {
    items: parentAttentionItems({
      starRequests: requests.data ?? [],
      goalRequests,
      redemptions: family?.redemptions ?? [],
    }),
    // Cached background reads stay visible; only initial reads are loading.
    loading:
      loading ||
      Boolean(familyId && (requests.isPending || goalRequestsLoading)),
    error: error ?? goalRequestsError ?? requests.error,
    refreshing: refreshing || requests.isFetching,
    refresh: () => refresh(["family", "goals", "attention"]),
  };
}
