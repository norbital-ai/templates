# How this HRMS works

For HR and payroll professionals. It explains the ideas behind the system in plain terms, without code. [The calculation architecture](0001-hrms-calculation-architecture.md) holds the technical detail.

## The idea in one paragraph

Everything the system knows about the law and your company's rules lives in **catalogs**. Everything that happens to a person is recorded as an **entry** against a catalog. Payroll reads those entries and works through **one straight calculation**, from pay down to net pay. When something happens that needs follow-up, an **effect** raises a task or runs an automation. **Balances** keep running totals, so nothing has to be worked out from history. When something was wrong, HR corrects it with a new entry, and nothing is ever overwritten.

```text
Catalogs          what the rules are
   |
Entries           what happened
   |
Payroll           one straight calculation, pay down to net pay
   |
Ledger            every movement, permanently recorded
   |
Balances          the running totals people see
```

## 1. Catalogs hold the rules

A catalog is a list of items, and each item describes how one thing behaves: a leave type, an allowance, a claim, a loan, a statutory scheme.

An item says who it applies to, how much it is worth, where it sits in the calculation, and whether it adds to pay or takes from it.

| Catalog        | Holds                                                | Example                      |
| -------------- | ---------------------------------------------------- | ---------------------------- |
| Leave          | Leave types, their entitlement and how a day is paid | Annual leave, unpaid leave   |
| Allowance      | Fixed pay on the contract, and whether it prorates   | Transport, meal              |
| Overtime       | Overtime rates                                       | Rest day overtime            |
| Claim          | What staff can claim back                            | Medical claim                |
| Adhoc          | One-off pay and deductions                           | Bonus, severance, EPF refund |
| Statutory      | Tax and contributions, with their tables and rates   | Income tax, pension, health  |
| Loan           | Loans and how they are repaid                        | Staff loan                   |
| Workplace case | Things filed at work                                 | A complaint, an accident     |

**Why this matters.** When the law changes, or your company's policy does, you change a catalog item. The way the system calculates does not change. A new law becomes a new dated version of the country's settings, and earlier periods stay on the rules that applied at the time.

## 2. Entries record what happened

An entry is one dated event against a catalog item: two days of leave, a bonus, a claim. It records what happened, never how it is priced. Pricing is the catalog's job.

Once a payroll run has used an entry, the entry is locked.

## 3. Payroll is one straight calculation

Payroll runs top to bottom, once, in one line. There are no separate stages and no special paths. Each **checkpoint** (a subtotal) is the one before it plus its own lines, and the last checkpoint is net pay.

```text
Salary for the period
  - no-pay days
  + allowances
  + overtime
  = ordinary wages        <- checkpoint
  + bonuses
  = additional wages      <- checkpoint
  + severance
  = gross                 <- checkpoint
  - tax and contributions
  - loans and deductions
  = net pay               <- last checkpoint
```

Each country names its own checkpoints. Statutory schemes read the checkpoint their law bases them on, so a contribution always works from the figure the law names. Nothing inspects individual lines to decide what to do.

No line on a payslip is ever negative, and no amount in the ledger is either.

There are two kinds of run:

- **On-cycle payroll** is the regular run for a pay period.
- **Off-cycle payroll** is for adjustment entries and one-off lump sums such as a bonus or severance. Anything recurring belongs on-cycle.

A run is either unpaid or paid. An unpaid run can be deleted, and its entries go back to waiting for a run. A paid run is final.

## 4. Effects start what happens next

When something happens, an **effect** can raise a task for HR or start an automation. The catalogs say which effects exist, so they are visible and can be changed like any other rule.

| When this happens                   | This follows                                    |
| ----------------------------------- | ----------------------------------------------- |
| A payroll run is created            | Remittance and filing tasks for the period      |
| A contribution is corrected         | A task to settle it with the fund               |
| A contract is sealed                | That person's leave is worked out               |
| A country's rules change            | Everyone's leave is worked out again            |
| A life event is added to a contract | The leave it gives is opened on the balance     |
| 30 sick days in 45, with no illness | A task to record a long illness on the contract |

**Rules** are the other half. A rule checks an entry before it is accepted and refuses it with a plain reason, such as a date in a period that has already run.

## 5. Balances keep the running totals

A balance holds what a person has so far: leave left, year-to-date pay, contributions paid. Payroll reads these totals, so it never has to look back through old payslips, and a run stays fast.

