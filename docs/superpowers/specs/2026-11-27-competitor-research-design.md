# Competitor research (module 2): design

For the developer who builds the Research module of sprint 1. Requirements come from `docs/AI_Marketing_Operating_System_specs.md` (§6.2, roles R03 to R05, WF-002). Code placement and shared interfaces are in `docs/structure.md`. The owner asked for Research to be built alongside Brand without reviewing a design first, so every scope decision below is the designer's call and is open to correction.

## 1. Intent

Brand reads the brand's own material. Research reads other people's: it watches the pages of the brand's competitors and turns each change into dated evidence, then into opportunities the owner can act on. The landing page promises this as "Watches 3 competitors every week".

```
Competitors (entered during brand onboarding; a base table)
  ▼
Watch list: up to 5 pages per competitor (pricing, offers, products, home), suggested, then confirmed by the owner
  ▼
First run, the baseline: snapshot each page → competitor profile          (cost confirmed first)
  ▼
Weekly run: snapshot each page → compare its text with the last snapshot
     unchanged → nothing happens and no model is called
     changed   → the model names what changed → observations, each with a before and an after quote
  ▼
Observations (the change log) ──► Opportunities: a hypothesis and a suggested action; the owner accepts or dismisses
                              └─► Battlecard per competitor; the owner approves a version
```

## 2. In scope

- **Watch list.** For each competitor, Prachaar suggests pages from the competitor's site and the owner confirms them. Limits: 5 pages per competitor and 10 competitors per brand.
- **Baseline run.** It snapshots every watched page and extracts a competitor profile: positioning, products with prices, current offers and calls to action. Every profile entry carries a quote.
- **Weekly run** (WF-002). Default Monday 06:00 in the brand's timezone. The owner can pause, resume, run now, retry and cancel it (spec developer rules).
- **Observations.** Types: `price_change`, `new_offer`, `offer_ended`, `new_product`, `product_removed`, `messaging_change`, `other`. Each holds the competitor, a summary, the before and after quotes with their sources, the URL, the date and a confidence (§16).
- **Opportunities** (replaced by [opportunities, second version](2026-11-28-opportunities-design.md)). After a run with new observations, the model proposes hypotheses. Each cites at least one observation and gives a suggested action and why it matters. The owner accepts or dismisses each one. Accepted opportunities are what the Plan module will read.
- **Battlecard** per competitor: where we differ, proof, likely objections and how to respond. The owner approves a version; regenerating makes a new draft and leaves the approved one in place.

## 3. Rules

- **Public pages only** (R04). The fetcher respects `robots.txt`, never logs in, never submits a form and never engages with a competitor. It makes at most one request per second per site.
- **Evidence or nothing.** An observation is kept only when its after quote is found in the new snapshot and its before quote, if it has one, is found in the previous snapshot. Anything else is discarded and counted on the run.
- **No invented claims in a battlecard.**
  - Every statement about our brand must cite an approved fact, by ID.
  - A statement with no valid fact ID is removed and listed under "left out", with the reason.
  - Every statement about a competitor cites an observation or a profile quote.
- **Competitor text is data.** The model gets no tools, and instructions inside a page are ignored (§4.3).
- **Noise is not news.** A change that is only a date, a time, a counter or a block under 20 characters does not count as a change.
- **Cost.**
  - Unchanged pages cost nothing.
  - The baseline run shows an estimate and waits for the owner.
  - A weekly run proceeds on its own when its estimate is at most NPR 150 (`RESEARCH_RUN_CAP_NPR`) and the monthly cap has room. Otherwise it waits at `awaiting_approval`.
- **A failing page does not stop a run.** A page that returns an error, or that `robots.txt` now blocks, is marked and shown to the owner. After three failed runs in a row it is paused.
- **One run at a time per brand.** A second request gets HTTP 409.

## 4. Not in this sprint

Two rows of the first version of this table are built since: competitor discovery has its own design, [competitor discovery](2026-11-28-competitor-discovery-design.md), and the Opportunities item in §2 is replaced by [opportunities, second version](2026-11-28-opportunities-design.md).

| Left out | Why | What stands in |
|---|---|---|
| Screenshots of competitor pages | They need a headless browser on the server. **The landing page says "with screenshots saved"**, so this is a gap against published copy | The saved page text and the before and after quotes |
| Public ad library scan | Meta's API needs an approved app and a verified identity | A link field per competitor, opened by hand |
| Market and trend scans (WF-003), search gap, AI answer visibility | Each needs its own design; the search gateway they would use exists (`server/src/search`) | Nothing yet |
| Review and voice-of-customer scan | It needs consent and PII handling (R05) | Nothing yet |
| Social content scan | Platform APIs and policies vary by channel; this belongs with Publish | Nothing yet |
| Email or push alerts | There is no user to notify until login exists | New observations show on the Research screen |

## 5. Data

Tables, all brand-scoped with RLS: `watch_targets`, `watch_schedules`, `watch_runs`, `competitor_profiles`, `observations`, `opportunities`, `battlecards`. Page snapshots are base `sources` rows with trust `external`. Profiles, battlecard bodies and run counts are `jsonb`.

## 6. Screens

- **Research overview:** what changed since the last run, the run in progress, and the schedule with its controls.
- **Competitor:** profile, change log, watched pages and the battlecard.
- **Opportunities:** the backlog, with accept and dismiss.

## 7. Acceptance

- A second run over unchanged pages makes no model call and records no cost.
- A price change on a fixture page produces one `price_change` observation whose two quotes are found in the two snapshots.
- A page that tells the model to ignore its instructions produces no effect beyond ordinary observations.
- A battlecard statement with no approved fact behind it is left out and listed.
- Brand B's observations cannot be read through brand A's path.
