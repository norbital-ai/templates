# Norbital templates

This repository holds the **public** Norbital starter workspaces, one directory per template. The
private counterpart lives in `norbital-ai/templates-private` and is structured identically; the only
difference is that a template here is advertised on the website automatically and a template there
is not.

- **A template has two names.** Its _directory_ (`hr-payroll/`) is the repository path, the
  `git subtree split` prefix, the published ref, and the website URL. Its _handle_ is
  `norbital.template.json`'s `key` (`norbital_hr`) — the organization a Norbital host provisions it
  as, which is also the tenant id and what a person types to sign in. They are allowed to differ, and
  for every template here they do. Directory names are `kebab-case`; handles are `norbital_*`.
  `scripts/lib/templates.mjs` calls the first `slug` and the second `handle`; the repository tooling
  works in slugs, because it works on directories.
- Template source is authored under `<directory>/src`; generated `.norbital` output is not hand-edited.
  `.norbital/migrations/` is authored history and **is** committed.
- A template is self-describing. `norbital.template.json` holds its picker and website metadata,
  and `pnpm-lock.yaml` pins its own dependencies including its exact `@norbital-ai/bolt` version.
  Nothing outside the tree pins them, and publishing a bolt package propagates into no template. Run
  `pnpm templates:lock` when you deliberately move a template's dependencies.
- Website gallery cards and `og:image` use `assets/thumbnail.svg` once. Optional manifest
  `thumbnail` only if the path differs — do not also configure that image as `bolt:thumbnail`.
- Templates are **not** pnpm workspace members. There is no root workspace and no linking: each
  template installs from the registry with its own lockfile, exactly as a tenant sandbox does. Work
  inside the template directory (`pnpm --dir <directory> install`), or use the repository-wide loops
  (`pnpm templates:install`, `templates:sync`, `templates:lint`, `templates:build`).
- Adding a template is adding a directory with a `norbital.template.json`. There is no catalogue
  file to edit, here or in Colony.
- Do not reformat anything under `.norbital/migrations/`. `migrationFingerprint` hashes the raw
  bytes of that directory, so a whitespace change reads as a changed migration history.
- Run `pnpm check` before pushing. It validates declarations and counts, runs the repository tests,
  checks formatting and lockfile freshness, and proves every template installs, syncs, lints, and
  builds from its tracked files alone.
- Pushing to `main` republishes `refs/heads/templates/<directory>` for every changed template. Refs are
  fast-forward only and pushed atomically, so a history rewrite fails rather than silently replacing
  a published revision.
