# HRMS calculation architecture

[How this HRMS works](0000-hrms-principles.md) is the plain-language version, for HR professionals.

Status: normative. Section 0 is the owner's fixed design. [The model contract](0002-model-specification.md) defines the models, [the seed contract](0003-jurisdiction-seed-specification.md) the seed and [verification](0004-verification-gates.md) the gates. The source tree is the final authority; these documents describe it and never create a second implementation plan.

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
- A **reversal entry** reverses a mistake: a new entry against the same catalog item, linked through `reverses` to the sealed entry it undoes, created only by the HR controller from the Events tab. The link is what makes it a reversal; `is_reversal` follows from it and nothing sets it by hand. Nothing raises one automatically. Leave, claim, adhoc and loan repayment entries all carry it. Nothing posted is edited or deleted. Its ledger movement is the inverse, and its pay line flips direction.
- A correction is a reversal entry or an adjustment entry against a catalog item. A statutory row may refund: where its statute has the employer repay, a result below zero pays a refund line on that run, and the balance falls with it. Where it does not, the row stops at zero and the next run nets it. No payslip line and no ledger amount is negative.
- A company's own policy goes on the existing row, through `pay_treatment` or a cash `conversion`.

### Ledger and balance

- The ledger moves in two ways only: **posting**, when a record is written (a leave, claim or adhoc entry that declares accounts, or a payslip, the run's entry), and **sync**, when an entitlement may have changed (a contract or its facts, an entity, a new law, or a period ending). One service writes it. Loans stay out: a loan and its repayments are their own record. Workplace cases never move a balance.
- The ledger is append-only and an amount is never negative.
- `employee_balance` is one row per person: the projection of the ledger, keyed by family, code, period and measure. It holds accumulated values and entitlements of the catalog, and nothing else: no notes, flags, dates or guards.
- Whatever a formula needs from earlier runs comes from the balance. There is no payroll history read: no `ctx.history`, no statutory history, no looking back through payslips.
- Balances do not run on forever. The period is in the key, so a new year is a new key and nothing closes. Old periods leave through proper dated ledger entries.

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

| Owner                               | Owns                                                                                                                       | Does not own                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `jurisdiction_settings`             | Sealed legal definitions, statutory schemes, statutory conversion constants, rounding                                      | Employer operating hours, agreed pay |
| `entity`, `entity_profile_version`  | Legal identity, registrations, payment schedule, non-working weekdays, disbursement, time zone                             | Employee pay terms                   |
| `employee_contract`                 | Agreed rate and its unit, normal hours per day, normal hours and days per week, agreed allowances, exit terms, dated facts | Statutory law                        |
| `contract_change`                   | A dated change filed ahead of its day                                                                                      | Anything payroll or the ledger reads |
| Catalogue definitions               | Eligibility, conversion, target subtotal, party, direction, lookup                                                         | Employee-specific amounts            |
| Catalogue entries                   | Dated employee activity and its evidence                                                                                   | Pay calculation results              |
| `ledger_entry` + `employee_balance` | Posted movements and their cumulative projection                                                                           | Calculation inputs                   |
| `payroll_run` + `payslip`           | Run state, coverage, source capture, per-employee totals, the breakdown as calculated                                      | Figures a later run reads            |

### Ordinary hours and statutory conversion

Ordinary hours are employment terms: `employee_contract.terms.normal_hours_per_day`, `normal_hours_per_week` and `normal_days_per_week`, with the employer's `payment_schedule.non_working_weekdays` defining the working week.

Every jurisdiction's `lookup` holds two conversions, and only these two:

- `day_rate`: an expression for one day's pay. Malaysia's is monthly wages ÷ 26 (EA s.60I). An hour is always the day ÷ normal hours.
- `proration_basis`: how a salary shrinks for a part period. `CALENDAR_DAYS` or `WORKING_DAYS`, whichever the statute names.

Every payroll expression reads `ctx.day_rate`, so a jurisdiction prices overtime, leave and deductions from one figure. A statute with its own formula for one purpose, such as Singapore's hourly overtime rate, keeps it on that row.

Rounding is the same kind of constant: `lookup.rounding` (`HALF_UP`, `HALF_EVEN`, `UP`, `DOWN`, `TRUNCATE`) and `lookup.rounding_scale` (integer 0–12), defaulting to `HALF_UP` at 2.

## 2. One ledger, two ways in

```text
POSTING                                    SYNC
a record was written                       an entitlement may have changed
leave · claim · adhoc · payslip            contract · entity · new law · a period ended
        │                                          │
        └──────────────────┬───────────────────────┘
                           ▼
                settle(what should stand)
                           │  one write
                           ▼
         ledger_entry (append-only) + employee_balance.account
```

`src/lib/ledger/` is the only writer. Model hooks schedule the `ledger` automation and write nothing, and it runs one at a time under the `payroll_execution` policy, so posting never depends on who made the entry. A source says what it should have posted, and `settle` posts the difference, so repeating any of this posts nothing.

| Source              | Movement                                                                         |
| ------------------- | -------------------------------------------------------------------------------- |
| Leave entry         | `leave/<code>/<period>/used`, per day of its window                              |
| Claim entry         | `claim/<code>/<period>/used`                                                     |
| Adhoc with accounts | What `lookup.accounts` names                                                     |
| Payslip             | `pay/<checkpoint>/<period>/total` and `statutory/<scheme>.<party>/<period>/paid` |
| Entitlement         | `leave/<code>/<period>/entitled`, `carried`                                      |
| Claim limit         | `claim/<code>/<period>/limit`                                                    |

A reversal is its own entry, posted in the period of the entry it `reverses`. It undoes one entry a run has sealed, of the same person and catalog item, once, for no more than that entry held; an entry no run has sealed is deleted instead. Loans stay out: a loan and its repayments are their own record. Workplace cases never move a balance.

Run effects look for their own task before raising it: raising one twice would fail every effect after it, so a second run in a period finds the first's task and raises nothing.

A run effect reads only its own task: its exact key where the key is known up front, or the tasks at its own level, entity or person. A read covering every task of the entity would change whenever anything raised one, and the write after it would fail, so a contract sealing beside a run could cost that run its reminders. A run cannot be marked paid until every payslip's balance has it.

Creating an entry posts it: once access control has approved the write, the model's `created` effect schedules the `ledger` automation, which posts the ledger rows and moves the balance in one write. A claim reversal gives back no more than its original drew.

## 3. Payroll chain

### 3.1 Intake

A run is created through `payroll_run.create`; its `transform` is the calculation entry point and produces the run's payslip children. It reads one sealed settings version, its `subtotal` chain, catalogues, statutory schemes and registered rules; the employee profile and balance map; the contract and the entity profile version covering the period; the period's entries. The balance holds everything a formula needs from earlier runs.

A captured source is immutable until the run releases it, even when the run is unpaid. Only deleting the run releases it.

### 3.2 First subtotal — base pay

The first subtotal has `previous_id = null`. With no `calculation`, it is the default base pay from contract terms; a `calculation` reads that figure as `ctx.base_pay`:

- `MONTHLY`: the agreed monthly salary.
- `DAILY`: daily rate × ordinary working days in the salary coverage.
- `HOURLY`: hourly rate × ordinary hours in the salary coverage.
- `PIECE`: configured in `subtotal.calculation`, because it needs the period's evidenced output.

Joiners, leavers, unpaid leave and `ABS` days all pass through one rule, the share of the period paid. A salary follows `proration_basis`; a day or hour rate pays the working days. On `WORKING_DAYS` the share is the person's own working days from their shift pattern. On `CALENDAR_DAYS` it is calendar days, and a rest day falling between two missed work days counts as missed. Each `UNPAID` leave slot removes half of one day and a reversal restores it. Paid leave creates no cash line.

An allowance row with `prorate` on takes the same share. A fixed recurring cash allowance prorates; a claim, overtime, a bonus, a benefit in kind, an attendance bonus, a per-event payment and an allowance tied to the person rather than to the days do not.

A leave row that must pay back after its period has run is `PAID` with `direction: DEDUCT` and a `conversion`, so its line takes the days instead of the salary basis. Every no-pay row in every jurisdiction has this shape: its line is the monthly pay (salary and the allowances with `prorate` on) ÷ the `proration_basis` days × the days missed, so a month pays what the salary basis would have paid. A correction after payment is then a reversal entry the HR controller enters in Events, on the same catalog item, dated in the next period to run. Its conversion prices it on the month before that run, so it gives back what was taken. The `NO_PAY_OPEN_PERIOD` rule refuses a no-pay entry dated in a period that has run, and a reversal of a day not yet paid: that entry is deleted instead.

A no-pay row carries `lookup.no_cap`. No statute caps it, so it has no entitlement and nothing limits it. The days taken still post to `used`. See section 4.1.

There is no base-pay producer model and no implicit BASE stage. Base pay is readable by every payroll expression.

### 3.3 Later subtotals

Each later subtotal's value is the previous subtotal plus every employee line whose `subtotal_id` points at it. Producers:

| Producer              | Payroll line                          | Ledger                                            |
| --------------------- | ------------------------------------- | ------------------------------------------------- |
| allowance             | cash, `party` from the catalogue      | none                                              |
| overtime              | cash, `party` from the catalogue      | none                                              |
| leave encashment      | cash from `conversion`                | the entry posted its days when it was created     |
| leave taken, `PAID`   | none, or a `DEDUCT` from `conversion` | the entry posted its days when it was created     |
| leave taken, `UNPAID` | none; prorates base pay               | the entry posted its days when it was created     |
| claim                 | reimbursement                         | the entry posted when it was created              |
| adhoc                 | cash `ADD` or `DEDUCT`                | posted when created, if the row declares accounts |
| loan repayment        | recovery                              | none; loans stay out of the ledger                |
| statutory scheme      | employee and employer amounts         | posted from the payslip                           |

`party EMPLOYEE` enters the running subtotal and net. `party EMPLOYER` is employer cost and never enters net.

A catalogue whose definition creates no payroll line has a null `subtotal_id` — a taken-leave catalogue, for example. Interruption and workplace-case catalogues leave it null: the engine prices neither, and a run only seals their entries.

`off_cycle_eligible` filters optional producers: an `OFF_CYCLE` run includes only catalogues that opt in. Statutory schemes always apply.

### 3.4 Statutory

Schemes evaluate in topological `depends_on` order and see only earlier finalised schemes; a cycle is refused. Each scheme evaluates `eligibility`, `employee_amount` and an optional `employer_amount`.

A row's result decides what happens. Above zero it is a deduction. Below zero, a row with `lookup.below_zero: 'REFUND'` pays a refund line on that run and the statutory balance falls with it, because its statute has the employer repay. Any other row stops at zero, and the next run nets what is left. No line and no ledger amount is ever negative.

### 3.5 Creation is finalisation

Creating a run computes and writes one payload: payslip totals and an `UNPAID` run. There is no preparing or separate finalise step. Payslips carry `basic_earnings`, `gross_earnings`, `net_pay`, `total_deductions`, `employer_cost`, `ordinary_wages`, `additional_wages`, `employee_statutory`, `employer_statutory`, `tax_withheld` and `breakdown`, the checkpoints, lines and statutory amounts as calculated. The run owns `salary_coverage`.

The payslip is the run's entry. `payroll_run.create` writes no ledger row: the `ledger` automation posts its checkpoints and statutory rows afterwards, once, in the period of its pay date, in one write with the balance. Run effects therefore read payslips, not ledger rows. A new run is refused while the entity's latest run has not posted, and PAID is refused while the run itself has not. A deleted run's movements are inverted exactly.

### 3.6 Ledger rows

| Account     | Code                | Measure | Posts                                           |
| ----------- | ------------------- | ------- | ----------------------------------------------- |
| `pay`       | `<subtotal code>`   | `total` | `ADD` the checkpoint's value, when above zero   |
| `statutory` | `<scheme>.employee` | `paid`  | The employee amount; a refund posts as `DEDUCT` |
| `statutory` | `<scheme>.employer` | `paid`  | The employer amount                             |

Each posts to the tax year's period, and also to the month's where `lookup.month_balance` names the code.

A wrong payment corrects itself through later cycles, with no automatic entry. HR corrects the pay, and the next run's statutory rows count the total paid: a row with a band, ceiling or threshold computes on the pay month's total and charges the difference from what the month has charged. Below zero on the employee side, a row with `lookup.below_zero: 'REFUND'` pays a refund line and any other row stops at zero; neither pays a negative line. The employer side stops at zero. A row on a base fixed for a period does not move with the month's pay, and a cumulative tax settles itself.

Singapore's AW ceiling works the same way across the year. `CPF_AW` records the additional wages that attracted CPF, and the ceiling counts each month's OW at that month's ceiling, so a raise past the ceiling stops counting the excess. The last month of the year or of the employment settles on the actual OW: AW the estimate left out attracts CPF, and an excess comes off that month's CPF.

A jurisdiction's `lookup.month_balance` lists the subtotal and `<scheme>.<side>` codes its formulas need by month. Those also post to the month's period, and `ctx.balances.month` holds them as `<pay month>.<code>`, so a formula reads what this month has paid, what last month paid, or a year that runs April to March.

Where a statute fixes an amount on the month's total, a month's runs are one month: the formula reads what earlier runs of the month paid and charges the rest, so a bonus owes the same inside the on-cycle run or off-cycle, before or after it. Contributions follow the wage month, so a whole-month salary already in the pay month is another wage month's or another employer's and the run stands alone; tax follows the pay month and combines them. An off-cycle run in a transfer month reads both companies' month, so a bonus that month goes on-cycle, where each company stands alone. A scheme charged on salary alone charges nothing on an off-cycle run. A tax that projects the year stands an off-cycle run on the salary to come, and withholds only what the run adds.

Year to date lives in the balance and nowhere else. A formula that needs earlier runs reads `ctx.balances.ytd`, `ctx.balances.statutory_contribution`, `ctx.balances.month` or `ctx.balances.years`; there is no payroll history read.

### 3.7 The tax year

The year is in the key, so nothing closes it. `ctx.balances.ytd` and `ctx.balances.statutory_contribution` hold the totals of the tax year the pay date falls in, so the first run of a new year reads an empty year. `jurisdiction_settings.tax_year_start_month` sets the year; the pay date decides which year a run falls in. A new jurisdiction is a new scope in the key and reads empty too, as does a new employer where `lookup.totals_by_employer` is set. A same-jurisdiction transfer keeps its keys; the comparison is by jurisdiction code, never by entity ([transfer semantics](transfer-semantics.md)). Sync takes old periods off the balance through dated movements: a month over a year old, and a year or service window that began more than three years back. The ledger keeps them.

## 4. Balances and ledger

`employee_balance` is one row per employee: `employee_id` (unique) and a JSON `account` map. `ledger_entry` is immutable: `balance_id`, `operation` (`CREATE`, `REMOVE`, `ADD`, `DEDUCT`), `account`, `code`, `period`, `measure`, `amount`, `unit`, `effective_on` and `source`.

The map is keyed by family, code, period and measure:

```json
{
	"leave": { "ANNUAL_LEAVE": { "MY.S.2026-03-05": { "entitled": 14, "carried": 3, "used": 6 } } },
	"claim": { "MEDICAL_CLAIM": { "MY.Y.2026-01-01": { "limit": 576, "used": 400 } } },
	"pay": { "GROSS": { "MY.Y.2026-01-01": { "total": 12000 } } },
	"statutory": { "EPF.employee": { "MY.Y.2026-01-01": { "paid": 1320 } } }
}
```

The projection is rebuildable from `ledger_entry` and is written only by the ledger service. A correction appends an inverse or a new movement; it never edits history.

A movement and the balance it moves commit as one write, so they cannot disagree. No effect touches the ledger or the balance. `source` is plain text, so a movement outlives what caused it, and a deleted record's movements are still found and inverted.

An effect can run again after a crash, and `settle` compares with the ledger, so a repeat posts nothing. Two writers cannot lose an update: the write is guarded by the balance's revision.

### 4.1 Leave entitlement

Everyone's leave is computed by default from the catalog row. The balance is never recalculated from scratch: it moves by the difference between the entitlement last applied and the new one, so days already taken stay taken.

```text
entitled = catalog row + the person     what they should have this window
carried  = from the window before
left     = entitled + carried − used    derived, never stored
```

The row's `lookup` holds the figure: `grant_days`, or `service_bands` by completed months of service, for its `window`. Eligibility, part-time bands, a first-year share by completed months and carry-forward come from the same lookup. A row with `no_cap`, or with no figure, has no cap to hold.

The `ledger` automation computes this, and `src/lib/ledger/entitlement.ts` holds the rule. One service, scoped by what it is given:

```text
WHEN                     CALLED BY              INPUT        WHO        WHAT MOVES
───────────────────────  ─────────────────────  ───────────  ─────────  ─────────────────────────
A contract is created    contract effect        employees    them       new − 0
or seals                                                                new − applied
HR runs it               employee profile       employees    them       whatever is due
A catalog change         sealed version effect  none         everyone   new − applied
An employer version      sealed version effect  none         everyone   new − applied
seals
A run marked paid        run effect             none         everyone   a service band
A window's first day     the automation itself  none         everyone   a new window: reset, carry
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

A new window starts the balance again rather than moving it by a diff, because days used come back. A calendar year turns on 1 January and a service year on its anniversary: each full sync schedules itself for the next day anyone's window turns, and the first paid run on or after that day picks it up too. A row opened by a fact has no window: only a fact on the contract gives or takes its days (section 4.2).

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
accounts                            the entry draws on another row's account instead
```

A contract's `annual_leave_carry_limit_days` caps what it carries. A limit that spans rows or years is a registered rule: Singapore's sick and hospitalisation days share 60, and Taiwan's hospitalised days total a year within any two. A write may make 10 reads, so a new check joins an existing rule's reads where it can.

Each window is its own key, so nothing closes or resets. A balance seeded before a sync opens with its entitlement under the sync's own source, so sync finds it posted.

### 4.2 Dated facts open leave

A birth, a marriage, a bereavement or a long illness is a fact about a person, so it lives on the sealed contract, in `employee_extension_data.events`. Each country's `employee_extension_schema` declares the kinds. Documents are uploaded on the employee profile, by HR or the employee.

```text
HR adds to the contract: CHILD_BIRTH, 2 March, and seals it
        |
Sealing triggers sync
        |
Each leave row whose lookup.opened_by names CHILD_BIRTH opens for that event
        |
ADD leave/MATERNITY_LEAVE/MY.E.2026-03-02/entitled 98
```

| Row                    | Holds                                                        |
| ---------------------- | ------------------------------------------------------------ |
| Contract               | `events`: `kind`, `on`, `opened_on`, `ended_on`, `document`  |
| `leave_catalog.lookup` | `opened_by`: the kinds that open it, with `days` to override |
| `leave_catalog.lookup` | `grant_days`, `eligibility`, `pay_steps`                     |

A change known ahead of its day is filed as a `contract_change`. Nothing reads it until the `contract_materialize` automation seals it into a new version on that day.

Each event is its own period, so days left from one birth do not stack onto the next. A complication is another event on the same date, so it adds to the same period and keeps its pay count.

Pay that steps down is one row. `pay_steps` on the leave row says what share each month of the event loses, and its `conversion` reads the event from the contract.

```text
MEDICAL_LEAVE, Indonesia (PP 36/2021 art.41(1))
  no event covers the day          full pay
  LONG_ILLNESS from 2 Feb          the count starts
    month 1-4    100%
    month 5-8     75%    this line takes the other 25% of each working day
    month 9-12    50%
    month 13+     25%
  event ended                      the next sick day is at full pay
```

Workplace cases file incidents, requests and notices. If one changes pay, HR makes the entry.

## 5. Catalogue contract

Catalogues live under `jurisdiction_settings/catalog/`.

- `static/` holds configured definitions with no employee rows: `allowance_catalog`, `overtime_catalog`, `statutory_contribution_catalog`.
- `non_static/` holds a definition with an entry subfolder: `leave_catalog`, `claim_catalog`, `adhoc_catalog`, `loan_catalog`, `work_interruption_catalog`, `workplace_case_catalog`.

Every definition carries `code`, `name`, `settings_id`, a `lookup`, `references`, `off_cycle_eligible` and an optional `subtotal_id`. Pay-producing definitions add `eligibility`, `conversion`, `incurred_on`, `direction` and `party`. Leave adds `pay_treatment` (`PAID` or `UNPAID`). Statutory adds `kind`, `depends_on`, `employee_amount`, `employer_amount` and an optional `employer_cost_subtotal_id`.

`references` records the research and legal provenance of the definition. Entries never carry a `reference`.

Leave, claim, adhoc and loan entries carry `entity_id`, `employment_id`, `catalog_id`, optional `payroll_run_id` and evidence. `payroll_run_id` locks the row once a run captures it; the lock is never a payslip. Family fields:

| Entry          | Fields                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| leave          | `days` — non-empty `{ date, part: AM \| PM }[]`; quantity is `days.length / 2`; `encashment`, `is_reversal`, `reverses` |
| claim          | `quantity`, `unit`, `incurred_on`, `is_reversal`, `reverses`                                                            |
| adhoc          | `description`, `quantity`, `unit`, `incurred_on`, `is_reversal`, `reverses`                                             |
| loan           | `quantity` (principal), `repayment_period`; no reversal flag                                                            |
| loan repayment | `loan_id`, `amount`, `paid_on`, `payment_reference`, `is_reversal`                                                      |

There is no `quantity`, `unit` or session object on leave, no advance date/reference or repayment plan on loans, and no principal/interest/fee allocation on repayments.

## 6. Work, calendar and validation

`shift_definition` declares one day variant: day type (`WORK`, `REST`, `OFF` or `ABS`), start/end time, next-day rollover, breaks and optional untimed hours. `shift_pattern` lists them by slot, counted from its `anchor_date`: anchored on a Monday, slot 1 is Monday and slot 7 Sunday. `holiday` and the interruption/case catalogues supply dated source data.

The contract's pattern is the default. A day with no `roster_entry` is a day worked as planned: salary stands and no overtime is paid. `roster_entry` changes a day: `work_date`, `shift_definition_id`, `planned_overtime_intervals` and `actual_worked_intervals`. `ABS` is a day type like `REST`: the person did not come, and it is not leave.

Overtime is paid only from planned intervals. The clock verifies them and never creates them, and no overtime is projected. A person who clocks at least the entity's `overtime_full_award_percent` of the plan is paid the whole plan; below it they are paid the clocked hours inside the plan, rounded down to the half hour.

`registered_rule` validates a target collection: events, declared reads, condition and validation expression, evaluated inside the target model's write transform or delete check. `registered_effect` registers a post-commit expression; the source model's effect queries the registry and writes the records the expression returns through its `target_action`. Every seeded effect raises an `obligation`.

```text
write ──► registered_rule (target_collection, events) ──► commit
                                                           │
commit ──► registered_effect (source_collection, events) ──┴──► target_action write
```

## 7. Obligations

`obligation` is a free-form task or reminder raised by an event: `entity_id`, optional employee/employment, `title`, optional `due_on` and `fulfilled_on`, `occurrence_key`, optional evidence and waiver reason, and the state `OPEN → FULFILLED | WAIVED`. It stores no financial fields and posts no ledger movement.

A registered effect on an entry reaches its version through the catalog row the entry was raised on, which the entry's model passes on; sealing an entry into a run is not an edit and fires nothing. A check with a deadline ahead, a permit or a retirement date, sits on `payslip` and runs at every run: nothing wakes a tenant database on a timer, and its `occurrence_key` keeps it to one obligation.

An off-cycle run pays the contracts in its period, so a leaver's goes on the period of their last day, and a run that would seal an entry with no payslip refuses.

## 8. Expression context

Expressions are deterministic JavaScript function bodies with explicit returns, run by the bounded interpreter. Missing values are unknown, never zero. No database access, ambient clock or undeclared calls.

| Evaluation      | Context                                                               |
| --------------- | --------------------------------------------------------------------- |
| `ctx.subject`   | employee, employment, employer data                                   |
| `ctx.entry`     | catalogue entry and its admitted quantity/unit                        |
| `ctx.lookup`    | the jurisdiction's global lookup under the row's own                  |
| `ctx.balances`  | `ytd`, `statutory_contribution`, `month`, `years`                     |
| `ctx.base_pay`  | the running checkpoint; default base pay at the first                 |
| `ctx.day_rate`  | the jurisdiction's day rate for this person                           |
| `ctx.subtotals` | completed earlier subtotal results only                               |
| `ctx.statutory` | completed earlier statutory results by scheme code                    |
| `ctx.overtime`  | the run's overtime pay, in statutory evaluation                       |
| `ctx.work`      | the period's roster days and their priced minutes                     |
| `ctx.run`       | payroll frame during a run                                            |
| `ctx.reads`     | declared reads for validation and registered effects                  |
| `ctx.event`     | the write a rule or effect answers to; the fact an entitlement counts |
| `ctx.as_of`     | the date the expression is evaluated for                              |

## 9. Governing constraints

1. The source tree in the [model contract](0002-model-specification.md) is the final model set. Deleted concepts are not reintroduced behind wrappers, aliases or JSON bags.
2. Values are not duplicated: no employment or payroll lock on a roster day, and no payroll history alongside the balance.
3. Statutory evaluation persists only as ledger rows and the payslip.
4. One linear, cycle-free subtotal chain per settings version. No `phase`, `channel`, `order` or implicit stage.
5. A payroll run, never a payslip, owns source capture and row locks.
6. Formula simplification means moving orchestration to the engine, not minifying legal distinctions.

## 10. Changing a formula

The ledger service owns balance admission and posting; the engine owns dependency resolution and rounding. A formula selects its evidenced base and legal values and assesses the amount. Preserve legal distinctions and dated versions. A changed result requires an explained correction, not a silently updated expected value.
