"use client";

import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
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
  readDraft,
  emptyDraft,
  validAddress,
  type OnboardingDraft,
} from "@/lib/onboarding";
import {
  StarApiError,
  starApi,
  type StarChild,
  type StarFamily,
  type StarPortfolio,
} from "@/lib/star-api";
import { displayEnsName } from "@/lib/star-format";
import { withGoalMetadata, type GoalRequest } from "@/lib/goal-requests";
import {
  starReadOptions,
  familyDiscoveryStaleTime,
  walletPageReads,
  matchesWalletReads,
  type WalletRead,
  walletRefreshFilter,
} from "@/lib/wallet-refresh";
import { childFromFamily } from "@/lib/family-child";
import {
  applyGoalContributionSnapshots,
  goalContributionConfirmationsKey,
  type GoalContributionSnapshot,
} from "@/lib/goal-contributions";
import { existingFamilyForWallet } from "@/lib/onboarding-entry";
import { useReadOnEntry } from "./use-read-on-entry";
import { FullScreenLoader } from "./home-ui";
import {
  CHILD_LINK_KEY,
  SELECTED_CHILD_KEY,
  walletContext,
  selectFamilyId,
  needsFamilyOnboarding,
} from "@/lib/wallet-context";

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
  refreshing: boolean;
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const section = searchParams.get("section");
  const pageReads = walletPageReads(pathname, section);
  const pageEntry = `${pathname}:${section ?? ""}`;
  // Keep existing screens and form state mounted while cached reads refresh.
  // Include inbox/activity queries, not just the three main wallet reads.
  const refreshing = useIsFetching(walletRefreshFilter) > 0;
  const [requestedRefreshes, setRequestedRefreshes] = useState(0);
  const refreshRequested = requestedRefreshes > 0;
  const { address, isReconnecting } = useAccount();
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [selectedChildWallet, setSelectedChildWallet] = useState("");
  const [childLink, setChildLink] = useState("");
  const [explicitChildLink, setExplicitChildLink] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const savedDraft = readDraft();
      const requestedChild =
        new URLSearchParams(window.location.search).get("child") ?? "";
      const linkedChild = validAddress(requestedChild)
        ? requestedChild
        : (window.sessionStorage.getItem(CHILD_LINK_KEY) ?? "");
      if (validAddress(linkedChild)) {
        setExplicitChildLink(validAddress(requestedChild));
        setChildLink(linkedChild);
        window.sessionStorage.setItem(CHILD_LINK_KEY, linkedChild);
      }
      setDraft(savedDraft);
      setSelectedChildWallet(
        (validAddress(linkedChild) ? linkedChild : null) ??
          window.sessionStorage.getItem(SELECTED_CHILD_KEY) ??
          savedDraft.childWallet,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const { storedFamilyId, discoveryAddress } = walletContext(
    address,
    draft,
    childLink,
    explicitChildLink,
  );
  const linkedChildDiscovery =
    validAddress(childLink) &&
    discoveryAddress.toLowerCase() === childLink.toLowerCase();
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
    staleTime: (query) => familyDiscoveryStaleTime(query.state.data),
    refetchOnMount: true,
    enabled:
      discoveryReady && validAddress(discoveryAddress) && !linkedChildDiscovery,
  });
  const discoverChild =
    validAddress(discoveryAddress) &&
    (linkedChildDiscovery ||
      (familiesQuery.isSuccess &&
        !familiesQuery.isFetching &&
        !familiesQuery.data.families.length));
  const childDiscoveryQuery = useQuery({
    ...starReadOptions,
    queryKey: ["star", "child", "discovery", discoveryAddress.toLowerCase()],
    queryFn: ({ signal }) => starApi.fullChild(discoveryAddress, { signal }),
    staleTime: 1_000,
    refetchOnMount: true,
    enabled: discoveryReady && discoverChild,
  });
  const familyId =
    !discoveryReady ||
    (!linkedChildDiscovery && familiesQuery.isFetching) ||
    (discoverChild && childDiscoveryQuery.isFetching)
      ? null
      : selectFamilyId(
          storedFamilyId,
          !linkedChildDiscovery && familiesQuery.isSuccess
            ? familiesQuery.data.families
            : undefined,
          discoverChild && childDiscoveryQuery.isSuccess
            ? childDiscoveryQuery.data?.family?.id
            : undefined,
        );
  const familyQuery = useQuery({
    ...starReadOptions,
    queryKey: ["star", "family", familyId],
    queryFn: ({ signal }) => starApi.fullFamily(familyId!, { signal }),
    enabled: familyId !== null,
  });
  useReadOnEntry(["star", "family", familyId], familyId !== null, pageEntry);
  const contributionConfirmations = useQuery<GoalContributionSnapshot[]>({
    ...starReadOptions,
    queryKey: goalContributionConfirmationsKey(familyId),
    enabled: false,
    queryFn: async () => [],
  });
  const family = useMemo(
    () =>
      applyGoalContributionSnapshots(
        familyQuery.data ?? null,
        contributionConfirmations.data ?? [],
      ),
    [familyQuery.data, contributionConfirmations.data],
  );
  const goalRequestsQuery = useQuery({
    ...starReadOptions,
    queryKey: ["star", "family", familyId, "goal-requests"],
    queryFn: ({ signal }) => starApi.allGoalRequests(familyId!, { signal }),
    enabled: familyId !== null && pageReads.goals,
  });
  useReadOnEntry(
    ["star", "family", familyId, "goal-requests"],
    familyId !== null && pageReads.goals,
    pageEntry,
  );
  const selectedChildSummary = useMemo(() => {
    if (!family?.children.length) return null;
    const requested = selectedChildWallet.toLowerCase();
    return (
      family.children.find(
        (item) => item.wallet.toLowerCase() === address?.toLowerCase(),
      ) ??
      family.children.find((item) => item.wallet.toLowerCase() === requested) ??
      family.children.find((item) => item.active) ??
      family.children[0]
    );
  }, [address, family, selectedChildWallet]);
  const portfolioQuery = useQuery({
    ...starReadOptions,
    queryKey: ["star", "portfolio", familyId],
    queryFn: ({ signal }) => starApi.portfolio(familyId!, { signal }),
    enabled: familyId !== null && pageReads.portfolio,
  });
  useReadOnEntry(
    ["star", "portfolio", familyId],
    familyId !== null && pageReads.portfolio,
    pathname,
  );
  const child = useMemo(
    () => childFromFamily(family, selectedChildSummary),
    [family, selectedChildSummary],
  );

  const selectChild = useCallback((wallet: string) => {
    if (!validAddress(wallet)) return;
    window.sessionStorage.setItem(SELECTED_CHILD_KEY, wallet);
    setSelectedChildWallet(wallet);
  }, []);

  const refresh = useCallback(
    async (reads?: readonly WalletRead[]) => {
      // Deliberate retry/refresh only, restricted to this family's mounted reads.
      setRequestedRefreshes((count) => count + 1);
      try {
        await queryClient.invalidateQueries(
          {
            predicate: (query) =>
              matchesWalletReads(
                query.queryKey,
                familyId,
                reads,
                undefined,
                discoveryAddress,
              ),
          },
          { cancelRefetch: false },
        );
      } finally {
        setRequestedRefreshes((count) => count - 1);
      }
    },
    [queryClient, familyId, discoveryAddress],
  );

  const discoveryError =
    familyId === null &&
    discoverChild &&
    !(
      childDiscoveryQuery.error instanceof StarApiError &&
      childDiscoveryQuery.error.code === "CHILD_NOT_FOUND"
    )
      ? childDiscoveryQuery.error
      : null;
  const familyDiscoveryError =
    familyId === null && !linkedChildDiscovery ? familiesQuery.error : null;
  const error = (familyQuery.error ??
    familyDiscoveryError ??
    discoveryError ??
    (pageReads.portfolio ? portfolioQuery.error : null)) as Error | null;
  const discoveryLoading =
    validAddress(discoveryAddress) &&
    familyId === null &&
    ((!linkedChildDiscovery &&
      (familiesQuery.isPending || familiesQuery.isFetching)) ||
      (discoverChild &&
        (childDiscoveryQuery.isPending || childDiscoveryQuery.isFetching)));
  const loading =
    draft === null ||
    isReconnecting ||
    discoveryLoading ||
    (familyId !== null && familyQuery.isPending) ||
    (familyId !== null && pageReads.portfolio && portfolioQuery.isPending);
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
      goalRequestsLoading: pageReads.goals && goalRequestsQuery.isPending,
      goalRequestsError: pageReads.goals ? goalRequestsQuery.error : null,
      portfolio: portfolioQuery.data ?? null,
      familyName: displayEnsName(
        family?.ensName,
        family?.id === draft?.familyId
          ? draft?.familyName || "Your family"
          : "Your family",
      ),
      childName: displayEnsName(
        child?.ensName,
        child?.wallet.toLowerCase() === draft?.childWallet.toLowerCase()
          ? draft?.childName || "Child"
          : "Child",
      ),
      loading,
      needsOnboarding: needsFamilyOnboarding({
        hydrated: draft !== null,
        loading,
        error,
        familyId,
        childCount: family?.childCount,
      }),
      refreshing,
      refreshRequested,
      error,
      selectChild,
      refresh,
    }),
    [
      child,
      draft,
      error,
      family,
      familyId,
      loading,
      refreshing,
      refreshRequested,
      goalRequestsQuery.data,
      goalRequestsQuery.error,
      goalRequestsQuery.isPending,
      pageReads.goals,
      portfolioQuery.data,
      refresh,
      selectChild,
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
  const data = useStarData();
  if (data.loading || data.needsOnboarding) {
    return <FullScreenLoader />;
  }
  if (data.error) {
    return (
      <div className="star-data-state" role="alert">
        <strong>Couldn&apos;t load Star Wallet</strong>
        <span>{data.error.message}</span>
        <button type="button" onClick={() => void data.refresh()}>
          Try again
        </button>
      </div>
    );
  }
  return children;
}
