import { dataSource, ethereum } from "@graphprotocol/graph-ts";
import { AquaPauseUpdated } from "../generated/templates/StarFamilyVaultTemplate/StarFamilyVault";
import { FamilyVault } from "../generated/schema";
import { requireVault } from "./helpers";

export function handleAquaPauseUpdated(event: AquaPauseUpdated): void {
  const vault = vaultForEvent(event);
  vault.aquaPaused = event.params.paused;
  vault.emergencyAdmin = event.params.emergencyAdmin;
  vault.updatedAt = event.block.timestamp;
  vault.updatedTransactionHash = event.transaction.hash;
  vault.save();
}

function vaultForEvent(event: ethereum.Event): FamilyVault {
  const vault = requireVault(event.address);
  assert(
    vault.family == dataSource.context().getString("familyId"),
    "Vault data source family context must match the factory registry",
  );
  return vault;
}
