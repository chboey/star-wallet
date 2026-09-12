import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import test from 'node:test';
import { loadConfig, protocolAddresses } from '../src/config.js';

const manifest = fileURLToPath(new URL('./fixtures/empty-deployment.json', import.meta.url));

test('the backend example parses and has no implicit legacy Aqua deployment', () => {
  const example = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));
  const settings = loadConfig({ ...example, DEPLOYMENT_FILE: manifest });
  assert.equal(settings.HOST, '127.0.0.1');
  assert.equal(settings.PORT, 3000);
  assert.equal(settings.CHAIN_ID, 11155111);
  assert.equal(settings.AQUA_ADDRESS, undefined);
  assert.equal(settings.AQUA_SWAP_VM_ADDRESS, undefined);
  assert.throws(() => protocolAddresses(settings), /AQUA_ADDRESS, AQUA_SWAP_VM_ADDRESS/);
});

test('blank and absent Aqua fields both remain unconfigured', () => {
  for (const value of ['', '   ', undefined]) {
    const settings = loadConfig({
      DEPLOYMENT_FILE: manifest,
      AQUA_ADDRESS: value,
      AQUA_SWAP_VM_ADDRESS: value,
    });
    assert.equal(settings.AQUA_ADDRESS, undefined);
    assert.equal(settings.AQUA_SWAP_VM_ADDRESS, undefined);
  }
});

test('paymaster policy configuration trims IDs and rejects malformed values', () => {
  assert.equal(
    loadConfig({ DEPLOYMENT_FILE: manifest, CHILD_PAYMASTER_POLICY_ID: '  policy-123_abc  ' })
      .CHILD_PAYMASTER_POLICY_ID,
    'policy-123_abc',
  );
  for (const value of ['', '   ', undefined])
    assert.equal(
      loadConfig({ DEPLOYMENT_FILE: manifest, CHILD_PAYMASTER_POLICY_ID: value })
        .CHILD_PAYMASTER_POLICY_ID,
      undefined,
    );
  for (const value of ['policy with spaces', '{"policyId":"other"}', 'x'.repeat(129)])
    assert.throws(() =>
      loadConfig({ DEPLOYMENT_FILE: manifest, CHILD_PAYMASTER_POLICY_ID: value }),
    );
});

test('explicit deployment addresses are retained and unsupported chain switches still fail closed', () => {
  const settings = loadConfig({
    DEPLOYMENT_FILE: manifest,
    AQUA_ADDRESS: '0x0000000000000000000000000000000000001234',
    AQUA_SWAP_VM_ADDRESS: '0x0000000000000000000000000000000000005678',
  });
  assert.equal(settings.AQUA_ADDRESS, '0x0000000000000000000000000000000000001234');
  assert.equal(settings.AQUA_SWAP_VM_ADDRESS, '0x0000000000000000000000000000000000005678');
  assert.throws(
    () => loadConfig({ DEPLOYMENT_FILE: manifest, CHAIN_ID: '1' }),
    /CHAIN_ID must be Ethereum Sepolia/,
  );
});
