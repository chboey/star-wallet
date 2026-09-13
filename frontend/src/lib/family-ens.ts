import {
  bytesToHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  namehash,
  type Address,
  type Hex,
} from "viem";
import { ensRegistrarAbi } from "@star/contracts/abi";
import { starApi, type TransactionIntent } from "./star-api";

/** Persist the reveal secret before signing; retries/resumes use the same commitment. */
export async function registerFamilyEns({
  name,
  parent,
  send,
  onMessage,
  api = starApi,
  storage = sessionStorage,
  wait = () => new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
}: {
  name: string;
  parent: Address;
  send: (intent: TransactionIntent) => Promise<unknown>;
  onMessage: (message: string) => void;
  api?: Pick<typeof starApi, "prepareEnsFamily">;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  wait?: () => Promise<void>;
}) {
  const [label, ...suffix] = name.split(".");
  if (!label || suffix.length !== 2 || suffix[1] !== "eth")
    throw new Error("Invalid family ENS name.");
  const key = `star:ens-family:11155111:${parent.toLowerCase()}:${name}`;
  let secret = storage.getItem(key);
  if (!secret) {
    secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    storage.setItem(key, secret);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(secret) || /^0x0{64}$/.test(secret))
    throw new Error("Invalid saved family-name reservation.");
  for (let attempt = 0; attempt < 90; attempt++) {
    const plan = await api.prepareEnsFamily({ label, signer: parent, secret });
    if (plan.name !== name)
      throw new Error("ENS response does not match this family's name.");
    if (plan.status === "READY") {
      storage.removeItem(key);
      return;
    }
    if (plan.status === "WAITING") {
      onMessage("Waiting for your family-name reservation to confirm…");
      await wait();
      continue;
    }
    const tx = plan.transaction;
    if (
      tx.chainId !== 11155111 ||
      getAddress(tx.from) !== getAddress(parent) ||
      tx.value !== "0"
    )
      throw new Error(
        "Family-name registration requires the connected parent on Sepolia.",
      );
    const commitment = keccak256(
      encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "address" },
          { type: "bytes32" },
          { type: "string" },
          { type: "address" },
          { type: "bytes32" },
        ],
        [
          11155111n,
          tx.to,
          namehash(suffix.join(".")),
          label,
          parent,
          secret as Hex,
        ],
      ),
    );
    const expected =
      plan.step === "COMMIT_FAMILY_NAME"
        ? encodeFunctionData({
            abi: ensRegistrarAbi,
            functionName: "commit",
            args: [commitment],
          })
        : plan.step === "REGISTER_FAMILY_NAME"
          ? encodeFunctionData({
              abi: ensRegistrarAbi,
              functionName: "registerFamily",
              args: [label, secret as Hex],
            })
          : null;
    if (!expected || tx.data.toLowerCase() !== expected.toLowerCase())
      throw new Error(
        "Unexpected family-name transaction. No transaction was signed.",
      );
    const message =
      plan.step === "COMMIT_FAMILY_NAME"
        ? "Reserve your family name: confirm in your wallet."
        : "Claim your family name: confirm in your wallet.";
    onMessage(message);
    await send({ ...tx, signerRole: "PARENT", summary: message });
  }
  throw new Error(
    "Family-name registration is still confirming. Continue to resume safely.",
  );
}
