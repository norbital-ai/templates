# Construction Operations — Architecture & Inner Mechanisms

Technical deep dive into the `norbital_construction` Bolt workspace (`templates/construction`). Every model, field, constraint, state transition, calculation formula, client worker, cache layer, automation, sync, and access-control rule below reflects the live implementation under `src/`.

## Table of Contents

1. [System Topology & Runtime Architecture](#1-system-topology--runtime-architecture)
2. [Data Model & Ownership ER Diagram](#2-data-model--ownership-er-diagram)
3. [State Machines, Write Locks & Side Effects](#3-state-machines-write-locks--side-effects)
4. [Single-Model BIM Lifecycle, Visual AI Costing & Daily EOD Sweep](#4-single-model-bim-lifecycle-visual-ai-costing--daily-eod-sweep)
5. [Client-Side 3D IFC Viewer & Two-Tier Fragment Cache](#5-client-side-3d-ifc-viewer--two-tier-fragment-cache)
6. [Catalog-Wired Pricing, 3-Way Matching & Commercial Cashflow Ledger](#6-catalog-wired-pricing-3-way-matching--commercial-cashflow-ledger)
7. [Multi-Channel WhatsApp/Email Intake, Routing & AI Extraction](#7-multi-channel-whatsappemail-intake-routing--ai-extraction)
8. [Programme Scheduling, Autodesk ACC Sync & 4D BIM Bridge](#8-programme-scheduling-autodesk-acc-sync--4d-bim-bridge)
9. [Access Control & Authority Matrix](#9-access-control--authority-matrix)

---

## 1. System Topology & Runtime Architecture

The workspace runs on `@norbital-ai/bolt` (`Asia/Singapore`, `en-SG`, `SGD` default currency, bilingual `en` / `zh`, PDF conversion enabled) and splits cleanly into two runtime sides:

- **Browser client (Svelte 5 + `@norbital-ai/ui` + Web Workers + WebGL):** Hosts the two apps (`operations`, `configuration`), the single-row Project Hub (`projects/+representation.svelte`), the 4D virtualized WBS timeline (`ProjectTimeline.svelte`), the catalog-only line editor (`CatalogLinesEditor.svelte`), and the heavy BIM geometry stack (streaming IFC STEP worker, offscreen WebGL isolated snapshot renderer, `@thatopen/components` + Three.js 3D viewport, and two-tier `.frag` cache). Large binaries (`web-ifc@0.0.77`, `three@0.185.1`, `@thatopen/*`) load from pinned CDN URLs at runtime so the workspace release stays lightweight.
- **Bolt server & guest engine (Effect v4):** Owns 12 record models, 5 co-located custom fields, 4 syncs, 8 automations, 1 custom OAuth 2.0 integration (`autodesk_acc`), 4 teams, 5 policies, and pure Effect `BigDecimal` commercial and BIM pricing libraries.

```text
+----------------------------------------------------------------------------------------------+
|                                     BROWSER CLIENT                                           |
|                                                                                              |
|  [Operations App]                         [Configuration App]                                |
|   |- Projects -> Project Hub               |- Item Matrix (+matrix.sync.ts XLSX/CSV)      |
|   |   |- Record (Project + Site)           |- Connections (MyConnections.svelte:             |
|   |   |- Programme & Tasks (Timeline |     |   Personal WA/Email + Shared WA/Email/ACC +     |
|   |   |   Table | Board icon toggle)       |   Personal Intake Rules)                        |
|   |   |- BIM [keep_alive]                  +-------------------------------------------------+
|   |   |   |- 3D Model & Issues (ifc_viewer.svelte + Issues table; select isolates)           |
|   |   |   |- BIM Costing (1:1 inline estimate + dirty/void banner)                           |
|   |   |   |- Model file (bim_version, bim_file, bim_summary)                                 |
|   |   |- Finance                                                                             |
|   |   |   |- Overview (KPI strip + net-amount chart)                                         |
|   |   |   |- Cashflow & Budget ledger                                                        |
|   |   |   |- Client contracts / Subcontracts & supply -> nested VOs & Transactions           |
|   |   |   |- Ad-hoc Costs (catalog-backed)                                                   |
|   |   |- Documents (project_files register)                                                  |
|   |- Business Partners (All | Customers | Vendors | Subcontractors)                          |
|   |- Messages (Unified WA/Email Inbox + Sync / Classify / Extract actions)                   |
|                                                                                              |
|  [Browser Workers & Cache]                                                                   |
|   |- norbital-ifc-converter Worker (web-ifc WASM -> .frag) <-> L1 LRU(4) + L2 CacheStorage   |
|   |- norbital-ifc-takeoff Worker (4 MiB STEP stream) -> Offscreen WebGL 3-Angle Snapshots    |
+---------------------------------------------+------------------------------------------------+
                                              | PageBolt queries, ctx.act, ctx.run, ctx.upload
                                              v
+----------------------------------------------------------------------------------------------+
|                              BOLT SERVER / GUEST ENGINE (Effect v4)                          |
|                                                                                              |
|  [12 Models + Write Transforms/Effects]        [8 Automations (construction_automation)]     |
|   projects (root) -> 7 owned children:          |- analyze_bim_file (manual / sweep)         |
|     cost_estimates (1:1), contracts,            |- sweep_bim_costing (cron 22:00 daily)      |
|     commercial_documents, adhoc_costs,          |- generate_payment_claim (mode: 'call' RPC) |
|     tasks, issues, project_files                |- sync_messages (sys_message + */15 cron)   |
|   Top-level: contacts, project_messages,        |- classify_messages (*/5 cron + scheduled)  |
|     item_matrix, communication_settings         |- reclassify_messages (contact/rule replay) |
|                                                 |- extract_project_updates (scheduled/manual)|
|  [Pure Domain Libraries]                        |- daily_project_digest (cron 06:00 SGT)     |
|   commercial.ts (BigDecimal), catalog-lines.ts,                                              |
|   bim-pipeline.ts, bim-step-stream.ts,         [4 Syncs]                                     |
|   schedule-parsers.ts (P6/MSP), zones.ts        |- tasks.schedule_file (.xer/.xml/.csv/.xlsx)|
|                                                 |- tasks.autodesk_schedule (30min 2-way)     |
|  [Access Control]                               |- project_files.autodesk_files (1h 2-way)   |
|   4 Teams -> 5 Policies (rate: 600/min)         |- item_matrix.matrix (.xlsx/.csv)           |
+----------------------+-----------------------+-----------------------+-----------------------+
                       |                       |                       |
                       v                       v                       v
           +--------------------+   +---------------------+   +------------------------+
           |   Host Facilities  |   |  AI & Media Engine  |   |   External Systems     |
           |  - PGlite / PG DB  |   |  - ctx.ai.sys_1     |   |  - WhatsApp (built-in) |
           |  - File Store      |   |    (Visual & Route) |   |  - Email (built-in)    |
           |  - Notifications   |   |  - ctx.ai.sys_2     |   |  - Autodesk ACC / APS  |
           |  - Cron / Queue    |   |    (Multimodal Ext) |   |    (OAuth 2.0, 10/s)   |
           |  - Sealed Secrets  |   |  - convert.ingest   |   |  - P6 .xer / MSP .xml  |
           +--------------------+   |    (Voice STT)      |   +------------------------+
                                    +---------------------+
```

---

## 2. Data Model & Ownership ER Diagram

All 12 models live under `src/data/model/`. `projects` is the primary aggregate root with 7 owned children (`owned: true`, cascade delete). Cross-entity operational references use `on_delete: 'set_null'`, except `adhoc_costs.catalog_item_id -> item_matrix`, which uses `on_delete: 'restrict'` so catalog items backing recorded project costs cannot be deleted.

```text
                       +-------------------------------------------+
                       |                 projects                  |
                       | PK id | UQ project_number | project_role  |
                       | status, currency, schedule_range          |
                       | client_id -> contacts (set_null)          |
                       | project_manager -> sys_user               |
                       | autodesk_project_id                       |
                       | bim_file (<=20MiB), bim_version,          |
                       | bim_costing_dirty, bim_summary (json)     |
                       | zones [project_zones], address [...]      |
                       | Counts: open_task, open_issue,            |
                       |         active_contract, open_document    |
                       +---+-------+-------+-------+-------+-------+
                           |       |       |       |       |
       +-------------------+   +---+       |       |       +-------------------+
       | owned (1:1 UQ)        | owned     | owned | owned                     | owned
       v                       v           |       v                           v
+-------------------------+ +------------+ | +-------------------------+ +---------------------+
|     cost_estimates      | |  issues    | | |     project_files       | |        tasks        |
| UQ (project_id)         | | SEQ ISS-*  | | | UQ (project_id,doc_no)  | | UQ (proj,task_code) |
| SEQ EST-yyyy-000        | | kind, sev, | | | kind: drawing|spec|     | | wbs_path, ext_id,   |
| status: draft|reviewed| | | trade,     | | |  schedule|contract_doc  | | is_milestone, zone*,|
|         baselined|void  | | zone*,     | | |  handover|autodesk_mdl  | | trade, status,      |
| bim_assets [bim_takeoff]| | bim_pin,   | | | current_version, file,  | | baseline/schedule/  |
| bim_subtotal,           | | photos[],  | | | discipline, status,     | | actual_range,       |
| contingency_pct/amount, | | task_id,   | | | autodesk_urn, zone*     | | progress_pct,       |
| total_estimate          | | contract_id| | +-------------------------+ | bim_express_ids[],  |
| analyzed_at, notes      | | party, msg | |                             | nested by wbs_path  |
+-------------------------+ +------------+ |                             | contract, subcon,   |
                                           |                             | assignee, msg       |
             +-----------------------------+-------------------+         +---------------------+
             | owned                       | owned             | owned
             v                             v                   v
+-------------------------+ +-----------------------------+ +-------------------------+
|       contracts         | |    commercial_documents     | |      adhoc_costs        |
| SEQ CTR-yyyy-000        | | SEQ DOC-yyyy-000            | | SEQ ADH-yyyy-000        |
| direction: up | down    | | doc_type: PO|DO|Invoice|    | | catalog_item_id --------+--+
| contract_type: main|sub | |   Claim|CreditNote          | |   (on_delete: restrict) |  |
|  supply|consult|VO      | | direction: inflow | outflow | | status,                 |  |
| parent_contract_id(self)| | status, match_status        | | currency, unit, qty,    |  |
| lines [priced_lines]    | | contract_id (set_null)      | | unit_rate, amount,      |  |
| retention, tax, terms   | | parent_document_id (self)   | | incurred_date,          |  |
| bim_pin, contact, msg   | | lines [priced_lines]        | | contact_id (set_null)   |  |
+-------------------------+ | subtotal/tax/total/net      | +-------------------------+  |
                            | contact_id, source_msg      |                              |
                            +-----------------------------+                              |
                                                                                         v
+-------------------------+ +-------------------------+ +----------------------------------+
|        contacts         | |    project_messages     | |           item_matrix            |
| full_name, company_name | | UQ (source_message)     | | UQ (code) [import_key]           |
| role (9 enum values),   | | transport, direction,   | | category: bim_asset |            |
| trade_specialty (16),   | | handle, detail,         | |           additional_cost        |
| payment_terms_days,     | | recording, transcription| | discipline, trade_specialty,     |
| phone, email,           | | classification,         | | ifc_classes[], match_keywords[], |
| COMPUTED email_key,     | | classified_by,          | | unit, quantity_basis, currency,  |
| COMPUTED phone_key      | | extraction_status       | | unit_rate, waste_factor_pct,     |
+-------------------------+ | source_message->sys_msg | | rate_basis, validity, active     |
                            | source_user->sys_user   | +----------------------------------+
+-------------------------+ | project_id, contact_id  |
| communication_settings  | +-------------------------+  * zone validated in batch against
| UQ (owner -> sys_user)  |                                projects.zones[].code (as_of:'act')
| hard_filter,auto_extract|                                when parent project defines zones.
| classification_sop      |
+-------------------------+
```

### Co-Located Custom Fields (5)

| Custom Field      | Used By                                         | Shape & Validation                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bim_takeoff`     | `cost_estimates.bim_assets`                     | Array of classified/unmatched takeoff buckets (`asset_key`, `ifc_class`, `classification`, `discipline`, `storey`, `element_count`, `measured_qty`, `unit`, `quantity_basis`, `matrix_code`, `unit_rate`, `waste_factor_pct`, `priced_qty`, `amount`, `status`, `match_method`, `match_confidence`, `match_reason`, `sample_express_ids`). Validates non-empty `classification` and valid `BigDecimal` strings. |
| `bim_pin`         | `issues.bim_pin`, `contracts.bim_pin`           | Single 3D element anchor (`express_id`, `element_name`, `global_id`, `x/y/z`, `camera_x/y/z`).                                                                                                                                                                                                                                                                                                                  |
| `priced_lines`    | `contracts.lines`, `commercial_documents.lines` | Array of catalog/BIM-backed lines (`source`: `bim_asset` \| `adhoc_catalog`, `code`, `bim_asset_key`, `storey`, `bim_express_ids`, `description`, `unit`, `qty`, `unit_rate`, `amount`). Validates required `code`, `description`, `unit`, and `BigDecimal` `qty`/`unit_rate`.                                                                                                                                  |
| `project_zones`   | `projects.zones`                                | Array of `{ code, name, elevation_m, grid_axis }`. Validates non-empty, unique `code` within the project.                                                                                                                                                                                                                                                                                                       |
| `project_address` | `projects.address`                              | Structured postal object `{ line_1, line_2, city, state, postal_code, country }`.                                                                                                                                                                                                                                                                                                                               |

---

## 3. State Machines, Write Locks & Side Effects

Eight models declare explicit state machines, row locks, or automated write transforms/effects. All constraints execute natively at the database/engine layer; locks allow only explicitly listed `except` fields to mutate once entered.

```text
[1] projects.status (initial: active)
  tendering <---> active <---> on_hold
      |            ^  |           |
      v            |  v           v
   cancelled <-----+  defects_liability <---> complete
      (can return to tendering or active)

  Side effects on bim_file write:
  - create (bim_file != null): bim_version ??= 'P01', bim_costing_dirty=true
  - update clearing bim_file:  bim_costing_dirty = false
  - update changing bim_file:  bim_costing_dirty = true (record history keeps the prior file),
                               effect -> void any non-void cost_estimates for project_id!

[2] cost_estimates.status (initial: draft | UQ project_id)
  +-------+      +----------+      +-----------+ [baselined_locked: except status, notes]
  | draft |<---->| reviewed |----->| baselined |
  +---+---+      +----+-----+      +-----+-----+
      |   ^           |                  |
      |   |           v                  |
      +---+-------> [void] <-------------+  <-- auto-triggered by projects.update.effect
      |   (re-run analyze_bim_file               when projects.bim_file changes
      |    transitions void -> draft)
      +------------------------------> baselined (direct baseline & baselined -> draft allowed)

[3] contracts.status (initial: draft)
  +-------+      +--------------+ [review_locked: except status, signed_date, attachments,
  | draft |<---->| under_review |                 scope_notes]
  +---+---+      +------+-------+
      |   ^             |  (record history keeps each priced version)
      v   |             v
  rejected|      +-----------+ [active_locked: except status, insurance_expiry, attachments,
          |      |  active   |                 scope_notes] (auto signed_date = ctx.today)
          +----->+-----+-----+
                       |
                       +---> completed  \  [settled_locked: except attachments]
                       +---> terminated /  (terminal states)

[4] commercial_documents.status (initial: draft)
                                  +----------+
                                  | disputed |<-----------------------+
                                  +----+-----+                        |
                                       | (to draft|issued|verified    |
                                       v  |cancelled)                 |
  +-------+     +--------+     +----------+     +-----------+     +---+--+
  | draft |---->| issued |---->| verified |---->| certified |---->| paid | (auto paid_date)
  +---+---+     +---+----+     +----+-----+     +-----+-----+     +------+
      |             |               |                 |
      |             +---------------+-----------------+--> (shortcut to paid allowed)
      v             v
  cancelled <-------+  (cancelled & paid are terminal)

  Locks:
  - issued_locked (issued, verified): except status, certified_amount, net_amount,
                                      delivery_date, paid_date, match_status, match_notes,
                                      attachments
  - certified_locked (certified):     except status, paid_date, attachments
  - settled_locked (paid, cancelled): except attachments

[5] adhoc_costs.status (initial: draft)
  draft <---> approved ---> incurred (terminal; auto incurred_date = ctx.today if null)
    |   ^         |
    v   |         |         [settled_locked (incurred, cancelled):
  cancelled <-----+          except status, attachments, notes]

[6] tasks.status (initial: todo)             [7] issues.status (initial: open)
  todo <---> in_progress <---> blocked         open <--> in_progress <--> ready_for_verification
   |  ^        |  ^             |               |  ^        |                      |
   |  |        v  |             |               |  |        v                      v
   |  |       done              |               |  +---> closed <------------------+
   v  |                         v               |  (entering closed auto-sets closed_date)
  cancelled <-------------------+
  - entering in_progress (no actual_range): sets actual_range = { from: ctx.today, to: null }
  - entering done: sets progress_pct = '100', closes actual_range.to = ctx.today
  - changing latest_update/progress_pct: auto-stamps last_updated_on = ctx.today
  - remote sync actor bypasses auto-stamping transforms

[8] project_files.status (initial: draft)
  draft <---> in_review <---> issued ---> superseded ---> archived ---> draft
    |             |             |                            ^
    +-------------+-------------+----------------------------+
  - create/update validates zone against projects.zones; record history keeps earlier versions
```

---

## 4. Single-Model BIM Lifecycle, Visual AI Costing & Daily EOD Sweep

Each project owns **one** federated BIM model (`projects.bim_file`, up to 20 MiB upload) paired **1:1** with a single `cost_estimates` row (`unique: ['project_id']`). Because contractor IFC files frequently use cryptic or generic proxy labels (`IFCBUILDINGELEMENTPROXY`), classification runs through Jev System 1 (`ctx.ai.sys_1.decide`) with isolated multi-angle 3D snapshots of each unique archetype rather than brittle keyword matching.

```text
  [Project BIM Model Changed]
  projects.create / projects.update (bim_file uploaded or replaced)
         |
         +--> Transform: bim_version ??= P01 on create, bim_costing_dirty=true
         +--> Effect:    query cost_estimates(project_id, status != 'void') -> set status='void'
                            |
         +------------------+-----------------------------------+
         |                                                      |
         v  PATH A: MANUAL BROWSER PIPELINE                     v  PATH B: DAILY EOD SWEEP
  (BIM -> BIM Costing, or Scan Local IFC)                sweep_bim_costing (0 22 * * *, 24h)
         |                                               or Projects toolbar "Sweep" button
         v                                                      |
  1. ifc_takeoff.worker.ts (Web Worker)                         v
     - Streams File/URL in 4 MiB slices                  Query active/tendering/on_hold/dlp
     - bim-step-stream.ts zero-regex scanner             projects where bim_file != null AND
       skips ~95% geometry lines                         (dirty OR no estimate OR status=void)
     - Keeps 90+ ASSET_CLASSES + spatial/type/                  |
       material/Pset/Qto graphs -> SI units                     v
     - Deduplicates via computeArchetypeSignature:       ctx.files.meta(project.bim_file)
       * Typed:   TYPE|cls|typeKey|op|pre|c|lay                 |
       * Untyped: INST|cls|norm|obj|op|pre|c|lay         +------+--------------------+
     - Emits ExtractedBimModel (archetypes +             | bytes <= 4 MiB            | > 4 MiB
       [archetype, storey] buckets)                      v                           v
         |                                           ctx.schedule(             ctx.notify(
         v                                             'analyze_bim_file',       teams: qs,
  2. ifc_asset_snapshots.ts (Offscreen WebGL)          { project_id }            delivery,
     - web-ifc@0.0.77 + three@0.185.1 (<=250MB)      )                           admins
     - Max 120 archetypes; 224x224 JPEG q=0.74           |                     "Exceeds 4 MiB;
       (soft 2-view @1.8MB, hard cap 2.4MB):             |                      open BIM Costing
       Isolates representative_express_id (+parts),      |                      in browser",
       orients widest face forward, 3 angles:            |                      once/proj/day)
       (a) Front 3/4 iso   (34deg yaw, 20deg pitch)      |
       (b) Front elevation (0deg yaw, 4deg pitch)        |
       (c) Side/rear 3/4   (112deg yaw, 28deg pitch)     |
         |                                               |
         +-----------------------+-----------------------+
                                 v
  3. analyze_bim_file Automation (concurrency: 1, policy: construction_automation)
     - Guard: refuse if existing estimate status not in ['draft', 'void']
     - No extracted_model -> ctx.files.get(bim_file, max: 4MiB) -> parseIfcStepToExtracted
     - Filter active item_matrix rules valid on ctx.today matching project.currency & bim_asset
     - Stage 3a (Visual, <=120, 1 call/archetype):
         rankCandidateMatrixRules([arch], rules, 80) -> ctx.ai.sys_1.decide(views + attrs)
         Choice = rule.code (confidence >= 0.68) OR 'unknown_unseen_catalog'
     - Stage 3b (Text-only remainder, batches of 15, max 12 batches = 180):
         rankCandidateMatrixRules(batch, rules, 80) -> ctx.ai.sys_1.decide(text summary)
     - Stage 3c (Exact BigDecimal Pricing — buildBimCostEstimateFromExtracted):
         measured_qty = metric + max(0, count - measured_count) [len/area/vol/wt] | count
         priced_qty   = measured_qty * (1 + waste_factor_pct / 100)
         amount       = round(priced_qty * unit_rate, scale=2, half-from-zero)
         Group by (rule.code::storey) or (UNMATCHED::archetype_id::storey)
         status: matched (rate>0) | rate_missing (rate==0) | unmatched (unknown_unseen_catalog)
         contingency_amount = round(bim_subtotal * contingency_pct / 100, 2)
         total_estimate     = bim_subtotal + contingency_amount
     - Atomic ctx.act:
         * projects.update:       bim_summary = {...}, bim_costing_dirty = false
         * cost_estimates.upsert: status = 'draft' (if was 'void'), bim_assets, analyzed_at
```

### Candidate Ranking Scoring (`rankCandidateMatrixRules`)

When a workspace carries more than 80 active currency-matched `bim_asset` rules in `item_matrix`, candidate rules are scored per batch before passing choices to Jev System 1 (`<= 255` choice limit):

- `+20` for each IFC class in `rule.ifc_classes` present in the archetype batch.
- `+6` if `rule.discipline` matches the inferred discipline (`mep`, `structural`, `civil`, `architecture`).
- `+3` for each overlapping normalized token (`>= 2` chars) across rule code, name, discipline, trade specialty, match keywords, and notes.

---

## 5. Client-Side 3D IFC Viewer & Two-Tier Fragment Cache

`src/lib/ifc-viewer/ifc_viewer.svelte` embeds an interactive Three.js + `@thatopen/components` viewport inside the `keep_alive` **BIM → 3D Model & Issues** tab. To eliminate repeated multi-second downloads and single-threaded WASM tessellation across tab switches, navigation, and page reloads, IFC-to-Fragment conversion runs in a disposable Web Worker backed by a two-tier browser cache.

```text
  projects.bim_file URL (/api/files/<immutable-id>)
              |
              v  normalizeFileUrlForSameOrigin -> { fetchUrl, cacheKey = pathname }
  +------------------------------------------------------------------------------------+
  |  Effect.all (concurrency: unbounded — parallel boot!)                              |
  |                                                                                    |
  |  Branch A: Runtime Boot                     Branch B: resolveFragmentBytes         |
  |  - Cached CDN ESM imports:                  1. Check L1 In-Memory LRU Map          |
  |    @thatopen/components@3.4.6                  (MEMORY_CACHE_LIMIT = 4 entries)    |
  |    @thatopen/components-front@3.4.3            -> HIT: refresh LRU order, return   |
  |    @thatopen/fragments@3.4.6                2. Check L2 Browser CacheStorage       |
  |    three@0.185.1                               ('norbital-ifc-fragments-v1')       |
  |  - SimpleScene + SimpleRenderer +              -> HIT: promote to L1, return       |
  |    SimpleCamera + FragmentsManager          3. MISS: fetchEffect(120s timeout)     |
  |    + Fragments worker init                     + assertIfcBodyNotHtml guard        |
  |  - AcquireRelease scope disposes            4. convertIfcToFragments (60s timeout) |
  |    scene & WebGL context cleanly               - Blob-URL Worker (iframe-safe):    |
  |                                                  norbital-ifc-converter            |
  |                                                - web-ifc@0.0.77 WASM single-thread |
  |                                                - FRAGS.IfcImporter.process(bytes)  |
  |                                                - Transfer .frag ArrayBuffer back   |
  |                                                - IMMEDIATELY worker.terminate()    |
  |                                                  to reclaim WASM heap memory!      |
  |                                             5. Write .frag bytes to L1 + L2 cache  |
  +---------------------------+------------------------------------+-------------------+
                              |                                    |
                              +-----------------+------------------+
                                                v
                       loadFragmentsIntoRuntime (120s timeout, uninterruptible)
                       - fragments.core.load(fragmentBytes) -> compute ModelBounds
                       - tuneCameraControls (dollyToCursor, infinityDolly, min 0.4m)
                       - framePreset('iso') + applyClippingPlanes + scheduleMarkerVisualization
```

### Interactive 3D Controls & Issue/4D Integration

- **Navigation Modes:**
  - `orbit` (default): Left-drag rotates, `Shift` + drag (or right-drag) pans, scroll dollies to cursor, `Cmd/Ctrl` + click inspects an element.
  - `pan`: Left-drag (or 1-finger touch) trucks/pans camera, `Cmd/Ctrl` + click inspects.
  - `inspect`: Left-click (`<= 5px` pointer drag threshold) runs `OBF.Highlighter` selection + `OBC.Raycasters` raycast to record exact 3D coordinates `(x, y, z)` and camera eye `(camera_x, camera_y, camera_z)` into a `bim_pin` candidate.
- **Camera Presets & Keyboard Shortcuts:** Toolbar presets (`Iso`, `Top`, `Front`, `Side`), Zoom In/Out, Fit Model (`R`), Lock/Unlock navigation, and canvas keyboard navigation (`W/S` or `ArrowUp/Down` dolly; `A/D` or `ArrowLeft/Right` horizontal truck; `Q/E` vertical truck; `Esc` clear selection).
- **3D Section Planes:** Three independent `create_slider` axes (`cutY` Elevation, `cutX` East–West, `cutZ` North–South from `0%` to `100%`) dynamically construct Three.js `Plane` clipping cuts against `modelBounds` with a `+0.05` pad and one-click Reset.
- **Semantic Highlights & Issue Isolation:** Open pinned issues group into three semantic severity highlight layers (`critical`, `high`, `medium/low`) plus an optional 4D active-on-date highlight layer pushed from `ProjectTimeline.svelte`. Selecting a pinned issue row in the register isolates its `express_id` (`OBC.Hider.isolate`; every other element hidden), highlights it in destructive tone, and animates `controls.setLookAt(camera_x, camera_y, camera_z, x, y, z)`; selecting the row again or **Show whole model** restores every element. Opening the issue record is the row's **Open issue** action.

---

## 6. Catalog-Wired Pricing, 3-Way Matching & Commercial Cashflow Ledger

All commercial amounts and quantities use Effect `BigDecimal` (`src/lib/commercial.ts`) with `half-from-zero` rounding (scale 2 for money, scale 3 for quantities, scale 1 for percentages). **Free-text money lines are prohibited** across commercial records: every line item in `contracts` and `commercial_documents` and every row in `adhoc_costs` must resolve against `item_matrix` (and optionally a non-void project `cost_estimates.bim_assets` bucket).

```text
  +-----------------------------+          +-----------------------------------+
  |  item_matrix (active=true)  |          |  cost_estimates (status != void)  |
  |  - category: bim_asset      |          |  - bim_assets[] (matched buckets  |
  |  - category: additional_cost|          |    with matrix_code, storey, qty, |
  +--------------+--------------+          |    unit_rate, sample_express_ids) |
                 |                         +-----------------+-----------------+
                 +---------------------+---------------------+
                                       |
         +-----------------------------+-----------------------------+
         |                                                           |
         v  CatalogLinesEditor.svelte + resolveCatalogLines()        v  adhoc_costs transform
  Picker priority:                                            Mandatory catalog_item_id
   1. Linked Parent Contract / PO lines (1-click Copy)        (on_delete: restrict)
   2. Project BIM Takeoff Assets (storey + expressIDs)        - Refuses if !active or
   3. BIM Asset Catalog (item_matrix)                           category != 'additional_cost'
   4. Ad-hoc Cost Catalog (item_matrix)                       - Locks currency & unit to catalog
                                                              - Defaults unit_rate from catalog
  Server validation (contracts & commercial_documents):       - amount = round(qty * rate, 2)
   - Query item_matrix + cost_estimates (as_of: 'act')        - status -> incurred stamps date
   - Unknown code -> refuse errors.line_requires_catalog
   - Canonicalizes source, unit, description, storey,
     bim_asset_key, bim_express_ids
   - Line amount = round(qty * unit_rate, 2)
         |
         +---------------------------+-------------------------------+
         |                           |                               |
         v                           v                               v
  [contracts]               [commercial_documents]          [adhoc_costs]
  Client (upstream)         PO / DO / Invoice / Claim /     Preliminaries, Craneage,
  Sub/supply (downstream)   Credit Note                     Permits, Testing, Overheads
  VO (parent_contract_id)     - subtotal = sum(lines) or     - draft -> approved -> incurred
  - If lines present:           manual subtotal
    contract_value =          - tax = round(sub * tax%/100)
      sum(line.amount)        - total = subtotal + tax
    (manual override in       - net = (certified ?? total)
     draft refused!)                  - retention
                              - due_date = issue_date +
                                (contract.terms ?? partner.terms; else none)
                              - 3-Way Match (when parent_document_id set):
                                cumulative = sum(non-cancelled same-type
                                             siblings) + this.total_amount
                                * cumulative > parent_total  -> 'variance'
                                * cumulative == parent_total -> 'matched'
                                * cumulative < parent_total  -> 'partial'
```

### Three Pure Commercial Engines (`src/lib/commercial.ts`)

1. **Contract Valuation & Progress Claim RPC (`computeProjectCommercial` + `generate_payment_claim`):**
   - Aggregates active/completed contracts into `original_contract_sum` (upstream non-VO contracts), `upstream_variations`, `revised_contract_sum = original + upstream_VOs`, `committed_downstream = downstream_base + downstream_VOs`, `projected_margin = revised - committed_downstream`, and `projected_margin_pct`.
   - Averages `progress_pct` across all non-cancelled `tasks` -> `overall_progress_pct`.
   - Computes `gross_work_done = revised_contract_sum * overall_progress_pct%`, `raw_retention = gross_work_done * retention_rate%`, `retention_held = min(raw_retention, revised_contract_sum * retention_cap_rate%)` (when cap > 0), with retention and tax rates taken from the client contract (`clientContractOf`: the first active or completed upstream non-VO contract), and `net_cumulative_value = gross_work_done - retention_held`.
   - Subtracts prior non-cancelled/non-disputed inflow `progress_claim` and `invoice` rows (`certified_amount` for certified/paid, `total_amount` for issued/verified) -> `net_claimable_now = max(0, net_cumulative_value - previous_valued)`.
   - `generate_payment_claim` (`mode: 'call'`) inserts a draft inflow `progress_claim` with `subtotal = net_claimable_now` and that contract's `tax_rate`, linked to that same client contract; without one it refuses `errors.claim_needs_main_contract`.

2. **Realized & Projected Cashflow (`computeProjectCashflow`):**
   - Excludes `cancelled` documents. Tracks non-draft outflow `purchase_order` separately as `po_committed_outflow`, skips `delivery_order` so POs/DOs never double-count billed cashflow.
   - Negates `credit_note` amounts (`-|effective|`), buckets monthly cashflow by `paid_date ?? due_date ?? issue_date`, and tracks `received_inflow`, `pending_inflow`, `paid_outflow`, `pending_outflow`, `net_realized_cashflow`, `net_projected_cashflow`, `overdue_receivables`, and `overdue_payables` (`due_date < today`).

3. **Catalog Cashflow & Budget Ledger (`computeCatalogCashflowBreakdown`):**
   - Reconciles every catalog code across four sources inside **Project Hub → Finance → Cashflow & Budget**:
     - `estimated_budget`: Matched non-void `cost_estimates.bim_assets` + non-cancelled `adhoc_costs`.
     - `so_value`: Active/completed upstream contract lines.
     - `po_committed`: Active/completed downstream contract lines + `approved` `adhoc_costs`.
     - `delivered_value`: Non-cancelled `delivery_order` lines.
     - `invoiced_outflow`: Non-cancelled outflow `invoice` / negated `credit_note` lines + `incurred` `adhoc_costs`.
     - `paid_outflow`: `paid` outflow `invoice` / negated `credit_note` lines + `incurred` `adhoc_costs`.
     - `budget_variance`: `estimated_budget - po_committed`.
     - `net`: `so_value - po_committed`.
   - Column labels state the side: `so_value` is money in from the client; budget, commitments, deliveries, billed and paid are money out to subcontractors, suppliers and ad-hoc costs; `net` is in less committed out.

---

## 7. Multi-Channel WhatsApp/Email Intake, Routing & AI Extraction

Unstructured WhatsApp messages, voice notes, site photos, and emails flow through a 3-stage idempotent pipeline (`sync_messages` -> `classify_messages` -> `extract_project_updates`) with automatic replay (`reclassify_messages`) whenever contacts or personal intake rules change.

```text
  WhatsApp / Email Connections (sys_integration, import_start: all | since | native)
         |
         v  Trigger: sys_message.create OR cron */15 (safety net) OR manual
  +------------------------------------------------------------------------------------+
  | 1. sync_messages (concurrency: 1, batch <= 25)                                     |
  |  - Binary search on sys_message.seq vs filed project_messages.source_seq counts    |
  |    to skip already-synced history in O(log N) queries                              |
  |  - Fair lane mixing (selectBatch): mixes newest per provider + oldest unfiled      |
  |  - Enforces per-connection import_start window (also validated in model transform) |
  |  - Deduplicates via UQ (source_message) + skipRacedWrite                           |
  |  - Attachments <= 20 MiB copied; audio-only voice notes -> ctx.convert.ingest()    |
  |    (diarize: false) -> writes transcript to detail, sets transcription status      |
  |  - Schedules classify_messages (and self-requeues if batch saturated)              |
  +-----------------------------------------+------------------------------------------+
                                            |
                                            v  Trigger: cron */5 OR scheduled
  +------------------------------------------------------------------------------------+
  | 2. classify_messages (concurrency: 1, limit 50, retry backoff: 5 min)              |
  |  - Loads communication_settings per source_user + group participant handles        |
  |  - Normalizes handles (handleKey: lowercase email / >=6-digit phone; ignores       |
  |    @g.us / @lid) and matches contacts via computed email_key / phone_key           |
  |  - Hard filter: if owner hard_filter == 'known_contacts' & unknown -> 'ignored'    |
  |  - Deterministic fallback (evidentProject): unique project_number/name substring   |
  |    match -> partner's one project (live contracts, client_id) -> sole active       |
  |    project                                                                         |
  |  - Jev System 1 (ctx.ai.sys_1.decide): relevance + project + certainty             |
  |    * Confident iff relevance.conf >= 0.80 & certainty.conf >= 0.80 &               |
  |      certainty.level == 'Clear direct evidence'                                    |
  |    * Useful + picked project -> classification='useful', project_id=picked         |
  |    * Ignored + confident     -> classification='ignored'                           |
  |    * Otherwise fallback to evidentProject ('hard_filter') or 'review'              |
  |  - If useful & auto_extract (default true): sets extraction_status = 'pending'     |
  +-----------------------------------------+------------------------------------------+
                                            |  project_messages.create/update effect
                                            |  (also triggers on manual project assign!)
                                            v
  +------------------------------------------------------------------------------------+
  | 3. extract_project_updates (concurrency: 1, limit 15)                              |
  |  - Sends bounded JSON context (project zones, open tasks, active contracts) +      |
  |    readable PDF/image/text attachments to Jev System 2 (ctx.ai.sys_2.infer)        |
  |  - Resolves valid task_id, contract_id, and project zone codes                     |
  |  - Atomic ctx.act creates/updates:                                                 |
  |      * tasks.update (progress_pct clamped 0..100, status, latest_update)           |
  |      * tasks.create (fallback code MSG-<id>-<seq>)                                 |
  |      * issues.create (attaches JPEG/PNG/WebP site photos when attach_photos!=false)|
  |      * contracts.create (draft variation_order with EOT days & attachments)        |
  |      * commercial_documents.create (draft PO/DO/Invoice/Claim/Credit Note)         |
  |      * project_messages.update (extraction_status='extracted'|'none', summary)     |
  +------------------------------------------------------------------------------------+

  Replay triggers (reclassify_messages, concurrency: 1, up to 100 rows):
   - contacts.create or contacts.update (phone/email changed) -> resets
     non-manual 'review'|'ignored' messages to 'pending' and queues classify_messages.
   - communication_settings.create or update (hard_filter/classification_sop changed) ->
     scoped replay for that owner.

  Morning Exception Digest (daily_project_digest, cron: 0 6 * * * Asia/Singapore):
   - Runs 4 SQL aggregate count queries: critical/high open issues, blocked or past-due
     open tasks, draft/under_review contracts, and overdue open commercial_documents.
   - If total > 0, publishes deduplicated notification (once: construction-digest:<today>)
     to project_delivery, commercial_qs, and construction_administrators.
```

---

## 8. Programme Scheduling, Autodesk ACC Sync & 4D BIM Bridge

Programme tasks nest by breakdown code (`tasks.wbs_path`: `3.1.2` sits under `3.1`, which sits under `3`; `task_code` is the source schedule's activity ID, unique per project) fed by three ingestion paths and rendered across a unified **Programme & Tasks** view (`Timeline` | `Table` | `Board` icon-only switcher).

```text
  [External Schedule & Sheet Sources]
   |- Primavera P6 (.xer) - parsePrimaveraXer (%T PROJWBS + %T TASK, <=4MiB) -+
   |- MS Project (.xml)   - parseMsProjectXml (<Task>, skip Summary=1,<=4MiB)-+-> schedule_file
   |- Spreadsheets        - XLSX / CSV ---------------------------------------+   (file sync)
   |
   |- Autodesk ACC / APS (integration: autodesk_acc, OAuth 2.0, 10 req/s)
        |- tasks.syncs.autodesk_schedule (every 30min, cursor=updatedSince)
        |    GET   /construction/schedule/v1/projects/{id}/activities -> upsert tasks
        |    PATCH /construction/schedule/v1/projects/{id}/activities/{id} (If-Match)
        |          pushes percentComplete, actualStart, actualFinish back to ACC
        |
        |- project_files.syncs.autodesk_files (every 1h, cursor=updatedSince)
             GET   /construction/sheets/v1/projects/{id}/sheets -> upsert project_files
                   (.rvt/.ifc/kind=model -> 'autodesk_model', else 'drawing')
             PATCH /construction/sheets/v1/projects/{id}/sheets/{id} -> pushes title updates
                                            |
                                            v
  [ProjectTimeline.svelte — High-Density 4D Planner (tasks only, no VOs)]
   - Isolated tasksQuery (limit 2000, separate from commercialQuery) for snappy updates
   - Four grouping modes: Breakdown | Subcontractor | Trade | Zone + Expand/Collapse all
   - Five instant client filters: All | Blocked | Behind | Updated | Milestones
   - Cycle-safe computeRollup(): rolls up earliest start, latest finish, average child %
   - Virtualized via virtual_list (30px compact single-line rows, threshold: 25, overscan: 12)
   - Single shared month/today/scrubber vertical gridline overlay (O(1) DOM at 1,000+ rows)
   - Inline 4D date scrubber (create_slider + register_control 'construction:programme-timeline')
     * Marks behind when (plannedPctAt(date) - actualPct) >= 15 & status != 'done'
     * Collects bim_express_ids[] of all tasks active on scrubDate
   - Companion views: Table (page_size 100, compact progress/update cells) & Board (4 cols, 50/lane)
     * "Highlight N in BIM" pushes timelineBimHighlight -> 3D Viewer 'Active on <date>' group
```

---

## 9. Access Control & Authority Matrix

Teams live as source declarations in `src/access_control/team/+team.ts`; policies live under `src/access_control/policy/`. `construction_read` sets the workspace rate limit (`act: 600/min`, `read: 600/min`, `agent: 100/h`).

```text
TEAM -> POLICY ASSIGNMENT MATRIX (src/access_control/team/+team.ts)
+-----------------------------+----------+----------+------------+-------------+
| Team                        |   read   | delivery | commercial | connections |
+-----------------------------+----------+----------+------------+-------------+
| construction_administrators |    X     |    X     |     X      |      X      |
| project_delivery            |    X     |    X     |     -      |      X      |
| commercial_qs               |    X     |    -     |     X      |      X      |
| client_consultant           |    X     |    -     |     -      |      -      |
+-----------------------------+----------+----------+------------+-------------+

POLICY CAPABILITIES & GRANTS (src/access_control/policy/)
+----------------------------------------------------------------------------------------------+
| construction_read                                                                            |
|  Apps: [operations] | Rate limit: act 600/min, read 600/min, agent 100/h                     |
|  Read (default output): all 11 operational models + sys_user                                 |
+----------------------------------------------------------------------------------------------+
| construction_delivery                                                                        |
|  Create/Update (all moves): projects, tasks, issues, project_messages | CRUD: contacts       |
|  project_files: Create + Update (10 fields, all moves)                                       |
|  cost_estimates: Update status -> void ONLY (draft|reviewed|baselined -> void on BIM swap)   |
|  Automations: sync_messages, classify_messages, extract_project_updates,                     |
|               reclassify_messages, analyze_bim_file, sweep_bim_costing                       |
|  Syncs: tasks.autodesk_schedule, project_files.autodesk_files                                |
+----------------------------------------------------------------------------------------------+
| construction_commercial                                                                      |
|  projects: Update currency only (contract terms live on contracts)                           |
|  Create/Update (all moves): contracts, commercial_documents, cost_estimates                  |
|  CRUD: adhoc_costs, item_matrix | Create/Update: contacts                                    |
|  Automations: generate_payment_claim, analyze_bim_file, sweep_bim_costing                    |
+----------------------------------------------------------------------------------------------+
| construction_connections                                                                     |
|  Apps: [configuration]                                                                       |
|  sys_integration: OWN personal whatsapp/email only (custom verdict: owner==me & personal)    |
|  communication_settings: OWN rows only (custom verdict + transform enforce owner == me)      |
+----------------------------------------------------------------------------------------------+
| construction_automation (system-only; bound to all 8 automations & both Autodesk ACC syncs)  |
|  projects: read + update ['bim_summary', 'bim_costing_dirty']                                |
|  contracts, commercial_documents, tasks, issues, project_files, cost_estimates: R/C/U (all)  |
|  project_messages: R/C/U | adhoc_costs, item_matrix, contacts, comm_settings, sys_*: read    |
+----------------------------------------------------------------------------------------------+
```

### Key Governance Details

- **Client & Consultant Isolation (`client_consultant`):** Receives only `construction_read` — read-only access to the Operations app with zero write grants, zero Configuration app access, and zero visibility into `sys_integration` or `communication_settings`.
- **Delivery vs. Commercial Separation:** `project_delivery` cannot create or modify contracts, commercial documents, ad-hoc costs, or item matrix rates, and on `cost_estimates` may **only** transition `status -> void` so updating `projects.bim_file` can safely execute the voiding side effect. Conversely, `commercial_qs` may only edit `currency` on `projects` (contract terms live on `contracts`) and cannot edit WBS tasks, BIM files, or site issues.
- **Personal Account Ownership (`construction_connections`):** Both policy verdicts and model transforms enforce that members can only create, edit, or delete their own `whatsapp` or `email` `sys_integration` accounts (`errors.personal_accounts_only`) and their own `communication_settings` row (`errors.intake_not_own`), while workspace-shared connections (`owner: null`, including `autodesk_acc`) are created by administrators.
