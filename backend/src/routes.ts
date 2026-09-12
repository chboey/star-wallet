import type { FastifyPluginAsync } from 'fastify';
import { getAddress, isAddress, zeroAddress, type Hex } from 'viem';
import { z } from 'zod';
import type { Config } from './config.js';
import { HttpError, badRequest } from './errors.js';
import type { EnsService } from './services/ens.js';
import type { GraphService } from './services/graph.js';
import { IntentService } from './services/intents.js';
import type { ChildAccountService } from './services/child-accounts.js';
import type { ChildOperationService } from './services/child-operations.js';
import { entryPoint08Address } from 'viem/account-abstraction';
import type { PortfolioService } from './services/portfolio.js';
import type { ProtocolService } from './services/protocol.js';
import { QuestService, type QuestAction, type QuestInput } from './services/quests.js';
import {
  GoalRequestService,
  type GoalRequestAction,
  type GoalRequestInput,
} from './services/goal-requests.js';

const maxUint256 = (1n << 256n) - 1n;
const maxRewardStars = maxUint256 / 1_000_000n;
const nonnegativeUintString = z
  .string()
  .max(78)
  .regex(/^[0-9]+$/)
  .transform((value) => BigInt(value))
  .refine((value) => value <= maxUint256, 'Must fit in uint256');
const uintString = z
  .string()
  .max(78)
  .regex(/^[0-9]+$/)
  .transform((value) => BigInt(value))
  .refine((value) => value > 0n, 'Must be greater than zero')
  .refine((value) => value <= maxUint256, 'Must fit in uint256');
const rewardStarsString = uintString.refine(
  (value) => value <= maxRewardStars,
  'STAR amount is too large for its matching USDC contribution',
);
const utf8String = (maximumBytes: number) =>
  z
    .string()
    .min(1)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= maximumBytes,
      `Must be at most ${maximumBytes} UTF-8 bytes`,
    );
const addressString = z
  .string()
  .refine(isAddress, 'Invalid EVM address')
  .refine((value) => value !== zeroAddress, 'Address must not be zero')
  .transform((value) => getAddress(value));
const bytes32String = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a 32-byte hex value')
  .transform((value) => value as Hex);
const pagination = z.object({
  first: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
});
const snapshotPagination = pagination.extend({
  blockHash: bytes32String.optional(),
});
const activityPagination = z.object({
  first: z.coerce.number().int().min(1).max(100).default(50),
  before: uintString.transform(String).default(maxUint256.toString()),
});

export type RouteServices = {
  childAccounts: ChildAccountService;
  childOperations: ChildOperationService;
  graph: GraphService;
  ens: EnsService;
  portfolio: PortfolioService;
  protocol: ProtocolService;
};

