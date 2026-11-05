# HRMS calculation architecture

Status: normative. Section 0 is the owner's fixed design. [The model contract](0002-model-specification.md) defines the models, [the seed contract](0003-jurisdiction-seed-specification.md) the seed replacement and [verification](0004-verification-gates.md) the gates. The source tree is the final authority; these documents describe it and never create a second implementation plan.

## 0. The design is fixed

This is the owner's design. Every agent working on this workspace reads this section first and wires around it. Only the owner's explicit words change it. Where anything else in this repository disagrees, this section wins.

### How to work with it

1. A requirement that seems not to fit is a misreading, not a gap. Read the engine, then express the requirement with the parts below.
2. "It doesn't fit", "the engine can't do that" and "this needs a new field" are not findings. Do not report them as limits, and do not propose changing the design.
3. A limit of code you just wrote is not a limit of the design. Never present one as the other.
4. Add no model field, engine concept, context root, run input or helper module unless the owner told you to. Ship no approximation to get past a requirement.
5. If a requirement still has no home after reading this and the engine, stop and ask the owner how they want it expressed. Ask; do not build.
6. Brief every subagent with this section. It knows only what you give it.

### Catalogs, entries and reversal entries

- A **catalog** row captures behaviour per family: eligibility, conversion, target subtotal, party, direction and lookup. Allowance, overtime and statutory catalogs are definitions only. Leave, claim, adhoc, loan, work interruption and workplace case catalogs take entries.
- A **catalog entry** is one dated event against a catalog item. It records what happened, never how it is priced.
- A **reversal entry** (`is_reversal`) reverses a mistake: a new entry against the same catalog item. Leave, claim, adhoc and loan repayment entries all carry it. Nothing posted is edited or deleted. Its ledger movement is the inverse, and its pay line flips direction.
- A refund or correction is a reversal entry or an adjustment entry against a catalog item, and nothing else. No payslip line and no ledger amount is negative. A refund gets no statutory row, no account of its own and no ledger trick.
- A company's own policy goes on the existing row, through `pay_treatment` or a cash `conversion`.

### Ledger and balance

- Ledger entries are emitted at two moments only: when a leave, claim, adhoc or loan entry is created, and during payroll. Neither repeats the other's movement.
- The ledger is append-only and an amount is never negative.
- `employee_balance` is one row per person: the projection of the ledger, keyed by family and then code. Its accounts are data, not fixed columns.
- Whatever a formula needs from earlier runs comes from the balance. There is no payroll history read: no `ctx.history`, no statutory history, no looking back through payslips.
- Balances do not run on forever. They reset through proper dated ledger entries.

### Linear computation and subtotals

- Calculation is linear: one chain per settings version, and no stages, phases or branches.
- The first subtotal opens with base pay. Each later subtotal is the previous one plus its lines. Statutory schemes run in `depends_on` order. Checkpoints then rebuild with the statutory lines, and the last one is net pay.
- A subtotal is a checkpoint in the calculation, used by catalogs. It can be any arbitrary figure.
- Separate pay with subtotals, never by inspecting lines.

### Jurisdiction settings and lookup

- Jurisdiction settings capture behaviour for the whole jurisdiction. A change of law is a new sealed version.
- The `jurisdiction_settings` lookup is the global lookup, and it consolidates shared tables. A row may hold its own local lookup, and the local value wins.
- A jurisdiction adds two conversions only: `day_rate` and `proration_basis`. An hour is the day ÷ normal hours. Both are configurable per jurisdiction, and each follows its statute.

### Registered rules and effects

- A registered rule validates on an event.
- A registered effect is a side effect of an event. A check on a finished payslip is an effect that raises an obligation.
- Reads happen once, up front, for the whole batch. Nothing reads per payslip.

### Payroll run

