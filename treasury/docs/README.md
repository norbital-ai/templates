# Treasury Technical Documentation

![Treasury application](screenshots/application.webp)

Technical documentation and developer guide for the `templates/treasury` Norbital Bolt workspace (`norbital_treasury`).

## Documentation Index

- **[Business overview (English)](../README.md)** — Executive scope, business impact, roles, apps, automations, and boundaries.
- **[业务概览（简体中文）](../README.zh.md)** — Customer-facing Simplified Chinese overview.
- **[Architecture and inner mechanisms](architecture.md)** — Deep technical guide with 10 pure-ASCII diagrams covering runtime topology, 26-model ownership ER graph, drawdown state machine & atomic bill conversion, bank-advice AI & approval pipeline, purchasing/PDF pack flow, `BigDecimal` calculation engines, month-end locking & export sync, FX hedging & 3,000-path bootstrap simulation, attention fan-out, and access-control authority matrix.
- **[Domain and calculation reference](reference.md)** — Glossary, 37-product catalogue, interest/charge/month-end formulas, invoice cross-check tolerances, FX hedging mechanics, and attention criteria.
- **[Source reference](source-reference.md)** — Verified inventory of all 26 models, 4 applications (16 pages), 10 custom record views, 17 automations, 11 policies, 4 teams, 1 integration, 1 file sync, and 8 shared libraries.
- **[App media credits](../assets/app-media/CREDITS.md)** — Attribution for application banner photography.

## Developer Quickstart

Run commands inside the `templates/treasury` directory:

```bash
bun install --frozen-lockfile   # Install pinned Bolt toolchain and workspace deps
bunx bolt check                 # Validate discovery, schema history, rules, and TypeScript types
bun run test                    # Execute the workspace Vitest / Bolt test suite
bunx bolt build                 # Compile .norbital/, generate next SQL migration if schema changed, and pack release
bun run format                  # Format workspace source with Prettier
```

### Schema & Migration Workflow

- Schema definitions live under `src/data/model/**/+model.ts`.
- Running `bunx bolt build` after a schema edit generates the next numbered SQL migration under `migrations/` and replays the migration chain against a scratch database.
- Always commit `migrations/*.sql`, `migrations/snapshot.json`, `migrations/migrations.lock.json`, and `migrations/physical.json` together. Never commit `.norbital/`.
- `bunx bolt check` verifies schema history and physical definitions across every migration prefix.

### Workspace Configuration & External Connections

- A fresh workspace starts empty: configure banks, facilities, sub-limits, fee rules, and reporting exchange rates under **Configuration**, and assign members to the four source-declared teams (`treasury`, `finance`, `purchasing`, `viewers`).
- To enable automated weekday official exchange rates (`fx_rates_fetch`), connect an organization-wide `mas_rates` integration instance with a Monetary Authority of Singapore API key under **Settings → Connections** (credentials stay in the host's sealed store and are never seeded).
- Optional demonstration data is loaded out-of-band via `bolt seed` using `seed/+seeder.ts` (which also kicks off initial document reading for unread advices, FX documents, and proposals).
