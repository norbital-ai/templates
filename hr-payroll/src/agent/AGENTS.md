# HR & Payroll source

Norbius reads [`+agent.md`](./+agent.md). This file points coding agents at the source and its documents.

## The design is fixed

Read [section 0 of the architecture](../../docs/0001-hrms-calculation-architecture.md#0-the-design-is-fixed) before you touch anything here. It is the owner's design, and you wire around it.

"It doesn't fit" is not a finding. Express the requirement with the parts section 0 names. If it still has no home, ask the owner; do not change the design, add to it or ship an approximation. Brief every subagent with section 0.

## Documents

- [Architecture](../../docs/0001-hrms-calculation-architecture.md): owners, the data model, law versions, catalogues, the engine, the ledger, automations, roles.
- [Core mechanisms, run through](../../docs/0008-mechanisms-walkthrough.md): one example from company setup to an exit.
- [Reversals and corrections](../../docs/0007-corrections-and-integrity.md): how each act is undone, the invariants, the integrity check.
- [Statutory coverage in the seed](../../docs/0009-statutory-coverage.md): what each jurisdiction carries and how it is verified.
- Reference: [model specification](../../docs/0002-model-specification.md) (the model tree and fields), [seed specification](../../docs/0003-jurisdiction-seed-specification.md), [transfer semantics](../../docs/transfer-semantics.md), [manual probe matrix](../../docs/manual-probe-matrix.md), [docs index](../../docs/README.md).
- [self_service_design.md](./self_service_design.md): the employee self-service interface design.

## Surfaces

- Models: `src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.
- Apps: `hr_controller/{entities,events,formats,obligations,payroll,people,settings/{change_log,lineage}}`, `hr_employee`
- Kiosk: `attendance`
- Automations: `contract_materialize`, `encashment`, `entity_materialize`, `invitation_profile`, `ledger`, `registered_effects`, `statutory_research`, `statutory_materialize`
- Policies: `configuration_execution`, `employee`, `hr_controller`, `hr_manager`, `invitation_profile_automation`, `kiosk`, `manager`, `payroll_execution`, `senior_management`, `supervisor`
- Shared code: `src/lib/ledger/` (the single ledger service), `src/lib/payroll_engine/` (calculation, reads, registrations, workbooks), `src/lib/dependants.ts` (what a raised, moved or cancelled exit leaves behind), `src/lib/integrity.ts` (the ledger check), `src/lib/ui/` (pages), `src/lib/export_format_configuration/` (salary listing and bank files)

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.
