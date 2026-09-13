"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { decodeFunctionData, erc20Abi, formatUnits, type Hash } from "viem";
import {
  childAccountAbi,
  familyVaultAbi,
  registryAbi,
} from "@star/contracts/abi";
import { sepolia } from "viem/chains";
import {
  useAccount,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
} from "wagmi";
import {
  starApi,
  type IntentAction,
  type IntentInputs,
  type IntentResponse,
  type SignerRole,
  type TransactionIntent,
} from "@/lib/star-api";
import { useStarData } from "./star-data-provider";
import { sendChildIntent } from "@/lib/child-account";
import { useParentAuthorization } from "./parent-authorization-provider";
import { validateQuestIntents } from "@/lib/quest-intents";
import { validateWethFundingIntents } from "@/lib/weth-funding";
import {
  aquaPositionKey,
  aquaTopUpKey,
  readAquaTopUpPosition,
  validateTopUpPositionState,
  validateTopUpAmounts,
  validateAddSavingsIntents,
  readAquaPosition,
  validatePositionAmounts,
  validateShipSavingsIntents,
  validateClosePositionState,
  validateDockSavingsIntents,
  type SelectedAquaPosition,
} from "@/lib/aqua-position";
import { refreshAfterWalletAction } from "@/lib/wallet-refresh";
import { waitForIndexedBlock } from "@/lib/indexed-transaction";
import {
  appendTransactionHash,
  waitForParentTransaction,
} from "@/lib/parent-transactions";
import {
  contributionAmount,
  contributionLimit,
  goalContributionKey,
  goalContributionConfirmationsKey,
  readGoalContribution,
  validateGoalContributionIntent,
  type GoalContributionSnapshot,
} from "@/lib/goal-contributions";
import {
  goalRequestActions,
  validateGoalRequestIntents,
} from "@/lib/goal-request-intents";

export type IntentOperation = { transactionHashes?: readonly Hash[] } & (
  | { state: "idle" }
  | { state: "signing"; message: string }
  | { state: "indexing"; message: string }
  | { state: "success"; message: string; indexed: boolean }
  | { state: "error"; message: string }
);

