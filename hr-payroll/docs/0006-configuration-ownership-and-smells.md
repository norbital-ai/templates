# Configuration ownership and the second-owner smell

Status: normative. This document names the recurring defect behind the 2026-11 simplification pass and records the
owner's decisions as rules. It sits beside [the calculation architecture](0001-hrms-calculation-architecture.md), whose
section 0 remains the fixed design.

## 1. The smell

**The second-owner smell:** one fact has two places that can answer for it, or one switch is the only place two
independent decisions meet. The two answers can disagree, and no reader knows which one wins.

It appears in five forms:

| Form                  | What it looks like                                                                                                                                                                         | Why it hurts                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| **Shadow state**      | A flag stored beside the link, date or child row that already decides it: `is_reversal` beside `reverses`, `month_balance` beside a row's window, `days_per_year` beside the contract week | The copy drifts; a reader picks the wrong one               |
| **Overloaded switch** | One global flag answers several independent questions: `include_allowances` controlled rate inclusion, proration and statutory bases                                                       | Every new behaviour adds another special case to the switch |
| **Hoisted constant**  | A value read by one row or one formula lives in the jurisdiction bag: `no_part_xii_categories`, `wage_floor_factor`, `daily_hours`, `months_per_year`                                      | The reader and its value are edited in different places     |
| **Stringly path**     | A field is named by a string: `company_cap_terms_field: annual_leave_carry_limit_days`, `*_field`                                                                                          | Renaming a field silently reads nothing                     |
| **Optional boundary** | A typed boundary makes every arm optional, or a flat object allows impossible combinations: all-optional catalog params, `day_basis: { basis, days? }`                                     | The type says “valid” for a configuration that cannot run   |

Two derived catalogues of the same fact are the same smell: `extension_fields.ts` (names) and
`extension_schema.json` (schemas) both claim to describe the extension surface.

## 2. The test

Before adding a field, ask:

1. **Who owns this?** If two models, two settings keys or a model and a settings key can answer, there are two owners.
2. **Can it disagree with another field?** If yes, one of them is derived.
3. **Does it answer more than one independent question?** If yes, it is an overloaded switch.
4. **Would renaming the thing it names break it silently?** If yes, it is a stringly path.
5. **Can the type hold an arm that cannot run?** If yes, the boundary is too flat.

A “yes” is a design defect, not a documentation task.

### 2.1 The field-sprawl smell

A model with many optional attributes is not flexible; it is a table of independent flags whose valid combinations
nobody wrote down. The producer catalogs are the current example:

```text
subtotal_id, direction, party, off_cycle_eligible, prorate, include_in_rate, conversion, eligibility, ...
```

Every combination is representable, but only a few are legal. The seed audit shows the field product is larger than the
behaviour:

| Field                      | Observed                                                                             | Consequence                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `off_cycle_eligible`       | always false on allowance (283), overtime (286), statutory (643) and loan (135) rows | the field has no reader that can ever see true in those families; remove it there |
| `party`                    | always `EMPLOYEE` on overtime, leave and loan rows                                   | the employee share is implicit in the role, not a selectable attribute            |
| `direction`                | always `ADD` on allowance, always `DEDUCT` on loan                                   | the role decides direction; do not ask                                            |
| `claim.off_cycle_eligible` | always true                                                                          | the flag adds no choice; remove it                                                |
| `incurred_on`              | empty on many allowance/overtime rows                                                | default to coverage end rather than storing an empty expression                   |
| `subtotal_id`              | nullable on models that always produce a line                                        | null encodes a missing target the engine silently skips                           |

A field is needed only when it has a distinct semantic, a reader and a legal alternative. Otherwise it is one of:

- a derived value (remove it);
- a role already implied by the model/arm (remove it);
- an invalid combination the model should refuse (add a check or union);
- a copied base field (keep the field, but stop repeating its decision in another model).

`2026-11` applied: removed `off_cycle_eligible` from allowance, overtime, statutory, claim, loan, work interruption and
workplace case; removed `party` from overtime, leave and loan; removed `direction` from allowance and loan; made
`incurred_on` optional on allowance/overtime. The role/arm union remains the next producer-model step.

## 3. Ownership ladder

