# Manual probe matrix

Reference: the probes an operator runs against a running workspace, and the evidence each leaves. They complement the mechanism tests; [the mechanisms, run through](0008-mechanisms-walkthrough.md) describes what each probe should see.

## 1. Environment

- A local workspace only, reset from the public seed plus private demo data.
- The demo data has people in MY, ID and PH. A probe for another jurisdiction needs a test entity made for it.
- Payroll months run sequentially inside each pay group; never skip a month or reuse a later period.
- All monetary comparisons use the seeded currency and the settings rounding rule.

## 2. Baseline payroll

| Probe                                               | Expected                                                                                          | Evidence                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Consecutive cycles, each demo company and pay group | Every cycle creates one run and one payslip per active employee, and its own write posts its rows | Run ids, payslip ids, per-cycle totals |
| Employee totals                                     | Basic, gross, net, deductions, employer cost reconcile to the subtotal chain and catalogue lines  | Per-employee expected/actual           |
| Statutory                                           | Employee and employer amounts match the jurisdiction table for that period and wage band          | Scheme-level expected/actual           |
| YTD                                                 | Sum of period statutory ledger rows; no duplicate YTD row                                         | Ledger extract                         |
| Idempotency                                         | A second on-cycle run for the period is refused; a repeated posting adds no ledger rows           | Second-run diff                        |

## 3. Lifecycle probes

### 3.1 Leaver and leave encashment

See §7.1.

### 3.2 Salary bump across a statutory band

For at least one employee per jurisdiction:

1. Run a cycle at a salary inside a lower statutory band.
2. Apply a raise mid-year so the next full cycle crosses a contribution or tax band/ceiling.
3. Run the next cycles and the next year-to-date calculation.

Expected: each cycle uses the rate effective in that cycle; band tables and ceilings select from the new wage; cumulative statutory history remains correct across the change. Record wage, band, employee/employer amount before and after.

### 3.3 China prior salary and probation

1. An employee with prior-year or prior-month salary history: cumulative IIT counts it only under the same withholding agent.
2. A probation employee: the agreed probation wage is at least 80% of the contracted wage and not below the local minimum; the boundary below either floor is refused.
3. Compare a probation month against the first post-probation month.

Expected: prior salary is correctly consumed or absent by contract; probation floors are enforced or refused with a clear finding. Record the rule and figures.

### 3.4 Allowance proration with unpaid leave

See §7.5.

### 3.5 Off-cycle run and statutory limits

Probe a bonus-only or ad-hoc off-cycle run with no base salary:

1. Run an on-cycle run, then an off-cycle run containing only an eligible bonus/adhoc line.
2. Confirm base pay is not paid again in the off-cycle run.
3. Confirm statutory ceilings/bands apply to the off-cycle wage base (e.g. bonus), not to a phantom monthly salary.
4. Confirm regular-only allowances/leave/claims are excluded unless `off_cycle_eligible`.
5. Run a second off-cycle in the same period and verify cumulative ceilings/YTD.

Expected: off-cycle pay lines exclude base pay; statutory amounts use the actual off-cycle wage; caps and annual ceilings remain correct across on-cycle and off-cycle runs. Record run kind, lines, wage base, cap and expected/actual statutory amounts.

Then probe a leaver: end a contract, pay its last period, key overtime on a paid day, and create an off-cycle run choosing the waiting period under "Earlier periods to carry". Expected: one payslip holding only "Adjustments for earlier periods" lines, net positive; the run's "Earlier periods" tab lists the row as carried. Deleting a paid bonus instead and carrying it off-cycle is refused: the recovery stays outside payroll. Naming an entry or period another run already took is refused: "An entry or amended period it names is already attached to another payroll run."

### 3.6 A run holding its people

While a run is unpaid:

1. Attempt to change the contract of someone on it (rate, allowances, normal hours), or any record of theirs dated in its period or before.
2. Expect "Run N holds this person and is not paid yet. Delete it, correct this, and run again." A change dated after the run's period is allowed.
3. Delete the unpaid run and retry the same change: accepted.
4. Mark a run paid, then seal a new contract version from a date inside its period: accepted. See §7.2.

