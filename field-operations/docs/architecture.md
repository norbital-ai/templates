# Field Operations — System Architecture & Inner Mechanisms

Technical architecture reference for the `field-operations` (`norbital_field_operations`) Bolt
workspace. Every model, constraint, write callback, automation, formula, threshold, and policy
rule below is derived directly from `src/` and `migrations/physical.json`.

Workspace defaults (`src/+workspace.ts`):

- **Time zone / locale / languages / currency:** `Asia/Singapore`, `en-SG`, `['en', 'zh']`, `SGD`
- **Declared AI embedding models:** `['scene', 'default']`
- **Applications:** `field_ops_controller` (Dispatch), `field_ops_contractor` (Contractor Workspace)
- **Models:** 6 domain models in a single `sites`-rooted ownership hierarchy + 1 custom field (`photo_source`)
- **Automations:** 5 system-identity automations (0 cron declarations; event-effect, manual, and retry-scheduled)
- **Integrations:** none declared in source; WhatsApp uses Bolt's built-in `whatsapp` channel paired to a runtime `sys_envoy` row holding `field_ops_whatsapp`

---

## 1. System Topology & Runtime Architecture

```text
+---------------------------------------------------------------------------------------------+
|                               CLIENT SURFACES & CHANNELS                                    |
+---------------------------------------+-----------------------------+-----------------------+
| Dispatch App (field_ops_controller)   | Contractor App              | Conversational Layer  |
| - +dispatch.page.svelte               | (field_ops_contractor)      | - Norbius (+agent.md) |
|   * Date-scoped Board (pending|done)  | - +jobs.page.svelte         |   uses signed-in      |
|   * Live Site Map + Route Planner     |   * Role-scoped Table       |   member authority    |
|   * Import Sheet & Suspicion Review   |   * Keyword + /semantic     | - WhatsApp Channel    |
| - +sites.page.svelte                  |     search (1536-dim)       |   sys_integration ->  |
|   * Sites Table + Site Handover act   |                             |   sys_envoy holding   |
|                                       |                             |   field_ops_whatsapp  |
+---------------------------------------+-----------------------------+-----------------------+
| Record Hubs (+representation.svelte) & Shared UI (src/lib/*.svelte)                         |
| - sites: Form + Upcoming Jobs tab + Activity History Timeline                               |
| - job_assignments: Scope/Progress/Completion/Location + Conversation + SuspicionPanel       |
| - photo_evidence: Upload form + photo_source custom renderer (+renderer.svelte)             |
| - communication_logs (read-only) | suspicion_reviews (EvidenceBasis)                        |
| - suspicious_activity_logs: EvidenceBasis + Resolve Sheet (suspicious_activity_logs_resolve)|
+----------------------------------------------+----------------------------------------------+
                                               | PageBolt queries, ctx.act, ctx.run
                                               v
+---------------------------------------------------------------------------------------------+
|                            BOLT ENGINE & POLICY GATE (@norbital-ai/bolt)                    |
|                                                                                             |
|  1. Rate Limiter (+workspace.ts limits: act / read / agent / envoys.receive)                |
|  2. Policy Gate: selects output (default | contractor), injects row WHERE predicates,       |
|     checks write field whitelist, runs custom policy verdicts                               |
|  3. Model Write Pipeline: transform() -> SQL commit + triggers -> post-commit effect()      |
|  4. Automation Runner (reserved system identity + declared policies + concurrency caps)     |
+------------------+-------------------------------------------+------------------------------+
                   |                                           |
                   v                                           v
+--------------------------------------------+  +---------------------------------------------+
|  POSTGRESQL + PGVECTOR + GIST + GIN        |  |  HOST FACILITIES (Host API Ports)           |
|  - 6 domain tables + system tables         |  |  - ctx.files.image  (decode, SHA-256, PDQ,  |
|  - HNSW vector(256) l2     (PDQ)           |  |                      EXIF, JPEG resize)     |
|  - HNSW vector(256) cosine (scene)         |  |  - ctx.files.meta   (byte size)             |
|  - HNSW vector(1536) cosine (job semantic) |  |  - ctx.files.put    (handover artifacts)    |
|  - GiST point              (sites, jobs)   |  |  - ctx.convert.ingest (CSV / XLS / XLSX)    |
|  - GIN tsvector + text[]   (search, flags) |  |  - ctx.ai.embed     (scene=256, default)    |
|  - Immutable bolt_history + optimistic     |  |  - ctx.ai.sys_2.infer (multimodal 'default')|
|    revision checks                         |  |  - ctx.schedule / ctx.notify                |
+--------------------------------------------+  +---------------------------------------------+
```

### UI Capability Detection

Client pages adapt to the caller's compiled catalog without duplicating routes:

- `+jobs.page.svelte` and `job_assignments/+representation.svelte` check `ctx.catalog?.['suspicion_reviews'] !== undefined` to distinguish dispatchers/controllers from contractors (controlling the **New** job button, **Contractor** column, open-finding header badge, and **Suspicion logs** tab).
- `src/lib/conversation.svelte` inspects `ctx.catalog?.['communication_logs']?.output === 'contractor'` and `ctx.catalog?.['photo_evidence']?.fields['source'] !== undefined` so contractors query the `contractor` output while controllers query `default` with full provenance and flags.
- `conversation.svelte` merges `communication_logs` and `photo_evidence` chronologically, groups photo-only bursts from the same non-system sender within **2 minutes** on the same Singapore calendar day into one bubble, and uses `create_stick_to_bottom({ threshold: 24 })`.