| Fact                                                   | Owner                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| what was agreed: rate, hours, allowances, facts        | `employee_contract`                                                     |
| how this law converts: day/hour/proration/rounding     | one typed `conversions` block on `jurisdiction_settings`                |
| whether an allowance is in the rate a day/hour divides | that `allowance_catalog` row (`include_in_rate`)                        |
| whether an allowance line follows absence              | that `allowance_catalog` row (`prorate`)                                |
| what one catalog family pays or decides                | that row's `lookup`/params                                              |
| what one rule or effect decides                        | that rule/effect                                                        |
| a rate table read by many rows                         | `jurisdiction_settings.lookup`, with a declared shape                   |
| which period a checkpoint or scheme posts to           | that `subtotal`/`statutory_contribution_catalog` row (`balance_window`) |
| whether an entry is a reversal                         | the entry's `reverses` link — never a separate flag                     |
| the original impact of a correction                    | the original payslip/impact snapshot; the reversal mirrors it           |

A value read by one row must not live in settings. A value the contract states must not be copied into settings. A
derived flag must not be stored.

## 4. Owner decisions

These are the owner's words, recorded as rules.

1. **One owner per fact.** A link, date or child row decides a state; do not store a second boolean for it.
2. **No global behaviour switch.** Per-row behaviour belongs on the row. `allowance_catalog.include_in_rate` owns rate
   inclusion; `prorate` owns absence reduction; they are independent.
3. **No variable allowances.** Every allowance amount is fixed. `purpose`, `variability`, `fixed` and the old
   `allowance_inclusion` enum are gone.
4. **No constant hoisting.** Each constant lives with its reader:
   - `no_part_xii_categories` inline in MY overtime eligibility
   - `wage_floor_factor` on the ID overtime row
   - `daily_hours` and part-time maxima on the roster rule
   - `months_per_year`, `full_year_min_months`, `compensation_max_years` inline in their reader
   - `normal_hours_per_day`, `days_per_week`, `six_day_week`, `calendar_days` from the contract or engine context
5. **Lookup holds shared tables only.** No free-form `record of json`, no boolean, no code list, no single-reader scalar.
   Every remaining key is declared in `tables.ts`; a single-reader key is rejected by the ownership test.
6. **A choice is an enum or union.** A list of allowed codes is a validated rule, not a settings bag.
7. **No stringly field paths.** A `*_field` path is replaced by a typed direct read.
8. **`reads` are explicit.** Every value is `{ var: … }` or a literal, never a bare `ctx.` string.
9. **Typed catalog programs.** Each family declares typed params, an input root set and an output type in
   `programs.ts`/`params.ts`. Start with `overtime_catalog`; all families follow.
10. **One expression language.** `format: 'cel'` is removed; expressions are JavaScript with one checker.
11. **Extension schemas are flat.** No `facts`, `term_facts`, `exit_facts` or `elections`; keep `statutory.<SCHEME>`
    and `events[]`. Every field is read by a formula or shown in the salary listing.
12. **A window is a row property.** `balance_window` is on the subtotal/statutory row; `month_balance` is gone.
13. **Ledger keys are typed.** Period is `<scope>.<Y|M|D|S|B|L|E>.<start>`; measure is a typed union; the write
    boundary refuses unknown codes.
14. **Reversal is a link, not a flag.** `reverses` is the only reversal link; every check derives `reverses != null`.
    A reversal must mirror the original impact, priced under the original sealed settings, not today's.
15. **No delta authoring.** The sealed version remains the whole law. Do not add version deltas.
16. **No release.** Staging only after all gates are green; production untouched until a proven no-reset path exists.

## 4.1 Owner amendments, 2026-11-08

- A shift pattern is a weekly configuration: `pattern.week_start` plus a weekday map of shift codes. The contract's
  `effective_range` owns dates; `anchor_date` is removed. The statutory week starts from the pattern.
- The contract write boundary refuses a shift code whose paid duration exceeds `terms.normal_hours_per_day`. Duration
  is untimed hours, or start/end minus unpaid breaks; no second duration field.
- `deemed_daily_hours` is removed. It is not `normal_hours_per_day`; a deemed-hours regime would be a separate typed
  employee election read under `working_time_regime = DEEMED`.
