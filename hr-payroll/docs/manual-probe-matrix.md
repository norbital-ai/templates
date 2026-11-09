# Manual probe matrix

Status: normative manual verification checklist. [The model contract](0002-model-specification.md) defines the models; this document defines the probes an operator runs against a live environment and the evidence each leaves.

## 1. Environment

- Local Colony only, reset from the public seed plus the private demo bank.
- One demo entity per jurisdiction: CN, ID, JP, MY, PH, SG, TH, TW, VN.
- At least 30 employees per entity, each with a sealed contract, bank account and opening balance.
- Payroll months run sequentially inside each entity; never skip a month or reuse a later period.
- All monetary comparisons use the seeded currency and the settings rounding rule.

## 2. Baseline payroll

| Probe                                                   | Expected                                                                                          | Evidence                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 12 consecutive cycles × 9 jurisdictions × ≥30 employees | Every cycle creates one run and one payslip per active employee, and its own write posts its rows | Run ids, payslip ids, per-cycle totals |
| Employee totals                                         | Basic, gross, net, deductions, employer cost reconcile to the subtotal chain and catalogue lines  | Per-employee expected/actual           |
| Statutory                                               | Employee and employer amounts match the jurisdiction table for that period and wage band          | Scheme-level expected/actual           |
| YTD                                                     | Sum of period statutory ledger rows; no duplicate YTD row                                         | Ledger extract                         |
| Idempotency                                             | A second on-cycle run for the period is refused; a repeated posting adds no ledger rows           | Second-run diff                        |

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

### 3.6 Contract lock during a run

While a run covers a period:

1. Attempt to change the employee's contract terms (rate, allowances, normal hours, bank details) for that period.
2. Expect a refusal naming the capturing run; unrelated future-dated changes remain allowed.
3. Delete the unpaid run and retry the same change.

Expected: the run captures the contract version it calculated, and its input cannot change underneath it. Record run id, attempted change and refusal.

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
4. As the HR controller, reverse it with a reversal entry on the same item and verify the inverse movement with no history edit.

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

| Probe                                  | Expected                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Off-cycle bonus, no base salary        | Base 0; a scheme charged on salary alone charges nothing; tax on the bonus once; net positive                                          |
| Off-cycle bonus, every jurisdiction    | Each statutory row owes what the same bonus owes inside the on-cycle run, both sides, in either order                                  |
| MY PCB on an off-cycle bonus           | The bonus withholds its additional MTD only; off-cycle plus on-cycle equals one on-cycle bonus, in either order; the month counts once |
| SG CPF annual ceiling                  | Additional wages attract CPF only up to what the annual ceiling leaves                                                                 |
| Second salary in a pay month           | A rolled pay date or a mid-month transfer charges each wage month or employer on its own; half-month cycles still combine              |
| Allowance in a transfer month          | Each company pays its days; a new contract in the same company pays the month once                                                     |
| Duplicate on-cycle run                 | The second run for the entity and period is refused                                                                                    |
| Skipped cycle                          | A period behind a later on-cycle run is refused                                                                                        |
| Marking a run paid                     | The pay date shows only then, keyed in as that day, and is never typed                                                                 |
| Run paid straight after it was created | Refused until posted; no effect fails                                                                                                  |
| Run paid at once, a full entity        | Every effect finishes, no conflict                                                                                                     |
| First run deleted and run again        | The rerun posts and can be paid                                                                                                        |
| Run a later run counted                | Deletion refused; runs come off newest first                                                                                           |
| A run of about 80 people               | Stays under 2 s of CPU                                                                                                                 |

### Corrections

| Probe                                 | Expected                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| No-pay day cancelled after its run    | HR enters a reversal on the same item, dated in the next period; that run pays it. A date in a period that has run is refused                  |
| No-pay day and allowances             | Allowances that read `ctx.paid_share` fall with the day; a bonus stays whole; the reversal gives back what was taken, though the months differ |
| Overpaid year                         | A row with `below_zero: REFUND` pays a refund line on that run, once; any other row stops at zero and the next run nets it                     |
| Wrong bonus reversed                  | Premiums and year-end tax come to what they would have been without it                                                                         |
| Contribution wrong for a closed month | The adjustment entry moves that scheme's balance, a task raises, and the next run pays it                                                      |

### Leave and facts