---

## 2. Data Model, Ownership Hierarchy & Relational ER Diagram

Source folders under `src/data/model/` mirror logical ownership (`sites/job_assignments/...`). Physically, every parent-child foreign key enforces `ON DELETE RESTRICT` so historical evidence and reviews cannot be silently orphaned, while optional citations (`evidence_id`, `resolved_by`) use `ON DELETE SET NULL`.

```text
                       +--------------------------------------+
                       |               sys_user               |
                       |  (host member directory; email,      |
                       |   phone, phone_key, team, active)    |
                       +--------+--------------------+--------+
                                ^                    ^
                 ON DELETE      |                    | ON DELETE
                 RESTRICT       | assignee_user_id   | SET NULL (resolved_by)
                                | (optional)         |
+-------------------------------+------+             |
|                sites                 |             |
|--------------------------------------|             |
| PK  id : uuid                        |             |
| UQ  site_key : text (hidden)         |             |
| UQ  site_code : text?                |             |
|     name : text (derived)            |             |
| GiST location : point? (req on write)|             |
|     address, unit_number : text?     |             |
|     client_name : text?              |             |
|     house_type : enum?               |             |
|     floor_area_sqm : decimal(2)?     |             |
| GIN bolt_search (name,addr,unit,     |             |
|     site_code,client_name)           |             |
+------------------+-------------------+             |
                   | 1                               |
                   | ON DELETE RESTRICT              |
                   v N                               |
+--------------------------------------+             |
|           job_assignments            |             |
|--------------------------------------|             |
| PK  id : uuid                        |             |
| FK  site_id -> sites (RESTRICT)      |             |
| FK  assignee_user_id -> sys_user?    |             |
| UQ  external_ref : text?             |             |
| UQ  source_message_id : text?(hidden)|             |
|     assignee_contact : text?         |             |
|     title, description : text        |             |
|     nature, summary : text?          |             |
| IDX scheduled_for : date             |             |
|     status : enum(pending|completed) |             |
|     dispatched_at, completed_at : ts?|             |
|     amount_charged : money?          |             |
| GiST location : point? + addr : text?|             |
| IDX suspicion_checked_at : ts?(hid)  |             |
| HNSW bolt_embedding : vec(1536,cos)  |             |
+---+---------------+--------------+---+             |
    | 1             | 1            | 1               |
    | RESTRICT      | RESTRICT     | RESTRICT        |
    v N             v N            v N               |
+-------------------+  +-----------+----------+  +---+------------------------+
| communication_logs|  |    photo_evidence    |  |     suspicion_reviews      |
| (create-only)     |  | (provenance locked)  |  | (create-only audit ledger) |
|-------------------|  |----------------------|  |----------------------------|
| PK id : uuid      |  | PK id : uuid         |  | PK id : uuid               |
| FK job_assignment |  | FK job_assignment?   |  | FK job_assignment(RESTRICT)|
| UQ source_msg_id  |  |    (req on create)   |  | FK evidence_id -> photo    |
|    message : text |  | UQ source_key (hid)  |  |    (SET NULL, optional)    |
| IDX sent_at : ts  |  |    photo : file<=20M |  | UQ source_key (hid)        |
|    sender : text  |  |    source : custom   |  | UQ (job_assignment_id,     |
|    (hidden)       |  |      photo_source    |  |     basis_hash) NND        |
+-------------------+  |    sha256 : text(hid)|  |    basis : json(REVIEW)    |
                       |    inspection_* (hid)|  |    suspicious : bool       |
                       | HNSW perceptual_emb  |  |    reason, model : text    |
                       |    vec(256, l2)      |  | IDX reviewed_at : ts       |
                       | HNSW scene_embedding |  +-------------+--------------+
                       |    vec(256, cos)?    |                | 1 (optional)
                       | GIN flags : enum[]   |                | ON DELETE RESTRICT
                       | GIN matched_ev_ids[] |                v N
                       +----------+-----------+  +-------------+--------------+
                                  ^              |  suspicious_activity_logs  |
                                  | SET NULL     |  (create + one-shot close) |
                                  +--------------+----------------------------|
                                    evidence_id  | PK id : uuid               |
                                                 | FK job_assignment(RESTRICT)|
                                                 | FK review_id? (RESTRICT)   |
                                                 | FK evidence_id? (SET NULL) |
                                                 | FK resolved_by? (SET NULL) +--+
                                                 | UQ source_key (hid)        |
                                                 |    origin: automation|human|
                                                 |    basis: json(SUSPICION)? |
                                                 |    reason : text           |
                                                 |    resolution : text?      |
                                                 | IDX resolved_at : ts?      |
                                                 +----------------------------+
```

### Custom Field: `photo_source` (`src/data/custom_field/photo_source/+custom_field.ts`)

Tagged union discriminated by `kind`:

