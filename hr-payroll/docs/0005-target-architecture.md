# Target architecture

The HRMS as built: its primitives, responsibilities, ledger service and worked examples. [The calculation architecture](0001-hrms-calculation-architecture.md) holds the fixed design and the calculation in detail. Figures in the examples are illustrative.

## 1. Overview

Law lives in catalogs. What is true about a person lives on their sealed contract. What happened once is recorded as an entry. A pure engine turns these into a payslip, and one ledger service keeps every accumulated value.

```text
  CATALOG ROWS           FACTS                 ENTRIES
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

| Primitive   | Answers                      | Example                             |
| ----------- | ---------------------------- | ----------------------------------- |
| Catalog row | What is the rule?            | Annual leave in Malaysia            |
| Fact        | What is true of this person? | A child born on 2 March             |
| Entry       | What happened once?          | 2 days of leave, an RM400 claim     |
| Subtotal    | Where in the calculation?    | Ordinary wages                      |
| Account     | What is being totalled?      | Annual leave used this service year |
| Movement    | What changed a total?        | Used +2, from this entry            |
| Rule        | May this be written?         | Not enough leave left               |
| Effect      | What follows?                | Raise a remittance task             |

The core of the design is one pairing:

```text
FACT   ->  SYNC     ->  what a person is owed
ENTRY  ->  POSTING  ->  what they used or were paid
```

## 2. Responsibilities

Each layer has one job.

| Layer           | Does                                                     | Never                                   |
| --------------- | -------------------------------------------------------- | --------------------------------------- |
| Catalog         | Holds the law, versioned by country                      | Holds anyone's data                     |
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

## 3. Catalog

Every catalog family shares one row shape, and each row fills only what it needs.

```text
code, name
eligibility                 does this row apply?
conversion                  how much is the pay line?
subtotal, direction, party  where the line lands
lookup                      the statute's numbers, and:
  window                    which period does it count in?
  grant_days, service_bands what is a person owed?
  opened_by                 which dated facts open it?
  accounts                  what does this row move, if not its default?
  below_zero                what does a statutory row do under zero?
```

`eligibility` and `conversion` are expressions. The rest are data.

**Defaults.** Most rows declare no `accounts`.

| Row       | Default accounts                                                                        |
| --------- | --------------------------------------------------------------------------------------- |
| Leave     | `leave/<own code>/<period>/used`                                                        |
| Claim     | `claim/<own code>/<period>/used`                                                        |
| Statutory | `statutory/<code>.<party>/` year, and month where the row's `balance_window` is `MONTH` |
| Subtotal  | `pay/<code>/` year, and month where the row's `balance_window` is `MONTH`               |
| Adhoc     | None                                                                                    |

A row that declares `accounts` replaces its default entirely.

Leave rows share one entitlement rule, which reads the standard keys (`service_bands`, `grant_days`, `carry`, `eligibility`). A row with its own statutory test gets an `entitlement` expression in its lookup.

**Versions.** A change of law is a new sealed version. Earlier periods stay on their own version.

**Unread keys.** Every `lookup` key must be read by an expression or by code. A key nobody reads fails the test suite, so a statute cannot look enforced and not be.

## 4. Facts, entries and corrections

### Facts

A fact is something true of a person. Every fact lives on the contract, because the contract is sealed and is what a payroll run reads. Each country's `employee_extension_schema` declares its facts, so a new fact needs no code.

| Fact       | Where on the contract                                | Examples                                             |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------- |
| Native     | Contract fields                                      | Gender, marital status, date of birth, service start |
| Person     | `employee_extension_data.<field>`                    | Dependants, tax elections, exit answers              |
| Statutory  | `employee_extension_data.statutory.<SCHEME>.<field>` | Scheme elections and registration numbers            |
| Dated list | `employee_extension_data.events`, one per event      | Children, confinements, illnesses, marriage          |

Every schema is flat: there are no `facts`, `term_facts`, `exit_facts` or `elections` buckets.

A new fact is a new contract version: HR adds it to a draft and seals it, from the first of a month, so a run never prices a month on two versions. A transfer starts on the first too; only a hire, a rehire and an exit keep their own day. The event keeps its own real date. One known ahead of its day is filed as a `contract_change`, which nothing reads until the `contract_materialize` automation seals it on that day; an employer fact is filed as an `entity_change` and sealed by `entity_materialize` the same way. An event carries its real date. Where leave starts first, as it can before a birth, `opened_on` is the day its window opens; the expected date goes in `on`, and a later contract change moves `on` to the real date while the window, its entitlement and the days taken stay where they are. Sealing triggers sync, and a catalog row's `opened_by` names the events that open it, so nothing else connects them.

Documents are uploaded on the employee profile, by HR or by the employee, and a fact item names its document. HR records the fact and seals.

A fact entered in error is removed by a new version without it, and sync takes back what it gave. The seal is refused while days taken stand on it, or on a date it moves without keeping `opened_on`.

### Entries

An entry is one dated event against a catalog row. A run locks the entries it uses. An unpaid entry can be deleted. A paid entry is corrected only by a new entry.

| Correction | How                                                                                        | Period                    |
| ---------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| Reversal   | New entry on the same row with `reverses` naming a sealed entry, by the HR controller only | Taken from the original   |
| Adjustment | Entry on a row that is itself the correction                                               | The period it is dated in |

### Workplace cases

A workplace case files something that happened at work: a harassment complaint, an accident, a data breach, a flexible work request, a notice dispute. It holds the record, the document and the outcome, and raises tasks through effects.

A case never moves a balance or prices a line. If its outcome changes pay, HR makes the entry: a suspension is an unpaid leave entry, a settled dispute is an adhoc entry.

## 5. Engine

```text
INPUT                               OUTPUT
run frame                           pay lines
subject: employment, employer       checkpoints
catalog rows in force               statutory rows
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

