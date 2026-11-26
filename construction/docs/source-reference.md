# Source Reference (`norbital_construction`)

Exact file-by-file inventory of the Construction Operations Bolt template (`templates/construction`). For architecture, data flows, state machines, and calculation internals, see [architecture.md](architecture.md).

## Workspace Manifest, Secrets, Agent & i18n

- `src/+workspace.ts` — workspace configuration (`tz: 'Asia/Singapore'`, `locale: 'en-SG'`, `languages: ['en', 'zh']`, `currency: 'SGD'`, warm/amber theme, apps `['operations', 'configuration']`, `convert: { to: ['pdf'] }`, `construction_read` rate limits `600/min` act/read and `100/h` agent)
- `src/+secrets.ts` — sealed OAuth credentials `AUTODESK_CLIENT_ID` and `AUTODESK_CLIENT_SECRET` for Autodesk Platform Services / Construction Cloud (ACC)
- `src/i18n/+messages.ts`, `src/i18n/+zh.messages.ts` — complete English and Simplified Chinese UI, model, enum, state, automation, integration, and error catalogs
- `src/agent/+agent.md` — Norbius workspace brief and operating rules
- `src/agent/AGENTS.md` — template-local developer authoring guide

## Custom Fields (5 Co-Located Value Types)

Each folder under `src/data/custom_field/` contains `+custom_field.ts` (schema + validation) and `+renderer.svelte` (view/edit UI):

- `src/data/custom_field/bim_takeoff/` — classified, unmatched, rate-missing, and manually overridden BIM asset takeoff lines (`asset_key`, `ifc_class`, `classification`, `discipline`, `storey`, `element_count`, `measured_qty`, `unit`, `quantity_basis`, `matrix_code`, `unit_rate`, `waste_factor_pct`, `priced_qty`, `amount`, `carbon_factor`, `carbon` (kgCO2e), `status`, `match_method`, `match_confidence`, `match_reason`, `sample_express_ids`) used on `cost_estimates.bim_assets`
- `src/data/custom_field/bim_pin/` — 3D IFC element anchor (`express_id`, `element_name`, `global_id`, `x/y/z`, `camera_x/y/z`) used on `issues.bim_pin` and `contracts.bim_pin`
- `src/data/custom_field/priced_lines/` — catalog- and BIM-asset-backed exact-decimal line items (`source`: `'bim_asset' | 'adhoc_catalog'`, `code`, `bim_asset_key`, `storey`, `bim_express_ids`, `description`, `unit`, `qty`, `unit_rate`, `amount`) used on `contracts.lines` and `commercial_documents.lines` (delegates editing to `CatalogLinesEditor.svelte`)
- `src/data/custom_field/project_zones/` — unique-coded project storeys, zones, elevations, and grid axes (`projects.zones`)
- `src/data/custom_field/project_address/` — structured site postal address (`projects.address`)

## Record Models (12) & Syncs (4)

Each model folder under `src/data/model/` contains `+model.ts` and `+representation.svelte`:

### Project Root & Owned Children (8)

