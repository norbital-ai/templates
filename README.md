# Field Operations

![Field Operations workspace thumbnail](assets/thumbnail.svg)

Field Operations is a construction field-operations workspace: schedule a site job, dispatch a
contractor, track on-site progress, raise scope-change requests, and collect photographic
evidence whose integrity is checked mechanically. It is deliberately focused — it does not attempt
project costing, payroll, or portfolio management, and the platform's native approval system owns the
variation approval lifecycle.

## 1. What this workspace is

The problem: field-service work needs the right people at the right site on the right day, and the
evidence that the work happened needs to be trustworthy. A photo of a job site is not proof by
itself — the same photo can be reused, a photo can be taken somewhere else, and a photo says nothing
about which site it shows unless the site's identity is readable in it.

Field Operations answers with a dispatch pipeline (site → job → contractor assignment)
followed by an evidence pipeline (per-photo integrity checks, geolocation, site-identity inference,
and a one-way suspect escalation for controllers to scrutinise).

## 2. The mental model

### Domain shape

```text
site → jobs → job assignment → user (the assignee)
             ↓
       photo evidence ← variation request
```

- **site** — a physical site with client context and an optional map location. Past jobs remain
  attached to it.
- **jobs** — work scheduled for one site and one calendar day, beginning `unassigned` and following
  the assignment's progress (`assigned` → `in_progress` → `completed`).
- **job_assignments** — one person per job. `assignee_user_id` is `user.id`
  directly: a contractor is a **role**, not a record — a user whose team holds `field_ops_contractor`
  — so there is no collection describing one. Identity (job + assignee) is immutable after dispatch;
  status runs `dispatched` → `in_progress` → `completed`, with `suspect` as a one-way integrity
  overlay (see below). Completion timestamps the assignment and advances the job.
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
   Meta PDQ perceptual hash (256-bit), EXIF parse (`exifr`), and quality/metadata signals. The
   selected asset, parent, and source provenance become immutable: correcting a filing requires new
   evidence so every check runs again.
2. **Duplicate check** — the create `after` hook compares the new photo against everything already
   stored: exact SHA-256 matches, and perceptual near-duplicates via `findNearest` on a 256-dim 0/1
   vector indexed with HNSW (L2 metric, threshold √31 ≈ PDQ Hamming 31). Matches are recorded as
   `exact_duplicate` / `visual_duplicate` flags with the matched evidence ids.
3. **Geolocation** — EXIF GPS is compared against the job site's map location (500 m tolerance).
   No GPS → `missing_geolocation`; capture beyond tolerance → `location_mismatch`.
4. **Site identity (shared automation)** — a vision model uses multimodal judgement over the whole
   naturally photographed scene and compares it with the transcript-assigned site. A matching
   overlay is never proof because it can be fabricated; a contradictory visible location claim is
   suspicious evidence and must be explained. A visibly wrong location latches
   `site_identity_mismatch` and stores the model's rationale. The create trigger reviews new evidence
   promptly, while a daily 02:00 reconciliation retries failures and catches seed/import paths that
   bypass collection events. Both call the same reviewer.
5. **Classification** — deterministic inspection records evidence attributes; it does not pretend
   those attributes are the verdict. Missing GPS is neutral on its own because WhatsApp commonly
   strips EXIF. Reuse and a GPS mismatch are strong signals, but the multimodal model classifies the
   whole scene against the assigned site and writes the human-readable rationale. A scene mismatch
   latches `suspect` and cannot be cleared by a later match. The controller dashboard shows the
   attributes and AI rationale; contractors and the WhatsApp agent never see them.
6. **Reconciliation state** — each photo stores `site_identity_status`, its last checked time, a
   stable `site_identity_review_basis`, and `site_identity_reconciled_at`. The basis includes the
   photo identity, deterministic flags/matches, and current assignment/job/site. Unchanged terminal
   evidence is marked reconciled without another vision call; changed inputs, pending rows, and
   failures are reviewed again. Hook updates to flags or matched evidence reset the row to `pending`.

