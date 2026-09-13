"use client";

import { registryAbi, familyVaultFactoryAbi } from "@star/contracts/abi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  getAddress,
  parseEventLogs,
  zeroAddress,
  type TransactionReceipt,
} from "viem";
import { sepolia } from "viem/chains";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
} from "wagmi";
import {
  childEns,
  emptyDraft,
  familyEns,
  readDraft,
  saveDraft,
  steps,
  validAddress,
  type OnboardingDraft,
} from "@/lib/onboarding";
import {
  starApi,
  retryStarQuery,
  type TransactionIntent,
} from "@/lib/star-api";
import { provisionChild } from "@/lib/child-onboarding";
import { registerFamilyEns } from "@/lib/family-ens";
import { createChildCredential, sendChildIntent } from "@/lib/child-account";
import { clearWalletSelection } from "@/lib/wallet-context";
import {
  existingFamilyForWallet,
  returningFamilyDraft,
  draftWithoutIndexedFamily,
  shouldCheckFamily,
  resumeFamilyOnboarding,
  familyForProfiles,
} from "@/lib/onboarding-entry";
import { Progress } from "./onboarding-ui";
import { ChildStep } from "./steps/child-step";
import { CompleteStep } from "./steps/complete-step";
import { ConfirmStep } from "./steps/confirm-step";
import { FamilyStep } from "./steps/family-step";
import { WalletStep } from "./steps/wallet-step";
import { WelcomeStarfield, WelcomeStep } from "./steps/welcome-step";
import type { Operation } from "./types";