| Probe                          | Expected                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Staff after a reset            | Every leave type computed from the catalog                                              |
| Leave over the balance         | Refused before commit, with `<code>: insufficient balance.`                             |
| Leave entry deleted            | What it posted is inverted, once                                                        |
| New no-pay entry               | Accepted, no grant needed, no day count shown                                           |
| Contract change                | That person recomputed, nothing repeated; days taken stay taken                         |
| Compute leave on the profile   | Runs for that person; a repeat writes nothing                                           |
| Birth on a contract            | Sealing opens the days once, on the ledger too; the rows of the other parent stay empty |
| Birth filed ahead of its day   | Nothing moves until the day; then one sealed version, and the days open once            |
| Fact removed by a new version  | Takes back what it gave, once; refused while days taken stand on it                     |
| Stepped pay on a real contract | A share of each working day, no weekend                                                 |
| Workplace case                 | Files the record; no balance moves                                                      |

### Employment changes

| Probe                        | Expected                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Contract state               | Sealed shows the lock and Promotion, Life event, Transfer, Terminate, with no status field or Edit; draft shows Edit and Seal |
| Promotion                    | Same employee number, service start preserved; no encashment; leave stays                                                     |
| Transfer, cross-jurisdiction | Old leave settles where the row allows; target-driven categories, an old value cleared; the target's fields stored            |
| Sealed overlap               | A draft overlapping an open sealed contract is refused until the predecessor ends                                             |
| Termination                  | A last day and a reason; jurisdiction-specific exit facts stay in `employee_extension_data`                                   |
| Exit encashment              | The days post as used and pay in `FINAL_PAY`                                                                                  |
| No double payment            | A second run for the period repays no sealed entry                                                                            |
| Balance across a move        | One `employee_balance` row per employee; a term change leaves the row in place                                                |
| Void contract                | Moves to `VOID` with a reason after it was paid; the next run excludes it                                                     |
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
| Entitlement and balances   | The employee balance `account` is displayed raw, not wrapped in a table or a synthetic record representation.                     |
| Face enrolment             | Available from Profile, not a separate tab.                                                                                       |
| Self-service leave request | The employment selector is hidden when the page already knows the employment; the catalog and calendar remain.                    |

### Ledger, sealing and reversals

| Probe                   | Expected                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Sealed leave slot       | A leave slot captured by a run cannot be edited or deleted. The entry refuses the change.                                                 |
| Uncaptured leave slot   | Removing a slot before a run posts the inverse ledger movement only; no pay line appears.                                                 |
| Partially paid leave    | A reversal names the original entry and only the captured subset. The ledger posts the inverse once; the next run repays only those days. |
| No double reversal      | A second reversal of the same slot is refused. A reversal outside the captured set is refused.                                            |
| Full leave cancellation | A reversal containing every captured slot returns the leave balance and pay to zero, once.                                                |
| Sealed loan repayment   | A repayment captured by a run cannot be edited; corrections use the loan schedule's own route.                                            |
| Ledger conservation     | Every posting has one inverse; no negative amount, no duplicate source, and the balance returns exactly after a full cancellation.        |
| Work event              | An event never posts by itself; only the allowance/ad-hoc/leave row it qualifies posts.                                                   |

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

## 7. Owner calibration probes (2026-11-09)

Run against the local demo after `env status` says READY and the demo digest matches the current build.

### 7.1 Effects: exit encashment and final pay

1. Pick a current employee with a positive annual-leave balance on a row with a `payout`.
2. End the contract (effective range `to`, `final_pay_due_on`) through the UI.
3. Expect an encashment leave entry immediately, before any run; quantity equals the remaining balance; the next final run posts it into FINAL_PAY; no later cycle creates a payslip for the person.
4. Record balance before, entry id, quantity, ledger movement, final net.

### 7.2 Ledger: reversal, deletion, addition

1. Create a leave entry, run payroll, reverse one captured half-day.
2. Expect exactly one inverse ledger row (same account/code/period, opposite operation), original row untouched, original slot still `payroll_run_id`.
3. Reverse the same original again: refused (one reversal per original).
4. Delete a captured slot: refused with "Create a reversal"; delete an unpriced slot: accepted and ledger inverted once.
5. Add a new entry after reversal: allowed, posts once, balance returns to the expected figure.

### 7.3 Mid-cycle changes

1. Pay bump mid-month: change the rate for the next contract version; run the next cycle; expect the new rate from its effective date, statutory bands recomputed, YTD carried.
2. Mid-month leaver: end the contract mid-month; expect prorated base pay, final statutory amounts, no later payslip.
3. More children mid-month: add a child/dependant fact and seal; expect the next entitlement sync to open the right leave window and the next tax run to use the new dependant count only from its effective date.
4. For each, record the before/after wage, band, statutory amounts, leave balance and ledger rows.