- There are two kinds of run, and these are their names: **on-cycle payroll** and **off-cycle payroll**.
- `payroll_run` is thin. An on-cycle run takes the cycle, and the entity comes from the page scope. An off-cycle run takes who and what it is for.
- Off-cycle payroll is for adjustment entries and bonus runs, with one-off lump sums such as severance. Recurring items are on-cycle only: a tax instalment, zakat, rent, a benefit in kind, an allowance or overtime never runs off-cycle. `off_cycle_eligible` on the catalog row decides.
- Everything else derives from the entity's schedule, its cutoff day and the law in force. None of it is typed.
- A run is `UNPAID` or `PAID`, and payment is per run. A payslip has no status and is read-only forever.
- An unpaid run can be deleted. That deletes its payslips and nothing else: every entry it sealed keeps its row and its `payroll_run_id` goes to null, and the balance returns to where it stood through inverse ledger entries. A paid run is locked.
- Attendance stays as recorded. Pay with no attendance behind it is flagged, never invented.

### Simplicity

- Thin and light. Delete before adding, and prefer the existing mechanism.
- Payroll is simple computation: a run of about 80 people stays under 2 s of CPU, on the fewest database round trips.
- A run reads once, at admit: everything its window needs, in one request, before any payslip. Each payslip is then one linear computation that reads nothing and evaluates nothing twice.
- Consumed entries are sealed in one write: leave, claim, adhoc, roster and loan repayment entries. A repayment is sealed, not its loan.
- Effects work in bulk: one read per batch and one write per effect.
- Seed expressions are read by customers. They carry statute citations, never working notes.

## 1. Ownership

Every fact has one owner. A value is read from its owner; it is not copied into a second model or JSON bag.

| Owner                               | Owns                                                                                                          | Does not own                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `jurisdiction_settings`             | Sealed legal definitions, statutory schemes, statutory conversion constants, rounding                         | Employer operating hours, agreed pay |
| `entity`, `entity_profile_version`  | Legal identity, registrations, payment schedule, non-working weekdays, disbursement, time zone                | Employee pay terms                   |
| `employee_contract`                 | Agreed rate and its unit, normal hours per day, normal hours and days per week, agreed allowances, exit terms | Statutory law                        |
| Catalogue definitions               | Eligibility, conversion, target subtotal, party, direction, lookup                                            | Employee-specific amounts            |
| Catalogue entries                   | Dated employee activity and its evidence                                                                      | Pay calculation results              |
| `ledger_entry` + `employee_balance` | Posted movements and their cumulative projection                                                              | Calculation inputs                   |
| `payroll_run` + `payslip`           | Run state, coverage, source capture, per-employee totals                                                      | Line-level or checkpoint copies      |

### Ordinary hours and statutory conversion

Ordinary hours are employment terms: `employee_contract.terms.normal_hours_per_day`, `normal_hours_per_week` and `normal_days_per_week`, with the employer's `payment_schedule.non_working_weekdays` defining the working week.

Every jurisdiction's `lookup` holds two conversions, and only these two:

- `day_rate`: an expression for one day's pay. Malaysia's is monthly wages ÷ 26 (EA s.60I). An hour is always the day ÷ normal hours.
- `proration_basis`: how a salary shrinks for a part period. `CALENDAR_DAYS` or `WORKING_DAYS`, whichever the statute names.

Every payroll expression reads `ctx.day_rate`, so a jurisdiction prices overtime, leave and deductions from one figure. A statute with its own formula for one purpose, such as Singapore's hourly overtime rate, keeps it on that row.

Rounding is the same kind of constant: `lookup.rounding` (`HALF_UP`, `HALF_EVEN`, `UP`, `DOWN`, `TRUNCATE`) and `lookup.rounding_scale` (integer 0–12), defaulting to `HALF_UP` at 2.

## 2. One ledger, two writers

```text
EVENT TIME (approval)                          PAYROLL TIME (run)
leave · claim · adhoc · loan repayment         sealed settings + approved entries
        │                                              │
        ▼                                              ▼
deducts balance now                          computes pay + statutory + YTD
        │                                              │
        └──────────────────────┬───────────────────────┘
                               ▼
             ledger_entry (append-only) + employee_balance.account
```

Event time writes the employee balance immediately; payroll time writes money and statutory movements. Neither writer repeats the other's movement.

