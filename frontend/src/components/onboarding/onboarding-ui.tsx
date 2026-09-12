import { CheckCircle2, Circle, Info, LoaderCircle } from "lucide-react";
import Image from "next/image";
import { steps } from "@/lib/onboarding";
import type { Operation } from "./types";

type ArtworkVariant = "wallet" | "home" | "child" | "clipboard" | "family";

export function Progress({ step }: { step: number }) {
  const progressSteps = steps.slice(1);
  const currentStep = step - 1;

  return (
    <div
      className="progress-dots"
      role="progressbar"
      aria-label={`${steps[step]}, step ${currentStep + 1} of ${progressSteps.length}`}
      aria-valuemin={1}
      aria-valuemax={progressSteps.length}
      aria-valuenow={currentStep + 1}
    >
      {progressSteps.map((label, index) => (
        <span className={index === currentStep ? "active" : ""} key={label} />
      ))}
    </div>
  );
}

export function Artwork({
  src,
  alt,
  variant,
}: {
  src: string;
  alt: string;
  variant: ArtworkVariant;
}) {
  return (
    <div className={`artwork artwork-${variant}`}>
      <span className="sparkle sparkle-one" aria-hidden="true">
        +
      </span>
      <span className="sparkle sparkle-two" aria-hidden="true">
        +
      </span>
      <span className="sparkle sparkle-three" aria-hidden="true">
        +
      </span>
      <Image src={src} alt={alt} width={380} height={380} />
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  mono?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className={mono ? "mono" : ""}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
    </label>
  );
}

export function ReadOnlyField({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help?: string;
}) {
  const fieldId = `readonly-${label.toLowerCase().replaceAll(" ", "-")}`;
  const tooltipId = `${fieldId}-help`;

  return (
    <div className="field">
      <div className="field-label-row">
        <label htmlFor={fieldId}>{label}</label>
        {help && (
          <span className="field-info">
            <button
              className="field-info-button"
              type="button"
              aria-label={`About ${label}`}
              aria-describedby={tooltipId}
            >
              <Info size={13} />
            </button>
            <span className="field-tooltip" id={tooltipId} role="tooltip">
              {help}
            </span>
          </span>
        )}
      </div>
      <input id={fieldId} value={value} readOnly aria-readonly="true" />
    </div>
  );
}

export function OperationMessage({ operation }: { operation: Operation }) {
  if (
    operation.state === "idle" ||
    (operation.state === "working" && !operation.message)
  )
    return null;

  return (
    <div
      className={`operation-message ${operation.state}`}
      role={operation.state === "error" ? "alert" : "status"}
    >
      {operation.state === "working" && (
        <LoaderCircle className="spin" size={18} />
      )}
      {operation.state === "success" && <CheckCircle2 size={18} />}
      {operation.state === "error" && <Circle size={18} />}
      <span>{operation.message}</span>
    </div>
  );
}
