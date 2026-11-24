# Construction Operations (`norbital_construction`)

![Construction Operations application](docs/screenshots/application.webp)

A generic **contractor project management system (PMS)** designed for **both main contractors coordinating specialized trade subcontractors and subcontractors or specialist contractors managing their own projects**. Unstructured updates from **WhatsApp**, **Email**, and structured **BIM IFC** models are organized into three operational pillars: **Cashflow**, **Progression**, and **Documentation & BIM Costing**.

## Core capabilities

1. **Automated BIM IFC takeoff & cost estimation pipeline**
   - Upload `.ifc` models into `project_files` (automatic `revision_trail` + Autodesk ACC model/sheet sync).
   - `analyze_bim_file` automatically parses the ISO-10303-21 IFC STEP file on upload, classifies every physical asset against the quantifiable **Costing Matrix** (`cost_matrix`), flags unmatched assets for review, and combines quantified BIM subtotals with editable **Additional Non-BIM Costings** (preliminaries, hoisting, permits, testing, contingency) inside `cost_estimates`.
   - Inspect models in the 3D IFC viewer (X/Y/Z axis section planes, severity/4D highlights, click-to-tag `issues` with `bim_pin` and site `photos`).
2. **Large-scale project planning & progression (`tasks` & `issues`)**
   - Switch between **Timeline** (4D date-axis scrubber, milestone diamonds, variation markers), **Table**, and **Board** views of `tasks`.
   - Import large-scale programmes directly from **Autodesk ACC/APS** (`autodesk_schedule` two-way sync), **Primavera P6 (`.xer`)**, **MS Project (`.xml`)**, CSV, and XLSX (`schedule_file`).
   - Track BIM-pinned **Issues & Snags** (`issues`) by trade specialty (`roofing`, `flooring`, `mne`, `electrical`, `plumbing`, `hvac`, `structural`, `facade`, `piling`, etc.) as part of progression and 3D visualization.
3. **Contract management, PO / DO / Invoice matching & cashflow**
   - **Contracts (`contracts`)**: unified upstream (main contract / client subcontract) and downstream (trade subcontract / supply agreement / variation order) ledger with `priced_lines`, revision archival (`revision_trail`), EOT days, and permanent lock upon activation.
   - **Commercial Ledger (`commercial_documents`)**: exact `BigDecimal` ledger for **POs**, **DOs**, **Invoices**, **Progress Claims**, and **Credit Notes** across inflows and outflows, with automatic **3-way PO → DO → Invoice matching** (`match_status`), SQL-aggregated commercial `<Chart>`, and one-click **Draft progress claim** (`generate_payment_claim`).
4. **WhatsApp & Email intake into structured records**
   - Connect personal or workspace **WhatsApp**, **Email**, and **Autodesk ACC** accounts under the isolated **Configuration** app.
   - Messages sync automatically on new `sys_message` arrival (with a 15-minute safety net via `sync_messages`), transcribe voice notes, route to projects (`classify_messages`), AI-extract (`extract_project_updates`) structured task progression, BIM issues, draft variation orders, and PO/DO/Invoice records, and deliver 06:00 SGT digests (`daily_project_digest`).

## Navigation & isolated configuration

Every model has one primary home across 2 apps:

- **Operations**: `Projects` (portfolio & single-row Project Hub), `Messages` (WhatsApp & email inbox with Sync, Route, and Extract toolbar actions).
- **Configuration** (isolated): `Connections` (`WhatsApp`, `Email`, `Autodesk ACC` + personal intake rules), `Contacts` (trade subcontractors, clients, consultants, suppliers), `Costing Matrix` (quantifiable BIM classification & unit-rate rules).

Opening a project lands on the single-row **Project Hub** (`RecordShell` native tabs):

| Tab                    | What lives here                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**           | Project role (`main_contractor` / `subcontractor` / `specialist_contractor`), terms, spatial `zones`, cashflow KPIs, and SQL-aggregated commercial `<Chart>`. |
| **Programme & Tasks**  | 4D programme (`Timeline` / `Table` / `Board`) with Autodesk ACC, Primavera P6 (`.xer`), MS Project (`.xml`), and CSV/XLSX sync.                               |
| **BIM & Issues**       | Split 3D IFC viewer (axis section scrubbers, click-to-tag) alongside the BIM-pinned **Issues & Snags** (`issues`) register.                                   |
| **Cost Estimations**   | Automated `cost_estimates` combining IFC asset takeoff, matrix coverage checks, and editable non-BIM additional costings.                                     |
| **BIM & Documents**    | `project_files` register for `.ifc` models, drawings, specifications, and Autodesk ACC sheets with automatic `revision_trail`.                                |
| **Contracts & VOs**    | Unified upstream & downstream **Contracts & Variations** (`contracts`) with `priced_lines` and activation locks.                                              |
| **PO / DO / Invoices** | Unified **Commercial Ledger** (`commercial_documents`) with 3-way PO → DO → Invoice matching and one-click `generate_payment_claim`.                          |

## Data model (11 models, 6 custom fields)

- `projects` — project root (`project_role`, commercial terms, `autodesk_project_id`, `zones`, `capture_rules`, `address`).
  - Owned children (`owned: true`): `contracts`, `commercial_documents`, `tasks`, `issues`, `project_files`, `cost_estimates`.
- Shared & configuration models: `project_messages`, `contacts`, `cost_matrix`, `communication_settings`.
- Reusable custom fields (6): `bim_takeoff`, `bim_pin`, `priced_lines`, `revision_trail`, `project_zones`, `project_address`.

See [docs/README.md](docs/README.md) and [docs/source-reference.md](docs/source-reference.md) for workflows and exact source inventory.

## Development & verification

```bash
bolt build
bolt check
bolt test
```
