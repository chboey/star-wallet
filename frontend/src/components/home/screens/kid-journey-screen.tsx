import { Check, Target } from "lucide-react";
import { KidIllustration, KidScreenHeader } from "../kid-ui";
import { StarValue } from "../home-ui";

const dreams = [
  { title: "New bicycle", progress: "12 / 20", image: "bicycle" },
  { title: "Art set", progress: "4 / 15", image: "paint" },
] as const;

export function KidJourneyScreen() {
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
          Quests
        </button>
      </div>

      <section className="journey-card-list">
        {dreams.map((dream) => (
          <article key={dream.title}>
            <KidIllustration name={dream.image} alt="" size={64} />
            <div>
              <strong>{dream.title}</strong>
              <span>{dream.progress} Stars</span>
            </div>
            <Target size={19} />
          </article>
        ))}
        <article>
          <KidIllustration name="purple_tick" alt="" size={64} />
          <div>
            <strong>Finished a book</strong>
            <span>Quest completed</span>
          </div>
          <span className="journey-complete">
            <Check size={18} />
          </span>
        </article>
      </section>

      <div className="journey-total">
        <span>Total Stars earned</span>
        <StarValue>46</StarValue>
      </div>
    </div>
  );
}
