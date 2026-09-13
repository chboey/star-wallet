import { familyVaultAbi } from "@star/contracts/abi";
import type { QueryClient } from "@tanstack/react-query";
import {
  encodeFunctionData,
  erc20Abi,
  maxUint256,
  parseUnits,
  type Address,
} from "viem";
import { sepolia } from "viem/chains";
import type { IntentEnvelope } from "./star-api.types";
import { aquaPositionKey, aquaTopUpKey } from "./aqua-position";
import { refreshAfterWalletAction } from "./wallet-refresh";

/** Refresh the live vault balance and family reads when dismissing a confirmed deposit. */
export async function refreshWethFundingReads(
  client: QueryClient,
  familyId: string,
  vault: Address,
) {
  await Promise.all([
    ...[aquaPositionKey(vault), aquaTopUpKey(vault)].map((queryKey) =>
      client.invalidateQueries(
        { queryKey, exact: true },
        { cancelRefetch: true, throwOnError: true },
      ),
    ),
    refreshAfterWalletAction(client, "fundWeth", { familyId }, true),
  ]);
}

/** Reject excess precision rather than rounding the amount the parent entered. */
export function parseWethAmount(value: string): bigint {
  const amount = value.trim();
  if (!/^(?:\d+(?:\.\d{0,18})?|\.\d{1,18})$/.test(amount))
    throw new Error("Enter a WETH amount with up to 18 decimal places.");
  const units = parseUnits(amount, 18);
  if (units <= 0n || units > maxUint256)
    throw new Error("Enter a valid WETH amount greater than zero.");
  return units;
}

/** Validate both calls before approving anything: no arbitrary spender or unlimited allowance. */
export function validateWethFundingIntents(
  envelope: IntentEnvelope,
  { vault, weth, amount }: { vault: Address; weth: Address; amount: bigint },
) {
  if (amount <= 0n || amount > maxUint256)
    throw new Error("Enter a valid WETH amount greater than zero.");
  const expected = [
    {
      to: weth,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [vault, amount],
      }),
    },
    {
      to: vault,
      data: encodeFunctionData({
        abi: familyVaultAbi,
        functionName: "fundStrategyWeth",
        args: [amount],
      }),
    },
  ];
  if (
    envelope.intents.length !== expected.length ||
    expected.some((call, index) => {
      const actual = envelope.intents[index];
      return (
        actual.chainId !== sepolia.id ||
        actual.signerRole !== "PARENT" ||
        BigInt(actual.value) !== 0n ||
        actual.to.toLowerCase() !== call.to.toLowerCase() ||
        actual.data.toLowerCase() !== call.data.toLowerCase()
      );
    })
  )
    throw new Error("The signing plan does not match this WETH deposit.");
}
