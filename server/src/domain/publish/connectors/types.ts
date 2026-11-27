// The connector contract (§20.2). A real platform connector is one file in this folder implementing Connector.
import type { Capabilities } from '../capabilities.ts';

export type PublishRequest = {
  platform: string; accountName: string; caption: string; hashtags: string[];
  media: { key: string; ratio: string; kind: 'image' | 'video' }[];
};
export type PublishResult = { status: 'published'; externalId: string; url: string } | { status: 'manual' };
export type ConnectorErrorKind = 'auth' | 'scope' | 'rate_limited' | 'server' | 'timeout' | 'unsupported';
export type Reconciled = { found: true; externalId: string; url: string } | { found: false } | { found: 'unknown' };

/** auth 401, scope 403, rate_limited 429, server 5xx, timeout: no answer after the request was sent, unsupported: not offered. */
export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly retryAfterSeconds?: number;
  constructor(kind: ConnectorErrorKind, message: string = kind, retryAfterSeconds?: number) {
    super(message);
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface Connector {
  id: 'manual' | 'mock';
  validateCredentials(): Promise<boolean>;
  listCapabilities(platform: string): Capabilities;
  /** Must be safe to call again with the same key: a repeated key is the same post, never a second one. */
  publish(req: PublishRequest, idempotencyKey: string): Promise<PublishResult>;
  /** Looks for the post sent with this key. found 'unknown' when the platform cannot tell. */
  reconcile(idempotencyKey: string): Promise<Reconciled>;
  healthCheck(): Promise<boolean>;
  // The rest of §20.2. Absent ones answer a ConnectorError of kind unsupported, through op().
  connect?(): Promise<void>;
  createDraft?(req: PublishRequest, idempotencyKey: string): Promise<{ externalId: string }>;
  getStatus?(externalId: string): Promise<string>;
  fetchAnalytics?(externalId: string): Promise<Record<string, number>>;
  receiveWebhook?(payload: unknown): Promise<void>;
  refreshToken?(): Promise<void>;
  disconnect?(): Promise<void>;
  getRateLimits?(): Promise<{ remaining: number; resetAt: string } | null>;
  redactLogs?(text: string): string;
}

/** An operation of the connector, or one that throws ConnectorError('unsupported') when the connector lacks it. */
export function op<K extends keyof Connector>(c: Connector, name: K): NonNullable<Connector[K]> {
  const f = c[name];
  if (typeof f === 'function') return f.bind(c) as NonNullable<Connector[K]>;
  return (() => {
    throw new ConnectorError('unsupported', `${c.id} does not support ${String(name)}`);
  }) as unknown as NonNullable<Connector[K]>;
}