- `src/data/model/projects/` — root project (`project_role`, `client_id` → `contacts`, `project_manager` → `sys_user`, `status`, `schedule_range`, `currency`, `autodesk_project_id`, single federated `bim_file` `<= 20MiB`, `bim_version`, `bim_costing_dirty`, `bim_summary`, `zones`, `address`, plus 4 computed counts: `open_task_count`, `open_issue_count`, `active_contract_count`, `open_document_count`); contract terms live only on `contracts`. Updating `bim_file` sets `bim_costing_dirty = true` and via `update.effect` voids any existing non-void `cost_estimates`. Representation renders the single-row **Project Hub** (`Record`, `Programme & Tasks`, `BIM`, `Finance`, `Sustainability`, `Documents`); `computeProjectCarbon` in `src/lib/commercial.ts` totals embodied carbon by item for the Sustainability tab.
  - `projects/cost_estimates/` (`owned: true`, `unique: ['project_id']`) — 1:1 BIM cost estimation per project (`EST-{yyyy}-{000}`, `draft`/`reviewed`/`baselined`/`void`, `bim_assets`, `bim_subtotal`, `contingency_pct`, `contingency_amount`, `total_estimate`, `carbon_total` (kgCO2e: each line's priced quantity × its item's carbon factor), `baselined_locked`)
  - `projects/adhoc_costs/` (`owned: true`) — standalone non-BIM project costs (`ADH-{yyyy}-{000}`) with mandatory `catalog_item_id` (`on_delete: 'restrict'`) referencing an active `item_matrix` `additional_cost` item, exact `BigDecimal` `amount`, `draft`/`approved`/`incurred`/`cancelled` lifecycle, auto `incurred_date`, and `settled_locked`
  - `projects/contracts/` (`owned: true`) — upstream client contracts (`upstream`), downstream subcontracts and supply contracts (`downstream`), and child Variation Orders (`variation_order` via self-ref `parent_contract_id`) with retention, retention cap, tax and payment terms, catalog/BIM-validated `priced_lines`, automatic `contract_value` derivation, `bim_pin`, `schedule_impact_days`, `review_locked` / `active_locked` / `settled_locked`, and nested **Transactions** & **Variation Orders** tabs
  - `projects/commercial_documents/` (`owned: true`) — unified PO, DO, Invoice, Progress Claim, and Credit Note ledger (`DOC-{yyyy}-{000}`, `inflow`/`outflow`) with catalog/BIM-validated `priced_lines`, `BigDecimal` subtotal/tax/total/net math, auto `due_date` from the contract's, else the partner's, `payment_terms_days`, self-ref `parent_document_id` 3-way match evaluation (`unmatched`/`partial`/`matched`/`variance`), `issued_locked` / `certified_locked` / `settled_locked`, and nested linked DO/Invoice tab on POs
  - `projects/tasks/` (`owned: true`, `unique: ['project_id', 'task_code']` `import_key`) — WBS work packages and milestones nested by `wbs_path` breakdown code (`task_code` = source activity ID, `trade_specialty`, `zone` validated against `projects.zones`, `baseline_range`/`schedule_range`/`actual_range`, `progress_pct`, 4D `bim_express_ids`)
    - `+schedule_file.sync.ts` — file import/export supporting XLSX, CSV, Primavera P6 (`.xer`, `<= 4MiB`), and MS Project (`.xml`, `<= 4MiB`)
    - `+autodesk_schedule.sync.ts` — two-way Autodesk ACC Schedule API sync (`every: '30min'`, `GET` activities / `PATCH` progress & actual dates with `If-Match`)
  - `projects/issues/` (`owned: true`) — `ISS-{yyyy}-{000}` BIM-pinned defects, RFIs, clashes, safety observations, and snags (`trade_specialty`, `zone` validated, `bim_pin`, site `photos`, links to `task_id`, `contract_id`, `party`, `source_message_id`, auto `closed_date`)
  - `projects/project_files/` (`owned: true`, `unique: ['project_id', 'document_number']` `import_key`) — filed non-BIM project documents (`drawing`, `spec`, `schedule`, `contract_doc`, `handover`, `autodesk_model`) listed in the project hub's **Documents** tab (`zone` validated; record history keeps earlier versions)
    - `+autodesk_files.sync.ts` — two-way Autodesk ACC Sheets API sync (`every: '1h'`, `GET` sheets / `PATCH` sheet titles)

### Top-Level & Configuration Models (4)

