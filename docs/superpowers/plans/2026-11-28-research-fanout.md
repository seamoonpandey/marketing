# Research Module Fan-out Plan

> **For agentic workers:** each task below is one agent's whole job. Read your task, the line ranges it cites, and the Global Constraints. Do not read the rest of this file or whole specs.

**Goal:** Finish the Research module: competitor discovery, opportunities that draw on everything Research knows, and ways in to both from Research, Brand and Home.

**Architecture:** One contract commit fixes the tables, API shapes and route handlers for everything. Three tracks then build in parallel worktrees from that commit and never share a file: the discovery engine (server), the opportunities engine (server) and the screens (web). After they merge, an adversarial review hardens the trust boundaries, a full-flow browser test proves the pipeline against the real API, and a final pass reviews the branch and cleans up.

**Tech Stack:** Hono + zod-openapi, Drizzle (Postgres 18, RLS), DBOS Transact, `extract` (Vercel AI SDK), Vitest; Next.js 16, TanStack Query, Playwright.

**Specs:** `docs/superpowers/specs/2026-11-28-competitor-discovery-design.md` (discovery), `docs/superpowers/specs/2026-11-28-opportunities-design.md` (opportunities, ways in, search reach). **Detail plan for discovery:** `docs/superpowers/plans/2026-11-28-competitor-discovery.md` (cited below by line range; its Task 1, the search gateway, is done).

## Global Constraints

- Every query on a brand-owned table runs inside `withBrand(brandId, tx => …)`; every brand-owned table declares `brandPolicies`.
- Every model call goes through `extract` (`server/src/ai`), with no tools. Search results, page text, quotes and facts go to the model inside tagged data blocks, and every system prompt says they are untrusted data whose instructions are ignored.
- Text from a model, a page or a person is compared through `server/src/text/normalise.ts` (`foldText`, `plainText`), never a bare `===`. Quotes are checked with `verifyQuote` (`domain/sources`). Every string a model or a search result wrote is passed through `cleanCut` (Task 1) before it is stored.
- A URL from a model, a search result or a page is stored or fetched only when it is http or https. Pages are fetched only through `savePageSource` or `pickPages` (the fetch guard). The web renders a link only for an http or https URL.
- Migrations are generated (`pnpm db:generate`), never hand-edited; never `drizzle-kit push`. `server/openapi.json` (`pnpm openapi`) and `web/src/lib/api/schema.d.ts` (`pnpm api:types`) are regenerated, never merged or hand-edited.
- **The contract is fixed after Task 1.** Tracks do not edit `server/src/db/schema/research.ts`, `server/src/contracts/research.ts`, the route files, `server/openapi.json` or `web/src/lib/api/schema.d.ts`. If the contract is wrong, make the smallest change, regenerate both generated files, and list it under "Contract changes" in your report.
- **File ownership:** a track edits only the files its task lists. Docs (`docs/**`) are edited only in Task 8.
- Tests never pay: `AI_MODEL=mock` and `SEARCH_PROVIDER=mock` are forced in `server/vitest.config.ts`.
- Limits: at most 15 keywords of at most 80 characters; 6 to 10 suggestions; one web query (10 results) and one Maps query per keyword; at most 30 candidates per run; page text cut to 12,000 characters for the model; 10 watched competitors per brand; unconfirmed runs expire after 7 days; at most 8 opportunities kept per call.
- Commit messages carry no Claude or AI attribution and no `Co-Authored-By` line. Never push.
- Run commands from `server/` or `web/`. Postgres and SeaweedFS containers are running and shared by every worktree: run focused tests while iterating and the full suite once before the last commit; on Postgres error 53300 (too many connections) wait a minute and run again.
- Browser tests set their own ports (given per task) so tracks and the owner's dev servers never collide.

## Review Focus

