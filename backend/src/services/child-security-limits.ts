import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Config } from '../config.js';
import { HttpError, unavailable } from '../errors.js';
import type { ChildGasOperation } from './child-gas.js';

const hour = 3_600_000;
const day = 24 * hour;
type Reservation = { account: string; nonce: string; cost: string; seen: number };

export const childGasCaps = {
  callGasLimit: 1_000_000n,
  verificationGasLimit: 500_000n,
  preVerificationGas: 1_000_000n,
  paymasterVerificationGasLimit: 500_000n,
  paymasterPostOpGasLimit: 1_000_000n,
} as const;
export const childFeeCap = 100_000_000_000n;

/** Conservative maximum ETH gas liability, not a token amount or an actual gas bill.
 * Missing fields use the proxy caps rather than letting an incomplete quote reserve zero.
 * ERC-4337 v0.8 prefund includes both paymaster gas limits; unused-gas penalties fit within it.
 */
export function maximumSponsorshipCost(operation: ChildGasOperation): bigint {
  let gas = 0n;
  for (const [key, cap] of Object.entries(childGasCaps)) {
    const raw = operation[key as keyof typeof childGasCaps];
    const value = raw === undefined ? cap : BigInt(raw);
    if (value < 0n || value > cap) throw new Error('Invalid sponsorship gas limit');
    gas += value;
  }
  const fee = operation.maxFeePerGas === undefined ? childFeeCap : BigInt(operation.maxFeePerGas);
  if (fee < 0n || fee > childFeeCap) throw new Error('Invalid sponsorship fee');
  return gas * fee;
}

/** Persistent, atomic, server-owned limits. Never stores signatures, keys or family metadata.
 * Multiple processes on ONE host must share this file; distributed replicas need a shared
 * transactional store instead. SQLite is deliberately not an in-memory fallback on I/O failure.
 */
export class ChildSecurityLimits {
  private database?: DatabaseSync;
  constructor(
    private readonly settings: Config,
    private readonly now = Date.now,
  ) {}

  close() {
    this.database?.close();
    this.database = undefined;
  }

