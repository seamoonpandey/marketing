import type { Channel } from '../channels.ts';
import { manualConnector } from './manual.ts';
import { MockConnector } from './mock.ts';
import type { Connector } from './types.ts';

export { manualConnector } from './manual.ts';
export { MockConnector, type MockStep } from './mock.ts';
export * from './types.ts';

/** The mock that channels with connector 'mock' use. Tests only: no route creates such a channel. */
export const mockConnector = new MockConnector();

/** A manual channel always gets the manual connector, whatever else is passed: it never sends. */
export function connectorFor(channel: Pick<Channel, 'mode' | 'connector'>, apiConnector?: Connector): Connector {
  if (channel.mode !== 'api') return manualConnector;
  return apiConnector ?? (channel.connector === 'mock' ? mockConnector : manualConnector);
}
