"use client";

import { ChevronDown } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { StarApiError } from "@/lib/star-api";
import { displayEnsName } from "@/lib/star-format";
import { submissionId } from "@/lib/star-submissions";
import { questTemplateValues, type QuestTemplate } from "@/lib/quest-templates";
import { ActionStatus, IntentStatus } from "./action-status";
import { FullScreenLoader, SectionEmptyState } from "./home-ui";
import { KidIllustration } from "./kid-ui";
import { KidQuestPreview } from "./kid-quest-preview";
import { ParentActionSheet } from "./parent-action-sheet";
import { ParentTransactionDetails } from "./parent-transaction-details";
import { QuestCard } from "./quest-card";
import { QuestAssignedSuccess, QuestSubmitButton } from "./quest-form-feedback";
import { QuestTemplatePicker } from "./quest-template-picker";
import { useStarData } from "./star-data-provider";
import { useStarIntents } from "./use-star-intents";
import { useQuestInbox } from "./use-quest-inbox";
import styles from "./quest-inbox.module.css";
import assignmentStyles from "./quest-assignment.module.css";

export function QuestInbox({
  childOnly,
  enabled = true,
}: {
  childOnly: true;
  enabled?: boolean;
}) {
  const { family, child } = useStarData();
  const [view, setView] = useState<"available" | "waiting" | "history">(
    "available",
  );
  const [preview, setPreview] = useState<{
    id: string;
    started: boolean;
  } | null>(null);
  const [submissionSent, setSubmissionSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState("");
  const lock = useRef(false);
  const query = useQuestInbox(view, childOnly, "quests", enabled);
  const { execute, operation, resetOperation } = useStarIntents();
  const selectedQuest = query.quests.find(
    (quest) => quest.id === preview?.id && quest.child.id === child?.id,
  );
  const cannotSubmit = Boolean(
    !family?.active || !family.vault || !child?.active,
  );

  const submit = async (questId: string) => {
    if (lock.current || !child || !family?.vault) return;
    lock.current = true;
    setBusy(true);
    setLocalMessage("");
    const key = `star:quest:${family.vault.questsAddress}:${child.id}:${questId}`;
    try {
      await execute(
        "submitQuest",
        { childId: child.id, id: questId, submissionId: submissionId(key) },
        "CHILD",
      );
      sessionStorage.removeItem(key);
      setPreview(null);
      setView("waiting");
      setSubmissionSent(true);
    } catch (cause) {
      if (
        cause instanceof StarApiError &&
        cause.code === "SUBMISSION_ALREADY_RECORDED"
      ) {
        sessionStorage.removeItem(key);
        await query.refetch();
      }
      setLocalMessage(
        cause instanceof Error ? cause.message : "Unable to submit the quest.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  if (!family || !child) return <SectionEmptyState />;

  if (selectedQuest && preview)
    return (
      <KidQuestPreview
        quest={selectedQuest}
        started={preview.started}
        busy={busy}
        disabled={!enabled || cannotSubmit || Boolean(query.error)}
        error={
          localMessage ||
          (operation.state === "error"
            ? operation.message
            : query.error?.message)
        }
        onBack={() => {
          if (lock.current) return;
          setPreview(null);
          setLocalMessage("");
          resetOperation();
        }}
        onStart={() => setPreview({ id: selectedQuest.id, started: true })}
        onSubmit={() => void submit(selectedQuest.questId)}
      />
    );

  return (
    <div className={styles.inbox}>
      <div className={styles.toolbar}>
        <div className={`kid-tabs ${styles.tabs}`} aria-label="Quest inbox">
          {(["available", "waiting", "history"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={view === tab ? "active" : ""}
              aria-pressed={view === tab}
              disabled={busy}
              onClick={() => {
                if (lock.current || tab === view) return;
                setView(tab);
                setLocalMessage("");
                resetOperation();
              }}
            >
              {tab === "available"
                ? "Available"
                : tab === "waiting"
                  ? "Waiting"
                  : "Completed"}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.content} key={view}>
        <IntentStatus operation={operation} busy={busy} error={localMessage} />
        {query.isPending ? (
          <FullScreenLoader />
        ) : query.error ? (
          <ActionStatus
            state="error"
            message={query.error.message}
            onRefresh={() => void query.refetch()}
            refreshing={query.isFetching}
            refreshLabel="Refresh quests"
          />
        ) : (
          <>
            {view === "available" ? (
              <>
                {!query.quests.length && <SectionEmptyState />}
                {query.quests.map((quest) => (
                  <QuestCard
                    key={quest.id}
                    title={quest.title}
                    stars={quest.stars}
                    disabled={busy}
                    onOpen={() => {
                      if (lock.current) return;
                      resetOperation();
                      setLocalMessage("");
                      setPreview({ id: quest.id, started: false });
                    }}
                  />
                ))}
              </>
            ) : (
              <>
                {!query.requests.length && !query.quests.length && (
                  <SectionEmptyState />
                )}
                {query.requests.map((request) => (
                  <QuestCard
                    key={request.id}
                    title={request.quest?.title ?? request.reason}
                    stars={request.stars}
                    subtitle={`Quest · ${request.status.toLowerCase()}`}
                    expandable={false}
                  />
                ))}
                {view === "history" &&
                  query.quests.map((quest) => (
                    <QuestCard
                      key={quest.id}
                      title={quest.title}
                      stars={quest.stars}
                      subtitle={`Quest ${quest.status.toLowerCase()}`}
                    />
                  ))}
              </>
            )}
            {query.hasNextPage && (
              <button
                type="button"
                disabled={query.isFetchingNextPage || busy}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? "Fetching…" : "Show more"}
              </button>
            )}
          </>
        )}
      </div>
      {submissionSent && (
        <ParentActionSheet
          title="Quest complete"
          onClose={() => setSubmissionSent(false)}
        >
          <div className="goal-request-result quest-submission-result">
            <KidIllustration name="paper_plane_sparkle" alt="" size={240} />
            <p>
              Congrats on completing your quest! We have informed your parents
              about it
            </p>
            <button
              className="filled-action-button"
              type="button"
              onClick={() => setSubmissionSent(false)}
            >
              Done
            </button>
          </div>
        </ParentActionSheet>
      )}
    </div>
  );
}

export function QuestForm({
  childOnly,
  onClose,
}: {
  childOnly: boolean;
  onClose: () => void;
}) {
  const { family, child } = useStarData();
  const [childId, setChildId] = useState(
    childOnly
      ? (child?.id ?? "")
      : (family?.children.find((item) => item.active)?.id ?? ""),
  );
  const [text, setText] = useState("");
  const [stars, setStars] = useState("");
  const [templateId, setTemplateId] = useState<QuestTemplate["id"] | null>(
    null,
  );
  const [step, setStep] = useState<"child" | "quest">("child");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const { execute, operation, resetOperation } = useStarIntents();
  const chosenChild = family?.children.find((item) => item.id === childId);
  const canAssign = Boolean(
    family?.active &&
    family.vault &&
    (childOnly ? child?.active : chosenChild?.active),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      lock.current ||
      !canAssign ||
      (!childOnly && (step !== "quest" || !templateId))
    )
      return;
    const reason = text.trim();
    if (
      !/^[1-9][0-9]{0,3}$/.test(stars) ||
      Number(stars) > 1000 ||
      !reason ||
      new TextEncoder().encode(reason).length > (childOnly ? 128 : 64)
    ) {
      setError("Use 1–1000 Stars and a short description.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const key = `star:request:${family?.vault?.questsAddress}:${childId}`;
    try {
      if (childOnly)
        await execute(
          "requestStars",
          { childId, stars, text: reason, submissionId: submissionId(key) },
          "CHILD",
        );
      else
        await execute(
          "createQuest",
          { childId, stars, text: reason },
          "PARENT",
        );
      if (childOnly) sessionStorage.removeItem(key);
      setDone(true);
    } catch (cause) {
      if (
        cause instanceof StarApiError &&
        cause.code === "SUBMISSION_ALREADY_RECORDED"
      )
        sessionStorage.removeItem(key);
      setError(cause instanceof Error ? cause.message : "Unable to submit.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <ParentActionSheet
      key={childOnly ? "request" : step}
      title={
        childOnly
          ? "Request Stars"
          : done
            ? "Quest Created"
            : step === "child"
              ? "Choose a child"
              : "Choose a quest"
      }
      onBack={
        !childOnly && !done && step !== "child"
          ? () => {
              if (busy) return;
              setStep("child");
              setError("");
              resetOperation();
            }
          : undefined
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {done && !childOnly ? (
        <QuestAssignedSuccess
          onDone={onClose}
          transactionHashes={operation.transactionHashes}
          childName={displayEnsName(chosenChild?.ensName, "Child")}
        />
      ) : done ? (
        <div className={assignmentStyles.success}>
          <ActionStatus
            state="success"
            message="Request submitted. Your parent can review it."
          />
          <button className="filled-action-button" onClick={onClose}>
            Done
          </button>
        </div>
      ) : !childOnly && step === "child" ? (
        <form
          className={`parent-action-form ${assignmentStyles.form}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (canAssign) setStep("quest");
          }}
        >
          <label>
            Child
            <span className={assignmentStyles.selectControl}>
              <select
                value={childId}
                onChange={(event) => setChildId(event.target.value)}
              >
                {!family?.children.some(
                  (item) => item.active && item.id === childId,
                ) && <option value="">Choose a child</option>}
                {family?.children
                  .filter((item) => item.active)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {displayEnsName(item.ensName, "Child")}
                    </option>
                  ))}
              </select>
              <ChevronDown size={18} aria-hidden="true" />
            </span>
          </label>
          {!family?.children.some((item) => item.active) && (
            <SectionEmptyState />
          )}
          <button
            className="filled-action-button"
            type="submit"
            disabled={!canAssign}
          >
            Continue
          </button>
        </form>
      ) : (
        <form
          className={`parent-action-form ${assignmentStyles.form}`}
          onSubmit={(event) => void submit(event)}
        >
          {!childOnly && (
            <QuestTemplatePicker
              value={templateId}
              disabled={busy || !canAssign}
              onChange={(template) => {
                if (template.id !== templateId) {
                  const values = questTemplateValues(template);
                  setTemplateId(template.id);
                  setText(values.text);
                  setStars(values.stars);
                }
                setError("");
                resetOperation();
              }}
            />
          )}
          {(childOnly || templateId) && (
            <>
              <label>
                {childOnly ? "What did you do?" : "Quest name"}
                <input
                  value={text}
                  maxLength={childOnly ? 128 : 64}
                  required
                  disabled={busy}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <label>
                Stars
                <input
                  className="amount-input"
                  value={stars}
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  required
                  disabled={busy}
                  onChange={(event) => setStars(event.target.value)}
                />
              </label>
              <IntentStatus operation={operation} busy={busy} error={error} />
              {!childOnly && (
                <ParentTransactionDetails
                  hashes={operation.transactionHashes}
                  completed={!busy && operation.state === "success"}
                />
              )}
              <QuestSubmitButton
                childOnly={childOnly}
                busy={busy}
                disabled={!childId || !canAssign || (!childOnly && !templateId)}
              />
            </>
          )}
        </form>
      )}
    </ParentActionSheet>
  );
}
