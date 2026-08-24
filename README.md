# Norbital templates

Starter workspaces for [Norbital](https://norbital.ai). Each directory here is a standalone,
filesystem-first Bolt project that can be installed, synchronized, type-checked, migrated,
and seeded with the public Bolt CLI — and forked into a tenant.

| Template                                    | Directory           | Organization handle     | Purpose                                                                        |
| ------------------------------------------- | ------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| [**hr-payroll**](./hr-payroll/)             | `hr-payroll/`       | `norbital_hr`           | Multi-country HR and payroll with effective-dated facts and payroll runs       |
| [**construction**](./construction/)         | `construction/`     | `norbital_construction` | Project-centered construction ops with BIM and workforce compliance            |
| [**field-operations**](./field-operations/) | `field-operations/` | `norbital_bca`          | Site operations: dispatch, accountless-contractor WhatsApp, photo integrity    |
| [**crm**](./crm/)                           | `crm/`              | `norbital_crm`          | B2B quoting and pipeline with purchasing, mirrored masters, and an ERP handoff |

**Directory and handle are two different names.** The directory is a path in this repository: it is
what `git subtree split` publishes as `refs/heads/templates/<directory>`, and what the website serves
`norbital.ai/templates/<directory>` from. The handle is `norbital.template.json`'s `key`: the
organization a Norbital host provisions this template as, which is also its tenant id and the string
a person types to sign in. Renaming a directory moves published refs and public URLs; renaming a
handle does not. They are allowed to differ and mostly do.

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
  site evidence, and variation requests. Contractors reach the authenticated WhatsApp envoy through
  a linked account; it can update only their own assignments and never exposes integrity flags.
- **Construction Operations** covers wider project delivery: workforce permits, quality, RFIs,
  BIM references, payment claims, and scheduled operational watches.
- **CRM** runs a B2B deal end to end: accounts with their credit position, catalogue-backed quoting
  with payment and shipping terms, revision-safe pipeline, and a confirmed-document handoff to the
  third-party ERP — together with the purchasing, supplier, and indicative stock position that make
  those commitments deliverable.
- **HR & Payroll** is the specialised multi-country payroll workspace, including attendance, leave,
  statutory contribution configuration, and reconciliation guidance.

Each template README explains its domain model, workflows, safeguards, source layout, and
verification. They are designed to be changed as normal Bolt workspaces rather than treated as
generated product code.

## Working with a template

A template is **not** a workspace member of this repository. It owns its own `pnpm-lock.yaml` and
resolves published `@norbital-ai/*` versions from the registry, exactly as a tenant sandbox does —
so you install and run inside the template directory:

```bash
pnpm --dir crm install
pnpm --dir crm sync
pnpm --dir crm lint
```

`sync` derives Bolt assembly and migrations and emits the deployable portable artifact at
`.norbital/artifact/bundle.mjs`; there is no separate per-template build command. Commit authored
source and `.norbital/migrations/`, but do not edit or commit other generated `.norbital` output.

Repository-wide equivalents loop over every template:

```bash
pnpm templates:install
pnpm templates:sync
pnpm templates:lint
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
unless the path differs. `counts` are checked against the source tree by `pnpm templates:check`, so
they cannot drift. `visibility` is `public` or `unlisted`; `unlisted` hides a template from the
in-product picker, and it is independent of which repository the template lives in.

## Release and tenant lifecycle

Publishing advances the fast-forward-only `refs/heads/templates/<slug>` branch to a commit produced
by `git subtree split` of the template directory, so the projected tree contains the standalone
template and nothing above it. Before that ref moves, the release workflow installs, syncs, and
lints the exact standalone projection. There is no prebuilt template package: Preview compiles the
exact selected commit only when someone asks to see it.

A remote Colony host enumerates `refs/heads/templates/*` on each configured template origin, fetches
the exact advertised commit into its local cache, and starts a new tenant repository from that
commit before recording Colony revision 0. The tenant therefore retains real ancestry with the
projected template commit, but it does not track the moving ref and is not changed when a later
template release appears. Local-directory origins are intentionally different: they read the live
checkout and make no projected-ref claim.

Yalc is only a local framework-development overlay. `pnpm yalc:link` in this repository replaces
the templates' `@norbital-ai/*` dependencies with locally built OSS packages; it does not publish a
template, link template source into Colony, or update an existing tenant. Retreat from that overlay
before release so every projected template carries exact registry pins and a clean lockfile.

Each template pins its own `@norbital-ai/bolt` version. Nothing propagates a bump into a template: a
developer runs `pnpm templates:lock` when they choose to move. Publishing a new Bolt version changes
no template and rebuilds no tenant.

```bash
pnpm templates:lock          # resolve and write each template's lockfile
pnpm templates:lock:check    # fail on drift
pnpm templates:lock:verify   # warm one shared store, then install offline with no credentials
pnpm templates:verify        # install/sync/lint and inspect each tracked template's emitted artifact
```

No template archive or package tarball is committed here. Template source is distributed through
ordinary Git refs, Preview builds are ephemeral and tied to the exact commit under review, and
dependency bytes live in one shared content-addressed pnpm store.

Editing this checkout never changes an existing tenant. Existing-tenant adoption of a later
template release is not an automated workflow; the tenant's source history remains untouched.

## License

See [LICENSE](./LICENSE).
