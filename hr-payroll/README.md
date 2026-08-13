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
   polymorphic calculation definition (`SCHEDULE`, `ENTRY`, `FORMULA`, `OVERTIME`,
   `OVERTIME_EXCESS`).
2. **`component_entries`** — approved monetary events: claims, allowances, adjustments, loan
   instalments.
3. **`payroll_runs`** — one company-period calculation with one captured configuration snapshot.
4. **`payslips`** — one employment's totals in a run.
5. **`payslip_lines`** — the direct payslip-to-component junction and complete breakdown.

Around that core: `companies` and `jurisdictions` scope the legal entity; `employments`,
`employment_terms` and `employment_statutory_facts` describe a person's working facts;
`shift_definitions`, `rosters`, `roster_entries`, `time_entries`,
`company_holidays`, `leave_types` and `leave_requests` supply the schedule and leave facts;
each effective-dated `jurisdictions` snapshot atomically owns overtime coverage, pricing, limits
and rest-break requirements; `statutory_contributions` and `contribution_rates` remain normalized
because contribution programmes and their bands have independent identities; and
`repayment_agreements` carries staff loans and overpayment recoveries.

Two invariants shape everything:

- **Overtime, contributions, gross and net are calculated, never stored or seeded.** A run derives
  them from the input records and is compared against an independently supplied source workbook.
- **Approval is the gate.** There is no approval column anywhere in this workspace:
  `norbital_approval_id IS NULL` is the only definition of a live row. Payroll reads only approved
  rows; a record still held by an approval request is locked and excluded.

## What ships in the workspace

### Apps (9)

**`hr_employee`** — employee self-service. A person sees their profile, company and next payday,
and can record time entries, raise leave requests and claims (each routed for approval), and read
their own loan agreements and payslips. A person with no active employment is told so; a person
with several chooses which one the page scopes to.

**`hr_controller`** (group) — the HR operating surface, eight pages:

| App                   | What a user does in it                                                                                                                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **People**            | The workforce: employee profiles, employments, effective-dated terms, statutory facts, and a workforce-shape chart                                                                                                                                                      |
| **Scheduling**        | Plans the month on a roster board — one row per person, one glyph per day — publishes it against statutory rules, and manages shifts, work patterns and holidays                                                                                                        |
| **Time & attendance** | Review clock data: overview charts and the dated time-entry ledger                                                                                                                                                                                                      |
| **Leave**             | Review leave requests and the leave types that entitle them, against year-to-date approval counters                                                                                                                                                                     |
| **Loans**             | Review repayment agreements and their derived outstanding balance, with instalment recovery tracked per payslip                                                                                                                                                         |
| **Pay components**    | The pay catalogue and the entry stream: claims, allowances, adjustments and their contribution treatment                                                                                                                                                                |
| **Payroll**           | Runs the payroll cycle: a pay-date board (late/current/upcoming), creating and recalculating runs, locking them paid, and exporting bank files, payslip PDFs and the report workbook                                                                                    |
| **Statutory profile** | The regime every payroll is calculated against — effective-dated jurisdiction snapshots with atomic overtime and break policy, normalized contribution schemes and rates, and the companies bound to each (file `+settings.svelte`: a file name owns an app's identity) |

### Policies (3)

- **`employee`** — scopes self-service to the requestor: their own profile, employments and the
  nine child collections, plus create-with-approval for time entries, claims and leave.
- **`hr`** — administers people, scheduling, requests, loans and payroll: reads the statutory law,
  writes the company's own configuration, and raises reviewed time, leave and payroll-run events.
- **`management`** — reads everything HR reads and writes almost none of it: the exceptions are
  creating/running payroll and acting on reports' time and leave, each routed for approval.

A policy names the `hr_controller` app _group_ rather than each page, so adding a controller page
does not mean revisiting every role declaration.

### Remote (1)

**`approval_analytics`** supplies year-to-date approval counters and a five-year trend for the
three subjects the controller pages summarise: payroll runs, leave requests and claims. It is worth
reading for how it phrases those counts: every counter is expressed as `norbital_approval_id IS
NULL`, because that is the only definition of a live row.

### Agent

`src/+agent.ts` declares the workspace agent narrowly — write access to `companies` alone, one host
tool, and bounded iterations and tokens. An agent receives a grant here, not the workspace.

### Automations (1)

**`statutory_profile_drift`** — weekly deterministic automation. Bounded reads of in-force jurisdiction
snapshots, contribution schemes and employment statutory facts; rule-based drift detection; optional
successor copy of `employment_statutory_facts` when a unique successor scheme exists; `api.infer` writes
the report. Never writes the law tables (those stay product-owned).

### Integrations, seed
statutory and sensitive fixture seed is Core-owned (see below), and payroll inputs belong to the
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
├── collections/              # 21 collections: +model.ts, +hooks.ts, +pipelines.ts, +representation.svelte
│   └── payroll_runs/lib/     # the settlement engine (phases, overtime, coverage, export)
├── custom-types/             # 27 structured values (money, statutory_regime, work_pattern, …)
├── policies/                 # employee, hr, management
├── remotes/                  # approval_analytics
├── i18n/                     # messages.en.json / messages.zh.json (same key set)
├── automation/               # statutory_profile_drift (weekly deterministic)
├── lib/                      # shared helpers: calendar, display formatters, policy grants, roster month
└── +agent.ts
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

The template includes focused arithmetic and export checks. All of them run against the source, so
`pnpm test` is the whole story and `pnpm build` only builds:

```bash
pnpm sync     # regenerate .norbital (never hand-edit generated output)
pnpm lint     # prettier + svelte-check
pnpm test     # everything below, plus the repayment-agreement and roster unit tests
pnpm build    # production build only
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
survive in stale build artefacts (`graphify-out/cache/stat-index.json`, `.norbital/dist/`), so a
fixture written against one of those looks right and is not; check `src/collections/<name>/+model.ts`
instead. Read that script's header before trusting a green run: it is honest about what it cannot
see, and a green run means nothing until the mutation check described there has been done.

The confidential source reconciliation is opt-in in Core; see
[`docs/data.md`](docs/data.md#reconciliation-method).

## Changing the template

This is a Pod tenant workspace: the Pod filesystem compiler derives the registry, workspace, client
and local types under `.norbital/` from `src/` alone. Workflow:

```bash
pnpm sync     # after any edit under src/ — regenerates .norbital (committed migrations stay put)
pnpm lint     # prettier + svelte-check over the workspace
pnpm build    # production build
```

- **Models** — do not change model schemas casually: each schema change produces a committed
  migration under `.norbital/migrations/`. Edit `+model.ts`, run `pnpm sync`, then review the
  migration the compiler emits.
- **Seed** — new-tenant fixture behavior belongs in `src/+seed.ts`; it does not evolve deployed
  data. For an existing tenant, create a committed migration with `pnpm exec pod migration create
<name> --custom`, edit its SQL, and resolve conflicts in Organization Studio → Template updates.
  Sensitive statutory seed (the jurisdiction regime snapshots and contribution rows) stays Core-owned at
  `norbital/apps/core/seed/norbital_hr/statutory/rows.ts`.
- **Publishing** — the template pins `@norbital-ai/pod` in its own `package.json` and lockfile.
  After a deliberate dependency move, refresh the template lock through the repository
  template-lock workflow. Consume a new template release in Core with
  `pnpm tenant:update --org=<org-slug> --template=hr-payroll`, then hard-refresh the iframe; use
  `pnpm env:reset --target dev --template hr-payroll` only for a deliberate reseed.
