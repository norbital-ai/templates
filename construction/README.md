# Construction Operations (`norbital_construction`)

![Construction Operations application](docs/screenshots/application.webp)

A **main-contractor construction project management system (PMS)** under one roof — built on co-located typed values, append-only commercial ledgers, exact `BigDecimal` math, and native Bolt views.

## Core capabilities

1. **3D BIM IFC viewer with click-to-tag issues & site photos**
   - Upload `.ifc` models into `project_files` (with automatic `revision_trail`).
   - Inspect IFC properties, scrub **3D X / Y / Z axis section planes**, highlight issues by severity or 4D schedule date, click any 3D element to pin a `seq`-numbered issue (`bim_pin` co-locates expressID, element name, GlobalId, 3D coordinates, and camera viewpoint), and attach site `photos`.
2. **4D programme timeline, milestones & structured WBS tasks**
   - Switch between **Timeline** (4D date-axis scrubber, milestone diamonds, VO markers), **Table**, and **Board** views of `tasks`.
   - Post append-only **Site Progress** entries (`progress_updates`) to atomically advance linked `tasks` (`actual_range`, `progress_pct`) and recalculate BOQ `cost_items`.
3. **WhatsApp, Telegram, email, Slack & Discord auto-sync**
   - Connect personal or workspace channels in **Configuration → Connections**.
   - Messages sync automatically (`sync_messages`), transcribe voice notes, route to projects (`classify_messages`), AI-extract (`extract_project_updates`) structured progress updates, issues, draft VOs, and tasks, and send 06:00 SGT digests (`daily_project_digest`).
4. **Main-contractor commercial & cashflow roof (exact `BigDecimal`)**
   - **BOQ & Costings (`cost_items`)**: `percentage`, `measured_qty`, or `milestone` lines.
   - **Quotes & Revisions (`quotes`)**: client & subcontractor quotes with reusable `priced_lines`; `sent` quotes lock pricing, `sent -> revised` snapshots prior revisions into `revision_trail`, and `accepted` locks permanently.
   - **Changes / VOs / EOTs (`change_orders`)**: itemized `priced_lines` auto-sum `cost_impact`; locks upon leaving `draft`.
   - **Unified Cashflow & Payment Claims (`payment_claims`)**: append-only `seq`-numbered ledger with a **2-step polymorphic create flow** (**Client Inflow** carrying co-located `claim_valuation` vs **Subcontractor/Supplier Outflow**), offsetting `adjustment` entries, native monthly **Inflow vs Outflow** `<Chart>`, committed subcon cost & projected margin %, and one-click **Draft progress claim** (`generate_payment_claim`).

## Navigation & Project Hub

Every model has one primary home across 2 apps:

- **Operations**: `Projects` (portfolio & Project Hub), `Messages` (global synced inbox).
- **Configuration**: `Connections` (`Channels` & `Intake & auto-extraction`), `Contacts`.

Opening a project lands on the **Project Hub** (one concern & one scroll owner per tab):

| Tab                  | What lives here                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**         | Readable project details (`zones`, `address`, commercial terms), cashflow KPIs, and native monthly **Inflow vs Outflow** `<Chart>`. |
| **BIM & Issues**     | 3D IFC viewer (X/Y/Z axis scrubbers + click-to-tag) alongside the scoped **Issues & RFIs** table with **Focus in 3D**.              |
| **BIM & Drawings**   | `project_files` register with automatic `revision_trail`.                                                                           |
| **Schedule & Tasks** | Same-model view switcher (**Timeline** / **Table** / **Board**) for `tasks` & milestones.                                           |
| **Site Progress**    | Append-only `progress_updates` diary.                                                                                               |
| **Commercial**       | Native level-2 tabs for **BOQ & Costings**, **Quotes & Revisions**, **Changes / VOs**, and **Claims & Cashflow**.                   |
| **Site Comms**       | Project-scoped synced messages with Sync & Extract toolbar actions.                                                                 |

## Data model (12 models, 6 custom fields)

- `projects` — project root, commercial terms, inline `zones` (`project_zones`), `capture_rules`, and `address` (`project_address`).
  - Owned children (`owned: true`): `project_files`, `issues`, `tasks`, `progress_updates`, `cost_items`, `quotes`, `change_orders`, `payment_claims`.
- Shared root models: `project_messages`, `contacts`, `communication_settings`.
- Reusable custom fields: `project_zones`, `bim_pin`, `priced_lines`, `revision_trail`, `claim_valuation`, `project_address`.

See [docs/README.md](docs/README.md) and [docs/source-reference.md](docs/source-reference.md) for workflows and exact source inventory.

## Development & verification

```bash
bolt build
bolt check
bolt test
```
