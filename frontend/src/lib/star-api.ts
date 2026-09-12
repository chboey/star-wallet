import { isAddress, zeroAddress } from "viem";
import type { InboxPage, InboxView } from "./quest-types";
import type { GoalRequestsResponse } from "./goal-requests";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import {
  intentPaths,
  isDeadlineFreeStarRequest,
  type IntentAction,
  type IntentInputs,
  type IntentResponse,
} from "./star-api.contract";
import type {
  ActivityPage,
  FamiliesByParentResponse,
  IndexingMetadata,
  IntentEnvelope,
  StarChild,
  StarFamily,
  StarPortfolio,
  TransactionIntent,
  EnsNamespace,
  EnsTransactionPlan,
  EnsSubdomainInput,
  EnsFamilyPlan,
  ChildAccountConfig,
  ChildAccountMetadata,
} from "./star-api.types";

export type * from "./star-api.types";
export type {
  IntentAction,
  IntentInputs,
  IntentResponse,
} from "./star-api.contract";
export type ApiRequestOptions = { signal?: AbortSignal };
type PageOptions = ApiRequestOptions & { first?: number; skip?: number };
type EnsResolution = {
  name: string;
  node: `0x${string}`;
  resolvedAddress: `0x${string}` | null;
  expectedAddress?: `0x${string}`;
  matchesExpected?: boolean;
  underConfiguredParent: boolean;
};

export class StarApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      status?: number;
      details?: unknown;
      requestId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "StarApiError";
    this.code = options.code ?? "STAR_API_ERROR";
    this.status = options.status ?? 0;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

/** Reads may retry transient failures. Intent preparation is never automatically retried. */
export function retryStarQuery(failureCount: number, error: Error): boolean {
  return (
    failureCount < 2 &&
    error instanceof StarApiError &&
    error.status !== 429 &&
    (error.code === "STAR_API_UNAVAILABLE" ||
      error.code === "STAR_API_TIMEOUT" ||
      error.status >= 500) &&
    error.code !== "STAR_API_INVALID_RESPONSE" &&
    error.code !== "STAR_API_NOT_CONFIGURED"
  );
}

