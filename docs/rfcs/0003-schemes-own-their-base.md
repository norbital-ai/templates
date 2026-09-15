# RFC 0003 — Schemes declare their base; every expression says what it returns

- Status: Landed 2026-09-15. §10 records what landed differently from the draft.
- Scope: `work_rules`, `catalogue_band`, the five catalogues, `statutory_contributions`, the
  expression contexts in `lib/expressions`, the Settings screens, and every fixture under
  `tests/fixtures`.
- Keeps: the RFC 0001 pipeline, the RFC 0002 rule ladders, the five families, `destination ×
direction` landings, the expression editors and their write-time compile.
- Changes: no computed amount. Every statutory golden stays cent-identical after every step.
- Reverses: RFC 0002 §0.2, "the scheme declares no list of lines at all". §1 says why.

## 0. The target in one page

```
LINES ──> LANDINGS ──> SCHEME BASE (declared on the scheme) ──> RULES ──> SETTLEMENT
```

1. A priced line carries a `code`, a family and a landing. No line names a scheme.
2. A scheme declares its base as typed data: whether salary, absence, overtime and the night
   premium are in it, and which catalogue rows are. Nothing is matched by string; every entry in
   the base is a reference the write validates.
3. Work rules are: proration, one ordinary-rate expression, one overtime-eligibility expression,
   the ordered bands, limits, breaks, weekly rest, an optional night premium, and precedence.
4. A catalogue row is identity, eligibility, landing, evidence and the family's own facts. A band
   exists only where an amount or a limit varies by entry, so every seeded row has none.
5. Every expression field is named for what it returns, and the editor says so beside it.

Field count on the objects this RFC touches:

| Object                        | Before | After                              |
| ----------------------------- | ------ | ---------------------------------- |
| `work_rules` top level        | 11     | 10                                 |
| `work_rules.rates.ordinary[]` | 3      | gone                               |
| `work_rules.rates.bands[]`    | 8      | 5                                  |
| `work_rules.coverage`         | 6      | gone                               |
| `work_rules.engine_lines`     | 3      | gone                               |
| `catalogue_band`              | 4      | 3                                  |
| `leave_catalogue`             | 15     | 12                                 |
| `statutory_contributions`     | 11     | 11 (`is_statutory` out, `base` in) |

## 1. Schemes declare their base

### 1.1 Why the scheme side

Overtime is not salary for contributions, and the seeded opt-ins prove it is the scheme that
decides: in Malaysia EPF and HRDF exclude overtime while SOCSO, EIS and PCB include it; in the
Philippines PhilHealth and Pag-IBIG exclude it; in Vietnam only PIT includes it. Each statute
defines its own wage base in one clause. Today that clause is restated on every line of the
version: three engine-line lists, one list per overtime band, one per catalogue band, two per leave
row.

RFC 0002 chose the line side so that the reference is validated at write time and a line nobody
names feeds nothing. Both hold on the scheme side (§1.4). What does not survive is the alias layer:
line-side opt-ins pin `contribution_id`s that change on every cloned version, so `loadOptInAliases`
and `aliasedOptIns` exist in `contribution.ts`, `money.ts`, `loan.ts` and `leave/payroll.ts` only
to remap pinned ids to the scheme in force. A scheme-side declaration is read from the version in
force, so the layer goes.

### 1.2 The declaration

A new custom datatype `contribution_base`, one column `base` on `statutory_contributions`:

```
base
  salary          boolean   BASIC is in the base
  absence         boolean   ABSENCE and every unpaid leave day reduce the base
  overtime        boolean   every band line is in the base, the INCENTIVE funnel included
  night_premium   boolean   NIGHT_PREMIUM is in the base
  entries[]       { family, code }   catalogue rows of the version whose lines are in the base
```

`entries` is the explicit list. A row absent from it feeds nothing, as silence does today. Any
family's row may be listed; `DISPLAY` lines never form a base. The sign is the line's own bucket:
an earning, non-wage payment or employer cost adds, an absence or deduction subtracts. The `effect` field disappears; the seeds never used `INCLUDE` on an absence or
`REDUCE` on an earning.

A leave row has two lines. Its unpaid day lands as `ABSENCE` and follows the scheme's `absence`
flag, because an unpaid leave day is an absence: in every fixture the leave deduction opt-ins equal
the absence opt-ins. Its encashment lands as `EARNING` and follows the row's presence in
`entries`. That is the one asymmetry the seeds hold (Malaysia's HRDF reduces for unpaid leave but
charges no encashment), and it needs no second list.

