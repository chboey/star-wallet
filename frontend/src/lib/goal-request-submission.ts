import type { Address } from "viem";
import { StarApiError } from "./star-api";
import type { IntentInputs } from "./star-api.contract";
import { submissionId } from "./star-submissions";

export async function submitGoalRequest(
  input: Omit<IntentInputs["requestGoal"], "submissionId"> & {
    goalsAddress: Address;
  },
  execute: (
    action: "requestGoal",
    body: IntentInputs["requestGoal"],
    role: "CHILD",
  ) => Promise<unknown>,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = sessionStorage,
) {
  const title = input.title.trim();
  const reason = input.reason.trim();
  if (
    !title ||
    new TextEncoder().encode(title).length > 64 ||
    new TextEncoder().encode(reason).length > 480 ||
    !Number.isInteger(input.icon) ||
    input.icon < 0 ||
    input.icon > 6
  )
    throw new Error(
      "Choose an illustration and use a short goal name and reason.",
    );
  const key = `star:goal-request:${input.goalsAddress.toLowerCase()}:${input.childId}`;
  try {
    await execute(
      "requestGoal",
      {
        childId: input.childId,
        title,
        reason,
        icon: input.icon,
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
