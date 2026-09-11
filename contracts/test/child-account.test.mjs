import assert from "node:assert/strict";
import test from "node:test";
import { decodeAbiParameters, parseAbiParameters, toHex } from "viem";
import {
  encodePasskeySignature,
  createPasskeyGasStub,
  passkeyGasChallenge,
  encodeParentSessionSignature,
  decodeParentSessionSignature,
  createParentSessionGasStub,
  parentAuthorizationDigest,
  decodeChildCall,
} from "../child-account.js";
import { sha256, stringToHex } from "viem";
import { encodeFunctionData } from "viem";
import { childAccountAbi } from "../abi/index.js";

test("goal contribution calls pin both integer arguments and reject extra calldata or zero amounts", () => {
  const data = encodeFunctionData({
    abi: childAccountAbi,
    functionName: "addStarsToGoal",
    args: [7n, 5n],
  });
  assert.deepEqual(decodeChildCall(data), {
    functionName: "addStarsToGoal",
    args: [7n, 5n],
  });
  assert.throws(
    () => decodeChildCall(`${data}${"00".repeat(32)}`),
    /Noncanonical/,
  );
  for (const args of [
    [0n, 5n],
    [7n, 0n],
  ])
    assert.throws(
      () =>
        decodeChildCall(
          encodeFunctionData({
            abi: childAccountAbi,
            functionName: "addStarsToGoal",
            args,
          }),
        ),
      /Invalid goal contribution/,
    );
});

test("parent device grant codec preserves the signed permission and cannot encode control calls", () => {
  const grant = {
    epoch: 3n,
    deviceKeyX: `0x${"ab".repeat(32)}`,
    deviceKeyY: `0x${"cd".repeat(32)}`,
    parentSignature: createPasskeyGasStub("localhost"),
  };
  const stub = createParentSessionGasStub(grant);
  const decoded = decodeParentSessionSignature(stub);
  assert.equal(stub.slice(0, 10), "0x53575031");
  assert.deepEqual(
    { ...decoded, signature: undefined },
    { ...grant, signature: undefined },
  );
  assert.equal(encodeParentSessionSignature(decoded), stub);
  for (const encoded of [
    "0x53575031",
    `${stub}z`,
    stub.slice(0, -1),
    `0x${"11".repeat(5000)}`,
  ])
    assert.throws(() => decodeParentSessionSignature(encoded));
  for (const change of [
    { deviceKeyX: "0x01" },
    { epoch: 0n },
    { parentSignature: "0x" },
  ])
    assert.throws(() => createParentSessionGasStub({ ...grant, ...change }));
  for (const data of [
    encodeFunctionData({
      abi: childAccountAbi,
      functionName: "configureParentPasskey",
      args: [grant.deviceKeyX, grant.deviceKeyY, "papa"],
    }),
    encodeFunctionData({
      abi: childAccountAbi,
      functionName: "revokeParentAuthorizations",
    }),
  ])
    assert.throws(() => decodeChildCall(data), /Unsupported child call/);
  const digest = parentAuthorizationDigest({
    ...grant,
    account: "0x1111111111111111111111111111111111111111",
    familyId: 1n,
    chainId: 11155111,
  });
  assert.match(digest, /^0x[0-9a-f]{64}$/);
});

test("WebAuthn codec normalizes authenticator high-S and matches flat Solidity ABI", () => {
  const order =
    0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const input = {
    signature: `${toHex(1n, { size: 32 })}${toHex(order - 1n, { size: 32 }).slice(2)}`,
    authenticatorData: `0x${"ab".repeat(37)}`,
    clientDataJSON: "{}",
    challengeIndex: 23,
    typeIndex: 1,
  };
  const values = decodeAbiParameters(
    parseAbiParameters("bytes32,bytes32,uint256,uint256,bytes,string"),
    encodePasskeySignature(input),
  );
  assert.equal(values[1], toHex(1n, { size: 32 }));
  assert.equal(values[2], 23n);
  assert.equal(values[4], input.authenticatorData);
  for (const change of [
    { signature: "0x" },
    { signature: `0x${"00".repeat(64)}` },
    { challengeIndex: -1 },
    { authenticatorData: "0x" },
  ])
    assert.throws(() => encodePasskeySignature({ ...input, ...change }));
});

test("gas stub bounds both WebAuthn byte arrays and uses a nonzero RP-bound full-path probe challenge", () => {
  for (const rp of ["localhost", "wallet.example.com"]) {
    const [r, s, challengeIndex, typeIndex, auth, json] = decodeAbiParameters(
      parseAbiParameters("bytes32,bytes32,uint256,uint256,bytes,string"),
      createPasskeyGasStub(rp),
    );
    assert.equal((auth.length - 2) / 2, 512);
    assert.equal(auth.slice(0, 66), sha256(stringToHex(rp)));
    assert.equal(auth.slice(66, 68), "05");
    assert.equal(new TextEncoder().encode(json).length, 1024);
    assert.equal(Number(challengeIndex), json.indexOf('"challenge"'));
    assert.equal(Number(typeIndex), json.indexOf('"type"'));
    assert.equal(
      JSON.parse(json).challenge,
      Buffer.from(passkeyGasChallenge.slice(2), "hex").toString("base64url"),
    );
    assert.ok(BigInt(r) > 0n && BigInt(s) > 0n);
  }
});
