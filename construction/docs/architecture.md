# Construction Operations — Architecture & Inner Mechanisms

Technical deep dive into the `norbital-construction` Bolt workspace (`templates/construction`). Every model, field, constraint, state transition, calculation formula, client worker, cache layer, automation, sync, and access-control rule below reflects the live implementation under `src/`.

## Table of Contents

1. [System Topology & Runtime Architecture](#1-system-topology--runtime-architecture)
2. [Data Model & Ownership ER Diagram](#2-data-model--ownership-er-diagram)
3. [State Machines, Write Locks & Side Effects](#3-state-machines-write-locks--side-effects)
4. [Single-Model BIM Lifecycle, Browser Takeoff & Visual AI Costing](#4-single-model-bim-lifecycle-browser-takeoff--visual-ai-costing)
5. [Client-Side 3D IFC Viewer & Two-Tier Fragment Cache](#5-client-side-3d-ifc-viewer--two-tier-fragment-cache)
6. [Catalog-Wired Pricing, 3-Way Matching & Commercial Cashflow Ledger](#6-catalog-wired-pricing-3-way-matching--commercial-cashflow-ledger)
7. [WhatsApp/Email Intake Filed on Arrival](#7-whatsappemail-intake-filed-on-arrival)
8. [Programme Scheduling, Autodesk ACC Sync & 4D BIM Bridge](#8-programme-scheduling-autodesk-acc-sync--4d-bim-bridge)
9. [Access Control & Authority Matrix](#9-access-control--authority-matrix)

---

## 1. System Topology & Runtime Architecture

The workspace runs on `@norbital-ai/bolt` (`Asia/Singapore`, `en-SG`, `SGD` default currency, bilingual `en` / `zh`, PDF conversion enabled) and splits cleanly into two runtime sides:

- **Browser client (Svelte 5 + `@norbital-ai/ui` + Web Workers + WebGL):** Hosts the two apps (`operations`, `configuration`), the thin Project Hub shell (`projects/+representation.svelte`) composed from co-located tab components (`ProjectProgrammeTab.svelte`, `ProjectBimTab.svelte`, `ProjectFinanceTab.svelte`, `ProjectSustainabilityTab.svelte`, `ProjectComplianceTab.svelte`, `BimPrepareStep.svelte`, `BimAssetReview.svelte`, `BimItemMatrixReview.svelte`), the Linear-inspired unified Task workspace (`tasks/+representation.svelte` via intrinsic `<Split ratio="wide">` + `create_clipboard`), the always-live debounced auto-save inline-editable BOQ renderer (`bim_takeoff/+renderer.svelte`), the A4 PDF report previewer/template engine (`src/services/reports/*`), the 4D virtualized WBS timeline (`ProjectTimeline.svelte`), the catalog-only line editor (`CatalogLinesEditor.svelte`), and the modular 3D/takeoff service stack under `src/services/viewer/` (`IfcViewer.svelte`, `engine.ts`, `converter.ts`, `converter.worker.ts`, `takeoff.ts`, `takeoff.worker.ts`, `geometry-pass.ts`). Large binaries (`web-ifc@0.0.77`, `three@0.185.1`, `@thatopen/*`) load from pinned CDN URLs at runtime so the workspace release stays lightweight.
- **Bolt server & guest engine (Effect v4):** Owns 17 record models (including `sustainability_logs`, `compliance_records`, `report_templates`, runtime-configurable `bim_settings`, and dynamic `sop_rules`), 4 co-located custom fields, 4 syncs, 4 automations, 1 custom OAuth 2.0 integration (`autodesk_acc`), 4 seeded teams, 5 policies, and clean domain services under `src/services/commercial/` (`decimal.ts`, `lines.ts`, `analytics.ts`), `src/services/bim/` (`schema.ts`, `config.ts`, `step-parser.ts`, `geometry.ts`, `cleanup.ts`, `pricing.ts`, `compliance.ts`, `remediation.ts`, `organizer.ts`, `classifier.ts`), and `src/services/reports/` (`template-validation.ts`, `report-document.ts`, `report-pdf.ts`, `ReportPdfViewer.svelte`, `ReportPreviewDialog.svelte`).

```text
+----------------------------------------------------------------------------------------------+
|                                     BROWSER CLIENT                                           |
|                                                                                              |
|  [Operations App]                         [Configuration App]                                |
|   |- Projects -> Project Hub (7 tabs)      |- Item Matrix (+matrix.sync.ts XLSX/CSV)         |
|   |   |- Record (Project, Sustain./Comp.,  |- BIM Compliance (Compliance Rules +             |
|   |   |   Site)                            |   Takeoff & Cleanup Profile)                    |
|   |   |- Programme & Tasks (Timeline |     |- Report Templates (EN/ZH HTML layouts for       |
|   |   |   Table | Board icon toggle)       |   Sustainability & Compliance A4 PDF reports)   |
|   |   |   (task: Record | Activity)        |   (Personal WA/Email & classifier rules live    |
|   |   |- BIM [keep_alive] (2 sub-tabs)     |   in Bolt's /connections; shared WA/Email/ACC   |
|   |   |   |- 3D Model & Tasks (IFC upload, |   in Settings -> Integrations -> Connections)   |
|   |   |   |   IfcViewer w/ proportional zoom & Asset Visibility + BIM tasks table)           |
|   |   |   |- BIM Costing (compact KPI header + debounced auto-save BOQ table +               |
|   |   |       tunneled 3-step BIM process: Parse -> Review Proposals & Lints -> Generate)    |
|   |   |- Finance                                                                             |
|   |   |   |- Overview (KPI strip + net-amount chart)                                         |
|   |   |   |- Cashflow & Budget ledger                                                        |
|   |   |   |- Client contracts / Subcontracts & supply -> nested VOs, Transactions & Activity |
|   |   |   |- Ad-hoc Costs (catalog-backed)                                                   |
|   |   |- Sustainability (3 sub-tabs + PDF export)                                            |
|   |   |   |- Overview (WLC carbon KPIs, typology baseline, site emissions, chart + PDF)      |
|   |   |   |- Carbon by item (computeProjectCarbon + stage/EPD/recycled %)                    |
|   |   |   |- Site logs (sustainability_logs energy/diesel/transport/water/waste ledger)      |
|   |   |- Compliance (2 sub-tabs + PDF export)                                                |
|   |   |   |- Overview & BIM Lints (statutory KPIs, authority-filtered lints + 3D + PDF)      |
|   |   |   |- Audits & IMS Register (compliance_records CONQUAS/CORENET X/ISO register)       |
|   |   |- Documents (project_files register)                                                  |
|   |- Projects page: Messages to file tab (only while review messages lack a project)         |
|   |- Business Partners (All | Customers | Vendors | Subcontractors; each has Activity tab)   |
|                                                                                              |
|  [Browser Workers & Cache]                                                                   |
|   |- norbital-ifc-converter Worker (web-ifc WASM -> .frag) <-> L1 LRU(4) + L2 CacheStorage   |
|   |- norbital-ifc-takeoff Worker (4 MiB STEP stream, an assembly counts once) ->             |
|   |    geometry pass (measure, drop doubles, merge, sign, 4-angle pictures) -> stored        |
|   |    bim_takeoff + bim_takeoff_views                                                       |
+---------------------------------------------+------------------------------------------------+
                                              | PageBolt queries, ctx.act, ctx.run, ctx.upload
                                              v
+----------------------------------------------------------------------------------------------+
|                              BOLT SERVER / GUEST ENGINE (Effect v4)                          |
|                                                                                              |
|  [17 Models + Write Transforms/Effects]        [4 Automations (construction_automation)]     |
|   projects (root) -> 8 owned children:          |- sync_messages (sys_message create)        |
|     cost_estimates (1:1), contracts,            |- file_project_messages (project_messages   |
|     commercial_documents, adhoc_costs,          |   effect + sys_integration update replay)  |
|     tasks, project_files, sustainability_logs,  |- analyze_bim_file (projects write/manual)  |
|     compliance_records                          |- generate_payment_claim (mode: 'call' RPC) |
|   Top-level (8): activities (polymorphic about),                                             |
|     contacts, project_messages, item_matrix,    [Message Filing (file_project_messages)]     |
|     bim_settings, sop_rules, asset_mappings,    transcribe -> 30-msg windowed classifier ->  |
|     report_templates                            batched System Agent (sys_2.task + fallback) |
|  [Domain Services (src/services/)]                                                           |
|   commercial/{decimal,lines,analytics}.ts       [4 Syncs]                                    |
|   bim/{schema,config,step-parser,geometry,      |- tasks.schedule_file (.xer/.xml/.csv/.xlsx)|
|     cleanup,pricing,compliance,remediation,     |- tasks.autodesk_schedule (30min 2-way)     |
|     organizer,classifier}.ts; reports/*;        |- project_files.autodesk_files (1h 2-way)   |
|   viewer/*; ui/*                                |- item_matrix.matrix (.xlsx/.csv)           |
|  [Access Control]                                                                            |
|   4 Teams -> 5 Policies (rate: 600/min)                                                      |
+----------------------+-----------------------+-----------------------+-----------------------+
                       |                       |                       |
                       v                       v                       v
           +--------------------+   +---------------------+   +------------------------+
           |   Host Facilities  |   |  AI & Media Engine  |   |   External Systems     |
           |  - PGlite / PG DB  |   |  - ctx.ai.sys_1     |   |  - WhatsApp (built-in) |
           |  - File Store      |   |    (Visual & Route) |   |  - Email (built-in)    |
           |  - Notifications   |   |  - ctx.ai.sys_2     |   |  - Autodesk ACC / APS  |
           |  - Cron / Queue    |   |    (Extract/Propose)|   |    (OAuth 2.0, 10/s)   |
           |  - Sealed Secrets  |   |  - convert.ingest   |   |  - P6 .xer / MSP .xml  |
           +--------------------+   |    (Voice STT)      |   +------------------------+
                                    +---------------------+
```

---

## 2. Data Model & Ownership ER Diagram

All 17 models live under `src/data/model/`. `projects` is the primary aggregate root with 8 owned children (`owned: true`, cascade delete: `cost_estimates`, `contracts`, `commercial_documents`, `adhoc_costs`, `tasks`, `project_files`, `sustainability_logs`, `compliance_records`), and top-level `activities` attaches polymorphically (`about`: `projects | tasks | contracts | contacts`, `on_delete: 'cascade'`) with an auto-derived `project_id` roll-up so a project's **Activity** tab surfaces activity across the project, its tasks, and its contracts. Top-level `report_templates` holds versioned EN/ZH HTML print layouts (`draft -> published`, locked on publish) for Sustainability and Compliance PDF reports. A task's `description` is Markdown edited in a borderless, full-height, auto-focused Linear-style `RichMarkdownEditor` (`images: 'attachments'`, floating bubble menu + `/` slash commands, no static toolbar). Cross-entity operational references use `on_delete: 'set_null'`, except `adhoc_costs.catalog_item_id -> item_matrix`, which uses `on_delete: 'restrict'` so catalog items backing recorded project costs cannot be deleted. `asset_mappings` remembers what each unique BIM asset is priced as across takeoffs and projects; `cost_estimates.asset_signatures` names the rows an estimate priced.

```text
                       +-------------------------------------------+
                       |                 projects                  |
                       | PK id | UQ project_number | project_role  |
                       | status, currency, schedule_range          |
                       | client_id -> contacts (set_null)          |
                       | project_manager -> sys_user               |
                       | autodesk_project_id                       |
                       | bim_file (<=250MiB), bim_version,         |
                       | bim_takeoff (<=16MiB), bim_takeoff_views  |
                       | bim_costing_dirty, bim_summary,           |
                       | bim_compliance (json), zones, location    |
                       | address, gfa_m2, building_typology,       |
                       | green_mark_target, bca_project_ref,       |
                       | submission_gateway, qualified_person,     |
                       | bim_manager, bep_version, conquas_band_*  |
                       | Counts: open_task, active_contract,       |
                       |         open_document                     |
                       +---+---------------+-------+-------+-------+
                           |               |       |       |
       +-------------------+               |       |       +-------------------+
       | owned (1:1 UQ)                    | owned | owned                     | owned
       v                                   |       v                           v
+-------------------------+                | +-------------------------+ +---------------------+
|     cost_estimates      |                | |     project_files       | |        tasks        |
| UQ (project_id)         |                | | UQ (project_id,doc_no)  | | UQ (proj,task_code) |
| SEQ EST-yyyy-000        |                | | kind: drawing|spec|     | | kind: bim | adhoc,  |
| status: draft|reviewed| |                | |  schedule|contract_doc  | | wbs_path, ext_id,   |
|         baselined|void  |                | |  handover|autodesk_mdl  | | is_milestone, zone*,|
| bim_assets [bim_takeoff]|                | | current_version, file,  | | trade, status,      |
| bim_subtotal,           |                | | discipline, status,     | | baseline/schedule/  |
| contingency_pct/amount, |                | | autodesk_urn, zone*     | | actual_range,       |
| total_estimate          |                | +-------------------------+ | progress_pct,       |
| analyzed_at, notes      |                |                             | bim_express_ids[],  |
+-------------------------+                |                             | contract, subcon,   |
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
                                                                                         |
  +----------------------------------------+   +-------------------------------------+   |
  |      sustainability_logs (owned)       |   |     compliance_records (owned)      |   |
  | project_id -> projects (cascade)       |   | SEQ CMP-yyyy-000 | project_id       |   |
  | reporting_period, electricity_kwh,     |   | recorded_on, standard (6 enums),    |   |
  | diesel_litres, transport_tco2e,        |   | category (6 enums), clause_ref,     |   |
  | water_m3, newater_m3, waste_*_t, notes |   | title, severity, status, owner,     |   |
  +----------------------------------------+   | metric_value, corrective_action     |   |
                                               +-------------------------------------+   |
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
+-------------------------+ | source_message->sys_msg | | carbon_factor, rate_basis,       |
                            | source_user->sys_user   | | derived: derived_from, ratio,    |
+-------------------------+ |       activities        | |          asset_mappings          |
|       sop_rules         | | about -> projects|tasks | | UQ (signature) [import_key]      |
| authority, scope, metric| |   |contracts|contacts   | | label, ifc_class, picture,       |
| threshold, active       | |   (on_delete: cascade)  | | source: system_1 | qs | proposal,|
+-------------------------+ | project_id -> projects  | | confidence, note, continuity,    |
|       bim_settings      | | title, description,     | | service, size_mm, review_status  |
| UQ (key='default')      | | occurred_at,            | +----------------------------------+
+-------------------------+ | attachments[], author,  |
|    report_templates     | | source_message_id       |
| kind (sustainability |  | +-------------------------+
|   compliance_report),   |
| locale (en|zh), version,|
| title, standard_ref,    |
| body, print_layout,     |
| letterhead, stamp,      |
| status (draft|published)|
+-------------------------+

* zone validated in batch against projects.zones[].code (as_of:'act') when the parent project
  defines zones.
```

### Co-Located Custom Fields (4)

| Custom Field    | Used By                                         | Shape & Validation                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bim_takeoff`   | `cost_estimates.bim_assets`                     | Array of classified/unmatched takeoff buckets (`asset_key`, `ifc_class`, `classification`, `discipline`, `storey`, `element_count`, `measured_qty`, `unit`, `quantity_basis`, `matrix_code`, `unit_rate`, `waste_factor_pct`, `priced_qty`, `amount`, `carbon_factor`, `carbon`, `status`, `match_method`, `match_confidence`, `match_reason`, `sample_express_ids`). Validates non-empty `classification` and valid `BigDecimal` strings. |
| `bim_pin`       | `contracts.bim_pin`                             | Single 3D element anchor (`express_id`, `element_name`, `global_id`, `x/y/z`, `camera_x/y/z`).                                                                                                                                                                                                                                                                                                                                             |
| `priced_lines`  | `contracts.lines`, `commercial_documents.lines` | Array of catalog/BIM-backed lines (`source`: `bim_asset` \| `adhoc_catalog`, `code`, `bim_asset_key`, `storey`, `bim_express_ids`, `description`, `unit`, `qty`, `unit_rate`, `amount`). Validates required `code`, `description`, `unit`, and `BigDecimal` `qty`/`unit_rate`.                                                                                                                                                             |
| `project_zones` | `projects.zones`                                | Array of `{ code, name, elevation_m, grid_axis }`. Validates non-empty, unique `code` within the project.                                                                                                                                                                                                                                                                                                                                  |

---

## 3. State Machines, Write Locks & Side Effects

Seven models declare explicit state machines, row locks, or automated write transforms/effects. All constraints execute natively at the database/engine layer; locks allow only explicitly listed `except` fields to mutate once entered.

```text
[1] projects.status (initial: active)
  tendering <---> active <---> on_hold
      |            ^  |           |
      v            |  v           v
   cancelled <-----+  defects_liability <---> complete
      (can return to tendering or active)

  Side effects on bim_file / bim_takeoff write:
  - create (bim_file != null): bim_version ??= 'P01', bim_costing_dirty=true
  - update changing bim_file:  bim_takeoff = bim_takeoff_views = bim_costing_error = null,
                               bim_costing_dirty = (bim_file != null) (history keeps the prior file),
                               effect -> void any non-void cost_estimates for project_id
  - update storing bim_takeoff: bim_costing_dirty = true, bim_costing_error = null
  - any projects create/update triggers analyze_bim_file, which prices a stored takeoff

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

[6] tasks.status (initial: todo)
  todo <---> in_progress <---> blocked
   |  ^        |  ^             |
   |  |        v  |             |
   |  |       done              |
   v  |                         v
  cancelled <-------------------+
  - entering in_progress (no actual_range): sets actual_range = { from: ctx.today, to: null }
  - entering done: sets progress_pct = '100', closes actual_range.to = ctx.today
  - changing progress_pct: auto-stamps last_updated_on = ctx.today
  - remote sync actor bypasses auto-stamping transforms
  - activities: polymorphic log (`about` -> projects | tasks | contracts | contacts) with
    auto-derived `project_id`, `title`, plain-text `description`, `occurred_at`, optional
    `attachments`, and `author` stamped from the posting member (envoy's member for them;
    none when filed from an incoming message)

[7] project_files.status (initial: draft)
  draft <---> in_review <---> issued ---> superseded ---> archived ---> draft
    |             |             |                            ^
    +-------------+-------------+----------------------------+
  - create/update validates zone against projects.zones; record history keeps earlier versions
```

---

## 4. Single-Model BIM Lifecycle, Browser Takeoff & Visual AI Costing

Each project owns **one** federated BIM model (`projects.bim_file`, up to 250 MiB upload) paired **1:1** with a single `cost_estimates` row (`unique: ['project_id']`). The browser takes the model off; the server never parses IFC. Because contractor IFC files frequently use cryptic or generic proxy labels (`IFCBUILDINGELEMENTPROXY`), classification runs through System 1 (`ctx.ai.sys_1.decide`) with a four-angle picture of each unique asset rather than brittle keyword matching, and each decision is remembered in `asset_mappings` by the asset's signature so the next takeoff (on any project) asks System 1 only about assets it has not seen.

```text
  [Project BIM Model Uploaded or Replaced]
  projects.create / projects.update (bim_file)
         |
         +--> Transform: bim_version ??= P01 on create; a new bim_file clears bim_takeoff,
         |               bim_takeoff_views and bim_costing_error, bim_costing_dirty = true
         +--> Effect:    query cost_estimates(project_id, status != 'void') -> set status='void'
         |
         v  BROWSER TAKEOFF (storeProjectTakeoff, src/services/viewer/takeoff.ts)
  Uploading on BIM -> 3D Model & Tasks (or BIM Costing) takes the file off right away;
  the tunneled 3-step BIM process parses/re-parses a stored model (Step 1), lets the QS
  review proposals, Clean BIM & compliance lints (Step 2), and generates the estimate (Step 3).
         |
         v
  1. src/services/viewer/takeoff.worker.ts (Web Worker)
     - Streams File/URL in 4 MiB slices
     - src/services/bim/step-parser.ts zero-regex scanner skips ~95% geometry lines
     - Keeps 90+ ASSET_CLASSES + spatial/type/material/Pset/Qto graphs -> SI units
     - An assembly counts once, as a whole: an asset whose IfcRelAggregates parent is an
       asset (a stair's flights, a curtain wall's plates and members) is a part, kept in
       `assemblies` only for the geometry pass
     - Deduplicates via computeArchetypeSignature:
       * Typed:   TYPE|cls|typeKey|op|pre|c|lay
       * Untyped: INST|cls|norm|obj|op|pre|c|lay
     - Emits archetypes + [archetype, storey] buckets with every element id
         |
         v
  2. src/services/viewer/geometry-pass.ts (web-ifc@0.0.77 + three@0.185.1, offscreen WebGL, <=250MB)
     - Measures every element from its mesh, an assembly with all its parts (src/services/bim/geometry.ts + cleanup.ts):
         volume = solid volume; extents along the element's own axes
         length = longest extent, area = face of the two longest
         steel (IfcReinforcingBar/Mesh/Tendon or steel/rebar material):
           weight = volume * 7,850 kg/m3
     - dropDuplicates: an element modelled twice (same class family, same shape,
       centred within 5 cm of another) counts once
     - fillFromGeometry: fills a bucket's quantities where the model's own quantity
       sets measured fewer of its elements
     - mergeIdenticalArchetypes: one asset under different names (same material
       families and traits excluding Reference/Name/Mark/Tag/IsExternal, same class,
       predefined and operation type unless one is a generic export class such as a
       proxy; volume and extents within 3 %, at least 1 cm)
     - assetSignature: identity (names left out) + extents to 2 cm, the asset's key
       in asset_mappings
     - Renders each unique asset (<=200) alone from 4 angles into one square
       448x448 JPEG (2 x 2; vision models refuse a long strip):
       (a) Front 3/4 iso   (34deg yaw, 20deg pitch)
       (b) Front elevation (0deg yaw, 4deg pitch)
       (c) Side/rear 3/4   (112deg yaw, 28deg pitch)
       (d) Plan from above (88deg pitch)
     - Fails soft: without WebGL/WASM the takeoff keeps the stream's quantities
         |
         v
  3. Stored on the project (element ids and assembly parts dropped):
     - bim_takeoff:       JSON file, <=16 MiB, no images
     - bim_takeoff_views: one JPEG per unique asset; archetype visual_file = file id
         |
         v  Trigger: projects create/update write (phase: 'prepare'), or manual
            { project_id, phase?: 'prepare' | 'cost' | 'all', contingency_pct? }
            from the tunneled 3-step BIM process inside BIM -> BIM Costing
  4. analyze_bim_file Automation (concurrency: 1, policy: construction_automation)
     - On a write: prepares touched projects with a takeoff that are dirty, have no
       summary/estimate, or a void one, unless bim_costing_error is set (a failed run never
       retries on its own write; a person's retry or a new takeoff clears it)
     - Manual 'cost' run refuses a locked estimate (status not in ['draft', 'void'])
     - Filter active item_matrix items valid on ctx.today matching project.currency & bim_asset
     a. Recall asset_mappings by signature (no AI call, confidence 1):
         source qs + usable item       -> method 'override'
         source proposal + usable item -> method 'ai_sys2'
         source system_1 + usable item -> method 'ai_sys1'
         item awaiting approval        -> unmatched ("awaiting commercial approval")
         source qs, no item            -> unmatched ("Left unpriced by a QS")
         (usable = active, approved, valid today, in the project's currency)
     b. System 1 classifies only the rest, against non-derived items:
         Visual (1 call per pictured asset):
           rankCandidateMatrixRules([arch], rules, 80) -> ctx.ai.sys_1.decide(inline JPEG + attrs)
           Choice = rule.code (confidence >= 0.68) OR 'unknown_unseen_catalog'
         Text (unpictured assets, batches of 15):
           rankCandidateMatrixRules(batch, rules, 80) -> ctx.ai.sys_1.decide(text summary)
         System 1 unavailable -> projects.bim_costing_error = reason, the run refuses
     c. Remember each decision: asset_mappings create/update (source system_1, item_id,
        confidence, note; a new row copies the asset's picture to asset_mappings.picture)
     - Exact BigDecimal Pricing (buildBimCostEstimateFromExtracted):
         measured_qty = measured on the item's basis [len/area/vol/wt] | count
                        (elements without that quantity are not priced; match_reason counts them)
         derived item: measured_qty = ratio * measured_qty of derived_from on each storey,
                       left out on a storey where stands_in_for is modelled
         priced_qty   = measured_qty * (1 + waste_factor_pct / 100)
         amount       = round(priced_qty * unit_rate, scale=2, half-from-zero)
         Group by (rule.code::storey) or (UNMATCHED::archetype_id::storey)
         status: matched (rate>0) | rate_missing (rate==0) | unmatched (no item)
         contingency_amount = round(bim_subtotal * contingency_pct / 100, 2)
         total_estimate     = bim_subtotal + contingency_amount
     - Atomic ctx.act:
         * projects.update:       bim_summary = {...}, bim_compliance = {...},
                                  bim_costing_dirty = false, bim_costing_error = null
         * cost_estimates:        update (void -> draft) or create; bim_assets,
                                  asset_signatures, analyzed_at
     d. System 2 (ctx.ai.sys_2.infer) proposes Item Matrix items for what System 1 found
        nothing for (<= 30 assets, pictures attached, alike assets grouped): each is one
        ctx.act of item_matrix.create (rate_basis 'assumption') + asset_mappings.update
        (item_id, source 'proposal'), held for approval by construction_automation's
        item_matrix create verdict (flow "Item Matrix proposal review": the teams holding
        construction_commercial); once approved it prices those assets from the
        next pricing on
     - Output { priced: cost_estimate ids }
```

Each Item Matrix item prices on its own `quantity_basis` (volume, weight, area, length or count), so a line's quantity is only what the takeoff measured on that basis. A `derived` item prices what the model does not carry (unmodelled rebar, formwork, paint) as `ratio` units per unit of its `derived_from` item, storey by storey. **BIM → BIM Costing** shows the estimate under a compact KPI header over a bounded internal-scroll BOQ table with debounced auto-save inline editing (quantities, waste, rates, contingency), and opens an in-place tunneled 3-step **BIM process** (**1. Parse & Analyze**, **2. Review Proposals & Lints** covering `asset_mappings` QS corrections where choosing `item_id` records `source: 'qs'`, Item Matrix proposals, compliance lints via `src/services/bim/remediation.ts`, and cleaned `.ifc` download, and **3. Generate Cost Estimate**).

### Candidate Ranking Scoring (`rankCandidateMatrixRules`)

Active currency-matched, non-derived `bim_asset` rules in `item_matrix` are scored per batch (capped at `bim_settings.max_candidates`, default 80) before passing choices to System 1 (`<= 255` choice limit):

- `+50` for an exact canonical IFC class match (`+35` for legacy `original_ifc_class`; `-25` mismatch penalty for non-proxy rules whose `ifc_classes` exclude the archetype).
- `+32` when `rule.system_services` matches the archetype's resolved MEP/trade service (`-28` on explicit service conflict).
- `+22` when `arch.nominal_size_mm` falls inside `[rule.min_size_mm, rule.max_size_mm]` (`-22` when outside).
- `+12` / `-14` for `rule.insulated` alignment (`insulated` vs `uninsulated`).
- `+12` / `-10` for `rule.topology_mode` vs `arch.continuity` (`discontiguous`, `contiguous_linear`, `contiguous_planar`).
- `+6` if `rule.discipline` matches the inferred discipline (`mep`, `structural`, `civil`, `architecture`).
- `+3` for each overlapping normalized token (`>= 2` chars) across rule code, name, discipline, trade specialty, services, match keywords, and notes.

### Configurable BIM Rules, Tunneled 3-Step BIM Costing & Dynamic Compliance

- **`sop_rules` & `bim_settings` (Configuration → BIM Compliance):** One consolidated **BIM Compliance** page (`src/app/configuration/+bim_compliance.page.svelte`) with two inner tabs and zero raw JSON editing:
  - **Compliance Rules (`sop_rules`):** Declarative statutory and company tender SOP checks (`authority`: `corenet_x | bca | scdf | pub | ura | company_sop`, `scope`: `model | element | estimate`, 21 metrics including `georef_crs` SVY21/EPSG:3414, `sgpset_coverage_pct`, `min_width_mm`, `min_height_mm`, `min_thickness_mm`, `max_riser_mm`, `min_tread_mm`, `max_slope_pct`, `required_property`, `mep_untagged_pct`, `duplicate_count`, `min_classified_pct`, and multimodal `semantic_check` using wide-aperture building/storey overviews, 4-angle+neighborhood archetype screenshots, and 3D `nearby_archetypes` clearances). Automatically evaluated during `phase: 'prepare'` and refreshed in `phase: 'cost'`, stored on `projects.bim_compliance`, and classified by `src/services/bim/remediation.ts` (`cleanup` vs `classification` vs `bim_revision`).
  - **Takeoff & Cleanup Profile (`bim_settings`):** Opens the singleton `default` profile directly in `<RecordShell header={false}>` (zero 1-row table click-through, no duplicate heading) with edit/create section-header presets (`CORENET X Strict (SG)`, `Main Contractor Tender (±1%)`, `Early Concept Budget`), visual key-value editors for `material_densities` and `service_aliases`, tolerances, cleanup toggles, `exclude_ifc_classes`, and collapsed advanced limits.
- **BIM → BIM Costing · Tunneled 3-Step Process (`projects/ProjectBimTab.svelte`, `BimPrepareStep.svelte`, `BimAssetReview.svelte`, `BimItemMatrixReview.svelte`):**
  1. **Step 1 — Parse & Analyze (`phase: 'prepare'`):** Runs browser streaming takeoff + `analyze_bim_file` preparation with live `RunStatus` progress and summary metrics.
  2. **Step 2 — Review Proposals & Lints (`BimPrepareStep.svelte`):** Inline review across **Proposed Clean BIM** (`BimAssetReview.svelte` over `asset_mappings`: `ifc_class`, `continuity`, `service`, `item_id`, `Verify`, `3D` inspect, `Download Clean BIM (.ifc)` writing back duplicates removed, IFC4 promotions, and live QS edits), **Proposed Item Matrix & Costings** (`BimItemMatrixReview.svelte`: inline editing with **Approve & Save** / **Reject** / **Approve all** and `<Sheet>` creation via **+ Add item**), and **Compliance Lints** (authority-filtered BCA / SCDF / PUB / URA / CORENET X / SOP scorecard with `remediation.ts` classification and direct 3D isolation).
  3. **Step 3 — Generate Cost Estimate (`phase: 'cost'`):** Generates/regenerates the 1:1 `cost_estimates` classification and BOQ costing matrix from the reviewed Clean BIM and Item Matrix, returning to the compact KPI header over a bounded internal-scroll table (`bim_takeoff/+renderer.svelte`) with debounced auto-save inline editing of `measured_qty`, `waste_factor_pct`, `unit_rate`, `contingency_pct`, and bulk `+/- %` tender adjustments.
- **Anti-Flicker 3D Viewer (`src/services/viewer/IfcViewer.svelte`, `engine.ts`, `converter.worker.ts`):** Hides the `@thatopen/components` watermark (`world.renderer.showLogo = false`), strips `exclude_ifc_classes` (`IFCSPACE`, `IFCOPENINGELEMENT`) during fragment conversion (cache `norbital-ifc-fragments-v2`), enables `logarithmicDepthBuffer: true` + `polygonOffset` on fragment materials, tightens `camera.three.near`/`far` to model bounds, renders highlight/ghost overlays single-sided (`RenderedFaces.ONE`, `depthWrite: false` on ghost), owns proportional wheel/trackpad-pinch dollying, exposes an **Asset visibility** panel, and flushes LOD state on `controls` `rest`.

---

## 5. Client-Side 3D IFC Viewer & Two-Tier Fragment Cache

`src/services/viewer/IfcViewer.svelte` (backed by `engine.ts`) embeds an interactive Three.js + `@thatopen/components` viewport inside the `keep_alive` **BIM → 3D Model & Tasks** tab. To eliminate repeated multi-second downloads and single-threaded WASM tessellation across tab switches, navigation, and page reloads, IFC-to-Fragment conversion runs in a disposable Web Worker backed by a two-tier browser cache.

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
  |    three@0.185.1                               ('norbital-ifc-fragments-v2')       |
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
                       - tuneCameraControls (dollyToCursor, proportional wheel/pinch zoom)
                       - framePreset('iso') + applyClippingPlanes + loadModelCategoriesEffect
```

### Interactive 3D Controls & Task/4D Integration

- **Navigation Modes & Proportional Zoom:**
  - `orbit` (default): Left-drag rotates, `Shift` + drag (or right-drag) pans, custom container `wheel` handler applies proportional distance-based dollying for mouse wheel/two-finger scroll and trackpad pinch (replacing `camera-controls`' built-in wheel/pinch handler so zoom never stalls or distorts FOV), `Cmd/Ctrl` + click inspects an element.
  - `pan`: Left-drag (or 1-finger touch) trucks/pans camera, `Cmd/Ctrl` + click inspects.
  - `inspect`: Left-click (`<= 5px` pointer drag threshold) runs `OBF.Highlighter` selection + `OBC.Raycasters` raycast to record exact 3D coordinates `(x, y, z)` and camera eye `(camera_x, camera_y, camera_z)` for the picked element, which the panel can focus, hide, or isolate.
- **Asset Visibility Panel:** Toolbar toggle (`Asset visibility`) opens a floating panel listing every IFC category in the loaded model (`loadModelCategoriesEffect`) with per-category show/hide toggles, a list of individually hidden elements with one-click unhide, and **Show all** to restore every hidden element/category or clear single-element isolation; the picked element popover also offers **Hide element** and **Isolate element** actions (`applyVisibilityEffect`).
- **Camera Presets & Keyboard Shortcuts:** Toolbar presets (`Iso`, `Top`, `Front`, `Side`), Zoom In/Out, Fit Model (`R`), Lock/Unlock navigation, and canvas keyboard navigation (`W/S` or `ArrowUp/Down` dolly; `A/D` or `ArrowLeft/Right` horizontal truck; `Q/E` vertical truck; `Esc` clear selection).
- **3D Section Planes:** Three independent `create_slider` axes (`cutY` Elevation, `cutX` East–West, `cutZ` North–South from `0%` to `100%`) dynamically construct Three.js `Plane` clipping cuts against `modelBounds` with a `+0.05` pad and one-click Reset.
- **Task Isolation & 4D Highlights:** Selecting a row of the BIM tasks table isolates that task's `bim_express_ids`: they take the brand colour, every other element is ghosted in a muted tone at `GHOST_OPACITY` (0.08), and the camera frames them; the 4D timeline's **Highlight N in BIM** isolates the elements active on the scrubbed date the same way, labelled **Active on** its date. Selecting the row again or **Show whole model** clears the ghost and focus styles and frames the whole model; **Open task** is the row's action.
- **Element Tasks:** Picking an element lists the BIM tasks that build it and offers **New BIM task**, prefilled with `kind: 'bim'`, the element's expressID, and its name.

---

## 6. Catalog-Wired Pricing, 3-Way Matching & Commercial Cashflow Ledger

All commercial amounts and quantities use Effect `BigDecimal` (`src/services/commercial/`) with `half-from-zero` rounding (scale 2 for money, scale 3 for quantities, scale 1 for percentages). **Free-text money lines are prohibited** across commercial records: every line item in `contracts` and `commercial_documents` and every row in `adhoc_costs` must resolve against `item_matrix` (and optionally a non-void project `cost_estimates.bim_assets` bucket).

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

### Three Pure Commercial Engines (`src/services/commercial/analytics.ts`)

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

## 7. WhatsApp/Email Intake via `file_project_messages`

Unstructured WhatsApp messages, voice notes, site photos, and emails are mirrored by `sync_messages` into `project_messages`, whose `create` and `update` effects schedule the `file_project_messages` automation (`fileMessages` in `src/data/model/project_messages/intake.ts`, executing under `construction_automation`). `file_project_messages` transcribes voice notes, runs a 30-message windowed System 1 classifier, and batches useful project messages into one System Agent (`ctx.ai.sys_2.task`, with `ctx.ai.sys_2.infer` fallback).

```text
  WhatsApp / Email Connections (sys_integration, import_start: all | since | native)
         |
         v  Trigger: sys_message.create write
  +------------------------------------------------------------------------------------+
  | 1. sync_messages (concurrency: 1, batch <= 25, requeues itself while backlog left) |
  |  - Binary search on sys_message.seq vs filed project_messages.source_seq counts    |
  |    to skip already-synced history in O(log N) queries                              |
  |  - Fair lane mixing (selectBatch): mixes newest per provider + oldest unfiled      |
  |  - Enforces per-connection import_start window (also validated in model transform) |
  |  - Deduplicates via UQ (source_message) + skipRacedWrite                           |
  |  - Attachments <= 20 MiB copied; an audio-only voice note is stored as recording   |
  |    with transcription = 'pending'; every row lands classification = 'pending'      |
  +-----------------------------------------+------------------------------------------+
                                            |
                                            v  project_messages.create/update effect
                                               schedules file_project_messages
  +------------------------------------------------------------------------------------+
  | 2. file_project_messages -> fileMessages (intake.ts, policy: construction_auto.)   |
  |  a. Transcribe: ctx.convert.ingest(recording, diarize: false) -> detail,           |
  |     transcription = done | failed | unavailable                                    |
  |  b. Route (classification = 'pending'):                                            |
  |   - Loads each connection's sys_integration.classifier + up to 30 preceding        |
  |     sys_message rows in the conversation (oldest first, contextOnly: true)         |
  |   - Normalizes handles (handleKey: lowercase email / >=6-digit phone; ignores      |
  |     @g.us / @lid) and matches contacts via computed email_key / phone_key          |
  |   - classifier.mode == 'off' -> 'ignored'; 'all' -> never semantically drop        |
  |   - System 1 (ctx.ai.sys_1.decide): relevance + project + certainty with           |
  |     channel_classifier instructions and 30-message earlier window                  |
  |     * Confident iff relevance.conf >= 0.80 & certainty.conf >= 0.80 &              |
  |       certainty.level == 'Clear direct evidence'                                   |
  |     * Useful + picked project -> classification='useful', project_id=picked        |
  |     * Ignored + confident (in 'smart' mode) -> classification='ignored'            |
  |   - Still undecided -> evidentProject: unique project_number/name in the text ->   |
  |     partner's one project (live contracts, client_id) -> sole active project;      |
  |     none -> 'review'                                                               |
  |  c. Extract (useful, project set, extraction_status = 'pending'):                  |
  |   - Batches useful messages per project into ONE System Agent (ctx.ai.sys_2.task)  |
  |     with readable PDF/image/text attachments (files), using read_messages,         |
  |     read_file, and single-record act writes                                        |
  |   - When automation System Agents are disabled or capped (Unavailable /            |
  |     FacilityFailure), falls back to structured ctx.ai.sys_2.infer:                 |
  |       * tasks.update, one per task the message concerns                            |
  |       * tasks.create (fallback code MSG-<id>-<seq>) for one no task matches        |
  |       * activities.create (polymorphic about -> task or project)                   |
  |       * contracts.create (draft variation_order with EOT days & attachments)       |
  |       * commercial_documents.create (draft PO/DO/Invoice/Claim/Credit Note)        |
  |       * project_messages.update (extraction_status='extracted'|'none', summary)    |
  |   - Refused write: keeps the routing, extraction_status = 'failed' with the reason |
  +------------------------------------------------------------------------------------+

  Filed again (project_messages.update effect -> file_project_messages) when a write
  sets classification, extraction_status or transcription back to 'pending', or changes
  project_id:
   - Message record "Re-extract updates" action.
   - Manual project assignment -> useful (classified_by 'manual'), extraction queued.
   - contacts.create, or contacts.update changing phone/email -> requeueMessages:
     up to 100 newest non-manual 'review'|'ignored' messages -> 'pending'.
   - sys_integration.update -> file_project_messages replays that connection's
     non-manual 'review'|'ignored' messages.
   - A writer who may not update messages (e.g. commercial staff editing a contact)
     leaves them as they are.
```

The tasks, activities, contracts and commercial documents an extraction writes carry `source_message_id`; the message's record view lists them under **What this message updated** (tasks, task activity, contracts, commercial documents; an activity row opens its task).

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
   - Companion views: Table (page_size 100, Kind column, compact progress cells) &
     Board (4 cols, 50/lane)
     * "Highlight N in BIM" isolates the active elements in the 3D viewer ('Active on <date>'),
       brand colour with the rest translucent, as a selected BIM task does
```

---

## 9. Access Control & Authority Matrix

Teams are `sys_team` rows an administrator edits, started by the base seed pack (`seed/public/sys_team.json`); policies live under `src/access_control/policy/`. `construction_read` sets the workspace rate limit (`act: 600/min`, `read: 600/min`, `agent: 100/h`).

```text
TEAM -> POLICY ASSIGNMENT MATRIX (seed/public/sys_team.json)
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
|  Read (default output): all 17 models + sys_user                                             |
+----------------------------------------------------------------------------------------------+
| construction_delivery                                                                        |
|  Create/Update (all moves): projects, tasks, project_messages                                |
|  CRUD: contacts, activities, sustainability_logs, compliance_records (all moves)             |
|  project_files: Create + Update (10 fields, all moves)                                       |
|  cost_estimates: Update status -> void ONLY (draft|reviewed|baselined -> void on BIM swap)   |
|  Automations: sync_messages, analyze_bim_file                                                |
|  Syncs: tasks.autodesk_schedule, project_files.autodesk_files                                |
+----------------------------------------------------------------------------------------------+
| construction_commercial                                                                      |
|  projects: Update currency, bim_takeoff, bim_takeoff_views, plus sustainability/compliance   |
|            metadata (gfa_m2, building_typology, green_mark_target, sustainability_assessor,  |
|            bca_project_ref, submission_gateway, qualified_person, bim_manager, bep_version,  |
|            conquas_band_target)                                                              |
|  Create/Update (all moves): contracts, commercial_documents, cost_estimates, report_templates|
|  CRUD: adhoc_costs, item_matrix, sop_rules, sustainability_logs, compliance_records (moves)  |
|  C/U (no delete): activities, contacts, bim_settings                                         |
|  asset_mappings: Update item_id, note, ifc_class, continuity, service, review_status         |
|  Automations: generate_payment_claim, analyze_bim_file                                       |
+----------------------------------------------------------------------------------------------+
| construction_connections                                                                     |
|  Apps: [configuration]                                                                       |
|  capabilities.personal_connections: ['whatsapp', 'email'] (own accounts + classifier rules)  |
+----------------------------------------------------------------------------------------------+
| construction_automation (system-only; bound to all 4 automations & both Autodesk ACC syncs)  |
|  projects: read + update ['bim_summary', 'bim_compliance', 'bim_costing_dirty', 'bim_costing_error'] |
|  contracts, commercial_documents, tasks, activities, project_files, cost_estimates: R/C/U    |
|  project_messages, asset_mappings: R/C/U | adhoc_costs, contacts, bim_settings, sop_rules,   |
|  report_templates, sustainability_logs, compliance_records, sys_*: read                      |
|  item_matrix: read + create held for approval ("Item Matrix proposal review":                |
|               the teams holding construction_commercial)                                     |
+----------------------------------------------------------------------------------------------+
```

### Key Governance Details

- **Client & Consultant Isolation (`client_consultant`):** Receives only `construction_read` — read-only access to the Operations app with zero write grants, zero Configuration app access, and zero visibility into `sys_integration`.
- **Delivery vs. Commercial Separation:** `project_delivery` cannot create or modify contracts, commercial documents, ad-hoc costs, or item matrix rates, and on `cost_estimates` may **only** transition `status -> void` so updating `projects.bim_file` can safely execute the voiding side effect. Conversely, `commercial_qs` may only edit `currency` and the stored takeoff (`bim_takeoff`, `bim_takeoff_views`) on `projects` (contract terms live on `contracts`) and cannot edit WBS tasks or BIM files; it may log polymorphic activities (`activities`) and correct what each BIM asset is priced as (`asset_mappings`).
- **System 2 Proposals Wait for Approval:** `analyze_bim_file`'s Item Matrix proposals are written by `construction_automation`, whose `item_matrix` create verdict returns `ctx.approve` with the **Item Matrix proposal review** flow, decided by the teams holding `construction_commercial` (refused as `errors.no_matrix_reviewer` when none does); until a member approves it, the proposed item prices nothing and its assets stay unmatched.
- **Message Filing via Dedicated Automation (`file_project_messages`):** `project_messages` effects schedule `file_project_messages`, which runs under `construction_automation` so it can spawn batched System Agents (`ctx.ai.sys_2.task`) or fall back to structured `ctx.ai.sys_2.infer`. A writer refused part of an extraction keeps the routing and records `extraction_status: failed` with the reason.
- **Personal Account Ownership (`construction_connections`):** Native `capabilities.personal_connections: ['whatsapp', 'email']` restricts members to their own personal `whatsapp` or `email` `sys_integration` accounts (including their `listen` and `classifier` configuration in `/connections`), while workspace-shared connections (`owner: null`, including `autodesk_acc`) are managed by administrators in Settings → Integrations → Connections.