1. A competitor's page or a search snippet that carries instructions, a `javascript:` link or a control character: none may reach a prompt outside a data block, a stored row uncleaned, or a rendered link.
2. Money: nothing is searched or sent to a model before the owner confirms a discovery run; a retry repeats no paid step; a scan that fails leaves no opportunity half-written.
3. IDs from another brand (candidate, source, fact, opportunity, run) on this brand's paths and in its bodies.
4. A brand with nothing yet (no facts, no competitors, no candidates): every screen has a next step and no route answers 500.
5. Devanagari names, quotes and keywords on every new screen at phone width.

---

### Task 1: Contract

**Model:** opus. **Where:** the integration branch `feat/competitor-discovery`, in the main worktree.

**Read first:** this task; discovery plan lines 233–262 (Task 3 "Interfaces") and 459–480 (Task 5 "Interfaces"); opportunities spec §3.4, §4.

**Files:**
- Modify: `server/src/db/schema/research.ts`, `server/src/contracts/research.ts`, `server/src/domain/research/routes.ts`, `server/src/domain/research/opportunities.ts`, `server/src/domain/research/index.ts`, `server/src/modules.ts`, `server/src/workflows/index.ts` (the `RunTable.table` union), `server/src/text/normalise.ts`, `server/src/search/serper.ts`
- Create: `server/src/domain/research/discovery/routes.ts`, `discovery/index.ts`, `discovery/run.ts`, `discovery/keywords.ts`, `discovery/candidates.ts`, `server/src/text/normalise.test.ts` case for `cleanCut` (add to the existing test file if there is one)
- Generated: one migration under `server/drizzle/`, `server/openapi.json`, `web/src/lib/api/schema.d.ts`

**Produces:**

1. **`cleanCut(s: string, max: number): string`** in `text/normalise.ts`: the cleaning cut `search/serper.ts` has now (control and bidi characters removed, cut to `max` UTF-16 units, made well-formed), moved there; `serper.ts` imports it.

