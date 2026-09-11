import { BigInt, dataSource, ethereum } from "@graphprotocol/graph-ts";
import {
  AquaPauseUpdated,
  PrincipalContributed,
  SavingsPositionUpdated,
  SavingsPositionToppedUp,
  SavingsStrategyConfigured,
  SavingsUsdcWithdrawn,
  StarsRewarded,
  StrategyWethFunded,
  StrategyWethWithdrawn,
} from "../generated/templates/StarFamilyVaultTemplate/StarFamilyVault";
import {
  FamilyVault,
  ProtocolState,
  Reward,
  SavingsContribution,
  SavingsPosition,
  SavingsWithdrawal,
  StrategyPosition,
} from "../generated/schema";
import {
  activity,
  eventId,
  eventSequence,
  linkPendingExecutions,
  loadSavings,
  requireChild,
  requireFamily,
  requireVault,
  strategyKey,
} from "./helpers";

export function handleStarsRewarded(event: StarsRewarded): void {
  const vault = vaultForEvent(event);
  const rewardId =
    event.address.toHexString() + "-" + event.params.rewardId.toString();
  const childId = event.params.childId.toString();
  const child = requireChild(childId);
  assert(
    child.family == vault.family,
    "Reward child must belong to the vault family",
  );
  assert(
    event.params.principalUsdc.equals(
      event.params.stars.times(BigInt.fromI32(1_000_000)),
    ),
    "Reward principal must equal one USDC per STAR",
  );

  const reward = new Reward(rewardId);
  reward.family = child.family;
  reward.child = childId;
  reward.stars = event.params.stars;
  reward.principalUsdc = event.params.principalUsdc;
  reward.reason = event.params.reason;
  reward.transactionHash = event.transaction.hash;
  reward.blockNumber = event.block.number;
  reward.timestamp = event.block.timestamp;
  reward.save();

  const item = activity(event, "STARS_REWARDED", child.family);
  item.child = childId;
  item.amount = event.params.stars;
  item.save();
}

export function handleAquaPauseUpdated(event: AquaPauseUpdated): void {
  const vault = vaultForEvent(event);
  const state = ProtocolState.load("protocol");
  assert(state !== null, "Protocol state must exist before vault pause events");

  const changed = vault.aquaPaused != event.params.paused;
  vault.aquaPaused = event.params.paused;
  vault.emergencyAdmin = event.params.emergencyAdmin;
  vault.updatedAt = event.block.timestamp;
  vault.updatedTransactionHash = event.transaction.hash;
  vault.save();

  if (!changed) return;
  if (event.params.paused) {
    state!.pausedVaultCount += 1;
  } else {
    assert(
      state!.pausedVaultCount > 0,
      "Paused vault count must remain non-negative",
    );
    state!.pausedVaultCount -= 1;
  }
  state!.hasPausedVaults = state!.pausedVaultCount > 0;
  state!.emergencyAdmin = event.params.emergencyAdmin;
  state!.updatedAt = event.block.timestamp;
  state!.updatedTransactionHash = event.transaction.hash;
  state!.save();

  const item = activity(
    event,
    event.params.paused ? "AQUA_PAUSED" : "AQUA_RESUMED",
    vault.family,
  );
  item.save();
}

export function handlePrincipalContributed(event: PrincipalContributed): void {
  const familyId = vaultForEvent(event).family;
  assert(
    event.params.familyId.toString() == familyId,
    "Contribution family must match the vault",
  );
  const childId = event.params.childId.toString();
  requireFamily(familyId);
  const child = requireChild(childId);
  assert(
    child.family == familyId,
    "Contribution child must belong to the vault family",
  );
  const account = loadSavings(familyId, event);
  account.totalPrincipalContributed = account.totalPrincipalContributed.plus(
    event.params.amount,
  );
  account.netPrincipal = account.netPrincipal.plus(event.params.amount);
  account.availableUsdc = account.availableUsdc.plus(event.params.amount);
  account.save();

  child.totalPrincipalContributed = child.totalPrincipalContributed.plus(
    event.params.amount,
  );
  child.updatedAt = event.block.timestamp;
  child.save();

  const contribution = new SavingsContribution(eventId(event));
  contribution.account = familyId;
  contribution.family = familyId;
  contribution.child = childId;
  contribution.amount = event.params.amount;
  contribution.transactionHash = event.transaction.hash;
  contribution.blockNumber = event.block.number;
  contribution.timestamp = event.block.timestamp;
  contribution.save();

  const item = activity(event, "PRINCIPAL_CONTRIBUTED", familyId);
  item.child = childId;
  item.amount = event.params.amount;
  item.save();
}

