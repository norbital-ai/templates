# HR & Payroll

![HR & Payroll workspace thumbnail](assets/thumbnail.svg)

## What this workspace is

This template is a multi-country HR and payroll settlement workspace. It turns approved employment,
attendance, leave and money events into auditable payroll results: effective-dated employment terms,
roster-based day classification, statutory overtime and contributions, repayment schedules, draft
recalculation, paid-run locking and source-linked payslip lines. It is built for countries whose
statutes the engine encodes as data — Malaysia, the Philippines and Indonesia carry cited,
effective-dated statutory rows — and everything a run pays is traceable back to the approved input
that produced it.

## The mental model

Payroll is a deterministic settlement engine over approved, effective-dated facts. Inputs and
outputs never share a table: approved inputs feed a calculator, and the only junction between a
payslip and what produced it is the `payslip_lines` row.

```text
APPROVED INPUTS                         SETTLED OUTPUT

employment_terms --+                 +-> payroll_runs [one policy snapshot]
time_entries -------+                 |        |
leave_requests -----+--> calculator -+        v
component_entries --+                          payslips
       |                                        |
       v                                        v
pay_components <-------------------------- payslip_lines
 [policy + calculation +                    [the only junction]
  entitlement union]                        |- pay_component_id
                                             |- component_entry_id (when entry-backed)
                                             `- statutory_contribution_id (when statutory)
