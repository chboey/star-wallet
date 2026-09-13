import { Check, Circle, Copy, LoaderCircle } from "lucide-react";
import type { OnboardingDraft } from "@/lib/onboarding";
import { Artwork, OperationMessage } from "../onboarding-ui";
import type { Operation } from "../types";

export function ConfirmStep({
  draft,
  operation,
  ensCopied,
  onCopy,
  onPropose,
}: {
  draft: OnboardingDraft;
  operation: Operation;
  ensCopied: boolean;
  onCopy: () => void;
  onPropose: () => void;
}) {
  return (
    <div className="step-screen confirm-step">
      <div className="step-body">
        <div className="center-copy heading-only step-heading">
          <h1>Confirm {draft.childName}</h1>
        </div>
        <Artwork
          src="/illustrations/onboarding/clipboard.png"
          alt="A checklist with three completed items"
          variant="clipboard"
        />
        <div className="step-details">
          <div className="checklist-card">
            <CheckRow
              done={Boolean(draft.childWallet)}
              title="Child passkey account created"
            />
            <CheckRow
              done={draft.registrationProposed}
              title={`ENS points to ${draft.childName}'s wallet`}
            />
            <CheckRow
              done={draft.registrationProposed}
              title="Wallet registration proposed"
            />
            <CheckRow
              done={draft.registrationAccepted}
              active={draft.registrationProposed && !draft.registrationAccepted}
              title="Child passkey confirms registration"
            />
          </div>
          <button className="copy-link" type="button" onClick={onCopy}>
            {ensCopied ? <Check size={15} /> : <Copy size={15} />}
            {ensCopied ? "ENS name copied" : draft.childEnsName}
          </button>
          <OperationMessage operation={operation} />
        </div>
      </div>
      <div className="step-actions">
        {!draft.registrationAccepted ? (
          <button
            className="primary-button"
            type="button"
            onClick={onPropose}
            disabled={operation.state === "working"}
          >
            {draft.registrationProposed ? "Finish setup" : "Create child account"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CheckRow({
  done,
  active,
  title,
}: {
  done: boolean;
  active?: boolean;
  title: string;
}) {
  return (
    <div className={`check-row ${active ? "active" : ""}`}>
      <span>
        {done ? (
          <Check size={16} />
        ) : active ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Circle size={16} />
        )}
      </span>
      <strong>{title}</strong>
    </div>
  );
}
