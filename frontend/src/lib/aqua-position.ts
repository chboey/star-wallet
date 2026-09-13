import { familyVaultAbi } from "@star/contracts/abi";
import {
  decodeFunctionData,
  maxUint256,
  parseUnits,
  type Address,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import type { IntentEnvelope } from "./star-api.types";

export const aquaPositionKey = (vault?: Address) =>
  ["aqua-position", sepolia.id, vault?.toLowerCase()] as const;

/** Read the complete vault account at one explicit block. */
export async function readAquaPosition(
  client: Pick<PublicClient, "getBlockNumber" | "multicall" | "readContract">,
  vault: Address,
) {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const contract = { address: vault, abi: familyVaultAbi } as const;
  const [account, paused, maxUsdc, maxWeth] = await client.multicall({
    blockNumber,
    allowFailure: false,
    contracts: [
      { ...contract, functionName: "getFamilyAccount" },
      { ...contract, functionName: "aquaPaused" },
      { ...contract, functionName: "maxPositionUsdc" },
      { ...contract, functionName: "maxPositionWeth" },
    ],
  });
  const [positionUsdc, positionWeth] = account.positionActive
    ? await client.readContract({
        ...contract,
        blockNumber,
        functionName: "currentPositionBalances",
      })
    : [0n, 0n];
  return {
    vault,
    blockNumber,
    ...account,
    paused,
    maxUsdc,
    maxWeth,
    positionUsdc,
    positionWeth,
  };
}

export type AquaPositionSnapshot = Awaited<ReturnType<typeof readAquaPosition>>;

export function parsePositionAmount(
  value: string,
  token: "USDC" | "WETH",
): bigint {
  const decimals = token === "USDC" ? 6 : 18;
  const amount = value.trim();
  if (
    !new RegExp(
      `^(?:\\d+(?:\\.\\d{0,${decimals}})?|\\.\\d{1,${decimals}})$`,
    ).test(amount)
  )
    throw new Error(
      `Enter a ${token} amount with up to ${decimals} decimal places.`,
    );
  const units = parseUnits(amount, decimals);
  if (units <= 0n || units > maxUint256)
    throw new Error(`Enter a ${token} amount greater than zero.`);
  return units;
}

export function validatePositionAmounts(
  state: AquaPositionSnapshot,
  usdc: bigint,
  weth: bigint,
) {
  if (state.positionActive)
    throw new Error(
      "This vault already has an Aqua position. View its on-chain details.",
    );
  if (state.paused)
    throw new Error(
      "Aqua is paused for this vault. Position creation is unavailable.",
    );
  for (const [token, amount, balance, limit] of [
    ["USDC", usdc, state.availableUsdc, state.maxUsdc],
    ["WETH", weth, state.availableWeth, state.maxWeth],
  ] as const) {
    if (amount <= 0n || amount > maxUint256)
      throw new Error(`Enter a ${token} amount greater than zero.`);
    if (amount > balance)
      throw new Error(
        `There isn’t enough ${token} available in your family vault.`,
      );
    if (amount > limit)
      throw new Error(
        `The ${token} amount exceeds this vault’s per-position limit.`,
      );
  }
}

/** Only the reviewed allocation to this vault can be signed. */
export function validateShipSavingsIntents(
  envelope: IntentEnvelope,
  expected: { vault: Address; usdc: bigint; weth: bigint },
) {
  const error = () =>
    new Error("The signing plan does not match this Aqua position.");
  if (envelope.intents.length !== 1) throw error();
  const intent = envelope.intents[0];
  if (
    intent.chainId !== sepolia.id ||
    intent.signerRole !== "PARENT" ||
    intent.to.toLowerCase() !== expected.vault.toLowerCase() ||
    BigInt(intent.value) !== 0n
  )
    throw error();
  const decoded = decodeFunctionData({
    abi: familyVaultAbi,
    data: intent.data,
  });
  if (
    decoded.functionName !== "shipSavingsPosition" ||
    decoded.args[0] === "0x" ||
    decoded.args[1] !== expected.usdc ||
    decoded.args[2] !== expected.weth
  )
    throw error();
  return decoded.args[0];
}
