# Construction Operations — Template Authoring Guide

Generic contractor workspace (`norbital_construction`) for both main contractors managing trade subcontractors and subcontractors running their own projects. Structures WhatsApp, email, Autodesk ACC, and BIM IFC files into cashflow, progression, and documentation.

## Structure

- **Models (13)** under `src/data/model/`:
  - `projects/` — root project (`project_role`, `client_id` → `contacts`, `project_manager` → `sys_user`, `autodesk_project_id`, single `bim_file` / `bim_version` / `bim_costing_dirty` / `bim_summary`, browser takeoff `bim_takeoff` / `bim_takeoff_views`, `zones`, `location` point + text `address` — replacing `bim_file` clears the takeoff, marks dirty & voids stale `cost_estimates`); contract terms live only on `contracts`
    - `contracts/` (`owned: true`) — upstream client contracts, downstream subcontracts and supply contracts, and their child variation orders (`trade_specialty`, value, retention, tax and payment terms, catalog/BIM-backed `priced_lines` validated against `item_matrix`, execution locks)
    - `commercial_documents/` (`owned: true`) — unified PO, DO, Invoice, Progress Claim, Credit Note ledger filed under each contract with catalog/BIM-backed `priced_lines`, due date from the contract's else the partner's payment terms, 3-way `parent_document_id` matching & locks
    - `adhoc_costs/` (`owned: true`) — standalone non-BIM project costs requiring a mandatory `catalog_item_id` (`item_matrix` `additional_cost`) for measurable units and cashflow tracking
    - `tasks/` (`owned: true`) — WBS tasks & milestones nested by `wbs_path` breakdown code (`task_code` is the source activity ID; `kind` `bim` builds its `bim_express_ids`, `adhoc` is work the model does not show; `open_issue_count`) with `+schedule_file.sync.ts` (XLSX/CSV/P6 `.xer`/MS Project `.xml`) and `+autodesk_schedule.sync.ts`
      - `activities/` (`owned: true`) — what happens on the task, by `kind`: `comment`, `issue` (`title`, `issue_type`, `severity`, `status` `open`/`closed`) or `meeting` (`title`, `attendees`); each with a Markdown `body` (`images: 'attachments'`), `attachments`, `occurred_at`, `author` (the writer; none when filed from a message) and `source_message_id`
    - `project_files/` (`owned: true`) — filed non-BIM project documents (drawings, specs, schedules, Autodesk sheets, contracts, handover docs) in the project's Documents tab with `+autodesk_files.sync.ts`
    - `cost_estimates/` (`owned: true`) — 1:1 per-project BIM classified asset takeoff (`unique: ['project_id']`, `bim_takeoff`, `asset_signatures`, cost and `carbon_total` totals, `draft/reviewed/baselined/void`, `baselined_locked`)
  - `project_messages/` — WhatsApp & email messages filed on arrival by the model's effects (`intake.ts`: transcribe, route, extract)
  - `item_matrix/` (Configuration) — BIM asset & ad-hoc cost items with `unit_rate` and `carbon_factor` (kgCO2e per unit), `derived` items priced from another item's quantity, with `+matrix.sync.ts`
  - `asset_mappings/` — what each unique BIM asset is priced as, by signature, across takeoffs and projects (`system_1`, `qs` correction, or approved System 2 `proposal`)
  - `contacts/` (Operations → Business Partners) — customers/clients, vendors/suppliers, subcontractors by `trade_specialty` & consultants (WhatsApp phone & email, standard `payment_terms_days`)
  - `communication_settings/` (Configuration) — personal WhatsApp/email intake & extraction rules (the only message routing configuration; none per project)
- **Integration (1):** `src/integration/autodesk_acc/+integration.ts` (OAuth 2.0 to Autodesk Platform Services / ACC).
- **Apps (2):** `operations` (`projects`, `partners`) and `configuration` (`item_matrix`, `connections`).
- **Automations (3):** `sync_messages`, `analyze_bim_file`, `generate_payment_claim`.
- **Libraries:** `commercial.ts`, `catalog-lines.ts`, `CatalogLinesEditor.svelte`, `bim-pipeline.ts`, `bim-geometry.ts`, `bim-step-stream.ts`, `schedule-parsers.ts`, `trades.ts`, `zones.ts`, `ProjectTimeline.svelte`, `ifc-viewer/`, `conversations.ts`, `message-import.ts`, `MyConnections.svelte`.

## Verification gates

From `templates/construction`, run `bolt check`, `bolt build`, `bolt test`, and `bolt seed --bank=../../seed_bank`. From the realm root, run `bun run privacy` before pushing.