```

Five collections carry the payroll core:

1. **`pay_components`** — one reusable definition with a strict settlement/statutory policy and a
   polymorphic calculation definition (`SCHEDULE`, `ENTRY`, `FORMULA`). Overtime is deliberately
   not among them: it is derived from time entries priced against the jurisdiction's own overtime
   rules, and its statutory treatment lives on the scheme that charges it.
2. **`component_entries`** — approved monetary events: claims, allowances, adjustments, loan
   instalments.
3. **`payroll_runs`** — one company-period calculation with one captured configuration snapshot.
4. **`payslips`** — one employment's totals in a run.
5. **`payslip_lines`** — the direct payslip-to-component junction and complete breakdown.

Around that core: `companies` and `jurisdictions` scope the legal entity; `employments`,
`employment_terms` and `employment_statutory_facts` describe a person's working facts;
`shift_definitions`, `rosters`, `roster_entries`, `time_entries`,
`company_holidays`, `leave_types` and `leave_requests` supply the schedule and leave facts;
each effective-dated `jurisdictions` snapshot atomically owns overtime coverage, pricing and
limits; `statutory_contributions` and `contribution_rates` remain normalized
because contribution programmes and their bands have independent identities; and
`repayment_agreements` carries staff loans and overpayment recoveries.

Two invariants shape everything:

- **Overtime, contributions, gross and net are calculated, never stored or seeded.** A run derives
  them from the input records and is compared against an independently supplied source workbook.
- **Approval is the gate.** There is no approval column anywhere in this workspace:
  `approval_id IS NULL` is the only definition of a live row. Payroll reads only approved
  rows; a record still held by an approval request is locked and excluded.

## What ships in the workspace

### Apps (8)

**`hr_employee`** — employee self-service. A person sees their profile, company and next payday,
and can record time entries, raise leave requests and claims (each routed for approval), and read
their own loan agreements and payslips. A person with no active employment is told so; a person
with several chooses which one the page scopes to.

**`hr_controller`** (group) — the HR operating surface, seven pages:

| App                   | What a user does in it                                                                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **People**            | The workforce: employee profiles, employments, effective-dated terms, statutory facts, and a workforce-shape chart                                                                                                                                                                                       |
| **Scheduling**        | Plans the month on a roster board — one row per person, one glyph per day — publishes it against statutory rules, and manages shifts, work patterns and holidays. The attendance insight chart now lives on its Exceptions tab, and its import sits on the board's action menu beside the roster import. |
| **Leave**             | Review leave requests and the leave types that entitle them, against year-to-date approval counters                                                                                                                                                                                                      |
| **Loans**             | Review repayment agreements and their derived outstanding balance, with instalment recovery tracked per payslip                                                                                                                                                                                          |
| **Pay components**    | The pay catalogue and the entry stream: claims, allowances, adjustments and their contribution treatment                                                                                                                                                                                                 |
| **Payroll**           | Runs the payroll cycle: a pay-date board (late/current/upcoming), creating and recalculating runs, locking them paid, and exporting bank files, payslip PDFs and the report workbook                                                                                                                     |
| **Statutory profile** | The regime every payroll is calculated against — effective-dated jurisdiction snapshots with atomic overtime and break policy, normalized contribution schemes and rates, and the companies bound to each (file `+settings.svelte`: a file name owns an app's identity)                                  |

### Policies (7)

- **`employee`** — self-service: their own profile, employments and the child collections, plus
  create-with-approval for time entries, claims and leave.
- **`supervisor`** — reads the team, reviews and records their attendance and leave.
- **`manager`** — reads people operations across the company and owns their team's time and leave.
- **`hr_controller`** — HR administration across people, scheduling, requests, loans and
  adjustments, with payroll visible but not committable.
- **`hr_manager`** — everything HR administration covers, plus creating, running and deleting
  payroll runs.
- **`senior_management`** — the full people-operations view, plus creating, running and deleting
  payroll runs.
- **`statutory_drift_automation`** — the automation's authority: reads statutory and employment
  snapshots, appends deterministic successor facts, and records durable drift research evidence.

Policies name the `hr_controller` app _group_ rather than each page, so adding a controller page
does not mean revisiting every role declaration.

### Live analytics

The controller's leave, pay-component and attendance charts read the relevant collections through
`client.db`. Those queries stay current through the workspace sync engine; the components derive
their bounded five-year heatmaps and eight-week attendance trend locally without a polling or
manually refreshed query function.

### Agent context

`src/+agents.md` supplies the shared HR/payroll context for web and envoy turns: tool-result honesty,
collection meanings, money/date rules, and the boundary around statutory advice. It grants nothing;
the signed-in person's policies remain the complete authority for a web-agent turn.

### Automations (1)

**`statutory_profile_drift`** — weekly automation (`0 3 * * 1`). Bounded reads of in-force jurisdiction
snapshots, contribution schemes and employment statutory facts; rule-based drift detection; optional
successor copy of `employment_statutory_facts` when a unique successor scheme exists; its policy
requires HR Manager approval, and the create hook stages the predecessor close so approval settlement
commits both rows or neither. `api.infer` writes the report. It never writes the law tables.

### Integrations, seed

statutory and sensitive fixture seed lives in the repository seed bank (see below), and payroll inputs belong to the
reconciliation workflow described in [`docs/data.md`](docs/data.md).

## Operational boundary

Seed only payroll inputs. Never seed a payroll run, payslip, calculated overtime amount, statutory
contribution, gross, net or source incentive-overtime result. A run must calculate those values from
the input records and then be compared with an independently supplied source workbook. This rule is
why the engine refuses a run that cannot produce a figure rather than approximating it, and why
paid runs are immutable — a correction is always a new approved event in a later draft.

## Under the hood

### Source layout

Everything the compiler knows about the workspace lives in `src/`:

```text
src/
├── apps/                     # +<app>.svelte per app; hr_controller/+group.ts owns the group
├── collections/              # 23 collections: +model.ts, +hooks.ts, +pipelines.ts, +representation.svelte
│   └── payroll_runs/lib/     # the settlement engine (phases, overtime, coverage, export)
├── datatypes/                # 27 structured values (statutory_regime, work_pattern, overtime_band, …)
├── access/                   # +teams.ts, anonymous limits, and seven policies
├── i18n/                     # messages.en.json / messages.zh.json (same key set)
├── automations/              # statutory_profile_drift (weekly and manually triggerable)
├── lib/                      # shared helpers: calendar, display formatters, policy grants, roster month
└── +agents.md
```

- **Models** describe storage only; presentation lives in apps and representations.
  `src/collections/+relationship.ts` owns the relation graph — foreign keys are derived from it,
  never declared in a model.
- **Hooks** validate and derive. The payroll create hook resolves the run's attendance window, pay
  date and configuration hash; the roster hooks enforce publishability; the repayment hooks keep an
  instalment schedule exactly reconciled with its principal.
  Effective-dated overlap and loan-instalment uniqueness are database constraints, not per-row hook
  SELECTs: `createMany` must retain one hook invocation per record without turning a statutory table
  or derived repayment schedule into one remote database round trip per row.
- **Pipelines** (`+pipelines.ts` on `roster_entries`, `time_entries` and `payroll_runs`) shape
  workbook import/export: the roster and attendance importers accept a month grid (or a long-form
  person-day sheet) for one legal entity, and the payroll exporter produces the bank file, payslip
  PDFs and report workbook the app offers.
- **Representations** decide create/display/edit per collection. `payroll_runs` and `payslips`
  refuse hand-created output; a payslip is written by the engine, never by hand.
- **i18n** — both catalogs carry the same 867 keys; app metadata in `<svelte:head>` stays static
  English, and per-locale sidebar labels come from the catalogs.

### The docs

- [`docs/architecture.md`](docs/architecture.md) — the live payroll engine: the model map, the
  eight calculation phases, cutoffs and periods, roster-to-day-type classification, overtime and
  the 12-hour/104-hour controls, statutory treatment, adjustments and ledgers, provenance, locking,
  and what of the statutory law is encoded (and what is not).
- [`docs/data.md`](docs/data.md) — the raw-source → cleaned-source → seed contract, the checks that
  prevent derived output from leaking back into inputs, and how an independent source workbook is
  reconciled against a generated one.

## Verification

The template includes focused arithmetic and export checks. `pnpm test` runs that suite, while
`pnpm sync` compiles the workspace and emits its portable deployment artifact:

```bash
pnpm sync     # regenerate .norbital and emit .norbital/artifact/bundle.mjs
pnpm lint     # prettier + svelte-check
pnpm test     # everything below, plus the repayment-agreement and roster unit tests
node scripts/verify-payroll-arithmetic.mjs   # the long-form arithmetic acceptance run
node scripts/verify-fixture-shapes.mjs       # audits that run's fixtures against the real API shape
```

`node scripts/generate-import-templates.mjs` writes the roster and time-entry import templates to
`~/Desktop` — one legal entity × one month, a person per row and a calendar day per column, with a
short Settings sheet. Long-form person-day sheets still import; these files are the ones operators
are issued. The `Read me first` sheet states only the rules the readers enforce.

The arithmetic run used to be on-demand and outside `pnpm test`. It is in `pnpm test` now, because
being outside it is what let a fixture rot unnoticed until the assertion above it stopped meaning
anything. A check nobody runs is a check that does not exist.

`verify-fixture-shapes.mjs` re-runs the arithmetic script under instrumentation and reports two
things: fields the engine read that a fixture never supplied, and fixture keys that exist nowhere in
`src/`. It exists because a fixture once described a response shape the API does not have — `nature`
on an invented `componentType` — which made a passing assertion prove nothing. Deleted collections
survive in stale build artefacts (`.norbital/dist/`), so a
fixture written against one of those looks right and is not; check `src/collections/<name>/+model.ts`
instead. Read that script's header before trusting a green run: it is honest about what it cannot
see, and a green run means nothing until the mutation check described there has been done.

The confidential source reconciliation is opt-in on the host; see
[`docs/data.md`](docs/data.md#reconciliation-method).

## Changing the template

This is a Bolt tenant workspace: the Bolt filesystem compiler derives the registry, workspace, client
and local types under `.norbital/` from `src/` alone. Workflow:

```bash
pnpm sync     # after any edit under src/ — regenerates .norbital (committed migrations stay put)
pnpm lint     # prettier + svelte-check over the workspace
```

There is no separate build command. `sync` emits `.norbital/artifact/bundle.mjs`, the portable
artifact a host deploys.

- **Models** — do not change model schemas casually: each schema change produces a committed
  migration under `.norbital/migrations/`. Edit `+model.ts`, run `pnpm sync`, then review the
  migration the compiler emits.
- **Seed** — fixture data is host-owned and lives in the repository seed bank; there is no
  `src/+seed.ts` role, and seeding does not evolve deployed data. For an existing tenant, write the
  next lineage entry with `pnpm exec bolt migrate --name <name>`, edit its SQL, and deploy it
  through Colony.
  Sensitive statutory seed (the jurisdiction regime snapshots and contribution rows) stays outside
  this template, in the repository seed bank at `seed_bank/norbital_hr/statutory/`.
- **Publishing** — the template pins `@norbital-ai/bolt` in its own `package.json` and lockfile.
  After a deliberate dependency move, refresh the template lock through the repository
  template-lock workflow. The templates release workflow advances
  `refs/heads/templates/hr-payroll`; a remote Colony host uses that exact commit when it provisions
  a new tenant, while an existing tenant remains on the revision it adopted. `pnpm yalc:link` only
  tests locally built OSS dependencies inside this template and neither publishes template source
  nor updates Colony.