### Key

Every value has a four-part key.

```text
family / code / period / measure

leave     / ANNUAL_LEAVE  / MY.S.2026-03-05 / used
claim     / MEDICAL_CLAIM / MY.Y.2026-01-01 / limit
pay       / GROSS         / MY.Y.2026-01-01 / total
statutory / EPF.employee  / MY.M.2026-06-01 / paid
```

| Part    | Holds                                                   |
| ------- | ------------------------------------------------------- |
| family  | The kind of value                                       |
| code    | A catalog code, a subtotal, or a scheme and party       |
| period  | The window the value belongs to                         |
| measure | `entitled`, `carried`, `used`, `limit`, `total`, `paid` |

The content is free, so a new statute needs no code. The structure is fixed, so everything stays queryable.

### Period

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

A new period is a new key, so nothing closes a year. Sync removes year and service windows after three years and month totals after twelve months, through dated movements. Blocks, lifetimes and events stay. The ledger keeps everything forever.

A sliding window is not an account. "A year within any two" (Taiwan) or "30 sick days within 45" (Indonesia) is a rule or an effect over dated entries.

### Balance

One row per person, holding values and entitlements only:

```json
{
	"leave": { "ANNUAL_LEAVE": { "MY.S.2026-03-05": { "entitled": 14, "carried": 3, "used": 6 } } },
	"claim": { "MEDICAL_CLAIM": { "MY.Y.2026-01-01": { "limit": 576, "used": 400 } } },
	"pay": { "GROSS": { "MY.Y.2026-01-01": { "total": 62000 } } },
	"statutory": { "EPF.employee": { "MY.Y.2026-01-01": { "paid": 6820 } } }
}
```

What is left is derived: `entitled + carried + limit - used`. A row with no entitlement has no limit. The balance never holds notes, flags, dates or guards.

### Ledger

One append-only row per movement:

```text
balance_id
operation     ADD, DEDUCT, REMOVE
account       the family
code
period
measure
amount        never negative
unit
effective_on
source        text: "leave_catalog_entry:<id>"
```

`source` is plain text so that a movement outlives what caused it.

Loans stay out of the ledger. A loan and its repayments are their own record, and outstanding is `principal - repayments`.

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

### Who runs it

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

Posting never runs as the person who made the entry. HR holds no direct write to the ledger or the balance.

### Two ways in

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

### Gates

