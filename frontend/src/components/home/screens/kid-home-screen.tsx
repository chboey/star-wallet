"use client";

import { ChevronRight, Plus, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  availableStars,
  goalIllustration,
  safeBigInt,
} from "@/lib/star-format";
import { KidActivitySheet } from "../kid-activity-sheet";
import { KidIllustration } from "../kid-ui";
import { SectionEmptyState, SectionTitle, StarValue } from "../home-ui";
import {
  isChildActivity,
  isVisibleActivity,
  presentRecentActivities,
} from "../star-activity";
import { useStarData } from "../star-data-provider";
import { KidAddGoalCard } from "../kid-add-goal-card";
import { GoalRequestSheet } from "../goal-request-sheet";
import { goalIconAsset } from "@/lib/goal-requests";
import {
  kidGoalsHref,
  kidGoalState,
  goalAllocatedStars,
} from "@/lib/kid-goals";
import { GoalContributionSheet } from "../goal-contribution-sheet";
import { ActionStatus } from "../action-status";
import { KidGoalRequestScreen } from "./kid-goal-request-screen";

export function KidHomeScreen() {
  const router = useRouter();
  const {
    family,
    child,
    childName,
    goalRequests,
    goalRequestsLoading,
    goalRequestsError,
    refresh,
  } = useStarData();
  const activities = (family?.activities ?? []).filter(isVisibleActivity);
  const [activityOpen, setActivityOpen] = useState(false);
  const [addGoalOpen, setAddGoalOpen] = useState(false);
  const [contributionGoalId, setContributionGoalId] = useState<string | null>(
    null,
  );
  const contributionGoal = child?.goals?.find(
    (goal) => goal.id === contributionGoalId,
  );
  const [requestId, setRequestId] = useState<string | null>(null);
  const pendingGoals = goalRequests.filter(
    (request) => request.child.id === child?.id && request.status === "PENDING",
  );
  const latestGoalRequest = goalRequests.find(
    (request) => request.child.id === child?.id,
  );
  const stars = child ? availableStars(child) : 0n;
  const activeGoal =
    child?.goals?.find((goal) => goal.status === "ACTIVE") ??
    family?.goals.find(
      (goal) => goal.child?.id === child?.id && goal.status === "ACTIVE",
    );
  const goalTarget = safeBigInt(activeGoal?.starCost);
  const goalProgress = activeGoal ? goalAllocatedStars(activeGoal) : 0n;
  const goalPercentage =
    goalTarget > 0n ? Number((goalProgress * 100n) / goalTarget) : 0;
  const childActivities =
    family && child
      ? activities.filter(
          (activity) =>
            activity.type !== "PRINCIPAL_CONTRIBUTED" &&
            isChildActivity(activity, family, child.id),
        )
      : [];
  const recentActivities = family
    ? presentRecentActivities(childActivities, family, true)
    : [];

  return (
    <div className="wallet-screen kid-dashboard">
      <header className="kid-dashboard-header">
        <KidIllustration name="kid" alt="" size={58} />
        <div>
          <h1>{child ? `Hi, ${childName}! 👋` : "Hi! 👋"}</h1>
          <p>Let&apos;s keep growing!</p>
        </div>
        <div className="kid-header-actions">
          {child && (
            <span
              className="kid-header-star-count"
              role="img"
              aria-label={`${stars} available Stars`}
            >
              <strong>{stars.toString()}</strong>
              <Star size={15} fill="currentColor" aria-hidden="true" />
            </span>
          )}
        </div>
      </header>

      <section id="goal" className="kid-anchor-section">
        <SectionTitle
          action={
            child && (activeGoal || pendingGoals.length > 0) ? (
              <button
                className="goal-add-link"
                type="button"
                aria-label="Request a new goal"
                aria-haspopup="dialog"
                onClick={() => setAddGoalOpen(true)}
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            ) : undefined
          }
        >
          My goal
        </SectionTitle>
        {goalRequestsLoading ? (
          <ActionStatus
            state="working"
            message="Checking your goal requests…"
          />
        ) : goalRequestsError ? (
          <ActionStatus
            state="error"
            message="Couldn’t load your goal requests. Please try again."
            onRefresh={() => void refresh(["goals"])}
            refreshing={goalRequestsLoading}
            refreshLabel="Refresh goal requests"
          />
        ) : null}
        {activeGoal ? (
          <button
            className="kid-goal-card"
            type="button"
            onClick={() => {
              if (child && kidGoalState(activeGoal, child)?.tab === "ongoing")
                setContributionGoalId(activeGoal.id);
              else router.push(kidGoalsHref({ goalId: activeGoal.id }));
            }}
          >
            <KidIllustration
              name={goalIllustration(activeGoal.title, activeGoal.icon)}
              alt=""
              size={82}
            />
            <div className="kid-goal-copy">
              <strong>{activeGoal.title}</strong>
              <span>
                {goalProgress.toString()} / {goalTarget.toString()}{" "}
                <Star size={14} fill="currentColor" aria-hidden="true" />
              </span>
              <div className="kid-goal-progress" aria-hidden="true">
                <span style={{ width: `${goalPercentage}%` }} />
              </div>
              <small>
                {goalTarget > goalProgress
                  ? `${goalTarget - goalProgress} Stars to go`
                  : "Ready to claim!"}
              </small>
            </div>
            <ChevronRight size={17} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
        {pendingGoals.map((request) => (
          <button
            className="goal-request-summary"
            type="button"
            key={request.id}
            onClick={() => setRequestId(request.id)}
          >
            <KidIllustration
              name={goalIconAsset(request.icon)}
              alt=""
              size={64}
            />
            <span>
              <strong>{request.title}</strong>
              <small>Waiting for Parent</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ))}
        {!activeGoal &&
          !pendingGoals.length &&
          latestGoalRequest &&
          (latestGoalRequest.status === "REJECTED" ||
            latestGoalRequest.status === "CANCELLED") && (
            <button
              className="goal-request-summary"
              type="button"
              onClick={() => setRequestId(latestGoalRequest.id)}
            >
              <KidIllustration
                name={goalIconAsset(latestGoalRequest.icon)}
                alt=""
                size={56}
              />
              <span>
                <strong>{latestGoalRequest.title}</strong>
                <small>
                  {latestGoalRequest.status === "REJECTED"
                    ? "Your parent declined this goal"
                    : "Request cancelled"}
                </small>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          )}
        {!activeGoal &&
          !pendingGoals.length &&
          !goalRequestsLoading &&
          !goalRequestsError &&
          (child ? (
            <KidAddGoalCard onOpen={() => setAddGoalOpen(true)} />
          ) : (
            <SectionEmptyState />
          ))}
      </section>

      <section id="quest" className="kid-anchor-section">
        <SectionTitle>My Stars</SectionTitle>
        {child ? (
          <Link className="kid-quest-card" href="/wallet/kid/add-stars">
            <KidIllustration name="jar_of_stars" alt="" size={70} />
            <span>
              <strong>{stars.toString()} Stars available</strong>
              <small>Ask your parent to add Stars</small>
            </span>
            <ChevronRight size={17} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        ) : (
          <SectionEmptyState />
        )}
      </section>

      <section id="activity" className="kid-anchor-section">
        <SectionTitle
          action={
            <button
              className="section-see-all"
              type="button"
              onClick={() => setActivityOpen(true)}
            >
              See all <ChevronRight size={14} aria-hidden="true" />
            </button>
          }
        >
          Recent activity
        </SectionTitle>
        {recentActivities.length ? (
          recentActivities.map((row) => (
            <div className="activity-row kid-activity-row" key={row.id}>
              <KidIllustration name={row.kidIllustration} alt="" size={48} />
              <span>
                <strong>{row.title}</strong>
                <small>{row.detail}</small>
              </span>
              {row.amount && row.currency === "STAR" && (
                <StarValue compact>{row.amount}</StarValue>
              )}
            </div>
          ))
        ) : (
          <SectionEmptyState />
        )}
      </section>

      {activityOpen && (
        <KidActivitySheet onClose={() => setActivityOpen(false)} />
      )}
      {contributionGoal && (
        <GoalContributionSheet
          key={contributionGoal.id}
          goal={contributionGoal}
          onClose={() => setContributionGoalId(null)}
        />
      )}
      {addGoalOpen && (
        <KidGoalRequestScreen onClose={() => setAddGoalOpen(false)} />
      )}
      {requestId && (
        <GoalRequestSheet
          requestId={requestId}
          childOnly
          onClose={() => setRequestId(null)}
        />
      )}
    </div>
  );
}
