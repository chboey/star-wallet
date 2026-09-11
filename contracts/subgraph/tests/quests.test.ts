import { Address, ethereum } from "@graphprotocol/graph-ts";
import { assert, beforeEach, clearStore, test } from "matchstick-as";
import { ChildRegistered } from "../generated/StarRegistry/StarRegistry";
import {
  QuestCreated,
  QuestStatusUpdated,
  StarRequestCreated,
  StarRequestResolved,
} from "../generated/templates/StarQuestsTemplate/StarQuests";
import { handleChildRegistered } from "../src/registry";
import {
  handleQuestCreated,
  handleQuestStatusUpdated,
  handleStarRequestCreated,
  handleStarRequestResolved,
} from "../src/quests";
import {
  createVault,
  mockEvent,
  param,
  uint,
  FACTORY,
  HASH,
  MAKER,
  OTHER_MAKER,
} from "./fixtures";

const CHILD = Address.fromString("0x0000000000000000000000000000000000000099");
const ID = OTHER_MAKER.toHexString() + "-1";
beforeEach(() => {
  clearStore();
  createVault();
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
      200,
    ),
  );
});
function createQuest(): void {
  handleQuestCreated(
    mockEvent<QuestCreated>(
      OTHER_MAKER,
      [
        param("questId", uint("1")),
        param("childId", uint("1")),
        param("stars", uint("3")),
        param("title", ethereum.Value.fromString("Read a book")),
      ],
      201,
    ),
  );
}
function request(questId: string): void {
  handleStarRequestCreated(
    mockEvent<StarRequestCreated>(
      OTHER_MAKER,
      [
        param("requestId", uint("1")),
        param("childId", uint("1")),
        param("questId", uint(questId)),
        param("stars", uint("3")),
        param("reason", ethereum.Value.fromString("Read a book")),
        param("submissionId", ethereum.Value.fromFixedBytes(HASH)),
      ],
      203,
    ),
  );
}
function resolve(status: i32, rewardId: string): void {
  handleStarRequestResolved(
    mockEvent<StarRequestResolved>(
      OTHER_MAKER,
      [
        param("requestId", uint("1")),
        param("status", ethereum.Value.fromI32(status)),
        param("rewardId", uint(rewardId)),
      ],
      205,
    ),
  );
}
test("quest completion links the request and vault-scoped reward without minting indexed Stars twice", () => {
  createQuest();
  handleQuestStatusUpdated(
    mockEvent<QuestStatusUpdated>(
      OTHER_MAKER,
      [param("questId", uint("1")), param("status", ethereum.Value.fromI32(1))],
      202,
    ),
  );
  request("1");
  assert.fieldEquals("StarRequest", ID, "quest", ID);
  assert.fieldEquals("StarRequest", ID, "status", "PENDING");
  assert.fieldEquals("Child", "1", "starBalance", "0");
  handleQuestStatusUpdated(
    mockEvent<QuestStatusUpdated>(
      OTHER_MAKER,
      [param("questId", uint("1")), param("status", ethereum.Value.fromI32(2))],
      204,
    ),
  );
  resolve(1, "7");
  assert.fieldEquals("Quest", ID, "status", "COMPLETED");
  assert.fieldEquals("StarRequest", ID, "reward", MAKER.toHexString() + "-7");
  assert.fieldEquals("Child", "1", "starBalance", "0");
});
test("manual request rejection retains history without a quest or reward", () => {
  request("0");
  resolve(2, "0");
  assert.fieldEquals("StarRequest", ID, "status", "REJECTED");
  assert.entityCount("Quest", 0);
  assert.entityCount("Reward", 0);
});
test("cancelled requests stay cancelled", () => {
  request("0");
  resolve(3, "0");
  assert.fieldEquals("StarRequest", ID, "status", "CANCELLED");
});
test(
  "duplicate resolution fails instead of rewriting history",
  () => {
    request("0");
    resolve(3, "0");
    resolve(1, "9");
  },
  true,
);