`salary` and `absence` are separate flags because the Philippines seed has PhilHealth charging
salary without reducing for absence (§8). Every other seeded scheme sets them alike, and the form
defaults `absence` to `salary`.

### 1.3 The seeds as declarations

Derived mechanically from the current fixtures (§7 step 4 is the script). Entries omitted here;
the script lists them.

| Jurisdiction | Scheme                       | salary | absence | overtime | night |
| ------------ | ---------------------------- | ------ | ------- | -------- | ----- |
| MY           | EPF, EPF_PR, EPF_NON_CITIZEN | yes    | yes     | no       | –     |
| MY           | SOCSO, EIS, PCB              | yes    | yes     | yes      | –     |
| MY           | HRDF                         | yes    | yes     | no       | –     |
| SG           | all six                      | yes    | yes     | yes      | –     |
| PH           | SSS, SSS_EC, WTAX            | yes    | yes     | yes      | yes   |
| PH           | PHIC                         | yes    | no      | no       | no    |
| PH           | HDMF                         | yes    | yes     | no       | no    |
| VN           | SI, HI, UI, UNION_FEE        | yes    | yes     | no       | no    |
| VN           | PIT                          | yes    | yes     | yes      | no    |
| TW           | all seven                    | yes    | yes     | yes      | –     |

### 1.4 The contract

- Write time: every entry in `base.entries` names a row of the same settings version, in the
  family stated, by code. This is the existing `catalogue_rules.ts` gate with the direction
  of the reference turned around.
- Seal time: a scheme whose base admits nothing (every flag off, no entries) is refused, as a rule
  that covers nobody is refused today (RFC 0002 §6).
- Run time: the engine resolves each scheme's declaration to the set of line codes in the version
  (the four work codes by flag, the listed rows by their `code`), and a scheme's base is the signed
  sum of the priced lines whose code is in that set. A reversal negates a frozen line under its
  frozen code; the scheme in force decides whether that code is in its base, which is what the
  alias layer approximated by scheme code.
- The "Opted-in lines" tab and the calculation-flow graph stay, computed from the declarations
  instead of by walking the lines.

### 1.5 The screen

The settings version gets one matrix, schemes across and lines down: the four work lines first,
then every PAY-landing catalogue row grouped by family. A cell is a checkbox. It is the same
information the "Opted-in lines" tab shows read-only today, made editable in the direction the
statute is written. The per-band, per-row and per-engine-line opt-in pickers go.

### 1.6 What disappears

- `work_rules.engine_lines`, all three lists.
- `statutory_opt_ins` on `work_rules.rates.bands[]`, on `catalogue_band`, and on every leave band.
- `leave_catalogue.bands`. Every seeded leave row carries the same two-band workaround
  (`entry.amount == 0` / `entry.amount > 0`) whose only job was different opt-ins for the deduction
  and the encashment. The band `amount` is never read for time off; the unpaid day is priced by
  `work_rules.proration` in `ordinary-rate.ts`.
- `leave_pay_items[].statutory_opt_ins`.
- `loadOptInAliases`, `aliasedOptIns`, `OptInAliases` and their four call sites.
- `opt-in-lines.ts` as a walk over declared lists; it becomes a read of the declarations.
- `statutory-opt-ins.svelte`, `statutory-opt-ins-cell.svelte`, `engine-line-opt-ins.svelte`,
  `scheme-options.svelte.ts`.
- The RFC 0002 §6 gate "every `contribution_id` in a band's opt-ins names a scheme of the same
  version", replaced by §1.4's first bullet.

## 2. Work rules, target shape

```
work_rules
  proration                 typed (unchanged)
  ordinary_divisor_days     expression · person · days per month
  overtime_when             expression · person · boolean · empty = everyone
  bands[]
    label                   text, the payslip class ("OT-1.5X")
    when                    expression · work_day · boolean
    take_hours              expression · work_day · hours
    price_amount            expression · work_day · money, for the whole slice
    funnel_above_hours      expression · work_day · hours · optional
  limits[]                  typed (unchanged)
  breaks[]
    when                    expression · work_day · boolean
    owed_minutes            expression · work_day · minutes
    counts_as_worked_time   boolean
  weekly_rest_rule          typed (unchanged)
  night_premium             { from, to, ordinary_add, overtime_add } · optional (unchanged)
  holiday_rest_precedence   typed (unchanged)
  authority                 text (unchanged)
```

### 2.1 Ordinary rate is one expression

