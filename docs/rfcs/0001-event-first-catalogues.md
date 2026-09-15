# RFC 0001 — Event-first catalogues, limit-referencing bands, explicit CEL contexts

- Status: Accepted; the scheme shapes in §8 (and the scheme lines in the model sketch) are
  superseded by [RFC 0002 — Schemes are rules](./0002-schemes-are-rules.md)
- Scope: `templates/hr-payroll` (schema, engine, UI, seed shape) and `seed_bank/norbital_hr`

> **Superseded in part.** RFC 0002 replaced the statutory scheme this RFC specified.
> `statutory_contributions.eligibility`, `sequence`, the typed `statutory_rules` remainder and the
> `scheme_reliefs` junction are gone: a scheme now holds `rules: [{ when, employee, employer }]`
> expressions plus the three relief-pool columns, and the order payroll applies schemes in is
> derived from `produced.<code>` mentions. Read the schema sketch and §8 below as the earlier
> design; RFC 0002 is what landed. Everything else in this RFC (the catalogue spine, work rules,
> destinations and directions, entries and `payslip_id`) stands.

## 1. Summary

Payroll becomes three line-item producers over a prorated base salary:

1. **Catalogue families** — leave, claims, adhoc (payments), allowances, loans. Every row owns
   code, eligibility, entitlement, bands and amount logic; every row has **entries**, and each
   entry is one line item on one payslip through a nullable `payslip_id`.
2. **Work rules** — a standalone producer on `jurisdiction_settings` that prices schedule and
   attendance through a CEL band table, including the incentive funnel. It is not a catalogue
   family.
3. **Statutory contributions** — standalone rows on the settings version that assemble bases from
   explicitly opted-in lines and price their own bands.

Hard-coded selector, award, nature, treatment and limit attributes are replaced with **CEL whose
contexts are explicit, documented and compiled at catalogue write time**. Limits are named
evaluated values, referenced inside bands. Compliance is enforced when schedules are written, in
patterns and roster overrides alike; attendance overruns are priced, reported, never dropped.

## 2. Locked decisions

1. Catalogue families: leave, claims, adhoc (payments), allowances, loans. Each row owns code,
   eligibility, entitlement, bands and amount logic; each has entries.
2. `work_rules` and `statutory_contributions` are standalone line producers on
   `jurisdiction_settings`, not catalogue families.
3. No capture collections. Every entry carries a nullable `payslip_id`; the run sets it on
   consumption. One entry = one line = one payslip. (A recurring allowance materialises one
   per-period row per payslip. A leave entry settles whole in one period; a straddling range is
   refused and entered per period. A loan repayment is recovered whole by one payslip — there is no
   partial recovery; a repayment the net-pay guard cannot carry stays unlinked for the next run.
   _Amended 2026-09-15._)
4. CEL where it removes a hard-coded attribute: band matching, amounts, proration, statutory
   rules and matching, break obligations.
5. Statutory effect is explicit opt-in per line; silence means no effect.
6. One payslip line per OT class: `OVERTIME 1.0/1.5/2.0/3.0`, `INCENTIVE`.
7. Incentive is not a fixed multiple: it inherits the award of the band the hours came from
   (a x3 holiday hour funnels as x3).
8. Compliance is schedule-time only — enforced on work patterns and roster overrides alike.
   Attendance overruns are priced and reported, never dropped or blocked.
9. `proration` and `rates.ordinary` are separate fields; they answer different questions.
10. OIL is manual. PH holiday replacement uses per-person `given_to` recipients.
11. Shift codes and patterns are entity-owned, like holidays. Sources are inlined
    (`sources.urls`), not a collection.
12. A run's population is every eligible employment in the period. There is no operator exclusion
    list and no subsetting: the run always builds a payslip for each of them. The per-run
    `withheld` input and `run_withholdings` type are removed.
13. A payslip carries `status: DRAFT | ON_HOLD | PAID` and a nullable `paid_at`. `DRAFT` is the
    freshly computed state and may be recalculated or deleted; `ON_HOLD` is a reviewed but held
    slip, excluded from every bank file and still releasable back to `DRAFT`; `PAID` is terminal
    and carries the day money left. There is no separate exclude-from-bank-file flag: holding a
    slip is how it is kept out of the file.
14. Payment and locks are per payslip, never per run. A captured source is locked while the slip
    that consumed it stands; deleting a `DRAFT`/`ON_HOLD` slip releases its own sources, and a
    `PAID` slip can never be deleted. A run carries no status of its own; the UI rolls its slips
    up. _Amended 2026-09-15: `lifecycle` is gone entirely._

