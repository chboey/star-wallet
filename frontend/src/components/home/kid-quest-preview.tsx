"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { questDescription, questIllustration } from "@/lib/quest-templates";
import type { Quest } from "@/lib/quest-types";
import { KidIllustration, KidScreenHeader } from "./kid-ui";
import { StarValue } from "./home-ui";
import { ActionStatus } from "./action-status";

function QuestElapsedTimer() {
  const [startedAt] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    // Use elapsed wall time so background-tab throttling does not slow the timer.
    const update = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    const interval = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, [startedAt]);
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return (
    <strong
      className="kid-quest-elapsed"
      role="timer"
      aria-label="Time elapsed"
      aria-live="off"
    >
      {minutes}:{remainder}
    </strong>
  );
}

export function KidQuestPreview({
  quest,
  started,
  busy,
  disabled,
  error,
  onBack,
  onStart,
  onSubmit,
}: {
  quest: Quest;
  started: boolean;
  busy: boolean;
  disabled: boolean;
  error?: string;
  onBack: () => void;
  onStart: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className="kid-quest-preview">
      <KidScreenHeader title="Quest" onBack={onBack} backDisabled={busy} />
      <div className="kid-detail-hero">
        <KidIllustration
          name={questIllustration(quest.title)}
          alt=""
          size={240}
          className={started ? "kid-quest-illustration-floating" : ""}
        />
        <h2>{quest.title}</h2>
        <p>{questDescription(quest.title)}</p>
      </div>
      <div className="kid-quest-preview-reward">
        <span>{started ? "Time elapsed" : "Reward"}</span>
        {started ? (
          <QuestElapsedTimer key={quest.id} />
        ) : (
          <strong aria-label={`${quest.stars} Stars`}>
            <StarValue>+{quest.stars}</StarValue>
          </strong>
        )}
      </div>
      <ActionStatus state="error" message={error} />
      <button
        className="filled-action-button kid-quest-preview-action"
        type="button"
        disabled={busy || disabled || quest.status !== "ACTIVE"}
        aria-busy={busy}
        onClick={started ? onSubmit : onStart}
      >
        {busy && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
        {started ? "I'm done" : "Start Quest"}
      </button>
    </section>
  );
}
