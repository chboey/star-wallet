import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  type Address,
  type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import type { Config } from '../config.js';

const priceFeedAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

export type FeedPrice = {
  address: Address;
  description: string;
  answer: bigint;
  decimals: number;
  roundId: bigint;
  answeredInRound: bigint;
  startedAt: bigint;
  updatedAt: bigint;
};

export type PricingSnapshot = {
  block: { number: bigint; timestamp: bigint };
  usdcPrice: FeedPrice;
  wethPrice: FeedPrice;
  /** tokenGt units / tokenLt units, scaled by 1e18. */
  rawPrice: bigint;
};

export class ChainlinkPricingService {
  private readonly client: Pick<PublicClient, 'getChainId' | 'getBlock' | 'readContract'>;

  constructor(
    private readonly settings: Config,
    client?: Pick<PublicClient, 'getChainId' | 'getBlock' | 'readContract'>,
  ) {
    this.client =
      client ?? createPublicClient({ chain: sepolia, transport: http(settings.SEPOLIA_RPC_URL) });
  }

  async context(): Promise<PricingSnapshot> {
    if (
      !this.settings.CHAINLINK_ETH_USD_FEED_ADDRESS ||
      !this.settings.CHAINLINK_USDC_USD_FEED_ADDRESS ||
      !this.settings.USDC_ADDRESS ||
      !this.settings.WETH_ADDRESS
    ) {
      throw new Error('Chainlink ETH/USD, USDC/USD and token addresses are required');
    }

    const [chainId, block] = await Promise.all([
      this.client.getChainId(),
      this.client.getBlock({ blockTag: 'latest' }),
    ]);
    if (chainId !== sepolia.id) {
      throw new Error(`SEPOLIA_RPC_URL returned chain ${chainId}; expected ${sepolia.id}`);
    }
    // Every oracle field belongs to the block used for freshness and valuation.
    const [usdcPrice, wethPrice] = await Promise.all([
      this.readPrice(
        this.settings.CHAINLINK_USDC_USD_FEED_ADDRESS,
        'USDC/USD',
        this.settings.CHAINLINK_USDC_USD_MAX_AGE_SECONDS,
        block.number,
      ),
      this.readPrice(
        this.settings.CHAINLINK_ETH_USD_FEED_ADDRESS,
        'ETH/USD',
        this.settings.CHAINLINK_ETH_USD_MAX_AGE_SECONDS,
        block.number,
      ),
    ]);
    this.requireFresh(usdcPrice, block.timestamp, this.settings.CHAINLINK_USDC_USD_MAX_AGE_SECONDS);
    this.requireFresh(wethPrice, block.timestamp, this.settings.CHAINLINK_ETH_USD_MAX_AGE_SECONDS);
    const rawPrice = deriveRawPrice(
      wethPrice,
      usdcPrice,
      this.settings.USDC_ADDRESS,
      this.settings.WETH_ADDRESS,
    );
    return { block, usdcPrice, wethPrice, rawPrice };
  }

  private async readPrice(
    address: Address,
    expectedDescription: string,
    maxAge: number,
    blockNumber: bigint,
  ) {
    const result = await this.readFeed(address, expectedDescription, blockNumber);
    if (result.answer <= 0n || result.updatedAt === 0n) {
      throw new Error(`${expectedDescription} returned a non-positive or incomplete price`);
    }
    if (maxAge <= 0) throw new Error(`${expectedDescription} maximum age is invalid`);
    return result;
  }

  private async readFeed(
    address: Address,
    expectedDescription: string,
    blockNumber: bigint,
  ): Promise<FeedPrice> {
    const [decimals, description, round] = await Promise.all([
      this.client.readContract({
        address,
        abi: priceFeedAbi,
        functionName: 'decimals',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: priceFeedAbi,
        functionName: 'description',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: priceFeedAbi,
        functionName: 'latestRoundData',
        blockNumber,
      }),
    ]);
    if (
      description.replaceAll(' ', '').toUpperCase() !==
      expectedDescription.replaceAll(' ', '').toUpperCase()
    ) {
      throw new Error(`${address} reports ${description}; expected ${expectedDescription}`);
    }
    const [roundId, answer, startedAt, updatedAt, answeredInRound] = round;
    if (decimals > 18)
      throw new Error(`${expectedDescription} uses unsupported decimals: ${decimals}`);
    if (roundId === 0n || answeredInRound < roundId) {
      throw new Error(`${expectedDescription} returned an incomplete oracle round`);
    }
    return {
      address: getAddress(address),
      description,
      answer,
      decimals,
      roundId,
      answeredInRound,
      startedAt,
      updatedAt,
    } satisfies FeedPrice;
  }

  private requireFresh(price: FeedPrice, blockTimestamp: bigint, maxAgeSeconds: number): void {
    if (price.updatedAt > blockTimestamp) {
      throw new Error(`${price.description} timestamp is later than the Sepolia block timestamp`);
    }
    if (blockTimestamp - price.updatedAt > BigInt(maxAgeSeconds)) {
      throw new Error(`${price.description} is older than ${maxAgeSeconds} seconds`);
    }
  }
}

export function feedMetadata(price: FeedPrice) {
  return {
    address: price.address,
    description: price.description,
    decimals: price.decimals,
    roundId: price.roundId.toString(),
    answeredInRound: price.answeredInRound.toString(),
    startedAt: price.startedAt.toString(),
    updatedAt: price.updatedAt.toString(),
  };
}

export function normalizeUsd18(price: FeedPrice): bigint {
  return price.answer * 10n ** BigInt(18 - price.decimals);
}

export function deriveRawPrice(
  wethUsd: FeedPrice,
  usdcUsd: FeedPrice,
  usdc: Address,
  weth: Address,
): bigint {
  if (wethUsd.answer <= 0n || usdcUsd.answer <= 0n || BigInt(usdc) === BigInt(weth))
    throw new Error('Invalid oracle price or token pair');
  const rawPrice =
    BigInt(usdc) < BigInt(weth)
      ? (normalizeUsd18(usdcUsd) * 10n ** 30n) / normalizeUsd18(wethUsd)
      : (normalizeUsd18(wethUsd) * 10n ** 6n) / normalizeUsd18(usdcUsd);
  if (rawPrice <= 0n) throw new Error('Chainlink-derived USDC/WETH price is zero');
  return rawPrice;
}
