import {
  decodeFunctionData,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  zeroHash,
  sha256,
  stringToHex,
  keccak256,
  hexToBytes,
  concatHex,
} from "viem";
import { childAccountAbi } from "./abi/index.js";

/** Shared strict allowlist. Re-encoding rejects extra calls, trailing bytes and noncanonical ABI. */
export function decodeChildCall(data) {
  if (typeof data !== "string" || data.length > 1482)
    throw new Error("Invalid child call");
  const call = decodeFunctionData({ abi: childAccountAbi, data });
  if (
    ![
      "acceptRegistration",
      "requestRedemption",
      "addStarsToGoal",
      "cancelRedemption",
      "submitQuest",
      "requestStars",
      "cancelStarRequest",
      "requestGoal",
      "cancelGoalRequest",
    ].includes(call.functionName)
  )
    throw new Error("Unsupported child call");
  if (
    encodeFunctionData({
      abi: childAccountAbi,
      functionName: call.functionName,
      args: call.args,
    }).toLowerCase() !== data.toLowerCase()
  )
    throw new Error("Noncanonical child call");
  if (
    call.functionName === "requestGoal" &&
    (new TextEncoder().encode(call.args[0]).length === 0 ||
      new TextEncoder().encode(call.args[0]).length > 64 ||
      new TextEncoder().encode(call.args[1]).length > 480 ||
      call.args[2] > 6 ||
      call.args[3] === zeroHash)
  )
    throw new Error("Invalid goal request");
  if (call.functionName === "cancelGoalRequest" && call.args[0] === 0n)
    throw new Error("Invalid goal request ID");
  if (
    call.functionName === "addStarsToGoal" &&
    (call.args[0] === 0n || call.args[1] === 0n)
  )
    throw new Error("Invalid goal contribution");
  if (
    call.functionName === "submitQuest" &&
    (call.args[0] === 0n || call.args[1] === zeroHash)
  )
    throw new Error("Invalid submission");
  if (
    call.functionName === "requestStars" &&
    (call.args[0] === 0n ||
      call.args[0] > 1000n ||
      new TextEncoder().encode(call.args[1]).length === 0 ||
      new TextEncoder().encode(call.args[1]).length > 128 ||
      call.args[2] === zeroHash)
  )
    throw new Error("Invalid Star request");
  return call;
}

const p256Order =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export const parentSessionPrefix = "0x53575031";

export function parentAuthorizationDigest({
  chainId,
  account,
  familyId,
  epoch,
  deviceKeyX,
  deviceKeyY,
}) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32, uint256, address, uint256, uint256, bytes32, bytes32",
      ),
      [
        keccak256(
          stringToHex(
            "StarParentAuthorization(uint256 chainId,address account,uint256 familyId,uint256 epoch,bytes32 deviceKeyX,bytes32 deviceKeyY)",
          ),
        ),
        BigInt(chainId),
        account,
        BigInt(familyId),
        BigInt(epoch),
        deviceKeyX,
        deviceKeyY,
      ],
    ),
  );
}

export function normalizeP256Signature(signature) {
  if (!/^0x[0-9a-f]{128}$/i.test(signature))
    throw new Error("Invalid P256 signature");
  const r = BigInt(`0x${signature.slice(2, 66)}`);
  let s = BigInt(`0x${signature.slice(66)}`);
  if (r <= 0n || r >= p256Order || s <= 0n || s >= p256Order)
    throw new Error("Invalid P256 signature");
  if (s > p256Order / 2n) s = p256Order - s;
  return concatHex([toHex(r, { size: 32 }), toHex(s, { size: 32 })]);
}

export function encodeParentSessionSignature({
  epoch,
  deviceKeyX,
  deviceKeyY,
  parentSignature,
  signature,
}) {
  if (
    ![deviceKeyX, deviceKeyY].every((key) => /^0x[0-9a-f]{64}$/i.test(key)) ||
    !/^0x(?:[0-9a-f]{2}){192,3932}$/i.test(parentSignature) ||
    BigInt(epoch) <= 0n
  )
    throw new Error("Invalid parent authorization grant");
  const encoded = concatHex([
    parentSessionPrefix,
    toHex(BigInt(epoch), { size: 32 }),
    deviceKeyX,
    deviceKeyY,
    normalizeP256Signature(signature),
    parentSignature,
  ]);
  decodeParentSessionSignature(encoded);
  return encoded;
}

