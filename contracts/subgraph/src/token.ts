import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Transfer } from "../generated/StarToken/StarToken";
import { Child, ChildWallet, StarBalance } from "../generated/schema";

const ZERO_ADDRESS = Address.fromString(
  "0x0000000000000000000000000000000000000000",
);

export function handleTransfer(event: Transfer): void {
  if (event.params.from.equals(ZERO_ADDRESS)) {
    const balance = loadBalance(event.params.to, event.block.timestamp);
    balance.balance = balance.balance.plus(event.params.value);
    balance.totalIssued = balance.totalIssued.plus(event.params.value);
    balance.save();
    syncChild(event.params.to, balance, event.block.timestamp);
    return;
  }
  if (event.params.to.equals(ZERO_ADDRESS)) {
    const balance = loadBalance(event.params.from, event.block.timestamp);
    assert(
      balance.balance.ge(event.params.value),
      "STAR burn cannot exceed indexed balance",
    );
    balance.balance = balance.balance.minus(event.params.value);
    balance.totalBurned = balance.totalBurned.plus(event.params.value);
    balance.save();
    syncChild(event.params.from, balance, event.block.timestamp);
    return;
  }
  assert(false, "STAR is non-transferable");
}

function loadBalance(wallet: Address, timestamp: BigInt): StarBalance {
  let balance = StarBalance.load(wallet);
  if (balance === null) {
    balance = new StarBalance(wallet);
    balance.balance = BigInt.zero();
    balance.totalIssued = BigInt.zero();
    balance.totalBurned = BigInt.zero();
  }
  balance.updatedAt = timestamp;
  return balance;
}

function syncChild(
  walletAddress: Address,
  balance: StarBalance,
  timestamp: BigInt,
): void {
  const wallet = ChildWallet.load(walletAddress);
  if (wallet === null) return;
  const child = Child.load(wallet.child);
  assert(
    child !== null,
    "A child wallet index must reference an existing child",
  );
  child!.starBalance = balance.balance;
  child!.totalStarsIssued = balance.totalIssued;
  child!.totalStarsBurned = balance.totalBurned;
  child!.updatedAt = timestamp;
  child!.save();
}
