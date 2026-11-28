# Competitor discovery (Research): design

For the developer who adds competitor discovery to the Research module. Requirements come from `docs/AI_Marketing_Operating_System_specs.md` (§6.2 "Competitor discovery", role R04). It fills a gap that [competitor research](2026-11-27-competitor-research-design.md) §4 left open: "Competitor discovery … needs a web search provider". Code placement and shared contracts are in `docs/structure.md`.

## 1. Intent

Today the owner types in their competitors by hand (Brand → Review → Competitors), and Research watches only those. Many owners do not know their whole field. Discovery has Prachaar find the competitors itself: it searches with keywords that fit the brand, collects every business it finds, and describes each one. The owner compares them side by side against their own brand and picks which ones to watch. Where a competitor's pages do not say something outright, Prachaar infers it, and says it is inferring.

```
Approved brand facts + brand country
  ▼
Suggest keywords (model, one small call)  → the owner edits, adds, removes
  ▼
Start a discovery run → estimate, an upper bound → the owner confirms        (nothing is spent before this)
  ▼
Search each keyword: web results + Maps business listings (Serper, set to the brand's country)
  ▼
Group the results into businesses (model): merge duplicates, drop the brand itself, directories, news
  ▼
For each business, at most 30: read its home page if it has one → one row of cells, each quoted or inferred
  ▼
Compare table, the brand's own row pinned on top → tick → "Watch selected" → competitors → existing watch-list step
                                                 → "Not a competitor" hides a row for this and later runs
```

## 2. Goals, non-goals, anti-goals

