"use client";

import { ChevronRight, ListChecks, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Hash } from "viem";
import { availableStars, displayEnsName, formatUsd18 } from "@/lib/star-format";
import {
  HomeIllustration,
  SectionEmptyState,
  SectionTitle,
  StarValue,
} from "../home-ui";
import { useStarData } from "../star-data-provider";
import { presentRecentActivities } from "../star-activity";
import { ParentActivitySheet } from "../parent-activity-sheet";
import {
  ParentRewardStarsSheet,
  type ParentChildChoice,
} from "../parent-action-sheets";
import { ParentActionSheet } from "../parent-action-sheet";
import { RewardApprovalSuccess } from "../reward-approval-feedback";
import { WalletActivitySheet } from "../wallet-activity-sheet";

export function HomeDashboard({
  initialRewardApprovalHashes,
}: {
  initialRewardApprovalHashes?: readonly Hash[];
} = {}) {
  const router = useRouter();
  const { family, familyName, portfolio } = useStarData();
  const [activityOpen, setActivityOpen] = useState(false);
  const [walletActivityOpen, setWalletActivityOpen] = useState(false);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [rewardApprovalOpen, setRewardApprovalOpen] = useState(
    initialRewardApprovalHashes !== undefined,
  );
  const closeRewardApproval = () => {
    setRewardApprovalOpen(false);
    router.replace("/wallet");
  };
  const children: ParentChildChoice[] = (family?.children ?? [])
    .filter((child) => child.active)
    .map((child) => ({
      id: child.id,
      name: displayEnsName(child.ensName, "Child"),
    }));
  const activities = family?.activities ?? [];
  const recentActivities = family
    ? presentRecentActivities(activities, family)
    : [];

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

      <button
        className="dashboard-balance-card"
        type="button"
        onClick={() => setWalletActivityOpen(true)}
      >
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
      </button>

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

      <SectionTitle
        action={
          <button type="button" onClick={() => setActivityOpen(true)}>
            See all <ChevronRight size={15} />
          </button>
        }
      >
        Recent activity
      </SectionTitle>
      {recentActivities.length ? (
        <section className="dashboard-activity-list">
          {recentActivities.map((row) => (
            <article key={row.id}>
              <HomeIllustration
                name={row.homeIllustration}
                collection={row.homeIllustrationCollection}
                alt=""
                size={42}
              />
              <span>{row.title}</span>
              <strong>
                {row.amount ?? ""} {row.currency ?? ""}
              </strong>
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
      <button
        className="dashboard-action-card"
        type="button"
        disabled={!family?.vault || children.length === 0}
        onClick={() => setRewardOpen(true)}
      >
        <span>
          <Star size={20} fill="currentColor" />
        </span>
        <div>
          <strong>Reward Stars</strong>
          <small>Celebrate a child&apos;s progress</small>
        </div>
        <ChevronRight size={18} />
      </button>
      {rewardOpen && (
        <ParentRewardStarsSheet
          childChoices={children}
          onClose={() => setRewardOpen(false)}
        />
      )}
      {activityOpen && (
        <ParentActivitySheet onClose={() => setActivityOpen(false)} />
      )}
      {walletActivityOpen && (
        <WalletActivitySheet onClose={() => setWalletActivityOpen(false)} />
      )}
      {rewardApprovalOpen && (
        <ParentActionSheet
          title="Reward approval"
          onClose={closeRewardApproval}
        >
          <RewardApprovalSuccess
            transactionHashes={initialRewardApprovalHashes}
            onDone={closeRewardApproval}
          />
        </ParentActionSheet>
      )}
    </div>
  );
}