- `src/data/model/contacts/` — Business Partners directory (`client`, `main_contractor`, `supplier`, `subcontractor`, `consultant`, `architect`, `qs`, `site_engineer`, `project_manager`; 16 trade specialties; standard `payment_terms_days`; CEL-computed `email_key` & `phone_key`; `create`/`update` effects schedule `reclassify_messages`; representation includes linked **Orders & Contracts**, **Transactions**, and **Assigned Tasks** tabs)
- `src/data/model/item_matrix/` — Item Matrix (`code` unique `import_key`, `category`: `'bim_asset' | 'additional_cost'`, `discipline`, `trade_specialty`, `ifc_classes[]`, `match_keywords[]`, `unit`, `quantity_basis`, `currency`, `unit_rate`, `waste_factor_pct`, `carbon_factor` (kgCO2e per unit), `rate_basis`, `validity`, `active`)
  - `+matrix.sync.ts` — bulk XLSX / CSV import and export for the Item Matrix
- `src/data/model/project_messages/` — global WhatsApp & email coordination inbox (`unique: ['source_message']`, `import_start` window guard, voice `recording` + `transcription`, `classification`, `extraction_status`, automatic scheduling of `classify_messages` and `extract_project_updates` via `create`/`update` effects, manual assignment auto-marks `useful` and queues extraction)
- `src/data/model/communication_settings/` — per-member (`unique: ['owner']`) intake rules (`hard_filter`: `'all' | 'known_contacts'`, `auto_extract`, `classification_sop` `<= 8000` chars); changes trigger owner-scoped `reclassify_messages`

## Integrations (1 Custom + Built-In WhatsApp & Email)

- `src/integration/autodesk_acc/+integration.ts` — Autodesk Platform Services / Construction Cloud OAuth 2.0 HTTP integration (`base_url: 'https://developer.api.autodesk.com'`, scopes `data:read`, `data:write`, `account:read`, rate `10/s`, allow-listed `/project/v1/**`, `/data/v1/**`, `/construction/schedule/v1/**`, `/construction/sheets/v1/**`, `/modelderivative/v2/**`, connection test via `GET /project/v1/hubs`)
- Built-in host channels `whatsapp` and `email` managed through `src/lib/MyConnections.svelte` (personal accounts per member + workspace-shared accounts for administrators)

## Apps (2) & Pages (5)

- `src/app/operations/` (**Operations**):
  - `+app.ts` — declares `projects`, `partners`, `messages`
  - `+projects.page.svelte` — Projects table with **Sweep pending BIM costings** action (`sweep_bim_costing`)
  - `+partners.page.svelte` — Business Partners tabbed directory (**All partners**, **Customers**, **Vendors**, **Subcontractors**) with role-preset quick create
  - `+messages.page.svelte` — Messages inbox with manual **Sync messages**, **Route pending**, and **Extract project updates** toolbar actions
- `src/app/configuration/` (**Configuration**):
  - `+app.ts` — declares `item_matrix`, `connections`
  - `+item_matrix.page.svelte` — active Item Matrix table with rate and carbon factor (with XLSX/CSV file sync)
  - `+connections.page.svelte` — tabbed **Channels & integrations** (`MyConnections.svelte`) and personal **Intake & auto-extraction** (`communication_settings`)

## Automations (8)

All 8 automations execute under policy `construction_automation`:

