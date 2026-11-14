# Core mechanisms, run through

One invented example followed from setting up a company to an exit. Each step says what the HR user does, what the system writes, and where it shows. Structure is in [the architecture](0001-hrms-calculation-architecture.md); correcting any step is in [corrections and integrity](0007-corrections-and-integrity.md); each country's own figures are in [statutory coverage](0009-statutory-coverage.md).

**The example.** A company called "Example Co" has one monthly payroll. It hires "the employee" on 3,000 a month. Every name and figure here is invented. To keep the arithmetic visible, the example's law is assumed to say:

- proration by calendar days, rounding to 2 places;
- an annual leave row granting 14 days per service year, carrying one window, with a `payout`;
- a no-pay leave row, `NPL`, with `paid_share` 0;
- a medical claim row with a yearly limit of 500.

A real jurisdiction's rows differ; the mechanism does not.

```mermaid
flowchart LR
  setup[Company, pay group,<br/>pay methods] --> hire[Hire:<br/>stint and first terms]
  hire --> month[The month: roster, leave,<br/>claims, ad hoc, loans]
  month --> run[Payroll run<br/>UNPAID]
  run --> paid[Marked PAID]
  paid --> month
  hire -- sync --> balance[Ledger and balance]
  month -- posting --> balance
  run -- posting --> balance
  balance --> run
  paid -- a correction --> amend[Amendment row]
  amend --> run
  paid --> change[Change of terms]
  paid --> exit[Exit and final pay]
```

## 1. Set up the company

| HR does                                                                                                                                          | The system writes                                                                                                          | Where it shows        |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Creates the company and names its jurisdiction                                                                                                   | An `entity`. Once it has changes or stints its jurisdiction cannot change                                                  | Entities              |
| Fills the bank and the time zone, then adds a change from the company's first day with the employer details the law asks for and any pay methods | The entity's own fields and an `entity_change`. The law's rules check the change; its effects raise the registration tasks | Entities; Obligations |
| Creates the pay group: monthly, pay day 25, cutoff day 1                                                                                         | A `pay_group` with its `payment_schedule`                                                                                  | Entities              |
| Publishes the holiday calendar and defines shifts and shift patterns                                                                             | `holiday`, `shift_definition`, `shift_pattern` rows                                                                        | Entities              |

What to expect:

- **Pay group.** A pay group is one payroll: frequency (monthly, twice a month, every ten days), the pay day of each cycle, how a pay day on a non-working day moves, and the cutoff day.
- **Cutoff.** With cutoff day 1, a cycle's attendance is its own salary days. With a later cutoff, a monthly cycle's attendance runs from last month's cutoff day to the day before this month's.
- **Pay methods.** The employer's optional methods are [section 0's](0001-hrms-calculation-architecture.md#company-methods). Each applies only where it pays at least the law. Which rows read them in each country is in [statutory coverage](0009-statutory-coverage.md).
- **The company screen** shows the company's own fields, what is in force today and one timeline of its changes.

## 2. Hire

| HR does                                                                                                                                                                               | The system writes                                                                                                                                                                                                                                                                                                              | Where it shows                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Creates the person, or invites them and lets the accepted invitation create the profile                                                                                               | An `employee_profile`, with the particulars that never change: date of birth, identity number, gender, bank                                                                                                                                                                                                                    | People                                       |
| On the profile's Contract tab chooses Hire: first day 16 June, 3,000 monthly, normal hours and days, shift pattern, agreed allowances, and what the law asks to be told of the person | In one write: an `employment` from 16 June with its first `contract_terms` and `statutory_parameters` rows, both dated 16 June. The write checks the terms against the law in force that day (minimum wage, hours, category). The law's effects raise the new-hire tasks. The `ledger` automation is scheduled for this person | People; Obligations                          |
| On the Family tab adds a spouse, and a child with a date of birth                                                                                                                     | `dependant` rows. Every count a scheme reads comes from them                                                                                                                                                                                                                                                                   | People                                       |
| Nothing                                                                                                                                                                               | The sync opens the person's `employee_balance` and posts each leave row's `entitled` and each limited claim row's `limit` for the current window. A child's birth date opens the leave rows that name `CHILD_BIRTH`                                                                                                            | The employee profile's balance; self-service |

What to expect:

- **Entitlement is a rule, not a number HR types.** The balance shows `entitled 14` because the row says 14 for this person in this window. If the row prorates a first year or counts service bands, the figure follows that rule.
- **A change known ahead**, such as a raise from next month, is a terms row dated ahead. An expected birth is a dependant with its expected date.

## 3. Roster, attendance and overtime

| HR or the employee does                                                         | The system writes                                                                   | Where it shows |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------- |
| Nothing, for an office worker                                                   | Nothing. A day with no roster row is a day worked as the agreed shift pattern plans | —              |
| Plans a shift worker's month, by hand or by importing the roster workbook       | One `roster_entry` per person and day: the shift, and any planned overtime          | Events → Work  |
| Clocks in and out at the kiosk                                                  | `actual_worked_intervals` on that day's `roster_entry`                              | Events → Work  |
| Marks planned overtime as time off instead of pay, where the law has such a row | `overtime_as_time_off` on the day                                                   | Events → Work  |

What the run will do with it:

- **A supplied roster is the source of truth for that person's cycle.** A planned work day the roster leaves out, with no leave and no published holiday, is an absence. So is a planned work day with no clock. An absence comes off the basic at `PRORATED`; it has no line of its own.
- **Overtime is paid only from the plan.** The clock verifies it and never creates it. A clock on a rest day with no planned overtime pays nothing. If the clock covers at least the employer's `overtime_full_award_percent` of the plan (100 by default), the whole plan is paid. Below that, the clocked time inside the plan is paid, rounded down to the half hour.
- **Overtime taken as time off** pays nothing; the payslip posts the awarded hours to the law's hour-counted leave row.
- **A holiday** applies by its date. Work on it pays the law's holiday row, not the rest-day row. A holiday that replaces one that fell on a rest day is given only to those off on the replaced date. Whether someone was off reads their roster for that date, or their agreed week where the roster has no row.
- **The roster's day type sets the overtime band**, not the weekday: a weekday rostered as a rest day and worked pays the rest-day row, and a Saturday rostered as a work day pays its planned overtime at the workday row.
- **The law's roster rules** refuse a roster day that breaks them. Its roster warnings (daily hours, overtime caps, consecutive days, weekly rest) are worked out when the day is written and kept on the day as findings.
- **Days rostered past a person's last day** are neither absences nor pay.

## 4. Leave

The employee asks for two days of annual leave, 8 and 9 July.

| Step                                    | The system writes                                                                                                                               | Where it shows                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| The employee submits the request        | A `leave_catalog_entry` with four half-day slots, held for approval. Nothing on the ledger                                                      | Self-service; the reviewer's approvals |
| While it waits                          | The four slots are held: a second request for the same days is refused, and the days count against what is left when another request is checked | —                                      |
| A supervisor approves, then HR approves | On the final decision, in one statement: the request is approved and `leave/ANNUAL_LEAVE/<window>/used +2` posts                                | Events → Leave; the balance            |
| Nothing                                 | The law's effects on the entry run now, under the system identity                                                                               | Obligations                            |

What to expect:

- **A request is refused at once** when the window does not hold the days, when leave already covers a half day, or when an unpaid run holds the person for that date.
- **Rejected or withdrawn**, the record is taken back and nothing was posted. Only the requester can withdraw; a reviewer rejects.
- **Paid leave makes no payslip line.** A day of `NPL` does: see the run below.
- **A half day is taken once** across all of a person's leave, until the slot is removed from its entry.

## 5. Claims and ad hoc entries

| HR or the employee does                                              | The system writes                                                                                                | Where it shows  |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------- |
| The employee claims 400 of medical costs                             | A `claim_catalog_entry`, held for the same two review steps. On approval: `claim/MEDICAL_CLAIM/<year>/used +400` | Events → Claims |
| Later the same year, claims 300                                      | The row's limit is 500 and 400 is used, so 100 posts. The entry keeps 300; the run pays the 100 that posted      | Events → Claims |
| HR keys a bonus of 1,000 on the bonus row                            | An `adhoc_catalog_entry`. It posts to the ledger only if its row declares accounts                               | Events → Ad hoc |
| HR keys a refund a fund decided, on the generic statutory refund row | An ad hoc entry. It posts to the account its row names; the next run pays it                                     | Events → Ad hoc |

What to expect:

- **A tax instalment the authority directs** (Malaysia's CP38) is an ad hoc entry. It is deducted and counted as tax withheld. It posts to its own account, so the PCB year-to-date the next months read leaves it out.

## 6. Loans

| HR does                                       | The system writes                                                                 | Where it shows |
| --------------------------------------------- | --------------------------------------------------------------------------------- | -------------- |
| Creates a loan of 1,200 repaid over 12 months | A `loan_catalog_entry`. The row's eligibility rule, if it has one, is checked now | Events → Loans |
| Generates the schedule                        | Twelve `loan_catalog_entry_repayment` rows of 100, one a month                    | Events → Loans |

What to expect:

- **Loans never touch the ledger.** What is outstanding is the principal less the repayments.
- **Each run recovers the instalment dated in its attendance.** A later month's stays open. Recovery is on-cycle only.
- **A recovery that would take net pay below zero refuses the run** and says how; reduce the instalment and run again.

## 7. The payroll run

HR creates the on-cycle run for July, for Example Co's one pay group.

```mermaid
flowchart TD
  create[HR creates the run] --> checks{Law and approvals<br/>in order?}
  checks -- no --> refused[Refused, nothing written]
  checks -- yes --> read[Read everything once:<br/>stints, entries, balance,<br/>open amendment rows]
  read --> calc[One pass per person:<br/>the subtotal chain]
  calc --> carry[Earlier periods worked out again;<br/>differences tagged]
  carry --> write[One write: run, payslips,<br/>seals, ledger rows]
  write --> unpaid[UNPAID: may be deleted]
  unpaid --> paid[PAID: locked]
```

**What it takes.** Everything is read once, before any payslip.

| Source                      | Taken when                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Stints                      | Of this company, covering days of the period, whose terms name this pay group on the period's last day. One payslip per person and stint |
| Roster days and leave slots | Dated in the run's attendance window                                                                                                     |
| Claims and ad hoc entries   | Not yet paid by any run, dated up to the period's end. One dated in a period the person was paid for goes to that period                 |
| Loan repayments             | Dated in the attendance window                                                                                                           |
| Leave cash-outs             | Not yet paid, whatever their date. An exit's leave is no entry: the last payslip settles it from the balance                             |
| Earlier pay                 | The balance's totals for the tax year and the last twelve months                                                                         |
| Amended paid periods        | The open amendment rows of the people it pays, and those periods' records and payslips, through the tax year's end                       |

**The subtotals, in order.** Suppose July has 31 days and the employee took one day of `NPL`.

```text
BASIC        3,000.00   the agreed salary
PRORATED     3,000.00   less days not employed and absences (none in July)
PAID_BASIC   2,903.23   less the NPL line: 3,000 ÷ 31 for one day
...          + allowances, overtime, the 100 claim, the 1,000 bonus, each at the subtotal its row names
statutory    each scheme in dependency order, on the subtotal its law names
NET          after employee contributions, tax and the 100 loan instalment
...          then any difference for an earlier period, each line tagged with its period
```

In June, the joining month, `PRORATED` was 1,500.00: 15 of 30 calendar days from 16 June.

**What it writes, in one write.**

| Written                     | Detail                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| The `payroll_run`, `UNPAID` | Company, pay group, period, salary coverage and pay date. None of these is typed. The run prices on the law in force on its pay date |
| One `payslip` per person    | Totals and the breakdown as calculated: checkpoints, lines, statutory amounts                                                        |
| The seals                   | `payroll_run_id` on every roster day, leave slot, claim, ad hoc entry and repayment it priced                                        |
| The amendment rows it took  | `payroll_run_id` on each `pay_amendment` row it carried; one new row where a recovery is carried forward                             |
| Ledger rows                 | Each checkpoint as `pay/…/total`, each scheme as `statutory/…/paid`, for the year and where named the month                          |

The law's run effects then raise the period's tasks: remittances, filings, payslip issue. See Obligations.

**The run refuses**, and writes nothing, when: no law is in force on its pay date; a later cycle of the group has already run; the group already ran this period; an entry it would pay, or one in a period it works out again, still waits for approval; or a loan recovery would take someone below zero.

**Off-cycle.** An off-cycle run is for what cannot wait: a bonus or severance. HR names the ad hoc entries it pays. Only their people get a payslip, and it pays no salary. Only rows marked `off_cycle_eligible` may be named; a recurring item is refused. Statutory schemes still apply, on the month's total, so the month owes the same as if the entry had gone on-cycle. A leaver's off-cycle run goes on the period of their last day, for their own pay group. An off-cycle run carries earlier periods only when HR names them; it never takes money back. It refuses an entry or amended period another run already took.

## 8. Payslip, salary listing and bank file

| HR does                              | The system writes                                    | Where it shows |
| ------------------------------------ | ---------------------------------------------------- | -------------- |
| Opens the run and reads each payslip | Nothing                                              | Payroll        |
| Exports the salary listing           | A spreadsheet built from the run's payslips          | Payroll        |
| Exports a bank file                  | A bank payment file in one of the template's layouts | Payroll        |

The salary listing is one sheet per run. Every figure is a payslip's own line or total, so each can be traced. An export reads the run; it changes nothing.

- **Who.** Position, department, employee code, name, ID number, date joined, last day. Frozen through the name.
- **Bands.** The law's subtotal chain, in order, each in its own colour. Each band holds the lines that move it (what adds is positive, what takes off negative) and closes on its subtotal. A line identical to its band's subtotal shows once.
- **GROSS PAY** stands before the first band that holds a statutory deduction.
- **TAX WITHHELD** comes right after the band that holds the tax. It counts every tax the payslip withholds: the tax scheme and any instalment the authority directs (Malaysia's PCB and CP38).
- **NET PAY**, then the **employer's portion**, one column per scheme.
- **COST TO COMPANY** = net pay + employee contributions + tax withheld + employer portion.
- A `TOTAL` row sums each column.

While the run is `UNPAID` it can be deleted, newest first; while it stands, nothing of the people it holds can be changed.

## 9. Marking paid

| HR does               | The system writes                                                                                                 | Where it shows |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------- |
| Marks the run as paid | The run moves to `PAID`. The paid date is the moment of this move. The entitlement sync is scheduled for everyone | Payroll        |

A paid run cannot be deleted and its payslips never change. The employee sees the payslip in self-service. What the run priced can still be corrected at its source: see the next section.

## 10. Correcting a paid month

July is paid. HR finds that two hours of planned overtime on 14 July were never keyed.

| HR does                                                   | The system writes                                                                                                                                      | Where it shows                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Opens the roster day of 14 July, adds the hours and saves | The roster day, and one `pay_amendment` row: the employee, the pay group, July. The July payslip does not change                                       | —                                         |
| Creates the August run                                    | It works July out again on the records as they stand, takes the difference from what July paid, and puts it on the August payslip as lines tagged July | Payroll → the run's "Earlier periods" tab |
| Reads the August payslip                                  | Under "Adjustments for earlier periods": the overtime for July, and what it moves in contributions and tax, posted to July's own totals                | The payslip                               |
| Marks August paid                                         | The amendment row stays, held by the August run: it is done                                                                                            | Payroll                                   |

HR keys no amount and picks no period: the correction is the record itself, with its real date. The whole rule, with what is carried, what is refused and how approvals fit, is in [corrections and integrity](0007-corrections-and-integrity.md).

## 11. Balances and the ledger

Each person has one balance. What a person or HR reads:

| Shown                    | Comes from                                                             |
| ------------------------ | ---------------------------------------------------------------------- |
| Entitled                 | The sync, from the row's rule and the person's facts; HR's manual rows |
| Carried                  | The sync, from the window before                                       |
| Used                     | Leave and claim entries                                                |
| Left                     | `entitled + carried + limit − used`, worked out, never stored          |
| Pay and statutory totals | Payslips                                                               |

An employee reads their own balance and ledger in self-service; HR reads them on the employee profile, where it adds manual adjustments. How the ledger is keyed and written is in [the architecture](0001-hrms-calculation-architecture.md#6-ledger-and-balance).

When the law changes an entitlement, the balance moves by the difference. If the law raises the example's 14 days to 18, the sync posts `entitled +4`. Days already taken stay taken.

## 12. Year or window turnover

Nothing is closed and nothing is typed.

| When                                                                         | The system writes                                                                                                                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The employee's service year turns (16 June next year)                        | The closing window settles once, under the law and the terms of its last day. A new window opens with a new key: `entitled 14`, and `carried` by the row's carry rule |
| A calendar-year row turns on 1 January                                       | The same, for everyone on that row                                                                                                                                    |
| The first pay date of a new tax year                                         | The run reads an empty year: pay and statutory totals start again                                                                                                     |
| A month total passes a year old; a year or service window passes three years | It leaves the balance through a dated ledger row. The ledger keeps every row                                                                                          |

In the example, with 5 of 14 days left at the turn and a carry of one window, the new window shows `entitled 14, carried 5`. Without a carry rule the 5 days lapse.

A tax row settles the year by its own law, inside the ordinary run: there is no year-end step.

## 13. A change of terms

The employee is promoted to 3,500 from 1 October.

| HR does                                                                                                     | The system writes                                                                                                                                                                         | Where it shows |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| On the Contract tab adds a change from 1 October: the new rate, the new job title and the day it was signed | One `contract_terms` row dated 1 October, holding only what changed. The write checks the employment as it stands from that day against the law. Dated ahead, the row is not yet in force | People         |
| Nothing                                                                                                     | The sync runs for this person: at once for a row in force today, otherwise on its day. The stint, the balance, the service start and any loan carry on                                    | The balance    |

What to expect:

- **A change may start in a month already paid.** The row takes its real date, and its signed date decides whether the paid months are worked out again or the signing month pays back pay ([how a period reads the employment](0007-corrections-and-integrity.md#3-how-a-period-reads-the-employment)).
- **A wrong change** is edited, moved or deleted on its own row ([dated changes](0011-dated-changes.md#3-writing)).
- **What the law is told of the person**, such as a new residency or marital status, is a `statutory_parameters` row from the first of a month, on the Statutory parameters tab.
- **A transfer** to another company is one sheet: see [transfer semantics](transfer-semantics.md).
- **A life event** keeps its real date: a birth is a dependant, and a marriage or a long illness an event on the stint. The leave it opens appears on the balance after the save.

## 14. An exit

The employee resigns; the last day is 20 November.

| HR does                                                                                        | The system writes                                                                                                                                                                        | Where it shows              |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| On the Contract tab chooses Terminate: last day, reason, exit ground, whether to pay out leave | The stint ends on 20 November. With no later stint under the same law, that is an exit                                                                                                   | People                      |
| Nothing                                                                                        | The law's exit effects raise the exit duties, each keyed to this exit                                                                                                                    | Obligations                 |
| Nothing                                                                                        | The sync prorates the leaving year's entitlement by the row's rule                                                                                                                       | The balance                 |
| Confirms the loan settlement the Terminate sheet proposes                                      | A final settlement repayment, up to what the employer's final-pay floor leaves. The rest is rescheduled and one task asks HR to chase it                                                 | Events → Loans; Obligations |
| Keys any notice pay or severance as ad hoc entries                                             | Ad hoc entries on the law's rows                                                                                                                                                         | Events → Ad hoc             |
| Runs November                                                                                  | The final payslip: salary for 1 to 20 November, the leave left paid out at the row's `payout`, the loan settlement, the entries. Its posting takes the days, so the balance ends at zero | Payroll                     |

What to expect:

- **The final run is the one covering the last day.** It pays everything up to that day; while the exit stands, no later on-cycle run pays this person.
- **The leave is settled by the final payslip,** as [section 0](0001-hrms-calculation-architecture.md#exits) says. What follows a changed decision, a moved last day or a cancelled exit is in [corrections and integrity](0007-corrections-and-integrity.md#11-when-an-exit-is-cancelled-or-its-date-moves).
