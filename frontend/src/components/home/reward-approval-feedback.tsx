import { LoaderCircle } from "lucide-react";
import { KidIllustration } from "./kid-ui";
import type { Hash } from "viem";
import { ParentTransactionDetails } from "./parent-transaction-details";

export function ApproveRewardButton({
  approving,
  disabled,
  onApprove,
}: {
  approving: boolean;
  disabled: boolean;
  onApprove: () => void;
}) {
  return (
    <button
      className="filled-action-button"
      type="button"
      onClick={onApprove}
      disabled={disabled || approving}
      aria-busy={approving}
    >
      {approving && (
        <LoaderCircle className="spin" size={18} aria-hidden="true" />
      )}
      Approve reward
    </button>
  );
}

export function RewardApprovalSuccess({
  onDone,
  transactionHashes,
}: {
  onDone: () => void;
  transactionHashes?: readonly Hash[];
}) {
  return (
    <div className="reward-approval-success-sheet">
      <div className="reward-approval-success-content" role="status">
        <KidIllustration name="purple_tick" alt="" size={176} />
        <h2>Reward approved on-chain</h2>
      </div>
      <ParentTransactionDetails hashes={transactionHashes} completed />
      <button className="filled-action-button" type="button" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
