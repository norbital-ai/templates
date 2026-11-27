# Construction Operations — Template Authoring Guide

Generic contractor workspace (`norbital_construction`) for both main contractors managing trade subcontractors and subcontractors running their own projects. Structures WhatsApp, email, Autodesk ACC, and BIM IFC files into cashflow, progression, and documentation.

## Structure

- **Models (17)** under `src/data/model/`:
  - `projects/` — root project (`project_role`, `client_id` → `contacts`, `project_manager` → `sys_user`, `autodesk_project_id`, single `bim_file` / `bim_version` / `bim_costing_dirty` / `bim_summary` / `bim_compliance`, browser takeoff `bim_takeoff` / `bim_takeoff_views`, sustainability & statutory metadata `gfa_m2` / `building_typology` / `green_mark_target` / `sustainability_assessor` / `bca_project_ref` / `submission_gateway` / `qualified_person` / `bim_manager` / `bep_version` / `conquas_band_target`, `zones`, `location` point + text `address` — replacing `bim_file` clears takeoff & compliance, marks dirty & voids stale `cost_estimates`); contract terms live only on `contracts`
    - `contracts/` (`owned: true`) — upstream client contracts, downstream subcontracts and supply contracts, and their child variation orders (`trade_specialty`, value, retention, tax and payment terms, catalog/BIM-backed `priced_lines` validated against `item_matrix`, execution locks)
    - `commercial_documents/` (`owned: true`) — unified PO, DO, Invoice, Progress Claim, Credit Note ledger filed under each contract with catalog/BIM-backed `priced_lines`, due date from the contract's else the partner's payment terms, 3-way `parent_document_id` matching & locks
    - `adhoc_costs/` (`owned: true`) — standalone non-BIM project costs requiring a mandatory `catalog_item_id` (`item_matrix` `additional_cost`) for measurable units and cashflow tracking
    - `tasks/` (`owned: true`) — WBS tasks & milestones nested by `wbs_path` breakdown code (`task_code` auto-allocates `T-001`… when omitted or preserves P6/ACC codes; `kind` `bim` builds its `bim_express_ids` via 3D BIM picker, `adhoc` is work the model does not show; Linear-style two-pane `Record` + `Activity` tabs with borderless full-height `RichMarkdownEditor` bubble & `/` slash menus) with `+schedule_file.sync.ts` (XLSX/CSV/P6 `.xer`/MS Project `.xml`) and `+autodesk_schedule.sync.ts`
    - `project_files/` (`owned: true`) — filed non-BIM project documents (drawings, specs, schedules, Autodesk sheets, contracts, handover docs) in the project's Documents tab with `+autodesk_files.sync.ts`
    - `cost_estimates/` (`owned: true`) — 1:1 per-project BIM classified asset takeoff (`unique: ['project_id']`, `bim_takeoff`, `asset_signatures`, cost and `carbon_total` totals, `draft/reviewed/baselined/void`, `baselined_locked`)
    - `sustainability_logs/` (`owned: true`) — periodic construction site energy, diesel, A4 haulage, water/NEWater, and C&D waste ledger supporting EN 15978 A4–A5, BCA Green Mark Whole Life Carbon, ISO 14064-1 Scope 1 & 2, and SGX / GRI 302–306 reporting
    - `compliance_records/` (`owned: true`) — BCA CONQUAS, CORENET X, ISO 9001, ISO 14001, ISO 45001, and ISO 19650 site inspections, NCRs, safety, environmental, and statutory gateway register
  - `report_templates/` (Configuration) — versioned `draft → published` (locked on publish) HTML print layouts, declarations, letterheads, and stamps for Sustainability and Compliance PDF reports (`en` / `zh`)
  - `activities/` — polymorphic operational activity log (`about` ref → `projects`, `tasks`, `contracts`, `contacts`, `on_delete: 'cascade'`; auto-derived `project_id` roll-up; simple `title`, plain-text `description`, `occurred_at`, optional `attachments`, `author`, `source_message_id`) rendered via shared `src/lib/ActivityTimeline.svelte` on every target record's **Activity** tab
  - `project_messages/` — WhatsApp & email messages filed on arrival by the model's effects (`intake.ts`: transcribe, route, extract)
  - `item_matrix/` (Configuration) — BIM asset & ad-hoc cost items with `unit_rate`, `carbon_factor` (kgCO2e per unit), `system_services`, `min_size_mm`/`max_size_mm`, `insulated`, `topology_mode`, and `derived` items, with `+matrix.sync.ts`
  - `bim_settings/` (Configuration) — runtime-configurable BIM takeoff tolerances, visual presets/editors, automatic cleanup flags, excluded IFC classes, nominal size bands, material densities, service keyword aliases, extra property keys, and AI thresholds
  - `sop_rules/` (Configuration) — dynamic, configurable BCA / SCDF / PUB / URA / CORENET X & company tender SOP compliance rules evaluated automatically against uploaded IFC models and cost estimates
  - `asset_mappings/` — what each unique BIM asset is priced as, by dimension-aware signature, across takeoffs and projects (`continuity`, `service`, `size_mm`, `review_status`, `cleanup_note`, `system_1` / `qs` verification & amendment / approved System 2 `proposal`)
  - `contacts/` (Operations → Business Partners) — customers/clients, vendors/suppliers, subcontractors by `trade_specialty` & consultants (WhatsApp phone & email, standard `payment_terms_days`)
