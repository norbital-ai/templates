# Norbital Templates

Public starter workspaces for [Norbital](https://norbital.ai). Every directory is a standalone,
filesystem-first Bolt project that installs, checks, builds and tests with the public Bolt CLI — and
forks cleanly into a tenant workspace.

## Template gallery

| Template                                       | Directory            | Handle                       | Industry                | Purpose                                                                                                                                                                                     |
| ---------------------------------------------- | -------------------- | ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**Blank**](./blank/)                          | `blank/`             | `norbital-blank`             | General                 | Minimal starter with one read-only `notes` model and no prebuilt apps                                                                                                                       |
| [**Construction Operations**](./construction/) | `construction/`      | `norbital-construction`      | Construction            | Main & subcontractor PMS: 3D BIM IFC viewer & visual AI costing, hierarchical WBS & Autodesk/P6/MSP schedules, SO/PO/VO & DO/Invoice transactions, Business Partners, WhatsApp/email intake |
| [**CRM**](./crm/)                              | `crm/`               | `norbital-hq`                | Professional Services   | Lead-to-client CRM: Apollo/CSV import, multi-channel intake, cited web research, meeting voice profiles, AI SOW extraction, PDF agreements                                                  |
| [**Field Operations**](./field-operations/)    | `field-operations/`  | `norbital-field-operations`  | Construction            | Daily site dispatch, contractor job reporting, WhatsApp Envoy and mechanical + AI photo integrity review                                                                                    |
| [**Fleet Management**](./fleet-management/)    | `fleet-management/`  | `norbital-fleet-management`  | Logistics & Fleet       | Real-time GPS transponder tracking, live vehicle map & live alerts, day-to-day route schedule & ETAs, geofences and telemetry alerting                                                      |
| [**HRMS**](./hrms/)                            | `hrms/`              | `norbital-hr`                | Human Resources         | Multi-country HR, attendance, leave, claims, loans and payroll with sealed dated jurisdiction law and an append-only ledger                                                                 |
| [**Portfolio Manager**](./portfolio-manager/)  | `portfolio-manager/` | `norbital-portfolio-manager` | Finance                 | Family-office book with multi-currency valuation, technical signals, browser market research and a cited daily agent PDF report                                                             |
| [**Service Scheduling**](./scheduling/)        | `scheduling/`        | `norbital-scheduling`        | Field & Local Services  | Generic appointment booking & dispatch: self-service customer portal, runtime service catalog, route-aware matching and GPS ETA alerts                                                      |
| [**Trade Operations**](./trade-operations/)    | `trade-operations/`  | `norbital-trade-operations`  | Trading & Manufacturing | Order-centered B2B sales & purchasing with pricing floors, approvals, bilingual contracts, credit releases and two-way Kingdee KIS ERP sync                                                 |
| [**Treasury**](./treasury/)                    | `treasury/`          | `norbital-treasury`          | Finance                 | Bank credit facilities, drawdowns, AI/OCR bank-advice reading, PO/invoice cross-checks, locked month-ends and FX hedging                                                                    |