`rates.ordinary[] {when, unit, divisor}` becomes `ordinary_divisor_days`, days per month over the
person site. The engine keeps `monthlyBaseSalary`, keeps rounding each rate to the cent before
multiplication, and derives both rates from the one divisor:

```
ordinary_day  = cents(monthly / divisor_days)
ordinary_hour = cents(monthly / divisor_days / normal_daily_hours)
```

That is what the engine computes for a `DAY` row today. For an `HOUR` row it computed
`cents(monthly / hours)` and `cents(monthly × daily / hours)`, the same pair once the divisor is
stated in days. The five seeds:

```
MY  26.0
TW  30.0
VN  period.working_days
PH  terms.payroll_group == "MONTHLY" ? 30.4167 : terms.ordinary_hours_per_week > 40.0 ? 26.0833 : 21.75
SG  52.0 * 44.0 / 12.0 / (terms.ordinary_hours_per_week / terms.working_days_per_week)
```

`period.working_days` is a new person-site member: the pay month's scheduled working days for the
person, which `resolveOrdinaryRate` already obtains through its `workingDays` callback. Singapore
is the only seed whose arithmetic changes shape; its goldens are the acceptance test.

`pay_frequency` `DAILY` and `HOURLY` stay engine branches. They are the contract's unit, not the
statute's divisor.

### 2.2 Overtime eligibility is one expression

`coverage {wage_ceiling, ceiling_is_inclusive, wage_basis, category_basis, exempt_categories,
excluded_categories}` becomes `overtime_when`, a boolean over the person site, evaluated by the
`isEligible` helper every catalogue row already uses. A person it rejects earns no band line and no
overtime night add, exactly as `NOT_COVERED` does today.

```
MY  terms.statutory_work_category != "VESSEL_WORK"
    && (terms.workman
        || terms.statutory_work_category == "COMMERCIAL_VEHICLE_OPERATOR"
        || terms.statutory_wages <= 4000.0)
SG  employment.classification == "EA_COVERED" && terms.basic_salary <= 4500.0
PH  employment.classification != "MANAGERIAL"
VN  (empty)
TW  (empty)
```

The enum values named here are the `employment_terms` enums the person context already exposes
(`employment.classification`) or will (`terms.statutory_work_category`); they are not free strings.
Two person-site members are added: `terms.statutory_work_category` (today only the `workman`
boolean is exposed) and `terms.statutory_wages`, the Employment Act s.2 comparand that `work.ts`
already derives for the ceiling test. `coverage.ts` and its `UNDETERMINED` and currency branches
are deleted; the comparand is always computable and always in the version currency.

The expression can state what the struct could not: Singapore's Part IV covers workmen to $4,500
and non-workmen to $2,600, and the struct held one ceiling. Vet before regenerating (§8).

### 2.3 Bands lose three fields

Across every seeded band `line` is `OVERTIME` and `funnel.line` is `INCENTIVE`. Both go; the
funnel is one optional `funnel_above_hours`. The component identity becomes `OVERTIME:<label>` and
`INCENTIVE:<label>`. The `absence` branch in `work-lines.ts` for a band that emits `ABSENCE` is dead
and goes with it. The band's opt-in list goes with §1.

`price_amount` gains `hours`, the slice the band actually consumed, in its context. Every seeded
price restates its own `take` today (Taiwan pastes a ternary twice); with `hours` it reads
`hours * ordinary_hour * 1.5`. Flat awards such as `day_wage * 0.5` are unchanged and must stay
possible: a Malaysian rest-day half-day award is a fixed sum whatever the hours worked.

### 2.4 Night premium

Unchanged. It is data (a clock window and two percentages), not a decision, and no seed needs a
night eligibility. Its opt-ins were the third `engine_lines` row and are now the scheme's
`night_premium` flag.

## 3. Catalogues, target shape

```
<family>_catalogue
  settings_id · code · name · authority
  eligibility               expression · person · boolean · empty = everyone
  destination · direction   (unchanged; see §3.2)
  evidence                  (unchanged)
  bands[]                   optional (already), see §3.1
  + family facts            allowance: recurring, prorates, on_day
                            loan: loan_type, minimum_repayment
                            leave: paid, evidence_after_days, entitlement

catalogue_band
  when                      expression · entry · boolean · empty = every entry
  amount                    expression · entry · money
  limit                     entitlement · nullable (unchanged)
```

### 3.1 Bands are for varying amounts

Every seeded allowance, claim and payment band is `when: ''`, `amount: entry.amount`,
`limit: null`; it exists only to hold opt-ins. A row with no bands already settles the entry's own
amount, so once opt-ins move to the scheme every seeded row has no bands and nothing else changes.

