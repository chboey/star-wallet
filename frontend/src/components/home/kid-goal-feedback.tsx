import { Check, LoaderCircle } from "lucide-react";
import {
  kidGoalTabs,
  type KidGoalState,
  type KidGoalTab,
} from "@/lib/kid-goals";
import { KidIllustration } from "./kid-ui";

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

export function KidGoalFeedback({
  state,
  busy,
  onRequest,
  onAdd,
}: {
  state: KidGoalState;
  busy: boolean;
  onRequest: () => void;
  onAdd?: () => void;
}) {
  if (!busy && state.completed)
    return (
      <div className="kid-ready-message kid-redeemed-message">
        <Check size={18} aria-hidden="true" />
        <span>Redeemed on-chain</span>
      </div>
    );
  if (!busy && state.waiting)
    return (
      <div className="kid-status-panel">
        <KidIllustration name="clock" alt="" size={30} />
        <span>
          <strong>Waiting for parent</strong>
          <small>Your {state.reservedStars} Stars are reserved</small>
        </span>
      </div>
    );
  if (!busy && state.tab === "ongoing" && onAdd)
    return (
      <button
        className="filled-action-button kid-primary-action"
        type="button"
        onClick={onAdd}
      >
        Add Stars
      </button>
    );
  return (
    <button
      className="filled-action-button kid-primary-action"
      type="button"
      disabled={!state.canRequest || busy}
      aria-busy={busy}
      onClick={onRequest}
    >
      {busy && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
      {busy || state.canRequest
        ? "Ask parent to redeem"
        : state.progress < state.target
          ? `Add ${state.target - state.progress} more Stars to this goal`
          : "Claim unavailable"}
    </button>
  );
}
