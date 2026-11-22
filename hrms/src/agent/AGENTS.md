# HRMS source

Norbius reads [`+agent.md`](./+agent.md). This file points coding agents at the source and its documents.

## The design is fixed

Read [section 0 of the architecture](../../docs/0001-hrms-calculation-architecture.md#0-the-design-is-fixed) before you touch anything here. It is the owner's design, and you wire around it.

"It doesn't fit" is not a finding. Express the requirement with the parts section 0 names. If it still has no home, ask the owner; do not change the design, add to it or ship an approximation. Brief every subagent with section 0.

## Documents

- [The documentation index](../../docs/README.md): one line per document.
- [self_service_design.md](./self_service_design.md): the employee self-service interface design.

## Surfaces

- Models: `src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model. Top-level folders: `employee_profile` (with `employment`, its `contract_terms` and `statutory_parameters`, `dependant` and `employee_balance`), `entity`, `entry` (the catalogue entry models), `jurisdiction` (with `jurisdiction_change`: a law is data in its rows, not models), `obligation`, `payroll_run`, `roster_entry`, `statutory_finding`, `statutory_source`, `work_event`.
- Apps: `hr_controller/{dashboard,entities,events,obligations,payroll,people,settings}`, `hr_employee`, `attendance` (kiosk shell)
- Automations: `invitation_profile`, `late_notice`, `ledger`, `registered_effects`, `statutory_filing`, `statutory_research`
- Policies: `configuration_execution`, `employee`, `hr_controller`, `hr_manager`, `invitation_profile_automation`, `kiosk`, `manager`, `payroll_execution`, `senior_management`, `supervisor`
- Model services (co-located under each owning model's `service/` folder):
  - `src/data/model/payroll_run/service/` (payroll engine `engine.ts`/`rates.ts`, run orchestration `run_calculation.ts`/`run_loader.ts`, cross-period amendments `amended.ts`/`history_slice.ts`/`amendments.ts`, `pay_cycle.ts`, `payslip_breakdown.ts`, and `exports/` for salary listing and bank files)
  - `src/data/model/employee_profile/employee_balance/service/` (the single ledger service: `core.ts`, `entitlement.ts`, `ledger_store.ts`, `posting_plans.ts`, `entry_postings.ts`, `guards.ts`, `entitlement_sync.ts`, `service.ts`)
  - `src/data/model/jurisdiction/service/` (the law on a day `law.ts`, `configuration.ts`, `params/`, `expressions.ts`, `registrations.ts`/`registration_context.ts`, `rule_reads.ts`, `programs.ts`, `taps.ts`)
  - `src/data/model/employee_profile/service/` (`person.ts` employment on a day; `dependants.ts` exit tasks and loan handling)
  - `src/data/model/entity/service/` (`company.ts` company on a day; `holiday_kind.ts`)
  - `src/data/model/roster_entry/service/` (`attendance.ts`, `time_evidence.ts`, `roster_warnings.ts`, `roster_workbook.ts`)
  - `src/data/model/entry/service/` (`entries.ts`, `entry_workbook.ts`) and `src/data/model/entry/loan_catalog_entry/service/` (`loan_schedule.ts`)
  - `src/data/model/statutory_finding/service/` (`research.ts`)
- Shared cross-cutting code: `src/lib/` (`foundation.ts`, `contracts.ts`, `reads.ts`, `dated.ts`, `dated_facts.ts`, `run_output.ts`, `workbook_rows.ts`, and `ui/` for pages)

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.
