import { LoaderCircle } from "lucide-react";
import { KidIllustration } from "./kid-ui";
import type { Hash } from "viem";
import { ParentTransactionDetails } from "./parent-transaction-details";

export function CancelStarRequestButton({
  busy,
  disabled,
  onCancel,
}: {
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
}) {
  return (
    <button
      className="outline-action-button"
      type="button"
      disabled={busy || disabled}
      aria-busy={busy}
      onClick={onCancel}
    >
      {busy && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
      Cancel request
    </button>
  );
}

export function QuestAssignedSuccess({
  onDone,
  transactionHashes,
  childName,
}: {
  onDone: () => void;
  transactionHashes?: readonly Hash[];
  childName: string;
}) {
  return (
    <div className="quest-assigned-success">
      <div role="status">
        <KidIllustration name="purple_tick" alt="Quest created" size={144} />
        <p>Quest has been assigned to {childName}</p>
      </div>
      <ParentTransactionDetails hashes={transactionHashes} completed />
      <button className="filled-action-button" type="button" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

export function QuestSubmitButton({
  childOnly,
  busy,
  disabled,
}: {
  childOnly: boolean;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <button
      className="filled-action-button"
      type="submit"
      disabled={busy || disabled}
      aria-busy={busy}
    >
      {busy && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
      {childOnly ? "Send request" : "Assign quest"}
    </button>
  );
}
