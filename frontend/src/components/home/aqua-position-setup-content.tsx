"use client";

import { LoaderCircle } from "lucide-react";
import type { FormEvent } from "react";
import { formatUnits, type Hash } from "viem";
import type { AquaPositionSnapshot } from "@/lib/aqua-position";
import { ActionStatus } from "./action-status";
import { HomeIllustration } from "./home-ui";
import { KidIllustration } from "./kid-ui";
import { ParentTransactionDetails } from "./parent-transaction-details";

export type SetupStep = "amounts" | "review" | "complete";

/** Keep each step renderable without a wallet for layout and interaction tests. */
export function AquaPositionSetupContent({
  step,
  snapshot,
  usdc,
  weth,
  busy,
  checking,
  disabled,
  error,
  transactionHashes,
  onRefresh,
  onAmountChange,
  onFund,
  onSubmit,
  onDone,
}: {
  step: SetupStep;
  snapshot?: AquaPositionSnapshot;
  usdc: string;
  weth: string;
  busy: boolean;
  checking: boolean;
  disabled: boolean;
  error?: string;
  transactionHashes?: readonly Hash[];
  onRefresh: () => void;
  onAmountChange: (token: "USDC" | "WETH", value: string) => void;
  onFund: (token: "USDC" | "WETH") => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDone: () => void;
  onDetails: () => void;
}) {
  if (step === "complete")
    return (
      <div className="aqua-setup-content aqua-setup-success">
        <div role="status">
          <KidIllustration name="purple_tick" alt="" size={144} />
          <h3>Your Aqua position is active</h3>
          <p>Your Star savings position is ready.</p>
        </div>
        <ParentTransactionDetails
          hashes={transactionHashes}
          completed={!busy}
        />
        <button className="filled-action-button" type="button" onClick={onDone}>
          Done
        </button>
      </div>
    );
  return (
    <form className="aqua-setup-content" onSubmit={onSubmit} aria-busy={busy}>
      <ol className="aqua-setup-steps" aria-label="Position setup progress">
        {(["Choose amounts", "Review & create"] as const).map(
          (label, index) => (
            <li
              key={label}
              aria-current={
                (step === "amounts" ? 0 : 1) === index ? "step" : undefined
              }
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ),
        )}
      </ol>
      <div className="aqua-setup-intro">
        <h3>
          {step === "amounts"
            ? "Choose what to put in"
            : "Review your position"}
        </h3>
        <p>
          {step === "amounts"
            ? "Use USDC and WETH already in your family vault."
            : "These amounts will be allocated from your vault to Aqua."}
        </p>
      </div>
      {step === "amounts" ? (
        <div className="aqua-setup-amounts">
          {(["USDC", "WETH"] as const).map((token) => {
            const decimals = token === "USDC" ? 6 : 18;
            const balance =
              snapshot &&
              (token === "USDC"
                ? snapshot.availableUsdc
                : snapshot.availableWeth);
            const limit =
              snapshot &&
              (token === "USDC" ? snapshot.maxUsdc : snapshot.maxWeth);
            const cap = limit !== undefined ? limit : undefined;
            const max =
              balance !== undefined && cap !== undefined
                ? balance < cap
                  ? balance
                  : cap
                : undefined;
            return (
              <div className="aqua-setup-token" key={token}>
                <div className="parent-action-field">
                  <label
                    className="aqua-setup-token-label"
                    htmlFor={`aqua-${token.toLowerCase()}-amount`}
                  >
                    <HomeIllustration
                      name={token.toLowerCase()}
                      alt=""
                      size={28}
                    />
                    {token} amount
                  </label>
                  <div className="aqua-setup-input">
                    <input
                      id={`aqua-${token.toLowerCase()}-amount`}
                      className="amount-input"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      maxLength={80}
                      placeholder="0.00"
                      value={token === "USDC" ? usdc : weth}
                      disabled={busy || disabled || checking}
                      onChange={(event) =>
                        onAmountChange(token, event.target.value)
                      }
                    />
                    <button
                      className="text-action aqua-setup-max"
                      type="button"
                      disabled={busy || disabled || checking || !max}
                      onClick={() =>
                        max !== undefined &&
                        onAmountChange(token, formatUnits(max, decimals))
                      }
                    >
                      Max
                    </button>
                  </div>
                </div>
                <div className="aqua-setup-balance">
                  <span>
                    Available:{" "}
                    {balance === undefined
                      ? "Checking…"
                      : `${formatUnits(balance, decimals)} ${token}`}
                  </span>
                </div>
                {balance !== undefined &&
                  cap !== undefined &&
                  cap < balance && (
                    <p className="aqua-setup-note">
                      Position limit: {formatUnits(cap, decimals)} {token}
                    </p>
                  )}
                {balance === 0n && (
                  <div className="aqua-setup-prerequisite">
                    <p>
                      {token === "USDC"
                        ? "Rewarding Stars adds USDC to your family vault."
                        : "Add WETH from your parent wallet first."}
                    </p>
                    <button
                      className="outline-action-button"
                      type="button"
                      disabled={busy || disabled || checking}
                      onClick={() => onFund(token)}
                    >
                      {token === "USDC" ? "Reward Stars" : "Add WETH"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <dl className="aqua-setup-review">
          <div>
            <dt>USDC to allocate</dt>
            <dd>{usdc.trim() || "0"} USDC</dd>
          </div>
          <div>
            <dt>WETH to allocate</dt>
            <dd>{weth.trim() || "0"} WETH</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>Ethereum Sepolia (testnet)</dd>
          </div>
          <div>
            <dt>Trading fee</dt>
            <dd>0.3%</dd>
          </div>
          {/* {topUp && (
            <div>
              <dt>Position</dt>
              <dd>Same strategy · unchanged expiry</dd>
            </div>
          )} */}
        </dl>
      )}
      {/* <p className="aqua-setup-note">
        {step === "amounts"
          ? "Anything you don’t allocate stays available in your vault. Your child’s Stars won’t change."
          : topUp
            ? "The existing price range, trading fee and expiry stay unchanged. Adding one token can change the position’s trading price within its range. This does not redeem Stars or withdraw savings."
            : "Aqua can swap these tokens, so the amounts held can change. The app’s configured price range and expiry apply. This does not redeem Stars or withdraw savings."}
      </p> */}
      <footer className="aqua-setup-footer">
        <ActionStatus
          state="error"
          message={error}
          onRefresh={onRefresh}
          refreshing={busy || checking}
          refreshLabel="Refresh Aqua position"
        />
        <ParentTransactionDetails
          hashes={transactionHashes}
          completed={false}
        />
        <button
          className="filled-action-button"
          type="submit"
          disabled={
            busy ||
            checking ||
            disabled ||
            !usdc.trim() ||
            !weth.trim() ||
            snapshot?.availableUsdc === 0n ||
            snapshot?.availableWeth === 0n
          }
          aria-busy={busy || checking}
        >
          {(busy || checking) && (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          )}
          {step === "amounts" ? "Continue" : "Create Aqua position"}
        </button>
      </footer>
    </form>
  );
}
