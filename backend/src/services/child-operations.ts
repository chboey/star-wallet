import { getAddress, toHex, type Hex } from 'viem';
import { decodeChildCall } from '@star/contracts/child-account';
import { entryPoint08Address } from 'viem/account-abstraction';
import { z } from 'zod';
import type { Config } from '../config.js';
import { badRequest, unavailable } from '../errors.js';
import type { ChildAccountService } from './child-accounts.js';
import { ChildGasEstimator } from './child-gas.js';
import {
  ChildSecurityLimits,
  childGasCaps,
  childFeeCap,
  maximumSponsorshipCost,
} from './child-security-limits.js';

const quantity = z
  .string()
  .regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/i)
  .max(66);
const address = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/i)
  .transform((value) => getAddress(value));
const data = z
  .string()
  .regex(/^0x(?:[0-9a-f]{2})*$/i)
  .max(8194);
// viem leaves context undefined; JSON serializes that array entry as null.
// Only an absent/empty context is accepted. The server supplies the actual policy.
const sponsorshipContext = z.object({}).strict().nullish();
const userOperation = z
  .object({
    sender: address,
    nonce: quantity,
    callData: data,
    signature: data.optional(),
    callGasLimit: quantity.optional(),
    verificationGasLimit: quantity.optional(),
    preVerificationGas: quantity.optional(),
    maxFeePerGas: quantity.optional(),
    maxPriorityFeePerGas: quantity.optional(),
    paymaster: address.optional(),
    paymasterData: data.optional(),
    paymasterVerificationGasLimit: quantity.optional(),
    paymasterPostOpGasLimit: quantity.optional(),
  })
  .strict();
const rpcRequest = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.number().int(), z.string().max(64)]),
    method: z.enum([
      'eth_estimateUserOperationGas',
      'eth_sendUserOperation',
      'eth_getUserOperationReceipt',
      'eth_supportedEntryPoints',
      'rundler_maxPriorityFeePerGas',
      'pm_getPaymasterStubData',
      'pm_getPaymasterData',
    ]),
    params: z.array(z.unknown()).max(4),
  })
  .strict();

/** Closed ERC-4337 RPC surface: no arbitrary RPC, deployments, batches or client-selected policy. */
export function validateChildRpc(input: unknown) {
  const request = rpcRequest.parse(input);
  if (
    request.method === 'eth_supportedEntryPoints' ||
    request.method === 'rundler_maxPriorityFeePerGas'
  ) {
    if (request.params.length)
      throw badRequest('INVALID_PARAMS', 'This method does not accept parameters');
    return { request, operation: null };
  }
  if (request.method === 'eth_getUserOperationReceipt') {
    if (
      request.params.length !== 1 ||
      !z
        .string()
        .regex(/^0x[0-9a-f]{64}$/i)
        .safeParse(request.params[0]).success
    )
      throw badRequest('INVALID_PARAMS', 'Provide one user operation hash');
    return { request, operation: null };
  }
  const operation = userOperation.parse(request.params[0]);
  if (
    typeof request.params[1] !== 'string' ||
    request.params[1].toLowerCase() !== entryPoint08Address.toLowerCase()
  )
    throw badRequest('WRONG_ENTRY_POINT', 'Only EntryPoint v0.8 is supported');
  const paymaster = request.method.startsWith('pm_');
  if (paymaster) {
    if (request.params.length < 3 || request.params[2] !== '0xaa36a7')
      throw badRequest('WRONG_CHAIN', 'Only Ethereum Sepolia sponsorship is supported');
    if (!sponsorshipContext.safeParse(request.params[3]).success)
      throw badRequest('INVALID_CONTEXT', 'Client-supplied sponsorship policies are not allowed');
  } else if (request.params.length !== 2)
    throw badRequest('INVALID_PARAMS', 'Unexpected bundler parameters');
  for (const key of [
    'callGasLimit',
    'verificationGasLimit',
    'preVerificationGas',
    'paymasterVerificationGasLimit',
    'paymasterPostOpGasLimit',
  ] as const) {
    const limit = childGasCaps[key];
    if (BigInt(operation[key] ?? '0x0') > limit)
      throw badRequest('GAS_LIMIT_EXCEEDED', 'Child gas limit exceeds the safety cap');
  }
  for (const key of ['maxFeePerGas', 'maxPriorityFeePerGas'] as const) {
    if (BigInt(operation[key] ?? '0x0') > childFeeCap)
      throw badRequest('FEE_LIMIT_EXCEEDED', 'Child fee exceeds the safety cap');
  }
  try {
    decodeChildCall(operation.callData as Hex);
  } catch {
    throw badRequest('UNSUPPORTED_CHILD_CALL', 'This selector is not permitted for child accounts');
  }
  return { request, operation };
}

