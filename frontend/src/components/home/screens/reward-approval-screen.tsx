"use client";

import { Check, Info, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Hash } from "viem";
import { displayEnsName, goalIllustration } from "@/lib/star-format";
import { FullScreenLoader, ScreenHeader, SectionEmptyState } from "../home-ui";
import { KidIllustration } from "../kid-ui";
import { IntentStatus } from "../action-status";
import { useStarData } from "../star-data-provider";
import { useStarIntents } from "../use-star-intents";
import { ParentTransactionDetails } from "../parent-transaction-details";
import { ApproveRewardButton } from "../reward-approval-feedback";

function rewardApprovalHref(hashes: readonly Hash[]) {
  const query = new URLSearchParams({ rewardApproval: "approved" });
  for (const hash of hashes) query.append("tx", hash);
  return `/wallet?${query.toString()}`;
}

export function RewardApprovalScreen({ rewardId }: { rewardId: string }) {
  const router = useRouter();
  const { family } = useStarData();
  const { execute, operation } = useStarIntents();
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(
    null,
  );
  const [pendingDecision, setPendingDecision] = useState<
    "approved" | "rejected" | null
  >(null);
  const [redirecting, setRedirecting] = useState(false);
  const decisionLock = useRef(false);
  const redemption = family?.redemptions.find((item) => item.id === rewardId);
  const child = family?.children.find(
    (item) => item.id === redemption?.child?.id,
  );
  const childName = displayEnsName(child?.ensName, "Child");
  const busy = pendingDecision !== null;
  const transactionHashes =
    operation.state === "success" && operation.transactionHashes?.length
      ? operation.transactionHashes
      : redemption?.status !== "CANCELLED" &&
          redemption?.resolutionTransactionHash
        ? [redemption.resolutionTransactionHash]
        : [];
  const approvedHref = rewardApprovalHref(transactionHashes);

  useEffect(() => {
    if (busy || redirecting || redemption?.status !== "APPROVED") return;
    router.replace(approvedHref);
  }, [approvedHref, busy, redirecting, redemption?.status, router]);

  const decide = async (approved: boolean) => {
    if (
      decisionLock.current ||
      decision ||
      !redemption ||
      redemption.status !== "PENDING"
    )
      return;
    decisionLock.current = true;
    setPendingDecision(approved ? "approved" : "rejected");
    try {
      let approvalHashes: readonly Hash[] = [];
      await execute(
        approved ? "approveRedemption" : "rejectRedemption",
        { redemptionId: redemption.id },
        "PARENT",
        {
          onTransactionHashes: (hashes) => {
            approvalHashes = hashes;
          },
        },
      );
      if (approved) {
        setRedirecting(true);
        router.replace(rewardApprovalHref(approvalHashes));
      } else {
        setDecision("rejected");
      }
    } catch {
      // The operation state below presents the API or wallet error.
    } finally {
      decisionLock.current = false;
      setPendingDecision(null);
    }
  };

  if (redirecting || (!busy && redemption?.status === "APPROVED"))
    return <FullScreenLoader />;

  if (!family || !redemption) {
    return (
      <div className="wallet-screen approval-detail-screen">
        <ScreenHeader title="Reward approval" />
        <SectionEmptyState className="is-tall" />
        <ParentTransactionDetails
          hashes={transactionHashes}
          completed={!busy && operation.state === "success"}
        />
        <button
          className="filled-action-button full-width-action"
          type="button"
          onClick={() => router.replace("/wallet")}
        >
          Back home
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-screen approval-detail-screen reward-approval-layout">
      <ScreenHeader title="Reward approval" />
      <div className="reward-approval-content">
        <div className="detail-hero">
          <div className="detail-illustration reward-approval-illustration">
            <KidIllustration
              name={goalIllustration(
                redemption.goal.title,
                redemption.goal.icon,
              )}
              alt=""
              size={190}
            />
          </div>
          <h1>{redemption.goal.title}</h1>
          <p>Requested by {childName}</p>
        </div>

        <section className="reward-panel">
          <span>Reserved for this reward</span>
          <strong>
            {redemption.reservedStars} Stars{" "}
            <Star size={19} fill="currentColor" />
          </strong>
        </section>

        <p className="detail-info-banner">
          <Info size={19} />
          Approval burns the reserved Stars and completes the goal. It does not
          withdraw family savings.
        </p>
      </div>

      <div className="reward-approval-footer">
        <IntentStatus operation={operation} busy={busy} />
        {decision ? (
          <div className="approval-result">
            <Check size={20} />
            <strong>Reward rejected on-chain</strong>
            <ParentTransactionDetails
              hashes={transactionHashes}
              completed={!busy}
            />
            <button
              className="filled-action-button"
              type="button"
              onClick={() => router.replace("/wallet")}
            >
              Done
            </button>
          </div>
        ) : redemption.status === "PENDING" || busy ? (
          <>
            <ParentTransactionDetails
              hashes={transactionHashes}
              completed={false}
            />
            <div className="detail-actions">
              <button
                className="outline-action-button"
                type="button"
                onClick={() => void decide(false)}
                disabled={busy}
              >
                Reject
              </button>
              <ApproveRewardButton
                approving={pendingDecision === "approved"}
                disabled={busy}
                onApprove={() => void decide(true)}
              />
            </div>
          </>
        ) : (
          <div className="approval-result">
            <strong>Already {redemption.status.toLowerCase()}</strong>
            <ParentTransactionDetails
              hashes={transactionHashes}
              completed={!busy}
            />
            <button
              className="filled-action-button"
              type="button"
              onClick={() => router.replace("/wallet")}
            >
              Back home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
