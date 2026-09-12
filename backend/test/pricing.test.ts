import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicClient, custom, numberToHex, encodeFunctionResult, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
import { loadConfig } from '../src/config.js';
import { ChainlinkPricingService } from '../src/services/pricing.js';

const abi = parseAbi([
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
]);
const settings = loadConfig({ SEPOLIA_RPC_URL: 'http://127.0.0.1:8545' });

function fixture(
  options: {
    chainId?: number;
    updatedAt?: bigint;
    answer?: bigint;
    answeredInRound?: bigint;
    description?: string;
  } = {},
) {
  const blocks: string[] = [];
  const client = createPublicClient({
    chain: sepolia,
    transport: custom({
      async request({ method, params }) {
        if (method === 'eth_chainId') return numberToHex(options.chainId ?? sepolia.id);
        if (method === 'eth_getBlockByNumber')
          return { number: '0x64', timestamp: '0xf4240', transactions: [] };
        if (method !== 'eth_call') throw new Error(`Unexpected RPC method: ${method}`);
        const [call, block] = params as [{ to: string; data: string }, string];
        blocks.push(block);
        const isUsdc =
          call.to.toLowerCase() === settings.CHAINLINK_USDC_USD_FEED_ADDRESS!.toLowerCase();
        if (call.data === '0x313ce567')
          return encodeFunctionResult({ abi, functionName: 'decimals', result: 8 });
        if (call.data === '0x7284e416')
          return encodeFunctionResult({
            abi,
            functionName: 'description',
            result: options.description ?? (isUsdc ? 'USDC / USD' : 'ETH / USD'),
          });
        assert.equal(call.data, '0xfeaf968c');
        return encodeFunctionResult({
          abi,
          functionName: 'latestRoundData',
          result: [
            10n,
            options.answer ?? (isUsdc ? 100_000_000n : 200_000_000_000n),
            999_900n,
            options.updatedAt ?? 999_990n,
            options.answeredInRound ?? 10n,
          ],
        });
      },
    }),
  });
  return { service: new ChainlinkPricingService(settings, client), blocks };
}

test('all oracle reads are pinned to the valuation block', async () => {
  const { service, blocks } = fixture();
  const result = await service.context();
  assert.equal(result.block.number, 100n);
  assert.equal(result.rawPrice, 500_000_000_000_000_000_000_000_000n);
  assert.deepEqual(blocks, Array(6).fill('0x64'));
});

test('rejects the wrong chain before reading any oracle', async () => {
  const { service, blocks } = fixture({ chainId: 1 });
  await assert.rejects(service.context(), /expected 11155111/);
  assert.deepEqual(blocks, []);
});

test('rejects stale, future, incomplete, non-positive and wrong-market prices', async () => {
  for (const [options, pattern] of [
    [{ updatedAt: 1n }, /older than/],
    [{ updatedAt: 1_000_001n }, /later than/],
    [{ updatedAt: 0n }, /incomplete price/],
    [{ answer: 0n }, /non-positive/],
    [{ answeredInRound: 9n }, /incomplete oracle round/],
    [{ description: 'BTC / USD' }, /expected/],
  ] as const)
    await assert.rejects(fixture(options).service.context(), pattern);
});
