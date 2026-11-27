# Approve module: implementation plan

> **For the agents executing this plan:** work on branch `product/approve`. One agent runs tasks 1 to 5 (server) in the worktree `.claude/worktrees/approve`. A second agent runs task 6 (screens) in its own worktree from the committed contract. Each task: write the listed tests, watch them fail, implement, run the check, commit.

**Goal:** the approval gate: a queue of ready Studio drafts, an exact-version preview, approvals bound to a payload hash, and one function that says whether a draft has a valid approval.

**Architecture:** three pure functions carry every rule: `payloadHash`, `riskOf` and `approvalState`. State is never stored; it is worked out on each read from the latest decision and today's payload. Studio is read through one adapter with an interface the tests replace with a fake, because Studio's domain is being built on another branch at the same time.

**Tech stack:** as the base branch. Add no dependency.

**Spec:** `docs/superpowers/specs/2026-11-27-approve-design.md` (whole file) and `docs/structure.md`. In the requirements spec read only lines 995–1018 (§4.1 and §4.2) and 2006–2017 (§21.2 and the audit fields).

## Global constraints

- Own only the paths tagged **approve** in `docs/structure.md` section 10. Task 1 registers the module in two base files; touch no other base file without reporting it.
- Every query runs inside `withBrand`. Every decision, pause and resume writes an `audit` event carrying the object version and the payload hash.
- This module makes no model call.
- Do not commit anything under `server/src/db/migrations/`. The grant that removes `UPDATE` and `DELETE` on `approvals` from the app role goes where the base keeps its grant for `audit_events` (`server/src/db/setup.ts`); that one base edit is allowed and must be reported.
- Commits carry no AI attribution line.

## The Studio adapter (fixed)

```ts
// server/src/domain/approve/studio.ts
type ReadyDraft = { id: string; planItemId: string; kind: string; status: 'draft' | 'ready';
  currentVersion: number; readyVersion: number | null; channel: string; day: string;   // YYYY-MM-DD
  pillar: string | null; campaignId: string | null; content: unknown; leftOut: unknown[];
  findings: { check: string; blocking: boolean; where: string; message: string }[];
  renders: { ratio: string; key: string; width: number; height: number; overflow: boolean; sha256: string }[];
  factIds: string[]; assetIds: string[] }
type StudioReads = {
  getDraft(tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<ReadyDraft | null>
  listDrafts(tx: Tx, brandId: string, facts: ApprovedFact[], filter?: { status?: 'draft' | 'ready' }): Promise<ReadyDraft[]> }
studioReads(): Promise<StudioReads>     // imports ../studio/index.ts at call time and returns its getDraft and listDrafts
```

`studioReads` uses a dynamic import cast to `StudioReads`, so this module compiles before Studio's domain is merged. Every function that needs Studio takes a `StudioReads` argument that defaults to `await studioReads()`. Tests pass a fake.

## Review focus

Each has a test in its owning task.

1. Two approve requests for one draft at the same instant: one decision is stored, not two (task 3).
2. A draft with no renders (a `post`): its hash is stable and it can be approved (task 2).
3. Content whose object keys arrive in a different order: the hash is the same (task 2).
4. An approval given while the brand is paused: stored, shown as `paused`, and valid once resumed if nothing else changed (task 3).
5. A draft deleted or no longer ready after approval: the state is `invalid`, and the queue still lists its history without failing (task 4).

---

### Task 1: Register the module, schema and settings

**Files:** `server/src/modules.ts`, `server/src/db/schema/index.ts` (one line each), `server/src/db/setup.ts` (the grant), `server/src/db/schema/approve.ts`, `server/src/domain/approve/index.ts`, `settings.ts`, `studio.ts`, `settings.int.test.ts`

| Table | Columns beyond `id`, `brandColumns`, `created_at` |
|---|---|
| `approvals` | `object_type` (`studio_draft`), `object_id`, `object_version`, `payload_hash`, `decision` (`approved`, `rejected`), `reason`, `risk`, `review_note`, `decided_by`, `decided_at`, `expires_at`, `bulk_id` |
| `approval_views` | `object_type`, `object_id`, `object_version`, `viewed_at`; unique per object and version |
| `approve_settings` | `paused`, `paused_reason`, `paused_at`, `max_age_days` (default 14, 1 to 90), `approvers jsonb` (names); one row per brand |

**Produces:** `getSettings`, `setSettings`, `setPaused(tx, brandId, paused: boolean, reason: string)`.

