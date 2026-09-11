import { Address, BigInt } from "@graphprotocol/graph-ts";
import { assert, beforeEach, clearStore, test } from "matchstick-as";
import { SavingsAccount } from "../generated/schema";
import {
  handleDocked,
  handlePulled,
  handlePushed,
  handleShipped,
  handleSwapped,
} from "../src/aqua";
import { handleSavingsPositionUpdated } from "../src/vault";
import { eventId, strategyKey } from "../src/helpers";
import {
  APP,
  HASH,
  MAKER,
  OPEN_USDC,
  OPEN_WETH,
  OTHER_HASH,
  OTHER_MAKER,
  USDC,
  WETH,
  createVault,
  docked,
  positionEvent,
  pulled,
  pushed,
  setFamilyContext,
  shipped,
  swapped,
} from "./fixtures";

const POSITION = "1-" + HASH.toHexString();

beforeEach(() => {
  clearStore();
  createVault();
});

function ship(): void {
  handleShipped(shipped());
  handlePushed(pushed(USDC, OPEN_USDC, 2));
  handlePushed(pushed(WETH, OPEN_WETH, 3));
}
function swap(): void {
  handlePulled(pulled(WETH, "5000000000000000", 6));
  handlePushed(pushed(USDC, "10000000", 7));
  handleSwapped(swapped(8));
}
function balances(
  usdc: string,
  weth: string,
  position: string = POSITION,
): void {
  assert.fieldEquals("SavingsPosition", position, "currentUsdcAmount", usdc);
  assert.fieldEquals("SavingsPosition", position, "currentWethAmount", weth);
}

test("factory snapshots token identities and creates the vault template", () => {
  assert.fieldEquals(
    "FamilyVault",
    MAKER.toHexString(),
    "usdc",
    USDC.toHexString(),
  );
  assert.fieldEquals(
    "FamilyVault",
    MAKER.toHexString(),
    "weth",
    WETH.toHexString(),
  );
  assert.dataSourceExists("StarFamilyVaultTemplate", MAKER.toHexString());
});

test("opening allocations are linked but never counted twice", () => {
  ship();
  handleSavingsPositionUpdated(positionEvent());
  balances(OPEN_USDC, OPEN_WETH);
  assert.fieldEquals("SavingsAccount", "1", "availableUsdc", "0");
  assert.fieldEquals("SavingsAccount", "1", "availableWeth", "0");
  assert.entityCount("AquaExecution", 3);
  assert.notInStore(
    "PendingStrategyExecutions",
    strategyKey(MAKER, HASH).toHexString(),
  );
});

test("new-template same-block replay applies queued swap deltas exactly once", () => {
  // Graph Node processes existing static data sources before the newly created
  // vault template. All events share a block; position log 4 follows ship but
  // precedes swap logs 6-8 on chain, and is handled last here.
  ship();
  swap();
  handleSavingsPositionUpdated(positionEvent());
  balances("110000000", "995000000000000000");
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
    "AquaExecution",
    eventId(swapped(8)).toHexString(),
    "position",
    POSITION,
  );
  assert.fieldEquals(
    "AquaExecution",
    eventId(swapped(8)).toHexString(),
    "family",
    "1",
  );
  assert.entityCount("AquaExecution", 6);
  assert.entityCount("PendingStrategyExecutions", 0);
});

test("an existing template applies swaps without a second Swapped balance update", () => {
  ship();
  handleSavingsPositionUpdated(positionEvent());
  swap();
  balances("110000000", "995000000000000000");
  handlePulled(pulled(USDC, "4000000", 9));
  handlePushed(pushed(WETH, "2000000000000000", 10));
  balances("106000000", "997000000000000000");
});

test("direct Aqua pushes are tracked even without a Swapped event", () => {
  ship();
  handlePushed(pushed(USDC, "1000000", 6));
  handleSavingsPositionUpdated(positionEvent());
  balances("101000000", OPEN_WETH);
  handlePushed(pushed(WETH, "1000000000000000", 7));
  balances("101000000", "1001000000000000000");
});

test("same-block ship swap dock preserves closing balances and restores inventory", () => {
  ship();
  swap();
  handleDocked(docked(9));
  handleSavingsPositionUpdated(positionEvent());
  handleSavingsPositionUpdated(
    positionEvent(false, 10, "110000000", "995000000000000000"),
  );
  balances("110000000", "995000000000000000");
  assert.fieldEquals("SavingsPosition", POSITION, "status", "DOCKED");
  assert.fieldEquals(
    "SavingsPosition",
    POSITION,
    "closingUsdcAmount",
    "110000000",
  );
  assert.fieldEquals(
    "SavingsPosition",
    POSITION,
    "closingWethAmount",
    "995000000000000000",
  );
  assert.fieldEquals("SavingsAccount", "1", "availableUsdc", "110000000");
  assert.fieldEquals(
    "SavingsAccount",
    "1",
    "availableWeth",
    "995000000000000000",
  );
  assert.assertNull(SavingsAccount.load("1")!.activePosition);
});