## 3. Non-goals

- No legacy or compatibility migration. The change is a full replacement: old collections,
  custom types, hooks and UI bindings are removed, and seeds and tests are rewritten to the new
  standard.
- No change to UI concepts. The settings, catalogue and schedule surfaces keep their meaning and
  layout; they are updated to render the new data shapes.
- No push to staging. Local verification only.

## 4. Target models and relationships

`◇` nullable, `[cascade|restrict|set null]` delete behaviour.

```
SETTINGS SIDE
jurisdiction_settings
├─ code · jurisdiction_code · name · effective_range · sealed_at · voided_at
├─ void_reason · cloned_from_id ◇
├─ payroll { currency · timezone · tax_year_start_month }
├─ wages { by_region -> amount }
├─ work_rules {
│    proration: CALENDAR_DAYS | WORKING_DAYS | FIXED_DAYS{n}   (typed, see 5.1)
│    lines { salary · absence · night } each { statutory_opt_ins[] }
│    rates.ordinary[ { when CEL · unit DAY|HOUR · divisor n | WORKING_DAYS } ]
│    rates.bands[ { label · line · when CEL · take CEL · price CEL ·
│                   funnel? { above CEL · line } · statutory_opt_ins[] } ]
│    limits[] · breaks[] · weekly_rest_rule · night_premium ·
│    holiday_rest_precedence · coverage · authority }
├─ sources { urls[] }
└─ change_summary
   1 ──< N statutory_contributions [cascade]
   1 ──< N leave_catalogue · claim_catalogue · payment_catalogue ·
         allowance_catalogue · loan_catalogue [cascade]
   1 ──< N payroll_runs [restrict]

statutory_contributions                       N >── 1 settings [cascade]
│   (superseded by RFC 0002: no `eligibility`, no `sequence`, no typed `rules`,
│    no `scheme_reliefs`; `rules: [ { when, employee, employer } ]` + three pool columns)
├─ code · name · is_statutory · authority · assessment_period
└─ rules[ { when CEL · employee CEL -> money · employer CEL -> money } ]
   1 ──< N employment_statutory_facts [restrict]

ENTITY SIDE
companies 1 ──< N employments · jurisdiction_holidays · shift_definitions · shift_patterns · payroll_runs
employees 1 ──< N employments
employments 1 ──< N employment_terms [cascade] · work_days · entries · loans · payslips
employment_terms N >── 1 shift_patterns [restrict]
shift_definitions 1 ──< N work_days [restrict]
jurisdiction_holidays 1 ──< N work_days [restrict]
  { company_id · date · name · kind PUBLIC|SPECIAL|SUBSTITUTE · published_at · source ·
    replaces ◇ · given_to EVERYONE | ONLY_IF_OFF_ON_REPLACED_DATE }

CATALOGUE SIDE — five families, one spine
<catalogue> (leave | claim | payment | allowance | loan)
├─ settings_id >── 1 settings [cascade] · code · name · eligibility CEL · sequence
├─ destination PAY|NET|EMPLOYER|DISPLAY · direction ADD|SUBTRACT ◇
├─ bands[ { when CEL · amount number|CEL · limit entitlement · statutory_opt_ins[] } ]
├─ evidence NONE|OPTIONAL|REQUIRED
└─ extras: leave { paid · evidence_after_days · convertor CEL(days, rate) }
           allowance { recurring · prorates · on_day }
           loan { loan_type · minimum_repayment }
   1 ──< N entries

ENTRIES (one collection per family)
├─ employment_id >── 1 employments [restrict]
├─ catalogue_id >── 1 <catalogue> [restrict]
├─ event (typed per family: leave range+charges · claim amount+incurred_on ·
│         payment amount+period · allowance amount+recurrence instance ·
│         loan_repayment amount_due+due_period)
├─ as_adjustment_entry -> sign -1 (same row, same line, negated)
└─ payslip_id ◇ -> payslips (one link; cleared with the slip)

PAYROLL SIDE
payroll_runs 1 ──< N payslips [cascade]
payslips { status DRAFT|ON_HOLD|PAID · paid_at ◇ · base[] · proration[] · adjustments[] ·
           statutory[] · gross · total_deductions · net · employer_cost · currency }
work_days ◇ payslip_id -> payslips (one link; cleared with the slip)

REMOVED: work_catalogue · payslip capture junctions · treatment maps · nature · settlement ·
         settled_* pins · research_notes · work_days.compensation · on_exceed ·
         OVERTIME_EXCESS · ordinaryDayIncentiveBoundary · run_withholdings
```

## 5. Limits and breaks