export function handleSavingsUsdcWithdrawn(event: SavingsUsdcWithdrawn): void {
  const familyId = vaultForEvent(event).family;
  assert(
    event.params.familyId.toString() == familyId,
    "Withdrawal family must match the vault",
  );
  const account = loadSavings(familyId, event);
  account.totalPrincipalWithdrawn = account.totalPrincipalWithdrawn.plus(
    event.params.principalAmount,
  );
  account.netPrincipal = account.netPrincipal.minus(
    event.params.principalAmount,
  );
  account.totalUsdcWithdrawn = account.totalUsdcWithdrawn.plus(
    event.params.amount,
  );
  account.availableUsdc = account.availableUsdc.minus(event.params.amount);
  account.save();

  const withdrawal = new SavingsWithdrawal(eventId(event));
  withdrawal.account = familyId;
  withdrawal.family = familyId;
  withdrawal.asset = "USDC";
  withdrawal.amount = event.params.amount;
  withdrawal.principalAmount = event.params.principalAmount;
  withdrawal.recipient = event.params.recipient;
  withdrawal.transactionHash = event.transaction.hash;
  withdrawal.blockNumber = event.block.number;
  withdrawal.timestamp = event.block.timestamp;
  withdrawal.save();

  const item = activity(event, "SAVINGS_USDC_WITHDRAWN", familyId);
  item.amount = event.params.amount;
  item.save();
}

export function handleStrategyWethFunded(event: StrategyWethFunded): void {
  const familyId = vaultForEvent(event).family;
  assert(
    event.params.familyId.toString() == familyId,
    "WETH funding family must match the vault",
  );
  const account = loadSavings(familyId, event);
  account.availableWeth = account.availableWeth.plus(event.params.amount);
  account.save();

  const item = activity(event, "STRATEGY_WETH_FUNDED", familyId);
  item.amount = event.params.amount;
  item.save();
}

export function handleStrategyWethWithdrawn(
  event: StrategyWethWithdrawn,
): void {
  const familyId = vaultForEvent(event).family;
  assert(
    event.params.familyId.toString() == familyId,
    "WETH withdrawal family must match the vault",
  );
  const account = loadSavings(familyId, event);
  account.totalWethWithdrawn = account.totalWethWithdrawn.plus(
    event.params.amount,
  );
  account.availableWeth = account.availableWeth.minus(event.params.amount);
  account.save();

  const withdrawal = new SavingsWithdrawal(eventId(event));
  withdrawal.account = familyId;
  withdrawal.family = familyId;
  withdrawal.asset = "WETH";
  withdrawal.amount = event.params.amount;
  withdrawal.principalAmount = BigInt.zero();
  withdrawal.recipient = event.params.recipient;
  withdrawal.transactionHash = event.transaction.hash;
  withdrawal.blockNumber = event.block.number;
  withdrawal.timestamp = event.block.timestamp;
  withdrawal.save();

  const item = activity(event, "STRATEGY_WETH_WITHDRAWN", familyId);
  item.amount = event.params.amount;
  item.save();
}

export function handleSavingsPositionUpdated(
  event: SavingsPositionUpdated,
): void {
  const familyId = vaultForEvent(event).family;
  assert(
    event.params.familyId.toString() == familyId,
    "Position family must match the vault",
  );
  const strategyHash = event.params.strategyHash;
  const positionId = familyId + "-" + strategyHash.toHexString();
  const account = loadSavings(familyId, event);
  let position = SavingsPosition.load(positionId);

  if (event.params.active) {
    assert(position === null, "A strategy hash must only open one position");
    assert(
      account.activePosition === null,
      "A savings account can only have one active position",
    );
    position = new SavingsPosition(positionId);
    position.account = familyId;
    position.family = familyId;
    position.strategyHash = strategyHash;
    position.maker = event.address;
    position.sqrtPriceMin = BigInt.zero();
    position.sqrtPriceMax = BigInt.zero();
    position.feeBps = BigInt.zero();
    position.salt = BigInt.zero();
    position.deadline = BigInt.zero();
    position.oracleRawPrice = BigInt.zero();
    position.openedAt = event.block.timestamp;
    position.openingUsdcAmount = event.params.usdcAmount;
    position.openingWethAmount = event.params.wethAmount;
    position.currentUsdcAmount = event.params.usdcAmount;
    position.currentWethAmount = event.params.wethAmount;
    position.status = "ACTIVE";
    position.updatedAt = event.block.timestamp;
    position.save();

    assert(
      StrategyPosition.load(strategyKey(event.address, strategyHash)) === null,
      "A maker and strategy hash must only map to one position",
    );
    const index = new StrategyPosition(
      strategyKey(event.address, strategyHash),
    );
    index.position = positionId;
    index.save();
    linkPendingExecutions(
      event.address,
      strategyHash,
      positionId,
      familyId,
      eventSequence(event),
    );
    assert(
      account.availableUsdc.ge(event.params.usdcAmount) &&
        account.availableWeth.ge(event.params.wethAmount),
      "Position opening balances must be available",
    );
    account.availableUsdc = account.availableUsdc.minus(
      event.params.usdcAmount,
    );
    account.availableWeth = account.availableWeth.minus(
      event.params.wethAmount,
    );
    account.activePosition = positionId;
  } else {
    assert(position !== null, "A docked position must already exist");
    assert(
      position!.status == "ACTIVE",
      "Only an active position can be docked",
    );
    assert(
      account.activePosition == positionId,
      "Docked position must match the account",
    );
    position!.currentUsdcAmount = event.params.usdcAmount;
    position!.currentWethAmount = event.params.wethAmount;
    position!.closingUsdcAmount = event.params.usdcAmount;
    position!.closingWethAmount = event.params.wethAmount;
    position!.status = "DOCKED";
    position!.closedAt = event.block.timestamp;
    position!.updatedAt = event.block.timestamp;
    position!.save();
    account.availableUsdc = account.availableUsdc.plus(event.params.usdcAmount);
    account.availableWeth = account.availableWeth.plus(event.params.wethAmount);
    account.activePosition = null;
  }
  account.save();

  const item = activity(
    event,
    event.params.active ? "SAVINGS_POSITION_ACTIVE" : "SAVINGS_POSITION_DOCKED",
    familyId,
  );
  item.amount = event.params.usdcAmount;
  item.save();
}

