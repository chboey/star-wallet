import { kidGoalTabs, type KidGoalTab } from "@/lib/kid-goals";

export function KidGoalTabs({
  tab,
  onChange,
}: {
  tab: KidGoalTab;
  onChange?: (tab: KidGoalTab) => void;
}) {
  return (
    <div className="kid-tabs kid-goal-tabs" aria-label="Goal status">
      {kidGoalTabs.map(({ id, label }) => (
        <button
          key={id}
          className={tab === id ? "active" : ""}
          type="button"
          aria-pressed={tab === id}
          onClick={() => onChange?.(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