export function decodeParentSessionSignature(encoded) {
  if (
    !/^0x[0-9a-f]+$/i.test(encoded) ||
    encoded.length % 2 !== 0 ||
    !encoded.startsWith(parentSessionPrefix) ||
    encoded.length < 714 ||
    encoded.length > 8194
  )
    throw new Error("Invalid parent authorization signature");
  const word = (index) =>
    `0x${encoded.slice(10 + index * 64, 74 + index * 64)}`;
  return {
    epoch: BigInt(word(0)),
    deviceKeyX: word(1),
    deviceKeyY: word(2),
    signature: concatHex([word(3), word(4)]),
    parentSignature: `0x${encoded.slice(330)}`,
  };
}

export function createParentSessionGasStub(grant) {
  return encodeParentSessionSignature({
    ...grant,
    signature: `0x${"11".repeat(64)}`,
  });
}
const authParameters = parseAbiParameters(
  "bytes32 r, bytes32 s, uint256 challengeIndex, uint256 typeIndex, bytes authenticatorData, string clientDataJSON",
);

export const passkeyGasChallenge = keccak256(
  stringToHex("Star Wallet passkey gas probe v1"),
);
export const maxPasskeyClientDataBytes = 1024;
export const maxPasskeyAuthenticatorDataBytes = 512;

/** Invalid signature with the maximum supported byte sizes. For estimation ONLY.
 * The validator short-circuits on its challenge; the backend measures the missing
 * full-validation cost separately using passkeyGasChallenge in a read-only probe.
 */
export function createPasskeyGasStub(rpId) {
  const challenge = btoa(
    String.fromCharCode(...hexToBytes(passkeyGasChallenge)),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const json = JSON.stringify({
    type: "webauthn.get",
    challenge,
    origin: `https://${rpId}`,
    padding: "",
  });
  const paddingBytes =
    maxPasskeyClientDataBytes - new TextEncoder().encode(json).length;
  if (paddingBytes < 0) throw new Error("Passkey RP ID is too long");
  const clientDataJSON = json.replace(
    '"padding":""',
    `"padding":"${" ".repeat(paddingBytes)}"`,
  );
  return encodeAbiParameters(authParameters, [
    `0x${"11".repeat(32)}`,
    `0x${"11".repeat(32)}`,
    BigInt(clientDataJSON.indexOf('"challenge"')),
    BigInt(clientDataJSON.indexOf('"type"')),
    `${sha256(stringToHex(rpId))}05${"ff".repeat(maxPasskeyAuthenticatorDataBytes - 33)}`,
    clientDataJSON,
  ]);
}

// Shared browser/integration codec for OpenZeppelin WebAuthn.tryDecodeAuth (flat ABI, not a tuple).
export function encodePasskeySignature({
  signature,
  authenticatorData,
  clientDataJSON,
  challengeIndex,
  typeIndex,
}) {
  if (
    !/^0x[0-9a-f]{128}$/i.test(signature) ||
    !/^0x(?:[0-9a-f]{2}){37,512}$/i.test(authenticatorData) ||
    new TextEncoder().encode(clientDataJSON).length >
      maxPasskeyClientDataBytes ||
    !Number.isSafeInteger(challengeIndex) ||
    challengeIndex < 0 ||
    !Number.isSafeInteger(typeIndex) ||
    typeIndex < 0
  )
    throw new Error("Invalid passkey assertion");
  const r = BigInt(`0x${signature.slice(2, 66)}`);
  let s = BigInt(`0x${signature.slice(66)}`);
  if (r <= 0n || r >= p256Order || s <= 0n || s >= p256Order)
    throw new Error("Invalid P256 signature");
  // Authenticators may return high-S signatures. OpenZeppelin intentionally accepts only low-S.
  if (s > p256Order / 2n) s = p256Order - s;
  return encodeAbiParameters(authParameters, [
    toHex(r, { size: 32 }),
    toHex(s, { size: 32 }),
    BigInt(challengeIndex),
    BigInt(typeIndex),
    authenticatorData,
    clientDataJSON,
  ]);
}
