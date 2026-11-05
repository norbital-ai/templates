# HR Template V2 source

Norbius reads [`+agent.md`](./+agent.md). This file maps the source and the refactor rules for coding agents.

## The design is fixed

Read [section 0 of the calculation architecture](../../docs/0001-hrms-calculation-architecture.md#0-the-design-is-fixed) before you touch anything here. It is the owner's design, and you wire around it. In short:

1. Catalogs, catalog entries and reversal entries. A refund or correction is a reversal or adjustment entry against a catalog item.
2. Ledger entries are emitted during payroll and when a leave, claim, adhoc or loan entry is created. The balance is their projection and replaces payroll history.
3. Linear computation: one subtotal chain, then statutory schemes in dependency order.
4. Jurisdiction settings hold the global lookup; a row's own lookup is local and wins. Registered rules validate; registered effects are side effects; reads happen once, up front.
5. Simplicity: thin models, a thin payroll run, and no field or engine concept the owner did not ask for.

"It doesn't fit" is not a finding. Express the requirement with these parts. If it still has no home, ask the owner; do not change the design, add to it or ship an approximation. Brief every subagent with this section.

## Model ownership

`src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.

```text
employee_profile/
  employee_balance/
    ledger_entry/
  employee_contract/
entity/
  entity_profile_version/
  holiday/
  shift_pattern/
    shift_definition/
jurisdiction_settings/
  catalog/
    non_static/
      adhoc_catalog/
        adhoc_catalog_entry/
      claim_catalog/
        claim_catalog_entry/
      leave_catalog/
        leave_catalog_entry/
      loan_catalog/
        loan_catalog_entry/
          loan_repayment_entry/
      work_interruption_catalog/
        work_interruption_catalog_entry/
      workplace_case_catalog/
        workplace_case_catalog_entry/
    static/
      allowance_catalog/
      overtime_catalog/
      statutory_contribution_catalog/
  rules/
    registered_effect/
    registered_rule/
  subtotal/
obligation/
statutory_finding/
  statutory_change/
statutory_source/
payroll_run/
  payslip/
roster_entry/
```

## Surfaces

- Apps: `hr_controller/{cases,entities,events,formats,payroll,people,settings}`, `hr_employee`
- Kiosk: `attendance`
- Automations: `invitation_profile`, `statutory_research`, `statutory_materialize`
- Policies: `configuration_execution`, `employee`, `hr_controller`, `hr_manager`, `invitation_profile_automation`, `kiosk`, `manager`, `payroll_execution`, `senior_management`, `supervisor`
- Shared code: `src/lib/payroll_engine/` (calculation, reads, admissions, registrations, exports), `src/lib/ui/` (pages), `src/lib/export_format_configuration/` (salary listing and bank files)

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

The published `@norbital-ai/*` 0.0.8 SDK discovers only `src/data/model/<name>`; this tree needs the local build with nested discovery. Do not claim a registry install reproduces the build until that release ships.

## Source truth

- [The calculation architecture](../../docs/0001-hrms-calculation-architecture.md) — calculation order, ledger, statutory chain.
- [The model contract](../../docs/0002-model-specification.md) — model fields, ownership and the final tree.
- [The seed contract](../../docs/0003-jurisdiction-seed-specification.md) — jurisdiction seed replacement.
- [Verification and gates](../../docs/0004-verification-gates.md) — what counts as verified and the open gates.
- [Manual probe matrix](../../docs/manual-probe-matrix.md) — the live acceptance checklist.
- [Docs index](../../docs/README.md) — every maintained document in this template.
- [self_service_design.md](./self_service_design.md) — the employee self-service interface design.

## Refactor scope

- Refactor only this template and its private tree `the private seed`.
- Preserve the original `hr-payroll` template, `norbital_hr` tenant and original private tree.
- Follow the model contract's declarations and the calculation architecture's rules; preserve unrelated features.
- Seed agents replace whole jurisdiction histories from the supplied evidence; do not patch legacy formulas. New formulas must be substantially smaller. Generate deltas after replacement versions pass checks.
- Use one agent per jurisdiction when seed replacement begins. Do not start those lanes merely for documentation or cloning.

## Invariants

- Every fact has one owner; a value is read from its owner, never copied into a second model or JSON bag.
- The first subtotal opens with base pay; later subtotals accumulate employee lines; statutory schemes evaluate in dependency order.
- `payroll_run.create` calculates and writes payslips plus ledger rows as one payload; there is no separate finalise step.
- Ledger rows are immutable and the balance is a rebuildable projection.
- A change of law is a new sealed jurisdiction version, never an edit to a sealed one.