- `{ kind: 'workspace_upload' }` — stamped automatically on direct `photo_evidence.create`.
- `{ kind: 'message', integration, conversation_id, message_id, attachment_id, sender_id, sent_at? }` — accepted only via nested `job_assignments.update.photo_evidence`. The validator rejects any `message` arm where `integration`, `conversation_id`, `message_id`, `attachment_id`, or `sender_id` trims to empty.

### Stored JSON Basis Schemas (`src/lib/basis.ts`)

- `REVIEW_BASIS` (`suspicion_reviews.basis`): tagged union `{ kind: 'review', assignment, job, site, photos[], candidates[], communications[] }`.
- `SUSPICION_BASIS` (`suspicious_activity_logs.basis`): tagged union with arm `review` (same schema as `REVIEW_BASIS`) or arm `human_judgement` (`{ kind: 'human_judgement', reason, evidence_id }`).

---

## 3. Site Identity, Contractor Linking & Job Lifecycle

`sites` and `job_assignments` do not use Bolt `state` lock machines; instead, they enforce strict invariants through synchronous `transform` callbacks and post-commit `effect` hooks.

### 3.1 Site Normalization & Duplicate Prevention (`sites/+model.ts`, `src/lib/site-key.ts`)

```text
  sites.create / sites.update (batch of rows)
        |
        v
  [sites.update only] Nested job_assignments verbs?
        |-- verb not in ('create', 'link') --> REFUSE errors.site_files_jobs_only
        |
        v
  placed(writes, ctx):
    1. Resolve location (set.location ?? before.location)
       |-- location == null --> REFUSE errors.site_location_required (field: location)
    2. If location coordinates changed and set.address omitted -> reset address = null
    3. Resolve unit_number: set.unit_number ?? before.unit_number ?? regex /#[0-9]+-[0-9A-Z]+/i
    4. Derive name = address.trim() || "<lat>, <lng>"
    5. Compute site_key = siteKey(name, unit_number):
         UPPERCASE -> strip apostrophes -> non-[A-Z0-9#-] to space -> compact '#' & '-'
         -> pad single-digit floor (#5-12 -> #05-12)
         -> abbreviate AVENUE->AVE, ROAD->RD, STREET->ST, BLOCK->BLK, DRIVE->DR
         -> strip standalone "SINGAPORE" -> collapse spaces
         -> extract 6-digit postal code (if present) else full normalized location
         -> append normalized "#<unit>" (if present)
         Example: "12 Sample Avenue #5-12, Singapore 100012" --> "100012#05-12"
    6. Batch uniqueness: Set(keys).size < keys.length --> REFUSE errors.sites_share_address
    7. DB uniqueness check (sites WHERE site_key IN keys):
       |-- existing holder.id != before.id --> REFUSE errors.site_address_exists (create)
       |                                           or errors.site_address_taken  (update)
        |
        v
  COMMIT (unique constraints on site_key and site_code)
```

### 3.2 Job Assignment Dispatch, Completion & Re-Review Reset (`job_assignments/+model.ts`, `src/lib/dispatch.ts`)

```text
                 +------------------------------------------+
                 | job_assignments.create / .update         |
                 +--------------------+---------------------+
                                      |
      +-------------------------------+-------------------------------+
      | CREATE                                                        | UPDATE
      v                                                               v
  fields: external_ref, source_message_id,           Guard nested child writes:
          + 14 progress fields                       only verb == 'create' allowed on
      |                                              photo_evidence & communication_logs
      v                                              else REFUSE errors.assignment_files_only
  contactKeys(assignee_contact)                                       |
  - contains '@': [lowercase email]                                   v
  - else digits only:                                If assignee_contact is non-empty:
      8 digits       -> [d, "65"+d]                    re-resolve assignee_user_id via
      10 starting 65 -> [d, d.slice(2)]                memberByContact(sys_user, contact)
      other          -> [d]                            (exact 1 match -> id; else -> null)
  memberByContact() -> unique sys_user.id | null                      |
      |                                                               v
      v                                              reviewStamp = (only suspicion_checked_at)
  dispatchFacts(linked, ctx.now):                    Compute automatic stamps:
  - status = set.status ?? 'pending'                 - assignee_user_id != null &&
  - dispatched_at = set.dispatched_at                  before.dispatched_at == null &&
      ?? (assignee_user_id != null ? now : null)       set.dispatched_at === undefined
      |                                                  --> dispatched_at = ctx.now
      v                                              - after.status === 'completed' &&
  COMMIT                                               after.completed_at == null
      |                                                  --> completed_at = ctx.now
      v                                              - !reviewStamp
  create.effect:                                         --> suspicion_checked_at = null
    ctx.schedule(                                                     |
      'review_job_assignment_suspicion',                              v
      {}, { key: 'suspicion_review' })                              COMMIT
                                                                      |
                                                                      v
                                                     update.effect:
                                                     if any row clears suspicion_checked_at
                                                        (after == null && before !== null):
                                                       ctx.schedule(
                                                         'review_job_assignment_suspicion',
                                                         {}, { key: 'suspicion_review' })
```

Key design invariants:

- **Status vs. findings separation:** `status` (`pending` | `completed`) tracks only field work completion. Raising a suspicion finding never rolls back `status` or erases `completed_at`.
- **Unmatched contractor contact:** If `assignee_contact` matches zero or multiple `sys_user` rows, `assignee_user_id` is stored as `null` (never refused). The dispatch board flags such cards with a warning icon (`No contractor linked`).
- **Automatic re-evaluation:** Any operational update clears `suspicion_checked_at = null`, triggering `update.effect` to queue a fresh review. The review automation's own stamp write (`{ suspicion_checked_at: ctx.now }`) is detected via `reviewStamp` and does not re-trigger itself.

