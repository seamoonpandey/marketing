import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { logger } from './log.ts';

serve({ fetch: createApp().fetch, port: config.PORT, hostname: '127.0.0.1' }, (info) =>
  logger.info(`API listening on http://127.0.0.1:${info.port}`),
);
