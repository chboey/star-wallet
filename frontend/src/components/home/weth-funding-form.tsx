"use client";

import { LoaderCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { sepolia } from "viem/chains";
import { useAccount, useReadContract } from "wagmi";
import { familyVaultAbi } from "@star/contracts/abi";
import { parseWethAmount, refreshWethFundingReads } from "@/lib/weth-funding";
import { IntentStatus } from "./action-status";
import { HomeIllustration } from "./home-ui";
import { useStarData } from "./star-data-provider";
import { useStarIntents, type IntentOperation } from "./use-star-intents";
import { ParentTransactionDetails } from "./parent-transaction-details";

const presets = ["0.001", "0.005", "0.01"];

export function WethFundingForm({
  onBusyChange,
  onDone,
}: {
  onBusyChange: (busy: boolean) => void;
  onDone: () => void;
}) {
  const { family } = useStarData();
  const queryClient = useQueryClient();
  const { address, isConnected } = useAccount();
  const { execute, operation, resetOperation } = useStarIntents();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const lock = useRef(false);
  const token = useReadContract({
    chainId: sepolia.id,
    address: family?.vault?.id,
    abi: familyVaultAbi,
    functionName: "weth",
    query: { enabled: Boolean(family?.vault) },
  });
  const balance = useReadContract({
    chainId: sepolia.id,
    address: token.data,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: family ? [family.parent] : undefined,
    query: {
      enabled: Boolean(token.data && family),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  const unavailable =
    !family?.active || !family.vault
      ? "An active family vault is needed to add WETH."
      : !isConnected || address?.toLowerCase() !== family.parent.toLowerCase()
        ? "Connect your registered parent wallet to add WETH."
        : token.error || balance.error
          ? "Couldn’t check your WETH balance. Close this popup and try again."
          : undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      lock.current ||
      complete ||
      unavailable ||
      !family ||
      balance.data === undefined
    )
      return;
    let units: bigint;
    try {
      units = parseWethAmount(amount);
      if (units > balance.data)
        throw new Error("There isn’t enough WETH in your parent wallet.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Enter a valid WETH amount.",
      );
      return;
    }
    lock.current = true;
    setError(undefined);
    setBusy(true);
    onBusyChange(true);
    try {
      await execute(
        "fundWeth",
        { familyId: family.id, amountWethUnits: units.toString() },
        "PARENT",
      );
      setComplete(true);
      void balance.refetch();
    } catch {
      // The shared status displays wallet cancellation, rejected plans and reverted deposits.
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  const done = async () => {
    if (lock.current || !complete || !family?.vault) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(undefined);
    try {
      await refreshWethFundingReads(queryClient, family.id, family.vault.id);
      onDone();
    } catch {
      setError(
        "WETH was added, but the balance could not refresh. Press Done to try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <WethFundingContent
      amount={amount}
      walletBalance={balance.data}
      busy={busy}
      complete={complete}
      operation={operation}
      error={error ?? unavailable}
      disabled={
        Boolean(unavailable) ||
        balance.data === undefined ||
        balance.data === 0n
      }
      onAmountChange={(value) => {
        if (lock.current) return;
        setAmount(value);
        setError(undefined);
        resetOperation();
      }}
      onSubmit={submit}
      onDone={() => void done()}
    />
  );
}

/** Presentational funding layout, also used by render tests without a connected wallet. */
export function WethFundingContent({
  amount,
  walletBalance,
  busy,
  complete,
  operation,
  error,
  disabled,
  onAmountChange,
  onSubmit,
  onDone,
}: {
  amount: string;
  walletBalance?: bigint;
  busy: boolean;
  complete: boolean;
  operation: IntentOperation;
  error?: string;
  disabled: boolean;
  onAmountChange: (amount: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDone: () => void;
}) {
  const locked = busy || complete;
  return (
    <form
      className={`weth-funding-form${complete ? " weth-funding-form-complete" : ""}`}
      onSubmit={onSubmit}
      aria-busy={busy}
    >
      <div className="weth-funding-fields">
        <div className="weth-funding-hero" aria-hidden="true">
          <span className="weth-funding-coin">
            <HomeIllustration name="weth" alt="" size={112} />
          </span>
        </div>
        {complete ? (
          <div className="weth-funding-success">
            <h3>WETH added!</h3>
            <p>{amount} WETH is now in your family vault.</p>
          </div>
        ) : (
          <>
            <p className="weth-funding-intro">
              Add WETH from your wallet to your family vault.
            </p>
            <label className="weth-funding-amount">
              <span className="sr-only">Amount in WETH</span>
              <input
                className="amount-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amount}
                maxLength={80}
                disabled={locked}
                aria-invalid={Boolean(error)}
                onChange={(event) => onAmountChange(event.target.value)}
              />
              <span className="weth-funding-currency">WETH</span>
            </label>
            <p className="weth-funding-balance">
              Wallet balance:{" "}
              {walletBalance === undefined
                ? "Checking…"
                : `${formatUnits(walletBalance, 18)} WETH`}
            </p>
            <div
              className="weth-funding-presets"
              role="group"
              aria-label="Choose WETH amount"
            >
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={amount === preset}
                  disabled={
                    locked ||
                    walletBalance === undefined ||
                    parseWethAmount(preset) > walletBalance
                  }
                  onClick={() => onAmountChange(preset)}
                >
                  {preset}
                </button>
              ))}
              <button
                type="button"
                disabled={locked || !walletBalance}
                onClick={() =>
                  walletBalance !== undefined &&
                  onAmountChange(formatUnits(walletBalance, 18))
                }
              >
                Max
              </button>
            </div>
            <p className="weth-funding-note">
              {walletBalance === 0n
                ? "You’ll need WETH in your parent wallet first. ETH and WETH are different tokens."
                : "You’ll confirm a WETH approval, then the deposit."}
            </p>
          </>
        )}
      </div>
      <footer className="weth-funding-footer">
        <IntentStatus operation={operation} busy={busy} error={error} />
        <ParentTransactionDetails
          hashes={operation.transactionHashes}
          completed={complete && !busy}
        />
        {complete ? (
          <button
            className="filled-action-button"
            type="button"
            onClick={onDone}
            disabled={busy}
            aria-busy={busy}
          >
            {busy && (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            )}
            Done
          </button>
        ) : (
          <button
            className="filled-action-button"
            type="submit"
            disabled={disabled || busy || !amount.trim()}
            aria-busy={busy}
          >
            {busy && (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            )}
            Add WETH
          </button>
        )}
      </footer>
    </form>
  );
}