---

## 4. Finding Lifecycle (`suspicious_activity_logs`) & Immutability Guards

```text
  +-----------------------------------+        +-----------------------------------+
  | AUTOMATED PATH                    |        | HUMAN CONTROLLER PATH             |
  | (review_job_assignment_suspicion) |        | (field_ops_controller direct act) |
  | origin = 'automation'             |        | origin = 'human' (default)        |
  | requires: basis.kind === 'review' |        | forbids:  review_id != null       |
  |           review_id != null       |        | composes: basis = {               |
  |           (same job_assignment)   |        |   kind: 'human_judgement',        |
  +-----------------+-----------------+        |   reason, evidence_id }           |
                    |                          +-----------------+-----------------+
                    +---------------------+----------------------+
                                          |
                                          v
              +-------------------------------------------------------+
              | suspicious_activity_logs.create.transform             |
              | - Reject blank reason (errors.finding_reason_empty)   |
              | - Verify review_id & evidence_id belong to same job   |
              | - Compute source_key =                                |
              |     "<origin>:<job_assignment_id>:<sha256(basis)>"    |
              |   (UNIQUE constraint prevents duplicate findings)     |
              +---------------------------+---------------------------+
                                          |
                                          v
              +-------------------------------------------------------+
              | STATE: OPEN (resolved_at IS NULL)                     |
              | create.effect -> ctx.notify("Suspicion raised",       |
              |   to: [team: field_ops_controllers,                   |
              |        team: contractor_controllers])                 |
              +---------------------------+---------------------------+
                                          |
                                          | Controller runs automation:
                                          | suspicious_activity_logs_resolve
                                          |   input: { finding: rows, resolution: text }
                                          |   resolved_by = ctx.trigger.actor.id (if member)
                                          v
              +-------------------------------------------------------+
              | suspicious_activity_logs.update.transform             |
              | update.fields: [resolution, resolved_at, resolved_by] |
              | - If before.resolved_at != null                       |
              |     --> REFUSE errors.finding_resolved                |
              | - If resolution blank OR resolved_at/by null          |
              |     --> REFUSE errors.finding_resolution_incomplete   |
              +---------------------------+---------------------------+
                                          |
                                          v
              +-------------------------------------------------------+
              | STATE: RESOLVED (TERMINAL & IMMUTABLE)                |
              | - No delete verb declared on model                    |
              | - Judgement fields (origin, basis, reason, review_id) |
              |   are outside update.fields                           |
              +-------------------------------------------------------+
```

---

## 5. Photo Filing, Forensic Inspection & Scene Backfill Pipeline

### 5.1 Two Filing Paths & Deterministic Provenance Key

```text
  PATH A: Workspace Upload (Controller/Contractor)  PATH B: WhatsApp / Message Report
  photo_evidence.create                             job_assignments.update
  fields: [job_assignment_id, photo]                layer: photo_evidence.create([photo,source])
  (`source` is NOT a create field here)             (`source` checked by photo_source field)
                |                                                   |
                v                                                   v
  source = { kind: 'workspace_upload' }             source = { kind: 'message', integration,
  source_key = "workspace:<photo.id>"                 conversation_id, message_id,
                |                                     attachment_id, sender_id, sent_at? }
                |                                   source_key = "<int>:<conv>:<msg>:<att>"
                +-------------------------+-------------------------+
                                               |
                                               v
  photo_evidence.create.transform:
  - Refuse if job_assignment_id == null (errors.photo_needs_assignment)
  - Stamp uninspectedPhotoFacts():
      sha256 = "", perceptual_embedding = [0 x 256], flags = [], matched_evidence_ids = []
  - Unique constraint on source_key guarantees redelivered attachments never duplicate
                                               |
                                               v
  photo_evidence.create.effect:
    ctx.schedule('inspect_photo_evidence', {}, { key: 'inspect_photo_evidence' })
```

### 5.2 Lease-Claimed Forensic Inspection (`inspect_photo_evidence` & `inspectPendingPhotos`)

Runs under `policies: ['suspicion_review_automation']` with `concurrency: { max: 1 }` and processes up to `INSPECTIONS_PER_RUN = 50` uninspected rows (`sha256 = '' AND inspection_failed_at IS NULL`) per invocation.

