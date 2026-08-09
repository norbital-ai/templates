# Field Operations

![Field Operations workspace banner](assets/banner.svg)

Field Operations is a construction field-operations workspace: schedule a site job, dispatch a
certified contractor, track on-site progress, raise scope-change requests, and collect photographic
evidence whose integrity is checked mechanically. It is deliberately focused — it does not attempt
project costing, payroll, or portfolio management, and the platform's native approval system owns the
variation approval lifecycle.

## 1. What this workspace is

The problem: field-service work needs _qualified_ people at the right site on the right day, and the
evidence that the work happened needs to be trustworthy. A photo of a job site is not proof by
itself — the same photo can be reused, a photo can be taken somewhere else, and a photo says nothing
about which site it shows unless the site's identity is readable in it.

Field Operations answers with a dispatch pipeline (site → job → certified contractor assignment)
followed by an evidence pipeline (per-photo integrity checks, geolocation, site-identity inference,
and a one-way suspect escalation for controllers to scrutinise).

## 2. The mental model

### Domain shape

```text
site → jobs → job assignment ← contractor profile
             ↓                  ↑
   required certifications   certifications held
             ↓
       photo evidence ← variation request
```

- **site** — a physical site with client context and an optional map location. Past jobs remain
  attached to it.
- **jobs** — work scheduled for one site and one calendar day, beginning `unassigned` and following
  the assignment's progress (`assigned` → `in_progress` → `completed`).
- **contractor_profiles** — a contractor organisation, linked one-to-one with a tenant user who can
  open the contractor workspace. Its certification holdings (join table) decide dispatch eligibility.
- **job_assignments** — one contractor per job. Identity (job + contractor) is immutable after
  dispatch; status runs `dispatched` → `in_progress` → `completed`, with `suspect` as a one-way
  integrity overlay (see below). Completion timestamps the assignment and advances the job.
- **variation_requests** — a scope change against one assignment. Creation is governed by the
  contractor policy's approval flow: writing one raises a platform approval request for a controller
  review step, not a row that is directly applied.
- **photo_evidence** — one explicitly selected photo attached to exactly one assignment or one
  variation, with deterministic integrity results. Conversation history and unselected media are not
  retained.

### The evidence integrity pipeline

Every photo, from every entry path (workspace upload or channel), passes through the same
`photo_evidence` create hooks:

1. **Ingest** — JPEG/PNG only, exactly one parent (assignment or variation), SHA-256 fingerprint,
   Meta PDQ perceptual hash (256-bit), EXIF parse (`exifr`), and quality/metadata signals.
2. **Duplicate check** — the create `after` hook compares the new photo against everything already
   stored: exact SHA-256 matches, and perceptual near-duplicates via `findNearest` on a 256-dim 0/1
   vector indexed with HNSW (L2 metric, threshold √31 ≈ PDQ Hamming 31). Matches are recorded as
   `exact_duplicate` / `visual_duplicate` flags with the matched evidence ids.
3. **Geolocation** — EXIF GPS is compared against the job site's map location (500 m tolerance).
   No GPS → `missing_geolocation`; capture beyond tolerance → `location_mismatch`.
4. **Site identity (automation)** — a vision model reads site name / location / unit visibly printed
   in the photo. The first photo that verifies sets `site_identity_unverified = false` on the
   assignment; an inconclusive photo deliberately does **not** write, so a later weak photo can never
   undo an earlier verified result ("at least one photo" semantics).
5. **Escalation** — any integrity flag (`exact_duplicate`, `visual_duplicate`,
   `missing_geolocation`, `location_mismatch`) latches the parent assignment to `suspect`, one-way.
   The controller dashboard surfaces suspects; contractors and the WhatsApp agent never see them.

## 3. What ships

### Apps

| App                    | Audience                                                   | What it provides                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `field_ops_controller` | Dispatch / operations staff (the BCA controller dashboard) | A dated dispatch schedule as a status kanban beside a site map, the suspect-scrutiny panel, weekly roster CSV import, and tabs for sites, contractors, and the certification catalogue.                |
| `field_ops_contractor` | Field contractor                                           | One table of its own assignments: job · site · date, dispatch time, progress, reported location, and summary. Opening a row shows the job scope, assignment activity, variations, and evidence photos. |

Flag visibility is reserved for the controller dashboard: photo integrity flags, the `suspect`
status, and the `site_identity_*` markers render only for controllers. Contractors see their own
assignment's progress and their evidence photos — never the integrity results.

### The WhatsApp channel

`field_ops_whatsapp` is a conversational entry point for contractors who have **no account**. The
platform's channel model supports communicators without user rows: the host authenticates the wire
(WhatsApp) and hands Pod an inbound message; the agent answers as the channel's own synthetic
principal, a `kind='agent'` user in a team carrying the channel's declared policy.

The channel runs under the strict capability lock:

- **The agent may only `update` existing `job_assignments`** — progress status, completion time,
  summary, reported location, amount charged. It cannot create or delete anything.
- **It has no read grants and no host tools.** `read_collection` is refused for every collection,
  so it cannot see assignments, photos, flags, `suspect` status, or `site_identity_*` markers —
  the integrity overlay is opaque to it by construction, not by instruction.
- Its `task` is written for contractor-only interactions and stays honest about the boundary: it
  never claims to have seen or looked up anything, never mentions integrity or flags, and directs
  callers to the app for evidence filing, variations, and anything requiring a lookup.