  private db() {
    if (this.database) return this.database;
    const path =
      this.settings.CHILD_SECURITY_DB_PATH ??
      (this.settings.NODE_ENV === 'test'
        ? ':memory:'
        : resolve(import.meta.dirname, '../../.security/child-limits.sqlite'));
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(path);
    try {
      database.exec(`
        PRAGMA busy_timeout = 1000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS child_security_requests (account TEXT NOT NULL, seen INTEGER NOT NULL) STRICT;
        CREATE INDEX IF NOT EXISTS child_security_requests_seen ON child_security_requests(seen);
        CREATE INDEX IF NOT EXISTS child_security_requests_account ON child_security_requests(account, seen);
        CREATE TABLE IF NOT EXISTS child_security_reservations (
          account TEXT NOT NULL, nonce TEXT NOT NULL, cost TEXT NOT NULL, seen INTEGER NOT NULL,
          PRIMARY KEY(account, nonce)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS child_security_reservations_seen ON child_security_reservations(seen);
      `);
      this.database = database;
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private atomic(work: (db: DatabaseSync, now: number) => void) {
    let database: DatabaseSync | undefined;
    let began = false;
    try {
      database = this.db();
      database.exec('BEGIN IMMEDIATE');
      began = true;
      work(database, this.now());
      database.exec('COMMIT');
      began = false;
    } catch (error) {
      if (began && database) {
        try {
          database.exec('ROLLBACK');
        } catch {
          // Discard a broken connection, never replace the durable file or reset its counters.
          this.close();
          throw unavailable(
            'CHILD_SECURITY_UNAVAILABLE',
            'Child request safety checks are temporarily unavailable. Please try again later.',
          );
        }
      }
      if (error instanceof HttpError) throw error;
      throw unavailable(
        'CHILD_SECURITY_UNAVAILABLE',
        'Child request safety checks are temporarily unavailable. Please try again later.',
      );
    }
  }

  /** Count every validated account RPC, not IPs/devices. Receipt polling is excluded by caller. */
  request(account: string) {
    const key = account.toLowerCase();
    this.atomic((db, now) => {
      db.prepare('DELETE FROM child_security_requests WHERE seen <= ?').run(now - hour);
      const counts = db
        .prepare(
          `SELECT COUNT(*) AS hourly,
        COALESCE(SUM(CASE WHEN seen > ? THEN 1 ELSE 0 END), 0) AS minute
        FROM child_security_requests WHERE account = ?`,
        )
        .get(now - 60_000, key)!;
      if (Number(counts.minute) >= this.settings.CHILD_RPC_PER_MINUTE)
        throw limited(
          'CHILD_REQUEST_RATE_LIMIT',
          'Too many child requests. Please wait a minute and try again.',
          60,
        );
      if (Number(counts.hourly) >= this.settings.CHILD_RPC_PER_HOUR)
        throw limited(
          'CHILD_REQUEST_RATE_LIMIT',
          'This child has made too many requests. Please try again later.',
          3600,
        );
      const global = db.prepare('SELECT COUNT(*) AS count FROM child_security_requests').get()!;
      if (Number(global.count) >= 10_000)
        throw limited(
          'CHILD_SERVICE_RATE_LIMIT',
          'Child requests are temporarily busy. Please try again later.',
          3600,
        );
      db.prepare('INSERT INTO child_security_requests (account, seen) VALUES (?, ?)').run(key, now);
    });
  }

  /** Reserve BEFORE returning any potentially usable paymaster data (including stub/isFinal).
   * One EntryPoint account+nonce can execute only once. Requotes/retries share its largest
   * reservation, with a rolling retention period renewed on every issue. No refund on failure:
   * a signed quote might already be in flight or submitted via a different bundler.
   */
  reserve(account: string, nonce: string, cost: bigint) {
    if (cost < 0n) throw new Error('Negative sponsorship reservation');
    const key = account.toLowerCase();
    const canonicalNonce = BigInt(nonce).toString();
    this.atomic((db, now) => {
      db.prepare('DELETE FROM child_security_reservations WHERE seen <= ?').run(now - day);
      const rows = db
        .prepare('SELECT account, nonce, cost, seen FROM child_security_reservations')
        .all() as Reservation[];
      const own = rows.filter((row) => row.account === key);
      const previous = own.find((row) => row.nonce === canonicalNonce);
      const oldCost = previous ? BigInt(previous.cost) : 0n;
      const reservedCost = cost > oldCost ? cost : oldCost;
      const extra = reservedCost - oldCost;
      const sum = (entries: Reservation[]) =>
        entries.reduce((total, row) => total + BigInt(row.cost), 0n);
      if (
        (!previous && own.length >= this.settings.CHILD_SPONSORED_OPERATIONS_PER_DAY) ||
        sum(own) + extra > this.settings.CHILD_SPONSOR_BUDGET_WEI_PER_DAY
      )
        throw limited(
          'CHILD_SPONSORSHIP_LIMIT',
          'This child has reached the sponsored request allowance. Please try again later; parent approval is still valid.',
          86_400,
        );
      if (
        (!previous && rows.length >= this.settings.CHILD_GLOBAL_SPONSORED_OPERATIONS_PER_DAY) ||
        sum(rows) + extra > this.settings.CHILD_GLOBAL_SPONSOR_BUDGET_WEI_PER_DAY
      )
        throw limited(
          'CHILD_SPONSORSHIP_BUDGET',
          'Sponsored child requests are temporarily at their safety limit. Please try again later.',
          86_400,
        );
      db.prepare(
        `INSERT INTO child_security_reservations (account, nonce, cost, seen) VALUES (?, ?, ?, ?)
        ON CONFLICT(account, nonce) DO UPDATE SET cost = excluded.cost, seen = excluded.seen`,
      ).run(key, canonicalNonce, reservedCost.toString(), now);
    });
  }
}

function limited(code: string, message: string, retryAfterSeconds: number) {
  return new HttpError(429, code, message, { retryAfterSeconds });
}