```
work_rules.limits: [
  { key, period: DAY|WEEK|MONTH|QUARTER|YEAR,
    measure: TOTAL_WORK_HOURS|OVERTIME_HOURS|NORMAL_HOURS|SPREAD_HOURS,
    max_hours, unit: WORKED_HOURS|CLOCK_HOURS,
    authority }
]
work_rules.breaks: [
  { when CEL(consecutive_hours, overtime_hours, continuous_attendance),
    owed_minutes number | CEL,
    counts_as_worked_time true|false|null }
]
```

### 5.1 Implementation notes

- `proration` stays typed, not CEL. The FIXED_DAYS arm's instalment share and its cap are
  arithmetic the engine must store beside its result (`payslip_proration.basis`), and a scalar
  expression could state the denominator but not the unit its numerator counts in.
- cel-js is strict about int and double: a seed writes double literals (`2.0`, `0.0`) in
  arithmetic, and there is no binary `min`/`max` (its overloads collide), so a clamp is a ternary.
- A Work pay item is one (line, label) pair: `BASIC`, `ABSENCE`, `NIGHT_PREMIUM`, and one
  component per band class plus funnel class. The funnel row keeps the source band's label,
  opt-ins and award.
- Until ACCUMULATE reads opt-ins natively, an adapter states each Work component's
  `contribution_treatments` from its opt-ins (INCLUDE / REDUCE by scheme code; absent = EXCLUDE).
  It is deleted with the treatments maps.

- `CLOCK_HOURS` limits evaluate against the shift: `evaluated = max_hours - shift.break_minutes/60`.
  A twelve-hour day less a one-hour break is 11 net worked hours.
- Every evaluated limit is exposed to CEL as `limits.<key>` in net worked hours. Bands reference
  the value; no duplicated constants.
- Schedule enforcement: a pattern write or roster override whose projection breaches any limit is
  refused. Per-period projections (day, week, month, quarter, year) are computed from the pattern
  cycle plus the overlay.
- Payroll: attendance overruns are reported, never blocked, never discarded.
- Breaks: `shift_definitions.variant.break_minutes` is what the shift grants; `work_rules.breaks`
  is what the law owes. A plan whose granted break is below the owed minimum is refused at
  schedule time. At payroll a quantified shortfall reduces payable OT where
  `counts_as_worked_time` is false.

Seeded coverage:

| Jurisdiction | Limits                                                                           | Breaks                                                 |
| ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| MY, MY-nihon | day TOTAL 12 CLOCK · day NORMAL 8 · day SPREAD 10 · week TOTAL 45 · month OT 104 | >5 h consecutive → 30; OT-length rule as configured    |
| ID           | day OT 4 · week OT 18                                                            | >4 h continuous → 30                                   |
| PH           | normal-day duty 8                                                                | 60 min meal, no trigger                                |
| SG           | day TOTAL 12 CLOCK · month OT 72                                                 | >6 h leisure (no minimum) · >8 h continuous → 45       |
| TW           | day TOTAL 12 CLOCK · month OT 46 · quarter OT 138                                | >4 h → 30                                              |
| VN           | day OT 4 · month OT 40 · year OT 200                                             | >6 h → 30 (counts as worked for continuous attendance) |

The MY normal/spread/weekly limits are newly applied; the regime currently records them as not
applied. They exist to refuse schedules.

## 6. Work rules bands and the incentive funnel

```
{ label "1.5", line OVERTIME, when day_type == "ORDINARY",
               take hours_beyond_normal, price ordinary_hour * 1.5,
               funnel { above limits.daily_total, line INCENTIVE } }
{ label "1.0", line OVERTIME, when day_type == "REST_DAY" && hours_from_start_fraction < 0.5,
               take first_half, price day_wage * 0.5 }
{ label "1.0", line OVERTIME, when day_type == "REST_DAY" && hours_from_start_fraction >= 0.5,
               take second_half, price day_wage * 1.0 }
{ label "2.0", line OVERTIME, when day_type == "REST_DAY",
               take hours_beyond_normal, price ordinary_hour * 2,
               funnel { above limits.daily_total, line INCENTIVE } }
{ label "2.0", line OVERTIME, when day_type == "PUBLIC_HOLIDAY",
               take within_normal, price day_wage * 2.0 }
{ label "3.0", line OVERTIME, when day_type == "PUBLIC_HOLIDAY",
               take hours_beyond_normal, price ordinary_hour * 3,
               funnel { above limits.daily_total, line INCENTIVE } }
```

- The engine prices the band's slice, then routes the portion of that slice above `funnel.above`
  to the funnel line at the band's own price.