Expected: nothing of a person moves under an unpaid run; a paid period is corrected at its source. Record run number, attempted change and the refusal or the amendment shown on the next run.

### 3.7 Overtime bands and excessive work

For at least one employee per jurisdiction with an overtime rule:

1. Run a cycle with ordinary overtime inside the band: the correct multiplier.
2. Increase hours beyond the statutory monthly/period cap: expect a warning or refusal, not silent payment.
3. Work too many consecutive days or breach rest-day rules: expect a warning or refusal.
4. Run a cycle with rest-day, holiday and night work to cross the applicable bands.

Expected: warnings appear as findings on the roster entry or explicit refusals with a source; payable bands calculate exactly; no overtime line when the cap is breached under a refusing rule. Record hours, band, multiplier, expected and actual.

## 4. Event-time UI and ledger probes

For each of leave, claim, adhoc and loan:

1. Create the record through the employee or controller UI.
2. Where the writer needs approval, approve it through the policy's approval flow.
3. Verify one ledger row per movement and the projected balance. A loan posts no ledger row.
4. Change its amount, then delete it, before any run: the ledger posts the difference, then the inverse, with no history edit.
5. Create it again, run and pay the period, then change it: the form asks "This period is already paid"; after confirming, the paid payslip is unchanged and the next run lists the period under "Earlier periods".

Expected: leave uses dated half-day slots; claim/adhoc use quantity and unit; loan uses principal and repayment amount; the ledger account/code matches the family convention.

### Work events

1. Create a work event type under Settings → Catalog (a row is the type; no category enum, no suspension catalog).
2. Record a dated entity-wide event (heat period, hurricane, earthquake, epidemic or suspension), optionally narrowed to one employment.
3. Run an allowance whose eligibility reads `ctx.work_events`; confirm it pays only while the event overlaps the run date.
4. Run an ad-hoc/off-cycle entry in the same context; confirm the event qualifies the row but does not pay by itself.
5. Run leave entitlement sync with a leave row whose `entitlement` reads `ctx.work_events`; confirm the event opens the period once.
6. Confirm a workplace case remains employee-specific and is not created by the work event.

Expected: one work event type, one dated event, one allowance/ad-hoc/leave posting; no automatic payment from the event row itself.

## 5. Evidence

Each probe records:

- jurisdiction, version, period, entity and employee;
- expected value, actual value, delta;
- source/evidence link and screenshot or log;
- PASS, FAIL or BLOCKED, with the blocking contract named.

A green automated suite is not acceptance evidence. A red probe is always a defect. Do not fix a probe by widening a timeout, editing expected values to match output, or seeding a result the engine should calculate.

## 6. Further probes

### Payroll

| Probe                               | Expected                                                                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Off-cycle bonus, no base salary     | Base 0; a scheme charged on salary alone charges nothing; tax on the bonus once; net positive                                                                                                                                                           |
| Off-cycle bonus, every jurisdiction | Each statutory row owes what the same bonus owes inside the on-cycle run, both sides, in either order                                                                                                                                                   |
| MY PCB on an off-cycle bonus        | The bonus withholds its additional MTD only; off-cycle plus on-cycle equals one on-cycle bonus, in either order; the month counts once                                                                                                                  |
| SG CPF annual ceiling               | Additional wages attract CPF only up to what the annual ceiling leaves                                                                                                                                                                                  |
| Second salary in a pay month        | A rolled pay date or a mid-month transfer charges each wage month or employer on its own; half-month cycles still combine                                                                                                                               |
| Allowance in a transfer month       | Each company pays its days; a new contract in the same company pays the month once                                                                                                                                                                      |
| Duplicate on-cycle run              | The second run for the pay group and period is refused                                                                                                                                                                                                  |
| Skipped cycle                       | A period behind a later on-cycle run is refused                                                                                                                                                                                                         |
| Marking a run paid                  | The pay date shows only then, keyed in as that day, and is never typed                                                                                                                                                                                  |
| Run paid at once, a full entity     | Every effect finishes, no conflict                                                                                                                                                                                                                      |
| First run deleted and run again     | The rerun posts and can be paid                                                                                                                                                                                                                         |
| Run a later run counted             | Deletion refused; runs come off newest first                                                                                                                                                                                                            |
| A run of about 80 people            | Stays under 2 s of CPU                                                                                                                                                                                                                                  |
| Salary listing export               | One sheet per run; a coloured band per subtotal closed by it; GROSS PAY before the first statutory band; TAX WITHHELD after the tax band; NET PAY; employer's portion; COST TO COMPANY = net + employee contributions + tax withheld + employer portion |
| MY CP38 instalment                  | An ad hoc entry on `CP38_INSTALMENT`: deducted, counted in TAX WITHHELD, posted to its own account; the next month's PCB is as without it                                                                                                               |

