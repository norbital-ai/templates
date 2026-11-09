# Target architecture

The HRMS as built. [The calculation architecture](0001-hrms-calculation-architecture.md) holds the fixed design and the owners' rulings; [the model contract](0002-model-specification.md) holds the models. Figures in the examples are illustrative.

## 1. The shape

Law lives in catalogues. What is true about a person lives on their sealed contract. What happened once is an entry. A pure engine turns these into a payslip, and one ledger service keeps every accumulated value.

```text
  CATALOGUE ROWS         FACTS                 ENTRIES
  what the law is        what is true          what happened once
       |                 of a person                |
       |                     |          RULE refuses a bad write
       |                     |                      |
       |                     |                      v
       +---------------------|------------------> ENGINE
       |                     |                 pure: pay to net pay
       |                     |                      |
       |                     |                   PAYSLIP
       |                     v                      |
       +----------------->  SYNC                 POSTING
                         what is owed         what was used or paid
                             |                      |
                             +---------+------------+
                                       v
                                LEDGER SERVICE
                                settle(sources)
                                       |  one write
                                +------+------+
                                v             v
                             LEDGER        BALANCE
                             every         running
                             movement      totals

  EFFECT   after a commit: a task, or a ledger sync scheduled
```

Everything is composed from eight primitives:

| Primitive     | Answers                      | Example                             |
| ------------- | ---------------------------- | ----------------------------------- |
| Catalogue row | What is the rule?            | Annual leave in Malaysia            |
| Fact          | What is true of this person? | A child born on 2 March             |
| Entry         | What happened once?          | 2 days of leave, an RM400 claim     |
| Subtotal      | Where in the calculation?    | Ordinary wages                      |
| Account       | What is being totalled?      | Annual leave used this service year |
| Movement      | What changed a total?        | Used +2, from this entry            |
| Rule          | May this be written?         | Not enough leave left               |
| Effect        | What follows?                | Raise a remittance task             |

The core is one pairing:

```text
FACT   ->  SYNC     ->  what a person is owed
ENTRY  ->  POSTING  ->  what they used or were paid
```

## 2. Responsibilities

| Layer           | Does                                                     | Never                                   |
| --------------- | -------------------------------------------------------- | --------------------------------------- |
| Catalogue       | Holds the law, versioned by country                      | Holds anyone's data                     |
| Fact            | Holds what is true of a person, on the sealed contract   | Prices anything or moves a balance      |
| Entry           | Records what happened once                               | Prices anything                         |
| Contract change | Files a dated change to a contract ahead of its day      | Reaches payroll or the ledger unsealed  |
| Workplace case  | Files an incident, request or notice, with its outcome   | Moves a balance or prices a line        |
| Model           | Shape, locks, a hook that schedules posting              | Holds law or posts anything             |
| Rule            | Refuses a write before commit, with the statute's reason | Writes anything                         |
| Engine          | Turns inputs into lines, checkpoints and statutory rows  | Reads, writes, or knows the ledger      |
| Run             | Loads data, calls the engine, stores payslips            | Calculates                              |
| Ledger service  | Keeps ledger and balance true, under its own policy      | Decides law                             |
| Sync            | Works out what is owed, closes old periods               | Writes the ledger except through settle |
| Effect          | Starts what follows                                      | Touches the ledger or the balance       |
| Page            | Shows state, starts verbs                                | Writes the ledger                       |

## 3. Catalogues

Every family shares one row shape, and each row fills only what it needs:

```text
code, description
eligibility                 does this row apply?
conversion                  how much is the pay line?
subtotal, direction, party  where the line lands
lookup                      the statute's numbers, and:
  window                    which period does it count in?
  granted days, bands       what is a person owed?
  opened_by                 which dated facts open it?
  accounts                  what does this row move, if not its default?
  below_zero                what does a statutory row do under zero?
```

`eligibility` and `conversion` are expressions; the rest are data. A leave row has no conversion: `paid_share` says what share of a normal day a slot pays (0 to 1, empty 1) and `payout` what a cash-out pays. Leave rows share one entitlement rule, which reads `service_bands`, `grant_days`, `carry` and `eligibility`; a row with its own statutory test states it in `lookup.entitlement`.

