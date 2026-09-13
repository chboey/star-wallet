import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { HomeIllustration, SectionTitle, StarValue } from "../home-ui";
import { KidIllustration } from "../kid-ui";

export function KidHomeScreen() {
  return (
    <div className="wallet-screen kid-dashboard">
      <header className="kid-dashboard-header">
        <HomeIllustration
          className="kid-illustration"
          name="girl"
          alt="Jane"
          size={58}
        />
        <div>
          <h1>Hi Jane!</h1>
          <p>What will you achieve today?</p>
        </div>
        <StarValue>30</StarValue>
      </header>

      <section className="kid-hero-card">
        <div>
          <span>Your next dream</span>
          <h2>New bicycle</h2>
          <p>12 of 20 Stars saved</p>
          <div className="kid-goal-progress" aria-label="60% complete">
            <span />
          </div>
        </div>
        <KidIllustration name="bicycle_sparkle" alt="A bicycle" size={116} />
      </section>

      <SectionTitle
        action={
          <Link href="/wallet/kid/journey">
            See journey <ChevronRight size={15} />
          </Link>
        }
      >
        Today&apos;s quest
      </SectionTitle>

      <article className="kid-quest-card">
        <KidIllustration name="kid_reading_book" alt="Reading" size={76} />
        <div>
          <strong>Read for 20 minutes</strong>
          <span>Complete this to earn</span>
        </div>
        <StarValue compact>5</StarValue>
      </article>

      <SectionTitle>Quick actions</SectionTitle>
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
