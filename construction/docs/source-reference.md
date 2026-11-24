# Source Reference (`norbital_construction`)

Exact file map of the Construction Operations template.

## Workspace manifest, secrets & i18n

- `src/+workspace.ts` — workspace name, title, theme, apps (`operations`, `configuration`), and runtime limits
- `src/+secrets.ts` — `AUTODESK_CLIENT_ID`, `AUTODESK_CLIENT_SECRET` for Autodesk ACC OAuth
- `src/i18n/+messages.ts`, `src/i18n/+zh.messages.ts` — full English and Simplified Chinese UI, model, enum, state, and error catalogs

## Custom fields (6 co-located value types)

- `src/data/custom_field/bim_takeoff/` — classified & unmatched BIM asset takeoff lines with quantities, waste factors, unit rates, and subtotals (`cost_estimates.bim_assets`)
- `src/data/custom_field/bim_pin/` — inline IFC element tag, GlobalId, 3D coordinates, and camera viewpoint (`issues.bim_pin`, `contracts.bim_pin`)
- `src/data/custom_field/priced_lines/` — reusable exact-decimal priced line items (`contracts.lines`, `commercial_documents.lines`, `cost_estimates.additional_costs`)
- `src/data/custom_field/revision_trail/` — chronological revision history (`project_files.revisions`, `contracts.revisions`)
- `src/data/custom_field/project_zones/` — inline list of project storeys, zones, elevations, and grid axes (`projects.zones`)
- `src/data/custom_field/project_address/` — structured site address (`projects.address`)

## Record models (11) & syncs (4)

- `src/data/model/projects/` — project root (`project_role`, `autodesk_project_id`, terms, `zones`, `capture_rules`) and single-row Project Hub
  - `projects/contracts/` (`owned: true`) — upstream & downstream agreements + variation orders (`priced_lines`, `revision_trail`, `active_locked`)
  - `projects/commercial_documents/` (`owned: true`) — PO / DO / Invoice / Progress Claim / Credit Note ledger with 3-way matching and `issued_locked` / `certified_locked` / `settled_locked`
  - `projects/tasks/` (`owned: true`) — WBS work packages & milestones (`trade_specialty`, `schedule_range`, `actual_range`, 4D `bim_express_ids`)
    - `+schedule_file.sync.ts` — Primavera P6 (`.xer`), MS Project (`.xml`), CSV & XLSX import/export
    - `+autodesk_schedule.sync.ts` — Autodesk ACC/APS two-way schedule sync
  - `projects/issues/` (`owned: true`) — `seq`-numbered BIM-pinned defects, RFIs, clashes, safety & snags with `trade_specialty` and site `photos`
  - `projects/project_files/` (`owned: true`) — IFC models, Autodesk ACC models/sheets, drawings & docs (`revision_trail`, `bim_summary`, automatic `analyze_bim_file` trigger)
    - `+autodesk_files.sync.ts` — Autodesk ACC/APS sheet & model sync
  - `projects/cost_estimates/` (`owned: true`) — automated BIM asset takeoff + additional non-BIM costings + contingency (`baselined_locked`)
- `src/data/model/project_messages/` — global WhatsApp & email inbox & AI extraction state
- `src/data/model/contacts/` — trade subcontractors, clients, consultants & suppliers (`trade_specialty`, `phone`/`email` handles)
- `src/data/model/cost_matrix/` — quantifiable BIM asset classification & unit-rate rules + non-BIM default additional costings
  - `+matrix.sync.ts` — CSV/XLSX Costing Matrix import/export
- `src/data/model/communication_settings/` — personal WhatsApp/email intake & auto-extraction rules

## Integrations (1 custom + built-in WhatsApp & Email)

- `src/integration/autodesk_acc/+integration.ts` — Autodesk Platform Services / Construction Cloud OAuth 2.0 connection

## Apps (2)

- `src/app/operations/` — `projects`, `messages`
- `src/app/configuration/` — `connections`, `contacts`, `cost_matrix`

## Automations (7)

- `src/automation/+analyze_bim_file.automation.ts` — IFC STEP parser + currency-matched Costing Matrix classifier + additional costings pipeline
- `src/automation/+sync_messages.automation.ts` — `sys_message` create trigger + 15-minute safety net + manual sync from WhatsApp & email into `project_messages`
- `src/automation/+classify_messages.automation.ts` — AI (`sys_1`) project routing for pending messages
- `src/automation/+reclassify_messages.automation.ts` — manual re-run of routing across pending/unassigned messages
- `src/automation/+extract_project_updates.automation.ts` — AI (`sys_2`) extraction into `tasks`, `issues`, variation `contracts`, and `commercial_documents`
- `src/automation/+generate_payment_claim.automation.ts` — page RPC (`mode: 'call'`) drafting a `progress_claim` commercial document
- `src/automation/+daily_project_digest.automation.ts` — 06:00 SGT morning digest using SQL aggregate counts to notify teams of critical/high issues, blocked/overdue tasks, and commercial items

## Shared libraries

- `src/lib/dates.ts` — Effect `DateTime`-based calendar-date validation, arithmetic, and workspace-timezone conversion
- `src/lib/trades.ts` — canonical 16-trade subcontractor specialty list
- `src/lib/commercial.ts` — pure Effect `BigDecimal` line totals, 3-way PO/DO/Invoice matching, contract valuation, margin & cashflow math
- `src/lib/bim-pipeline.ts` — ISO-10303-21 IFC STEP parser, spatial storey/quantity extraction, currency-scoped Costing Matrix classification & estimate totals
- `src/lib/schedule-parsers.ts` — Primavera P6 `.xer` and MS Project `.xml` schedule parsers
- `src/lib/zones.ts` — batched `zone` validator against parent `projects.zones`
- `src/lib/ProjectTimeline.svelte` — 4D timeline with `create_slider` date scrubber, `register_control`, milestone diamonds, variation markers & BIM highlights
- `src/lib/ifc-viewer/` — browser 3D IFC viewer with `create_slider` X/Y/Z axis scrubbers, `register_control`, semantic token highlights & click-to-tag
- `src/lib/ai.ts`, `src/lib/conversations.ts`, `src/lib/message-import.ts`, `src/lib/MyConnections.svelte`, `src/lib/record-editor.svelte`, `src/lib/record-form.svelte`

## Access control

- `src/access_control/team/+team.ts` — 4 teams (`construction_administrators`, `project_delivery`, `commercial_qs`, `client_consultant`)
- `src/access_control/policy/` — 5 policies (`construction_read`, `construction_delivery`, `construction_commercial`, `construction_connections`, `construction_automation`)

## Tests

- `tests/test-runtime.ts` — scoped `TestWorkspace` acquisition and `id_of` record helpers
- `tests/commercial-and-contracts.test.ts` — BigDecimal totals, negative credit note cashflow, 3-way PO/DO/Invoice matching, contract revision & lock enforcement (persisted-state verified), progress claim RPC persistence, and non-admin `t.member(...)` RBAC across policies & custom verdicts
- `tests/bim-schedule-and-comms.test.ts` — IFC STEP parsing, multi-currency Costing Matrix classification, P6/MSP/CSV/Autodesk ACC syncs, automatic `project_files.create.effect` BIM takeoff & locked estimate refusal, baselined lock, zone validation, WhatsApp intake/classification/extraction via `fakes.ai.cassette` & `daily_project_digest` persisted notifications
