import { toHex } from "viem";

// Reuse the identifier after an unknown transaction outcome so retries cannot reward twice.
export function submissionId(
  key: string,
  storage: Pick<Storage, "getItem" | "setItem"> = sessionStorage,
): `0x${string}` {
  const saved = storage.getItem(key);
  if (saved && /^0x[0-9a-f]{64}$/.test(saved)) return saved as `0x${string}`;
  const id = toHex(crypto.getRandomValues(new Uint8Array(32)));
  storage.setItem(key, id);
  return id;
}
