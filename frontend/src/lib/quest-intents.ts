import {
  childAccountAbi,
  familyVaultAbi,
  questsAbi,
} from "@star/contracts/abi";
import { encodeFunctionData, parseAbi, type Abi, type Address } from "viem";
import type { IntentAction, IntentInputs } from "./star-api.contract";
import type {
  IntentEnvelope,
  StarVault,
  StarChild,
  TransactionIntent,
} from "./star-api.types";
type QuestFamily = {
  children: ReadonlyArray<Pick<StarChild, "id">>;
  vault?: Pick<StarVault, "id" | "questsAddress" | "usdc"> | null;
};

const actions = [
  "createQuest",
  "cancelQuest",
  "submitQuest",
  "requestStars",
  "cancelStarRequest",
  "approveStarRequest",
  "rejectStarRequest",
];
const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** Check the complete plan before showing any signing prompt, including USDC allowance. */
export function validateQuestIntents(
  action: IntentAction,
  input: IntentInputs[IntentAction],
  envelope: IntentEnvelope,
  family: QuestFamily | null,
  child: Pick<StarChild, "id" | "wallet"> | null,
) {
  if (!actions.includes(action)) return;
  if (!family?.vault?.questsAddress || !("childId" in input))
    throw new Error("Refresh the family workflow before continuing.");
  const { vault } = family;
  const isChild = ["submitQuest", "requestStars", "cancelStarRequest"].includes(
    action,
  );
  if (
    !family.children.some((c) => c.id === input.childId) ||
    (isChild && child?.id !== input.childId)
  )
    throw new Error("This action does not belong to the selected child.");
  const expected: TransactionIntent[] = [];
  const add = (
    to: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
  ) =>
    expected.push({
      chainId: 11155111,
      signerRole: isChild ? "CHILD" : "PARENT",
      to,
      data: encodeFunctionData({ abi, functionName, args }),
      value: "0",
      summary: "",
    });
  if (action === "createQuest" && "text" in input && "stars" in input)
    add(vault.questsAddress, questsAbi, "createQuest", [
      BigInt(input.childId),
      BigInt(input.stars),
      input.text,
    ]);
  if (
    action === "requestStars" &&
    "text" in input &&
    "stars" in input &&
    "submissionId" in input
  )
    add(child!.wallet, childAccountAbi, "requestStars", [
      BigInt(input.stars),
      input.text,
      input.submissionId,
    ]);
  if ("id" in input) {
    const id = BigInt(input.id);
    if (action === "cancelQuest")
      add(vault.questsAddress, questsAbi, "cancelQuest", [id]);
    if (action === "submitQuest" && "submissionId" in input)
      add(child!.wallet, childAccountAbi, "submitQuest", [
        id,
        input.submissionId,
      ]);
    if (action === "cancelStarRequest")
      add(child!.wallet, childAccountAbi, "cancelStarRequest", [id]);
    if (action === "rejectStarRequest")
      add(vault.questsAddress, questsAbi, "rejectRequest", [id]);
    if (action === "approveStarRequest" && "stars" in input) {
      add(vault.usdc, erc20, "approve", [
        vault.id,
        BigInt(input.stars) * 1_000_000n,
      ]);
      add(vault.id, familyVaultAbi, "approveStarRequest", [id]);
    }
  }
  if (
    !expected.length ||
    expected.length !== envelope.intents.length ||
    expected.some((item, i) => {
      const actual = envelope.intents[i];
      return (
        actual.chainId !== item.chainId ||
        actual.signerRole !== item.signerRole ||
        actual.to.toLowerCase() !== item.to.toLowerCase() ||
        actual.data.toLowerCase() !== item.data.toLowerCase() ||
        BigInt(actual.value) !== 0n
      );
    })
  )
    throw new Error(
      "The signing plan does not match the selected quest or Star request.",
    );
}
