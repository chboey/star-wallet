import type { Config } from '../config.js';
import { HttpError, unavailable } from '../errors.js';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

const indexingQuery = `query Indexing { _meta { deployment block { number hash timestamp } hasIndexingErrors } }`;

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

  constructor(
    private readonly settings: Config,
    sepoliaClient?: SepoliaHeadReader,
  ) {
    this.sepoliaClient =
      sepoliaClient ??
      createPublicClient({ chain: sepolia, transport: http(settings.SEPOLIA_RPC_URL) });
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