**Defaults.** Most rows declare no `accounts`.

| Row       | Default accounts                                                                        |
| --------- | --------------------------------------------------------------------------------------- |
| Leave     | `leave/<own code>/<period>/used`                                                        |
| Claim     | `claim/<own code>/<period>/used`                                                        |
| Statutory | `statutory/<code>.<party>/` year, and month where the row's `balance_window` is `MONTH` |
| Subtotal  | `pay/<code>/` year, and month where the row's `balance_window` is `MONTH`               |
| Adhoc     | None                                                                                    |

A row that declares `accounts` replaces its default entirely. A change of law is a new sealed version; earlier periods stay on their own version. Every `lookup` key must be read by an expression or by code: a key nobody reads fails the test suite, so a statute cannot look enforced and not be.

## 4. Facts, entries and corrections

A fact lives on the contract, which is sealed and is what a payroll run reads. It is native (gender, date of birth, service start), a `family` member (children, spouse, parents; every count derives here), a declared `employee_extension_data.<field>` or `statutory.<SCHEME>.<field>`, or a dated item in the contract's native `events` (illness, bereavement, marriage, work injury). Every extension schema is flat: no `facts`, `term_facts`, `exit_facts` or `elections` bucket.

A new fact is a new contract version, sealed from the first of a month so a run never prices a month on two versions. A transfer starts on the first too; only a hire, a rehire and an exit keep their own day, and an event keeps its real date. A fact known ahead of its day is filed as a `contract_change`, sealed by `contract_materialize` on that day; an employer fact is an `entity_change` sealed by `entity_materialize`. Where leave starts before a birth, `opened_on` is the day its window opens and `on` carries the expected date; a later change moves `on`, while the window, its entitlement and the days taken stay. Sealing triggers sync, and a catalogue row's `opened_by` names the events that open it. A fact entered in error is removed by a new version without it; sync takes back what it gave, and the seal is refused while days taken stand on it. Documents are uploaded on the employee profile and a fact names its document.

What a person is owed comes from a catalogue rule plus contract facts, and sync posts the difference per source. Besides posting and sync, only HR writes the ledger, by hand on the employee profile: a manual adjustment (`source` `manual:<id>`, a `note` naming its cause) adds or removes signed days on a leave row's `entitled`, or money on a claim row's `limit`, for the window holding its date. It is a ledger row and nothing else, immutable, corrected by an opposite row; sync diffs only its own sources, and carry and the closing settlement count it like any entitled day.

Days in lieu are a leave row of their own (`PUBLIC_HOLIDAY_IN_LIEU`): 0 by default, a yearly grant only if the rule says so, plus HR's manual adjustments. A public holiday on a rest day is instead a calendar row that `replaces` it, given only to those off on the replaced date.

Overtime taken as time off (Taiwan §32-1) is marked on the roster day as `overtime_as_time_off`: the run prices no overtime, and the payslip posts the awarded hours to the `entitled` of the law's one hour-unit leave row in the window of the day worked. A half day taken uses half the contract's normal day; HR's adjustments on it are hours; sync settles none of it.

An exit is read from the contract chain: a sealed version that ends with no successor of the same jurisdiction lineage. Its facts sit on that version (`effective_range.to`, `reason`, `exit_ground`, `final_pay_due_on`). The contract's write raises `exit` when a save makes that true; encashment and the exit duties listen, and a corrected or cancelled exit raises it again. The save that ends a version, or moves its end, states the exit answers the version did not hold; the facts it holds stand.

Service is worked out from the person's contracts at the employer. `employee_profile.cumulative_service` (default false) chooses: on, every stint counts, rehires included; off, only the current unbroken stint. Expressions read the service start as `service_started_on` and the current stint's start as `employment_started_on`.

An entry is one dated event against a catalogue row. A run locks the entries it uses. An unpaid entry can be deleted; a paid entry is corrected only by a new entry. A reversal names the sealed entry it undoes, is made by the HR controller only, and takes the original's period; an adjustment is an entry on a row that is itself the correction, in its own period. A reversal no run has consumed is cancelled by deleting it; once paid, delete is refused.

