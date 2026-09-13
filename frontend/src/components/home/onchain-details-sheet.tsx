"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { sepolia } from "viem/chains";
import { formatTokenAmount, shortHex } from "@/lib/star-format";
import { ActionStatus } from "./action-status";
import { useStarData } from "./star-data-provider";
import { useAquaPosition } from "./use-aqua-position";

export function OnchainDetailsSheet({ onClose }: { onClose: () => void }) {
  const { family } = useStarData();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const live = useAquaPosition();
  const savings = family?.savings;
  const explorer = sepolia.blockExplorers.default.url;
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
      label: "Principal contributed",
      value: `${formatTokenAmount(live.data?.totalPrincipalContributed, 6, 6)} USDC`,
      code: false,
    },
    {
      label: "Principal withdrawn",
      value: `${formatTokenAmount(live.data?.totalPrincipalWithdrawn, 6, 6)} USDC`,
      code: false,
    },
    {
      label: "Net principal",
      value: `${formatTokenAmount(
        live.data
          ? live.data.totalPrincipalContributed -
              live.data.totalPrincipalWithdrawn
          : undefined,
        6,
        6,
      )} USDC`,
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
      label: "Total USDC withdrawn",
      value: `${formatTokenAmount(savings?.totalUsdcWithdrawn, 6, 6)} USDC`,
      code: false,
    },
    {
      label: "Total WETH withdrawn",
      value: `${formatTokenAmount(savings?.totalWethWithdrawn, 18, 18)} WETH`,
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
      label: "Latest indexed transaction",
      value: shortHex(family?.vault?.updatedTransactionHash),
      code: true,
      href: family?.vault?.updatedTransactionHash
        ? `${explorer}/tx/${family.vault.updatedTransactionHash}`
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
    closeButtonRef.current?.focus();
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeWithEscape);
    return () => document.removeEventListener("keydown", closeWithEscape);
  }, [onClose]);

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
          <span aria-hidden="true" />
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
            message="Couldn’t refresh the on-chain vault account. Indexed withdrawal totals may still be available."
            onRefresh={() => void live.refetch()}
            refreshing={live.isFetching}
          />
        )}
        <dl className="onchain-detail-list">
          {details.map(({ label, value, code, href }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${label.toLowerCase()} on Sepolia Etherscan (opens in a new tab)`}
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
          Vault balances and principal accounting are checked directly on
          Sepolia. Withdrawal totals and transaction details follow the latest
          indexed snapshot.
        </p>
      </section>
    </>
  );
}
