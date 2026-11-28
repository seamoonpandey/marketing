# Opportunities, second version (Research): design

For the developer who rebuilds Opportunities in the Research module. It replaces §2 "Opportunities" of [competitor research](2026-11-27-competitor-research-design.md) and builds on [competitor discovery](2026-11-28-competitor-discovery-design.md). The owner asked for opportunities to work "properly" and left the design to the designer, so every decision below is the designer's call and is open to correction.

## 1. Intent

Today an opportunity appears only after a watched page changes. A brand that has just found its competitors has an empty backlog for weeks, and opportunities ignore most of what Research knows. In this version an opportunity can come from anything Research holds, compared with what the brand has approved about itself:

```
Changes seen on watched pages ─┐
Competitor profiles (baseline) ─┼─► evidence list ─► model proposes ─► server checks every citation ─► ranked backlog
Discovered competitors' cells ──┤        ▲                                                              │
Approved brand facts ───────────┘        └── titles already proposed (never repeated)                   ▼
                                                                              owner accepts or dismisses; accepted ones go to Plan
```

## 2. Goals, non-goals, anti-goals

**Goals:**
- The owner can ask for opportunities at any time ("Find opportunities"), as soon as one competitor is known.
- Every opportunity shows what it rests on, and each piece of evidence can be opened.
- The backlog is ranked, and nothing is proposed twice.
- A watch run that finds changes still proposes opportunities on its own, inside that run's confirmed cost.

**Non-goals:** no schedule for scans; no automatic scan after a discovery run (it would spend unconfirmed money); no change to how Plan reads accepted opportunities; no measured impact (that needs the Results module).

**Anti-goals:** an opportunity with no competitor evidence behind it; a claim about the brand that is not an approved fact; a competitor's page text steering the result; the same idea proposed again after the owner dismissed it.

## 3. How it works

### 3.1 The evidence list

The server builds a list of evidence items, each with a short reference (`e1`, `e2`, …) that the model cites. Items, in this order and with these limits:

| Type | What | Limit |
|---|---|---|
| `observation` | Changes from the last 60 days: competitor name, summary, the after quote | 40, newest first |
| `profile` | Entries of each existing competitor's latest profile: text, price, quote | 12 per competitor |
| `candidate` | Cells of discovery candidates with status `new` or `watched`: name, column, value, and the quote or the reason | 30 candidates |
| `fact` | Approved brand facts: field, value, unit | all |

