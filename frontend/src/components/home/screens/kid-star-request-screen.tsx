"use client";

import { ChevronLeft, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  quickStarAmounts,
  submitQuickStarRequest,
  type QuickStarAmount,
} from "@/lib/quick-star-request";
import { KidIllustration } from "../kid-ui";
import { SectionEmptyState } from "../home-ui";
import { IntentStatus } from "../action-status";
import { useStarData } from "../star-data-provider";
import { useStarIntents } from "../use-star-intents";

export function KidStarRequestScreen() {
  const router = useRouter();
  const { child, family } = useStarData();
  const { execute, operation } = useStarIntents();
  const [stars, setStars] = useState<QuickStarAmount>(10);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const canRequest = Boolean(child?.active && family?.active && family.vault);
  const back = () => {
    if (!lock.current) router.push("/wallet/kid");
  };
  const askParent = async () => {
    if (lock.current || !canRequest || !child || !family?.vault) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await submitQuickStarRequest(
        { childId: child.id, workflow: family.vault.questsAddress, stars },
        execute,
      );
      setDone(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to send your request. Please try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const hero = (
    <div className="kid-detail-hero kid-add-stars-hero">
      <KidIllustration
        name={done ? "mail_sparkle" : "jar_of_stars"}
        alt=""
        size={240}
      />
      <h1>{done ? "Request sent!" : "Add Stars"}</h1>
      <p>
        {done
          ? `Your parent can now review your request for ${stars} Stars.`
          : "Ask your parent to add Stars to your account."}
      </p>
    </div>
  );

  return (
    <div
      className={`wallet-screen kid-flow-screen kid-add-stars-screen ${done || child ? "kid-pinned-action-screen" : ""}`}
    >
      <header className="kid-screen-header">
        <button
          type="button"
          aria-label="Back to Home"
          disabled={busy}
          onClick={back}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
      </header>
      {done ? (
        <>
          <div className="kid-goal-detail-content">{hero}</div>
          <div className="kid-goal-detail-footer">
            <button
              className="filled-action-button kid-ask-parent-button"
              type="button"
              onClick={back}
            >
              Done
            </button>
          </div>
        </>
      ) : child ? (
        <form
          className="kid-star-request-form"
          onSubmit={(event) => {
            event.preventDefault();
            void askParent();
          }}
        >
          <div className="kid-goal-detail-content">
            {hero}
            <fieldset
              className="kid-star-request-options"
              disabled={busy}
              aria-label="Choose Stars"
            >
              {quickStarAmounts.map((amount) => (
                <button
                  type="button"
                  key={amount}
                  className={stars === amount ? "active" : ""}
                  aria-pressed={stars === amount}
                  onClick={() => setStars(amount)}
                >
                  {amount} Stars
                </button>
              ))}
            </fieldset>
          </div>
          <div className="kid-goal-detail-footer">
            <IntentStatus operation={operation} busy={busy} error={error} />
            <button
              className="filled-action-button kid-ask-parent-button"
              type="submit"
              disabled={busy || !canRequest}
              aria-busy={busy}
            >
              {busy && (
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
              )}
              Ask Parent
            </button>
          </div>
        </form>
      ) : (
        <>
          {hero}
          <SectionEmptyState />
        </>
      )}
    </div>
  );
}
