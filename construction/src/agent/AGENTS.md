# Construction Operations — Template Authoring Guide

Generic contractor workspace (`norbital_construction`) for both main contractors managing trade subcontractors and subcontractors running their own projects. Structures WhatsApp, email, Autodesk ACC, and BIM IFC files into cashflow, progression, and documentation.

## Structure

- **Models (11)** under `src/data/model/`:
  - `projects/` — root project (`project_role`, `autodesk_project_id`, `zones`, commercial terms, `capture_rules`)
    - `contracts/` (`owned: true`) — upstream/downstream contracts & variation orders (`trade_specialty`, `priced_lines`, `revision_trail`, execution locks)
    - `commercial_documents/` (`owned: true`) — unified PO, DO, Invoice, Progress Claim, Credit Note ledger with 3-way `parent_document_id` matching & locks
    - `tasks/` (`owned: true`) — large-scale WBS tasks & milestones with `+schedule_file.sync.ts` (XLSX/CSV/P6 `.xer`/MS Project `.xml`) and `+autodesk_schedule.sync.ts`
    - `issues/` (`owned: true`) — BIM-pinned defects, clashes, RFIs, safety & snags tied to tasks, contracts & trade subcontractors
    - `project_files/` (`owned: true`) — IFC models, Autodesk sheets/models, drawings & specs with `+autodesk_files.sync.ts` and automatic `analyze_bim_file` trigger
    - `cost_estimates/` (`owned: true`) — BIM classified asset takeoff (`bim_takeoff`) + editable non-BIM `additional_costs` (`priced_lines`) + `baselined_locked`
  - `project_messages/` — WhatsApp & email intake inbox routed into projects
  - `cost_matrix/` (Configuration) — quantifiable IFC asset & additional-cost rate matrix with `+matrix.sync.ts`
  - `contacts/` (Configuration) — subcontractors by `trade_specialty`, suppliers, clients & consultants (WhatsApp phone & email)
  - `communication_settings/` (Configuration) — personal WhatsApp/email intake & extraction rules
- **Integration (1):** `src/integration/autodesk_acc/+integration.ts` (OAuth 2.0 to Autodesk Platform Services / ACC).
- **Apps (2):** `operations` (`projects`, `messages`) and `configuration` (`connections`, `contacts`, `cost_matrix`).
- **Automations (7):** `sync_messages`, `classify_messages`, `reclassify_messages`, `extract_project_updates`, `analyze_bim_file`, `generate_payment_claim`, `daily_project_digest`.
- **Libraries:** `commercial.ts`, `bim-pipeline.ts`, `schedule-parsers.ts`, `trades.ts`, `zones.ts`, `ProjectTimeline.svelte`, `ifc-viewer/`, `conversations.ts`, `message-import.ts`, `MyConnections.svelte`.

## Verification gates

From `templates/construction`, run `bolt check`, `bolt build`, `bolt test`, and `bolt seed --bank=../../seed_bank`. From the realm root, run `bun run privacy` before pushing.
