"use client";

import { useQuery } from "@tanstack/react-query";
import { sepolia } from "viem/chains";
import { usePublicClient } from "wagmi";
import {
  aquaPositionKey,
  aquaTopUpKey,
  readAquaPosition,
  readAquaTopUpPosition,
} from "@/lib/aqua-position";
import { starReadOptions } from "@/lib/wallet-refresh";
import { useStarData } from "./star-data-provider";
import { useReadOnEntry } from "./use-read-on-entry";

export function useAquaPosition({
  forTopUp = false,
}: { forTopUp?: boolean } = {}) {
  const { family } = useStarData();
  const client = usePublicClient({ chainId: sepolia.id });
  const vault = family?.vault?.id;
  const queryKey = forTopUp ? aquaTopUpKey(vault) : aquaPositionKey(vault);
  const enabled = Boolean(vault && client);
  const query = useQuery({
    queryKey,
    queryFn: () => {
      if (!client || !vault)
        throw new Error("The family vault is unavailable.");
      return forTopUp
        ? readAquaTopUpPosition(client, vault)
        : readAquaPosition(client, vault);
    },
    enabled,
    ...starReadOptions,
  });
  // Page/popup entry and a changed vault transaction are events, not polling.
  useReadOnEntry(queryKey, enabled, family?.vault?.updatedTransactionHash);
  return query;
}