### Corrections

| Probe                               | Expected                                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No-pay day removed after its run    | HR removes the day on the leave entry and confirms. The paid payslip stands; the next payslip gives the day's pay back under "Adjustments for earlier periods"    |
| No-pay day added in a paid month    | Accepted after the confirmation. The next payslip takes the day's pay, and allowances that read `ctx.paid_share`, tagged with the paid month; a bonus stays whole |
| Overpaid year                       | A row with `below_zero: REFUND` pays a refund line on that run, once; any other row stops at zero and the next run nets it                                        |
| Wrong bonus deleted after its run   | The next payslip takes the bonus back with its contributions and tax, tagged with its month; the year's tax comes to what it would have been without it           |
| Contribution wrong for a paid month | HR corrects the set-up on the contract from its real date. The next run collects each month's difference under that month, with no lump and no double             |
| Correction put back                 | A record changed and then put back as it was carries nothing on the next payslip                                                                                  |
| Recovery larger than the pay        | Net pay is zero with a line "Recovery carried forward"; the following run takes the rest, once                                                                    |
| Correction under an unpaid run      | Refused with "Run N holds this person and is not paid yet. Delete it, correct this, and run again."                                                               |
| Paid run deleted                    | Refused: a paid run is locked. Correct the record where it was recorded                                                                                           |

### Leave and facts

| Probe                          | Expected                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Staff after a reset            | Every leave type computed from the catalog                                              |
| Leave over the balance         | Refused before commit, with `<code>: insufficient balance.`                             |
| Leave entry deleted            | What it posted is inverted, once                                                        |
| New no-pay entry               | Accepted, no grant needed, no day count shown                                           |
| Contract change                | That person recomputed, nothing repeated; days taken stay taken                         |
| Birth on a contract            | Sealing opens the days once, on the ledger too; the rows of the other parent stay empty |
| Birth filed ahead of its day   | Nothing moves until the day; then one sealed version, and the days open once            |
| Fact removed by a new version  | Takes back what it gave, once; refused while days taken stand on it                     |
| Stepped pay on a real contract | A share of each working day, no weekend                                                 |
| Workplace case                 | Files the record; no balance moves                                                      |

### Employment changes

| Probe                        | Expected                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Contract state               | Sealed shows the lock and Promotion, Life event, Transfer, Terminate, with no status field or Edit; draft shows Edit and Seal |
| Promotion                    | Same employee number, service start preserved; no leave paid out; leave stays                                                 |
| Transfer, cross-jurisdiction | Old leave settles where the row allows; target-driven categories, an old value cleared; the target's fields stored            |
| Sealed overlap               | A draft overlapping an open sealed contract is refused until the predecessor ends                                             |
| Termination                  | A last day and a reason; jurisdiction-specific exit facts stay in `employee_extension_data`                                   |
| Exit encashment              | No entry and no request; the last payslip lists the leave under `cash_out` and the balance ends at zero                       |
| No double payment            | A second run for the period repays no sealed entry                                                                            |
| Balance across a move        | One `employee_balance` row per employee; a term change leaves the row in place                                                |
| Void contract                | Moves to `VOID` with a reason after it was paid; the next run excludes it and works its paid periods out again                |
| Void employer version        | Moves to `VOID`; the next run cannot use it                                                                                   |
| Void jurisdiction version    | Moves to `VOID`; the next run cannot use it                                                                                   |

### Loans

