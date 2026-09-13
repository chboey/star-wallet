"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sepolia } from "viem/chains";
import { formatTokenAmount, shortHex } from "@/lib/star-format";
import type { SelectedAquaPosition } from "@/lib/aqua-position";
import { ActionStatus } from "./action-status";
import { useStarData } from "./star-data-provider";
import { useAquaPosition } from "./use-aqua-position";
import { AquaPositionOptions } from "./aqua-position-options";
import { CloseAquaPositionSheet } from "./close-aqua-position-sheet";
import { AquaPositionSetupSheet } from "./aqua-position-setup-sheet";

export function OnchainDetailsSheet({
  onClose,
  canManage = false,
}: {
  onClose: () => void;
  canManage?: boolean;
}) {
  const { family } = useStarData();
  const live = useAquaPosition();
  const busy = live.isFetching;
  const [closingPosition, setClosingPosition] =
    useState<SelectedAquaPosition | null>(null);
  const [addingPosition, setAddingPosition] =
    useState<SelectedAquaPosition | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const position =
    family?.savings.activePosition?.strategyHash.toLowerCase() ===
    live.data?.strategyHash.toLowerCase()
      ? family?.savings.activePosition
      : undefined;
  const latestExecution = position?.executions?.[0];
  const explorer = sepolia.blockExplorers.default.url;
  const latestTransaction =
    latestExecution?.transactionHash ?? family?.vault?.updatedTransactionHash;
  const details = [
    { label: "Network", value: "Ethereum Sepolia (testnet)", code: false },
    {
      label: "Available in vault",
      value: `${formatTokenAmount(live.data?.availableUsdc, 6, 6)} USDC · ${formatTokenAmount(live.data?.availableWeth, 18, 18)} WETH`,
      code: false,
    },
    {
      label: "In position",
      value: `${formatTokenAmount(live.data?.positionUsdc, 6, 6)} USDC · ${formatTokenAmount(live.data?.positionWeth, 18, 18)} WETH`,
      code: false,
    },
    {
      label: "Position status",
      value: live.isError
        ? "Couldn’t verify position"
        : !live.data
          ? "Checking…"
          : live.data.positionActive
            ? live.data.paused
              ? "Active · Aqua paused"
              : "Active Aqua position"
            : "No active position",
      code: false,
    },
    {
      label: "Vault contract",
      value: shortHex(family?.vault?.id),
      code: true,
      href: family?.vault
        ? `${explorer}/address/${family.vault.id}`
        : undefined,
    },
    {
      label: "Strategy hash",
      value: shortHex(
        live.data?.positionActive ? live.data.strategyHash : undefined,
      ),
      code: true,
      // A strategy hash is not a transaction hash. Show its Aqua event logs,
      // or the vault's readable contract state while the indexer catches up.
      href: live.data?.positionActive
        ? latestExecution
          ? `${explorer}/tx/${latestExecution.transactionHash}#eventlog`
          : `${explorer}/address/${live.data.vault}#readContract`
        : undefined,
      title: latestExecution
        ? "View this strategy’s Aqua event logs on Sepolia Etherscan"
        : "View the active strategy in the vault contract on Sepolia Etherscan",
    },
    {
      label: "Aqua maker",
      value: shortHex(live.data?.positionActive ? live.data.vault : undefined),
      code: true,
      href: live.data?.positionActive
        ? `${explorer}/address/${live.data.vault}`
        : undefined,
    },
    {
      label: "Latest indexed transaction",
      value: shortHex(latestTransaction),
      code: true,
      href: latestTransaction
        ? `${explorer}/tx/${latestTransaction}`
        : undefined,
    },
    {
      label: "Checked on-chain block",
      value: live.data ? `#${live.data.blockNumber.toLocaleString()}` : "—",
      code: false,
    },
    {
      label: "Indexed block",
      value: `#${family?.indexing.block.number.toLocaleString() ?? "—"}`,
      code: false,
    },
  ];

  useEffect(() => {
    if ((closingPosition || addingPosition) && canManage) return;
    closeButtonRef.current?.focus();
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeWithEscape);
    return () => document.removeEventListener("keydown", closeWithEscape);
  }, [onClose, closingPosition, addingPosition, canManage]);

  if (addingPosition && canManage)
    return (
      <AquaPositionSetupSheet
        selected={addingPosition}
        onClose={() => setAddingPosition(null)}
        onDetails={() => setAddingPosition(null)}
      />
    );

  if (closingPosition && canManage)
    return (
      <CloseAquaPositionSheet
        selected={closingPosition}
        onClose={() => setClosingPosition(null)}
        onDone={onClose}
      />
    );

  return (
    <>
      <button
        className="add-funds-backdrop"
        type="button"
        aria-label="Close on-chain details"
        onClick={onClose}
      />
      <section
        className="onchain-details-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onchain-details-title"
      >
        <header className="add-funds-sheet-header">
          {canManage ? (
            <AquaPositionOptions
              disabled={busy || live.isError || !live.data?.positionActive}
              onAddPosition={() => {
                if (!busy && !live.isError && live.data?.positionActive)
                  setAddingPosition({
                    vault: live.data.vault,
                    strategyHash: live.data.strategyHash,
                  });
              }}
              onClosePosition={() => {
                if (!busy && !live.isError && live.data?.positionActive)
                  setClosingPosition({
                    vault: live.data.vault,
                    strategyHash: live.data.strategyHash,
                  });
              }}
            />
          ) : (
            <span aria-hidden="true" />
          )}
          <h2 id="onchain-details-title">On-chain details</h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close on-chain details"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        {live.isError && (
          <ActionStatus
            state="error"
            message="Couldn’t refresh the on-chain state. Displayed values may be out of date."
            onRefresh={() => void live.refetch()}
            refreshing={busy}
          />
        )}
        <dl className="onchain-detail-list">
          {details.map(({ label, value, code, href, title }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={
                      title ??
                      `View ${label.toLowerCase()} on Sepolia Etherscan`
                    }
                    aria-label={`${title ?? `View ${label.toLowerCase()} on Sepolia Etherscan`} (opens in a new tab)`}
                  >
                    <code>{value}</code>
                  </a>
                ) : code ? (
                  <code>{value}</code>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="onchain-details-note">
          Balances and position status are checked directly on Sepolia. Indexed
          transaction details can take a little longer to update.
        </p>
      </section>
    </>
  );
}