| Event                   | Operation                                         |
| ----------------------- | ------------------------------------------------- |
| leave approved          | `DEDUCT leave.<catalog code> <half-days>`         |
| claim approved          | `DEDUCT claim.<catalog code> <quantity or money>` |
| adhoc approved          | `DEDUCT adhoc.<catalog code> <quantity or money>` |
| loan approved           | `CREATE loan.<loan entry id> <principal>`         |
| loan repayment approved | `DEDUCT loan.<loan entry id> <amount>`            |
| reversal                | inverse operation with `is_reversal`              |

Creating an entry posts it: once access control has approved the write, the model's `created` effect posts ledger rows and updates the balance projection. A reversal uses the recorded original amount, never today's rates.

## 3. Payroll chain

### 3.1 Intake

A run is created through `payroll_run.create`; its `transform` is the calculation entry point and produces the run's payslip children. It reads one sealed settings version, its `subtotal` chain, catalogues, statutory schemes, registered rules and registered effects; the employee profile and balance map; the contract and the entity profile version covering the period; approved period entries; the balance holds everything a formula needs from earlier runs.

A captured source is immutable until the run releases it, even when the run is unpaid; deleting a payslip never releases it.

### 3.2 First subtotal — base pay

The first subtotal has `previous_id = null`. With no `calculation`, it is the default base pay from contract terms; a `calculation` reads that figure as `ctx.base_pay`:

- `MONTHLY`: the agreed monthly salary.
- `DAILY`: daily rate × ordinary working days in the salary coverage.
- `HOURLY`: hourly rate × ordinary hours in the salary coverage.
- `PIECE`: configured in `subtotal.calculation`, because it needs the period's evidenced output.

Joiners, leavers, unpaid leave and `ABS` days all pass through one rule, the share of the period paid. A salary follows `proration_basis`; a day or hour rate pays the working days. On `WORKING_DAYS` the share is the person's own working days from their shift pattern. On `CALENDAR_DAYS` it is calendar days, and a rest day falling between two missed work days counts as missed. Each `UNPAID` leave slot removes half of one day and a reversal restores it. Paid leave creates no cash line.

An allowance with `lookup.prorate` takes the same share.

There is no base-pay producer model and no implicit BASE stage. Base pay is readable by every payroll expression.

### 3.3 Later subtotals

Each later subtotal's value is the previous subtotal plus every employee line whose `subtotal_id` points at it. Producers:

| Producer              | Payroll line                     | Balance effect at payroll                |
| --------------------- | -------------------------------- | ---------------------------------------- |
| allowance             | cash, `party` from the catalogue | none                                     |
| overtime              | cash, `party` from the catalogue | none                                     |
| leave encashment      | cash from `conversion`           | none; approval already deducted the days |
| leave taken, `PAID`   | none                             | none                                     |
| leave taken, `UNPAID` | none; prorates base pay          | none                                     |
| claim                 | reimbursement                    | none; approval already deducted          |
| adhoc                 | cash `ADD` or `DEDUCT`           | none; approval already deducted          |
| loan repayment        | recovery                         | none; approval already deducted          |
| statutory scheme      | employee and employer amounts    | ledger at finalisation                   |

`party EMPLOYEE` enters the running subtotal and net. `party EMPLOYER` is employer cost and never enters net.

A catalogue whose definition creates no payroll line has a null `subtotal_id` — a taken-leave catalogue, for example. An interruption or workplace-case catalogue that never affects payroll likewise leaves it null.

`off_cycle_eligible` filters optional producers: an `OFF_CYCLE` run includes only catalogues that opt in. Statutory schemes always apply.

### 3.4 Statutory

Schemes evaluate in topological `depends_on` order and see only earlier finalised schemes; a cycle is refused. Each scheme evaluates `eligibility`, `employee_amount` and an optional `employer_amount`.

An employee amount on a payslip is never negative. A tax row that finds the year overpaid reports the figure, and the `TAX_REFUND` registered effect raises a reversal entry on the jurisdiction's `STATUTORY_ADJUSTMENT` item. The next run, or an off-cycle run, pays it.

### 3.5 Creation is finalisation

