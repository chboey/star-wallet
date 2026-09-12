import assert from 'node:assert/strict';
import test from 'node:test';
import { keccak256 } from 'viem';
import { loadConfig } from '../src/config.js';
import { AquaStrategyService, derivePriceBand } from '../src/services/aqua.js';
import { AquaConnector } from '../src/services/aqua-connector.js';
import { deriveRawPrice, type FeedPrice, type PricingSnapshot } from '../src/services/pricing.js';

const ethFeed = feed('0x694AA1769357215DE4FAC081bf1f309aDC325306', 'ETH / USD', 200_000_000_000n);
const usdcFeed = feed('0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E', 'USDC / USD', 100_000_000n);
const snapshot: PricingSnapshot = {
  block: { number: 123n, timestamp: 1_000_000n },
  wethPrice: ethFeed,
  usdcPrice: usdcFeed,
  rawPrice: 500_000_000_000_000_000_000_000_000n,
};
const settings = loadConfig({ SEPOLIA_RPC_URL: 'http://127.0.0.1:8545' });

test('derives the reciprocal Sepolia price with 6/18 decimals and supports either token order', () => {
  assert.equal(
    deriveRawPrice(ethFeed, usdcFeed, settings.USDC_ADDRESS!, settings.WETH_ADDRESS!),
    snapshot.rawPrice,
  );
  assert.equal(
    deriveRawPrice(ethFeed, usdcFeed, settings.WETH_ADDRESS!, settings.USDC_ADDRESS!),
    2_000_000_000n,
  );
});

test('derives a price band within the on-chain integer bounds', () => {
  assert.deepEqual(derivePriceBand(2_000_000_001n, 500), {
    rawPriceMin: 1_900_000_000n,
    rawPriceMax: 2_100_000_001n,
  });
});

test('rejects zero prices and duplicate token addresses', () => {
  assert.throws(
    () =>
      deriveRawPrice(
        { ...ethFeed, answer: 0n },
        usdcFeed,
        settings.USDC_ADDRESS!,
        settings.WETH_ADDRESS!,
      ),
    /Invalid oracle/,
  );
  assert.throws(
    () => deriveRawPrice(ethFeed, usdcFeed, settings.USDC_ADDRESS!, settings.USDC_ADDRESS!),
    /Invalid oracle/,
  );
});

test('builds the pinned deadline/fee/concentrated-swap/salt program', async () => {
  const built = await service().build({
    maker: '0x0000000000000000000000000000000000001234',
    feeBps: 30,
    priceBandBps: 500,
    validForSeconds: 900,
  });
  const decoded = AquaConnector.decodeOrder(built.strategy);
  assert.equal((decoded.program.length - 2) / 2, 88);
  assert.ok(decoded.program.startsWith('0x2005'));
  assert.equal(decoded.feeBps, 30);
  assert.equal(decoded.tokenA.toLowerCase(), settings.USDC_ADDRESS?.toLowerCase());
  assert.equal(decoded.tokenB.toLowerCase(), settings.WETH_ADDRESS?.toLowerCase());
  assert.equal(built.deadline, '1000900');
  assert.equal(built.oracleRawPrice, '500000000000000000000000000');
  assert.equal(built.rawPriceMin, '475000000000000000000000000');
  assert.equal(built.rawPriceMax, '525000000000000000000000000');
  assert.ok(decoded.sqrtPriceMin ** 2n / 10n ** 18n >= BigInt(built.rawPriceMin));
  assert.ok(decoded.sqrtPriceMax ** 2n / 10n ** 18n <= BigInt(built.rawPriceMax));
});

test('rejects unsafe band and lifetime inputs before constructing bytecode', async () => {
  await assert.rejects(
    service().build({
      maker: '0x0000000000000000000000000000000000001234',
      feeBps: 30,
      priceBandBps: 10,
      validForSeconds: 900,
    }),
    /price band must be between 25 and 1000 bps/,
  );
  await assert.rejects(
    service().build({
      maker: '0x0000000000000000000000000000000000001234',
      feeBps: 30,
      priceBandBps: 500,
      validForSeconds: 60,
    }),
    /lifetime must be between 120 and 1800 seconds/,
  );
});

test('hashes the complete canonical Aqua order with and without fees', async () => {
  for (const feeBps of [0, 30]) {
    const built = await service().build({
      maker: '0x0000000000000000000000000000000000001234',
      feeBps,
      priceBandBps: 500,
      validForSeconds: 900,
    });
    const decoded = AquaConnector.decodeOrder(built.strategy);
    assert.equal(decoded.feeBps, feeBps);
    assert.equal(built.strategyHash, keccak256(built.strategy));
  }
});

function service() {
  return new AquaStrategyService(settings, { context: async () => snapshot });
}

function feed(address: FeedPrice['address'], description: string, answer: bigint): FeedPrice {
  return {
    address,
    description,
    answer,
    decimals: 8,
    roundId: 1n,
    answeredInRound: 1n,
    startedAt: 990_000n,
    updatedAt: 999_900n,
  };
}