A workplace case files something that happened at work: a harassment complaint, an accident, a data breach, a flexible work request, a notice dispute. It holds the record, the document and the outcome, and raises tasks through effects. It never moves a balance or prices a line; if its outcome changes pay, HR makes the entry (a suspension is an unpaid leave entry, a settled dispute an adhoc entry).

## 5. Engine

```text
INPUT                               OUTPUT
run frame                           pay lines
subject: employment, employer       checkpoints
catalogue rows in force             statutory rows
entries due in this run             net pay
attendance
balance values
```

Calculation is linear: one chain per version, from the first subtotal to net pay. The engine reads nothing beyond its input and writes nothing. It has no knowledge of ledgers, year close or retention.

Formulas read balance values through `ctx.balances`, built by the run from the balance: `ytd` and `statutory_contribution` for the tax year of the pay date, `month` for the last twelve months and `years` for each tax year held.

**What a statutory row returns decides what happens.**

| Result     | Payslip            | Balance             | Use                            |
| ---------- | ------------------ | ------------------- | ------------------------------ |
| Above zero | Deduction line     | Rises               | The normal case                |
| Zero       | No line            | Unchanged           | Carries: the next run nets it  |
| Below zero | Refund line, `ADD` | Falls by the refund | The law has the employer repay |

A row whose statute forbids an employer refund stops at zero. The choice lives in the row, by country. No payslip line and no ledger amount is ever negative. The balance moves with the refund, so nothing can be repaid twice.

## 6. Accounts

Every value has a four-part key, `<family>/<code>/<period>/<measure>`:

```text
leave     / ANNUAL_LEAVE / MY.S.2026-03-05 / used
claim     / MEDICAL_CLAIM / MY.Y.2026-01-01 / limit
pay       / GROSS        / MY.Y.2026-01-01 / total
statutory / EPF.employee / MY.M.2026-06-01 / paid
```

The content is free, so a new statute needs no code; the structure is fixed, so everything stays queryable. Measures are `entitled`, `carried`, `used`, `limit`, `total` and `paid`.

A period key is `<scope>.<kind>.<window start date>`, computed by one function.

| Kind                   | Letter | Used by                                      |
| ---------------------- | ------ | -------------------------------------------- |
| `YEAR(start month)`    | `Y`    | Tax year, calendar year, Japan's April year  |
| `MONTH`                | `M`    | Month totals                                 |
| `SERVICE_YEAR(offset)` | `S`    | Service-year leave, Japan's six-month offset |
| `BLOCK(months)`        | `B`    | Fixed blocks of service                      |
| `EVENT`                | `E`    | Leave given per dated fact on the contract   |
| `LIFETIME`             | `L`    | Grants for the whole of service              |

Scope is the country by default, so a move between countries or a restart of service starts new keys. Where the law has each employer withhold on its own, as China and Thailand do, the jurisdiction sets `ytd_scope` and pay and statutory totals are also keyed by employer, so a move starts them again.

A new period is a new key, so nothing closes a year. Sync removes year and service windows after three years and month totals after twelve months, through dated movements; blocks, lifetimes and events stay, and the ledger keeps everything forever. A sliding window is not an account: "a year within any two" (Taiwan) or "30 sick days within 45" (Indonesia) is a rule or an effect over dated entries.

The balance is one row per person, holding values and entitlements only:

```json
{
	"leave": { "ANNUAL_LEAVE": { "MY.S.2026-03-05": { "entitled": 14, "carried": 3, "used": 6 } } },
	"claim": { "MEDICAL_CLAIM": { "MY.Y.2026-01-01": { "limit": 576, "used": 400 } } },
	"pay": { "GROSS": { "MY.Y.2026-01-01": { "total": 62000 } } },
	"statutory": { "EPF.employee": { "MY.Y.2026-01-01": { "paid": 6820 } } }
}
```

What is left is derived: `entitled + carried + limit - used`. A row with no entitlement has no limit, and the balance never holds notes, flags, dates or guards.

