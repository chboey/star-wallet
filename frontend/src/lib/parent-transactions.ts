import type { Hash, PublicClient } from "viem";

/** Report the broadcast hash immediately, not only after mining or indexing. */
export async function waitForParentTransaction(
  client: Pick<PublicClient, "waitForTransactionReceipt">,
  hash: Hash,
  onHash: (hash: Hash) => void,
) {
  onHash(hash);
  let replacementError: string | undefined;
  const receipt = await client.waitForTransactionReceipt({
    hash,
    // Viem otherwise aborts after 180 seconds even though the transaction
    // remains valid and may already have succeeded on-chain.
    timeout: 0,
    onReplaced: (replacement) => {
      onHash(replacement.transactionReceipt.transactionHash);
      if (replacement.reason === "cancelled")
        replacementError = "The transaction was cancelled in your wallet.";
      else if (replacement.reason === "replaced")
        replacementError =
          "A different transaction replaced this action in your wallet.";
    },
  });
  onHash(receipt.transactionHash);
  if (replacementError) throw new Error(replacementError);
  return receipt;
}

export function appendTransactionHash(
  hashes: readonly Hash[],
  hash: Hash,
): Hash[] {
  return hashes.some((item) => item.toLowerCase() === hash.toLowerCase())
    ? [...hashes]
    : [...hashes, hash];
}

export async function copyTransactionHash(
  hash: Hash,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
) {
  if (!/^0x[\da-f]{64}$/i.test(hash))
    throw new Error("Invalid transaction hash.");
  if (!clipboard) throw new Error("Select the transaction hash to copy it.");
  await clipboard.writeText(hash);
}
