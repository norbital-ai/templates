# Portfolio Manager — Technical Documentation

Technical documentation for the `norbital-portfolio-manager` Bolt workspace template (`@template/portfolio-manager`).

## Document Index

| Document                                                           | Audience                  | Contents                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [System Architecture & Inner Mechanisms](architecture.md)          | Engineers & architects    | End-to-end runtime topology, data ownership ER diagram, multi-currency valuation & FX precedence, technical signal formulas, daily agent execution pipeline, browser/RSS fallback and strict citation gating, dual screen/PDF report rendering, and RBAC matrix (with ASCII diagrams).       |
| [Source Reference](source-reference.md)                            | Engineers & coding agents | Complete inventory of workspace configuration, all 4 data models (fields, types, constraints, indexes, verbs), shared modules (`book.ts`, `market.ts`), automation specification, app pages, report representation, teams, policies, i18n keys, seed fixtures, tests, and schema migrations. |
| [Coding-Agent Source Map](../src/agent/AGENTS.md)                  | Coding agents             | Concise map of file ownership, build gates, and invariants that edits must preserve.                                                                                                                                                                                                         |
| [Norbius Agent Brief](../src/agent/+agent.md)                      | Workspace assistant       | Domain rules and writing discipline loaded into the built-in Norbius assistant.                                                                                                                                                                                                              |
| [Business Overview (EN)](../README.md) / [(中文)](../README.zh.md) | Stakeholders & evaluators | Non-technical scope of work, roles, app modules, automation behavior, and boundaries.                                                                                                                                                                                                        |

## Developer Quickstart

Run all commands from this template's directory (`templates/portfolio-manager`):

```bash
# Install dependencies against the committed lockfile
bun install --frozen-lockfile

# Verify workspace discovery, schema history, rules, and strict types
bunx bolt check

# Execute unit and workspace integration tests (PGlite + fakes)
bun run test

# Compile `.norbital/` and build the release artifact + seed packs
bunx bolt build
```

Additional local authoring scripts from `package.json`:

- `bun run dev` — runs `bolt dev` for local iterative authoring.
- `bun run format` — formats workspace files with Prettier (`prettier --write .`).

## Workspace Configuration

Most operational parameters are stored as **data**, not code:

1. **Time zone, locale, languages, and PDF export (`src/+workspace.ts`)**
   - `tz`: `'Asia/Singapore'` — single source of truth governing both the `portfolio_agent` `0 8 * * *` cron schedule and the `ctx.today` date stamped on each daily `report` and `pnl_history` entry.
   - `locale`: `'en-US'`, `languages`: `['en', 'zh']`, `currency`: `'USD'`.
   - `convert`: `{ to: ['pdf'] }` — enables `ctx.convert.record('report', id, { to: 'pdf' })`.
2. **Base currency, benchmarks & delivery channel (`portfolio_settings` model)**
   - Configured at runtime in **Portfolio → Settings** (`base_currency`, `benchmarks`; defaults to `USD` if absent) and **Portfolio → Subscribers** (`report_channel`, optional ref to `sys_integration`).
   - If more than one `portfolio_settings` row exists, `portfolio_agent` refuses with `errors.settings_ambiguous`.
3. **Subscribers (`report_subscription` model)**
   - One row per subscribed `sys_user` (`one_per_user`). Viewers self-manage their own row on **Portfolio → Reports**; owners manage all rows and pick `report_channel` on **Portfolio → Subscribers**.
4. **External messaging delivery (built-in Envoy channels)**
   - No custom integration source files are needed. Bind an active Envoy (`sys_envoy`) to a workspace chat account (`whatsapp`, `telegram`, `slack`, or `discord`) via `sys_envoy_channel` under **Settings → Integrations → Envoys**, then select it as `portfolio_settings.report_channel` in **Portfolio → Subscribers** (if left on automatic, `portfolio_agent` uses a connected Envoy channel only when exactly one exists; with zero or multiple unpaired/ambiguous channels, delivery degrades cleanly to in-app notifications only).

## Schema Migrations & Seed Workflow

### Migrations

Schema history lives under `migrations/`:

- `0001_initial.sql` — editable initial SQL migration.
- `snapshot.json`, `migrations.lock.json`, and `physical.json` — generated schema snapshot, prefix hashes, and physical DDL verification manifest.

Whenever a `+model.ts` schema changes, `bunx bolt build` generates the next migration and replays the full prefix chain against a scratch database. Always commit the SQL files, `snapshot.json`, `migrations.lock.json`, and `physical.json` together, and verify with `bunx bolt check`. Never commit `.norbital/`.

### Seeds & Test Fixtures

- **Fresh workspace:** Starts with its two teams (`seed/public/sys_team.json`) and no business rows.
- **Automated test fixture (`seed/test/holding.json`):** Contains a synthetic 4-line book loaded automatically by `TestWorkspace.layer`:
  1. `Acme Robotics Inc` (`ACME UW`, `equity`, `USD`, qty 100, cost 10,000, market 12,000, base 12,000, P&L 2,000)
  2. `Global Bond Index Fund` (`fund`, `USD`, qty 500, cost 5,000, market 5,100, base 5,100, P&L 100)
  3. `Operating account` (`cash`, `USD`, market 3,000, base 3,000)
  4. `Credit facility` (`loan`, `USD`, market -2,000, base -2,000)
- **Demo fixture hook (`seed/+seeder.ts`):** Declares `seeder({ bank: { tree: 'portfolio-manager' } })` so demo environment resets can hydrate an external demo dataset in memory without committing private data into the template repository.

## Automated Test Suites

| Suite                     | Focus                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/market.test.ts`    | Pure unit tests for `quoteSymbol`, `parseQuote` (including `GBp` minor-unit scaling and volume ratios), `parseRates`, `parseHeadlines`, `signalsOf`, `cite`, `lineValue` (3-tier valuation precedence + accrued interest + cross-currency quotes), `costInBase`, and `computeMetrics`.                                                                                                                                       |
| `tests/research.test.ts`  | Effect unit tests for browser-backed `search` (engine selectors, link filtering, page reading) and graceful degradation when browser is unavailable (`readPage` falling back to `web.read`).                                                                                                                                                                                                                                 |
| `tests/portfolio.test.ts` | Full Bolt `TestWorkspace` integration tests covering RBAC (`portfolio_manage` vs `portfolio_read`), `report_subscription` self-only verdicts, `loan_is_owed` and `one_per_day` constraints, scheduled and manual `portfolio_agent` runs, citation gating, idempotent same-day reruns, in-app-only fallback, multi-currency `SGD` reporting, PDF record rendering (`?record=report/<id>&print`), and WhatsApp Envoy delivery. |
