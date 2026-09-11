import { Address, ethereum } from "@graphprotocol/graph-ts";
import { assert, beforeEach, clearStore, test } from "matchstick-as";
import {
  ChildRegistered,
  ChildRegistrationProposed,
  ChildRegistrationAccepted,
  ChildRegistrationCancelled,
} from "../generated/StarRegistry/StarRegistry";
import { Transfer } from "../generated/StarToken/StarToken";
import {
  GoalCreated,
  GoalCancelled,
  GoalStarsAdded,
  GoalCompleted,
  GoalRequested,
  GoalRequestApproved,
  GoalRequestRejected,
  GoalRequestCancelled,
  RedemptionRequested,
  RedemptionApproved,
  RedemptionRejected,
  RedemptionCancelled,
} from "../generated/StarGoals/StarGoals";
import {
  handleChildRegistered,
  handleChildRegistrationProposed,
  handleChildRegistrationAccepted,
  handleChildRegistrationCancelled,
} from "../src/registry";
import { handleTransfer } from "../src/token";
import {
  handleGoalCreated,
  handleGoalCancelled,
  handleGoalStarsAdded,
  handleGoalCompleted,
  handleGoalRequested,
  handleGoalRequestApproved,
  handleGoalRequestRejected,
  handleGoalRequestCancelled,
  handleRedemptionRequested,
  handleRedemptionApproved,
  handleRedemptionRejected,
  handleRedemptionCancelled,
} from "../src/goals";
import { eventId } from "../src/helpers";
import {
  FACTORY,
  HASH,
  PARENT,
  createVault,
  mockEvent,
  param,
  uint,
} from "./fixtures";

const CHILD = Address.fromString("0x0000000000000000000000000000000000000099");
const ZERO = Address.fromString("0x0000000000000000000000000000000000000000");

beforeEach(() => {
  clearStore();
  createVault();
});

function propose(index: i32): ChildRegistrationProposed {
  return mockEvent<ChildRegistrationProposed>(
    FACTORY,
    [
      param("registrationId", ethereum.Value.fromFixedBytes(HASH)),
      param("familyId", uint("1")),
      param("childWallet", ethereum.Value.fromAddress(CHILD)),
      param("ensNode", ethereum.Value.fromFixedBytes(HASH)),
      param("ensName", ethereum.Value.fromString("child.family.eth")),
    ],
    index,
  );
}

function register(): void {
  const proposal = propose(200);
  handleChildRegistrationProposed(proposal);
  handleChildRegistered(
    mockEvent<ChildRegistered>(
      FACTORY,
      [
        param("childId", uint("1")),
        param("familyId", uint("1")),
        param("wallet", ethereum.Value.fromAddress(CHILD)),
        param("ensNode", ethereum.Value.fromFixedBytes(HASH)),
        param("ensName", ethereum.Value.fromString("child.family.eth")),
      ],
      201,
    ),
  );
  handleChildRegistrationAccepted(
    mockEvent<ChildRegistrationAccepted>(
      FACTORY,
      [
        param("registrationId", ethereum.Value.fromFixedBytes(HASH)),
        param("familyId", uint("1")),
        param("childId", uint("1")),
        param("childWallet", ethereum.Value.fromAddress(CHILD)),
      ],
      202,
    ),
  );
  assert.fieldEquals(
    "ChildRegistration",
    eventId(proposal).toHexString(),
    "status",
    "ACCEPTED",
  );
  assert.notInStore("PendingChildRegistration", HASH.toHexString());
}

function transfer(from: Address, to: Address, amount: string): void {
  handleTransfer(
    mockEvent<Transfer>(
      FACTORY,
      [
        param("from", ethereum.Value.fromAddress(from)),
        param("to", ethereum.Value.fromAddress(to)),
        param("value", uint(amount)),
      ],
      210,
    ),
  );
}

function requestGoal(id: string = "1"): void {
  handleGoalRequested(
    mockEvent<GoalRequested>(
      FACTORY,
      [
        param("requestId", uint(id)),
        param("childId", uint("1")),
        param("title", ethereum.Value.fromString("Rocket Toy")),
        param("reason", ethereum.Value.fromString("Space adventures")),
        param("icon", ethereum.Value.fromI32(6)),
        param("submissionId", ethereum.Value.fromFixedBytes(HASH)),
      ],
      230,
    ),
  );
}

