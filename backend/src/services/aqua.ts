import { randomBytes } from 'node:crypto';
import type { Address, Hex } from 'viem';
import type { Config } from '../config.js';
import { ChainlinkPricingService, feedMetadata, type PricingSnapshot } from './pricing.js';
import { AquaConnector } from './aqua-connector.js';

export type AquaStrategyInput = {
  maker: Address;
  feeBps: number;
  priceBandBps: number;
  validForSeconds: number;
};

export type BuiltAquaStrategy = {
  strategy: Hex;
  strategyHash: Hex;
  strategyType: 'XYC_CONCENTRATED';
  salt: string;
  deadline: string;
  priceBandBps: number;
  oracleRawPrice: string;
  rawPriceMin: string;
  rawPriceMax: string;
  oracleBlockNumber: string;
  oracleBlockTimestamp: string;
  oracleFeeds: {
    ethUsd: ReturnType<typeof feedMetadata>;
    usdcUsd: ReturnType<typeof feedMetadata>;
  };
};

export class AquaStrategyService {
  private readonly pricing: { context(): Promise<PricingSnapshot> };

  constructor(
    private readonly settings: Config,
    pricing: { context(): Promise<PricingSnapshot> } = new ChainlinkPricingService(settings),
  ) {
    this.pricing = pricing;
  }

  async build(input: AquaStrategyInput): Promise<BuiltAquaStrategy> {
    if (!Number.isSafeInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > 1_000) {
      throw new Error('Aqua strategy fee must be between 0 and 1000 bps');
    }
    if (
      !Number.isSafeInteger(input.priceBandBps) ||
      input.priceBandBps < 25 ||
      input.priceBandBps > this.settings.AQUA_MAX_PRICE_DEVIATION_BPS
    ) {
      throw new Error(
        `Aqua price band must be between 25 and ${this.settings.AQUA_MAX_PRICE_DEVIATION_BPS} bps`,
      );
    }
    if (
      !Number.isSafeInteger(input.validForSeconds) ||
      input.validForSeconds < 120 ||
      input.validForSeconds > this.settings.AQUA_MAX_STRATEGY_LIFETIME_SECONDS
    ) {
      throw new Error(
        `Aqua strategy lifetime must be between 120 and ${this.settings.AQUA_MAX_STRATEGY_LIFETIME_SECONDS} seconds`,
      );
    }

    const pricing = await this.pricing.context();
    const { rawPriceMin, rawPriceMax } = derivePriceBand(pricing.rawPrice, input.priceBandBps);
    const deadline = pricing.block.timestamp + BigInt(input.validForSeconds);
    let salt = 0n;
    while (salt === 0n) salt = BigInt(`0x${randomBytes(8).toString('hex')}`);
    if (!this.settings.WETH_ADDRESS || !this.settings.USDC_ADDRESS) {
      throw new Error('WETH and USDC addresses are required');
    }
    const [tokenA, tokenB] = [this.settings.USDC_ADDRESS, this.settings.WETH_ADDRESS].sort(
      (a, b) => (BigInt(a) < BigInt(b) ? -1 : 1),
    );
    const built = AquaConnector.buildOrder({
      maker: input.maker,
      tokenA: tokenA!,
      tokenB: tokenB!,
      rawPriceMin,
      rawPriceMax,
      feeBps: input.feeBps,
      salt,
      deadline,
    });
    return {
      strategy: built.strategy,
      strategyHash: built.strategyHash,
      strategyType: 'XYC_CONCENTRATED',
      salt: salt.toString(),
      deadline: deadline.toString(),
      priceBandBps: input.priceBandBps,
      oracleRawPrice: pricing.rawPrice.toString(),
      rawPriceMin: rawPriceMin.toString(),
      rawPriceMax: rawPriceMax.toString(),
      oracleBlockNumber: pricing.block.number.toString(),
      oracleBlockTimestamp: pricing.block.timestamp.toString(),
      oracleFeeds: {
        ethUsd: feedMetadata(pricing.wethPrice),
        usdcUsd: feedMetadata(pricing.usdcPrice),
      },
    };
  }
}

export function derivePriceBand(oracleRawPrice: bigint, priceBandBps: number) {
  if (oracleRawPrice <= 0n) throw new Error('Oracle raw price must be positive');
  if (!Number.isSafeInteger(priceBandBps) || priceBandBps <= 0 || priceBandBps >= 10_000) {
    throw new Error('Price band must be an integer between 1 and 9999 bps');
  }
  const bps = BigInt(priceBandBps);
  const rawPriceMin = (oracleRawPrice * (10_000n - bps)) / 10_000n;
  const rawPriceMax = (oracleRawPrice * (10_000n + bps)) / 10_000n;
  if (rawPriceMin <= 0n || rawPriceMax <= rawPriceMin) {
    throw new Error('Chainlink-derived Aqua price range is invalid');
  }
  return { rawPriceMin, rawPriceMax };
}
