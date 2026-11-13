# HRMS source

Norbius reads [`+agent.md`](./+agent.md). This file points coding agents at the source and its documents.

## The design is fixed

Read [section 0 of the architecture](../../docs/0001-hrms-calculation-architecture.md#0-the-design-is-fixed) before you touch anything here. It is the owner's design, and you wire around it.

"It doesn't fit" is not a finding. Express the requirement with the parts section 0 names. If it still has no home, ask the owner; do not change the design, add to it or ship an approximation. Brief every subagent with section 0.

## Documents

- [The documentation index](../../docs/README.md): one line per document.
- [self_service_design.md](./self_service_design.md): the employee self-service interface design.

## Surfaces

- Models: `src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model. Top-level folders: `employee_profile`, `entity`, `entry` (the catalogue entry models), `jurisdiction` (with `jurisdiction_change`: a law is data in its rows, not models), `obligation`, `payroll_run`, `roster_entry`, `statutory_finding`, `statutory_source`, `work_event`.
- Apps: `hr_controller/{entities,events,formats,obligations,payroll,people,settings}`, `hr_employee`, `attendance` (kiosk shell)
- Automations: `contract_materialize`, `invitation_profile`, `ledger`, `registered_effects`, `statutory_research`
- Policies: `configuration_execution`, `employee`, `hr_controller`, `hr_manager`, `invitation_profile_automation`, `kiosk`, `manager`, `payroll_execution`, `senior_management`, `supervisor`
- Shared code: `src/lib/ledger/` (the single ledger service), `src/lib/payroll_engine/` (calculation, reads, registrations, workbooks), `src/lib/law.ts` (the law on a day), `src/lib/company.ts` (the company on a day), `src/lib/dated.ts` (the fold of dated changes and the reach of a change), `src/lib/amendments.ts` (the amendment rows a write to a paid period carries), `src/lib/dependants.ts` (an exit's tasks and loan when it is raised, moved or cancelled; the last payslip settles the leave), `src/lib/integrity.ts` (the ledger check), `src/lib/ui/` (pages), `src/lib/export_format_configuration/` (salary listing and bank files)

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.
