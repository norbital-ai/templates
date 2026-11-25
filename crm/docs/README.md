# CRM Technical Documentation

![CRM application](screenshots/application.webp)

Technical documentation and developer quickstart for the CRM Bolt template workspace (`norbital_hq`).

## Documentation Index

- **[Template Overview (English)](../README.md)** / **[模板概览（简体中文）](../README.zh.md)** — Business-focused Scope of Work covering workflows, expected impact, roles, apps, automations, and scope boundaries.
- **[Architecture & Inner Mechanisms](architecture.md)** — Deep technical guide with 10 ASCII diagrams covering runtime topology, 22-model ownership ER schema, state machines & commitment gating, fair multi-channel message intake & System 1 classification, two-way Google Calendar sync, meeting diarization & in-browser CAM++ voiceprints, lead research & SOW merge engine, PDF layout/signing, Apollo outreach cohorts, and access control.
- **[Source Reference](source-reference.md)** — Verified inventory of all 2 apps (8 pages), 22 models, 2 syncs, 21 automations, 2 custom integrations (+ 5 built-in channels), 1 team, 6 policies, and domain libraries.
- **[Operator Guide](operator-guide.md)** — Operational walkthrough for pairing Gmail, WhatsApp, Google Calendar, and Apollo, configuring import start boundaries and intake rules, managing meeting recordings and voice profiles, running outreach cohorts, issuing signed agreements, and troubleshooting.
- **[Activity Timeline Design](design/activity-timeline.md)** — Conversation slicing rules, typed activity creation, meeting capture UX, and A4 `DocumentPaper` rendering behavior.

## Developer Quickstart

Run all commands from this template directory (`templates/crm/`):

```bash
# Install exact locked dependencies
bun install --frozen-lockfile

# Validate discovery, schema history, rules, i18n keys, and strict TypeScript types
bunx bolt check

# Run the Vitest workspace test suite (uses synthetic fixtures in seed/test/ against PGlite)
bun run test

# Compile .norbital/, generate/verify SQL migrations, and build the release artifact
bunx bolt build

# Format source and docs with Prettier
bun run format
```

## Migrations & Seeding Workflow

- **Schema & migrations:** Record models under `src/data/model/**/+model.ts` are the source of truth. Running `bunx bolt build` generates any required SQL migration under `migrations/` and replays the full history against a scratch database. Commit SQL migration files together with `migrations/snapshot.json`, `migrations/migrations.lock.json`, and `migrations/physical.json`. Never commit `.norbital/`.
- **Workspace startup state:** A fresh workspace starts empty; runtime catalogues (products, seller/research focus, templates, signatory details, outreach settings, sequences) and personal/workspace connections are configured under **Configuration**.
- **Test fixtures:** Synthetic fixtures in `seed/test/` serve `bun run test` only and never ship in a production release. Private demo seeding is wired through `seed/+seeder.ts` at environment reset time without embedding private data in this repository.
- **Coding-agent map:** See [src/agent/AGENTS.md](../src/agent/AGENTS.md) for source layout invariants and [src/agent/+agent.md](../src/agent/+agent.md) for the Norbius assistant brief.