### 7.4 Transfers

1. Same jurisdiction: create a successor contract with no employment gap; leave and YTD continue, no encashment.
2. Transfer out: create a contract in another jurisdiction or end without a successor; leave settles by encashment, final pay, then a clean new balance under the new entity/version.

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

1. Set `pay_methods.overtime_hour_basis` = `CONTRACT_WEEKLY` on a Malaysian employer: a 9 h × 5 worker's OT hour is monthly × 12 ÷ (52 × 45) (RM9.88 on RM1,927), not ÷ 26 ÷ 9 (RM8.24).
2. With a 7.5 h × 6 contract both bases give the same rate; no basis ever pays below the statutory rate.
3. Set `rest_day_hourly_multiplier` = 2: an 11 h rest-day shift pays 11 × 2 × the hour rate; a 1 h shift still pays the statutory half day.
[amount]. Set `night_differential_basis` = `CLOCK_SPAN`: a [amount]:[amount]–[amount]:[amount] shift with an unpaid [amount]:[amount]–[amount]:[amount] break pays [amount]% of the ordinary hour on all [amount] clocked hours (₱[amount] a shift on the Company C rate), against ₱[amount] by statute; a shift where the statute pays more pays the statute.
5. Taiwan §32-1: mark a workday's 2 h planned overtime "as time off" (roster day or the Plan sheet's `OT as time off` column). The run pays no overtime for it and `COMPENSATORY_TIME_OFF` gains 2 hours; a half day off takes 4 hours (8 h day) and is refused until HR adds 2 hours by hand. Malaysia: 100 h of workday overtime plus 10 h on a rest day raise no monthly-cap warning (EA s.60A(4)(a)).

### 7.12 Exit and rehire

1. End a sealed contract with a reason and no successor: `exit` raises once; encashment requests and exit duties appear once. Save it again: nothing new.
2. Move the end date: duties follow the new date. Cancel the exit (a successor version): the open duties close. The held encashment request of a moved or cancelled exit stays open until HR rejects it by hand (owner).
3. End a contract and seal a successor the next day: no `exit`.
4. Rehire after a 4-day gap with `cumulative_service` on: leave bands count both stints (2017 + 2025). Turn it off: only the rehire counts, and the next sync posts the difference.
5. Indonesia: end a sealed contract from the termination sheet with a `termination_cause` (efficiency, actual loss): the exit duties (termination report, BPA1, BPJS exit) raise once. Saving a cause without ending the contract, or changing a fact the version already holds, is refused.

### 7.13 UI

1. Settings: all top-level tabs visible; `More` only for genuine overflow.
2. Catalog: every row shows a description; row sheet has no Settings section.
3. Event catalog pickers: only current-version codes, no duplicates.
4. Leave (HR controller): an entry opens in the same calendar form as the employee's leave application, plus the person it is for. Its open half-days stay editable; no `Reverses` field on a forward entry. `Reverse entry` asks which of the entry's sealed half-days to reverse, and files the reversal; a reversal is never created from the blank form. Selected half-days are visibly filled; unavailable ones dimmed. Claims work the same way: `Reverse entry` on a sealed claim asks what of it to reverse. A reversal no run has consumed yet is cancelled by deleting it (the ordinary delete): it disappears, its ledger movement is undone and the original stays sealed; once a run has paid it, delete is refused.
5. Profile and entity drawers: top-level tabs use the default segmented variant, not chips; nested tabs step down to underline and then chips. Face stays inside Profile; no seal badge on the leave/loan entry itself.
6. Employer payroll versions: Schedule change opens the form, and filed changes appear under Scheduled changes until their day seals them into a new version.
7. Calculation overview: each catalogue row wraps its description below the code; the info icon opens Eligibility and Payroll amount as labelled code blocks, never one clipped line.

## 8. Salary listing reconciliation (norbital_hr demo)