The ledger is one append-only row per movement: `balance_id`, `operation` (`ADD`, `DEDUCT`, `REMOVE`), `account`, `code`, `period`, `measure`, `amount` (never negative), `unit`, `effective_on`, `source`. `source` is plain text (`leave_catalog_entry:<id>`) so that a movement outlives what caused it. Loans stay out of the ledger: outstanding is `principal - repayments`.

## 7. Ledger service

The ledger service lives in `src/lib/ledger/` and has one write:

```text
settle(sources)

  for each source:
    1. Work out what it should have posted, from the record as it stands now
    2. Read what it has posted
    3. Keep only the difference
  commit ledger rows and balances as one write, guarded by each balance's revision
```

A record that no longer exists should have posted nothing, so its movements are inverted. Its core is two pure functions in `core.ts`, `diff(source, wanted, posted)` and `apply(accounts, movements)`, tested without a database.

```text
record committed
     |
model hook schedules posting (it writes nothing)
     |
ledger automation: payroll_execution policy, one run at a time, declared retries
     |
settle, in chunks of 50 people
     |
failed for good: raises a task, and the PAID gate holds the run
```

Posting never runs as the person who made the entry. HR's one direct write is a manual adjustment on the employee profile; the ledger takes only that shape from the `hr_controller` policy, works out its window and `source`, and moves the balance in the same write. HR never writes the balance itself.

Posting and sync meet in `settle`:

```text
POSTING                                SYNC
a record was written                   an entitlement may have changed

leave entry                            contract changed
claim entry                            entity changed
adhoc entry with accounts              new law takes effect
payslip                                a period ended
                                       a fact changed
                                       a run was paid
                                       HR pressed the button
     |                                      |
source = the record                    source = the entitlement and period
wanted = the row's accounts            wanted = the row's entitlement
     |                                      |
     +-------------> settle <---------------+
```

A payslip is the run's entry. Pay and statutory totals post from it once, in the period of its pay date.

| Event                      | Result                      |
| -------------------------- | --------------------------- |
| Entry created              | One add or deduct           |
| Same work runs again       | Nothing                     |
| Unpaid entry edited        | The difference              |
| Unpaid entry deleted       | Exact inverse               |
| Unpaid run deleted         | Exact inverse, slip by slip |
| Entitlement rises 14 to 18 | +4                          |
| Sync runs twice            | Nothing                     |

Gates:

| Gate                                                                                  | Protects                        |
| ------------------------------------------------------------------------------------- | ------------------------------- |
| A run is refused while an earlier payslip has not posted                              | Totals read by the next run     |
| A run is refused until a deleted run has taken its totals back                        | Year-to-date figures            |
| PAID is refused while the run's own payslips have not posted                          | A paid run is complete          |
| A run cannot be deleted once a later run has read it                                  | Year-to-date figures            |
| A rule counts entries not yet posted, as well as the balance                          | Two entries in quick succession |
| A contract seal is refused while days taken stand on a fact it drops                  | Days taken stay taken           |
| An entry with a reversal cannot be deleted                                            | A reversal keeps its original   |
| A reversal names one entry of the same person and catalogue item                      | Nothing is reversed by accident |
| An entry is reversed once, for no more than it held, and a reversal is never reversed | `used` cannot fall below zero   |
| Half a day is taken once across a person's leave, until a reversal frees it           | One absence, one entry          |
| Only posting, sync and HR's manual adjustments write the ledger; balance = projection | No hand-written balance         |
| A leave in a window no sync has opened has nothing to refuse against                  | A leave dated next year         |
| A leave posted into an earlier year syncs that person again                           | Carry stays right               |

A slip that moved no money posts nothing and holds nothing back. A posting that cannot succeed raises a task on its first failure; only a write conflict is retried. A claim on a limited row pays what the limit leaves, the run pays what the ledger posted, and a reversal gives back no more than its original drew.

The guarantees follow from the write: a balance equals the sum of its ledger (any row can declare any account), a repeat posts nothing (`settle` compares with the ledger), a crash leaves ledger and balance in agreement, one writer at a time holds a revision, and the key is free in content but fixed in structure.

