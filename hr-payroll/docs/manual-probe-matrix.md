# Manual probe matrix

Status: normative manual verification checklist. [The model contract](0002-model-specification.md) defines the models; this document defines the probes an operator must run against a live environment and the evidence each probe must leave.

## 1. Environment

```text
local reset ──► nine jurisdiction tenants ──► event-time probes
                                                │
                                                ▼
                              payroll: 12 sequential cycles × 30 employees
                                                │
                                                ▼
                              lifecycle / band / overtime probes
                                                │
                                                ▼
                              expected vs actual evidence per row
```

- Local Colony only, reset from the public seed plus the private demo bank.
- One demo entity per jurisdiction: CN, ID, JP, MY, PH, SG, TH, TW, VN.
- At least 30 employees per entity, each with a sealed contract, bank account and opening balance.
- Payroll months run sequentially inside each entity. Never skip a month or reuse a later period.
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

For at least one employee per jurisdiction whose annual leave row sets `encash_on_exit`:

1. Accrue leave, then set the contract end / exit date.
2. Exiting must raise the leave encashment movement immediately, not wait for payroll.
3. The encashment uses the recorded remaining balance and the catalogue conversion.
4. The final payroll pays the encashment, unused-leave adjustment and final statutory amounts.
5. After exit, later cycles create no payslip for that employee.

Expected: an encashment leave entry exists at exit time, with a source-linked ledger movement; the final payslip reflects it. Record balance before, encashment quantity, rate, amount and final net.

### 3.2 Salary bump across a statutory band

For at least one employee per jurisdiction:

1. Run a cycle at a salary inside a lower statutory band.
2. Apply a raise mid-year so the next full cycle crosses a contribution or tax band/ceiling.
3. Run the next cycles and the next year-to-date calculation.

Expected: each cycle uses the rate effective in that cycle; band tables and ceilings select from the new wage; cumulative statutory history remains correct across the change. Record wage, band, employee/employer amount before and after.

### 3.3 China prior salary and probation

Probes:

1. Employee with prior-year or prior-month salary history: confirm cumulative IIT counts it only under the same withholding agent.
2. Probation employee: verify the agreed probation wage is at least 80% of the contracted wage and not below the local minimum; test the boundary where it would fall below either floor.
3. Compare a probation month against the first post-probation month.

Expected: explicit evidence that prior salary is either correctly consumed or absent by contract; probation floors are enforced or refused with a clear finding. Record the applicable local rule and the tested figures.

### 3.4 Allowance proration with unpaid leave

For an employee with a recurring allowance:

1. Run a full-paid cycle: allowance pays the full agreed amount.
2. Add unpaid leave (NPL) in the next cycle: the allowance takes the same share of the period as base pay, by the jurisdiction's `proration_basis`.
3. Mix paid leave, unpaid leave and a mid-month join/exit.
4. Repeat for each allowance with `prorate` on.

Expected: allowance amount = agreed amount × the share of the period paid. Paid leave does not reduce it; unpaid leave does. Record leave slots, paid-day factor, expected and actual allowance.

### 3.5 Off-cycle run and statutory limits

Probe a bonus-only or ad-hoc off-cycle run with no base salary:

1. Run an on-cycle run, then an off-cycle run containing only an eligible bonus/adhoc line.
2. Confirm base pay is not paid again in the off-cycle run.
3. Confirm statutory ceilings/bands apply to the off-cycle wage base (e.g. bonus), not to a phantom monthly salary.
4. Confirm regular-only allowances/leave/claims are excluded unless `off_cycle_eligible`.
5. Run a second off-cycle in the same period and verify cumulative ceilings/YTD.

Expected: off-cycle pay lines exclude base pay; statutory employee/employer amounts use the actual off-cycle wage; caps and annual ceilings remain correct across on-cycle and off-cycle runs. Record run kind, lines, wage base, cap and expected/actual statutory amounts.

### 3.6 Contract lock during a run

While an on-cycle or off-cycle run covers a period:

1. Attempt to change the employee's contract terms (rate, allowances, normal hours, bank details) for that period.
2. Expect a refusal naming the capturing run; unrelated future-dated changes remain allowed.
3. Delete the unpaid run and retry the same change.

Expected: the run captures the contract version it calculated, and its input contract cannot change underneath it. Record run id, attempted change and refusal.

### 3.7 Overtime bands and excessive work

For at least one employee per jurisdiction with an overtime rule:

1. Run a cycle with ordinary overtime inside the band: expected amount is paid at the correct multiplier.
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

| Probe                                 | Expected                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| No-pay day cancelled after its run    | HR enters a reversal on the same item, dated in the next period; that run pays it. A date in a period that has run is refused         |
| No-pay day and allowances             | Allowances with `prorate` on fall with the day; a bonus stays whole; the reversal gives back what was taken, though the months differ |
| Overpaid year                         | A row with `below_zero: REFUND` pays a refund line on that run, once; any other row stops at zero and the next run nets it            |
| Wrong bonus reversed                  | Premiums and year-end tax come to what they would have been without it                                                                |
| Contribution wrong for a closed month | The adjustment entry moves that scheme's balance, a task raises, and the next run pays it                                             |

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
| Sealed loan repayment   | A repayment captured by a run cannot be edited. There is no loan repayment reversal; corrections use the loan schedule's own route.       |
| Ledger conservation     | Every posting has one inverse; no negative amount, no duplicate source, and the balance returns exactly after a full cancellation.        |
| Work event              | An event never posts by itself; only the allowance/ad-hoc/leave row it qualifies posts.                                                   |

### Roster and kiosk

