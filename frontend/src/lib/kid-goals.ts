import type { StarChild, StarGoal } from "./star-api.types";
import { availableStars, safeBigInt } from "./star-format";

export function goalAllocatedStars(
  goal: Pick<StarGoal, "allocatedStars" | "starCost">,
): bigint {
  const allocated = safeBigInt(goal.allocatedStars);
  const target = safeBigInt(goal.starCost);
  return allocated < 0n ? 0n : allocated > target ? target : allocated;
}

export const kidGoalTabs = [
  { id: "ongoing", label: "Ongoing" },
  { id: "ready", label: "Ready to claim" },
  { id: "completed", label: "Completed" },
] as const;
export type KidGoalTab = (typeof kidGoalTabs)[number]["id"];

export function kidGoalTab(value?: string): KidGoalTab {
  return value === "ready" || value === "completed" ? value : "ongoing";
}

export function kidGoalsHref({
  goalId,
  tab,
}: { goalId?: string; tab?: KidGoalTab } = {}) {
  const query = new URLSearchParams({ section: "goals" });
  if (tab) query.set("tab", tab);
  if (goalId) query.set("goal", goalId);
  return `/wallet/kid/journey?${query}`;
}

/** All three tabs use the same goal/redemption state, never separate copies. */
export function kidGoalState(
  goal: StarGoal,
  child: StarChild,
  confirmationPending = false,
) {
  if (goal.child && goal.child.id !== child.id) return null;
  const redemptions = (child.redemptions ?? []).filter(
    (item) =>
      item.goal.id === goal.id && (!item.child || item.child.id === child.id),
  );
  const approved = redemptions.find((item) => item.status === "APPROVED");
  const completed = goal.status === "COMPLETED" || Boolean(approved);
  if (!completed && goal.status !== "ACTIVE") return null;
  const pending = completed
    ? undefined
    : redemptions.find((item) => item.status === "PENDING");
  const waiting = !completed && (Boolean(pending) || confirmationPending);
  const stars = availableStars(child);
  const target = safeBigInt(goal.starCost);
  const allocated = goalAllocatedStars(goal);
  const enoughStars = target > 0n && allocated >= target;
  const tab: KidGoalTab = completed
    ? "completed"
    : waiting || enoughStars
      ? "ready"
      : "ongoing";
  const progress = completed || waiting ? target : allocated;
  return {
    goal,
    tab,
    completed,
    waiting,
    pending,
    stars,
    allocated,
    target,
    progress,
    reservedStars: pending?.reservedStars ?? goal.starCost,
    percentage: target > 0n ? Number((progress * 100n) / target) : 0,
    canRequest:
      !completed &&
      !waiting &&
      enoughStars &&
      child.active &&
      child.family?.active !== false,
  };
}
export type KidGoalState = NonNullable<ReturnType<typeof kidGoalState>>;