| Gate                                                                                  | Protects                        |
| ------------------------------------------------------------------------------------- | ------------------------------- |
| A run is refused while an earlier payslip has not posted                              | Totals read by the next run     |
| A run is refused until a deleted run has taken its totals back                        | Year-to-date figures            |
| PAID is refused while the run's own payslips have not posted                          | A paid run is complete          |
| A run cannot be deleted once a later run has read it                                  | Year-to-date figures            |
| A rule counts entries not yet posted, as well as the balance                          | Two entries in quick succession |
| A contract seal is refused while days taken stand on a fact it drops                  | Days taken stay taken           |
| An entry with a reversal cannot be deleted                                            | A reversal keeps its original   |
| A reversal names one entry of the same person and catalog item                        | Nothing is reversed by accident |
| An entry is reversed once, for no more than it held, and a reversal is never reversed | `used` cannot fall below zero   |
| Half a day is taken once across a person's leave, until a reversal frees it           | One absence, one entry          |
| Only posting and sync write the ledger or the balance, an admin included              | No hand-written balance         |
| A leave in a window no sync has opened has nothing to refuse against                  | A leave dated next year         |
| A leave posted into an earlier year syncs that person again                           | Carry stays right               |

A slip that moved no money posts nothing and holds nothing back. A posting that cannot succeed raises a task on its first failure; only a write conflict is retried. A claim on a limited row pays what the limit leaves, the run pays what the ledger posted, and a reversal gives back no more than its original drew.

### Guarantees

| Requirement                    | How it holds                                                 |
| ------------------------------ | ------------------------------------------------------------ |
| Tracks values and entitlements | Any row can declare any account                              |
| Idempotent                     | `settle` compares with the ledger, so a repeat posts nothing |
| Race-safe                      | One writer at a time, one write, guarded by revision         |
| Properly keyed                 | Four-part key, free in content and fixed in structure        |

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

Sync runs on the triggers in section 7. It schedules itself for the next period boundary anyone reaches, so a reset lands on its day. A paid run also triggers it, which catches monthly accrual. A yearly cron is the backstop.

## 9. Rules and effects

**Rules** run before commit. They read balance values and dated entries, and a refusal gives one plain reason, taken from the rule's own message.

**Effects** run after commit. Registered effects go through one dispatcher that resolves the settings version for every model, and each seeded one raises a task. A contract's own effect schedules a ledger sync and raises the exit encashment, and a leave posting dated in an earlier year schedules a sync of its people. No effect touches the ledger or the balance.

## 10. Worked examples

### Leave

**Entitlement rises with service (Malaysia).** Employment Act 1955 s.60E: 8 days under 2 years, 12 from 2 to 5 years, 16 after.

```text
ANNUAL_LEAVE
  period  SERVICE_YEAR(0)
  lookup  service_bands 12->8, 24->12, 60->16

Second service year begins
  ADD leave/ANNUAL_LEAVE/MY.S.2025-03-05/entitled 12
Sync runs again
  nothing
```

**Carry with a company cap (Malaysia).** Unused statutory days carry in full (s.60E(2)). The cap of 5 limits only company days above statute.

```text
carried = statutory days left
        + min(company days left, lookup.carry.company_cap_days)

14 left, 12 of them statutory    carried 12 + 2 = 14
7 left, all statutory            carried 7
```

**Attendance test (Japan).** Labour Standards Act art.39: 10 days after 6 months with 80% attendance.

```text
ANNUAL_LEAVE
  period       SERVICE_YEAR(6)
  entitlement  if a sealed ATTENDANCE_BELOW_RATIO fact sits on this grant day, return 0
               otherwise the days for this length of service

ANNUAL_LEAVE_ATTENDANCE_REVIEW   an effect on the payslip of the grant month
  reads        the roster for the months before the grant
  raises       a task due on the grant day when recorded attendance is short
```

The effect measures what the roster records. HR confirms the days the statute deems attended, then seals the fact. Above the ratio nothing is raised.

**Leave across New Year (Vietnam).** Annual leave runs by calendar year. An entry with 2 days in December and 2 in January:

```text
ADD leave/ANNUAL_LEAVE/VN.Y.2026-01-01/used 2
ADD leave/ANNUAL_LEAVE/VN.Y.2027-01-01/used 2
```

**One leave drawing on another (Indonesia).** Joint leave uses up annual leave.

```text
JOINT_LEAVE
  accounts [{ account: leave, code: ANNUAL_LEAVE, measure: used }]

Entry created   ADD    leave/ANNUAL_LEAVE/ID.S.2026-03-05/used 1
Entry deleted   DEDUCT leave/ANNUAL_LEAVE/ID.S.2026-03-05/used 1
```

**Leave given by a dated fact (Malaysia).** Employment Act s.37: 98 days per confinement.

