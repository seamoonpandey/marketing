import { describe, expect, it } from 'vitest';
import { jobStates } from '../../db/schema/publish.ts';
import { allowedActions, isMissed, nextState, type JobState, type Outcome } from './state.ts';

const MAX = 3;
const at = (state: JobState, attempts = 1, retryable = false) => ({ state, attempts, retryable });

// One sample of every outcome, sends and owner actions alike.
const outcomes: Outcome[] = [
  { type: 'gate_refused', reason: 'gate' },
  { type: 'channel_unavailable', reason: 'channel' },
  { type: 'manual' },
  { type: 'sent', externalId: 'e1', url: 'https://p/1' },
  ...(['auth', 'scope', 'rate_limited', 'server', 'timeout', 'unsupported'] as const).map((kind) => ({ type: 'error' as const, kind })),
  { type: 'reconciled', result: { found: true, externalId: 'e2', url: 'https://p/2' } },
  { type: 'reconciled', result: { found: false } },
  { type: 'reconciled', result: { found: 'unknown' } },
  { type: 'stalled' },
  { type: 'cancel' },
  { type: 'reschedule', at: new Date() },
  { type: 'retry' },
  { type: 'confirm_manual', url: 'https://p/3' },
  { type: 'resolve_unknown', posted: true, url: 'https://p/4' },
  { type: 'resolve_unknown', posted: false },
];

describe('nextState: the error table (§20.3) from publishing', () => {
  const err = (kind: Parameters<typeof nextState>[1] & { type: 'error' }) => kind;
  it('401 blocks the job and asks to reconnect the channel', () => {
    expect(nextState(at('publishing'), err({ type: 'error', kind: 'auth' }), MAX)).toMatchObject({ state: 'blocked', channelStatus: 'needs_reconnect', error: expect.stringMatching(/reconnect/) });
  });
  it('403 fails the job, not retryable, offering to post by hand', () => {
    expect(nextState(at('publishing'), err({ type: 'error', kind: 'scope' }), MAX)).toMatchObject({ state: 'failed', retryable: false, error: expect.stringMatching(/by hand/) });
  });
  it('429 is retried after the time the platform gives, 60 seconds without one, at most a day, until the attempts run out', () => {
    expect(nextState(at('publishing'), { type: 'error', kind: 'rate_limited', retryAfterSeconds: 120 }, MAX)).toMatchObject({ state: 'scheduled', retryInSeconds: 120 });
    expect(nextState(at('publishing'), { type: 'error', kind: 'rate_limited' }, MAX)).toMatchObject({ state: 'scheduled', retryInSeconds: 60 });
    expect(nextState(at('publishing'), { type: 'error', kind: 'rate_limited', retryAfterSeconds: 10 ** 9 }, MAX).retryInSeconds).toBe(86_400);
    expect(nextState(at('publishing'), { type: 'error', kind: 'rate_limited', retryAfterSeconds: -5 }, MAX).retryInSeconds).toBe(1);
    expect(nextState(at('publishing', 3), { type: 'error', kind: 'rate_limited', retryAfterSeconds: 120 }, MAX)).toMatchObject({ state: 'failed', retryable: true });
  });
  it('5xx retries after 60 × 2^attempts seconds until the attempts reach the limit, then fails retryable', () => {
    expect(nextState(at('publishing', 1), { type: 'error', kind: 'server' }, MAX)).toMatchObject({ state: 'scheduled', retryInSeconds: 120 });
    expect(nextState(at('publishing', 2), { type: 'error', kind: 'server' }, MAX)).toMatchObject({ state: 'scheduled', retryInSeconds: 240 });
    expect(nextState(at('publishing', 3), { type: 'error', kind: 'server' }, MAX)).toMatchObject({ state: 'failed', retryable: true });
    expect(nextState(at('publishing', 1), { type: 'error', kind: 'server' }, 1)).toMatchObject({ state: 'failed', retryable: true });
  });
  it('a timeout is unknown whatever the attempt count', () => {
    for (const attempts of [1, 3, 99]) expect(nextState(at('publishing', attempts), { type: 'error', kind: 'timeout' }, MAX)).toMatchObject({ state: 'unknown' });
  });
  it('unsupported at send time fails, not retryable', () => {
    expect(nextState(at('publishing'), { type: 'error', kind: 'unsupported' }, MAX)).toMatchObject({ state: 'failed', retryable: false });
  });
  it('the gate or the channel saying no blocks with its reason; manual waits for the owner; sent publishes', () => {
    expect(nextState(at('publishing'), { type: 'gate_refused', reason: 'missed its time' }, MAX)).toEqual({ state: 'blocked', error: 'missed its time' });
    expect(nextState(at('publishing'), { type: 'channel_unavailable', reason: 'The channel is disabled' }, MAX)).toEqual({ state: 'blocked', error: 'The channel is disabled' });
    expect(nextState(at('publishing'), { type: 'manual' }, MAX)).toEqual({ state: 'awaiting_manual' });
    expect(nextState(at('publishing'), { type: 'sent', externalId: 'e', url: 'https://p' }, MAX)).toEqual({ state: 'published', published: { externalId: 'e', url: 'https://p', manual: false } });
  });
});

