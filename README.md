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

Field Operations answers with a dispatch pipeline (site → job → contractor) followed by an
evidence pipeline (per-photo integrity checks, geolocation, and a bounded AI suspicion review whose
findings a controller resolves).

## 2. The mental model

### Domain shape

```text
site → job assignment → user (the assignee)
             ↓
       photo evidence ← variation request
       communication logs   (immutable inbound messages, one per assignment)
```

- **site** — a physical site with client context and an optional map location. Past jobs remain
  attached to it.
- **job_assignments** — one dispatched day job: the work order (site, day, title, nature,
  description, the dispatch system's reference) and the contractor who holds it, in one row. The two
  were separate collections until the job and its single assignment were folded together.
  `assignee_user_id` is `user.id` directly — a contractor is a **role**, not a record, a user whose
  team holds `field_ops_contractor` — and is null while the work order is filed but unassigned.
  Controllers file work orders in the dashboard or import them from a sheet; `external_ref` is the
  dispatch system's reference when a sheet carries one (unique, so a re-imported sheet files nothing
  twice) and `source_message_id` is the channel message the dispatch came from. Status runs `unassigned` →
  `assigned` → `completed`; whether the work was legitimately done is a suspicion question and is
  never stored on this row (`suspicion_checked_at` is the only suspicion-adjacent column, written by
  the review automation after a run).
- **variation_requests** — a scope change against one assignment. The new-record mutation is governed
  by the contractor policy's approval flow: writing one raises a platform approval request for a
  controller review step, not a row that is directly applied.
- **photo_evidence** — one explicitly selected photo attached to exactly one assignment or one
  variation, with deterministic integrity facts. Conversation history and unselected media are not
  retained; the message **content** of each assignment's conversation is retained in
  `communication_logs`.
- **communication_logs** — the contractor's inbound messages about one assignment, immutable, one
  row per provider message (idempotent on `source_message_id`), retained independently of agent
  transcripts. The suspicion review reads them.
- **suspicion_reviews** — one audit row per AI review of one assignment's evidence basis, including
  clear decisions; controller-only.
- **suspicious_activity_logs** — an AI or authorized-human suspicion judgement against one
  assignment: an immutable evidence basis, the reason, and an explicit controller resolution that
  is the only way a log closes.

### The evidence integrity pipeline

Every photo, from every entry path, passes through the same pipeline: the `photo_evidence`
collection files it (exactly one parent, immutable provenance) and the suspicion review's first
pass reads the bytes and writes the facts. The facts need the bytes, which a collection transform
cannot read, and the review is the first thing that must not proceed without them — so inspection
is the opening pass of the one hourly run rather than an automation of its own:

1. **Ingest** — JPEG/PNG only, exactly one parent (assignment or variation), SHA-256 fingerprint,
   Meta PDQ perceptual hash (256-bit), EXIF parse (`exifr`), and quality/metadata signals. The
   selected asset, parent, and source provenance become immutable: correcting a filing requires new
   evidence so every check runs again. A row is born uninspected (empty hash, zero vector); the
   review inspects it — including a photo filed after its assignment was already reviewed — and
   leaves an assignment unchecked until every photo on it carries a hash.
2. **Duplicate check** — the pass compares the photo against everything already stored: perceptual
   near-duplicates via `findNearest` on a 256-dim 0/1 vector indexed with HNSW (L2 metric,
   threshold √31 ≈ PDQ Hamming 31) are recorded as `visual_duplicate`; a byte-identical file
   (SHA-256) under another assignment is `exact_duplicate`. Both flags carry the matched evidence
   ids. A match inside the photo's own assignment is a neutral repeat, never evidence.
3. **Geolocation** — EXIF GPS is compared against the job site's map location (500 m tolerance).
   No GPS → `missing_geolocation`; capture beyond tolerance → `location_mismatch`.