| Probe                           | Expected                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Loan create                     | One loan and its repayments; generated total equals the principal in minor units                          |
| Sealed schedule                 | Sealed rows are never rewritten; regeneration works around them                                           |
| Settlement at termination       | The repayment is stamped with the run and the payslip deducts it; net never falls below the floor         |
| Partial recovery                | The rest stays open on a recalibrated schedule, and HR gets a task                                        |
| Transfer, target has the code   | A new loan and schedule in the target; the old schedule cleared                                           |
| Transfer, target lacks the code | Settles from final pay; no new loan                                                                       |
| Forced settlement               | With the box checked, the loan settles though the target has the code                                     |
| Same-jurisdiction carry         | One loan remains; a cross-entity move repoints it and its open schedule, and successor payroll deducts it |
| Any loan movement               | No ledger row                                                                                             |

### Employee profile and self-service

| Probe                      | Expected                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Employee profile tabs      | Only Profile, Employment contract, Loans, Workplace cases and Entitlement and balances. No Leave, Payslips or Face enrolment tab. |
| Face enrolment             | Available from Profile, not a separate tab.                                                                                       |
| Self-service leave request | The employment selector is hidden when the page already knows the employment; the catalog and calendar remain.                    |

### Ledger, sealing and corrections

| Probe                    | Expected                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unpriced leave slot      | Removing a slot before a run posts the inverse ledger movement only; no pay line appears.                                                          |
| Paid leave slot          | Removing a slot a paid run priced asks for confirmation, returns the half day to the balance at once, and the next payslip carries the pay for it. |
| Slot under an unpaid run | The change is refused: the run holds the person. Delete the run first.                                                                             |
| Full leave cancellation  | Deleting an entry whose slots were all paid returns the leave balance at once and the pay on the next payslip, once.                               |
| Paid loan repayment      | A repayment a paid run took can be changed or deleted after the confirmation; the next payslip carries the difference for its period.              |
| Ledger conservation      | Every posting has one inverse; no negative amount, no duplicate source, and the balance returns exactly after a full cancellation.                 |
| Carried postings         | A carried line posts to the totals of the period it is tagged with, not the period of the payslip that carries it.                                 |
| Work event               | An event never posts by itself; only the allowance/ad-hoc/leave row it qualifies posts.                                                            |

### Roster and kiosk

| Probe                                  | Expected                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Roster person-day                      | One `roster_entry` for the employment and date                                                                           |
| Roster batch, one act                  | All rows commit inside the write's read budget                                                                           |
| Roster workbook, Plan and Work entries | Each sheet writes only its own fields; blank rows and omitted days stay; a sealed day refuses a change, passes unchanged |
| Roster import across people            | One import act: a dry run lists every refused row (person, date, rule) and writes nothing; a clean file writes it all    |
| Overtime warning                       | A finding on the roster entry, not on payroll                                                                            |
| Kiosk punch                            | Create with only `actual_worked_intervals` commits                                                                       |

### Configuration

| Probe                   | Expected                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Settings form, sealed   | Single fields, then tables, then schemas; day rate as code                                                                        |
| Settings form, draft    | Edit and save one lookup value; every other key unchanged                                                                         |
| Minimum wage floors     | Each jurisdiction at the floor passes and one minor unit below refuses; regional and job-nature variants included                 |
| Overtime eligibility    | Each jurisdiction's excluded classes get no overtime line; an eligible person with no overtime hours gets none                    |
| Research run            | Official sources returned; a failed pair fails the run                                                                            |
| Confirming a change     | Refused without an official source and its quoted effective date; verifier stamped                                                |
| Merging a future change | A dated draft; the in-force version untouched; a repeat refused by name                                                           |
| Sealing a release       | Predecessor shortened, no overlap, change `APPLIED`                                                                               |
| Later change            | Builds on the sealed version; an undated change stays out                                                                         |
| Stale change            | Refused by name                                                                                                                   |
| Employment import       | One company, its people and contracts; a second upload adds nothing; a duplicated row closes the older contract before its change |

## 7. Calibration probes

Run against the local demo after `env status` says READY and the demo digest matches the current build.

### 7.1 Effects: exit encashment and final pay

