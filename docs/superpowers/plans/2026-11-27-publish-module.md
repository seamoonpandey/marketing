# Publish module: implementation plan

> This is the plan the module was built from, kept for reference. `docs/structure.md` and the code are the current truth.

> **For the agents executing this plan:** work on branch `product/publish`. One agent runs tasks 1 to 6 (server) in the worktree `.claude/worktrees/publish`. A second agent runs task 7 (screens) in its own worktree from the committed contract. Each task: write the listed tests, watch them fail, implement, run the check, commit.

**Goal:** schedule approved drafts to channels and send them through a connector, with a state machine that never posts twice and never posts something whose approval is no longer valid.

**Architecture:** a `Connector` interface with two implementations, `manual` and `mock`. A pure `nextState` function holds the state machine. One DBOS workflow sends a job; a scheduled workflow starts due jobs every minute. Approve and Studio are read through one adapter file with interfaces the tests replace with fakes, because both are being built on other branches.

**Tech stack:** as the base branch. Add no dependency.

**Spec:** `docs/superpowers/specs/2026-11-27-publish-design.md` (whole file) and `docs/structure.md`. In the requirements spec read only lines 1385–1420 (§9 to §9.2) and 1972–1978 (§20.2 and §20.3).

## Global constraints

- Own only the paths tagged **publish** in `docs/structure.md` section 11. Task 1 registers the module in two base files; touch no other base file without reporting it.
- Every query runs inside `withBrand`. Every state change of a job writes an `audit` event with the job, the draft version and the payload hash.
- This module makes no model call.
- Do not commit anything under `server/src/db/migrations/`.
- Commits carry no AI attribution line.

## The adapters to other modules (fixed)

```ts
// server/src/domain/publish/reads.ts
type GateApproval = { id: string; objectId: string; objectVersion: number; payloadHash: string; expiresAt: Date | string }
type DraftForPublish = { id: string; kind: string; status: string; currentVersion: number; channel: string; day: string;
  content: unknown; renders: { ratio: string; key: string; width: number; height: number; sha256: string }[] }
type Reads = {
  validApproval(tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<GateApproval | null>
  getDraft(tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<DraftForPublish | null>
  listDrafts(tx: Tx, brandId: string, facts: ApprovedFact[], filter?: { status?: 'ready' }): Promise<DraftForPublish[]> }
reads(): Promise<Reads>   // dynamic imports of ../approve/index.ts and ../studio/index.ts, cast to Reads
```

Every function that needs them takes a `Reads` argument that defaults to `await reads()`. Tests pass a fake.

## The connector contract (§20.2)

```ts
// server/src/domain/publish/connectors/types.ts
type PublishRequest = { platform: string; accountName: string; caption: string; hashtags: string[];
  media: { key: string; ratio: string; kind: 'image' | 'video' }[] }
type PublishResult = { status: 'published'; externalId: string; url: string } | { status: 'manual' }
type ConnectorErrorKind = 'auth' | 'scope' | 'rate_limited' | 'server' | 'timeout' | 'unsupported'
class ConnectorError extends Error { kind: ConnectorErrorKind; retryAfterSeconds?: number }
type Reconciled = { found: true; externalId: string; url: string } | { found: false } | { found: 'unknown' }
interface Connector {
  id: 'manual' | 'mock'
  validateCredentials(): Promise<boolean>
  listCapabilities(platform: string): Capabilities
  publish(req: PublishRequest, idempotencyKey: string): Promise<PublishResult>
  reconcile(idempotencyKey: string): Promise<Reconciled>
  healthCheck(): Promise<boolean>
}
```

The other operations of §20.2 (`connect`, `create_draft`, `get_status`, `fetch_analytics`, `receive_webhook`, `refresh_token`, `disconnect`, `get_rate_limits`, `redact_logs`) are listed in the interface as optional and, where absent, answer a `ConnectorError` of kind `unsupported`.

## Review focus

Each has a test in its owning task.

1. A job scheduled for a time that falls in a daylight-saving gap, or given as a local time with no offset: refused; times are stored in UTC and shown in the brand's timezone (task 3).
2. A job due while the server was down for an hour: it is sent when the server returns, once, and jobs older than 24 hours are `blocked` with "missed its time" and not sent (task 5).
3. A channel deleted or disabled while it has scheduled jobs: its jobs become `blocked` at send time; nothing is sent to it (task 4).
4. The owner confirms a manual post with a link that is not a URL, or confirms the same job twice: the first is refused, the second changes nothing (task 4).
5. A draft scheduled twice to the same channel: the second is refused while the first is active; allowed again after the first is cancelled (task 3).

