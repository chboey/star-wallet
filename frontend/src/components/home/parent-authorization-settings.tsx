"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  useAccount,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
} from "wagmi";
import { childAccountAbi, registryAbi } from "@star/contracts/abi";
import { encodeFunctionData } from "viem";
import { sepolia } from "viem/chains";
import { createChildCredential } from "@/lib/child-account";
import {
  prepareParentPasskeySetup,
  readParentAuthorization,
} from "@/lib/parent-authorization";
import { starApi } from "@/lib/star-api";
import { displayEnsName } from "@/lib/star-format";
import { deviceAuthorizationStore } from "@/lib/parent-device-key";
import { ParentActionSheet } from "./parent-action-sheet";
import { useStarData } from "./star-data-provider";
import { waitForParentTransaction } from "@/lib/parent-transactions";

export function ParentAuthorizationSettings({
  onClose,
}: {
  onClose: () => void;
}) {
  const { family } = useStarData();
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: sepolia.id });
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const [wallet, setWallet] = useState(family?.children[0]?.wallet ?? "");
  const [state, setState] = useState<Awaited<
    ReturnType<typeof readParentAuthorization>
  > | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = busy || (!state && !error);
  const lock = useRef(false);
  const selected = family?.children.find((item) => item.wallet === wallet);
  const name = displayEnsName(selected?.ensName ?? "", "Child");
  useEffect(() => {
    if (!client || !selected) return;
    let current = true;
    readParentAuthorization(client, selected.wallet).then(
      (result) => {
        if (current) setState(result);
      },
      () => {
        if (current)
          setError(
            "Unable to check this account. Please reopen this popup to retry.",
          );
      },
    );
    return () => {
      current = false;
    };
  }, [client, selected]);

  const act = async (kind: "configure" | "revoke") => {
    if (lock.current || !client || !selected || !family || !state?.supported)
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!address || address.toLowerCase() !== family.parent.toLowerCase())
        throw new Error("Connect the registered parent wallet first.");
      const metadata = await starApi.childAccount(selected.wallet);
      const registry = await client.readContract({
        address: selected.wallet,
        abi: childAccountAbi,
        functionName: "registry",
      });
      const registeredFamily = await client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "getFamily",
        args: [BigInt(metadata.familyId)],
      });
      if (
        registeredFamily.parent.toLowerCase() !== address.toLowerCase() ||
        metadata.familyId !== family.id
      )
        throw new Error(
          "This child account does not belong to the connected parent.",
        );
      let data;
      if (kind === "configure") {
        const setup = await prepareParentPasskeySetup(
          client,
          selected.wallet,
          async () => {
            const config = await starApi.childAccountConfig();
            return createChildCredential(
              `Parent approval for ${name}`,
              config.rpId,
            );
          },
        );
        setState(setup.state);
        if (!setup.credential) {
          return;
        }
        const credential = setup.credential;
        data = encodeFunctionData({
          abi: childAccountAbi,
          functionName: "configureParentPasskey",
          args: [
            `0x${credential.publicKey.slice(2, 66)}`,
            `0x${credential.publicKey.slice(66)}`,
            credential.id,
          ],
        });
      } else {
        data = encodeFunctionData({
          abi: childAccountAbi,
          functionName: "revokeParentAuthorizations",
        });
      }
      if (chainId !== sepolia.id)
        await switchChainAsync({ chainId: sepolia.id });
      const hash = await sendTransactionAsync({
        account: address,
        chainId: sepolia.id,
        to: selected.wallet,
        data,
        value: 0n,
      });
      const receipt = await waitForParentTransaction(
        client,
        hash,
        () => undefined,
      );
      if (receipt.status !== "success")
        throw new Error("The update reverted. Authorization was not changed.");
      // Contract revocation is authoritative even if this browser's cache is unavailable.
      await deviceAuthorizationStore.remove(selected.wallet).catch(() => {});
      setState(await readParentAuthorization(client, selected.wallet));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to update parent authorization.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  if (!selected)
    return (
      <ParentActionSheet title="Parent authorization" onClose={onClose}>
        <p>Add a child before setting up device authorization.</p>
      </ParentActionSheet>
    );

  return (
    <ParentActionSheet
      title="Parent authorization"
      onClose={() => {
        if (!lock.current) onClose();
      }}
    >
      <div className="parent-authorization-settings">
        <label className="parent-action-field">
          <span>Child account</span>
          <span className="parent-authorization-select">
            <select
              value={wallet}
              disabled={busy}
              onChange={(event) => {
                setWallet(event.target.value as typeof wallet);
                setState(null);
                setError("");
              }}
            >
              {family?.children.map((item) => (
                <option key={item.wallet} value={item.wallet}>
                  {displayEnsName(item.ensName, "Child")}
                </option>
              ))}
            </select>
            <ChevronDown size={18} aria-hidden="true" />
          </span>
        </label>
        <p>
          Approve a device once with your passkey. It stays approved until you
          revoke access.
        </p>
        <p>
          Device access only allows child requests. It cannot transfer money or
          approve rewards.
        </p>
        {state?.supported && (
          <p>
            {state.credential.id
              ? "Parent passkey is already set up. This passkey will be used if a device needs your approval."
              : "One-time setup: create a parent passkey and link it with your registered parent wallet. This setup requires a network transaction; later device approvals do not."}
          </p>
        )}
        {error && (
          <span className="sr-only" role="alert">
            {error}
          </span>
        )}
        <button
          className="filled-action-button parent-authorization-submit"
          type="button"
          aria-busy={pending}
          disabled={
            pending ||
            !state?.supported ||
            Boolean(state.credential.id) ||
            Boolean(error && !state)
          }
          onClick={() => void act("configure")}
        >
          {pending && (
            <span
              className="parent-authorization-spinner spin"
              aria-hidden="true"
            />
          )}
          {state?.supported && state.credential.id
            ? "Passkey already set up"
            : "Set up parent passkey"}
        </button>
        {state?.supported && state.credential.id && (
          <button
            className="outline-action-button"
            type="button"
            disabled={busy}
            onClick={() => void act("revoke")}
          >
            Revoke all device approvals
          </button>
        )}
      </div>
    </ParentActionSheet>
  );
}
