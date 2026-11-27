// The job state machine. Every state change of a job is decided here and nowhere else; callers only
// apply the answer, with a conditional update on the state they read.
import type { jobStates } from '../../db/schema/publish.ts';
import type { ConnectorErrorKind, Reconciled } from './connectors/types.ts';

export type JobState = (typeof jobStates)[number];

export type Outcome =
  | { type: 'gate_refused'; reason: string }
  | { type: 'channel_unavailable'; reason: string }
  | { type: 'manual' }
  | { type: 'sent'; externalId: string; url: string }
  | { type: 'error'; kind: ConnectorErrorKind; retryAfterSeconds?: number }
  | { type: 'reconciled'; result: Reconciled }
  /** The send never finished: publishing for longer than a send can take. */
  | { type: 'stalled' }
  // The owner's actions.
  | { type: 'cancel' }
  | { type: 'reschedule'; at: Date }
  | { type: 'retry' }
  | { type: 'confirm_manual'; url: string }
  | { type: 'resolve_unknown'; posted: boolean; url?: string };

export type Next = {
  state: JobState;
  retryable?: boolean;
  /** Send again this many seconds from now (0: at the next check). */
  retryInSeconds?: number;
  error?: string;
  channelStatus?: 'needs_reconnect';
  published?: { externalId: string | null; url: string; manual: boolean };
  /** Set when the outcome does not apply in this state: nothing changes. */
  refused?: string;
};

const MISSED_AFTER_MS = 24 * 3_600_000;
export const MISSED = 'missed its time';
const STALLED = 'the send did not finish';
/** A job due more than 24 hours ago is not sent. */
export const isMissed = (dueAt: Date, now: Date) => now.getTime() - dueAt.getTime() > MISSED_AFTER_MS;

const MAX_RETRY_AFTER = 86_400;

function onError(attempts: number, o: { kind: ConnectorErrorKind; retryAfterSeconds?: number }, maxAttempts: number): Next {
  const spent = attempts >= maxAttempts;
  switch (o.kind) {
    case 'auth':
      return { state: 'blocked', channelStatus: 'needs_reconnect', error: 'The platform refused the channel\'s login: reconnect the channel, then retry' };
    case 'scope':
      return { state: 'failed', retryable: false, error: 'The channel lacks the permission to post this: post it by hand and confirm with its link' };
    case 'rate_limited': {
      if (spent) return { state: 'failed', retryable: true, error: `Still rate limited by the platform after ${attempts} attempts` };
      const s = Number.isFinite(o.retryAfterSeconds) ? Math.round(o.retryAfterSeconds!) : 60;
      return { state: 'scheduled', retryInSeconds: Math.min(Math.max(s, 1), MAX_RETRY_AFTER), error: 'Rate limited by the platform; sending again later' };
    }
    case 'server':
      if (spent) return { state: 'failed', retryable: true, error: `The platform kept failing with a server error after ${attempts} attempts` };
      return { state: 'scheduled', retryInSeconds: 60 * 2 ** attempts, error: 'The platform had a server error; sending again later' };
    case 'timeout':
      return { state: 'unknown', error: 'The send timed out: it may have been posted. Nothing is sent again until that is known' };
    case 'unsupported':
      return { state: 'failed', retryable: false, error: 'The platform does not support this post' };
  }
}

/**
 * The next state of a job after an outcome. `job.attempts` counts the sends tried so far, this one
 * included. Published and cancelled are final: nothing moves a job out of them.
 */
export function nextState(job: { state: JobState; attempts: number; retryable?: boolean }, o: Outcome, maxAttempts: number): Next {
  const s = job.state;
  const refuse = (why: string): Next => ({ state: s, refused: why });
  const from = (...states: JobState[]) => states.includes(s);
  switch (o.type) {
    case 'gate_refused':
    case 'channel_unavailable':
      return from('publishing') ? { state: 'blocked', error: o.reason } : refuse(`Not sending: the job is ${s}`);
    case 'manual':
      return from('publishing') ? { state: 'awaiting_manual' } : refuse(`Not sending: the job is ${s}`);
    case 'sent':
      return from('publishing') ? { state: 'published', published: { externalId: o.externalId, url: o.url, manual: false } } : refuse(`Not sending: the job is ${s}`);
    case 'error':
      return from('publishing') ? onError(job.attempts, o, maxAttempts) : refuse(`Not sending: the job is ${s}`);
    case 'reconciled': {
      if (!from('unknown')) return refuse(`Only an unknown job is reconciled; this one is ${s}`);
      const r = o.result;
      if (r.found === true) return { state: 'published', published: { externalId: r.externalId, url: r.url, manual: false } };
      if (r.found === 'unknown') return { state: 'unknown', error: 'The platform cannot tell whether it was posted: check the channel and say whether it was' };
      // Not there: send again with the same idempotency key, within the attempt limit.
      return job.attempts < maxAttempts
        ? { state: 'scheduled', retryInSeconds: 0, error: 'The platform has no such post; sending again' }
        : { state: 'failed', retryable: true, error: `Not posted after ${job.attempts} attempts` };
    }
    case 'stalled':
      // It may or may not have been posted: nothing is sent again until reconcile or the owner says it was not.
      return from('publishing') ? { state: 'unknown', error: STALLED } : refuse(`Only a publishing job can stall; this one is ${s}`);
    case 'cancel':
      return from('scheduled', 'awaiting_manual', 'blocked', 'failed') ? { state: 'cancelled' } : refuse(`A ${s} job cannot be cancelled`);
    case 'reschedule':
      return from('scheduled', 'blocked') ? { state: 'scheduled' } : refuse(`A ${s} job cannot be moved`);
    case 'retry':
      if (from('unknown')) return refuse('It may have been posted: say whether it was before anything is sent again');
      return (s === 'failed' && job.retryable) || s === 'blocked'
        ? { state: 'scheduled', retryInSeconds: 0 }
        : refuse(s === 'failed' ? 'This failure cannot be retried' : `A ${s} job cannot be retried`);
    case 'confirm_manual':
      return from('awaiting_manual', 'failed') ? { state: 'published', published: { externalId: null, url: o.url, manual: true } } : refuse(`A ${s} job cannot be confirmed`);
    case 'resolve_unknown':
      if (!from('unknown')) return refuse(`Only an unknown job can be resolved; this one is ${s}`);
      if (!o.posted) return { state: 'scheduled', retryInSeconds: 0 };
      return o.url ? { state: 'published', published: { externalId: null, url: o.url, manual: false } } : refuse('Give the post\'s link');
  }
}

/** The owner's actions the job's state allows, from nextState itself. */
export function allowedActions(job: { state: JobState; attempts: number; retryable?: boolean }) {
  const ok = (o: Outcome) => !nextState(job, o, 1).refused;
  return {
    cancel: ok({ type: 'cancel' }),
    reschedule: ok({ type: 'reschedule', at: new Date(0) }),
    retry: ok({ type: 'retry' }),
    confirmManual: ok({ type: 'confirm_manual', url: 'https://example.com' }),
    resolveUnknown: ok({ type: 'resolve_unknown', posted: false }),
  };
}
