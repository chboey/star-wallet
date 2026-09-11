import {
  ChildRegistrationAccepted,
  ChildRegistrationCancelled,
  ChildRegistrationProposed,
  ChildRegistered,
  ChildStatusUpdated,
  FamilyCreated,
  FamilyStatusUpdated,
} from "../generated/StarRegistry/StarRegistry";
import { BigInt, store } from "@graphprotocol/graph-ts";
import {
  Child,
  ChildRegistration,
  ChildWallet,
  Family,
  PendingChildRegistration,
  StarBalance,
} from "../generated/schema";
import {
  activity,
  eventId,
  loadSavings,
  requireChild,
  requireFamily,
} from "./helpers";

export function handleFamilyCreated(event: FamilyCreated): void {
  const familyId = event.params.familyId.toString();
  const family = new Family(familyId);
  family.parent = event.params.parent;
  family.ensNode = event.params.ensNode;
  family.ensName = event.params.ensName;
  family.active = true;
  family.childCount = 0;
  family.createdAt = event.block.timestamp;
  family.updatedAt = event.block.timestamp;
  const savings = loadSavings(familyId, event);
  savings.save();
  family.savings = familyId;
  family.save();
  const item = activity(event, "FAMILY_CREATED", familyId);
  item.save();
}

export function handleChildRegistered(event: ChildRegistered): void {
  const familyId = event.params.familyId.toString();
  const childId = event.params.childId.toString();
  const family = requireFamily(familyId);

  const child = new Child(childId);
  child.family = familyId;
  child.wallet = event.params.wallet;
  child.ensNode = event.params.ensNode;
  child.ensName = event.params.ensName;
  child.active = true;
  const tokenBalance = StarBalance.load(event.params.wallet);
  child.starBalance =
    tokenBalance === null ? BigInt.zero() : tokenBalance.balance;
  child.reservedStars = BigInt.zero();
  child.totalStarsIssued =
    tokenBalance === null ? BigInt.zero() : tokenBalance.totalIssued;
  child.totalStarsBurned =
    tokenBalance === null ? BigInt.zero() : tokenBalance.totalBurned;
  child.totalPrincipalContributed = BigInt.zero();
  child.createdAt = event.block.timestamp;
  child.updatedAt = event.block.timestamp;
  child.save();

  const wallet = new ChildWallet(event.params.wallet);
  wallet.child = childId;
  wallet.save();

  family.childCount += 1;
  family.updatedAt = event.block.timestamp;
  family.save();

  const item = activity(event, "CHILD_REGISTERED", familyId);
  item.child = childId;
  item.save();
}

export function handleChildRegistrationProposed(
  event: ChildRegistrationProposed,
): void {
  const familyId = event.params.familyId.toString();
  requireFamily(familyId);

  assert(
    PendingChildRegistration.load(event.params.registrationId) === null,
    "A registration ID can only have one pending attempt",
  );
  const registration = new ChildRegistration(eventId(event));
  registration.registrationId = event.params.registrationId;
  registration.family = familyId;
  registration.childWallet = event.params.childWallet;
  registration.ensNode = event.params.ensNode;
  registration.ensName = event.params.ensName;
  registration.status = "PENDING";
  registration.proposedAt = event.block.timestamp;
  registration.updatedAt = event.block.timestamp;
  registration.proposalTransactionHash = event.transaction.hash;
  registration.save();

  const pending = new PendingChildRegistration(event.params.registrationId);
  pending.registration = registration.id;
  pending.save();

  const item = activity(event, "CHILD_REGISTRATION_PROPOSED", familyId);
  item.registration = registration.id;
  item.save();
}

export function handleChildRegistrationCancelled(
  event: ChildRegistrationCancelled,
): void {
  const pending = PendingChildRegistration.load(event.params.registrationId);
  assert(pending !== null, "Cancelled registration must be pending");
  const registration = ChildRegistration.load(pending!.registration);
  assert(registration !== null, "Cancelled registration must exist");
  assert(
    registration!.family == event.params.familyId.toString(),
    "Cancelled registration family must match",
  );
  assert(
    registration!.childWallet.equals(event.params.childWallet),
    "Cancelled registration wallet must match",
  );
  assert(
    registration!.status == "PENDING",
    "Only a pending registration can be cancelled",
  );
  registration!.status = "CANCELLED";
  registration!.resolvedAt = event.block.timestamp;
  registration!.resolvedBy = event.params.cancelledBy;
  registration!.updatedAt = event.block.timestamp;
  registration!.resolutionTransactionHash = event.transaction.hash;
  registration!.save();
  store.remove(
    "PendingChildRegistration",
    event.params.registrationId.toHexString(),
  );

  const item = activity(
    event,
    "CHILD_REGISTRATION_CANCELLED",
    registration!.family,
  );
  item.registration = registration!.id;
  item.save();
}

export function handleChildRegistrationAccepted(
  event: ChildRegistrationAccepted,
): void {
  const pending = PendingChildRegistration.load(event.params.registrationId);
  assert(pending !== null, "Accepted registration must be pending");
  const registration = ChildRegistration.load(pending!.registration);
  assert(registration !== null, "Accepted registration must exist");
  const childId = event.params.childId.toString();
  const child = requireChild(childId);
  assert(
    registration!.family == event.params.familyId.toString() &&
      child.family == registration!.family,
    "Accepted registration family must match",
  );
  assert(
    registration!.childWallet.equals(event.params.childWallet) &&
      child.wallet.equals(event.params.childWallet),
    "Accepted registration wallet must match",
  );
  assert(
    registration!.status == "PENDING",
    "Only a pending registration can be accepted",
  );
  registration!.child = childId;
  registration!.status = "ACCEPTED";
  registration!.resolvedAt = event.block.timestamp;
  registration!.resolvedBy = registration!.childWallet;
  registration!.updatedAt = event.block.timestamp;
  registration!.resolutionTransactionHash = event.transaction.hash;
  registration!.save();
  store.remove(
    "PendingChildRegistration",
    event.params.registrationId.toHexString(),
  );

  const item = activity(
    event,
    "CHILD_REGISTRATION_ACCEPTED",
    registration!.family,
  );
  item.child = childId;
  item.registration = registration!.id;
  item.save();
}

export function handleFamilyStatusUpdated(event: FamilyStatusUpdated): void {
  const familyId = event.params.familyId.toString();
  const family = requireFamily(familyId);
  assert(
    family.parent.equals(event.params.parent),
    "Family status parent must match",
  );
  family.active = event.params.active;
  family.updatedAt = event.block.timestamp;
  family.save();

  const item = activity(event, "FAMILY_STATUS_UPDATED", familyId);
  item.active = event.params.active;
  item.save();
}

export function handleChildStatusUpdated(event: ChildStatusUpdated): void {
  const childId = event.params.childId.toString();
  const child = Child.load(childId);
  assert(child !== null, "Updated child must exist");
  assert(
    child!.family == event.params.familyId.toString(),
    "Child status family must match",
  );
  child!.active = event.params.active;
  child!.updatedAt = event.block.timestamp;
  child!.save();

  const family = requireFamily(child!.family);
  family.updatedAt = event.block.timestamp;
  family.save();

  const item = activity(event, "CHILD_STATUS_UPDATED", child!.family);
  item.child = childId;
  item.active = event.params.active;
  item.save();
}
