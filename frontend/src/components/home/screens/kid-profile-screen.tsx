"use client";

import Link from "next/link";
import { ArrowLeftRight, ListChecks, Target } from "lucide-react";
import { KidIllustration, KidScreenHeader } from "../kid-ui";
import { HomeIllustration } from "../home-ui";
import { useStarData } from "../star-data-provider";

export function KidProfileScreen() {
  const { child, childName } = useStarData();
  const activeGoals =
    child?.goals?.filter((goal) => goal.status === "ACTIVE") ?? [];
  const completedGoals =
    child?.goals?.filter((goal) => goal.status === "COMPLETED") ?? [];

  return (
    <div className="wallet-screen kid-profile-screen">
      <KidScreenHeader
        title="My profile"
        action={
          <Link aria-label="Switch profile" href="/wallet/profiles">
            <ArrowLeftRight size={19} />
          </Link>
        }
      />

      <section className="kid-profile-overview">
        <div className="kid-profile-avatar">
          <HomeIllustration
            className="kid-illustration"
            name="girl_star"
            alt={childName}
            size={126}
          />
        </div>
        <h1>{childName}</h1>
        <span>{child?.ensName ?? "Child profile"}</span>
      </section>

      <section className="kid-profile-stats">
        <div>
          <Target size={20} />
          <small>Active dreams</small>
          <strong>{activeGoals.length}</strong>
        </div>
        <div>
          <ListChecks size={20} />
          <small>Dreams completed</small>
          <strong>{completedGoals.length}</strong>
        </div>
      </section>

      <section className="kid-profile-playground">
        <header>
          <h2>My rewards</h2>
          <p>Things I&apos;m working toward</p>
        </header>
        {activeGoals.length ? (
          <div>
            {activeGoals.slice(0, 3).map((goal) => (
              <KidIllustration
                name="star_sparkle"
                alt={goal.title}
                size={82}
                key={goal.id}
              />
            ))}
          </div>
        ) : (
          <div>
            <KidIllustration name="star_sparkle" alt="A Star" size={82} />
          </div>
        )}
      </section>
    </div>
  );
}
