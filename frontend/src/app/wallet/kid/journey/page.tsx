import {
  type KidJourneySection,
  KidJourneyScreen,
} from "@/components/home/screens/kid-journey-screen";
import { redirect } from "next/navigation";
import { kidGoalsHref, kidGoalTab } from "@/lib/kid-goals";

const validSections = new Set<KidJourneySection>(["quests", "goals"]);

export default async function KidJourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; tab?: string; goal?: string }>;
}) {
  const { section, tab, goal } = await searchParams;
  if (section === "rewards")
    redirect(kidGoalsHref({ tab: "ready", goalId: goal }));
  const initialGoalTab = kidGoalTab(tab);
  const initialSection = validSections.has(section as KidJourneySection)
    ? (section as KidJourneySection)
    : "quests";

  return (
    <KidJourneyScreen
      key={`${initialSection}:${initialGoalTab}:${goal ?? ""}`}
      initialSection={initialSection}
      initialGoalTab={initialGoalTab}
      initialGoalId={initialSection === "goals" ? goal : undefined}
    />
  );
}