```text
Crash before commit   nothing happened; the rerun posts it
Crash after commit    the rerun finds it posted; nothing to do
Conflicting write     refused; the attempt starts again from fresh state
Record deleted first  the rerun finds no record and posts the inverse
```

A write conflict is an `ActConflict`, and the automation's declared retries start it again.

## 8. Sync

Sync is one automation over one pure function. For each person and each row with an entitlement:

```text
period  = the row's period on this date
wanted  = { entitled, carried } from the row's rule
settle("entitlement:<balance>:<code>:<period>")
a full sync then removes periods past retention
```

Carry comes from the previous period's derived balance. Used days are never touched, so days taken stay taken.

A period that closes is settled once on its last day: sync evaluates its rule as of that day and posts the difference before the next period opens, so an accrual by completed months ends with the full year (Malaysia's first year closes at 8 days, not 7). A share by completed months counts the day itself as served; a service band is the one the period started in, so the settlement never lifts a closing year into the next band.

Sync runs on the triggers in section 7. It schedules itself for the next period boundary anyone reaches, so a reset lands on its day. A paid run also triggers it, which catches monthly accrual. A yearly cron is the backstop.

## 9. Rules and effects

**Rules** run before commit. They read balance values and dated entries, and a refusal gives one plain reason, taken from the rule's own message.

**Effects** run after commit. Registered effects go through one dispatcher that resolves the settings version for every model, and each seeded one raises a task. A contract's own effect schedules a ledger sync and raises `seal` and `exit`; the exit encashment and the exit duties listen to `exit`. A leave posting dated in an earlier year schedules a sync of its people. No effect touches the ledger or the balance.

**Company methods.** Where the employer's own method pays at least what the law requires, payroll follows it; where it pays less or withholds wrongly, the law. A method is an employer setting with the statute as its floor: the overtime hour basis (`CONTRACT_WEEKLY`, the month × 12 ÷ 52 weeks of contract hours), a rest-day hourly multiplier, a night-differential basis (`CLOCK_SPAN`, never paying less than the statute per shift), company leave rows the tenant adds, and an employee-borne share of income tax. A one-off month that departs from the company's own method is not a method.

## 10. Worked examples

**Leave entitlement and carry (Malaysia).** Employment Act 1955 s.60E: 8 days under 2 years, 12 from 2 to 5, 16 after; unused statutory days carry in full (s.60E(2)), and a cap of 5 limits only company days above statute.

```text
ANNUAL_LEAVE   period SERVICE_YEAR(0)   lookup service_bands 12->8, 24->12, 60->16
Second service year begins   ADD leave/ANNUAL_LEAVE/MY.S.2025-03-05/entitled 12
Sync runs again              nothing
14 left, 12 of them statutory   carried 12 + 2 = 14
```

**Attendance test (Japan).** Labour Standards Act art.39: 10 days after 6 months with 80% attendance.

```text
ANNUAL_LEAVE   period SERVICE_YEAR(6)
  entitlement  if a sealed ATTENDANCE_BELOW_RATIO fact sits on this grant day, 0
               otherwise the days for this length of service

ANNUAL_LEAVE_ATTENDANCE_REVIEW   an effect on the payslip of the grant month
  reads    the roster for the months before the grant
  raises   a task due on the grant day when recorded attendance is short
```

The effect measures what the roster records; HR confirms the days the statute deems attended and seals the fact.

**Leave given by a dated fact (Malaysia).** Employment Act s.37: 98 days per confinement.

```text
MATERNITY_LEAVE   period EVENT   opened by CHILD_BIRTH   grant_days 98
Child born 10 Feb 2025, contract sealed
  sync   ADD leave/MATERNITY_LEAVE/MY.E.2025-02-10/entitled 98
  leave  ADD leave/MATERNITY_LEAVE/MY.E.2025-02-10/used 60
Second child, 3 May 2027   ADD leave/MATERNITY_LEAVE/MY.E.2027-05-03/entitled 98
```

One fact can open several rows (the same birth gives a father paternity leave); days left from the first birth do not stack onto the second. A complication adds 90 days to the same birth: sync wants 180, 90 is posted, so it adds 90.

**Pay that steps down (Indonesia).** PP 36/2021 art.41: 100% for 4 months, 75% for 4, 50% for 4, 25% after. `MEDICAL_LEAVE`'s `paid_share` reads the illness that opened it, per slot. The run already reads the contract, so a leave entry needs no link to the illness.

**A leave drawing on another (Indonesia).** Joint leave uses up annual leave: its row declares `accounts [{ account: leave, code: ANNUAL_LEAVE, measure: used }]`, so an entry posts `ADD` on the annual-leave key and a delete posts the inverse.

**Yearly claim limit (Malaysia).** RM576 a year: `lookup.annual_limit 576`, and the conversion is the entry's quantity, which a run sets to what the ledger posted.

```text
1 January     ADD claim/MEDICAL_CLAIM/MY.Y.2026-01-01/limit 576
RM400 claim   ADD claim/MEDICAL_CLAIM/MY.Y.2026-01-01/used  400
RM800 claim   pays RM176   ADD claim/MEDICAL_CLAIM/MY.Y.2026-01-01/used 176
Reversal      DEDUCT claim/MEDICAL_CLAIM/MY.Y.2026-01-01/used 400, in the original's period
```

**Tax.** Each country's tax row settles the year by its own law, inside the linear calculation. There is no year-end step or reconciliation feature; HR has no step for tax.

| Country     | How the year settles                                   | Below zero                                                 |
| ----------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| Japan       | `YEAR_END_ADJUSTMENT` in the December run              | Refund line: the employer repays                           |
| Indonesia   | `PPH21` reckons the year in December or the exit month | Refund line: the employer repays                           |
| Philippines | `WTAX` annualises at the year's last pay               | Refund line: the employer repays                           |
| Vietnam     | `PIT` monthly; the year in December where authorised   | Refund line, for an authorised finalisation                |
| China       | `IIT` withholds cumulatively every month               | Stops at zero and carries; the employee files for the year |
| Malaysia    | `PCB` recalculates monthly from year-to-date           | Stops at zero                                              |
| Thailand    | `PND1` recalculates monthly from the months left       | Stops at zero                                              |
| Taiwan      | Withheld monthly; the employee files for the year      | Stops at zero                                              |
| Singapore   | No withholding on salary                               | None                                                       |

```text
Year-end refund     Japan, December: YEAR_END_ADJUSTMENT returns -400
                    pay line +400, DEDUCT statutory/YEAR_END_ADJUSTMENT.employee 400
Cumulative          China: IIT = max(0, tax on the year so far - paid so far); below zero no line
Tax the state bears PMK 105/2025: PPH21_DTP adds the amount of PPH21 in cash (Indonesia)
Two-year benefit    PP 68/2009: SEVERANCE posts to its year and month; PPH21_FINAL_SEVERANCE reads
                    ctx.balances.years from severance_tax_history.first_payment_year
```

**Contributions.** Each month's contribution is set by that month's wage and reported person by person, so one month cannot offset another. A wrong wage is a normal reversal entry whose contribution follows; a correction within the month nets on the month's total (a below-zero result is a refund line); a wrong rate in a closed month is one adjustment entry and a claim to the fund.

The adjustment lives in the adhoc catalogue, on a row that is the correction for that scheme:

```text
EPF_REFUND (adhoc_catalog)   direction ADD   subtotal NET   accounts statutory/EPF.employee, year and month
```

HR enters employee, item, amount 100, dated 30 June and a description. The entry posts `DEDUCT statutory/EPF.employee/MY.Y.2026-01-01/paid 100` and the same on June's key; an effect raises the task to claim RM100 back from EPF; the next run pays the employee +100; HR files the claim and closes the task. An underpayment is the mirror (`EPF_ADJUSTMENT`, `DEDUCT`). Each scheme has its own adjustment rows, so the target is exact, and an adjustment is dated in the closed wage month it corrects: that month's statutory total takes it and the next run pays it. It is refused in a month no run has closed, where that month's row would count it as paid and nothing would move.

**Ceiling across the year (Singapore).** The yearly ceiling less ordinary wages attracting CPF, each month counted at that month's ceiling:

```text
ORDINARY_WAGES accumulates by month   pay/ORDINARY_WAGES/SG.M.2026-06-01/total
CPF reads the months   ceiling = annual_ceiling - sum(min(month's OW, ordinary_ceiling))
```

**Severance.** Severance lives in the adhoc catalogue. Each kind of payment is one adhoc row, and each person's payment is one `adhoc_catalog_entry`. The facts that decide it, such as `exit_ground` and `termination_cause`, are on the contract.

| Country     | Adhoc row               | Subtotal         | The amount comes from                                  |
| ----------- | ----------------------- | ---------------- | ------------------------------------------------------ |
| Indonesia   | `PESANGON`, `UPMK`      | `SEVERANCE`      | Formula: service schedule × termination cause          |
| Thailand    | `SEVERANCE_PAY`         | `SEVERANCE`      | Formula on service                                     |
| Taiwan      | `SEVERANCE_PAY`         | `RETIREMENT`     | Formula on service                                     |
| China       | `ECONOMIC_COMPENSATION` | `SEVERANCE`      | Formula on service                                     |
| Vietnam     | `SEVERANCE_ALLOWANCE`   | `FINAL_PAY`      | Formula on months HR counts                            |
| Malaysia    | `TERMINATION_BENEFIT`   | `SEPARATION_PAY` | The higher of the entry's amount and the law's formula |
| Singapore   | `RETRENCHMENT_BENEFIT`  | `GROSS`          | The entry's amount                                     |
| Philippines | `SEPARATION_PAY`        | `GROSS`          | The entry's amount                                     |
| Japan       | `RETIREMENT_ALLOWANCE`  | `RETIREMENT`     | The entry's amount                                     |

A company package above the law is another adhoc row, with its own formula and eligibility. When a Malaysian employee with 6 years is made redundant, the Regulation floor is 20 days a year × 6 years × a day's wages; the contract end raises the task, HR makes the entry with the agreed package, and the final run pays the higher of the package and the floor while the tax row reads `SEPARATION_PAY`.

**13th month (Philippines).** PD 851: one twelfth of basic salary earned in the year. `THIRTEENTH_MONTH_PAY` (adhoc) is eligible from a month of service within the employment and converts the entry's quantity; a December effect raises the task to pay it by 24 December, and the run pays it through `ADDITIONAL_WAGES`.

**Unused leave at exit.** When the contract end seals, the contract's effect creates a leave entry with `encashment: true` and the days left. The ledger posts them as used and the row prices them in the final run. An `ANNUAL_LEAVE` row encashes when it has a `payout`.

## 11. Code layout

```text
src/lib/
  ledger/
    core.ts             diff, apply, periods, windows, the view formulas read
    entitlement.ts      the leave entitlement rule
    service.ts          settle, post, sync, retention, the ledger gates
  payroll_engine/
    engine.ts           calculation, subtotal chain, statutory order
    run_calculation.ts  load, calculate, what a run seals
    expressions.ts      sandbox and neutral helpers
    registrations.ts    rule and effect dispatch
    contract_change.ts  dated contract changes
    pay_cycle.ts        pay cycle
    attendance.ts       attendance
    time_evidence.ts    time evidence
    loan_schedule.ts    schedule, recovery
  export_format_configuration/  salary listing, bank files
  ui/                   pages and shared components
```

A model's posting is what its write carries:

```text
return { rows, onApproved: yield* entryPostings(ctx.db.query, 'leave_catalog_entry', entries, true) };
```

## 12. Invariants

1. A balance equals the sum of its ledger.
2. Repeating any posting or sync posts nothing.
3. A crash at any point leaves ledger and balance in agreement.
4. Two concurrent writers never lose an update.
5. Only the ledger service writes the ledger or the balance.
6. The engine depends only on its input.
7. Every `lookup` key is read.
8. Every effect fires for every model that declares one.
9. No posting fails silently.
10. Every statutory row names a statute, and below zero it refunds by `lookup.below_zero` or stops at zero.
11. Tests write as real roles, never as admin.
