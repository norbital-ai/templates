# HRMS calculation architecture

[How this HRMS works](0000-hrms-principles.md) is the plain-language version, for HR professionals.

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
- A **reversal entry** (`is_reversal`) reverses a mistake: a new entry against the same catalog item, created only by the HR controller from the Events tab. Nothing raises one automatically. Leave, claim, adhoc and loan repayment entries all carry it. Nothing posted is edited or deleted. Its ledger movement is the inverse, and its pay line flips direction.
- A refund or correction is a reversal entry or an adjustment entry against a catalog item, and nothing else. No payslip line and no ledger amount is negative. A refund gets no statutory row, no account of its own and no ledger trick.
- A company's own policy goes on the existing row, through `pay_treatment` or a cash `conversion`.

### Ledger and balance

- Ledger entries are emitted at four moments only: when a leave, claim, adhoc or loan entry is created, during payroll, when a leave entitlement changes, and when the HR controller confirms a workplace case that opens leave. None repeats another's movement.
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
- `pay_date` is the day the schedule pays, and the calculation reads it. The pay date people see is the moment the run moved to `PAID`: a paid run is locked, so that is its last write. It shows only then and is never typed.
- A run is `UNPAID` or `PAID`, and payment is per run. A payslip has no status and is read-only forever.
- An unpaid run can be deleted. That deletes its payslips and nothing else: every entry it sealed keeps its row and its `payroll_run_id` goes to null, and the balance returns to where it stood through inverse ledger entries. A paid run is locked.
- Year-to-date only moves forward. A run a later run counted cannot be deleted, for anyone paid in both, so runs come off newest first; and a skipped on-cycle period cannot run behind a later one.
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

## 2. One ledger, four writers

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

Event time writes the employee balance immediately; payroll time writes money and statutory movements; a leave entitlement change writes its diff (section 4.1). No writer repeats another's movement.

| Event                   | Operation                                         |
| ----------------------- | ------------------------------------------------- |
| leave approved          | `DEDUCT leave.<catalog code> <half-days>`         |
| claim approved          | `DEDUCT claim.<catalog code> <quantity or money>` |
| adhoc approved          | `DEDUCT adhoc.<catalog code> <quantity or money>` |
| loan approved           | `CREATE loan.<loan entry id> <principal>`         |
| loan repayment approved | `DEDUCT loan.<loan entry id> <amount>`            |
| reversal                | inverse operation with `is_reversal`              |
| leave entitlement moves | `ADD` or `DEDUCT leave.<catalog code> <diff>`     |
| leave case confirmed    | `ADD` or `DEDUCT leave.<catalog code> <days>`     |
| benefit run marked paid | `ADD` or `DEDUCT benefit_paid.<month>.<code>`     |

Indonesia's severance and pension benefits run on one ladder across two calendar years, longer than a balance keeps its months, so a catalog effect keeps them in `benefit_paid` when the run is marked paid. A paid run is final, so nothing there ever needs undoing. An earlier run not marked paid yet still counts, from the months the balance keeps. Japan's premiums paid back or collected late go on their own items, on a subtotal of their own that the year-end adjustment reads, so the deduction is what the employee bore.

Run effects look for their own task before raising it: raising one twice would fail every effect after it, so a second run in a period finds the first's task and raises nothing.

A run effect reads only its own task: its exact key where the key is known up front, or the tasks at its own level, entity or person. A read covering every task of the entity would change whenever anything raised one, and the write after it would fail, so a contract sealing beside a run could cost that run its reminders. A run cannot be marked paid until every payslip's balance has it.

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

An allowance row with `prorate` on takes the same share. A fixed recurring cash allowance prorates; a claim, overtime, a bonus, a benefit in kind, an attendance bonus, a per-event payment and an allowance tied to the person rather than to the days do not.

A leave row that must pay back after its period has run is `PAID` with `direction: DEDUCT` and a `conversion`, so its line takes the days instead of the salary basis. Every no-pay row in every jurisdiction has this shape: its line is the monthly pay (salary and the allowances with `prorate` on) ÷ the `proration_basis` days × the days missed, so a month pays what the salary basis would have paid. A correction after payment is then a reversal entry the HR controller enters in Events, on the same catalog item, dated in the next period to run. Its conversion prices it on the month before that run, so it gives back what was taken. The `NO_PAY_OPEN_PERIOD` rule refuses a no-pay entry dated in a period that has run, and a reversal of a day not yet paid: that entry is deleted instead.

A no-pay row carries `lookup.no_cap`. No statute caps it, so its account opens large enough never to refuse, and the days taken still post to it. See section 4.1.

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

