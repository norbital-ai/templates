# HR & Payroll

![HR & Payroll workspace thumbnail](assets/thumbnail.svg)

## What this workspace is

This template is a multi-country HR and payroll settlement workspace. It turns approved employment,
attendance, leave and money events into auditable payroll results: effective-dated employment terms,
roster-based day classification, statutory overtime and contributions, repayment schedules, draft
recalculation, paid-run locking and source-linked payslip lines. It is built for countries whose
statutes the engine encodes as data — Malaysia, the Philippines and Indonesia carry cited law,
versioned as sealed statutory profiles — and everything a run pays is traceable back to the approved
input that produced it.

## The mental model

Payroll is a deterministic settlement engine over approved, effective-dated facts. Its two halves
never share a table: **inputs** are the approved records a run read, and **outputs** are the
immutable values it calculated from them. Every linkage is a real foreign key — four engine-owned
input junctions tie each payslip to the work days, component entries, loan repayments and leave
requests it consumed, and every payslip adjustment names exactly one of those captures.

```text
APPROVED INPUTS                          SETTLED OUTPUT

employment_terms --+                  +-> payroll_runs [one policy + statutory snapshot]
work_days ----------+                 |        |
leave_requests -----+--> calculator -+        v
component_entries --+                          payslips
loan_repayments ----+                          |
                                               |- base / proration / statutory (inlined)
pay_components <-----------+                   |- payslip_work_day_inputs
 [policy + calculation]    |                   |- payslip_component_entry_inputs
                           |                   |- payslip_leave_request_inputs
loans -> loan_repayments <-+                   |- payslip_loan_repayment_inputs
                                               `- payslip_adjustments
                                                  |- input: one captured input link
                                                  |- label + bucket + amount (frozen)
                                                  `- statutory_rule_key (work-day only)
```

Five collections carry the payroll core:

1. **`pay_components`** — one reusable definition with a strict settlement/statutory policy and a
   polymorphic calculation definition (`SCHEDULE`, `ENTRY`, `FORMULA`). Overtime is deliberately
   not among them: it is derived from work days priced against the jurisdiction's own overtime
   rules, and its statutory treatment lives on the scheme that charges it.
2. **`component_entries`** — approved employee-specific monetary facts: claims, standing
   allowances, bonuses, arrears settlements and HR manual corrections.
3. **`payroll_runs`** — one company-period calculation naming the statutory snapshot that governed
   it and the calculation version that produced its outputs.
4. **`payslips`** — one employment's totals, its inlined base/proration/statutory planes, and its
   four captured-input junctions.
5. **`payslip_adjustments`** — one settled thing per captured input, frozen so later catalogue or
   law changes cannot rewrite history.

Around that core: `companies` and `jurisdictions` scope the legal entity; `employments`,
`employment_terms` and `employment_statutory_facts` describe a person's working facts;
`shift_definitions`, `rosters`, `work_days`, `company_holidays`, `leave_types` and
`leave_requests` supply the schedule and leave facts; a sealed `jurisdictions` profile version
atomically owns overtime coverage, pricing, limits and the statutory leave floors, and scopes the
leave and pay catalogues; `statutory_contributions` and `contribution_rates` remain normalized
because contribution programmes and their bands have independent identities, scoped to the profile
and sealed with it; and `loans` with their `loan_repayments` carry staff loans and
overpayment recoveries — the agreement, and the amounts due under it.

Two invariants shape everything:

- **Overtime, contributions, gross and net are calculated, never stored or seeded.** A run derives
  them from the input records and is compared against an independently supplied source workbook.
- **Approval is the gate.** `approval_id` is a platform-owned system column, not authored business
  state. `approval_id IS NULL` identifies a committed row that is not held by an approval request.
  A held create has no domain row yet; payroll reads only committed, unheld inputs.

## What ships in the workspace

### Apps (10)

**`hr_employee`** — employee self-service. A person sees their profile, company and next payday,
and can record time entries, raise leave requests and claims (each routed for approval), and read
their own loan agreements and payslips. A person with no active employment is told so; a person
with several chooses which one the page scopes to.

**`hr_controller`** (group) — the HR operating surface. Legal-entity choice lives on **Entities**
and is inherited by every sibling; boards state the active entity, they do not pick it again.

