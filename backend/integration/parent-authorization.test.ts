import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createPublicClient,
  createWalletClient,
  http,
  toHex,
  hexToBytes,
  concatHex,
  encodeFunctionData,
  decodeFunctionResult,
  keccak256,
  stringToHex,
  sha256,
  type Abi,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { entryPoint08Address } from 'viem/account-abstraction';
import { childAccountAbi, childAccountFactoryAbi, registryAbi } from '@star/contracts/abi';
import {
  parentAuthorizationDigest,
  encodePasskeySignature,
  encodeParentSessionSignature,
  createParentSessionGasStub,
} from '@star/contracts/child-account';

// Public test accounts on a NEW LOCAL chain only. Never loads .env or external RPC URLs.
test(
  'real WebCrypto parent/device signatures interoperate with deployed account validation and revocation',
  { timeout: 120_000 },
  async (t) => {
    const anvil = spawn('anvil', ['--host', '127.0.0.1', '--port', '0', '--chain-id', '11155111'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(async () => {
      if (anvil.exitCode === null && anvil.signalCode === null) {
        const exited = once(anvil, 'exit');
        anvil.kill('SIGTERM');
        await exited;
      }
    });
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Local chain startup timed out')), 10_000);
      anvil.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      anvil.stdout.on('data', (data: Buffer) => {
        output += data.toString();
        const match = /Listening on 127\.0\.0\.1:(\d+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(`http://127.0.0.1:${match[1]}`);
        }
      });
    });
    const client = createPublicClient({
      chain: sepolia,
      transport: http(url),
      pollingInterval: 10,
    });
    const [owner] = await createWalletClient({
      chain: sepolia,
      transport: http(url),
    }).getAddresses();
    const wallet = createWalletClient({ account: owner!, chain: sepolia, transport: http(url) });
    const receipt = async (hash: Hex) => {
      const result = await client.waitForTransactionReceipt({ hash });
      assert.equal(result.status, 'success');
      return result;
    };
    const deploy = async (name: string, args: unknown[]) => {
      const artifact = JSON.parse(
        await readFile(
          new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url),
          'utf8',
        ),
      ) as { abi: Abi; bytecode: { object: Hex } };
      const result = await receipt(
        await wallet.deployContract({
          abi: artifact.abi,
          bytecode: artifact.bytecode.object,
          args,
        }),
      );
      return result.contractAddress!;
    };
    const registry = await deploy('StarRegistry', []);
    const token = await deploy('StarToken', [owner]);
    const goals = await deploy('StarGoals', [registry, token]);
    const factory = await deploy('StarChildAccountFactory', [registry, goals, 'localhost', owner]);
    await receipt(
      await wallet.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: 'createFamily',
        args: ['test.starwallet.eth'],
      }),
    );
    const key = async () => {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
        'sign',
        'verify',
      ]);
      const raw = toHex(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
      return {
        privateKey: pair.privateKey,
        x: `0x${raw.slice(4, 68)}` as Hex,
        y: `0x${raw.slice(68)}` as Hex,
      };
    };
    const parent = await key();
    const device = await key();
    const node = keccak256(stringToHex('test-child-node'));
    await receipt(
      await wallet.writeContract({
        address: factory,
        abi: childAccountFactoryAbi,
        functionName: 'createChildAccount',
        args: [1n, node, device.x, device.y, 'onboarding-credential'],
      }),
    );
    const account = await client.readContract({
      address: factory,
      abi: childAccountFactoryAbi,
      functionName: 'accountByName',
      args: [1n, node],
    });
    await receipt(
      await wallet.writeContract({
        address: account,
        abi: childAccountAbi,
        functionName: 'configureParentPasskey',
        args: [parent.x, parent.y, 'papa'],
      }),
    );
    const digest = parentAuthorizationDigest({
      chainId: 11155111,
      account,
      familyId: 1n,
      epoch: 1n,
      deviceKeyX: device.x,
      deviceKeyY: device.y,
    });
    assert.equal(
      await client.readContract({
        address: account,
        abi: childAccountAbi,
        functionName: 'parentAuthorizationDigest',
        args: [device.x, device.y, 1n],
      }),
      digest,
    );
    const json = JSON.stringify({
      type: 'webauthn.get',
      challenge: Buffer.from(hexToBytes(digest)).toString('base64url'),
      origin: 'http://localhost:3001',
      crossOrigin: false,
    });
    const authenticatorData = concatHex([sha256(stringToHex('localhost')), '0x0500000000']);
    const parentRaw = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      parent.privateKey,
      new Uint8Array(hexToBytes(concatHex([authenticatorData, sha256(stringToHex(json))]))),
    );
    const parentSignature = encodePasskeySignature({
      signature: toHex(new Uint8Array(parentRaw)),
      authenticatorData,
      clientDataJSON: json,
      challengeIndex: json.indexOf('"challenge"'),
      typeIndex: json.indexOf('"type"'),
    });
    const grant = { epoch: 1n, deviceKeyX: device.x, deviceKeyY: device.y, parentSignature };
    const operationHash = keccak256(stringToHex('chain-account-nonce-calldata-operation'));
    const operationRaw = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      device.privateKey,
      new Uint8Array(hexToBytes(operationHash)),
    );
    const op = {
      sender: account,
      nonce: 0n,
      initCode: '0x' as Hex,
      callData: encodeFunctionData({
        abi: childAccountAbi,
        functionName: 'cancelStarRequest',
        args: [1n],
      }),
      accountGasLimits: `0x${'00'.repeat(32)}` as Hex,
      preVerificationGas: 0n,
      gasFees: `0x${'00'.repeat(32)}` as Hex,
      paymasterAndData: '0x' as Hex,
      signature: encodeParentSessionSignature({
        ...grant,
        signature: toHex(new Uint8Array(operationRaw)),
      }),
    };
    const validate = async (signature = op.signature, hash = operationHash) => {
      const result = await client.call({
        account: entryPoint08Address,
        to: account,
        data: encodeFunctionData({
          abi: childAccountAbi,
          functionName: 'validateUserOp',
          args: [{ ...op, signature }, hash, 0n],
        }),
      });
      assert.ok(result.data);
      return decodeFunctionResult({
        abi: childAccountAbi,
        functionName: 'validateUserOp',
        data: result.data,
      });
    };
    assert.equal(await validate(), 0n);
    assert.equal(
      await validate(createParentSessionGasStub(grant)),
      1n,
      'gas stub must never authorize',
    );
    assert.equal(
      await validate(op.signature, digest),
      1n,
      'a grant proof cannot sign another operation',
    );
    await receipt(
      await wallet.writeContract({
        address: account,
        abi: childAccountAbi,
        functionName: 'revokeParentAuthorizations',
      }),
    );
    assert.equal(await validate(), 1n, 'revocation takes effect in actual account validation');
  },
);
