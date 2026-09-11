import { Address, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Docked, Pulled, Pushed, Shipped } from "../generated/Aqua/Aqua";
import { Swapped } from "../generated/AquaSwapVM/AquaSwapVM";
import {
  AquaExecution,
  FamilyVault,
  PendingStrategyExecutions,
} from "../generated/schema";
import {
  applyPositionBalanceChange,
  eventId,
  eventSequence,
  positionForStrategy,
  strategyKey,
} from "./helpers";

export function handleShipped(event: Shipped): void {
  if (!isStarAquaExecution(event.params.maker, event.address, event.params.app))
    return;
  newExecution(
    event,
    event.params.strategyHash,
    "SHIPPED",
    event.params.maker,
    event.params.app,
  ).save();
}

export function handlePushed(event: Pushed): void {
  if (!isStarAquaExecution(event.params.maker, event.address, event.params.app))
    return;
  const execution = newExecution(
    event,
    event.params.strategyHash,
    "PUSHED",
    event.params.maker,
    event.params.app,
  );
  execution.token = event.params.token;
  execution.amount = event.params.amount;
  execution.save();
  updatePositionBalance(execution);
}

export function handlePulled(event: Pulled): void {
  if (!isStarAquaExecution(event.params.maker, event.address, event.params.app))
    return;
  const execution = newExecution(
    event,
    event.params.strategyHash,
    "PULLED",
    event.params.maker,
    event.params.app,
  );
  execution.token = event.params.token;
  execution.amount = event.params.amount;
  execution.save();
  updatePositionBalance(execution);
}

export function handleDocked(event: Docked): void {
  if (!isStarAquaExecution(event.params.maker, event.address, event.params.app))
    return;
  newExecution(
    event,
    event.params.strategyHash,
    "DOCKED",
    event.params.maker,
    event.params.app,
  ).save();
}

export function handleSwapped(event: Swapped): void {
  if (!isStarSwapExecution(event.params.maker, event.address)) return;
  const execution = newExecution(
    event,
    event.params.orderHash,
    "SWAPPED",
    event.params.maker,
    event.address,
  );
  execution.taker = event.params.taker;
  execution.tokenIn = event.params.tokenIn;
  execution.tokenOut = event.params.tokenOut;
  execution.amountIn = event.params.amountIn;
  execution.amountOut = event.params.amountOut;
  execution.save();
  // Pushed/Pulled already account for settlement. Swapped is history only.
}

function newExecution(
  event: ethereum.Event,
  strategyHash: Bytes,
  type: string,
  maker: Address,
  app: Address,
): AquaExecution {
  const execution = new AquaExecution(eventId(event));
  execution.strategyHash = strategyHash;
  execution.type = type;
  execution.maker = maker;
  execution.app = app;
  execution.transactionHash = event.transaction.hash;
  execution.logIndex = event.logIndex;
  execution.sequence = eventSequence(event);
  execution.blockNumber = event.block.number;
  execution.timestamp = event.block.timestamp;
  const position = positionForStrategy(maker, strategyHash);
  if (position !== null) {
    execution.position = position.id;
    execution.family = position.family;
  } else {
    const key = strategyKey(maker, strategyHash);
    let pending = PendingStrategyExecutions.load(key);
    if (pending === null) {
      pending = new PendingStrategyExecutions(key);
      pending.executionIds = [];
    }
    const ids = pending.executionIds;
    ids.push(execution.id);
    pending.executionIds = ids;
    pending.save();
  }
  return execution;
}

function isStarAquaExecution(
  maker: Address,
  aqua: Address,
  app: Address,
): bool {
  const vault = FamilyVault.load(maker);
  return vault !== null && vault.aqua.equals(aqua) && vault.swapVm.equals(app);
}

function isStarSwapExecution(maker: Address, app: Address): bool {
  const vault = FamilyVault.load(maker);
  return vault !== null && vault.swapVm.equals(app);
}

function updatePositionBalance(execution: AquaExecution): void {
  const position = positionForStrategy(
    Address.fromBytes(execution.maker),
    execution.strategyHash,
  );
  // newExecution queued this event; the vault's opening handler will replay it.
  if (position === null) return;
  applyPositionBalanceChange(position, execution);
  position.save();
}
