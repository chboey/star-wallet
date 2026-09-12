import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  keccak256,
  parseEther,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { ensRegistrarAbi } from '@star/contracts/abi';
import { sepoliaDeployment } from '@star/contracts/network';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { EnsService } from '../src/services/ens.js';
import {
  ensRegistryAbi,
  ensResolverAbi,
  ENS_OWNER_ROLES,
  type EnsPlan,
} from '../src/services/ens-v2.js';

// Only the fork source is public. Impersonation and ALL transactions are confined
// to a fresh localhost Anvil. No private keys or deployment files are loaded.
test(
  'ENSv2 API bootstraps a namespace and registers/resolves subdomains on a Sepolia fork',
  {
    skip: !process.env.SEPOLIA_FORK_RPC_URL,
    timeout: 180_000,
  },
  async (t) => {
    const anvil = spawn(
      'anvil',
      [
        '--host',
        '127.0.0.1',
        '--port',
        '0',
        '--chain-id',
        '11155111',
        '--fork-url',
        process.env.SEPOLIA_FORK_RPC_URL!,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    t.after(async () => {
      if (anvil.exitCode === null && anvil.signalCode === null) {
        const exited = once(anvil, 'exit');
        anvil.kill('SIGTERM');
        await exited;
      }
    });
    const rpc = await new Promise<string>((done, fail) => {
      let output = '';
      const timer = setTimeout(() => fail(new Error('Fork startup timed out')), 30_000);
      anvil.on('error', (error) => {
        clearTimeout(timer);
        fail(error);
      });
      anvil.on('exit', () => {
        clearTimeout(timer);
        fail(new Error('Fork exited'));
      });
      anvil.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const match = /Listening on 127\.0\.0\.1:(\d+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          done(`http://127.0.0.1:${match[1]}`);
        }
      });
      anvil.stderr.resume();
    });
    assert.equal(new URL(rpc).hostname, '127.0.0.1');
    const client = createPublicClient({
      chain: sepolia,
      transport: http(rpc),
      pollingInterval: 10,
      cacheTime: 0,
    });
    const control = createTestClient({ chain: sepolia, mode: 'anvil', transport: http(rpc) });
    const wallet = createWalletClient({ chain: sepolia, transport: http(rpc) });
    const settings = loadConfig({ NODE_ENV: 'test', SEPOLIA_RPC_URL: rpc });
    const initial = await new EnsService(settings).namespace();
    const signer = initial.owner;
    const owner: Address = '0x1000000000000000000000000000000000000001';
    const target: Address = '0x2000000000000000000000000000000000000002';
    await control.impersonateAccount({ address: signer });
    await control.setBalance({ address: signer, value: parseEther('10') });
    await control.impersonateAccount({ address: owner });
    await control.setBalance({ address: owner, value: parseEther('10') });
    const artifact = JSON.parse(
      await readFile(
        new URL('../../contracts/artifacts/StarEnsRegistrar.json', import.meta.url),
        'utf8',
      ),
    );
    const deploymentHash = await wallet.deployContract({
      account: signer,
      abi: ensRegistrarAbi,
      bytecode: artifact.bytecode as Hex,
      args: [
        sepoliaDeployment.ensEthRegistry,
        'starwallet',
        sepoliaDeployment.ensVerifiableFactory,
        sepoliaDeployment.ensUserRegistryImplementation,
        sepoliaDeployment.ensPermissionedResolverImplementation,
      ],
    });
    const registrarReceipt = await client.waitForTransactionReceipt({ hash: deploymentHash });
    assert.equal(registrarReceipt.status, 'success');
    const registrar = registrarReceipt.contractAddress!;
    settings.STAR_ENS_REGISTRAR_ADDRESS = registrar;
    settings.STAR_ENS_REGISTRAR_RUNTIME_CODE_HASH = keccak256(
      (await client.getCode({ address: registrar }))!,
    );
    const ens = new EnsService(settings);
    const app = await buildApp(settings);
    t.after(() => app.close());
    assert.equal((await ens.inspect(initial.name, signer)).matchesExpected, true);
    if (initial.setupRequired)
      await assert.rejects(ens.readiness(), { code: 'ENS_SETUP_REQUIRED' });
    const input = { label: 'star-api-fork-test', signer, owner, address: target };
    const steps: EnsPlan['step'][] = [];
    async function run(path: string, body: object, from: Address) {
      for (let attempt = 0; attempt < 7; attempt++) {
        const response = await app.inject({
          method: 'POST',
          url: `/v1/ens/${path}`,
          payload: body,
        });
        if (response.statusCode !== 200) {
          assert.equal(response.statusCode, 200, response.body);
        }
        const plan = response.json<EnsPlan>();
        if (plan.status === 'READY') {
          assert.equal(plan.transaction, null);
          return plan;
        }
        const tx = plan.transaction;
        assert.ok(tx);
        assert.equal(tx.chainId, sepolia.id);
        assert.equal(tx.from.toLowerCase(), from.toLowerCase());
        assert.equal(tx.value, '0');
        assert.notEqual(tx.to, zeroAddress);
        steps.push(plan.step);
        const hash = await wallet.sendTransaction({
          account: from,
          to: tx.to,
          data: tx.data,
          value: 0n,
        });
        assert.equal((await client.waitForTransactionReceipt({ hash })).status, 'success');
      }
      assert.fail('ENS preparation did not converge');
    }
    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/ens/subdomains',
      payload: { ...input, signer: owner },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    const ready = await run('subdomains', input, signer);
    assert.equal(ready.name, `${input.label}.starwallet.eth`);
    if (initial.setupRequired)
      assert.deepEqual(steps, [
        'DEPLOY_REGISTRY',
        'SET_REGISTRY_PARENT',
        'ATTACH_REGISTRY',
        'DEPLOY_RESOLVER',
        'REGISTER_SUBDOMAIN',
      ]);
    await assert.rejects(ens.readiness(), { code: 'ENS_SETUP_REQUIRED' });
    await run('namespace', { signer }, signer);
    assert.equal(steps.at(-1), 'AUTHORIZE_FAMILY_REGISTRAR');
    assert.equal((await ens.readiness()).chainId, sepolia.id);
    assert.equal((await ens.inspect(ready.name, target)).matchesExpected, true);
    const child = await ens.namespace(ready.name);
    assert.equal(child.owner.toLowerCase(), owner.toLowerCase());
    const resolver = await client.readContract({
      address: child.registry,
      abi: ensRegistryAbi,
      functionName: 'getResolver',
      args: [input.label],
    });
    assert.equal(
      await client.readContract({
        address: resolver,
        abi: ensResolverAbi,
        functionName: 'hasRootRoles',
        args: [ENS_OWNER_ROLES, owner],
      }),
      true,
    );
    assert.equal(
      await client.readContract({
        address: resolver,
        abi: ensResolverAbi,
        functionName: 'hasRootRoles',
        args: [ENS_OWNER_ROLES, signer],
      }),
      false,
    );
    const before = steps.length;
    await run('subdomains', input, signer);
    assert.equal(steps.length, before, 'Retry must not prepare another transaction');
    assert.equal((await ens.prepareNamespace(signer)).status, 'READY');
    for (const [body, status] of [
      [{ ...input, address: owner }, 409],
      [{ ...input, owner: signer }, 409],
      [{ ...input, label: 'invalid.label' }, 400],
      [{ ...input, parentName: 'other.eth' }, 400],
      [{ ...input, owner: zeroAddress }, 400],
      [{ ...input, expiresAt: '1' }, 400],
      [{ ...input, expiresAt: (BigInt(initial.expiresAt) + 1n).toString() }, 400],
      [{ ...input, expiresAt: (1n << 64n).toString() }, 400],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ens/subdomains',
        payload: body,
      });
      assert.equal(response.statusCode, status, response.body);
    }
    // Ownership handed to the requested account is usable for nested namespaces.
    const nested = {
      parentName: ready.name,
      label: 'nested',
      signer: owner,
      owner,
      address: target,
    };
    const nestedReady = await run('subdomains', nested, owner);
    assert.equal((await ens.inspect(nestedReady.name, target)).matchesExpected, true);

    // An ordinary parent now claims their OWN family without any root namespace role.
    const root = await ens.namespace();
    assert.equal(
      await client.readContract({
        address: root.subregistry,
        abi: ensRegistryAbi,
        functionName: 'hasRootRoles',
        args: [1n, owner],
      }),
      false,
    );
    const claim = {
      signer: owner,
      label: 'tan-fork-parent',
      secret: `0x${'42'.repeat(32)}` as Hex,
    };
    const familyPlan = async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ens/families',
        payload: claim,
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    };
    const commitmentPlan = await familyPlan();
    assert.equal(commitmentPlan.step, 'COMMIT_FAMILY_NAME');
    const commitReceipt = await client.waitForTransactionReceipt({
      hash: await wallet.sendTransaction({
        account: owner,
        to: registrar,
        data: commitmentPlan.transaction.data,
        value: 0n,
      }),
    });
    assert.equal(commitReceipt.status, 'success');
    assert.equal((await familyPlan()).status, 'WAITING');
    await control.setNextBlockTimestamp({ timestamp: (await client.getBlock()).timestamp + 11n });
    await control.mine({ blocks: 1 });
    const registrationPlan = await familyPlan();
    assert.equal(registrationPlan.step, 'REGISTER_FAMILY_NAME');
    assert.equal(registrationPlan.transaction.from.toLowerCase(), owner.toLowerCase());
    const claimReceipt = await client.waitForTransactionReceipt({
      hash: await wallet.sendTransaction({
        account: owner,
        to: registrar,
        data: registrationPlan.transaction.data,
        value: 0n,
      }),
    });
    assert.equal(claimReceipt.status, 'success');
    assert.equal(
      (await familyPlan()).status,
      'READY',
      'A confirmed retry must not request root permission or sign again',
    );
    const familyName = `${claim.label}.starwallet.eth`;
    const claimed = await ens.namespace(familyName);
    assert.equal(claimed.owner.toLowerCase(), owner.toLowerCase());
    assert.equal(
      claimed.setupRequired,
      false,
      'Family registry is linked in the claim transaction',
    );
    assert.equal((await ens.inspect(familyName, owner)).matchesExpected, true);
    assert.equal(
      await client.readContract({
        address: claimed.subregistry,
        abi: ensRegistryAbi,
        functionName: 'hasRootRoles',
        args: [ENS_OWNER_ROLES, owner],
      }),
      true,
    );
    assert.equal(
      await client.readContract({
        address: claimed.subregistry,
        abi: ensRegistryAbi,
        functionName: 'hasRootRoles',
        args: [1n, registrar],
      }),
      false,
      'Registrar retains no control over child names',
    );
    assert.equal(
      (await ens.namespace()).owner.toLowerCase(),
      signer.toLowerCase(),
      'App owner retains the root name',
    );
    const jasmine = {
      signer: owner,
      owner,
      address: target,
      parentName: familyName,
      label: 'jasmine',
    };
    await run('subdomains', jasmine, owner);
    assert.equal((await ens.inspect(`jasmine.${familyName}`, target)).matchesExpected, true);
    const otherParent = await app.inject({
      method: 'POST',
      url: '/v1/ens/families',
      payload: { ...claim, signer: target },
    });
    assert.equal(otherParent.statusCode, 409);
    const wrongChildParent = await app.inject({
      method: 'POST',
      url: '/v1/ens/subdomains',
      payload: { ...jasmine, signer: target, label: 'intruder' },
    });
    assert.equal(wrongChildParent.statusCode, 403);
    const recipientOverride = await app.inject({
      method: 'POST',
      url: '/v1/ens/families',
      payload: { ...claim, owner: target },
    });
    assert.equal(recipientOverride.statusCode, 400);
    // Re-registration after expiry must follow the registry's versioned token IDs.
    const expiry = (await client.getBlock()).timestamp + 300n;
    const temporary = { ...input, label: 'star-api-expiry-test', expiresAt: expiry.toString() };
    await run('subdomains', temporary, signer);
    await control.setNextBlockTimestamp({ timestamp: expiry + 1n });
    await control.mine({ blocks: 1 });
    const renewed = await run('subdomains', { ...temporary, expiresAt: initial.expiresAt }, signer);
    assert.equal((await ens.inspect(renewed.name, target)).matchesExpected, true);
  },
);
