import type { Config } from '../config.js';
import { HttpError, unavailable } from '../errors.js';
import type { PortfolioBalances } from './graph.js';
import { ChainlinkPricingService, feedMetadata, type FeedPrice } from './pricing.js';
import { createPublicClient, http, erc20Abi, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';

const SEPOLIA_CHAIN_ID = 11155111;

export class PortfolioService {
  private readonly pricing;
  private readonly client: Pick<PublicClient, 'getChainId' | 'getBlock' | 'readContract'>;

  constructor(
    private readonly settings: Config,
    client?: Pick<PublicClient, 'getChainId' | 'getBlock' | 'readContract'>,
  ) {
    this.client =
      client ?? createPublicClient({ chain: sepolia, transport: http(settings.SEPOLIA_RPC_URL) });
    this.pricing = new ChainlinkPricingService(settings, this.client);
  }

  async value(balances: PortfolioBalances) {
    try {
      const { block, usdcPrice, wethPrice } = await this.pricing.context();
      const [walletUsdc, walletWeth, usdcDecimals, wethDecimals] = await Promise.all([
        this.client.readContract({
          address: this.settings.USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [balances.parent],
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: this.settings.WETH_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [balances.parent],
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: this.settings.USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'decimals',
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: this.settings.WETH_ADDRESS,
          abi: erc20Abi,
          functionName: 'decimals',
          blockNumber: block.number,
        }),
      ]);
      if (usdcDecimals !== 6 || wethDecimals !== 18)
        throw unavailable(
          'TOKEN_DECIMALS_MISMATCH',
          'Token decimals do not match the deployed savings accounting',
        );
      const totalUsdc = balances.availableUsdc + balances.positionUsdc;
      const totalWeth = balances.availableWeth + balances.positionWeth;
      const usdcValueUsd18 = usd18(totalUsdc, 6, usdcPrice);
      const wethValueUsd18 = usd18(totalWeth, 18, wethPrice);

      return {
        familyId: balances.familyId,
        parentWallet: {
          address: balances.parent,
          usdc: { amount: walletUsdc.toString(), decimals: usdcDecimals },
          weth: { amount: walletWeth.toString(), decimals: wethDecimals },
        },
        currentPortfolioValue: {
          amount: (usdcValueUsd18 + wethValueUsd18).toString(),
          decimals: 18,
          currency: 'USD',
        },
        assets: {
          usdc: assetValue(
            balances.availableUsdc,
            balances.positionUsdc,
            6,
            usdcValueUsd18,
            usdcPrice,
          ),
          weth: assetValue(
            balances.availableWeth,
            balances.positionWeth,
            18,
            wethValueUsd18,
            wethPrice,
          ),
        },
        valuedAtBlock: block.number.toString(),
        valuedAt: block.timestamp.toString(),
        holdingsIndexedAtBlock: balances.indexedBlock.toString(),
        holdingsIndexedAt:
          balances.indexedTimestamp === undefined
            ? undefined
            : balances.indexedTimestamp.toString(),
      };
    } catch (error) {
      throw pricingError(error);
    }
  }

  async readiness() {
    try {
      const { block, usdcPrice, wethPrice } = await this.pricing.context();
      return {
        chainId: SEPOLIA_CHAIN_ID,
        checkedBlock: block.number.toString(),
        feeds: {
          usdcUsd: feedMetadata(usdcPrice),
          ethUsd: feedMetadata(wethPrice),
        },
      };
    } catch (error) {
      throw pricingError(error);
    }
  }
}
function pricingError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  return unavailable('PORTFOLIO_PRICING_UNAVAILABLE', 'Portfolio valuation failed', {
    cause: error instanceof Error ? error.message : String(error),
  });
}

function usd18(tokenUnits: bigint, tokenDecimals: number, price: FeedPrice): bigint {
  return (
    (tokenUnits * price.answer * 10n ** 18n) /
    (10n ** BigInt(tokenDecimals) * 10n ** BigInt(price.decimals))
  );
}

function assetValue(
  available: bigint,
  position: bigint,
  decimals: number,
  valueUsd18: bigint,
  price: FeedPrice,
) {
  return {
    availableAmount: available.toString(),
    positionAmount: position.toString(),
    totalAmount: (available + position).toString(),
    decimals,
    valueUsd18: valueUsd18.toString(),
    price: {
      address: price.address,
      description: price.description,
      answer: price.answer.toString(),
      decimals: price.decimals,
      roundId: price.roundId.toString(),
      updatedAt: price.updatedAt.toString(),
    },
  };
}