- [ ] Test: as the app role, `UPDATE approvals` and `DELETE FROM approvals` fail with a permission error.
- [ ] Test: `setPaused` without a reason is refused; with one it writes an audit event.
- [ ] Test: brand B's approvals and settings are invisible inside `withBrand(A)`.
- [ ] Check: `pnpm test && pnpm typecheck`.

### Task 2: The three rules

**Files:** `server/src/domain/approve/hash.ts`, `risk.ts`, `state.ts`, `rules.test.ts`

```ts
type Payload = { objectType: 'studio_draft'; objectId: string; version: number; channel: string; day: string;
  kind: string; content: unknown; renders: { ratio: string; sha256: string }[] }
payloadOf(d: ReadyDraft): Payload | null            // null unless status is 'ready' and readyVersion === currentVersion
payloadHash(p: Payload): string                     // hex SHA-256 of canonical JSON: keys sorted at every depth
riskOf(i: { text: string; pillar: string | null; industry: string | null }): { risk: 'low' | 'medium' | 'high'; reasons: string[] }
approvalState(i: { latest: Approval | null; draft: ReadyDraft | null; now: Date; paused: boolean;
  approvedFactIds: Set<string>; assetsWithRights: Set<string> }): { state: 'waiting' | 'approved' | 'rejected' | 'invalid' | 'expired' | 'paused'; reason?: string }
expiryOf(i: { decidedAt: Date; maxAgeDays: number; factExpiries: (Date | null)[]; rightsExpiries: (Date | null)[] }): Date
```

The rules are the design's section 3. `riskOf` matches whole words, case-insensitively, after Unicode normalisation, and treats `Rs`, `रु`, `NPR` followed by a number, and any number followed by `%`, as a price or percentage, with Devanagari digits read as digits. `approvalState` checks in this order: no decision or a decision for an older version gives `waiting`; `rejected`; then for an approved decision: `invalid` (not ready, hash differs, a fact not approved, an asset without rights), `expired`, `paused`, `approved`. A draft that is not ready and has no decision is not in the queue at all.

- [ ] Test (review focus 3): two payloads equal except for key order hash the same; changing one character of the caption, the day, the channel or one render's `sha256` changes the hash.
- [ ] Test (review focus 2): a payload with no renders hashes, and hashes the same twice.
- [ ] Test: `riskOf` returns `high` for industry `Pharmacy` and for copy containing `Guaranteed`; `medium` for `Rs 4,500`, `१५% छुट`, `the best` and pillar `offer`; `low` for plain copy. `guaranteeing` and `bestow` do not match.
- [ ] Test: each `approvalState` outcome, including: an approval for version 2 when the draft is at version 3 is `waiting`; an approval whose hash differs at the same version is `invalid`; expiry one second ago is `expired`; paused and otherwise valid is `paused`.
- [ ] Test: `expiryOf` returns the earliest of the three sources and ignores nulls.
- [ ] Check: `pnpm test`.

### Task 3: Decisions

**Files:** `server/src/domain/approve/decisions.ts`, `decisions.int.test.ts`

```ts
recordView(tx, brandId, draftId, version): Promise<void>
approve(tx, brandId, i: { draftId: string; payloadHash: string; reviewNote?: string }, facts: ApprovedFact[], studio?: StudioReads): Promise<Approval>
reject(tx, brandId, i: { draftId: string; payloadHash: string; reason: string }, facts: ApprovedFact[], studio?: StudioReads): Promise<Approval>
bulkApprove(tx, brandId, items: { draftId: string; payloadHash: string }[], facts: ApprovedFact[], studio?: StudioReads): Promise<Approval[]>
validApproval(tx, brandId, draftId: string, facts: ApprovedFact[], studio?: StudioReads): Promise<Approval | null>   // the gate
```

**Rules:** `approve` and `reject` load the draft, build its payload, and refuse with a `ConflictError` when the draft is not ready (`not ready`), the sent hash differs (`changed since you opened it`), a blocking finding exists, or, for `approve`, the risk is `high` and the note is under 20 characters. A second decision for the same object version while one exists is refused, enforced by a unique index, so a race stores one. `bulkApprove` applies the design's bulk rule and stores every approval with one `bulk_id` in one transaction, or none. `validApproval` returns the latest approval only when `approvalState` is `approved`.

