import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import type { Config } from './config.js';
import { loadConfig } from './config.js';
import { HttpError } from './errors.js';
import { protocolRoutes } from './routes.js';
import { EnsService } from './services/ens.js';
import { GraphService } from './services/graph.js';
import { PortfolioService } from './services/portfolio.js';
import { ProtocolService } from './services/protocol.js';
import { ChildAccountService } from './services/child-accounts.js';
import { ChildOperationService } from './services/child-operations.js';

export async function buildApp(settings: Config = loadConfig()) {
  const app = Fastify({
    logger: settings.NODE_ENV === 'test' ? false : { level: settings.LOG_LEVEL },
    requestIdHeader: 'x-request-id',
    trustProxy: settings.TRUST_PROXY,
  });

  const protocol = new ProtocolService(settings);
  const childAccounts = new ChildAccountService(settings, protocol);
  const services = {
    childAccounts,
    childOperations: new ChildOperationService(settings, childAccounts),
    graph: new GraphService(settings),
    ens: new EnsService(settings),
    portfolio: new PortfolioService(settings),
    protocol,
  };
  app.addHook('onClose', async () => services.childOperations.close());

  await app.register(cors, { origin: false });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Star Wallet API',
        version: '0.2.0',
        description:
          'Sepolia indexed reads, ENSv2 resolution and unsigned subdomain registration, direct-RPC safety checks, and unsigned transaction intents. Sepolia contracts remain authoritative.',
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      if (error.statusCode >= 500) request.log.error(error);
      if (
        error.statusCode === 429 &&
        error.details &&
        typeof error.details === 'object' &&
        'retryAfterSeconds' in error.details &&
        typeof error.details.retryAfterSeconds === 'number'
      ) {
        reply.header('Retry-After', error.details.retryAfterSeconds);
      }
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.statusCode < 500 ? error.details : undefined,
        requestId: request.id,
      });
    }
    // Preserve Fastify's client errors (malformed JSON, body limits, rate limits).
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({
        code: 'code' in error && typeof error.code === 'string' ? error.code : 'INVALID_REQUEST',
        message: error.message,
        requestId: request.id,
      });
    }
    request.log.error(error);
    return reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: request.id,
    });
  });

  app.get('/health', async () => ({
    status: 'ok',
    canonicalState: 'sepolia-contracts',
    readModel: 'subgraph',
    chainId: settings.CHAIN_ID,
    contractsConfigured: Boolean(
      settings.STAR_REGISTRY_ADDRESS &&
      settings.STAR_TOKEN_ADDRESS &&
      settings.STAR_GOALS_ADDRESS &&
      settings.STAR_FAMILY_VAULT_FACTORY_ADDRESS &&
      settings.STAR_CHILD_ACCOUNT_FACTORY_ADDRESS,
    ),
    subgraphConfigured: Boolean(settings.STAR_SUBGRAPH_URL && settings.STAR_SUBGRAPH_DEPLOYMENT_ID),
    signingEnabled: false,
    childSponsorshipConfigured: services.childOperations.configured,
    databaseEnabled: false, // No application-state database.
    securityCountersPersistent: settings.NODE_ENV !== 'test',
  }));

  app.get('/ready', async () => {
    const [protocol, ens, subgraph, portfolio, childAccounts] = await Promise.all([
      services.protocol.ensureReady(),
      services.ens.readiness(),
      services.graph.indexingStatus(),
      services.portfolio.readiness(),
      services.childOperations.readiness(),
    ]);

    return {
      status: 'ready',
      protocol,
      ens,
      subgraph,
      portfolio,
      childAccounts,
    };
  });

  await app.register(protocolRoutes(settings, services), { prefix: '/v1' });
  return app;
}
