# The blank workspace

This is an empty Norbital workspace: it declares no collections, no apps, and no automations. It is
the starting point for building a workspace entirely from scratch with the workspace agent.

## What "blank" means

- `src/` holds only the shared workspace prompt (`src/+agents.md`) and the bilingual catalogs under
  `src/i18n/`. There is no domain model, no app surface, and no automation.
- The manifest (`norbital.template.json`) declares zero counts. When you add a collection, app, or
  automation, update `counts` in the same change — `pnpm templates:check` recomputes them from source
  and fails when they disagree.

## Building on it

Author collections under `src/collections/<name>/+model.ts`, app surfaces under
`src/apps/+<app>.svelte`, and automations under `src/automations/+<name>.ts`. The workspace agent can
also do this through its Workbench source tools (`workspace_files`, `workspace_read`,
`workspace_edit`, `workspace_apply`), which write private drafts a person previews and promotes.

The authoring contract lives in the
[Norbital OSS repository](https://github.com/norbital-ai/oss/tree/main/packages/bolt); the
`authoring-tenant-workspace` skill is its published summary.

## Verify locally

```bash
pnpm install
pnpm sync
pnpm lint
pnpm test
```