## 3. What ships

### Apps

| App                    | Audience                                                   | What it provides                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `field_ops_controller` | Dispatch / operations staff (the BCA controller dashboard) | A dated dispatch schedule as a status kanban beside a site map, the suspect-scrutiny panel, weekly roster CSV import, and a sites tab.                                                                 |
| `field_ops_contractor` | Field contractor                                           | One table of its own assignments: job · site · date, dispatch time, progress, reported location, and summary. Opening a row shows the job scope, assignment activity, variations, and evidence photos. |

Flag visibility is reserved for the controller dashboard: photo integrity flags, the `suspect`
status, and the `site_identity_*` markers render only for controllers. Contractors see their own
assignment's progress and their evidence photos — never the integrity results.

### The WhatsApp envoy

`field_ops_whatsapp` is a conversational entry point for contractors who already have an active
workspace account. An administrator verifies the contractor's WhatsApp number on that account; an
unknown number receives a registration prompt and no model run.

The envoy runs under the strict capability lock:

- **The ceiling is `field_ops_whatsapp`, not the contractor policy.** The envoy names that policy
  directly, and it is the complete answer to what any turn may reach — for a linked contractor
  exactly as for anyone. It is narrower than
  `field_ops_contractor`: no variation requests, no photo evidence, no apps.
- **The linked account is the requestor, which only narrows.** `${requestor.id}` conditions
  resolve to that person, so they see their own assignments rather than none — matched on
  `job_assignments.assignee_user_id`. It confers nothing: a contractor who administers the web app
  reaches no more here than an ordinary one, and their `admin` flag is dropped at the boundary.
- **DMs are private; groups are shared.** Every assigned member sees profile group transcripts in
  Agent UI, while only the DM owner and administrators see a private transcript.
- The task never exposes controller-only integrity fields and directs photo uploads to the app.

Policy grants remain row-level rather than column-level, so the task still explicitly forbids
controller-only integrity fields even though the contractor can update their own assignment row.

### Automations, policies, functions, seed

| Kind       | Name                                 | What it does                                                                                                                                                                                                                          |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automation | `photo_site_identity`                | Created-event wrapper around the shared reviewer for prompt semantic review of newly filed evidence.                                                                                                                                  |
| Automation | `photo_site_identity_reconciliation` | Daily 02:00 reconciliation of pending/failed evidence first, then least-recently reconciled terminal evidence; unchanged bases skip the vision call.                                                                                  |
| Policy     | `field_ops_controller`               | Full command of every collection, both apps. The reconciliation key is the filename.                                                                                                                                                  |
| Policy     | `field_ops_contractor`               | Requestor-scoped grants: assigned sites/jobs, own assignments (read + update, `assignee_user_id = requestor`), own variations (read + create/update behind the variation approval flow), own evidence (read + create).                |
| Policy     | `field_ops_whatsapp`                 | The WhatsApp envoy's directly declared ceiling: read and update the caller's own assignments, and read the jobs and sites behind them. No creates, deletes, evidence or apps.                                                         |
| Function   | `field_ops_dashboard`                | Date-specific controller query: assignment cards, board ids, map points (with suspect tones), and the month's suspect assignments.                                                                                                    |
| Seed       | —                                    | Fixture data is host-owned and lives in the repository seed bank (`src/+seed.ts` is deliberately absent). Its job/photo map is audited against the WhatsApp transcript; the weekly roster CSV lives in `assets/` with its own README. |

## 4. Under the hood

### Source layout