- `long_leave_granted` is removed. The leave application/approval is the decision owner; a legal accrual would be a
  dated entitlement, not a boolean.
- Workplace cases carry one required `employment_id` and one `entity_id`; one entry per employee. `WORK_ACCIDENT` is a
  `workplace_case_catalog` row. `severity` is a concrete entry enum (`DEATH`, `PERMANENT_TOTAL_DISABILITY`,
  `SERIOUS_INJURY`, `MINOR_INJURY`, `NEAR_MISS`, `PROPERTY_DAMAGE`, `N/A`). Non-injury cases use `N/A`. Common fields
  are `employment_id`, `severity`, optional `occurred_on`, `location`, `reference`, `description`; kind-specific data
  stays in `inputs`. The accident effect reads `severity`, never `inputs.outcome`.
- No decorative facts. A value read by two or more rows lives once in `lookup.constants`; a value read by one row
  lives on that row. Generated registries, not hand-edited parallel JSON.

## 4.2 Catalog and settings surfaces

- A catalog is configuration for an entry. The entry owns its dates, quantity, unit, evidence and party facts.
  `incurred_on` is therefore removed from the leave, claim, ad-hoc and loan catalogs; their ledger lines use the
  entry date (and the loan repayment's `paid_on`). Allowance and overtime have no entry, so they keep one explicit
  “economic date rule”, labelled as a rule and rendered as code.
- Each catalog family states what it configures, its rules and its behaviour above the table. The row drawer groups
  Definition, Rule, Posting, Configuration and Settings with icons; every expression field renders in a code block.
- Settings is a parent group. `Lineage` holds the version tabs, General, Tables, Calculation overview, Catalog,
  Registered rules, Registered behaviour and Compare; `Change log` is a separate global app and is not scoped to a
  version. General renders only declared form sections; arbitrary lookup tables live in Tables.
- Static catalogs declare an optional `description`; the family description is always shown. Seed descriptions are
  jurisdiction content and follow the one-agent-per-jurisdiction rule.
- A **work event** is a dated real-life condition independent of one employee: a heat period, hurricane, earthquake,
  epidemic or suspension. `work_event_catalog` is configuration under Settings → Catalog; its row is the event type
  itself, referenced directly. There is no category enum and no separate suspension catalog; a suspension is a work
  event. `work_event` records the period, entity and optional employment. The run and the leave-entitlement sync expose
  the applicable events as `ctx.work_events`. The event itself pays nothing; an allowance or ad-hoc catalog row reads it
  and remains the thing that posts.
- A workplace case remains an employee-specific incident. A work event is the non-person variant; keeping them separate
  now avoids forcing an employee link onto a period that affects a whole site or region.

## 4.3 Latest owner directives

**Extension ownership (owner directive, 2026-11-08).** The extension is not a sink. Life events, dependents, child
birth, only-child, nationality, birth city, passport number and worksite region are native `employee_contract` fields.
The extension keeps jurisdiction-specific statutory declarations and elections only, and never duplicates a contract
field.

**Catalog identity.** A catalog row is `code`; `name` is deleted from every catalog model and seed row. Tables show
`code` and `description`, and relations render their target badge.

**Three-layer catalog naming.** `<family>_catalog`, `<family>_catalog_entry`, `<family>_catalog_entry_<part>`.
`leave_catalog_entry_day` and `loan_catalog_entry_repayment` are the two split children; `payroll_run_id` lives on the
child, never on the catalog or the entry.


- ~~Partially sealed entries.~~ Leave now uses `leave_catalog_entry_day`; a run seals each day, the entry remains editable
  for uncaptured days, and a reversal names a subset of captured days. Loan repayments keep the whole-child lock and no
  reversal. The ledger posts the inverse once.
- ~~Work interruptions merge into work events.~~ Implemented: the separate catalog and entry models, page and engine reads are gone; their catalog rows live in `work_event_catalog` and their periods are `work_event` records.
- ~~Payment schedule ownership.~~ `payment_schedule` and `pay_cutoff_day` live on `entity`; the legal version no longer
  duplicates them.
- ~~Lineage app.~~ Scheduled moved under Change log; Lineage has one page and no root tabs.
- ~~Reads filter.~~ Root `id` shows as a variable chip; other conditions use `FilterEditor`.
- ~~Events > Work.~~ Month board is the page content; shift definitions/patterns are no longer edited there.
- ~~Settings tabs.~~ Tab strip is flush right.

## 5. Required gates

A change is not complete on `bolt check` alone.

| Gate             | Evidence                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership        | `configuration_ownership.test.ts`: every settings key is a declared table, no single-row value, no `*_field`, no contract-term duplicate, no bare `ctx.` read |
| Typed params     | every catalog lookup key is in `params.ts` and decodes                                                                                                        |
| Extension        | `extension_fields.test.ts`: no buckets, every field has a reader, every direct path is declared, latest schema matches its source                             |
| Lookup inventory | `lookup_keys.test.ts`: no declared key without a reader                                                                                                       |
| Lineage          | every version is sealed, unbroken and changed for a reason                                                                                                    |
| Figures          | the country suites for the affected jurisdiction; a moved value needs a figure probe, not just a green shape test                                             |
| Full suite       | the whole HR suite, not only the focused file                                                                                                                 |

A test that passes because a token appears in prose is not a reader test. A move is proved by the figure the formula
produces.

## 6. Migration and reset rules

- Rebase freely while nothing is deployed; one clean migration per release line.
- Destructive steps carry an explicit `-- accept:` line immediately after the `-- step`.
- Backfill before dropping: allowance row flags before the settings keys that seed them; balance windows before
  `month_balance`; contract terms before the old shape is refused.
- HR demos reset; a demo holding deleted history is reset, not followed.

## 7. Known smell backlog

Ranked by the cost of leaving them:

1. ~~Duplicate extension catalogue~~ — `extension_fields.ts` deleted; names derive from `extension_schema.json`.
2. ~~All-optional params~~ — `ROW_PARAMS` is generated per family and code; required keys are required.
3. ~~Overtime/night aliases~~ — single-factor keys normalized to `multiplier`; night window to `night_from`/`night_to`;
   the day-type map to `overtime_multiples`.
4. ~~Flat day/hour arms~~ — the write boundary rejects a divisor outside `FIXED` and a missing FIXED divisor. A stored
   sum union is not available in the Bolt field model; the guard is the union enforcement.
5. ~~Unchecked producer roles~~ — employer-only rate inclusion and `UNPAID` plus conversion are rejected at the model
   boundary; the seed gate checks every version, and the `off_cycle_eligible` surface is adhoc-only.
6. ~~No generator hook~~ — `bun run registry:generate` regenerates `tables.ts`, `params.ts` and `extension_schema.json`.
7. ~~Off-cycle ambiguity~~ — only adhoc rows opt into an `OFF_CYCLE` run.
8. ~~`service_started_on` versus `effective_range.from`~~ — the two dates answer different questions; the write
   boundary now refuses a service start after the contract version that records it (`startsAfterService`).
9. ~~Shared scalars copied into rows~~ — a key every reader declares with the same value now lives once in
   `jurisdiction_settings.lookup.constants`; `settingsConstants` spreads it into `ctx.lookup`, and test readers merge it
   for expression evaluation. Keys where absence is meaningful (`no_cap`, `service_months`, `state_owned_employer`,
   `below_zero`, `eligibility`, `opened_by`) stay on the row.
10. ~~`minimum_wage` two shapes~~ — CN's list is `minimum_wage_by_zone`; `minimum_wage` is VN's object. The table shape
    follows the jurisdiction, and no key carries two shapes.

## 8. Review checklist

- [ ] Can this value be derived? If yes, it is not a field.
- [ ] Does a link, date or child row already decide it? If yes, delete the flag.
- [ ] Does one flag answer more than one question? If yes, split it.
- [ ] Is this value beside its only reader? If not, move it.
- [ ] Is this settings key read by at least two rows and declared in `tables.ts`?
- [ ] Is there a `*_field` string path?
- [ ] Is every `reads` value a `{ var }` or literal?
- [ ] Is every catalog lookup key in `params.ts` and typed?
- [ ] Does the extension schema stay flat, with a reader or listing use per field?
- [ ] Does a moved value have a figure probe, not only a shape test?