4. **Flags are evidence, not a verdict.** `metadata_anomaly`, `edited_metadata` and `low_quality`
   are also noted when seen. Missing GPS is neutral on its own because WhatsApp commonly strips
   EXIF; reuse and a GPS mismatch are strong signals but never suspicion by themselves. Nothing on
   the photo row can latch `suspect` — the contextual judgement belongs to the review automation
   and lives in `suspicious_activity_logs`.

### The suspicion review

One automation owns both passes: `review_job_assignment_suspicion` (hourly, manual runs may
name one `assignment_id`). It inspects every photo still awaiting its facts, then pages through
every unchecked assignment, including completed work, and assembles the assignment, its job and site, the deterministic photo facts, and bounded
recent `communication_logs`. It passes a bounded visual sample (up to three photos, deterministic
selection weighted by signal, capped at 4 MiB) plus a text context to a provider model
(`openrouter/deepseek/deepseek-v4.1-flash`). A separate scripted record of every review — the canonical basis hash, the
verdict, the model and the reason — lands in `suspicion_reviews`, so clear decisions are auditable
too; a `suspicious` verdict appends an idempotent `suspicious_activity_logs` row (unique on
`origin:job_assignment_id:md5(basis)`). The assignment's `suspicion_checked_at` is stamped only
after inference and durable review persistence succeed, and any other change to the assignment —
a status move, a photo or message filed through it, a controller's edit — clears it again, so the
next run judges the new evidence. Failures remain unchecked for retry, and
the run output reports selected assignments, actual inference invocations, failure count, and up
to 100 assignment/stage failure details. A fact-loading failure necessarily happens before an
inference can be invoked and is reported separately instead of claiming an inference occurred.
Only a controller's stated resolution closes a log. The flags and views never leak to the
contractor policy or the WhatsApp envoy: only the controller dashboard renders integrity or
suspicion state.