---

### Task 1: Register the module, schema, settings, capabilities

**Files:** `server/src/modules.ts`, `server/src/db/schema/index.ts` (one line each), `server/src/db/schema/publish.ts`, `server/src/domain/publish/index.ts`, `reads.ts`, `settings.ts`, `capabilities.ts`, `server/src/workflows/publish-run.ts`, `settings.int.test.ts`

| Table | Columns beyond `id`, `brandColumns`, `created_at` |
|---|---|
| `channels` | `platform`, `mode` (`manual`, `api`), `connector` (`manual`, `mock`), `account_name`, `account_url`, `status` (`connected`, `needs_reconnect`, `disabled`), `last_verified_at`; unique per brand, platform and account name |
| `publish_jobs` | `draft_id`, `draft_version`, `payload_hash`, `channel_id`, `scheduled_at timestamptz`, `state`, `attempts`, `next_attempt_at`, `idempotency_key` (unique), `external_id`, `external_url`, `error`, `retryable`, `published_at`, `manual`, `workflow_id` |
| `publish_settings` | `window_start` (hour, default 7), `window_end` (hour, default 21), `max_attempts` (default 3, 1 to 5); one row per brand |

A partial unique index allows one active job (any state but `published`, `cancelled` and `failed`) per draft and channel.

`capabilities.ts` holds one constant for the nine platforms Plan offers (facebook, instagram, tiktok, youtube, linkedin, x, whatsapp, email, website): `{ textLimit, ratios, maxMedia, lastVerified, manualFallback: true }`. Text limits are those of the Studio design, section 3. Ratios: instagram `1:1`, `4:5`, `9:16`; tiktok `9:16`; youtube `16:9`, `9:16`; x `16:9`, `1:1`; linkedin `1:1`, `4:5`, `16:9`; facebook, whatsapp, email and website all four. Maximum media: instagram and facebook 10, linkedin 9, x 4, the rest 1. Set `lastVerified` to `null`, with a comment that each value must be checked against the platform before a real connector ships.

- [ ] Test: settings refuse a window whose start is not before its end, and `max_attempts` outside 1 to 5.
- [ ] Test: brand B's channels and jobs are invisible inside `withBrand(A)`.
- [ ] Check: `pnpm test && pnpm typecheck`.

### Task 2: Contract first

**Files:** `server/src/contracts/publish.ts`, `server/src/domain/publish/routes.ts`, `server/openapi.json`

Declare every route with full schemas; unbuilt handlers answer 501. Run `pnpm openapi` and commit with the message `Add the publish API contract`. The screens agent starts from that commit.

All under `/api/brands/{brandId}/publish`:

- `GET /summary`: jobs awaiting manual posting, jobs needing attention (`blocked`, `unknown`, `failed`), the next seven days' jobs, the last ten published, and counts by state
- `GET` and `POST /channels`, `PATCH /channels/{id}`, `GET /capabilities`
- `GET /schedulable`: ready drafts with a valid approval, each with its kind, planned day, planned channel, a caption excerpt, a thumbnail URL, and the channels it fits with the reason for each it does not
- `GET /jobs?from=&to=&state=`, `POST /jobs` with `{ draftId, channelId, scheduledAt }`
- `GET /jobs/{id}`: the job, its channel, its history from the audit trail, and its package: the caption by language, hashtags, the call to action and the media in the channel's shapes with presigned download URLs
- `POST /jobs/{id}/cancel`, `/reschedule`, `/retry`, `/confirm-manual` with `{ url }`, `/resolve-unknown` with `{ posted: boolean, url? }`
- `GET` and `PUT /settings`

Timestamps travel as ISO 8601 with an offset. Nullable values follow the `RunMoney` pattern in `server/src/contracts/research.ts`.

- [ ] Check: `pnpm openapi && pnpm openapi:check && pnpm typecheck`.

### Task 3: Channels, fit and scheduling

**Files:** `server/src/domain/publish/channels.ts`, `fit.ts`, `schedule.ts`, `fit.test.ts`, `schedule.int.test.ts`

