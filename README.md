# Norbital templates

Starter workspaces for [Norbital](https://norbital.ai). Each directory here is a standalone,
filesystem-first Pod project that can be installed, synchronized, type-checked, built, migrated,
and seeded with the public Pod CLI — and forked into a tenant.

| Template                                    | Directory           | Purpose                                                                        |
| ------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| [**hr-payroll**](./hr-payroll/)             | `hr-payroll/`       | Multi-country HR and payroll with effective-dated facts and payroll runs       |
| [**construction**](./construction/)         | `construction/`     | Project-centered construction ops with BIM and workforce compliance            |
| [**field-operations**](./field-operations/) | `field-operations/` | Site operations: dispatch, accountless-contractor WhatsApp, photo integrity    |
| [**crm**](./crm/)                           | `crm/`              | B2B quoting and pipeline with purchasing, mirrored masters, and an ERP handoff |

Every template in this repository is public, and the website lists it automatically: the template
gallery at [norbital.ai/templates](https://norbital.ai/templates) is generated from the templates
found in this repository, using each template's own `norbital.template.json`, `README.md`, and
`assets/thumbnail.svg` (marketing card / `og:image` — declare that file once; no manifest field).
There is no rewritten marketing copy and no list to update — **publishing a template here is what
puts it on the website**.

Templates that should not be advertised live in a separate private repository. Both repositories
are resolved the same way by a Norbital host, so a private template is a first-class template in
every respect except discovery.

## Choosing a template

- **Field Operations** is the focused choice for day-of-work dispatch, qualification checks,
  site evidence, and variation requests. Contractors work over WhatsApp without an account: the
  channel agent can only update their own job assignments and never sees integrity flags.
- **Construction Operations** covers wider project delivery: workforce permits, quality, RFIs,
  BIM references, payment claims, and scheduled operational watches.
- **CRM** runs a B2B deal end to end: accounts with their credit position, catalogue-backed quoting
  with payment and shipping terms, revision-safe pipeline, and a confirmed-document handoff to the
  third-party ERP — together with the purchasing, supplier, and indicative stock position that make
  those commitments deliverable.
- **HR & Payroll** is the specialised multi-country payroll workspace, including attendance, leave,
  statutory contribution configuration, and reconciliation guidance.

Each template README explains its domain model, workflows, safeguards, source layout, and
verification. They are designed to be changed as normal Pod workspaces rather than treated as
generated product code.

## Working with a template

A template is **not** a workspace member of this repository. It owns its own `pnpm-lock.yaml` and
resolves published `@norbital-ai/*` versions from the registry, exactly as a tenant sandbox does —
so you install and run inside the template directory:

```bash
pnpm --dir crm install
pnpm --dir crm sync
pnpm --dir crm lint
pnpm --dir crm build
```

`sync` derives Pod assembly and migrations. Commit authored source and `.norbital/migrations/`, but
do not edit or commit other generated `.norbital` output.

Repository-wide equivalents loop over every template:

```bash
pnpm templates:install
pnpm templates:sync
pnpm templates:lint
pnpm templates:build
```

Because `@norbital-ai/*` come from GitHub Packages, an install needs a `NODE_AUTH_TOKEN` with
`read:packages`, or the equivalent entry in your `~/.npmrc`.

## Adding a template

Create a directory named for the key, put `norbital.template.json` at its root, and that is the
whole registration — discovery reads the tree, not a catalogue:

```json
{
	"schemaVersion": 1,
	"key": "my-template",
	"name": "My Template",
	"industry": "Operations",
	"description": "What it is for.",
	"visibility": "public",
	"counts": { "collections": 0, "apps": 0, "automations": 0 },
	"tags": ["Operations"]
}
```

Drop `assets/thumbnail.svg` once for website cards and `og:image` — no manifest field needed
unless the path differs. `counts` are recomputed from source by `pnpm templates:check`, so they
cannot drift. `visibility` is `public` or `unlisted`; `unlisted` hides a template from the
in-product picker, and it is independent of which repository the template lives in.

## Release and tenant lifecycle

Publishing advances the fast-forward-only `refs/heads/templates/<key>` branch to a new commit
produced by `git subtree split` of the template directory, so the projected tree is the template
tree with nothing above it. A tenant is _forked_ from that commit, so it shares ancestry with the
template and adopting a newer one is a real three-way rebase, not a conflicting re-add of every
file. A tenant records the exact commit it adopted rather than tracking the moving branch
implicitly, and is told when its upstream is ahead — it never moves on its own.

A host resolves the active set with one
`git ls-remote --heads <url> 'refs/heads/templates/*'` round trip. There is no mirror, no catalogue
file, and no provider API.

Each template pins its own `@norbital-ai/pod` version. Nothing propagates a bump into a template: a
developer runs `pnpm templates:lock` when they choose to move. Publishing a new pod version changes
no template and rebuilds no tenant.

```bash
pnpm templates:lock          # resolve and write each template's lockfile
pnpm templates:lock:check    # fail on drift
pnpm templates:lock:verify   # warm one shared store, then install offline with no credentials
pnpm templates:verify        # install/sync/lint/build each template from its tracked files alone
```

No template archive or package tarball is committed here. Template source is distributed through
ordinary Git refs, and dependency bytes live in one shared content-addressed pnpm store.

Editing this checkout never changes an existing tenant, and a tenant's local changes must be merged
or rebased intentionally rather than overwritten by a template update.

## License

See [LICENSE](./LICENSE).