**Cross-assignment scene-reuse nomination (the review's second task).** PDQ cannot separate a crop
of the same scene from an unrelated pair, so that task nominates candidates through the collection's
learned record embedding. `photo_evidence` names Gemini Embedding 2 (multimodal, 256-dimension
truncation) as its embedding model; the host resolves and normalizes the stored image and sends it
as the provider's image content part, so `record_embedding` is a real scene vector and the Kismis /
Lorong crop pair sits far closer than unrelated pairs. The host must have that model registered
(`COLONY_AI_EMBEDDING_MODELS`); the review basis reports `record_embedding_photos` so a review taken
without it is visible rather than silently clear. The deterministic PDQ net
(`visual_duplicate` / `exact_duplicate`) runs independently of the embedding.

**Network reach.** The review reaches no public page. Its inputs are tenant-held rows and the
photo objects in storage; `api.infer` is called with no `tools`, nothing in this template calls
`api.readUrl`, and the seed bank's field-operations rows carry no URL. An outbound DNS or connect
fault in the host's page reader cannot originate from this automation, whatever the hour: the
realm's page readers are hr-payroll's statutory drift research and the private serial-pcn
catalogue refresh, and every agent turn can read a page through the same host facility. When a
page-read fault is being attributed, find the reader by the task id or effect id on the crash log
first (learnings-matrix row 179).

## 3. What ships

### Apps

| App                    | Audience                                                   | What it provides                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `field_ops_controller` | Dispatch / operations staff (the BCA controller dashboard) | A dated dispatch schedule as a status kanban beside a site map, the suspect-scrutiny panel, a job-assignment CSV import, and a sites tab.                                                              |
| `field_ops_contractor` | Field contractor                                           | One table of its own assignments: job · site · date, dispatch time, progress, reported location, and summary. Opening a row shows the job scope, assignment activity, variations, and evidence photos. |

Flag visibility is reserved for the controller dashboard: photo integrity flags, the review
ledger and every suspicion-log field render only for controllers. Contractors see their own
assignment's progress and their evidence photos — never the integrity results.

### The WhatsApp envoy

`field_ops_whatsapp` is a conversational entry point for contractors who already have an active
workspace account. It answers on the WhatsApp channel of the same name
(`src/channels/+field_ops_whatsapp.ts`). An administrator verifies the contractor's WhatsApp number on that account; an
unknown number receives a registration prompt and no model run.

The envoy's whole job is to bring a contractor's **existing** assignments up to date from what
they send. One report is one `write_collection` update on the assignment it is about, carrying:

- the progress it reports — `status`, `completed_at`, `summary`;
- `job_assignment_photo_evidence.create` — one row per photo sent, its file and the channel
  `source` (conversation, message, attachment, sender, time) that delivered it;
- `job_assignment_communications.create` — the messages with text that are this assignment's slice
  of the conversation, keyed by the WhatsApp message id so each change traces to its message.

The assignment transform stamps the filed photos uninspected (as a direct upload is) and clears
`suspicion_checked_at`, so the review picks the assignment up on its next run.

The envoy runs under the strict capability lock:

- **The ceiling is `field_ops_whatsapp`, not the contractor policy.** It reads assignments, updates
  `status`, `completed_at` and `summary` on one the sender holds, and files new photo and message
  rows only under such an assignment. It cannot create, delete or reassign an assignment, change the
  work order, read back evidence or logs, or reach reviews, suspicion data or apps.
- **The linked account is the requestor, which only authorizes the target.** `${requestor.id}` must
  match `job_assignments.assignee_user_id` on the existing row. It confers nothing: a contractor who
  administers the web app reaches no more here than an ordinary one, and their `admin` flag is
  dropped at the boundary.
- **DMs are private; groups are shared.** Every assigned member sees profile group transcripts in
  Agent UI, while only the DM owner and administrators see a private transcript.

### Automations, policies, seed

| Kind       | Name                              | What it does                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automation | `review_job_assignment_suspicion` | Hourly (and on manual request, one assignment by id): inspects every photo still awaiting its integrity facts, then pages through all unchecked assignments, reviews each against a bounded visual + communication context, and writes one idempotent suspicion log only when the model judges the evidence suspicious. |
| Policy     | `field_ops_controller`            | Full command of the operational records and both apps; the audit ledgers (communications, reviews, suspicion logs) are append-only.                                                                                                                                                                                     |
| Policy     | `field_ops_contractor`            | Requestor-scoped grants: assigned sites and their dispatched jobs; own assignments (`read` + `mutate.existing`, `assignee_user_id = requestor`); own variations (`read` + both `mutate` branches behind the approval flow); own evidence (`read` + `mutate.new`).                                                       |
| Policy     | `field_ops_whatsapp`              | The WhatsApp envoy's directly declared ceiling: read assignments; update status, completion and summary on one the linked contractor holds; file new photo and message rows under it. No other writes, deletes, evidence or log reads, reviews, suspicion data or apps.                                                 |
| Policy     | `suspicion_review_automation`     | The review automation's authority: the photo corpus it inspects (facts written once, while the hash is empty), append-only review records and suspicion logs, and the single `suspicion_checked_at` stamp that closes the review.                                                                                       |
| Seed       | —                                 | Fixture data is host-owned and lives in the repository seed bank (there is no `src/+seed.ts` compiler role). Its photo-to-assignment map is reviewed photo by photo; the job-assignment import CSV template lives in `assets/` with its own README.                                                                     |

The controller reads assignments, people, sites, and open suspicion logs directly from the
sync-backed collections. Its board cards and map points are local projections of those rows, so they
stay live without a remote query handler or refresh control.

## 4. Under the hood

### Source layout

```text
src/
├── apps/                           +field_ops_controller.svelte, +field_ops_contractor.svelte
├── channels/                       +field_ops_whatsapp.ts, the WhatsApp channel
├── envoys/                         +field_ops_whatsapp.ts, the agent on that channel
├── access/policies/                the four policies and the variation approval flow
├── collections/                    models, relationships, write contracts (+collection.ts), pipelines, representations
│   ├── photo_evidence/             photo-integrity.ts + pdq.ts — PDQ, EXIF, geo, duplicates, immutable provenance
│   ├── suspicion_reviews/          the review ledger (controller-only)
│   └── suspicious_activity_logs/   the suspicion judgements and their controller resolution
├── datatypes/
│   └── photo_source/               where a photo came from: workspace upload or an envoy message
├── i18n/                           messages.en.json + messages.zh.json (identical key sets)
├── lib/                            typed workspace client shared by server roles
├── automations/                    the suspicion review — the one automation: it inspects filed photos and judges unchecked work
```

Apps are deliberately thin because the work happens inside a record: opening an assignment brings up
its job scope, activity, variations, and photo evidence together; opening a site separates upcoming
work from activity history. Each collection's `+collection.ts` declares what a caller may submit
and its transform carries the domain rules, so they apply to every client, function, and agent —
not only the UI:

- A dispatched job must reference an existing site; naming a contractor is what moves it from
  `unassigned` to `assigned`.
- `external_ref` is an imported job's dispatch-system reference and `source_message_id` the
  channel message's; both are unique idempotency keys.
- A reported location beyond the site tolerance is recorded as an evidence fact and never sets
  `suspect`; completion is stamped by the collection's own transform.
- Photo evidence: JPEG/PNG only, exactly one parent, fingerprints and integrity flags recorded by
  the inspection automation; its asset, parent, and provenance cannot be swapped after filing.
- Communication logs and suspicion reviews declare no `update` and no `delete`: immutable by
  construction. A suspicion log's judgement is not an update input; only its resolution is.

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
  GPS mismatch are strong inputs, not a verdict by themselves. The suspicion-review automation
  judges the whole case — scene, aggregate facts, and recent contractor communications — records its
  rationale, and is what recommends an assignment suspicious. The controller dashboard renders both
  the deterministic attributes and that rationale; contractors and the WhatsApp agent see neither.

### How the WhatsApp envoy works

The `field_ops_whatsapp` channel declares the transport; the host holds its credential and delivers
already-authenticated inbound messages. Bolt
binds the conversation to a transcript, claims the message exactly once, and matches its sender to a
verified WhatsApp identity. Runtime mints `envoy:field_ops_whatsapp` with the declaration's policies;
the linked contractor supplies only `userId` for requestor predicates, never team authority or admin.
The model sees each message's time, sender and id, and each attachment's stored file, which is
what it files on the assignment. The reply goes back over the same transport.

## 5. Verification

Product template-suite acceptance is the isolated public-seed suite: `tests/fixtures/seed/` loaded through
`@norbital-ai/test-utilities`. No Colony, no `seed_bank`, no `:5173`. See
[`RFC/testing.md`](../../RFC/testing.md) §4–§5.

```bash
node --experimental-strip-types --import ./scripts/ts-source-resolve.mjs --test \
  tests/public-seed-assignments.integration.test.ts \
  tests/public-seed-board.integration.test.ts \
  tests/public-seed-mutate-run.integration.test.ts
```

## 6. Changing the template

```bash
pnpm sync    # compile types/migrations and emit .norbital/artifact/bundle.mjs
pnpm lint    # prettier --check + svelte-check
```

- There is no separate build command; the portable deployment artifact is an output of `sync`.
- Never hand-edit `.norbital/` generated output. `sync` may update `.norbital/migrations/`; commit
  that history alongside the authored change. Model edits are the only thing that should produce a
  migration.
- Tests own `tests/fixtures/seed/` (invented public ids). Host demo still uses the private
  repository seed bank; there is no `src/+seed.ts` compiler role. The bank is not a test input.
- The seed bank treats transcript job reports and their textual photo references as authoritative.
  It never reparents a simulated wrong-site photo from an overlay, OCR, image content, upload burst,
  or filename timestamp; those contradictions are precisely what this template must detect.
- Publishing and tenant lifecycle: publish through the templates release workflow. A remote Colony
  host provisions new tenants from the exact commit advertised by
  `refs/heads/templates/field-operations`; advancing that ref does not rewrite existing tenants.
  From the realm root, `pnpm run env -- link` only tests local OSS packages inside the
  template and does not link template source into Colony. The template detail page on the website
  is generated from this README and `norbital.template.json` — no separate copy.
