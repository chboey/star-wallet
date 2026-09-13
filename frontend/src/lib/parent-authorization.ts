import { childAccountAbi } from "@star/contracts/abi";
import {
  parentAuthorizationDigest,
  createParentSessionGasStub,
} from "@star/contracts/child-account";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  type Address,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import { checkPasskeyOrigin, signPasskeyHash } from "./child-account";
import type { ChildCredential } from "./star-api";
import {
  createDeviceKey,
  deviceAuthorizationStore,
  verifyDeviceKey,
  type AuthorizedDevice,
  type DeviceAuthorizationStore,
} from "./parent-device-key";

type AuthorizationClient = Pick<
  PublicClient,
  "getChainId" | "readContract" | "getBlockNumber"
>;
export type ParentAuthorizationScope = {
  account: Address;
  familyId: bigint;
  rpId: string;
  client: AuthorizationClient;
};

export async function readParentAuthorization(
  client: AuthorizationClient,
  account: Address,
) {
  if ((await client.getChainId()) !== sepolia.id)
    throw new Error("Open the Ethereum Sepolia account.");
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  try {
    const version = await client.readContract({
      address: account,
      abi: childAccountAbi,
      functionName: "parentAuthorizationVersion",
      blockNumber,
    });
    if (version !== 1n) return { supported: false } as const;
  } catch (error) {
    if (error instanceof BaseError) {
      const cause = error.walk(
        (item) =>
          item instanceof ContractFunctionRevertedError ||
          item instanceof ContractFunctionZeroDataError,
      );
      if (
        cause instanceof ContractFunctionRevertedError ||
        cause instanceof ContractFunctionZeroDataError
      )
        return { supported: false } as const;
    }
    throw error;
  }
  const [epoch, id, x, y] = await Promise.all([
    client.readContract({
      address: account,
      abi: childAccountAbi,
      functionName: "parentAuthorizationEpoch",
      blockNumber,
    }),
    client.readContract({
      address: account,
      abi: childAccountAbi,
      functionName: "parentCredentialId",
      blockNumber,
    }),
    client.readContract({
      address: account,
      abi: childAccountAbi,
      functionName: "parentPublicKeyX",
      blockNumber,
    }),
    client.readContract({
      address: account,
      abi: childAccountAbi,
      functionName: "parentPublicKeyY",
      blockNumber,
    }),
  ]);
  return {
    supported: true,
    epoch,
    credential: { id, publicKey: `${x}${y.slice(2)}` as `0x${string}` },
  } as const;
}

/** Recheck live enrollment before setup; never replace an existing parent passkey. */
export async function prepareParentPasskeySetup(
  client: AuthorizationClient,
  account: Address,
  createCredential: () => Promise<ChildCredential>,
) {
  const state = await readParentAuthorization(client, account);
  if (!state.supported)
    throw new Error("Parent authorization is not supported by this account.");
  return {
    state,
    credential: state.credential.id ? null : await createCredential(),
  };
}

/** Live contract validation, never a timer, cached PIN result, or local "approved" flag. */
export async function isDeviceAuthorized(
  scope: ParentAuthorizationScope,
  device: AuthorizedDevice,
) {
  if (
    device.version !== 1 ||
    typeof device.account !== "string" ||
    device.account.toLowerCase() !== scope.account.toLowerCase()
  )
    return false;
  return scope.client.readContract({
    address: scope.account,
    abi: childAccountAbi,
    functionName: "isParentAuthorizationValid",
    args: [
      device.deviceKeyX,
      device.deviceKeyY,
      device.epoch,
      device.parentSignature,
    ],
  });
}

export async function requireParentAuthorization(
  scope: ParentAuthorizationScope,
  requestAttention: (
    authenticate: () => Promise<AuthorizedDevice>,
  ) => Promise<AuthorizedDevice>,
  signal: AbortSignal,
  dependencies: {
    store?: DeviceAuthorizationStore;
    signPasskey?: typeof signPasskeyHash;
  } = {},
): Promise<AuthorizedDevice> {
  const { store = deviceAuthorizationStore, signPasskey = signPasskeyHash } =
    dependencies;
  signal.throwIfAborted();
  checkPasskeyOrigin(scope.rpId);
  const state = await readParentAuthorization(scope.client, scope.account);
  if (!state.supported)
    throw new Error(
      "Parent authorization needs the new child-account deployment. This account has not been migrated yet.",
    );
  if (!state.credential.id)
    throw new Error(
      "Ask your parent to set up Parent authorization in their profile first.",
    );
  const saved = await store.read(scope.account);
  if (saved) {
    let keyWorks = false;
    try {
      createParentSessionGasStub(saved);
      await verifyDeviceKey(
        saved,
        parentAuthorizationDigest({
          ...scope,
          chainId: sepolia.id,
          epoch: saved.epoch,
          deviceKeyX: saved.deviceKeyX,
          deviceKeyY: saved.deviceKeyY,
        }),
      );
      keyWorks = true;
    } catch {
      /* Missing or unusable device key requires fresh approval, not a fallback passkey. */
    }
    if (keyWorks && (await isDeviceAuthorized(scope, saved))) {
      signal.throwIfAborted();
      return saved;
    }
    await store.remove(scope.account);
  }
  signal.throwIfAborted();
  return requestAttention(async () => {
    signal.throwIfAborted();
    // Read again after the PIN: Papa may have revoked or rotated while this popup was open.
    const current = await readParentAuthorization(scope.client, scope.account);
    if (!current.supported || !current.credential.id)
      throw new Error("Parent authorization is not configured.");
    const key = await createDeviceKey();
    const digest = parentAuthorizationDigest({
      ...scope,
      ...key,
      chainId: sepolia.id,
      epoch: current.epoch,
    });
    signal.throwIfAborted();
    const parentSignature = await signPasskey(
      current.credential,
      scope.rpId,
      digest,
    );
    signal.throwIfAborted();
    const device: AuthorizedDevice = {
      ...key,
      version: 1,
      account: scope.account,
      epoch: current.epoch,
      parentSignature,
    };
    if (!(await isDeviceAuthorized(scope, device)))
      throw new Error(
        "Parent approval could not be verified. No device access was granted.",
      );
    signal.throwIfAborted();
    await store.save(device);
    // Fail before any transaction if the browser could not persist the non-exportable key.
    const persisted = await store.read(scope.account);
    if (!persisted)
      throw new Error(
        "This browser could not remember the approval. Please allow device storage.",
      );
    await verifyDeviceKey(persisted, digest);
    if (signal.aborted) {
      if (persisted.parentSignature === parentSignature)
        await store.remove(scope.account);
      signal.throwIfAborted();
    }
    return persisted;
  });
}
