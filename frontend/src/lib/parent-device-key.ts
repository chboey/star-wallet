import { hexToBytes, toHex, type Address, type Hex } from "viem";
import {
  normalizeP256Signature,
  type ParentDeviceGrant,
} from "@star/contracts/child-account";

export type AuthorizedDevice = ParentDeviceGrant & {
  version: 1;
  account: Address;
  privateKey: CryptoKey;
};

export async function createDeviceKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const publicKey = toHex(
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  );
  return {
    privateKey: pair.privateKey,
    deviceKeyX: `0x${publicKey.slice(4, 68)}` as Hex,
    deviceKeyY: `0x${publicKey.slice(68)}` as Hex,
  };
}

export async function signWithDevice(
  device: Pick<AuthorizedDevice, "privateKey">,
  hash: Hex,
) {
  if (
    device.privateKey.extractable ||
    device.privateKey.type !== "private" ||
    device.privateKey.algorithm.name !== "ECDSA" ||
    (device.privateKey.algorithm as EcKeyAlgorithm).namedCurve !== "P-256"
  )
    throw new Error(
      "This device authorization is invalid. Ask your parent to approve again.",
    );
  const result = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    device.privateKey,
    new Uint8Array(hexToBytes(hash)),
  );
  return normalizeP256Signature(toHex(new Uint8Array(result)));
}

export async function verifyDeviceKey(
  device: Pick<AuthorizedDevice, "privateKey" | "deviceKeyX" | "deviceKeyY">,
  hash: Hex,
) {
  const signature = await signWithDevice(device, hash);
  const publicKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(
      hexToBytes(
        `0x04${device.deviceKeyX.slice(2)}${device.deviceKeyY.slice(2)}`,
      ),
    ),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      new Uint8Array(hexToBytes(signature)),
      new Uint8Array(hexToBytes(hash)),
    ))
  )
    throw new Error(
      "This device key is no longer available. Ask your parent to approve again.",
    );
}

export interface DeviceAuthorizationStore {
  read(account: Address): Promise<AuthorizedDevice | null>;
  save(device: AuthorizedDevice): Promise<void>;
  remove(account: Address): Promise<void>;
}

/** IndexedDB structured-clones a non-exportable CryptoKey; no private key string or cookie. */
export const deviceAuthorizationStore: DeviceAuthorizationStore = {
  read: (account) =>
    accessStore("readonly", (store) => store.get(account.toLowerCase())),
  save: async (device) => {
    await accessStore("readwrite", (store) =>
      store.put(device, device.account.toLowerCase()),
    );
  },
  remove: async (account) => {
    await accessStore("readwrite", (store) =>
      store.delete(account.toLowerCase()),
    );
  },
};

async function accessStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      settled = true;
      reject(new Error(message));
    };
    // Origin-isolated database; the network is part of its name.
    let opening: IDBOpenDBRequest;
    try {
      opening = indexedDB.open("star-parent-authorizations:11155111:v1", 1);
    } catch {
      fail("Allow device storage to remember your parent's approval.");
      return;
    }
    opening.onupgradeneeded = () => opening.result.createObjectStore("devices");
    opening.onerror = () =>
      fail("Allow device storage to remember your parent's approval.");
    opening.onblocked = () =>
      fail("Close other Star Wallet tabs and try again.");
    opening.onsuccess = () => {
      const database = opening.result;
      if (settled) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      try {
        const transaction = database.transaction("devices", mode);
        transaction.onabort = transaction.onerror = () => {
          database.close();
          fail(
            "Unable to save or read this device's authorization. Check browser storage.",
          );
        };
        const request = action(transaction.objectStore("devices"));
        transaction.oncomplete = () => {
          database.close();
          if (!settled) {
            settled = true;
            resolve(request.result ?? (null as T));
          }
        };
      } catch {
        database.close();
        fail(
          "This browser could not store the device key. Try a browser that supports persistent device authorization.",
        );
      }
    };
  });
}
