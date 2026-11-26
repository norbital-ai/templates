# Construction Operations — Technical Documentation

![Construction Operations application](screenshots/application.webp)

Technical guide and developer reference for the `norbital_construction` Bolt template (`templates/construction`). For a business-facing overview of roles, capabilities, and scope, see the root [README](../README.md) ([简体中文](../README.zh.md)).

## Documentation Index

| Document                                       | Contents                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[architecture.md](architecture.md)**         | System topology, full 13-model ER diagram, 7 state machines & locks, single-model browser BIM takeoff & visual costing with remembered asset mappings, 3D viewer two-tier `.frag` cache, catalog-wired commercial & cashflow ledger engine, WhatsApp/email intake filed on arrival, schedule/Autodesk syncs, and RBAC matrix (all illustrated with ASCII diagrams). |
| **[source-reference.md](source-reference.md)** | Complete file-by-file inventory of workspace config, secrets, i18n, 4 custom fields, 13 models, 4 syncs, 1 custom integration, 2 apps / 4 pages, 3 automations, 4 seeded teams, 5 policies, `src/lib/` modules, migrations, and tests.                                                                                                                              |

## Developer Quickstart

Run all commands from the template root (`templates/construction`):

```bash
bun install --frozen-lockfile   # Install pinned Bolt & toolchain dependencies
bunx bolt check                 # Type-check, compile manifest, and verify migration history
bun run test                    # Run Vitest + @effect/vitest suites against PGlite
bunx bolt build                 # Build release bundle, generate next SQL migration if schema changed
```

### Schema Migrations & Seed Workflow

- **Schema changes:** Edit model declarations under `src/data/model/**` or custom fields under `src/data/custom_field/**`, then run `bunx bolt build` to generate the next sequential SQL migration under `migrations/` and verify full replay against a scratch database. Commit SQL files together with `migrations/snapshot.json`, `migrations/migrations.lock.json`, and `migrations/physical.json`. Never commit `.norbital/`.
- **Demo seeding:** `seed/+seeder.ts` defines the template's demo dataset binding for `bolt seed --bank=<path>` during environment reset or provisioning. A fresh workspace without seed data starts empty and ready to configure partners, item matrix rates, and connections.
- **Autodesk ACC secrets:** Configure `AUTODESK_CLIENT_ID` and `AUTODESK_CLIENT_SECRET` in the host's sealed secret store before pairing the `autodesk_acc` integration under **Configuration → Connections**.

## Core Architectural Highlights

1. **Single Federated BIM Model (`projects.bim_file`) & 1:1 `cost_estimates`:** Each project stores one `.ifc` model (`bim_file`, `bim_version`, `bim_costing_dirty`, `bim_summary`) and its browser takeoff (`bim_takeoff`, `bim_takeoff_views`), paired 1:1 (`unique: ['project_id']`) with `cost_estimates`. Replacing `bim_file` clears the takeoff, marks `bim_costing_dirty = true` and automatically transitions any non-void estimate to `void`. Non-BIM drawings, specifications, schedules, and handover records are filed in the hub's **Documents** tab (`project_files`).
2. **Browser Takeoff & Visual AI BIM Costing:** Uploading a model takes it off in that browser (`src/services/viewer/takeoff.worker.ts` + `geometry-pass.ts`): it streams the `.ifc` in 4 MiB slices into unique archetypes, measures every element from its mesh (volume, oriented length/area, steel weight), counts an assembly once as a whole (a stair, not also its flights), merges archetypes that are one asset, and renders each unique asset from 4 angles into one square picture. Storing the takeoff triggers `analyze_bim_file`, which prices each asset as its `asset_mappings` row remembers (a QS correction, an approved proposal, or an earlier System 1 decision), classifies only the rest via System 1 against active currency-matched `item_matrix` items (flagging uncataloged ones as `unknown_unseen_catalog`), prices only measured quantities, and has System 2 propose Item Matrix entries for what nothing prices, each held for commercial approval. The server never parses IFC.
3. **Client-Side 3D Viewer & Two-Tier `.frag` Cache:** `src/services/viewer/IfcViewer.svelte` (backed by `engine.ts`) boots Three.js + `@thatopen/components` in parallel with a two-tier fragment cache (in-memory LRU-4 + persistent browser `CacheStorage` `norbital-ifc-fragments-v2`), converting raw IFC files once inside a disposable `web-ifc` WASM Web Worker. Includes Orbit / Pan / Inspect modes, keyboard navigation, `Iso`/`Top`/`Front`/`Side` presets, X/Y/Z section planes, and isolation of a selected BIM task's or the 4D slice's elements (brand colour, rest translucent).
4. **Catalog-Wired Commercial Ledger & Standalone Ad-hoc Costs:** Every line item on client contracts, subcontracts, Variation Orders (`contracts`), and Purchase Orders / Delivery Orders / Invoices / Claims (`commercial_documents`) must reference a valid `item_matrix` code (or project BIM takeoff bucket) via `resolveCatalogLines` — zero free-text money lines. Non-BIM site costs live in standalone `adhoc_costs` with a mandatory `catalog_item_id` (`on_delete: 'restrict'`). Everything reconciles per catalog code in **Finance → Cashflow & Budget** (`computeCatalogCashflowBreakdown`) using exact Effect `BigDecimal` math.
5. **Simplified Programme & Tasks + Multi-Channel AI Intake:** All project progression is tracked via **Programme & Tasks** (4D timeline nested by `wbs_path`, table, and board behind an icon-only view toggle, backed by Primavera P6 `.xer`, MS Project `.xml`, XLSX/CSV, and two-way Autodesk ACC sync). Each task (`bim` or `adhoc`) uses a borderless Linear-style Markdown `description` (floating bubble & `/` slash menus, `images: 'attachments'`) and a dedicated **Activity** tab backed by polymorphic `activities` (`title`, plain-text `description`, `occurred_at`, optional `attachments`). WhatsApp and email messages are mirrored into `project_messages` as they arrive (`sync_messages`) and filed in one pass by the model's create effect into tasks, activities, variations, and commercial documents.
