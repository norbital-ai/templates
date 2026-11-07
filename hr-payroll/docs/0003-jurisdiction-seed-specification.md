# Jurisdiction seed specification

Status: normative seed contract. [The model contract](0002-model-specification.md) defines the models, [the calculation architecture](0001-hrms-calculation-architecture.md) the engine and [verification](0004-verification-gates.md) the gates.

## 1. Sources and scope

The public seed is `seed/public/jurisdiction/<CODE>/version_<v>/`: nine jurisdictions (CN, ID, JP, MY, PH, SG, TH, TW, VN) and 57 sealed versions. `bolt build` writes it as the release's `base` pack.

Public law belongs there. The private bank supplies tenant-specific people, teams and entity rows, through `seed/+seeder.ts` and `bolt seed`; they never enter a release. Personal records are never copied into the public seed.

## 2. Layout

```text
seed/public/jurisdiction/
  MY/
    version_1/
      jurisdiction_settings.json
      subtotal.json
      allowance_catalog.json
      overtime_catalog.json
      statutory_contribution_catalog.json
      leave_catalog.json
      claim_catalog.json
      adhoc_catalog.json
      loan_catalog.json
      work_interruption_catalog.json
      workplace_case_catalog.json
      registered_rule.json
      registered_effect.json
```

One folder per version, one JSON file per model type: the file name is the model. Rows carry their `id` and stored fields and load as stored. `settings_id`, `previous_id` and `subtotal_id` hold the ids of the rows they name.

## 3. Versions

A change of law is a new version, never an edit to a sealed one. A lineage is numbered in date order, sealed, unbroken and open at the end, and a version exists only because something changed on its date. The folder number is a rolling sequence, never a legal effective date: the date is the version's `effective_range`.

## 4. Authoring rules

### Formulas

Formulas select an evidenced base and assess an amount. The ledger service owns balance admission and posting; the engine owns dependency order and rounding.

- A jurisdiction's shared tables and shared constants live in its global `lookup`, each with a declared shape. A value read by one row lives on that row's own `lookup`, which wins over the global one.
- Every `lookup` key is read by an expression or by code. Settings keys must be shared values; a single-reader value belongs to its row.
- Employee extension schemas are flat: no `facts`, `term_facts`, `exit_facts` or `elections` bucket. `statutory.<SCHEME>` and `events[]` stay nested.
- Statutory bases come from completed subtotals and explicit catalog references. A tax formula reuses contribution results rather than reproducing their maths.
- Legal distinctions and dated exceptions are preserved. Splitting a formula across more fields does not count as simplification.
- Minification, opaque helpers and copied orchestration are rejected.
- Expressions carry statute citations, never working notes.

### Structure

- `subtotal` rows carry `code`, `name`, `previous_id`, `balance_window` (`MONTH` or `YEAR`) and optional `calculation`. The first computes base pay; later rows accumulate producer lines. Statutory rows carry `balance_window` too. Do not seed output bindings, phases, channels, order fields or subtotal-held catalogue lists.
- Static catalogues hold confirmed definitions and leave `subtotal_id` null when they create no pay line. Non-static catalogues own their entries.

### Data

- Seed balances as ledger movements, never as direct projection writes.
- Seed no payroll runs, payslips, YTD or per-run statutory results.
- Suspensions and work stoppages are interruption data.
- Register work limits against roster creation and change; planned-work refusal is distinct from recording an actual violation.
- Amounts in expected results are independently calculated, never copied from the formulas.

## 5. Acceptance

A jurisdiction is accepted when its boundary scenarios pass: overtime inclusion, allowances, balance limits, ledger reversal and retry, run locks, dependent contributions, exits and carry-forward, where applicable.

Every jurisdiction also passes the [manual probe matrix](manual-probe-matrix.md): twelve consecutive months, independently verified amounts and retained evidence. Singapore additionally covers shortfall and excess/refund flows.

Private and synthetic fixtures carry actual employment dates, zero payroll YTD, source-linked leave and claim movements, and independently reconciled balance controls.
