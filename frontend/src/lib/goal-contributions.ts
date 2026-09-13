import { childAccountAbi, starGoalsAbi } from "@star/contracts/abi";
import { decodeChildCall } from "@star/contracts/child-account";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  erc20Abi,
  maxUint256,
  type Address,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import type { IntentEnvelope, StarFamily, StarGoal } from "./star-api.types";

export const goalContributionKey = (wallet?: Address, goalId?: string) =>
  ["goal-contribution", sepolia.id, wallet?.toLowerCase(), goalId] as const;
export const goalContributionConfirmationsKey = (familyId?: string | null) =>
  ["goal-contribution-confirmations", sepolia.id, familyId] as const;

export function contributionAmount(value: string): bigint | null {
  if (!/^[0-9]{1,78}$/.test(value)) return null;
  const amount = BigInt(value);
  return amount > 0n && amount <= maxUint256 ? amount : null;
}

export function contributionLimit(
  available: bigint,
  target: bigint,
  allocated: bigint,
): bigint {
  const remaining = target > allocated ? target - allocated : 0n;
  return available < remaining ? available : remaining;
}

export function validateGoalContributionIntent(
  envelope: IntentEnvelope,
  input: { wallet: Address; goalId: string; amount: string },
) {
  const amount = contributionAmount(input.amount);
  if (
    !amount ||
    !contributionAmount(input.goalId) ||
    envelope.intents.length !== 1
  )
    throw new Error("The goal contribution does not match your selection.");
  const [intent] = envelope.intents;
  if (
    intent.chainId !== sepolia.id ||
    intent.signerRole !== "CHILD" ||
    intent.value !== "0" ||
    intent.to.toLowerCase() !== input.wallet.toLowerCase()
  )
    throw new Error(
      "The contribution must target the selected child's account without transferring money.",
    );
  const decoded = decodeChildCall(intent.data);
  if (
    decoded.functionName !== "addStarsToGoal" ||
    decoded.args[0] !== BigInt(input.goalId) ||
    decoded.args[1] !== amount
  )
    throw new Error("The goal contribution does not match your selection.");
}

/** Explicit popup/submission check, pinned to one block; no polling. */
export async function readGoalContribution(
  client: Pick<PublicClient, "getBlockNumber" | "multicall" | "readContract">,
  wallet: Address,
  childId: string,
  goalId: string,
) {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const account = { address: wallet, abi: childAccountAbi } as const;
  let goalsAddress: Address;
  let starAddress: Address;
  try {
    const [address, accountVersion] = await client.multicall({
      blockNumber,
      allowFailure: false,
      contracts: [
        { ...account, functionName: "goals" },
        { ...account, functionName: "goalContributionsVersion" },
      ],
    });
    goalsAddress = address;
    const [version, token] = await client.multicall({
      blockNumber,
      allowFailure: false,
      contracts: [
        {
          address,
          abi: starGoalsAbi,
          functionName: "goalContributionsVersion",
        },
        { address, abi: starGoalsAbi, functionName: "star" },
      ],
    });
    starAddress = token;
    if (version !== 1n || accountVersion !== 1n)
      throw new Error(
        "Adding Stars needs the updated goal and child-account contracts.",
      );
  } catch (error) {
    if (error instanceof BaseError) {
      const cause = error.walk(
        (cause) =>
          cause instanceof ContractFunctionRevertedError ||
          cause instanceof ContractFunctionZeroDataError,
      );
      if (
        cause instanceof ContractFunctionRevertedError ||
        cause instanceof ContractFunctionZeroDataError
      )
        throw new Error(
          "Adding Stars needs the updated goal and child-account contracts.",
        );
    }
    throw error;
  }
  const contract = { address: goalsAddress, abi: starGoalsAbi } as const;
  const [goal, allocated, available, pendingId, reservedStars, starBalance] =
    await client.multicall({
      blockNumber,
      allowFailure: false,
      contracts: [
        { ...contract, functionName: "getGoal", args: [BigInt(goalId)] },
        { ...contract, functionName: "allocatedStars", args: [BigInt(goalId)] },
        {
          ...contract,
          functionName: "availableStars",
          args: [BigInt(childId)],
        },
        {
          ...contract,
          functionName: "pendingRedemptionForGoal",
          args: [BigInt(goalId)],
        },
        { ...contract, functionName: "reservedStars", args: [BigInt(childId)] },
        {
          address: starAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet],
        },
      ],
    });
  if (goal.childId !== BigInt(childId))
    throw new Error("This goal belongs to a different child.");
  return {
    blockNumber,
    wallet,
    childId,
    goalId,
    goalsAddress,
    allocated,
    available,
    reservedStars,
    starBalance,
    target: goal.starCost,
    status: goal.status,
    pendingId,
  };
}
export type GoalContributionSnapshot = Awaited<
  ReturnType<typeof readGoalContribution>
>;

/** Confirmed live state bridges indexer lag without changing the indexed snapshot. */
export function applyGoalContributionSnapshots(
  family: StarFamily | null,
  snapshots: readonly GoalContributionSnapshot[],
): StarFamily | null {
  if (!family) return null;
  const indexedBlock = BigInt(family.indexing?.block.number ?? 0);
  const fresh = snapshots.filter(
    (snapshot) =>
      snapshot.blockNumber > indexedBlock &&
      family.children.some(
        (child) =>
          child.id === snapshot.childId &&
          child.wallet.toLowerCase() === snapshot.wallet.toLowerCase(),
      ),
  );
  if (!fresh.length) return family;
  const statuses: readonly StarGoal["status"][] = [
    "ACTIVE",
    "COMPLETED",
    "CANCELLED",
  ];
  return {
    ...family,
    goals: family.goals.map((goal) => {
      const snapshot = fresh
        .filter(
          (item) => item.goalId === goal.id && item.childId === goal.child?.id,
        )
        .sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1))[0];
      return snapshot
        ? {
            ...goal,
            allocatedStars: snapshot.allocated.toString(),
            status: statuses[snapshot.status] ?? goal.status,
          }
        : goal;
    }),
    children: family.children.map((child) => {
      const snapshot = fresh
        .filter((item) => item.childId === child.id)
        .sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1))[0];
      return snapshot
        ? {
            ...child,
            starBalance: snapshot.starBalance.toString(),
            reservedStars: snapshot.reservedStars.toString(),
          }
        : child;
    }),
  };
}
