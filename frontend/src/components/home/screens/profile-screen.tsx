"use client";

import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { shortAddress } from "@/lib/onboarding";
import { formatTokenAmount, formatUsd18 } from "@/lib/star-format";
import { HomeIllustration, SectionTitle, StarValue } from "../home-ui";
import { useStarData } from "../star-data-provider";

export function ProfileScreen() {
  const { address } = useAccount();
  const { family, familyName, portfolio } = useStarData();
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
    </div>
  );
}