export function useStarIntents() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const { family, child } = useStarData();
  const queryClient = useQueryClient();
  const authorizeDevice = useParentAuthorization();
  const [operation, setOperation] = useState<IntentOperation>({
    state: "idle",
  });

  const execute = async <Action extends IntentAction>(
    action: Action,
    body: IntentInputs[Action],
    signerRole: SignerRole,
    options?: {
      expectedPosition?: SelectedAquaPosition;
      onTransactionHashes?: (hashes: readonly Hash[]) => void;
    },
  ): Promise<IntentResponse<Action>> => {
    let transactionHashes: Hash[] = [];
    const updateOperation = (next: IntentOperation) =>
      setOperation({ ...next, transactionHashes: [...transactionHashes] });
    const onTransactionHash = (hash: Hash) => {
      transactionHashes = appendTransactionHash(transactionHashes, hash);
      options?.onTransactionHashes?.([...transactionHashes]);
      setOperation((current) => ({
        ...current,
        transactionHashes: [...transactionHashes],
      }));
    };
    setOperation({ state: "signing", message: "Preparing your request…" });
    try {
      if (signerRole !== "CHILD" && (!address || !isConnected))
        throw new Error("Connect the signing wallet first.");
      if (!publicClient) throw new Error("The Sepolia client is unavailable.");
      const expectedAddress =
        signerRole === "PARENT"
          ? family?.parent
          : signerRole === "CHILD"
            ? child?.wallet
            : family?.vault?.emergencyAdmin;
      if (
        signerRole !== "CHILD" &&
        expectedAddress &&
        expectedAddress.toLowerCase() !== address?.toLowerCase()
      ) {
        throw new Error(
          `Connect the registered ${signerRole.toLowerCase()} wallet to continue.`,
        );
      }
      if (signerRole !== "CHILD" && chainId !== sepolia.id)
        await switchChainAsync({ chainId: sepolia.id });

      if (action === "dockSavings") {
        if (
          signerRole !== "PARENT" ||
          !family?.vault ||
          !("familyId" in body) ||
          body.familyId !== family.id ||
          !options?.expectedPosition
        )
          throw new Error(
            "Select the position to close from your family's on-chain details.",
          );
        const state = await readAquaPosition(publicClient, family.vault.id);
        queryClient.setQueryData(aquaPositionKey(family.vault.id), state);
        validateClosePositionState(state, options.expectedPosition);
      }
      if (action === "addSavings") {
        if (
          signerRole !== "PARENT" ||
          !family?.active ||
          !family.vault ||
          !("expectedStrategyHash" in body) ||
          body.familyId !== family.id ||
          !options?.expectedPosition ||
          body.expectedStrategyHash.toLowerCase() !==
            options.expectedPosition.strategyHash.toLowerCase()
        )
          throw new Error(
            "Select the existing position from your family's on-chain details.",
          );
        const state = await readAquaTopUpPosition(
          publicClient,
          family.vault.id,
        );
        queryClient.setQueryData(aquaTopUpKey(family.vault.id), state);
        validateTopUpPositionState(state, options.expectedPosition);
        validateTopUpAmounts(
          state,
          BigInt(body.usdcAmountUnits),
          BigInt(body.wethAmountUnits),
        );
      }
      if (action === "shipSavings") {
        if (
          signerRole !== "PARENT" ||
          !family?.active ||
          !family.vault ||
          !("usdcAmountUnits" in body) ||
          body.familyId !== family.id
        )
          throw new Error(
            "Select an active family vault before creating a position.",
          );
        // Recheck the contract before preparing a plan, even if the indexer is behind.
        const state = await readAquaPosition(publicClient, family.vault.id);
        queryClient.setQueryData(aquaPositionKey(family.vault.id), state);
        validatePositionAmounts(
          state,
          BigInt(body.usdcAmountUnits),
          BigInt(body.wethAmountUnits),
        );
      }
      if (action === "addStarsToGoal") {
        if (
          signerRole !== "CHILD" ||
          !child?.active ||
          !family?.active ||
          !("goalId" in body) ||
          !("amount" in body) ||
          !child.goals?.some((goal) => goal.id === body.goalId)
        )
          throw new Error("Select an active goal belonging to this child.");
        const state = await readGoalContribution(
          publicClient,
          child.wallet,
          child.id,
          body.goalId,
        );
        queryClient.setQueryData(
          goalContributionKey(child.wallet, body.goalId),
          state,
        );
        const amount = contributionAmount(body.amount);
        if (
          state.status !== 0 ||
          state.pendingId !== 0n ||
          !amount ||
          amount >
            contributionLimit(state.available, state.target, state.allocated)
        )
          throw new Error(
            "Check the Stars available and the amount this goal still needs.",
          );
      }
      const envelope = await starApi.intent(action, body);
      if (
        action === "addSavings" &&
        family?.vault &&
        options?.expectedPosition &&
        "expectedStrategyHash" in body
      ) {
        const usdc = BigInt(body.usdcAmountUnits);
        const weth = BigInt(body.wethAmountUnits);
        validateAddSavingsIntents(envelope, {
          ...options.expectedPosition,
          usdc,
          weth,
        });
        const state = await readAquaTopUpPosition(
          publicClient,
          family.vault.id,
        );
        queryClient.setQueryData(aquaTopUpKey(family.vault.id), state);
        validateTopUpPositionState(state, options.expectedPosition);
        validateTopUpAmounts(state, usdc, weth);
        // The contract rechecks ownership, expiry, oracle constraints and live Aqua exposure.
        await publicClient.simulateContract({
          account: address!,
          address: family.vault.id,
          abi: familyVaultAbi,
          functionName: "addToSavingsPosition",
          args: [body.expectedStrategyHash, usdc, weth],
        });
      }
      if (
        action === "dockSavings" &&
        family?.vault &&
        options?.expectedPosition
      ) {
        validateDockSavingsIntents(envelope, family.vault.id);
        // Recheck after preparing the plan, then simulate the exact parent call.
        // The existing no-argument dock method targets the active position at execution.
        const state = await readAquaPosition(publicClient, family.vault.id);
        queryClient.setQueryData(aquaPositionKey(family.vault.id), state);
        validateClosePositionState(state, options.expectedPosition);
        await publicClient.simulateContract({
          account: address!,
          address: family.vault.id,
          abi: familyVaultAbi,
          functionName: "dockSavingsPosition",
        });
      }
      if (
        action === "addStarsToGoal" &&
        child &&
        "goalId" in body &&
        "amount" in body
      )
        validateGoalContributionIntent(envelope, {
          wallet: child.wallet,
          goalId: body.goalId,
          amount: body.amount,
        });
      validateQuestIntents(action, body, envelope, family, child);
      if (
        action === "shipSavings" &&
        family?.vault &&
        "usdcAmountUnits" in body
      ) {
        const strategy = validateShipSavingsIntents(envelope, {
          vault: family.vault.id,
          usdc: BigInt(body.usdcAmountUnits),
          weth: BigInt(body.wethAmountUnits),
        });
        // The vault checks its maker, token pair, oracle price range and expiry.
        const parameters = await publicClient.readContract({
          address: family.vault.id,
          abi: familyVaultAbi,
          functionName: "inspectSavingsStrategy",
          args: [strategy],
        });
        if (parameters.feeBps !== ("feeBps" in body ? (body.feeBps ?? 30) : 30))
          throw new Error("The Aqua trading fee does not match your review.");
      }
      if (action === "fundWeth") {
        if (
          signerRole !== "PARENT" ||
          !family?.active ||
          !family.vault ||
          !("amountWethUnits" in body) ||
          body.familyId !== family.id
        )
          throw new Error("Select an active family vault before adding WETH.");
        // Resolve the token and ownership from the selected vault, not from the API plan.
        const vault = family.vault.id;
        const [weth, registry, familyId] = await Promise.all([
          publicClient.readContract({
            address: vault,
            abi: familyVaultAbi,
            functionName: "weth",
          }),
          publicClient.readContract({
            address: vault,
            abi: familyVaultAbi,
            functionName: "registry",
          }),
          publicClient.readContract({
            address: vault,
            abi: familyVaultAbi,
            functionName: "familyId",
          }),
        ]);
        const registeredFamily = await publicClient.readContract({
          address: registry,
          abi: registryAbi,
          functionName: "getFamily",
          args: [familyId],
        });
        if (
          registeredFamily.parent.toLowerCase() !== address!.toLowerCase() ||
          familyId !== BigInt(family.id) ||
          !registeredFamily.active
        )
          throw new Error(
            "Connect the registered parent wallet for this family vault.",
          );
        const amount = BigInt(body.amountWethUnits);
        validateWethFundingIntents(envelope, { vault, weth, amount });
        const balance = await publicClient.readContract({
          address: weth,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address!],
        });
        if (balance < amount)
          throw new Error("There isn’t enough WETH in your parent wallet.");
        const displayAmount = formatUnits(amount, 18);
        envelope.intents[0].summary = `Step 1 of 2: approve ${displayAmount} WETH for your family vault.`;
        envelope.intents[1].summary = `Step 2 of 2: add ${displayAmount} WETH to your family vault.`;
      }
      if ((goalRequestActions as readonly string[]).includes(action)) {
        const requestChild =
          "childId" in body
            ? family?.children.find((item) => item.id === body.childId)
            : undefined;
        if (!requestChild)
          throw new Error("Select the child for this goal request.");
        // Pin the destination to the immutable contract bound to the registered
        // child's account, not an address supplied in the unsigned API plan.
        const goalsAddress = await publicClient.readContract({
          address: requestChild.wallet,
          abi: childAccountAbi,
          functionName: "goals",
        });
        validateGoalRequestIntents(
          action,
          body,
          envelope,
          goalsAddress,
          family!.children,
          child,
        );
      }
      // A selected profile is not signing authority: the selected child's passkey must authenticate.
      if (action === "requestRedemption" || action === "cancelRedemption") {
        if (
          !child?.wallet ||
          signerRole !== "CHILD" ||
          envelope.intents.some(
            (intent) => intent.to.toLowerCase() !== child.wallet.toLowerCase(),
          )
        ) {
          throw new Error(
            "The request must target the selected child's passkey account.",
          );
        }
        const requestedId =
          "goalId" in body
            ? body.goalId
            : "redemptionId" in body
              ? body.redemptionId
              : undefined;
        for (const intent of envelope.intents) {
          const decoded = decodeFunctionData({
            abi: childAccountAbi,
            data: intent.data,
          });
          if (
            requestedId === undefined ||
            decoded.functionName !== action ||
            ((decoded.functionName === "requestRedemption" ||
              decoded.functionName === "cancelRedemption") &&
              decoded.args[0] !== BigInt(requestedId))
          ) {
            throw new Error(
              "The child operation does not match the requested action.",
            );
          }
        }
      }
      if (envelope.intents.some((intent) => intent.chainId !== sepolia.id)) {
        throw new Error("The API returned an intent for the wrong network.");
      }
      const invalidIntent = envelope.intents.find(
        (intent) => intent.signerRole !== signerRole,
      );
      if (invalidIntent) {
        throw new Error(
          `The API returned an unexpected ${invalidIntent.signerRole} intent.`,
        );
      }

      let receiptBlock = 0n;
      for (const intent of envelope.intents) {
        updateOperation({ state: "signing", message: intent.summary });
        receiptBlock =
          signerRole === "CHILD"
            ? await sendChildIntent(intent, authorizeDevice)
            : await sendIntent(
                intent,
                address!,
                publicClient,
                sendTransactionAsync,
                onTransactionHash,
              );
      }

      updateOperation({
        state: "indexing",
        message: "Transaction confirmed! Updating your wallet…",
      });
      if (
        (action === "shipSavings" ||
          action === "dockSavings" ||
          action === "addSavings" ||
          action === "fundWeth") &&
        family?.vault
      ) {
        // Update the live position independently of subgraph indexing lag.
        await Promise.all(
          [aquaPositionKey(family.vault.id), aquaTopUpKey(family.vault.id)].map(
            (queryKey) =>
              queryClient.invalidateQueries({ queryKey, exact: true }),
          ),
        );
      }
      if (action === "addStarsToGoal" && child && "goalId" in body) {
        await queryClient.invalidateQueries({
          queryKey: goalContributionKey(child.wallet, body.goalId),
          exact: true,
        });
        const snapshot = queryClient.getQueryData<GoalContributionSnapshot>(
          goalContributionKey(child.wallet, body.goalId),
        );
        if (snapshot && snapshot.blockNumber >= receiptBlock && family) {
          queryClient.setQueryData<GoalContributionSnapshot[]>(
            goalContributionConfirmationsKey(family.id),
            (current = []) => [
              ...current.filter(
                (item) =>
                  item.goalId !== snapshot.goalId ||
                  item.wallet !== snapshot.wallet,
              ),
              snapshot,
            ],
          );
        }
      }
      const indexed = await waitForIndexedBlock(receiptBlock);
      await refreshAfterWalletAction(
        queryClient,
        action,
        {
          familyId: family?.id ?? ("familyId" in body ? body.familyId : null),
          childId: "childId" in body ? body.childId : undefined,
          parent: family?.parent ?? address,
        },
        indexed,
      );
      updateOperation({
        state: "success",
        indexed,
        message: indexed
          ? "All done! Your wallet is up to date."
          : "Transaction confirmed! Still syncing—reopen this page to check for the update.",
      });
      return envelope;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The transaction could not be completed.";
      updateOperation({ state: "error", message });
      throw error;
    }
  };

  return {
    execute,
    operation,
    resetOperation: () => setOperation({ state: "idle" }),
  };
}

async function sendIntent(
  intent: TransactionIntent,
  account: `0x${string}`,
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  sendTransaction: ReturnType<
    typeof useSendTransaction
  >["sendTransactionAsync"],
  onHash: (hash: Hash) => void,
): Promise<bigint> {
  if (intent.chainId !== sepolia.id)
    throw new Error(`Unexpected intent chain ${intent.chainId}.`);
  const hash = await sendTransaction({
    account,
    chainId: sepolia.id,
    to: intent.to,
    data: intent.data,
    value: BigInt(intent.value),
  });
  const receipt = await waitForParentTransaction(publicClient, hash, onHash);
  if (receipt.status !== "success")
    throw new Error(`${intent.summary} reverted.`);
  return receipt.blockNumber;
}
