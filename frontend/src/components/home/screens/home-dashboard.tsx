"use client";

import { ChevronRight, ListChecks, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Hash } from "viem";
import {
  availableStars,
  displayEnsName,
  formatTokenAmount,
} from "@/lib/star-format";
import {
  HomeIllustration,
  SectionEmptyState,
  SectionTitle,
  StarValue,
} from "../home-ui";
import {
  ParentRewardStarsSheet,
  type ParentChildChoice,
  type RewardPanel,
} from "../parent-action-sheets";
import { ParentActivitySheet } from "../parent-activity-sheet";
import { isVisibleActivity, presentRecentActivities } from "../star-activity";
import { useStarData } from "../star-data-provider";
import { WalletActivitySheet } from "../wallet-activity-sheet";
import { ParentQuestInboxSheet } from "../quest-inbox";
import { GoalRequestSheet } from "../goal-request-sheet";
import { useParentAttention } from "../use-parent-attention";
import { ParentAttentionList } from "../parent-attention-list";
import { RequestReviewSheet } from "../request-review-sheet";
import type { StarRequest } from "@/lib/quest-types";
import { ParentActionSheet } from "../parent-action-sheet";
import { RewardApprovalSuccess } from "../reward-approval-feedback";

export function HomeDashboard({
  initialQuestInboxOpen = false,
  initialRewardPanel,
  initialRewardApprovalHashes,
}: {
  initialQuestInboxOpen?: boolean;
  initialRewardPanel?: RewardPanel;
  initialRewardApprovalHashes?: readonly Hash[];
} = {}) {
  const router = useRouter();
  const { family, familyName, portfolio } = useStarData();
  const activities = (family?.activities ?? []).filter(isVisibleActivity);
  const attention = useParentAttention();
  const [rewardPanel, setRewardPanel] = useState<RewardPanel | null>(
    initialRewardPanel ?? null,
  );
  const [walletActivityOpen, setWalletActivityOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [questInboxOpen, setQuestInboxOpen] = useState(initialQuestInboxOpen);
  const [attentionRequest, setAttentionRequest] = useState<StarRequest | null>(
    null,
  );
  const [goalRequestId, setGoalRequestId] = useState<string | null>(null);
  const [rewardApprovalOpen, setRewardApprovalOpen] = useState(
    initialRewardApprovalHashes !== undefined,
  );
  const closeRewardApproval = () => {
    setRewardApprovalOpen(false);
    router.replace("/wallet");
  };
  const children: ParentChildChoice[] = (family?.children ?? [])
    .filter((child) => child.active)
    .map((child) => ({
      id: child.id,
      name: displayEnsName(child.ensName, "Child"),
    }));
  const recentActivities = family
    ? presentRecentActivities(activities, family)
    : [];
  const usdc = formatTokenAmount(
    portfolio?.parentWallet?.usdc.amount,
    portfolio?.parentWallet?.usdc.decimals ?? 6,
    2,
  );
  const weth = formatTokenAmount(
    portfolio?.parentWallet?.weth.amount,
    portfolio?.parentWallet?.weth.decimals ?? 18,
    6,
  );

  return (
    <div className="wallet-screen home-dashboard">
      <header className="dashboard-header">
        <HomeIllustration name="dad" alt="" size={58} />
        <div>
          <p>
            Welcome back!
            <HomeIllustration
              className="greeting-sun"
              name="sunshine"
              alt=""
              size={18}
            />
          </p>
          {family && <button type="button">{familyName}&apos;s Family</button>}
        </div>
      </header>

      {family && portfolio ? (
        <section className="family-wallet-card">
          <button
            className="wallet-activity-trigger"
            type="button"
            aria-label={`Open wallet activity for ${usdc} USDC and ${weth} WETH`}
            onClick={() => setWalletActivityOpen(true)}
          />
          <div>
            <span>Your wallet</span>
            <strong>
              {usdc} <small>USDC</small>
            </strong>
            <p>+ {weth} WETH</p>
          </div>
          <span className="wallet-card-art">
            <HomeIllustration name="wallet" alt="" size={96} />
          </span>
        </section>
      ) : (
        <section>
          <SectionEmptyState />
        </section>
      )}

      <section>
        <SectionTitle>Children</SectionTitle>
        <div className="children-overview-list">
          {(family?.children ?? []).map((child) => {
            const available = availableStars(child);
            return (
              <article className="child-overview-card" key={child.id}>
                <HomeIllustration name="girl" alt="" size={72} />
                <div className="child-overview-main">
                  <div className="child-identity">
                    <strong>{displayEnsName(child.ensName, "Child")}</strong>
                    <span>{child.active ? "Active" : "Inactive"}</span>
                  </div>
                </div>
                <div className="available-stars">
                  <span className="available-stars-label">Available Stars</span>
                  <span className="available-stars-value">
                    <strong>{available.toString()}</strong>
                    <Star size={16} fill="currentColor" aria-hidden="true" />
                  </span>
                </div>
              </article>
            );
          })}
          {!family?.children.length && <SectionEmptyState />}
        </div>
      </section>

      <section className="parent-quick-actions" aria-label="Parent actions">
        <button
          type="button"
          onClick={() => setRewardPanel("reward")}
          disabled={!family?.vault}
        >
          <span className="parent-quick-action-icon parent-quick-action-star">
            <Star size={20} fill="currentColor" />
          </span>
          <span>
            <strong>Reward Stars</strong>
            <small>Celebrate a win</small>
          </span>
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          onClick={() => setQuestInboxOpen(true)}
          disabled={!family?.vault}
        >
          <span className="parent-quick-action-icon">
            <ListChecks size={21} />
          </span>
          <span>
            <strong>Quests</strong>
            <small>Assign and review</small>
          </span>
          <ChevronRight size={16} />
        </button>
      </section>

      <section>
        <SectionTitle>Needs attention</SectionTitle>
        <ParentAttentionList
          items={attention.items}
          childProfiles={family?.children ?? []}
          loading={attention.loading}
          refreshing={attention.refreshing}
          error={attention.error}
          onRetry={() => void attention.refresh()}
          onOpen={(item) => {
            if (item.kind === "goal") setGoalRequestId(item.request.id);
            if (item.kind === "stars" || item.kind === "quest") {
              setRewardPanel(null);
              setQuestInboxOpen(false);
              setAttentionRequest(item.request);
            }
          }}
        />
      </section>

      <section>
        <SectionTitle
          action={
            activities.length ? (
              <button
                className="section-see-all"
                type="button"
                onClick={() => setActivityOpen(true)}
              >
                See all <ChevronRight size={14} />
              </button>
            ) : undefined
          }
        >
          Recent activity
        </SectionTitle>
        {recentActivities.length ? (
          recentActivities.map((row) => (
            <div className="activity-row" key={row.id}>
              <HomeIllustration
                name={row.homeIllustration}
                collection={row.homeIllustrationCollection}
                alt=""
                size={48}
              />
              <span>
                <strong>{row.title}</strong>
                <small>{row.detail}</small>
              </span>
              {row.amount &&
                (row.currency === "STAR" ? (
                  <StarValue compact>{row.amount}</StarValue>
                ) : (
                  <span className="activity-row-token-amount">
                    <strong>{row.amount}</strong>
                    <small>{row.currency}</small>
                  </span>
                ))}
            </div>
          ))
        ) : (
          <SectionEmptyState />
        )}
      </section>

      {rewardPanel !== null && (
        <ParentRewardStarsSheet
          childChoices={children}
          initialPanel={rewardPanel}
          onClose={() => {
            setRewardPanel(null);
          }}
        />
      )}
      {questInboxOpen && (
        <ParentQuestInboxSheet
          onClose={() => {
            setQuestInboxOpen(false);
          }}
        />
      )}
      {attentionRequest && (
        <RequestReviewSheet
          key={attentionRequest.id}
          request={attentionRequest}
          onBusyChange={() => {}}
          onClose={() => setAttentionRequest(null)}
        />
      )}
      {goalRequestId && (
        <GoalRequestSheet
          requestId={goalRequestId}
          onClose={() => setGoalRequestId(null)}
        />
      )}
      {walletActivityOpen && (
        <WalletActivitySheet onClose={() => setWalletActivityOpen(false)} />
      )}
      {activityOpen && (
        <ParentActivitySheet onClose={() => setActivityOpen(false)} />
      )}
      {rewardApprovalOpen && (
        <ParentActionSheet
          title="Reward approval"
          onClose={closeRewardApproval}
        >
          <RewardApprovalSuccess
            transactionHashes={initialRewardApprovalHashes}
            onDone={closeRewardApproval}
          />
        </ParentActionSheet>
      )}
    </div>
  );
}
