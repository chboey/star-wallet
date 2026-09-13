import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { HomeIllustration, SectionTitle } from "../home-ui";

export function ProfileScreen() {
  return (
    <div className="wallet-screen profile-screen">
      <header className="profile-hero">
        <Link aria-label="Switch profile" href="/wallet/profiles">
          <ArrowLeftRight size={19} />
        </Link>
        <HomeIllustration name="dad" alt="Parent profile" size={118} />
        <h1>Tan Family</h1>
        <span>Parent profile</span>
      </header>

      <SectionTitle>Family wallet</SectionTitle>
      <section className="profile-balance-grid">
        <article>
          <HomeIllustration name="usdc" alt="USDC" size={46} />
          <span>USDC balance</span>
          <strong>$1,248.50</strong>
        </article>
        <article>
          <HomeIllustration name="weth" alt="WETH" size={46} />
          <span>WETH balance</span>
          <strong>$342.18</strong>
        </article>
      </section>

      <SectionTitle>Family progress</SectionTitle>
      <section className="profile-summary-card">
        <HomeIllustration name="home" alt="Family home" size={88} />
        <div>
          <strong>1 child profile</strong>
          <span>2 active dreams · 8 quests completed</span>
        </div>
      </section>
    </div>
  );
}