/** Browser-only transport via the same-origin proxy. No backend URL/credentials in the bundle. */
export function createStarApi(
  fetcher: typeof fetch = (...args) => fetch(...args),
  timeoutMs = 20_000,
) {
  async function request<T>(
    path: string,
    options: ApiRequestOptions = {},
    body?: unknown,
  ): Promise<T> {
    // Match the proxy: ENS onboarding and child configuration have no application
    // deadline, but callers can still cancel and genuine service errors still surface.
    const timeout = isDeadlineFreeStarRequest(
      path,
      body === undefined ? "GET" : "POST",
    )
      ? undefined
      : AbortSignal.timeout(timeoutMs);
    const signal = timeout
      ? options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout
      : options.signal;
    let response: Response;
    let payload: unknown;
    let serialized: string | undefined;
    try {
      serialized = body === undefined ? undefined : JSON.stringify(body);
    } catch {
      throw invalidRequest(
        "API amounts must be JSON-safe strings, not bigint values.",
      );
    }
    try {
      signal?.throwIfAborted();
      response = await fetcher(`/api/star/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined
            ? { accept: "application/json" }
            : {
                accept: "application/json",
                "content-type": "application/json",
              },
        body: serialized,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal,
      });
      payload = await response.json().catch((error: unknown) => {
        if (signal?.aborted) throw error;
        return undefined;
      });
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      throw new StarApiError(
        timeout?.aborted
          ? "The Star service timed out. Please try again."
          : "The Star service could not be reached.",
        {
          code: timeout?.aborted ? "STAR_API_TIMEOUT" : "STAR_API_UNAVAILABLE",
          cause: error,
        },
      );
    }
    if (!response.ok) {
      const error = record(payload) ? payload : {};
      throw new StarApiError(
        typeof error.message === "string"
          ? error.message
          : errorMessage(error.code),
        {
          code: typeof error.code === "string" ? error.code : "STAR_API_ERROR",
          status: response.status,
          details: error.details,
          requestId:
            typeof error.requestId === "string" ? error.requestId : undefined,
        },
      );
    }
    if (!record(payload)) throw invalidResponse();
    return payload as T;
  }

  async function allPages<T>(
    path: string,
    options: ApiRequestOptions = {},
    filters: Record<string, string> = {},
    validatePage?: (page: Record<string, unknown>) => void,
    firstPage?: Record<string, unknown>,
  ): Promise<T> {
    let merged: Record<string, unknown> | undefined;
    let snapshot: IndexingMetadata | undefined;
    let skip = 0;
    while (true) {
      const query = new URLSearchParams({
        ...filters,
        first: "100",
        skip: String(skip),
      });
      if (snapshot) query.set("blockHash", snapshot.block.hash!);
      const page =
        (skip === 0 ? firstPage : undefined) ??
        (await request<Record<string, unknown>>(`${path}?${query}`, options));
      validatePage?.(page);
      const meta = page.indexing;
      if (
        !record(meta) ||
        !record(meta.block) ||
        !Number.isSafeInteger(meta.block.number) ||
        Number(meta.block.number) < 0 ||
        typeof meta.block.hash !== "string" ||
        !/^0x[0-9a-f]{64}$/i.test(meta.block.hash) ||
        typeof meta.deployment !== "string"
      )
        throw invalidResponse();
      if (
        snapshot &&
        (meta.block.number !== snapshot.block.number ||
          meta.block.hash !== snapshot.block.hash ||
          meta.deployment !== snapshot.deployment)
      )
        throw invalidResponse();
      snapshot ??= meta as IndexingMetadata;
      merged = merged ? mergeIndexedPages(merged, page) : page;
      if (page.nextOffset === null) return { ...merged, nextOffset: null } as T;
      if (
        !Number.isSafeInteger(page.nextOffset) ||
        Number(page.nextOffset) <= skip
      )
        throw invalidResponse();
      skip = Number(page.nextOffset);
    }
  }

  function inbox(
    familyId: string,
    options: PageOptions & { childId?: string; view: InboxView },
  ) {
    const query = new URLSearchParams(pageQuery(options));
    query.set("view", options.view);
    if (options.childId) query.set("childId", id(options.childId));
    return request<InboxPage>(
      `families/${id(familyId)}/inbox?${query}`,
      options,
    );
  }

  return {
    async config(options?: ApiRequestOptions) {
      const value = await request<unknown>("config", options);
      if (
        !record(value) ||
        value.chainId !== sepolia.id ||
        typeof value.ensParentName !== "string"
      )
        throw invalidResponse();
      try {
        if (
          normalize(value.ensParentName) !== value.ensParentName ||
          !value.ensParentName.endsWith(".eth")
        )
          throw invalidResponse();
      } catch {
        throw invalidResponse();
      }
      return { chainId: sepolia.id, ensParentName: value.ensParentName };
    },
    allFamiliesByParent: (parent: string, options?: ApiRequestOptions) =>
      allPages<FamiliesByParentResponse>(
        `families/by-parent/${address(parent)}`,
        options,
      ),
    fullFamily: (familyId: string, options?: ApiRequestOptions) =>
      allPages<StarFamily>(`families/${id(familyId)}`, options),
    fullChild: (wallet: string, options?: ApiRequestOptions) =>
      allPages<StarChild>(`children/by-wallet/${address(wallet)}`, options),
    inbox,
    async pendingStarRequests(familyId: string, options?: ApiRequestOptions) {
      const result = await allPages<InboxPage>(
        `families/${id(familyId)}/inbox`,
        options,
        { view: "waiting" },
        validatePendingRequestsPage,
      );
      return result.requests;
    },
    async allGoalRequests(familyId: string, options?: ApiRequestOptions) {
      const path = `families/${id(familyId)}/goal-requests`;
      const capability = await request<GoalRequestsResponse>(
        `${path}?first=100&skip=0`,
        options,
      );
      if (
        !record(capability) ||
        typeof capability.supported !== "boolean" ||
        !isAddress(capability.goalsAddress) ||
        capability.goalsAddress === zeroAddress ||
        !Array.isArray(capability.requests)
      )
        throw invalidResponse();
      if (!capability.supported) {
        if (capability.requests.length || capability.nextOffset !== null)
          throw invalidResponse();
        return capability;
      }
      const result = await allPages<GoalRequestsResponse>(
        path,
        options,
        {},
        undefined,
        { ...capability },
      );
      if (
        result.supported !== true ||
        result.goalsAddress !== capability.goalsAddress ||
        !Array.isArray(result.requests)
      )
        throw invalidResponse();
      for (const item of result.requests) {
        if (
          !record(item) ||
          typeof item.id !== "string" ||
          !/^[1-9][0-9]*$/.test(item.id) ||
          typeof item.title !== "string" ||
          typeof item.reason !== "string" ||
          !Number.isInteger(item.icon) ||
          item.icon < 0 ||
          item.icon > 6 ||
          !["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(
            item.status,
          ) ||
          !record(item.child) ||
          typeof item.child.id !== "string" ||
          !/^[1-9][0-9]*$/.test(item.child.id) ||
          !isAddress(item.child.wallet) ||
          typeof item.child.ensName !== "string" ||
          (item.status === "APPROVED" &&
            (!record(item.goal) ||
              typeof item.goal.id !== "string" ||
              typeof item.goal.starCost !== "string" ||
              !/^[1-9][0-9]*$/.test(item.goal.id) ||
              !/^[1-9][0-9]*$/.test(item.goal.starCost)))
        )
          throw invalidResponse();
      }
      return result;
    },
    async completedQuestCount(
      familyId: string,
      childId: string,
      options: ApiRequestOptions = {},
    ): Promise<number> {
      const selectedChildId = id(childId);
      const completed = new Set<string>();
      let skip = 0;
      while (true) {
        const page = await inbox(familyId, {
          ...options,
          childId: selectedChildId,
          view: "history",
          first: 100,
          skip,
        });
        if (!Array.isArray(page.quests)) throw invalidResponse();
        for (const quest of page.quests) {
          if (
            !record(quest) ||
            typeof quest.id !== "string" ||
            !quest.id ||
            !record(quest.child) ||
            typeof quest.child.id !== "string" ||
            !["ACTIVE", "SUBMITTED", "COMPLETED", "CANCELLED"].includes(
              String(quest.status),
            )
          )
            throw invalidResponse();
          if (
            quest.child.id === selectedChildId &&
            quest.status === "COMPLETED"
          )
            completed.add(quest.id);
        }
        if (page.nextOffset === null) return completed.size;
        if (
          !Number.isSafeInteger(page.nextOffset) ||
          Number(page.nextOffset) <= skip
        )
          throw invalidResponse();
        skip = Number(page.nextOffset);
      }
    },
    status: (options?: ApiRequestOptions) =>
      request<{ configured: boolean }>("status", options),
    familiesByParent: (parent: string, options?: ApiRequestOptions) =>
      request<FamiliesByParentResponse>(
        `families/by-parent/${address(parent)}`,
        options,
      ),
    family: (familyId: string, options: PageOptions = {}) =>
      request<StarFamily>(
        `families/${id(familyId)}${pageQuery(options)}`,
        options,
      ),
    childByWallet: (wallet: string, options: PageOptions = {}) =>
      request<StarChild>(
        `children/by-wallet/${address(wallet)}${pageQuery(options)}`,
        options,
      ),
    portfolio: (familyId: string, options?: ApiRequestOptions) =>
      request<StarPortfolio>(`families/${id(familyId)}/portfolio`, options),
    activity: (
      familyId: string,
      options: ApiRequestOptions & { first?: number; before?: string } = {},
    ) => {
      const query = new URLSearchParams({
        first: pageSize(options.first).toString(),
      });
      if (options.before !== undefined) query.set("before", id(options.before));
      return request<ActivityPage>(
        `families/${id(familyId)}/activity?${query}`,
        options,
      );
    },
    async childAccountConfig(options: ApiRequestOptions = {}) {
      const value = await request<unknown>("child-accounts/config", options);
      if (
        !record(value) ||
        value.chainId !== sepolia.id ||
        typeof value.entryPoint !== "string" ||
        !isAddress(value.entryPoint) ||
        typeof value.factory !== "string" ||
        !isAddress(value.factory) ||
        value.factory === zeroAddress ||
        typeof value.rpId !== "string" ||
        !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value.rpId) ||
        typeof value.sponsorshipConfigured !== "boolean"
      )
        throw invalidResponse();
      return value as ChildAccountConfig;
    },
    async childAccount(wallet: string) {
      return validateChildAccount(
        await request<unknown>(`child-accounts/${address(wallet)}`),
      );
    },
    async findChildAccount(familyId: string, ensName: string) {
      const query = new URLSearchParams({ familyId: id(familyId), ensName });
      const result = await request<unknown>(`child-accounts/lookup?${query}`);
      if (!record(result)) throw invalidResponse();
      return result.account === null
        ? null
        : validateChildAccount(result.account);
    },
    indexingStatus: (options?: ApiRequestOptions) =>
      request<IndexingMetadata>("indexing/status", options),
    resolveEns: (
      name: string,
      expectedAddress?: string,
      options?: ApiRequestOptions,
    ) => {
      if (!name.trim()) throw invalidRequest("ENS name is required.");
      const query = new URLSearchParams({ name });
      if (expectedAddress !== undefined)
        query.set("expectedAddress", address(expectedAddress));
      return request<EnsResolution>(`ens/resolve?${query}`, options);
    },
    ensNamespace: (name?: string, options?: ApiRequestOptions) =>
      request<EnsNamespace>(
        `ens/namespace${name ? `?${new URLSearchParams({ name })}` : ""}`,
        options,
      ),
    async prepareEnsNamespace(
      input: { signer: string; name?: string },
      options?: ApiRequestOptions,
    ) {
      const signer = address(input.signer);
      return validateEnsPlan(
        await request("ens/namespace", options, { ...input, signer }),
        signer,
      );
    },
    async prepareEnsFamily(
      input: { signer: string; label: string; secret: string },
      options?: ApiRequestOptions,
    ): Promise<EnsFamilyPlan> {
      const signer = address(input.signer);
      if (
        !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(input.label) ||
        input.label.slice(2, 4) === "--" ||
        !/^0x[0-9a-fA-F]{64}$/.test(input.secret) ||
        /^0x0{64}$/.test(input.secret)
      )
        throw invalidRequest(
          "Provide a valid family label and commitment secret.",
        );
      const result = await request<unknown>("ens/families", options, {
        ...input,
        signer,
      });
      if (record(result) && result.status === "WAITING") {
        if (
          typeof result.name !== "string" ||
          !result.name ||
          typeof result.checkedAtBlock !== "string" ||
          !/^[0-9]+$/.test(result.checkedAtBlock) ||
          typeof result.readyAt !== "string" ||
          !/^[1-9][0-9]*$/.test(result.readyAt) ||
          result.step !== null ||
          result.transaction !== null ||
          result.requiresConfirmation !== false
        )
          throw invalidResponse();
        return result as EnsFamilyPlan;
      }
      const plan = validateEnsPlan(result, signer);
      if (
        plan.status === "TRANSACTION_REQUIRED" &&
        plan.step !== "COMMIT_FAMILY_NAME" &&
        plan.step !== "REGISTER_FAMILY_NAME"
      )
        throw invalidResponse();
      return plan;
    },
    async prepareEnsSubdomain(
      input: EnsSubdomainInput,
      options?: ApiRequestOptions,
    ) {
      const signer = address(input.signer);
      if (!input.label.trim() || input.label.includes("."))
        throw invalidRequest("Provide one ENS label.");
      const body = {
        ...input,
        signer,
        owner: address(input.owner),
        address: address(input.address),
        ...(input.expiresAt === undefined
          ? {}
          : { expiresAt: id(input.expiresAt) }),
      };
      return validateEnsPlan(
        await request("ens/subdomains", options, body),
        signer,
      );
    },
    async intent<Action extends IntentAction>(
      action: Action,
      input: IntentInputs[Action],
      options?: ApiRequestOptions,
    ): Promise<IntentResponse<Action>> {
      if (!Object.hasOwn(intentPaths, action) || !record(input))
        throw invalidRequest("Invalid intent action or payload.");
      const result = await request<unknown>(
        intentPaths[action],
        options,
        input,
      );
      if (!record(result)) throw invalidResponse();
      if (
        action === "createFamily" &&
        (!record(result) ||
          typeof result.ensName !== "string" ||
          !bytes32(result.ensNode))
      )
        throw invalidResponse();
      if (
        action === "registerChild" &&
        (!record(result) ||
          typeof result.ensName !== "string" ||
          !bytes32(result.ensNode) ||
          !bytes32(result.registrationId) ||
          typeof result.childWallet !== "string" ||
          !isAddress(result.childWallet) ||
          !["UNREGISTERED", "PENDING", "ACCEPTED"].includes(
            String(result.registrationState),
          ) ||
          result.requiresSequentialConfirmation !== true)
      )
        throw invalidResponse();
      if (
        action === "createChildAccount" &&
        (typeof result.childWallet !== "string" ||
          !isAddress(result.childWallet) ||
          result.childWallet === zeroAddress ||
          typeof result.parent !== "string" ||
          !isAddress(result.parent) ||
          result.parent === zeroAddress ||
          typeof result.alreadyDeployed !== "boolean")
      )
        throw invalidResponse();
      const complete =
        (action === "createChildAccount" && result.alreadyDeployed === true) ||
        (action === "registerChild" && result.registrationState === "ACCEPTED");
      assertIntentEnvelope(result, complete);
      if (complete && result.intents.length !== 0) throw invalidResponse();
      return result as IntentResponse<Action>;
    },
  };
}

function validatePendingRequestsPage(page: Record<string, unknown>) {
  if (!Array.isArray(page.requests) || !Array.isArray(page.quests))
    throw invalidResponse();
  for (const item of page.requests) {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      !item.id ||
      typeof item.requestId !== "string" ||
      !/^[1-9][0-9]*$/.test(item.requestId) ||
      item.status !== "PENDING" ||
      typeof item.stars !== "string" ||
      !/^[1-9][0-9]*$/.test(item.stars) ||
      typeof item.reason !== "string" ||
      typeof item.createdAt !== "string" ||
      !/^[0-9]+$/.test(item.createdAt) ||
      !record(item.child) ||
      typeof item.child.id !== "string" ||
      !/^[1-9][0-9]*$/.test(item.child.id) ||
      typeof item.child.ensName !== "string" ||
      typeof item.child.wallet !== "string" ||
      !isAddress(item.child.wallet) ||
      (item.quest !== null &&
        (!record(item.quest) ||
          typeof item.quest.id !== "string" ||
          typeof item.quest.title !== "string"))
    )
      throw invalidResponse();
  }
}

function mergeIndexedPages(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    const existing = previous[key];
    if (Array.isArray(existing) && Array.isArray(value)) {
      const items = new Map<string, unknown>();
      for (const item of [...existing, ...value]) {
        if (!record(item) || typeof item.id !== "string")
          throw invalidResponse();
        items.set(item.id, item);
      }
      result[key] = [...items.values()];
    } else if (record(existing) && record(value)) {
      result[key] = mergeIndexedPages(existing, value);
    }
  }
  return result;
}

export const starApi = createStarApi();

/** ENS authority is an exact address, not a Star PARENT/CHILD role. */
function validateEnsPlan(value: unknown, signer: string): EnsTransactionPlan {
  if (
    !record(value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    typeof value.checkedAtBlock !== "string" ||
    !/^[0-9]+$/.test(value.checkedAtBlock)
  )
    throw invalidResponse();
  if (value.status === "READY") {
    if (
      value.step !== null ||
      value.transaction !== null ||
      value.requiresConfirmation !== false
    )
      throw invalidResponse();
  } else {
    const tx = value.transaction;
    if (
      value.status !== "TRANSACTION_REQUIRED" ||
      value.requiresConfirmation !== true ||
      typeof value.step !== "string" ||
      ![
        "DEPLOY_REGISTRY",
        "SET_REGISTRY_PARENT",
        "ATTACH_REGISTRY",
        "DEPLOY_RESOLVER",
        "REGISTER_SUBDOMAIN",
        "AUTHORIZE_FAMILY_REGISTRAR",
        "COMMIT_FAMILY_NAME",
        "REGISTER_FAMILY_NAME",
      ].includes(value.step) ||
      !record(tx) ||
      tx.chainId !== sepolia.id ||
      tx.value !== "0" ||
      typeof tx.from !== "string" ||
      !isAddress(tx.from) ||
      tx.from.toLowerCase() !== signer.toLowerCase() ||
      tx.from.toLowerCase() === zeroAddress ||
      typeof tx.to !== "string" ||
      !isAddress(tx.to) ||
      tx.to.toLowerCase() === zeroAddress ||
      typeof tx.data !== "string" ||
      !/^0x(?:[a-fA-F0-9]{2}){4,}$/.test(tx.data)
    )
      throw invalidResponse();
  }
  return value as EnsTransactionPlan;
}

/** Reject a malformed whole envelope before any transaction can be signed. */
export function assertIntentEnvelope(
  value: unknown,
  allowEmpty = false,
): asserts value is IntentEnvelope {
  if (
    !record(value) ||
    !Array.isArray(value.intents) ||
    (!allowEmpty && value.intents.length < 1) ||
    value.intents.length > 8
  )
    throw invalidResponse();
  for (const intent of value.intents) assertTransactionIntent(intent);
}
export function assertTransactionIntent(
  value: unknown,
): asserts value is TransactionIntent {
  if (
    !record(value) ||
    value.chainId !== sepolia.id ||
    typeof value.signerRole !== "string" ||
    !["PARENT", "CHILD", "EMERGENCY_ADMIN"].includes(value.signerRole) ||
    typeof value.to !== "string" ||
    !isAddress(value.to) ||
    value.to.toLowerCase() === zeroAddress ||
    typeof value.data !== "string" ||
    !/^0x(?:[a-fA-F0-9]{2}){4,}$/.test(value.data) ||
    value.value !== "0" ||
    typeof value.summary !== "string" ||
    !value.summary.trim()
  )
    throw invalidResponse();
}

function validateChildAccount(value: unknown): ChildAccountMetadata {
  if (
    !record(value) ||
    typeof value.wallet !== "string" ||
    !isAddress(value.wallet) ||
    value.wallet === zeroAddress ||
    typeof value.familyId !== "string" ||
    !/^[1-9][0-9]*$/.test(value.familyId) ||
    typeof value.rpId !== "string" ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value.rpId) ||
    !record(value.credential) ||
    typeof value.credential.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,1024}$/.test(value.credential.id) ||
    typeof value.credential.publicKey !== "string" ||
    !/^0x[0-9a-f]{128}$/i.test(value.credential.publicKey)
  )
    throw invalidResponse();
  return value as ChildAccountMetadata;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function bytes32(value: unknown): boolean {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}
function invalidResponse() {
  return new StarApiError("The Star service returned an invalid response.", {
    code: "STAR_API_INVALID_RESPONSE",
  });
}
function invalidRequest(message: string) {
  return new StarApiError(message, { code: "INVALID_REQUEST", status: 400 });
}
function id(value: string): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]*$/.test(value) ||
    value.length > 78 ||
    BigInt(value) >= 1n << 256n
  )
    throw invalidRequest("Invalid ID or activity cursor.");
  return value;
}
function address(value: string): string {
  if (typeof value !== "string" || !isAddress(value))
    throw invalidRequest("Invalid wallet address.");
  return value;
}
function pageSize(value = 100) {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw invalidRequest("Page size must be between 1 and 100.");
  return value;
}
function pageQuery({ first, skip = 0 }: PageOptions) {
  if (!Number.isSafeInteger(skip) || skip < 0)
    throw invalidRequest("Invalid page offset.");
  return `?${new URLSearchParams({ first: pageSize(first).toString(), skip: skip.toString() })}`;
}
function errorMessage(code: unknown) {
  if (code === "FAMILY_NOT_FOUND")
    return "This family has not been indexed yet.";
  if (code === "CHILD_NOT_FOUND") return "This child has not been indexed yet.";
  return "The Star service could not complete this request.";
}
