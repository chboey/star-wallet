"use client";

import { type FormEvent, useRef, useState } from "react";
import { useAccount } from "wagmi";
import {
  parsePositionAmount,
  validatePositionAmounts,
} from "@/lib/aqua-position";
import { displayEnsName } from "@/lib/star-format";
import { IntentStatus } from "./action-status";
import { ParentActionSheet } from "./parent-action-sheet";
import { ParentRewardStarsSheet } from "./parent-action-sheets";
import { useStarData } from "./star-data-provider";
import { useStarIntents } from "./use-star-intents";
import { useAquaPosition } from "./use-aqua-position";
import { WethFundingForm } from "./weth-funding-form";
import {
  AquaPositionSetupContent,
  type SetupStep,
} from "./aqua-position-setup-content";

export function AquaPositionSetupSheet({
  onClose,
  onDetails,
}: {
  onClose: () => void;
  onDetails: () => void;
}) {
  const { family } = useStarData();
  const { address, isConnected } = useAccount();
  const position = useAquaPosition();
  const { execute, operation, resetOperation } = useStarIntents();
  const [step, setStep] = useState<SetupStep>("amounts");
  const [funding, setFunding] = useState<"weth" | "usdc" | null>(null);
  const [usdc, setUsdc] = useState("");
  const [weth, setWeth] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const ready =
    step === "complete" ||
    (!busy &&
      !position.isError &&
      !position.isFetching &&
      position.data?.positionActive === true);
  const unavailable =
    !family?.active || !family.vault
      ? "An active family vault is needed to add savings."
      : !isConnected || address?.toLowerCase() !== family.parent.toLowerCase()
        ? "Connect your registered parent wallet to add savings."
        : position.data?.paused
          ? "Aqua is paused for this vault. Adding savings is unavailable."
          : undefined;

  const close = () => {
    if (!lock.current) onClose();
  };
  const returnFromFunding = () => {
    if (lock.current) return;
    setFunding(null);
    void position.refetch();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      lock.current ||
      ready ||
      unavailable ||
      !family ||
      !position.data ||
      position.isFetching ||
      position.isError
    )
      return;
    let amounts: { usdc: bigint; weth: bigint };
    try {
      amounts = {
        usdc: parsePositionAmount(usdc, "USDC"),
        weth: parsePositionAmount(weth, "WETH"),
      };
      validatePositionAmounts(position.data, amounts.usdc, amounts.weth);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Check the amounts and try again.",
      );
      return;
    }
    setError(undefined);
    if (step === "amounts") {
      setStep("review");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await execute(
        "shipSavings",
        {
          familyId: family.id,
          usdcAmountUnits: amounts.usdc.toString(),
          wethAmountUnits: amounts.weth.toString(),
          feeBps: 30,
        },
        "PARENT",
      );
      setStep("complete");
    } catch {
      // Cancellation and failed transactions remain on Review with a retryable error.
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  if (funding === "usdc")
    return (
      <ParentRewardStarsSheet
        childChoices={(family?.children ?? [])
          .filter((child) => child.active)
          .map((child) => ({
            id: child.id,
            name: displayEnsName(child.ensName, "Child"),
          }))}
        onClose={returnFromFunding}
      />
    );

  if (funding === "weth")
    return (
      <ParentActionSheet
        title="Add WETH"
        className="weth-funding-sheet"
        onClose={returnFromFunding}
      >
        <WethFundingForm
          onBusyChange={(pending) => {
            lock.current = pending;
          }}
          onDone={returnFromFunding}
        />
      </ParentActionSheet>
    );

  return (
    <ParentActionSheet
      title={ready ? "Star savings" : "Create Aqua position"}
      className="aqua-setup-sheet"
      onClose={close}
      onBack={
        !ready && step === "review"
          ? () => {
              if (lock.current) return;
              setStep("amounts");
              setError(undefined);
              resetOperation();
            }
          : undefined
      }
    >
      <AquaPositionSetupContent
        step={ready ? "complete" : step}
        snapshot={position.data}
        usdc={usdc}
        weth={weth}
        busy={busy}
        transactionHashes={operation.transactionHashes}
        checking={position.isFetching || (!position.data && !position.isError)}
        disabled={Boolean(unavailable) || position.isError || !position.data}
        error={
          position.isError
            ? position.error.message.startsWith("This vault does not support")
              ? position.error.message
              : "Couldn’t check the Aqua position. Please refresh."
            : (error ??
              unavailable ??
              (operation.state === "error" ? operation.message : undefined))
        }
        onRefresh={() => {
          if (!lock.current) void position.refetch();
        }}
        onAmountChange={(token, value) => {
          if (lock.current) return;
          if (token === "USDC") setUsdc(value);
          else setWeth(value);
          setError(undefined);
          resetOperation();
        }}
        onFund={(token) => {
          if (!lock.current) setFunding(token === "WETH" ? "weth" : "usdc");
        }}
        onSubmit={submit}
        onDone={close}
        onDetails={() => {
          if (!lock.current) {
            onClose();
            onDetails();
          }
        }}
      />
      {busy && <IntentStatus operation={operation} busy />}
    </ParentActionSheet>
  );
}
