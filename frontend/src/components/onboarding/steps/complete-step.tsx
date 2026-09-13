"use client";

import { ChevronRight, House, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { OnboardingDraft } from "@/lib/onboarding";
import { Artwork, OperationMessage } from "../onboarding-ui";
import type { Operation } from "../types";

export function CompleteStep({
  draft,
  onContinue,
  operation = { state: "idle" },
}: {
  draft: OnboardingDraft;
  onContinue: () => void;
  operation?: Operation;
}) {
  return (
    <div className="step-screen complete-step">
      <div className="step-body">
        <div className="center-copy heading-only step-heading">
          <h1>Your family is ready</h1>
        </div>
        <div className="completion-artwork">
          <Artwork
            src="/illustrations/onboarding/family.png"
            alt="The family together"
            variant="family"
          />
        </div>
        <div className="step-details">
          <div className="summary-card">
            <SummaryRow
              icon={<House />}
              label="Family"
              value={draft.familyName}
            />
            <SummaryRow
              icon={<UserRound />}
              label="Child"
              value={draft.childName}
            />
          </div>
        </div>
      </div>
      <div className="step-actions">
        <OperationMessage operation={operation} />
        <button
          className="primary-button"
          type="button"
          onClick={onContinue}
          disabled={operation.state === "working"}
        >
          Choose a profile
        </button>
      </div>
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="summary-row">
      <span>{icon}</span>
      <strong>{label}</strong>
      <em>{value}</em>
      <ChevronRight size={17} />
    </div>
  );
}
