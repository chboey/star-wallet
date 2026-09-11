import {
  Address,
  BigInt,
  Bytes,
  DataSourceContext,
  ethereum,
} from "@graphprotocol/graph-ts";
import {
  assert,
  beforeEach,
  clearStore,
  dataSourceMock,
  newMockEvent,
  test,
} from "matchstick-as";
import { FamilyCreated, ChildRegistered } from "../generated/StarRegistry/StarRegistry";
import {
  GoalCreated,
  GoalRequested,
  GoalRequestApproved,
  GoalStarsAdded,
  RedemptionRejected,
  RedemptionRequested,
} from "../generated/StarGoals/StarGoals";
import {
  QuestCreated,
  QuestStatusUpdated,
  StarRequestCreated,
  StarRequestResolved,
} from "../generated/templates/StarQuestsTemplate/StarQuests";
import { Transfer } from "../generated/StarToken/StarToken";
import { handleChildRegistered, handleFamilyCreated } from "../src/registry";
import { handleTransfer } from "../src/token";
import {
  handleGoalCreated,
  handleGoalRequested,
  handleGoalRequestApproved,
  handleGoalStarsAdded,
  handleRedemptionRejected,
  handleRedemptionRequested,
} from "../src/goals";
import {
  handleQuestCreated,
  handleQuestStatusUpdated,
  handleStarRequestCreated,
  handleStarRequestResolved,
} from "../src/quests";

const SOURCE = Address.fromString("0x0000000000000000000000000000000000000001");
const ZERO = Address.fromString("0x0000000000000000000000000000000000000000");
const PARENT = Address.fromString("0x0000000000000000000000000000000000000002");
const CHILD = Address.fromString("0x0000000000000000000000000000000000000003");
const WORKFLOW = Address.fromString("0x0000000000000000000000000000000000000004");
const VAULT = Address.fromString("0x0000000000000000000000000000000000000005");
const HASH = Bytes.fromHexString("0x" + "ab".repeat(32));

function parameter(name: string, value: ethereum.Value): ethereum.EventParam {
  return new ethereum.EventParam(name, value);
}

function uint(value: string): ethereum.Value {
  return ethereum.Value.fromUnsignedBigInt(BigInt.fromString(value));
}

function event<T>(params: ethereum.EventParam[], index: i32 = 1): T {
  const item = newMockEvent();
  item.address = SOURCE;
  item.parameters = params;
  item.logIndex = BigInt.fromI32(index);
  item.block.timestamp = BigInt.fromI32(1000 + index);
  return changetype<T>(item);
}

function createFamilyAndChild(): void {
  handleFamilyCreated(
    event<FamilyCreated>([
      parameter("familyId", uint("1")),
      parameter("parent", ethereum.Value.fromAddress(PARENT)),
      parameter("ensNode", ethereum.Value.fromFixedBytes(HASH)),
      parameter("ensName", ethereum.Value.fromString("lee.starwallet.eth")),
    ]),
  );
  handleChildRegistered(
    event<ChildRegistered>(
      [
        parameter("childId", uint("1")),
        parameter("familyId", uint("1")),
        parameter("wallet", ethereum.Value.fromAddress(CHILD)),
        parameter("ensNode", ethereum.Value.fromFixedBytes(HASH)),
        parameter("ensName", ethereum.Value.fromString("maya.lee.starwallet.eth")),
      ],
      2,
    ),
  );
}

beforeEach(() => {
  clearStore();
  createFamilyAndChild();
});

test("goal requests link to the matching parent-created goal", () => {
  handleGoalRequested(
    event<GoalRequested>([
      parameter("requestId", uint("1")),
      parameter("childId", uint("1")),
      parameter("title", ethereum.Value.fromString("Rocket Toy")),
      parameter("reason", ethereum.Value.fromString("Space adventures")),
      parameter("icon", ethereum.Value.fromI32(6)),
      parameter("submissionId", ethereum.Value.fromFixedBytes(HASH)),
    ]),
  );
  handleGoalCreated(
    event<GoalCreated>([
      parameter("goalId", uint("9")),
      parameter("childId", uint("1")),
      parameter("starCost", uint("30")),
      parameter("title", ethereum.Value.fromString("Rocket Toy")),
    ]),
  );
  handleGoalRequestApproved(
    event<GoalRequestApproved>([
      parameter("requestId", uint("1")),
      parameter("goalId", uint("9")),
    ]),
  );
  assert.fieldEquals("GoalRequest", "1", "status", "APPROVED");
  assert.fieldEquals("GoalRequest", "1", "goal", "9");
  assert.fieldEquals("Goal", "9", "allocatedStars", "0");
});

