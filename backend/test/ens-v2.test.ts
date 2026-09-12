import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData, encodeFunctionData, namehash, zeroAddress } from 'viem';
import {
  ENS_OWNER_ROLES,
  ENS_REGISTRAR_ROLE,
  ENS_SET_SUBREGISTRY_ROLE,
  ensFactoryAbi,
  ensProxyAddress,
  ensRegistryAbi,
  ensResolverAbi,
} from '../src/services/ens-v2.js';

const factory = '0x1000000000000000000000000000000000000001';
const logic = '0x2000000000000000000000000000000000000002';
const signer = '0x3000000000000000000000000000000000000003';
const owner = '0x4000000000000000000000000000000000000004';
const resolver = '0x5000000000000000000000000000000000000005';

test('defines the ENSv2 registry, factory, and resolver operations used by the service', () => {
  const registration = encodeFunctionData({
    abi: ensRegistryAbi,
    functionName: 'register',
    args: ['family', owner, zeroAddress, resolver, ENS_OWNER_ROLES, 2_000_000n],
  });
  const deployment = encodeFunctionData({
    abi: ensFactoryAbi,
    functionName: 'deployProxy',
    args: [logic, 42n, '0x1234'],
  });
  const setter = encodeFunctionData({
    abi: ensResolverAbi,
    functionName: 'setAddr',
    args: [namehash('family.starwallet.eth'), owner],
  });

  assert.deepEqual(decodeFunctionData({ abi: ensRegistryAbi, data: registration }), {
    functionName: 'register',
    args: ['family', owner, zeroAddress, resolver, ENS_OWNER_ROLES, 2_000_000n],
  });
  assert.deepEqual(decodeFunctionData({ abi: ensFactoryAbi, data: deployment }), {
    functionName: 'deployProxy',
    args: [logic, 42n, '0x1234'],
  });
  assert.deepEqual(decodeFunctionData({ abi: ensResolverAbi, data: setter }), {
    functionName: 'setAddr',
    args: [namehash('family.starwallet.eth'), owner],
  });
});

test('uses EnhancedAccessControl nybble roles and isolated registrar permissions', () => {
  assert.equal(ENS_OWNER_ROLES, BigInt(`0x${'1'.repeat(64)}`));
  assert.equal(ENS_REGISTRAR_ROLE, 1n);
  assert.equal(ENS_SET_SUBREGISTRY_ROLE, 1n << 20n);
  assert.equal(ENS_OWNER_ROLES & ENS_REGISTRAR_ROLE, ENS_REGISTRAR_ROLE);
  assert.equal(ENS_OWNER_ROLES & ENS_SET_SUBREGISTRY_ROLE, ENS_SET_SUBREGISTRY_ROLE);
});

test('derives the exact deterministic ENSv2 CloneProxyBytecode address', () => {
  assert.equal(
    ensProxyAddress(factory, logic, signer, 42n),
    '0x88828739b5471fC6E35F1488BA187F59209A6458',
  );
  assert.notEqual(
    ensProxyAddress(factory, logic, signer, 43n),
    ensProxyAddress(factory, logic, signer, 42n),
  );
  assert.notEqual(
    ensProxyAddress(factory, logic, owner, 42n),
    ensProxyAddress(factory, logic, signer, 42n),
  );
});
