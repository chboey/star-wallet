import { ChevronRight } from "lucide-react";
import type { StarGoal } from "@/lib/star-api";
import { goalIllustration, safeBigInt } from "@/lib/star-format";
import { KidIllustration } from "./kid-ui";

export function KidGoalListCard({
  goal,
  stars,
  pending = false,
  completed = goal.status === "COMPLETED",
  onOpen,
}: {
  goal: StarGoal;
  stars: bigint;
  pending?: boolean;
  completed?: boolean;
  onOpen: () => void;
}) {
  const target = safeBigInt(goal.starCost);
  const progress = stars > target ? target : stars;
  const percentage = target > 0n ? Number((progress * 100n) / target) : 0;

  return (
    <button className="kid-goal-list-row" type="button" onClick={onOpen}>
      <KidIllustration
        name={goalIllustration(goal.title, goal.icon)}
        alt=""
        size={68}
      />
      <span>
        <strong>{goal.title}</strong>
        {!completed && (
          <>
            <small>
              {pending
                ? "Waiting for parent"
                : target > stars
                  ? `${target - stars} Stars to go`
                  : "Ready to claim"}
            </small>
            {!pending && target > stars && (
              <span className="kid-mini-progress" aria-hidden="true">
                <span style={{ width: `${percentage}%` }} />
              </span>
            )}
          </>
        )}
      </span>
      <span className="kid-goal-list-value">
        {!completed && !pending && `${progress} / ${target}`}
        <ChevronRight size={15} aria-hidden="true" />
      </span>
    </button>
  );
}
