import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  GoalCancelled,
  GoalCompleted,
  GoalCreated,
  GoalStarsAdded,
  GoalRequested,
  GoalRequestApproved,
  GoalRequestRejected,
  GoalRequestCancelled,
  RedemptionApproved,
  RedemptionCancelled,
  RedemptionRejected,
  RedemptionRequested,
} from "../generated/StarGoals/StarGoals";
import { Goal, GoalRequest, Redemption } from "../generated/schema";
import { activity, requireChild } from "./helpers";

export function handleGoalRequested(event: GoalRequested): void {
  const id = event.params.requestId.toString();
  const child = requireChild(event.params.childId.toString());
  assert(GoalRequest.load(id) === null, "Goal request must be new");
  const request = new GoalRequest(id);
  request.requestId = event.params.requestId;
  request.family = child.family;
  request.child = child.id;
  request.title = event.params.title;
  request.reason = event.params.reason;
  request.icon = event.params.icon;
  request.submissionId = event.params.submissionId;
  request.status = "PENDING";
  request.requestedAt = event.block.timestamp;
  request.requestTransactionHash = event.transaction.hash;
  request.save();
}

function resolveGoalRequest(
  event: ethereum.Event,
  id: string,
  status: string,
): GoalRequest {
  const request = GoalRequest.load(id);
  assert(
    request !== null && request!.status == "PENDING",
    "Goal request must be pending",
  );
  request!.status = status;
  request!.resolvedAt = event.block.timestamp;
  request!.resolutionTransactionHash = event.transaction.hash;
  return request!;
}

export function handleGoalRequestApproved(event: GoalRequestApproved): void {
  const request = resolveGoalRequest(
    event,
    event.params.requestId.toString(),
    "APPROVED",
  );
  const goal = Goal.load(event.params.goalId.toString());
  assert(
    goal !== null &&
      goal!.child == request.child &&
      goal!.title == request.title,
    "Approved goal must match the child's request",
  );
  request.goal = goal!.id;
  request.save();
}

export function handleGoalRequestRejected(event: GoalRequestRejected): void {
  resolveGoalRequest(
    event,
    event.params.requestId.toString(),
    "REJECTED",
  ).save();
}

export function handleGoalRequestCancelled(event: GoalRequestCancelled): void {
  resolveGoalRequest(
    event,
    event.params.requestId.toString(),
    "CANCELLED",
  ).save();
}

export function handleGoalCreated(event: GoalCreated): void {
  const goalId = event.params.goalId.toString();
  const childId = event.params.childId.toString();
  const child = requireChild(childId);
  const goal = new Goal(goalId);
  goal.family = child.family;
  goal.child = childId;
  goal.title = event.params.title;
  goal.starCost = event.params.starCost;
  goal.allocatedStars = BigInt.zero();
  goal.status = "ACTIVE";
  goal.createdAt = event.block.timestamp;
  goal.updatedAt = event.block.timestamp;
  goal.save();

  const item = activity(event, "GOAL_CREATED", child.family);
  item.child = childId;
  item.goal = goalId;
  item.amount = event.params.starCost;
  item.save();
}

export function handleGoalStarsAdded(event: GoalStarsAdded): void {
  const goal = Goal.load(event.params.goalId.toString());
  const child = requireChild(event.params.childId.toString());
  assert(
    goal !== null && goal!.child == child.id && goal!.status == "ACTIVE",
    "Contribution must belong to an active goal",
  );
  assert(
    event.params.amount.gt(BigInt.zero()),
    "Contribution must be positive",
  );
  assert(
    goal!.allocatedStars
      .plus(event.params.amount)
      .equals(event.params.totalAllocated),
    "Contribution total must match",
  );
  assert(
    event.params.totalAllocated.le(goal!.starCost),
    "Contribution cannot exceed goal target",
  );
  child.reservedStars = child.reservedStars.plus(event.params.amount);
  assert(
    child.reservedStars.le(child.starBalance),
    "Contribution cannot overspend Stars",
  );
  child.updatedAt = event.block.timestamp;
  child.save();
  goal!.allocatedStars = event.params.totalAllocated;
  goal!.updatedAt = event.block.timestamp;
  goal!.save();
  const item = activity(event, "GOAL_STARS_ADDED", child.family);
  item.child = child.id;
  item.goal = goal!.id;
  item.amount = event.params.amount;
  item.save();
}