Every payslip of the demo's January–June runs against the customer's salary listing, line by line. The rule the seed follows: **a company method that pays at least what the law requires is followed; one that pays less, or withholds wrongly, is replaced by the law.** A one-off (a single month that departs from the company's own method) is not a method: the attendance stands and the line is a recorded difference.

Listings: `the private seed`. Run each entity from January, importing each month's roster workbook first (`the private seed`). Company A has no June listing; Company C pays two halves a month (MID MONTH, END MONTH).

**Method (owner, 2026-11-10): exact tally, month by month.** Go entity by entity, one month at a time, in order. For each month, compare every payslip line with the listing's column for that person, to the cent. There is no tolerance: a cent apart is a mismatch until its cause is named.

Report each month as one table: person, line, run value, listing value, difference, and verdict:

- **Match:** equal to the cent.
- **Explained:** different, with its cause named in §8.1a–8.4 (the law applies, a recorded one-off, a seed correction).
- **Unexplained:** anything else. It is a bug in source or seed, or a question for the customer, until proved otherwise.

A month passes when every line is Match or Explained. Record each month as its own row in `.agent/TEST_MATRIX.md`, N2–N7 (January to June): run id, payslip count, the three counts, and every Explained and Unexplained line with its cause.

### 8.1 Every entity

| Check                   | Expect                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Headcount               | one payslip per person employed in the period, the same people as the listing         |
| Basic                   | match, joiners and leavers prorated by the settings' basis                            |
| Allowances              | match (flat agreed amounts; prorated only where the row says)                         |
| Statutory contributions | match, given the same wages; a difference only follows a wage difference listed below |
| Net                     | gross − deductions; differs only by the differences below                             |

### 8.1a How each listing rounds (proved from the files, `.tmp/hr-rounding/`)

A company rounding that never pays the employee less than the statute is followed; one that sometimes pays less is replaced by the law, and the cents it moves are recorded differences, explained to the sen.

| Entity | Line                          | Listing's rule (match)                                                                                                                                              | Applies                                                                                                                                         |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Company A  | OVER-TIME                     | hour = round2(basic × [amount] ÷ hours a year); band rate = round2(hour × [amount]/[amount]/[amount]); round2(rate × hours) per calendar month in the 21st–20th window, summed ([amount]/[amount]) | law: pays [amount]–[amount] less than EA s.60I in [amount] person-months                                                                                    |
| Company A  | INCENTIVE (OT)                | same hour rate and rounding as OVER-TIME                                                                                                                            | each hour priced by the type of the day its work entry falls on (work, rest, off, public holiday), from correct work entries and shift patterns |
| Company A  | NO PAY LEAVE                  | day = round2(basic ÷ calendar days), half = round2(day ÷ [amount]) ([amount]/[amount])                                                                                                 | law: deducts up to [amount] more than s.18A in [amount] cases                                                                                           |
| Company A  | EPF                           | Third Schedule 20-ringgit bands, each share rounded up ([amount]/[amount]); foreign [amount]% each share rounded up ([amount]/[amount])                                                        | law: the Act rounds the total; foreign staff and EMP-REDACTED pay more                                                                             |
| Company A  | SOCSO, EIS                    | the statutory tables ([amount]/[amount], [amount]/[amount])                                                                                                                             | statute                                                                                                                                         |
| Company A  | HRDF                          | [amount]% half-up on basic only ([amount]/[amount])                                                                                                                                  | law: the levy is on wages, not basic only                                                                                                       |
| Company A  | PCB                           | the MTD specification                                                                                                                                               | statute                                                                                                                                         |
| Company B   | BPJS, PPh [amount]                  | each share half-up to the rupiah; Kesehatan employer = round([amount]%) − employee share ([amount]/[amount]; PPh [amount] [amount]/[amount])                                                           | company (pays no less): whole rupiah; the run must not keep cents                                                                               |
| Company B   | BPJS-TK base                  | basic only                                                                                                                                                          | law: the base includes fixed allowances                                                                                                         |
| Company C  | OT, night, rest day, absences | exact hour (monthly × [amount] ÷ [amount]/[amount] ÷ [amount]) × premium × hours, rounded once ([amount]/[amount]; absences [amount]/[amount])                                                                   | statute (DOLE factors)                                                                                                                          |
| Company C  | PhilHealth                    | the odd centavo to the employer                                                                                                                                     | company                                                                                                                                         |

Also explained to the unit: EMP-REDACTED and EMP-REDACTED OT paid a month late as April back pay (one-off); foreign EPF stopping in leavers' final months, EMP-REDACTED's employee SOCSO after [amount] HRDF on basic only and Company B's BPJS-TK base all contribute below the law (law applies). Unexplained so far: EMP-REDACTED January OT (+[amount] h), EMP-REDACTED January OT (−[amount] h), EMP-REDACTED's February SOCSO base.

### [amount] Company A (MY)

| Line (listing column) | Expect                     | Why                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OVER-TIME             | match                      | company rate basic × [amount] ÷ hours a year, never below EA s.60I (employer setting); [amount] of [amount] lines differ in hours; EMP-REDACTED ([amount] h) and EMP-REDACTED ([amount] h) March OT the clock machine missed is paid in April by HR's `OVERTIME_ARREARS` adhoc entry, as the listing's BACK PAY OT |
| INCENTIVE (OT)        | match, paid as rest-day OT | company rate: every rest-day hour × 2.0 × the hourly rate, floored at EA s.60(3)                                                                                                                                                                                              |
| NO PAY LEAVE          | match                      | except EMP-REDACTED February: the listing paid in full despite unpaid leave [amount]–[amount] Jan and an absence on [amount] Feb (one-off; the run deducts)                                                                                                                                        |
| TAX (PCB)             | match                      | except EMP-REDACTED: no spouse relief (her spouse works here); the run withholds [amount]–[amount] more a month                                                                                                                                                                            |
| MEDICAL CLAIM         | match                      | except EMP-REDACTED's [amount] dated [amount] Mar: paid in March, the listing paid it in May                                                                                                                                                                                               |
| LOAN RETURN           | match                      | EMP-REDACTED: March refunded in April as a reversal                                                                                                                                                                                                                              |
| Exit encashment       | match                      | EMP-REDACTED, [amount], [amount]: the days the listing paid, dated as the automation dates them                                                                                                                                                                                          |

### [amount] Company B (ID)

| Line                                | Expect                                | Why                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overtime, timed claim forms         | match                                 | —                                                                                                                                                                                                                                                               |
| Ganti jaga                          | run higher                            | company pays 10.5 weighted hours; Kepmenakertrans 102/2004 gives 16–17                                                                                                                                                                                          |
| Holiday nights                      | differs on 13 slots                   | the law prices the hours on the holiday's calendar day; the company priced the night by the evening it starts                                                                                                                                                   |
| PPh 21                              | run lower by 0.5–1.5% of the TER base | the company adds employer JHT to the base, which PMK 168/2023 excludes                                                                                                                                                                                          |
| EMP-REDACTED PPh [amount]                     | total differs                         | the law's total on her pay; she bears the tax on her house allowance (`employee_borne_tax_items`), the employer the rest; the listing's further [amount] names no allowance                                                                                      |
| BPJS                                | match                                 | —                                                                                                                                                                                                                                                               |
| EMP-REDACTED leave encashment (January) | match                                 | [amount] days                                                                                                                                                                                                                                                        |
| EMP-REDACTED claim [amount]               | paid in January                       | dated by its receipt ([amount] Dec [amount]); the listing paid it in March                                                                                                                                                                                                |
| PKWT compensation                   | paid in January, run lower            | the end-of-term compensation of EMP-REDACTED and the renewed guards (EMP-REDACTED, [amount], [amount], [amount]) pays in the run covering the term's end as final severance, [amount]% up to [amount] (PP [amount]/[amount] art.5); the listing paid it in February and withheld [amount]–[amount] |

### [amount] Company C (PH)

| Line                      | Expect                        | Why                                                                                                                                                                                                |
| ------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ABSENT / UNPAID           | match                         | no-pay leave has `paid_share` 0; a PH day is monthly × 12 ÷ 313 (6-day) or ÷ 261 (5-day), the DOLE daily rate                                                                                      |
| MC and EL                 | match (paid)                  | company policy: the workspace's PH `MEDICAL_LEAVE` and `EMERGENCY_LEAVE` have `paid_share` 1 (empty), set by HR in Settings                                                                        |
| Annual leave above 5 days | match (paid)                  | HR's manual adjustments on `ANNUAL_LEAVE` per person: the company gives more than the law's 5 days                                                                                                 |
| ORDINARY PAY (OT)         | match                         | except EMP-REDACTED [amount] Feb (−₱[amount], the repeated night) and a few April hours with no clock                                                                                                          |
| NIGHT SHIFT               | match                         | company method `night_differential_basis: CLOCK_SPAN`: 10% of the ordinary hour on every clocked hour 22:00–06:00, the unpaid break and OT hours included; per shift never below Labor Code art.86 |
| REGULAR / SPECIAL HOLIDAY | run higher                    | production worked 20 Mar, 9 Apr, 27 May, 12 Jun (200%) and 17 Feb (130%); the company kept the holiday on the next Saturday instead and paid no premium. The Saturday stays a paid company day off |
| EMP-REDACTED                  | differs in February and March | she ends [amount] Feb (the listing's last day); unpaid leave [amount]–[amount] Feb; her 13th month dated on her last day                                                                                              |
| SSS, PhilHealth, Pag-IBIG | match                         | the listing's ₱0.01 PhilHealth residue is not seeded                                                                                                                                               |
| Withholding tax           | match                         | differs only where the holiday premium raises taxable pay                                                                                                                                          |
