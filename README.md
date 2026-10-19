# Field Operations

![Field Operations workspace thumbnail](assets/thumbnail.svg)

Field Operations is a construction field-operations workspace: schedule a site job, dispatch a
contractor, track on-site progress, raise scope-change requests, and collect photographic
evidence whose integrity is checked mechanically. It is deliberately focused — it does not attempt
project costing, payroll, or portfolio management, and the platform's native approval system owns the
variation approval lifecycle.

The problem: field-service work needs the right people at the right site on the right day, and the
evidence that the work happened needs to be trustworthy. A photo of a job site is not proof by
itself — the same photo can be reused, a photo can be taken somewhere else, and a photo says nothing
about which site it shows unless the site's identity is readable in it.

Field Operations answers with a dispatch pipeline (site → job → contractor) followed by an
evidence pipeline (per-photo integrity checks, geolocation, and a bounded AI suspicion review whose
findings a controller resolves).

## Apps and roles

| App                    | Audience                                                   | What it provides                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `field_ops_controller` | Dispatch / operations staff (the BCA controller dashboard) | A dated dispatch schedule as a status kanban beside a site map, the suspect-scrutiny panel, a job-assignment CSV import, and a sites tab.                                                                                                 |
| `field_ops_contractor` | Field contractor                                           | One table of its own assignments: job · site · scheduled date · status (plus the contractor for dispatchers). Opening a row shows the job scope, progress, dispatch time, location, assignment activity, variations, and evidence photos. |

Flag visibility is reserved for the controller dashboard: photo integrity flags, the review
ledger and every suspicion-log field render only for controllers. Contractors see their own
assignment's progress and their evidence photos — never the integrity results.

The controller reads assignments, people, sites and open suspicion logs directly from the
sync-backed collections. Its board cards and map points are local projections of those rows, so they
stay live without a remote query handler or refresh control.

Teams (`src/access_control/team/+team.ts`): **Field Operations Controllers** and **Contractor
(Controller)** hold `field_ops_controller`; **Contractor** holds `field_ops_contractor`. A contractor
is a role, not a record: a user whose team holds `field_ops_contractor`.

| Policy                        | What it grants                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `field_ops_controller`        | Full command of the operational records and both apps; the audit ledgers (communications, reviews, suspicion logs) are append-only.                                                                                                                                       |
| `field_ops_contractor`        | Requestor-scoped grants: assigned sites and their dispatched jobs; own assignments (`read` + scoped `update`, `assignee_user_id = actor.id`); own variations (`read` + opt-in source approval for `create`/`update` proposals); own evidence (`read` + `create`).         |
| `field_ops_whatsapp`          | The WhatsApp envoy's directly declared ceiling: read assignments; update status, completion and summary on any one; file new photo and message rows under it. No other writes, deletes, evidence or log reads, reviews, suspicion data or apps.                           |
| `suspicion_review_automation` | The review automation's authority: the photo corpus it inspects (facts for an uninspected photo, or a scene backfilled on a hashed photo without one), append-only review records and suspicion logs, and the single `suspicion_checked_at` stamp that closes the review. |

## Data model

```text
site → job assignment → user (the assignee)
             ↓
       photo evidence ← variation request
       communication logs   (immutable inbound messages, one per assignment)
```

- **site** — a physical site with client context and an optional map location. Past jobs remain
  attached to it.
- **job_assignments** — one dispatched day job: the work order (site, day, title, nature,
  description, the dispatch system's reference) and the contractor who holds it, in one row.
  `assignee_user_id` is `user.id` directly — a contractor is a **role**, not a record, a user whose
  team holds `field_ops_contractor` — and is null while the work order is filed but unassigned.
  Controllers file work orders in the dashboard or import them from a sheet; `external_ref` is the
  dispatch system's reference when a sheet carries one (unique, so a re-imported sheet files nothing
  twice) and `source_message_id` is the WhatsApp message the dispatch came from. Status runs `unassigned` →
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

## Automations and integrations

| Automation                        | Trigger                                                          | What it does                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `inspect_photo_evidence`          | photo filed                                                      | Fills each pending photo's SHA-256, PDQ and scene embeddings, integrity flags and near-duplicate matches                     |
| `review_job_assignment_suspicion` | assignment filed or its check cleared; manual by `assignment_id` | Inspects photos still pending, then reviews every unchecked assignment with AI; logs a suspicion only when judged suspicious |
| `site_handover`                   | manual, selected sites                                           | One JSON file per site (site, jobs, variations, photo evidence) plus a CSV per table, for another system                     |