1. Pick a current employee with a positive annual-leave balance on a row with a `payout`.
2. End the contract (effective range `to`, `final_pay_due_on`) through the UI.
3. Expect no leave entry, request or task for the leave. Run the cycle whose salary period holds the last day: the payslip lists each row with a `payout` under `cash_out` for what is left after the exit's proration, paid at the row's `payout`, and its posting leaves the balance at zero. No later on-cycle run creates a payslip for the person.
4. Delete that run and run it again with `encash_leave` switched off in the termination sheet: nothing is paid out and the balance keeps its days. Leave taken beyond what the last day earned is taken back either way.
5. Mark the run paid, then cancel the exit (a successor version): the next run carries the pay-out back under "Adjustments for earlier periods" and the days return.
6. Record balance before, quantity, ledger movement, final net.

### 7.2 Correcting a paid month

Each probe starts with a month run and marked paid. Note the paid payslip's figures first: they must be the same at the end.

**Missed overtime**

1. Open Events → Work, find a day of the paid month, add two hours of planned overtime and the clock that covers it, and save.
2. Open the paid month's payslip: nothing has changed.
3. Create the next month's run and open its "Earlier periods" tab: the person and the paid month are listed as carried by this run.
4. Open the person's payslip in the new run. Under "Adjustments for earlier periods" expect the overtime for the paid month and what it moves in contributions and tax, each tagged with that month. No amount was keyed.
5. Record the carried lines, and compare the two months' net pay with a workspace where the overtime was keyed in time: the totals are equal.

**A deleted claim**

1. Open Events → Claims, pick a claim the paid run paid, and delete it. Changing its amount instead asks "This period is already paid"; confirm with "Save correction".
2. Expect the claim's `used` to return to the balance at once.
3. Run the next month. Under "Adjustments for earlier periods" expect one deduction for the claim, tagged with its month, for exactly what was paid.
4. Delete that unpaid run and create it again: the payslip is the same.
5. Move another paid claim's date into the unpaid month instead of deleting it: the next payslip takes it back for the month it left and pays it as an ordinary line of the month it joined.

**A backdated raise**

1. With three months paid, open the person's contract, choose Promotion from the first of the earliest paid month, and enter a higher rate. Leave the signed date empty, or enter a date before that month's pay date. Seal.
2. Run the next month. Under "Adjustments for earlier periods" expect, for each of the three months, the difference in basic pay and in each contribution and the tax, each month under its own ceiling.
3. On a Singapore or Indonesia test entity, repeat with a signed date in the month being run. Expect no line for the earlier months. The payslip shows the new salary and one line of back pay (`ADDITIONAL_BACKPAY` in SG, `RETROACTIVE_PAY` in ID), and the month's contributions and tax count it by the law's own rule.
4. On another jurisdiction, a signed date changes nothing: the version applies from its start, as in step 2.
5. Void the raise after the run is paid and seal a smaller one with the same dates: the following payslip takes back the difference, contributions included.

**A pay-group move**

1. On a company paying twice a month, open the pay group and change its frequency: expect "This group has paid runs. Make a new group for the new schedule, and move people to it from the first of a month." Changing its name or pay day is accepted.
2. Create a monthly pay group. Move one person to it with a contract version from the first of next month.
3. Run and pay the old group's last periods and the new group's first month.
4. Correct a roster day in a half-month the old group paid.
5. Run the new group's next month. Its "Earlier periods" tab lists the old group's period. The payslip carries the difference tagged with that half-month; the periods after it show no difference.

Also check, once: a correction for a person on an unpaid run is refused until the run is deleted; a request from self-service dated in a paid month shows nothing on the next run until HR approves it, and nothing at all if it is rejected.

### 7.3 Mid-cycle changes

1. Pay bump: a version starting mid-month is refused ("A contract changes from the first of a month"). Seal it from the 1st; run the next cycle; expect the new rate from that date, statutory bands recomputed, YTD carried. File a `contract_change` ahead, then pay a run covering its date before that day: on its day it stays filed and raises a task.
2. Mid-month leaver: end the contract mid-month; expect prorated base pay, final statutory amounts, no later payslip.
3. More children mid-month: add a child/dependant fact and seal; expect the next entitlement sync to open the right leave window and the next tax run to use the new dependant count only from its effective date.
4. For each, record the before/after wage, band, statutory amounts, leave balance and ledger rows.

