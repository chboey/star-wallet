"use client";

import { ChevronDown, LoaderCircle } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { truncateUtf8 } from "@/lib/star-format";
import type { StarRequest } from "@/lib/quest-types";
import {
  VerticalSectionPaging,
  type SectionPagingState,
} from "@/lib/vertical-section-paging";
import { KidIllustration } from "./kid-ui";
import { ParentActionSheet } from "./parent-action-sheet";
import { IntentStatus } from "./action-status";
import { ParentTransactionDetails } from "./parent-transaction-details";
import { QuestInbox } from "./quest-inbox";
import { RequestReviewSheet } from "./request-review-sheet";
import { useStarData } from "./star-data-provider";
import { useStarIntents } from "./use-star-intents";
import styles from "./parent-reward-sheet.module.css";

export type ParentChildChoice = { id: string; name: string };
export type RewardPanel = "reward" | "requests";

const rewardAmounts = [5, 10, 20, 50] as const;
const panels = [
  { id: "reward", label: "Reward Stars" },
  { id: "requests", label: "Star requests" },
] as const;

export function ParentRewardStarsSheet({
  childChoices,
  initialPanel = "reward",
  initialRequestId,
  onClose,
}: {
  childChoices: ParentChildChoice[];
  initialPanel?: RewardPanel;
  initialRequestId?: string;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<RewardPanel>(initialPanel);
  const [reviewRequest, setReviewRequest] = useState<StarRequest | null>(null);
  const [focusedRequestId, setFocusedRequestId] = useState(initialRequestId);
  const [busy, setBusy] = useState(false);
  const [rewardComplete, setRewardComplete] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const paging = useRef(new VerticalSectionPaging());
  const [direction, setDirection] = useState<"next" | "previous" | null>(null);
  const panelId = useId();
  const changePanel = (index: number, time: number) => {
    const next = panels[index];
    if (busy || !next || next.id === panel) return;
    const current = trackRef.current?.querySelector<HTMLElement>(
      "[data-stars-panel]:not([hidden])",
    );
    // Do not leave keyboard focus inside a panel that becomes hidden.
    if (current?.contains(document.activeElement))
      trackRef.current?.focus({ preventScroll: true });
    setDirection(
      index > panels.findIndex((item) => item.id === panel)
        ? "next"
        : "previous",
    );
    setPanel(next.id);
    paging.current.lock(time);
  };
  const pagingState = (target: EventTarget): SectionPagingState | null => {
    const track = trackRef.current;
    if (!track || !(target instanceof Element) || !track.contains(target))
      return null;
    // Keep native select/input gestures and nested dialogs independent of section paging.
    if (target.closest("input, select, textarea, [contenteditable='true']"))
      return null;
    const active = track.querySelector<HTMLElement>(
      "[data-stars-panel]:not([hidden])",
    );
    if (!active) return null;
    const scroll =
      target.closest<HTMLElement>("[data-stars-scroll]") ??
      active.querySelector<HTMLElement>("[data-stars-scroll]") ??
      active;
    return {
      index: panels.findIndex((item) => item.id === panel),
      count: panels.length,
      busy,
      atTop: scroll.scrollTop <= 2,
      atBottom:
        scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2,
    };
  };
  const close = () => {
    if (!busy) onClose();
  };

  if (reviewRequest) {
    return (
      <RequestReviewSheet
        key={reviewRequest.id}
        request={reviewRequest}
        onBusyChange={setBusy}
        onClose={() => {
          if (busy) return;
          setFocusedRequestId(undefined);
          setReviewRequest(null);
        }}
      />
    );
  }

  return (
    <ParentActionSheet
      title="Stars"
      onClose={close}
      className={`${styles.sheet} ${panel === "requests" ? styles.requestsSheet : ""}`}
    >
      {!rewardComplete && (
        <div className={styles.navigation} aria-label="Reward options">
          {panels.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={panel === item.id}
              aria-controls={`${panelId}-${item.id}`}
              disabled={busy}
              onClick={(event) => changePanel(index, event.timeStamp)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div
        className={styles.sections}
        ref={trackRef}
        role="region"
        aria-roledescription="carousel"
        aria-label="Reward Stars or review Star requests. Scroll or swipe up and down to switch."
        aria-busy={busy}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (
            ["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)
          ) {
            event.preventDefault();
            changePanel(
              event.key === "ArrowUp" || event.key === "PageUp" ? 0 : 1,
              event.timeStamp,
            );
          }
        }}
        onWheel={(event) => {
          if (event.ctrlKey) return;
          const state = pagingState(event.target);
          if (!state) return;
          const unit =
            event.deltaMode === 1
              ? 16
              : event.deltaMode === 2
                ? event.currentTarget.clientHeight
                : 1;
          const next = paging.current.wheel(
            event.deltaX * unit,
            event.deltaY * unit,
            event.timeStamp,
            state,
          );
          if (next !== null) changePanel(next, event.timeStamp);
        }}
        onTouchStart={(event) => {
          const state = pagingState(event.target);
          const touch = event.touches[0];
          if (event.touches.length !== 1 || !state || !touch) {
            paging.current.cancelTouch();
            return;
          }
          paging.current.startTouch(touch.clientX, touch.clientY, state);
        }}
        onTouchMove={(event) => {
          if (event.touches.length !== 1) paging.current.cancelTouch();
        }}
        onTouchCancel={() => paging.current.cancelTouch()}
        onTouchEnd={(event) => {
          const state = pagingState(event.target);
          const touch = event.changedTouches[0];
          if (!state || !touch) {
            paging.current.cancelTouch();
            return;
          }
          const next = paging.current.endTouch(
            touch.clientX,
            touch.clientY,
            event.timeStamp,
            state,
          );
          if (next !== null) changePanel(next, event.timeStamp);
        }}
      >
        {panels.map((item, index) => (
          <div
            key={item.id}
            id={`${panelId}-${item.id}`}
            className={`${styles.panel} ${item.id === "reward" ? styles.rewardPanel : ""}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of 2: ${item.label}`}
            data-stars-panel={item.id}
            data-direction={panel === item.id ? direction : undefined}
            hidden={panel !== item.id}
            aria-hidden={panel !== item.id}
            inert={panel !== item.id}
          >
            {item.id === "reward" ? (
              <RewardStarsForm
                childChoices={childChoices}
                onBusyChange={setBusy}
                onComplete={() => setRewardComplete(true)}
                onDone={close}
              />
            ) : (
              <QuestInbox
                scope="stars"
                verticalPaging
                initialRequestId={focusedRequestId}
                onReviewRequest={setReviewRequest}
                enabled={panel === "requests"}
                onBusyChange={setBusy}
              />
            )}
          </div>
        ))}
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
        <div className="parent-action-success-content" data-stars-scroll>
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
      <div className={styles.fields} data-stars-scroll>
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