test("same-block replacement keeps old and new strategy balances separate", () => {
  ship();
  swap();
  handleDocked(docked(9));
  handleShipped(shipped(11, OTHER_HASH));
  handlePushed(pushed(USDC, "100000000", 12, OTHER_HASH));
  handlePushed(pushed(WETH, "900000000000000000", 13, OTHER_HASH));
  handlePulled(pulled(WETH, "5000000000000000", 16, OTHER_HASH));
  handlePushed(pushed(USDC, "10000000", 17, OTHER_HASH));
  handleSwapped(swapped(18, OTHER_HASH));
  // Replay the newly created vault template after all singleton events.
  handleSavingsPositionUpdated(positionEvent());
  handleSavingsPositionUpdated(
    positionEvent(false, 10, "110000000", "995000000000000000"),
  );
  handleSavingsPositionUpdated(
    positionEvent(true, 14, "100000000", "900000000000000000", OTHER_HASH),
  );
  balances("110000000", "995000000000000000");
  balances("110000000", "895000000000000000", "1-" + OTHER_HASH.toHexString());
  assert.fieldEquals("SavingsAccount", "1", "availableUsdc", "10000000");
  assert.fieldEquals(
    "SavingsAccount",
    "1",
    "availableWeth",
    "95000000000000000",
  );
  assert.entityCount("PendingStrategyExecutions", 0);
});

test("identical strategy hashes from different makers remain isolated", () => {
  createVault("2", OTHER_MAKER);
  ship();
  swap();
  handleShipped(shipped(11, HASH, OTHER_MAKER));
  handlePushed(pushed(USDC, OPEN_USDC, 12, HASH, OTHER_MAKER));
  handlePushed(pushed(WETH, OPEN_WETH, 13, HASH, OTHER_MAKER));
  handleSavingsPositionUpdated(
    positionEvent(true, 14, OPEN_USDC, OPEN_WETH, HASH, OTHER_MAKER, "2"),
  );
  setFamilyContext("1");
  handleSavingsPositionUpdated(positionEvent());
  balances("110000000", "995000000000000000");
  balances(OPEN_USDC, OPEN_WETH, "2-" + HASH.toHexString());
});

test("token identity, not address sort order, determines the balance bucket", () => {
  clearStore();
  createVault("1", MAKER, WETH, USDC);
  handleShipped(shipped());
  handlePushed(pushed(WETH, OPEN_USDC, 2));
  handlePushed(pushed(USDC, OPEN_WETH, 3));
  handlePulled(pulled(USDC, "5000000000000000", 6));
  handlePushed(pushed(WETH, "10000000", 7));
  handleSavingsPositionUpdated(positionEvent());
  balances("110000000", "995000000000000000");
});

test("ignores foreign makers and wrong Aqua or SwapVM emitters", () => {
  handlePushed(pushed(USDC, "1", 1, HASH, OTHER_MAKER));
  const wrongAqua = pushed(USDC, "1", 2);
  wrongAqua.address = APP;
  handlePushed(wrongAqua);
  const wrongApp = swapped(3);
  wrongApp.address = MAKER;
  handleSwapped(wrongApp);
  assert.entityCount("AquaExecution", 0);
  assert.entityCount("PendingStrategyExecutions", 0);
});

test(
  "rejects a pull larger than the indexed balance",
  () => {
    ship();
    handleSavingsPositionUpdated(positionEvent());
    handlePulled(pulled(USDC, "100000001", 6));
  },
  true,
);

test(
  "rejects an unexpected token instead of corrupting a balance bucket",
  () => {
    ship();
    handleSavingsPositionUpdated(positionEvent());
    handlePushed(
      pushed(
        Address.fromString("0x0000000000000000000000000000000000000099"),
        "1",
        6,
      ),
    );
  },
  true,
);

test("keeps activity cursors distinct for events sharing a block timestamp", () => {
  ship();
  swap();
  handleSavingsPositionUpdated(positionEvent());
  const sequence = BigInt.fromI32(100)
    .times(BigInt.fromString("4294967296"))
    .plus(BigInt.fromI32(8));
  assert.fieldEquals(
    "AquaExecution",
    eventId(swapped(8)).toHexString(),
    "sequence",
    sequence.toString(),
  );
});