- Worked example, normal 9 h, break 1 h, `limits.daily_total` = 12 clock → 11 net:
  - Weekday, 13 net hours: BASIC 9; `OVERTIME 1.5` for 9→11; `INCENTIVE` for 11→13 at x1.5.
  - Public holiday, 12 net hours: `OVERTIME 2.0` (day wage) within normal; `OVERTIME 3.0` for
    9→11; `INCENTIVE` for 11→12 at x3.
- Bands are ordered; each consumes from what is left. Jurisdictions without an incentive band
  simply state the statutory ladder.

## 7. CEL evaluation contexts

Five sites, each with one context object, one builder, and one blank instance used to compile
expressions at catalogue write time. An unknown member or a wrong result type is refused then,
not at payroll.

### 7.1 `PersonContext` — catalogue and scheme `eligibility`

Built by `personContext(input)` from employees, employments, effective employment terms,
children and companies.

```
employee   { gender · age · citizenship · marital_status · spouse_status ·
             solo_parent · race · religion · residency_months }
employment { type · classification · service_months · hire_date }
terms      { basic_salary · workman · department · payroll_group · grade ·
             ordinary_hours_per_week · working_days_per_week }
children   { count · under(n) }
company    { region }
```

### 7.2 `EntryContext` — catalogue band `when`/`amount`, leave `convertor`

Built by `entryContext(entry, catalogue, employmentBundle, period, configuration)` when the run
collects an entry, and at write time from the entry being saved.

```
person   PersonContext
entry    { amount · days · hours · quantity · event_date · period · recurring ·
           occurrence_index · window { start, end } · captures { paid_to_date, remaining } }
rates    { ordinary_day · ordinary_hour }
limits   { ...evaluated... }
period   { key · start · end · index · instalments }
leave    { days(code) · balance(code) }
```

### 7.3 `WorkDayContext` — `rates.bands` and `work_rules.breaks`

Built by `workDayContext(day, scheduledDay, configuration, person)` per priced day. The day
facts are flat so a band reads `total_work_hours > limits.daily_total` as written:

```
date · day_type ORDINARY|REST_DAY|PUBLIC_HOLIDAY|SPECIAL_HOLIDAY|OFF_DAY
worked_hours · normal_hours · hours_beyond_normal · hours_from_start_fraction
total_work_hours · overtime_hours · month_overtime_hours
consecutive_hours · continuous_attendance
roster_code · paid_minutes · break_minutes · start_time · end_time
ordinary_hour · ordinary_day · day_wage
limits { ...evaluated... } · person PersonContext · holiday { kind · name }
```

### 7.4 `SchemeContext` — scheme `rules` and the rule `when`/`employee`/`employer`

Built by `schemeContext(...)` inside the contribution step after bases are assembled.

```
base · share · code · assessment_period
period       { key · index · instalments }
year_to_date { base · employee }
projection   { payslips_remaining · future_equivalents }
person       PersonContext
region · minimum_wage(region) · headcount · age · risk_class
produced     { scheme_code -> { employee } }
```

### 7.5 `ScheduleContext` — limit and break enforcement

Built by `scheduleContext(plan, pattern, configuration, person)` at every pattern write and
roster override.

```
plan      { date · roster_code · kind · paid_minutes · break_minutes · spread_hours }
projected { day_hours · week_hours · month_ot_hours · quarter_ot_hours ·
            year_ot_hours · run_of_work_days }
limits    { ...evaluated... }
person    PersonContext
```

Helpers registered per site: `minimum_wage`, `bracket`, `ladder`, `progressive` and the money
roundings. cel-js is strict about int and double, so arithmetic writes double
literals (`0.0`) and `double(...)` where a value may be integral; there is no binary `min`/`max`
(its overloads collide), so clamps are ternaries. Member lists are data
(`EXPRESSION_CONTEXTS`) rendered by the UI Fields panel.

## 8. Statutory contributions

> Superseded by [RFC 0002 §3](./0002-schemes-are-rules.md). The landed shape is
> `rules[ { when, employee, employer } ]` expressions, the three relief-pool columns, and
> `produced.<code>` mentions as the only dependency declaration.

Base = sum of lines whose explicit opt-in names the scheme. Then `rules` (relief, base
transform, dependants as CEL; rounding, period table, caps, withholding as typed), then
`bands[ { when, employee, employer } ]`. A progressive rung is an expression: `when base > x &&
base <= y`, `employee: constant + (base - x) * rate`. Scheme-to-scheme relief via
`scheme_reliefs`.

## 9. Catalogue families and entries

