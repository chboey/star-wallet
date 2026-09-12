import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { decodeFunctionData, keccak256, namehash, zeroAddress, type Address, type Hex } from 'viem';
import { ensRegistrarAbi } from '@star/contracts/abi';
import { sepoliaDeployment } from '@star/contracts/network';
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

test('validates family labels and commitment secrets before RPC', async () => {
  const ens = new EnsService(loadConfig({ SEPOLIA_RPC_URL: 'http://127.0.0.1:1' }));
  const secret = `0x${'42'.repeat(32)}` as Hex;

  for (const label of ['a', 'has.dots', '-tan', 'tan-', 'ab--cd', 'tán'])
    await assert.rejects(ens.prepareFamily({ signer, label, secret }), {
      code: 'INVALID_ENS_LABEL',
    });
  await assert.rejects(ens.prepareFamily({ signer, label: 'tan', secret: `0x${'0'.repeat(32)}` }), {
    code: 'INVALID_ENS_COMMITMENT',
  });
});

test('prepares caller-bound family commitments, waiting, and reveal transactions', async () => {
  const secret = `0x${'42'.repeat(32)}` as Hex;
  const commitment = `0x${'24'.repeat(32)}` as Hex;

  const commit = await familyService({ committedAt: 0n, commitment }).prepareFamily({
    signer,
    label: 'tan-family',
    secret,
  });
  assert.equal(commit.status, 'TRANSACTION_REQUIRED');
  assert.equal(commit.step, 'COMMIT_FAMILY_NAME');
  assert.equal(commit.transaction?.from, signer);
  assert.deepEqual(decodeFunctionData({ abi: ensRegistrarAbi, data: commit.transaction!.data }), {
    functionName: 'commit',
    args: [commitment],
  });

  const waiting = await familyService({ committedAt: 95n, commitment }).prepareFamily({
    signer,
    label: 'tan-family',
    secret,
  });
  assert.equal(waiting.status, 'WAITING');
  if (waiting.status === 'WAITING') {
    assert.equal(waiting.readyAt, '105');
    assert.equal(waiting.transaction, null);
  }

  const reveal = await familyService({ committedAt: 80n, commitment }).prepareFamily({
    signer,
    label: 'tan-family',
    secret,
  });
  assert.equal(reveal.status, 'TRANSACTION_REQUIRED');
  assert.equal(reveal.step, 'REGISTER_FAMILY_NAME');
  assert.deepEqual(decodeFunctionData({ abi: ensRegistrarAbi, data: reveal.transaction!.data }), {
    functionName: 'registerFamily',
    args: ['tan-family', secret],
  });
});

test('refuses a family claim already owned by another parent', async () => {
  await assert.rejects(
    familyService({
      committedAt: 0n,
      commitment: `0x${'24'.repeat(32)}`,
      nameStatus: 2,
      nameOwner: '0x9000000000000000000000000000000000000009',
    }).prepareFamily({
      signer,
      label: 'tan-family',
      secret: `0x${'42'.repeat(32)}`,
    }),
    { code: 'ENS_NAME_UNAVAILABLE' },
  );
});

function familyService(options: {
  committedAt: bigint;
  commitment: Hex;
  nameStatus?: number;
  nameOwner?: Address;
}) {
  const namespaceRegistry = '0x6000000000000000000000000000000000000006';
  const registrar = '0x7000000000000000000000000000000000000007';
  const code = '0x6000' as Hex;
  const settings = loadConfig({
    SEPOLIA_RPC_URL: 'http://127.0.0.1:1',
    STAR_ENS_REGISTRAR_ADDRESS: registrar,
    STAR_ENS_REGISTRAR_RUNTIME_CODE_HASH: keccak256(code),
  });
  const ens = new EnsService(settings);
  Object.assign(ens, {
    client: {
      getChainId: async () => 11155111,
      getBlock: async () => ({ number: 100n, timestamp: 100n }),
      getCode: async () => code,
      call: async () => ({}),
      getEnsAddress: async () => options.nameOwner ?? signer,
      readContract: async (input: {
        address: string;
        functionName: string;
        args?: readonly unknown[];
      }) => {
        const address = input.address.toLowerCase();
        switch (input.functionName) {
          case 'getSubregistry':
            return address === sepoliaDeployment.ensRootRegistry.toLowerCase()
              ? sepoliaDeployment.ensEthRegistry
              : namespaceRegistry;
          case 'findTokenId':
            return address === sepoliaDeployment.ensEthRegistry.toLowerCase() ? 1n : 2n;
          case 'getState':
            return address === sepoliaDeployment.ensEthRegistry.toLowerCase()
              ? { status: 2, expiry: 10_000n, latestOwner: signer, tokenId: 1n, resource: 0n }
              : {
                  status: options.nameStatus ?? 0,
                  expiry: 10_000n,
                  latestOwner: options.nameOwner ?? zeroAddress,
                  tokenId: 2n,
                  resource: 0n,
                };
          case 'verifyContract':
            return sepoliaDeployment.ensUserRegistryImplementation;
          case 'getParent':
            return [sepoliaDeployment.ensEthRegistry, 'starwallet'];
          case 'hasRootRoles':
            return true;
          case 'ethRegistry':
            return sepoliaDeployment.ensEthRegistry;
          case 'factory':
            return sepoliaDeployment.ensVerifiableFactory;
          case 'registryImplementation':
            return sepoliaDeployment.ensUserRegistryImplementation;
          case 'resolverImplementation':
            return sepoliaDeployment.ensPermissionedResolverImplementation;
          case 'parentNode':
            return namehash('starwallet.eth');
          case 'makeCommitment':
            return options.commitment;
          case 'commitments':
            return options.committedAt;
          case 'MIN_COMMITMENT_AGE':
            return 10n;
          case 'MAX_COMMITMENT_AGE':
            return 1_000n;
          default:
            throw new Error(`Unexpected ENS read: ${input.functionName}`);
        }
      },
    },
  });
  return ens;
}