### 7.4 Transfers

1. Same jurisdiction: create a successor contract with no employment gap; leave and YTD continue, no leave paid out.
2. Transfer out: create a contract in another jurisdiction or end without a successor; the last payslip settles the leave, then a clean new balance under the new entity/version.

### 7.5 Allowance proration with unpaid leave

1. Run a full-paid cycle and note each allowance that reads `ctx.paid_share`.
2. Add NPL in the next cycle; allowance = agreed amount × paid share, exactly the base-pay share.
3. Mix paid leave and NPL; paid leave must not reduce the allowance.

### 7.6 China prior employment

1. Give a contract `prior_employment` rows for the same withholding agent with gross income, employee contributions, months and IIT withheld.
2. Run the first CN payroll of the year; the cumulative taxable base and tax include the prior rows and subtract the prior withholding, not restart from zero.
3. Repeat with a different withholding agent: those rows must not enter the current agent's cumulative base.

### 7.7 Overtime day bands

1. For each pattern (Mon–Fri rest Sat/Sun; Sun–Thu rest Fri/Sat; six-day week), create work entries on a workday, rest day, public holiday and a swapped rest day.
2. The multiplier band follows the entry's day type and the statutory week, not a fixed weekday assumption.
3. Add approved overtime on the nominal rest day that becomes a workday; the band follows the roster day type.
4. Record hours, day type, multiplier, expected and actual line.

### 7.8 Holiday kept on Saturday, weekday in lieu

A holiday the six-day staff keep on the Saturday after, and the five-day staff take on the weekday in lieu. Set it up on a test entity: the weekday row is `ONLY_IF_OFF_ON_REPLACED_DATE`, replacing the Saturday, which is `EVERYONE`. Use it only where the law lets the holiday move; a regular holiday the law fixes to its date stays `EVERYONE`.

1. Open the entity's holiday calendar: the Saturday row is the holiday for everyone; the weekday row names the Saturday it replaces and is given only to those off on it.
2. Run the period with a six-day worker who works the weekday and a five-day worker who works it too.
3. Expect the six-day worker's weekday priced as an ordinary day and their Saturday as the holiday; the five-day worker's weekday priced as the holiday. No one is paid the holiday twice.
4. A six-day worker with no roster entry on the Saturday still counts as working it (the gate reads the pattern).
5. A six-day worker who swapped (OFF on the weekday, working or on leave on the Saturday) is off with pay on the weekday and works or takes leave on the Saturday.
6. Record each person's day type on both dates, the holiday lines and the expected and actual amounts.

### 7.9 Days in lieu and manual adjustments

1. A public holiday on a Sunday: the calendar row that `replaces` it (given only to those off on Sunday) gives Monday to the five-day worker; no leave entry is filed.
2. `PUBLIC_HOLIDAY_IN_LIEU` starts at 0. As `hr_controller`, on the employee profile's balances, add +0.5 dated the day it was earned, cause "worked through the release": one ledger row `manual:<id>` with the note; the balance shows 0.5. A sync afterwards posts nothing.
3. The person requests a half day in lieu: it commits against the 0.5. A second half day is refused (nothing left).
4. Add −0.5 with cause "granted in error": the day already taken stays taken and the balance shows −0.5. The first row cannot be edited or deleted.
5. +2 on `ANNUAL_LEAVE`: adds 2 to the window holding its date; when that year closes, the settlement keeps them and carry counts them like any entitled day.
6. The employee (self-service) and a role without the HR policy cannot add one.
7. +150 on a claim row's limit (`MEDICAL_CLAIM`): one `manual:<id>` row on `limit`; the window's limit rises by 150 and a sync leaves it.
8. Record each adjustment's ledger row (source, measure, amount, note) and the request's acceptance or refusal.

### 7.10 Closing a leave year

