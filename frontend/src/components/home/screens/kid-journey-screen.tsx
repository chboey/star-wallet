"use client";

import { Check, Target } from "lucide-react";
import { goalIllustration } from "@/lib/star-format";
import { KidIllustration, KidScreenHeader } from "../kid-ui";
import { SectionEmptyState, StarValue } from "../home-ui";
import { useStarData } from "../star-data-provider";

export function KidJourneyScreen() {
  const { child } = useStarData();
  const goals = child?.goals ?? [];
  const completed = goals.filter((goal) => goal.status === "COMPLETED");

  return (
    <div className="wallet-screen kid-journey-screen">
      <KidScreenHeader title="My journey" />

      <section className="journey-summary-card">
        <KidIllustration name="rocket_sparkle" alt="A rocket" size={96} />
        <div>
          <span>Keep going!</span>
          <strong>Every Star gets you closer.</strong>
        </div>
      </section>

      <div className="journey-tabs" role="tablist" aria-label="Journey views">
        <button className="active" type="button" role="tab" aria-selected>
          Dreams
        </button>
        <button type="button" role="tab" aria-selected={false}>
          Completed
        </button>
      </div>

      {goals.length ? (
        <section className="journey-card-list">
          {goals.map((goal) => (
            <article key={goal.id}>
              <KidIllustration
                name={goalIllustration(goal.title, goal.icon)}
                alt=""
                size={64}
              />
              <div>
                <strong>{goal.title}</strong>
                <span>
                  {goal.allocatedStars ?? "0"} / {goal.starCost} Stars
                </span>
              </div>
              {goal.status === "COMPLETED" ? (
                <span className="journey-complete">
                  <Check size={18} />
                </span>
              ) : (
                <Target size={19} />
              )}
            </article>
          ))}
        </section>
      ) : (
        <SectionEmptyState className="is-tall" />
      )}

      <div className="journey-total">
        <span>Dreams completed</span>
        <StarValue>{completed.length}</StarValue>
      </div>
    </div>
  );
}
