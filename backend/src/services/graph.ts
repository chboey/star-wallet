import type { Config } from '../config.js';
import { HttpError, unavailable } from '../errors.js';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

const familyQuery = `
  query Family($id: ID!, $first: Int!, $skip: Int!, $block: Block_height) {
    family(id: $id, block: $block) {
      id parent ensName ensNode active childCount createdAt updatedAt
      vault {
        id questsAddress usdc parent emergencyAdmin aqua swapVm aquaPaused createdAt updatedAt
        creationTransactionHash updatedTransactionHash
      }
      childRegistrations(first: $first, skip: $skip, orderBy: proposedAt, orderDirection: desc) {
        id registrationId childWallet ensName ensNode status proposedAt resolvedAt resolvedBy updatedAt
        proposalTransactionHash resolutionTransactionHash
        child { id wallet }
      }
      children(first: $first, skip: $skip, orderBy: createdAt, orderDirection: asc) {
        id wallet ensName ensNode active starBalance reservedStars totalStarsIssued
        totalStarsBurned totalPrincipalContributed createdAt updatedAt
      }
      goals(first: $first, skip: $skip, orderBy: createdAt, orderDirection: desc) {
        id title starCost allocatedStars status createdAt updatedAt completedAt cancelledAt
        child { id }
      }
      rewards(first: $first, skip: $skip, orderBy: timestamp, orderDirection: desc) {
        id stars principalUsdc reason transactionHash blockNumber timestamp
        child { id }
      }
      savings {
        id totalPrincipalContributed totalPrincipalWithdrawn netPrincipal
        totalUsdcWithdrawn totalWethWithdrawn availableUsdc availableWeth updatedAt
        vault { id aquaPaused }
        activePosition {
          id strategyHash maker openingUsdcAmount openingWethAmount currentUsdcAmount
          currentWethAmount closingUsdcAmount closingWethAmount
          sqrtPriceMin sqrtPriceMax feeBps salt deadline oracleRawPrice
          status openedAt updatedAt
          executions(first: $first, skip: $skip, orderBy: sequence, orderDirection: desc) {
            id strategyHash type maker app taker token tokenIn tokenOut amount amountIn amountOut
            transactionHash logIndex sequence blockNumber timestamp
          }
        }
        contributions(first: $first, skip: $skip, orderBy: timestamp, orderDirection: desc) {
          id child { id } amount transactionHash blockNumber timestamp
        }
        withdrawals(first: $first, skip: $skip, orderBy: timestamp, orderDirection: desc) {
          id asset amount principalAmount recipient transactionHash blockNumber timestamp
        }
        positions(first: $first, skip: $skip, orderBy: openedAt, orderDirection: desc) {
          id strategyHash maker openingUsdcAmount openingWethAmount currentUsdcAmount
          currentWethAmount closingUsdcAmount closingWethAmount
          sqrtPriceMin sqrtPriceMax feeBps salt deadline oracleRawPrice
          status openedAt closedAt updatedAt
        }
      }
      redemptions(first: $first, skip: $skip, orderBy: requestedAt, orderDirection: desc) {
        id reservedStars status requestedAt resolvedAt requestTransactionHash
        resolutionTransactionHash
        child { id wallet } goal { id title starCost allocatedStars status }
      }
      activities(first: $first, skip: $skip, orderBy: sequence, orderDirection: desc) {
        id type amount active transactionHash logIndex sequence blockNumber timestamp
        child { id } registration { id registrationId } goal { id } redemption { id }
      }
    }
    _meta(block: $block) { deployment block { number hash timestamp } hasIndexingErrors }
  }
`;

const familiesByParentQuery = `
  query FamiliesByParent($parent: Bytes!, $first: Int!, $skip: Int!, $block: Block_height) {
    families(first: $first, skip: $skip, block: $block, where: { parent: $parent }, orderBy: createdAt, orderDirection: desc) {
      id parent ensName ensNode active childCount createdAt updatedAt
      vault { id aquaPaused }
    }
    _meta(block: $block) { deployment block { number hash timestamp } hasIndexingErrors }
  }
`;

const childQuery = `
  query ChildByWallet($wallet: ID!, $first: Int!, $skip: Int!, $block: Block_height) {
    childWallet(id: $wallet, block: $block) {
      child {
        id wallet ensName ensNode active starBalance reservedStars totalStarsIssued totalStarsBurned
        totalPrincipalContributed
        goals(first: $first, skip: $skip, orderBy: createdAt, orderDirection: desc) {
          id title starCost allocatedStars status createdAt updatedAt
        }
        rewards(first: $first, skip: $skip, orderBy: timestamp, orderDirection: desc) {
          id stars reason transactionHash timestamp
        }
        redemptions(first: $first, skip: $skip, orderBy: requestedAt, orderDirection: desc) {
          id reservedStars status requestedAt resolvedAt requestTransactionHash
          resolutionTransactionHash
          goal { id title starCost allocatedStars status }
        }
        family { id ensName ensNode active }
      }
    }
    _meta(block: $block) { deployment block { number hash timestamp } hasIndexingErrors }
  }
`;

