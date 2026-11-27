# Publish (module 6): design

For the developer who builds the Publish module. Requirements come from `docs/AI_Marketing_Operating_System_specs.md` (§9, §20.2, §20.3, WF-008). Code placement and shared interfaces are in `docs/structure.md`. The owner asked for Publish to be built in parallel, like the earlier modules, without reviewing a design first. Every scope decision below is the designer's call and is open to correction.

## 1. Intent

Approve says a draft may go out. Publish sends it: it schedules an approved draft to a channel, sends it at the right time, and records where it ended up. Its hardest duty is never to post twice and never to post something that is no longer approved.

```
Approved draft (Approve) + channel + time
                    ▼
Scheduled job, holding the approval's payload hash
                    ▼  at the scheduled time
Ask the gate again: is this exact payload still approved?   no → blocked, shown to the owner
                    ▼ yes
Manual channel → "post this by hand now": the owner posts it and confirms with the link
API channel    → the connector sends it → published, or failed, or unknown
                    ▼
Unknown (the request timed out after sending): look for the post before any retry
                    ▼
Published: the post's link and ID are stored for the Results module
```

## 2. The constraint that shapes this sprint

**No platform app credentials exist yet** (owner decision 14, §24.1), and the real platforms need app review. So this sprint ships the whole pipeline with two connectors:

- **`manual`**, for real use today. The landing page already promises it: "the rest get a finished draft to post by hand". At the scheduled time the owner gets the finished copy and media to post by hand, then confirms with the post's link.
- **`mock`**, for tests only. It can be told to succeed, fail, time out or answer any of the errors in §20.3, so the state machine and the no-duplicate rule are proven without a real platform.

A real connector, for Facebook or Instagram for example, is then a single file behind the same contract. It needs the owner's app credentials and the platform's review first.

## 3. In scope

- **Channels.** The brand's accounts by platform, each with its mode (manual for now) and status. A capability table per platform holds text limits, accepted image shapes and media counts (§9.1), marked with the date it was last checked.
- **Scheduling.** An approved draft goes to one or more channels, each as its own job with its own state (AT-015).
- **Publishing**, by the state machine below, started by a check every minute.
- **Manual posting.** A package of the copy and the right-shaped media, with copy and download controls, and a confirmation that records the post's link.
- **Calendar and history** (FR-SOC-008).
- **Publish dashboard.** What to post by hand now, what needs attention, what is coming, and what went out.
- **Settings.** The hours of the day when posts may go out, and the number of attempts.

## 4. Rules

- **The gate is asked twice:** when a job is scheduled and again at the moment of sending. A job stores the payload hash it was scheduled with. If the valid approval's hash differs at send time, or there is no valid approval, the job becomes `blocked` and nothing is sent. A paused brand sends nothing.
- **Never twice** (FR-SOC-004, AT-014).
  - Every job has one idempotency key, passed to the connector on every attempt.
  - A job is claimed with one atomic update, so two workers cannot send the same job.
  - After a timeout the job is `unknown`. It is retried only when the connector's `reconcile` says the post is not there, or the owner says so. If the connector cannot tell, the job waits for the owner.
- **Each channel fails alone** (AT-015). One job per channel, so one failure does not stop the others.
- **A draft must fit its channel.** Scheduling is refused when the caption is over the platform's limit, when the draft has no render in a shape the platform accepts, or when it has more media than the platform takes.
- **Errors follow §20.3:**

| Connector answer | Result |
|---|---|
| Not authorised (401) | The channel needs reconnecting; the job is `blocked` |
| Missing permission (403) | The job fails, with an offer to post it by hand |
| Rate limited (429) | Retried after the time the platform gives |
| Server error (5xx) | Retried with a growing delay, up to the attempt limit, then `failed` |
| Timeout after sending | `unknown`; reconcile before any retry |
| Not supported | Refused at scheduling, never at send time |

Job states:

| State | Meaning |
|---|---|
| `scheduled` | Waiting for its time. Can be cancelled or moved |
| `publishing` | A send is in flight |
| `awaiting_manual` | Its time has come on a manual channel; the owner must post it and confirm |
| `published` | Sent, with its link and ID |
| `unknown` | The outcome is not known; nothing is retried until it is |
| `blocked` | The gate or the channel said no at send time; the owner must act |
| `failed` | Sending failed, with the reason and whether a retry is allowed |
| `cancelled` | Stopped by the owner |

## 5. Not in this sprint

| Left out | Why |
|---|---|
| Real platform connectors | No app credentials, and platform review takes weeks (§24) |
| Inbox: comments, messages, reply drafts (§9.3) | It needs real connections to receive anything, and has its own privacy rules |
| Platform analytics | They come with real connectors and the Results module |
| Evergreen recycling (FR-SOC-006) | It needs performance data |
| Reddit, Pinterest | Not among the channels Plan offers |

## 6. Data

Tables, all brand-scoped with RLS: `channels`, `publish_jobs`, `publish_settings`.

## 7. Acceptance

- A job whose draft was edited after scheduling is `blocked` at send time and nothing is sent.
- A mock timeout leaves the job `unknown`; when `reconcile` finds the post it becomes `published` without a second send; when it finds nothing, one retry sends it (AT-014).
- One draft scheduled to two channels where one fails ends with one `published` and one `failed` (AT-015).
- Two workers claiming one job send it once.
- A manual job confirmed with a link becomes `published`.
- Brand B's jobs and channels cannot be read or changed through brand A's path.
