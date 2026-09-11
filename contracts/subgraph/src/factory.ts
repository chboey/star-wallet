import { DataSourceContext } from "@graphprotocol/graph-ts";
import {
  FamilyVaultCreated,
  StarFamilyVaultFactory,
} from "../generated/StarFamilyVaultFactory/StarFamilyVaultFactory";
import {
  StarFamilyVaultTemplate,
  StarQuestsTemplate,
} from "../generated/templates";
import { StarFamilyVault } from "../generated/StarFamilyVaultFactory/StarFamilyVault";
import { FamilyVault, ProtocolState } from "../generated/schema";
import { activity, loadSavings, requireFamily } from "./helpers";

export function handleFamilyVaultCreated(event: FamilyVaultCreated): void {
  const familyId = event.params.familyId.toString();
  const family = requireFamily(familyId);
  assert(
    family.parent.equals(event.params.parent),
    "Vault parent must match the family parent",
  );

  let vault = FamilyVault.load(event.params.vault);
  assert(vault === null, "A family vault must only be registered once");
  assert(family.vault === null, "A family must only have one vault");
  const factory = StarFamilyVaultFactory.bind(event.address);
  assert(
    factory.emergencyAdmin().equals(event.params.emergencyAdmin),
    "Vault emergency administrator must match the factory",
  );
  vault = new FamilyVault(event.params.vault);
  vault.family = familyId;
  const questsAddress = StarFamilyVault.bind(event.params.vault).quests();
  vault.questsAddress = questsAddress;
  vault.parent = event.params.parent;
  vault.emergencyAdmin = event.params.emergencyAdmin;
  vault.aqua = factory.aqua();
  vault.swapVm = factory.swapVmApp();
  vault.usdc = factory.usdc();
  vault.weth = factory.weth();
  vault.aquaPaused = false;
  vault.createdAt = event.block.timestamp;
  vault.updatedAt = event.block.timestamp;
  vault.creationTransactionHash = event.transaction.hash;
  vault.updatedTransactionHash = event.transaction.hash;
  vault.save();

  family.vault = event.params.vault;
  family.updatedAt = event.block.timestamp;
  family.save();

  const savings = loadSavings(familyId, event);
  savings.vault = event.params.vault;
  savings.save();

  let state = ProtocolState.load("protocol");
  if (state === null) {
    state = new ProtocolState("protocol");
    state.factory = event.address;
    state.vaultCount = 0;
    state.pausedVaultCount = 0;
    state.hasPausedVaults = false;
  } else {
    assert(
      state.factory.equals(event.address),
      "Protocol factory must not change",
    );
    assert(
      state.emergencyAdmin.equals(event.params.emergencyAdmin),
      "Protocol emergency administrator must not change",
    );
  }
  state.vaultCount += 1;
  state.emergencyAdmin = event.params.emergencyAdmin;
  state.updatedAt = event.block.timestamp;
  state.updatedTransactionHash = event.transaction.hash;
  state.save();

  const item = activity(event, "FAMILY_VAULT_CREATED", familyId);
  item.save();

  const context = new DataSourceContext();
  context.setString("familyId", familyId);
  context.setString("vault", event.params.vault.toHexString());
  StarFamilyVaultTemplate.createWithContext(event.params.vault, context);
  StarQuestsTemplate.createWithContext(questsAddress, context);
}
