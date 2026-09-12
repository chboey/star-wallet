import { ChevronRight, LoaderCircle, LogOut, WalletCards } from "lucide-react";
import { shortAddress, validAddress } from "@/lib/onboarding";
import { Artwork, OperationMessage } from "../onboarding-ui";
import type { Operation } from "../types";

type WalletStepProps = {
  address: string;
  connected: boolean;
  connecting: boolean;
  operation: Operation;
  onConnect: () => void;
  onContinue: () => void;
  onDisconnect: () => void;
  continueLabel?: string;
};

export function WalletStep(props: WalletStepProps) {
  const hasAddress = props.connected && validAddress(props.address);

  return (
    <div className="step-screen wallet-step">
      <div className="step-body">
        <div className="center-copy compact step-heading">
          <h1>Connect your wallet</h1>
        </div>
        <Artwork
          src="/illustrations/onboarding/wallet.png"
          alt="A secure purple wallet"
          variant="wallet"
        />
        <div className="step-details">
          {hasAddress ? (
            <div className="connected-card">
              <span className="wallet-avatar">
                <WalletCards size={22} />
              </span>
              <div>
                <span>Connected wallet</span>
                <strong>{shortAddress(props.address)}</strong>
              </div>
              <button
                type="button"
                className="text-icon-button"
                onClick={props.onDisconnect}
              >
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <button
              className="wallet-option"
              type="button"
              onClick={props.onConnect}
              disabled={props.connecting}
            >
              <span className="wallet-avatar">
                <WalletCards size={22} />
              </span>
              <span>
                <strong>External wallet</strong>
              </span>
              {props.connecting ? (
                <LoaderCircle className="spin" size={20} />
              ) : (
                <ChevronRight size={20} />
              )}
            </button>
          )}
          <OperationMessage operation={props.operation} />
        </div>
      </div>
      <div className="step-actions">
        <button
          className="primary-button"
          type="button"
          onClick={props.onContinue}
          disabled={
            !hasAddress ||
            props.connecting ||
            props.operation.state === "working"
          }
        >
          {props.continueLabel ?? "Continue"}
        </button>
      </div>
    </div>
  );
}
