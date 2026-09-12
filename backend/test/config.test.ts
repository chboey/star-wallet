import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import test from 'node:test';
import { loadConfig, protocolAddresses } from '../src/config.js';

const emptyManifest = fileURLToPath(new URL('./fixtures/empty-deployment.json', import.meta.url));

test('the incremental environment example parses without future service settings', () => {
  const example = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));
  const settings = loadConfig({ ...example, DEPLOYMENT_FILE: emptyManifest });
  assert.equal(settings.HOST, '127.0.0.1');
  assert.equal(settings.PORT, 3000);
  assert.equal(settings.CHAIN_ID, 11155111);
  assert.equal(settings.STAR_REGISTRY_ADDRESS, undefined);
  assert.equal(settings.AQUA_ADDRESS, undefined);
  assert.throws(() => protocolAddresses(settings), /STAR_REGISTRY_ADDRESS.*AQUA_SWAP_VM_ADDRESS/);
});

test('the default deployment manifest supplies canonical protocol addresses', () => {
  const settings = loadConfig({});
  const addresses = protocolAddresses(settings);
  assert.equal(addresses.registry, '0x23920FF112B125BAD86E2e29B8986C4B29815886');
  assert.equal(addresses.usdc, '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
  assert.equal(addresses.weth, '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9');
});

test('nonempty environment values override the manifest and normalize addresses', () => {
  const settings = loadConfig({
    STAR_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000001234',
    SEPOLIA_RPC_URL: ' https://rpc.example.test ',
  });
  assert.equal(settings.STAR_REGISTRY_ADDRESS, '0x0000000000000000000000000000000000001234');
  assert.equal(settings.SEPOLIA_RPC_URL, 'https://rpc.example.test');
});

test('blank overrides inherit configuration and unsafe network values fail closed', () => {
  const inherited = loadConfig({ STAR_REGISTRY_ADDRESS: '   ' });
  assert.equal(inherited.STAR_REGISTRY_ADDRESS, '0x23920FF112B125BAD86E2e29B8986C4B29815886');
  assert.throws(() => loadConfig({ CHAIN_ID: '1' }), /CHAIN_ID must be Ethereum Sepolia/);
  assert.throws(
    () => loadConfig({ STAR_TOKEN_ADDRESS: '0x0000000000000000000000000000000000000000' }),
    /Invalid EVM address/,
  );
  assert.throws(
    () => loadConfig({ DEPLOYMENT_FILE: './missing-deployment.json' }),
    /DEPLOYMENT_FILE does not exist/,
  );
});

test('runtime hashes and deployed safety settings are validated with their protocol consumer', () => {
  const settings = loadConfig({});
  assert.match(settings.STAR_REGISTRY_RUNTIME_CODE_HASH ?? '', /^0x[0-9a-f]{64}$/);
  assert.equal(settings.CHILD_ACCOUNT_RP_ID, 'star-frontend-mu.vercel.app');
  assert.equal(settings.CHAINLINK_ETH_USD_MAX_AGE_SECONDS, 3_600);
  assert.equal(settings.AQUA_MAX_POSITION_USDC_UNITS, 1_000_000_000n);
  assert.throws(
    () => loadConfig({ STAR_REGISTRY_RUNTIME_CODE_HASH: '0x1234' }),
    /Invalid bytes32 value/,
  );
  assert.throws(() => loadConfig({ CHILD_ACCOUNT_RP_ID: 'https://example.com' }));
});

test('Aqua builder defaults cannot exceed the deployed protocol limits', () => {
  const settings = loadConfig({});
  assert.equal(settings.AQUA_DEFAULT_PRICE_BAND_BPS, 500);
  assert.equal(settings.AQUA_DEFAULT_STRATEGY_LIFETIME_SECONDS, 900);
  assert.throws(() =>
    loadConfig({ AQUA_DEFAULT_PRICE_BAND_BPS: '1001', AQUA_MAX_PRICE_DEVIATION_BPS: '1000' }),
  );
  assert.throws(() =>
    loadConfig({
      AQUA_DEFAULT_STRATEGY_LIFETIME_SECONDS: '1801',
      AQUA_MAX_STRATEGY_LIFETIME_SECONDS: '1800',
    }),
  );
});
