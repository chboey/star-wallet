import {
  decodeChildCall,
  encodePasskeySignature,
  createPasskeyGasStub,
  maxPasskeyClientDataBytes,
  maxPasskeyAuthenticatorDataBytes,
  encodeParentSessionSignature,
  createParentSessionGasStub,
} from "@star/contracts/child-account";
import { createPublicClient, getAddress, http } from "viem";
import { sepolia } from "viem/chains";
import {
  createBundlerClient,
  createWebAuthnCredential,
  entryPoint08Abi,
  entryPoint08Address,
  getUserOperationHash,
  toSmartAccount,
  toWebAuthnAccount,
} from "viem/account-abstraction";
import {
  starApi,
  type ChildCredential,
  type TransactionIntent,
} from "./star-api";
import { sepoliaTransport } from "./wagmi";
import { estimateChildOperationFees } from "./child-operation-fees";
import { signWithDevice, type AuthorizedDevice } from "./parent-device-key";
import type { ParentAuthorizationScope } from "./parent-authorization";

export function checkPasskeyOrigin(rpId: string) {
  if (!window.isSecureContext || window.location.hostname !== rpId)
    throw new Error(
      `Open Star Wallet securely on ${rpId}. Passkeys cannot move between app hostnames.`,
    );
  if (!window.PublicKeyCredential)
    throw new Error("This browser does not support passkeys.");
}

export async function createChildCredential(
  name: string,
  rpId: string,
): Promise<ChildCredential> {
  checkPasskeyOrigin(rpId);
  const credential = await createWebAuthnCredential({
    name,
    rp: { id: rpId, name: "Star Wallet" },
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
  });
  return { id: credential.id, publicKey: credential.publicKey };
}

/** Sends a child-authorized UserOperation. Never uses the connected parent's wallet. */
export async function sendChildIntent(
  intent: TransactionIntent,
  authorize?: (scope: ParentAuthorizationScope) => Promise<AuthorizedDevice>,
): Promise<bigint> {
  if (
    intent.chainId !== sepolia.id ||
    intent.signerRole !== "CHILD" ||
    BigInt(intent.value) !== 0n
  )
    throw new Error("Invalid child operation.");
  decodeChildCall(intent.data);
  const [config, metadata] = await Promise.all([
    starApi.childAccountConfig(),
    starApi.childAccount(intent.to),
  ]);
  checkPasskeyOrigin(config.rpId);
  if (!config.sponsorshipConfigured)
    throw new Error(
      "Child gas sponsorship is not configured yet. Ask the parent to finish app setup.",
    );
  if (
    config.chainId !== sepolia.id ||
    getAddress(config.entryPoint) !== getAddress(entryPoint08Address) ||
    getAddress(metadata.wallet) !== getAddress(intent.to) ||
    metadata.rpId !== config.rpId
  )
    throw new Error(
      "Child account configuration does not match this deployment.",
    );
  const client = createPublicClient({
    chain: sepolia,
    transport: sepoliaTransport,
  });
  const device = authorize
    ? await authorize({
        account: intent.to,
        familyId: BigInt(metadata.familyId),
        rpId: config.rpId,
        client,
      })
    : undefined;
  const account = await toSmartAccount({
    client,
    entryPoint: {
      address: entryPoint08Address,
      abi: entryPoint08Abi,
      version: "0.8",
    },
    getAddress: async () => intent.to,
    getFactoryArgs: async () => ({}), // Already deployed by the parent during onboarding.
    getNonce: () =>
      client.readContract({
        address: entryPoint08Address,
        abi: entryPoint08Abi,
        functionName: "getNonce",
        args: [intent.to, 0n],
      }),
    encodeCalls: async () => {
      throw new Error("Arbitrary calls are disabled for child accounts.");
    },
    signMessage: async () => {
      throw new Error("Arbitrary signatures are disabled for child accounts.");
    },
    signTypedData: async () => {
      throw new Error("Arbitrary signatures are disabled for child accounts.");
    },
    getStubSignature: async () =>
      device
        ? createParentSessionGasStub(device)
        : createPasskeyGasStub(config.rpId),
    async signUserOperation(operation) {
      const hash = getUserOperationHash({
        chainId: sepolia.id,
        entryPointAddress: entryPoint08Address,
        entryPointVersion: "0.8",
        userOperation: { ...operation, sender: intent.to },
      });
      if (device)
        return encodeParentSessionSignature({
          ...device,
          signature: await signWithDevice(device, hash),
        });
      return signPasskeyHash(metadata.credential, config.rpId, hash);
    },
  });
  const bundler = createBundlerClient({
    account,
    client,
    chain: sepolia,
    transport: http("/api/star/child-accounts/rpc", {
      retryCount: 0,
      timeout: 18_000,
    }),
    paymaster: true,
    userOperation: {
      estimateFeesPerGas: ({ bundlerClient }) =>
        estimateChildOperationFees(client, bundlerClient),
    },
  });
  const hash = await bundler.sendUserOperation({ callData: intent.data });
  const receipt = await bundler.waitForUserOperationReceipt({
    hash,
    timeout: 0,
    pollingInterval: 3_000,
  });
  if (!receipt.success)
    throw new Error(
      "The child request reverted. No success has been recorded.",
    );
  return receipt.receipt.blockNumber;
}

export async function signPasskeyHash(
  credential: ChildCredential,
  rpId: string,
  hash: `0x${string}`,
) {
  checkPasskeyOrigin(rpId);
  const signer = toWebAuthnAccount({ credential, rpId });
  const { signature, webauthn } = await signer.sign({ hash });
  if (webauthn.challengeIndex === undefined || webauthn.typeIndex === undefined)
    throw new Error("Invalid passkey metadata.");
  const clientData = JSON.parse(webauthn.clientDataJSON) as {
    origin?: unknown;
    crossOrigin?: unknown;
  };
  if (
    clientData.origin !== window.location.origin ||
    clientData.crossOrigin === true ||
    new TextEncoder().encode(webauthn.clientDataJSON).length >
      maxPasskeyClientDataBytes ||
    webauthn.authenticatorData.length > 2 + maxPasskeyAuthenticatorDataBytes * 2
  )
    throw new Error("Unexpected passkey authentication response.");
  return encodePasskeySignature({
    signature,
    ...webauthn,
    challengeIndex: webauthn.challengeIndex,
    typeIndex: webauthn.typeIndex,
  });
}