An employee amount on a payslip is never negative. A tax row that finds the year overpaid reports the figure, and the `TAX_REFUND` registered effect raises an obligation. The HR controller enters the amount on the adhoc `STATUTORY_REFUND` item, and the next run, or an off-cycle run, pays it. A statutory correction is an adhoc entry whose item is the correction, so it takes no `is_reversal`; its direction and subtotal are set on the catalog row like any other.

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

A wrong payment corrects itself through later cycles, with no automatic entry. HR corrects the pay, and the next run's statutory rows count the total paid: a row with a band, ceiling or threshold computes on the pay month's total and charges the difference from what the month has charged. Below zero on the employee side, the row reports `overpaid` and pays no negative line. The employer side stops at zero. A row on a base fixed for a period does not move with the month's pay, and a cumulative tax settles itself.

Singapore's AW ceiling works the same way across the year. `CPF_AW` records the additional wages that attracted CPF, and the ceiling counts each month's OW at that month's ceiling, so a raise past the ceiling stops counting the excess. The last month of the year or of the employment settles on the actual OW: AW the estimate left out attracts CPF, and an excess comes off that month's CPF.

A jurisdiction's `lookup.month_balance` lists the subtotal and `<scheme>.<side>` codes its formulas need by month. Those also post to the `month` account as `<pay month>.<code>`, so a formula reads what this month has paid, what last month paid, or a year that runs April to March.

Where a statute fixes an amount on the month's total, a month's runs are one month: the formula reads what earlier runs of the month paid and charges the rest, so a bonus owes the same inside the on-cycle run or off-cycle, before or after it. Contributions follow the wage month, so a whole-month salary already in the pay month is another wage month's or another employer's and the run stands alone; tax follows the pay month and combines them. An off-cycle run in a transfer month reads both companies' month, so a bonus that month goes on-cycle, where each company stands alone. A scheme charged on salary alone charges nothing on an off-cycle run. A tax that projects the year stands an off-cycle run on the salary to come, and withholds only what the run adds.

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

### 4.1 Leave entitlement

Everyone's leave is computed by default from the catalog row. The balance is never recalculated from scratch: it moves by the difference between the entitlement last applied and the new one, so days already taken stay taken.

```text
entitlement = catalog row + the person     what they should have
applied     = last entitlement on the balance sheet
balance     = applied − days taken         what is left
```

The row's `lookup` holds the figure: `grant_days`, or `service_bands` by completed months of service, for its `window`. Eligibility, part-time bands, a first-year share by completed months and carry-forward come from the same lookup. A row with `no_cap`, or with no figure, has no cap to hold.

The `leave_entitlement` automation does this for everyone, and `src/lib/leave/entitlement.ts` holds the rule. It computes when any of these happens:

One service, scoped by what it is given:

```text
WHEN                     CALLED BY              INPUT        WHO        WHAT MOVES
───────────────────────  ─────────────────────  ───────────  ─────────  ─────────────────────────
A contract is created    contract effect        employees    them       new − 0
or changes                                                              new − applied
HR runs it               employee profile       employees    them       whatever is due
A catalog change         sealed version effect  none         everyone   new − applied
A run marked paid        run effect             none         everyone   a service band
1 January                yearly cron            none         everyone   a new window: reset, carry
```

It is idempotent. Each run compares what is owed with what was applied and writes only the difference, so a run with nothing to do writes nothing, and a repeat changes nothing. A person's movements and their balance commit together, and a lost race reads again, so what already landed is never repeated.

```text
  newcomer, or catalog change
              │
              ▼
  compute new entitlement from the catalog row
              │
              ▼
       diff = new − applied
              │
     ┌────────┼────────┐
     ▼        ▼        ▼
   diff=0   diff>0   diff<0
   nothing  ledger   ledger
            ADD      DEDUCT
              │        │
              └───┬────┘
                  ▼
     balance moves by diff
     applied = new
```

```text
EVENT                         APPLIED   DIFF   TAKEN   BALANCE
───────────────────────────   ───────   ────   ─────   ───────
Joins, entitled to 14            14     +14      0       14
Takes 3 days                     14       –      3       11
Catalog raises it to 18          18      +4      3       15
Catalog lowers it to 16          16      −2      3       13
```

A new sealed version is the catalog change. In force now, its diff applies straight away; dated later, it applies on the day it starts. A cut stops the balance at zero: days already taken are never clawed back.

A new window starts the balance again rather than moving it by a diff, because days used come back. A calendar year turns on 1 January, a service year on the anniversary, picked up by the first paid run on or after it. An `EVENT` row has no window: nothing gives or takes its days but a confirmed case (section 4.2).

