// The manual connector: nothing is sent. At its time the job waits for the owner to post it by hand.
import { CAPABILITIES, type Platform } from '../capabilities.ts';
import type { Connector } from './types.ts';

export const manualConnector: Connector = {
  id: 'manual',
  validateCredentials: async () => true,
  listCapabilities: (platform) => CAPABILITIES[platform as Platform],
  publish: async () => ({ status: 'manual' }),
  reconcile: async () => ({ found: 'unknown' }),
  healthCheck: async () => true,
};
