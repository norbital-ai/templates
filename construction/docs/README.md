# Construction Operations — Workflows & Architecture

![Construction Operations application](screenshots/application.webp)

## Generic contractor design (Main Contractor, Subcontractor & Specialist Contractor)

Each project declares `project_role` (`main_contractor`, `subcontractor`, or `specialist_contractor`). Contracts (`contracts`) and commercial documents (`commercial_documents`) distinguish `upstream` (client / main contractor revenue) from `downstream` (subcontractor / supplier cost), while `trade_specialty` classifies 16 trade packages (`roofing`, `flooring`, `mne`, `electrical`, `plumbing`, `hvac`, `structural`, `facade`, `piling`, `civil_earthworks`, `waterproofing`, `fire_protection`, `elv_security`, `finishing`, `landscaping`, `general`) across contacts, contracts, schedule tasks, issues, and the Costing Matrix.

## Core workflows

### 1. Project Overview & Cashflow (`Overview`)

- Review project role, commercial retention/tax/payment terms, Autodesk ACC project ID, spatial `zones`, site `address`, and message `capture_rules`.
- Track revised upstream contract sum, downstream committed cost, projected margin %, net projected cashflow, overdue payables/receivables, and the SQL-aggregated commercial `<Chart>`.

### 2. Large-Scale Progression & BIM Issues (`Programme & Tasks` & `BIM & Issues`)

- Manage WBS work packages and milestones (`tasks`) across **Timeline** (4D date scrubber + variation markers), **Table**, and **Board** views.
- Pull and push large programmes via **Autodesk ACC/APS** (`tasks.syncs.autodesk_schedule`), or upload **Primavera P6 (`.xer`)**, **MS Project (`.xml`)**, CSV, and XLSX schedules (`tasks.syncs.schedule_file`).
- Inspect the live 3D IFC model with X/Y/Z axis section planes, severity/4D highlights, and click-to-tag **Issues & Snags** (`issues`) right beside the single project issues register.

### 3. Automated BIM Cost Estimation & Documents (`Cost Estimations` & `BIM & Documents`)

- Upload `.ifc` models and drawings into `project_files` (with automatic `revision_trail` and optional Autodesk ACC sheet/model sync via `project_files.syncs.autodesk_files`).
- Uploading an `.ifc` model automatically schedules `analyze_bim_file`:
  1. Parses the ISO-10303-21 IFC STEP geometry/property hierarchy (`src/lib/bim-pipeline.ts`).
  2. Matches each physical asset by IFC class and keywords against active currency-matched rules in `cost_matrix` (applying area/length/volume/count quantity basis and waste factors).
  3. Surfaces unmatched assets explicitly so commercial teams can extend the Costing Matrix or price them manually.
  4. Combines quantified BIM costs with editable **Additional Non-BIM Costings** (`additional_costs`: preliminaries, hoisting, permits, testing, contingency) inside `cost_estimates`. Baselined estimates lock rates and totals permanently.

### 4. Contracts, PO / DO / Invoice 3-Way Match & Claims (`Contracts & VOs` & `PO / DO / Invoices`)

- **Contracts & Variations (`contracts`)**: upstream & downstream agreements plus variation orders (`variation_order`) with itemized `priced_lines`, EOT days, revision history (`revision_trail`), and lock upon activation.
- **Commercial Ledger (`commercial_documents`)**: `purchase_order`, `delivery_order`, `invoice`, `progress_claim`, and `credit_note` rows with exact Effect `BigDecimal` totals, automatic **3-way PO → DO → Invoice match evaluation** (`match_status`), lock upon issuance, and one-click **Draft progress claim** (`generate_payment_claim`).

### 5. WhatsApp & Email Intake (`Messages` & isolated `Configuration`)

- All external integrations (`whatsapp`, `email`, `autodesk_acc`), subcontractor `contacts`, quantifiable `cost_matrix` rules, and personal intake rules (`communication_settings`) are isolated inside the **Configuration** app.
- `sync_messages` ingests WhatsApp and email messages on new `sys_message` creation (plus a 15-minute safety net, deduplicated, with voice transcription), `classify_messages` routes them to projects, `extract_project_updates` turns unstructured site chats/emails into structured `tasks`, `issues`, draft variation `contracts`, and `commercial_documents`, and `daily_project_digest` sends 06:00 SGT exception digests.

## Access control

Source teams under `src/access_control/team/+team.ts`:

- `construction_administrators` — `construction_read`, `construction_delivery`, `construction_commercial`, `construction_connections`
- `project_delivery` — `construction_read`, `construction_delivery`, `construction_connections`
- `commercial_qs` — `construction_read`, `construction_commercial`, `construction_connections`
- `client_consultant` — `construction_read`

See [source-reference.md](source-reference.md) for the exact file-by-file inventory.
