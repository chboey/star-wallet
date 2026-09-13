import Link from "next/link";
import { goalIcons, type GoalIconId } from "@/lib/goal-requests";
import { KidIllustration } from "./kid-ui";

export function GoalTypePicker({
  onChoose,
}: {
  onChoose?: (icon: GoalIconId) => void;
}) {
  return (
    <div className="goal-type-grid" aria-label="Choose a goal type">
      {goalIcons
        .filter((icon) => icon.id !== 6)
        .map((icon) => {
          const content = (
            <>
              <span className="goal-type-art">
                <KidIllustration name={icon.illustration} alt="" size={64} />
              </span>
              <span>{icon.label}</span>
            </>
          );
          return onChoose ? (
            <button
              type="button"
              onClick={() => onChoose(icon.id)}
              key={icon.id}
            >
              {content}
            </button>
          ) : (
            <Link href={`/wallet/kid/add-goal?icon=${icon.id}`} key={icon.id}>
              {content}
            </Link>
          );
        })}
    </div>
  );
}
