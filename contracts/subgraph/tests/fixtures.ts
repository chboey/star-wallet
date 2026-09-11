import {
  Address,
  BigInt,
  Bytes,
  DataSourceContext,
  ethereum,
} from "@graphprotocol/graph-ts";
import {
  createMockedFunction,
  dataSourceMock,
  newMockEvent,
} from "matchstick-as";
import { FamilyCreated } from "../generated/StarRegistry/StarRegistry";
import { FamilyVaultCreated } from "../generated/StarFamilyVaultFactory/StarFamilyVaultFactory";
import { Docked, Pulled, Pushed, Shipped } from "../generated/Aqua/Aqua";
import { Swapped } from "../generated/AquaSwapVM/AquaSwapVM";
import { SavingsPositionUpdated } from "../generated/templates/StarFamilyVaultTemplate/StarFamilyVault";
import { SavingsAccount } from "../generated/schema";
import { handleFamilyCreated } from "../src/registry";
import { handleFamilyVaultCreated } from "../src/factory";

export const USDC = Address.fromString(
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
);
export const WETH = Address.fromString(
  "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
);
export const MAKER = Address.fromString(
  "0x0000000000000000000000000000000000000003",
);
export const OTHER_MAKER = Address.fromString(
  "0x0000000000000000000000000000000000000004",
);
export const AQUA = Address.fromString(
  "0x0000000000000000000000000000000000000005",
);
export const APP = Address.fromString(
  "0x0000000000000000000000000000000000000006",
);
export const FACTORY = Address.fromString(
  "0x0000000000000000000000000000000000000007",
);
export const PARENT = Address.fromString(
  "0x0000000000000000000000000000000000000008",
);
export const HASH = Bytes.fromHexString("0x" + "aa".repeat(32));
export const OTHER_HASH = Bytes.fromHexString("0x" + "bb".repeat(32));
export const OPEN_USDC = "100000000";
export const OPEN_WETH = "1000000000000000000";

export function param(
  name: string,
  value: ethereum.Value,
): ethereum.EventParam {
  return new ethereum.EventParam(name, value);
}
export function uint(value: string): ethereum.Value {
  return ethereum.Value.fromUnsignedBigInt(BigInt.fromString(value));
}
export function mockEvent<T>(
  address: Address,
  params: ethereum.EventParam[],
  index: i32,
): T {
  const event = newMockEvent();
  event.address = address;
  event.parameters = params;
  event.logIndex = BigInt.fromI32(index);
  event.block.number = BigInt.fromI32(100);
  event.block.timestamp = BigInt.fromI32(1000);
  return changetype<T>(event);
}

export function setFamilyContext(familyId: string): void {
  const context = new DataSourceContext();
  context.setString("familyId", familyId);
  context.setString("vault", MAKER.toHexString());
  dataSourceMock.setReturnValues(MAKER.toHexString(), "sepolia", context);
}

export function createVault(
  familyId: string = "1",
  maker: Address = MAKER,
  usdc: Address = USDC,
  weth: Address = WETH,
): void {
  handleFamilyCreated(
    mockEvent<FamilyCreated>(
      FACTORY,
      [
        param("familyId", uint(familyId)),
        param("parent", ethereum.Value.fromAddress(PARENT)),
        param("ensNode", ethereum.Value.fromFixedBytes(HASH)),
        param("ensName", ethereum.Value.fromString("family.eth")),
      ],
      100 + I32.parseInt(familyId) * 2,
    ),
  );
  const names = ["emergencyAdmin", "aqua", "swapVmApp", "usdc", "weth"];
  const values = [PARENT, AQUA, APP, usdc, weth];
  for (let i = 0; i < names.length; i++) {
    createMockedFunction(FACTORY, names[i], names[i] + "():(address)").returns([
      ethereum.Value.fromAddress(values[i]),
    ]);
  }
  createMockedFunction(maker, "quests", "quests():(address)").returns([
    ethereum.Value.fromAddress(OTHER_MAKER),
  ]);
  handleFamilyVaultCreated(
    mockEvent<FamilyVaultCreated>(
      FACTORY,
      [
        param("familyId", uint(familyId)),
        param("parent", ethereum.Value.fromAddress(PARENT)),
        param("vault", ethereum.Value.fromAddress(maker)),
        param("emergencyAdmin", ethereum.Value.fromAddress(PARENT)),
      ],
      101 + I32.parseInt(familyId) * 2,
    ),
  );
  const savings = SavingsAccount.load(familyId)!;
  savings.availableUsdc = BigInt.fromString(OPEN_USDC);
  savings.availableWeth = BigInt.fromString(OPEN_WETH);
  savings.totalPrincipalContributed = BigInt.fromString(OPEN_USDC);
  savings.netPrincipal = BigInt.fromString(OPEN_USDC);
  savings.save();
  setFamilyContext(familyId);
}

function aquaParams(maker: Address, hash: Bytes): ethereum.EventParam[] {
  return [
    param("maker", ethereum.Value.fromAddress(maker)),
    param("app", ethereum.Value.fromAddress(APP)),
    param("strategyHash", ethereum.Value.fromFixedBytes(hash)),
  ];
}
export function shipped(
  index: i32 = 1,
  hash: Bytes = HASH,
  maker: Address = MAKER,
): Shipped {
  const params = aquaParams(maker, hash);
  params.push(
    param("strategy", ethereum.Value.fromBytes(Bytes.fromHexString("0x01"))),
  );
  return mockEvent<Shipped>(AQUA, params, index);
}
export function pushed(
  token: Address,
  amount: string,
  index: i32,
  hash: Bytes = HASH,
  maker: Address = MAKER,
): Pushed {
  const params = aquaParams(maker, hash);
  params.push(param("token", ethereum.Value.fromAddress(token)));
  params.push(param("amount", uint(amount)));
  return mockEvent<Pushed>(AQUA, params, index);
}
export function pulled(
  token: Address,
  amount: string,
  index: i32,
  hash: Bytes = HASH,
  maker: Address = MAKER,
): Pulled {
  return changetype<Pulled>(pushed(token, amount, index, hash, maker));
}
export function swapped(
  index: i32,
  hash: Bytes = HASH,
  maker: Address = MAKER,
): Swapped {
  return mockEvent<Swapped>(
    APP,
    [
      param("orderHash", ethereum.Value.fromFixedBytes(hash)),
      param("maker", ethereum.Value.fromAddress(maker)),
      param("taker", ethereum.Value.fromAddress(PARENT)),
      param("tokenIn", ethereum.Value.fromAddress(USDC)),
      param("tokenOut", ethereum.Value.fromAddress(WETH)),
      param("amountIn", uint("10000000")),
      param("amountOut", uint("5000000000000000")),
    ],
    index,
  );
}
export function docked(index: i32, hash: Bytes = HASH): Docked {
  return mockEvent<Docked>(AQUA, aquaParams(MAKER, hash), index);
}
export function positionEvent(
  active: bool = true,
  index: i32 = 4,
  usdc: string = OPEN_USDC,
  weth: string = OPEN_WETH,
  hash: Bytes = HASH,
  maker: Address = MAKER,
  familyId: string = "1",
): SavingsPositionUpdated {
  return mockEvent<SavingsPositionUpdated>(
    maker,
    [
      param("familyId", uint(familyId)),
      param("strategyHash", ethereum.Value.fromFixedBytes(hash)),
      param("usdcAmount", uint(usdc)),
      param("wethAmount", uint(weth)),
      param("active", ethereum.Value.fromBoolean(active)),
    ],
    index,
  );
}