Creating a run computes and writes everything in one payload: payslip totals, ledger rows and an `UNPAID` run. There is no preparing or separate finalise step. Payslips carry: `basic_earnings`, `gross_earnings`, `net_pay`, `total_deductions`, `employer_cost`, and `breakdown`, the checkpoints, lines and statutory amounts as calculated. The run owns `salary_coverage`.

Ledger rows are created inline with the run, and an effect on the run then applies them to the balance. The effect can run twice after a crash; `ytd.LAST_RUN` stops a second posting.

### 3.6 Ledger rows

| Account                  | Code                | Operation             |
| ------------------------ | ------------------- | --------------------- |
| `payroll`                | `NET_PAY`           | `ADD` net pay         |
| `ytd`                    | `<subtotal code>`   | `ADD` the run's value |
| `statutory_contribution` | `<scheme>.employee` | `ADD` employee amount |
| `statutory_contribution` | `<scheme>.employer` | `ADD` employer amount |

A jurisdiction's `lookup.month_balance` lists the subtotal and `<scheme>.<side>` codes its formulas need by month. Those also post to the `month` account as `<pay month>.<code>`, so a formula reads what this month has paid, what last month paid, or a year that runs April to March.

Year to date lives in the balance and nowhere else. A formula that needs earlier runs reads `ctx.balances.ytd` and `ctx.balances.statutory_contribution`; there is no payroll history read.

### 3.7 Closing the year

`ytd` and `statutory_contribution` never run on. The first run of a tax year, or the first run under a new jurisdiction, posts a `DEDUCT` for every code in them, dated by the pay date, and marks the new year. Calculation then starts from an empty year. A new jurisdiction closes the `month` account too, and a month over a year old leaves it by a `DEDUCT` then a `REMOVE`. A same-jurisdiction transfer carries the balance unchanged; the comparison is by jurisdiction code, never by entity ([transfer semantics](transfer-semantics.md)). `jurisdiction_settings.tax_year_start_month` sets the year; the pay date decides which year a run falls in. Leave, claim, adhoc and loan accounts are untouched.

## 4. Balances and ledger

`employee_balance` is one row per employee: `employee_id` (unique) and a JSON `account` map. `ledger_entry` is immutable: `balance_id`, `operation` (`CREATE`, `REMOVE`, `ADD`, `DEDUCT`), `account`, `code`, `amount`, `unit`, `effective_on` and an optional `source_id`.

The map is keyed by account family, then account code:

```json
{
	"leave": { "ANNUAL_LEAVE": 8 },
	"loan": { "<loan entry id>": 5000 },
	"ytd": { "TAX_YEAR": 2026, "GROSS": 12000 },
	"statutory_contribution": { "CPF.employee": 10909.09, "CPF.employer": 9272.73 }
}
```

The projection is rebuildable from `ledger_entry` and is written only by the posting service. A correction appends an inverse or a new movement; it never edits history.

## 5. Catalogue contract

Catalogues live under `jurisdiction_settings/catalog/`.

- `static/` holds configured definitions with no employee rows: `allowance_catalog`, `overtime_catalog`, `statutory_contribution_catalog`.
- `non_static/` holds a definition with an entry subfolder: `leave_catalog`, `claim_catalog`, `adhoc_catalog`, `loan_catalog`, `work_interruption_catalog`, `workplace_case_catalog`.

Every definition carries `code`, `name`, `settings_id`, a flat `lookup`, `references`, `off_cycle_eligible` and an optional `subtotal_id`. Pay-producing definitions add `eligibility`, `conversion`, `incurred_on`, `direction` and `party`. Leave adds `pay_treatment` (`PAID` or `UNPAID`). Statutory adds `kind`, `depends_on`, `employee_amount` and `employer_amount`.

`references` records the research and legal provenance of the definition. Entries never carry a `reference`.

Entries carry `entity_id`, `employment_id`, `catalog_id`, optional `payroll_run_id`, evidence and status. `payroll_run_id` locks the row once a run captures it; the lock is never a payslip. Family fields:

