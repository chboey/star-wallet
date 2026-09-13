"use client";

import { ArrowLeftRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { shortAddress } from "@/lib/onboarding";
import { formatTokenAmount, formatUsd18 } from "@/lib/star-format";
import { HomeIllustration, SectionTitle, StarValue } from "../home-ui";
import { hasMasterPinCredential, MasterPinSheet } from "../master-pin-sheet";
import { ParentAuthorizationSettings } from "../parent-authorization-settings";
import { useStarData } from "../star-data-provider";

export function ProfileScreen() {
  const { address } = useAccount();
  const { family, familyName, portfolio } = useStarData();
  const [masterPinOpen, setMasterPinOpen] = useState(false);
  const [hasMasterPin, setHasMasterPin] = useState(false);
  const [authorizationOpen, setAuthorizationOpen] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setHasMasterPin(hasMasterPinCredential());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const starsGiven = (family?.children ?? []).reduce(
    (total, child) => total + BigInt(child.totalStarsIssued),
    0n,
  );

  return (
    <div className="wallet-screen profile-screen">
      <header className="profile-hero">
        <Link aria-label="Switch profile" href="/wallet/profiles">
          <ArrowLeftRight size={19} />
        </Link>
        <HomeIllustration name="dad" alt="Parent profile" size={118} />
        <h1>{familyName}</h1>
        <span>{address ? shortAddress(address) : "Parent profile"}</span>
      </header>

      <SectionTitle>Family wallet</SectionTitle>
      <section className="profile-balance-grid">
        <article>
          <HomeIllustration name="usdc" alt="USDC" size={46} />
          <span>USDC balance</span>
          <strong>
            {formatTokenAmount(portfolio?.assets.usdc.totalAmount, 6, 2)}
          </strong>
        </article>
        <article>
          <HomeIllustration name="weth" alt="WETH" size={46} />
          <span>WETH balance</span>
          <strong>
            {formatTokenAmount(portfolio?.assets.weth.totalAmount, 18, 6)}
          </strong>
        </article>
      </section>

      <SectionTitle>Family progress</SectionTitle>
      <section className="profile-balance-grid">
        <article>
          <HomeIllustration name="star" alt="Stars" size={46} />
          <span>Stars given</span>
          <StarValue>{starsGiven.toString()}</StarValue>
        </article>
        <article>
          <HomeIllustration name="home" alt="Portfolio" size={46} />
          <span>Portfolio value</span>
          <strong>
            {formatUsd18(portfolio?.currentPortfolioValue.amount)}
          </strong>
        </article>
      </section>

      <SectionTitle>Security</SectionTitle>
      <section className="profile-security-section">
        <button
          className="profile-security-row"
          type="button"
          onClick={() => setMasterPinOpen(true)}
        >
          <span>
            <strong>Master PIN</strong>
            <small>
              {hasMasterPin
                ? "Ready for profile switching"
                : "Set a PIN for profile switching"}
            </small>
          </span>
          <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button
          className="profile-security-row"
          type="button"
          onClick={() => setAuthorizationOpen(true)}
        >
          <span>
            <strong>Parent authorization</strong>
            <small>Manage your passkey and revoke child device access</small>
          </span>
          <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </section>

      {authorizationOpen && (
        <ParentAuthorizationSettings
          onClose={() => setAuthorizationOpen(false)}
        />
      )}
      {masterPinOpen && (
        <MasterPinSheet
          alreadySet={hasMasterPin}
          onClose={() => setMasterPinOpen(false)}
          onSaved={() => setHasMasterPin(true)}
        />
      )}
    </div>
  );
}