- [ ] Test: approving with a stale hash is refused; with the current hash it stores one approval with the risk, the expiry and an audit event carrying the version and hash.
- [ ] Test (AT-013): after approval, a fake Studio that returns the draft at a new version makes `validApproval` return null.
- [ ] Test: a cited fact missing from `facts` makes `validApproval` return null.
- [ ] Test (review focus 1): two concurrent `approve` calls for one draft store one row; the other is refused.
- [ ] Test: a high-risk draft is refused without a note, accepted with one, and refused in `bulkApprove`.
- [ ] Test: `bulkApprove` is refused when the items mix channels, mix risks, span two weeks, or one has no recorded view; nothing is stored in any of those cases.
- [ ] Test (review focus 4): an approval given while paused makes `validApproval` return null, and return the approval after `setPaused(false)`.
- [ ] Check: `pnpm test`.

### Task 4: Contract first, then routes

**Files:** `server/src/contracts/approve.ts`, `server/src/domain/approve/routes.ts`, `queue.ts`, `routes.int.test.ts`, `server/openapi.json`

Declare every route with full schemas first, with unbuilt handlers answering 501, run `pnpm openapi`, and commit with the message `Add the approve API contract`. The screens agent starts from that commit. Then build the handlers.

All under `/api/brands/{brandId}/approve`:

- `GET /summary`: counts by state, whether the brand is paused and why, and the month's count of decisions
- `GET /queue?state=`: items ordered by day, then risk (high first), each with the draft's kind, channel, day, a caption excerpt, a thumbnail URL, the risk with its reasons, the state with its reason, the payload hash, the blocking count and whether its current version has been viewed
- `GET /queue/{draftId}`: the full preview (content, facts cited, left-out list, findings, renders with presigned URLs), the risk, the state, the payload hash, the expiry an approval would get, and the decision history. Reading it records a view
- `POST /queue/{draftId}/approve`, `POST /queue/{draftId}/reject`
- `POST /bulk-approve`
- `GET` and `PUT /settings`, `POST /pause`, `POST /resume`

Nullable values follow the `RunMoney` pattern in `server/src/contracts/research.ts` for anything `openapi-typescript` must read as `… | null`.

- [ ] Test: brand B's queue item, decision history and approve route through brand A's path each return 404 and a `denied` audit event.
- [ ] Test (review focus 5): an approved draft that Studio no longer returns shows `invalid` in the queue with its history, and the queue does not fail.
- [ ] Test: `GET /queue/{draftId}` records one view per version, however often it is read.
- [ ] Test: every route validates its body and answers 400 with the base error shape.
- [ ] Check: `pnpm test && pnpm typecheck && pnpm openapi && pnpm openapi:check`.

### Task 5: The gate export

**Files:** `server/src/domain/approve/index.ts`, `gate.int.test.ts`

Export `validApproval` and the `Approval` type from `index.ts`, with a one-line comment that every module which publishes must call it.

- [ ] Test: the six acceptance cases of the design's section 6, through `validApproval` and the routes.
- [ ] Check: `pnpm test`.

### Task 6: Screens

**Files:** `web/src/nav.ts` (add Approve after Studio, or after Plan when Studio is absent), `web/src/app/(app)/app.css` (one `@source` line for `components/approve`), `web/src/app/(app)/app/b/[brandId]/approve/**`, `web/src/components/approve/**`, `web/e2e/approve*.spec.ts`, `web/src/lib/api/schema.d.ts`

| Route under `/app/b/[brandId]/approve` | Screen |
|---|---|
| `/` | Approval dashboard and queue: counts by state; the pause switch with its reason; the queue by day with each item's thumbnail, channel, risk and state; filters by state; bulk selection that explains, before the owner submits, why an item cannot join the selection |
| `/[draftId]` | Exact-version preview: where and when it will go out, the copy in each language, the images at each size or the video, the facts it cites, what was left out, the risk with its reasons, the expiry an approval would get, approve (with the review note when the risk is high) and reject with a reason, and the decision history |

The preview must make plain that the owner is approving this version and that any later edit undoes it. When the API answers that the draft changed, the screen reloads the preview and says so. Every screen handles loading, empty, provider unavailable and stale states through `StateBlock`.

- [ ] Stubbed tests (`approve.stub.spec.ts`): the queue with one item in each state; approving a low-risk item; a high-risk item refusing approval until the note is long enough; rejecting with a reason; the "changed since you opened it" answer reloading the preview; a bulk selection refusing a mixed-channel item with its reason, then approving two valid items; pausing with a reason and seeing approved items shown as paused; keyboard-only use of the queue; the error state.
- [ ] Full-flow test (`approve.spec.ts`, real API), wrapped in `test.describe.skip` until Studio and this server are merged.
- [ ] Check: `pnpm build && pnpm e2e`.

## Hand-off

Each agent replies with at most 150 words: which checks pass, anything skipped and why, base changes, added dependencies, and contract changes after the contract commit.
