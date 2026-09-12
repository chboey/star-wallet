import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { maxUint256 } from 'viem';
import { assertVaultAquaAllowance } from '../src/services/protocol.js';

test('unpaused vaults resolve after Aqua spends USDC or WETH allowances', () => {
  for (const token of ['USDC', 'WETH']) {
    for (const allowance of [
      maxUint256,
      maxUint256 - 2_000_000n,
      maxUint256 - 10n ** 18n,
      1n,
      0n,
    ]) {
      assert.doesNotThrow(() =>
        assertVaultAquaAllowance(`vault ${token} Aqua allowance`, allowance, false),
      );
    }
  }
});

test('paused vaults still require both token allowances to be zero', () => {
  for (const token of ['USDC', 'WETH']) {
    const name = `vault ${token} Aqua allowance`;
    assert.doesNotThrow(() => assertVaultAquaAllowance(name, 0n, true));
    for (const allowance of [1n, maxUint256 - 2_000_000n, maxUint256]) {
      assert.throws(() => assertVaultAquaAllowance(name, allowance, true), /expected 0/);
    }
  }
});

test('malformed allowance reads fail closed, paused or unpaused', () => {
  for (const paused of [false, true]) {
    for (const value of [undefined, null, false, '0', 0, -1n, maxUint256 + 1n]) {
      assert.throws(() => assertVaultAquaAllowance('allowance', value, paused), /valid uint256/);
    }
  }
});

test('family vault verification applies the spendable allowance check to both tokens', () => {
  const source = readFileSync(new URL('../src/services/protocol.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /assertVaultAquaAllowance\('vault USDC Aqua allowance', usdcAquaAllowance, aquaPaused\)/,
  );
  assert.match(
    source,
    /assertVaultAquaAllowance\('vault WETH Aqua allowance', wethAquaAllowance, aquaPaused\)/,
  );
  assert.doesNotMatch(source, /const expectedAllowance = aquaPaused/);
});