### Photo integrity

The host's `ctx.files.image` decodes each photo (JPEG, PNG, HEIC), hashes it (SHA-256 and Meta PDQ)
and reads EXIF; `src/lib/photo-integrity.ts` decides what counts as a duplicate, an anomaly or a
mismatch. A row is born uninspected (empty hash, zero vector). A photo the host cannot read records
`inspection_failed_at` and `inspection_failure_reason` once, is never picked again, and takes no
visual slot. The selected asset, parent and source provenance are immutable: correcting a filing
requires new evidence so every check runs again.

- **Duplicates.** The 256-bit PDQ hash is stored as a 256-dim 0/1 `perceptual_embedding` (L2 metric,
  so L2 distance is √Hamming). The collection's `pdq` similarity finds near-duplicates within √31
  (PDQ Hamming 31) as `visual_duplicate`; a byte-identical file under another assignment is
  `exact_duplicate`. Both carry `matched_evidence_ids`. A match inside the photo's own assignment is
  a neutral repeat.
- **Geolocation.** EXIF GPS is compared with the job site's map location (500 m tolerance): no GPS is
  `missing_geolocation`, capture beyond tolerance `location_mismatch`.
- **Flags are evidence, not a verdict.** `metadata_anomaly`, `edited_metadata` and `low_quality` are
  also noted. Missing GPS is neutral on its own because WhatsApp commonly strips EXIF; reuse and a GPS
  mismatch are strong signals but never suspicion by themselves. Nothing on the photo row latches
  `suspect`: the judgement belongs to the review and lives in `suspicious_activity_logs`.
- **Scene reuse.** PDQ cannot separate a crop of the same scene from an unrelated pair, so inspection
  also embeds the photo (`ctx.ai.embed` with the `scene` model) into `scene_embedding`, and the
  `scene` similarity ranks by cosine. The host maps the `scene` embedding model; the review context
  reports `scene_embedding_photos` so a review taken without it is visible rather than silently clear.

### The suspicion review

`review_job_assignment_suspicion` pages through every unchecked assignment, including completed
work, and assembles the assignment, its job and site, the deterministic photo facts and bounded recent
`communication_logs`. It passes a bounded visual sample (up to three photos, deterministic selection
weighted by signal, capped at 4 MiB) plus a text context to the workspace's `default` model. Every
review — the canonical basis hash, verdict, model and reason — lands in `suspicion_reviews`, so clear
decisions are auditable too; a `suspicious` verdict appends an idempotent `suspicious_activity_logs`
row. The assignment's `suspicion_checked_at` is stamped only after inference and durable review
persistence succeed, and any other change to the assignment clears it, so the next run judges the
new evidence. A failed review stamps nothing and is retried at the next two-hour slot; the run output
reports assignments, inference invocations and failures. Only a controller's stated resolution closes
a log. The review calls no tools and reads no web page: its inputs are tenant rows and stored photos.

### The WhatsApp envoy

`field_ops_whatsapp` is a conversational entry point for contractors who already have an active
workspace account. Its source role is `src/agent/envoy/+field_ops_whatsapp.envoy.ts`, deployed
on the named WhatsApp instance in `src/+workspace.ts`. Pairing and pause belong to that runtime
instance. An administrator records the contractor's WhatsApp number on that account
(Settings → People); an unknown number is told it is not recognised and gets no model run.

The envoy's whole job is to bring a contractor's **existing** assignments up to date from what
they send. One report is one update on the assignment it is about, carrying:

- the progress it reports — `status`, `completed_at`, `summary`;
- `photo_evidence.create` — one row per photo sent, its file and the message
  `source` (conversation, message, attachment, sender, time) that delivered it;
- `communication_logs.create` — the messages with text that are this assignment's slice
  of the conversation, keyed by the WhatsApp message id so each change traces to its message.

The assignment transform stamps the filed photos uninspected (as a direct upload is) and clears
`suspicion_checked_at`, so the review picks the assignment up on its next run.

The envoy runs under the strict capability lock:

- **The ceiling is `field_ops_whatsapp`, not the contractor policy.** It reads assignments, updates
  `status`, `completed_at` and `summary` on any one, and files new photo and message rows under it;
  a group turn runs under this policy alone, so any member's group report may update any assignment. It cannot create, delete or reassign an assignment, change the
  work order, read back evidence or logs, or reach reviews, suspicion data or apps.