describe('nextState: a send that never finished', () => {
  it('a job publishing too long becomes unknown, attempts unchanged, with nothing to retry', () => {
    expect(nextState(at('publishing', 2), { type: 'stalled' }, MAX)).toEqual({ state: 'unknown', error: 'the send did not finish' });
  });
});

describe('nextState: reconciling an unknown job', () => {
  it('found publishes, without another send', () => {
    expect(nextState(at('unknown'), { type: 'reconciled', result: { found: true, externalId: 'e', url: 'https://p' } }, MAX))
      .toEqual({ state: 'published', published: { externalId: 'e', url: 'https://p', manual: false } });
  });
  it('not found schedules an immediate retry, until the attempts reach the limit', () => {
    expect(nextState(at('unknown', 1), { type: 'reconciled', result: { found: false } }, MAX)).toMatchObject({ state: 'scheduled', retryInSeconds: 0 });
    expect(nextState(at('unknown', 3), { type: 'reconciled', result: { found: false } }, MAX)).toMatchObject({ state: 'failed', retryable: true });
  });
  it('cannot tell stays unknown and sends nothing', () => {
    const n = nextState(at('unknown'), { type: 'reconciled', result: { found: 'unknown' } }, MAX);
    expect(n).toMatchObject({ state: 'unknown' });
    expect(n.retryInSeconds).toBeUndefined();
    expect(n.refused).toBeUndefined();
  });
  it('is refused for any job that is not unknown', () => {
    for (const s of jobStates.filter((s) => s !== 'unknown'))
      expect(nextState(at(s), { type: 'reconciled', result: { found: true, externalId: 'e', url: 'https://p' } }, MAX)).toMatchObject({ state: s, refused: expect.any(String) });
  });
});

