import { Address, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Child, Family, FamilyVault } from "../generated/schema";

export function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
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
