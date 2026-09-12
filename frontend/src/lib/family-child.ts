import type { StarChild, StarFamily } from "./star-api.types";

// The family response already contains these complete, snapshot-pinned relations.
// Selecting a child must not fetch the same data again from /children/by-wallet.
export function childFromFamily(
  family: StarFamily | null,
  summary: StarChild | null,
): StarChild | null {
  if (!family || !summary) return null;
  return {
    ...summary,
    family: {
      id: family.id,
      ensName: family.ensName,
      ensNode: family.ensNode,
      active: family.active,
    },
    goals: family.goals.filter((goal) => goal.child?.id === summary.id),
    rewards: family.rewards.filter((reward) => reward.child?.id === summary.id),
    redemptions: family.redemptions.filter(
      (redemption) => redemption.child?.id === summary.id,
    ),
    indexing: family.indexing,
  };
}
