import { LoaderCircle, Minus, Plus, Star } from "lucide-react";
import { contributionAmount } from "@/lib/goal-contributions";
import { KidIllustration } from "./kid-ui";

export function GoalContributionContent({
  available,
  maximum,
  value,
  onChange,
  onSubmit,
  busy,
  loading,
  disabled,
  added,
  onDone,
}: {
  available?: bigint;
  maximum: bigint;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  loading: boolean;
  disabled: boolean;
  added: string | null;
  onDone: () => void;
}) {
  const amount = contributionAmount(value);
  const blocked = busy || loading || disabled;
  if (added !== null)
    return (
      <div className="goal-contribution-content">
        <div className="goal-contribution-success" role="status">
          <KidIllustration name="purple_tick" alt="" size={112} />
          <span>Added {added} Stars</span>
        </div>
        <button className="filled-action-button" type="button" onClick={onDone}>
          Done
        </button>
      </div>
    );
  return (
    <div className="goal-contribution-content">
      <div className="goal-contribution-available">
        <span>Available Stars</span>
        <strong>
          {available === undefined ? "—" : available.toString()}{" "}
          <Star size={22} fill="currentColor" aria-hidden="true" />
        </strong>
      </div>
      <div className="goal-contribution-stepper">
        <button
          type="button"
          aria-label="Add fewer Stars"
          disabled={blocked || !amount || amount <= 1n}
          onClick={() => onChange(((amount ?? 1n) - 1n).toString())}
        >
          <Minus size={22} />
        </button>
        <label>
          <span className="sr-only">Stars to add</span>
          <input
            className="amount-input"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={78}
            value={value}
            disabled={blocked}
            onChange={(event) => {
              if (/^[0-9]*$/.test(event.target.value))
                onChange(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          aria-label="Add more Stars"
          disabled={
            blocked || maximum === 0n || (amount !== null && amount >= maximum)
          }
          onClick={() => onChange(((amount ?? 0n) + 1n).toString())}
        >
          <Plus size={22} />
        </button>
      </div>
      <button
        className="filled-action-button"
        type="button"
        disabled={blocked || amount === null || amount > maximum}
        aria-busy={busy}
        onClick={onSubmit}
      >
        {busy && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
        {loading && !busy
          ? "Checking Stars…"
          : `Add ${amount?.toString() ?? "0"} Stars`}
      </button>
    </div>
  );
}
