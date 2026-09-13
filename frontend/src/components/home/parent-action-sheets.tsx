"use client";

import { ChevronDown, LoaderCircle } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { truncateUtf8 } from "@/lib/star-format";
import { IntentStatus } from "./action-status";
import { KidIllustration } from "./kid-ui";
import { ParentActionSheet } from "./parent-action-sheet";
import { ParentTransactionDetails } from "./parent-transaction-details";
import { useStarData } from "./star-data-provider";
import { useStarIntents } from "./use-star-intents";
import styles from "./parent-reward-sheet.module.css";

export type ParentChildChoice = { id: string; name: string };

const rewardAmounts = [5, 10, 20, 50] as const;

export function ParentRewardStarsSheet({
  childChoices,
  onClose,
}: {
  childChoices: ParentChildChoice[];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (!busy) onClose();
  };

  return (
    <ParentActionSheet
      title="Reward Stars"
      onClose={close}
      className={styles.sheet}
    >
      <div className={`${styles.sections} ${styles.rewardPanel}`}>
        <RewardStarsForm
          childChoices={childChoices}
          onBusyChange={setBusy}
          onComplete={() => {}}
          onDone={close}
        />
      </div>
    </ParentActionSheet>
  );
}

function RewardStarsForm({
  childChoices,
  onBusyChange,
  onComplete,
  onDone,
}: {
  childChoices: ParentChildChoice[];
  onBusyChange: (busy: boolean) => void;
  onComplete: () => void;
  onDone: () => void;
}) {
  const { family } = useStarData();
  const { execute, operation } = useStarIntents();
  const [childId, setChildId] = useState(childChoices[0]?.id ?? "");
  const [amount, setAmount] = useState<number>(10);
  const [reason, setReason] = useState("");
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const childName =
    childChoices.find((child) => child.id === childId)?.name ?? "Child";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanReason = reason.trim();
    if (
      lock.current ||
      !cleanReason ||
      !family?.active ||
      !family.vault ||
      !childChoices.some((child) => child.id === childId)
    )
      return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      await execute(
        "rewardStars",
        { childId, stars: String(amount), reason: cleanReason },
        "PARENT",
      );
      setComplete(true);
      onComplete();
    } catch {
      // The operation state renders the actionable API or wallet error.
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  if (complete)
    return (
      <div className={`parent-action-success ${styles.success}`}>
        <div className="parent-action-success-content">
          <KidIllustration
            className="parent-reward-success-illustration"
            name="jar_of_stars"
            alt=""
            size={188}
          />
          <strong>
            {amount} Stars sent to {childName}!
          </strong>
        </div>
        <div className={styles.footer}>
          <ParentTransactionDetails
            hashes={operation.transactionHashes}
            completed={complete && !busy}
          />
          <button
            className="filled-action-button parent-action-submit"
            type="button"
            onClick={onDone}
          >
            Done
          </button>
        </div>
      </div>
    );

  return (
    <form className={`parent-action-form ${styles.form}`} onSubmit={submit}>
      <div className={styles.fields}>
        <label className="parent-action-field">
          <span>Reward</span>
          <span className={styles.selectControl}>
            <select
              value={childId}
              disabled={busy}
              onChange={(event) => setChildId(event.target.value)}
            >
              {childChoices.map((child) => (
                <option value={child.id} key={child.id}>
                  {child.name}
                </option>
              ))}
            </select>
            <ChevronDown size={18} aria-hidden="true" />
          </span>
        </label>
        <fieldset className="parent-choice-grid" disabled={busy}>
          <legend>Choose Stars</legend>
          <div>
            {rewardAmounts.map((value) => (
              <button
                className={amount === value ? "active" : ""}
                type="button"
                aria-pressed={amount === value}
                onClick={() => setAmount(value)}
                key={value}
              >
                {value}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="parent-action-field">
          <span>Reason</span>
          <input
            className="cursor-only-input"
            value={reason}
            disabled={busy}
            onChange={(event) =>
              setReason(truncateUtf8(event.target.value, 128))
            }
            placeholder="Finished homework"
            required
          />
        </label>
      </div>
      <div className={styles.footer}>
        <IntentStatus operation={operation} busy={busy} />
        <ParentTransactionDetails
          hashes={operation.transactionHashes}
          completed={complete && !busy}
        />
        <button
          className="filled-action-button parent-action-submit"
          type="submit"
          aria-busy={busy}
          disabled={
            busy ||
            !reason.trim() ||
            !family?.active ||
            !family.vault ||
            !childChoices.some((child) => child.id === childId)
          }
        >
          {busy && (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          )}
          Reward {amount} Stars
        </button>
      </div>
    </form>
  );
}
