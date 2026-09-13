"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { availableStars } from "@/lib/star-format";
import {
  HomeIllustration,
  SectionEmptyState,
  SectionTitle,
  StarValue,
} from "../home-ui";
import { KidIllustration } from "../kid-ui";
import { useStarData } from "../star-data-provider";

export function KidHomeScreen() {
  const { child, childName } = useStarData();
  const goal = child?.goals?.find((item) => item.status === "ACTIVE");
  const allocated = BigInt(goal?.allocatedStars ?? 0);
  const cost = BigInt(goal?.starCost ?? 0);
  const progress = cost ? Number((allocated * 100n) / cost) : 0;

  return (
    <div className="wallet-screen kid-dashboard">
      <header className="kid-dashboard-header">
        <HomeIllustration
          className="kid-illustration"
          name="girl"
          alt={childName}
          size={58}
        />
        <div>
          <h1>Hi {childName}!</h1>
          <p>What will you achieve today?</p>
        </div>
        <StarValue>{availableStars(child).toString()}</StarValue>
      </header>

      {goal ? (
        <section className="kid-hero-card">
          <div>
            <span>Your next dream</span>
            <h2>{goal.title}</h2>
            <p>
              {allocated.toString()} of {goal.starCost} Stars saved
            </p>
            <div
              className="kid-goal-progress"
              aria-label={`${progress}% complete`}
            >
              <span style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          </div>
          <KidIllustration name="bicycle_sparkle" alt="A dream" size={116} />
        </section>
      ) : (
        <SectionEmptyState className="is-tall" />
      )}

      <SectionTitle
        action={
          <Link href="/wallet/kid/journey">
            See journey <ChevronRight size={15} />
          </Link>
        }
      >
        My progress
      </SectionTitle>

      <div className="kid-quick-actions">
        <Link href="/wallet/kid/journey">
          <HomeIllustration
            name="star_sparkle"
            alt=""
            size={48}
            collection="kid"
          />
          <strong>My dreams</strong>
        </Link>
        <Link href="/wallet/kid/profile">
          <span className="kid-add-icon">
            <Plus size={22} />
          </span>
          <strong>My profile</strong>
        </Link>
      </div>
    </div>
  );
}