Two platform limits are worth stating: policy grants are row-level, not column-level (an update
grant covers every column of `job_assignments`, so the agent could in principle touch the integrity
columns — the task forbids it, and the update response returns the full row it just wrote); and the
platform does not yet provide conversation-to-record resolution, so the agent cannot map "my job" to
an assignment without a read grant. The lock is deliberate: those gaps close only with platform
features, not with a looser workspace.

### Automations, policies, remotes, seed

| Kind       | Name                   | What it does                                                                                                                                                                                                            |
| ---------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automation | `photo_site_identity`  | Post-commit vision inference on each new photo; verifies the assignment's site identity once, never re-flags on inconclusive photos.                                                                                    |
| Policy     | `field_ops_controller` | Full command of every collection, both apps. The reconciliation key is the filename.                                                                                                                                    |
| Policy     | `field_ops_contractor` | Requestor-scoped grants: own profile, own certifications, assigned sites/jobs, own assignments (read + update), own variations (read + create/update behind the variation approval flow), own evidence (read + create). |
| Policy     | `field_ops_whatsapp`   | The channel lock above: exactly one grant — `update` on `job_assignments`.                                                                                                                                              |
| Remote     | `field_ops_dashboard`  | Date-specific controller query: assignment cards, board ids, map points (with suspect tones), and the month's suspect assignments.                                                                                      |
| Seed       | —                      | Fixture data is Core-owned (`src/+seed.ts` is deliberately absent); the weekly roster CSV lives in `assets/` with its own README.                                                                                       |

## 4. Under the hood

### Source layout

```text
src/
├── apps/                           +field_ops_controller.svelte, +field_ops_contractor.svelte
├── channels/                       +field_ops_whatsapp.channel.ts
├── policies/                       the three policies and the variation approval flow
├── collections/                    models, relationships, hooks, pipelines, representations
│   └── photo_evidence/lib/         photo-integrity.ts — PDQ + EXIF inspection, geo flags, parenting
├── custom-types/
│   ├── money/                      money value with renderer (ISO 4217 currency)
│   └── photo_source/               where a photo came from: workspace upload or a channel message
├── i18n/                           messages.en.json + messages.zh.json (identical key sets)
├── lib/
│   ├── calendar.ts                 calendar-day derivation in a named timezone (Asia/Singapore)
│   ├── certification-eligibility.ts  dispatch qualification checks
│   └── haversine.ts                site-tolerance distance math
├── remotes/                        +field_ops_dashboard.ts
```

Apps are deliberately thin because the work happens inside a record: opening an assignment brings up
its job scope, activity, variations, and photo evidence together; opening a site separates upcoming
jobs from activity history. Hooks carry the domain rules so they apply to every client, remote, and
agent — not only the UI:

- A job must reference an existing site; an assignment must reference an existing job and contractor,
  be unique per job, and satisfy every declared certification requirement.
- `source_message_id` is an idempotency key for inbound assignments and variations.
- Assignment identity cannot be moved after dispatch; a reported location beyond the site tolerance
  forces `suspect` (one-way); completion advances the job state.
- Photo evidence: JPEG/PNG only, exactly one parent, fingerprints and integrity flags recorded.

### How photo integrity works

- **PDQ**: Meta's perceptual hash, computed in-process via `pdq-wasm` (bundled with its WASM sidecar
  by the Vite config). The 256-bit hash is stored as a 256-dim 0/1 `vector` (`hexToBinaryEmbedding`);
  L2 distance equals √Hamming, so the near-duplicate threshold √31 is PDQ's Hamming 31.
- **Similarity search**: `findNearest` on the HNSW `photo_evidence_pdq_hnsw` index (`vector_l2_ops`)
  with bounded limits — the fast, indexed path, not a scan.
- **EXIF**: `exifr` reads capture time, software, and GPS. `missing_geolocation` fires for any photo
  without GPS; `metadata_anomaly`/`edited_metadata`/`low_quality` are recorded but do not escalate.
- **Flags** live on the photo row (`flags` array, `matched_evidence_ids`) and drive the one-way
  `suspect` escalation; the controller dashboard is where they render.

### How the WhatsApp channel works

The host (Core) holds the transport credential and delivers an already-authenticated inbound command
(`channel` / `inbound` with transport conversation id, provider message id, text, sender). Pod binds
the conversation to a transcript, claims the message exactly once, re-enters the workspace under the
channel principal (`channel.field_ops_whatsapp@channels.invalid`), and runs one agent turn with the
channel's `task` as the standing instruction. The reply goes back over the same transport. The
channel principal's team carries `field_ops_whatsapp`, so every read and write meets the same
policy, hooks, and approval gates any other requestor would meet.

## 5. Changing the template

```bash
pnpm sync    # compile the workspace: .norbital/generated, types, migrations
pnpm lint    # prettier --check + svelte-check
pnpm build   # vite build
```

- Never hand-edit `.norbital/` generated output. `sync` may update `.norbital/migrations/`; commit
  that history alongside the authored change. Model edits are the only thing that should produce a
  migration — this template has none pending.
- Seed data stays Core-owned; tenant fixtures belong in `src/+seed.ts` (deliberately absent here).
- Publishing and tenant lifecycle: publish the template through the OSS release workflow, then have
  Core redeploy a tenant checkpoint (`pnpm tenant:update --org=<org> --template=<key>`) before a
  revision reaches a tenant; use `env:reset` only for a deliberate reseed. The template detail page
  on the website is generated from this README and `norbital.template.json` — no separate copy.