export class ChildOperationService {
  private readyCache?: {
    expiresAt: number;
    promise: Promise<{ entryPoint: Hex; bundlerSupported: boolean; paymasterConfigured: boolean }>;
  };
  constructor(
    private readonly settings: Config,
    private readonly accounts: Pick<ChildAccountService, 'validateCall'>,
    private readonly gasEstimator: Pick<
      ChildGasEstimator,
      'stub' | 'verificationGasDelta'
    > = new ChildGasEstimator(settings),
    private readonly limits = new ChildSecurityLimits(settings),
  ) {}

  close() {
    this.limits.close();
  }

  get configured() {
    return Boolean(
      this.settings.CHILD_BUNDLER_RPC_URL &&
      this.settings.CHILD_PAYMASTER_RPC_URL &&
      this.settings.CHILD_PAYMASTER_POLICY_ID,
    );
  }

  readiness() {
    if (this.readyCache && this.readyCache.expiresAt > Date.now()) return this.readyCache.promise;
    const promise = this.checkReadiness().catch((error: unknown) => {
      this.readyCache = undefined;
      throw error;
    });
    this.readyCache = { expiresAt: Date.now() + 30_000, promise };
    return promise;
  }

  private async checkReadiness() {
    if (!this.configured)
      throw unavailable(
        'CHILD_GAS_NOT_CONFIGURED',
        'Configure the child bundler/paymaster URLs and CHILD_PAYMASTER_POLICY_ID',
      );
    const [result, chain] = await Promise.all([
      providerRequest(this.settings.CHILD_BUNDLER_RPC_URL!, {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_supportedEntryPoints',
        params: [],
      }),
      providerRequest(this.settings.CHILD_BUNDLER_RPC_URL!, {
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_chainId',
        params: [],
      }),
    ]);
    if (!chain || typeof chain !== 'object' || !('result' in chain) || chain.result !== '0xaa36a7')
      throw unavailable('WRONG_BUNDLER_CHAIN', 'The child bundler must use Ethereum Sepolia');
    if (
      !result ||
      typeof result !== 'object' ||
      !('result' in result) ||
      !Array.isArray(result.result) ||
      !result.result.some(
        (value: unknown) =>
          typeof value === 'string' && value.toLowerCase() === entryPoint08Address.toLowerCase(),
      )
    )
      throw unavailable(
        'UNSUPPORTED_CHILD_BUNDLER',
        'The configured bundler must support EntryPoint v0.8',
      );
    return { entryPoint: entryPoint08Address, bundlerSupported: true, paymasterConfigured: true };
  }

