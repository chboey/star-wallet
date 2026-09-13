import Image from "next/image";
import { LoaderCircle } from "lucide-react";
import type { Hash } from "viem";
import { KidIllustration } from "./kid-ui";
import { ActionStatus } from "./action-status";
import { ParentTransactionDetails } from "./parent-transaction-details";

export function CloseAquaPositionContent({
  busy,
  complete,
  checking,
  disabled,
  error,
  transactionHashes,
  onConfirm,
  onDone,
  onRefresh,
}: {
  busy: boolean;
  complete: boolean;
  checking: boolean;
  disabled: boolean;
  error?: string;
  transactionHashes?: readonly Hash[];
  onConfirm: () => void;
  onDone: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="close-aqua-position-content">
      <div
        className="close-aqua-position-hero"
        role={complete ? "status" : undefined}
      >
        {complete ? (
          <KidIllustration name="purple_tick" alt="" size={144} />
        ) : (
          <Image
            src="/illustrations/profile/exclaimation_mark.png"
            alt=""
            width={144}
            height={180}
          />
        )}
        <h3>
          {complete
            ? "Position closed"
            : "Are you sure you want to close this position?"}
        </h3>
        <p>
          {complete
            ? "The position’s USDC and WETH are now available in your family vault."
            : "Its current USDC and WETH will become available in your family vault. This won’t withdraw funds to your wallet or change any Stars."}
        </p>
      </div>
      <div className="close-aqua-position-actions">
        {!complete && (
          <ActionStatus
            state="error"
            message={error}
            onRefresh={onRefresh}
            refreshing={busy || checking}
            refreshLabel="Check position again"
          />
        )}
        <ParentTransactionDetails
          hashes={transactionHashes}
          completed={complete && !busy}
        />
        <button
          className="filled-action-button"
          type="button"
          aria-busy={busy || (!complete && checking)}
          disabled={!complete && (busy || checking || disabled)}
          onClick={complete ? onDone : onConfirm}
        >
          {(busy || (!complete && checking)) && (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          )}
          {complete ? "Done" : "Close this position"}
        </button>
      </div>
    </div>
  );
}
