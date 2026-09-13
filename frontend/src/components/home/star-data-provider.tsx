"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAccount } from "wagmi";
import {
  emptyDraft,
  readDraft,
  validAddress,
  type OnboardingDraft,
} from "@/lib/onboarding";
import {
  starApi,
  type StarChild,
  type StarFamily,
  type StarPortfolio,
} from "@/lib/star-api";
import { childFromFamily } from "@/lib/family-child";
import {
  applyGoalContributionSnapshots,
  goalContributionConfirmationsKey,
  type GoalContributionSnapshot,
} from "@/lib/goal-contributions";
import { withGoalMetadata, type GoalRequest } from "@/lib/goal-requests";
import { displayEnsName } from "@/lib/star-format";
import {
  matchesWalletReads,
  starReadOptions,
  type WalletRead,
} from "@/lib/wallet-refresh";
import { existingFamilyForWallet } from "@/lib/onboarding-entry";
import {
  SELECTED_CHILD_KEY,
  needsFamilyOnboarding,
  selectFamilyId,
  walletContext,
} from "@/lib/wallet-context";
import { FullScreenLoader } from "./home-ui";
import { useReadOnEntry } from "./use-read-on-entry";

type StarDataContextValue = {
  hydrated: boolean;
  familyId: string | null;
  family: StarFamily | null;
  child: StarChild | null;
  portfolio: StarPortfolio | null;
  familyName: string;
  childName: string;
  loading: boolean;
  needsOnboarding: boolean;
  refreshRequested: boolean;
  error: Error | null;
  goalRequests: GoalRequest[];
  goalRequestsSupported: boolean | undefined;
  goalRequestsAddress: `0x${string}` | null;
  goalRequestsLoading: boolean;
  goalRequestsError: Error | null;
  selectChild: (wallet: string) => void;
  refresh: (reads?: readonly WalletRead[]) => Promise<void>;
};

const StarDataContext = createContext<StarDataContextValue | null>(null);

