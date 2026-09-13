"use client";

import { useState } from "react";
import {
  displayEnsName,
  formatTokenAmount,
  formatUsd18,
} from "@/lib/star-format";
import { HomeIllustration, SectionEmptyState, SectionTitle } from "../home-ui";
import { useStarData } from "../star-data-provider";
import { VaultActivitySheet } from "../vault-activity-sheet";

export function FamilyOverviewScreen() {
  const { family, familyName, portfolio } = useStarData();
  const savings = family?.savings;
  const [activityOpen, setActivityOpen] = useState(false);

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
        <section className="family-balance-grid">
          <article>
            <HomeIllustration name="usdc" alt="USDC" size={44} />
            <span>Available USDC</span>
            <strong>
              {formatTokenAmount(savings?.availableUsdc, 6, 2)} USDC
            </strong>
          </article>
          <article>
            <HomeIllustration name="weth" alt="WETH" size={44} />
            <span>Available WETH</span>
            <strong>
              {formatTokenAmount(savings?.availableWeth, 18, 6)} WETH
            </strong>
          </article>
          <button
            className="family-activity-button"
            type="button"
            onClick={() => setActivityOpen(true)}
          >
            View vault activity
          </button>
        </section>
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
      {activityOpen && (
        <VaultActivitySheet onClose={() => setActivityOpen(false)} />
      )}
    </div>
  );
}
