import { createPublicClient, createWalletClient, getAddress, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { loadConfig } from '../src/config.js';
import { EnsService } from '../src/services/ens.js';

// One-time ENS operator setup. Only this CLI loads the existing contracts deployer key;
// the API stays unsigned. Without --broadcast, prepare only the next transaction.
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--broadcast')) throw new Error('Only --broadcast is supported');
const broadcast = args.includes('--broadcast');
const settings = loadConfig();
const ens = new EnsService(settings);
if (!settings.STAR_ENS_REGISTRAR_ADDRESS || !settings.STAR_ENS_REGISTRAR_RUNTIME_CODE_HASH)
  throw new Error(
    'Deploy Star contracts first; ENS setup loads the registrar from the deployment manifest',
  );
const privateKey = required('DEPLOYER_PRIVATE_KEY');
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey))
  throw new Error('DEPLOYER_PRIVATE_KEY must be a 32-byte hex private key');
const account = privateKeyToAccount(privateKey as Hex);
const signer = account.address;
const namespace = await ens.namespace();
if (getAddress(namespace.owner) !== signer)
  throw new Error('The deployer must own the configured ENS parent name on Sepolia');
const client = createPublicClient({ chain: sepolia, transport: http(settings.SEPOLIA_RPC_URL) });
const wallet = broadcast
  ? createWalletClient({ account, chain: sepolia, transport: http(settings.SEPOLIA_RPC_URL) })
  : undefined;

for (let attempt = 0; attempt < 7; attempt++) {
  const plan = await ens.prepareNamespace(signer);
  console.log(JSON.stringify({ dryRun: !broadcast, ...plan }, null, 2));
  if (plan.status === 'READY' || !broadcast) process.exit(0);
  const tx = plan.transaction;
  if (
    !tx ||
    !wallet ||
    !account ||
    tx.chainId !== sepolia.id ||
    getAddress(tx.from) !== account.address ||
    tx.value !== '0'
  )
    throw new Error('Invalid ENS transaction plan');
  if ((await client.getChainId()) !== sepolia.id)
    throw new Error('RPC network changed; refusing to sign');
  const gas = await client.estimateGas({ account, to: tx.to, data: tx.data, value: 0n });
  const hash = await wallet.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: 0n,
    gas: (gas * 120n) / 100n,
  });
  console.log(JSON.stringify({ step: plan.step, transactionHash: hash }));
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== 'success') throw new Error(`ENS transaction reverted: ${hash}`);
}
throw new Error('ENS setup did not converge; inspect the confirmed transactions before retrying');

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
