# Construction Operations

![Construction workspace thumbnail](assets/thumbnail.svg)

A project-centered construction operations workspace: projects, work fronts, jobs, workers and
their permits, quality defects, RFIs, payment claims, handover documents, and a BIM reference
matrix for cost and embodied-carbon baselines — with a server-enforced rule that a worker is only
assigned to a work front when active permits in force today cover every certification required by
at least one job linked to that work front. It provides the operations model and safety checks
for project delivery; it does not replace an ERP, a BIM authoring tool, or a regulatory permit authority.

## Apps and roles

| App                                      | What a user does                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `construction_project_workspace`         | Browse the project catalogue; open a project record for the delivery detail. |
| `construction_settings_workforce`        | Manage workers, certifications and jobs.                                     |
| `construction_settings_reference_matrix` | Maintain the BIM reference matrix: codes, units, rates, carbon factors.      |

The project workspace app is deliberately just the projects table: the depth lives in the project
record itself. Its representation opens three tabs — **Model & coordination** (the IFC viewer next
to the project's RFIs and defects), **Manpower allocation** (the native assignment table scoped to this project), and **Commercial & controls** (contract value against claimed/certified amounts, payment
claims, project documents, and current permits to work). Site locations, asset documents, and
permits to work have no tab of their own anywhere and are reached only through a project — the only
context in which any of them means much.

Teams (`src/access_control/team/+team.ts`):

| Team (handle)                                                       | Policies                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| Project Delivery (`project_delivery`)                               | `construction_read`, `construction_project_workspace`         |
| Reference Matrix Administrators (`reference_matrix_administrators`) | `construction_read`, `construction_settings_reference_matrix` |
| Workforce Administrators (`workforce_administrators`)               | `construction_read`, `construction_settings_workforce`        |
| Construction Administrators (`construction_administrators`)         | `construction_read` and all three app policies                |

`src/access_control/policy/+construction_read.policy.ts` owns the shared read grants. Three
app-opening policies supply only capabilities. Source teams in
`src/access_control/team/+team.ts` explicitly link those policies. Teams select available apps;
these grants do not permit business writes. Creating and changing records requires the native
workspace administrator flag. A team label containing “Administrators” does not confer that flag.

Team and policy definitions are source only. There is no runtime editor for these definitions,
and this template declares no approval flows. Changing access requires editing source
and adopting the rebuilt release.

## Data model

| Model                                 | Purpose                                                           |
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

References (`ref` fields on the model holding the key): `permits_to_work` ↔ `certification_types` and ↔ `workers` (many-to-many through the
join tables); `jobs` ↔ `certification_types` and ↔ `site_locations` (same); `job_assignments` →
`workers` / `jobs` / `site_locations` (direct foreign keys). Every RFI, defect, claim, permit,
document, site location, and job belongs to a project.

### Job assignment compliance

The `create.transform` and `update.transform` in `src/data/model/job_assignments/+model.ts` share
one check that uses one native keyed read for worker-permit links, site jobs, their active permits
and their required certifications. Dependent members resolve from earlier members in that same read
group.

At least one site job must have a nonempty qualification set fully covered by the worker's active
permits in force today. Otherwise the whole batch is refused, with no partial assignments. The
check runs on create and when the worker or site changes. Changes to job, role, hours or dates that
leave worker and site unchanged preserve the existing assignment without rechecking eligibility.

### Operating model

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

## Automations and integrations

Four server automations run at `06:00` each day. They produce bounded JSON exports for operational
review; they do not send messages, escalate records, or mutate business state.

| Automation                      | Subject           | Export file                          |
| ------------------------------- | ----------------- | ------------------------------------ |
| `permit_expiry_watch`           | `permits_to_work` | `permit-expiry-watch.json`           |
| `defect_closeout_digest`        | `defects`         | `defect-closeout-digest.json`        |
| `rfi_followup_watch`            | `rfis`            | `rfi-followup-watch.json`            |
| `payment_claim_readiness_watch` | `payment_claims`  | `payment-claim-readiness-watch.json` |