const indexingQuery = `query Indexing { _meta { deployment block { number hash timestamp } hasIndexingErrors } }`;
const inboxQuery = `
  query Inbox($questsWhere: Quest_filter!, $requestsWhere: StarRequest_filter!, $first: Int!, $skip: Int!, $block: Block_height) {
    quests(block: $block, where: $questsWhere, first: $first, skip: $skip, orderBy: questId, orderDirection: desc) {
      id questId workflow title stars status createdAt updatedAt child { id wallet ensName }
    }
    starRequests(block: $block, where: $requestsWhere, first: $first, skip: $skip, orderBy: requestId, orderDirection: desc) {
      id requestId workflow stars reason status submissionId createdAt updatedAt
      creationTransactionHash resolutionTransactionHash
      child { id wallet ensName } quest { id questId title } reward { id transactionHash }
    }
    _meta(block: $block) { deployment block { number hash timestamp } hasIndexingErrors }
  }
`;
const goalRequestsQuery = `
  query GoalRequests($family: String!, $first: Int!, $skip: Int!, $block: Block_height) {
    goalRequests(where: { family: $family }, first: $first, skip: $skip, block: $block, orderBy: requestId, orderDirection: desc) {
      id title reason icon status submissionId requestedAt resolvedAt
      requestTransactionHash resolutionTransactionHash
      child { id wallet ensName } goal { id title starCost status }
    }
    _meta(block: $block) { deployment block { number hash timestamp } hasIndexingErrors }
  }
`;

export type Pagination = { first: number; skip: number };
type SnapshotPagination = Pagination & { blockHash?: string };
type IndexingStatus = {
  deployment: string;
  block: { number: number; hash?: string; timestamp?: number | null };
  hasIndexingErrors: boolean;
  currentBlock?: number;
  blockLag?: number;
  maximumBlockLag?: number;
};

type SepoliaHeadReader = {
  getBlockNumber(): Promise<bigint>;
  getChainId(): Promise<number>;
  getBlock(args: { blockNumber: bigint }): Promise<{ hash: string | null }>;
};

export class GraphService {
  private readonly sepoliaClient: SepoliaHeadReader;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private retryAt = 0;
  private allocationsSupported: boolean | undefined;

  constructor(
    private readonly settings: Config,
    sepoliaClient?: SepoliaHeadReader,
  ) {
    this.sepoliaClient =
      sepoliaClient ??
      createPublicClient({ chain: sepolia, transport: http(settings.SEPOLIA_RPC_URL) });
  }

  async goalRequests(family: string, page: SnapshotPagination) {
    const data = await this.query<{
      goalRequests: Array<Record<string, unknown>>;
      _meta: IndexingStatus;
    }>(goalRequestsQuery, { family, ...snapshotVariables(page) });
    const indexing = await this.requireFreshIndex(data._meta);
    assertSnapshot(indexing, page);
    return {
      requests: data.goalRequests,
      nextOffset: data.goalRequests.length === page.first ? page.skip + page.first : null,
      indexing,
    };
  }

  async inbox(
    family: string,
    page: SnapshotPagination & { childId?: string; view: 'available' | 'waiting' | 'history' },
  ) {
    const scope = { family, ...(page.childId ? { child: page.childId } : {}) };
    const data = await this.query<{
      quests: Array<Record<string, unknown>>;
      starRequests: Array<Record<string, unknown>>;
      _meta: IndexingStatus;
    }>(inboxQuery, {
      questsWhere: {
        ...scope,
        status_in:
          page.view === 'history'
            ? ['COMPLETED', 'CANCELLED']
            : [page.view === 'available' ? 'ACTIVE' : 'SUBMITTED'],
      },
      requestsWhere: {
        ...scope,
        status_in: page.view === 'history' ? ['APPROVED', 'REJECTED', 'CANCELLED'] : ['PENDING'],
      },
      ...snapshotVariables(page),
    });
    const indexing = await this.requireFreshIndex(data._meta);
    assertSnapshot(indexing, page);
    return {
      quests: data.quests,
      requests: data.starRequests,
      nextOffset:
        data.quests.length === page.first || data.starRequests.length === page.first
          ? page.skip + page.first
          : null,
      indexing,
    };
  }

