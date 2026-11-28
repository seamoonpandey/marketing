# Architecture

Prachaar is a marketing team that runs on AI, for brands in Nepal. The owner states what is true about a brand once and approves each fact. Prachaar finds and watches competitors, plans a week of content, writes and designs the posts from approved facts only, asks the owner to approve each post, and then sends it or hands it over to post by hand. Every step shows what it will cost before it spends, and nothing reaches the public without the owner's approval of the exact content. `docs/structure.md` is the code layout; `docs/status.md` is what is built and what is not.

## The modules, in the order work flows

| # | Module | Takes in | Puts out | Design |
|---|---|---|---|---|
| 1 | Brand (`knowledge`) | A website, uploaded files, typed entries | Approved facts with source and quote, palette, assets, readiness score | [brand onboarding](superpowers/specs/2026-11-27-brand-onboarding-design.md) |
| 2 | Research | The owner's search keywords, web and Maps search results, the competitors' public pages; approved facts | Businesses found and compared side by side (each cell quoted or marked inferred), the competitors the owner picked to watch, observations of changes, competitor profiles, ranked opportunities with the evidence each rests on, battlecards | [competitor research](superpowers/specs/2026-11-27-competitor-research-design.md), [competitor discovery](superpowers/specs/2026-11-28-competitor-discovery-design.md), [opportunities](superpowers/specs/2026-11-28-opportunities-design.md) |
| 3 | Plan | Approved facts, opportunities, the owner's goals | Campaign briefs and an approved week plan of items (day, channel, format) | [plan](superpowers/specs/2026-11-27-plan-design.md) |
| 4 | Studio | An approved plan item and the facts it may cite | A draft with copy, designs and video, its checks, a ready version | [studio](superpowers/specs/2026-11-27-studio-design.md) |
| 5 | Approve | A ready draft version | An approval bound to that version's payload hash, with an expiry, or a rejection | [approve](superpowers/specs/2026-11-27-approve-design.md) |
| 6 | Publish | An approved draft and a channel | A scheduled job, then a published post with its link, or a manual package | [publish](superpowers/specs/2026-11-27-publish-design.md) |
| | Home | Every module's summary | What needs the owner now, ranked; this month's cost | none (code: `server/src/domain/home/`) |

Base services under every module: brands and competitors, sources (fetching and storing pages and files), costs, audit. Research also uses the search gateway (`server/src/search`): web and Maps queries through Serper, paid per query.

```
website / files / typed entries
        |  extract (model) -> facts proposed, quote checked against the source
        v
   [Brand] owner approves each fact ----> approvedFacts (only current, approved, unexpired)
        |                                        |
        |                         +--------------+----------------+
        v                         v                               v
   [Research] observations,  ->  [Plan] brief, week plan  ->  [Studio] copy + designs + video
   opportunities                  owner approves the week        checks (numbers, words, rights)
                                                                  | owner marks a version ready
                                                                  v
                                                           [Approve] payload hash, risk, expiry
                                                                  | validApproval
                                                                  v
                                                           [Publish] schedule -> gate -> send
                                                                  |                (gate again)
                                                                  v
                                                       published post, or a manual package
   [Home] reads every module's summary          cost ledger and audit log record every step
```

## One post, from an approved fact to a published post

