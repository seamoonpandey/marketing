import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { logger } from './log.ts';
import { ensureBucket } from './storage/index.ts';
import { launchWorkflows } from './workflows/index.ts';

// createApp's import of src/modules.ts has registered every workflow by now.
const app = createApp();
await ensureBucket();
await launchWorkflows();
serve({ fetch: app.fetch, port: config.PORT, hostname: '127.0.0.1' }, (info) =>
  logger.info(`API listening on http://127.0.0.1:${info.port}`),
);
