// Tests only. Programmed per idempotency key with a list of outcomes; records every publish call. Like a
// real platform's idempotency, a key that already made a post returns that post and never makes another.
import { CAPABILITIES, type Platform } from '../capabilities.ts';
import { ConnectorError, type Connector, type ConnectorErrorKind, type PublishRequest, type PublishResult, type Reconciled } from './types.ts';

export type MockStep =
  | { result: 'published' }
  /** No answer after sending; posted says whether the post was made anyway. */
  | { result: 'timeout'; posted: boolean }
  | { result: 'error'; kind: ConnectorErrorKind; retryAfterSeconds?: number };

export class MockConnector implements Connector {
  readonly id = 'mock' as const;
  readonly calls: { req: PublishRequest; idempotencyKey: string }[] = [];
  readonly posts = new Map<string, { externalId: string; url: string }>();
  private steps = new Map<string, MockStep[]>();
  private answers = new Map<string, Reconciled[]>();

  /** What publish does for this key, call by call; once the list is used up, it publishes. */
  program(key: string, ...steps: MockStep[]): this {
    this.steps.set(key, [...(this.steps.get(key) ?? []), ...steps]);
    return this;
  }

  /** What reconcile answers for this key, call by call; once used up, it looks at the posts made. */
  programReconcile(key: string, ...answers: Reconciled[]): this {
    this.answers.set(key, [...(this.answers.get(key) ?? []), ...answers]);
    return this;
  }

  callsFor(key: string) {
    return this.calls.filter((c) => c.idempotencyKey === key);
  }

  reset(): void {
    this.calls.length = 0;
    this.posts.clear();
    this.steps.clear();
    this.answers.clear();
  }

  async publish(req: PublishRequest, idempotencyKey: string): Promise<PublishResult> {
    this.calls.push({ req, idempotencyKey });
    const made = this.posts.get(idempotencyKey);
    if (made) return { status: 'published', ...made };
    const step = this.steps.get(idempotencyKey)?.shift() ?? { result: 'published' };
    if (step.result === 'error') throw new ConnectorError(step.kind, `mock ${step.kind}`, step.retryAfterSeconds);
    if (step.result === 'published' || step.posted) {
      const n = this.posts.size + 1;
      this.posts.set(idempotencyKey, { externalId: `mock-${n}`, url: `https://mock.example/post/${n}` });
    }
    if (step.result === 'timeout') throw new ConnectorError('timeout', 'mock timeout');
    return { status: 'published', ...this.posts.get(idempotencyKey)! };
  }

  async reconcile(idempotencyKey: string): Promise<Reconciled> {
    const answer = this.answers.get(idempotencyKey)?.shift();
    if (answer) return answer;
    const made = this.posts.get(idempotencyKey);
    return made ? { found: true, ...made } : { found: false };
  }

  validateCredentials = async () => true;
  healthCheck = async () => true;
  listCapabilities = (platform: string) => CAPABILITIES[platform as Platform];
}