| Entry          | Fields                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------- |
| leave          | `days` — non-empty `{ date, part: AM \| PM }[]`; quantity is `days.length / 2`; `is_reversal` |
| claim          | `quantity`, `unit`, `incurred_on`, `is_reversal`                                              |
| adhoc          | `description`, `quantity`, `unit`, `incurred_on`, `is_reversal`                               |
| loan           | `quantity` (principal), `unit`, `repayment_period`; no reversal flag                          |
| loan repayment | `loan_id`, `amount`, `paid_on`, `payment_reference`, `is_reversal`                            |

There is no `quantity`, `unit` or session object on leave, no advance date/reference or repayment plan on loans, and no principal/interest/fee allocation on repayments.

## 6. Work, calendar and validation

`shift_definition` declares one day variant: day type (`WORK`, `REST`, `OFF` or `ABS`), start/end time, next-day rollover, unpaid breaks and optional untimed hours. `shift_pattern` lists them by slot, slot 1 being Monday and slot 7 Sunday. `holiday` and the interruption/case catalogues supply dated source data.

The contract's pattern is the default. A day with no `roster_entry` is a day worked as planned: salary stands and no overtime is paid. `roster_entry` changes a day: `work_date`, `shift_definition_id`, `planned_overtime_intervals` and `actual_worked_intervals`. `ABS` is a day type like `REST`: the person did not come, and it is not leave.

Overtime is paid only from planned intervals. The clock verifies them and never creates them, and no overtime is projected. A person who clocks at least the entity's `overtime_full_award_percent` of the plan is paid the whole plan; below it they are paid the clocked hours inside the plan, rounded down to the half hour.

`registered_rule` validates a target collection: events, declared reads, condition and validation expression, evaluated inside the target model's write transform or delete check. `registered_effect` registers a post-commit expression; the target model's effect queries the registry and applies the records its declared action returns.

```text
write ──► registered_rule (target_collection, events) ──► commit
                                                           │
commit ──► registered_effect (target_collection, events) ──┴──► target_action write
```

## 7. Obligations

`obligation` is a free-form task or reminder raised by an event: `entity_id`, optional employee/employment, `title`, optional `due_on` and `fulfilled_on`, `occurrence_key`, optional evidence and waiver reason, and the state `OPEN → FULFILLED | WAIVED`. It stores no financial fields and posts no ledger movement.

## 8. Expression context

Expressions are deterministic JavaScript function bodies with explicit returns, run by the bounded interpreter. Missing values are unknown, never zero. No database access, ambient clock or undeclared calls.

| Evaluation      | Context                                               |
| --------------- | ----------------------------------------------------- |
| `ctx.subject`   | employee, employment, employer data                   |
| `ctx.entry`     | catalogue entry and its admitted quantity/unit        |
| `ctx.lookup`    | the jurisdiction's global lookup under the row's own  |
| `ctx.balances`  | employee balance account map, including `ytd`         |
| `ctx.base_pay`  | the running checkpoint; default base pay at the first |
| `ctx.day_rate`  | the jurisdiction's day rate for this person           |
| `ctx.subtotals` | completed earlier subtotal results only               |
| `ctx.statutory` | completed earlier statutory results by scheme code    |
| `ctx.work`      | the period's roster days and their priced minutes     |
| `ctx.run`       | payroll frame during a run                            |
| `ctx.reads`     | declared reads for validation and registered effects  |

## 9. Governing constraints

1. The source tree in the [model contract](0002-model-specification.md) is the final model set. Deleted concepts are not reintroduced behind wrappers, aliases or JSON bags.
2. Values are not duplicated: no employment or payroll lock on a roster day, and no payroll history alongside the balance.
3. Statutory evaluation persists only as ledger rows and the payslip.
4. One linear, cycle-free subtotal chain per settings version. No `phase`, `channel`, `order` or implicit stage.
5. A payroll run, never a payslip, owns source capture and row locks.
6. Formula simplification means moving orchestration to the engine, not minifying legal distinctions.

## 10. Migration principle

Replace a jurisdiction's configuration and formulas as a whole. The engine owns balance admission, posting, dependency resolution and rounding; a formula selects its evidenced base and legal values and assesses the amount. Preserve legal distinctions and dated versions. A changed result requires an explained correction, not a silently updated expected value.