```text
  Query up to 50 photos WHERE sha256 = '' AND inspection_failed_at IS NULL
  Load parent job_assignments.site_id -> sites.location in 2 batch reads
        |
        v
  For each photo:
    +-----------------------------------------------------------------------------------+
    | 1. OPTIMISTIC CLAIM LEASE (INSPECTION_CLAIM_LEASE = 10 min)                       |
    |    If inspection_claimed_at > (ctx.now - 10 min) -> mark job in `held`, skip      |
    |    Else act photo_evidence.update at read `revision`:                             |
    |      { inspection_claimed_at: ctx.now }                                           |
    |    On ActConflict (another run claimed first) -> mark job in `held`, skip         |
    +-----------------------------------------+-----------------------------------------+
                                              | claimed revision obtained
                                              v
    +-----------------------------------------------------------------------------------+
    | 2. HOST IMAGE EXTRACTION: ctx.files.image(photo.photo)                            |
    |    |-- Failure --> clip reason <= 500 chars; record in failures[]                 |
    |    |               write { inspection_failed_at: ctx.now,                         |
    |    |                       inspection_failure_reason: reason } at claimed rev     |
    |    |               (durably settled: never re-inspected, never blocks review)     |
    +-----------------------------------------+-----------------------------------------+
                                              | ImageFacts { sha256, pdq, fmt, w, h, exif }
                                              v
    +-----------------------------------------------------------------------------------+
    | 3. DETERMINISTIC SELF-FLAGS: imageFlags(facts, mime, ctx.now, site.location)      |
    |    - metadata_anomaly    : declared MIME != decoded format (ignoring '' and       |
    |                            'application/octet-stream') OR exif.taken_at > now+1d  |
    |    - edited_metadata     : exif.software matches /photoshop|lightroom|gimp|       |
    |                                                   snapseed|pixelmator/i           |
    |    - low_quality         : width < 640 OR height < 480                            |
    |    - missing_geolocation : exif.gps == null                                       |
    |    - location_mismatch   : exif.gps != null AND site.location != null AND         |
    |                            haversineMeters(gps, site) > 500 m (R = 6,371,000 m)   |
    +-----------------------------------------+-----------------------------------------+
                                              |
                                              v
    +-----------------------------------------------------------------------------------+
    | 4. CROSS-ASSIGNMENT PDQ SEARCH (Meta PDQ 256-bit binary vector)                   |
    |    embedding = hexToBinaryEmbedding(facts.pdq)   (64 hex chars -> 256 x {0, 1})   |
    |    Query photo_evidence index `pdq` (L2, limit 50):                               |
    |      Keep hits where $distance <= sqrt(31) (~5.568, i.e. Hamming <= 31),          |
    |                      id != photo.id, sha256 != '', job_assignment_id != own       |
    |    - any foreign hit with hit.sha256 == facts.sha256 --> add `exact_duplicate`    |
    |    - any foreign hit with hit.sha256 != facts.sha256 --> add `visual_duplicate`   |
    |    - matched_evidence_ids = foreign.map(h => h.id)                                |
    +-----------------------------------------+-----------------------------------------+
                                              |
                                              v
    +-----------------------------------------------------------------------------------+
    | 5. BEST-EFFORT SCENE EMBEDDING                                                    |
    |    file = visible(ctx, photo): pass through jpeg|png|webp|gif, else host-derive   |
    |           JPEG via ctx.files.image(ref, { jpeg: { max_edge: 2048 } })             |
    |    ctx.ai.embed([file], { model: 'scene', dimensions: 256 })                      |
    |    (on error: log warning, set scene_embedding = null; backfilled before review)  |
    +-----------------------------------------+-----------------------------------------+
                                              |
                                              v
    +-----------------------------------------------------------------------------------+
    | 6. COMMIT FACTS AT CLAIMED REVISION & WAKE REVIEWS                                |
    |    Write sha256, perceptual_embedding, scene_embedding, flags, matched_evidence   |
    |    After loop: query settled jobs with suspicion_checked_at IS NULL               |
    |    -> ctx.schedule('review_job_assignment_suspicion', { ids: waiting })           |
    +-----------------------------------------------------------------------------------+
```

### 5.3 Scene Embedding Backfill (`backfillScenes`)

Before `review_job_assignment_suspicion` evaluates any assignment, it calls `backfillScenes(ctx)`:

- Queries up to `SCENE_BACKFILL_PER_RUN = 1000` rows where `sha256 != '' AND scene_embedding IS NULL` (covers seeded photos or transient embed failures during inspection).
- Splits into chunks of `SCENE_BATCH = 4` images and runs up to `SCENE_BATCHES_AT_ONCE = 4` concurrent uninterruptible batches (`ctx.ai.embed(files, { model: 'scene', dimensions: 256 })`).
- **Fail-closed guarantee:** If any batch fails or returns a dimension other than `256`, the review automation immediately schedules a retry at `nextRetrySlot(ctx.now)` and throws `ReviewIncomplete` **before** stamping any assignment checked, preventing a missing scene vector from hiding cross-assignment photo reuse.

---

## 6. Multimodal AI Suspicion Review & Pairwise Verification Engine

`review_job_assignment_suspicion` (`policies: ['suspicion_review_automation']`, `concurrency: { max: 1 }`) orchestrates inspection, scene backfill, and concurrent per-assignment inference (`REVIEWS_AT_ONCE = 6` uninterruptible fibers).

