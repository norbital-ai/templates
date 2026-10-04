# HR payroll takeover — active implementation plan

Updated 4 October 2026 (post-purge). This is the sole active plan. The 288 KB checkpoint log it
replaced is archived at realm `.tmp/hr-takeover-full-20261004.md`; historical reference audits live in
`docs/architecture/`.

## Objective and constraints

Big-bang refactor with no compatibility layer. Every original captured value, identity, access
boundary, evidence requirement and calculation result is preserved. Configuration is data, not code.

- One automation per catalog family (`leave`, `claims`, `loans`, …). Encashment is a configured
  leave operation, never an `encashment` automation.
- One `behaviours` field per jurisdiction version: rules, bindings, ordered reads, derived values,
  bounded programs and operations with stable IDs.
- Delete-first. No "source-written, unverified" landings: every change runs its gate or does not land.
- Actual jurisdiction configurations may stay incomplete; the engine must be correct and generically
  verified first.
- No commits, publication, reset or deploy without explicit user approval.

## Target architecture

| Role | Collections | Responsibility |
| --- | --- | --- |
| Catalogs | `statutory_contributions`, `claim_catalogue`, `allowance_catalogue`, `adhoc_catalogue`, `leave_catalogue`, `loan_catalogue`, `work_catalogue` | Versioned definitions, eligibility, quantity/rate/rounding expressions, output codes. Static allowances/work produce payslip lines directly, no entry records. |
| Catalog entries | `catalogue_entries` | Typed catalog-linked requests, transactions, balances; original identities, approvals, evidence. |
| Jurisdiction | `jurisdiction_settings` | General data, legal tables, exactly two input schemas, one `behaviours` field. |
| Rules | `rule_sets` | Families (WORK, LEAVE, PAYROLL, STATUTORY, EMPLOYMENT, OBLIGATIONS, GLOBAL), ordered configured rules/programs, authority pins. |
| Entities | `entities` | Legal employers, authorities, recipients; dated inputs and schema/evidence pins. |
| Obligations | `obligations` | Configured duties, due dates, executions, outcome evidence. |
| Holidays | `holidays` | Entity-linked holiday dates with original import/approval semantics. |
| Roster | `rosters`, `roster_entries` | Planned vs actual work inputs. |
| Employees | `employees`, `employee_profiles` | Identity, dated employment, dynamic inputs, proofs. |
| Payroll | `payroll_runs`, `payslips` | Run selection, immutable calculation captures, payment/locking, results. |

### Behaviour contract (version 1)

`jurisdiction_settings.behaviours` declares `rules` with: stable `id`, catalog family, subscribed
`events`, `when` condition; named `inputs` bindings (qualified employee/entity sources, CEL
`key_expression` optionally selecting a stable child key); ordered bounded `records` reads; ordered
`derived` values; bounded `program` instructions; ordered `operations` with registered capabilities,
target collection, arguments and timing. Reusable immutable programs live under `behaviours.programs`
by verified content hash — never inline copies, never escaped JSON payloads inside expressions.

Calculation is pure. Effects execute through native actions with authorization, approval and atomic
commit. Execution identity binds event, subject, snapshot/hash, rule, operation and effect slot.
Retries reuse original configuration and sources.

```json
{
  "version": 1,
  "rules": [{
    "id": "leave-exit-settlement",
    "catalog": "LEAVE",
    "events": ["PROFILE_CHANGED", "CALENDAR_DATE"],
    "when": "inputs.terms.value.exit_is_due",
    "inputs": {
      "terms": {"source": "EMPLOYEE", "subject": "profile.id", "key": "input:/leave_terms"}
    },
    "operations": [{
      "id": "settle-exit",
      "capability": "SETTLE_LEAVE_EXIT",
      "target": "catalogue_entries",
      "args": {"profile_id": "profile.id"}
    }]
  }]
}
```

### Engine boundary (frozen)

Code owns only the generic, jurisdiction-blind runtime: expression evaluation, behaviour
planning/execution, dynamic input admission, readers/writers, one automation per catalog family.
Every law- or operation-specific rule lives in `behaviours` / `rule_sets` / catalog records.
No new per-domain `src/lib/*-source.ts`, leave/payroll/statutory kernel, or datatype module;
new behaviour lands as configuration or it does not land. Ports are verified by the existing
probes and goldens before the superseded TypeScript is removed; calculations stay exact.

**Operator constraints (binding, 2026-10-05):**

1. The HR engine source stays simple: it aggregates the evaluation context, orders it
   (chronological windows, periods, rosters), executes the configured behaviours, and produces
   payslips. Nothing domain-specific in source.
2. `src/automation/**` owns dynamic side effects configured by the user: they read catalogue /
   rule_sets / behaviours records and perform the writes. No side effects buried in the engine.
3. All core logic is encapsulated in database records (catalogue, `rule_sets`, `behaviours`);
   source may only read, order, and execute them.
4. No git tooling is used in this workstream (no checkout/show/ls-files); recovery uses the
   realm `.tmp/` backups, and the built artifact only as a last resort.

### Seed contract

