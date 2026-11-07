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

| Probe                                                   | Expected                                                                                                    | Evidence                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 12 consecutive cycles × 9 jurisdictions × ≥30 employees | Every cycle creates one run and one payslip per active employee, and the `ledger` automation posts its rows | Run ids, payslip ids, per-cycle totals |
| Employee totals                                         | Basic, gross, net, deductions, employer cost reconcile to the subtotal chain and catalogue lines            | Per-employee expected/actual           |
| Statutory                                               | Employee and employer amounts match the jurisdiction table for that period and wage band                    | Scheme-level expected/actual           |
| YTD                                                     | Sum of period statutory ledger rows; no duplicate YTD row                                                   | Ledger extract                         |
| Idempotency                                             | A second on-cycle run for the period is refused; a repeated posting adds no ledger rows                     | Second-run diff                        |

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
3. Once the `ledger` automation has run, verify one ledger row per movement and the projected balance. A loan posts no ledger row.
4. As the HR controller, reverse it with a reversal entry on the same item and verify the inverse movement with no history edit.

Expected: leave uses dated half-day slots; claim/adhoc use quantity and unit; loan uses principal and repayment amount; the ledger account/code matches the family convention.

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
