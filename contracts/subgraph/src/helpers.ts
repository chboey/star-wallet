import {
  Address,
  BigInt,
  Bytes,
  ethereum,
  store,
} from "@graphprotocol/graph-ts";
import {
  AquaExecution,
  Child,
  Family,
  FamilyVault,
  PendingStrategyExecutions,
  ProtocolActivity,
  SavingsAccount,
  SavingsPosition,
  StrategyPosition,
} from "../generated/schema";

export function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

export function eventSequence(event: ethereum.Event): BigInt {
  return event.block.number
    .times(BigInt.fromString("4294967296"))
    .plus(event.logIndex);
}

export function strategyKey(maker: Address, strategyHash: Bytes): Bytes {
  return maker.concat(strategyHash);
}

export function requireFamily(id: string): Family {
  const family = Family.load(id);
  assert(family !== null, "Family must exist before dependent events");
  return family!;
}

export function requireChild(id: string): Child {
  const child = Child.load(id);
  assert(child !== null, "Child must exist before dependent events");
  return child!;
}

export function requireVault(address: Address): FamilyVault {
  const vault = FamilyVault.load(address);
  assert(
    vault !== null,
    "Vault must be registered by the factory before its events",
  );
  return vault!;
}

export function loadSavings(
  familyId: string,
  event: ethereum.Event,
): SavingsAccount {
  let account = SavingsAccount.load(familyId);
  if (account === null) {
    account = new SavingsAccount(familyId);
    account.family = familyId;
    account.totalPrincipalContributed = BigInt.zero();
    account.totalPrincipalWithdrawn = BigInt.zero();
    account.netPrincipal = BigInt.zero();
    account.totalUsdcWithdrawn = BigInt.zero();
    account.totalWethWithdrawn = BigInt.zero();
    account.availableUsdc = BigInt.zero();
    account.availableWeth = BigInt.zero();
  }
  account.updatedAt = event.block.timestamp;
  return account;
}

export function activity(
  event: ethereum.Event,
  type: string,
  familyId: string | null,
): ProtocolActivity {
  const item = new ProtocolActivity(eventId(event));
  item.type = type;
  item.family = familyId;
  item.transactionHash = event.transaction.hash;
  item.logIndex = event.logIndex;
  item.sequence = eventSequence(event);
  item.blockNumber = event.block.number;
  item.timestamp = event.block.timestamp;
  return item;
}

export function positionForStrategy(
  maker: Address,
  strategyHash: Bytes,
): SavingsPosition | null {
  const index = StrategyPosition.load(strategyKey(maker, strategyHash));
  return index === null ? null : SavingsPosition.load(index.position);
}

export function linkPendingExecutions(
  maker: Address,
  strategyHash: Bytes,
  positionId: string,
  familyId: string,
  openingSequence: BigInt,
): void {
  const key = strategyKey(maker, strategyHash);
  const pending = PendingStrategyExecutions.load(key);
  if (pending === null) return;
  const position = SavingsPosition.load(positionId);
  assert(position !== null, "Position must exist before replaying executions");
  const ids = pending.executionIds;
  for (let index = 0; index < ids.length; index += 1) {
    const execution = AquaExecution.load(ids[index]);
    if (execution !== null) {
      execution.position = positionId;
      execution.family = familyId;
      execution.save();
      // ship() emits the initial Pushed logs BEFORE SavingsPositionUpdated.
      // Those amounts are already in the opening snapshot. A newly created
      // template can also have later swaps queued from the same block; replay
      // only their balance deltas, in the original log order.
      if (execution.sequence.gt(openingSequence)) {
        applyPositionBalanceChange(position!, execution);
      }
    }
  }
  position!.save();
  store.remove("PendingStrategyExecutions", key.toHexString());
}

export function applyPositionBalanceChange(
  position: SavingsPosition,
  execution: AquaExecution,
): void {
  if (execution.type != "PUSHED" && execution.type != "PULLED") return;
  assert(
    position.status == "ACTIVE",
    "Balance change requires an active position",
  );
  assert(
    position.maker.equals(execution.maker) &&
      position.strategyHash.equals(execution.strategyHash),
    "Balance change must match the maker and strategy",
  );
  const vault = requireVault(Address.fromBytes(position.maker));
  const token = execution.token;
  const amount = execution.amount;
  assert(
    token !== null && amount !== null,
    "Balance change requires token and amount",
  );
  const isUsdc = token!.equals(vault.usdc);
  assert(isUsdc || token!.equals(vault.weth), "Unexpected position token");
  const current = isUsdc
    ? position.currentUsdcAmount
    : position.currentWethAmount;
  const pushed = execution.type == "PUSHED";
  assert(
    pushed || current.ge(amount!),
    "Aqua pull cannot exceed indexed balance",
  );
  const updated = pushed ? current.plus(amount!) : current.minus(amount!);
  if (isUsdc) {
    position.currentUsdcAmount = updated;
  } else {
    position.currentWethAmount = updated;
  }
  position.updatedAt = execution.timestamp;
}
