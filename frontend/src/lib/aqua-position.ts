import { familyVaultAbi } from "@star/contracts/abi";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  decodeFunctionData,
  encodeFunctionData,
  maxUint256,
  parseUnits,
  type Address,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import type { IntentEnvelope } from "./star-api.types";

export const aquaPositionKey = (vault?: Address) =>
  ["aqua-position", sepolia.id, vault?.toLowerCase()] as const;

export const aquaTopUpKey = (vault?: Address) =>
  [...aquaPositionKey(vault), "top-up"] as const;

/** A separate capability check keeps viewing/closing older vaults working. */
export async function readAquaTopUpPosition(
  client: Parameters<typeof readAquaPosition>[0],
  vault: Address,
) {
  const state = await readAquaPosition(client, vault);
  const unsupported = () =>
    new Error(
      "This vault does not support adding existing vault funds. A new vault deployment and migration are required. You can still close this position.",
    );
  try {
    const version = await client.readContract({
      address: vault,
      abi: familyVaultAbi,
      functionName: "savingsTopUpsVersion",
      blockNumber: state.blockNumber,
    });
    if (version !== 1n) throw unsupported();
  } catch (error) {
    if (error instanceof BaseError) {
      const cause = error.walk(
        (item) =>
          item instanceof ContractFunctionRevertedError ||
          item instanceof ContractFunctionZeroDataError,
      );
      if (
        cause instanceof ContractFunctionRevertedError ||
        cause instanceof ContractFunctionZeroDataError
      )
        throw unsupported();
    }
    throw error;
  }
  return state;
}

/** One explicit, block-consistent check; never infer a position from token holdings. */
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

export type SelectedAquaPosition = Pick<
  AquaPositionSnapshot,
  "vault" | "strategyHash"
>;

/** Closing remains allowed when the family or Aqua is paused, as the vault permits. */
export function validateClosePositionState(
  state: AquaPositionSnapshot,
  selected: SelectedAquaPosition,
) {
  if (state.vault.toLowerCase() !== selected.vault.toLowerCase())
    throw new Error(
      "The selected family vault has changed. Reopen on-chain details.",
    );
  if (!state.positionActive)
    throw new Error(
      "This position is no longer active. Go back to on-chain details.",
    );
  if (state.strategyHash.toLowerCase() !== selected.strategyHash.toLowerCase())
    throw new Error(
      "The active position has changed. Reopen on-chain details before continuing.",
    );
}

/** Dock only: never sign a replacement, withdrawal, token approval, or extra call. */
export function validateDockSavingsIntents(
  envelope: IntentEnvelope,
  vault: Address,
) {
  if (envelope.intents.length !== 1)
    throw new Error("The signing plan does not match closing this position.");
  const [intent] = envelope.intents;
  const data = encodeFunctionData({
    abi: familyVaultAbi,
    functionName: "dockSavingsPosition",
  });
  if (
    intent.chainId !== sepolia.id ||
    intent.signerRole !== "PARENT" ||
    intent.to.toLowerCase() !== vault.toLowerCase() ||
    intent.value !== "0" ||
    intent.data.toLowerCase() !== data.toLowerCase()
  )
    throw new Error("The signing plan does not match closing this position.");
}

export function parsePositionAmount(
  value: string,
  token: "USDC" | "WETH",
  allowZero = false,
) {
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
  if (units < 0n || (!allowZero && units === 0n) || units > maxUint256)
    throw new Error(`Enter a ${token} amount greater than zero.`);
  return units;
}

export function validateTopUpPositionState(
  state: AquaPositionSnapshot,
  selected: SelectedAquaPosition,
  now = Math.floor(Date.now() / 1000),
) {
  validateClosePositionState(state, selected);
  if (state.paused)
    throw new Error(
      "Aqua is paused for this vault. Adding funds is unavailable.",
    );
  if (state.positionDeadline <= now)
    throw new Error(
      "This position has expired. Close it and create a new position before adding funds.",
    );
}

export function validateTopUpAmounts(
  state: AquaPositionSnapshot,
  usdc: bigint,
  weth: bigint,
) {
  if (usdc === 0n && weth === 0n)
    throw new Error("Choose a USDC or WETH amount greater than zero.");
  for (const [token, amount, available, current, cap] of [
    ["USDC", usdc, state.availableUsdc, state.positionUsdc, state.maxUsdc],
    ["WETH", weth, state.availableWeth, state.positionWeth, state.maxWeth],
  ] as const) {
    if (amount < 0n || amount > maxUint256)
      throw new Error(`Enter a valid ${token} amount.`);
    if (amount > available)
      throw new Error(
        `There isn’t enough ${token} available in your family vault.`,
      );
    if (current + amount > cap)
      throw new Error(
        `The ${token} total exceeds this vault’s per-position limit.`,
      );
  }
}

/** Exactly one vault call: no approval, wallet transfer, replacement or withdrawal. */
export function validateAddSavingsIntents(
  envelope: IntentEnvelope,
  expected: SelectedAquaPosition & { usdc: bigint; weth: bigint },
) {
  const data = encodeFunctionData({
    abi: familyVaultAbi,
    functionName: "addToSavingsPosition",
    args: [expected.strategyHash, expected.usdc, expected.weth],
  });
  const [intent] = envelope.intents;
  if (
    envelope.intents.length !== 1 ||
    intent.chainId !== sepolia.id ||
    intent.signerRole !== "PARENT" ||
    intent.value !== "0" ||
    intent.to.toLowerCase() !== expected.vault.toLowerCase() ||
    intent.data.toLowerCase() !== data.toLowerCase()
  )
    throw new Error(
      "The signing plan does not match adding funds to this position.",
    );
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

/** Only the requested allocation to this vault can be signed, with no extra transfers. */
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