A balance holds accumulated values and entitlements, and nothing else. Behind every balance is the **ledger**, a permanent record of every movement. Every day and every amount in a balance comes from a movement in the ledger, and movements are never edited or removed. A movement and its balance are saved together, so they cannot disagree. If the system stops part-way and repeats a step, nothing moves twice.

Leave entitlement moves as a difference. If the entitlement rises from 14 days to 18, the balance rises by 4, and days already taken stay taken. At a new year the balance starts again, with carry-forward where the catalog allows it.

## 6. Two ways to correct something

Nothing is overwritten and nothing fixes itself. HR makes every correction, with a new entry, so there is always a record of what was wrong and who corrected it.

There are two kinds, and which one you use depends on what was wrong.

**A reversal entry corrects a mistake on an item.** It is a new entry on the **same** catalog item, made by the HR controller from Events, who picks the past sealed entry it reverses: an annual leave reversal is against an annual leave entry a run has already sealed. It undoes the original.

```text
June    Unpaid leave, 1 day               pay down by one day
July    Unpaid leave, 1 day, reversal     pay back the same amount
```

**An adjustment entry corrects a contribution for a closed month.** Each month's contribution stands alone and the money is already at the fund, so the catalog has an item for each scheme that **is** the correction.

```text
June's EPF used the wrong rate: RM100 too much
  -> HR enters EPF refund, 100, dated June
  -> the next run pays the employee
  -> a task reminds HR to claim it back from the fund
```

**Tax needs no entry.** Each tax row settles the year by its own law. Where the law has the employer repay, the run pays a refund line by itself. Where it does not, the row stops at zero and the next run nets it.

| What was wrong                      | Use                                      | Example                               |
| ----------------------------------- | ---------------------------------------- | ------------------------------------- |
| An entry that has already been paid | Reversal entry on the same item          | A leave day that was never taken      |
| A wage                              | Reversal entry; the contribution follows | A bonus paid twice                    |
| A contribution rate, month closed   | Adjustment entry for that scheme         | EPF at the wrong rate in March        |
| An entry not yet paid               | Delete it                                | A wrong date on an open entry         |
| A fact on a contract                | A new version without it                 | An event recorded on the wrong person |

**Corrections carry through.** The next run's statutory figures count the total actually paid in the month. If a wrong payment moved someone across a contribution band, the next cycle works from the corrected total, so the statutory position comes right without a separate fix.

## 7. Life events are facts on the contract

Some leave depends on something happening: a birth, a marriage, a bereavement, a long illness. The contract is sealed and is what payroll reads, so these facts live there, and the document is uploaded on the employee profile.

```text
HR adds the event to the contract and seals it
        |
The leave it gives opens on the balance
        |
Leave taken against it is a normal leave entry
```

The leave type gives no days by itself, and nothing refills it by the calendar. A second birth is a second event, and leftover days do not stack.

**Pay that steps down** stays on one leave type. Indonesia pays long illness at 100% for four months, 75% for four, 50% for four, then 25%. Sick days stay at full pay until HR records the illness on the contract, which starts the count. Ending it ends the count.

**Workplace cases** file things that happen at work: a complaint, an accident, a request, a dispute. They never change a balance. If one changes pay, HR makes the entry.

## 8. What the system will not do

- It will not change a figure on its own. A correction is always an HR entry.
- It will not invent pay. Attendance stays as recorded, and pay with no attendance behind it is flagged for HR.
- It will not refill leave by the calendar. Days taken stay taken until a new year or a new event.
- It will not bury the law in the calculation. What varies by country, law or company policy lives in a catalog, where you can read it and change it.

## Terms

| Term              | Meaning                                                            |
| ----------------- | ------------------------------------------------------------------ |
| Catalog           | A list of rules for one kind of thing                              |
| Entry             | One dated event against a catalog item                             |
| Checkpoint        | A running subtotal in the calculation                              |
| Effect            | Something that follows automatically from an event, such as a task |
| Rule              | A check that accepts or refuses an entry                           |
| Ledger            | The permanent record of every movement                             |
| Balance           | A person's running totals, built from the ledger                   |
| Reversal entry    | A new entry on the same item that undoes a mistake                 |
| Adjustment entry  | An entry on an item that is itself the contribution correction     |
| Workplace case    | Something filed at work: an incident, request or notice            |
| On-cycle payroll  | The regular run for a pay period                                   |
| Off-cycle payroll | A run for adjustment entries and one-off lump sums                 |
