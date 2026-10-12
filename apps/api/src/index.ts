import { loadConfig } from './config.js';
import { buildApp } from './app.js';
const cfg = loadConfig();
const app = await buildApp(cfg);
await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
