"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { refreshReadOnEntry } from "@/lib/wallet-refresh";

/** Revisit a page, tab or popup once; rerenders and browser focus do not fetch. */
export function useReadOnEntry(
  queryKey: QueryKey,
  enabled: boolean,
  entry = "",
) {
  const client = useQueryClient();
  const key = JSON.stringify(queryKey);
  useEffect(() => {
    if (enabled) void refreshReadOnEntry(client, JSON.parse(key));
  }, [client, key, enabled, entry]);
}
