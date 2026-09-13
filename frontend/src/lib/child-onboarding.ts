import { decodeFunctionData, getAddress } from "viem";
import { childAccountAbi } from "@star/contracts/abi";
import {
  starApi,
  type TransactionIntent,
  type ChildCredential,
} from "./star-api";

type OnboardingApi = Pick<typeof starApi, "intent" | "prepareEnsSubdomain">;
type Send = (intent: TransactionIntent) => Promise<unknown>;

/** Each confirmed ENS step is read back before preparing the next. Safe to resume. */
export async function registerOnboardingEns({
  name,
  parent,
  receiver,
  send,
  onMessage,
  api = starApi,
}: {
  name: string;
  parent: `0x${string}`;
  receiver: `0x${string}`;
  send: Send;
  onMessage: (message: string) => void;
  api?: OnboardingApi;
}) {
  const [label, ...suffix] = name.split(".");
  if (!label || !suffix.length) throw new Error("Invalid onboarding ENS name.");
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const plan = await api.prepareEnsSubdomain({
      parentName: suffix.join("."),
      label,
      signer: parent,
      owner: parent,
      address: receiver,
    });
    if (plan.status === "READY") return;
    if (getAddress(plan.transaction.from) !== getAddress(parent)) {
      throw new Error("ENS setup requires the connected parent wallet.");
    }
    const message = `Setting up ${name}: confirm in your parent wallet.`;
    onMessage(message);
    await send({ ...plan.transaction, signerRole: "PARENT", summary: message });
  }
  throw new Error(
    "ENS setup has not finished. Continue to resume confirmed steps.",
  );
}

/** No child keys or saved calldata. Resume from the factory and registry's current state. */
export async function provisionChild({
  familyId,
  ensName,
  parent,
  credential,
  send,
  sendChild,
  onMessage,
  onProgress,
  api = starApi,
}: {
  familyId: string;
  ensName: string;
  parent: `0x${string}`;
  credential: ChildCredential;
  send: Send;
  sendChild: Send;
  onMessage: (message: string) => void;
  onProgress: (state: {
    childWallet: string;
    registrationId?: string;
    registrationProposed?: boolean;
  }) => void;
  api?: OnboardingApi;
}) {
  onMessage("Preparing the child passkey account…");
  const account = await api.intent("createChildAccount", {
    familyId,
    ensName,
    credential,
  });
  if (getAddress(account.parent) !== getAddress(parent)) {
    throw new Error(
      "Connect this family's parent wallet to create the child account.",
    );
  }
  for (const intent of account.intents) await send(intent);
  onProgress({ childWallet: account.childWallet });
  await registerOnboardingEns({
    name: ensName,
    parent,
    receiver: account.childWallet,
    send,
    onMessage,
    api,
  });
  const body = { familyId, ensName, childWallet: account.childWallet };
  const registration = await api.intent("registerChild", body);
  if (
    registration.ensName !== ensName ||
    getAddress(registration.childWallet) !== getAddress(account.childWallet)
  )
    throw new Error("Registration does not match the requested child.");
  onProgress({
    childWallet: account.childWallet,
    registrationId: registration.registrationId,
    registrationProposed: registration.registrationState !== "UNREGISTERED",
  });
  for (const intent of registration.intents) {
    onMessage(intent.summary);
    if (intent.signerRole === "CHILD") {
      const decoded = decodeFunctionData({
        abi: childAccountAbi,
        data: intent.data,
      });
      if (
        getAddress(intent.to) !== getAddress(account.childWallet) ||
        decoded.functionName !== "acceptRegistration" ||
        decoded.args[0] !== registration.registrationId
      )
        throw new Error("Unexpected child registration operation.");
      await sendChild(intent);
    } else await send(intent);
    onProgress({
      childWallet: account.childWallet,
      registrationProposed: true,
    });
  }
  const confirmed =
    registration.registrationState === "ACCEPTED"
      ? registration
      : await api.intent("registerChild", body);
  if (confirmed.registrationState !== "ACCEPTED")
    throw new Error(
      "Registration is still confirming. Continue to check again.",
    );
  return {
    childWallet: account.childWallet,
    registrationId: confirmed.registrationId,
  };
}
