import { ChevronRight, ListChecks } from "lucide-react";
import Link from "next/link";
import { HomeIllustration, SectionTitle, StarValue } from "../home-ui";

const activity = [
  { label: "Stars for finishing homework", value: "+5", image: "book" },
  { label: "Saved toward a new bicycle", value: "+3", image: "bicycle" },
  { label: "Weekly allowance added", value: "$10", image: "wallet" },
] as const;

export function HomeDashboard() {
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
          <h1>Tan Family</h1>
        </div>
      </header>

      <section className="dashboard-balance-card">
        <div>
          <span>Family savings</span>
          <strong>$1,590.68</strong>
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

      <section className="dashboard-child-card">
        <HomeIllustration name="girl" alt="Jane" size={68} />
        <div>
          <strong>Jane</strong>
          <span>Saving for a bicycle</span>
        </div>
        <StarValue>30</StarValue>
      </section>

      <SectionTitle>Recent activity</SectionTitle>
      <section className="dashboard-activity-list">
        {activity.map((item) => (
          <article key={item.label}>
            <HomeIllustration
              name={item.image}
              alt=""
              size={42}
              collection={item.image === "book" ? "kid" : "home"}
            />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      <Link className="dashboard-action-card" href="/wallet/kid">
        <span>
          <ListChecks size={20} />
        </span>
        <div>
          <strong>Open Jane&apos;s dashboard</strong>
          <small>See goals, quests and rewards</small>
        </div>
        <ChevronRight size={18} />
      </Link>
    </div>
  );
}