  async rpc(input: unknown) {
    let checked: ReturnType<typeof validateChildRpc>;
    try {
      checked = validateChildRpc(input);
    } catch (error) {
      if (error instanceof z.ZodError)
        throw badRequest('INVALID_CHILD_OPERATION', 'Invalid child operation payload');
      throw error;
    }
    if (!this.configured)
      throw unavailable(
        'CHILD_GAS_NOT_CONFIGURED',
        'Configure the child bundler/paymaster URLs and CHILD_PAYMASTER_POLICY_ID',
      );
    const { request, operation } = checked;
    if (operation) {
      await this.accounts.validateCall(operation.sender, operation.callData as Hex);
      this.limits.request(operation.sender);
    }
    await this.readiness();
    if (request.method === 'eth_supportedEntryPoints')
      return { jsonrpc: '2.0', id: request.id, result: [entryPoint08Address] };
    const paymaster = request.method.startsWith('pm_');
    const upstream = paymaster
      ? this.settings.CHILD_PAYMASTER_RPC_URL!
      : this.settings.CHILD_BUNDLER_RPC_URL!;
    const estimating = request.method === 'eth_estimateUserOperationGas' && operation !== null;
    // Alchemy's ERC-7677 context is server-owned. Never merge browser policy/webhook/token settings.
    const upstreamRequest = paymaster
      ? {
          ...request,
          params: [
            operation,
            entryPoint08Address,
            '0xaa36a7',
            { policyId: this.settings.CHILD_PAYMASTER_POLICY_ID! },
          ],
        }
      : estimating
        ? { ...request, params: [this.gasEstimator.stub(operation), entryPoint08Address] }
        : request;
    if (operation && request.method === 'eth_sendUserOperation') {
      this.limits.reserve(operation.sender, operation.nonce, maximumSponsorshipCost(operation));
    }
    const result = await providerRequest(upstream, upstreamRequest);
    if (result && typeof result === 'object' && 'error' in result)
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: childProviderError(result.error, this.settings),
      };
    if (!result || typeof result !== 'object' || !('result' in result))
      throw unavailable(
        'INVALID_CHILD_GAS_RESPONSE',
        'The child gas provider returned an invalid response',
      );
    if (paymaster && operation) {
      const quote = z
        .object({
          paymaster: address,
          paymasterData: data,
          paymasterVerificationGasLimit: quantity.optional(),
          paymasterPostOpGasLimit: quantity.optional(),
        })
        .safeParse(result.result);
      if (!quote.success)
        throw unavailable(
          'INVALID_CHILD_GAS_RESPONSE',
          'The paymaster returned invalid sponsorship data',
        );
      const sponsored = { ...operation, ...quote.data };
      validateChildRpc({ ...request, params: [sponsored, entryPoint08Address, '0xaa36a7'] });
      this.limits.reserve(operation.sender, operation.nonce, maximumSponsorshipCost(sponsored));
    }
    if (estimating) {
      const gas = z
        .object({
          callGasLimit: quantity,
          preVerificationGas: quantity,
          verificationGasLimit: quantity,
          paymasterVerificationGasLimit: quantity.optional(),
          paymasterPostOpGasLimit: quantity.optional(),
        })
        .strict()
        .safeParse(result.result);
      if (!gas.success)
        throw unavailable(
          'INVALID_CHILD_GAS_RESPONSE',
          'The bundler returned invalid gas estimates',
        );
      const delta = await this.gasEstimator.verificationGasDelta(operation);
      const corrected = {
        ...gas.data,
        verificationGasLimit: toHex(BigInt(gas.data.verificationGasLimit) + delta),
      };
      // Reuse the same caps enforced on submission. No client can inject overrides.
      validateChildRpc({
        ...request,
        params: [{ ...operation, ...corrected }, entryPoint08Address],
      });
      return { jsonrpc: '2.0', id: request.id, result: corrected };
    }
    if (request.method === 'rundler_maxPriorityFeePerGas') {
      const fee = quantity.safeParse(result.result);
      if (!fee.success || BigInt(fee.data) > 100_000_000_000n)
        throw unavailable(
          'INVALID_CHILD_FEE',
          'The child gas provider returned an invalid or excessive fee',
        );
    }
    return { jsonrpc: '2.0', id: request.id, result: result.result };
  }
}

function childProviderError(input: unknown, settings: Config) {
  const parsed = z
    .object({
      code: z.number().int(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .safeParse(input);
  if (!parsed.success)
    return { code: -32000, message: 'The child gas provider returned an invalid error response.' };

  const { code, message, data } = parsed.data;
  // Only retain diagnostic text, never arbitrary provider data or echoed operations.
  const details = [message];
  if (data && typeof data === 'object') {
    for (const key of ['reason', 'innerReason'] as const) {
      const detail = (data as Record<string, unknown>)[key];
      if (typeof detail === 'string' && !details.includes(detail)) details.push(detail);
    }
  }
  const secrets = new Set<string>([settings.CHILD_PAYMASTER_POLICY_ID ?? '']);
  for (const value of [settings.CHILD_BUNDLER_RPC_URL, settings.CHILD_PAYMASTER_RPC_URL]) {
    if (!value) continue;
    const url = new URL(value);
    for (const part of [
      value,
      url.username,
      url.password,
      ...url.pathname.split('/'),
      ...url.searchParams.values(),
    ]) {
      if (!part) continue;
      secrets.add(part);
      secrets.add(encodeURIComponent(part));
      try {
        secrets.add(decodeURIComponent(part));
      } catch {
        /* Already literal text. */
      }
    }
  }
  let text = details.join(': ');
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length))
    text = text.replaceAll(secret, '[redacted]');
  text = text
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted URL]')
    .replace(/0x[0-9a-f]{64,}/gi, '[redacted data]')
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, 1000);
  return { code, message: `Child gas provider (${code}): ${text || 'Operation rejected.'}` };
}

async function providerRequest(url: string, request: unknown): Promise<unknown> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
    if (!response.body) throw new Error('Provider unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const value: unknown = chunk.value;
        if (!(value instanceof Uint8Array)) throw new Error('Invalid response chunk');
        size += value.byteLength;
        if (size > 200_000) {
          await reader.cancel();
          throw new Error('Oversized response');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    // Some providers return a valid JSON-RPC error with HTTP 400/429.
    if (!response.ok && !(result && typeof result === 'object' && 'error' in result))
      throw new Error('Provider unavailable');
    return result;
  } catch {
    // Avoid leaking credential-bearing provider URLs in logs or error responses.
    throw unavailable(
      'CHILD_GAS_UNAVAILABLE',
      'The child gas provider is unavailable or returned an invalid response',
    );
  }
}