| Step | What happens | Rule that guards it | Code |
|---|---|---|---|
| 1 | A fact is proposed from a source, with the quote it came from | `verifyQuote`: the quote must appear in the source text. A stated fact whose quote is not found has no source link and carries the warning "quote not found in source" | `domain/sources/verify-quote.ts`, `domain/knowledge/facts/` |
| 2 | The owner approves the fact; it may carry an expiry | Only current, approved, unexpired facts leave Brand, through `approvedFacts` | `domain/knowledge/facts/index.ts` |
| 3 | Plan puts the fact-backed idea on a day and channel; the owner approves the week | Plan reads facts only through `approvedFacts` | `domain/plan/` |
| 4 | Studio composes the copy: the model answers in sentences, each marked a claim or not | A claim is kept only if it cites a supplied approved fact; the rest are listed as left out | `domain/studio/compose.ts` |
| 5 | Studio checks the copy and every slide | Every number must appear in a fact the draft cites (`unverified_number` blocks); prohibited words, caption length, missing call to action, expired facts, assets without a licence, text that overflows a design all block | `domain/studio/checks.ts` |
| 6 | The owner marks a version ready | Any later edit makes a new version and returns the draft to `draft` | `domain/studio/drafts.ts` |
| 7 | The owner approves that version | The approval stores the SHA-256 of the exact payload (version, channel, day, content, every render's checksum and order). A changed screen is refused as `changed`. High-risk content (promises, regulated industries) needs a review note of at least 20 visible characters and cannot be approved in bulk | `domain/approve/decisions.ts`, `hash.ts`, `risk.ts` |
| 8 | The approval's validity is worked out on every read | It is never stored as valid. It lapses by itself at the earliest of: decision date plus the brand's validity days, a cited fact's expiry, a used asset's rights expiry. It turns invalid if the payload hash differs, a check now blocks, a cited fact is no longer approved, or an asset has no rights. Pausing approvals stops it too | `domain/approve/state.ts` |
| 9 | The owner schedules the post on a channel | `scheduleJob` asks the gate (`validApproval`) first; the job records the approval's version and payload hash | `domain/publish/schedule.ts` |
| 10 | At the due time the send workflow claims the job | Only the run that made the claim may send; a job more than 24 hours late is refused as missed | `domain/publish/send.ts` |
| 11 | Immediately before sending, in the same step, the gate is asked again | Anything that changed since scheduling stops the post; the send carries the job's one idempotency key | `domain/publish/send.ts` (`gate`) |
| 12 | The connector sends, or the owner is handed a package to post by hand | A manual channel never sends; the owner confirms with the post's link | `domain/publish/connectors/`, `manual.ts` |
| 13 | A timeout or an error that is not a typed answer is an unknown outcome | The job becomes `unknown`; nothing is sent again until a lookup (after 60, 300 and 900 seconds) or the owner says whether it was posted | `domain/publish/state.ts`, `send.ts` |

## Trust rules

The product depends on these. Each is enforced in code and covered by tests.

- **Facts carry sources and quotes.** A fact shown as sourced has a quote that the quote check found in its source. Text inside a source is data: the model is given no tools, so it cannot act on it.
- **What a competitor or a search result wrote is data.** It reaches the model only inside a tagged block that it cannot close (`dataBlock`, `dataJson` in `server/src/ai`), under a system prompt that says to ignore instructions inside it. It is cleaned before it is stored (`cleanCut`), a link is kept and shown only when it is http or https, and pages are fetched only through the guarded fetcher.
- **A discovered business says where each statement comes from.** A cell is quoted (the quote check found it in the business's page or its search results) or inferred (a reason, a confidence and the sources or approved facts it rests on); anything else is dropped. A site or Maps listing counts as a business's own only when one of its own search results carries it. An opportunity is kept only when it cites competitor evidence the server gave the model, and a claim about the brand's strength only with an approved fact.
- **Only approved facts are used.** Plan, Studio, Approve and Publish read facts through `approvedFacts`. Conflicting facts are blocked until the owner resolves them.
- **Numbers in copy come from cited facts.** The check does not depend on the model labelling its own claims honestly.
- **Approval binds to a payload hash and lapses by itself.** See steps 7 and 8. Approvals are append-only rows; the state is derived on every read.
- **Publishing asks the gate twice and never retries from an unknown outcome.** See steps 9, 11 and 13. Anything that publishes must call `validApproval`.
- **The owner is the only approver today.** There is no login; every action is recorded with the actor `operator`.

## How cost is controlled

- Every model call goes through `extract` in `server/src/ai`, which refuses to run when the call's worst-case cost (input plus its output cap, at the model's list price) exceeds what is left of the tenant's monthly cap (`AI_MONTHLY_CAP_NPR`, calendar month in UTC).
- The check and a cost row reserving the estimate commit together under a tenant advisory lock, so concurrent calls cannot spend the same remainder. The row is then settled with the real token counts. Every call writes a row, failed or not, with the rates it used.
- A search query is paid too. Each goes through `search` in `server/src/search`, which checks the same cap under the same lock and writes its own cost row, priced per query in `ai/registry.ts`; a failed query is recorded at zero.
- The owner sees the estimate and the remaining cap before a paid run starts (`CostConfirm`); a run that would exceed the cap cannot be confirmed. Rendering is local and costs no model money.
- A discovery run searches nothing and calls no model until the owner confirms its estimate, an upper bound: two queries a keyword, one call to group the results, at most 30 calls to describe a business (20 search results of 700 characters and 12,000 characters of its home page each) and one for the brand's own row. Suggesting keywords and "Find opportunities" are single calls the owner starts with a click, with no confirm step; the cap applies.
- An estimate prices one model attempt per call. A second attempt (when an answer does not match its schema) can take a run past the bound it showed, never past the cap.
- A retried run forks from its first failed step, so a completed paid step is not paid for twice.
- Scheduled competitor checks have their own per-run ceiling, `RESEARCH_RUN_CAP_NPR`, and pause a target after repeated failures. Nothing else spends on a schedule: the owner starts each draft, each import, each search for competitors and each scan for opportunities.
- `/api/brands/{brandId}/costs` lists the month's spend by run; Home shows it by module.

## How brands are isolated

- One tenant runs today (`TENANT_SLUG`). Every brand-owned table has `tenant_id` and `brand_id` and a Postgres row-level security policy; the app connects as a role without `BYPASSRLS`.
- Every query runs in `withBrand(brandId, …)`, which sets the tenant and the one brand for the transaction. A brand outside the tenant answers 404 and leaves a `denied` audit event. Workflow steps use the same functions.
- Storage keys start `tenant/<t>/brand/<b>/`; Approve refuses a draft whose renders are stored under another brand's prefix.
- `server/src/isolation.int.test.ts` calls every route with another tenant's brand and foreign IDs; a route that is not listed there fails the suite.
