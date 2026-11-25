# Construction Operations — Technical Documentation

![Construction Operations application](screenshots/application.webp)

Technical guide and developer reference for the `norbital_construction` Bolt template (`templates/construction`). For a business-facing overview of roles, capabilities, and scope, see the root [README](../README.md) ([简体中文](../README.zh.md)).

## Documentation Index

| Document                                       | Contents                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **[architecture.md](architecture.md)**         | System topology, full 12-model ER diagram, 8 state machines & locks, single-model BIM & EOD sweep pipeline, 3D viewer two-tier `.frag` cache, catalog-wired commercial & cashflow ledger engine, WhatsApp/email AI pipeline, schedule/Autodesk syncs, and RBAC matrix (all illustrated with ASCII diagrams). |
| **[source-reference.md](source-reference.md)** | Complete file-by-file inventory of workspace config, secrets, i18n, 6 custom fields, 12 models, 4 syncs, 1 custom integration, 2 apps / 5 pages, 8 automations, 4 teams, 5 policies, `src/lib/` modules, migrations, and tests.                                                                              |

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
- **Demo seeding:** `seed/+seeder.ts` defines the template's demo dataset binding for `bolt seed --bank=<path>` during environment reset or provisioning. A fresh workspace without seed data starts empty and ready to configure partners, costing matrix rates, and connections.
- **Autodesk ACC secrets:** Configure `AUTODESK_CLIENT_ID` and `AUTODESK_CLIENT_SECRET` in the host's sealed secret store before pairing the `autodesk_acc` integration under **Configuration → Connections**.

## Core Architectural Highlights

1. **Single Federated BIM Model (`projects.bim_file`) & 1:1 `cost_estimates`:** Each project stores one `.ifc` model (`bim_file`, `bim_version`, `bim_revisions`, `bim_costing_dirty`, `bim_summary`) paired 1:1 (`unique: ['project_id']`) with `cost_estimates`. Replacing `bim_file` marks `bim_costing_dirty = true` and automatically transitions any non-void estimate to `void`. Non-BIM drawings, specifications, schedules, and handover records are consolidated under **Record → Filed Documents** (`project_files`).
2. **Visual AI BIM Costing & Daily EOD Sweep:** Browser-side takeoff (`ifc_takeoff.worker.ts` + `ifc_asset_snapshots.ts`) streams arbitrarily large `.ifc` models in 4 MiB chunks, deduplicates instances into unique archetypes, renders 3 isolated studio angles per archetype, and classifies them via Jev System 1 (`analyze_bim_file`) against active currency-matched `cost_matrix` rules (explicitly flagging uncataloged assemblies as `unknown_unseen_catalog`). At 22:00 daily, `sweep_bim_costing` automatically schedules server-side costing for dirty/missing/void models up to 4 MiB and alerts teams to open browser takeoff for larger models.
3. **Client-Side 3D Viewer & Two-Tier `.frag` Cache:** `ifc_viewer.svelte` boots Three.js + `@thatopen/components` in parallel with a two-tier fragment cache (in-memory LRU-4 + persistent browser `CacheStorage` `norbital-ifc-fragments-v1`), converting raw IFC files once inside a disposable `web-ifc` WASM Web Worker. Includes Orbit / Pan / Inspect modes, keyboard navigation, `Iso`/`Top`/`Front`/`Side` presets, X/Y/Z section planes, severity & 4D highlights, and raycast `bim_pin` tagging.
4. **Catalog-Wired Commercial Ledger & Standalone Ad-hoc Costs:** Every line item on Sales Orders, Purchase Orders, Variation Orders (`contracts`), and Delivery Orders / Invoices / Claims (`commercial_documents`) must reference a valid `cost_matrix` code (or project BIM takeoff bucket) via `resolveCatalogLines` — zero free-text money lines. Non-BIM site costs live in standalone `adhoc_costs` with a mandatory `catalog_item_id` (`on_delete: 'restrict'`). Everything reconciles per catalog code in **Commercial → Cashflow & Budget** (`computeCatalogCashflowBreakdown`) using exact Effect `BigDecimal` math.
5. **Simplified Programme & Tasks + Multi-Channel AI Intake:** **Programme & Tasks** pairs a simplified WBS-only 4D timeline (no VOs on the planner), table, and board behind an icon-only view toggle, backed by Primavera P6 (`.xer`), MS Project (`.xml`), XLSX/CSV, and two-way Autodesk ACC sync. WhatsApp and email traffic syncs continuously into `project_messages` (`sync_messages` → `classify_messages` → `extract_project_updates`), with 06:00 SGT exception digests (`daily_project_digest`).
