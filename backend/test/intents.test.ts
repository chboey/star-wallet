import assert from 'node:assert/strict';
import test from 'node:test';
import { familyVaultFactoryAbi, registryAbi } from '@star/contracts/abi';
import { decodeFunctionData, namehash } from 'viem';
import { loadConfig, protocolAddresses } from '../src/config.js';
import { IntentService } from '../src/services/intents.js';

const settings = loadConfig({ SEPOLIA_RPC_URL: 'http://127.0.0.1:8545' });
const addresses = protocolAddresses(settings);
const service = new IntentService(settings);

test('prepares parent-signed family registration with a normalized ENS node', () => {
  const prepared = service.createFamily('family.starwallet.eth');

  assert.equal(prepared.ensName, 'family.starwallet.eth');
  assert.equal(prepared.ensNode, namehash('family.starwallet.eth'));
  assert.equal(prepared.intents.length, 1);
  assert.deepEqual(prepared.intents[0], {
    chainId: 11155111,
    signerRole: 'PARENT',
    to: addresses.registry,
    data: prepared.intents[0]?.data,
    value: '0',
    summary: 'Create a Star family associated with family.starwallet.eth',
  });
  assert.deepEqual(decodeFunctionData({ abi: registryAbi, data: prepared.intents[0]!.data }), {
    functionName: 'createFamily',
    args: ['family.starwallet.eth'],
  });
});

test('rejects invalid family ENS names before preparing calldata', () => {
  assert.throws(() => service.createFamily('.starwallet.eth'), /The ENS name is not valid/);
});

test('prepares the one-vault-per-family factory call', () => {
  const prepared = service.createFamilyVault(42n);

  assert.equal(prepared.familyId, '42');
  assert.deepEqual(prepared.intents[0], {
    chainId: 11155111,
    signerRole: 'PARENT',
    to: addresses.vaultFactory,
    data: prepared.intents[0]?.data,
    value: '0',
    summary: 'Create the isolated vault for family 42',
  });
  assert.deepEqual(
    decodeFunctionData({ abi: familyVaultFactoryAbi, data: prepared.intents[0]!.data }),
    { functionName: 'createFamilyVault', args: [42n] },
  );
});