```ts
fits(i: { draft: DraftForPublish; captionLength: number; platform: string }): { ok: true } | { ok: false; reason: string }   // pure
scheduleJob(tx, brandId, i: { draftId: string; channelId: string; scheduledAt: string }, facts, r?: Reads): Promise<Job>
cancelJob(tx, brandId, jobId): Promise<Job>      rescheduleJob(tx, brandId, jobId, scheduledAt: string): Promise<Job>
```

`scheduleJob` is refused with a clear message when: there is no valid approval; the time has no offset, is in the past, or is outside the brand's publishing hours in the brand's timezone; the channel is not `connected`; the draft does not fit the platform; or an active job exists for that draft and channel. It stores the approval's `objectVersion` and `payloadHash` and a new idempotency key.

- [ ] Test: `fits` refuses a 300-character caption on x, a draft with only a `16:9` render on instagram, and five images on x; it accepts a `post` draft with no render on x.
- [ ] Test: scheduling without a valid approval is refused; with one it stores the hash and version.
- [ ] Test (review focus 1): `2026-12-01T10:00` with no offset is refused; a time at 23:00 brand time is refused under the default hours.
- [ ] Test (review focus 5): a second job for one draft and channel is refused while the first is `scheduled`, and accepted after it is cancelled.
- [ ] Check: `pnpm test`.

### Task 4: The state machine and connectors

**Files:** `server/src/domain/publish/state.ts`, `connectors/types.ts`, `connectors/manual.ts`, `connectors/mock.ts`, `connectors/index.ts`, `manual.ts`, `state.test.ts`, `manual.int.test.ts`

```ts
type JobState = 'scheduled' | 'publishing' | 'awaiting_manual' | 'published' | 'unknown' | 'blocked' | 'failed' | 'cancelled'
type Outcome =
  | { type: 'gate_refused'; reason: string } | { type: 'channel_unavailable'; reason: string }
  | { type: 'manual' } | { type: 'sent'; externalId: string; url: string }
  | { type: 'error'; kind: ConnectorErrorKind; retryAfterSeconds?: number }
  | { type: 'reconciled'; result: Reconciled }
nextState(job: { state: JobState; attempts: number }, outcome: Outcome, maxAttempts: number):
  { state: JobState; retryable?: boolean; retryInSeconds?: number; error?: string; channelStatus?: 'needs_reconnect' }   // pure
confirmManual(tx, brandId, jobId, url: string): Promise<Job>
resolveUnknown(tx, brandId, jobId, i: { posted: boolean; url?: string }): Promise<Job>
retryJob(tx, brandId, jobId): Promise<Job>
```

`nextState` implements the design's error table. A `timeout` gives `unknown` whatever the attempt count. `reconciled` with `found: true` gives `published`; `found: false` gives `scheduled` for an immediate retry with the same idempotency key; `found: 'unknown'` stays `unknown`. A server error retries after 60 seconds times two to the power of the attempts so far, until the attempts reach the limit, then `failed` with `retryable: true`. `retryJob` is allowed only from `failed` with `retryable` and from `blocked`, and it re-runs the gate; it is never allowed from `unknown`. The mock connector is programmed per idempotency key with a list of outcomes and records every `publish` call it receives.

- [ ] Test: every row of the design's error table through `nextState`, and every `reconciled` case.
- [ ] Test: no sequence of outcomes moves a job out of `published` or `cancelled`.
- [ ] Test (review focus 4): `confirmManual` refuses `not a link`, accepts an `https` URL and sets `published` with `manual` true; a second confirmation changes nothing.
- [ ] Test: `resolveUnknown` with `posted: false` returns the job to `scheduled`; with `posted: true` and a URL it sets `published`; `retryJob` on an `unknown` job is refused.
- [ ] Check: `pnpm test`.

### Task 5: The send workflow and the scheduler

**Files:** `server/src/workflows/publish-run.ts`, `server/src/domain/publish/send.ts`, `send.int.test.ts`

```ts
dueJobs(now: Date): Promise<{ brandId: string; jobId: string }[]>
sendJob(brandId: string, jobId: string, deps?: { reads?: Reads; connector?: Connector; now?: () => Date }): Promise<Job>
```

`sendJob`, each numbered part its own workflow step:

