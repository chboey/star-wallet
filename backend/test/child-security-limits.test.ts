import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import {
  ChildSecurityLimits,
  maximumSponsorshipCost,
  childGasCaps,
  childFeeCap,
} from '../src/services/child-security-limits.js';

const settings = (extra: NodeJS.ProcessEnv = {}) =>
  loadConfig({
    NODE_ENV: 'test',
    CHILD_RPC_PER_MINUTE: '10',
    CHILD_RPC_PER_HOUR: '10',
    CHILD_SPONSORED_OPERATIONS_PER_DAY: '2',
    CHILD_GLOBAL_SPONSORED_OPERATIONS_PER_DAY: '3',
    CHILD_SPONSOR_BUDGET_WEI_PER_DAY: '100',
    CHILD_GLOBAL_SPONSOR_BUDGET_WEI_PER_DAY: '150',
    ...extra,
  });

test('rate limits are account-scoped, case insensitive and rolling; another child is unaffected', (t) => {
  let now = 10_000_000;
  const limits = new ChildSecurityLimits(settings(), () => now);
  t.after(() => limits.close());
  for (let i = 0; i < 10; i++) limits.request('0xAbC');
  assert.throws(() => limits.request('0xabc'), {
    statusCode: 429,
    code: 'CHILD_REQUEST_RATE_LIMIT',
  });
  limits.request('0xDEF');
  now += 60_001;
  assert.throws(() => limits.request('0xabc'), { code: 'CHILD_REQUEST_RATE_LIMIT' });
  now += 3_600_000;
  limits.request('0xabc');
});

test('stub, final quote and send retries share one nonce reservation at its highest cost', (t) => {
  const limits = new ChildSecurityLimits(settings());
  t.after(() => limits.close());
  limits.reserve('0xAbC', '0x0', 20n);
  limits.reserve('0xabc', '0x00', 40n);
  limits.reserve('0xabc', '0x0', 10n);
  limits.reserve('0xabc', '0x1', 60n);
  assert.throws(() => limits.reserve('0xabc', '0x1', 61n), { code: 'CHILD_SPONSORSHIP_LIMIT' });
  assert.throws(() => limits.reserve('0xabc', '0x2', 0n), { code: 'CHILD_SPONSORSHIP_LIMIT' });
  // Denied increases roll back, and repeated sends are not double-charged.
  limits.reserve('0xabc', '0x1', 60n);
});

test('global spend and operation-count budgets cover all accounts', (t) => {
  const limits = new ChildSecurityLimits(settings());
  t.after(() => limits.close());
  limits.reserve('a', '0x0', 100n);
  assert.throws(() => limits.reserve('b', '0x0', 51n), { code: 'CHILD_SPONSORSHIP_BUDGET' });
  limits.reserve('b', '0x0', 50n);
  limits.reserve('c', '0x0', 0n);
  assert.throws(() => limits.reserve('d', '0x0', 0n), { code: 'CHILD_SPONSORSHIP_BUDGET' });
});

test('budget retention renews on a retry; midnight, reconnects and new device keys do not reset it', (t) => {
  let now = 86_399_000;
  const limits = new ChildSecurityLimits(settings(), () => now);
  t.after(() => limits.close());
  limits.reserve('a', '0x0', 100n);
  now += 2_000;
  assert.throws(() => limits.reserve('a', '0x1', 1n), { code: 'CHILD_SPONSORSHIP_LIMIT' });
  now += 86_000_000;
  limits.reserve('a', '0x0', 1n);
  now += 400_000;
  assert.throws(() => limits.reserve('a', '0x1', 1n), { code: 'CHILD_SPONSORSHIP_LIMIT' });
  now += 86_400_001;
  limits.reserve('a', '0x1', 100n);
});

test('counters survive restart and two connections cannot independently spend the same budget', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'star-security-test-'));
  const config = settings({ CHILD_SECURITY_DB_PATH: join(directory, 'limits.sqlite') });
  const one = new ChildSecurityLimits(config);
  const two = new ChildSecurityLimits(config);
  t.after(() => {
    one.close();
    two.close();
    rmSync(directory, { recursive: true });
  });
  one.reserve('a', '0x0', 75n);
  assert.throws(() => two.reserve('a', '0x1', 26n), { code: 'CHILD_SPONSORSHIP_LIMIT' });
  two.reserve('a', '0x1', 25n);
  for (let i = 0; i < 10; i++) one.request('a');
  one.close();
  assert.throws(() => two.request('a'), { code: 'CHILD_REQUEST_RATE_LIMIT' });
  assert.throws(() => one.reserve('a', '0x2', 1n), { code: 'CHILD_SPONSORSHIP_LIMIT' });
});

test('failed durable storage never falls back to an empty in-memory allowance', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'star-security-unavailable-'));
  t.after(() => rmSync(directory, { recursive: true }));
  const limits = new ChildSecurityLimits(settings({ CHILD_SECURITY_DB_PATH: directory }));
  t.after(() => limits.close());
  assert.throws(() => limits.request('a'), { statusCode: 503, code: 'CHILD_SECURITY_UNAVAILABLE' });
  assert.throws(() => limits.reserve('a', '0x0', 1n), { code: 'CHILD_SECURITY_UNAVAILABLE' });
});

test('cost includes all five gas fields and missing fields cannot imply free sponsorship', () => {
  const operation = {
    sender: '0x0000000000000000000000000000000000001234',
    nonce: '0x0',
    callData: '0x',
  } as const;
  assert.equal(
    maximumSponsorshipCost(operation),
    Object.values(childGasCaps).reduce((a, b) => a + b, 0n) * childFeeCap,
  );
  assert.equal(
    maximumSponsorshipCost({
      ...operation,
      callGasLimit: '0x1',
      verificationGasLimit: '0x2',
      preVerificationGas: '0x3',
      paymasterVerificationGasLimit: '0x4',
      paymasterPostOpGasLimit: '0x5',
      maxFeePerGas: '0x6',
    }),
    90n,
  );
  assert.throws(() => maximumSponsorshipCost({ ...operation, callGasLimit: '-1' }));
  assert.throws(() => maximumSponsorshipCost({ ...operation, maxFeePerGas: '0xffffffffffff' }));
});

test('production requires durable storage and refuses invalid or unbounded budgets', () => {
  assert.throws(
    () => settings({ NODE_ENV: 'production', CHILD_PAYMASTER_POLICY_ID: 'policy' }),
    /persistent local volume/,
  );
  assert.throws(
    () => settings({ NODE_ENV: 'development', CHILD_SECURITY_DB_PATH: ':memory:' }),
    /persist/,
  );
  for (const value of ['0', '-1', '1000000000000000001', 'not-a-number']) {
    assert.throws(() => settings({ CHILD_SPONSOR_BUDGET_WEI_PER_DAY: value }));
  }
  assert.throws(() => settings({ CHILD_SPONSOR_BUDGET_WEI_PER_DAY: '200' }), /global budget/);
});