```text
  START review_job_assignment_suspicion(input: { ids?, assignment_id? })
    |
    +-> Step 1: inspectPendingPhotos(ctx)           [ratio 0.02]
    +-> Step 2: backfillScenes(ctx)                 [ratio 0.03]
    |           |-- failure -> schedule retry ('suspicion_retry') & FAIL ReviewIncomplete
    +-> Step 3: uncheckedAssignments(ctx, only)     [ratio 0.05]
    |           Filter out assignments in inspection.held (being inspected by another run)
    |
    v
  PARALLEL FAN-OUT (concurrency = REVIEWS_AT_ONCE = 6, Effect.uninterruptible)
  Per unchecked assignment:
    +---------------------------------------------------------------------------------------+
    | A. LOAD FACTS (loadFacts)                                                             |
    |    - Query site (name, location, house_type) + communication_logs + photo_evidence    |
    |    - If any photo has sha256 == '' AND inspection_failed_at == null:                  |
    |        fail with AwaitingInspection -> increment counts.awaiting_inspection (no stamp)|
    |    - Fetch byte sizes via ctx.files.meta (bytes = -1 on failure -> no visual slot)    |
    +-------------------------------------------+-------------------------------------------+
                                                |
                                                v
    +---------------------------------------------------------------------------------------+
    | B. SCENE REUSE CANDIDATE NOMINATION (sceneCandidates + nominate)                      |
    |    - Uniformly sample up to MAX_PROBES = 64 chronological photos                      |
    |    - For each probe with scene_embedding:                                             |
    |        Query photo_evidence index `scene` (cosine, limit 12)                          |
    |        Keep foreign-job hits with $distance <= SCENE_MAX_COSINE (0.35)                |
    |    - nominate(): per probe, sort by distance; accept winner ONLY IF                   |
    |        (runnerUp.distance - winner.distance) >= SCENE_MIN_DISTINCTIVENESS (0.02)      |
    |        (filters out dense clusters of generic fixtures/doors)                         |
    |      Round distance to 3 decimals (BigDecimal, mode: 'half-ceil')                     |
    |      Keep closest MAX_CANDIDATES = 2 unique foreign photos                            |
    +-------------------------------------------+-------------------------------------------+
                                                |
                                                v
    +---------------------------------------------------------------------------------------+
    | C. VISUAL SAMPLE SELECTION (selectInferencePhotos)                                    |
    |    Exclude inspection_failed_at != null and bytes < 0.                                |
    |    Budget: MAX_INFERENCE_IMAGES = 3 AND total bytes <= 4 MiB.                         |
    |    Priority order (deduplicated, then re-sorted chronologically):                     |
    |      1. preferred: own photos matched by nominated scene candidates                   |
    |      2. signalled: top MAX_SIGNAL_IMAGES = 2 photos with photoSignal > 0, where       |
    |           photoSignal = matched_evidence_ids.length * 8 + sum(SIGNAL_WEIGHT[flag])    |
    |           Weights: exact_duplicate=7, visual_duplicate=6, location_mismatch=5,        |
    |                    edited_metadata=4, metadata_anomaly=3, low_quality=2,              |
    |                    missing_geolocation=0                                              |
    |      3. temporal : [first, middle, last] chronological photos                         |
    |      4. remaining chronological photos                                                |
    +-------------------------------------------+-------------------------------------------+
                                                |
                                                v
    +---------------------------------------------------------------------------------------+
    | D. CANONICAL BASIS & PARALLEL MULTIMODAL INFERENCE (model: 'default')                 |
    |    basis = reviewBasis(facts); basisHash = sha256Text(JSON.stringify(basis))          |
    |    attachedPairs = pairs where own in representatives & candidate.bytes <= 1 MiB      |
    |                                                                                       |
    |    Effect.all (concurrency: unbounded, mode: result):                                 |
    |      [1] MAIN JOB-SITE TURN                                                           |
    |          Prompt: job, site, attached photo list+flags, unattached flag counts,        |
    |                  <= 24 most recent messages (<= 800 chars each, total <= 48 KiB)      |
    |          Files : up to 3 representatives (host JPEG fallback <= 2048px if needed)     |
    |          Output: DECISION { suspicious: bool, reason: text, evidence_asset_name }     |
    |      [2..k] ISOLATED TWO-IMAGE PAIR TURNS (1 per attachedPair, prevents cross-wiring) |
    |          Prompt: PAIR_PROMPT (permanent landmark geometry only; ignore overlays/tools)|
    |          Files : [own.photo, candidate.photo]                                         |
    |          Output: PAIR_DECISION { same_scene: bool, reason: text }                     |
    +-------------------------------------------+-------------------------------------------+
                                                |
                                                v
    +---------------------------------------------------------------------------------------+
    | E. DETERMINISTIC VERDICT GATE (judge in suspicion-review-verdict.ts)                  |
    |    - Blank decision.reason -> throw ReviewDecisionInvalid                             |
    |    - cited = representatives.find(p => assetName(p) === decision.evidence_asset_name) |
    |    - supported = decision.suspicious && cited != null                                 |
    |    - reused    = attachedPairs where pairTurn succeeded with same_scene === true      |
    |    - suspicious = supported || reused.length > 0                                      |
    |      (Unsupported job-site suspicion without valid attached asset name is downgraded  |
    |       to suspicious=false with explicit audit note; pair prose is replaced with       |
    |       standardized reuse sentence; final reason clipped to 600 chars)                 |
    +-------------------------------------------+-------------------------------------------+
                                                |
                                                v
    +---------------------------------------------------------------------------------------+
    | F. IDEMPOTENT AUDIT & ATOMIC COMMIT                                                   |
    |    1. suspicion_reviews.create (source_key = "suspicion-review:<job>:<basisHash>")    |
    |       If ActRefused(code: 'unique'), ignore and query existing row by (job,basisHash) |
    |    2. If review.suspicious: query suspicious_activity_logs for same review_id OR any  |
    |       unresolved log on job -> status: 'suspicious' | 'suspicious_log_exists' |       |
    |       'suspicious_open_exists' (else 'clear' | 'clear_existing')                      |
    |    3. Single atomic ctx.act:                                                          |
    |       - [if status === 'suspicious'] suspicious_activity_logs.create (origin: auto)   |
    |       - job_assignments.update at read `revision`: { suspicion_checked_at: ctx.now }  |
    +---------------------------------------------------------------------------------------+
                                                |
                                                v
  POST-LOOP RETRY POLICY:
    If failures.length > 0 OR counts.awaiting_inspection > 0:
      ctx.schedule('review_job_assignment_suspicion', {},
                   { at: nextRetrySlot(ctx.now), key: 'suspicion_retry' })
      where nextRetrySlot = next even UTC hour (00:00, 02:00, ..., 22:00 UTC)
    If failures.length > 0:
      FAIL with ReviewIncomplete naming failure count and first assignment failure
```