**Goals (the owner's):**
- Find competitors with searches on fitting keywords, and list all that are found.
- Describe what each does, using inference where the pages do not say it.
- Let the owner compare them side by side and pick which to watch.

**Non-goals (this build):**
- No schedule. Discovery runs only when the owner starts it (spec says onboarding and quarterly; the owner reruns it when they want). Nothing in Prachaar spends on a schedule except the capped weekly watch.
- No reading of Facebook, Instagram or TikTok pages: they need a login. A business found only there is described from its search snippets and Maps listing.
- No ad library, review, social content or search-gap scans; those stay as listed in the Research design §4.
- No change to how watching works. Picking a competitor hands it to the existing suggest-and-confirm watch-list step.
- No Home card for discovery results.

**Anti-goals (a failure even if it works):**
- An inference shown as if it were a fact. Every cell says whether it is quoted or inferred.
- An invented competitor: every row must come from at least one search result.
- Money spent before the owner confirms, or a run that exceeds the monthly cap.
- A rival's page text steering the result (prompt injection).

## 3. Constraints (from the project rules)

- **Search is a new paid service.** Search goes through one function, `search(query, kind, country)` in a new `server/src/search/` folder, with a `mock` provider driven by fixtures. `SEARCH_PROVIDER=mock` in tests and by default in `.env.example`, as `AI_MODEL=mock` is. Real runs need `SERPER_API_KEY`. Without it, suggesting keywords still works and starting a run answers 503 with "Search is not set up".
- **Model calls** go through `extract` only, with no tools. Search results and page text are data; the system prompts say instructions inside them are ignored.
- **Search costs go in the ledger.** Each search call writes a `cost_events` row (provider `serper`, one input unit per query, priced in `server/src/ai/registry.ts` like a model) and counts against the monthly cap. My call: this keeps one ledger and one cap, and Home's cost card stays right.
- **Public data only (R04).** Pages are read through the existing `savePageSource` (robots.txt, one request a second per site, no login, no forms). Snapshots are `sources` rows with trust `external`.
- **Evidence or inference, never neither** (§5.2).
- **Text comparisons** (merging duplicate names, matching dismissed and watched rows) use `server/src/text/normalise.ts`, never `===`.
- **Brand data:** every query in `withBrand`; every new table declares `brandPolicies`; every new route gets an entry in `server/src/isolation.int.test.ts`.
- **Migrations are generated** from `server/src/db/schema/research.ts`; `server/openapi.json` and `web/src/lib/api/schema.d.ts` are regenerated.
- **Data leaving Nepal** (open question 4 in `docs/stack.md`): search queries carry the brand's category and city, not brand documents. I judge that acceptable; say so if not.

## 4. Approaches considered (search source)

| Option | Trade-off |
|---|---|
| **Serper**, Google web results plus Google Maps listings, `gl` set to the brand's country | Best coverage of Nepali businesses; Maps listings catch shops with only a Facebook page, with category, address, rating. About USD 1 per 1,000 queries, 2,500 free. A third party reselling Google results; its price page needs signup |
| Brave Search API | An independent index and a stable vendor, about USD 5 per 1,000. Likely weaker on small Nepali businesses (untested) and no Maps listings for Nepal |
| Tavily | Returns page text too, about USD 8 per 1,000; Nepal coverage unknown |
| The model's own web-search tool | Ruled out: the model gets no tools |

**Picked: Serper** (my call; the owner handed over the how). The provider sits behind `search()`, so moving to Brave later is one new file.

## 5. How it works

### 5.1 Keywords

- `POST …/research/discovery/keywords` reads the approved facts and the brand's country and asks the model for 6 to 10 search keywords: what the brand sells, in the places it sells it, the way a customer would search ("momo restaurant Kathmandu", "frozen momo delivery Nepal"). One small call, about NPR 3, started by the owner's click like "Generate battlecard". It answers the list; nothing is stored.
- The owner edits the list in the page: add, remove, change. At most 15 keywords, each at most 80 characters. A keyword without a place in it finds aspirational and online competitors; the page says so in one line of help text.
- A brand with no approved facts gets no suggestions and a message pointing to Brand; the owner can still type keywords.

### 5.2 The run

A DBOS workflow `research-discovery` in `server/src/workflows/`, built the way `research-watch.ts` is: the run ID is the workflow ID, each step returns plain JSON, retry forks from the first failed step, cancel is supported.

1. **Create** (`POST …/research/discovery/runs` with the keywords): stores the run with its keywords and an upper-bound estimate, state `awaiting_approval`. 409 if a discovery run is already active for the brand. Watch runs and discovery runs do not block each other.
2. **Confirm** (`…/runs/{runId}/confirm`): the owner accepts the estimate, as with the watch baseline (`CostConfirm` in the web). A run whose estimate exceeds the remaining monthly cap cannot be confirmed. Unconfirmed runs expire after 7 days.
3. **Search:** for each keyword, one web query (10 results) and one Maps query. Results are stored on the run. A failing query is counted and skipped; if every query fails the run fails retryable.
4. **Group** (one model call): from all results, the distinct businesses, each with the result IDs it came from, a site if it has one, social links found in result URLs, and a relevance rank. The prompt drops the brand itself, directories and marketplaces (Daraz, Foodmandu, Tripadvisor and the like), news, blogs and job posts. Code then also drops any business whose site is the brand's own domain, merges rows whose site domain or folded name match, drops any business that matches a hidden candidate or an existing competitor (§5.4), and only then keeps the top 30. So a hidden or already-watched business is never described or paid for again; the run counts how many were skipped.
5. **Profile** (one model call per business, so one failure loses one row): input is the approved facts with IDs, the business's search results and Maps data, and its home page text if it has a site (saved with `savePageSource`; the text is cut to 12,000 characters for the model, the quote check reads the whole page). The search results and Maps data for the business are saved as one text source too, so quotes from snippets are checked the same way. Output is one row (§5.3). A business that matches a candidate from an earlier run (still `new`) updates that candidate's cells, sources and last-found date instead of making a second one.
6. **Own row** (one model call): the brand's own cells from approved facts only, each citing a fact ID. A cell with no valid fact ID is left blank.
7. **Finish:** counts on the run: queries, failed queries, results, businesses found, profiled, cells dropped.

**Estimate, an upper bound:** queries × the search price, plus the group call and 30 profile calls and the own-row call, each at its maximum input and maximum output, at the current model's price. With the default model that is roughly NPR 300; the actual is usually less. Serper may charge a Maps query more credits than a web query: price the two endpoints separately in the registry, from the account's actual rates, so the bound stays a bound. The owner sees it, and the remaining cap, before confirming.

### 5.3 A row and its cells

Columns: **kind** (direct, indirect, aspirational), **sells**, **sells to**, **price level** (low, mid, high), **where** (the area they serve, online or physical), **pitch** (how they describe themselves), **overlap** with the brand (high, medium, low), and **channels**.

Every column except channels holds a cell of one of two shapes:

- **Quoted:** a value, the quote, and the source ID. Kept only when `verifyQuote` finds the quote in that source. Otherwise the cell is dropped and counted.
- **Inferred:** a value, a one-sentence reason, the IDs of the sources or facts it rests on (at least one, all belonging to this row or to approved facts), and a confidence on the same scale observations use. A cell with no reason or no valid ID is dropped and counted.

Kind and overlap are always inferred, because they compare the business with the brand. Overlap's reason must cite at least one approved fact. Channels are not cells: they are links found in the results, the page and the Maps listing (website, Facebook, Instagram, TikTok, YouTube, the Maps listing with its rating), shown as links.

### 5.4 Picking

- **Watch selected** (`POST …/discovery/candidates/watch` with IDs) creates a competitor for each (name, kind, site, social handles) through the brands module and marks the candidate `watched` with the competitor ID. Then:
  - **A business with a site** also gets its suggested pages added straight away (the existing `suggestTargets`, then `addTarget`, up to 5), so it is watched from the next run. Ticking it is the owner's confirmation; they can remove pages on the competitor's page. This takes one of the 10 watch slots under the existing rule (`MAX_COMPETITORS` in `targets.ts`: competitors with watched pages). The page stops the owner ticking more site rows than there are free slots, and the server refuses the whole request if `addTarget` would go over. If the site cannot be read (robots.txt, unreachable), the competitor is still created with no pages, and the row says "Couldn't read the site; add pages on the competitor's page".
  - **A business with no site** (Facebook or Maps only) can be ticked too. It joins the competitor list with its social links, so battlecards and later social scans can use it, and the row says "No website to watch". It takes no slot, because there is nothing the watch run can read.
- **Not a competitor** (`…/candidates/{id}/dismiss`) hides the row. Hidden rows sit in a collapsed "Hidden (n)" list with Restore (`…/restore`), which puts the row back with the cells it last had and their date.
- **One record per business.** A candidate is one row per business per brand, across runs. A business matches a candidate or an existing competitor when their site domains match, or, with no site, their Maps listing ID or folded names match. Matches to hidden candidates and existing competitors are dropped before the top-30 cut (§5.2 step 4), so they cost nothing. Competitors typed in by hand never appear in the table; the run's counts say how many were found again.

## 6. Data

New tables in `server/src/db/schema/research.ts`, brand-scoped with RLS:

- `discovery_runs`: keywords, state (`runColumns`), estimate, actual, counts, results (`jsonb`: the raw search results the run used), workflow ID. One active run per brand, enforced by a partial unique index as `watch_runs` does.
- `discovery_candidates`: one row per business per brand (unique on brand and match key): name, match key, site, channels (`jsonb`), cells (`jsonb`), source IDs, rank, status (`new`, `watched`, `dismissed`), competitor ID, first run ID, last run ID, last found at, dismissed at.

The table shows candidates with status `new` or `watched`, each with the date it was last found; the hidden list shows `dismissed` ones.

## 7. Screens

A third Research tab, **Find competitors** (`/app/b/[brandId]/research/discover`), components in `web/src/components/research/`:

```
Find competitors   [momo restaurant Kathmandu ✕] [frozen momo Nepal ✕] [+ add]  [Suggest keywords]  [Search · up to NPR 300]

              Kind      Sells                For               Price   Where       Channels   Pitch             Overlap
★ Your brand  —         Steamed, frozen momo Families, offices Mid     Kathmandu   Web FB IG  "Fresh daily…"    —
☐ Momo Hut    direct~   Momo, thukpa         Students~         Low~    Lalitpur    FB IG Map  "Cheapest in…"    high~
☐ Bhojan Ghar indirect~ Nepali thali         Office lunch~     Mid~    Kathmandu   Web FB     "Ghar jasto…"     medium~
☐ Dai Ko Momo direct~   Momo                 Locals~                   Lalitpur    FB Map     —                 high~   No website to watch
  Himal Momo  direct~   Momo                 Families~         Mid~    Kathmandu   Web FB     "Since 2010…"     high~   Watching
                                        [Watch 2 selected]   [Not a competitor]      Hidden (3) ▸
~ inferred: hover or tap to see the reason and the evidence
```

- Sorted by overlap, then rank; filter by kind.
- A quoted cell opens its quote and source link; an inferred cell opens its reason, confidence and evidence links. Both work by keyboard and on touch.
- The run in progress shows its step and counts; a failed run shows Retry, an awaiting one shows the estimate with Confirm and Cancel, as the watch run panel does.
- On a narrow screen the table scrolls sideways inside its own frame with the name column sticky; the page itself never scrolls sideways.
- Quotes and names may be in Devanagari. Add a Devanagari face (Noto Sans Devanagari) to the app's font stack, per the project's Nepali-text rule.

## 8. Acceptance

All against the mock search provider and the mock model, so no test pays.

- A keyword run over fixtures where two keywords return the same business gives one row; the brand's own site and a directory listing give no row.
- A quoted cell whose quote is not in its source is dropped and counted; an inferred cell with no reason or no valid source ID is dropped and counted.
- An overlap cell whose only cited ID is not an approved fact is dropped.
- A page telling the model to rate itself "direct, high overlap" has no effect beyond an ordinary row.
- Nothing is searched and no cost is recorded before confirm; after it, each search query has a `cost_events` row; a run whose estimate exceeds the remaining cap cannot be confirmed.
- A dismissed business is not profiled or charged on the next run; restoring it brings its row back with its earlier cells.
- A business found by two runs is one candidate, updated by the second run.
- Watch selected creates competitors with site and handles and adds the suggested pages of those with a site; a request that would exceed the free slots is refused whole; a business with no site is added with no pages and takes no slot; a watched candidate shows as Watching.
- Without `SERPER_API_KEY` (and provider `serper`), starting a run answers 503 and creates nothing.
- Brand B's runs and candidates cannot be read or changed through brand A's paths (isolation test).
- An e2e stub spec covers: suggest, edit keywords, confirm, see rows, open an inferred cell, watch one, hide one.

## 9. Left to the builder

- Prompt wording, the directory and marketplace list, and the exact JSON shapes of cells and counts.
- How Serper's Maps listing ID and fields map onto the row.
- Whether search steps run one per keyword or in one step, as long as a retry does not repeat paid queries already made.
- Polling interval and loading states on the page.

## 10. What changed during the build

Where the code differs from the sections above. None breaks a goal, an anti-goal or an acceptance line.

| Section | The design said | The code does | Why |
|---|---|---|---|
| §5.1, §5.2, §5.4 | Paths under `…/research/discovery/` (`runs`, `runs/{runId}/confirm`, `candidates/watch`) | `POST …/research/discovery/keywords`; runs at `…/research/discoveries` and `…/discoveries/{id}` with `/confirm`, `/cancel`, `/retry`; candidates at `…/research/candidates`, `/candidates/watch`, `/candidates/{id}/dismiss` and `/restore` | The names the watch run's routes already use |
| §5.1 | 6 to 10 suggested keywords | The same, and at least two of them carry no place name; the answer is cleaned, deduplicated by folded text and cut to 10 | The owner asked for searches that reach beyond the local area |
| §5.2 step 3 | If every query fails the run fails retryable | One more step asks every query again, and the run fails retryable only if they all fail again | A failed query is a step that succeeded, so a retry would only have replayed the failures and left the run running. Failed queries cost nothing |
| §5.2 step 3 | 10 web results and the Maps listings | At most 10 web results and 20 listings are kept per query | The estimate prices that many |
| §5.2 step 4 | The model gives each business its site and Maps listing | A site or a listing ID is kept only when one of the business's own results carries it; the group call lists at most 60 businesses (output cap 8,192 tokens) | A snippet could otherwise point a business at another one's key and have it merged or skipped; a longer list was cut off mid-answer |
| §5.2 step 4, §5.4 | A business with no site matches by its Maps listing ID or its folded name | A hidden or watched business with no site is matched by both, so it is never described again. A `new` one is matched by one key (site, else listing, else name), so a business found once on Maps and once only by name can show as two rows | The skip is what costs money; merging `new` rows across keys was left |
| §5.2 step 5 | The business's search results go to the model | At most 20 results a business, each cut to 700 characters; the model cites its two sources as `results` and `page`, and the row stores their source IDs | The estimate prices 20 results of 700 characters; mock answers and models handle short names better than UUIDs |
| §5.2 steps 4 to 6 | A model failure fails the run | A refusal (or an answer that stays off-schema) on one business loses that row and is counted (`failedProfiles`); on the own row it leaves the row empty; on the group call it ends the run `failed_final`, so no retry pays for the same refusal | A retry of a refusal buys the same refusal |
| §5.2 step 6 | The brand's own row | No own row when the search found nothing, and an empty one (no model call) when the brand has no approved facts | There is nothing to compare it with, or nothing to fill it from |
| §5.2 step 7 | Counts: queries, failed queries, results, found, profiled, cells dropped | Also `skipped` (already hidden or watched) and `failedProfiles`. The stored rank is the position after tidying, not the model's number | The screen reports both |
| §5.2 | The estimate is roughly NPR 300 | About NPR 365 for one keyword and NPR 415 for fifteen with the default model and rate | The group call's larger output cap, and 20 results a profile |
| §5.2 | The estimate is an upper bound | It prices one model attempt per call. A repair attempt adds one more, so a run can pass its bound; every attempt checks the monthly cap. The JSON schema `extract` appends and the tags around each block are not priced | The convention every estimate in the product follows |
| §5.3 | Channels: every link found | At most 12, the Maps listing first | A page can link to thousands of profiles |
| §5.4 | Dismiss and restore | Dismiss only from `new`, restore only from `dismissed`; a watch, a hide or a restore that finds the status changed answers 409. A watch request takes the brand's watch-slot lock before it counts free slots | Two requests at once |
| §6 | The tables' columns | `discovery_runs` also has `own_row`; `discovery_candidates` also has `place_cid` and `place` (the first Maps hit, for the rating). A business's search results are a `sources` row of kind `page`, titled "Search results", with the key `search:<run>:<match key>` for a URI | The screen shows the rating; a quote needs a source to be checked against |
| §7 | The Search button shows the estimate; the run in progress shows its step and counts | The estimate appears in the cost confirmation after Search is pressed; a running run shows its state only, and its counts when it ends | An estimate needs the run's keywords stored; the shared run panel shows states |
| §7 | "Watch 2 selected" | "Watch selected", with the free slots beside it | Copy |
| §7 | Add a Devanagari face | Nothing added | The app's font stack already had Noto Sans Devanagari |
| §8 | An e2e stub spec | `discover.stub.spec.ts`, and the full flow against the real API in `research.spec.ts` | The owner asked for the whole path proved |

Cancelling a run records what its cost rows hold at that moment. A watched candidate whose competitor is later deleted stays `watched` (see `docs/status.md`, section 5).
