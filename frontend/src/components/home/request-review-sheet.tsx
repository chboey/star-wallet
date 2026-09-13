"use client";

import { useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { StarRequest } from "@/lib/quest-types";
import { questIllustration } from "@/lib/quest-templates";
import { displayEnsName } from "@/lib/star-format";
import { ParentActionSheet } from "./parent-action-sheet";
import { KidIllustration } from "./kid-ui";
import { StarValue } from "./home-ui";
import { IntentStatus } from "./action-status";
import { ParentTransactionDetails } from "./parent-transaction-details";
import { useStarIntents, type IntentOperation } from "./use-star-intents";
import { useStarData } from "./star-data-provider";

export function RequestReviewSheet({
  request,
  onClose,
  onBusyChange,
}: {
  request: StarRequest;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { family } = useStarData();
  const { execute, operation } = useStarIntents();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(
    null,
  );
  const lock = useRef(false);
  const close = () => {
    if (!lock.current) onClose();
  };
  const approveDisabled =
    !family?.active ||
    !family.children.find((child) => child.id === request.child.id)?.active;
  const decide = async (approved: boolean) => {
    if (
      lock.current ||
      decision ||
      request.status !== "PENDING" ||
      (approved && approveDisabled)
    )
      return;
    lock.current = true;
    setPending(approved ? "approve" : "reject");
    onBusyChange(true);
    try {
      if (approved) {
        await execute(
          "approveStarRequest",
          {
            childId: request.child.id,
            id: request.requestId,
            stars: request.stars,
          },
          "PARENT",
        );
      } else {
        await execute(
          "rejectStarRequest",
          { childId: request.child.id, id: request.requestId },
          "PARENT",
        );
      }
      setDecision(approved ? "approved" : "rejected");
    } catch {
      // Keep the request open for retry; the shared status displays the error.
    } finally {
      lock.current = false;
      setPending(null);
      onBusyChange(false);
    }
  };
  return (
    <ParentActionSheet
      title={request.quest ? "Finished Quests" : "Star request"}
      onClose={close}
    >
      <RequestReviewContent
        request={request}
        pending={pending}
        decision={decision}
        operation={operation}
        approveDisabled={approveDisabled}
        onDecide={(approved) => void decide(approved)}
        onDone={close}
      />
    </ParentActionSheet>
  );
}

export function RequestReviewContent({
  request,
  pending,
  decision,
  operation,
  approveDisabled,
  onDecide,
  onDone,
}: {
  request: StarRequest;
  pending: "approve" | "reject" | null;
  decision: "approved" | "rejected" | null;
  operation: IntentOperation;
  approveDisabled: boolean;
  onDecide: (approved: boolean) => void;
  onDone: () => void;
}) {
  const busy = pending !== null;
  if (decision === "approved") {
    return (
      <div className="request-review-content request-review-success">
        <div
          className="request-review-success-status"
          role="status"
          aria-label={request.quest ? "Quest approved" : "Star request approved"}
        >
          <KidIllustration name="purple_tick" alt="" size={144} />
          <p>
            {displayEnsName(request.child.ensName, "Child")} has successfully
            received their stars!
          </p>
        </div>
        <ParentTransactionDetails
          hashes={operation.transactionHashes}
          completed={!busy && operation.state === "success"}
        />
        <button
          className="filled-action-button"
          type="button"
          disabled={busy}
          onClick={onDone}
        >
          Done
        </button>
      </div>
    );
  }
  return (
    <div className="request-review-content">
      <KidIllustration
        name={questIllustration(request.quest?.title ?? "")}
        alt=""
        size={180}
      />
      {request.quest ? (
        <>
          <p className="request-review-summary">
            <strong>{displayEnsName(request.child.ensName, "Child")}</strong>
            {" has completed the following task:"}
            <br />
            <strong>{request.quest.title}</strong>
            {" 🎉"}
          </p>
          <div className="request-review-reward">
            <span>Reward:</span>
            <StarValue>+{request.stars}</StarValue>
          </div>
        </>
      ) : (
        <p className="request-review-summary">
          <strong>{displayEnsName(request.child.ensName, "Child")}</strong>
          {" has requested for "}
          <StarValue>{request.stars}</StarValue>
        </p>
      )}
      <IntentStatus operation={operation} busy={busy} />
      {decision === "rejected" && <p role="status">Rejected</p>}
      <ParentTransactionDetails
        hashes={operation.transactionHashes}
        completed={!busy && decision !== null && operation.state === "success"}
      />
      {decision ? (
        <button className="filled-action-button" type="button" onClick={onDone}>
          Done
        </button>
      ) : (
        <div className="request-review-actions">
          <button
            className="outline-action-button"
            type="button"
            disabled={busy}
            aria-busy={pending === "reject"}
            onClick={() => onDecide(false)}
          >
            {pending === "reject" && (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            )}
            Reject
          </button>
          <button
            className="filled-action-button"
            type="button"
            disabled={busy || approveDisabled}
            aria-busy={pending === "approve"}
            onClick={() => onDecide(true)}
          >
            {pending === "approve" && (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            )}
            Approve
          </button>
        </div>
      )}
    </div>
  );
}