1. Claim: one `UPDATE … SET state = 'publishing' WHERE id = … AND state = 'scheduled'`. No row changed means another worker has it; stop.
2. A job more than 24 hours past its time becomes `blocked` with `missed its time`.
3. Gate: `validApproval` must return an approval whose `payloadHash` equals the job's; otherwise `gate_refused`.
4. Channel: it must exist and be `connected`; otherwise `channel_unavailable`.
5. Send through the connector with the job's idempotency key, and apply `nextState`. On `unknown`, try `reconcile` after 60, 300 and 900 seconds, applying `nextState` each time, and stop at the first answer that is not `unknown`.

A scheduled workflow runs every minute, calls `dueJobs` (state `scheduled` and `scheduled_at` or `next_attempt_at` at or before now) and starts `sendJob` for each, with the workflow ID taken from the idempotency key and the attempt number.

- [ ] Test: a manual channel's due job becomes `awaiting_manual` and the connector's `publish` is never called for it.
- [ ] Test (AT-013): a fake gate returning an approval with a different hash leaves the job `blocked`, and the mock connector receives no call.
- [ ] Test (AT-014): a mock timeout leaves the job `unknown`; with `reconcile` answering `found: true` it becomes `published` and the connector has received exactly one `publish` call; with `found: false` it is sent again with the same idempotency key and becomes `published` after exactly two calls.
- [ ] Test (AT-015): one draft with two jobs, one mock succeeding and one answering `scope`, ends with one `published` and one `failed`.
- [ ] Test: two concurrent `sendJob` calls for one job produce exactly one connector call.
- [ ] Test: a `rate_limited` answer with `retryAfterSeconds: 120` sets `next_attempt_at` 120 seconds ahead and the job is not due before then.
- [ ] Test (review focus 2): a job 30 minutes late is sent; a job 25 hours late is `blocked`.
- [ ] Test (review focus 3): a job whose channel is `disabled` at send time is `blocked`.
- [ ] Check: `pnpm test`.

### Task 6: Routes, summary, isolation

**Files:** `server/src/domain/publish/routes.ts`, `summary.ts`, `package.ts`, `routes.int.test.ts`, `server/openapi.json`

Replace every 501 handler. Export `listPublished(tx, brandId, range)` from `index.ts` for the Results module.

- [ ] Test: brand B's job, channel and package through brand A's path each return 404 and a `denied` audit event; a presigned media URL is issued only for a job of the brand in the path.
- [ ] Test: `GET /schedulable` lists only drafts for which the fake gate returns an approval, with the reason for each channel a draft does not fit.
- [ ] Test: every route validates its body and answers 400 with the base error shape.
- [ ] Check: `pnpm test && pnpm typecheck && pnpm openapi && pnpm openapi:check`.

### Task 7: Screens

**Files:** `web/src/nav.ts` (add Publish last), `web/src/app/(app)/app.css` (one `@source` line for `components/publish`), `web/src/app/(app)/app/b/[brandId]/publish/**`, `web/src/components/publish/**`, `web/e2e/publish*.spec.ts`, `web/src/lib/api/schema.d.ts`

| Route under `/app/b/[brandId]/publish` | Screen |
|---|---|
| `/` | Publish dashboard: "Post by hand now" first, then what needs attention with the reason and the action for each, what is coming in the next seven days, and what went out, with links |
| `/calendar` | A week of jobs by day and time, in the brand's timezone, with each job's channel and state; scheduling an approved draft to one or more channels, showing why a channel does not fit before the owner submits |
| `/channels` | The brand's channels with platform, account, mode and status; adding one; the platform's limits, marked as not yet verified |
| `/jobs/[jobId]` | One job: its state and history; for a manual job, the package with copy buttons for the caption, hashtags and call to action, downloads of the media, and confirmation with the post's link; for an `unknown` job, "It was posted" with a link and "It was not posted"; cancel, move and retry where allowed |

Every time on screen names its timezone. Every screen handles loading, empty, provider unavailable and stale states through `StateBlock`.

- [ ] Stubbed tests (`publish.stub.spec.ts`): the dashboard with one job in each state; scheduling a draft to two channels, one refused for fit with its reason; a manual job's package, copying the caption and confirming with a link; an `unknown` job resolved both ways; a `blocked` job showing its reason; adding a channel; keyboard-only use of the dashboard; the error state.
- [ ] Full-flow test (`publish.spec.ts`, real API), wrapped in `test.describe.skip` until Approve, Studio and this server are merged.
- [ ] Check: `pnpm build && pnpm e2e`.

## Hand-off

Each agent replies with at most 150 words: which checks pass, anything skipped and why, base changes, added dependencies, and contract changes after the contract commit.
