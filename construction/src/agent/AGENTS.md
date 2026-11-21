# Construction Operations — Template Authoring Guide

Main-contractor construction PMS (`norbital_construction`) built around co-located typed values, append-only commercial ledgers, exact `BigDecimal` math, and native Bolt views.

## Structure

- **Models (12)** under `src/data/model/`:
  - `projects/` — root project with inline `zones` (`project_zones`), `payment_terms_days`, retention/tax terms, `capture_rules`, and `address`
    - `project_files/` (`owned: true`) — IFC models, drawings, specs, method statements with `revision_trail`
    - `issues/` (`owned: true`) — `seq`-numbered defects, RFIs, clashes, safety, snags with `photos` and `bim_pin`
    - `tasks/` (`owned: true`) — WBS work packages & milestones (`is_milestone`) with `schedule_range`, `actual_range`, and 4D `bim_express_ids`
    - `progress_updates/` (`owned: true`) — append-only site diary propagating max batch progress to `tasks` & `cost_items`
    - `cost_items/` (`owned: true`) — configurable BOQ lines (`percentage` | `measured_qty` | `milestone`)
    - `quotes/` (`owned: true`) — `seq`-numbered client & subcon quotes with `priced_lines`, `revision_trail`, `sent_locked` & `accepted_locked`
    - `change_orders/` (`owned: true`) — `seq`-numbered VOs/EOTs with `priced_lines`, `bim_pin`, `submitted_locked` & `approved_locked`
    - `payment_claims/` (`owned: true`) — `seq`-numbered polymorphic cashflow ledger (`inflow` with `claim_valuation`, `outflow` subcon/supplier bills, `adjustment` offsetting entries), `submitted_locked` & `settled_locked`
  - `project_messages/` — global WhatsApp/Telegram/email/Slack/Discord inbox routed to projects
  - `contacts/` — subcontractor, supplier, consultant & client directory (`format: 'phone'`, `format: 'email'`)
  - `communication_settings/` — per-member intake / auto-extraction rules
- **Custom Fields (6)** under `src/data/custom_field/`: `project_zones`, `bim_pin`, `priced_lines`, `revision_trail`, `claim_valuation`, `project_address`.
- **Apps (2)** under `src/app/`:
  - `operations` — `projects`, `messages` (each model has one primary home; `tasks` lives in the Project Hub)
  - `configuration` — `connections` (`Channels` + `Intake & auto-extraction` tabs), `contacts`
- **Automations (6)** under `src/automation/`:
  - `sync_messages`, `classify_messages`, `reclassify_messages`, `extract_project_updates`, `generate_payment_claim`, `daily_project_digest`
- **Libraries** under `src/lib/`:
  - `claims.ts` — pure Effect `BigDecimal` BOQ, quote, VO, valuation, margin & cashflow math
  - `zones.ts` — shared batched validator checking child `zone` codes against `projects.zones`
  - `ProjectTimeline.svelte` — 4D timeline with date scrubber, milestone diamonds, VO markers & BIM highlights
  - `ifc-viewer/` — browser 3D IFC viewer with X/Y/Z axis section scrubbers & click-to-tag issues
  - `ai.ts`, `conversations.ts`, `message-import.ts`, `MyConnections.svelte`

## Key invariants

1. **Exact `BigDecimal` arithmetic.** Zero floating-point money math; store all line/valuation money values as exact decimal strings.
2. **Co-located typed values.** Reuse built-in kinds (`period`, `money`, `seq`, `state`) and shared custom fields (`priced_lines`, `revision_trail`, `bim_pin`, `claim_valuation`, `project_zones`). Validate child `zone` strings via `validateProjectZones`.
3. **Immutable ledgers & documents.** `progress_updates` locks numeric progress after post; `quotes` locks `sent` & `accepted`; `change_orders` locks `submitted`/`under_review`/`approved`; `payment_claims` locks on leaving `draft`.
4. **Polymorphic step UI & single scroll owner.** `payment_claims` uses a 2-step create flow (`inflow` vs `outflow`); every Project Hub tab owns one concern and one scroll container.
5. **Verification gates.** From `templates/construction`, run `bolt build`, `bolt check`, `bolt test`, and `bolt seed --bank=../../seed_bank`. From the realm root, run `bun run privacy` before pushing.
