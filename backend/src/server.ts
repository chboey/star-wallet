import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const settings = loadConfig();
const app = await buildApp(settings);

try {
  await app.listen({ host: settings.HOST, port: settings.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