- **A DM joins the linked member's own authority** to the envoy's policy; a group turn holds
  the envoy's policy alone, whoever sent the message.
- **DMs are private; groups are shared.** Every assigned member sees profile group transcripts in
  Agent UI, while only the DM owner and administrators see a private transcript.

The `field_ops_whatsapp` connection in `src/+workspace.ts` names an instance of Bolt's built-in
`whatsapp` integration; an administrator pairs it under **Settings → Integrations**, and the host's
WhatsApp provider holds its paired session and delivers inbound messages, each stored once. The
envoy role `src/agent/envoy/+field_ops_whatsapp.envoy.ts` supplies the policies; the instance's
envoy field (`sys_integration.envoy`) deploys it there. Bolt matches each sender to a verified
WhatsApp number on a member's account. A private DM joins the linked member's current authority
(the default `dm: 'union'`); a group turn uses the envoy's policy alone. Source teams and native
member admission determine authority, not a sender-supplied identity or team label.
The model sees each message's time, sender and id, and each attachment's stored file, which is
what it files on the assignment. The reply goes back through the same instance.

## Source layout

```text
src/
├── +workspace.ts                   Asia/Singapore, SGD, the app order, the AI model classes, the field_ops_whatsapp connection
├── data/
│   ├── +relationship.ts            every foreign key
│   ├── model/+<c>.model.ts         the seven models
│   ├── collection/<c>/             +collection.ts (write contract, transform, queries/actions) and +representation.svelte
│   └── custom_field/photo_source/  where a photo came from: workspace upload or a WhatsApp message
├── access_control/                 policy/: the four +<name>.policy.ts (the variation approval is in the contractor's); team/+team.ts
├── agent/                          +agent.md
├── agent/envoy/                    +field_ops_whatsapp.envoy.ts
├── automation/                     inspect_photo_evidence, review_job_assignment_suspicion, site_handover
├── app/                            field_ops_controller (dispatch, sites) and field_ops_contractor (jobs)
├── i18n/                           +messages.ts, +zh.messages.ts
└── lib/                            site keys, photo rules, the review, the sheet import, csv/xlsx readers
seed/                               base pack JSON; seed.ts reads the bank tree `field-operations` for the sample pack
```

Apps are deliberately thin because the work happens inside a record: opening an assignment brings up
its job scope, activity, variations, and photo evidence together; opening a site separates upcoming
work from activity history. Each collection's `+collection.ts` declares what a caller may submit
and its transform carries the domain rules, so they apply to every client, function, and agent —
not only the UI:

- A dispatched job must reference an existing site; naming a contractor is what moves it from
  `unassigned` to `assigned`.
- `external_ref` is an imported job's dispatch-system reference and `source_message_id` the
  WhatsApp message's; both are unique idempotency keys.
- A reported location beyond the site tolerance is recorded as an evidence fact and never sets
  `suspect`; completion is stamped by the collection's own transform.
- Photo evidence: JPEG/PNG/HEIC, exactly one parent, fingerprints and integrity flags recorded by
  inspection; its asset, parent, and provenance cannot be swapped after filing.
- Communication logs and suspicion reviews declare no `update` and no `delete`: immutable by
  construction. A suspicion log's judgement is not an update input; only its resolution is.

## Seed

- **base** — `seed/*.json`: sites, job assignments and communication logs, verified by
  `tests/public-seed.test.ts`.
- **sample** (private) — `seed/seed.ts` reads the seed bank tree `field-operations` with
  `bolt build --bank=<checkout>`. The bank is read without rewriting it, so `seed.ts` converts its
  shapes (a `geolocation()` value to a point and address, a day instant to a date, derived `site_key`
  and photo `summary`). Photos come from the bank's `simulation.json` with their JPEGs as assets;
  `NORBITAL_SEED_PHOTOS` (`all` or a per-assignment count) samples them evenly across assignments.
  The bank treats transcript job reports and their textual photo references as authoritative; it never
  reparents a simulated wrong-site photo, since those contradictions are what this template detects.

The job-assignment import CSV template and its column reference live in `assets/`
([job-assignments-import.README.md](./assets/job-assignments-import.README.md)).

## Checks

```bash
pnpm install
pnpm check      # bolt check
pnpm test       # bolt build --bank=$SEED_BANK (default ../../seed_bank), then bolt test
pnpm test:e2e   # the same build, then bolt test with E2E=1 (mounted app sweep)
pnpm lint       # prettier --check .
```

Use the private bank checkout read-only. `.norbital/` is generated and never committed; there is
no incremental migration chain.