export function OnboardingFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { address, chainId, isConnected, isReconnecting } = useAccount();
  const connectedWallet = isConnected ? address : undefined;
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const sepoliaClient = usePublicClient({ chainId: sepolia.id });
  const [draft, setDraft] = useState<OnboardingDraft>(emptyDraft);
  // Welcome is always the entry screen. Wallet auto-reconnection and saved
  // completion flags cannot begin discovery or navigate without a user action.
  const [requestedWallet, setRequestedWallet] = useState<string | null>(null);
  const [checkedWallet, setCheckedWallet] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>({ state: "idle" });
  const [copied, setCopied] = useState<"ens" | null>(null);
  const config = useQuery({
    queryKey: ["star", "config"],
    queryFn: ({ signal }) => starApi.config({ signal }),
    retry: retryStarQuery,
  });
  const ensRoot = config.data?.ensParentName ?? "";
  const lookupEnabled = shouldCheckFamily(
    connectedWallet,
    requestedWallet,
    draft.step,
  );
  const familyLookup = useQuery({
    // Share the discovery result with the profile picker’s data provider.
    queryKey: ["star", "families", connectedWallet?.toLowerCase() ?? ""],
    queryFn: ({ signal }) =>
      starApi.allFamiliesByParent(connectedWallet!, { signal }),
    select: (response) => ({
      family: existingFamilyForWallet(response, connectedWallet!, draft),
      indexedBlock: response.indexing.block.number,
    }),
    enabled: lookupEnabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const checkingFamily = Boolean(
    lookupEnabled && (familyLookup.isPending || familyLookup.isFetching),
  );
  const canCreateFamily = Boolean(
    connectedWallet &&
    lookupEnabled &&
    familyLookup.isSuccess &&
    !familyLookup.isFetching &&
    checkedWallet === connectedWallet.toLowerCase() &&
    (familyLookup.data.family === null ||
      (familyLookup.data.family.id === draft.familyId &&
        familyLookup.data.family.childCount === 0)),
  );

  useEffect(() => {
    if (
      !connectedWallet ||
      !lookupEnabled ||
      checkedWallet === connectedWallet.toLowerCase() ||
      familyLookup.isFetching ||
      !familyLookup.isSuccess
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      const family = familyLookup.data.family;
      if (family && family.childCount > 0) {
        clearWalletSelection();
        saveDraft(
          returningFamilyDraft(
            connectedWallet,
            family,
            readDraft(connectedWallet),
          ),
        );
        router.replace("/wallet/profiles");
        return;
      }
      if (family) {
        const next = resumeFamilyOnboarding(
          connectedWallet,
          family,
          readDraft(connectedWallet),
        );
        saveDraft(next);
        setDraft(next);
        clearWalletSelection();
      } else {
        const saved = draftWithoutIndexedFamily(
          connectedWallet,
          readDraft(connectedWallet),
          familyLookup.data.indexedBlock,
        );
        const next = { ...saved, step: Math.max(2, saved.step) };
        saveDraft(next);
        setDraft(next);
        clearWalletSelection();
      }
      setCheckedWallet(connectedWallet.toLowerCase());
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    connectedWallet,
    lookupEnabled,
    checkedWallet,
    familyLookup.isFetching,
    familyLookup.isSuccess,
    familyLookup.data,
    router,
  ]);

  const commit = useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      saveDraft(next);
      return next;
    });
  }, []);

  const parentAddress = address ?? draft.parentAddress;
  const currentFamilyEns = useMemo(
    () => (ensRoot ? familyEns(draft.familyName, ensRoot) : ""),
    [draft.familyName, ensRoot],
  );
  const currentChildEns = useMemo(
    () => childEns(draft.childName, draft.familyEnsName || currentFamilyEns),
    [currentFamilyEns, draft.childName, draft.familyEnsName],
  );

  const goTo = (step: number) => {
    setOperation({ state: "idle" });
    const nextStep = Math.max(0, Math.min(steps.length - 1, step));
    if (nextStep <= 1) {
      setRequestedWallet(null);
      setCheckedWallet(null);
    }
    // Do not overwrite a saved family's credentials just by visiting Welcome.
    if (!checkedWallet || nextStep <= 1)
      setDraft((current) => ({ ...current, step: nextStep }));
    else commit({ step: nextStep });
  };

  const checkConnectedWallet = (wallet: string) => {
    const saved = readDraft(wallet);
    setDraft({ ...saved, parentAddress: wallet, step: 1 });
    setCheckedWallet(null);
    setRequestedWallet(wallet.toLowerCase());
    setOperation({ state: "idle" });
  };

  const connectWallet = async () => {
    const connector = connectors[0];
    if (!connector) {
      setOperation({
        state: "error",
        message: "No browser wallet was found. Install a wallet to continue.",
      });
      return;
    }

    try {
      const result = await connectAsync({ connector });
      clearWalletSelection();
      checkConnectedWallet(result.accounts[0]);
    } catch (error) {
      setOperation({ state: "error", message: errorMessage(error) });
    }
  };

  const continueWithWallet = () => {
    if (!isConnected || !address || !validAddress(parentAddress)) {
      setOperation({
        state: "error",
        message: "Connect your wallet before continuing.",
      });
      return;
    }
    checkConnectedWallet(address);
  };

  const disconnectWallet = () => {
    if (isConnected) disconnect();
    setRequestedWallet(null);
    setCheckedWallet(null);
    setDraft({ ...emptyDraft, step: 1 });
    setOperation({ state: "idle" });
  };

  const sendParentIntent = useCallback(
    async (intent: TransactionIntent): Promise<TransactionReceipt> => {
      if (intent.signerRole !== "PARENT")
        throw new Error(
          `Expected a parent intent, received ${intent.signerRole}.`,
        );
      if (!address || !isConnected)
        throw new Error("Connect the registered parent wallet first.");
      if (
        draft.parentAddress &&
        getAddress(address) !== getAddress(draft.parentAddress)
      )
        throw new Error(
          "Reconnect the parent wallet used for this onboarding.",
        );
      if (intent.chainId !== sepolia.id)
        throw new Error(`Unexpected intent chain ${intent.chainId}.`);
      if (chainId !== sepolia.id)
        await switchChainAsync({ chainId: sepolia.id });
      if (!sepoliaClient) throw new Error("The Sepolia client is unavailable.");

      const hash = await sendTransactionAsync({
        account: address,
        chainId: sepolia.id,
        to: intent.to,
        data: intent.data,
        value: BigInt(intent.value),
      });
      const receipt = await sepoliaClient.waitForTransactionReceipt({
        hash,
        // Do not treat Viem's default three-minute polling deadline as an
        // on-chain failure after MetaMask has already broadcast the write.
        timeout: 0,
      });
      if (receipt.status !== "success")
        throw new Error(`${intent.summary} reverted.`);
      return receipt;
    },
    [
      address,
      draft.parentAddress,
      sepoliaClient,
      chainId,
      isConnected,
      sendTransactionAsync,
      switchChainAsync,
    ],
  );

  const createFamily = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreateFamily) return;
    if (!currentFamilyEns || draft.familyName.trim().length < 2) {
      setOperation({
        state: "error",
        message: "Choose a family name with at least two characters.",
      });
      return;
    }

    try {
      if (!ensRoot)
        throw new Error("The backend ENS configuration is not available yet.");
      if (!address || !isConnected || !sepoliaClient)
        throw new Error("Connect the parent wallet first.");
      if (draft.familyId && draft.familyEnsName !== currentFamilyEns)
        throw new Error(
          "This onboarding already has a family. Keep its original name, or start a new onboarding.",
        );
      let familyId = familyLookup.data?.family?.id ?? "";
      let familyCreationBlock = draft.familyCreationBlock;
      if (!familyId) {
        setOperation({
          state: "working",
          message: "Setting up your family ENS name…",
        });
        await registerFamilyEns({
          name: currentFamilyEns,
          parent: address,
          send: sendParentIntent,
          onMessage: (message) => setOperation({ state: "working", message }),
        });
        const family = await starApi.intent("createFamily", {
          ensName: currentFamilyEns,
        });
        const createIntent = parentIntent(family.intents);
        // Recover a confirmed family even if the browser closed before saving its receipt.
        const ids = await sepoliaClient.readContract({
          address: createIntent.to,
          abi: registryAbi,
          functionName: "getFamilyIdsByParent",
          args: [address],
        });
        for (const id of [...ids].reverse()) {
          const existing = await sepoliaClient.readContract({
            address: createIntent.to,
            abi: registryAbi,
            functionName: "getFamily",
            args: [id],
          });
          if (existing.ensName === currentFamilyEns) {
            if (!existing.active)
              throw new Error(
                "Reactivate the existing family before continuing.",
              );
            familyId = id.toString();
            break;
          }
        }
        if (!familyId) {
          const receipt = await sendParentIntent(createIntent);
          familyId = createdFamilyId(receipt);
          familyCreationBlock = receipt.blockNumber.toString();
        }
        commit({
          familyEnsName: currentFamilyEns,
          familyId,
          familyCreationBlock,
        });
      }

      setOperation({
        state: "working",
        message: "Creating your isolated family vault…",
      });
      const vault = await starApi.intent("createVault", { familyId });
      const vaultIntent = parentIntent(vault.intents);
      const existingVault = await sepoliaClient.readContract({
        address: vaultIntent.to,
        abi: familyVaultFactoryAbi,
        functionName: "vaultByFamily",
        args: [BigInt(familyId)],
      });
      if (existingVault === zeroAddress) await sendParentIntent(vaultIntent);
      commit({
        familyEnsName: currentFamilyEns,
        familyId,
        vaultReady: true,
        step: 3,
      });
      setOperation({ state: "idle" });
    } catch (error) {
      setOperation({ state: "error", message: errorMessage(error) });
    }
  };

  const saveChild = async (event: FormEvent) => {
    event.preventDefault();

    if (draft.childName.trim().length < 2 || !currentChildEns) {
      setOperation({
        state: "error",
        message: "Choose a child nickname with at least two characters.",
      });
      return;
    }
    try {
      setOperation({
        state: "working",
        message: "Setting up your child's passkey…",
      });
      const config = await starApi.childAccountConfig();
      if (!config.sponsorshipConfigured)
        throw new Error(
          "Configure the child bundler and paymaster before onboarding a child.",
        );
      const existing = await starApi.findChildAccount(
        draft.familyId,
        currentChildEns,
      );
      const credential =
        existing?.credential ??
        (draft.childCredential && draft.childEnsName === currentChildEns
          ? draft.childCredential
          : await createChildCredential(currentChildEns, config.rpId));
      commit({
        childCredential: credential,
        childEnsName: currentChildEns,
        ...(draft.childEnsName !== currentChildEns
          ? {
              childWallet: "",
              registrationId: "",
              registrationProposed: false,
              registrationAccepted: false,
            }
          : {}),
        step: 4,
      });
      setOperation({ state: "idle" });
    } catch (error) {
      setOperation({ state: "error", message: errorMessage(error) });
    }
  };

  const proposeChild = async () => {
    try {
      if (!address || !isConnected)
        throw new Error("Connect the parent wallet first.");
      if (!draft.childCredential)
        throw new Error("Go back and set up the child's passkey first.");
      const result = await provisionChild({
        familyId: draft.familyId,
        ensName: draft.childEnsName,
        parent: address,
        send: sendParentIntent,
        credential: draft.childCredential,
        sendChild: sendChildIntent,
        onMessage: (message) => setOperation({ state: "working", message }),
        onProgress: commit,
      });
      commit({
        ...result,
        registrationProposed: true,
        registrationAccepted: true,
        step: 5,
      });
      setOperation({ state: "idle" });
    } catch (error) {
      setOperation({ state: "error", message: errorMessage(error) });
    }
  };

  const openProfiles = async () => {
    if (operation.state === "working") return;
    if (!connectedWallet || !draft.registrationAccepted || !draft.childWallet) {
      commit({ registrationAccepted: false, step: 3 });
      return;
    }
    setOperation({
      state: "working",
      message: "Loading your family’s profiles…",
    });
    try {
      const family = await familyForProfiles(connectedWallet, draft.familyId);
      queryClient.setQueryData(["star", "family", family.id], family);
      await queryClient.invalidateQueries({
        queryKey: ["star", "families", connectedWallet.toLowerCase()],
        exact: true,
        refetchType: "none",
      });
      router.replace("/wallet/profiles");
    } catch (error) {
      setOperation({ state: "error", message: errorMessage(error) });
    }
  };

  const copyEns = async () => {
    await navigator.clipboard.writeText(draft.childEnsName);
    setCopied("ens");
    window.setTimeout(() => setCopied(null), 1_500);
  };

  const waitingForFamily = Boolean(
    checkingFamily ||
    (lookupEnabled &&
      familyLookup.isSuccess &&
      checkedWallet !== connectedWallet?.toLowerCase()),
  );
  const familyLookupFailed = Boolean(
    lookupEnabled && connectedWallet && familyLookup.isError,
  );
  // Discovery and navigation keep the wallet screen mounted, with the same
  // inline progress/error panel used by every other onboarding step.
  const walletOperation: Operation = waitingForFamily
    ? {
        state: "working",
        message: checkingFamily
          ? "Checking your wallet for an existing family…"
          : "Opening your family…",
      }
    : familyLookupFailed
      ? {
          state: "error",
          message:
            "Couldn’t check whether this wallet already has a family. Please try again.",
        }
      : operation;

  const step =
    draft.step > 1 &&
    (!lookupEnabled || checkedWallet !== connectedWallet?.toLowerCase())
      ? 1
      : draft.step;

  return (
    <main className="onboarding-page">
      <section className="onboarding-frame">
        {step === 0 && <WelcomeStarfield />}
        <div className="flow-panel">
          {step > 0 && (
            <header className="screen-nav">
              {step < 5 ? (
                <button
                  className="back-button"
                  type="button"
                  onClick={() =>
                    goTo(step === 3 && draft.familyId ? 1 : step - 1)
                  }
                  aria-label="Go back"
                  disabled={operation.state === "working"}
                >
                  <ArrowLeft size={23} />
                </button>
              ) : (
                <span />
              )}
              <Progress step={step} />
              <span aria-hidden="true" />
            </header>
          )}

          <div className="step-content" data-step={step}>
            {step === 0 && <WelcomeStep onContinue={() => goTo(1)} />}
            {step === 1 && (
              <WalletStep
                address={parentAddress}
                connected={isConnected}
                connecting={isConnecting || isReconnecting}
                operation={walletOperation}
                onConnect={connectWallet}
                onContinue={
                  familyLookupFailed
                    ? () => void familyLookup.refetch()
                    : continueWithWallet
                }
                continueLabel={familyLookupFailed ? "Try again" : "Continue"}
                onDisconnect={disconnectWallet}
              />
            )}
            {step === 2 && (
              <FamilyStep
                draft={draft}
                ensName={currentFamilyEns}
                ensRoot={ensRoot}
                operation={
                  config.error
                    ? { state: "error", message: config.error.message }
                    : config.isPending
                      ? {
                          state: "working",
                          message: "Loading app configuration…",
                        }
                      : operation
                }
                onChange={(familyName) => commit({ familyName })}
                onSubmit={createFamily}
              />
            )}
            {step === 3 && (
              <ChildStep
                draft={draft}
                ensName={currentChildEns}
                operation={operation}
                onName={(childName) => commit({ childName })}
                onSubmit={saveChild}
              />
            )}
            {step === 4 && (
              <ConfirmStep
                draft={draft}
                operation={operation}
                ensCopied={copied === "ens"}
                onCopy={copyEns}
                onPropose={proposeChild}
              />
            )}
            {step === 5 && (
              <CompleteStep
                draft={draft}
                onContinue={openProfiles}
                operation={operation}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function parentIntent(intents: TransactionIntent[]): TransactionIntent {
  const intent = intents.find((item) => item.signerRole === "PARENT");
  if (!intent)
    throw new Error(
      "The Star API did not return a parent-signed transaction intent.",
    );
  return intent;
}

function createdFamilyId(receipt: TransactionReceipt): string {
  const events = parseEventLogs({
    abi: registryAbi,
    eventName: "FamilyCreated",
    logs: receipt.logs,
    strict: true,
  });
  const familyId = events[0]?.args.familyId;
  if (familyId === undefined)
    throw new Error("The family transaction did not emit FamilyCreated.");
  return familyId.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
