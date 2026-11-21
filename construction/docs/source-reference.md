# Source Reference (`norbital_construction`)

Exact file map of the Construction Operations template.

## Workspace manifest & i18n

- `src/+workspace.ts` — workspace name, title, icon, and runtime limits
- `src/i18n/+messages.ts`, `src/i18n/+zh.messages.ts` — English and Simplified Chinese UI/error catalogs

## Custom fields (6 co-located value types)

- `src/data/custom_field/project_zones/` — inline list of project storeys, zones, elevations, and grid axes (`projects.zones`)
- `src/data/custom_field/bim_pin/` — inline IFC element tag, GlobalId, 3D coordinates, and camera viewpoint (`issues.bim_pin`, `change_orders.bim_pin`)
- `src/data/custom_field/priced_lines/` — reusable exact-decimal priced line items with inline row editor & table renderer (`quotes.lines`, `change_orders.lines`)
- `src/data/custom_field/revision_trail/` — chronological revision history table (`project_files.revisions`, `quotes.revisions`)
- `src/data/custom_field/claim_valuation/` — client progress valuation totals & BOQ snapshot (`payment_claims.valuation`)
- `src/data/custom_field/project_address/` — structured site address (`projects.address`)

## Record models (12)

- `src/data/model/projects/` — project root and Project Hub
  - `projects/project_files/` (`owned: true`) — IFC models, drawings, specs, method statements with `revision_trail`
  - `projects/issues/` (`owned: true`) — `seq`-numbered BIM-pinned defects, RFIs, clashes, safety & snags with site `photos`
  - `projects/tasks/` (`owned: true`) — WBS work packages & milestones (`is_milestone`) with `schedule_range`, `actual_range`, and 4D `bim_express_ids`
  - `projects/progress_updates/` (`owned: true`) — append-only site diary with atomic batch propagation to `tasks` & `cost_items`
  - `projects/cost_items/` (`owned: true`) — configurable BOQ lines (`percentage` | `measured_qty` | `milestone`)
  - `projects/quotes/` (`owned: true`) — `seq`-numbered client & subcontractor quotes with `priced_lines`, `revision_trail`, `sent_locked` & `accepted_locked`
  - `projects/change_orders/` (`owned: true`) — `seq`-numbered VOs, instructions & EOTs with `priced_lines`, `bim_pin`, `submitted_locked` & `approved_locked`
  - `projects/payment_claims/` (`owned: true`) — `seq`-numbered polymorphic cashflow ledger (`inflow` / `outflow` / `adjustment`), 2-step create UI, `claim_valuation`, `submitted_locked` & `settled_locked`
- `src/data/model/project_messages/` — global WhatsApp/Telegram/email/Slack/Discord inbox & AI extraction state
- `src/data/model/contacts/` — subcontractors, suppliers, consultants & client contacts (`phone`/`email` formats & handle keys)
- `src/data/model/communication_settings/` — personal message intake / auto-extraction rules

## Apps (2)

- `src/app/operations/` — `projects`, `messages`
- `src/app/configuration/` — `connections`, `contacts`

## Automations (6)

- `src/automation/+sync_messages.automation.ts` — scheduled (5 min) + manual sync from `sys_message` into `project_messages`
- `src/automation/+classify_messages.automation.ts` — AI (`sys_1`) project routing for pending messages
- `src/automation/+reclassify_messages.automation.ts` — manual re-run of routing across pending/unassigned messages
- `src/automation/+extract_project_updates.automation.ts` — AI (`sys_2`) extraction of progress updates, issues, draft VOs & tasks
- `src/automation/+generate_payment_claim.automation.ts` — page RPC (`mode: 'call'`) drafting a client `payment_claims` valuation from BOQ + approved VOs
- `src/automation/+daily_project_digest.automation.ts` — 06:00 SGT morning digest notifying teams of critical/high issues & blocked/overdue tasks

## Shared libraries

- `src/lib/claims.ts` — pure Effect `BigDecimal` BOQ, quote, variation, valuation, margin, and monthly cashflow math
- `src/lib/zones.ts` — shared batched `zone` validator against parent `projects.zones`
- `src/lib/ProjectTimeline.svelte` — 4D timeline with date scrubber, milestone diamonds, VO markers & BIM highlights
- `src/lib/ifc-viewer/` — browser 3D IFC viewer with X/Y/Z axis scrubbers, severity/4D highlights & click-to-tag
- `src/lib/ai.ts`, `src/lib/conversations.ts`, `src/lib/message-import.ts`, `src/lib/MyConnections.svelte`
- `src/lib/record-editor.svelte`, `src/lib/record-form.svelte`

## Access control

- `src/access_control/team/+team.ts` — 4 teams (`construction_administrators`, `project_delivery`, `commercial_qs`, `client_consultant`)
- `src/access_control/policy/` — 5 policies (`construction_read`, `construction_delivery`, `construction_commercial`, `construction_connections`, `construction_automation`)

## Tests

- `tests/claims-and-costings.test.ts` — BigDecimal BOQ/milestone math, zone validation, quote/VO/claim ledger locks, `seq` numbering, batch progress propagation & payment claim RPC
- `tests/bim-and-messaging.test.ts` — `project_files` revision trail, BIM-pinned `issues`, WhatsApp intake/sync/dedupe/AI extraction & daily digest