- `src/automation/+analyze_bim_file.automation.ts` — visual & text Jev System 1 (`ctx.ai.sys_1.decide`) BIM archetype classification (`<= 120` visual single-asset calls + text batches of 15, candidate cap 80, `unknown_unseen_catalog` choice, confidence `>= 0.68`) + exact `BigDecimal` pricing + atomic update of `projects.bim_summary` / `bim_costing_dirty = false` and `cost_estimates` (`concurrency: 1`; accepts browser-extracted model or server-streams `<= 4MiB`)
- `src/automation/+sweep_bim_costing.automation.ts` — daily EOD cron (`0 22 * * *`, `rest: '24h'`) and manual trigger; finds active/tendering/on-hold/DLP projects with a dirty BIM file, missing estimate, or `void` estimate, schedules `analyze_bim_file` for models `<= 4MiB`, and sends deduplicated team notifications for models `> 4MiB` (`concurrency: 1`)
- `src/automation/+generate_payment_claim.automation.ts` — page RPC (`mode: 'call'`) running `computeProjectCommercial` to draft a `BigDecimal` inflow `progress_claim` in `commercial_documents` against the client contract (`clientContractOf`: first active or completed upstream non-VO contract; refuses `errors.claim_needs_main_contract` without one)
- `src/automation/+sync_messages.automation.ts` — triggered by `sys_message.create`, 15-minute cron safety net (`*/15 * * * *`), or manual action; mirrors WhatsApp & email messages respecting `import_start` using binary-search seq skipping + fair lane mixing, transcribes voice notes via `ctx.convert.ingest`, and queues `classify_messages` (`concurrency: 1`)
- `src/automation/+classify_messages.automation.ts` — 5-minute cron (`*/5 * * * *`) or scheduled; applies `known_contacts` hard filter, deterministic contact/project matching (a partner's one project from live contracts or `client_id`), and Jev System 1 routing (`confidence >= 0.80`) (`concurrency: 1`)
- `src/automation/+reclassify_messages.automation.ts` — scheduled by `contacts` and `communication_settings` effects (or manual); resets up to 100 non-manual `review`/`ignored` messages to `pending` and queues `classify_messages` (`concurrency: 1`)
- `src/automation/+extract_project_updates.automation.ts` — scheduled by `project_messages` effects or manual; runs Jev System 2 (`ctx.ai.sys_2.infer`) over message text plus PDF/image/text attachments to atomically create/update `tasks`, `issues`, draft variation `contracts`, and draft `commercial_documents` (`concurrency: 1`)
- `src/automation/+daily_project_digest.automation.ts` — daily `06:00` `Asia/Singapore` cron using SQL aggregate counts to notify `project_delivery`, `commercial_qs`, and `construction_administrators` of critical/high open issues, blocked/overdue tasks, pending contracts/VOs, and overdue documents

## Access Control (4 Teams, 5 Policies)

- `src/access_control/team/+team.ts` — `construction_administrators`, `project_delivery`, `commercial_qs`, `client_consultant`
- `src/access_control/policy/+construction_read.policy.ts` — `operations` app + read grants on all 11 operational models and `sys_user`
- `src/access_control/policy/+construction_delivery.policy.ts` — delivery writes on `projects`, `project_files`, `tasks`, `issues`, `contacts`, `project_messages`, status-only `-> void` move on `cost_estimates`, BIM/message automations, and Autodesk ACC syncs
- `src/access_control/policy/+construction_commercial.policy.ts` — commercial writes on `projects` (`currency` only), `contracts`, `commercial_documents`, `adhoc_costs`, `cost_estimates`, `item_matrix`, `contacts`, plus `generate_payment_claim`, `analyze_bim_file`, `sweep_bim_costing`
- `src/access_control/policy/+construction_connections.policy.ts` — `configuration` app + custom ownership verdicts restricting members to their own personal `whatsapp`/`email` `sys_integration` accounts and `communication_settings`
- `src/access_control/policy/+construction_automation.policy.ts` — background system policy used by all 8 automations and both Autodesk syncs

## Shared Libraries (`src/lib/`)

- `src/lib/commercial.ts` — pure Effect `BigDecimal` line totals, document totals, 3-way PO/DO/Invoice matching, contract valuation & retention-capped claim math, monthly cashflow & credit-note negation, and per-catalog-code `computeCatalogCashflowBreakdown`
- `src/lib/catalog-lines.ts` — server-side `resolveCatalogLines` validator ensuring zero free-text codes or units across `contracts` and `commercial_documents`
- `src/lib/CatalogLinesEditor.svelte` — grouped combobox editor (Linked Contract/PO lines + 1-click Copy, Project BIM Takeoff Assets, BIM Asset Catalog, Ad-hoc Cost Catalog)
- `src/lib/bim-step-stream.ts` — zero-regex streaming ISO-10303-21 IFC STEP scanner (`90+` `ASSET_CLASSES`, SI unit conversion, material layers, Pset/Qto resolution, strict archetype deduplication)
- `src/lib/bim-pipeline.ts` — `parseIfcStepToExtracted`, `rankCandidateMatrixRules`, `describeArchetypeForAi`, `buildBimCostEstimateFromExtracted`, `recomputeCostEstimateTotals`
- `src/lib/ifc-viewer/ifc_viewer.svelte` — Three.js + `@thatopen/components` 3D viewport with Orbit/Pan/Inspect modes, keyboard navigation, `Iso`/`Top`/`Front`/`Side` presets, X/Y/Z clipping planes, severity & 4D highlights, and `bim_pin` raycast tagging
- `src/lib/ifc-viewer/ifc_viewer.converter.ts` & `ifc_viewer.converter.worker.ts` — two-tier client `.frag` cache (in-memory LRU-4 + `CacheStorage` `norbital-ifc-fragments-v1`) and disposable iframe-safe blob-URL `web-ifc@0.0.77` WASM converter worker
- `src/lib/ifc-viewer/ifc_takeoff.ts` & `ifc_takeoff.worker.ts` — browser 4 MiB chunked IFC STEP streaming worker coordinator
- `src/lib/ifc-viewer/ifc_asset_snapshots.ts` — offscreen WebGL multi-angle isolated studio renderer (`224x224` JPEG, up to 120 archetypes / 2.4 MB cap)
- `src/lib/ifc-viewer/ifc_viewer.types.ts` & `ifc_viewer.runtime.d.ts` — viewer types, Effect `fetchEffect` helper, and CDN module type declarations
- `src/lib/ProjectTimeline.svelte` — high-density 4D planner for hundreds of subcontractors (30px virtualized single-line rows via `virtual_list`, Breakdown (`wbs_path`) / Subcontractor / Trade / Zone grouping, Blocked / Behind / Updated / Milestones quick filters, single shared gridline overlay, inline 4D date scrubber, BIM highlight bridge; no VOs on planner)
- `src/lib/schedule-parsers.ts` — Primavera P6 `.xer` and MS Project `.xml` schedule parsers
- `src/lib/trades.ts` — canonical 16 trade specialties
- `src/lib/zones.ts` — batched `validateProjectZones` helper (`as_of: 'act'`)
- `src/lib/dates.ts` — Effect `DateTime` calendar-date validation, arithmetic, and workspace-timezone conversion
- `src/lib/conversations.ts`, `src/lib/message-import.ts`, `src/lib/ai.ts` — handle normalization, `import_start` windowing, fair batch selection, race-safe write helpers, and bounded prompt capping
- `src/lib/MyConnections.svelte`, `src/lib/record-editor.svelte` — shared connection setup and record editor (record representations compose the kit's `RecordForm`)

## Migrations, Seeder & Tests

- `migrations/0001_initial.sql`, `0002_schema.sql`, `snapshot.json`, `migrations.lock.json`, `physical.json` — committed SQL migration history and physical schema definitions
- `seed/+seeder.ts` — workspace demo seeder binding
- `tests/test-runtime.ts` — scoped `TestWorkspace` acquisition and record helpers
- `tests/commercial-and-contracts.test.ts` — exact `BigDecimal` math, catalog line validation, `adhoc_costs`, catalog cashflow breakdown, 3-way matching, contract review locks, `generate_payment_claim` RPC, and non-admin RBAC enforcement
- `tests/bim-schedule-and-comms.test.ts` — IFC STEP streaming & multi-storey archetype deduplication, isolated multi-angle System 1 visual classification & `unknown_unseen_catalog` routing, `bim_file` dirty/void lifecycle & `sweep_bim_costing`, baselined estimate locks, all 4 syncs (P6/MSP/CSV/XLSX/Autodesk ACC), zone validation, WhatsApp intake/classification/extraction, and `daily_project_digest` notifications