describe('nextState: every state and outcome', () => {
  // The transitions that apply; every other pair is refused and leaves the state as it was.
  const applies: Record<JobState, string[]> = {
    scheduled: ['cancel', 'reschedule'],
    publishing: ['gate_refused', 'channel_unavailable', 'manual', 'sent', 'error', 'stalled'],
    awaiting_manual: ['cancel', 'confirm_manual'],
    published: [],
    unknown: ['reconciled', 'resolve_unknown'],
    blocked: ['cancel', 'reschedule', 'retry'],
    failed: ['cancel', 'confirm_manual'], // retry too, when retryable (below)
    cancelled: [],
  };
  for (const s of jobStates)
    it(`from ${s}`, () => {
      for (const o of outcomes) {
        const n = nextState(at(s), o, MAX);
        if (applies[s].includes(o.type)) expect(n.refused, `${s} + ${o.type}`).toBeUndefined();
        else expect(n, `${s} + ${o.type}`).toEqual({ state: s, refused: expect.any(String) });
      }
    });

  it('retry: failed and retryable, or blocked; never unknown', () => {
    expect(nextState(at('failed', 3, true), { type: 'retry' }, MAX)).toEqual({ state: 'scheduled', retryInSeconds: 0 });
    expect(nextState(at('failed', 1, false), { type: 'retry' }, MAX).refused).toMatch(/cannot be retried/);
    expect(nextState(at('blocked'), { type: 'retry' }, MAX)).toEqual({ state: 'scheduled', retryInSeconds: 0 });
    expect(nextState(at('unknown'), { type: 'retry' }, MAX).refused).toMatch(/may have been posted/);
  });

  it('owner actions land where the design says', () => {
    expect(nextState(at('scheduled'), { type: 'cancel' }, MAX)).toEqual({ state: 'cancelled' });
    expect(nextState(at('awaiting_manual'), { type: 'confirm_manual', url: 'https://p' }, MAX)).toEqual({ state: 'published', published: { externalId: null, url: 'https://p', manual: true } });
    expect(nextState(at('unknown'), { type: 'resolve_unknown', posted: true, url: 'https://p' }, MAX)).toEqual({ state: 'published', published: { externalId: null, url: 'https://p', manual: false } });
    expect(nextState(at('unknown'), { type: 'resolve_unknown', posted: true }, MAX).refused).toMatch(/link/);
    expect(nextState(at('unknown', 9), { type: 'resolve_unknown', posted: false }, MAX)).toEqual({ state: 'scheduled', retryInSeconds: 0 });
  });

  it('no sequence of outcomes moves a job out of published or cancelled', () => {
    let seed = 42;
    const rand = (n: number) => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) % n;
    for (let run = 0; run < 2000; run++) {
      let job = at(jobStates[rand(jobStates.length)]!, 1 + rand(5), rand(2) === 1);
      let final: JobState | null = null;
      for (let step = 0; step < 30; step++) {
        const n = nextState(job, outcomes[rand(outcomes.length)]!, 1 + rand(5));
        if (final) expect(n.state).toBe(final);
        if (!n.refused) job = { state: n.state, attempts: job.attempts + (n.state === 'publishing' ? 1 : 0), retryable: n.retryable ?? false };
        // The claim (scheduled to publishing) is the database's conditional update, not an outcome.
        if (job.state === 'scheduled' && rand(2)) job = { ...job, state: 'publishing', attempts: job.attempts + 1 };
        if (job.state === 'published' || job.state === 'cancelled') final ??= job.state;
      }
    }
  });
});

describe('allowedActions and isMissed', () => {
  it('offers only what nextState allows', () => {
    expect(allowedActions(at('scheduled'))).toEqual({ cancel: true, reschedule: true, retry: false, confirmManual: false, resolveUnknown: false });
    expect(allowedActions(at('awaiting_manual'))).toEqual({ cancel: true, reschedule: false, retry: false, confirmManual: true, resolveUnknown: false });
    expect(allowedActions(at('unknown'))).toEqual({ cancel: false, reschedule: false, retry: false, confirmManual: false, resolveUnknown: true });
    expect(allowedActions(at('failed', 3, true)).retry).toBe(true);
    expect(allowedActions(at('published'))).toEqual({ cancel: false, reschedule: false, retry: false, confirmManual: false, resolveUnknown: false });
  });
  it('a job is missed only after more than 24 hours', () => {
    const due = new Date('2026-12-01T00:00:00Z');
    expect(isMissed(due, new Date('2026-12-01T00:30:00Z'))).toBe(false);
    expect(isMissed(due, new Date('2026-12-02T00:00:00Z'))).toBe(false);
    expect(isMissed(due, new Date('2026-12-02T00:00:00.001Z'))).toBe(true);
  });
});
