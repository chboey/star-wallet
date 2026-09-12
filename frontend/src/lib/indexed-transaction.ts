import { starApi, type IndexingMetadata } from "./star-api";

/** A short, bounded check only after a confirmed transaction; never idle polling. */
export async function waitForIndexedBlock(
  receiptBlock: bigint,
  read: () => Promise<IndexingMetadata> = () => starApi.indexingStatus(),
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  for (const delay of [0, 2_000, 4_000, 8_000]) {
    if (delay) await pause(delay);
    try {
      const status = await read();
      if (BigInt(status.block.number) >= receiptBlock) return true;
    } catch {
      // Rate limits/outages end this check. Keep the transaction confirmed and
      // let the next page entry or deliberate Retry fetch its indexed result.
      return false;
    }
  }
  return false;
}
