import type { KidGoalTab } from "@/lib/kid-goals";
import { KidScreenHeader } from "../kid-ui";
import { KidGoalsScreen } from "./kid-goals-screen";

export function KidJourneyScreen({
  initialGoalTab = "ongoing",
  initialGoalId,
}: {
  initialGoalTab?: KidGoalTab;
  initialGoalId?: string;
}) {
  return (
    <div className="wallet-screen kid-journey-screen">
      {!initialGoalId && <KidScreenHeader title="My goals" />}
      <KidGoalsScreen
        embedded
        initialTab={initialGoalTab}
        initialGoalId={initialGoalId}
      />
    </div>
  );
}
