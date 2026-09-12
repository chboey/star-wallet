import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { zeroAddress } from 'viem';
import { loadConfig } from '../src/config.js';
import { EnsService } from '../src/services/ens.js';

const signer = '0x1000000000000000000000000000000000000001';

test('rejects legacy ENS settings and substituted ENSv2 dependencies', () => {
  for (const key of [
    'ENS_REGISTRY_ADDRESS',
    'ENS_NAME_WRAPPER_ADDRESS',
    'ENS_PUBLIC_RESOLVER_ADDRESS',
    'ENS_PARENT_WRAPPED',
  ]) {
    assert.throws(() => loadConfig({ [key]: 'legacy' }), /obsolete ENSv1/);
  }
  assert.throws(
    () => new EnsService(loadConfig({ ENS_VERIFIABLE_FACTORY_ADDRESS: signer })),
    /pinned Sepolia/,
  );
  assert.throws(
    () => new EnsService(loadConfig({ ENS_PARENT_NAME: 'not-a-namespace' })),
    /under .eth/,
  );
});

test('validates managed namespace boundaries and signer addresses before RPC', async () => {
  const ens = new EnsService(loadConfig({ SEPOLIA_RPC_URL: 'http://127.0.0.1:1' }));

  assert.equal(ens.requireManagedName('MAYA.starwallet.eth'), 'maya.starwallet.eth');
  for (const name of [
    'starwallet.eth',
    'fake-starwallet.eth',
    'starwallet.eth.attacker.eth',
    `${'a'.repeat(64)}.starwallet.eth`,
  ]) {
    assert.throws(() => ens.requireManagedName(name));
  }
  await assert.rejects(ens.prepareNamespace(zeroAddress), { code: 'INVALID_ENS_ADDRESS' });
});

test('fails namespace inspection and readiness closed on the wrong chain', async (t) => {
  const methods: string[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      const rpc = JSON.parse(body) as { id: number; method: string };
      methods.push(rpc.method);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: '0x1' }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const ens = new EnsService(
    loadConfig({ NODE_ENV: 'test', SEPOLIA_RPC_URL: `http://127.0.0.1:${address.port}` }),
  );

  await assert.rejects(ens.inspect('starwallet.eth'), { code: 'ENS_WRONG_CHAIN' });
  await assert.rejects(ens.namespace(), { code: 'ENS_WRONG_CHAIN' });
  await assert.rejects(ens.readiness(), { code: 'ENS_WRONG_CHAIN' });
  await assert.rejects(ens.prepareNamespace(signer), { code: 'ENS_WRONG_CHAIN' });
  assert.deepEqual(methods, Array(4).fill('eth_chainId'));
});