---

## 7. Work-Order Import & Site Handover Export Pipelines

### 7.1 Whole-Sheet Work-Order Import (`job_assignments_import_work_orders`)

Runs under `policies: ['field_ops_controller']`. Accepts CSV, XLS, or XLSX files up to **5 MiB** and **1 to 5,000 data rows**.

```text
  Upload file (CSV / XLS / XLSX <= 5 MiB)
        |
        v
  ctx.convert.ingest(file) --> decode IngestSheets --> take sheets[0]
        |
        v
  sheetRecords(sheet):
    - Lower-case & trim headers; trim cell values; drop blank cells & empty rows
    - Check row count in [1, 5000] else REFUSE errors.sheet_size
        |
        v
  decodeWorkOrders(records) [src/lib/work-order-sheet.ts]:
    - Verify required headers: ['site', 'scheduled_for', 'title']
    - Convert 1..6-digit Excel date serials -> ISO date (1899-12-30 + N days)
    - Decode every row against WORK_ORDER_ROW Schema (accumulating all errors)
    - Any decode error --> REFUSE errors.sheet_invalid (lists every faulty row/column)
        |
        v
  Whole-Sheet Semantic Validation & Deduplication:
    - Check non-empty title, non-empty address/siteKey, no duplicate external_ref in sheet
    - Single batch ctx.query:
        * sites WHERE site_key IN keys OR site_code IN codes
        * job_assignments WHERE site_id IN matched sites OR external_ref IN refs
    - For each row:
        * Match site: byCode(row.site) ?? byKey(siteKey(addressOf(row), unitOf(row)))
          (explicit unit_number overrides embedded /#[0-9]+-[0-9A-Z]+/i; postal_code folded in)
        * Identity key = external_ref || sameWork(siteId | "new:"+key, day, normalizedTitle)
        * If identity already in `filed` set --> increment `skipped`, continue
        * Add identity to `filed` (deduplicates identical rows within the same sheet)
        * If existing site: queue in `onSites`
        * If new site: require finite latitude in [-90, 90] & longitude in [-180, 180]
          (else record errors.sheet_site_unlocated) and group jobs under `fresh.get(key)`
    - If ANY problem recorded --> sort by row index and REFUSE first problem (0 rows written!)
        |
        v
  Single Atomic ctx.act:
    {
      'sites.create': newSites (each carrying nested `job_assignments`),
      'job_assignments.create': onSites
    }
    (Triggers sites.create.transform, job_assignments.create.transform [contractor linking],
     and job_assignments.create.effect [schedules suspicion review])
        |
        v
  Return { created, sites: fresh.size, skipped }
```

### 7.2 Site Handover Export (`site_handover`)

Runs under `policies: ['field_ops_controller']` for `ids: ref<sites>[]` (`min_items: 1`):

```text
  input: { ids: [site_id, ...] }
        |
        v
  Single Multi-Root ctx.query:
    - sites           WHERE id IN ids
    - job_assignments WHERE site_id IN ids
    - photo_evidence  WHERE job_assignment_id.site_id IN ids
                      fields: [job_assignment_id, photo, sha256, flags, matched_evidence_ids]
        |
        v
  For each site (sanitized code = (site.name || site.id).replace(/[^a-z0-9_-]/gi, '_')):
    Transform points to WGS84 interoperability object:
      { geometry: { lat, lon }, formatted_address, type: 'Point', srid: 4326 }
    Emit 3 files via ctx.files.put(..., { for: 'site_handover' }):
      1. field_ops_<code>.json
           { schema: 'norbital.field_operations.interoperability.v2',
             site, job_assignments, photo_evidence }
      2. field_ops_<code>_job_assignments.csv   (RFC 4180, CRLF)
      3. field_ops_<code>_photo_evidence.csv    (RFC 4180, pipe-joined flags & matched IDs)
        |
        v
  Return { files } (downloadable from automation run output)
```

---

## 8. Access Control, Output Isolation & Rate-Limit Boundary

### 8.1 Teams-to-Policies & Authority Matrix