test("contributions reserve once and a rejected redemption releases once", () => {
  handleTransfer(
    event<Transfer>([
      parameter("from", ethereum.Value.fromAddress(ZERO)),
      parameter("to", ethereum.Value.fromAddress(CHILD)),
      parameter("value", uint("30")),
    ]),
  );
  handleGoalCreated(
    event<GoalCreated>([
      parameter("goalId", uint("1")),
      parameter("childId", uint("1")),
      parameter("starCost", uint("30")),
      parameter("title", ethereum.Value.fromString("Bicycle")),
    ]),
  );
  handleGoalStarsAdded(
    event<GoalStarsAdded>([
      parameter("goalId", uint("1")),
      parameter("childId", uint("1")),
      parameter("amount", uint("30")),
      parameter("totalAllocated", uint("30")),
    ]),
  );
  assert.fieldEquals("Child", "1", "reservedStars", "30");
  handleRedemptionRequested(
    event<RedemptionRequested>([
      parameter("redemptionId", uint("1")),
      parameter("goalId", uint("1")),
      parameter("childId", uint("1")),
      parameter("reservedStars", uint("30")),
    ]),
  );
  assert.fieldEquals("Child", "1", "reservedStars", "30");
  handleRedemptionRejected(
    event<RedemptionRejected>([
      parameter("redemptionId", uint("1")),
      parameter("goalId", uint("1")),
    ]),
  );
  assert.fieldEquals("Child", "1", "reservedStars", "0");
  assert.fieldEquals("Goal", "1", "allocatedStars", "0");
  assert.fieldEquals("Redemption", "1", "status", "REJECTED");
});

test("quest and Star-request history is scoped to its workflow", () => {
  const context = new DataSourceContext();
  context.setString("familyId", "1");
  context.setString("vault", VAULT.toHexString());
  dataSourceMock.setReturnValues(WORKFLOW.toHexString(), "sepolia", context);
  const quest = event<QuestCreated>([
    parameter("questId", uint("1")),
    parameter("childId", uint("1")),
    parameter("stars", uint("5")),
    parameter("title", ethereum.Value.fromString("Read a book")),
  ]);
  quest.address = WORKFLOW;
  handleQuestCreated(quest);
  const created = event<StarRequestCreated>([
    parameter("requestId", uint("1")),
    parameter("childId", uint("1")),
    parameter("questId", uint("1")),
    parameter("stars", uint("5")),
    parameter("reason", ethereum.Value.fromString("Read a book")),
    parameter("submissionId", ethereum.Value.fromFixedBytes(HASH)),
  ]);
  created.address = WORKFLOW;
  handleStarRequestCreated(created);
  const submitted = event<QuestStatusUpdated>([
    parameter("questId", uint("1")),
    parameter("status", ethereum.Value.fromI32(1)),
  ]);
  submitted.address = WORKFLOW;
  handleQuestStatusUpdated(submitted);
  const resolved = event<StarRequestResolved>([
    parameter("requestId", uint("1")),
    parameter("status", ethereum.Value.fromI32(1)),
    parameter("rewardId", uint("7")),
  ]);
  resolved.address = WORKFLOW;
  handleStarRequestResolved(resolved);
  const completed = event<QuestStatusUpdated>([
    parameter("questId", uint("1")),
    parameter("status", ethereum.Value.fromI32(2)),
  ]);
  completed.address = WORKFLOW;
  handleQuestStatusUpdated(completed);
  const id = WORKFLOW.toHexString() + "-1";
  assert.fieldEquals("Quest", id, "status", "COMPLETED");
  assert.fieldEquals("StarRequest", id, "status", "APPROVED");
  assert.fieldEquals("StarRequest", id, "quest", id);
  assert.fieldEquals("StarRequest", id, "rewardId", "7");
});
