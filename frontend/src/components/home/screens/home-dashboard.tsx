"use client";

import { ChevronRight, ListChecks } from "lucide-react";
import Link from "next/link";
import { availableStars, displayEnsName, formatUsd18 } from "@/lib/star-format";
import {
  HomeIllustration,
  SectionEmptyState,
  SectionTitle,
  StarValue,
} from "../home-ui";
import { useStarData } from "../star-data-provider";

export function HomeDashboard() {
  const { family, familyName, portfolio } = useStarData();
  const recent = family?.activities.slice(0, 3) ?? [];

  return (
    <div className="wallet-screen home-dashboard">
      <header className="dashboard-header">
        <HomeIllustration name="dad" alt="Parent profile" size={58} />
        <div>
          <p>
            Good morning
            <HomeIllustration
              className="greeting-sun"
              name="sunshine"
              alt=""
              size={32}
            />
          </p>
          <h1>{familyName}</h1>
        </div>
      </header>

      <section className="dashboard-balance-card">
        <div>
          <span>Family savings</span>
          <strong>
            {formatUsd18(portfolio?.currentPortfolioValue.amount)}
          </strong>
          <small>USDC and WETH</small>
        </div>
        <HomeIllustration
          name="jar_of_stars"
          alt="A jar of Stars"
          size={108}
          collection="kid"
        />
      </section>

      <SectionTitle
        action={
          <Link href="/wallet/profiles">
            Switch profile <ChevronRight size={15} />
          </Link>
        }
      >
        Family
      </SectionTitle>

      <section className="dashboard-children-list">
        {(family?.children ?? []).map((child) => (
          <article className="dashboard-child-card" key={child.id}>
            <HomeIllustration name="girl" alt="" size={68} />
            <div>
              <strong>{displayEnsName(child.ensName, "Child")}</strong>
              <span>{child.active ? "Active" : "Inactive"}</span>
            </div>
            <StarValue>{availableStars(child).toString()}</StarValue>
          </article>
        ))}
        {!family?.children.length && <SectionEmptyState />}
      </section>

      <SectionTitle>Recent activity</SectionTitle>
      {recent.length ? (
        <section className="dashboard-activity-list">
          {recent.map((item) => (
            <article key={item.id}>
              <HomeIllustration name="star" alt="" size={42} />
              <span>{activityLabel(item.type)}</span>
              <strong>{item.amount ? `+${item.amount}` : "Updated"}</strong>
            </article>
          ))}
        </section>
      ) : (
        <SectionEmptyState />
      )}

      <Link className="dashboard-action-card" href="/wallet/family">
        <span>
          <ListChecks size={20} />
        </span>
        <div>
          <strong>Open family overview</strong>
          <small>See balances, savings and children</small>
        </div>
        <ChevronRight size={18} />
      </Link>
    </div>
  );
}

function activityLabel(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