All four share one shape: read at most 25 rows, report that number as the summary count, and export
the same rows as the file body. The bounds hold a review a reviewer can read — the sweep is a
morning digest, not a full table in a JSON blob. These read-only watches notify no one on their
own: a deployment that wants alerts adds a conversation connection to `src/+workspace.ts` (e.g.
`{ integration: 'whatsapp' }`), names it as a notification channel, and pairs the instance under
**Settings → Integrations** with the business's own account.

## Source layout

Bolt discovers named declarations under `src/`, beginning with `src/+workspace.ts`.
`bolt check` validates the source contract; `bolt build` generates types, the artifact and seed
packs under `.norbital/`, plus editable schema migrations under `migrations/`.

```text
src/+workspace.ts                     workspace locale, timezone and defaults
src/app/<app>/                        application declaration and pages
src/access_control/team/+team.ts      source teams and explicit policy links
src/access_control/policy/+*.policy.ts source grants and capabilities
src/data/model/<name>/                model (storage, refs, exposure, write callbacks) and optional representation
src/data/custom_field/<name>/         inline type definition and renderer
src/automation/                       four daily review watches
src/i18n/                             English and Chinese messages
src/lib/ifc-viewer/                    lazy viewer and converter worker
assets/                               media and the bundled sample IFC
```

How the pieces work:

- **Representations.** Model folders hold `+representation.svelte` companions. Forms reuse
  native `RecordShell`, `Form`, `Field`, `Section` and relationship `Picker` controls. The project
  combines the IFC viewer, native model tables and per-currency commercial totals. Allocation
  filtering, actions and record management belong to the native table toolbar and controller.
- **The IFC viewer.** `src/lib/ifc-viewer/` holds a lazy-loaded WebGL viewer (`ifc_viewer.svelte`)
  plus a converter that runs web-ifc in a worker (`ifc_viewer.converter.worker.ts`), with ambient
  declarations for the esm.sh-loaded viewer libraries (`ifc_viewer.runtime.d.ts`). It is mounted inside the
  project record when a linked `asset_documents` row carries an `ifc_model` document (or a
  `.ifc` URL); the sample model under `assets/ifc/` is what a freshly seeded tenant shows.
- **Join names.** Each join model's `create.transform` and `update.transform` name the row by its
  two sides' labels (one keyed read per write).
- **Custom types.** Parent-owned structured values use `project_address`, `site_coordinates`,
  `emergency_contact` and `permit_signatures`, each with one definition and a renderer. Money is a
  builtin: `{ kind: 'money', currency: 'currency' }` uses the row's currency field and native controls.
- **i18n.** English and Chinese message declarations supply localized app and record copy.

Use a model's write callbacks for non-negotiable server rules, a custom type when a reusable field needs its
own validation and renderer, and a model representation only when schema-derived UI is
insufficient. Keep large BIM artefacts in a file-storage facility; the `bim_reference_matrix` is
the reference and baseline model, not a replacement for native BIM files.

## Seed

- **base** — `seed/*.json`: projects, certification types and workers.
- **sample** (private) — `seed/seed.ts` reads the seed bank's `construction` tree (projects, jobs,
  workers, permits, RFIs, defects, claims, the BIM matrix, documents) with
  `bolt build --bank=<checkout>`. The bank's rows are read without rewriting them, so `seed.ts`
  converts their shapes to the current field kinds (day ranges, dates in the business zone, money
  with its row currency), maps the bank's team ids to the team handles, and rewrites document URLs to the artifact's `/assets/`, where the sample
  IFC model under `assets/ifc/` is served for the project record's viewer.

## Checks

```bash
bun install
bunx bolt check   # types, Svelte warnings, layout and declarations
bun run build   # bolt build (add --bank=<checkout> for the sample pack)
bun run test    # bolt test, including tests/e2e/surface-sweep.integration.test.ts
```

`.norbital/` is generated and never committed. Schema changes generate the next editable SQL
migration under `migrations/` and verify the complete history against the declaration. Commit
the SQL, `snapshot.json` and `migrations.lock.json` together. Rebuilding does not reset an existing
database or update an adopted tenant release. See the [template lifecycle](../README.md#release-and-tenant-lifecycle).
