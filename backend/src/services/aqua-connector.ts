import {
  concatHex,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  isAddressEqual,
  keccak256,
  parseAbi,
  size,
  sliceHex,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';

/** Wire format pinned to vendor/1inch-swap-vm commit f09a41e689240adc645934f965c8061749397cd2.
 * Deliberately supports only Star's hook-free Aqua concentrated orders and full exact-input swaps.
 * This connector prepares calls; it never holds keys, sends transactions or changes allowances.
 */
export const swapVmAbi = parseAbi([
  'function AQUA() view returns (address)',
  'function WETH() view returns (address)',
  'function hash((address maker,uint256 traits,bytes data) order) view returns (bytes32)',
  'function quote((address maker,uint256 traits,bytes data) order,uint256 amount,bytes takerTraitsAndData) returns (uint256 amountIn,uint256 amountOut,bytes32 orderHash)',
  'function swap((address maker,uint256 traits,bytes data) order,uint256 amount,bytes takerTraitsAndData) payable returns (uint256 amountIn,uint256 amountOut,bytes32 orderHash)',
  'event Swapped(bytes32 orderHash,address maker,address taker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut)',
]);
export const aquaAbi = parseAbi([
  'function ship(address app,bytes strategy,address[] tokens,uint256[] amounts) returns (bytes32 strategyHash)',
  'function dock(address app,bytes32 strategyHash,address[] tokens)',
  'function safeBalances(address maker,address app,bytes32 strategyHash,address token0,address token1) view returns (uint256 balance0,uint256 balance1)',
]);
const orderAbi = [
  {
    type: 'tuple',
    components: [
      { name: 'maker', type: 'address' },
      { name: 'traits', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
  },
] as const;
// Four hook end offsets all point past the two packed token addresses (40 bytes).
export const AQUA_MAKER_TRAITS = (1n << 254n) | (0x0028002800280028n << 160n);
const ONE = 10n ** 18n;
export type AquaOrder = { maker: Address; traits: bigint; data: Hex };
export type ConcentratedOrderInput = {
  maker: Address;
  tokenA: Address;
  tokenB: Address;
  /** tokenB base units / tokenA base units, scaled by 1e18. Tokens must be sorted. */
  rawPriceMin: bigint;
  rawPriceMax: bigint;
  feeBps: number;
  salt: bigint;
  deadline: bigint;
};
type SwapInput = { strategy: Hex; tokenIn: Address; tokenOut: Address; amount: bigint };
export type ContractCall = { to: Address; data: Hex; value: bigint };

export class AquaConnector {
  readonly aqua: Address;
  readonly swapVm: Address;

  constructor(addresses: { aqua: Address; swapVm: Address }) {
    this.aqua = address(addresses.aqua);
    this.swapVm = address(addresses.swapVm);
    if (isAddressEqual(this.aqua, this.swapVm)) throw new Error('Aqua and SwapVM must be distinct');
  }

  static buildOrder(input: ConcentratedOrderInput) {
    const maker = address(input.maker);
    const [tokenA, tokenB] = sortedPair(input.tokenA, input.tokenB);
    uint(input.rawPriceMin, 256, 'minimum price');
    uint(input.rawPriceMax, 256, 'maximum price');
    if (input.rawPriceMax <= input.rawPriceMin) throw new Error('Invalid price range');
    if (!Number.isSafeInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > 1_000) {
      throw new Error('Fee must be an integer between 0 and 1000 bps');
    }
    uint(input.salt, 64, 'salt');
    uint(input.deadline, 40, 'deadline');
    const minimumSquared = input.rawPriceMin * ONE;
    const minimumRoot = sqrt(minimumSquared);
    // Round into the accepted band. At Sepolia's reciprocal price scale a
    // floor here can undershoot the on-chain lower bound by thousands of units.
    const sqrtPriceMin =
      minimumRoot * minimumRoot === minimumSquared ? minimumRoot : minimumRoot + 1n;
    const sqrtPriceMax = sqrt(input.rawPriceMax * ONE);
    if (sqrtPriceMax <= sqrtPriceMin)
      throw new Error('Price range collapses after square-root rounding');
    // FeeFlatIn wraps the following curve execution. XYCConcentrateSwap already swaps:
    // appending a second XYCSwap would overwrite its concentrated-price result.
    const program = concatHex([
      instruction(0x20, toHex(input.deadline, { size: 5 })),
      ...(input.feeBps
        ? [instruction(0x70, toHex(BigInt(input.feeBps) * 1_000n, { size: 3 }))]
        : []),
      instruction(0x51, encodePacked(['uint256', 'uint256'], [sqrtPriceMin, sqrtPriceMax])),
      instruction(0x02, toHex(input.salt, { size: 8 })),
    ]);
    const order: AquaOrder = {
      maker,
      traits: AQUA_MAKER_TRAITS,
      data: concatHex([encodePacked(['address', 'address'], [tokenA, tokenB]), program]),
    };
    const strategy = encodeAbiParameters(orderAbi, [order]);
    return {
      order,
      strategy,
      strategyHash: keccak256(strategy),
      program,
      sqrtPriceMin,
      sqrtPriceMax,
    };
  }

  /** Reject noncanonical encodings, foreign maker flags/hooks and unsupported programs. */
  static decodeOrder(strategy: Hex) {
    if (size(strategy) > 4_096) throw new Error('Strategy is too large');
    const [order] = decodeAbiParameters(orderAbi, strategy);
    if (encodeAbiParameters(orderAbi, [order]).toLowerCase() !== strategy.toLowerCase()) {
      throw new Error('Noncanonical order encoding');
    }
    address(order.maker);
    if (order.traits !== AQUA_MAKER_TRAITS) throw new Error('Unsupported maker traits');
    const [tokenA, tokenB] = sortedPair(sliceHex(order.data, 0, 20), sliceHex(order.data, 20, 40));
    const program = sliceHex(order.data, 40);
    const hasFee = size(program) === 88;
    if (!hasFee && size(program) !== 83) throw new Error('Unsupported concentrated program');
    const curve = hasFee ? 12 : 7;
    if (
      sliceHex(program, 0, 2) !== '0x2005' ||
      sliceHex(program, curve, curve + 2) !== '0x5140' ||
      sliceHex(program, curve + 66, curve + 68) !== '0x0208'
    ) {
      throw new Error('Unsupported concentrated program');
    }
    const fee = hasFee ? BigInt(sliceHex(program, 9, 12)) : 0n;
    if (
      hasFee &&
      (sliceHex(program, 7, 9) !== '0x7003' ||
        fee === 0n ||
        fee % 1_000n !== 0n ||
        fee > 1_000_000n)
    ) {
      throw new Error('Unsupported fee');
    }
    const deadline = BigInt(sliceHex(program, 2, 7));
    const salt = BigInt(sliceHex(program, curve + 68, curve + 76));
    const sqrtPriceMin = BigInt(sliceHex(program, curve + 2, curve + 34));
    const sqrtPriceMax = BigInt(sliceHex(program, curve + 34, curve + 66));
    if (!deadline || !salt || !sqrtPriceMin || sqrtPriceMax <= sqrtPriceMin)
      throw new Error('Invalid strategy parameters');
    return {
      order,
      tokenA,
      tokenB,
      program,
      deadline,
      salt,
      sqrtPriceMin,
      sqrtPriceMax,
      feeBps: Number(fee / 1_000n),
    };
  }

  /** Quote only: no threshold. Quotes are eth_call simulations, never transactions. */
  quote(input: SwapInput): ContractCall {
    return this.swapCall('quote', input, undefined, undefined);
  }

  /** A swap always enforces a positive minimum output and deadline; partial fills are disabled. */
  swap(input: SwapInput & { minimumOutput: bigint; deadline: bigint }): ContractCall {
    uint(input.minimumOutput, 256, 'minimum output');
    uint(input.deadline, 40, 'taker deadline');
    return this.swapCall('swap', input, input.minimumOutput, input.deadline);
  }

  /** Direct Aqua calls are for the maker itself. Star vault users call shipSavingsPosition instead. */
  ship(input: { strategy: Hex; amountA: bigint; amountB: bigint }): ContractCall {
    const { tokenA, tokenB } = AquaConnector.decodeOrder(input.strategy);
    uint(input.amountA, 248, 'token A amount');
    uint(input.amountB, 248, 'token B amount');
    return {
      to: this.aqua,
      value: 0n,
      data: encodeFunctionData({
        abi: aquaAbi,
        functionName: 'ship',
        args: [this.swapVm, input.strategy, [tokenA, tokenB], [input.amountA, input.amountB]],
      }),
    };
  }

  dock(strategy: Hex): ContractCall {
    const { tokenA, tokenB } = AquaConnector.decodeOrder(strategy);
    return {
      to: this.aqua,
      value: 0n,
      data: encodeFunctionData({
        abi: aquaAbi,
        functionName: 'dock',
        args: [this.swapVm, keccak256(strategy), [tokenA, tokenB]],
      }),
    };
  }

  private swapCall(
    name: 'quote' | 'swap',
    input: SwapInput,
    minimumOutput?: bigint,
    deadline?: bigint,
  ): ContractCall {
    uint(input.amount, 256, 'input amount');
    const decoded = AquaConnector.decodeOrder(input.strategy);
    const tokenIn = address(input.tokenIn);
    const tokenOut = address(input.tokenOut);
    const isAToB =
      isAddressEqual(tokenIn, decoded.tokenA) && isAddressEqual(tokenOut, decoded.tokenB);
    if (
      !isAToB &&
      !(isAddressEqual(tokenIn, decoded.tokenB) && isAddressEqual(tokenOut, decoded.tokenA))
    ) {
      throw new Error('Swap tokens do not match the order pair');
    }
    if (deadline !== undefined && deadline > decoded.deadline)
      throw new Error('Taker deadline exceeds strategy deadline');
    // Ten uint16 end offsets, then uint16 flags (22-byte header). No callbacks,
    // custom recipient, signature or instruction arguments. Payment uses router transferFrom + Aqua.push.
    const thresholdBytes = minimumOutput === undefined ? '0x' : toHex(minimumOutput, { size: 32 });
    const deadlineBytes = deadline === undefined ? '0x' : toHex(deadline, { size: 5 });
    const thresholdEnd = size(thresholdBytes);
    const end = thresholdEnd + size(deadlineBytes);
    const offsets = [thresholdEnd, thresholdEnd, ...Array<number>(8).fill(end)];
    const flags = 0x0001 | 0x0040 | (isAToB ? 0x0080 : 0);
    const takerTraitsAndData = concatHex([
      ...offsets.reverse().map((offset) => toHex(offset, { size: 2 })),
      toHex(flags, { size: 2 }),
      thresholdBytes,
      deadlineBytes,
    ]);
    return {
      to: this.swapVm,
      value: 0n,
      data: encodeFunctionData({
        abi: swapVmAbi,
        functionName: name,
        args: [decoded.order, input.amount, takerTraitsAndData],
      }),
    };
  }
}

function address(value: Address): Address {
  const normalized = getAddress(value);
  if (normalized === zeroAddress) throw new Error('Zero address is not allowed');
  return normalized;
}
function sortedPair(a: Address, b: Address): [Address, Address] {
  const tokenA = address(a);
  const tokenB = address(b);
  if (BigInt(tokenA) >= BigInt(tokenB))
    throw new Error('Tokens must be distinct and sorted by address');
  return [tokenA, tokenB];
}
function uint(value: bigint, bits: number, label: string) {
  if (typeof value !== 'bigint' || value <= 0n || value >= 1n << BigInt(bits))
    throw new Error(`Invalid ${label}: expected positive uint${bits}`);
}
function instruction(opcode: number, args: Hex): Hex {
  return concatHex([toHex(opcode, { size: 1 }), toHex(size(args), { size: 1 }), args]);
}
function sqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let root = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (root + value / root) / 2n;
    if (next >= root) return root;
    root = next;
  }
}