  async family(
    id: string,
    pagination: SnapshotPagination,
  ): Promise<Record<string, unknown> | null> {
    const data = await this.queryWithAllocations<{
      family: Record<string, unknown> | null;
      _meta: IndexingStatus;
    }>(familyQuery, { id, ...snapshotVariables(pagination) });
    const indexing = await this.requireFreshIndex(data._meta);
    assertSnapshot(indexing, pagination);
    return data.family === null
      ? null
      : {
          ...data.family,
          nextOffset: hasFullPage(data.family, pagination.first)
            ? pagination.skip + pagination.first
            : null,
          indexing,
        };
  }

  async familiesByParent(
    parent: string,
    pagination: SnapshotPagination = { first: 100, skip: 0 },
  ): Promise<{
    families: Array<Record<string, unknown>>;
    nextOffset: number | null;
    indexing: IndexingStatus;
  }> {
    const data = await this.query<{
      families: Array<Record<string, unknown>>;
      _meta: IndexingStatus;
    }>(familiesByParentQuery, { parent: parent.toLowerCase(), ...snapshotVariables(pagination) });
    const indexing = await this.requireFreshIndex(data._meta);
    assertSnapshot(indexing, pagination);
    return {
      families: data.families,
      nextOffset:
        data.families.length === pagination.first ? pagination.skip + pagination.first : null,
      indexing,
    };
  }

  async childByWallet(
    wallet: string,
    pagination: SnapshotPagination,
  ): Promise<Record<string, unknown> | null> {
    const data = await this.queryWithAllocations<{
      childWallet: { child: Record<string, unknown> } | null;
      _meta: IndexingStatus;
    }>(childQuery, {
      wallet: wallet.toLowerCase(),
      ...snapshotVariables(pagination),
    });
    const indexing = await this.requireFreshIndex(data._meta);
    assertSnapshot(indexing, pagination);
    return data.childWallet?.child
      ? {
          ...data.childWallet.child,
          nextOffset: hasFullPage(data.childWallet.child, pagination.first)
            ? pagination.skip + pagination.first
            : null,
          indexing,
        }
      : null;
  }

  async indexingStatus(): Promise<IndexingStatus> {
    const data = await this.query<{ _meta: IndexingStatus }>(indexingQuery, {});
    return this.requireFreshIndex(data._meta);
  }

  private async requireFreshIndex(meta: IndexingStatus): Promise<IndexingStatus> {
    if (
      !meta ||
      typeof meta.deployment !== 'string' ||
      !meta.block ||
      typeof meta.hasIndexingErrors !== 'boolean'
    ) {
      throw unavailable(
        'SUBGRAPH_INVALID_RESPONSE',
        'The Subgraph returned invalid indexing metadata',
      );
    }
    if (meta.deployment !== this.settings.STAR_SUBGRAPH_DEPLOYMENT_ID) {
      throw unavailable(
        'SUBGRAPH_WRONG_DEPLOYMENT',
        'The Subgraph deployment does not match STAR_SUBGRAPH_DEPLOYMENT_ID',
      );
    }
    if (meta.hasIndexingErrors) {
      throw unavailable('SUBGRAPH_INDEXING_ERRORS', 'The Star Subgraph reports indexing errors');
    }
    if (!Number.isSafeInteger(meta.block.number) || meta.block.number < 0) {
      throw unavailable('SUBGRAPH_INVALID_RESPONSE', 'The Subgraph returned an invalid block');
    }
    if (
      meta.block.timestamp != null &&
      (!Number.isSafeInteger(meta.block.timestamp) || meta.block.timestamp < 0)
    ) {
      throw unavailable(
        'SUBGRAPH_INVALID_RESPONSE',
        'The Subgraph returned an invalid block timestamp',
      );
    }
    const [chainId, head] = await Promise.all([
      this.sepoliaClient.getChainId(),
      this.sepoliaClient.getBlockNumber(),
    ]);
    if (chainId !== sepolia.id)
      throw unavailable(
        'SUBGRAPH_WRONG_NETWORK',
        `SEPOLIA_RPC_URL returned chain ${chainId}; expected ${sepolia.id}`,
      );
    const currentBlock = Number(head);
    if (!Number.isSafeInteger(currentBlock) || meta.block.number > currentBlock) {
      throw unavailable(
        'SUBGRAPH_INVALID_BLOCK',
        'The Subgraph block is ahead of the configured Sepolia RPC',
      );
    }
    const blockLag = currentBlock - meta.block.number;
    if (blockLag > this.settings.STAR_SUBGRAPH_MAX_BLOCK_LAG) {
      throw unavailable(
        'SUBGRAPH_STALE',
        `The Star Subgraph is ${blockLag} blocks behind Sepolia; maximum is ${this.settings.STAR_SUBGRAPH_MAX_BLOCK_LAG}`,
      );
    }
    const indexedBlock = await this.sepoliaClient.getBlock({
      blockNumber: BigInt(meta.block.number),
    });
    if (
      typeof meta.block.hash !== 'string' ||
      !indexedBlock.hash ||
      meta.block.hash.toLowerCase() !== indexedBlock.hash.toLowerCase()
    )
      throw unavailable(
        'SUBGRAPH_WRONG_NETWORK',
        'The indexed block hash does not match Sepolia; check the network or wait for reorg recovery',
      );
    return {
      ...meta,
      block: { ...meta.block, timestamp: meta.block.timestamp ?? undefined },
      currentBlock,
      blockLag,
      maximumBlockLag: this.settings.STAR_SUBGRAPH_MAX_BLOCK_LAG,
    };
  }