export function handleGoalCancelled(event: GoalCancelled): void {
  const goalId = event.params.goalId.toString();
  const goal = Goal.load(goalId);
  assert(goal !== null, "Cancelled goal must exist");
  assert(
    goal!.child == event.params.childId.toString(),
    "Cancelled goal child must match",
  );
  assert(goal!.status == "ACTIVE", "Only an active goal can be cancelled");
  const child = requireChild(goal!.child);
  assert(
    child.reservedStars.ge(goal!.allocatedStars),
    "Goal reservation must exist",
  );
  child.reservedStars = child.reservedStars.minus(goal!.allocatedStars);
  child.updatedAt = event.block.timestamp;
  child.save();
  goal!.allocatedStars = BigInt.zero();
  goal!.status = "CANCELLED";
  goal!.cancelledAt = event.block.timestamp;
  goal!.updatedAt = event.block.timestamp;
  goal!.save();

  const item = activity(event, "GOAL_CANCELLED", goal!.family);
  item.child = goal!.child;
  item.goal = goalId;
  item.save();
}

export function handleGoalCompleted(event: GoalCompleted): void {
  const goalId = event.params.goalId.toString();
  const goal = Goal.load(goalId);
  assert(goal !== null, "Completed goal must exist");
  assert(
    goal!.child == event.params.childId.toString(),
    "Completed goal child must match",
  );
  assert(goal!.status == "ACTIVE", "Only an active goal can be completed");
  goal!.status = "COMPLETED";
  goal!.completedAt = event.block.timestamp;
  goal!.updatedAt = event.block.timestamp;
  goal!.save();

  const item = activity(event, "GOAL_COMPLETED", goal!.family);
  item.child = goal!.child;
  item.goal = goalId;
  item.save();
}

export function handleRedemptionRequested(event: RedemptionRequested): void {
  const redemptionId = event.params.redemptionId.toString();
  const goalId = event.params.goalId.toString();
  const childId = event.params.childId.toString();
  const child = requireChild(childId);
  const goal = Goal.load(goalId);
  assert(goal !== null, "Redemption goal must exist");
  assert(
    goal!.child == childId && goal!.family == child.family,
    "Redemption goal must match child",
  );
  assert(goal!.status == "ACTIVE", "Redemption goal must be active");
  assert(
    goal!.allocatedStars.equals(goal!.starCost) &&
      event.params.reservedStars.equals(goal!.starCost),
    "Redemption requires a fully funded goal",
  );

  const redemption = new Redemption(redemptionId);
  redemption.family = child.family;
  redemption.child = childId;
  redemption.goal = goalId;
  redemption.reservedStars = event.params.reservedStars;
  redemption.status = "PENDING";
  redemption.requestedAt = event.block.timestamp;
  redemption.requestTransactionHash = event.transaction.hash;
  redemption.updatedAt = event.block.timestamp;
  redemption.save();

  // Contributions already reserved these Stars; requesting must not reserve twice.
  child.updatedAt = event.block.timestamp;
  child.save();

  const item = activity(event, "REDEMPTION_REQUESTED", child.family);
  item.child = childId;
  item.goal = goalId;
  item.redemption = redemptionId;
  item.amount = event.params.reservedStars;
  item.save();
}

export function handleRedemptionApproved(event: RedemptionApproved): void {
  resolveRedemption(
    event,
    event.params.redemptionId.toString(),
    event.params.goalId.toString(),
    "APPROVED",
  );
}

export function handleRedemptionRejected(event: RedemptionRejected): void {
  resolveRedemption(
    event,
    event.params.redemptionId.toString(),
    event.params.goalId.toString(),
    "REJECTED",
  );
}

export function handleRedemptionCancelled(event: RedemptionCancelled): void {
  resolveRedemption(
    event,
    event.params.redemptionId.toString(),
    event.params.goalId.toString(),
    "CANCELLED",
  );
}

function resolveRedemption(
  event: ethereum.Event,
  redemptionId: string,
  goalId: string,
  status: string,
): void {
  const redemption = Redemption.load(redemptionId);
  assert(redemption !== null, "Resolved redemption must exist");
  assert(redemption!.goal == goalId, "Resolved redemption goal must match");
  assert(
    redemption!.status == "PENDING",
    "Only a pending redemption can be resolved",
  );
  redemption!.status = status;
  redemption!.resolvedAt = event.block.timestamp;
  redemption!.updatedAt = event.block.timestamp;
  redemption!.resolutionTransactionHash = event.transaction.hash;
  redemption!.save();

  const child = requireChild(redemption!.child);
  assert(
    child.reservedStars.ge(redemption!.reservedStars),
    "Resolved redemption cannot exceed reserved stars",
  );
  child.reservedStars = child.reservedStars.minus(redemption!.reservedStars);
  child.updatedAt = event.block.timestamp;
  child.save();

  const goal = Goal.load(goalId);
  assert(
    goal !== null && goal!.allocatedStars.equals(redemption!.reservedStars),
    "Resolved goal allocation must match",
  );
  goal!.allocatedStars = BigInt.zero();
  goal!.updatedAt = event.block.timestamp;
  goal!.save();

  const item = activity(event, "REDEMPTION_" + status, redemption!.family);
  item.child = redemption!.child;
  item.goal = redemption!.goal;
  item.redemption = redemptionId;
  item.amount = redemption!.reservedStars;
  item.save();
}