test("goal requests preserve metadata and approval links exactly one parent-created goal", () => {
  register();
  requestGoal();
  assert.fieldEquals("GoalRequest", "1", "status", "PENDING");
  assert.fieldEquals("GoalRequest", "1", "family", "1");
  assert.fieldEquals("GoalRequest", "1", "icon", "6");
  assert.fieldEquals("GoalRequest", "1", "reason", "Space adventures");
  assert.entityCount("Goal", 0);
  assert.fieldEquals("Child", "1", "starBalance", "0");
  handleGoalCreated(
    mockEvent<GoalCreated>(
      FACTORY,
      [
        param("goalId", uint("9")),
        param("childId", uint("1")),
        param("starCost", uint("32")),
        param("title", ethereum.Value.fromString("Rocket Toy")),
      ],
      231,
    ),
  );
  handleGoalRequestApproved(
    mockEvent<GoalRequestApproved>(
      FACTORY,
      [param("requestId", uint("1")), param("goalId", uint("9"))],
      232,
    ),
  );
  assert.fieldEquals("GoalRequest", "1", "status", "APPROVED");
  assert.fieldEquals("GoalRequest", "1", "goal", "9");
  assert.fieldEquals("Goal", "9", "starCost", "32");
  assert.fieldEquals("Child", "1", "starBalance", "0");
});

test("declined and cancelled goal requests retain their history without creating goals", () => {
  register();
  requestGoal();
  requestGoal("2");
  handleGoalRequestRejected(
    mockEvent<GoalRequestRejected>(
      FACTORY,
      [param("requestId", uint("1"))],
      233,
    ),
  );
  handleGoalRequestCancelled(
    mockEvent<GoalRequestCancelled>(
      FACTORY,
      [param("requestId", uint("2"))],
      234,
    ),
  );
  assert.fieldEquals("GoalRequest", "1", "status", "REJECTED");
  assert.fieldEquals("GoalRequest", "2", "status", "CANCELLED");
  assert.entityCount("Goal", 0);
});

function addGoalStars(amount: string, total: string, index: i32): void {
  handleGoalStarsAdded(
    mockEvent<GoalStarsAdded>(
      FACTORY,
      [
        param("goalId", uint("1")),
        param("childId", uint("1")),
        param("amount", uint(amount)),
        param("totalAllocated", uint(total)),
      ],
      index,
    ),
  );
}

function createFundableGoal(): void {
  register();
  transfer(ZERO, CHILD, "100");
  handleGoalCreated(
    mockEvent<GoalCreated>(
      FACTORY,
      [
        param("goalId", uint("1")),
        param("childId", uint("1")),
        param("starCost", uint("80")),
        param("title", ethereum.Value.fromString("Bicycle")),
      ],
      220,
    ),
  );
  assert.fieldEquals("Goal", "1", "allocatedStars", "0");
  assert.fieldEquals("Child", "1", "reservedStars", "0");
}

function requestRedemption(): void {
  createFundableGoal();
  addGoalStars("30", "30", 221);
  addGoalStars("50", "80", 222);
  assert.fieldEquals("Goal", "1", "allocatedStars", "80");
  assert.fieldEquals("Child", "1", "reservedStars", "80");
  handleRedemptionRequested(
    mockEvent<RedemptionRequested>(
      FACTORY,
      [
        param("redemptionId", uint("1")),
        param("goalId", uint("1")),
        param("childId", uint("1")),
        param("reservedStars", uint("80")),
      ],
      223,
    ),
  );
  assert.fieldEquals("Child", "1", "reservedStars", "80");
  assert.fieldEquals("Child", "1", "starBalance", "100");
}

test("accepted child links its wallet and any existing token balance", () => {
  transfer(ZERO, CHILD, "10");
  register();
  assert.fieldEquals("ChildWallet", CHILD.toHexString(), "child", "1");
  assert.fieldEquals("Family", "1", "childCount", "1");
  assert.fieldEquals("Child", "1", "starBalance", "10");
  transfer(ZERO, CHILD, "5");
  transfer(CHILD, ZERO, "3");
  assert.fieldEquals("Child", "1", "starBalance", "12");
  assert.fieldEquals("Child", "1", "totalStarsIssued", "15");
  assert.fieldEquals("Child", "1", "totalStarsBurned", "3");
});

