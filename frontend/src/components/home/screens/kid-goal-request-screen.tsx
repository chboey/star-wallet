"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { goalIcons, goalIconAsset, type GoalIconId } from "@/lib/goal-requests";
import { submitGoalRequest } from "@/lib/goal-request-submission";
import { truncateUtf8 } from "@/lib/star-format";
import { GoalTypePicker } from "../goal-type-picker";
import { KidIllustration, KidScreenHeader } from "../kid-ui";
import { IntentStatus, ActionStatus } from "../action-status";
import { useStarData } from "../star-data-provider";
import { useStarIntents } from "../use-star-intents";
import { ParentActionSheet } from "../parent-action-sheet";

export function KidGoalRequestScreen({
  initialIcon,
  onClose,
}: {
  initialIcon?: GoalIconId;
  onClose?: () => void;
}) {
  const router = useRouter();
  const {
    child,
    family,
    goalRequestsAddress,
    goalRequestsSupported,
    goalRequestsLoading,
    goalRequestsError,
    refresh,
  } = useStarData();
  const { execute, operation, resetOperation } = useStarIntents();
  const [step, setStep] = useState<"choose" | "details" | "sent">(
    initialIcon === undefined ? "choose" : "details",
  );
  const [icon, setIcon] = useState<GoalIconId>(initialIcon ?? 5);
  const [title, setTitle] = useState(
    initialIcon === undefined || initialIcon === 5
      ? ""
      : goalIcons.find((item) => item.id === initialIcon)!.label,
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const canSend = Boolean(
    goalRequestsSupported &&
    !goalRequestsError &&
    child?.active &&
    family?.active &&
    goalRequestsAddress,
  );
  const choose = (value: GoalIconId) => {
    setIcon(value);
    setTitle(
      value === 5 ? "" : goalIcons.find((item) => item.id === value)!.label,
    );
    setStep("details");
  };
  const close = () => {
    if (lock.current) return;
    if (onClose) onClose();
    else router.push("/wallet/kid");
  };
  const back = () => {
    if (lock.current) return;
    if (step === "details") {
      setStep("choose");
      setError("");
      resetOperation();
    } else close();
  };
  const send = async () => {
    if (
      lock.current ||
      !canSend ||
      !child ||
      !goalRequestsAddress ||
      !title.trim()
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await submitGoalRequest(
        {
          childId: child.id,
          title,
          reason,
          icon,
          goalsAddress: goalRequestsAddress,
        },
        execute,
      );
      setStep("sent");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to send your goal request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const heading =
    step === "choose"
      ? "Add a New Goal"
      : step === "details"
        ? "Request a New Goal"
        : "Goal request";
  const content = (
    <>
      {step === "choose" ? (
        <GoalTypePicker onChoose={choose} />
      ) : step === "sent" ? (
        <div className="goal-request-result">
          <KidIllustration name="paper_plane_sparkle" alt="" size={240} />
          <h2>Request sent!</h2>
          <p>
            We’ve asked your parent to add this goal and set the Star target.
          </p>
          <button
            className="filled-action-button"
            type="button"
            onClick={close}
          >
            Done
          </button>
        </div>
      ) : (
        <form
          className="goal-request-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="goal-request-selected-art">
            <KidIllustration name={goalIconAsset(icon)} alt="" size={140} />
            <span>
              <Check size={14} aria-hidden="true" />
            </span>
          </div>
          <label>
            Goal name
            <input
              value={title}
              onChange={(event) =>
                setTitle(truncateUtf8(event.target.value, 64))
              }
              placeholder="What are you dreaming of?"
              required
              disabled={busy}
            />
          </label>
          <fieldset disabled={busy}>
            <legend>Pick an icon</legend>
            <div className="goal-icon-options">
              {goalIcons.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-label={item.label}
                  aria-pressed={icon === item.id}
                  onClick={() => setIcon(item.id)}
                >
                  <KidIllustration name={item.illustration} alt="" size={64} />
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            Why do you want this?{" "}
            <span className="goal-field-optional">(optional)</span>
            <textarea
              value={reason}
              maxLength={120}
              disabled={busy}
              rows={3}
              placeholder="Tell your parent why it’s special to you…"
              onChange={(event) => setReason(event.target.value)}
            />
            <small className="goal-character-count">
              {reason.length} / 120
            </small>
          </label>
          <p className="goal-request-hint">
            Your parent will choose how many Stars you need.
          </p>
          {goalRequestsLoading ? (
            <ActionStatus state="working" message="Checking goal requests…" />
          ) : goalRequestsError ? (
            <ActionStatus
              state="error"
              message="Couldn’t check goal requests. Please try again."
              onRefresh={() => void refresh(["goals"])}
              refreshing={goalRequestsLoading}
              refreshLabel="Refresh goal requests"
            />
          ) : null}
          <IntentStatus operation={operation} busy={busy} error={error} />
          <button
            type="submit"
            className="filled-action-button"
            disabled={busy || !canSend || !title.trim()}
            aria-busy={busy}
          >
            {busy && (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            )}
            Send Request
          </button>
        </form>
      )}
    </>
  );
  return onClose ? (
    <ParentActionSheet
      title={heading}
      onClose={close}
      onBack={step === "details" ? back : undefined}
    >
      <div className="kid-goal-request-popup">{content}</div>
    </ParentActionSheet>
  ) : (
    <div className="wallet-screen kid-flow-screen kid-goal-request-screen">
      <KidScreenHeader title={heading} onBack={back} backDisabled={busy} />
      {content}
    </div>
  );
}
