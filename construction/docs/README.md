# Construction Operations — Workflows & Architecture

![Construction Operations application](docs/screenshots/application.webp)

## Daily main-contractor workflows

### 1. Project Overview & Cashflow (`Overview`)

- Read full project scope, commercial retention/tax/payment terms, spatial `zones`, site `address`, and WhatsApp `capture_rules`.
- Inspect committed subcontractor cost, projected margin %, realized vs projected cashflow, overdue alerts, and the native monthly **Inflow vs Outflow** `<Chart>`.

### 2. BIM coordination & site snagging (`BIM & Issues`, `BIM & Drawings`)

- Upload `.ifc` models, drawings, and method statements under **BIM & Drawings** (`project_files`); updating a file or version appends to its `revision_trail`.
- Orbit the 3D IFC model, scrub **X / Y / Z axis section planes**, click any element to tag an issue (`issues`, `seq`-numbered) with `bim_pin` and site `photos`, or trigger **Focus in 3D** from any row in the Issues table.

### 3. 4D schedule, milestones & site progress (`Schedule & Tasks`, `Site Progress`)

- Switch views of `tasks` via toolbar controls (**Timeline**, **Table**, **Board**), tracking work packages and **milestones** (`is_milestone: true`).
- Drag the **Programme time axis** scrubber to inspect active work, milestones achieved, approved EOT days, and highlight scheduled IFC elements in 3D.
- Post append-only entries under **Site Progress** (`progress_updates`) — or let WhatsApp extraction create them — to atomically advance `tasks` (`actual_range`, `progress_pct`) and recalculate BOQ `cost_items`.

### 4. Commercial control, quotes, variations & cashflow (`Commercial`)

- **BOQ & Costings (`cost_items`)**: `percentage`, `measured_qty`, or `milestone` lines computed with exact Effect `BigDecimal`.
- **Quotes & Revisions (`quotes`)**: client & subcontractor quotes using co-located `priced_lines`. `sent` quotes lock pricing; transitioning `sent -> revised` snapshots the prior revision into `revision_trail`; `accepted` locks permanently.
- **Changes / VOs (`change_orders`)**: itemized `priced_lines` auto-sum `cost_impact`; locks upon submission and permanently upon approval.
- **Claims & Cashflow (`payment_claims`)**: unified append-only ledger with a 2-step create flow (**Client Inflow** with `claim_valuation` vs **Subcontractor/Supplier Outflow**), or run **Draft progress claim** from the toolbar menu (`generate_payment_claim`). Locks upon leaving `draft`.

### 5. WhatsApp & multi-channel site sync (`Site Comms` & `Configuration → Connections`)

- Connect channels under **Configuration → Connections → Channels** and configure personal intake rules under **Intake & auto-extraction**.
- `sync_messages` mirrors messages, transcribes voice notes, `classify_messages` routes to projects, `extract_project_updates` creates structured records, and `daily_project_digest` notifies teams at 06:00 SGT with critical/high issues and blocked/overdue tasks.

## Access control

Source teams under `src/access_control/team/+team.ts`:

- `construction_administrators` — `construction_read`, `construction_delivery`, `construction_commercial`, `construction_connections`
- `project_delivery` — `construction_read`, `construction_delivery`, `construction_connections`
- `commercial_qs` — `construction_read`, `construction_commercial`, `construction_connections`
- `client_consultant` — `construction_read`

See [source-reference.md](source-reference.md) for the exact file-by-file inventory.
