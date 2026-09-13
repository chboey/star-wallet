"use client";

import { useRef, useState } from "react";
import { useAccount } from "wagmi";
import {
  validateClosePositionState,
  type SelectedAquaPosition,
} from "@/lib/aqua-position";
import { ParentActionSheet } from "./parent-action-sheet";
import { IntentStatus } from "./action-status";
import { CloseAquaPositionContent } from "./close-aqua-position-content";
import { useAquaPosition } from "./use-aqua-position";
import { useStarData } from "./star-data-provider";
import { useStarIntents } from "./use-star-intents";

export function CloseAquaPositionSheet({
  selected,
  onClose,
  onDone,
}: {
  selected: SelectedAquaPosition;
  onClose: () => void;
  onDone: () => void;
}) {
  const { family } = useStarData();
  const { address, isConnected } = useAccount();
  const position = useAquaPosition();
  const { execute, operation } = useStarIntents();
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const lock = useRef(false);
  const checking = position.isFetching || (!position.data && !position.isError);
  let unavailable =
    !family?.vault ||
    family.vault.id.toLowerCase() !== selected.vault.toLowerCase()
      ? "The selected family vault has changed. Reopen on-chain details."
      : !isConnected || address?.toLowerCase() !== family.parent.toLowerCase()
        ? "Connect the registered parent wallet to close this position."
        : position.isError
          ? "Couldn’t check this position. Please refresh before closing it."
          : undefined;
  if (!unavailable && position.data) {
    try {
      validateClosePositionState(position.data, selected);
    } catch (cause) {
      unavailable =
        cause instanceof Error ? cause.message : "Check this position again.";
    }
  }
  const close = () => {
    if (lock.current) return;
    if (complete) onDone();
    else onClose();
  };
  const submit = async () => {
    if (
      lock.current ||
      complete ||
      unavailable ||
      checking ||
      !position.data ||
      !family
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      await execute("dockSavings", { familyId: family.id }, "PARENT", {
        expectedPosition: selected,
      });
      setComplete(true);
    } catch {
      // Keep the confirmation and any broadcast hash available for a deliberate retry.
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <ParentActionSheet
      title={complete ? "Position closed" : "Close position"}
      className="close-aqua-position-sheet"
      onClose={close}
    >
      <CloseAquaPositionContent
        busy={busy}
        complete={complete}
        checking={checking}
        disabled={Boolean(unavailable) || !position.data}
        error={
          busy
            ? undefined
            : operation.state === "error"
              ? operation.message
              : unavailable
        }
        transactionHashes={operation.transactionHashes}
        onConfirm={() => void submit()}
        onDone={close}
        onRefresh={() => {
          if (!lock.current) void position.refetch();
        }}
      />
      <IntentStatus
        operation={operation.state === "error" ? { state: "idle" } : operation}
        busy={busy}
      />
    </ParentActionSheet>
  );
}