`amount` becomes an expression only. Today it is `number | string`; a bare `120.0` is a valid
expression, so the union buys nothing and costs a type check in every reader. The same applies to
`entitlement.amount` and `breaks[].owed_minutes`.

### 3.2 Landing stays two fields

`destination × direction` collapses to one bucket in `settlementBucket`, and one enum could
replace the pair. Not in this RFC: it changes no seeded value, touches every family's form, and the
pair reads more naturally on the form than the six-value bucket would.

### 3.3 Leave

`bands` goes (§1.6). `is_statutory` goes (§4). The "Pricing" tab shrinks to `paid`, `evidence`
and `evidence_after_days`, and is renamed accordingly. Whether an unpaid day or an encashment
touches a scheme is that scheme's declaration (§1.2).

## 4. `is_statutory` goes

On `statutory_contributions` and `leave_catalogue` the flag does three things: the hook demands
`authority` when it is set, the drift automation watches only flagged rows, and a badge renders.
All three follow from `authority` being non-empty, and none of the 30 seeded schemes is unflagged.
Delete the column on both; the drift automation filters on `authority != ''`; the badge renders
from the same test. `leave_pay_items[].is_statutory` is a frozen copy and goes with it.

## 5. Every expression says what it returns

### 5.1 Already in place

`compileExpression({site, type})` checks members and the result type at write time.
`expression-field.svelte` and `expression-cell.svelte` take the same `{site, type}`, compile live
and show the refusal sentence. `expression-fields.svelte` lists the site's members. That is the
mechanism; what is missing is that a reader cannot see the contract until they get it wrong, and a
numeric field's unit is nowhere.

### 5.2 The unit rides the type

`ExpressionType` widens from `'boolean' | 'number'` to `'boolean' | 'money' | 'hours' |
'minutes' | 'days'`. The compiler still checks the two underlying kinds; the unit is for the
reader, and every existing call site names its unit instead of `number`. Fields that may be empty
pass `empty: 'everyone'` (or `'every entry'`), and both editors render one line under the input,
from those two props:

```
boolean over the work day
hours over the work day
money over the entry · empty is the entry's own amount
boolean over the person · empty is everyone
```

### 5.3 The naming rule

- A boolean expression is named `when`, `<x>_when` or `eligibility`. Nothing else ends in `_when`.
- A numeric expression names its unit as a suffix: `_hours`, `_minutes`, `_days`. An unsuffixed
  numeric expression (`amount`, `employee`, `employer`, `price_amount`) is money in the version
  currency.

Renames: `take` → `take_hours`, `price` → `price_amount`, `funnel.above` →
`funnel_above_hours`, `rates.ordinary` → `ordinary_divisor_days`, `coverage` → `overtime_when`.

### 5.4 Every expression field after this RFC

| Field                                   | Site       | Returns | Empty means |
| --------------------------------------- | ---------- | ------- | ----------- |
| `work_rules.ordinary_divisor_days`      | `person`   | days    | refused     |
| `work_rules.overtime_when`              | `person`   | boolean | everyone    |
| `work_rules.bands[].when`               | `work_day` | boolean | refused     |
| `work_rules.bands[].take_hours`         | `work_day` | hours   | refused     |
| `work_rules.bands[].price_amount`       | `work_day` | money   | refused     |
| `work_rules.bands[].funnel_above_hours` | `work_day` | hours   | no funnel   |
| `work_rules.breaks[].when`              | `work_day` | boolean | refused     |
| `work_rules.breaks[].owed_minutes`      | `work_day` | minutes | refused     |
| `<family>_catalogue.eligibility`        | `person`   | boolean | everyone    |
| `catalogue_band.when`                   | `entry`    | boolean | every entry |
| `catalogue_band.amount`                 | `entry`    | money   | refused     |
| `entitlement.amount`                    | `entry`    | money   | refused     |
| `leave_entitlement.bands[].eligibility` | `person`   | boolean | everyone    |
| `contribution_rules[].when`             | `scheme`   | boolean | refused     |
| `contribution_rules[].employee`         | `scheme`   | money   | refused     |
| `contribution_rules[].employer`         | `scheme`   | money   | refused     |

## 6. Context additions

