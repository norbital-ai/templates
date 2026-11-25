# Construction Operations — Template Authoring Guide

Generic contractor workspace (`norbital_construction`) for both main contractors managing trade subcontractors and subcontractors running their own projects. Structures WhatsApp, email, Autodesk ACC, and BIM IFC files into cashflow, progression, and documentation.

## Structure

- **Models (12)** under `src/data/model/`:
  - `projects/` — root project (`project_role`, `autodesk_project_id`, single `bim_file` / `bim_version` / `bim_revisions` / `bim_costing_dirty` / `bim_summary` — replacing `bim_file` marks dirty & voids stale `cost_estimates`, `zones`, commercial terms, `capture_rules`)
    - `contracts/` (`owned: true`) — upstream Sales Orders (SO), downstream Purchase Orders / subcontracts (PO), and their child variation orders (`trade_specialty`, catalog/BIM-backed `priced_lines` validated against `cost_matrix`, `revision_trail`, execution locks)
    - `commercial_documents/` (`owned: true`) — unified PO, DO, Invoice, Progress Claim, Credit Note ledger filed under each contract with catalog/BIM-backed `priced_lines`, 3-way `parent_document_id` matching & locks
    - `adhoc_costs/` (`owned: true`) — standalone non-BIM project costs requiring a mandatory `catalog_item_id` (`cost_matrix` `additional_cost`) for measurable units and cashflow tracking
    - `tasks/` (`owned: true`) — large-scale WBS tasks & milestones with `+schedule_file.sync.ts` (XLSX/CSV/P6 `.xer`/MS Project `.xml`) and `+autodesk_schedule.sync.ts`
    - `issues/` (`owned: true`) — BIM-pinned defects, clashes, RFIs, safety & snags tied to tasks, contracts & trade subcontractors
    - `project_files/` (`owned: true`) — filed non-BIM project documents (drawings, specs, schedules, Autodesk sheets, contracts, handover docs) under the project's Record tab with `+autodesk_files.sync.ts`
    - `cost_estimates/` (`owned: true`) — 1:1 per-project BIM classified asset takeoff (`unique: ['project_id']`, `bim_takeoff`, `draft/reviewed/baselined/void`, `baselined_locked`)
  - `project_messages/` — WhatsApp & email intake inbox routed into projects
  - `cost_matrix/` (Configuration) — quantifiable BIM asset & ad-hoc cost catalog with `+matrix.sync.ts`
  - `contacts/` (Operations → Business Partners) — customers/clients, vendors/suppliers, subcontractors by `trade_specialty` & consultants (WhatsApp phone & email)
  - `communication_settings/` (Configuration) — personal WhatsApp/email intake & extraction rules
- **Integration (1):** `src/integration/autodesk_acc/+integration.ts` (OAuth 2.0 to Autodesk Platform Services / ACC).
- **Apps (2):** `operations` (`projects`, `partners`, `messages`) and `configuration` (`cost_matrix`, `connections`).
- **Automations (8):** `sync_messages`, `classify_messages`, `reclassify_messages`, `extract_project_updates`, `analyze_bim_file`, `sweep_bim_costing`, `generate_payment_claim`, `daily_project_digest`.
- **Libraries:** `commercial.ts`, `catalog-lines.ts`, `CatalogLinesEditor.svelte`, `bim-pipeline.ts`, `schedule-parsers.ts`, `trades.ts`, `zones.ts`, `ProjectTimeline.svelte`, `ifc-viewer/`, `conversations.ts`, `message-import.ts`, `MyConnections.svelte`.

## Verification gates

From `templates/construction`, run `bolt check`, `bolt build`, `bolt test`, and `bolt seed --bank=../../seed_bank`. From the realm root, run `bun run privacy` before pushing.
