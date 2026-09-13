"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, LoaderCircle, Plus } from "lucide-react";
import { submissionId } from "@/lib/star-submissions";
import type { InboxView, StarRequest } from "@/lib/quest-types";
import type { InboxScope } from "@/lib/quest-inbox";
import {
  StarApiError,
  type IntentAction,
  type IntentInputs,
} from "@/lib/star-api";
import { displayEnsName } from "@/lib/star-format";
import { ParentActionSheet } from "./parent-action-sheet";
import { ActionStatus, IntentStatus } from "./action-status";
import { FullScreenLoader, SectionEmptyState } from "./home-ui";
import { KidIllustration } from "./kid-ui";
import { QuestCard } from "./quest-card";
import { RequestReviewSheet } from "./request-review-sheet";
import { KidQuestPreview } from "./kid-quest-preview";
import { QuestTemplatePicker } from "./quest-template-picker";
import {
  CancelStarRequestButton,
  QuestAssignedSuccess,
  QuestSubmitButton,
} from "./quest-form-feedback";
import { questTemplateValues, type QuestTemplate } from "@/lib/quest-templates";
import { useQuestInbox } from "./use-quest-inbox";
import { useStarData } from "./star-data-provider";
import { useStarIntents } from "./use-star-intents";
import { ParentTransactionDetails } from "./parent-transaction-details";
import { useVerticalSectionPaging } from "./use-vertical-section-paging";
import styles from "./quest-inbox.module.css";