| Site       | Member                          | Type   | Why                                |
| ---------- | ------------------------------- | ------ | ---------------------------------- |
| `person`   | `terms.statutory_work_category` | string | `overtime_when` (§2.2)             |
| `person`   | `terms.statutory_wages`         | number | `overtime_when` (§2.2)             |
| `person`   | `period.working_days`           | number | `ordinary_divisor_days` (§2.1, VN) |
| `work_day` | `hours`                         | number | `price_amount` (§2.3)              |

`terms.workman` stays; the MY expression uses it and it is shorter than the two-value test.

## 7. Migration order

Each step regenerates the fixtures it touches, runs `pnpm templates:check`, the statutory goldens
and the template lint, and lands with its test. Goldens must be cent-identical at every step; a
step that moves a cent stops and is vetted before the next.

1. **Units and names** (§5). Widen `ExpressionType`, rename the five fields, add the line under
   the editors. Fixture keys rename; no value changes.
2. **Ordinary rate** (§2.1). Add `period.working_days`; add `ordinary_divisor_days`; write the
   five expressions; delete `rates.ordinary`, the row search in `resolveOrdinaryRate`, and the
   `ordinary-rate.test.ts` cases that exercised row order.
3. **Overtime eligibility** (§2.2). Add the two person members; add `overtime_when`; delete
   `coverage`, `coverage.ts`, `isStatutoryOvertimePayCovered` and the coverage cases in
   `work.ts`. Vet SG first (§8).
4. **Schemes declare their base** (§1). Add `contribution_base` and the `base` column. A one-off
   script reads each fixture's line-side opt-ins and writes each scheme's four flags and its
   `entries`. Run the goldens with both mechanisms present and the declaration authoritative.
   Then delete everything in §1.6, add the §1.4 gates, and build the §1.5 matrix.
5. **Bands** (§2.3). Drop `line` and `funnel.line`; add `hours`; rewrite the seeded prices.
6. **Prune** (§3, §4). `number | string` unions collapse; `is_statutory` goes on both collections
   and on `leave_pay_items`; the leave tab is renamed.
7. **Docs.** `architecture.md` §Coverage and §Contribution rewritten; RFC 0002 §0.2 and §7.2
   marked superseded by this RFC; the acceptance matrix updated per probe.

## 8. Vet before landing

- **PH absence and PhilHealth.** The seed has PhilHealth charging salary but not reducing for
  absence, alone among the five. Either PhilHealth's basis is the contracted monthly salary and the
  flags are right, or it is a seed slip and `absence` joins the others.
- **SG non-workman ceiling.** The struct held one ceiling ($4,500). The expression can hold both
  Part IV ceilings; confirm the second before writing it.
- **MY HRDF on leave encashment.** The seed excludes it. Confirm against the PSMB Act levy base.
- **Loan opt-ins.** No seeded loan row has any. If a deployed lineage does, it needs a decision
  before step 4, because `NET` rows cannot be listed in a base afterwards.

## 9. Not in this RFC

- `proration`, `limits`, `weekly_rest_rule`, `holiday_rest_precedence`: typed data the engine
  stores beside its result, not decisions.
- Merging `destination × direction` (§3.2).
- Removing any stored employee or terms column; every one is read by at least one seeded
  expression.

## 10. As landed

- `entries` reference rows by `{ family, code }`, not by id: a code is the row's natural key within
  a version, so a clone carries the declaration unchanged and a settled line is matched by the code
  it froze. The write gate resolves the family to its catalogue and refuses a code the version lacks.
- Any family may be listed, `LOAN` included, and the sign comes from the landing: the seeds charge
  employer-paid medical rows and a `NET` 13th-month payment into tax bases, which "PAY rows only"
  would have dropped. `DISPLAY` lines never count.
- The converter derived every declaration from the line-side opt-ins with zero contradictions
  across the seed bank and both fixture roots; the Philippine PhilHealth asymmetry (salary yes,
  absence no) is preserved as separate flags.
- Bands sit at the top level of `work_rules` (`bands`, not `rates.bands`); the ordinary divisor is
  `ordinary_divisor_days`; coverage is `overtime_when`; a break's `owed_minutes` is an expression.
- `ExpressionType` is `boolean | money | hours | minutes | days`; the editors print the contract
  under the input (matrix cells carry it as the input title).
- `is_statutory` is gone from schemes, leave rows and frozen leave items; the drift automation
  watches rows that cite an `authority`.
- Parity: the statutory goldens of every lineage are cent-identical before and after each pass,
  proven both on the committed fixtures and, in a throwaway worktree, against the committed engine
  with opt-ins rebuilt from the declarations. The Singapore hours-per-month divisor survives the
  days-per-month form at the cent.
