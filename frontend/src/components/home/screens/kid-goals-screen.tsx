"use client";

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { StarGoal } from "@/lib/star-api";
import { goalIllustration } from "@/lib/star-format";
import { kidGoalsHref, kidGoalState, type KidGoalTab } from "@/lib/kid-goals";
import { KidIllustration, KidScreenHeader } from "../kid-ui";
import { KidGoalListCard } from "../kid-goal-list-card";
import { KidGoalFeedback, KidGoalTabs } from "../kid-goal-feedback";
import { GoalContributionSheet } from "../goal-contribution-sheet";
import { SectionEmptyState } from "../home-ui";
import { IntentStatus } from "../action-status";
import { useStarData } from "../star-data-provider";
import { useStarIntents } from "../use-star-intents";

export function KidGoalsScreen({
  initialView,
  embedded = false,
  initialTab = "ongoing",
  initialGoalId,
}: {
  initialView: "list" | "detail";
  embedded?: boolean;
  initialTab?: KidGoalTab;
  initialGoalId?: string;
}) {
  const router = useRouter();
  const { child } = useStarData();
  const { execute, operation, resetOperation } = useStarIntents();
  const goals = child?.goals ?? [];
  const initialGoal =
    goals.find((goal) => goal.id === initialGoalId) ??
    (initialView === "detail"
      ? (goals.find((goal) => goal.status === "ACTIVE") ?? goals[0])
      : null);
  const initialContribution =
    initialGoal && child && kidGoalState(initialGoal, child)?.tab === "ongoing";
  const [tab, setTab] = useState<KidGoalTab>(initialTab);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(
    initialContribution
      ? null
      : (initialGoalId ??
          (initialView === "detail" ? (initialGoal?.id ?? null) : null)),
  );
  const [contributionGoalId, setContributionGoalId] = useState<string | null>(
    initialContribution ? initialGoal.id : null,
  );
  const contributionGoal = goals.find((goal) => goal.id === contributionGoalId);
  const [requestSent, setRequestSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestLock = useRef(false);
  // Keep confirmed requests in Ready while indexing catches up. A newly indexed
  // pending/approved/rejected/cancelled redemption then becomes authoritative.
  const [confirmedRequests, setConfirmedRequests] = useState<
    Record<string, readonly string[]>
  >({});
  const entries = child
    ? goals.flatMap((goal) => {
        const previousIds = confirmedRequests[goal.id];
        const confirming =
          previousIds !== undefined &&
          !(child.redemptions ?? []).some(
            (item) =>
              item.goal.id === goal.id && !previousIds.includes(item.id),
          );
        const state = kidGoalState(goal, child, confirming);
        return state ? [state] : [];
      })
    : [];
  const selected = entries.find((entry) => entry.goal.id === selectedGoalId);
  const selectedGoal = selected?.goal;

  const syncLocation = (nextTab: KidGoalTab, goalId?: string) => {
    if (window.location.pathname !== "/wallet/kid/journey") return;
    window.history.replaceState(
      window.history.state,
      "",
      kidGoalsHref({ tab: nextTab, goalId }),
    );
  };

  const requestRedemption = async (goal: StarGoal) => {
    if (requestLock.current) return;
    if (
      !child ||
      !entries.find((entry) => entry.goal.id === goal.id)?.canRequest
    )
      return;
    const previousIds = (child.redemptions ?? [])
      .filter((item) => item.goal.id === goal.id)
      .map((item) => item.id);
    requestLock.current = true;
    setBusy(true);
    try {
      await execute("requestRedemption", { goalId: goal.id }, "CHILD");
      setConfirmedRequests((current) => ({
        ...current,
        [goal.id]: previousIds,
      }));
      setRequestSent(true);
      setTab("ready");
      syncLocation("ready", goal.id);
    } catch {
      // The operation state below presents the API or wallet error.
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  };

  const backToList = () => {
    if (requestLock.current) return;
    resetOperation();
    const nextTab = selected?.tab ?? tab;
    if (initialView === "detail" && !embedded) {
      router.push(kidGoalsHref({ tab: nextTab }));
      return;
    }
    setTab(nextTab);
    syncLocation(nextTab);
    setSelectedGoalId(null);
    setRequestSent(false);
  };

  if (!child) {
    return (
      <GoalShell embedded={embedded}>
        <KidGoalTabs tab={tab} />
        <SectionEmptyState />
      </GoalShell>
    );
  }
  if (requestSent && selectedGoal && selected?.waiting) {
    return (
      <GoalShell
        embedded={embedded}
        className="kid-result-screen kid-pinned-action-screen"
      >
        <KidScreenHeader title="Goals" onBack={backToList} />
        <div className="kid-goal-detail-content">
          <div className="kid-detail-hero">
            <KidIllustration name="mail_sparkle" alt="" size={174} />
            <h2>Request sent!</h2>
          </div>
        </div>
        <div className="kid-goal-detail-footer">
          <button
            className="filled-action-button kid-primary-action"
            type="button"
            onClick={backToList}
          >
            Back to goals
          </button>
        </div>
      </GoalShell>
    );
  }

  if (selectedGoal && selected) {
    return (
      <GoalShell
        embedded={embedded}
        className="kid-goal-detail-screen kid-pinned-action-screen"
      >
        <KidScreenHeader title="Goal" onBack={backToList} backDisabled={busy} />
        <div className="kid-goal-detail-content">
          <div className="kid-detail-hero">
            <KidIllustration
              name={goalIllustration(selectedGoal.title, selectedGoal.icon)}
              alt=""
              size={178}
            />
            <h2>{selectedGoal.title}</h2>
            {!selected.completed && selectedGoal.description && (
              <p>{selectedGoal.description}</p>
            )}
            <p>
              {selected.completed
                ? "Goal completed! 🎉"
                : selected.waiting
                  ? "Your request is with your parent"
                  : selected.target > selected.progress
                    ? `${selected.target - selected.progress} Stars to go`
                    : "Ready to claim"}
            </p>
          </div>
          {!selected.completed && (
            <div className="kid-large-goal-progress">
              <strong>
                {selected.progress.toString()} / {selected.target.toString()}{" "}
                <Star size={18} fill="currentColor" />
              </strong>
              <div aria-hidden="true">
                <span style={{ width: `${selected.percentage}%` }} />
              </div>
            </div>
          )}
        </div>
        <div className="kid-goal-detail-footer">
          <IntentStatus operation={operation} busy={busy} />
          <KidGoalFeedback
            state={selected}
            busy={busy}
            onRequest={() => void requestRedemption(selectedGoal)}
            onAdd={() => setContributionGoalId(selectedGoal.id)}
          />
        </div>
        {contributionGoal && (
          <GoalContributionSheet
            key={contributionGoal.id}
            goal={contributionGoal}
            onClose={() => setContributionGoalId(null)}
          />
        )}
      </GoalShell>
    );
  }

  const visibleGoals = entries.filter((entry) => entry.tab === tab);
  return (
    <GoalShell embedded={embedded}>
      <KidGoalTabs
        tab={tab}
        onChange={(nextTab) => {
          if (requestLock.current) return;
          setTab(nextTab);
          syncLocation(nextTab);
        }}
      />
      {visibleGoals.length ? (
        <div className="kid-module-list kid-goals-list">
          {visibleGoals.map(({ goal, waiting, completed, progress }) => (
            <KidGoalListCard
              key={goal.id}
              goal={goal}
              stars={progress}
              pending={waiting}
              completed={completed}
              onOpen={() => {
                resetOperation();
                if (tab === "ongoing") setContributionGoalId(goal.id);
                else setSelectedGoalId(goal.id);
                setRequestSent(false);
                syncLocation(tab, goal.id);
              }}
            />
          ))}
        </div>
      ) : (
        <SectionEmptyState />
      )}
      {contributionGoal && (
        <GoalContributionSheet
          key={contributionGoal.id}
          goal={contributionGoal}
          onClose={() => {
            const nextTab = child
              ? (kidGoalState(contributionGoal, child)?.tab ?? tab)
              : tab;
            setContributionGoalId(null);
            setTab(nextTab);
            syncLocation(nextTab);
          }}
        />
      )}
    </GoalShell>
  );
}

function GoalShell({
  embedded,
  className = "",
  children,
}: {
  embedded: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${embedded ? "kid-journey-module" : "wallet-screen kid-flow-screen"} ${className}`}
    >
      {children}
    </div>
  );
}
