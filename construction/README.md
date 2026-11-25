# Construction Operations

![Construction Operations application](docs/screenshots/application.webp)

A generic contractor project management workspace for **both main contractors coordinating specialized
trade subcontractors and subcontractors or specialist contractors managing their own projects**.
Unstructured updates from **WhatsApp**, **Email** and structured **BIM IFC** models are organized into
three pillars: **Cashflow**, **Progression**, and **Documentation & BIM Costing**.

## Key capabilities

- **Automated BIM IFC takeoff & costing:** Upload `.ifc` models into `project_files` (with automatic
  `revision_trail` and Autodesk ACC sync). `analyze_bim_file` parses ISO-10303-21 STEP files on upload,
  classifies assets against the quantifiable **Costing Matrix** (`cost_matrix`), flags unmatched assets,
  and combines quantified BIM totals with editable **Additional Non-BIM Costings** inside `cost_estimates`.
- **3D BIM viewer & issue tracking:** Inspect `.ifc` models with X/Y/Z axis section planes and 4D/severity
  highlights, and pin site **Issues & Snags** (`issues`) directly to 3D elements by trade specialty
  (`roofing`, `flooring`, `mne`, `electrical`, `plumbing`, `hvac`, `structural`, `facade`, `piling`, etc.).
- **Large-scale planning & progression:** Manage `tasks` across **Timeline** (4D scrubber and milestone
  diamonds), **Table** and **Board** views, with two-way **Autodesk ACC/APS** sync (`autodesk_schedule`)
  and **Primavera P6 (`.xer`)**, **MS Project (`.xml`)**, CSV and XLSX imports (`schedule_file`).
- **Contracts, PO / DO / Invoice matching & cashflow:** Manage upstream and downstream `contracts`
  (with `priced_lines`, revision history, EOT days and activation locks) alongside an exact `BigDecimal`
  `commercial_documents` ledger featuring automatic **3-way PO → DO → Invoice matching** and one-click
  progress claim drafts (`generate_payment_claim`).
- **WhatsApp & email intake:** Connect personal or workspace **WhatsApp**, **Email** and **Autodesk ACC**
  under isolated **Configuration**; inbound messages sync automatically, transcribe voice notes, route to
  projects, extract task/issue/commercial updates, and deliver 06:00 daily digests.

## Apps and roles

| App               | Pages                                 | Audience / role                                                        |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| **Operations**    | Projects (Project Hub), Messages      | `Project Managers`, `Commercial`, `Site Supervisors`, `Subcontractors` |
| **Configuration** | Connections, Contacts, Costing Matrix | `Project Managers`, `Commercial` (isolated setup & master data)        |

Opening a project lands on the single-row **Project Hub** tabs: **Overview**, **Programme & Tasks**,
**BIM & Issues**, **Cost Estimations**, **BIM & Documents**, **Contracts & VOs**, and **PO / DO / Invoices**.

## Data model

11 models and 6 custom fields (`bim_takeoff`, `bim_pin`, `priced_lines`, `revision_trail`,
`project_zones`, `project_address`):

- **Project root (`projects`):** holds `project_role` (`main_contractor` / `subcontractor` /
  `specialist_contractor`), commercial terms, `autodesk_project_id`, `zones` and `capture_rules`.
  - Owned children: `contracts`, `commercial_documents`, `tasks`, `issues`, `project_files`,
    `cost_estimates`.
- **Intake & configuration:** `project_messages`, `contacts`, `cost_matrix`, `communication_settings`.

## Automations and integrations

| Automation / integration  | Trigger / type                                       | Purpose                                                                                     |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `analyze_bim_file`        | `project_files` IFC upload; manual run               | Parses IFC geometry/classes, prices against `cost_matrix` and writes `cost_estimates`       |
| `sync_messages`           | `sys_message` arrival; 15-min safety net; manual run | Mirrors WhatsApp/email messages and transcribes voice notes into `project_messages`         |
| `classify_messages`       | Message intake; manual run                           | Routes unstructured messages to projects                                                    |
| `extract_project_updates` | Routed messages; manual run                          | AI-extracts task progression, BIM issues, draft variations and PO/DO/Invoice records        |
| `generate_payment_claim`  | Manual (on a project)                                | Drafts a `BigDecimal` progress claim from active contracts and commercial documents         |
| `daily_project_digest`    | Daily 06:00                                          | Delivers project exception and progression digests                                          |
| `autodesk` integration    | Two-way sync (`tasks`, `project_files`)              | Connects Autodesk ACC/APS programmes, models and sheets alongside built-in WhatsApp & Email |

## Getting started

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

A fresh workspace starts empty; configure trade contacts, costing matrix rules and connections
(WhatsApp, Email, Autodesk ACC) under **Configuration**.

- [Workflow guide](docs/README.md)
- [Source reference](docs/source-reference.md)
