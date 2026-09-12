import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test, { type TestContext } from 'node:test';
import { loadConfig } from '../src/config.js';
import { ProtocolService } from '../src/services/protocol.js';

async function rpcEndpoint(t: TestContext, responses: { chainId: string; code: string }) {
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const payload = JSON.parse(body) as { id: number; method: string };
      const result = payload.method === 'eth_chainId' ? responses.chainId : responses.code;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

test('protocol readiness rejects an RPC connected to the wrong chain', async (t) => {
  const rpc = await rpcEndpoint(t, { chainId: '0x1', code: '0x6000' });
  const service = new ProtocolService(loadConfig({ SEPOLIA_RPC_URL: rpc }));
  await assert.rejects(
    service.ensureReady(),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'PROTOCOL_UNAVAILABLE',
  );
});

test('protocol readiness rejects missing and mismatched runtime bytecode', async (t) => {
  const missingRpc = await rpcEndpoint(t, { chainId: '0xaa36a7', code: '0x' });
  await assert.rejects(
    new ProtocolService(loadConfig({ SEPOLIA_RPC_URL: missingRpc })).ensureReady(),
    /Sepolia protocol verification failed/,
  );

  const wrongCodeRpc = await rpcEndpoint(t, { chainId: '0xaa36a7', code: '0x6000' });
  await assert.rejects(
    new ProtocolService(loadConfig({ SEPOLIA_RPC_URL: wrongCodeRpc })).ensureReady(),
    /Sepolia protocol verification failed/,
  );
});
