import type { FormEvent } from "react";
import type { OnboardingDraft } from "@/lib/onboarding";
import {
  Artwork,
  Field,
  OperationMessage,
  ReadOnlyField,
} from "../onboarding-ui";
import type { Operation } from "../types";

export function FamilyStep({
  draft,
  ensName,
  ensRoot,
  operation,
  onChange,
  onSubmit,
}: {
  draft: OnboardingDraft;
  ensName: string;
  ensRoot: string;
  operation: Operation;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="step-screen form-step family-step" onSubmit={onSubmit}>
      <div className="step-body">
        <div className="center-copy heading-only step-heading">
          <h1>Create your family</h1>
        </div>
        <Artwork
          src="/illustrations/onboarding/home.png"
          alt="A purple family home"
          variant="home"
        />
        <div className="step-details">
          <Field
            label="Family nickname"
            value={draft.familyName}
            onChange={onChange}
            placeholder="Your family nickname"
          />
          <ReadOnlyField
            label="Family ENS name"
            value={ensName || (ensRoot ? `your-family.${ensRoot}` : "")}
            help="Your public family identity"
          />
          <OperationMessage operation={operation} />
        </div>
      </div>
      <div className="step-actions">
        <button
          className="primary-button"
          type="submit"
          disabled={
            !ensRoot ||
            operation.state === "working" ||
            draft.familyName.trim().length < 2
          }
        >
          Create family
        </button>
      </div>
    </form>
  );
}
