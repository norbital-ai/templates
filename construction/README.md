# Construction — How It Works

![Construction workspace thumbnail](assets/thumbnail.svg)

A project-centered construction operations workspace: projects, work fronts, jobs, workers and
their permits, quality defects, RFIs, payment claims, handover documents, and a BIM reference
matrix for cost and embodied-carbon baselines — with a server-enforced rule that a worker is only
assigned to a work front when a currently valid permit covers every certification the linked job
requires. It provides the operations model and safety checks for project delivery; it does not
replace an ERP, a BIM authoring tool, or a regulatory permit authority.

This is an executable Bolt template, not a production-operations manual. Start with the
[operating model](#operating-model) below, then use the [collections](#collections),
[apps](#apps-and-policies), [automations](#daily-operational-watches), and
[verification](#changing-the-template) sections when changing it.

## Operating model

1. Establish a **project**, its **site locations** (work fronts), and BIM reference context.
2. Configure **certification types** and issue **permits to work** that prove a worker's currently
   valid authority and the certifications it covers.
3. Define **jobs** (work packages), link them to work fronts and required certifications, then
   create worker **assignments** — every assignment passes a server compliance check before it
   exists.
4. Run delivery in the project record: review the IFC coordination model, track RFIs and defects
   per project, and allocate manpower per work front.
5. Track commercial work through **payment claims** and keep the documents supporting each claim.
6. Review the four scheduled daily exports for permits, defects, RFIs, and claim readiness.

The data model keeps these concerns separate: jobs describe work packages; site locations describe
work fronts; permits prove a worker's currently valid authority; and assignments connect a worker
to work only after the compliance check passes.

```
projects ─┬─ site_locations ── job_assignments ── workers ── permits_to_work ── certification_types
          ├─ jobs ────────────┘                         │             └── permit ↔ certification join
          ├─ rfis · defects · payment_claims            └── permit ↔ worker join
          └─ asset_documents · bim_reference_matrix   jobs ↔ certifications / site_locations (joins)
```

## Collections

| Collection                            | Purpose                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| `projects`                            | Construction projects and operating context.                      |
| `jobs`                                | Work packages linked to site locations and BIM references.        |
| `workers`                             | Worker roster used for assignment and compliance.                 |
| `certification_types`                 | Certification library defining workforce requirements.            |
| `site_locations`                      | Work fronts and delivery zones within a project.                  |
| `defects`                             | Quality issues and closeout items.                                |
| `rfis`                                | Design and coordination questions.                                |
| `payment_claims`                      | Commercial claims with readiness and submission state.            |
| `permits_to_work`                     | Permit and competency validity records.                           |
| `asset_documents`                     | Handover and asset-linked documents.                              |
| `bim_reference_matrix`                | BIM item master sheet for cost and carbon estimation.             |
| `job_assignments`                     | Worker assignments to jobs and site locations (compliance-gated). |
| `jobs_certification_types`            | Join: jobs ↔ certification_types.                                 |
| `jobs_site_locations`                 | Join: jobs ↔ site_locations.                                      |
| `permits_to_work_certification_types` | Join: permits_to_work ↔ certification_types.                      |
| `permits_to_work_workers`             | Join: permits_to_work ↔ workers.                                  |

Relationships: `permits_to_work` ↔ `certification_types` and ↔ `workers` (many-to-many through the
join tables); `jobs` ↔ `certification_types` and ↔ `site_locations` (same); `job_assignments` →
`workers` / `jobs` / `site_locations` (direct foreign keys). Every RFI, defect, claim, permit,
document, site location, and job belongs to a project.

### Job assignment compliance

`job_assignments/+hooks.ts` validates create and update:

1. Load the worker's active permits (via `permits_to_work_workers` + `permits_to_work`) and collect
   the certification ids they cover.
2. Load the jobs linked to the assignment's site location (via `jobs_site_locations` + `jobs`) with
   their required certifications.
3. Require at least one site job whose required certifications are all covered by an active,
   in-validity permit.

The rule is enforced in both create and update hooks, not just in the assignment UI. Empty
requirements do not pass the guard: every assignment requires a site-location job with an explicit
qualification set.

## Apps and policies

| App                                      | What a user does                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `construction_project_workspace`         | Browse the project catalogue; open a project record for the delivery detail. |
| `construction_settings_workforce`        | Manage workers, certification types, and job requirements.                   |
| `construction_settings_reference_matrix` | Maintain the BIM reference matrix: codes, units, rates, carbon factors.      |

The project workspace app is deliberately just the projects table: the depth lives in the project
record itself. Its representation opens three tabs — **Model & coordination** (the IFC viewer next
to the project's RFIs and defects), **Manpower allocation** (one lane per work front with worker
cards), and **Commercial & controls** (contract value against claimed/certified amounts, payment
claims, project documents, and current permits to work). Site locations, asset documents, and
permits to work have no tab of their own anywhere and are reached only through a project — the only
context in which any of them means much.

Three policies match those three apps one for one, and their grant sets are identical: unconditional
read on the same twelve collections. The narrowing is `apps`, not `where`. That is deliberate rather
than lazy — construction carries no requestor-bearing column on any of these collections, so there
is nothing for a `where` clause to scope to, and what actually separates a delivery user from a
settings administrator is which application they can open. The three files repeat the twelve grant
lines instead of sharing a list, because `src/policies` admits only `+<name>.policy.ts`; twelve
literal lines per file is the price of keeping a policy's whole grant set readable in the file that
names it.

## Daily operational watches

Four server automations run at `06:00` each day. They produce bounded JSON exports for operational
review; they do not send messages, escalate records, or mutate business state.

| Automation                      | Subject           | Export file                          |
| ------------------------------- | ----------------- | ------------------------------------ |
| `permit_expiry_watch`           | `permits_to_work` | `permit-expiry-watch.json`           |
| `defect_closeout_digest`        | `defects`         | `defect-closeout-digest.json`        |
| `rfi_followup_watch`            | `rfis`            | `rfi-followup-watch.json`            |
| `payment_claim_readiness_watch` | `payment_claims`  | `payment-claim-readiness-watch.json` |

All four share one shape: read at most 250 rows, report that number as the summary count, and
export the first 25 as the file body. Two different bounds because they answer two different
questions — a reviewer wants a sense of scale and a handful of rows to look at, not a full table in
a JSON blob. The summary count therefore saturates at 250 and is a floor once a subject grows past
that, not a total. If a deployment needs alerts, an integration or delivery facility must be added
explicitly; these read-only watches notify no one on their own.

## Under the hood

Bolt discovers the workspace from the filesystem; `vite.config.ts` is the only root entry point.
All source lives under `src/`; the compiler derives the registry, workspace, client, and types
under `.norbital/`.

```text
src/apps/                              the three applications (+<app>.svelte)
src/policies/                          one read-only role per application
src/collections/                       models (+model.ts), relations (+relationship.ts),
                                       the compliance hook, and form/detail representations
src/automation/                        the four daily review watches (+<name>.ts)
src/custom-types/                      money, project address, site coordinates,
                                       emergency contact, permit signatures (+definition.ts + renderer)
src/i18n/                              English and Chinese copy, same key sets (messages.en/zh.json)
src/collections/projects/ifc-viewer/   the embedded IFC viewer and its converter worker
assets/                                thumbnail and record media; the sample IFC model under assets/ifc/
```

How the pieces work:

- **Representations.** Every collection ships a `+representation.svelte` that overrides the
  schema-derived form where the auto form would be two uuid boxes (join tables, relationship
  fields). Fields that point at another collection render through `RelationshipRenderer` with a
  human `code · name` label; no system id is ever painted. The project's representation is the one
  genuinely bespoke surface (the IFC viewer, manpower lanes, commercial rollups) and lives as
  `project-representation.svelte` beside it.
- **The IFC viewer.** `src/collections/projects/ifc-viewer/` holds a lazy-loaded WebGL viewer (`ifc_viewer.svelte`)
  plus a converter that runs web-ifc in a worker (`ifc_viewer.converter.worker.ts`) and a typed
  surface for the esm.sh-loaded viewer libraries (`ifc_viewer.types.ts`). It is mounted inside the
  project record when a linked `asset_documents` row carries an `ifc_model` document (or a
  `.ifc` URL); the sample model under `assets/ifc/` is what a freshly seeded tenant shows.
- **Custom types.** Structured values that cannot be plain columns: `money` (ISO 4217 currency
  with an optional `allowedCurrencies` restriction), `project_address`, `site_coordinates`,
  `emergency_contact`, and `permit_signatures`. Each has a definition (the only schema) and a
  renderer (display and edit).
- **i18n.** The workspace ships English and Chinese catalogs with exactly the same keys. App
  metadata in `<svelte:head>` stays static English; the sidebar label and page copy localize via
  the catalogs.
- **Seed data.** The workspace ships no `+seed.ts`. Fixture data (projects, jobs, workers,
  permits, RFIs, defects, claims, the BIM matrix, documents) is provisioned by the host's
  construction seed plan, which serves the committed `assets/` files at
  `/api/template-seed-assets/construction/...` — including the sample IFC model used by the
  project record's viewer.

Use collection hooks for non-negotiable server rules, a custom type when a reusable field needs its
own validation and renderer, and a collection representation only when schema-derived UI is
insufficient. Keep large BIM artefacts in a file-storage facility; the `bim_reference_matrix` is
the reference and baseline model, not a replacement for native BIM files.

## Changing the template

A template is a normal Bolt workspace: install once, then sync, lint, and build inside this
directory.

```bash
pnpm sync
pnpm lint
pnpm build
```

`sync` derives Bolt assembly and migrations. Commit authored source and `.norbital/migrations/`
with your change, but do not edit or commit other generated `.norbital` output. Publish a template
revision and deploy a new tenant checkpoint before expecting an existing tenant to use it — a
tenant is forked from the published commit and never moves on its own. See the
[template lifecycle](../README.md#release-and-tenant-lifecycle) for the full release flow.
