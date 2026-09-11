import { DataSourceContext } from "@graphprotocol/graph-ts";
import {
  FamilyVaultCreated,
  StarFamilyVaultFactory,
} from "../generated/StarFamilyVaultFactory/StarFamilyVaultFactory";
import { StarFamilyVaultTemplate } from "../generated/templates";
import { FamilyVault } from "../generated/schema";
import { requireFamily } from "./helpers";

export function handleFamilyVaultCreated(event: FamilyVaultCreated): void {
  const familyId = event.params.familyId.toString();
  const family = requireFamily(familyId);
  assert(
    family.parent.equals(event.params.parent),
    "Vault parent must match the family parent",
  );
  assert(
    FamilyVault.load(event.params.vault) === null,
    "A family vault must only be registered once",
  );
  assert(family.vault === null, "A family must only have one vault");

  const factory = StarFamilyVaultFactory.bind(event.address);
  assert(
    factory.emergencyAdmin().equals(event.params.emergencyAdmin),
    "Vault emergency administrator must match the factory",
  );
  const vault = new FamilyVault(event.params.vault);
  vault.family = familyId;
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

  const context = new DataSourceContext();
  context.setString("familyId", familyId);
  StarFamilyVaultTemplate.createWithContext(event.params.vault, context);
}