1. A Malaysian joiner (service year from 21 May): just before the anniversary the year holds round(8 × completed months ÷ 12); on the anniversary sync settles the closing year at 8 days (+1) and opens the next at 8.
2. At the end of year 2 the settlement posts nothing: the band is the one the year started in (8, not 12).
3. Repeat for SG (service-year bands from 3 months) and VN (calendar year, joiner in July: 6 days).
4. Record the ledger rows of each settlement.

### 7.11 Employer pay methods

1. Set `pay_methods.overtime_hour_basis` = `CONTRACT_WEEKLY` on a Malaysian employer: a 9 h × 5 worker's OT hour is monthly × 12 ÷ (52 × 45) (for example RM10.00 on a wage of RM1,950), not ÷ 26 ÷ 9 (RM8.33).
2. With a 7.5 h × 6 contract both bases give the same rate; no basis ever pays below the statutory rate.
3. Set `rest_day_hourly_multiplier` = 2: an 11 h rest-day shift pays 11 × 2 × the hour rate; a 1 h shift still pays the statutory half day.
4. Set `night_differential_basis` = `CLOCK_SPAN`: a 22:00–06:00 shift with an unpaid 00:30–01:30 break pays 10% of the ordinary hour on all 8 clocked hours, more than the statute's worked hours; a shift where the statute pays more pays the statute. `WHOLE_NIGHT`: a worked night shift earns eight full hours of premium. `contribution_split` = `FIRST_RUN` on a twice-monthly group: the first payslip carries the whole month's contributions and the second settles. `benefit_exclusion` = `EXCESS_TAXED`: a benefit past its own tax-free limit is taxed on the payslip of its month.
5. Taiwan §32-1: mark a workday's 2 h planned overtime "as time off" (roster day or the Plan sheet's `OT as time off` column). The run pays no overtime for it and `COMPENSATORY_TIME_OFF` gains 2 hours; a half day off takes 4 hours (8 h day) and is refused until HR adds 2 hours by hand. Malaysia: 100 h of workday overtime plus 10 h on a rest day raise no monthly-cap warning (EA s.60A(4)(a)).

### 7.12 Exit and rehire

1. End a sealed contract with a reason and no successor: `exit` raises once; the exit duties appear once and nothing is raised for the leave. Save it again: nothing new.
2. Move the end date: the duties of the earlier date are waived and raised for the new one. Cancel the exit (a successor version): the open duties are waived. After the last payslip is paid, switch `encash_leave` off on the ended contract: the next run takes the pay-out back under "Adjustments for earlier periods" and the days return.
3. End a contract and seal a successor the next day: no `exit`.
4. Rehire after a 4-day gap with `cumulative_service` on: leave bands count both stints (2017 + 2025). Turn it off: only the rehire counts, and the next sync posts the difference.
5. Indonesia: end a sealed contract from the termination sheet with a `termination_cause` (efficiency, actual loss): the exit duties (termination report, BPA1, BPJS exit) raise once. Saving a cause without ending the contract, or changing a fact the version already holds, is refused.

### 7.13 UI

1. Settings: all top-level tabs visible; `More` only for genuine overflow.
2. Catalog: every row shows a description; row sheet has no Settings section.
3. Event catalog pickers: only current-version codes, no duplicates.
4. Leave (HR controller): an entry opens in the same calendar form as the employee's leave application, plus the person it is for. Every half-day stays editable, paid ones included. Selected half-days are visibly filled; unavailable ones dimmed. Removing or adding a half-day in a paid period asks "This period is already paid" before it saves. Claims, ad hoc entries and loan repayments ask the same question from their own forms. The payslip of a run that carried something shows "Adjustments for earlier periods", grouped by period; the run shows an "Earlier periods" tab with what it carried and what is waiting for the next run.
5. Profile and entity drawers: top-level tabs use the default segmented variant, not chips; nested tabs step down to underline and then chips. Face stays inside Profile; no seal badge on the leave/loan entry itself.
6. Employer payroll versions: Schedule change opens the form, and filed changes appear under Scheduled changes until their day seals them into a new version.
7. Calculation overview: each catalogue row wraps its description below the code; the info icon opens Eligibility and Payroll amount as labelled code blocks, never one clipped line.
