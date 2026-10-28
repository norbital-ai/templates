# Norbital templates

Starter workspaces for [Norbital](https://norbital.ai). Each directory here is a standalone,
filesystem-first Bolt project that can be installed, checked, built and tested with the public Bolt CLI — and forked into a tenant.

| Template                                        | Directory             | Template handle             | Purpose                                                                                 |
| ----------------------------------------------- | --------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| [**blank**](./blank/)                           | `blank/`              | `norbital_blank`            | Minimal starter with no authored business application                                   |
| [**hr-payroll**](./hr-payroll/)                 | `hr-payroll/`         | `norbital_hr`               | Multi-country HR and payroll with effective-dated facts and payroll runs                |
| [**construction**](./construction/)             | `construction/`       | `norbital_construction`     | Project-centered construction ops with BIM and workforce compliance                     |
| [**field-operations**](./field-operations/)     | `field-operations/`   | `norbital_bca`              | Site operations: dispatch, linked-contractor WhatsApp, photo integrity                  |
| [**trade-operations**](./trade-operations/)     | `trade-operations/`   | `norbital_trade_operations` | Order-centered trading and manufacturing with sealed contracts, pricing and ERP handoff |
| [**on-demand-services**](./on-demand-services/) | `on-demand-services/` | `norbital_on_demand`        | Home-service bookings with helper matching, shift checks and ETA alerts                 |

**Directory and handle are two different names.** The directory is a path in this repository: it is
what the website serves `norbital.ai/templates/<directory>` from. The handle is `norbital.template.json`'s `key`: the
template identity used by the catalogue and provisioning contract. It is not a runtime
organization or member identity. Renaming a directory moves public URLs;
renaming a template handle changes its catalogue identity. They are allowed to differ and mostly do.

Every template in this repository is public, and the website lists it automatically: the template
gallery at [norbital.ai/templates](https://norbital.ai/templates) is generated from the templates
found in this repository, using each template's own `norbital.template.json`, `README.md`, and
`assets/thumbnail.svg` (marketing card / `og:image` — declare that file once; no manifest field).
There is no rewritten marketing copy and no list to update — **publishing a template here is what
puts it on the website**.

Templates that should not be advertised live in a separate private repository. Both repositories
release the same way, so a private template is a first-class template in
every respect except website discovery and its `visibility` setting.

## Choosing a template

- **Field Operations** is the focused choice for day-of-work dispatch, qualification checks,
  site evidence, and variation requests. Contractors reach the private WhatsApp envoy through a
  linked account; under its `field_ops_whatsapp` policy it updates status, completion and summary on
  any assignment and files photos and messages, and never exposes integrity flags.
- **Construction Operations** covers wider project delivery: workforce permits, quality, RFIs,
  BIM references, payment claims, and scheduled operational watches.
- **Trade Operations** keeps sales and purchasing documents inside each order. Confirmation seals
  contract content and pricing; billing, deliveries, payments and ERP handoff remain separate evidence.
- **On-Demand Services** books helpers to customers' homes (cleaning, laundry, handyman): skill- and
  availability-matched visits with travel buffers, preferred-helper scheduling, recurring visits,
  pre-shift confirmation with controller-approved replacements and warning letters, and GPS ETA
  alerts.
- **HR & Payroll** is the specialised multi-country payroll workspace, including attendance, leave,
  statutory contributions as dated jurisdiction data, and statutory drift checks against official
  sources.

Each template README follows the same sections: purpose, apps and roles, data model, automations
and integrations, seed, and checks. They are designed to be changed as normal Bolt workspaces rather than treated as
generated product code.

## Working with a template

A template is **not** a workspace member of this repository. It owns its own `bun.lock` and
resolves published `@norbital-ai/*` versions from the registry, exactly as a tenant sandbox does —
so you install and run inside the template directory:

```bash
bun --cwd trade-operations install
bun --cwd trade-operations build
bun --cwd trade-operations test
```

`build` validates the authored manifest, schema and permissions and emits the artifact and seed
packs. When the schema changes, it generates the next editable SQL migration under `migrations/`
and verifies the complete history against the declaration. Run `bunx bolt check <template>`
for a template's generated names, types and authoring checks. This repository's `bun run check` runs the shared `bolt templates`
checks, lock verification and template gates. Commit authored source, lockfiles and the migration
SQL, `snapshot.json` and `migrations.lock.json`, never generated `.norbital/` output.

Because `@norbital-ai/*` come from GitHub Packages, an install needs a `NODE_AUTH_TOKEN` with
`read:packages`, or the equivalent entry in your `~/.npmrc`.

Authored Effect bodies use generators and yield native operations. The Effect release line is
`4.0.6`; declare `effect` directly when the template's own source imports it. Template tests
declare `@effect/vitest` at that exact version in `devDependencies` and import their test helpers
from it directly. The Bolt kit provides scoped `TestWorkspace.layer(options)` and native callers
under `t.as(t.admin)` or `t.as(member)`. Keep acquired resources inside the test's scope and assert
typed failures without converting them to successful values.

## Adding a template

Create a directory for the template (its directory name and its handle may differ), put
`norbital.template.json` at its root, and that is the whole registration — discovery reads the tree,
not a catalogue:

```json
{
	"schemaVersion": 1,
	"key": "norbital_example",
	"name": "My Template",
	"industry": "Operations",
	"description": "What it is for.",
	"visibility": "public",
	"counts": { "models": 0, "apps": 0, "automations": 0 },
	"tags": ["Operations"]
}
```

Drop `assets/thumbnail.svg` once for website cards and `og:image` — no manifest field needed
unless the path differs. `counts` are checked against the source tree by `bun run templates:check`, so
they cannot drift. `visibility` is `public` or `unlisted`; `unlisted` hides a template from the
in-product picker, and it is independent of which repository the template lives in.

## Release and tenant lifecycle

On `main`, CI builds each template once: `bolt check`, one `bolt build` and `bolt test` against that
build. The build's release (bundle, source and seed, each by digest) uploads to R2 under `releases/`.
Nothing reaches a tenant until `bun run env -- deploy promote --release=<bundle digest>` names it. A
new tenant starts from the promoted release's source; an existing tenant is not changed when a later
template release appears.

The local framework-development overlay is managed from the **realm root** with
`bun run env -- link`. It builds and packs OSS packages into the substrate's local registry,
then overlays their bytes and dependency links in installed template graphs. Committed package
pins and lockfiles remain unchanged. Run `bun run env -- retreat` there before release to
reinstall those frozen pins from the configured registry. The pinned versions must be available
in that registry for retreat to complete.

Each template pins its own `@norbital-ai/bolt` version. Nothing propagates a bump into a template: a
developer runs `bun run templates:lock` when they choose to move. Publishing a new Bolt version changes
no template and rebuilds no tenant.

```bash
bun run templates:lock          # resolve and write each template's lockfile
bun run templates:lock:check    # fail on drift
bun run check                  # the one gate, local and CI: declarations, format, every lock, the audit, then each changed
                             # template installed from its frozen lock, type-checked, built once and tested against that build
```

No template archive or package tarball is committed here; releases live in R2 and dependency bytes
in the host's shared package store.

## License

See [LICENSE](./LICENSE).
