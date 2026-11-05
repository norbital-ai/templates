# HRMS calculation architecture

Status: normative. [The model contract](0002-model-specification.md) defines the models, [the seed contract](0003-jurisdiction-seed-specification.md) the seed replacement and [verification](0004-verification-gates.md) the gates. The source tree is the final authority; these documents describe it and never create a second implementation plan.

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

A jurisdiction may prescribe conversion divisors used by its statutory formulas — Malaysia's ordinary rate of pay is monthly wages ÷ 26, and its hourly rate is that daily rate ÷ normal hours. Those constants live in the jurisdiction or catalogue `lookup` and are cited by the formula that needs them. The engine never assumes them: base pay uses the contract and the employer schedule, while statutory pricing uses the formula's own lookup.

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

Approval is atomic: entry `status → APPROVED`, then the model effect posts ledger rows and updates the balance projection. A reversal uses the recorded original amount, never today's rates.

## 3. Payroll chain

### 3.1 Intake

A run is created through `payroll_run.create`; its `transform` is the calculation entry point and produces the run's payslip children. It reads one sealed settings version, its `subtotal` chain, catalogues, statutory schemes, registered rules and registered effects; the employee profile and balance map; the contract and the entity profile version covering the period; approved period entries; prior ledger and payslips for history and YTD.

`payroll_run.source_manifest` records the captured source references and hashes. A captured source is immutable until the run releases it, even when the run is unpaid; deleting a payslip never releases it.

### 3.2 First subtotal — base pay

The first subtotal has `previous_id = null`. Its `calculation` computes base pay from contract terms:

- `MONTHLY`: the agreed monthly salary.
- `DAILY`: daily rate × ordinary working days in the salary coverage.
- `HOURLY`: hourly rate × ordinary hours in the salary coverage.
- `PIECE`: configured in `subtotal.calculation`, because it needs the period's evidenced output.

Unpaid leave prorates the result by half-days: ordinary working days are counted in the salary coverage from the employer's `non_working_weekdays`; each `UNPAID` leave slot removes half of one day. A reversal restores it. Paid leave creates no cash line.

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

Schemes evaluate in topological `depends_on` order and see only earlier finalised schemes; a cycle is refused. Each scheme evaluates `eligibility`, `employee_amount` and an optional `employer_amount`. Evaluation is transient; nothing stores a per-run scheme result.

### 3.5 Creation is finalisation

Creating a run computes and writes everything in one payload: payslip totals, ledger rows and the `FINALISED` run state. There is no preparing or separate finalise step. Payslips carry: `basic_earnings`, `gross_earnings`, `net_pay`, `total_deductions`, `employer_cost`. The run owns `salary_coverage`.

Ledger rows are created inline with the run. The payslip stores no `pay_lines`, `subtotal_results` or `statutory_results`. Those are recomputed from the subtotal chain, catalogue entries and ledger, so a second copy would only drift.

### 3.6 Ledger rows

| Account                  | Code                | Operation             |
| ------------------------ | ------------------- | --------------------- |
| `payroll`                | `NET_PAY`           | `ADD` net pay         |
| `statutory_contribution` | `<scheme>.employee` | `ADD` employee amount |
| `statutory_contribution` | `<scheme>.employer` | `ADD` employer amount |

YTD is the sum of period ledger entries per scheme and side. There is no `_YTD` ledger row and no payslip copy of current statutory amounts.

## 4. Balances and ledger

`employee_balance` is one row per employee: `employee_id` (unique), `entity_id`, and a JSON `account` map. `ledger_entry` is immutable: `balance_id`, `operation` (`CREATE`, `REMOVE`, `ADD`, `DEDUCT`), `account`, `code`, `amount`, `unit`, `effective_on` and an optional `source_id`.

The map is keyed by account family, then account code:

```json
{
	"leave": { "ANNUAL_LEAVE": 8 },
	"loan": { "<loan entry id>": 5000 },
	"statutory_contribution": { "CPF": { "employee": 10909.09, "employer": 9272.73 } }
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

`shift_definition` declares one day variant: day type, start/end time, next-day rollover, unpaid breaks and optional untimed hours. `shift_pattern` groups variants; `holiday` and the interruption/case catalogues supply dated source data.

`roster` is one schedule per employment, holding `employment_id`, optional `pattern_id` and the payroll-run lock. `roster_entry` owns the days: `roster_id`, `work_date`, optional `shift_definition_id`, `planned_overtime_intervals` and `actual_worked_intervals`. Overtime is employer-mandated; the day stores no consent or requestor field.

Employment and the payroll lock are stored once, on the parent roster. Entry create, update and delete read the parent and refuse when its `payroll_run_id` is set.

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

| Evaluation      | Context                                              |
| --------------- | ---------------------------------------------------- |
| `ctx.subject`   | employee, employment, employer data                  |
| `ctx.entry`     | catalogue entry and its admitted quantity/unit       |
| `ctx.lookup`    | the current definition's flat lookup                 |
| `ctx.balances`  | employee balance account map                         |
| `ctx.base`      | base-pay checkpoint value                            |
| `ctx.subtotals` | completed earlier subtotal results only              |
| `ctx.statutory` | completed earlier statutory results by scheme code   |
| `ctx.history`   | prior ledger and payslips for YTD                    |
| `ctx.run`       | payroll frame during a run                           |
| `ctx.reads`     | declared reads for validation and registered effects |

## 9. Governing constraints

1. The source tree in the [model contract](0002-model-specification.md) is the final model set. Deleted concepts are not reintroduced behind wrappers, aliases or JSON bags.
2. Values are not duplicated: no per-run pay lines, checkpoint lists or statutory lists on a payslip; no employment or payroll lock on a roster day; no current amount on a balance.
3. Statutory evaluation is transient; its only persistent effects are ledger rows and payslip totals.
4. One linear, cycle-free subtotal chain per settings version. No `phase`, `channel`, `order` or implicit stage.
5. A payroll run, never a payslip, owns source capture and row locks.
6. Formula simplification means moving orchestration to the engine, not minifying legal distinctions.

## 10. Migration principle

Replace a jurisdiction's configuration and formulas as a whole. The engine owns history scoping, balance admission, posting, dependency resolution and rounding; a formula selects its evidenced base and legal values and assesses the amount. Preserve legal distinctions and dated versions. A changed result requires an explained correction, not a silently updated expected value.