```text
NEW WINDOW, RULE ON THE ROW        NEXT BALANCE
─────────────────────────────────  ───────────────────────────────────────
no carry                           new entitlement; unused days lapse
carry: { windows: 1 }              new + the smaller of held and applied
carry: { windows: 1, max_days: n } as above, the carried part at most n
per_months                         held + new; nothing lapses
```

Carry reaches one window back: taking the smaller of held and applied means days carried last time lapse if they are still unused.

A row can also say:

```text
KEY                                 EFFECT
─────────────────────────────────   ──────────────────────────────────────────────
part_time_pro_rata                  a part-timer takes hours ÷ full_time_weekly_hours
grant_days_by_normal_days_per_week  few weekly days and hours take the statute's table
extra_days                          a class of work or a contract fact adds days
rolling_months                      a window of several years opens once in the span
first_year_proration_days           the first year counts the calendar days left
state_owned_employer                only a state-owned employer's staff qualify
consumes_code                       the entry also draws on that row's account
```

A contract's `annual_leave_carry_limit_days` caps what it carries. A limit that spans rows or years is a registered rule: Singapore's sick and hospitalisation days share 60, and Taiwan's hospitalised days total a year within any two. A write may make 10 reads, so a new check joins an existing rule's reads where it can.

An account opened before this keeps what it holds, and only its window starts counting. `applied` is kept per leave type in the balance's `leave_window` family as `<code>.granted`, beside the window it belongs to. Each movement is a dated ledger entry, like any other.

### 4.2 Events are workplace cases

A birth, a marriage, a bereavement or a long illness is something that happened, and a balance cannot tell one from the next. So each one is a row in `workplace_case_catalog`, and HR records it as a case. A registered effect opens the days. Nothing refills them by the calendar, and no code knows what a birth is.

```text
Employee hands HR the notice or doctor's letter
        |
        v
HR opens a case on the person's Leave tab
  what happened: CHILD_BIRTH
  decision:      Confirmed / Rejected / Decide later
  document:      attached
        |
        +-- Rejected ----> nothing moves
        |
        +-- Decide later -> nothing moves until HR presses Confirm or Reject on the case
        |
        v Confirmed
registered effects LEAVE_CASE_LEDGER and LEAVE_CASE
  read the case's lookup.grants and each leave row's grant_days and eligibility
  post ledger rows and raise the balance, once for this case
```

| Row                             | Holds                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `workplace_case_catalog.lookup` | `grants`: the leave rows it opens, `days` to override, `keep_start`; `certificate`; `ends_on_close` |
| `leave_catalog.lookup`          | `grant_days`, `eligibility`, `pay_steps`                                                            |
| `registered_effect`             | `LEAVE_CASE_LEDGER`, `LEAVE_CASE`, `LEAVE_CASE_ENDED`                                               |
| `registered_rule`               | `LEAVE_CASE_DECISION`: a case names its employee and has its certificate before confirming          |

```text
                              Balance (MATERNITY_LEAVE, Indonesia)
Joined                             0     an event row gives nothing by itself
CHILD_BIRTH confirmed             90     ledger: ADD 90
Takes 31 days                     59
Months pass                       59     nothing refills it
BIRTH_COMPLICATION confirmed     149     ledger: ADD 90, needs the certificate
Next birth, a new case           +90     a second event is a second case
```

A case confirmed in error is reversed like any other entry: **Reverse this case** opens the same case again with `is_reversal`, and the effects take back exactly what it gave. Days already taken must be reversed first, so a balance never goes below what was used, and a case reverses once.

Pay that steps down is one row. `pay_steps` on the leave row says what share each month of the event loses, and the confirmed case stamps when the event began in `leave_window.<code>.from`. The row's `conversion` prices each day by its date from that stamp, so the order days were entered does not move it.

```text
MEDICAL_LEAVE, Indonesia (PP 36/2021 art.41(1))
  no open case                     every day at full pay
  LONG_ILLNESS confirmed 2 Feb     the count starts
    month 1-4    100%
    month 5-8     75%    this line takes the other 25% of each working day
    month 9-12    50%
    month 13+     25%
  case closed (closed_on)          the count ends, the next sick day is at full pay
```

A reversal on such a row gives back the month it corrects, at that month's share. Thirty sick days within 45 with no open case raise a task for the HR controller (`LONG_ILLNESS_REMINDER`), so a missed case cannot quietly overpay.

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

A registered effect on an entry reaches its version through the catalog row the entry was raised on, which the entry's model passes on; sealing an entry into a run is not an edit and fires nothing. A check with a deadline ahead, a permit or a retirement date, sits on `payslip` and runs at every run: nothing wakes a tenant database on a timer, and its `occurrence_key` keeps it to one obligation.

An off-cycle run pays the contracts in its period, so a leaver's goes on the period of their last day, and a run that would seal an entry with no payslip refuses.

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