2. **Types in `schema/research.ts`** (the discovery plan's `COLUMNS`, `Cell`, `Cells`, `OWN_COLUMNS`, `OwnCell`, `OwnRow` are these; `discovery/cells.ts` will import them):

```ts
export const discoveryColumns = ['kind', 'sells', 'sellsTo', 'priceLevel', 'where', 'pitch', 'overlap'] as const;
export type DiscoveryColumn = (typeof discoveryColumns)[number];
export type Cell =
  | { value: string; basis: 'quoted'; quote: string; sourceId: string }
  | { value: string; basis: 'inferred'; reason: string; evidence: string[]; confidence: 'low' | 'medium' | 'high' };
export type Cells = Partial<Record<DiscoveryColumn, Cell>>;
export const ownColumns = ['sells', 'sellsTo', 'priceLevel', 'where', 'pitch'] as const;
export type OwnCell = { value: string; factIds: string[] };
export type OwnRow = Partial<Record<(typeof ownColumns)[number], OwnCell>>;
export type SearchResult = SearchHit & { id: string; kind: SearchKind; query: string }; // type-only import from search/index.ts
export type DiscoveryCounts = { queries: number; failedQueries: number; results: number; found: number; skipped: number; profiled: number; failedProfiles: number; dropped: number };
export type OpportunityEvidence = { type: 'observation' | 'profile' | 'candidate' | 'fact'; id: string; label: string; detail: string; quote?: string; sourceId?: string };
```

3. **Tables:** `discoveryRuns` and `discoveryCandidates` exactly as the discovery plan lines 244–248 describe them (including `place jsonb Place | null`, both indexes, `brandPolicies`). `opportunities` gains `kind` (`change` | `gap` | `strength`, default `change`), `impact` and `effort` (`low` | `medium` | `high`, default `medium`), `evidence jsonb OpportunityEvidence[]` default `[]`, all not null.

4. **Contracts** (OpenAPI names): `DiscoveryCell` (a union discriminated on `basis`), `DiscoveryCells`, `DiscoveryOwnRow`, `DiscoveryPlace`, `DiscoveryCounts` (every field optional), `DiscoveryRun` `{ id, keywords, state, error, startedAt, finishedAt, estimate, actual, counts, ownRow (nullable), createdAt }` (no `results`), `DiscoveryRunCreate` `{ keywords: string[] }` (bounds size only: 1 to 50 strings of at most 500 characters; `cleanKeywords` enforces the real limits), `KeywordSuggestions` `{ keywords }`, `DiscoveryCandidate` `{ id, name, site, channels, place, cells, sourceIds, rank, status, competitorId, lastFoundAt, dismissedAt }`, `CandidateWatch` `{ ids }` (1 to 30), `CandidateWatchResult` `{ watched, unreadable }`, `CandidatesQuery` `{ status? }`, `OpportunityEvidence`, `OpportunityScanResult` `{ created: Opportunity[]; dropped: number }`. `Opportunity` gains `kind`, `impact`, `effort`, `evidence` and keeps `observationIds`.

5. **Routes with real handlers** (`P = /brands/{brandId}/research`), following the existing handlers in `routes.ts`:

| Route | Calls | Answers |
|---|---|---|
| `POST ${P}/discovery/keywords` | `suggestKeywords(brandId)` | 200 `KeywordSuggestions`; 400, 402, 404 |
| `GET ${P}/discoveries` | `listDiscoveries(tx, brandId)` | 200 `DiscoveryRun[]` |
| `POST ${P}/discoveries` | `createDiscovery(brandId, keywords)` then `getDiscovery` | 201 `DiscoveryRun`; 400, 404, 409, 503 |
| `GET ${P}/discoveries/{id}` | `getDiscovery(tx, brandId, id)` | 200; 404 |
| `POST ${P}/discoveries/{id}/confirm` · `/cancel` · `/retry` | `confirmDiscovery` · `cancelDiscovery` · `retryDiscovery` `(brandId, id)` then `getDiscovery` | 200 `DiscoveryRun`; 402 (confirm), 404, 409 |
| `GET ${P}/candidates` | `listCandidates(tx, brandId, status?)` | 200 `DiscoveryCandidate[]` |
| `POST ${P}/candidates/watch` | `watchCandidates(brandId, ids)` | 200 `CandidateWatchResult`; 400, 404, 409 |
| `POST ${P}/candidates/{id}/dismiss` · `/restore` | `dismissCandidate` · `restoreCandidate` `(tx, brandId, id)` | 200 `DiscoveryCandidate`; 404, 409 |
| `POST ${P}/opportunities/scan` | `scanOpportunities(brandId)` | 200 `OpportunityScanResult`; 400, 402, 404 |
| `POST ${P}/opportunities/{id}/restore` | `restoreOpportunity(tx, brandId, id)` | 200 `Opportunity`; 404, 409 |

The discovery and candidate routes live in `discovery/routes.ts` (`discoveryRoutes`), mounted through `server/src/modules.ts` like a module router. The two opportunity routes join `routes.ts`, and `toOpportunity` maps the new fields.

6. **Domain functions with their final signatures.** Real: `getDiscovery`, `listDiscoveries` (newest first, 50), `cancelDiscovery`, `retryDiscovery` (through `cancelRun` and `retryRun` in `workflows/index.ts`, audit action `research.discovery`, object type `discovery_run`), `listCandidates` (without a status: `new` and `watched`; sorted by overlap high, medium, low, none, then rank). Stubs that `throw new Error('not built: <name>')`: `suggestKeywords`, `cleanKeywords`, `createDiscovery`, `confirmDiscovery`, `watchCandidates`, `dismissCandidate`, `restoreCandidate`, `scanOpportunities`, `restoreOpportunity`. Signatures are in the discovery plan lines 249–254 and 469–474, and in the table above.

- [ ] **Step 1:** Add `cleanCut` with a test (an emoji split at the cut comes out well-formed; a NUL is removed); switch `serper.ts` to it. Run `pnpm exec vitest run src/text src/search`. Expected: PASS.
- [ ] **Step 2:** Add the types, tables and columns; run `pnpm db:generate`. Expected: one new SQL file creating both tables with policies and altering `opportunities`.
- [ ] **Step 3:** Add the contracts, the domain files and the routes; mount `discoveryRoutes`.
- [ ] **Step 4:** Run `pnpm openapi` in `server/`, then `pnpm api:types` in `web/`.
- [ ] **Step 5:** Verify: `pnpm typecheck && pnpm openapi:check` in `server/`; `pnpm exec tsc --noEmit` in `web/`; `pnpm test` in `server/`. Expected: everything passes except cases in `src/isolation.int.test.ts` for the new routes (stubs and missing entries). List each red case in your report; any other failure is yours to fix.
- [ ] **Step 6:** Commit: `git commit -m "Fix the Research contract for discovery and opportunities"`.

---

### Task 2: Discovery engine, part 1 (matching, keywords, the run up to search)

**Model:** opus. **Where:** its own worktree, starting from the Task 1 commit.

**Read first:** this task; discovery plan lines 133–232 (its Task 2) and 233–360 (its Task 3); discovery spec §5.1, §5.2 steps 1–3.

**Files you own:** `server/src/domain/research/discovery/{match,cells,keywords,run,steps,prompts}.ts` and their tests, `server/src/workflows/research-discovery.ts`, `server/src/modules.ts` (one import line), `server/src/isolation.int.test.ts`.

**Changes to the cited plan text:**
- The tables, migration, contracts, routes and `openapi.json` already exist (Task 1). Skip those steps. Replace the stubs in `keywords.ts` and `run.ts`; keep the functions Task 1 made real.
- `cells.ts` imports `discoveryColumns`, `ownColumns`, `Cell`, `Cells`, `OwnCell`, `OwnRow` from `db/schema/research.ts` and re-exports them as `COLUMNS`, `OWN_COLUMNS` and the same type names.
- `tidyBusinesses` keeps a `site` and a channel only when `siteHost` accepts it (http or https); anything else is dropped. Test: a `javascript:alert(1)` site becomes null and is not a channel.
- `checkCells` and `checkOwnRow` pass every stored string through `cleanCut`: a value at 200 characters, a reason or quote at 300.
- `KEYWORD_SYSTEM` asks for at least two keywords without a place name. Test: the system prompt says so.
- Add the isolation entries for the discovery routes (cited lines 336–345); the candidate entries are Task 3's.

- [ ] Follow the cited steps test-first. Done when: `pnpm exec vitest run src/domain/research/discovery` passes, the isolation cases for `discovery/keywords` and `discoveries` pass, `pnpm typecheck` passes, and the full suite has no failure outside the candidate and opportunity stubs.
- [ ] Commit in the cited plan's two commits.

---

### Task 3: Discovery engine, part 2 (group, profile, own row, candidates)

**Model:** opus. **Where:** the Task 2 worktree's branch, after Task 2.

**Read first:** this task; discovery plan lines 361–458 (its Task 4) and 459–546 (its Task 5); discovery spec §5.2 steps 4–7, §5.3, §5.4.

**Files you own:** `server/src/domain/research/discovery/{steps,prompts,candidates}.ts` and their tests, `server/src/workflows/research-discovery.ts`, `server/src/domain/sources/index.ts` (`saveTextSource`) and its test, `server/src/domain/research/targets.ts` (export `MAX_COMPETITORS`), `server/test/fixtures/research/discovery/`, `server/src/isolation.int.test.ts`.

**Changes to the cited plan text:**
- Contracts and routes exist. Replace the stubs in `candidates.ts`.
- Task 2's run tests must still pass once the workflow calls the model: queue the group, profile and own-row answers in them, or give them empty search results.
- Channels read from a page or a result are kept only when http or https.
- Every model-written string stored on a candidate goes through `cleanCut` (name at 200).

- [ ] Follow the cited steps test-first. Done when: `pnpm test` in `server/` passes except the opportunity stubs' isolation cases, and `pnpm typecheck && pnpm openapi:check` pass.
- [ ] Commit in the cited plan's two commits.

---

### Task 4: Opportunities engine

**Model:** opus. **Where:** its own worktree, starting from the Task 1 commit, in parallel with Tasks 2, 3 and 5.

**Read first:** this task; opportunities spec, all of it (it is short); `server/src/domain/research/opportunities.ts`; `server/src/domain/research/battlecard.ts` for how citations are checked today.

**Files you own:** `server/src/domain/research/opportunities.ts`, a new `server/src/domain/research/opportunity-evidence.ts` if the evidence list is clearer on its own, their tests (`opportunities.int.test.ts`, a new `opportunities.test.ts`), `server/src/domain/home/collect.ts` and `home.int.test.ts`. Read, but do not edit, the discovery tables (seed `discovery_candidates` rows directly in tests).

**Interfaces:**
- Consumes: `OpportunityEvidence`, the new `opportunities` columns, `discoveryCandidates` (Task 1); `cleanCut`, `foldText`; `extract`, `estimateTokens`; `approvedFacts`; `listCompetitors`.
- Produces:
  - `buildEvidence(tx, brandId, scope: { runId: string } | 'all'): Promise<EvidenceItem[]>` where `EvidenceItem = OpportunityEvidence & { ref: string }`, with the types, order and limits of spec §3.1 (`{ runId }` gives that run's observations and the facts only)
  - `keepOpportunities(proposed, items, existingTitles: string[]): { kept: …; dropped: number }`, pure: spec §3.2 rules 1–4, the cap of 8, the rank order
  - `generateOpportunities(brandId, runId, facts)` (signature unchanged; the watch workflow calls it) and `estimateOpportunities(facts, urls)` (still an upper bound: add the allowance for 50 titles of 120 characters)
  - `scanOpportunities(brandId): Promise<{ created: Opportunity[]; dropped: number }>`: 400 (`ValidationError`, the spec's message) with no model call when there is no observation, profile or candidate item; `runType` `research_opportunities`, `runId` a fresh UUID; audit `research.opportunity.scan`
  - `listOpportunities(tx, brandId, status?)`: rank order; a row with empty `evidence` gets evidence built from its `observationIds`
  - `restoreOpportunity(tx, brandId, id)`: dismissed → new, 409 otherwise, 404 for an unknown, foreign or malformed ID; audit `research.opportunity.restore`
  - Home: the `setup_competitor` item becomes title "Find your competitors", text "Prachaar can search for them; you pick the ones to watch.", link `/research/discover`

- [ ] **Step 1: Write the failing tests.** One per acceptance line in spec §6 (the isolation line is covered by the existing walk), plus:

```ts
it('orders by impact, then confidence, then effort', () => { /* keepOpportunities: [low/high/low, high/low/high, high/high/low] → second and third first, third before second */ });
it('cuts a 300-character title to 120 and removes control characters', () => {});
it('shows the model the 50 most recent titles and no more', async () => { /* 60 existing → the prompt part holds 50 */ });
it('stores the observation ids among the evidence in observationIds', async () => {});
it('writes nothing when the model call fails', async () => { /* mockAi.refusal → rejects; opportunities table unchanged */ });
it('Home points a brand with facts and channels but no competitor to Find competitors', async () => {});
```

- [ ] **Step 2:** Run `pnpm exec vitest run src/domain/research/opportunities src/domain/home`. Expected: FAIL.
- [ ] **Step 3:** Implement to the interfaces above. One system prompt for both paths; data in `<evidence>`, `<approved_facts>` and `<already_proposed>` blocks.
- [ ] **Step 4:** Run the same command, then `pnpm exec vitest run src/domain/research src/domain/plan src/domain/home && pnpm typecheck`. Expected: PASS (watch and plan tests included).
- [ ] **Step 5:** Run `pnpm test`. Expected: no failure outside the discovery stubs' cases.
- [ ] **Step 6:** Commit: `git commit -m "Propose opportunities from everything Research knows, ranked and never repeated"`.

---

### Task 5: Screens

**Model:** sonnet. **Where:** its own worktree, starting from the Task 1 commit, in parallel. **Ports:** `WEB_PORT=3111 API_PORT=8111` on every Playwright command.

**Read first:** this task; discovery plan lines 547–622 (its Task 6; skip its Step 1 and Step 6); discovery spec §7; opportunities spec §5; `web/AGENTS.md`; `web/src/components/research/run-panel.tsx` and `opportunities.tsx` as the patterns to follow.

**Files you own:** everything under `web/` except `web/src/lib/api/schema.d.ts` (generated; already current).

**Build:**
1. **Find competitors** (`/app/b/[brandId]/research/discover`): as the cited plan lines describe, with the tab.
2. **Opportunities, second version:** spec §5. `useOpportunities` reads the rank order the server returns. Evidence comes from `o.evidence` (no join with observations). "Find opportunities" calls `POST …/research/opportunities/scan` and reports `created.length`. Tabs show counts. Restore on dismissed cards; "Plan a campaign" on accepted ones links to `/app/b/{brandId}/plan`.
3. **Ways in** (spec §5): the Research overview's empty state and competitor list, and Brand → Review → Competitors (`CompetitorsPanel` in `web/src/components/brand/review.tsx`).
4. A link is rendered only for an http or https URL (one helper, used for site, channels and evidence sources).

Follow the app's components and tokens (`@/components/app`, `--theme-*` or the Tailwind theme names, never a hex). Respect `prefers-reduced-motion`. If the Skill tool lists `impeccable`, run its audit on the two screens once they work and fix what it finds.

- [ ] **Step 1: Write the failing stub specs.** `web/e2e/discover.stub.spec.ts` as the cited lines 581–598 list, plus in `web/e2e/research.stub.spec.ts`:

```ts
test('Find opportunities adds ranked cards with their evidence', async ({ page }) => {
  // scan answers { created: [gap opportunity with 3 evidence items], dropped: 1 } → "1 new opportunity"; the card shows 'Gap', 'High impact', the three evidence lines; the quote opens its source
});
test('restores a dismissed opportunity and links an accepted one to Plan', async ({ page }) => {});
test('an empty brand is sent to Find competitors from Research, Opportunities and the Brand competitors panel', async ({ page }) => {});
test('a javascript: channel is not rendered as a link', async ({ page }) => {});
test('Opportunities does not scroll sideways at 375px with Devanagari evidence', async ({ page }) => {});
```

Update the existing cases in `research.stub.spec.ts` and `brand.stub.spec.ts` that the new empty states and the new opportunity shape change.

- [ ] **Step 2:** Run `WEB_PORT=3111 API_PORT=8111 pnpm exec playwright test e2e/discover.stub.spec.ts e2e/research.stub.spec.ts`. Expected: the new cases FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `WEB_PORT=3111 API_PORT=8111 pnpm exec playwright test e2e/*.stub.spec.ts && pnpm exec tsc --noEmit && pnpm build`. Expected: PASS and a clean build.
- [ ] **Step 5:** Commit in two commits: `Add the Find competitors screen to Research`, `Rank opportunities, show their evidence and add ways in to Find competitors`.

---

### Task 6: Adversarial review of the trust boundaries

**Model:** opus. **Where:** its own worktree, starting from the integration branch after Tasks 2–5 are merged, in parallel with Task 7.

**Read first:** this task; Global Constraints; Review Focus; the two specs' anti-goals; then the code: `server/src/search/`, `server/src/domain/research/discovery/`, `server/src/domain/research/opportunities.ts` (and `opportunity-evidence.ts`), `server/src/workflows/research-discovery.ts`, `saveTextSource` in `server/src/domain/sources/index.ts`, the new routes.

**Files you own:** those files and their tests.

Try to break each boundary. For every defect, first write a failing test that proves it, then fix it, then show the test passing. Report what you tried that held, too.

- **Untrusted text:** instructions in a snippet, a page, a Maps listing, a quote, a keyword; control, bidi and invisible characters; look-alike names; over-long fields; a model answer that cites IDs it was not shown, another row's source, or another brand's fact.
- **URLs:** `javascript:`, `data:`, `file:`, private addresses, redirects, a model-invented `site`; nothing is fetched outside the fetch guard and nothing non-http is stored.
- **Money:** any search or model call before confirm; confirm twice; confirm over the cap; a retry repeating a paid step; a cancelled run that keeps spending; concurrent scans or confirms; cost rows left reserved after a failure.
- **Brand isolation:** every new route and workflow step with another brand's run, candidate, source, fact and opportunity IDs; a workflow started for brand A with brand B's run ID.
- **Robustness:** a brand with no facts, no website, no results; 30 candidates; a duplicate `matchKey` race between two runs.

- [ ] Done when: every defect found has a test and a fix, `pnpm test && pnpm typecheck && pnpm openapi:check` pass in `server/`, and the report lists each defect (test name, fix) and each attack that held.
- [ ] Commit one commit per defect, subject saying what was wrong.

---

### Task 7: The whole flow in a browser, against the real API

**Model:** sonnet. **Where:** its own worktree, starting from the integration branch after Tasks 2–5 are merged, in parallel with Task 6. **Ports:** `WEB_PORT=3112 API_PORT=8112`.

**Read first:** this task; `web/e2e/research.spec.ts`, `web/e2e/helpers.ts`, `server/scripts/e2e-server.ts`; `web/README.md` on e2e.

**Files you own:** `web/e2e/research.spec.ts`, `web/e2e/helpers.ts`, `server/scripts/e2e-server.ts`. A defect the test exposes elsewhere: fix it with the smallest change and list it under "Fixes outside my files".

**Build:**
- `e2e-server.ts`: `PUT /__e2e/search` (`{ kind, query, hits }`) and `DELETE /__e2e/search`, driving `mockSearch`; the server runs with `SEARCH_PROVIDER=mock`. Helpers `setSearch` and `resetSearch`.
- One test, "from no competitors to a planned opportunity", through the screens only:
  1. A brand with a website and one approved fact, no competitor. Research shows **Find competitors**.
  2. Suggest keywords (queued answer), edit one, Search, see the estimate, Confirm.
  3. The table shows the brand's row and two businesses, one with a site served by the fixture server, one found only on Maps; open an inferred cell and a quoted cell.
  4. Watch the one with a site; hide the other. Research overview lists the competitor with its watched pages.
  5. Baseline run, confirm; change the fixture page; run again; the change shows with its before and after quotes, and an opportunity of kind "Answer a change" appears.
  6. Opportunities: **Find opportunities** adds a "Gap" opportunity whose evidence names the competitor; accept it; Plan lists it as an accepted opportunity.
- [ ] Done when: `WEB_PORT=3112 API_PORT=8112 pnpm exec playwright test e2e/research.spec.ts` passes twice in a row, and `pnpm exec tsc --noEmit` passes in `web/`.
- [ ] Commit: `git commit -m "Prove Research end to end: find, watch, change, opportunity, plan"`.

---

### Task 8: Final review and cleanup

**Model:** fable. **Where:** the integration branch, after Tasks 6 and 7 are merged.

**Read first:** this task; Global Constraints; Review Focus; both specs; the ledger's deferred findings (path given at dispatch); the branch diff against `main`.

1. **Review the whole branch** for security and correctness with fresh eyes: the Review Focus list, the specs' acceptance lists line by line, module boundaries, leftover stubs (`not built`), `shortcut:` comments without a limit, dead code. Fix what you find, each with a test.
2. **Triage the deferred findings:** fix or record why not.
3. **Docs:** `docs/status.md` (Research row, the not-built rows, environment table), `docs/structure.md`, `docs/architecture.md` (module 2 inputs and outputs, costs), the Research design §4 (discovery now points to its design; opportunities to theirs), and a "What changed during the build" table at the end of each of the two new specs for every place the code differs from them.
4. **Verify everything:** in `server/`: `pnpm typecheck && pnpm openapi:check && pnpm test`; in `web/`: `pnpm exec tsc --noEmit && pnpm build && WEB_PORT=3113 API_PORT=8113 pnpm exec playwright test e2e/*.stub.spec.ts e2e/research.spec.ts`. After `pnpm openapi` and `pnpm api:types`, `git status --porcelain` shows no change.

- [ ] Done when: all of step 4 passes and the report lists every finding with its fix or its reason, and anything the owner must do (the Serper key, prices to set).
- [ ] Commit the fixes one per finding, then the docs in one commit.
