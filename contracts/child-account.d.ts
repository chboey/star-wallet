import type { Hex, Address } from "viem";
export declare const parentSessionPrefix: "0x53575031";
export type ParentDeviceGrant = {
  epoch: bigint;
  deviceKeyX: Hex;
  deviceKeyY: Hex;
  parentSignature: Hex;
};
export declare function parentAuthorizationDigest(input: {
  chainId: number;
  account: Address;
  familyId: bigint;
  epoch: bigint;
  deviceKeyX: Hex;
  deviceKeyY: Hex;
}): Hex;
export declare function normalizeP256Signature(signature: Hex): Hex;
export declare function encodeParentSessionSignature(
  input: ParentDeviceGrant & { signature: Hex },
): Hex;
export declare function decodeParentSessionSignature(
  encoded: Hex,
): ParentDeviceGrant & { signature: Hex };
export declare function createParentSessionGasStub(
  grant: ParentDeviceGrant,
): Hex;
export declare const passkeyGasChallenge: Hex;
export declare const maxPasskeyClientDataBytes: 1024;
export declare const maxPasskeyAuthenticatorDataBytes: 512;
export declare function createPasskeyGasStub(rpId: string): Hex;
export type ChildCall =
  | { functionName: "acceptRegistration"; args: readonly [Hex] }
  | {
      functionName:
        | "requestRedemption"
        | "cancelRedemption"
        | "cancelStarRequest"
        | "cancelGoalRequest";
      args: readonly [bigint];
    }
  | { functionName: "submitQuest"; args: readonly [bigint, Hex] }
  | { functionName: "addStarsToGoal"; args: readonly [bigint, bigint] }
  | { functionName: "requestStars"; args: readonly [bigint, string, Hex] }
  | {
      functionName: "requestGoal";
      args: readonly [string, string, number, Hex];
    };
export declare function decodeChildCall(data: Hex): ChildCall;
export declare function encodePasskeySignature(input: {
  signature: Hex;
  authenticatorData: Hex;
  clientDataJSON: string;
  challengeIndex: number;
  typeIndex: number;
}): Hex;
