import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { assert, beforeEach, clearStore, test } from "matchstick-as";
import { SavingsAccount } from "../generated/schema";
import { SavingsPositionToppedUp } from "../generated/templates/StarFamilyVaultTemplate/StarFamilyVault";
import {
  handleSavingsPositionToppedUp,
  handleSavingsPositionUpdated,
} from "../src/vault";
import { handlePushed, handleShipped, handleDocked } from "../src/aqua";
import { eventId } from "../src/helpers";
import {
  MAKER,
  HASH,
  OTHER_HASH,
  USDC,
  WETH,
  OPEN_USDC,
  OPEN_WETH,
  createVault,
  mockEvent,
  param,
  uint,
  positionEvent,
  pushed,
  shipped,
  docked,
} from "./fixtures";

const POSITION = "1-" + HASH.toHexString();
function topUp(
  usdc: string = "1000000",
  weth: string = "1000000000000000",
  index: i32 = 7,
  hash: Bytes = HASH,
  familyId: string = "1",
): SavingsPositionToppedUp {
  return mockEvent<SavingsPositionToppedUp>(
    MAKER,
    [
      param("familyId", uint(familyId)),
      param("strategyHash", ethereum.Value.fromFixedBytes(hash)),
      param("usdcAmount", uint(usdc)),
      param("wethAmount", uint(weth)),
    ],
    index,
  );
}
function ship(): void {
  handleShipped(shipped());
  handlePushed(pushed(USDC, OPEN_USDC, 2));
  handlePushed(pushed(WETH, OPEN_WETH, 3));
}
beforeEach(() => {
  clearStore();
  createVault();
  const account = SavingsAccount.load("1")!;
  account.availableUsdc = account.availableUsdc.plus(
    BigInt.fromString("2000000"),
  );
  account.availableWeth = account.availableWeth.plus(
    BigInt.fromString("2000000000000000"),
  );
  account.save();
});

function verify(): void {
  assert.fieldEquals("SavingsAccount", "1", "availableUsdc", "1000000");
  assert.fieldEquals(
    "SavingsAccount",
    "1",
    "availableWeth",
    "1000000000000000",
  );
  assert.fieldEquals("SavingsAccount", "1", "activePosition", POSITION);
  assert.fieldEquals(
    "SavingsPosition",
    POSITION,
    "openingUsdcAmount",
    OPEN_USDC,
  );
  assert.fieldEquals(
    "SavingsPosition",
    POSITION,
    "openingWethAmount",
    OPEN_WETH,
  );
  assert.fieldEquals(
    "SavingsPosition",
    POSITION,
    "currentUsdcAmount",
    "101000000",
  );
  assert.fieldEquals(
    "SavingsPosition",
    POSITION,
    "currentWethAmount",
    "1001000000000000000",
  );
  assert.entityCount("SavingsPosition", 1);
  assert.fieldEquals(
    "ProtocolActivity",
    eventId(topUp()).toHexString(),
    "type",
    "SAVINGS_POSITION_TOPPED_UP",
  );
}

test("Aqua credits and vault debits a top-up exactly once without changing principal", () => {
  const before = SavingsAccount.load("1")!.totalPrincipalContributed.toString();
  ship();
  handleSavingsPositionUpdated(positionEvent());
  handlePushed(pushed(USDC, "1000000", 5));
  handlePushed(pushed(WETH, "1000000000000000", 6));
  handleSavingsPositionToppedUp(topUp());
  verify();
  assert.fieldEquals(
    "SavingsAccount",
    "1",
    "totalPrincipalContributed",
    before,
  );
});

test("new template same-block replay does not double-count queued top-up pushes", () => {
  ship();
  handlePushed(pushed(USDC, "1000000", 5));
  handlePushed(pushed(WETH, "1000000000000000", 6));
  handleSavingsPositionUpdated(positionEvent());
  handleSavingsPositionToppedUp(topUp());
  verify();
});

test("one-token top-up then close returns current balances without a second allocation", () => {
  ship();
  handleSavingsPositionUpdated(positionEvent());
  handlePushed(pushed(USDC, "1000000", 5));
  handleSavingsPositionToppedUp(topUp("1000000", "0"));
  assert.fieldEquals(
    "SavingsAccount",
    "1",
    "availableWeth",
    "2000000000000000",
  );
  handleDocked(docked(8));
  handleSavingsPositionUpdated(positionEvent(false, 9, "101000000", OPEN_WETH));
  assert.fieldEquals("SavingsAccount", "1", "availableUsdc", "102000000");
  assert.fieldEquals(
    "SavingsAccount",
    "1",
    "availableWeth",
    "1002000000000000000",
  );
  assert.fieldEquals("SavingsPosition", POSITION, "status", "DOCKED");
});

test(
  "top-up rejects a missing position",
  () => {
    handleSavingsPositionToppedUp(topUp());
  },
  true,
);
test(
  "top-up rejects another family",
  () => {
    handleSavingsPositionToppedUp(topUp("1", "0", 7, HASH, "2"));
  },
  true,
);
test(
  "top-up rejects another strategy",
  () => {
    ship();
    handleSavingsPositionUpdated(positionEvent());
    handleSavingsPositionToppedUp(topUp("1", "0", 7, OTHER_HASH));
  },
  true,
);
test(
  "top-up cannot debit more than available",
  () => {
    ship();
    handleSavingsPositionUpdated(positionEvent());
    handleSavingsPositionToppedUp(topUp("2000001", "0"));
  },
  true,
);
test(
  "top-up cannot target a closed position",
  () => {
    ship();
    handleSavingsPositionUpdated(positionEvent());
    handleDocked(docked(5));
    handleSavingsPositionUpdated(positionEvent(false, 6));
    handleSavingsPositionToppedUp(topUp());
  },
  true,
);
