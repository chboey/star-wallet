import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  parseAbi,
} from 'viem';
import { sepolia } from 'viem/chains';
import { loadConfig } from '../src/config.js';
import { PortfolioService } from '../src/services/portfolio.js';

const settings = loadConfig({});
const parent = '0x0000000000000000000000000000000000001234';
const feeds = parseAbi([
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
]);
const balances = {
  familyId: '7',
  parent,
  availableUsdc: 10_000_000n,
  availableWeth: 0n,
  positionUsdc: 20_000_000n,
  positionWeth: 0n,
  indexedBlock: 99n,
} as const;

function fixture(tokenDecimals = 6, brokenBalance = false) {
  const client = createPublicClient({
    chain: sepolia,
    transport: custom(
      {
        async request({ method, params }) {
          if (method === 'eth_chainId') return '0xaa36a7';
          if (method === 'eth_getBlockByNumber')
            return { number: '0x64', timestamp: '0xf4240', transactions: [] };
          assert.equal(method, 'eth_call');
          const [call, block] = params as [{ to: string; data: `0x${string}` }, string];
          assert.equal(block, '0x64');
          const usdc = call.to.toLowerCase() === settings.USDC_ADDRESS!.toLowerCase();
          const weth = call.to.toLowerCase() === settings.WETH_ADDRESS!.toLowerCase();
          if (usdc || weth) {
            const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
            if (decoded.functionName === 'decimals')
              return encodeFunctionResult({
                abi: erc20Abi,
                functionName: 'decimals',
                result: usdc ? tokenDecimals : 18,
              });
            assert.equal(decoded.functionName, 'balanceOf');
            assert.deepEqual(decoded.args, [parent]);
            return brokenBalance
              ? '0x'
              : encodeFunctionResult({
                  abi: erc20Abi,
                  functionName: 'balanceOf',
                  result: usdc ? 120_000_000n : 80_000_000_000_000_000n,
                });
          }
          const isUsdcFeed =
            call.to.toLowerCase() === settings.CHAINLINK_USDC_USD_FEED_ADDRESS!.toLowerCase();
          if (call.data === '0x313ce567')
            return encodeFunctionResult({ abi: feeds, functionName: 'decimals', result: 8 });
          if (call.data === '0x7284e416')
            return encodeFunctionResult({
              abi: feeds,
              functionName: 'description',
              result: isUsdcFeed ? 'USDC / USD' : 'ETH / USD',
            });
          assert.equal(call.data, '0xfeaf968c');
          return encodeFunctionResult({
            abi: feeds,
            functionName: 'latestRoundData',
            result: [10n, isUsdcFeed ? 100_000_000n : 200_000_000_000n, 999_990n, 999_990n, 10n],
          });
        },
      },
      { retryCount: 0 },
    ),
  });
  return new PortfolioService(settings, client);
}

test('parent wallet balances are read separately from family-vault holdings at the valuation block', async () => {
  const result = await fixture().value(balances);
  assert.deepEqual(result.parentWallet, {
    address: parent,
    usdc: { amount: '120000000', decimals: 6 },
    weth: { amount: '80000000000000000', decimals: 18 },
  });
  assert.equal(result.assets.usdc.totalAmount, '30000000');
  assert.equal(result.currentPortfolioValue.amount, '30000000000000000000');
  assert.equal(result.valuedAtBlock, '100');
});

test('invalid token decimals or failed wallet reads never fabricate a zero balance', async () => {
  await assert.rejects(fixture(18).value(balances), { code: 'TOKEN_DECIMALS_MISMATCH' });
  await assert.rejects(fixture(6, true).value(balances), { code: 'PORTFOLIO_PRICING_UNAVAILABLE' });
});
