import type { Address, Hex } from "viem";
import type { IndexingMetadata } from "./star-api.types";

export type InboxView = "available" | "waiting" | "history";
type InboxChild = { id: string; wallet: Address; ensName: string };
export type Quest = {
  id: string;
  questId: string;
  workflow: Address;
  child: InboxChild;
  title: string;
  stars: string;
  status: "ACTIVE" | "SUBMITTED" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
};
export type StarRequest = {
  id: string;
  requestId: string;
  workflow: Address;
  child: InboxChild;
  quest: { id: string; questId: string; title: string } | null;
  stars: string;
  reason: string;
  submissionId: Hex;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  reward: { id: string; transactionHash: Hex } | null;
  createdAt: string;
  updatedAt: string;
  creationTransactionHash: Hex;
  resolutionTransactionHash: Hex | null;
};
export type InboxPage = {
  quests: Quest[];
  requests: StarRequest[];
  nextOffset: number | null;
  indexing: IndexingMetadata;
};