Materialized JSON, split `seed/jurisdiction/<lineage>/<collection>.json`; `seed/seed.ts` is a loader
only. No generated law, no conversion factories in seed. One-off tools live in realm-root `.tmp/`
and are removed after use. Programs are stored once, referenced by hash; snapshot rows carry
references and authority pins, not duplicated program bodies.

## Storage correction (active)

The pre-purge SG settings were 646 MB (JP 1.5 GB) because snapshot rows duplicated the whole
program registry and program bodies embedded escaped JSON literals. Purge removed the eight
non-baseline jurisdiction outputs. Remaining work: materialize SG under the contract above with a
single shared program library, then enforce by test — per-jurisdiction size budget, no duplicate
program hashes across rows, no escaped-JSON payloads in expressions.

## Execution plan

1. **Purge (done).** Realm `.tmp` cleaned (14 GB → 2 files, 292 KB: takeover archive +
   purge log), `.norbital` wiped, 193 legacy tests and 8 unsupported e2e files deleted, 13
   orphaned synthetic fixtures removed, eight jurisdiction outputs removed, `seed/` 4.7 GB →
   686 MB, `tests/fixtures` 280 MB → 242 MB. No dead `src` files (single ambient `.d.ts` kept).
2. **Operational gate (current).**
   - `pnpm check` green (26 seed-discover errors from root `seed/runtime-*.json`; i18n syntax error
     at `src/i18n/+messages.ts:6`).
   - `pnpm build` green by doctor-pack root-cause batch (GUARD2, COERCE1, R3a, R3b, R5d, svelte
     types), not per diagnostic.
   - Storage contract applied to SG; size tests green.
   - Seed loads and app boots; generic behaviour suites
     (`tests/behaviours.test.ts`, `behaviour-execution.test.ts`, `behaviour-program-registry.test.ts`)
     pass with synthetic fixtures.
   - One SG payroll probe passes on the built artifact (`pnpm test:probe`).
3. **Gap-closure DAG (after operational).**
   - **A. Engine gaps:** atomic off-cycle settlement; attendance locks; CPF earned/attributed/payment
     views; scheduled catalogue catch-up; minimum-wage warnings; final pay; noncontract payments;
     export/statutory-return transports; conversion-month weighted rounding and CHECKS stages;
     election history, late entries, PF fixtures.
    - **B. Consumer migration:** map remaining unresolved imports to retained roles (cohorts:
      payroll, leave/loan, attendance/roster, catalog events, reports/exports, UI pages off
      `claim_requests`/`leave_entries`/`employment_terms`).
    - **Adhoc acceptance (binding):** `OFF_CYCLE`/`CORRECTION` runs keep working with no salary
      lines — sources-only pricing via `run.sources`, cash-only static path, atomic run prep —
      and statutory contributions stay correct on salary-less runs (additional-wage ceilings
      per jurisdiction config). Verified by the migrated `adhoc-corrections` probe plus
      `cn-bonus-oracle`; the stale probe's `adhoc_requests` / `employment_terms` /
      `employment_statutory_facts` inputs move to `catalogue_entries` + profile facts.
   - **C. Jurisdiction configuration:** fixed materializer (shared registry, structured payloads,
     snapshot refs); nine jurisdiction folds; `rule_sets` extraction; per-jurisdiction differential
     oracles and probes (46 probes, 10 oracles exist).
   - **D. Compliance:** `inventory/*.csv` remain the canonical legal status authority (272 GAP, 730
     PARTIAL at last audit). Wave 1 resolvable scope, Wave 2 changed saved workflows; no status
     promotion without real proof.
   - **E. Release:** sequential lint → check → build → tests → probes, then immutable publication and
     staging only on explicit approval.

Dependencies: operational gate → {A, B, C}; A/B/C → D; D → E. Long poles: A for engine
correctness, C for coverage (deliberately behind operational).

## Current delivery matrix

| Requirement | State | Remaining |
| --- | --- | --- |
| Purge | Done: `.tmp`, `.norbital`, legacy tests, unused fixtures, 8 jurisdictions | — |
| Build and check | Red: 27 check errors, 3,545 build diagnostics in `src` | Root-cause batches |
| Behaviour engine | Source present; 14/134 collected node tests passed pre-purge | Storage contract, generic suites |
| SG baseline | Materialized but oversized (646 MB) | Contract materialization, size tests |
| Seed loader | `seed/seed.ts` JSON loader only | 26 root runtime files must join the contract |
| Payroll probes | 46 probes / 11 profiles / 10 oracles, never green post-migration | Run after operational |
| Compliance | Inventory CSVs current; no verification claim | Waves after DAG work |

## Guardrails

- No unverified landings; every batch reruns its gate.
- Delete before add; regenerable data is deleted, originals preserved once (git HEAD, original-fold
  fixtures, seed bank).
- One plan file; checkpoints stay out of it.
- No subagent fan-out without a single integrator and merge gate.
- Configuration is data: no escaped JSON, no per-row or per-jurisdiction duplication.
- Do not touch `norbital/apps/colony/mobile` (untracked mobile source for future store deploys).
