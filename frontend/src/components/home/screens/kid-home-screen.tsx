"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { availableStars } from "@/lib/star-format";
import {
  goalAllocatedStars,
  kidGoalsHref,
  kidGoalState,
} from "@/lib/kid-goals";
import {
  HomeIllustration,
  SectionEmptyState,
  SectionTitle,
  StarValue,
} from "../home-ui";
import { ActionStatus } from "../action-status";
import { GoalRequestSheet } from "../goal-request-sheet";
import { goalIconAsset } from "@/lib/goal-requests";
import { KidIllustration } from "../kid-ui";
import { KidAddGoalCard } from "../kid-add-goal-card";
import { useStarData } from "../star-data-provider";
import { isChildActivity, presentRecentActivities } from "../star-activity";
import { KidActivitySheet } from "../kid-activity-sheet";
import { GoalContributionSheet } from "../goal-contribution-sheet";
import { KidGoalRequestScreen } from "./kid-goal-request-screen";

export function KidHomeScreen() {
  const router = useRouter();
  const {
    child,
    childName,
    family,
    goalRequests,
    goalRequestsLoading,
    goalRequestsError,
    refresh,
  } = useStarData();
  const [activityOpen, setActivityOpen] = useState(false);
  const [addGoalOpen, setAddGoalOpen] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [contributionGoalId, setContributionGoalId] = useState<string | null>(
    null,
  );
  const activeGoal = child?.goals?.find((item) => item.status === "ACTIVE");
  const contributionGoal = child?.goals?.find(
    (item) => item.id === contributionGoalId,
  );
  const allocated = activeGoal ? goalAllocatedStars(activeGoal) : 0n;
  const cost = BigInt(activeGoal?.starCost ?? 0);
  const progress = cost ? Number((allocated * 100n) / cost) : 0;
  const pendingGoalRequests = goalRequests.filter(
    (request) => request.child.id === child?.id && request.status === "PENDING",
  );
  const childActivities =
    family && child
      ? family.activities.filter(
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
        <HomeIllustration
          className="kid-illustration"
          name="girl"
          alt={childName}
          size={58}
        />
        <div>
          <h1>Hi {childName}!</h1>
          <p>What will you achieve today?</p>
        </div>
        <StarValue>{availableStars(child).toString()}</StarValue>
      </header>

      {activeGoal ? (
        <button
          className="kid-hero-card"
          type="button"
          onClick={() => {
            if (child && kidGoalState(activeGoal, child)?.tab === "ongoing")
              setContributionGoalId(activeGoal.id);
            else router.push(kidGoalsHref({ goalId: activeGoal.id }));
          }}
        >
          <div>
            <span>Your next dream</span>
            <h2>{activeGoal.title}</h2>
            <p>
              {allocated.toString()} of {activeGoal.starCost} Stars saved
            </p>
            <div
              className="kid-goal-progress"
              aria-label={`${progress}% complete`}
            >
              <span style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          </div>
          <KidIllustration name="bicycle_sparkle" alt="A dream" size={116} />
        </button>
      ) : (
        !pendingGoalRequests.length && (
          <KidAddGoalCard onOpen={() => setAddGoalOpen(true)} />
        )
      )}
      {goalRequestsLoading ? (
        <ActionStatus state="working" message="Checking goal requests…" />
      ) : goalRequestsError ? (
        <ActionStatus
          state="error"
          message="Couldn’t load your goal requests. Please try again."
          onRefresh={() => void refresh(["goals"])}
          refreshing={goalRequestsLoading}
          refreshLabel="Refresh goal requests"
        />
      ) : null}
      {pendingGoalRequests.map((request) => (
        <button
          className="goal-request-summary"
          type="button"
          key={request.id}
          onClick={() => setRequestId(request.id)}
        >
          <KidIllustration
            name={goalIconAsset(request.icon)}
            alt=""
            size={56}
          />
          <span>
            <strong>{request.title}</strong>
            <small>Waiting for parent</small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      ))}
      {activeGoal && !pendingGoalRequests.length && (
        <KidAddGoalCard onOpen={() => setAddGoalOpen(true)} />
      )}

      <SectionTitle
        action={
          <Link href={kidGoalsHref()}>
            See journey <ChevronRight size={15} />
          </Link>
        }
      >
        My progress
      </SectionTitle>

      {recentActivities.length ? (
        <section className="dashboard-activity-list">
          {recentActivities.map((row) => (
            <article key={row.id}>
              <KidIllustration name={row.kidIllustration} alt="" size={42} />
              <span>{row.title}</span>
              <strong>
                {row.amount ?? ""} {row.currency ?? ""}
              </strong>
            </article>
          ))}
        </section>
      ) : (
        <SectionEmptyState />
      )}

      <button
        className="kid-activity-link"
        type="button"
        onClick={() => setActivityOpen(true)}
      >
        See all activity <ChevronRight size={15} />
      </button>

      <div className="kid-quick-actions">
        <Link href={kidGoalsHref()}>
          <HomeIllustration
            name="star_sparkle"
            alt=""
            size={48}
            collection="kid"
          />
          <strong>My dreams</strong>
        </Link>
        <Link href="/wallet/kid/profile">
          <span className="kid-add-icon">
            <Plus size={22} />
          </span>
          <strong>My profile</strong>
        </Link>
      </div>
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