export function handleSavingsPositionToppedUp(
  event: SavingsPositionToppedUp,
): void {
  const vault = vaultForEvent(event);
  const familyId = vault.family;
  assert(
    event.params.familyId.toString() == familyId,
    "Top-up family must match the vault",
  );
  const account = loadSavings(familyId, event);
  const positionId = familyId + "-" + event.params.strategyHash.toHexString();
  const position = SavingsPosition.load(positionId);
  assert(position !== null, "Top-up position must exist");
  assert(
    position!.status == "ACTIVE" && account.activePosition == positionId,
    "Top-up must target the active position",
  );
  assert(
    position!.maker.equals(event.address),
    "Top-up maker must match the vault",
  );
  assert(
    event.params.usdcAmount.gt(BigInt.zero()) ||
      event.params.wethAmount.gt(BigInt.zero()),
    "Top-up must be nonzero",
  );
  assert(
    account.availableUsdc.ge(event.params.usdcAmount) &&
      account.availableWeth.ge(event.params.wethAmount),
    "Top-up funds must be available",
  );
  account.availableUsdc = account.availableUsdc.minus(event.params.usdcAmount);
  account.availableWeth = account.availableWeth.minus(event.params.wethAmount);
  account.save();
  // Aqua Pushed logs (including queued same-block logs) already credit current holdings.
  // Never modify current/opening amounts, principal or the active position here.
  position!.updatedAt = event.block.timestamp;
  position!.save();
  vault.updatedAt = event.block.timestamp;
  vault.updatedTransactionHash = event.transaction.hash;
  vault.save();
  const item = activity(event, "SAVINGS_POSITION_TOPPED_UP", familyId);
  item.amount = event.params.usdcAmount;
  item.save();
}

export function handleSavingsStrategyConfigured(
  event: SavingsStrategyConfigured,
): void {
  const familyId = vaultForEvent(event).family;
  assert(
    event.params.familyId.toString() == familyId,
    "Strategy family must match the vault",
  );
  const positionId = familyId + "-" + event.params.strategyHash.toHexString();
  const position = SavingsPosition.load(positionId);
  assert(position !== null, "Position must exist before its strategy metadata");
  assert(
    position!.status == "ACTIVE",
    "Strategy metadata requires an active position",
  );
  assert(
    event.params.sqrtPriceMin.gt(BigInt.zero()) &&
      event.params.sqrtPriceMax.gt(event.params.sqrtPriceMin) &&
      event.params.salt.gt(BigInt.zero()) &&
      event.params.deadline.gt(event.block.timestamp) &&
      event.params.oracleRawPrice.gt(BigInt.zero()),
    "Strategy metadata must contain valid bounds, salt, deadline, and oracle price",
  );
  position!.sqrtPriceMin = event.params.sqrtPriceMin;
  position!.sqrtPriceMax = event.params.sqrtPriceMax;
  position!.feeBps = BigInt.fromI32(event.params.feeBps);
  position!.salt = event.params.salt;
  position!.deadline = event.params.deadline;
  position!.oracleRawPrice = event.params.oracleRawPrice;
  position!.updatedAt = event.block.timestamp;
  position!.save();
}

function vaultForEvent(event: ethereum.Event): FamilyVault {
  const vault = requireVault(event.address);
  assert(
    vault.family == dataSource.context().getString("familyId"),
    "Vault data source family context must match the factory registry",
  );
  return vault;
}
