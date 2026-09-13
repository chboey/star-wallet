"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { ActionStatus } from "./action-status";
import { hasMasterPinCredential, MasterPinSheet } from "./master-pin-sheet";
import { ParentActionSheet } from "./parent-action-sheet";
import { ParentAttentionContent } from "./parent-attention-content";

/** PIN is a local handoff; authorize verifies the real parent proof on-chain before saving. */
export function ParentAttentionSheet({
  authorize,
  onAuthorized,
  onCancel,
}: {
  authorize: () => Promise<void>;
  onAuthorized: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<"attention" | "pin" | "passkey">(
    "attention",
  );
  const [hasPin, setHasPin] = useState(false);
  const pinVerified = useRef(false);
  const active = useRef(true);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const close = () => {
    active.current = false;
    onCancel();
  };
  const authenticate = async () => {
    if (lock.current || !pinVerified.current || !active.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setStep("passkey");
    try {
      await authorize();
      if (active.current) onAuthorized();
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to verify the parent passkey. Please try again.",
        );
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  };

  if (step === "pin")
    return (
      <MasterPinSheet
        alreadySet={hasPin}
        verifyOnly
        purpose="passkey"
        onSaved={() => {}}
        onClose={() => {
          if (!pinVerified.current) close();
        }}
        onVerified={() => {
          if (pinVerified.current) return;
          pinVerified.current = true;
          void authenticate();
        }}
      />
    );

  return (
    <ParentActionSheet
      title="Parent approval"
      className="parent-attention-sheet"
      backdropClassName="parent-attention-backdrop"
      onClose={close}
    >
      {step === "passkey" ? (
        <div className="parent-attention-content">
          <p>Confirm with your parent&apos;s passkey to approve this device.</p>
          {error && <ActionStatus state="error" message={error} />}
          <button
            className="filled-action-button parent-attention-continue"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void authenticate()}
          >
            {busy && (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            )}
            {busy ? "Verifying passkey…" : "Try passkey again"}
          </button>
        </div>
      ) : (
        <ParentAttentionContent
          onContinue={() => {
            setHasPin(hasMasterPinCredential());
            setStep("pin");
          }}
        />
      )}
    </ParentActionSheet>
  );
}
