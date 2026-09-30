# The blank workspace

The user guide, with screens of every app, is [docs/README.md](docs/README.md).

This is an empty Norbital workspace: one starter collection (`notes`, read-only), no apps and no
automations. It is the starting point for building a workspace from scratch with the workspace
agent.

## What "blank" means

- `src/` holds the workspace declaration (`src/+workspace.ts`), the agent brief
  (`src/agent/+agent.md`), the starter `notes` model and its read-only collection under `src/data/`,
  and the empty bilingual catalogues under `src/i18n/`.
- The manifest (`norbital.template.json`) declares the counts. When you add a collection, app, or
  automation, update `counts` in the same change — `tests/blank.test.ts` recomputes them from source
  and fails when they disagree.

## Building on it

Author models under `src/data/model/<name>/+model.ts` and expose them through
`src/data/collection/<name>/+collection.ts` (a model no collection exposes is invisible), apps under
`src/app/<app>/+app.ts` with one `+<page>.page.svelte` per page, and automations under
`src/automation/+<name>.automation.ts`. The workspace agent can also do this through its Studio tools
(`workspace_read`, `workspace_write`, `workspace_validate`), which write private drafts a person
previews and publishes.

The authoring contract lives in the
[Norbital OSS repository](https://github.com/norbital-ai/oss/tree/main/packages/bolt); the
`authoring-tenant-workspace` skill is its published summary.

## Verify locally

```bash
pnpm install
pnpm build
pnpm check
pnpm test
```
