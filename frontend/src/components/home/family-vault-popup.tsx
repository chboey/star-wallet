"use client";

import { VaultActivitySheet } from "./vault-activity-sheet";
import { WethFundingSheet } from "./weth-funding-sheet";

export type FamilyVaultPopupView = "activity" | "funding";

export function FamilyVaultPopup({
  view,
  onClose,
}: {
  view: FamilyVaultPopupView | null;
  onClose: () => void;
}) {
  if (view === "funding") return <WethFundingSheet onClose={onClose} />;
  if (view === "activity") return <VaultActivitySheet onClose={onClose} />;
  return null;
}