Five catalogues share one spine (code, name, eligibility, sequence, destination, direction,
bands, evidence, family extras). One entry collection per family, each entry carrying a nullable
`payslip_id`. Adjustments are the same entry with `as_adjustment_entry`, sign -1, same line.

Destination and direction replace `nature`:

| destination | direction | Lands as                                     | Old nature       |
| ----------- | --------- | -------------------------------------------- | ---------------- |
| PAY         | ADD       | gross pay                                    | EARNING          |
| PAY         | SUBTRACT  | reduces gross                                | ABSENCE          |
| NET         | ADD       | pays the employee, not gross                 | NON_WAGE_PAYMENT |
| NET         | SUBTRACT  | net-only deduction                           | DEDUCTION        |
| EMPLOYER    | —         | employer cost only (company-direct included) | EMPLOYER_COST    |
| DISPLAY     | —         | printed, no money                            | INFORMATION      |

## 10. Holidays and OIL

```
CASE A — holiday fell on a non-working day for some staff
  HR publishes jurisdiction_holidays { kind SUBSTITUTE, replaces <PH date>,
                                       given_to ONLY_IF_OFF_ON_REPLACED_DATE }
  per person on the replaced date (pattern + work_days + leave):
      WORK -> not a recipient · OFF/REST -> recipient
  month board and resolveSchedule use the same check

CASE B — a premium day was worked and OIL is owed
  HR records it in the leave ledger: ADJUSTMENT (grant) ·
  TIME_OFF (fixed date) · candidate TIME_OFF (own choice) · REVERSAL (return the credit).
  No engine minting, no work_days.compensation.
```

## 11. Payroll flow

```
 employment_terms -> base salary · pattern · frequency
        |
 RUN          population = every eligible employment in the period
        |
 [1] PRORATE      work_rules.proration -> payslip.base (BASIC)
        |
 [2] COLLECT      entries with payslip_id = null
        |
 [3] NORMALISE    EntryContext: band when -> amount; opt-ins carried; adjustments negate
        |
 [4] WORK LINES   WorkDayContext: rates.bands in order -> BASIC · OVERTIME classes
        |           slice above funnel.above -> INCENTIVE at the band's own award
        |
 [5] SETTLE       PAY +/- · NET +/- · EMPLOYER · DISPLAY -> gross · net adjustments ·
        |           employer cost
        |
 [6] STATUTORY    SchemeContext: opt-in bases -> rules(when/employee/employer)
        |           rounding · caps · reliefs · period table
        |
 [7] FINALISE     net = gross - statutory - net deductions + net additions ->
        |           payslip arrays + totals
        |
 [8] SETTLE LINKS payslip_id set on every consumed entry; draft deletion clears it
        |
 STATUS           per slip: DRAFT -> ON_HOLD (held, out of the bank file) -> PAID (terminal)
        |
 BANK FILE        every slip except ON_HOLD

 SCHEDULING (before payroll)
 pattern write   -> ScheduleContext vs limits + breaks -> REFUSE on breach
 roster override -> same check -> REFUSE on breach
 attendance      -> priced; overrun -> INCENTIVE; reported, never blocked
```

## 12. Implementation strategy

Full replacement, no compatibility layer:

1. Replace models, custom types and relations; delete the removed collections and types.
2. Rewrite the engine read paths: work bands, settlement by destination, contribution bases,
   entry contexts, schedule validation.
3. Update the UI to render the new shapes under the same concepts; delete bindings to removed
   fields and the OIL day-sheet machinery.
4. Rewrite the seed bank to the new standard (all jurisdictions and the three entities), and the
   loader.
5. Rewrite tests; add the new proof tests.
6. Run gates, probe locally, remove leftover legacy concepts and shims.

## 13. Acceptance criteria

- Every expression site compiles and type-checks at catalogue write; a bad expression is refused
  at write with a named member or type.
- Schedule writes (pattern and roster) refuse any breach of `limits` or `breaks`.
- An attendance overrun prices onto `INCENTIVE` at the source band's award (x3 stays x3), one
  line per OT class.
- Each consumed entry is linked to exactly one payslip; a deleted draft clears the link.
- A run build covers every eligible employment; a held payslip is `ON_HOLD`, is absent from the
  bank file, and its captured sources stay locked until the slip is released or deleted; a `PAID`
  slip is never deletable.
- Nihon, KDIT and OPSPH payrolls tally with the raw source, unchanged from the takeover's
  reconciliation.
- `pnpm test` and `pnpm lint` pass inside the template; no legacy concept remains (checked by
  search).
- Nothing is pushed to staging.
