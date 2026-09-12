import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress,
  type Hex,
} from 'viem';
import { AquaConnector, AQUA_MAKER_TRAITS, swapVmAbi } from '../src/services/aqua-connector.js';

const addresses = {
  aqua: '0x0000000000000000000000000000000000000010',
  swapVm: '0x0000000000000000000000000000000000000020',
} as const;
const input = {
  maker: '0x0000000000000000000000000000000000001234',
  tokenA: '0x0000000000000000000000000000000000000001',
  tokenB: '0x0000000000000000000000000000000000000002',
  rawPriceMin: 1_900_000_000n,
  rawPriceMax: 2_100_000_000n,
  feeBps: 30,
  salt: 1n,
  deadline: 1_000_900n,
} as const;
const connector = new AquaConnector(addresses);
const built = AquaConnector.buildOrder(input);
const swap = {
  strategy: built.strategy,
  tokenIn: input.tokenA,
  tokenOut: input.tokenB,
  amount: 1n,
};
const encodeOrder = (order: typeof built.order) =>
  encodeAbiParameters(parseAbiParameters('(address maker,uint256 traits,bytes data)'), [order]);

test('uses the pinned three-argument selectors and no native value', () => {
  const quote = connector.quote(swap);
  const trade = connector.swap({ ...swap, minimumOutput: 1n, deadline: input.deadline });
  assert.equal(
    quote.data.slice(0, 10),
    toFunctionSelector('quote((address,uint256,bytes),uint256,bytes)'),
  );
  assert.equal(
    trade.data.slice(0, 10),
    toFunctionSelector('swap((address,uint256,bytes),uint256,bytes)'),
  );
  assert.equal(trade.to, addresses.swapVm);
  assert.equal(trade.value, 0n);
});

test('encodes exact-input, transferFrom+push, correct direction and no partial fills', () => {
  for (const reverse of [false, true]) {
    const call = connector.quote(
      reverse ? { ...swap, tokenIn: input.tokenB, tokenOut: input.tokenA } : swap,
    );
    const decoded = decodeFunctionData({ abi: swapVmAbi, data: call.data });
    assert.equal(decoded.functionName, 'quote');
    if (decoded.functionName !== 'quote') throw new Error('Expected quote');
    assert.equal(BigInt(decoded.args[2]), reverse ? 0x41n : 0xc1n);
  }
});

test('requires a complete positive slippage limit and bounded deadline for swaps', () => {
  assert.throws(
    () => connector.swap({ ...swap, deadline: input.deadline } as never),
    /minimum output/,
  );
  assert.throws(
    () => connector.swap({ ...swap, minimumOutput: '1', deadline: input.deadline } as never),
    /minimum output/,
  );
  assert.throws(
    () => connector.swap({ ...swap, minimumOutput: 0n, deadline: input.deadline }),
    /minimum output/,
  );
  assert.throws(() => connector.swap({ ...swap, minimumOutput: 1n, deadline: 0n }), /deadline/);
  assert.throws(
    () => connector.swap({ ...swap, minimumOutput: 1n, deadline: input.deadline + 1n }),
    /exceeds/,
  );
  assert.throws(() => connector.quote({ ...swap, amount: 0n }), /input amount/);
  assert.throws(() => connector.quote({ ...swap, tokenIn: input.maker }), /pair/);
  assert.throws(() => connector.quote({ ...swap, tokenOut: input.tokenA }), /pair/);
});

test('rejects malformed, legacy and hook-enabled orders', () => {
  const invalid: Hex[] = [
    '0x',
    `${built.strategy}00`,
    encodeOrder({ ...built.order, traits: 1n << 254n }),
    encodeOrder({ ...built.order, traits: AQUA_MAKER_TRAITS | (1n << 252n) }),
    encodeOrder({ ...built.order, data: built.program }),
    encodeOrder({ ...built.order, data: `${built.order.data}00` }),
    encodeOrder({ ...built.order, maker: zeroAddress }),
  ];
  for (const strategy of invalid) assert.throws(() => AquaConnector.decodeOrder(strategy));
});

test('validates token order, prices, fee units, salt and packed integer bounds', () => {
  assert.throws(() => AquaConnector.buildOrder({ ...input, tokenA: input.tokenB }), /sorted/);
  assert.throws(() => AquaConnector.buildOrder({ ...input, tokenA: zeroAddress }), /Zero address/);
  for (const feeBps of [-1, 0.5, 1_001, NaN]) {
    assert.throws(() => AquaConnector.buildOrder({ ...input, feeBps }), /Fee/);
  }
  for (const salt of [0n, -1n, 1n << 64n])
    assert.throws(() => AquaConnector.buildOrder({ ...input, salt }), /salt/);
  for (const deadline of [0n, 1n << 40n])
    assert.throws(() => AquaConnector.buildOrder({ ...input, deadline }), /deadline/);
  assert.throws(() => AquaConnector.buildOrder({ ...input, rawPriceMin: 0n }), /price/);
  assert.throws(
    () => AquaConnector.buildOrder({ ...input, rawPriceMin: input.rawPriceMax }),
    /price range/,
  );
  assert.throws(
    () => connector.ship({ strategy: built.strategy, amountA: 1n << 248n, amountB: 1n }),
    /token A amount/,
  );
});

test('rejects using the same address for Aqua and its router', () => {
  assert.throws(
    () => new AquaConnector({ ...addresses, swapVm: addresses.aqua }),
    /must be distinct/,
  );
});
