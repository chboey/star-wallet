"use client";

import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { goalIconAsset } from "@/lib/goal-requests";
import { kidGoalsHref } from "@/lib/kid-goals";
import { displayEnsName } from "@/lib/star-format";
import { ParentActionSheet } from "./parent-action-sheet";
import { KidIllustration } from "./kid-ui";
import { ActionStatus, IntentStatus } from "./action-status";
import { useStarData } from "./star-data-provider";
import { useStarIntents } from "./use-star-intents";
import { ParentTransactionDetails } from "./parent-transaction-details";

type GoalRequestAction =
  | "approveGoalRequest"
  | "rejectGoalRequest"
  | "cancelGoalRequest";

export function GoalRequestSheet({
  requestId,
  childOnly = false,
  onClose,
}: {
  requestId: string;
  childOnly?: boolean;
  onClose: () => void;
}) {
  const {
    family,
    child,
    goalRequests,
    goalRequestsError,
    goalRequestsSupported,
  } = useStarData();
  const { execute, operation } = useStarIntents();
  const request = goalRequests.find(
    (item) =>
      item.id === requestId && (!childOnly || item.child.id === child?.id),
  );
  const [starCost, setStarCost] = useState("");
  const [pendingAction, setPendingAction] = useState<GoalRequestAction | null>(
    null,
  );
  const busy = pendingAction !== null;
  const [decision, setDecision] = useState<
    "APPROVED" | "REJECTED" | "CANCELLED" | null
  >(null);
  const lock = useRef(false);
  const validTarget =
    /^[1-9][0-9]{0,77}$/.test(starCost) && BigInt(starCost) < 1n << 256n;
  const active =
    family?.active &&
    family.children.some(
      (item) => item.id === request?.child.id && item.active,
    );
  const decide = async (action: GoalRequestAction) => {
    if (
      lock.current ||
      !request ||
      request.status !== "PENDING" ||
      decision ||
      !goalRequestsSupported ||
      goalRequestsError ||
      (action === "approveGoalRequest" && (!validTarget || !active))
    )
      return;
    lock.current = true;
    setPendingAction(action);
    try {
      const input = { childId: request.child.id, requestId: request.id };
      if (action === "approveGoalRequest")
        await execute(action, { ...input, starCost }, "PARENT");
      else if (action === "rejectGoalRequest")
        await execute(action, input, "PARENT");
      else await execute(action, input, "CHILD");
      setDecision(
        action === "approveGoalRequest"
          ? "APPROVED"
          : action === "rejectGoalRequest"
            ? "REJECTED"
            : "CANCELLED",
      );
    } catch {
      // The status panel keeps the request open for a deliberate retry.
    } finally {
      lock.current = false;
      setPendingAction(null);
    }
  };
  const status = decision ?? request?.status;
  return (
    <ParentActionSheet
      title={
        status === "APPROVED" && !childOnly ? "Goal Approved!" : "Goal request"
      }
      onClose={() => {
        if (!lock.current) onClose();
      }}
    >
      {request && status === "APPROVED" && !childOnly ? (
        <div className="goal-request-approval-result">
          <KidIllustration name="purple_tick" alt="" size={144} />
          <p>
            Goal Approved! Target has been set to:{" "}
            {request.goal?.starCost ?? starCost} stars
          </p>
          <ParentTransactionDetails
            hashes={
              operation.state === "success" &&
              operation.transactionHashes?.length
                ? operation.transactionHashes
                : request.resolutionTransactionHash
                  ? [request.resolutionTransactionHash]
                  : []
            }
            completed={!busy}
          />
          <button
            type="button"
            className="filled-action-button"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      ) : request ? (
        <div className="goal-request-review">
          <div className="kid-detail-hero">
            <KidIllustration
              name={goalIconAsset(request.icon)}
              alt=""
              size={180}
            />
            <h2>{request.title}</h2>
            <p>
              {childOnly
                ? "Your new dream"
                : `Requested by ${displayEnsName(request.child.ensName, "Child")}`}
            </p>
          </div>
          {request.reason && (
            <div className="goal-request-reason">
              <strong>Why {childOnly ? "you want" : "they want"} this</strong>
              <p>{request.reason}</p>
            </div>
          )}
          {status === "PENDING" ? (
            <div className="goal-request-review-controls">
              {!childOnly && (
                <label className="parent-action-field">
                  <span>Star target</span>
                  <input
                    className="amount-input"
                    value={starCost}
                    onChange={(event) => {
                      if (/^[0-9]{0,78}$/.test(event.target.value))
                        setStarCost(event.target.value);
                    }}
                    inputMode="numeric"
                    placeholder="How many Stars?"
                    disabled={busy}
                  />
                </label>
              )}
              <IntentStatus
                operation={operation}
                busy={busy}
                error={goalRequestsError?.message}
              />
              {!childOnly && (
                <ParentTransactionDetails
                  hashes={operation.transactionHashes}
                  completed={!busy && operation.state === "success"}
                />
              )}
              <div className="goal-request-review-actions">
                {childOnly ? (
                  <button
                    type="button"
                    className="outline-action-button"
                    disabled={
                      busy ||
                      !goalRequestsSupported ||
                      Boolean(goalRequestsError)
                    }
                    onClick={() => void decide("cancelGoalRequest")}
                  >
                    Cancel request
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="outline-action-button"
                      disabled={
                        busy ||
                        !goalRequestsSupported ||
                        Boolean(goalRequestsError)
                      }
                      onClick={() => void decide("rejectGoalRequest")}
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      className="filled-action-button"
                      aria-busy={pendingAction === "approveGoalRequest"}
                      disabled={
                        busy ||
                        !active ||
                        !validTarget ||
                        !goalRequestsSupported ||
                        Boolean(goalRequestsError)
                      }
                      onClick={() => void decide("approveGoalRequest")}
                    >
                      {pendingAction === "approveGoalRequest" && (
                        <LoaderCircle
                          className="spin"
                          size={18}
                          aria-hidden="true"
                        />
                      )}
                      Approve goal
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="goal-request-review-controls">
              <ActionStatus
                state={status === "APPROVED" ? "success" : "info"}
                message={
                  status === "APPROVED"
                    ? `Target: ${request.goal?.starCost ?? starCost} Stars.`
                    : status === "REJECTED"
                      ? "This goal request was declined."
                      : "This goal request was cancelled."
                }
              />
              {!childOnly && (
                <ParentTransactionDetails
                  hashes={
                    operation.state === "success" &&
                    operation.transactionHashes?.length
                      ? operation.transactionHashes
                      : status !== "CANCELLED" &&
                          request.resolutionTransactionHash
                        ? [request.resolutionTransactionHash]
                        : []
                  }
                  completed={!busy}
                />
              )}
              {childOnly && status === "APPROVED" ? (
                <Link
                  className="filled-action-button"
                  href={kidGoalsHref({ goalId: request.goal?.id })}
                  onClick={onClose}
                >
                  View goals
                </Link>
              ) : (
                <button
                  type="button"
                  className="filled-action-button"
                  onClick={onClose}
                >
                  Done
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <ActionStatus message="This goal request is no longer available. Refresh your wallet and try again." />
      )}
    </ParentActionSheet>
  );
}
