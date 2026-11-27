# Plan (module 3): design

For the developer who builds the Plan module. Requirements come from `docs/AI_Marketing_Operating_System_specs.md` (§8, WF-004). Code placement and shared interfaces are in `docs/structure.md`. The owner asked for Plan to be built in parallel, the same way as Brand and Research, without reviewing a design first. Every scope decision below is the designer's call and is open to correction.

## 1. Intent

Brand says what is true about the brand. Research says what competitors are doing. Plan decides what the brand will say next, and when: it turns goals, approved facts and accepted opportunities into campaign briefs and a weekly content calendar that the owner approves. The landing page promises this as "Approve the first week's plan".

```
Approved brand facts (Brand)      Accepted opportunities (Research)
            └──────────────┬──────────────┘
                           ▼
Campaign: objective, dates, audience, budget  ──►  Brief, drafted by the model, approved by the owner
                           ▼
Plan settings: channels with posts per week, content pillars
                           ▼
Week plan: one item per post, with day, channel, format, pillar, funnel stage, idea and call to action
   cost shown first → model drafts → balance checked → owner edits → owner approves
                           ▼
Approved items are the briefs the Studio module will produce (module 4)
```

A plan item is an idea for a post. Writing the post is Studio's job.

## 2. In scope

- **Plan dashboard.** This week and next week with their status, active campaigns, accepted opportunities that have no campaign yet, and the month's planning cost.
- **Settings.** The channels the brand uses with posts per week for each, the content pillars, and the day the week starts (Sunday by default, as in Nepal).
- **Campaigns** (§8.1). A campaign has a name, objective, dates, audience segment and budget. It can start from an accepted Research opportunity.
- **Campaign brief.** The model drafts it in nine sections: goal and KPI, audience, offer and message, channel mix, creative, conversion, budget, measurement and risk. The owner edits and approves it.
- **Week plan** (WF-004). The model drafts a week of items from the settings, the approved facts, the active campaigns with approved briefs, and the accepted opportunities. The owner edits, adds and removes items, then approves the week.
- **Balance check** (§8.3). Every plan is checked against fixed rules each time it is read.

## 3. Rules

- **No invented claims.** A brief statement in the audience or offer sections is kept only when it cites an approved fact that was supplied. Anything else moves to a "left out" list, as on a battlecard. The same rule applies to the owner's own edits, so an offer always points at an approved fact.
- **Approval binds to what was approved** (§4.2, AT-013).
  - Editing, adding or removing an item of an approved week sets the week back to draft and records that the approval was invalidated.
  - Editing an approved brief retires that version and starts a new draft.
- **An approval cannot outlive its facts.** The balance check runs against today's approved facts. A week that cites a fact which has since expired or been rejected cannot be approved until the item is fixed.
- **Cost first.** The screen shows the estimate before a draft starts, and every model call goes through the base gateway, which enforces the monthly cap.
- **The brand must have facts.** Drafting is refused with a clear message while the brand has no approved fact.
- **Source material is data.** The model gets no tools, and text inside facts or opportunities is never treated as instructions.

Balance rules:

| Rule | Blocks approval | Meaning |
|---|---|---|
| `same_day_channel` | Yes | Two items on one channel on one day |
| `incomplete` | Yes | An item lacks its idea, call to action, pillar, funnel stage or format |
| `duplicate_idea` | Yes | Two items in the week have the same idea |
| `unknown_fact` | Yes | An item cites a fact that is not approved today |
| `channel_count` | No | A channel has more or fewer items than its posts per week |
| `pillar_share` | No | With five or more items, one pillar has over 40% of them |
| `format_variety` | No | With four or more items, every item has the same format |
| `repeat_idea` | No | An idea repeats one from the approved plans of the previous four weeks |

## 4. Not in this sprint

| Left out | Why |
|---|---|
| A weekly schedule that drafts the plan on its own | It would spend money without the owner asking. The owner starts each draft |
| The fatigue index and planning from past performance (§8.3) | They need the Results module's data |
| Experiments and paid media plans | They belong with Results and Ads |
| Writing the posts, designs and video | That is Studio |
| Drag and drop on the calendar | Items are moved by editing their day |

## 5. Data

Tables, all brand-scoped with RLS: `plan_settings`, `campaigns`, `campaign_briefs`, `week_plans`, `plan_items`, `plan_runs`. Brief bodies, left-out lists and settings lists are `jsonb`.

## 6. Screens

- **Plan dashboard:** the two weeks, campaigns, waiting opportunities and cost.
- **Calendar:** a week as seven day columns of item cards, with the balance findings, item editing and the approve action.
- **Campaigns:** the list, and one campaign with its brief by section, its left-out list, and generate, edit and approve.
- **Settings:** channels, posts per week, pillars and the week's first day.

## 7. Acceptance

- A drafted week for a brand with two channels at three posts each has six items, and the balance check reports nothing blocking.
- Editing the call to action of an item in an approved week sets the week back to draft (AT-013).
- A brief's offer statement with no approved fact behind it is left out and listed.
- A week citing a fact that expired yesterday cannot be approved.
- Brand B's campaigns and plans cannot be read through brand A's path.
