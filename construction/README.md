# Construction Operations

![Construction Operations application](docs/screenshots/application.webp)

A contractor project management workspace built for **main contractors coordinating trade subcontractors
as well as specialist subcontractors delivering their own packages**. Unstructured updates from
**WhatsApp** and **Email** sit alongside **3D BIM IFC models**, **hierarchical WBS schedules** and an
order-centered **SO / PO / VO + DO / Invoice** commercial ledger.

## Industry & Bolt capabilities

- **Industry:** Construction
- **Bolt capabilities:** `data_modeling`, `complex_files`, `ai_classification`, `channel_integrations`, `third_party_saas`, `scheduled_automations`

## Key capabilities

- **Unified BIM hub (`BIM`):** Organizes **3D Model & Issues**, **Cost Estimation** and **BIM Files**
  into clean nested tabs. Inspect `.ifc` models in the browser with `web-ifc` + Three.js (X/Y/Z section
  planes, severity and 4D highlights) and pin site issues directly to 3D elements by trade specialty.
- **Visual AI BIM archetype classification & costing:** Uploading an `.ifc` file triggers
  `analyze_bim_file`, which parses geometry, deduplicates identical elements into unique archetypes,
  renders isolated multi-angle isometric snapshots per archetype, and classifies each archetype visually
  against the active **Costing Matrix** (`cost_matrix`) — routing unseen or poorly tagged proxy elements
  to `unknown_unseen_catalog` for commercial review alongside editable **Additional Non-BIM Costings**.
- **Hierarchical WBS planning (`Programme & Tasks`):** Manage parent/child work breakdown trees, rollup
  progress and milestone diamonds across a virtualized **4D Timeline** (with date scrubber and variation
  markers), **Table** and **Board** views, synced with **Autodesk ACC/APS** (`autodesk_schedule`) or
  imported from **Primavera P6 (`.xer`)**, **MS Project (`.xml`)**, CSV and XLSX (`schedule_file`).
- **Order-centered commercial ledger (`Orders`):** Separates upstream **Sales Orders (SO)**, downstream
  **Purchase Orders (PO)** and **Variation Orders (VO)** (`contracts` with `priced_lines`, revision trail
  and EOT days), with nested **Transactions** (`commercial_documents`: Delivery Orders, Invoices,
  Progress Claims and Credit Notes), exact `BigDecimal` 3-way PO → DO → Invoice matching and one-click
  progress claim drafts (`generate_payment_claim`).
- **Business Partners & multi-channel intake:** Maintain **Customers**, **Vendors** and
  **Subcontractors** in a dedicated **Business Partners** module, while isolated **Configuration**
  connects **WhatsApp**, **Email** and **Autodesk ACC** for automatic message sync, voice transcription,
  AI update extraction and 06:00 daily digests.

## How it works

1. **Project setup & partners:** Each project declares its `project_role` (`main_contractor`,
   `subcontractor`, `specialist_contractor`), commercial terms, zones and capture rules. Counterparties
   are managed in **Business Partners** (`contacts`) tagged as `client`, `supplier` or `subcontractor`.
2. **BIM ingestion → visual costing:** An `.ifc` upload to `project_files` runs client-side `web-ifc`
   extraction and multi-angle archetype rendering, then invokes `analyze_bim_file` to visually match
   every archetype to `cost_matrix` rules, write itemized `cost_estimates` (`matched` vs
   `unknown_unseen_catalog`), and combine BIM quantities with manual non-BIM costs.
3. **Schedule & issue coordination:** `tasks` form a self-referential WBS hierarchy (`parent_task_id`,
   `wbs_path`) whose rollups drive the 4D timeline and link directly to BIM element IDs and 3D-pinned
   `issues`.
4. **Commercial execution:** `contracts` (SO/PO/VO) lock on activation; child `commercial_documents`
   (DOs, Invoices, Progress Claims) cross-check against parent POs and DOs in `BigDecimal` arithmetic.
5. **Channel automation:** `sync_messages` ingests WhatsApp and email traffic, `classify_messages` routes
   items to projects, `extract_project_updates` drafts tasks, issues or commercial entries, and
   `daily_project_digest` notifies project teams each morning.

## Apps and roles

| App               | Pages                                               | Audience / role                                                        |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| **Operations**    | Projects (Project Hub), Business Partners, Messages | `Project Managers`, `Commercial`, `Site Supervisors`, `Subcontractors` |
| **Configuration** | Connections, Costing Matrix                         | `Project Managers`, `Commercial` (isolated setup & master rates)       |

Opening a project lands on four clean **Project Hub** tabs: **Overview**, **Programme & Tasks**, **BIM**
(`3D Model & Issues` · `Cost Estimation` · `BIM Files`), and **Orders** (`SO / PO / VO` with nested
`Transactions: DO & Invoices`).

## Data model

11 models and 6 custom fields (`bim_takeoff`, `bim_pin`, `priced_lines`, `revision_trail`,
`project_zones`, `project_address`):

- **Project root (`projects`):** `project_role`, commercial terms, `autodesk_project_id`, `zones` and
  `capture_rules`.
  - Owned children: `contracts` (SO / PO / VO), `commercial_documents` (DO / Invoice / Claim / Credit
    Note), `tasks` (hierarchical WBS), `issues` (3D-pinned snags), `project_files` (`.ifc` & drawings),
    `cost_estimates`.
- **Partners, intake & configuration:** `contacts` (Customers, Vendors, Subcontractors),
  `project_messages`, `cost_matrix`, `communication_settings`.

## Automations and integrations

| Automation / integration   | Trigger / type                                   | Purpose                                                                                            |
| -------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `analyze_bim_file`         | `project_files` IFC upload; manual run           | Deduplicates IFC archetypes, classifies visually against `cost_matrix` and writes `cost_estimates` |
| `sync_messages`            | `sys_message` arrival; 15-min safety net; manual | Mirrors WhatsApp/email messages and transcribes voice notes into `project_messages`                |
| `classify_messages`        | Message intake; manual                           | Routes unstructured messages to projects                                                           |
| `extract_project_updates`  | Routed messages; manual                          | AI-extracts task updates, BIM issues, draft variations and commercial transactions                 |
| `generate_payment_claim`   | Manual (on a project)                            | Drafts a `BigDecimal` progress claim from active orders and transactions                           |
| `daily_project_digest`     | Daily 06:00                                      | Delivers project exception and progression digests                                                 |
| `autodesk_acc` integration | Two-way sync (`tasks`, `project_files`)          | Syncs Autodesk ACC/APS programmes, models and sheets alongside built-in WhatsApp & Email           |

## Getting started

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

A fresh workspace starts empty; configure business partners, costing matrix rules and connections
(WhatsApp, Email, Autodesk ACC) under **Operations → Business Partners** and **Configuration**.

- [Workflow guide](docs/README.md)
- [Source reference](docs/source-reference.md)
