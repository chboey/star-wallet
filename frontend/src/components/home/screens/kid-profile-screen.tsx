import Link from "next/link";
import { ArrowLeftRight, ListChecks, Target } from "lucide-react";
import { KidIllustration, KidScreenHeader } from "../kid-ui";
import { HomeIllustration } from "../home-ui";

export function KidProfileScreen() {
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
            alt="Jane"
            size={126}
          />
        </div>
        <h1>Jane</h1>
        <span>jane.tan.starwallet.eth</span>
      </section>

      <section className="kid-profile-stats">
        <div>
          <Target size={20} />
          <small>Dreams</small>
          <strong>2</strong>
        </div>
        <div>
          <ListChecks size={20} />
          <small>Quests done</small>
          <strong>8</strong>
        </div>
      </section>

      <section className="kid-profile-playground">
        <header>
          <h2>My rewards</h2>
          <p>Things I&apos;m working toward</p>
        </header>
        <div>
          <KidIllustration name="bicycle" alt="Bicycle" size={92} />
          <KidIllustration name="paint" alt="Art set" size={82} />
          <KidIllustration name="books" alt="Books" size={78} />
        </div>
      </section>
    </div>
  );
}