export function QuestInbox({
  childOnly = false,
  onCreate,
  scope = "all",
  enabled = true,
  onBusyChange,
  onReviewRequest,
  initialRequestId,
  verticalPaging = false,
}: {
  childOnly?: boolean;
  onCreate?: () => void;
  scope?: InboxScope;
  enabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onReviewRequest?: (request: StarRequest) => void;
  initialRequestId?: string;
  verticalPaging?: boolean;
}) {
  const { family, child } = useStarData();
  const initialView: InboxView = initialRequestId
    ? "waiting"
    : childOnly || scope === "quests"
      ? "available"
      : "waiting";
  const [view, setView] = useState<InboxView>(initialView);
  const pagingSequence = useRef(0);
  const [pagingOverlay, setPagingOverlay] = useState<{
    view: InboxView;
    sequence: number;
  } | null>(null);
  const [focusedRequestId, setFocusedRequestId] = useState(initialRequestId);
  const [form, setForm] = useState(false);
  const [preview, setPreview] = useState<{
    id: string;
    started: boolean;
  } | null>(null);
  const query = useQuestInbox(
    view,
    childOnly,
    scope,
    enabled,
    focusedRequestId,
  );
  const { execute, operation, resetOperation } = useStarIntents();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState("");
  const [operationTarget, setOperationTarget] = useState<string | null>(null);
  const [reviewRequest, setReviewRequest] = useState<StarRequest | null>(null);
  const [questSubmissionSent, setQuestSubmissionSent] = useState(false);
  const openedInitialRequest = useRef<string | null>(null);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      if (!verticalPaging || !enabled) {
        setPagingOverlay(null);
        return;
      }
      pagingSequence.current += 1;
      setPagingOverlay({ view, sequence: pagingSequence.current });
    });
    return () => {
      current = false;
    };
  }, [enabled, verticalPaging, view]);
  useEffect(() => {
    if (!pagingOverlay) return;
    const timer = window.setTimeout(() => setPagingOverlay(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [pagingOverlay]);
  useEffect(() => {
    if (
      childOnly ||
      !initialRequestId ||
      openedInitialRequest.current === initialRequestId
    )
      return;
    const request = query.requests.find(
      (item) => item.id === initialRequestId && item.status === "PENDING",
    );
    if (!request) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      openedInitialRequest.current = initialRequestId;
      if (onReviewRequest) onReviewRequest(request);
      else setReviewRequest(request);
    });
    return () => {
      current = false;
    };
  }, [childOnly, initialRequestId, onReviewRequest, query.requests]);
  const views = (["available", "waiting", "history"] as const).filter(
    (tab) => scope !== "stars" || tab !== "available",
  );
  const changeView = (tab: InboxView) => {
    if (lock.current || tab === view) return;
    setView(tab);
    setFocusedRequestId(undefined);
    setOperationTarget(null);
    setLocalMessage("");
    resetOperation();
  };
  const { regionRef, scrollRef, direction, changePage, handlers } =
    useVerticalSectionPaging({
      enabled: verticalPaging && enabled,
      index: views.indexOf(view),
      count: views.length,
      busy,
      onChange: (index) => changeView(views[index]),
    });
  const run = async <A extends IntentAction>(
    action: A,
    input: IntentInputs[A],
    key?: string,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setLocalMessage("");
    setOperationTarget(
      "childId" in input && "id" in input
        ? `${action === "cancelQuest" || action === "submitQuest" ? "quest" : "request"}:${input.childId}:${input.id}`
        : null,
    );
    try {
      await execute(action, input, childOnly ? "CHILD" : "PARENT");
      setFocusedRequestId(undefined);
      if (key) sessionStorage.removeItem(key);
      return true;
    } catch (error) {
      // Only rotate an identifier after RPC proves that it was already consumed.
      // Unknown transaction outcomes must keep the same identifier on retry.
      if (
        key &&
        error instanceof StarApiError &&
        error.code === "SUBMISSION_ALREADY_RECORDED"
      ) {
        sessionStorage.removeItem(key);
        await query.refetch();
      }
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  const submit = async (questId: string) => {
    if (!child || !family?.vault) return;
    try {
      const key = `star:quest:${family.vault.questsAddress}:${child.id}:${questId}`;
      const submitted = await run(
        "submitQuest",
        { childId: child.id, id: questId, submissionId: submissionId(key) },
        key,
      );
      if (submitted) {
        setPreview(null);
        setView("waiting");
        setQuestSubmissionSent(true);
      }
    } catch {
      setLocalMessage("Allow session storage to safely retry this submission.");
    }
  };
  if (!family || (childOnly && !child)) return <SectionEmptyState />;
  const cannotCreate =
    busy ||
    !family.active ||
    !family.vault ||
    (childOnly ? !child?.active : !family.children.some((c) => c.active));
  const selectedQuest = childOnly
    ? query.quests.find(
        (quest) => quest.id === preview?.id && quest.child.id === child?.id,
      )
    : undefined;
  const hasOperationCard =
    query.quests.some(
      (quest) => operationTarget === `quest:${quest.child.id}:${quest.questId}`,
    ) ||
    query.requests.some(
      (request) =>
        request.status === "PENDING" &&
        operationTarget === `request:${request.child.id}:${request.requestId}`,
    );
  // A resolved request can leave the Waiting list during receipt/index refresh.
  // Keep its transaction visible above Done until the parent dismisses it.
  const showTransactionResult =
    !childOnly &&
    !busy &&
    operation.state === "success" &&
    Boolean(operation.transactionHashes?.length);
  if (selectedQuest && preview) {
    return (
      <KidQuestPreview
        quest={selectedQuest}
        started={preview.started}
        busy={busy}
        disabled={!enabled || cannotCreate || Boolean(query.error)}
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
  }
  return (
    <div
      className={`${styles.inbox} ${verticalPaging ? styles.pagedInbox : ""}`}
      ref={regionRef}
      role={verticalPaging ? "region" : undefined}
      aria-label={
        verticalPaging
          ? "Star requests. Scroll or swipe up and down to switch between Waiting and Completed."
          : undefined
      }
      tabIndex={verticalPaging ? 0 : undefined}
      {...handlers}
    >
      {verticalPaging ? (
        <>
          <nav
            className={`${styles.sectionPager} ${pagingOverlay ? styles.overlayVisible : ""}`}
            aria-label="Star request sections"
          >
            {views.map((tab, index) => (
              <button
                key={tab}
                type="button"
                aria-label={`Show ${tab === "history" ? "Completed" : "Waiting"}`}
                aria-current={view === tab ? "page" : undefined}
                aria-pressed={view === tab}
                disabled={busy}
                onClick={(event) => changePage(index, event.timeStamp)}
              >
                <span className={styles.sectionPagerLine} aria-hidden="true" />
              </button>
            ))}
          </nav>
          {pagingOverlay && (
            <div
              className={styles.sectionSwitchOverlay}
              style={{
                top: `calc(50% + ${
                  (views.indexOf(pagingOverlay.view) - (views.length - 1) / 2) *
                  36
                }px)`,
              }}
              role="status"
              aria-live="polite"
              key={pagingOverlay.sequence}
            >
              <span>
                {pagingOverlay.view === "history" ? "Completed" : "Waiting"}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className={styles.toolbar}>
          <div
            className={`kid-tabs ${styles.tabs}`}
            aria-label={scope === "stars" ? "Star requests" : "Quest inbox"}
          >
            {views.map((tab, index) => (
              <button
                key={tab}
                type="button"
                className={view === tab ? "active" : ""}
                aria-pressed={view === tab}
                disabled={busy}
                onClick={(event) => {
                  if (verticalPaging) changePage(index, event.timeStamp);
                  else changeView(tab);
                }}
              >
                {tab === "available"
                  ? childOnly
                    ? "Available"
                    : "Quests"
                  : tab === "waiting"
                    ? "Waiting"
                    : "Completed"}
              </button>
            ))}
          </div>
          {!childOnly && scope !== "stars" && (
            <button
              className={styles.addQuest}
              type="button"
              aria-label="Assign a quest"
              title="Assign a quest"
              disabled={cannotCreate}
              onClick={() => (onCreate ? onCreate() : setForm(true))}
            >
              <Plus size={22} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <div
        className={styles.content}
        ref={scrollRef}
        key={view}
        data-direction={verticalPaging ? direction : undefined}
      >
        {!hasOperationCard && (
          <IntentStatus
            operation={operation}
            busy={busy}
            error={localMessage}
          />
        )}
        {showTransactionResult && (
          <div className="parent-transaction-result">
            <ParentTransactionDetails
              hashes={operation.transactionHashes}
              completed={!busy && operation.state === "success"}
            />
            <button
              className="filled-action-button"
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => {
                if (lock.current) return;
                resetOperation();
                setOperationTarget(null);
                setLocalMessage("");
              }}
            >
              {busy && (
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
              )}
              Done
            </button>
          </div>
        )}
        {query.isPending ? (
          <FullScreenLoader />
        ) : query.error ? (
          <ActionStatus
            state="error"
            message={query.error.message}
            onRefresh={() => void query.refetch()}
            refreshing={query.isFetching}
            refreshLabel="Refresh requests"
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
                    onOpen={
                      childOnly
                        ? () => {
                            if (lock.current) return;
                            resetOperation();
                            setLocalMessage("");
                            setPreview({ id: quest.id, started: false });
                          }
                        : undefined
                    }
                    subtitle={
                      !childOnly
                        ? displayEnsName(quest.child.ensName, "Child")
                        : undefined
                    }
                  >
                    {!childOnly && (
                      <>
                        {operationTarget ===
                          `quest:${quest.child.id}:${quest.questId}` && (
                          <IntentStatus
                            operation={operation}
                            busy={busy}
                            error={localMessage}
                          />
                        )}
                        <button
                          className="outline-action-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run("cancelQuest", {
                              childId: quest.child.id,
                              id: quest.questId,
                            })
                          }
                        >
                          Cancel quest
                        </button>
                      </>
                    )}
                  </QuestCard>
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
                    expandable={
                      childOnly &&
                      request.status === "PENDING" &&
                      !request.quest
                    }
                    initiallyOpen={childOnly && request.id === initialRequestId}
                    popupTitle={request.quest ? "Quest" : "Star request"}
                    disabled={busy}
                    onOpen={
                      !childOnly && request.status === "PENDING"
                        ? () => {
                            if (lock.current) return;
                            resetOperation();
                            setOperationTarget(null);
                            setLocalMessage("");
                            if (onReviewRequest) onReviewRequest(request);
                            else setReviewRequest(request);
                          }
                        : undefined
                    }
                    title={request.quest?.title ?? request.reason}
                    stars={request.stars}
                    subtitle={`${childOnly ? "" : `${displayEnsName(request.child.ensName, "Child")} · `}${request.quest ? "Quest" : "Star request"} · ${request.status.toLowerCase()}`}
                  >
                    {childOnly &&
                      operationTarget ===
                        `request:${request.child.id}:${request.requestId}` && (
                        <IntentStatus
                          operation={operation}
                          busy={busy}
                          error={localMessage}
                        />
                      )}
                    {childOnly &&
                      request.status === "PENDING" &&
                      !request.quest && (
                        <CancelStarRequestButton
                          busy={
                            busy &&
                            operationTarget ===
                              `request:${request.child.id}:${request.requestId}`
                          }
                          disabled={busy}
                          onCancel={() =>
                            void run("cancelStarRequest", {
                              childId: request.child.id,
                              id: request.requestId,
                            })
                          }
                        />
                      )}
                  </QuestCard>
                ))}
                {view === "history" &&
                  query.quests.map((quest) => (
                    <QuestCard
                      key={quest.id}
                      title={quest.title}
                      stars={quest.stars}
                      subtitle={`${childOnly ? "" : `${displayEnsName(quest.child.ensName, "Child")} · `}Quest ${quest.status.toLowerCase()}`}
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
      {form && (
        <QuestForm
          childOnly={childOnly}
          onClose={() => {
            setForm(false);
          }}
        />
      )}
      {reviewRequest && !childOnly && (
        <RequestReviewSheet
          key={reviewRequest.id}
          request={reviewRequest}
          onBusyChange={(pending) => {
            lock.current = pending;
            setBusy(pending);
            onBusyChange?.(pending);
          }}
          onClose={() => {
            if (lock.current) return;
            setReviewRequest(null);
            setFocusedRequestId(undefined);
          }}
        />
      )}
      {questSubmissionSent && childOnly && (
        <ParentActionSheet
          title="Quest complete"
          onClose={() => setQuestSubmissionSent(false)}
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
              onClick={() => setQuestSubmissionSent(false)}
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
      : (family?.children.find((c) => c.active)?.id ?? ""),
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
    } catch (e) {
      if (e instanceof StarApiError && e.code === "SUBMISSION_ALREADY_RECORDED")
        sessionStorage.removeItem(key);
      setError(e instanceof Error ? e.message : "Unable to submit.");
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
        <div className={styles.inbox}>
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
          className={`parent-action-form ${styles.form}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (canAssign) setStep("quest");
          }}
        >
          <label>
            Child
            <span className={styles.selectControl}>
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
          className={`parent-action-form ${styles.form}`}
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
                  onChange={(e) => setText(e.target.value)}
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
                  onChange={(e) => setStars(e.target.value)}
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

export function ParentQuestInboxSheet({
  onClose,
  initialRequestId,
}: {
  onClose: () => void;
  initialRequestId?: string;
}) {
  const [creating, setCreating] = useState(false);
  return creating ? (
    <QuestForm childOnly={false} onClose={() => setCreating(false)} />
  ) : (
    <ParentActionSheet title="Quests" onClose={onClose}>
      <QuestInbox
        scope="quests"
        initialRequestId={initialRequestId}
        onCreate={() => setCreating(true)}
      />
    </ParentActionSheet>
  );
}
