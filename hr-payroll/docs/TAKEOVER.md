# HR payroll takeover

Living plan for `templates/hr-payroll`. One file; checkpoints stay here.

## Target HRMS architecture

- **Effect-TS everywhere.** The entire template is Effect-TS based, not plain TypeScript —
  engine, automations, collections, transforms, projections, and UI logic. Idioms:
  `Effect.gen`/`Effect.fn`, `Data.TaggedError` for refusals, `Context.Tag`/`Layer` for
  services, `Schema` for all decoding/validation, `Option`/`Either` where they fit — no
  ad-hoc try/catch or bare thrown errors in new code, and existing plain-TS survivors are
  converted as they are touched.
- **Logic in records.** Catalogues, `rule_set`, and `behaviours` rows (jurisdiction-linked,
  seeded) carry the computation and are changeable without moving source.
- **Behaviours are first-class.** A rules/catalogue-like, jurisdiction-linked construct with
  triggers, ordering, conditions, and programme refs (hash-addressed library in the seeded
  `rule_set` rows). Adding an encashment/late-notice/statutory-drift behaviour is a row.
- **Automations are minimal taps.** The fewest possible, dynamically tapped by behaviour
  records, owning all side effects. No behaviour logic in automations. Behaviour-driven taps
  are named `behaviour_*` (e.g. `+behaviour_catalog_events`, `+behaviour_catalog_deferred`,
  `+behaviour_catalog_sweep`, `+behaviour_run_payroll`, `+behaviour_scheduled_entries`).
  Transport automations that are not behaviour taps keep their own names (`+holiday_import`,
  `+payroll_export`). A statutory research automation is a separate thing, not a behaviour
  tap.
- **Input model.** The jurisdiction declares exactly two input schemas — one employee, one
  entity. The employee/entity records store the JSONB that satisfies them. Fact/wage-period/
  history tables do not exist.
- **Data model** (`src/data/{model,collection}`, folder hierarchy is the semantics; Bolt
  discovery patched to accept nesting and derive the name from the leaf folder):
  ```
  jurisdiction/jurisdiction_settings      (root model)
  jurisdiction/rule_set
  jurisdiction/statutory_contribution_catalog   (static — no entries)
  jurisdiction/obligation
  jurisdiction/<catalog>_catalog          (+model.ts at the folder)
  jurisdiction/<catalog>_catalog/<catalog>_catalog_entry
      for adhoc, claim, leave, loan  (entry-bearing)
      allowance, work               (static — catalog only)
  employment_profile/employment_contract
  entity/holiday
  payroll_run/payslip
  roster/roster_entry
  ```
  Everything singular, snake_case, `catalog` not `catalogue`, `entry` not `entries`.
- **UI.** `src/lib` holds exactly `ui/` and `payroll_engine/`. Kiosk is its own top-level app
  (attendance capture); the other surface is the XLSX roster-template import. `hr_employee`
  (Employee Self-Service) stays. The look of apps and UI must not change.
- **Server stores UTC.** Timezone and locale are the client's; the workspace never sets them.

## Binding operator directives

1. **Delete-first.** Purge stale files, configuration, and seed data. Legacy consumers are
   either purged or refactored onto the engine / catalogues / rules / behaviours. Never
   bring back anything deleted — not from git, not from build artifacts, not from backups.
2. **When an import points at something deleted:** open the file, see why, then purge the
   legacy consumer or refactor it onto the engine/records correctly. Do not recreate the
   deleted thing.
3. **Effect-TS, whole template.** Not just the engine — automations, collections, transforms,
   projections, and UI logic are Effect-TS based (Effect/Schema/Context/Data.TaggedError).
   Aggregate context → order → execute behaviours → payslips; computation lives in seeded
   records, changeable without touching source.
4. **Automations:** minimum count, tapped by behaviour records, side effects only.
   Behaviour-driven taps are named `behaviour_*`; non-behaviour transports keep their names;
   a statutory research automation is its own thing.
5. **Behaviours** are jurisdiction-linked records like rules/catalogues.
6. **Files:** `src/lib` = `ui/` + `payroll_engine/`; everything snake_case (no camel, no
   kebab); merge into fewer, bigger files; folders express hierarchy semantically.
7. **Data structure:** as in the section above; static catalogues carry no entries.
8. **Input model:** two schemas in jurisdiction (employee, entity); records hold the JSONB.
9. **Kiosk is its own app** (never under `hr_controller`); attendance = XLSX import + kiosk;
   `hr_employee` stays.
10. **UTC server; client owns tz/locale**; never in the workspace.
11. **No git tooling** — except the one commit explicitly requested (`0ae9eacb`).
12. **Scratch stays clean** — realm `.tmp` (one-off tooling, emptied), no `.tmp`/scratch in
    nested checkouts, Codex/Claude scratch pads, or system temp.
13. **Don't stop, don't ask — execute.**
14. Adhoc `OFF_CYCLE`/`CORRECTION` runs keep working salary-less with correct statutory
    contributions.

## Checkpoint

Committed: `0ae9eacb Consolidate HR payroll template layout and purge legacy engine`
(that commit predates the current rename/nesting work).

Done since:
- Bolt patched (`oss/packages/bolt/src/compiler/discover.ts`): nested `data/model/**` and
  `data/collection/**` allowed, name derived from the leaf folder; built and linked locally
  (`pnpm run env -- link --only=@norbital-ai/bolt`).
- Engine rebuilt from scratch in Effect-TS: `src/lib/payroll_engine/{foundation,expressions,
  behaviours,services}.ts` (foundation primitives + reads; CEL + configured evaluation;
  configured-step execution and stored-programme resolution from seeded `rule_set`;
  ordering/admission/catalogues/payslips).
- Data layer rebuilt to the target naming: 22 models + 22 collections.
- UI restored and subfoldered; kiosk app complete at `src/app/kiosk`; `hr_employee` present;
  access policies cleaned.
- Purges: legacy lib kernels, old models/collections, orphaned UI/policy consumers.
- `catalogue`→`catalog`, `entries`→`entry`, plurals→singular, and collection-name references
  swept across `src`; 245 engine imports rewired onto the four Effect modules.

Current state of `bolt check`:
- discovery, seed, names, bundle up to load — passing;
- one failure remains: `load/failed evaluating the declarations failed: (void 0) is not a
  function`. Prime suspect: top-level CEL function registration in `expressions.ts`
  (`environment.registerFunction` shape), then the rebuilt declarations.
- No blockers beyond that; no `.tmp` backups exist (clean-scratch directive).

## Next steps

1. Fix the declaration-load failure: bisect the engine top-level registration, then
   automations, then data declarations (move copies to system temp, never nested `.tmp`).
2. Route the surviving `<catalog>_catalog_entry` consumers (engine, automations, UI) off any
   remaining old names and onto the per-family entry collections.
3. Wire `+run_payroll.automation.ts` (and the other taps) to the behaviour records; no
   hardcoded run kinds/populations.
4. `bolt check` → `bolt build` to green.
5. Re-author the probes/goldens (deleted deliberately) once the layout is green, including the
   adhoc salary-less statutory probe.