```text
src/
├── apps/                           +field_ops_controller.svelte, +field_ops_contractor.svelte
├── envoys/                         +field_ops_whatsapp.ts
├── access/policies/                the three policies and the variation approval flow
├── collections/                    models, relationships, hooks, pipelines, representations
│   └── photo_evidence/             photo-integrity.ts + pdq.ts — PDQ, EXIF, geo, duplicates, immutable provenance
├── datatypes/
│   ├── money/                      money value with renderer (ISO 4217 currency)
│   └── photo_source/               where a photo came from: workspace upload or a channel message
├── i18n/                           messages.en.json + messages.zh.json (identical key sets)
├── lib/                            typed workspace client shared by server roles
├── automations/                    immediate + daily wrappers over one batched site-identity reviewer
├── functions/                      +field_ops_dashboard.ts
```

Apps are deliberately thin because the work happens inside a record: opening an assignment brings up
its job scope, activity, variations, and photo evidence together; opening a site separates upcoming
jobs from activity history. Hooks carry the domain rules so they apply to every client, function,
and agent — not only the UI:

- A job must reference an existing site; an assignment must reference an existing job and a real
  workspace user, and be unique per job.
- `source_message_id` is an idempotency key for inbound assignments and variations.
- Assignment identity cannot be moved after dispatch; a reported location beyond the site tolerance
  forces `suspect` (one-way); completion advances the job state.
- Photo evidence: JPEG/PNG only, exactly one parent, fingerprints and integrity flags recorded;
  its asset, parent, and channel provenance cannot be swapped after those checks settle.

### How photo integrity works

- **PDQ**: Meta's perceptual hash, computed in-process via `pdq-wasm` (bundled with its WASM sidecar
  by the Vite config). The 256-bit hash is stored as a 256-dim 0/1 `vector` (`hexToBinaryEmbedding`);
  L2 distance equals √Hamming, so the near-duplicate threshold √31 is PDQ's Hamming 31.
- **Similarity search**: `findNearest` on the HNSW `photo_evidence_pdq_hnsw` index (`vector_l2_ops`)
  with bounded limits — the fast, indexed path, not a scan.
- **EXIF**: `exifr` reads capture time, software, and GPS. `missing_geolocation` records that the
  signal is absent, but does not classify the photo: WhatsApp commonly strips EXIF.
  `metadata_anomaly`/`edited_metadata`/`low_quality` are also evidence attributes.
- **Flags** live on the photo row (`flags` array, `matched_evidence_ids`). Cross-assignment reuse and
  GPS mismatch are strong inputs, not a verdict by themselves. The multimodal site-identity layer
  judges the whole natural scene, records its rationale, and is the layer that can latch an assignment
  suspicious. The controller dashboard renders both the deterministic attributes and that rationale.

### How the WhatsApp envoy works

The host holds the transport credential and delivers an already-authenticated inbound command. Bolt
binds the conversation to a transcript, claims the message exactly once, and matches its sender to a
verified WhatsApp identity. Runtime mints `envoy:field_ops_whatsapp` with the declaration's policies;
the linked contractor supplies only `userId` for requestor predicates, never team authority or admin.
The reply goes back over the same transport.

## 5. Changing the template

```bash
pnpm sync    # compile types/migrations and emit .norbital/artifact/bundle.mjs
pnpm lint    # prettier --check + svelte-check
```

- There is no separate build command; the portable deployment artifact is an output of `sync`.
- Never hand-edit `.norbital/` generated output. `sync` may update `.norbital/migrations/`; commit
  that history alongside the authored change. Model edits are the only thing that should produce a
  migration.
- Seed data stays host-owned in the repository seed bank; tenant fixtures belong in `src/+seed.ts` (deliberately absent here).
- The seed bank treats transcript job reports and their textual photo references as authoritative.
  It never reparents a simulated wrong-site photo from an overlay, OCR, image content, upload burst,
  or filename timestamp; those contradictions are precisely what this template must detect.
- Publishing and tenant lifecycle: publish through the templates release workflow. A remote Colony
  host provisions new tenants from the exact commit advertised by
  `refs/heads/templates/field-operations`; advancing that ref does not rewrite existing tenants.
  `pnpm yalc:link` only tests local OSS packages inside the template and does not link template
  source into Colony. The template detail page on the website is generated from this README and
  `norbital.template.json` — no separate copy.