| App                   | What a user does in it                                                                                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entities**          | Chooses the legal entity every other HR Controller app is scoped to                                                                                                                                                                                                                                                  |
| **People**            | The workforce: employee profiles, employments, effective-dated terms, statutory facts, and a workforce-shape chart                                                                                                                                                                                                   |
| **Scheduling**        | Plans the month on a roster board — one row per person, one glyph per day — publishes it against statutory rules, and manages shifts, work patterns and holidays. Attendance import sits on the board's action menu beside the roster import.                                                                        |
| **Leave**             | Review time-off applications; maintain effective-dated company leave plans; inspect sealed yearly accounts and their signed ledger entries; submit exceptional balance corrections for one manager review                                                                                                            |
| **Loans**             | Review loan agreements and their derived outstanding balance, with recovery tracked per repayment                                                                                                                                                                                                                    |
| **Pay components**    | The pay catalogue and the entry stream: claims, allowances, bonuses, arrears and corrections, with their contribution treatment                                                                                                                                                                                      |
| **Payroll**           | Runs the payroll cycle: a pay-date board (late/current/upcoming), creating and recalculating runs, locking them paid, and exporting bank files, payslip PDFs and the report workbook                                                                                                                                 |
| **Statutory profile** | The regime every payroll is calculated against — versioned jurisdiction profiles (DRAFT → SEALED → VOIDED) with atomic overtime, break policy and statutory leave floors, their scoped contribution schemes and rates, and the companies bound to each (file `+settings.svelte`: a file name owns an app's identity) |
| **Kiosk**             | Face-recognition time clock for a shop-floor tablet: clock in/out by face (match, anti-spoof filter, blink-to-confirm), manual entry, and face enrollment. Renders chromeless (`bolt:kiosk`); the device account sees this page and nothing else                                                                     |

### Policies (9)

- **`employee`** — self-service: their own profile, employments and the child collections, plus
  create-with-approval for time entries, claims and leave.
- **`supervisor`** — reads the team, reviews and records their attendance and leave.
- **`manager`** — reads people operations across the company and owns their team's time and leave.
- **`hr_controller`** — HR administration across people, scheduling, requests, loans and
  entries, with payroll visible but not committable.
- **`hr_manager`** — everything HR administration covers, plus creating, running and deleting
  payroll runs.
- **`senior_management`** — the full people-operations view, plus creating, running and deleting
  payroll runs.
- **`statutory_drift_automation`** — the automation's authority: reads sealed statutory profiles
  and employment facts, appends deterministic successor facts, and records durable drift research
  evidence.
- **`leave_reconciliation_automation`** — system-only authority that creates sealed yearly leave
  accounts and appends idempotent entitlement, request, carry and expiry movements.
- **`kiosk`** — the attendance-kiosk device account: the kiosk app only, interval-only time
  entries, face-field-only writes on people, and enrollments that always land `PENDING` for HR
  review. Held by the `Attendance Kiosk` team (one user row per device).

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

### Automations

**`statutory_profile_drift`** — weekly automation (`0 3 * * 1`). It compares every governing
sealed profile with company and employment facts, then starts a separate
**`statutory_profile_research`** run per profile. Each run retains its own identity, evidence,
status and approval proposals; one failed profile does not prevent the others from being researched.
Replaying a completed occurrence reuses its receipt.

Research reads approved HTTPS sources through the host connector. A new site must be linked and
quoted in retrieved evidence; it is proposed in `statutory_research_sources` and is not fetched until
HR Manager approval. Approved origins are scoped to their jurisdiction. Revoking a source stops its
future use while preserving the approval and evidence history. Settings exposes sources and run receipts.

Evidence-backed law changes propose an effective-dated sealed successor for separate HR approval.
Approval preserves the predecessor and activates the successor at its effective date. Deterministic
employment-fact copies likewise require HR approval. Missing evidence and oversized documents fail
explicitly; research never substitutes guessed or silently truncated facts.

The leave automations reconcile yearly accounts after employment, plan or statutory-profile
changes, post approved/withdrawn requests and reviewed qualifying-event openings to the ledger, and
run a daily repair sweep. HR does not run an annual entitlement batch.

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
├── collections/              # 29 collections: +model.ts, +hooks.ts, +pipelines.ts, +representation.svelte
│   └── payroll_runs/lib/     # the settlement engine (phases, overtime, coverage, export)
├── datatypes/                # 30 structured values (statutory_regime, statutory_leave_profile, component_entry_event, …)
├── access/                   # +teams.ts, anonymous limits, and nine policies
├── i18n/                     # messages.en.json / messages.zh.json (same key set)
├── automations/              # statutory drift plus account and ledger reconciliation
├── lib/                      # shared helpers: calendar, display formatters, policy grants, roster month
└── +agents.md
```

- **Models** describe storage only; presentation lives in apps and representations.
  `src/collections/+relationship.ts` owns the relation graph — foreign keys are derived from it,
  never declared in a model.
- **Hooks** validate and derive. The payroll create hook resolves the run's attendance window, pay
  date and configuration hash; the roster hooks enforce publishability; the loan hooks keep a
  repayment schedule exactly reconciled with its principal.
  Effective-dated overlap and repayment-sequence uniqueness are database constraints, not per-row
  hook SELECTs: a batched `mutate` must retain one hook invocation per record without turning a
  statutory table or derived repayment schedule into one remote database round trip per row.
- **Pipelines** (`+pipelines.ts` on `work_days` and `payroll_runs`) shape
  workbook import/export: the roster and attendance importers accept a month grid (or a long-form
  person-day sheet) for one legal entity, and the payroll exporter produces the bank file, payslip
  PDFs and report workbook the app offers.
- **Representations** decide create/display/edit per collection. `payroll_runs` and `payslips`
  refuse hand-created output; a payslip is written by the engine, never by hand.
- **i18n** — both catalogs carry the same key set; app metadata in `<svelte:head>` stays static
  English, and per-locale sidebar labels come from the catalogs.

### The docs

- [`docs/architecture.md`](docs/architecture.md) — the live payroll engine: the model map, the
  eight calculation phases, cutoffs and periods, roster-to-day-type classification, overtime and
  the 12-hour/104-hour controls, statutory treatment, adjustments and ledgers, provenance, locking,
  and what of the statutory law is encoded (and what is not).
- [`docs/data.md`](docs/data.md) — the raw-source → cleaned-source → seed contract, the checks that
  prevent derived output from leaking back into inputs, and how an independent source workbook is
  reconciled against a generated one.
- [`docs/leave.md`](docs/leave.md) — the current application, one-step approval, sealed yearly
  account, append-only ledger, carry-forward, policy-change and payroll behavior.

## Verification

Product H-row acceptance is the isolated public-seed suite: `tests/fixtures/seed/` loaded through
`@norbital-ai/test-utilities` (`withSelfHost` / `startSelfHostSession`). No Colony, no
`seed_bank`, no `:5173`. See [`RFC/testing.md`](../../RFC/testing.md) I1–I3.

```bash
node --experimental-strip-types --import ./scripts/ts-source-resolve.mjs --test \
  tests/public-seed-payroll.integration.test.ts \
  tests/public-seed-open-month.integration.test.ts \
  tests/public-seed-attendance.integration.test.ts \
  tests/public-seed-roster-import.integration.test.ts
```

The template also includes focused arithmetic and export checks. `pnpm test` runs that suite, while
`pnpm sync` compiles the workspace and emits its portable deployment artifact:

```bash
pnpm sync     # regenerate .norbital and emit .norbital/artifact/bundle.mjs
pnpm lint     # prettier + svelte-check
pnpm test     # everything below, plus the loan-recovery and roster unit tests
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
- **Seed** — tests own `tests/fixtures/seed/` (invented public ids). Host demo / reconciliation
  uses the private seed bank remote, not this tree; there is no `src/+seed.ts` role, and
  seeding does not evolve deployed data. For an existing tenant, write the next lineage entry
  with `pnpm exec bolt migrate --name <name>`, edit its SQL, and deploy it through Colony.
  Sensitive statutory seed for demo tenants stays in the host seed bank. It is not a test
  input.
- **Publishing** — the template pins `@norbital-ai/bolt` in its own `package.json` and lockfile.
  After a deliberate dependency move, refresh the template lock through the repository
  template-lock workflow. The templates release workflow advances
  `refs/heads/templates/hr-payroll`; a remote Colony host uses that exact commit when it provisions
  a new tenant, while an existing tenant remains on the revision it adopted. From the realm
  root, `pnpm env -- link` only tests locally built OSS dependencies inside this template
  and neither publishes template source nor updates Colony.
