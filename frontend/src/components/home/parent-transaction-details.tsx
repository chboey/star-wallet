"use client";

import type { Hash } from "viem";
import { sepolia } from "viem/chains";

/** Show completed transactions directly above the parent action/Done button. */
export function ParentTransactionDetails({
  hashes = [],
  completed,
}: {
  hashes?: readonly Hash[];
  completed: boolean;
}) {
  const transactions = hashes.filter(
    (hash, index) =>
      /^0x[\da-f]{64}$/i.test(hash) &&
      hashes.findIndex((item) => item.toLowerCase() === hash.toLowerCase()) ===
        index,
  );
  if (!completed || !transactions.length) return null;
  return (
    <div
      className="parent-transaction-details"
      aria-label="On-chain transactions"
    >
      {transactions.map((hash) => (
        <div className="parent-transaction-entry" key={hash}>
          <div className="parent-transaction-row">
            <p>
              Tx hash :{" "}
              <a
                className="parent-transaction-link"
                href={`${sepolia.blockExplorers.default.url}/tx/${hash}`}
                target="_blank"
                rel="noopener noreferrer"
                title={hash}
                aria-label={`View transaction ${hash} on Sepolia Etherscan (opens in a new tab)`}
              >
                <span className="parent-transaction-hash">
                  {hash.slice(0, 8)}....{hash.slice(-6)}
                </span>
              </a>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
