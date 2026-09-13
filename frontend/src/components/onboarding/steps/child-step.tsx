import type { FormEvent } from "react";
import type { OnboardingDraft } from "@/lib/onboarding";
import {
  Artwork,
  Field,
  OperationMessage,
  ReadOnlyField,
} from "../onboarding-ui";
import type { Operation } from "../types";

export function ChildStep({
  draft,
  ensName,
  operation,
  onName,
  onSubmit,
}: {
  draft: OnboardingDraft;
  ensName: string;
  operation: Operation;
  onName: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const childLabel = draft.childName.trim() || "your child";

  return (
    <form className="step-screen form-step child-step" onSubmit={onSubmit}>
      <div className="step-body">
        <div className="center-copy heading-only step-heading">
          <h1>Create {childLabel}&apos;s wallet</h1>
        </div>
        <Artwork
          src="/illustrations/onboarding/wallet-girl.png"
          alt="A child with a Star Wallet"
          variant="child"
        />
        <div className="step-details">
          <Field
            label="Child nickname"
            value={draft.childName}
            onChange={onName}
            placeholder="Child nickname"
          />
          <ReadOnlyField
            label="Child ENS name"
            value={
              ensName ||
              (draft.familyEnsName ? `child.${draft.familyEnsName}` : "")
            }
          />
          <OperationMessage operation={operation} />
        </div>
      </div>
      <div className="step-actions">
        <button
          className="primary-button"
          type="submit"
          disabled={
            draft.childName.trim().length < 2 || operation.state === "working"
          }
        >
          Set up child passkey
        </button>
      </div>
    </form>
  );
}