```text
  TEAMS (src/access_control/team/+team.ts)              POLICIES (src/access_control/policy/)
  ----------------------------------------              -------------------------------------
  field_ops_controllers  ("Field Operations Controllers") --+--> field_ops_controller
  contractor_controllers ("Contractor (Controller)")     ---+
  contractors            ("Contractor")                  ------> field_ops_contractor
  [runtime sys_envoy]    (WhatsApp Envoy)                ------> field_ops_whatsapp
  [system automations]   (inspect / review)              ------> suspicion_review_automation

+---------------------+------------------+----------------+----------------+------------------+
| Resource            | field_ops_       | field_ops_     | field_ops_     | suspicion_review |
| / Capability        | controller       | contractor     | whatsapp       | _automation      |
+---------------------+------------------+----------------+----------------+------------------+
| Apps                | controller,      | contractor     | (none)         | (none)           |
|                     | contractor       |                |                |                  |
| Manual Automations  | review, handover | (none)         | (none)         | (none)           |
|                     | import, resolve  |                |                |                  |
+---------------------+------------------+----------------+----------------+------------------+
| sites               | R(default) C U D | R(contractor)  | R(default)     | R(default)       |
|                     |                  | own-job sites  |                |                  |
| job_assignments     | R(default) C U*D | R(contractor)  | R(default)     | R(default)       |
|                     | *all excl. stamp | OWN; U(6 prog  | U(status,comp, | U(checked_at     |
|                     | +nested photo/msg| flds,OWN verd) | summary+nested)|  once verdict)   |
| photo_evidence      | R(default) C U D | R(contractor)  | (via nested    | R(default)       |
|                     |                  | OWN_JOB;C(2fld)| job upd only)  | U(unsettled verd)|
| communication_logs  | R(default) C     | R(contractor)  | C (direct &    | R(default)       |
|                     | (append-only)    | OWN_JOB; C     |  nested upd)   | UNCHECKED_JOB    |
| suspicion_reviews   | R(default) C     | (NO ACCESS)    | (NO ACCESS)    | R(default) C     |
|                     | (append-only)    |                |                | UNCHECKED verd.  |
| suspicious_activity | R(default) C U   | (NO ACCESS)    | (NO ACCESS)    | R(default) C     |
| _logs               | (no delete)      |                |                | auto+UNCHECKED   |
| sys_user            | R(default)       | (dir via host) | R(directory)   | (none)           |
+---------------------+------------------+----------------+----------------+------------------+
| Rate Limits         | act:   600/min   | act:   600/min | act: 60/min    | act:   600/min   |
| (+workspace.ts)     | read:  600/min   | read:  600/min | envoys.receive:| read:  600/min   |
|                     | agent: 100/h     | agent: 100/h   |  30/min sender | agent: 500/h     |
|                     |                  |                | 300/min subj.  |                  |
+---------------------+------------------+----------------+----------------+------------------+
```

### 8.2 Structural Confidentiality & Single-Transition Verdicts

1. **Named Output Firewall (`contractor` vs. `default`):**
   - `sites.contractor` hides `site_key` and filters nested `job_assignments` to `OWN` (`assignee_user_id = actor.id`), so a contractor at a shared site never sees another contractor's visits.
   - `job_assignments.contractor` hides `external_ref`, `assignee_contact`, `source_message_id`, and `suspicion_checked_at`.
   - `photo_evidence.contractor` exposes only `['job_assignment_id', 'photo', 'source']` — hiding `sha256`, `perceptual_embedding`, `scene_embedding`, `flags`, `matched_evidence_ids`, and `inspection_*` fields structurally at the database/API boundary.
   - `communication_logs.contractor` hides `source_message_id`.
   - `suspicion_reviews` and `suspicious_activity_logs` declare only a `default` output and grant zero access to `field_ops_contractor` and `field_ops_whatsapp`.
2. **Custom Policy Verdicts:**
   - `field_ops_contractor` on `job_assignments.update`: verifies `before.assignee_user_id === actor.id` (`errors.job_not_yours`).
   - `suspicion_review_automation` on `job_assignments.update`: permits only `suspicion_checked_at` and only when `before.suspicion_checked_at === null && set.suspicion_checked_at != null` (`errors.assignment_stamped_once`).
   - `suspicion_review_automation` on `photo_evidence.update`: refuses if `before.sha256 !== '' && before.scene_embedding !== null` (`errors.photo_already_inspected`), ensuring facts and scene embeddings are each filled at most once.
   - `suspicion_review_automation` on `suspicion_reviews.create` and `suspicious_activity_logs.create`: verifies every target assignment is still unchecked (`suspicion_checked_at IS NULL`), and on `suspicious_activity_logs.create` additionally enforces `origin === 'automation'` (`errors.review_automated_only`).
3. **WhatsApp Envoy Turn Authority:**
   - Configured at runtime as a private `sys_envoy` holding `field_ops_whatsapp`.
   - Group chats execute under `field_ops_whatsapp` alone (can update any existing assignment's `status`, `completed_at`, `summary`, and append nested `photo_evidence` + `communication_logs`).
   - Direct messages union `field_ops_whatsapp` with the linked member's team policies; unknown senders are refused.
   - Because `field_ops_whatsapp` grants no direct `photo_evidence.create`, photos can only enter through nested `job_assignments.update.photo_evidence`, ensuring message provenance (`source.kind = 'message'`) is always preserved.
