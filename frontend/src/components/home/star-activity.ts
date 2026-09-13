import type { StarActivity, StarFamily } from "@/lib/star-api";
import {
  activityDate,
  displayEnsName,
  formatTokenAmount,
  goalIllustration,
} from "@/lib/star-format";

export type ActivityPresentation = {
  id: string;
  title: string;
  detail: string;
  amount: string | null;
  currency: "STAR" | "USDC" | "WETH" | null;
  incoming: boolean;
  homeIllustration: string;
  homeIllustrationCollection?: "home" | "kid";
  kidIllustration: string;
};

export function isVisibleActivity(activity: Pick<StarActivity, "type">) {
  // Approval already represents the completed goal in the feed. Keep the
  // on-chain completion event/state, but do not display a second activity row.
  return (
    activity.type !== "CHILD_REGISTRATION_ACCEPTED" &&
    activity.type !== "GOAL_COMPLETED"
  );
}

/** Preview the newest three eligible events without changing the full feed. */
export function presentRecentActivities(
  activities: readonly StarActivity[],
  family: Pick<StarFamily, "children" | "goals" | "rewards">,
  kidPerspective = false,
): ActivityPresentation[] {
  return activities
    .filter(isVisibleActivity)
    .sort((a, b) => {
      const aSequence = BigInt(a.sequence);
      const bSequence = BigInt(b.sequence);
      return aSequence > bSequence ? -1 : aSequence < bSequence ? 1 : 0;
    })
    .slice(0, 3)
    .map((activity) => presentActivity(activity, family, kidPerspective));
}