export function StarDataProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { address, isReconnecting } = useAccount();
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [selectedChildWallet, setSelectedChildWallet] = useState("");
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = readDraft();
      setDraft(saved);
      setSelectedChildWallet(
        window.sessionStorage.getItem(SELECTED_CHILD_KEY) ?? saved.childWallet,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const { discoveryAddress, storedFamilyId } = walletContext(
    address,
    draft,
    "",
  );
  const discoveryReady = draft !== null && !isReconnecting;
  const familiesQuery = useQuery({
    ...starReadOptions,
    queryKey: ["star", "families", discoveryAddress.toLowerCase()],
    queryFn: ({ signal }) =>
      starApi.allFamiliesByParent(discoveryAddress, { signal }),
    select: (response) => {
      existingFamilyForWallet(response, discoveryAddress, draft ?? emptyDraft);
      return response;
    },
    enabled: discoveryReady && validAddress(discoveryAddress),
  });
  useReadOnEntry(
    ["star", "families", discoveryAddress.toLowerCase()],
    discoveryReady && validAddress(discoveryAddress),
    discoveryAddress,
  );

  const familyId = selectFamilyId(storedFamilyId, familiesQuery.data?.families);
  const familyQuery = useQuery({
    ...starReadOptions,
    queryKey: ["star", "family", familyId],
    queryFn: ({ signal }) => starApi.fullFamily(familyId!, { signal }),
    enabled: familyId !== null,
  });
  useReadOnEntry(
    ["star", "family", familyId],
    familyId !== null,
    familyId ?? "",
  );

  const contributionConfirmations = useQuery<GoalContributionSnapshot[]>({
    ...starReadOptions,
    queryKey: goalContributionConfirmationsKey(familyId),
    enabled: false,
    queryFn: async () => [],
  });

  const goalRequestsQuery = useQuery({
    ...starReadOptions,
    queryKey: ["star", "family", familyId, "goal-requests"],
    queryFn: ({ signal }) => starApi.allGoalRequests(familyId!, { signal }),
    enabled: familyId !== null,
  });
  useReadOnEntry(
    ["star", "family", familyId, "goal-requests"],
    familyId !== null,
    familyId ?? "",
  );

  const portfolioQuery = useQuery({
    ...starReadOptions,
    queryKey: ["star", "portfolio", familyId],
    queryFn: ({ signal }) => starApi.portfolio(familyId!, { signal }),
    enabled: familyId !== null,
  });
  useReadOnEntry(
    ["star", "portfolio", familyId],
    familyId !== null,
    familyId ?? "",
  );

  const family = useMemo(
    () =>
      applyGoalContributionSnapshots(
        familyQuery.data ?? null,
        contributionConfirmations.data ?? [],
      ),
    [familyQuery.data, contributionConfirmations.data],
  );
  const selectedChild = useMemo(() => {
    if (!family?.children.length) return null;
    const selected = selectedChildWallet.toLowerCase();
    return (
      family.children.find((item) => item.wallet.toLowerCase() === selected) ??
      family.children.find((item) => item.active) ??
      family.children[0]
    );
  }, [family, selectedChildWallet]);
  const child = useMemo(
    () => childFromFamily(family, selectedChild),
    [family, selectedChild],
  );

  const selectChild = useCallback((wallet: string) => {
    if (!validAddress(wallet)) return;
    window.sessionStorage.setItem(SELECTED_CHILD_KEY, wallet);
    setSelectedChildWallet(wallet);
  }, []);

  const refresh = useCallback(
    async (reads?: readonly WalletRead[]) => {
      setRefreshes((count) => count + 1);
      try {
        await queryClient.invalidateQueries(
          {
            predicate: (query) =>
              matchesWalletReads(
                query.queryKey,
                familyId,
                reads,
                child?.id,
                discoveryAddress,
              ),
          },
          { cancelRefetch: false },
        );
      } finally {
        setRefreshes((count) => count - 1);
      }
    },
    [queryClient, familyId, child?.id, discoveryAddress],
  );

  const error = (familyQuery.error ??
    familiesQuery.error ??
    portfolioQuery.error) as Error | null;
  const loading =
    draft === null ||
    isReconnecting ||
    (validAddress(discoveryAddress) && familiesQuery.isPending) ||
    (familyId !== null && (familyQuery.isPending || portfolioQuery.isPending));
  const value = useMemo<StarDataContextValue>(
    () => ({
      hydrated: draft !== null,
      familyId,
      family: family
        ? {
            ...family,
            goals: family.goals.map((goal) =>
              withGoalMetadata(goal, goalRequestsQuery.data?.requests ?? []),
            ),
            redemptions: family.redemptions.map((redemption) => ({
              ...redemption,
              goal: withGoalMetadata(
                redemption.goal,
                goalRequestsQuery.data?.requests ?? [],
              ),
            })),
          }
        : null,
      child: child
        ? {
            ...child,
            goals: child.goals?.map((goal) =>
              withGoalMetadata(goal, goalRequestsQuery.data?.requests ?? []),
            ),
            redemptions: child.redemptions?.map((redemption) => ({
              ...redemption,
              goal: withGoalMetadata(
                redemption.goal,
                goalRequestsQuery.data?.requests ?? [],
              ),
            })),
          }
        : null,
      goalRequests: goalRequestsQuery.data?.requests ?? [],
      goalRequestsSupported: goalRequestsQuery.data?.supported,
      goalRequestsAddress: goalRequestsQuery.data?.goalsAddress ?? null,
      goalRequestsLoading: goalRequestsQuery.isPending,
      goalRequestsError: goalRequestsQuery.error,
      portfolio: portfolioQuery.data ?? null,
      familyName: displayEnsName(family?.ensName, "Your family"),
      childName: displayEnsName(child?.ensName, "Child"),
      loading,
      needsOnboarding: needsFamilyOnboarding({
        hydrated: draft !== null,
        loading,
        error,
        familyId,
        childCount: family?.childCount,
      }),
      refreshRequested: refreshes > 0,
      error,
      selectChild,
      refresh,
    }),
    [
      draft,
      familyId,
      family,
      child,
      goalRequestsQuery.data,
      goalRequestsQuery.isPending,
      goalRequestsQuery.error,
      portfolioQuery.data,
      loading,
      error,
      refreshes,
      selectChild,
      refresh,
    ],
  );

  return (
    <StarDataContext.Provider value={value}>
      {children}
    </StarDataContext.Provider>
  );
}

export function useStarData(): StarDataContextValue {
  const value = useContext(StarDataContext);
  if (!value)
    throw new Error("useStarData must be used inside StarDataProvider");
  return value;
}

export function StarDataBoundary({ children }: { children: ReactNode }) {
  const { loading, error, needsOnboarding, refresh } = useStarData();
  if (loading || needsOnboarding) return <FullScreenLoader />;
  if (error)
    return (
      <div className="star-data-state" role="alert">
        <strong>Couldn&apos;t load your family.</strong>
        <span>{error.message}</span>
        <button type="button" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  return children;
}
