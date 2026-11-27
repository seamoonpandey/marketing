# Studio (module 4): design

For the developer who builds the Studio module. Requirements come from `docs/AI_Marketing_Operating_System_specs.md` (§7, §8, WF-005). Code placement and shared interfaces are in `docs/structure.md`. The owner asked for Studio to be built in parallel, like the earlier modules, without reviewing a design first. Every scope decision below is the designer's call and is open to correction.

## 1. Intent

Plan decides what the brand will say and when. Studio makes it: each approved plan item becomes a draft with its copy and, where the format needs them, its images, carousel slides or a short video. Every draft is priced in rupees before the model runs, and every claim in it points at an approved fact.

```
Approved plan item (Plan)  +  approved facts, palette, logo, voice (Brand)
                    ▼
Estimate in rupees → the owner confirms → the model writes the copy (and slide or scene text)
                    ▼
Claims without an approved fact are left out and listed
                    ▼
Images, slides and video are rendered on the server from brand templates, at no model cost
                    ▼
Checks run on every read → the owner edits → the owner marks the draft ready
                    ▼
Ready drafts are what the Approve module (module 5) will put in front of the approver
```

## 2. In scope

A draft's kind follows its plan item's format:

| Kind | Plan formats | What the draft holds |
|---|---|---|
| `post` | text, poll, and every format not listed below | Copy only |
| `static` | image, infographic, story | Copy and one designed image |
| `carousel` | carousel | Copy and 2 to 10 designed slides |
| `video` | short_video, long_video, gif, live | Copy, a script with scenes, and a rendered video of the scene cards |

- **Copy.** A caption, hashtags and a call to action, in each of the brand's languages.
- **Designs.** Three brand templates (`headline`, `offer`, `quote`) drawn with the brand's palette roles and logo, in four sizes: 1:1 (1080×1080), 4:5 (1080×1350), 9:16 (1080×1920) and 16:9 (1920×1080).
- **Video.** The script's scenes become cards in the same templates, joined into an H.264 MP4 with FFmpeg. There is no voice and no music.
- **Studio dashboard.** The week's approved plan items with each one's draft state, "Draft all" with the total estimate, and the month's Studio cost.
- **Draft editor.** Copy by language, the facts each claim cites, the left-out list, the checks, the rendered previews, the slide and scene text, and "Mark ready".

## 3. Rules

- **No invented claims.** The model returns the caption as sentences, each marked as a claim or not. A claim is kept only when it cites an approved fact that was supplied. The rest are left out and listed, as the landing page shows: "I left out 'lowest price in Kathmandu': no approved fact backs it."
- **Numbers must come from facts.** Every number, price, percentage and date in the final copy and on every slide must appear in a fact that the draft cites. This check does not depend on the model labelling its own claims honestly.
- **Ready binds to a version.** Any edit after "ready" creates a new version and sets the draft back to `draft`. Approval of the exact version is module 5's job.
- **Checks run against today's facts and rights**, so a draft that cites a fact which has since expired, or uses an asset whose licence is missing, stops being ready-able.
- **Cost first.** The model call for copy shows its estimate first. Rendering is local and costs no model money; its estimate is NPR 0.
- **Rights.** A photo or logo is used only when its asset has a licence recorded (AT-011).
- **Nepali text renders correctly.** Text is drawn with a shaping engine (Pango, through the `sharp` library already installed), and Noto Sans with Noto Sans Devanagari is bundled. This replaces the Satori renderer named in `docs/stack.md`, which does not shape Devanagari.
- **Source material is data.** The model gets no tools.

Checks:

| Check | Blocks "ready" | Meaning |
|---|---|---|
| `unverified_number` | Yes | A number in the copy or on a slide is not in any cited fact |
| `prohibited_word` | Yes | The copy uses a word or claim the brand's voice or positioning facts prohibit |
| `too_long` | Yes | The caption is over its channel's limit |
| `missing_cta` | Yes | No call to action |
| `expired_fact` | Yes | A cited fact is not approved today |
| `no_rights` | Yes | A used asset has no licence |
| `text_overflow` | Yes | Text does not fit its template at some size |
| `not_rendered` | Yes | A `static`, `carousel` or `video` draft has no render of its current version |
| `low_contrast` | No | The text and background roles have a contrast under 4.5 |
| `many_hashtags` | No | More than 10 hashtags |

Caption limits by channel, in characters: x 280, whatsapp 1024, facebook 2000, instagram 2200, tiktok 2200, linkedin 3000, youtube 5000; email and website have none.

## 4. Not in this sprint

| Left out | Why |
|---|---|
| Voice, music, sound effects, subtitles from speech (§7.5, §7.6) | They need Piper, whisper.cpp and a rights registry for audio |
| AI-generated images and video, actors, UGC, product-URL import (§7.2, §7.3) | Paid providers and synthetic-media rights; the spec says template rendering comes first |
| A timeline editor, transitions, motion graphics | `docs/stack.md` says not to build an editor |
| Long-form formats (blog, email, landing page) as their own kinds | They get a `post` draft for now |
| A separate media worker process | Renders run in the API process for now |

## 5. Data

Tables, all brand-scoped with RLS: `studio_drafts`, `studio_versions`, `studio_runs`. Draft content, left-out lists and render lists are `jsonb`. Rendered files go to object storage under the brand's `asset` keys.

## 6. Acceptance

- A caption sentence marked as a claim with no approved fact is left out and listed.
- A caption saying "15% off" whose cited facts do not contain 15 fails `unverified_number`.
- A slide with the headline `हिमाल पश्मिना — १५% छुट` renders with its conjuncts joined, at all four sizes.
- A three-scene video renders to an H.264 MP4 of the right size and length.
- Editing a ready draft sets it back to `draft`.
- Brand B's drafts and renders cannot be read through brand A's path.
