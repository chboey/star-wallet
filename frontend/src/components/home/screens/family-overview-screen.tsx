"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  displayEnsName,
  formatTokenAmount,
  formatUsd18,
} from "@/lib/star-format";
import { HomeIllustration, SectionEmptyState, SectionTitle } from "../home-ui";
import { useOnchainDetailsSheet } from "../home-app-shell";
import { FamilyVaultCard } from "../family-vault-card";
import {
  FamilyVaultPopup,
  type FamilyVaultPopupView,
} from "../family-vault-popup";
import { useStarData } from "../star-data-provider";

export function FamilyOverviewScreen() {
  const { family, familyName, portfolio } = useStarData();
  const savings = family?.savings;
  const [vaultPopup, setVaultPopup] = useState<FamilyVaultPopupView | null>(
    null,
  );
  const openOnchainDetails = useOnchainDetailsSheet();

  return (
    <div className="wallet-screen family-overview-screen">
      <header className="family-overview-header">
        <HomeIllustration name="home" alt="Family home" size={78} />
        <div>
          <span>Family overview</span>
          <h1>{familyName}</h1>
          <strong>
            {formatUsd18(portfolio?.currentPortfolioValue.amount)} total
          </strong>
        </div>
      </header>

      <SectionTitle>Vault balances</SectionTitle>
      {family?.vault ? (
        <>
          <FamilyVaultCard
            familyName={familyName}
            usdc={formatTokenAmount(savings?.availableUsdc, 6, 2)}
            weth={formatTokenAmount(savings?.availableWeth, 18, 6)}
            fundingDisabled={!family.active}
            onOpenActivity={() => setVaultPopup("activity")}
            onAddWeth={() => setVaultPopup("funding")}
          />
          <button
            className="family-onchain-button"
            type="button"
            onClick={openOnchainDetails}
          >
            On-chain details <ChevronRight size={15} aria-hidden="true" />
          </button>
        </>
      ) : (
        <SectionEmptyState />
      )}

      <SectionTitle>Children</SectionTitle>
      <div className="children-savings-list">
        {(family?.children ?? []).map((child) => (
          <article className="child-savings-card" key={child.id}>
            <HomeIllustration name="girl_star" alt="" size={58} />
            <div>
              <strong>{displayEnsName(child.ensName, "Child")}</strong>
              <span>Principal contributed</span>
            </div>
            <strong>
              {formatTokenAmount(child.totalPrincipalContributed, 6, 2)} USDC
            </strong>
          </article>
        ))}
        {!family?.children.length && <SectionEmptyState />}
      </div>

      <SectionTitle>Savings position</SectionTitle>
      {savings?.activePosition ? (
        <section className="family-position-card">
          <span className="family-position-assets" aria-hidden="true">
            <HomeIllustration name="usdc" alt="" size={38} />
            <HomeIllustration name="weth" alt="" size={38} />
          </span>
          <div>
            <strong>Star savings</strong>
            <span>USDC / WETH · Aqua</span>
          </div>
          <small>Active</small>
        </section>
      ) : (
        <SectionEmptyState />
      )}
      <FamilyVaultPopup
        key={`family-vault-${family?.vault?.id ?? "none"}`}
        view={vaultPopup}
        onClose={() => setVaultPopup(null)}
      />
    </div>
  );
}
