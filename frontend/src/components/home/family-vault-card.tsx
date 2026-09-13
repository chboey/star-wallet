"use client";

import { Plus } from "lucide-react";
import Image from "next/image";

export function FamilyVaultCard({
  familyName,
  usdc,
  weth,
  fundingDisabled = false,
  onOpenActivity,
  onAddWeth,
}: {
  familyName: string;
  usdc: string;
  weth: string;
  fundingDisabled?: boolean;
  onOpenActivity: () => void;
  onAddWeth: () => void;
}) {
  return (
    <section className="family-vault-card">
      <button
        className="wallet-activity-trigger"
        type="button"
        aria-label="Open family vault activity"
        aria-haspopup="dialog"
        onClick={onOpenActivity}
      />
      <div className="family-vault-copy">
        <h1>{familyName}&apos;s family vault</h1>
        <div className="family-vault-balance">
          <strong className="family-vault-usdc">
            {usdc} <small>USDC</small>
          </strong>
          <span className="family-vault-weth">
            + {weth} <small>WETH</small>
          </span>
        </div>
        <button
          className="family-vault-add-weth"
          type="button"
          aria-haspopup="dialog"
          disabled={fundingDisabled}
          onClick={onAddWeth}
        >
          <Plus size={18} aria-hidden="true" />
          Add WETH
        </button>
      </div>
      <Image
        className="family-vault-safe"
        src="/illustrations/family/safe.png"
        alt="Purple Star Wallet family safe"
        width={126}
        height={126}
        priority
      />
    </section>
  );
}
