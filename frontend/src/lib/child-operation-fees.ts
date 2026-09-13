import type { Client, Hex, PublicClient } from "viem";

const maxChildFeePerGas = 100_000_000_000n; // Matches the backend safety cap.

/** Rundler's priority fee is distinct from an ordinary Ethereum RPC's estimate. */
export async function estimateChildOperationFees(
  client: Pick<PublicClient, "getBlock">,
  bundlerClient: Pick<Client, "request">,
) {
  const [block, priorityFee] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    bundlerClient.request<{
      Method: "rundler_maxPriorityFeePerGas";
      Parameters: [];
      ReturnType: Hex;
    }>({ method: "rundler_maxPriorityFeePerGas", params: [] }),
  ]);
  if (
    typeof priorityFee !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(priorityFee) ||
    typeof block.baseFeePerGas !== "bigint" ||
    block.baseFeePerGas < 0n
  )
    throw new Error("The child gas provider returned an invalid fee estimate.");

  const maxPriorityFeePerGas = BigInt(priorityFee);
  // Alchemy recommends a 50% base-fee buffer on Sepolia. Round up in wei.
  // https://www.alchemy.com/docs/wallets/reference/bundler-faqs
  const maxFeePerGas =
    (block.baseFeePerGas * 3n + 1n) / 2n + maxPriorityFeePerGas;
  if (maxFeePerGas > maxChildFeePerGas)
    throw new Error(
      "Child gas fees exceed the safety cap. Please try again later.",
    );
  return { maxFeePerGas, maxPriorityFeePerGas };
}
