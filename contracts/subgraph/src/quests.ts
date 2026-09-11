import { BigInt, dataSource, ethereum } from "@graphprotocol/graph-ts";
import {
  QuestCreated,
  QuestStatusUpdated,
  StarRequestCreated,
  StarRequestResolved,
} from "../generated/templates/StarQuestsTemplate/StarQuests";
import { Quest, StarRequest } from "../generated/schema";
import { requireChild } from "./helpers";

function key(event: ethereum.Event, id: BigInt): string {
  return event.address.toHexString() + "-" + id.toString();
}

export function handleQuestCreated(event: QuestCreated): void {
  const child = requireChild(event.params.childId.toString());
  assert(
    child.family == dataSource.context().getString("familyId"),
    "Quest family mismatch",
  );
  const item = new Quest(key(event, event.params.questId));
  item.questId = event.params.questId;
  item.workflow = event.address;
  item.family = child.family;
  item.child = child.id;
  item.title = event.params.title;
  item.stars = event.params.stars;
  item.status = "ACTIVE";
  item.createdAt = event.block.timestamp;
  item.updatedAt = event.block.timestamp;
  item.save();
}

export function handleQuestStatusUpdated(event: QuestStatusUpdated): void {
  const item = Quest.load(key(event, event.params.questId));
  assert(item !== null, "Quest must exist");
  const statuses = ["ACTIVE", "SUBMITTED", "COMPLETED", "CANCELLED"];
  assert(event.params.status < statuses.length, "Invalid quest status");
  item!.status = statuses[event.params.status];
  item!.updatedAt = event.block.timestamp;
  item!.save();
}

export function handleStarRequestCreated(event: StarRequestCreated): void {
  const child = requireChild(event.params.childId.toString());
  assert(
    child.family == dataSource.context().getString("familyId"),
    "Request family mismatch",
  );
  const item = new StarRequest(key(event, event.params.requestId));
  item.requestId = event.params.requestId;
  item.workflow = event.address;
  item.family = child.family;
  item.child = child.id;
  if (!event.params.questId.isZero())
    item.quest = key(event, event.params.questId);
  item.stars = event.params.stars;
  item.reason = event.params.reason;
  item.submissionId = event.params.submissionId;
  item.status = "PENDING";
  item.createdAt = event.block.timestamp;
  item.updatedAt = event.block.timestamp;
  item.creationTransactionHash = event.transaction.hash;
  item.save();
}

export function handleStarRequestResolved(event: StarRequestResolved): void {
  const item = StarRequest.load(key(event, event.params.requestId));
  assert(item !== null && item!.status == "PENDING", "Request must be pending");
  const statuses = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
  assert(
    event.params.status > 0 && event.params.status < statuses.length,
    "Invalid request status",
  );
  item!.status = statuses[event.params.status];
  if (event.params.status == 1) item!.rewardId = event.params.rewardId;
  item!.updatedAt = event.block.timestamp;
  item!.resolutionTransactionHash = event.transaction.hash;
  item!.save();
}
