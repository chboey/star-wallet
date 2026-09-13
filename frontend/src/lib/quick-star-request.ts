import type { Address } from "viem";
import { StarApiError, type IntentInputs } from "./star-api";
import { submissionId } from "./star-submissions";

export const quickStarAmounts = [10, 20, 50] as const;
export type QuickStarAmount = (typeof quickStarAmounts)[number];

export async function submitQuickStarRequest(
  input: { childId: string; workflow: Address; stars: QuickStarAmount },
  execute: (
    action: "requestStars",
    body: IntentInputs["requestStars"],
    role: "CHILD",
  ) => Promise<unknown>,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = sessionStorage,
) {
  if (!quickStarAmounts.includes(input.stars))
    throw new Error("Choose 10, 20, or 50 Stars.");
  const key = `star:request:${input.workflow}:${input.childId}`;
  try {
    await execute(
      "requestStars",
      {
        childId: input.childId,
        stars: String(input.stars),
        text: `Please add ${input.stars} Stars to my account.`,
        submissionId: submissionId(key, storage),
      },
      "CHILD",
    );
    storage.removeItem(key);
  } catch (error) {
    if (
      error instanceof StarApiError &&
      error.code === "SUBMISSION_ALREADY_RECORDED"
    )
      storage.removeItem(key);
    throw error;
  }
}
