import { KidJourneyScreen } from "@/components/home/screens/kid-journey-screen";
import { kidGoalTab } from "@/lib/kid-goals";

export default async function KidJourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; goal?: string }>;
}) {
  const { tab, goal } = await searchParams;
  return (
    <KidJourneyScreen initialGoalTab={kidGoalTab(tab)} initialGoalId={goal} />
  );
}