  private async queryWithAllocations<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const legacyQuery = query.replace(/\ballocatedStars\b/g, '');
    if (this.allocationsSupported === false) return this.query<T>(legacyQuery, variables);
    try {
      const result = await this.query<T>(query, variables);
      this.allocationsSupported = true;
      return result;
    } catch (error) {
      // Keep older deployments readable during rollout. Never turn network,
      // indexing or other schema errors into a fabricated zero allocation.
      const details =
        error instanceof HttpError
          ? (error.details as { errors?: { message: string }[] } | undefined)
          : undefined;
      if (
        !(error instanceof HttpError) ||
        error.code !== 'SUBGRAPH_ERROR' ||
        !details?.errors?.length ||
        !details.errors.every(
          ({ message }) =>
            /allocatedStars/.test(message) &&
            /cannot query field|has no field|unknown field/i.test(message),
        )
      )
        throw error;
      this.allocationsSupported = false;
      return this.query<T>(legacyQuery, variables);
    }
  }

  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (!this.settings.STAR_SUBGRAPH_URL || !this.settings.STAR_SUBGRAPH_DEPLOYMENT_ID) {
      throw unavailable(
        'SUBGRAPH_NOT_CONFIGURED',
        'STAR_SUBGRAPH_URL and STAR_SUBGRAPH_DEPLOYMENT_ID are required',
      );
    }
    if (this.retryAt > Date.now()) throw this.rateLimited();
    const key = JSON.stringify({ query, variables });
    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;
    const request = this.fetchQuery<T>(query, variables);
    this.inFlight.set(key, request);
    try {
      return await request;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private rateLimited() {
    const retryAfterSeconds = Math.max(1, Math.ceil((this.retryAt - Date.now()) / 1_000));
    return new HttpError(
      429,
      'SUBGRAPH_RATE_LIMITED',
      `The indexer is busy. Please try again in ${retryAfterSeconds} seconds.`,
      { retryAfterSeconds },
    );
  }

  private async fetchQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.settings.STAR_SUBGRAPH_URL!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw unavailable('SUBGRAPH_UNAVAILABLE', 'The Star Subgraph could not be reached', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    // Studio may send plain text/HTML for 429. Inspect status before parsing
    // JSON and honor its cooldown across ALL reads, not just the failed query.
    if (response.status === 429) {
      const header = response.headers.get('retry-after');
      const seconds =
        header && /^\d+$/.test(header)
          ? Number(header)
          : header
            ? Math.ceil((Date.parse(header) - Date.now()) / 1_000)
            : 60;
      const cooldown = Number.isFinite(seconds) ? Math.max(1, seconds) : 60;
      this.retryAt = Math.max(this.retryAt, Date.now() + cooldown * 1_000);
      await response.body?.cancel();
      throw this.rateLimited();
    }
    let body: { data?: T; errors?: Array<{ message: string }> };
    try {
      body = (await response.json()) as typeof body;
    } catch (error) {
      throw unavailable('SUBGRAPH_INVALID_RESPONSE', 'The Star Subgraph returned invalid JSON', {
        status: response.status,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (!response.ok || !body || body.errors?.length || !body.data) {
      throw unavailable('SUBGRAPH_ERROR', 'The Star Subgraph could not serve the query', {
        status: response.status,
        errors: body?.errors,
      });
    }
    return body.data;
  }
}

function snapshotVariables({ first, skip, blockHash }: SnapshotPagination) {
  // Graph Node returns a null _meta.block.hash for number-pinned queries.
  // Hash-pinning preserves both a consistent snapshot and RPC hash verification.
  return { first, skip, ...(blockHash === undefined ? {} : { block: { hash: blockHash } }) };
}

function assertSnapshot(indexing: IndexingStatus, page: SnapshotPagination) {
  if (
    page.blockHash !== undefined &&
    indexing.block.hash?.toLowerCase() !== page.blockHash.toLowerCase()
  )
    throw unavailable(
      'SUBGRAPH_INVALID_RESPONSE',
      'The Subgraph returned a different pagination snapshot',
    );
}

/** Nested relations share the page offset; continue until every relation is exhausted. */
function hasFullPage(value: unknown, first: number): boolean {
  if (Array.isArray(value)) return value.length >= first;
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.values(value).some((item) => hasFullPage(item, first))
  );
}