export function presentActivity(
  activity: StarActivity,
  family: Pick<StarFamily, "children" | "goals" | "rewards">,
  kidPerspective = false,
): ActivityPresentation {
  const child = family.children.find((item) => item.id === activity.child?.id);
  const childName = displayEnsName(child?.ensName, "Child");
  const goal = family.goals.find((item) => item.id === activity.goal?.id);
  const reward = family.rewards.find(
    (item) =>
      item.transactionHash.toLowerCase() ===
      activity.transactionHash.toLowerCase(),
  );
  const date = activityDate(activity.timestamp);
  const amount = formatTokenAmount(activity.amount, 0);
  const signedAmount = (decimals: number, digits: number, sign: "+" | "-") => {
    const formatted = formatTokenAmount(activity.amount, decimals, digits);
    return formatted === "—" ? formatted : `${sign}${formatted}`;
  };
  const base = {
    id: activity.id,
    detail: date,
    amount: null,
    currency: null,
    incoming: false,
    homeIllustration: "star",
    kidIllustration: "star_sparkle",
  } satisfies Omit<ActivityPresentation, "title">;
  // Keep a goal's artwork throughout its lifecycle; its status belongs in the
  // title, not in a replacement Star or completion icon.
  const goalArtwork = goalIllustration(goal?.title ?? "", goal?.icon);
  const goalBase = {
    ...base,
    homeIllustration: goalArtwork,
    homeIllustrationCollection: "kid",
    kidIllustration: goalArtwork,
  } satisfies Omit<ActivityPresentation, "title">;

  switch (activity.type) {
    case "STARS_REWARDED":
      return {
        ...base,
        title: kidPerspective
          ? `You received ${amount} Stars`
          : `${childName} earned ${amount} Stars`,
        detail: `${reward?.reason ?? "Star reward"} · ${date}`,
        amount: signedAmount(0, 0, "+"),
        currency: "STAR",
        incoming: true,
        homeIllustration: "girl_star",
      };
    case "PRINCIPAL_CONTRIBUTED":
      return {
        ...base,
        title: "Principal contributed",
        detail: `${childName} · ${date}`,
        amount: signedAmount(6, 2, "+"),
        currency: "USDC",
        incoming: true,
        homeIllustration: "usdc",
      };
    case "SAVINGS_USDC_WITHDRAWN":
      return {
        ...base,
        title: "USDC withdrawn",
        amount: signedAmount(6, 2, "-"),
        currency: "USDC",
        homeIllustration: "usdc",
      };
    case "STRATEGY_WETH_FUNDED":
      return {
        ...base,
        title: "WETH funded",
        amount: signedAmount(18, 6, "+"),
        currency: "WETH",
        incoming: true,
        homeIllustration: "weth",
      };
    case "STRATEGY_WETH_WITHDRAWN":
      return {
        ...base,
        title: "WETH withdrawn",
        amount: signedAmount(18, 6, "-"),
        currency: "WETH",
        homeIllustration: "weth",
      };
    case "GOAL_CREATED":
      return {
        ...goalBase,
        title: `${goal?.title ?? "Goal"} created`,
        detail: `${childName} · ${date}`,
        amount,
        currency: "STAR",
      };
    case "GOAL_STARS_ADDED":
      return {
        ...goalBase,
        title: `${amount} Stars added to ${goal?.title ?? "goal"}`,
        detail: `${childName} · ${date}`,
        amount,
        currency: "STAR",
      };
    case "GOAL_COMPLETED":
      return {
        ...goalBase,
        title: `${goal?.title ?? "Goal"} completed`,
        detail: `${childName} · ${date}`,
      };
    case "GOAL_CANCELLED":
      return {
        ...goalBase,
        title: `${goal?.title ?? "Goal"} cancelled`,
        detail: `${childName} · ${date}`,
      };
    case "REDEMPTION_REQUESTED":
      return {
        ...goalBase,
        title: kidPerspective
          ? `${goal?.title ?? "Reward"} requested`
          : `${childName} requested ${goal?.title ?? "a reward"}`,
        amount,
        currency: "STAR",
      };
    case "REDEMPTION_APPROVED":
    case "REDEMPTION_REJECTED":
    case "REDEMPTION_CANCELLED":
      return {
        ...goalBase,
        title: `${goal?.title ?? "Reward"} ${activity.type.split("_")[1].toLowerCase()}`,
        detail: `${childName} · ${date}`,
      };
    case "SAVINGS_POSITION_ACTIVE":
      return {
        ...base,
        title: "Savings position opened",
        homeIllustration: "wallet",
      };
    case "SAVINGS_POSITION_DOCKED":
      return {
        ...base,
        title: "Savings position docked",
        homeIllustration: "wallet",
      };
    case "SAVINGS_POSITION_TOPPED_UP":
      return {
        ...base,
        title: "Added to savings position",
        homeIllustration: "wallet",
      };
    case "AQUA_PAUSED":
      return {
        ...base,
        title: "Aqua access paused",
        homeIllustration: "wallet",
      };
    case "AQUA_RESUMED":
      return {
        ...base,
        title: "Aqua access resumed",
        homeIllustration: "wallet",
      };
    case "CHILD_REGISTERED":
      return {
        ...base,
        title: `${childName} joined the family`,
        homeIllustration: "girl",
      };
    case "CHILD_STATUS_UPDATED":
      return {
        ...base,
        title: `${childName} ${activity.active ? "reactivated" : "deactivated"}`,
        homeIllustration: "girl",
      };
    case "CHILD_REGISTRATION_PROPOSED":
      return {
        ...base,
        title: "Child registration proposed",
        homeIllustration: "girl",
      };
    case "CHILD_REGISTRATION_ACCEPTED":
      return {
        ...base,
        title: "Child registration accepted",
        homeIllustration: "girl",
      };
    case "CHILD_REGISTRATION_CANCELLED":
      return {
        ...base,
        title: "Child registration cancelled",
        homeIllustration: "girl",
      };
    case "FAMILY_VAULT_CREATED":
      return {
        ...base,
        title: "Family vault created",
        homeIllustration: "wallet",
      };
    case "FAMILY_STATUS_UPDATED":
      return {
        ...base,
        title: `Family ${activity.active ? "reactivated" : "deactivated"}`,
        homeIllustration: "wallet",
      };
    case "FAMILY_CREATED":
      return { ...base, title: "Family created", homeIllustration: "wallet" };
  }
}

export function isVaultActivity(activity: StarActivity): boolean {
  return (
    activity.type === "PRINCIPAL_CONTRIBUTED" ||
    activity.type === "SAVINGS_USDC_WITHDRAWN" ||
    activity.type === "STRATEGY_WETH_FUNDED" ||
    activity.type === "STRATEGY_WETH_WITHDRAWN" ||
    activity.type === "SAVINGS_POSITION_ACTIVE" ||
    activity.type === "SAVINGS_POSITION_DOCKED" ||
    activity.type === "SAVINGS_POSITION_TOPPED_UP" ||
    activity.type === "AQUA_PAUSED" ||
    activity.type === "AQUA_RESUMED"
  );
}

export function isChildActivity(
  activity: StarActivity,
  family: StarFamily,
  childId: string,
): boolean {
  if (activity.child?.id === childId) return true;
  if (activity.goal?.id) {
    return family.goals.some(
      (goal) => goal.id === activity.goal?.id && goal.child?.id === childId,
    );
  }
  if (activity.redemption?.id) {
    return family.redemptions.some(
      (redemption) =>
        redemption.id === activity.redemption?.id &&
        redemption.child?.id === childId,
    );
  }
  return false;
}