test("partial contributions reserve Stars on the chosen goal and goal cancellation releases them", () => {
  createFundableGoal();
  addGoalStars("20", "20", 221);
  assert.fieldEquals("Goal", "1", "allocatedStars", "20");
  assert.fieldEquals("Child", "1", "reservedStars", "20");
  assert.fieldEquals("Child", "1", "starBalance", "100");
  handleGoalCancelled(
    mockEvent<GoalCancelled>(
      FACTORY,
      [param("goalId", uint("1")), param("childId", uint("1"))],
      222,
    ),
  );
  assert.fieldEquals("Goal", "1", "allocatedStars", "0");
  assert.fieldEquals("Child", "1", "reservedStars", "0");
  assert.fieldEquals("Child", "1", "starBalance", "100");
});

test(
  "inconsistent contribution totals fail closed",
  () => {
    createFundableGoal();
    addGoalStars("20", "30", 221);
  },
  true,
);

test("cancelled registrations retain history when the same registration ID is proposed again", () => {
  const first = propose(200);
  handleChildRegistrationProposed(first);
  handleChildRegistrationCancelled(
    mockEvent<ChildRegistrationCancelled>(
      FACTORY,
      [
        param("registrationId", ethereum.Value.fromFixedBytes(HASH)),
        param("familyId", uint("1")),
        param("childWallet", ethereum.Value.fromAddress(CHILD)),
        param("cancelledBy", ethereum.Value.fromAddress(PARENT)),
      ],
      201,
    ),
  );
  const second = propose(202);
  handleChildRegistrationProposed(second);
  assert.entityCount("ChildRegistration", 2);
  assert.fieldEquals(
    "ChildRegistration",
    eventId(first).toHexString(),
    "status",
    "CANCELLED",
  );
  assert.fieldEquals(
    "ChildRegistration",
    eventId(second).toHexString(),
    "status",
    "PENDING",
  );
  assert.fieldEquals(
    "PendingChildRegistration",
    HASH.toHexString(),
    "registration",
    eventId(second).toHexString(),
  );
});

test("approved redemption consumes its reservation and records the token burn only once", () => {
  requestRedemption();
  // StarGoals burns first, then emits approval and completion in this order.
  transfer(CHILD, ZERO, "80");
  handleRedemptionApproved(
    mockEvent<RedemptionApproved>(
      FACTORY,
      [param("redemptionId", uint("1")), param("goalId", uint("1"))],
      224,
    ),
  );
  handleGoalCompleted(
    mockEvent<GoalCompleted>(
      FACTORY,
      [param("goalId", uint("1")), param("childId", uint("1"))],
      225,
    ),
  );
  assert.fieldEquals("Child", "1", "reservedStars", "0");
  assert.fieldEquals("Child", "1", "starBalance", "20");
  assert.fieldEquals("Child", "1", "totalStarsBurned", "80");
  assert.fieldEquals("Redemption", "1", "status", "APPROVED");
  assert.fieldEquals("Goal", "1", "status", "COMPLETED");
  assert.fieldEquals("Goal", "1", "allocatedStars", "0");
});

test("rejection releases the reservation without burning STAR or completing the goal", () => {
  requestRedemption();
  handleRedemptionRejected(
    mockEvent<RedemptionRejected>(
      FACTORY,
      [param("redemptionId", uint("1")), param("goalId", uint("1"))],
      224,
    ),
  );
  assert.fieldEquals("Child", "1", "reservedStars", "0");
  assert.fieldEquals("Child", "1", "starBalance", "100");
  assert.fieldEquals("Redemption", "1", "status", "REJECTED");
  assert.fieldEquals("Goal", "1", "status", "ACTIVE");
  assert.fieldEquals("Goal", "1", "allocatedStars", "0");
});

test("child cancellation releases the reservation without burning STAR", () => {
  requestRedemption();
  handleRedemptionCancelled(
    mockEvent<RedemptionCancelled>(
      FACTORY,
      [param("redemptionId", uint("1")), param("goalId", uint("1"))],
      224,
    ),
  );
  assert.fieldEquals("Child", "1", "reservedStars", "0");
  assert.fieldEquals("Child", "1", "starBalance", "100");
  assert.fieldEquals("Redemption", "1", "status", "CANCELLED");
});

test(
  "missing mint history fails instead of indexing a negative STAR balance",
  () => {
    register();
    transfer(CHILD, ZERO, "1");
  },
  true,
);
