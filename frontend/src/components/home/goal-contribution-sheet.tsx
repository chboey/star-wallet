"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { sepolia } from "viem/chains";
import type { StarGoal } from "@/lib/star-api.types";
import {
  contributionAmount,
  contributionLimit,
  goalContributionKey,
  readGoalContribution,
} from "@/lib/goal-contributions";
import { starReadOptions } from "@/lib/wallet-refresh";
import { ParentActionSheet } from "./parent-action-sheet";
import { GoalContributionContent } from "./goal-contribution-content";
import { ActionStatus, IntentStatus } from "./action-status";
import { useReadOnEntry } from "./use-read-on-entry";
import { useStarData } from "./star-data-provider";
import { useStarIntents } from "./use-star-intents";

export function GoalContributionSheet({
  goal,
  onClose,
}: {
  goal: StarGoal;
  onClose: () => void;
}) {
  const { child, family } = useStarData();
  const client = usePublicClient({ chainId: sepolia.id });
  const { execute, operation } = useStarIntents();
  const [value, setValue] = useState("1");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const lock = useRef(false);
  const key = goalContributionKey(child?.wallet, goal.id);
  const enabled = Boolean(child && client);
  const query = useQuery({
    ...starReadOptions,
    queryKey: key,
    enabled,
    queryFn: () => {
      if (!child || !client)
        throw new Error("The child's account is unavailable.");
      return readGoalContribution(client, child.wallet, child.id, goal.id);
    },
  });
  useReadOnEntry(key, enabled);
  const state = query.data;
  const maximum = state
    ? contributionLimit(state.available, state.target, state.allocated)
    : 0n;
  const inactive =
    !child?.active ||
    !family?.active ||
    !state ||
    state.status !== 0 ||
    state.pendingId !== 0n;
  const close = () => {
    if (!lock.current) onClose();
  };
  const submit = async () => {
    const amount = contributionAmount(value);
    if (
      lock.current ||
      inactive ||
      query.isFetching ||
      query.error ||
      !amount ||
      amount > maximum
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      await execute(
        "addStarsToGoal",
        { goalId: goal.id, amount: amount.toString() },
        "CHILD",
      );
      setAdded(amount.toString());
    } catch {
      // Keep the same amount and display the operation error; never retry a write automatically.
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <ParentActionSheet
      title={`Add Stars to ${goal.title}`}
      onClose={close}
      className="goal-contribution-sheet"
    >
      <GoalContributionContent
        available={query.error ? undefined : state?.available}
        maximum={maximum}
        value={value}
        onChange={setValue}
        onSubmit={() => void submit()}
        busy={busy}
        loading={query.isPending || query.isFetching}
        disabled={inactive || Boolean(query.error)}
        added={added}
        onDone={close}
      />
      {added === null && query.error && (
        <ActionStatus
          state="error"
          message={query.error.message}
          onRefresh={() => void query.refetch()}
          refreshing={query.isFetching}
        />
      )}
      {added === null &&
        !query.error &&
        state &&
        (inactive || maximum === 0n) && (
          <p className="goal-contribution-note">
            {!child?.active || !family?.active
              ? "Ask your parent to reactivate your account before adding Stars."
              : state.status !== 0
                ? "This goal is no longer accepting Stars."
                : state.pendingId !== 0n
                  ? "This goal is waiting for your parent's approval."
                  : state.allocated >= state.target
                    ? ""
                    : ""}
          </p>
        )}
      {added === null && <IntentStatus operation={operation} busy={busy} />}
    </ParentActionSheet>
  );
}
