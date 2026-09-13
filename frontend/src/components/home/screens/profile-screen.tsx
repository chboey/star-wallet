"use client";

import { ArrowLeftRight, ChevronRight, LogOut } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { clearDraft, shortAddress } from "@/lib/onboarding";
import { clearWalletSelection } from "@/lib/wallet-context";
import { formatTokenAmount, formatUsd18, safeBigInt } from "@/lib/star-format";
import { ACTIVE_PROFILE_SESSION_KEY } from "../active-profile";
import { HomeIllustration, SectionEmptyState, SectionTitle } from "../home-ui";
import { useStarData } from "../star-data-provider";
import { ParentAuthorizationSettings } from "../parent-authorization-settings";
import {
  hasMasterPinCredential,
  MASTER_PIN_SESSION_KEY,
  MasterPinSheet,
} from "../master-pin-sheet";

export function ProfileScreen() {
  const router = useRouter();
  const { family, familyName, portfolio } = useStarData();
  const { address: connectedAddress, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [walletSlide, setWalletSlide] = useState(0);
  const [masterPinOpen, setMasterPinOpen] = useState(false);
  const [hasMasterPin, setHasMasterPin] = useState(false);
  const [authorizationOpen, setAuthorizationOpen] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setHasMasterPin(hasMasterPinCredential());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const disconnectWallet = () => {
    clearDraft();
    clearWalletSelection();
    window.sessionStorage.removeItem(ACTIVE_PROFILE_SESSION_KEY);
    window.sessionStorage.removeItem(MASTER_PIN_SESSION_KEY);
    window.localStorage.removeItem(MASTER_PIN_SESSION_KEY);
    if (isConnected) disconnect();
    router.replace("/onboarding");
  };

  const parentAddress = family?.parent ?? connectedAddress ?? "";
  const usdc = formatTokenAmount(
    portfolio?.parentWallet?.usdc.amount,
    portfolio?.parentWallet?.usdc.decimals ?? 6,
    2,
  );
  const weth = formatTokenAmount(
    portfolio?.parentWallet?.weth.amount,
    portfolio?.parentWallet?.weth.decimals ?? 18,
    6,
  );
  const starsGiven = (family?.children ?? []).reduce(
    (total, child) => total + safeBigInt(child.totalStarsIssued),
    0n,
  );

  return (
    <div className="wallet-screen profile-screen">
      <section className="profile-overview">
        {family ? (
          <div className="profile-hero">
            <button
              className="profile-switch-icon"
              type="button"
              aria-label="Open profiles"
              onClick={() => router.push("/wallet/profiles")}
            >
              <ArrowLeftRight size={20} strokeWidth={2.1} aria-hidden="true" />
            </button>
            <HomeIllustration name="dad" alt="Your profile" size={104} />
            <h1>{familyName}</h1>
            <div className="profile-session">
              <span className="profile-address">
                {shortAddress(parentAddress)}
              </span>
              <button
                className="profile-disconnect-button"
                type="button"
                aria-label="Disconnect wallet"
                onClick={disconnectWallet}
              >
                <LogOut size={18} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        ) : (
          <SectionEmptyState />
        )}

        <SectionTitle>Your wallet</SectionTitle>
        {family && portfolio ? (
          <>
            <div
              className="profile-wallet-card"
              aria-label={`Family wallet: ${usdc} USDC and ${weth} WETH`}
            >
              <div
                className="profile-wallet-carousel"
                aria-label="Wallet balances. Swipe left or right to change asset."
                tabIndex={0}
                onScroll={(event) => {
                  const { clientWidth, scrollLeft } = event.currentTarget;
                  setWalletSlide(Math.round(scrollLeft / clientWidth));
                }}
              >
                <div
                  className={`profile-wallet-slide profile-wallet-slide-usdc ${
                    walletSlide === 0 ? "is-active" : ""
                  }`}
                  role="group"
                  aria-label={`1 of 2: ${usdc} USDC`}
                >
                  <span className="profile-wallet-balance">
                    <span className="profile-wallet-coin" aria-hidden="true">
                      <HomeIllustration name="usdc" alt="" size={54} />
                    </span>
                    <span className="profile-wallet-balance-copy">
                      <strong>{usdc}</strong>
                      <small>USDC</small>
                    </span>
                  </span>
                </div>
                <div
                  className={`profile-wallet-slide profile-wallet-slide-weth ${
                    walletSlide === 1 ? "is-active" : ""
                  }`}
                  role="group"
                  aria-label={`2 of 2: ${weth} WETH`}
                >
                  <span className="profile-wallet-balance">
                    <span className="profile-wallet-coin" aria-hidden="true">
                      <HomeIllustration name="weth" alt="" size={54} />
                    </span>
                    <span className="profile-wallet-balance-copy">
                      <strong>{weth}</strong>
                      <small>WETH</small>
                    </span>
                  </span>
                </div>
              </div>
            </div>
            <div className="profile-wallet-indicator" aria-hidden="true">
              <span className={walletSlide === 0 ? "is-active" : ""} />
              <span className={walletSlide === 1 ? "is-active" : ""} />
            </div>
          </>
        ) : (
          <SectionEmptyState />
        )}
      </section>

      <section className="profile-totals-section">
        <SectionTitle>Family totals</SectionTitle>
        {family ? (
          <div className="profile-totals">
            <div className="profile-stats" aria-label="Family savings stats">
              <div>
                <Image
                  className="profile-stat-illustration"
                  src="/illustrations/profile/star.png"
                  alt=""
                  width={44}
                  height={44}
                />
                <small>Stars given</small>
                <strong className="profile-stars-value">
                  {starsGiven.toString()}
                </strong>
              </div>
              <div>
                <span
                  className="profile-stat-illustration profile-portfolio-icon"
                  aria-hidden="true"
                />
                <small>Portfolio value</small>
                <strong className="profile-positive-value">
                  {formatUsd18(portfolio?.currentPortfolioValue.amount)}
                </strong>
              </div>
            </div>
          </div>
        ) : (
          <SectionEmptyState />
        )}
      </section>

      <section className="profile-security-section">
        <SectionTitle>Security</SectionTitle>
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
