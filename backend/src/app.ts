import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import type { Config } from './config.js';
import { loadConfig } from './config.js';
import { HttpError } from './errors.js';

export async function buildApp(settings: Config = loadConfig()) {
  const app = Fastify({
    logger: settings.NODE_ENV === 'test' ? false : { level: settings.LOG_LEVEL },
    requestIdHeader: 'x-request-id',
    trustProxy: settings.TRUST_PROXY,
  });

  await app.register(cors, { origin: false });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Star Wallet API',
        version: '0.1.0',
        description:
          'Sepolia protocol utilities and unsigned transaction preparation. Contracts remain authoritative.',
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

  const contractsConfigured = Boolean(
    settings.STAR_REGISTRY_ADDRESS &&
    settings.STAR_TOKEN_ADDRESS &&
    settings.STAR_GOALS_ADDRESS &&
    settings.STAR_FAMILY_VAULT_FACTORY_ADDRESS &&
    settings.STAR_CHILD_ACCOUNT_FACTORY_ADDRESS,
  );

  app.get('/health', async () => ({
    status: 'ok',
    canonicalState: 'sepolia-contracts',
    chainId: settings.CHAIN_ID,
    contractsConfigured,
    signingEnabled: false,
    databaseEnabled: false,
  }));

  app.get('/ready', async () => ({
    status: 'ready',
    chainId: settings.CHAIN_ID,
    rpcConfigured: Boolean(settings.SEPOLIA_RPC_URL),
    contractsConfigured,
  }));

  return app;
}
