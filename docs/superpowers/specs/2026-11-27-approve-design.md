# Approve (module 5): design

For the developer who builds the Approve module. Requirements come from `docs/AI_Marketing_Operating_System_specs.md` (§2.2, §4.1, §4.2, §21.2). Code placement and shared interfaces are in `docs/structure.md`. The owner asked for Approve to be built in parallel, like the earlier modules, without reviewing a design first. Every scope decision below is the designer's call and is open to correction.

## 1. Intent

Studio produces drafts and marks them ready. Approve is the gate between a ready draft and the public: the owner sees exactly what will go out and approves that exact version. Nothing later in the product may publish without a valid approval. The landing page promises this as "You approve the exact version that posts".

```
Ready draft (Studio): copy, images or video, channel, day
                    ▼
Queue, soonest first: each item with its risk and its state
                    ▼
Preview of the exact payload → approve (or reject with a reason)
                    ▼
Approval record: who, when, which version, a hash of the payload, when it expires
                    ▼
Valid only while: the payload is unchanged, its facts are still approved, its assets still have
rights, it has not expired, and the brand is not paused
                    ▼
Publish (module 6) asks one function: is there a valid approval for this draft?
```

## 2. In scope

- **Approval queue and dashboard.** Every ready draft, ranked by its planned day and then its risk, with counts of what is waiting, approved, rejected and no longer valid.
- **Exact-version preview.** The copy in each language, every rendered image or the video, the channel and day, the facts it cites, what was left out, its risk and why.
- **Approve and reject.** A rejection needs a reason. A decision is a new record; nothing is edited afterwards.
- **Bulk approval**, under the spec's conditions (§4.2).
- **Emergency pause.** One switch per brand that makes every approval unusable until resumed (§4.2).
- **Settings.** The names of the approvers and how many days an approval stays valid (14 by default).
- **The gate for later modules:** one exported function that returns a draft's approval only when it is valid.

## 3. Rules

- **An approval binds to a payload hash.** The hash covers the draft's version, channel, day, content and the checksum of every rendered file. The screen sends back the hash it showed. If the draft changed in between, the approval is refused with "changed since you opened it".
- **An approval stops being valid on its own** (§4.2, AT-013). Its state is worked out on every read, so nothing has to remember to revoke it:

| State | When |
|---|---|
| `waiting` | The draft is ready and has no decision for its current version |
| `approved` | Approved, and every condition below still holds |
| `rejected` | Rejected for its current version. A new version returns it to `waiting` |
| `invalid` | Approved, but the payload changed, the draft is no longer ready, a cited fact is no longer approved, or a used asset has lost its rights |
| `expired` | Approved, but past its expiry |
| `paused` | Approved and otherwise valid, while the brand is paused |

- **Expiry** is the earliest of: the approval date plus the brand's validity days, the earliest expiry of a cited fact, and the earliest rights expiry of a used asset.
- **Nothing blocked can be approved.** Approval is refused while the draft has a blocking finding from Studio's checks.
- **Risk** (§21.2) is worked out by fixed rules, shown with its reasons:

| Risk | When | Effect |
|---|---|---|
| `high` | The brand's industry is regulated (health, medical, pharmacy, finance, banking, insurance, investment, legal, safety, employment, political, children, alcohol, tobacco, gambling), or the copy says `guarantee`, `guaranteed`, `cure` or `risk-free` | Approval needs a written review note of at least 20 characters. Never in a bulk approval |
| `medium` | The copy has a price, a percentage or a comparison word (`best`, `cheapest`, `lowest`, `better than`, `#1`, `no. 1`), or its pillar is `comparison` or `offer` | Approved one at a time or in bulk with others of the same risk |
| `low` | Everything else | As medium |

- **Bulk approval** needs every item to share one risk and one channel and to fall in one week, and each item's current version must have been opened in the preview first. Each item's hash is checked like a single approval. One failure approves none.
- **Pause** does not delete anything. Approvals can still be given while paused, but none is valid until the brand is resumed. Pausing and resuming need a reason and are audited.

## 4. Not in this sprint

| Left out | Why |
|---|---|
| Separate approver logins, client approvers, two-person approval (§4.1 P4) | There is no login yet |
| Reminders and escalation (WF-007) | There is nobody to notify until users exist |
| Approval of things other than Studio drafts | Facts, briefs, weeks and battlecards are approved inside their own modules. The record is built to take other object types later |
| Publication windows and quiet hours | They belong with Publish |

## 5. Data

Tables, all brand-scoped with RLS: `approvals` (append-only: the app role gets no `UPDATE` or `DELETE` on it), `approval_views`, `approve_settings`.

## 6. Acceptance

- Approving with a hash that no longer matches the draft is refused.
- Editing a draft after approval makes its state `invalid` without any action in this module (AT-013).
- A cited fact that expires makes the approval `invalid`.
- A high-risk draft cannot be approved without a review note, and cannot be in a bulk approval.
- While the brand is paused, the gate function returns nothing for an approved draft.
- Brand B's approvals cannot be read or given through brand A's path.