| Probe                                  | Expected                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Roster person-day                      | One `roster_entry` for the employment and date                                                                           |
| Roster batch, one act                  | All rows commit inside the write's read budget                                                                           |
| Roster workbook, Plan and Work entries | Each sheet writes only its own fields; blank rows and omitted days stay; a sealed day refuses a change, passes unchanged |
| Roster import across people            | One act per employment; a run cut short picks up on the same file                                                        |
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

Run these against the local demo after `env status` says READY and the demo digest matches the current build.

### 7.1 Effects: exit encashment and final pay

1. Pick a current employee with a positive annual-leave balance and `encash_on_exit.allowed`.
2. End the contract (effective range `to`, `final_pay_due_on`) through the UI.
3. Expect an encashment leave entry immediately, before any payroll run; quantity equals the remaining balance;
   the next final run posts the encashment into FINAL_PAY; no later cycle creates a payslip for the person.
4. Record balance before, entry id, quantity, ledger movement, final net.

### 7.2 Ledger: reversal, deletion, addition

1. Create a leave entry, run payroll, reverse one captured half-day.
2. Expect exactly one inverse ledger row (same account/code/period, opposite operation), original row untouched,
   original slot still `payroll_run_id`.
3. Reverse the same original again: refused (one reversal per original).
4. Delete a captured slot: refused with “Create a reversal”; delete an unpriced slot: accepted and ledger inverted
   once.
5. Add a new entry after reversal: allowed, posts once, balance returns to the expected figure.

### 7.3 Mid-cycle changes

1. Pay bump mid-month: change the rate for the next contract version; run the next cycle; expect the new rate from its
   effective date, statutory bands recomputed, YTD carried.
2. Mid-month leaver: end the contract mid-month; expect prorated base pay, final statutory amounts, no later payslip.
3. More children mid-month: add a child/dependant fact and seal; expect the next entitlement sync to open the right
   leave window and the next tax run to use the new dependant count only from its effective date.
4. For each, record the before/after wage, band, statutory amounts, leave balance and ledger rows.

### 7.4 Transfers

1. Same jurisdiction: create a successor contract with no employment gap; expect leave and YTD to continue, no
   encashment.
2. Transfer out: create a contract in another jurisdiction or end without a successor; expect leave settled by
   encashment, final pay, then a clean new balance under the new entity/version.

### 7.5 Allowance proration with unpaid leave

1. Run a full-paid cycle and note each `prorate` allowance.
2. Add NPL in the next cycle; expect allowance = agreed amount × paid share, exactly the base-pay share.
3. Mix paid leave and NPL; paid leave must not reduce the allowance.

### 7.6 China prior employment

1. Give a contract `prior_employment` rows for the same withholding agent with gross income, employee contributions,
   months and IIT withheld.
2. Run the first CN payroll of the year; expect the cumulative taxable base and tax to include the prior rows and
   subtract the prior withholding, not restart from zero.
3. Repeat with a different withholding agent: those rows must not enter the current agent's cumulative base.

### 7.7 Overtime day bands

1. For each pattern (Mon–Fri rest Sat/Sun; Sun–Thu rest Fri/Sat; six-day week), create work entries on a workday,
   rest day, public holiday and a swapped rest day.
2. Expect the multiplier band to follow the entry's day type and the statutory week, not a fixed weekday assumption.
3. Add approved overtime on the nominal rest day that becomes a workday; the band must follow the roster day type.
4. Record hours, day type, multiplier, expected and actual line.

### 7.8 Holiday kept on Saturday, weekday in lieu

A holiday the six-day staff keep on the Saturday after, and the five-day staff take on the weekday in lieu (seeded on
Company C: [amount] Apr Araw ng Kagitingan is `ONLY_IF_OFF_ON_REPLACED_DATE`, replacing Saturday [amount] Apr, which is `EVERYONE`).

1. Open the entity's holiday calendar: the Saturday row is the holiday for everyone; the weekday row names the Saturday
   it replaces and is given only to those off on it.
2. Run the period with a six-day worker who works the weekday and a five-day worker who works it too.
3. Expect the six-day worker's weekday priced as an ordinary day and their Saturday as the holiday; the five-day
   worker's weekday priced as the holiday. No one is paid the holiday twice.
4. A six-day worker with no roster entry on the Saturday still counts as working it (the gate reads the pattern).
5. A six-day worker who swapped (OFF on the weekday, working or on leave on the Saturday) is off with pay on the
   weekday and works or takes leave on the Saturday.
6. Record each person's day type on both dates, the holiday lines and the expected and actual amounts.

### 7.9 Public holiday in lieu

1. Publish a public holiday on a Sunday and run the period with a five-day and a six-day worker; both may receive
   Monday as a day in lieu.
2. Publish a public holiday on a Saturday; a five-day worker may receive Monday, a six-day worker may not.
3. File `PUBLIC_HOLIDAY_IN_LIEU` manually on the substitution day: it commits. File it on a day no rest-day holiday
   substitutes: it is refused. No entry is ever created automatically.
4. Record the employee's normal week, the holiday dates, the entry date and the refusal message.

### 7.10 UI

1. Settings: all top-level tabs visible; `More` only for genuine overflow.
2. Catalog: every row shows a description; row sheet has no Settings section.
3. Event catalog pickers: only current-version codes, no duplicates.
4. Leave: HR Events only shows `Reverse entry`; the form preselects captured slots and opens on their month; selected
   half-days are visibly filled; unavailable half-days are dimmed.
5. Profile and entity drawers: top-level tabs use the default segmented variant, not chips; nested tabs step down to
   underline and then chips. Face stays inside Profile; no seal badge on the leave/loan entry itself.
6. Employer payroll versions: Schedule change opens the form, and filed changes appear under Scheduled changes until
   their day seals them into a new version.
7. Calculation overview: each catalogue row wraps its description below the code; the info icon opens Eligibility and
   Payroll amount as labelled code blocks, never one clipped line.