Each item is stored with the opportunity as a snapshot: `{ type, id, label, detail, quote?, sourceId? }`. `id` is the row it came from (observation, profile, candidate or fact), `label` is who (the competitor's name, or "Your brand"), `detail` is what. A snapshot stays readable after its competitor is deleted.

### 3.2 What the model returns, and what the server keeps

One `extract` call. For each opportunity: `kind`, `title`, `hypothesis`, `suggestedAction`, `whyItMatters`, `evidence` (references), `impact`, `effort`, `confidence`.

- **Kinds:** `change` (answer something a competitor changed), `gap` (something competitors offer, say or serve that the brand does not address, or a customer, area or price level nobody serves), `strength` (something the brand can prove that competitors do not claim).
- **Impact, effort, confidence:** each low, medium or high.

The server keeps an opportunity only when all of these hold:
1. After unknown references are removed, it cites at least one `observation`, `profile` or `candidate` item.
2. A `strength` cites at least one `fact`.
3. Its title, folded (`foldText`), is not the title of any opportunity the brand already has, in any status.
4. Its title is at most 120 characters and its other texts at most 600 after cleaning; longer text is cut.

Dropped ones are counted. At most **8** are kept per call, the best by rank. The model is also shown the 50 most recent existing titles and told not to repeat them.

**Rank:** impact (high first), then confidence (high first), then effort (low first), then newest.

### 3.3 When it runs

- **After a watch run with new observations** (as today, inside the run's estimate): the evidence list holds only that run's observations and the facts, so the run's cost bound does not grow beyond a fixed allowance for the existing titles.
- **"Find opportunities"** (`POST …/research/opportunities/scan`): the whole evidence list, one call, started by the owner's click like "Generate battlecard". It answers `{ created, dropped }`. With no observation, profile or candidate to go on it answers 400 "Nothing to compare yet: find or watch a competitor first" and calls no model. The monthly cap applies as for every model call (402).

### 3.4 Lifecycle

`new` → `accepted` or `dismissed`, as today. New: a dismissed opportunity can be restored to `new` (`POST …/opportunities/{id}/restore`; 409 unless it is dismissed). An accepted one links to Plan, which already lists accepted opportunities no campaign uses.

## 4. Data

`opportunities` gains `kind` (default `change`), `impact` and `effort` (default `medium`), and `evidence` (`jsonb`, default `[]`). `observation_ids` stays and holds the observation IDs among the evidence, so Plan and Home are untouched. A row from before this version has empty evidence: the read path builds its evidence from `observation_ids`.

## 5. Screens

**Opportunities tab:**

```
Opportunities                                                        [Find opportunities]
[New 4] [Accepted 2] [Dismissed 1]

┌ GAP · High impact · Low effort · Medium confidence ───────────────────────────────┐
│ Offer delivery to offices                                                          │
│ Hypothesis …            Suggested action …            Why it matters …             │
│ Based on                                                                           │
│   Momo Hut: Sells to offices (inferred: "corporate lunch boxes" on its home page)  │
│   Bhojan Ghar: "Office lunch delivered by 12:30" ↗                                 │
│   Your brand: delivery area: Kathmandu                                             │
│ [Accept] [Dismiss]                                                                 │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- "Find opportunities" shows "Looking…" while it runs, then "3 new opportunities" or "Nothing new this time".
- Kind labels: Answer a change, Gap, Your strength.
- A quote opens its source (`SourceQuote`).
- Accepted cards show **Plan a campaign** (link to Plan). Dismissed cards show **Restore**.
- Empty "New" tab: with no competitor and no candidate, the action is **Find competitors**; otherwise **Find opportunities**.

**Ways in to Find competitors** (the owner asked for the button in more places):
- Research overview with no competitors: **Find competitors** is the main action, **Add one by hand** the second.
- Research overview, under the competitor list: **Find more competitors**.
- Brand → Review → Competitors: **Find competitors**.
- Home, when the brand has facts and channels but no competitor: "Find your competitors", linking to Find competitors.

**Search reach** ("searches all over"): keyword suggestions always include at least two keywords without a place name, so online and out-of-town competitors are found as well as local ones; every keyword runs on the web and on Maps.

## 6. Acceptance

All with the mock model.

- A scan for a brand with one candidate and one approved fact keeps an opportunity that cites the candidate, with its evidence snapshot stored; one that cites only an unknown reference is dropped and counted.
- A `strength` that cites no fact is dropped.
- A proposal whose folded title matches a dismissed opportunity is dropped.
- Ten valid proposals give the 8 best by rank.
- A brand with nothing to compare answers 400 and makes no model call.
- A watch run with observations still creates opportunities that cite only that run's observations, and the run's estimate stays an upper bound.
- A row with empty evidence and observation IDs is returned with evidence built from those observations.
- Restore moves a dismissed opportunity to `new`; restoring an accepted one answers 409.
- An instruction inside a competitor's quote has no effect: the call has no tools and the quote sits inside a data block.
- Another brand's opportunity cannot be scanned into, restored or read (isolation test).

## 7. What changed during the build

Where the code differs from the sections above. None breaks a goal, an anti-goal or an acceptance line.

| Section | The design said | The code does | Why |
|---|---|---|---|
| §3.1 | The model is given the evidence items | Items are grouped under their label, so a competitor's name is sent once; row IDs and source IDs stay on the server | Fewer tokens, and the model has nothing to cite but the references |
| §3.2 | A title already used is dropped | The check runs again under a per-brand lock when the proposals are stored, against every title the brand has | Two calls at once could otherwise both store the same title |
| §3.3 | "Find opportunities" is one call | Two scans started at once each pay for a call (a `shortcut:` comment marks it). The screen disables the button while a scan runs | Closing it needs a scan run table, which is a contract change |
| §3.3 | The watch run's opportunities call | `generateOpportunities(brandId, runId)` reads the approved facts itself; the watch run no longer passes them | One read of the facts |
| §3.3 | The scan answers `{ created, dropped }` | It also writes an audit event, `research.opportunity.scan`, with both counts. Its opportunities carry a run ID of their own, not a watch run's | The owner's action is recorded |
| §4 | The read path builds old rows' evidence | The list does, and so do the answers to accept, dismiss and restore | The screen shows the answered row |
| §6 | Text inside a quote sits in a data block | Every `</` inside a block is written `<\/`, so no quote, name or stored title can close its block | A closing tag in a competitor's page ended the block |