- **Integration (1):** `src/integration/autodesk_acc/+integration.ts` (OAuth 2.0 to Autodesk Platform Services / ACC).
- **Apps (2):** `operations` (`projects`, `partners`) and `configuration` (`item_matrix`, `bim_compliance` combining `sop_rules` + `bim_settings`, `report_templates`). Personal connections (with native listening scope, smart classifier, automation toggles & delivery history) live in Bolt's `/connections`; workspace connections (`whatsapp`, `email`, `autodesk_acc`) live in Settings → Integrations → Connections.
- **Automations (4):** `sync_messages`, `file_project_messages`, `analyze_bim_file`, `generate_payment_claim`.
- **Services (`src/services/`):**
  - `src/services/commercial/` — `decimal.ts` (`BigDecimal`), `lines.ts` (line totals, 3-way match, catalog resolution), `analytics.ts` (project commercial, cashflow, catalog ledger, embodied carbon).
  - `src/services/bim/` — `schema.ts`, `config.ts`, `step-parser.ts`, `geometry.ts`, `cleanup.ts`, `pricing.ts`, `compliance.ts`, `organizer.ts`, `classifier.ts` (zero hardcoded business/SOP/regional trade tables; driven by `bim_settings`, `sop_rules`, and `item_matrix`).
  - `src/services/reports/` — `template-validation.ts`, `report-document.ts`, `report-pdf.ts`, `ReportPdfViewer.svelte`, `ReportPreviewDialog.svelte` (A4 PDF previewer & customizable HTML template engine for BCA Green Mark Sustainability & CORENET X / ISO 19650 / CONQUAS Compliance reports).
  - `src/services/viewer/` — `types.ts`, `runtime.d.ts`, `engine.ts`, `IfcViewer.svelte`, `converter.ts`, `converter.worker.ts`, `geometry-pass.ts`, `takeoff.ts`, `takeoff.worker.ts`.
  - `src/services/ui/` — `SegmentedToggle.svelte`, `create-values.ts`, `download.ts`, `task-meta.ts`.
- **Libraries (`src/lib/`):** `ActivityTimeline.svelte`, `CatalogLinesEditor.svelte`, `ProjectTimeline.svelte`, `record-editor.svelte`, `schedule-parsers.ts`, `trades.ts`, `zones.ts`, `dates.ts`, `conversations.ts`, `message-import.ts`, `ai.ts`.
- **Co-located project hub tabs (`src/data/model/projects/`):** `ProjectProgrammeTab.svelte`, `ProjectBimTab.svelte`, `ProjectFinanceTab.svelte`, `ProjectSustainabilityTab.svelte`, `ProjectComplianceTab.svelte`, `BimPrepareStep.svelte`, `BimAssetReview.svelte`, `BimItemMatrixReview.svelte`.

## Verification gates

From `templates/construction`, run `bolt check`, `bolt build`, `bolt test`, and `bolt seed --bank=../../seed_bank`. From the realm root, run `bun run privacy` before pushing.
