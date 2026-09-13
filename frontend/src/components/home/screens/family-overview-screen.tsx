"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { displayEnsName, formatTokenAmount } from "@/lib/star-format";
import { useOnchainDetailsSheet } from "../home-app-shell";
import { HomeIllustration, SectionEmptyState, SectionTitle } from "../home-ui";
import { useStarData } from "../star-data-provider";
import { FamilyVaultCard } from "../family-vault-card";
import { ActionStatus } from "../action-status";
import { AquaPositionSetupSheet } from "../aqua-position-setup-sheet";
import { CreateAquaPositionCard } from "../create-aqua-position-card";
import { useAquaPosition } from "../use-aqua-position";
import {
  FamilyVaultPopup,
  type FamilyVaultPopupView,
} from "../family-vault-popup";

export function FamilyOverviewScreen() {
  const { family, familyName } = useStarData();
  const openOnchainDetails = useOnchainDetailsSheet();
  const position = useAquaPosition();
  const [setupOpen, setSetupOpen] = useState(false);
  const [vaultPopup, setVaultPopup] = useState<FamilyVaultPopupView | null>(
    null,
  );
  const usdcPosition = formatTokenAmount(position.data?.positionUsdc, 6, 2);
  const wethPosition = formatTokenAmount(position.data?.positionWeth, 18, 6);
  // The vault card shows unallocated funds, not vault + Aqua portfolio totals.
  // Use the same on-chain snapshot as the position card, including zero balances.
  const usdcAvailable = formatTokenAmount(position.data?.availableUsdc, 6, 2);
  const wethAvailable = formatTokenAmount(position.data?.availableWeth, 18, 6);

  return (
    <div className="wallet-screen family-overview-screen">
      {family?.vault ? (
        <FamilyVaultCard
          familyName={familyName}
          usdc={usdcAvailable}
          weth={wethAvailable}
          fundingDisabled={!family.active || !family.vault}
          onOpenActivity={() => setVaultPopup("activity")}
          onAddWeth={() => setVaultPopup("funding")}
        />
      ) : (
        <section>
          <SectionEmptyState />
        </section>
      )}

      <section>
        <SectionTitle>Savings position</SectionTitle>
        {family?.vault && position.isError ? (
          <ActionStatus
            state="error"
            message="Couldn’t check the Aqua position. Please refresh."
            onRefresh={() => void position.refetch()}
            refreshing={position.isFetching}
            refreshLabel="Refresh Aqua position"
          />
        ) : family?.vault && !position.data ? (
          <CreateAquaPositionCard
            checking
            onCreate={() => setSetupOpen(true)}
          />
        ) : family?.vault && position.data?.positionActive ? (
          <button
            className="savings-position-card"
            type="button"
            aria-label="View Star savings position on-chain details"
            onClick={openOnchainDetails}
          >
            <span className="position-card-top">
              <span className="position-token-stack" aria-hidden="true">
                <HomeIllustration name="usdc" alt="" size={36} />
                <HomeIllustration name="weth" alt="" size={36} />
              </span>
              <span className="position-card-copy">
                <strong>Star savings</strong>
                <small>USDC / WETH · Aqua</small>
              </span>
              <span className="position-card-rotator">
                <span
                  className="position-card-metric position-card-metric-invested"
                  aria-hidden="true"
                >
                  <small>In position</small>
                  <strong>
                    {usdcPosition} USDC · {wethPosition} WETH
                  </strong>
                </span>
                <span
                  className="position-card-metric position-card-metric-available"
                  aria-hidden="true"
                >
                  <small>Available in vault</small>
                  <strong>
                    {usdcAvailable} USDC · {wethAvailable} WETH
                  </strong>
                </span>
                <span className="sr-only">
                  In position: {usdcPosition} USDC and {wethPosition} WETH.
                  Available in vault: {usdcAvailable} USDC and {wethAvailable}{" "}
                  WETH.
                </span>
              </span>
            </span>
            <span className="position-card-action">
              On-chain details <ChevronRight size={15} />
            </span>
          </button>
        ) : (
          <CreateAquaPositionCard
            onCreate={() => setSetupOpen(true)}
            disabled={
              !family?.active ||
              !family.vault ||
              !position.data ||
              position.data.paused
            }
            checking={Boolean(family?.vault) && position.isFetching}
            note={
              !family?.vault
                ? "A family vault is needed first."
                : position.data?.paused
                  ? "Aqua is paused for this vault."
                  : undefined
            }
          />
        )}
      </section>

      <section>
        <SectionTitle>Children</SectionTitle>
        <div className="children-savings-list">
          {(family?.children ?? []).map((child) => (
            <div className="child-savings-card" key={child.id}>
              <HomeIllustration name="girl_star" alt="" size={58} />
              <div className="child-savings-copy">
                <strong>{displayEnsName(child.ensName, "Child")}</strong>
                <span>Principal contributed</span>
              </div>
              <div className="child-savings-principal">
                <strong>
                  {formatTokenAmount(child.totalPrincipalContributed, 6, 2)}{" "}
                  USDC
                </strong>
              </div>
            </div>
          ))}
          {!family?.children.length && <SectionEmptyState />}
        </div>
      </section>

      <FamilyVaultPopup
        key={`family-vault-${family?.vault?.id ?? "none"}`}
        view={vaultPopup}
        onClose={() => setVaultPopup(null)}
      />
      {setupOpen && (
        <AquaPositionSetupSheet
          key={`aqua-setup-${family?.vault?.id ?? "none"}`}
          onClose={() => setSetupOpen(false)}
          onDetails={openOnchainDetails}
        />
      )}
    </div>
  );
}