**Directory vs handle:** The directory name controls the public URL (`norbital.ai/templates/<directory>`);
the handle (`norbital.template.json`'s `key`) is the stable catalogue identity. They may differ and stay
independent.

Every public template appears automatically in the [Norbital template gallery](https://norbital.ai/templates)
using its `norbital.template.json`, `README.md` (and `README.zh.md`) and `docs/screenshots/application.webp` (1920×1080).

## Standardized Bolt capabilities

Each template declares its `industry` and standardized `capabilities` in `norbital.template.json` so
teams can search by vertical or by the Bolt framework mechanisms a workspace demonstrates:

| Capability ID            | Label                       | What it demonstrates in Bolt                                                                                                                   |
| ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `data_modeling`          | Data Modeling               | Typed `+model.ts` tables, relations, computed CEL fields, state locks and SQL migrations                                                       |
| `complex_business_logic` | Complex Business Logic      | Multi-stage domain engines (e.g., dated jurisdiction payroll, credit-facility accruals, lot-level margins)                                     |
| `workflow_approvals`     | Approvals & Governance      | Native `ctx.approve` provisional writes, multi-step team reviews and immutable audit trails                                                    |
| `scheduled_automations`  | Automations & Schedules     | Background cron schedules and event-driven model write triggers (`+*.automation.ts`)                                                           |
| `ai_classification`      | AI Classification & Triage  | Bounded LLM classification, visual archetype matching, photo suspicion review and intake extraction                                            |
| `document_intelligence`  | Document Intelligence & OCR | PDF/image extraction (OCR), structured spreadsheet import/export and templated PDF generation                                                  |
| `browser_automation`     | Web & Browser Automation    | Automated `ctx.web` / `ctx.browser` research for leads, statutory law monitoring and market briefings                                          |
| `channel_integrations`   | Messaging & Channels        | Built-in WhatsApp, Email, Telegram, Slack and Discord syncs plus Envoy assistants                                                              |
| `third_party_saas`       | Third-Party SaaS & ERP      | Custom `+integration.ts` connectors & `+*.sync.ts` pipelines (Kingdee KIS, Autodesk ACC, Apollo, Google Calendar/Routes, GPS gateways, MAS FX) |
| `gps_geospatial`         | GPS & Geospatial            | Native `<Map>` rendering, point coordinates, geofences, EXIF geotag checks and driving-time ETAs                                               |
| `complex_files`          | Complex Files & Media       | Specialist file pipelines (3D BIM `.ifc` parsing/rendering, P6 `.xer`/MSP `.xml`, SHA-256/PDQ/EXIF photo forensics)                            |
| `self_service_portal`    | Self-Service Portals        | External customer booking portals, employee self-service apps and dedicated kiosk/mobile views                                                 |

### Capability matrix

| Template                                   | Industry                | Bolt capabilities                                                                                                                                              |
| ------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Blank](./blank/)                          | General                 | `data_modeling`                                                                                                                                                |
| [Construction Operations](./construction/) | Construction            | `data_modeling`, `complex_files`, `ai_classification`, `channel_integrations`, `third_party_saas`, `workflow_approvals`                                        |
| [CRM](./crm/)                              | Professional Services   | `data_modeling`, `channel_integrations`, `third_party_saas`, `ai_classification`, `browser_automation`, `document_intelligence`, `scheduled_automations`       |
| [Field Operations](./field-operations/)    | Construction            | `data_modeling`, `channel_integrations`, `ai_classification`, `complex_files`, `gps_geospatial`, `scheduled_automations`                                       |
| [Fleet Management](./fleet-management/)    | Logistics & Fleet       | `data_modeling`, `gps_geospatial`, `third_party_saas`, `scheduled_automations`                                                                                 |
| [HRMS](./hrms/)                            | Human Resources         | `data_modeling`, `complex_business_logic`, `workflow_approvals`, `browser_automation`, `document_intelligence`, `self_service_portal`, `scheduled_automations` |
| [Portfolio Manager](./portfolio-manager/)  | Finance                 | `data_modeling`, `browser_automation`, `ai_classification`, `document_intelligence`, `channel_integrations`, `scheduled_automations`                           |
| [Service Scheduling](./scheduling/)        | Field & Local Services  | `data_modeling`, `self_service_portal`, `gps_geospatial`, `third_party_saas`, `channel_integrations`, `scheduled_automations`                                  |
| [Trade Operations](./trade-operations/)    | Trading & Manufacturing | `data_modeling`, `complex_business_logic`, `workflow_approvals`, `third_party_saas`, `document_intelligence`, `scheduled_automations`                          |
| [Treasury](./treasury/)                    | Finance                 | `data_modeling`, `complex_business_logic`, `workflow_approvals`, `document_intelligence`, `third_party_saas`, `scheduled_automations`                          |

## Working with a template

Templates are standalone projects — **not** workspace members of this repository. Each pins its own
`@norbital-ai/bolt` release and `bun.lock`, so run commands inside the template directory:

```bash
bun install --cwd <directory> --frozen-lockfile
bunx --cwd <directory> bolt check
bun run --cwd <directory> test
bunx --cwd <directory> bolt build
```

Because `@norbital-ai/*` packages are hosted on GitHub Packages, installing requires a `NODE_AUTH_TOKEN`
with `read:packages` (or an equivalent `~/.npmrc` entry).

- `bolt check` verifies declarations, schema migration history, rules, layout and TypeScript types.
- `bolt build` emits `.norbital/` (generated, never committed), refreshes `counts` in
  `norbital.template.json`, and generates the next editable migration under `migrations/` when schema
  changes (commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together).
- `bun run check` at this repo root runs shared `bolt templates` checks, lockfile verification and tests
  across changed templates.

## Adding a template

Create a kebab-case directory with `norbital.template.json` at its root:

```json
{
	"schema_version": 1,
	"key": "norbital-example",
	"name": "My Template",
	"industry": "Operations",
	"description": "What it is for.",
	"visibility": "public",
	"capabilities": ["data_modeling", "scheduled_automations"],
	"tags": ["Operations"]
}
```

Add `README.md`, `README.zh.md`, `docs/README.md`, `docs/source-reference.md` and a `1920×1080`
`docs/screenshots/application.webp` screenshot. Run `bolt build` to compute `counts` automatically.

## Release lifecycle

Pushing to `main` builds each changed template once (`bolt check`, `bolt build`, `bolt test`) and uploads
its immutable release bundle to R2 by digest. Environments only serve a release after an explicit
`env deploy promote` names its digest; existing tenants keep their pinned release until upgraded.

```bash
bun run templates:lock         # update template lockfiles when intentionally upgrading Bolt
bun run templates:lock:check   # fail on lockfile drift
bun run check                  # full local and CI gate
```

## Documentation index

| Template                | Docs                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blank                   | [Overview](blank/README.md) · [Docs](blank/docs/README.md) · [Architecture](blank/docs/architecture.md) · [Source reference](blank/docs/source-reference.md)                                                                                                         |
| Construction Operations | [Overview](construction/README.md) · [Docs](construction/docs/README.md) · [Architecture](construction/docs/architecture.md) · [Source reference](construction/docs/source-reference.md)                                                                             |
| CRM                     | [Overview](crm/README.md) · [Docs](crm/docs/README.md) · [Architecture](crm/docs/architecture.md) · [Operator guide](crm/docs/operator-guide.md) · [Source reference](crm/docs/source-reference.md)                                                                  |
| Field Operations        | [Overview](field-operations/README.md) · [Docs](field-operations/docs/README.md) · [Architecture](field-operations/docs/architecture.md) · [Operator guide](field-operations/docs/operator-guide.md) · [Source reference](field-operations/docs/source-reference.md) |
| Fleet Management        | [Overview](fleet-management/README.md) · [Docs](fleet-management/docs/README.md) · [Architecture](fleet-management/docs/architecture.md) · [Source reference](fleet-management/docs/source-reference.md)                                                             |
| HRMS                    | [Overview](hrms/README.md) · [Docs](hrms/docs/README.md) · [Inner Mechanisms](hrms/docs/0012-inner-mechanisms-diagrams.md)                                                                                                                                           |
| Portfolio Manager       | [Overview](portfolio-manager/README.md) · [Docs](portfolio-manager/docs/README.md) · [Architecture](portfolio-manager/docs/architecture.md) · [Source reference](portfolio-manager/docs/source-reference.md)                                                         |
| Service Scheduling      | [Overview](scheduling/README.md) · [Docs](scheduling/docs/README.md) · [Architecture](scheduling/docs/architecture.md) · [Source reference](scheduling/docs/source-reference.md)                                                                                     |
| Trade Operations        | [Overview](trade-operations/README.md) · [Docs](trade-operations/docs/README.md) · [Inner Mechanisms](trade-operations/docs/0009-inner-mechanisms-diagrams.md) · [Source reference](trade-operations/docs/0003-source-reference.md)                                  |
| Treasury                | [Overview](treasury/README.md) · [Docs](treasury/docs/README.md) · [Architecture](treasury/docs/architecture.md) · [Reference](treasury/docs/reference.md) · [Source reference](treasury/docs/source-reference.md)                                                   |

## License

See [LICENSE](./LICENSE).
