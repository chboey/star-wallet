import type { Address, Hex } from "viem";
import type { StarGoal, IndexingMetadata } from "./star-api.types";

// Stable IDs match StarGoals' on-chain icon metadata; labels are presentation only.
export const goalIcons = [
  { id: 0, label: "Bicycle", illustration: "bicycle" },
  { id: 1, label: "Toy", illustration: "teddy" },
  { id: 2, label: "Books", illustration: "stacked_books" },
  { id: 3, label: "Art Set", illustration: "paint" },
  { id: 4, label: "Game", illustration: "console" },
  { id: 5, label: "Something else", illustration: "star_sparkle" },
  { id: 6, label: "Rocket", illustration: "rocket_sparkle" },
] as const;
export type GoalIconId = (typeof goalIcons)[number]["id"];
export type GoalRequest = {
  id: string;
  title: string;
  reason: string;
  icon: GoalIconId;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  child: { id: string; wallet: Address; ensName: string };
  goal: Pick<StarGoal, "id" | "title" | "starCost" | "status"> | null;
  submissionId: Hex;
  requestedAt: string;
  resolvedAt: string | null;
  requestTransactionHash: Hex;
  resolutionTransactionHash: Hex | null;
};
export type GoalRequestsResponse = {
  supported: boolean;
  goalsAddress: Address;
  requests: GoalRequest[];
  nextOffset: number | null;
  indexing?: IndexingMetadata;
};

export function goalIconAsset(icon: number): string {
  return (
    goalIcons.find((item) => item.id === icon)?.illustration ?? "star_sparkle"
  );
}

export function withGoalMetadata<T extends Pick<StarGoal, "id" | "title">>(
  goal: T,
  requests: readonly GoalRequest[],
): T & { icon?: GoalIconId; description?: string } {
  const request = requests.find(
    (item) =>
      item.status === "APPROVED" &&
      item.goal?.id === goal.id &&
      item.title === goal.title,
  );
  return request
    ? { ...goal, icon: request.icon, description: request.reason }
    : goal;
}
