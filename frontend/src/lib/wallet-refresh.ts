import type {
  QueryClient,
  QueryFilters,
  QueryKey,
} from "@tanstack/react-query";
import type { IntentAction } from "./star-api.contract";

// Reads happen on entry or explicit invalidation, never on a clock/focus change.
export const starReadOptions = {
  staleTime: Infinity,
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: false,
  retry: false,
} as const;

// Reuse a returning parent's connection lookup. An empty result from before
// onboarding must be checked again when entering Wallet after family creation.
export function familyDiscoveryStaleTime(data?: {
  families: readonly unknown[];
}) {
  // Only coalesce the immediate onboarding -> profile picker handoff. A later
  // Wallet entry must not trust families cached before a backend redeployment.
  return data?.families.length ? 1_000 : 0;
}

export type WalletRead =
  | "family"
  | "goals"
  | "portfolio"
  | "inbox"
  | "attention"
  | "activity"
  | "completed"
  | "discovery";

export function walletPageReads(path: string, section: string | null = null) {
  const dashboard = [
    "/wallet",
    "/wallet/quests/read",
    "/wallet/stars/request",
  ].includes(path);
  return {
    portfolio:
      dashboard || ["/wallet/family", "/wallet/profile"].includes(path),
    goals:
      dashboard ||
      path === "/wallet/kid" ||
      path === "/wallet/kid/add-goal" ||
      (path === "/wallet/kid/journey" && section === "goals") ||
      path.startsWith("/wallet/kid/goals") ||
      path === "/wallet/kid/profile" ||
      path.startsWith("/wallet/rewards/"),
  };
}

const affectedReads = {
  createQuest: ["inbox"],
  cancelQuest: ["inbox"],
  submitQuest: ["inbox", "attention"],
  requestStars: ["inbox", "attention"],
  cancelStarRequest: ["inbox", "attention"],
  rejectStarRequest: ["inbox", "attention"],
  approveStarRequest: [
    "inbox",
    "attention",
    "completed",
    "family",
    "portfolio",
    "activity",
  ],
  rewardStars: ["family", "portfolio", "activity"],
  requestGoal: ["goals"],
  rejectGoalRequest: ["goals"],
  cancelGoalRequest: ["goals"],
  approveGoalRequest: ["goals", "family", "activity"],
  createGoal: ["family", "activity"],
  addStarsToGoal: ["family", "activity"],
  cancelGoal: ["family", "goals", "activity"],
  requestRedemption: ["family", "activity"],
  cancelRedemption: ["family", "activity"],
  approveRedemption: ["family", "activity"],
  rejectRedemption: ["family", "activity"],
  fundWeth: ["family", "portfolio", "activity"],
  withdrawWeth: ["family", "portfolio", "activity"],
  withdrawSavings: ["family", "portfolio", "activity"],
  shipSavings: ["family", "portfolio", "activity"],
  replaceSavings: ["family", "portfolio", "activity"],
  dockSavings: ["family", "portfolio", "activity"],
  addSavings: ["family", "portfolio", "activity"],
  setAquaPaused: ["family", "activity"],
  createFamily: ["discovery"],
  createVault: ["family", "discovery", "portfolio"],
  setFamilyStatus: ["family", "discovery", "activity"],
  registerChild: ["family", "discovery", "activity"],
  createChildAccount: ["family", "discovery"],
  setChildStatus: ["family", "activity"],
  cancelChildRegistration: ["family", "activity"],
  rejectChildRegistration: ["family", "activity"],
} satisfies Record<IntentAction, WalletRead[]>;

export function matchesWalletReads(
  key: QueryKey,
  familyId: string | null,
  reads?: readonly WalletRead[],
  childId?: string,
  discoveryAddress?: string,
): boolean {
  if (key[0] !== "star") return false;
  if (key[1] === "families" || (key[1] === "child" && key[2] === "discovery")) {
    const wallet = key[1] === "families" ? key[2] : key[3];
    return Boolean(
      discoveryAddress &&
      wallet === discoveryAddress.toLowerCase() &&
      (reads?.includes("discovery") ?? familyId === null),
    );
  }
  if (!familyId || key[2] !== familyId) return false;
  if (key[1] === "portfolio") return !reads || reads.includes("portfolio");
  if (key[1] !== "family") return false;
  if (key.length === 3) return !reads || reads.includes("family");
  const scopes: Record<string, WalletRead> = {
    "goal-requests": "goals",
    inbox: "inbox",
    "parent-attention": "attention",
    activity: "activity",
    child: "completed",
  };
  const scope = scopes[String(key[3])];
  if (!scope || (reads && !reads.includes(scope))) return false;
  return (
    !childId ||
    (scope !== "inbox" && scope !== "completed") ||
    key[4] === undefined ||
    key[4] === childId
  );
}

export function refreshAfterWalletAction(
  client: QueryClient,
  action: IntentAction,
  context: { familyId: string | null; childId?: string; parent?: string },
  indexed: boolean,
) {
  return client.invalidateQueries(
    {
      predicate: (query) =>
        matchesWalletReads(
          query.queryKey,
          context.familyId,
          affectedReads[action],
          context.childId,
          context.parent,
        ),
      // An unindexed transaction is confirmed, not failed. Re-read on next entry;
      // don't immediately read the same old snapshot or retry the transaction.
      refetchType: indexed ? "active" : "none",
      // Supersede any pre-transaction read so it cannot overwrite the new state.
    },
    { cancelRefetch: true },
  );
}

export function refreshReadOnEntry(client: QueryClient, queryKey: QueryKey) {
  const state = client.getQueryState(queryKey);
  // Initial reads already start in useQuery. Coalesce simultaneous consumers,
  // StrictMode mounts and navigation immediately after a completed action.
  if (
    !state ||
    state.data === undefined ||
    state.fetchStatus === "fetching" ||
    (!state.isInvalidated && Date.now() - state.dataUpdatedAt < 1_000)
  )
    return;
  return client.invalidateQueries(
    { queryKey, exact: true },
    { cancelRefetch: false },
  );
}

// Initial reads use the full-page loader; cached reads must not replace forms.
export const walletRefreshFilter = {
  queryKey: ["star"],
  predicate: (query) => query.state.data !== undefined,
} satisfies QueryFilters;
