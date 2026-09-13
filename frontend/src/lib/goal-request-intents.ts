import { childAccountAbi, starGoalsAbi } from "@star/contracts/abi";
import { encodeFunctionData, type Address, type Abi } from "viem";
import { sepolia } from "viem/chains";
import type { IntentAction, IntentInputs } from "./star-api.contract";
import type { IntentEnvelope, StarChild } from "./star-api.types";

export const goalRequestActions = [
  "requestGoal",
  "approveGoalRequest",
  "rejectGoalRequest",
  "cancelGoalRequest",
] as const;

export function validateGoalRequestIntents(
  action: IntentAction,
  input: IntentInputs[IntentAction],
  envelope: IntentEnvelope,
  goalsAddress: Address,
  children: readonly Pick<StarChild, "id" | "wallet">[],
  selectedChild: Pick<StarChild, "id" | "wallet"> | null,
) {
  if (!(goalRequestActions as readonly string[]).includes(action)) return;
  if (!("childId" in input))
    throw new Error("Select the child for this goal request.");
  const child = children.find((item) => item.id === input.childId);
  const childAction =
    action === "requestGoal" || action === "cancelGoalRequest";
  if (
    !child ||
    (childAction &&
      (selectedChild?.id !== child.id ||
        selectedChild.wallet.toLowerCase() !== child.wallet.toLowerCase()))
  )
    throw new Error("This goal request does not belong to the selected child.");
  let abi: Abi = starGoalsAbi;
  let args: readonly unknown[] = [];
  if (childAction) abi = childAccountAbi;
  if (
    action === "requestGoal" &&
    "submissionId" in input &&
    "reason" in input &&
    "icon" in input &&
    "title" in input
  )
    args = [input.title, input.reason, input.icon, input.submissionId];
  if ("requestId" in input)
    args =
      action === "approveGoalRequest" && "starCost" in input
        ? [BigInt(input.requestId), BigInt(input.starCost)]
        : [BigInt(input.requestId)];
  if (!args.length) throw new Error("Invalid goal request.");
  const expected = encodeFunctionData({ abi, functionName: action, args });
  const intent = envelope.intents[0];
  if (
    envelope.intents.length !== 1 ||
    intent.chainId !== sepolia.id ||
    intent.signerRole !== (childAction ? "CHILD" : "PARENT") ||
    intent.to.toLowerCase() !==
      (childAction ? child.wallet : goalsAddress).toLowerCase() ||
    intent.data.toLowerCase() !== expected.toLowerCase() ||
    BigInt(intent.value) !== 0n
  )
    throw new Error("The signing plan does not match this goal request.");
}