```text
MATERNITY_LEAVE
  period       EVENT
  opened by    CHILD_BIRTH
  eligibility  gender FEMALE
  lookup       grant_days 98

HR adds to the contract: child born 10 Feb 2025, and seals it
  sync     ADD leave/MATERNITY_LEAVE/MY.E.2025-02-10/entitled 98
  leave    ADD leave/MATERNITY_LEAVE/MY.E.2025-02-10/used 60
Second child, 3 May 2027
  sync     ADD leave/MATERNITY_LEAVE/MY.E.2027-05-03/entitled 98
```

One fact can open several rows: the same birth gives a father his paternity leave. Days left from the first birth do not stack onto the second.

**A fact that changes the grant (Indonesia).** A complication adds 90 days to the same birth.

```text
New contract version: a BIRTH_COMPLICATION event on the same date
  sync     wanted 180, already 90
  ADD leave/MATERNITY_LEAVE/ID.E.2026-03-02/entitled 90
```

**Pay that steps down (Indonesia).** PP 36/2021 art.41: 100% for 4 months, 75% for 4, 50% for 4, 25% after.

```text
Contract fact: illness from 2 Feb
MEDICAL_LEAVE conversion reads the contract
  no illness covers the day    pays in full
  an illness covers the day    steps from its start
New version ends the illness on 29 May: the next sick day pays in full
```

The run already reads the contract, so a leave entry needs no link to the illness.

### Claims

**Yearly limit (Malaysia).** RM576 a year, employer policy. The row pays what remains of the limit.

```text
MEDICAL_CLAIM
  period       YEAR(1)
  lookup       annual_limit 576
  conversion   the entry's quantity, which a run sets to what the ledger posted

1 January     ADD claim/MEDICAL_CLAIM/MY.Y.2026-01-01/limit 576
RM400 claim   ADD claim/MEDICAL_CLAIM/MY.Y.2026-01-01/used  400
RM800 claim   pays RM176
              ADD claim/MEDICAL_CLAIM/MY.Y.2026-01-01/used  176
Reversal of   DEDUCT claim/MEDICAL_CLAIM/MY.Y.2026-01-01/used 400
the first     in the original's period, whenever it is entered
```

### Tax

Each country's tax row settles the year by its own law, inside the linear calculation. There is no year-end step and no reconciliation feature. HR has no step for tax.

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

**Refund at year end (Japan).**

```text
December run: YEAR_END_ADJUSTMENT returns -400
  pay line +400
  DEDUCT statutory/YEAR_END_ADJUSTMENT.employee/... 400
```

**Cumulative withholding (China).** Year-to-date income less deductions, on the ladder, less tax already withheld.

```text
IIT = max(0, tax on the year so far - paid so far)

Below zero: no line. Next month's figure already counts it.
```

**Tax the government bears (Indonesia).** PMK 105/2025: the employee receives the tax in cash.

```text
PPH21_DTP: an ADD row paying the amount of PPH21
```

**Benefit taxed over two years (Indonesia).** PP 68/2009 arts.2(2), 6: the first two calendar years are one benefit on the ladder. Tax follows payment, so the totals post from the payslip.

```text
SEVERANCE posts to its year, and to its month through balance_window: MONTH
Contract fact: severance_tax_history.first_payment_year

PPH21_FINAL_SEVERANCE reads ctx.balances.years from that year on
```

### Contributions

Each month's contribution is set by that month's wage and reported to the fund person by person, so one month cannot offset another.

| Situation                  | What happens                                                                |
| -------------------------- | --------------------------------------------------------------------------- |
| Wage wrong                 | A normal reversal entry lowers the next wage, and the contribution follows  |
| Corrected within the month | The row nets on the month's total, and a below-zero result is a refund line |
| Wrong rate, month closed   | One adjustment entry, and a claim to the fund                               |

**Making an adjustment entry (Malaysia).** The wrong rate overcharged June's EPF by RM100.

The adjustment lives in the **adhoc catalog**, on a row that is the correction for that scheme:

```text
EPF_REFUND (adhoc_catalog)
  direction  ADD
  subtotal   NET, so it is not wages and attracts nothing
  accounts   statutory/EPF.employee, year and month
```