export function protocolRoutes(settings: Config, services: RouteServices): FastifyPluginAsync {
  return async (app) => {
    app.get('/config', async () => ({
      chainId: settings.CHAIN_ID,
      ensParentName: settings.ENS_PARENT_NAME,
    }));
    const { graph, ens, portfolio, protocol, childAccounts, childOperations } = services;
    const quests = new QuestService(settings, protocol, childAccounts);
    const goalRequests = new GoalRequestService(settings, protocol, childAccounts);
    const goalRequestSchemas = {
      request: z
        .object({
          childId: uintString,
          title: utf8String(64).refine((value) => value.trim().length > 0),
          reason: z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= 480),
          icon: z.number().int().min(0).max(6),
          submissionId: bytes32String.refine((value) => !/^0x0{64}$/.test(value)),
        })
        .strict(),
      approve: z
        .object({ childId: uintString, requestId: uintString, starCost: uintString })
        .strict(),
      reject: z.object({ childId: uintString, requestId: uintString }).strict(),
      cancel: z.object({ childId: uintString, requestId: uintString }).strict(),
    };
    for (const action of Object.keys(goalRequestSchemas) as GoalRequestAction[]) {
      app.post(`/intents/goal-requests/${action}`, async (request) =>
        goalRequests.prepare(
          action,
          parse<GoalRequestInput>(goalRequestSchemas[action], request.body),
        ),
      );
    }
    app.get('/families/:familyId/goal-requests', async (request) => {
      const { familyId } = parse(z.object({ familyId: uintString }), request.params);
      const page = parse(snapshotPagination, request.query);
      const capability = await goalRequests.capability();
      if (!capability.supported) return { ...capability, requests: [], nextOffset: null };
      return { ...capability, ...(await graph.goalRequests(familyId.toString(), page)) };
    });
    const questSchemas = {
      create: z
        .object({
          childId: uintString,
          stars: uintString.refine((v) => v <= 1000n),
          text: utf8String(64),
        })
        .strict(),
      cancel: z.object({ childId: uintString, id: uintString }).strict(),
      submit: z
        .object({
          childId: uintString,
          id: uintString,
          submissionId: bytes32String.refine((v) => !/^0x0{64}$/.test(v)),
        })
        .strict(),
      request: z
        .object({
          childId: uintString,
          stars: uintString.refine((v) => v <= 1000n),
          text: utf8String(128),
          submissionId: bytes32String.refine((v) => !/^0x0{64}$/.test(v)),
        })
        .strict(),
      'cancel-request': z.object({ childId: uintString, id: uintString }).strict(),
      approve: z
        .object({
          childId: uintString,
          id: uintString,
          stars: uintString.refine((v) => v <= 1000n),
        })
        .strict(),
      reject: z.object({ childId: uintString, id: uintString }).strict(),
    };
    for (const action of Object.keys(questSchemas) as QuestAction[]) {
      app.post(`/intents/quests/${action}`, async (request) =>
        quests.prepare(action, parse<QuestInput>(questSchemas[action], request.body)),
      );
    }
    app.get('/families/:familyId/inbox', async (request) => {
      const { familyId } = parse(z.object({ familyId: uintString }), request.params);
      const page = parse(
        snapshotPagination.extend({
          childId: uintString.transform(String).optional(),
          view: z.enum(['available', 'waiting', 'history']).default('waiting'),
        }),
        request.query,
      );
      return graph.inbox(familyId.toString(), page);
    });
    let intentService: IntentService | undefined;
    const intents = () => (intentService ??= createIntentService(settings));
    const positionInput = z.object({
      familyId: uintString,
      usdcAmountUnits: uintString.refine(
        (value) => value <= settings.AQUA_MAX_POSITION_USDC_UNITS,
        'USDC amount exceeds the configured per-position cap',
      ),
      wethAmountUnits: uintString.refine(
        (value) => value <= settings.AQUA_MAX_POSITION_WETH_UNITS,
        'WETH amount exceeds the configured per-position cap',
      ),
      feeBps: z.number().int().min(0).max(1_000).default(30),
      priceBandBps: z
        .number()
        .int()
        .min(25)
        .max(settings.AQUA_MAX_PRICE_DEVIATION_BPS)
        .default(settings.AQUA_DEFAULT_PRICE_BAND_BPS),
      validForSeconds: z
        .number()
        .int()
        .min(120)
        .max(settings.AQUA_MAX_STRATEGY_LIFETIME_SECONDS)
        .default(settings.AQUA_DEFAULT_STRATEGY_LIFETIME_SECONDS),
    });

    app.addHook('preHandler', async (request) => {
      if (request.routeOptions.url?.includes('/intents/')) await protocol.ensureReady();
    });

    app.get('/families/:familyId', async (request, reply) => {
      const input = parse(z.object({ familyId: uintString }), request.params);
      const page = parse(snapshotPagination, request.query);
      const family = await graph.family(input.familyId.toString(), page);
      if (family === null) return reply.code(404).send({ code: 'FAMILY_NOT_FOUND' });
      return family;
    });

    app.get('/families/by-parent/:parent', async (request) => {
      const input = parse(z.object({ parent: addressString }), request.params);
      return graph.familiesByParent(input.parent, parse(snapshotPagination, request.query));
    });

    app.get('/families/:familyId/activity', async (request) => {
      const input = parse(z.object({ familyId: uintString }), request.params);
      const page = parse(activityPagination, request.query);
      return graph.familyActivities(input.familyId.toString(), page.first, page.before);
    });

    app.get('/children/by-wallet/:wallet', async (request, reply) => {
      const input = parse(z.object({ wallet: addressString }), request.params);
      const page = parse(snapshotPagination, request.query);
      const child = await graph.childByWallet(input.wallet, page);
      if (child === null) return reply.code(404).send({ code: 'CHILD_NOT_FOUND' });
      return child;
    });

    app.get('/families/:familyId/portfolio', async (request, reply) => {
      const input = parse(z.object({ familyId: uintString }), request.params);
      const balances = await graph.portfolioBalances(input.familyId.toString());
      if (balances === null) return reply.code(404).send({ code: 'FAMILY_NOT_FOUND' });
      return portfolio.value(balances);
    });

    app.get('/indexing/status', async () => graph.indexingStatus());

    app.get('/protocol/state', async (_request, reply) => {
      const state = await graph.protocolState();
      if (state === null) return reply.code(404).send({ code: 'PROTOCOL_STATE_NOT_FOUND' });
      return state;
    });

    app.get('/ens/resolve', async (request) => {
      const input = parse(
        z.object({ name: z.string().min(1), expectedAddress: addressString.optional() }),
        request.query,
      );
      return ens.inspect(input.name, input.expectedAddress);
    });

    app.get('/ens/namespace', async (request) => {
      const input = parse(z.object({ name: z.string().min(1).max(255).optional() }), request.query);
      return ens.namespace(input.name);
    });

    // Unsigned ENS steps work independently of Star contract deployment/readiness.
    app.post('/ens/namespace', async (request) => {
      const input = parse(
        z.object({ name: z.string().min(1).max(255).optional(), signer: addressString }).strict(),
        request.body,
      );
      return ens.prepareNamespace(input.signer, input.name);
    });

    app.post('/ens/subdomains', async (request) => {
      const input = parse(
        z
          .object({
            parentName: z.string().min(1).max(255).optional(),
            label: utf8String(63),
            signer: addressString,
            owner: addressString,
            address: addressString,
            expiresAt: uintString
              .refine((value) => value < 1n << 64n, 'Must fit in uint64')
              .optional(),
          })
          .strict(),
        request.body,
      );
      return ens.prepareSubdomain(input);
    });

    app.post('/ens/families', async (request) => {
      const input = parse(
        z
          .object({
            signer: addressString,
            label: utf8String(63),
            secret: z
              .string()
              .regex(/^0x[0-9a-fA-F]{64}$/)
              .transform((value) => value as `0x${string}`),
          })
          .strict(),
        request.body,
      );
      return ens.prepareFamily(input);
    });

    app.post('/intents/families', async (request) => {
      const input = parse(z.object({ ensName: z.string().min(1) }), request.body);
      const ensName = ens.requireManagedName(input.ensName);
      return intents().createFamily(ensName);
    });

    app.post('/intents/families/vault', async (request) => {
      const input = parse(z.object({ familyId: uintString }), request.body);
      return intents().createFamilyVault(input.familyId);
    });

    app.get('/child-accounts/config', async () => {
      const { addresses } = await protocol.ensureReady();
      return {
        chainId: 11155111,
        entryPoint: entryPoint08Address,
        factory: addresses.childAccountFactory,
        rpId: settings.CHILD_ACCOUNT_RP_ID,
        sponsorshipConfigured: childOperations.configured,
      };
    });
    app.get('/child-accounts/lookup', async (request) => {
      const input = parse(
        z.object({ familyId: uintString, ensName: z.string().min(1).max(255) }).strict(),
        request.query,
      );
      return childAccounts.findByName(input.familyId, ens.requireManagedName(input.ensName));
    });
    app.get('/child-accounts/:wallet', async (request) => {
      const { wallet } = parse(z.object({ wallet: addressString }), request.params);
      const account = await childAccounts.resolve(wallet);
      return { ...account, familyId: account.familyId.toString() };
    });
    app.post(
      '/child-accounts/rpc',
      { bodyLimit: 32_000, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
      async (request) => childOperations.rpc(request.body),
    );

    app.post('/intents/children/account', async (request) => {
      const input = parse(
        z
          .object({
            familyId: uintString,
            ensName: z.string().min(1).max(255),
            credential: z
              .object({
                id: z
                  .string()
                  .min(1)
                  .max(1024)
                  .regex(/^[A-Za-z0-9_-]+$/),
                publicKey: z
                  .string()
                  .regex(/^0x[0-9a-fA-F]{128}$/)
                  .transform((value) => value as Hex),
              })
              .strict(),
          })
          .strict(),
        request.body,
      );
      const ensName = ens.requireManagedName(input.ensName);
      const account = await childAccounts.prepare(input.familyId, ensName, input.credential);
      return intents().createChildAccount({ ...input, ensName, ...account });
    });

    app.post('/intents/children', async (request) => {
      const input = parse(
        z.object({
          familyId: uintString,
          childWallet: addressString,
          ensName: z.string().min(1),
        }),
        request.body,
      );
      const ensName = ens.requireManagedName(input.ensName);
      const resolution = await ens.inspect(ensName, input.childWallet);
      if (!resolution.matchesExpected) {
        throw badRequest(
          'ENS_ADDRESS_MISMATCH',
          'The child ENS name must resolve to the child smart wallet before registration',
          resolution,
        );
      }
      const account = await childAccounts.registration(input.familyId, input.childWallet, ensName);
      return intents().registerChild({ ...input, ensName, state: account.state });
    });

    app.post('/intents/families/status', async (request) => {
      const input = parse(z.object({ familyId: uintString, active: z.boolean() }), request.body);
      return intents().setFamilyStatus(input.familyId, input.active);
    });

    app.post('/intents/children/status', async (request) => {
      const input = parse(z.object({ childId: uintString, active: z.boolean() }), request.body);
      return intents().setChildStatus(input.childId, input.active);
    });

    app.post('/intents/children/registration/cancel', async (request) => {
      const input = parse(z.object({ registrationId: bytes32String }), request.body);
      return intents().cancelChildRegistration(input.registrationId);
    });

    app.post('/intents/children/registration/reject', async (request) => {
      const input = parse(z.object({ registrationId: bytes32String }), request.body);
      return intents().cancelChildRegistration(input.registrationId);
    });

    app.post('/intents/rewards', async (request) => {
      const input = parse(
        z.object({ childId: uintString, stars: rewardStarsString, reason: utf8String(128) }),
        request.body,
      );
      const { vault } = await protocol.resolveChildVault(input.childId);
      return intents().reward({ ...input, vault });
    });

    app.post('/intents/goals', async (request) => {
      const input = parse(
        z.object({ childId: uintString, title: utf8String(64), starCost: uintString }),
        request.body,
      );
      return intents().createGoal(input);
    });

    app.post('/intents/goals/cancel', async (request) => {
      const input = parse(z.object({ goalId: uintString }), request.body);
      return intents().cancelGoal(input.goalId);
    });

    app.post('/intents/goals/add-stars', async (request) => {
      const input = parse(
        z.object({ goalId: uintString, amount: uintString }).strict(),
        request.body,
      );
      const account = await childAccounts.forAction('goal', input.goalId);
      const plan = intents().addStarsToGoal(input.goalId, input.amount, account.wallet);
      await childAccounts.validateCall(account.wallet, plan.intents[0]!.data);
      return plan;
    });

    app.post('/intents/redemptions/request', async (request) => {
      const input = parse(z.object({ goalId: uintString }), request.body);
      const account = await childAccounts.forAction('goal', input.goalId);
      return intents().requestRedemption(input.goalId, account.wallet);
    });

    app.post('/intents/redemptions/cancel', async (request) => {
      const input = parse(z.object({ redemptionId: uintString }), request.body);
      const account = await childAccounts.forAction('redemption', input.redemptionId);
      return intents().cancelRedemption(input.redemptionId, account.wallet);
    });

    app.post('/intents/redemptions/approve', async (request) => {
      const input = parse(z.object({ redemptionId: uintString }), request.body);
      return intents().resolveRedemption(input.redemptionId, true);
    });

    app.post('/intents/redemptions/reject', async (request) => {
      const input = parse(z.object({ redemptionId: uintString }), request.body);
      return intents().resolveRedemption(input.redemptionId, false);
    });

    app.post('/intents/savings/withdraw', async (request) => {
      const input = parse(
        z.object({ familyId: uintString, amountUsdcUnits: uintString, recipient: addressString }),
        request.body,
      );
      const { vault } = await protocol.resolveFamilyVault(input.familyId);
      return intents().withdrawSavings({
        familyId: input.familyId,
        vault,
        amount: input.amountUsdcUnits,
        recipient: input.recipient,
      });
    });

    app.post('/intents/savings/fund-weth', async (request) => {
      const input = parse(
        z.object({ familyId: uintString, amountWethUnits: uintString }),
        request.body,
      );
      const { vault } = await protocol.resolveFamilyVault(input.familyId);
      return intents().fundStrategyWeth({
        familyId: input.familyId,
        vault,
        amount: input.amountWethUnits,
      });
    });

    app.post('/intents/savings/withdraw-weth', async (request) => {
      const input = parse(
        z.object({ familyId: uintString, amountWethUnits: uintString, recipient: addressString }),
        request.body,
      );
      const { vault } = await protocol.resolveFamilyVault(input.familyId);
      return intents().withdrawStrategyWeth({
        familyId: input.familyId,
        vault,
        amount: input.amountWethUnits,
        recipient: input.recipient,
      });
    });

    app.post('/intents/savings/ship', async (request) => {
      const input = parse(positionInput, request.body);
      const { vault } = await protocol.resolveFamilyVault(input.familyId);
      return intents().shipSavings({
        familyId: input.familyId,
        vault,
        usdcAmount: input.usdcAmountUnits,
        wethAmount: input.wethAmountUnits,
        feeBps: input.feeBps,
        priceBandBps: input.priceBandBps,
        validForSeconds: input.validForSeconds,
      });
    });

    app.post('/intents/savings/dock', async (request) => {
      const input = parse(z.object({ familyId: uintString }), request.body);
      const { vault } = await protocol.resolveFamilyVault(input.familyId);
      return intents().dockSavings(input.familyId, vault);
    });

    app.post('/intents/savings/add', async (request) => {
      const input = parse(
        z
          .object({
            familyId: uintString,
            expectedStrategyHash: bytes32String.refine((value) => !/^0x0{64}$/.test(value)),
            usdcAmountUnits: nonnegativeUintString,
            wethAmountUnits: nonnegativeUintString,
          })
          .strict()
          .refine(
            (value) => value.usdcAmountUnits > 0n || value.wethAmountUnits > 0n,
            'Choose a nonzero USDC or WETH amount',
          ),
        request.body,
      );
      const { vault } = await protocol.resolveFamilyVault(input.familyId);
      return intents().addSavings({
        familyId: input.familyId,
        vault,
        expectedStrategyHash: input.expectedStrategyHash,
        usdcAmount: input.usdcAmountUnits,
        wethAmount: input.wethAmountUnits,
      });
    });

    app.post('/intents/savings/replace', async (request) => {
      const input = parse(positionInput, request.body);
      const { vault } = await protocol.resolveFamilyVault(input.familyId);
      return intents().replaceSavings({
        familyId: input.familyId,
        vault,
        usdcAmount: input.usdcAmountUnits,
        wethAmount: input.wethAmountUnits,
        feeBps: input.feeBps,
        priceBandBps: input.priceBandBps,
        validForSeconds: input.validForSeconds,
      });
    });

    app.post('/intents/savings/aqua-pause', async (request) => {
      const input = parse(z.object({ familyId: uintString, paused: z.boolean() }), request.body);
      const { vault, positionActive } = await protocol.resolveFamilyVault(input.familyId);
      return intents().setAquaPaused(input.familyId, vault, input.paused, positionActive);
    });
  };
}

function createIntentService(settings: Config): IntentService {
  try {
    return new IntentService(settings);
  } catch (error) {
    throw new HttpError(
      503,
      'PROTOCOL_NOT_CONFIGURED',
      error instanceof Error ? error.message : 'Protocol addresses are not configured',
    );
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest('INVALID_REQUEST', 'The request is invalid', result.error.flatten());
  }
  return result.data;
}
