# HRMS Technical Documentation

![HRMS application](screenshots/application.webp)

> **Fixed design notice:** Read [Section 0 of the architecture](0001-hrms-calculation-architecture.md#0-the-design-is-fixed) first. That section is the owner's fixed design. The source tree (`src/`) is the final authority for every model, rule, automation, and policy.

## Document Index

| Document                                                                             | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [0012 — Inner Mechanisms & Architecture Diagrams](0012-inner-mechanisms-diagrams.md) | 17 pure-ASCII diagrams tracing system topology, 30-model ER ownership, dated patch folding, payroll batch admission & sealing, linear subtotal chain & statutory DAG, cross-period amendments, append-only ledger & entitlement sync, stints/exits/loans, kiosk biometrics & attendance matching, registered rules/effects, statutory research & filing, state machines, exports, and RBAC matrix, plus a verified source inventory. |
| [0001 — HRMS Calculation Architecture](0001-hrms-calculation-architecture.md)        | Fixed design (Section 0), single-owner boundaries, dated jurisdiction law, catalogues, engine pipeline, append-only ledger, rules and effects, automations, roles, and screen structure.                                                                                                                                                                                                                                             |
| [0008 — Core Mechanisms Walkthrough](0008-mechanisms-walkthrough.md)                 | End-to-end worked example from company setup and employment terms through payroll runs, salary listing/bank exports, corrections, and employee exit.                                                                                                                                                                                                                                                                                 |
| [0007 — Corrections and Integrity](0007-corrections-and-integrity.md)                | Correcting a paid period at its source record, historical balance unwinding, employment period resolution, and append-only ledger invariants.                                                                                                                                                                                                                                                                                        |
| [0011 — Dated Changes](0011-dated-changes.md)                                        | Plain fields, self-dated records, and dated change rows; the patch fold (`dated.ts`); "Always so" vs. "Changes from date" editing semantics.                                                                                                                                                                                                                                                                                         |
| [0002 — Model Specification](0002-model-specification.md)                            | Data model fields, write rules, validation guards, and the deterministic calculation expression context.                                                                                                                                                                                                                                                                                                                             |
| [0003 — Jurisdiction Seed Specification](0003-jurisdiction-seed-specification.md)    | Structure and authoring rules for jurisdiction law baselines and dated statutory changes in the public seed.                                                                                                                                                                                                                                                                                                                         |
| [Transfer Semantics](transfer-semantics.md)                                          | Employment stints, intra- and cross-jurisdiction transfers, continuous/cumulative service, loan carry/transfer/settlement, and exit reconciliation.                                                                                                                                                                                                                                                                                  |
| [0009 — Statutory Coverage in the Seed](0009-statutory-coverage.md)                  | Summary of statutory rules, catalogues, thresholds, and verification notes across all nine seeded jurisdictions (`CN`, `ID`, `JP`, `MY`, `PH`, `SG`, `TH`, `TW`, `VN`).                                                                                                                                                                                                                                                              |

## Developer Quickstart

Run all workspace checks and builds from this template directory (`templates/hrms`):

```bash
bun install --frozen-lockfile
bunx bolt check   # declarations, schema history, policies, and types
bun run test      # standalone mechanism and edge-case tests (`bolt test`)
bunx bolt build   # compiles `.norbital/` and writes the release artifact
```

Additional helper scripts in `package.json`:

- `bun run dev` (`bolt dev`) — starts the local Bolt compiler watcher.
- `bun run format` — formats the template with Prettier.
- `bun run registry:generate` — regenerates registry glue from `src/`.

### Schema Migrations

Schema changes generate editable SQL migrations under `migrations/` and replay-check against a scratch database during `bolt build`. Commit the SQL migration files, `migrations/snapshot.json`, `migrations/migrations.lock.json`, and generated `migrations/physical.json` together. `.norbital/` is generated build output and is never committed.

### Seed Data

- **Public base (`seed/public/jurisdiction/<CODE>/`):** Holds the complete baseline law on 1 December 2025 plus enacted dated changes since for nine jurisdictions (`CN`, `ID`, `JP`, `MY`, `PH`, `SG`, `TH`, `TW`, `VN`): catalogues, subtotal chains, registered rules, and registered effects. `bolt build` packages these into the release's `base` pack.
- **Test fixtures (`seed/test/`):** Synthetic fixtures used exclusively by `bolt test` to verify calculation and governance mechanisms without certifying live statutory values.
- **Demo seeder (`seed/+seeder.ts`):** Loads optional private demo records into demo environments via `bolt seed`. Demo rows never enter a built release.

## Reference Screenshots & Workspace Guides

- Reference UI captures under `docs/screenshots/`: [Application](screenshots/application.webp), [Settings](screenshots/settings.webp), [Statutory Parameters](screenshots/parameters.webp), [Leave Entry](screenshots/leave-entry.webp), and [Workspace Overview](screenshots/workspace-overview.webp). All screenshot names and identifiers are illustrative.
- Business overview: [English README](../README.md) · [简体中文 README](../README.zh.md)
- Agent guidance: workspace operator brief [`src/agent/+agent.md`](../src/agent/+agent.md) · coding agent instructions [`src/agent/AGENTS.md`](../src/agent/AGENTS.md)
