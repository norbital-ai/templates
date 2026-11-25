# Norbital Templates

Public starter workspaces for [Norbital](https://norbital.ai). Every directory is a standalone,
filesystem-first Bolt project that installs, checks, builds and tests with the public Bolt CLI — and
forks cleanly into a tenant workspace.

## Template gallery

| Template                                       | Directory            | Handle                       | Purpose                                                                                                                   |
| ---------------------------------------------- | -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [**Blank**](./blank/)                          | `blank/`             | `norbital_blank`             | Minimal starter with one read-only `notes` model and no prebuilt apps                                                     |
| [**Construction Operations**](./construction/) | `construction/`      | `norbital_construction`      | Main & subcontractor PMS: BIM IFC takeoff & costing, Autodesk/P6/MSP planning, contracts, PO/DO/invoices, WhatsApp/email  |
| [**CRM**](./crm/)                              | `crm/`               | `norbital_hq`                | Lead-to-client CRM: Apollo/CSV import, multi-channel intake, meeting voice profiles, AI SOW extraction, PDF agreements    |
| [**Field Operations**](./field-operations/)    | `field-operations/`  | `norbital_field_operations`  | Daily site dispatch, contractor job reporting, WhatsApp Envoy and mechanical + AI photo integrity review                  |
| [**Fleet Management**](./fleet-management/)    | `fleet-management/`  | `norbital_fleet_management`  | Real-time GPS transponder tracking, live vehicle map, route dispatch & ETAs, circular geofences and telemetry alerts      |
| [**HRMS**](./hrms/)                            | `hrms/`              | `norbital_hr`                | Multi-country HR, attendance, leave and payroll with sealed dated jurisdiction law and an append-only ledger              |
| [**Portfolio Manager**](./portfolio-manager/)  | `portfolio-manager/` | `norbital_portfolio_manager` | Family-office book with multi-currency valuation, technical signals and a cited daily agent PDF report                    |
| [**Service Scheduling**](./scheduling/)        | `scheduling/`        | `norbital_scheduling`        | Generic appointment booking & dispatch: customer portal, runtime service catalog, route-aware matching and GPS ETA alerts |
| [**Trade Operations**](./trade-operations/)    | `trade-operations/`  | `norbital_trade_operations`  | Order-centered B2B sales & purchasing with pricing floors, bilingual contracts, credit releases and Kingdee KIS sync      |
| [**Treasury**](./treasury/)                    | `treasury/`          | `norbital_treasury`          | Bank credit facilities, drawdowns, AI-read bank advices, PO/invoice checks, locked month-ends and FX hedging              |

**Directory vs handle:** The directory name controls the public URL (`norbital.ai/templates/<directory>`);
the handle (`norbital.template.json`'s `key`) is the stable catalogue identity. They may differ and stay
independent.

Every public template here appears automatically in the [Norbital template gallery](https://norbital.ai/templates)
using its `norbital.template.json`, `README.md` and `docs/screenshots/application.webp` (1920×1080).

## Choosing a template

- **Blank** — Start from scratch with zero domain opinions and build interactively with Norbius.
- **Construction Operations** — Run full contractor delivery for main contractors or specialized
  subcontractors: BIM IFC asset classification and costing, Autodesk ACC / P6 / MS Project schedules,
  3D BIM-pinned issues, contracts, 3-way PO/DO/Invoice cashflow and WhatsApp/email intake.
- **CRM** — Manage leads through signed client engagements in one deduplicated company table, with
  Apollo outreach cohorts, WhatsApp/email/meeting intake, PIC voice profiles and versioned PDF contracts.
- **Field Operations** — Focus purely on day-of-work dispatch and trustworthy proof of completion:
  role-scoped contractor reporting, WhatsApp Envoy updates, SHA-256/PDQ/EXIF photo checks and AI suspicion
  reviews.
- **Fleet Management** — Monitor transponder-equipped vehicles on a live map with route dispatch,
  waypoints, traffic ETAs, circular geofences and overspeed/offline alerting.
- **HRMS** — Run multi-country employment records, attendance, leave, claims, loans, payroll and
  statutory obligations driven by dated, sealed jurisdiction law.
- **Portfolio Manager** — Track securities, funds, cash and credit facilities with daily technical
  signals and an automated, strictly cited PDF morning briefing.
- **Service Scheduling** — Book and dispatch scheduled on-site services (HVAC, plumbing, electrical,
  cleaning, maintenance, detailing, etc.) via a phone-verified booking portal, runtime skill/service
  catalog, travel-aware provider matching, shift check-ins and live GPS ETA recovery.
- **Trade Operations** — Unify quotations, sales orders and purchase orders with two-way Kingdee KIS ERP
  sync, pricing-floor approvals, credit-release workflows and lot-level margin analysis.
- **Treasury** — Control bank credit lines, drawdowns, bank-advice extraction, purchasing requisitions,
  month-end snapshots and FX hedging structures.

Every template README follows the same scannable structure: overview, key capabilities, apps and roles,
data model, automations and integrations, and getting started.

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
	"key": "norbital_example",
	"name": "My Template",
	"industry": "Operations",
	"description": "What it is for.",
	"visibility": "public",
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

| Template                | Docs                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Blank                   | [Overview](blank/README.md) · [Docs](blank/docs/README.md) · [Source reference](blank/docs/source-reference.md)                                                                                              |
| Construction Operations | [Overview](construction/README.md) · [Docs](construction/docs/README.md) · [Source reference](construction/docs/source-reference.md)                                                                         |
| CRM                     | [Overview](crm/README.md) · [Docs](crm/docs/README.md) · [Operator guide](crm/docs/operator-guide.md) · [Source reference](crm/docs/source-reference.md)                                                     |
| Field Operations        | [Overview](field-operations/README.md) · [Docs](field-operations/docs/README.md) · [Operator guide](field-operations/docs/operator-guide.md) · [Source reference](field-operations/docs/source-reference.md) |
| Fleet Management        | [Overview](fleet-management/README.md) · [Docs](fleet-management/docs/README.md) · [Source reference](fleet-management/docs/source-reference.md)                                                             |
| HRMS                    | [Overview](hrms/README.md) · [Docs](hrms/docs/README.md)                                                                                                                                                     |
| Portfolio Manager       | [Overview](portfolio-manager/README.md) · [Screenshot](portfolio-manager/docs/screenshots/application.webp)                                                                                                  |
| Service Scheduling      | [Overview](scheduling/README.md) · [Docs](scheduling/docs/README.md) · [Source reference](scheduling/docs/source-reference.md)                                                                               |
| Trade Operations        | [Overview](trade-operations/README.md) · [Docs](trade-operations/docs/README.md) · [Source reference](trade-operations/docs/0003-source-reference.md)                                                        |
| Treasury                | [Overview](treasury/README.md) · [Docs](treasury/docs/README.md) · [Reference](treasury/docs/reference.md) · [Source reference](treasury/docs/source-reference.md)                                           |

## License

See [LICENSE](./LICENSE).
