import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import test from 'node:test';
import { createPublicClient, createWalletClient, http } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { registryAbi, familyVaultFactoryAbi, familyVaultAbi } from '@star/contracts/abi';
import { loadConfig } from '../src/config.js';
import { ProtocolService } from '../src/services/protocol.js';
import { AquaStrategyService } from '../src/services/aqua.js';
import { EnsService } from '../src/services/ens.js';
import { exerciseChildAccount } from './child-account-flow.js';

// The external RPC is read-only fork input. Every signed transaction goes to a
// fresh localhost Anvil using its public test mnemonic, never an environment key.
test(
  'Sepolia deployment scripts, manifests and backend readiness agree on a local fork',
  {
    skip: !process.env.SEPOLIA_FORK_RPC_URL,
    timeout: 180_000,
  },
  async (t) => {
    const contracts = resolve(import.meta.dirname, '../../contracts');
    const root = await mkdtemp(resolve(tmpdir(), 'star-sepolia-deployment-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(resolve(root, 'scripts'));
    for (const name of ['deploy-aqua.mjs', 'deploy.mjs', 'deployment-utils.mjs'])
      await cp(resolve(contracts, 'scripts', name), resolve(root, 'scripts', name));
    await cp(resolve(contracts, 'network.js'), resolve(root, 'network.js'));
    await cp(resolve(contracts, 'package.json'), resolve(root, 'package.json'));
    await symlink(resolve(contracts, 'node_modules'), resolve(root, 'node_modules'), 'dir');
    await symlink(resolve(contracts, 'artifacts'), resolve(root, 'artifacts'), 'dir');
    const anvil = spawn(
      'anvil',
      [
        '--host',
        '127.0.0.1',
        '--port',
        '0',
        '--chain-id',
        '11155111',
        // Match Sepolia's native P256 verification; Anvil's fork auto-detection
        // otherwise chooses older EVM rules for this Sepolia block height.
        '--hardfork',
        'osaka',
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
      anvil.on('error', (e) => {
        clearTimeout(timer);
        fail(e);
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
    const account = mnemonicToAccount(
      'test test test test test test test test test test test junk',
    );
    const key = account.getHdKey().privateKey;
    assert.ok(key);
    const defaults = parseEnv(await readFile(resolve(contracts, '.env.example'), 'utf8'));
    const env = {
      ...defaults,
      PATH: process.env.PATH,
      SEPOLIA_RPC_URL: rpc,
      DEPLOYER_PRIVATE_KEY: `0x${Buffer.from(key).toString('hex')}`,
      // Legacy settings must not redirect either admin role away from the deployer.
      TOKEN_ADMIN_ADDRESS: '0x0000000000000000000000000000000000001234',
      EMERGENCY_ADMIN_ADDRESS: '0x0000000000000000000000000000000000005678',
    };
    const client = createPublicClient({
      chain: sepolia,
      transport: http(rpc),
      pollingInterval: 20,
    });
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
    const run = async (script: string, dryRun: boolean) => {
      const child = spawn(process.execPath, [`scripts/${script}`], {
        cwd: root,
        env: { ...env, DRY_RUN: String(dryRun) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let errors = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        errors += chunk.toString();
      });
      const [exit] = await once(child, 'exit');
      assert.equal(exit, 0, `${script}: ${errors}`);
      return output;
    };
    let nonce = await client.getTransactionCount({ address: account.address });
    assert.equal(JSON.parse(await run('deploy-aqua.mjs', true)).dryRun, true);
    assert.equal(await client.getTransactionCount({ address: account.address }), nonce);
    await run('deploy-aqua.mjs', false);
    nonce = await client.getTransactionCount({ address: account.address });
    const preflight = JSON.parse(await run('deploy.mjs', true));
    assert.equal(preflight.readyToDeploy, true);
    assert.equal(preflight.tokenAdmin, account.address);
    assert.equal(preflight.emergencyAdmin, account.address);
    assert.equal(await client.getTransactionCount({ address: account.address }), nonce);
    await run('deploy.mjs', false);
    const manifestPath = resolve(root, 'deployments/sepolia.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(manifest.chainId, sepolia.id);
    assert.equal(Object.keys(manifest.contracts).length, 8);
    assert.equal(
      manifest.configuration.STAR_ENS_REGISTRAR_ADDRESS,
      manifest.contracts.StarEnsRegistrar.address,
    );
    assert.equal(
      manifest.configuration.STAR_ENS_REGISTRAR_RUNTIME_CODE_HASH,
      manifest.contracts.StarEnsRegistrar.runtimeCodeHash,
    );
    assert.equal(manifest.tokenAdmin, account.address);
    assert.equal(manifest.emergencyAdmin, account.address);
    assert.equal(manifest.roleAssertions.deployerHasAdminRole, true);
    assert.equal(manifest.roleTransactions.grantTokenAdmin, undefined);
    assert.equal(manifest.roleTransactions.renounceDeployerAdmin, undefined);
    const config = loadConfig({ SEPOLIA_RPC_URL: rpc, DEPLOYMENT_FILE: manifestPath });
    const protocol = new ProtocolService(config);
    const ready = await protocol.ensureReady();
    assert.equal(ready.chainId, sepolia.id);
    assert.equal(
      await client.readContract({
        address: ready.addresses.vaultFactory,
        abi: familyVaultFactoryAbi,
        functionName: 'emergencyAdmin',
      }),
      account.address,
    );
    const created = await wallet.writeContract({
      address: ready.addresses.registry,
      abi: registryAbi,
      functionName: 'createFamily',
      args: ['local.starwallet.eth'],
    });
    assert.equal((await client.waitForTransactionReceipt({ hash: created })).status, 'success');
    const vaultCreated = await wallet.writeContract({
      address: ready.addresses.vaultFactory,
      abi: familyVaultFactoryAbi,
      functionName: 'createFamilyVault',
      args: [1n],
    });
    assert.equal(
      (await client.waitForTransactionReceipt({ hash: vaultCreated })).status,
      'success',
    );
    const vault = await protocol.resolveFamilyVault(1n);
    assert.equal(vault.familyId, 1n);
    assert.equal(vault.emergencyAdmin, account.address);
    const strategy = await new AquaStrategyService(config).build({
      maker: vault.vault,
      feeBps: 30,
      priceBandBps: config.AQUA_MAX_PRICE_DEVIATION_BPS,
      validForSeconds: 900,
    });
    const inspected = await client.readContract({
      address: vault.vault,
      abi: familyVaultAbi,
      functionName: 'inspectSavingsStrategy',
      args: [strategy.strategy],
    });
    assert.equal(inspected.oracleRawPrice.toString(), strategy.oracleRawPrice);
    // ENS namespace registration is separate from deploying Star. Its bootstrap
    // and actual registration transactions are tested in ens-sepolia.test.ts.
    assert.equal((await new EnsService(config).namespace()).chainId, sepolia.id);
    await exerciseChildAccount(config, protocol, account);
    // An altered dependency hash must block preparation, not silently disable verification on testnet.
    await assert.rejects(
      new ProtocolService({
        ...config,
        AQUA_RUNTIME_CODE_HASH: `0x${'00'.repeat(32)}`,
      }).ensureReady(),
    );
  },
);