| Step | Who    | What                                                                                                                   |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 1    | HR     | Events > Ad hoc > New, or a spreadsheet for many people                                                                |
| 2    | HR     | Employee, item `EPF_REFUND`, amount 100, dated 30 June, a description                                                  |
| 3    | System | The entry's own write posts `DEDUCT statutory/EPF.employee/MY.Y.2026-01-01/paid 100`, and the same on June's month key |
| 4    | System | An effect raises the task: claim RM100 back from EPF                                                                   |
| 5    | System | The next run pays the employee +100                                                                                    |
| 6    | HR     | Files the claim with EPF, outside the system, and closes the task                                                      |

An underpayment is the mirror: `EPF_ADJUSTMENT`, direction `DEDUCT`, which adds to the statutory balance and raises a task to pay the arrears. An adjustment entered wrongly is deleted while unpaid, and reversed on the same row once paid.

Each scheme has its own adjustment rows, so the target is exact. An adjustment is dated in the closed wage month it corrects: that month's statutory total takes it, and the next run pays it. It is refused in a month no run has closed, where that month's row would count it as paid and nothing would move.

**Ceiling across the year (Singapore).** The yearly ceiling less ordinary wages attracting CPF, each month counted at that month's ceiling.

```text
ORDINARY_WAGES accumulates by month
  pay/ORDINARY_WAGES/SG.M.2026-06-01/total
CPF reads the months
  ceiling = annual_ceiling - sum(min(month's OW, ordinary_ceiling))
```

### Pay

**Severance.** Severance lives in the **adhoc catalog**. Each kind of payment is one adhoc row, and each person's payment is one `adhoc_catalog_entry`. The facts that decide it, such as `exit_ground` and `termination_cause`, are on the contract.

| Country     | Adhoc row               | Subtotal         | The amount comes from                                  |
| ----------- | ----------------------- | ---------------- | ------------------------------------------------------ |
| Indonesia   | `PESANGON`, `UPMK`      | `SEVERANCE`      | Formula: service schedule x termination cause          |
| Thailand    | `SEVERANCE_PAY`         | `SEVERANCE`      | Formula on service                                     |
| Taiwan      | `SEVERANCE_PAY`         | `RETIREMENT`     | Formula on service                                     |
| China       | `ECONOMIC_COMPENSATION` | `SEVERANCE`      | Formula on service                                     |
| Vietnam     | `SEVERANCE_ALLOWANCE`   | `FINAL_PAY`      | Formula on months HR counts                            |
| Malaysia    | `TERMINATION_BENEFIT`   | `SEPARATION_PAY` | The higher of the entry's amount and the law's formula |
| Singapore   | `RETRENCHMENT_BENEFIT`  | `GROSS`          | The entry's amount                                     |
| Philippines | `SEPARATION_PAY`        | `GROSS`          | The entry's amount                                     |
| Japan       | `RETIREMENT_ALLOWANCE`  | `RETIREMENT`     | The entry's amount                                     |

A company package above the law is another adhoc row, with its own formula and eligibility.

```text
Employee made redundant in Malaysia after 6 years
Regulation floor: 20 days a year x 6 years x a day's wages

Contract end sealed
  an effect raises the task to pay the termination benefit
HR makes the adhoc entry on TERMINATION_BENEFIT, with the agreed package
Final run pays the higher of the package and the floor
The tax row reads the SEPARATION_PAY subtotal
```

**13th month (Philippines).** PD 851: one twelfth of basic salary earned in the year.

```text
THIRTEENTH_MONTH_PAY (adhoc)
  eligibility  a month of service, dated within the employment
  conversion   the entry's quantity

December on-cycle run: an effect raises the task to pay it by 24 December
HR enters the amount due, and the run pays it in ADDITIONAL_WAGES
```

**Unused leave at exit.**

```text
Contract end sealed
  the contract's effect creates a leave entry
  with encashment true and the days left
The ledger automation posts them as used, and the row prices them in the final run
```

An `ANNUAL_LEAVE` row encashes when its `encash_on_exit` allows it.

### Lifecycle

**New law mid-year.**

```text
Version 8 sealed, effective 1 July
  sync scheduled for 1 July
  entitled 14 -> 16   ADD 2
  entitled 16 -> 16   nothing
```

**Moving country.**

```text
Malaysia to Singapore in June
  pay/GROSS/MY.Y.2026-01-01   stays as history
  pay/GROSS/SG.Y.2026-01-01   starts at zero
```

**Remittance deadline.**

```text
Run created
  effect raises "Remit EPF contributions", with the due date from the effect's lookup
```

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
