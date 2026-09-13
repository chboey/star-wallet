"use client";

import { Check, Clock, Star } from "lucide-react";
import { useState } from "react";
import { goalIllustration } from "@/lib/star-format";
import { kidGoalsHref, kidGoalState, type KidGoalTab } from "@/lib/kid-goals";
import { KidGoalTabs } from "../kid-goal-feedback";
import { KidGoalListCard } from "../kid-goal-list-card";
import { KidIllustration, KidScreenHeader } from "../kid-ui";
import { GoalContributionSheet } from "../goal-contribution-sheet";
import { SectionEmptyState } from "../home-ui";
import { useStarData } from "../star-data-provider";

export function KidGoalsScreen({
  embedded = false,
  initialTab = "ongoing",
  initialGoalId,
}: {
  embedded?: boolean;
  initialTab?: KidGoalTab;
  initialGoalId?: string;
}) {
  const { child } = useStarData();
  const goals = child?.goals ?? [];
  const initialGoal = goals.find((goal) => goal.id === initialGoalId);
  const initialContribution = Boolean(
    initialGoal && child && kidGoalState(initialGoal, child)?.tab === "ongoing",
  );
  const [tab, setTab] = useState<KidGoalTab>(initialTab);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(
    initialContribution ? null : (initialGoalId ?? null),
  );
  const [contributionGoalId, setContributionGoalId] = useState<string | null>(
    initialContribution ? (initialGoal?.id ?? null) : null,
  );
  const contributionGoal = goals.find((goal) => goal.id === contributionGoalId);
  const entries = child
    ? goals.flatMap((goal) => {
        const state = kidGoalState(goal, child);
        return state ? [state] : [];
      })
    : [];
  const selected = entries.find((entry) => entry.goal.id === selectedGoalId);

  const syncLocation = (nextTab: KidGoalTab, goalId?: string) => {
    if (window.location.pathname !== "/wallet/kid/journey") return;
    window.history.replaceState(
      window.history.state,
      "",
      kidGoalsHref({ tab: nextTab, goalId }),
    );
  };

  if (selected) {
    return (
      <GoalShell
        embedded={embedded}
        className="kid-goal-detail-screen kid-pinned-action-screen"
      >
        <KidScreenHeader
          title="Goal"
          onBack={() => {
            setTab(selected.tab);
            setSelectedGoalId(null);
            syncLocation(selected.tab);
          }}
        />
        <div className="kid-goal-detail-content">
          <div className="kid-detail-hero">
            <KidIllustration
              name={goalIllustration(selected.goal.title, selected.goal.icon)}
              alt=""
              size={178}
            />
            <h2>{selected.goal.title}</h2>
            {selected.goal.description && <p>{selected.goal.description}</p>}
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
          <div className="kid-goal-state-message" role="status">
            {selected.completed ? (
              <Check size={18} aria-hidden="true" />
            ) : selected.waiting ? (
              <Clock size={18} aria-hidden="true" />
            ) : (
              <Star size={18} fill="currentColor" aria-hidden="true" />
            )}
            <span>
              {selected.completed
                ? "Completed"
                : selected.waiting
                  ? "Waiting for parent"
                  : selected.tab === "ready"
                    ? "Ready to claim"
                    : `${selected.progress} Stars allocated`}
            </span>
          </div>
          {selected.tab === "ongoing" && (
            <button
              className="filled-action-button kid-primary-action"
              type="button"
              onClick={() => setContributionGoalId(selected.goal.id)}
            >
              Add Stars
            </button>
          )}
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
                if (tab === "ongoing") setContributionGoalId(goal.id);
                else setSelectedGoalId(goal.id);
                syncLocation(tab, goal.id);
              }}
            />
          ))}
        </div>
      ) : (
        <SectionEmptyState className="kid-goals-empty" />
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
