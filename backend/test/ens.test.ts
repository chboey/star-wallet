import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { zeroAddress } from 'viem';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { EnsService } from '../src/services/ens.js';

const signer = '0x1000000000000000000000000000000000000001';

test('ENS rejects legacy settings and substituted v2 dependencies', () => {
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

test('ENS validates namespace boundaries, labels and addresses before RPC', async () => {
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
  await assert.rejects(
    ens.prepareSubdomain({ label: 'has.dots', signer, owner: signer, address: signer }),
    { code: 'INVALID_ENS_LABEL' },
  );
  await assert.rejects(
    ens.prepareSubdomain({ label: 'maya', signer, owner: zeroAddress, address: signer }),
    { code: 'INVALID_ENS_ADDRESS' },
  );
  for (const label of ['a', 'has.dots', '-tan', 'tan-', 'ab--cd', 'tán'])
    await assert.rejects(ens.prepareFamily({ signer, label, secret: `0x${'42'.repeat(32)}` }), {
      code: 'INVALID_ENS_LABEL',
    });
  await assert.rejects(ens.prepareFamily({ signer, label: 'tan', secret: `0x${'0'.repeat(64)}` }), {
    code: 'INVALID_ENS_COMMITMENT',
  });
});

test('ENS routes reject wrong-chain RPC without consulting Star deployment or broadcasting', async (t) => {
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
  const app = await buildApp(
    loadConfig({ NODE_ENV: 'test', SEPOLIA_RPC_URL: `http://127.0.0.1:${address.port}` }),
  );
  t.after(() => app.close());
  for (const path of ['namespace', 'subdomains', 'families']) {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/ens/${path}`,
      payload:
        path === 'namespace'
          ? { signer }
          : path === 'families'
            ? { signer, label: 'tan', secret: `0x${'42'.repeat(32)}` }
            : { signer, label: 'maya', owner: signer, address: signer },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json<{ code: string }>().code, 'ENS_WRONG_CHAIN');
  }
  const invalid = await app.inject({
    method: 'POST',
    url: '/v1/ens/subdomains',
    payload: { signer, label: 'maya', owner: zeroAddress, address: signer },
  });
  assert.equal(invalid.statusCode, 400);
  const recipientOverride = await app.inject({
    method: 'POST',
    url: '/v1/ens/families',
    payload: {
      signer,
      label: 'tan',
      secret: `0x${'42'.repeat(32)}`,
      owner: zeroAddress,
    },
  });
  assert.equal(recipientOverride.statusCode, 400);
  assert.deepEqual(methods, ['eth_chainId', 'eth_chainId', 'eth_chainId']);
});
