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

- Local Colony only, reset from the public seed plus a rebuilt private demo bank.
- One demo entity per jurisdiction: CN, ID, JP, MY, PH, SG, TH, TW, VN.
- At least 30 employees per entity, each with a sealed contract, bank account and opening balance.
- Payroll months run sequentially inside each entity. Never skip a month or reuse a later period.
- All monetary comparisons use the seeded currency and the settings rounding rule.

## 2. Baseline payroll

| Probe                                                   | Expected                                                                                           | Evidence                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 12 consecutive cycles × 9 jurisdictions × ≥30 employees | Every cycle creates one run, one finalised payslip per active employee and the payroll ledger rows | Run ids, payslip ids, per-cycle totals |
| Employee totals                                         | Basic, gross, net, deductions, employer cost reconcile to the subtotal chain and catalogue lines   | Per-employee expected/actual           |
| Statutory                                               | Employee and employer amounts match the jurisdiction table for that period and wage band           | Scheme-level expected/actual           |
| YTD                                                     | Sum of period statutory ledger rows; no duplicate YTD row                                          | Ledger extract                         |
| Idempotency                                             | Re-running the same cycle does not duplicate payslips or ledger rows                               | Second-run diff                        |

## 3. Lifecycle probes

### 3.1 Leaver and leave encashment

For at least one employee per jurisdiction:

1. Accrue leave, then set the contract end / exit date.
2. Exiting must raise the leave encashment movement immediately, not wait for payroll.
3. The encashment uses the recorded remaining balance and the catalogue conversion.
4. The final payroll pays the encashment, unused-leave adjustment and final statutory amounts.
5. After exit, later cycles create no payslip for that employee.

Expected: an encashment catalogue entry (or equivalent registered effect) exists at exit time, with a source-linked ledger movement; the final payslip reflects it. Record balance before, encashment quantity, rate, amount and final net.

### 3.2 Salary bump across a statutory band

For at least one employee per jurisdiction:

1. Run a cycle at a salary inside a lower statutory band.
2. Apply a raise mid-year so the next full cycle crosses a contribution or tax band/ceiling.
3. Run the next cycles and the next year-to-date calculation.

Expected: each cycle uses the rate effective in that cycle; band tables and ceilings select from the new wage; cumulative statutory history remains correct across the change. Record wage, band, employee/employer amount before and after.

### 3.3 China prior salary and probation

Probes:

1. Employee with prior-year or prior-month salary history: confirm whether cumulative IIT and any average-wage calculation consume it, and that the current engine either captures it or reports it as unsupported.
2. Probation employee: verify the agreed probation wage is at least 80% of the contracted wage and not below the local minimum; test the boundary where it would fall below either floor.
3. Compare a probation month against the first post-probation month.

Expected: explicit evidence that prior salary is either correctly consumed or absent by contract; probation floors are enforced or refused with a clear finding. Record the applicable local rule and the tested figures.

### 3.4 Allowance proration with unpaid leave

For an employee with a recurring allowance:

1. Run a full-paid cycle: allowance pays the full agreed amount.
2. Add unpaid leave (NPL) in the next cycle: the allowance prorates by the same paid-time basis as base pay, not by calendar days alone.
3. Mix paid leave, unpaid leave and a mid-month join/exit.
4. Repeat for each allowance that declares proration.

Expected: allowance amount = agreed amount × paid ordinary time ÷ ordinary time in the period. Paid leave does not reduce it; unpaid leave does. Record leave slots, paid-day factor, expected and actual allowance.

### 3.5 Off-cycle run and statutory limits

Probe a bonus-only or ad-hoc off-cycle run with no base salary:

1. Run a regular cycle, then an off-cycle cycle containing only an eligible bonus/adhoc line.
2. Confirm base pay is not paid again in the off-cycle run.
3. Confirm statutory ceilings/bands apply to the off-cycle wage base (e.g. bonus), not to a phantom monthly salary.
4. Confirm regular-only allowances/leave/claims are excluded unless `off_cycle_eligible`.
5. Run a second off-cycle in the same period and verify cumulative ceilings/YTD.

Expected: off-cycle pay lines exclude base pay; statutory employee/employer amounts use the actual off-cycle wage; caps and annual ceilings remain correct across regular and off-cycle runs. Record run kind, lines, wage base, cap and expected/actual statutory amounts.

### 3.6 Contract lock during a run

While an off-cycle or regular payroll run is open for a period:

1. Attempt to change the employee's contract terms (rate, allowances, normal hours, bank details) for that period.
2. Expect a refusal naming the capturing run; unrelated future-dated changes remain allowed.
3. Release/cancel the run and retry the same change.

Expected: the run captures the contract version it calculated; an in-flight run cannot have its input contract changed underneath it. Record run id, attempted change and refusal.

### 3.7 Overtime bands and excessive work

For at least one employee per jurisdiction with an overtime rule:

1. Run a cycle with ordinary overtime inside the band: expected amount is paid at the correct multiplier.
2. Increase hours beyond the statutory monthly/period cap: expect a warning or refusal, not silent payment.
3. Work too many consecutive days or breach rest-day rules: expect a warning or refusal.
4. Run a cycle with rest-day, holiday and night work to cross the applicable bands.

Expected: warnings appear as run findings or explicit refusals with a source; payable bands calculate exactly; no overtime line when the cap is breached under a refusing rule. Record hours, band, multiplier, expected and actual.

## 4. Event-time UI and ledger probes

For each of leave, claim, adhoc and loan:

1. Create the record through the employee/controller UI, visually consistent with the V1 template.
2. Approve it through the configured approval path.
3. Verify entry `status → APPROVED`, one ledger row and the projected balance.
4. Reverse it and verify the inverse movement with no history edit.

Expected: leave uses dated half-day slots; claim/adhoc use quantity and unit; loan uses principal and repayment amount; the ledger account/code matches the family convention.

## 5. Evidence

Each probe records:

- jurisdiction, version, period, entity and employee;
- expected value, actual value, delta;
- source/evidence link and screenshot or log;
- PASS, FAIL or BLOCKED, with the blocking contract named.

A green automated suite is not acceptance evidence. A red probe is always a defect. Do not fix a probe by widening a timeout, editing expected values to match output, or seeding a result the engine should calculate.

## 6. Known prerequisites

These must close before the matrix is meaningful:

- private demo bank rebuilt against the current models (30 employees per jurisdiction);
- overtime quantity source (`ctx.work` or roster-derived input);
- off-cycle base-pay suppression and contract capture lock;
- allowance proration by paid time, not only calendar time;
- registered rule/effect `reads`, `subject` and run context;
- leave encashment path at exit;
- statutory history exposing prior periods/payslips where cumulative tax requires it;
- grid of statutory wage bases where a single gross subtotal is insufficient.

## 7. Local probe run — 2026-11-03

Environment: local Colony, `norbital_hr`, public jurisdiction seed plus a rebuilt private demo bank (9 entities × 30 employees). All amounts below are the values the engine wrote.

| Probe                                                                        | Expected                                                                  | Actual                                                                                                                | Result  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| Baseline: 12 cycles × 9 jurisdictions × 30 employees                         | 108 finalised runs, 3,240 finalised payslips, no negative or zero net     | 108 runs, 3,240 payslips, all `FINALISED`; 0 negative, 0 zero                                                         | PASS    |
| Off-cycle bonus-only: VN, 30,000,000 VND bonus, no base salary               | base 0; SI/HI/UI 0; PIT on the bonus; net positive                        | basic 0, gross 30,000,000, deductions 950,000, employer 237,600, net 29,050,000                                       | PASS    |
| Contract lock: change a contract that a finalised run captured               | refusal naming the capturing run                                          | refused: `Payroll run DEMO-VN-2026-01 already captured this period; the contract cannot change under it.`             | PASS    |
| Salary bump across CPF band: SG 3,000 → 9,000 from the next contract         | employee CPF 600 → 1,600; employer CPF 510 → 1,360; SDL capped            | Jan 2027 employee 600, employer 517.50; Feb 2027 employee 1,600, employer 1,371.25 (CPF 1,360 + SDL 11.25)            | PASS    |
| Allowance proration with NPL: SG fixed 300, one unpaid day in a 23-day month | 300 × 22/23 = 286.96; base 4,000 × 22/23 = 3,826.09                       | basic 3,826.09; gross 4,113.05; allowance 286.96                                                                      | PASS    |
| Leave approval ledger: VN annual leave, one day (AM+PM)                      | one `live` ledger `DEDUCT 1 DAY ANNUAL_LEAVE`; balance 12 → 11            | balance 12 → 11; one ledger row `leave/ANNUAL_LEAVE/DEDUCT/1 DAY`                                                     | PASS    |
| Overtime pay: PH, 10 worked hours + 2 planned overtime hours on one day      | overtime line at the ordinary premium; gross above basic                  | basic 31,500; gross 31,877.40; overtime 377.40                                                                        | PASS    |
| Overtime warnings: over the monthly/consecutive-day caps                     | a warning or refusal                                                      | no findings path consumes `work`; rules are not jurisdiction-scoped and receive empty `reads`                         | BLOCKED |
| Leaver and leave encashment: set the exit date, expect encashment at exit    | encashment movement at exit; final payslip includes it                    | no encashment catalogue row, effect or engine path exists; leave catalogues have null `subtotal_id` and no conversion | BLOCKED |
| China prior salary and probation                                             | prior salary consumed or explicitly unsupported; probation floor enforced | no prior-salary field or history input; probation rule exists but reads undeclared facts                              | BLOCKED |

### Defects fixed while probing

- A payroll run could not persist its payslips: a finalised parent locked its `payslips` relation during the same create. The payslip parent ref is no longer `owned`; cascade remains.
- Payroll run creation forced `FINALISED` before the state field existed; `payroll_run` now starts finalised and exposes only the `state` update.
- Engine wrote no `work` context, so any overtime catalogue threw. It now receives an empty day list, or the roster days when present.
- Payslip totals carried float tails beyond scale 12. Totals are rounded to 12 decimal places before insert.
- SG CPF lookup used nested objects and arrays, which the expression `Lookup` contract forbids. Rates and age bands are flat records.
- VN statutory insurance read the contract salary even in an off-cycle run with no salary. It now reads paid base pay and charges nothing when no base or fixed allowance is paid.
- ID PPH21 treated a November payroll paid in December as the December true-up and multiplied by total employment months. It now keys on the salary coverage month and the tax-year months.
- TH WCF refused the run once the annual ceiling was reached. It now caps at zero for the rest of the year.
- Leave approval posted a ledger row keyed by catalogue id and dated on approval. It now resolves the catalogue code and dates the movement on the first leave day.
- Registered rules from every jurisdiction ran against every entry. Rules are now scoped to the row's jurisdiction version.

### Remaining blockers

- Registered rule/effect `reads` are still empty; rules that need employee, payslip or obligation evidence are inert.
- `ctx.work` carries roster days but no holiday/rest classification, so only ordinary overtime is exercised.
- No overtime cap/consecutive-day findings path.
- No leave encashment catalogue, effect or engine path at exit.
- No prior-salary input for China, and probation facts are not declared.

## 8. Bonus and additional-wage remediation — 2026-11-04

The previous table's overtime-warning and China prior-salary rows are superseded by this run.

| Probe                                                                | Expected                                                    | Actual                                                                     | Result                 |
| -------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| Baseline: 12 cycles × 9 jurisdictions × 30 employees                 | 108 finalised runs, 3,240 payslips, no negative or zero net | 108 runs, 3,240 payslips, 0 negative, 0 zero                               | PASS                   |
| SG bonus-only: 3,000 bonus, no base                                  | OW 0; AW 3,000; CPF 600; net 2,400                          | OW 0; AW 3,000; CPF 600; net 2,400; employer 517.50 (CPF 510 + SDL 7.50)   | PASS                   |
| SG CPF annual ceiling: 150,000 bonus after OW 71,280 and AW 3,000    | AW charged 27,720; employee CPF 5,544                       | AW charged 27,720; employee CPF 5,544                                      | PASS                   |
| SG salary band: 3,000 → 9,000 from a replacement contract            | CPF 600 → 1,600; employer 517.50 → 1,371.25                 | 600 → 1,600; 517.50 → 1,371.25                                             | PASS                   |
| SG allowance NPL: 300 fixed allowance, one unpaid day in 23 days     | allowance 286.96; base 3,826.09; gross 4,113.05             | allowance 286.96; base 3,826.09; gross 4,113.05                            | PASS                   |
| CN prior employment: same withholding agent false → true             | prior income ignored → included                             | IIT 7.01 → 157.01 on the same salary                                       | PASS                   |
| CN bonus-only: 50,000 bonus, no base                                 | SI/HPF 0; IIT on bonus once                                 | basic 0; gross 50,000; employee statutory 0; tax 2,862.71                  | PASS                   |
| Roster overtime warning: 5 overtime hours against a 3-hour daily cap | finding on the roster entry, not payroll                    | `roster.daily_overtime` finding stored on the entry                        | PASS                   |
| PH overtime pay: 10 worked + 2 overtime hours                        | gross above basic                                           | basic 31,500; gross 31,877.40                                              | PASS                   |
| Leave approval ledger: one annual-leave day                          | balance 12 → 11; dated ledger row                           | 12 → 11; `leave/ANNUAL_LEAVE/DEDUCT/1 DAY`, effective 2026-12-15           | PASS                   |
| Leaver encashment at exit                                            | encashment movement on exit                                 | no catalogue/effect/engine path                                            | BLOCKED                |
| CN monthly IIT annual bonus separate method                          | optional separate annual-bonus method                       | bonus is taxed once in the cumulative base; separate method not modelled   | PARTIAL                |
| JP health/child bonus annual ceiling                                 | fiscal-year YTD cap                                         | fiscal-year YTD cap implemented; pension remains per payment month         | PASS                   |
| MY EPF/SOCSO/EIS/HRDF bonus split                                    | scheme-specific base                                        | EPF on bonus; SOCSO/EIS/HRDF on ordinary wages; backpay routing unresolved | PASS with caveat       |
| PH SSS/PHIC/HDMF/WTAX bonus split                                    | scheme-specific base                                        | SSS on bonus, PHIC on basic, HDMF on ordinary, WTAX 90k pool               | PASS with legal caveat |
| TH PND1 bonus                                                        | bonus once, prior employer only same agent                  | implemented; weekly OT cap cannot be expressed exactly                     | PASS with caveat       |
| VN PIT/union                                                         | bonus once; union on ordinary pay                           | implemented; monthly cumulative PIT method needs confirmation              | PASS with caveat       |

## 9. Final pay and non-wage checkpoint — 2026-11-04

`FINAL_PAY` is inserted after `GROSS` (and after `RETIREMENT` where present) and before `NET` for CN, JP, MY, TH, TW and VN. Terminal, injury, notice, maternity pass-through and non-compete rows moved off `ORDINARY_WAGES` / `ADDITIONAL_WAGES`. Statutory schemes that read OW/AW no longer see them; tax schemes that read NET still do.

| Probe                                                | Expected                                                                                                           | Actual                                                                     | Result                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Baseline after checkpoint                            | 108 runs, 3,252 payslips                                                                                           | 108 runs, 3,252 payslips                                                   | PASS                                                        |
| CN economic compensation, off-cycle: 6,480 × 3 years | OW 0; AW 0; gross/net 19,440; SI/HPF 0                                                                             | basic 0; OW 0; AW 0; gross 19,440; net 19,440; employee statutory 0; tax 0 | PASS for wage classification; severance tax remains PARTIAL |
| Chain shape                                          | `BASIC → ORDINARY_WAGES → ADDITIONAL_WAGES → GROSS → FINAL_PAY → NET` (JP/TW keep `RETIREMENT` before `FINAL_PAY`) | 46 versions updated; `bolt check` green                                    | PASS                                                        |

Blocked: payslip validation in the run transform. Payslip rules declare calculation facts (`pay_lines`, `overtime_hours`, …), not database reads; materialising them needs a separate engine adapter. Running the current `validateRegistered` path would query non-tables and exhaust the 10-crossing write budget.

## 10. Ledger and approval break probes — 2026-11-04

| Probe                                                       | Expected                                                    | Actual                                                                                     | Result                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Funded leave approval: SG, ANNUAL_LEAVE 12, approve one day | one `leave/ANNUAL_LEAVE/DEDUCT/1 DAY`; balance 12 → 11      | ledger row on 2026-12-16; balance 11                                                       | PASS                                              |
| Cancel an approved leave day                                | inverse `ADD 1`; balance restored                           | inverse row added; balance restored                                                        | PASS after fix                                    |
| Approve 12 days against balance 11                          | refusal before commit                                       | `ANNUAL_LEAVE: insufficient balance.` applied before the write                             | PASS after fix                                    |
| Delete a cancelled leave with ledger history                | refusal                                                     | refused by `ledger_entry: source_id` foreign key                                           | PASS                                              |
| Demo bank approvals out of the box                          | every employee can request leave                            | all 271 balances were `{}`; approval effect failed after the status committed              | FIXED: bank seeds `leave.ANNUAL_LEAVE = 12`       |
| Loan approval, empty loan account                           | a loan increases outstanding debt                           | refused `FESTIVE_ADVANCE: insufficient balance.` because approval deducts the loan account | BLOCKED: approve semantics need a domain decision |
| Payroll run entity/settings mismatch                        | refuse a run whose settings lineage does not own the entity | CN entity + SG settings committed (zero-pay off-cycle)                                     | FAIL: no lineage check                            |
| Duplicate regular run for one period                        | refuse the second run                                       | a second CN 2026-11 regular run committed                                                  | FAIL: no one-regular-run-per-period guard         |
| Payslip edit after finalisation                             | refusal                                                     | refused while `FINALISED`                                                                  | PASS                                              |
| Non-admin demo staff self-service                           | `employee` team and app access                              | every demo `sys_user` has no team; the employee app is empty                               | FAIL: bank membership missing                     |

Fixes this run:

- `assertApprovalBalance` preflights leave/claim/adhoc/loan approvals against the projected account, so an overdraw refuses before the status commits.
- Cancelling an `APPROVED` entry now posts the inverse operation and restores the account.
- Unit test: overdrawing a leave approval rejects.

## 11. Statutory research automation — 2026-11-04

| Probe                                              | Expected                                      | Actual                                                                                                                                        | Result                                                                                                |
| -------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Automation reads all families                      | policy grants every family the research reads | failed `no held policy grants reading 'overtime_catalog'`                                                                                     | FIXED: added `overtime_catalog`, `workplace_case_catalog` and host tools to `configuration_execution` |
| Web research                                       | `web_search` and browser tools available      | failed 81× `'web_search' is not a host tool this run's policies name`                                                                         | FIXED: policy `capabilities.tools` added                                                              |
| Full run, 81 agents (9 jurisdictions × 9 families) | one run completes                             | failed: `The run used more than its CPU budget (3 s) and was stopped`                                                                         | FAIL: one run cannot host 81 agents                                                                   |
| Resource sample during full run                    | bounded                                       | template dev 3.4–4.0 GB RSS, 100–181% CPU; Colony 1.9–2.0 GB, 120–176% CPU; databases 1.5–2.8 GB                                              | measured, then CPU budget stopped the run                                                             |
| Fan-out design                                     | one run per jurisdiction × family             | added optional `code`/`family` inputs and child-run fan-out; not yet observed end-to-end because the local watcher restarted during the probe | BLOCKED by local watcher instability                                                                  |
| Latest changes picked up                           | current law vs seeded law                     | not established; no completed research answer, no source citations in the draft                                                               | BLOCKED                                                                                               |

Root cause: the V2 automation launches `jurisdictions × FAMILIES` inside one guest run with unbounded concurrency. The host gives a run a 3 s CPU budget; 81 agents exceed it before any model result arrives. V1 (`statutory_drift`) researches one lineage at a time with a bounded agent set and returns evidence. V2 needs child runs or one run per jurisdiction, not one run for all.

## 12. Roster, loans, minimum wage and overtime eligibility — 2026-11-04

Build `d68ecee811b5` (schema `ac159d18181a`, seed `e7bd35bbeaab`), 51 unit tests. Local demo `norbital_hr`.

| Probe                                        | Expected                                                                                                                      | Actual                                                                                                                                            | Result                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Roster person-day create, month board        | one `roster_entry` for the employment and date                                                                                | VN0001 2026-11-02 committed and read back                                                                                                         | PASS                                             |
| Roster batch create, 20 person-days, one act | all rows commit inside the 10-crossing write budget                                                                           | 20/20 committed after per-layer read cache and grouped findings                                                                                   | PASS                                             |
| Roster batch update, 5 person-days           | all rows commit; no null-id rule read                                                                                         | 5/5 committed (revision 2); `ROSTER_PATTERN_CYCLE` reads `terms.shift_pattern_id` and finds the pattern in JS                                     | PASS                                             |
| Roster import across people                  | one act per employment; no crossing refusal                                                                                   | `roster_import.ts` groups creates/updates/deletes by employment; unit suite green                                                                 | PASS (unit)                                      |
| Kiosk punch shape                            | create with only `actual_worked_intervals` commits                                                                            | VN rule conditions use `get(..., [])`; the act committed                                                                                          | PASS                                             |
| Loan inline create, 12,000,000 over Nov–Dec  | one loan and two 6,000,000 installments                                                                                       | UI/create path wrote both installments for 2026-11-01 and 2026-12-01                                                                              | PASS                                             |
| Loan sheet visual                            | card border around the matrix; rows have vertical leeway; add and regenerate explain themselves                               | outer `rounded-md border`, 45 px rows (was 36), built-in `hint` tooltips on both icon buttons                                                     | PASS (visual, `.tmp/loan-sheet-bordered2.png`)   |
| Loan schedule FSM                            | `NO_TERMS → READY → GENERATED → SEALED`; sealed rows never rewritten                                                          | `tests/loan_schedule.test.ts`: state transition, sealed preservation, regeneration around sealed rows                                             | PASS                                             |
| Loan schedule invariants                     | generated total equals principal in minor units; one row per month; positive amounts; ordered months; every open row replaced | invariant case table over one to twelve months and 100.00–1,000.01 principals                                                                     | PASS                                             |
| Loan schedule refusals                       | principal ≤ 0, reversed period, duplicate month, outside period, open total ≠ principal, sealed total > principal             | each reports its problem or throws the named refusal                                                                                              | PASS                                             |
| Minimum wage floors                          | each seeded jurisdiction at the floor passes and one minor unit below refuses; regional and job-nature variants included      | 10 tests: TW, MY, SG, VN, JP, CN, ID, PH (regional + agriculture/retail + domestic), TH (provincial)                                              | PASS                                             |
| TH provincial minimum wage                   | 337–400 THB by province, daily/monthly/hourly equivalents                                                                     | rule seeded in TH v1–v8; 82 region keys; BANGKOK 400; monthly and hourly boundaries tested                                                        | PASS                                             |
| Overtime eligibility, MY                     | monthly wage ≤ RM4,000, manual categories, or contractual opt-in; fixed allowances count, variable allowances do not          | `tests/overtime_eligibility.test.ts`: 4,000 / 4,000.01, manual labour, vehicle operator, opt-in, monthly/daily/hourly conversions, PIECE excluded | PASS                                             |
| Overtime eligibility, TH/PH                  | TH managers excluded; PH managerial, domestic and field personnel excluded                                                    | TH `overtime_category = MANAGER` false; PH `MANAGERIAL`, `DOMESTIC`, `FIELD_PERSONNEL` false; ordinary true                                       | PASS                                             |
| SG statutory research retry                  | changed rows and source URLs returned                                                                                         | run `01a1a59f-12a6…` remains `running` with no progress; `infer` never returns                                                                    | BLOCKED: host AI stream stall, not template code |

Notes:

- The loan sheet uses the native `Table` border and row rhythm; the empty state keeps the same header but has no data rows.
- `loanScheduleProblems` is the invariant gate used by the form; `buildLoanSchedule` only mutates open rows.
- Overtime pay still requires a positive `source_manifest.overtime` quantity; eligibility is a separate gate, so an eligible employee with zero hours gets no overtime line.
- Statutory research now returns source URLs even when no value changed; the retry above stalled before producing an answer.

## 13. Catalogue shape and matrix interaction — 2026-11-04

Build `bd4c005441af` (schema `1e4871ee0ce0`, seed `04b033eb996c`), local demo `norbital_hr`.

| Probe                                 | Expected                                                                             | Actual                                                                                                                                                          | Result                    |
| ------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Loans are always money                | model, seed, create/update, list and sheet expose no unit                            | `loan_catalog_entry.unit` deleted; seed keys removed; create without unit committed; list/person tabs and sheet show quantity/period only                       | PASS                      |
| Work interruption selects a catalogue | no free-text kind; the catalogue row is the kind                                     | `kind` deleted from the entry model; form shows Catalog, Entity, Period, Worksite, Document, Reason; TH/TW notice effects read `work_interruption_catalog.code` | PASS                      |
| Workplace cases entry placement       | entries under Events; catalogue under Settings                                       | `/events/cases` renders as a Workplace cases tab; the separate sidebar app is gone; Settings → Catalog still lists Workplace cases                              | PASS                      |
| Matrix row removal                    | built-in table border/rhythm; larger bordered remove control; phone swipe reveals it | 32×32 outline button; touch swipe changed trailing opacity 0 → 1 and set `data-revealed`; desktop hover still reveals                                           | PASS                      |
| Stacked sheets                        | push/pop by identity, explicit depth, no jitter when the top closes                  | `pushSheet`/`popSheet` dedupe and an absent pop never removes another sheet; depth sets z-index; only the top sheet keeps the phone scrim; `kit.test.ts` 13/13  | PASS (unit)               |
| `sys_2` infer probe                   | no-tool and `web_search` both return                                                 | no-tool `OK` in 1.8 s; web_search returned the CPF URL in 8 s                                                                                                   | PASS                      |
| Statutory research stability          | one run completes without lease loss                                                 | repeated template cutovers during builds produced `lostLease` after 3 attempts; step budget reduced 12 → 6; a quiet window is required                          | BLOCKED by local cutovers |

Notes:

- The loan and interruption removals are model changes, not just UI: migrations were rebased to `0001_initial.sql` and the seed bank was updated.
- `work_interruption_catalog_entry.label` is now `reason`; the list column is `catalog_id`, so the catalogue name is the visible identity.
- The matrix swipe is shared by every `Table` with `rowTrailing`; the phone card list uses the same reveal state.
- Sheet stack depth is explicit; the phone scrim renders only for the top sheet and for a sheet that is leaving.

## 14. Employment changes, balances and exit — 2026-11-05

Build `87a1b47c2709` (schema `971e093e76b6`, seed `6fb4fe227ad0`).

| Probe                                     | Expected                                                                                                                           | Actual                                                                                                                                                                                                                                                | Result                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Promotion                                 | open **Employment history**, press **Promotion** in the footer                                                                     | compact sheet prefilled from the contract; creates a dated replacement draft with reason `Promotion`                                                                                                                                                  | PASS — SG0013 draft `01a1a6e0-078a…`, effective 2026-11-05, same employee number; no encashment and 12 leave days stay                                                                                                                                                                                                                                                                                     |
| Transfer (cross-jurisdiction)             | draft an MY→TH replacement, then end the MY contract                                                                               | compact sheet with entity, jurisdiction settings, period, terms and reason; old leave settles before the new contract                                                                                                                                 | PASS — TH draft created; encashment `01a1a6fb-13c1…`, balance 12 → 0; MY Nov payslip paid `ANNUAL_LEAVE` 806.77 in `FINAL_PAY`                                                                                                                                                                                                                                                                             |
| Transfer target terms                     | MY→TH transfer with the target's statutory categories                                                                              | the sheet captures statutory work category, residency status and work classification; TH accepts and seals the contract                                                                                                                               | PASS — live UI: MY0004 → TH; sheet prefilled MY `NON_MANUAL` / `CITIZEN`, changed to `ORDINARY` / `RESIDENT` / `ORDINARY`; TH contract `01a1a77a…` sealed and the DB stores all three values; old MY contract ended                                                                                                                                                                                        |
| Sealed-overlap guard                      | seal a draft whose period overlaps an open sealed contract                                                                         | refused until the predecessor ends                                                                                                                                                                                                                    | PASS — live UI: draft SG0001 `01a1a771…` (2026-11-06 – 2026-11-30) under the open TW contract (from 2026-11-05); **Seal contract** returned `employee_contract.update` refusal `overlap` and the draft stayed Open; the earlier workspace probe confirmed the same draft seals after the predecessor ends                                                                                                  |
| Termination                               | a last day; the reason is the standardized `reason`; jurisdiction-specific exit facts stay in `employee_extension_data`            | contract `reason` field; `exit_facts.exit_ground` is a jurisdiction fact, not a contract field; sealed contract shows a **Terminate** sheet with last day + reason                                                                                    | PASS                                                                                                                                                                                                                                                                                                                                                                                                       |
| Contract state UI                         | open a sealed contract, then a draft                                                                                               | sealed shows lock + Promotion/Transfer/Terminate, no status field/Edit; draft shows Edit/Seal                                                                                                                                                         | PASS — sealed footer action set and lock confirmed live; status removed from the form                                                                                                                                                                                                                                                                                                                      |
| Promotion modal                           | press Promotion in the contract footer                                                                                             | two-step sheet captures last day, job title, salary, terms; creates draft, ends old, seals new                                                                                                                                                        | PASS — old ended 2026-11-04; replacement sealed 2026-11-05 with Senior Operator / 2200 and service start preserved                                                                                                                                                                                                                                                                                         |
| Loan settlement                           | settle an outstanding loan through final payroll                                                                                   | repayment posts and the payslip deducts it                                                                                                                                                                                                            | PASS — live UI: MY0001 loan 500 previewed `Loan balance: 500; settles from final pay`; Terminate replaced the open schedule with one repayment of 500 on 2026-11-04. Fresh-state MY November run: the 500 repayment is stamped with the run; payslip nets 2,026.51 and deducts `AIR_TICKET_DEDUCTION` 500 alongside `ANNUAL_LEAVE` 872.31 in `FINAL_PAY`                                                   |
| Loan transfer                             | transfer an outstanding loan to the target catalogue                                                                               | same code transfers principal and schedule; otherwise settles; dated ledger pair                                                                                                                                                                      | PASS — live UI: SG0001 loan 300 (SALARY_ADVANCE) → TW created a new TW loan 300 with a 2026-11-05 – 2026-11-30 schedule; the old schedule was cleared. MY0002 loan 400 (AIR_TICKET_DEDUCTION) → TW had no matching code, so it settled 400 on 2026-11-04 and created no new loan. Probe DB: `ADD SALARY_ADVANCE 300` + `DEDUCT SALARY_ADVANCE 300` on 2026-11-04, plus settlement DEDUCTs 500, 400 and 200 |
| Forced loan settlement                    | transfer a loan to a jurisdiction that has the same catalogue code, with **Settle from final pay instead of transferring** checked | settle instead of transfer                                                                                                                                                                                                                            | PASS — live UI: SG0002 loan 200 (SALARY_ADVANCE) → TW with the checkbox checked created no new loan and settled 200 on 2026-11-04                                                                                                                                                                                                                                                                          |
| Same-jurisdiction loan carry              | promote or transfer within the same jurisdiction with an outstanding loan                                                          | one loan remains; the schedule is untouched                                                                                                                                                                                                           | PASS — live UI: MY0003 loan 250 promoted; confirmation said `Loan balance: 250; carries with the person`, no settle checkbox; the profile still had exactly one loan and its 250 schedule on 2026-11-01                                                                                                                                                                                                    |
| Same-jurisdiction cross-entity loan carry | transfer a loan to another entity in the same jurisdiction                                                                         | the loan and its open schedule move to the successor contract/entity; successor payroll deducts it                                                                                                                                                    | PASS — live UI: MY0005 → Probe Malaysia Two; loan 300 and its open repayment moved to the successor entity/contract (DB `entity_id` and `employment_id` both point at the successor); MY2 November run sealed the repayment; payslip nets 1,668.4 and deducts `AIR_TICKET_DEDUCTION` 300                                                                                                                   |
| Entity page scope                         | open an entity and a payroll version                                                                                               | only Profile, Employer payroll versions, Holidays; version is read-only with Void action                                                                                                                                                              | PASS — serve UI; version footer has Void + lock, no status field/Edit                                                                                                                                                                                                                                                                                                                                      |
| People scope                              | open People                                                                                                                        | only entity-scoped Employee profile and Overview; no All people                                                                                                                                                                                       | PASS — serve UI                                                                                                                                                                                                                                                                                                                                                                                            |
| Calculation overview                      | expand a settings checkpoint                                                                                                       | each catalogue row shows +/−, when and calculation                                                                                                                                                                                                    | PASS — serve UI: `+`, Assessment date, conversion expression and eligibility                                                                                                                                                                                                                                                                                                                               |
| Balance on same-entity promotion          | leave/loan balances continue                                                                                                       | one `employee_balance` row per employee; term change leaves the row in place                                                                                                                                                                          | PASS                                                                                                                                                                                                                                                                                                                                                                                                       |
| Balance on cross-entity transfer          | move the balance or settle it at the old entity                                                                                    | payroll reads the single `employee_balance` row by `employee_id`; `entity_id` is administrative, not a partition                                                                                                                                      | PASS                                                                                                                                                                                                                                                                                                                                                                                                       |
| Balance across jurisdictions              | settle old-jurisdiction leave before the new entitlement starts                                                                    | leave is settled by exit encashment and paid in the old jurisdiction; loans transfer by target catalogue code, otherwise settle                                                                                                                       | PASS — leave encashment PASS; SG→TW SALARY_ADVANCE transferred 300 with a new schedule; MY→TW AIR_TICKET_DEDUCTION had no target code and settled 400; forced settlement SG→TW settled 200                                                                                                                                                                                                                 |
| Exit encashment (MY)                      | approved leave balance converts to a final-pay line and ledger movement                                                            | UI Terminate created leave request `01a1a6dd-b56f…` (24 half-days, balance 12 → 0); payslip `01a1a6dd-d94a-7e1c…` period 2026-11 pays `ANNUAL_LEAVE` 806.77 × 12 in `FINAL_PAY`                                                                       | PASS                                                                                                                                                                                                                                                                                                                                                                                                       |
| Exit encashment (SG)                      | SG annual leave encashes in FINAL_PAY                                                                                              | live UI: SG0003 terminated 2026-11-04; SG November run Finalised; payslip `FINALISED · 5222.77` pays `ANNUAL_LEAVE` 1,910.77 (12 days) in `FINAL_PAY`; DB leave entry `encashment: true` with 24 half-days. Earlier workspace probe encashed 2,741.54 | PASS                                                                                                                                                                                                                                                                                                                                                                                                       |
| No double payment                         | a second payroll run for the same period must not repay a posted leave entry                                                       | the request is stamped with the first run; the second payslip `01a1a6dd-f558…` has no `ANNUAL_LEAVE` line                                                                                                                                             | PASS                                                                                                                                                                                                                                                                                                                                                                                                       |
| Void contract                             | press **Void contract** in the contract footer, give a reason, after the contract has been paid                                    | the contract moves to `VOID`; the next run excludes it                                                                                                                                                                                                | PASS — MY contract `01476913…` voided after the Nov run; the Dec run has 107 slips (down from 108) and no target payslip                                                                                                                                                                                                                                                                                   |
| Void employer payroll version             | press **Void version** on a sealed version that a run already used                                                                 | the version moves to `VOID`; the next run cannot use it                                                                                                                                                                                               | PASS — SG version `faa8efd0…` voided after the Nov run; the Dec run refused `No employer version covers the salary period`                                                                                                                                                                                                                                                                                 |
| Void jurisdiction version                 | press **Void version** beside the settings status, after a run used it                                                             | the version moves to `VOID`; the next run cannot use it                                                                                                                                                                                               | PASS — MY settings `8b8909da…` voided after the Nov run; the Jan run refused `Choose a sealed jurisdiction.`                                                                                                                                                                                                                                                                                               |

Notes:

- Promotion and transfer create the same replacement-contract draft; the difference is the recorded reason and, for transfer, the entity and jurisdiction settings.
- The current contract must be ended before the replacement is sealed. A finalised run blocks a substantive contract change in its period, but a captured contract can still be voided with a reason; the next run excludes it.
- `reason` records why a contract was voided or an employment ended; jurisdiction-specific exit facts remain in `employee_extension_data.exit_facts`.
- `employee_balance` is one row per employee. The balance follows the person; payroll reads it by `employee_id`, so a transfer does not need to move or duplicate it.
- A same-jurisdiction replacement repoints the loan and its open schedule to the successor contract (and entity, for a cross-entity move); payroll then selects the open repayments by entity and `paid_on`. A cross-jurisdiction replacement transfers the outstanding principal and schedule to a target loan when the target settings have the same loan catalogue code, otherwise it settles from final pay. The old open schedule is deleted first so it cannot be paid twice.

## 13. Statutory ledger, transfer, loan recovery, data request — 2026-11-05

Build `7de642b3836c` (schema `f84afa0d489a`, seed `05ee5357b95a`), 73 unit tests. `:4182` is the persistent base serve; `:4183` was a throwaway copy with the private bank, removed after the probes.

| Probe                          | Expected                                                                                        | Actual                                                                                                                           | Result       |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| R3 research host               | `{code:'ID', family:'statutory_contribution_catalog'}` returns official sources, `failed` empty | run `01a1a806…` succeeded; `failed: []`; 3 sources: bpjs-kesehatan.go.id, peraturan.go.id ×2; 0 proposed                         | PASS         |
| R1 confirm gates               | no official source or no quote refused; verifier stamped                                        | `Confirming a change needs an official https source.`; `…its quoted effective date.`; then `verified_by`, `verified_on` stamped  | PASS         |
| R2 future change               | draft dated the change, in-force version untouched                                              | draft from 2027-01-01 rate 0.02; in-force version still 0.01                                                                     | PASS         |
| R2 repeat                      | refused by name                                                                                 | `already_materialized: ID has a draft from 2027-01-01`                                                                           | PASS         |
| R2 seal                        | predecessor shortened, no overlap, change `APPLIED`                                             | predecessor `to` 2026-12-31; draft SEALED; `applied_version_id` set; an edit refused `locked while status is 'APPLIED'`          | PASS         |
| R2 cumulative                  | a later change builds on the sealed version; undated stays out                                  | draft from 2027-07-01 rate 0.03, name `Indonesia — 2027-07-01`; undated change left `PROPOSED`                                   | PASS         |
| R2 stale                       | refused by name                                                                                 | `stale: …lookup.employer_rate: the baseline holds 0.04, the change expects 0.99.`                                                | PASS         |
| R4 transfer categories         | target-driven dropdowns; an old value cleared                                                   | MY→TH shows `Select…` for category and residency; `NON_MANUAL`/`CITIZEN` not submitted; sealed `ORDINARY`/`RESIDENT`             | PASS         |
| R5 target extension            | TH fields render, prefilled from the prior TH contract                                          | nationality `TH` and `sso_continuing_insured` prefilled; sealed contract stores them; no MY keys                                 | PASS         |
| R6 cap from a figure           | expected 300 at 10% floor                                                                       | max 270, remaining 230, notice shown; schedule 12 rows summing to 230; loan period moved; HR task raised                         | PASS         |
| R6 payslip basis, custom floor | latest payslip 4,496.30 at 25% floor                                                            | max 3,372.22, remaining 5,627.78 over Dec–Feb                                                                                    | PASS         |
| R6 final payroll               | deducts the partial repayment only; net never below the floor                                   | Nov payslip gross 5,143, deductions 4,018.92, net 1,124.08 (25% of 4,496.30); later instalments stay open                        | PASS         |
| R6 HR notice                   | team inbox                                                                                      | task raised; the notice declared; not observed, the probe has no `hr_controller` member                                          | NOT VERIFIED |
| R7 failed pair                 | not `succeeded`                                                                                 | without the search key the run is `failed`: `1 of 1 failed: ID/statutory_contribution_catalog: 'web_search' is not a host tool…` | PASS         |
| R8 EPF effect                  | completes on an MY version with no registrations                                                | `succeeded`; EPF, HRD and SOCSO/EIS tasks raised; no duplicate                                                                   | PASS         |
| Large entity run               | a full MY run                                                                                   | refused `cpuBudget`: `the invocation used its 3000 ms of guest CPU` on 77 active contracts                                       | OPEN         |

Root causes found by these probes, each fixed at its shared function:

- `get(row, key, fallback)` returned a stored null instead of the fallback (R8).
- A compound read such as `'MY:KEY:' + ctx.entry.entity_id` or `[ctx.entry.catalog_id]` was sent as literal text, so every registered effect's idempotence guard missed its own row.
- Configuration and seal checks passed an empty subtotal set, refusing every `ctx.subtotals.X`; seed rows bypass the check, so no clone could ever finish.
- `configuration_execution` could not create `work_interruption_catalog`.
- Payroll deducted every open repayment whatever its date; an instalment is now due in the run that covers it.
- A json-schema `Editor` needs `kind: 'json'`; `kind: 'object'` with no fields renders `Empty object`, which also hid `employee_extension_data` in the contract form.

## 14. Employment import — 2026-11-05

Build `8790bec0e478` (schema `3d2a3d966642`), 90 unit tests.

| Probe                | Expected                                                           | Actual                                                                                                         | Result |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------ |
| First upload         | a Malaysia workbook with 1 company, 60 people and 70 contract rows | entity and version SEALED with EPF and SOCSO numbers; 60 profiles with no login; 70 contracts SEALED           | PASS   |
| Duplicated row       | the older contract closes before its change                        | IMP001 2026-02-01..2026-07-31 at 3,001, then 2026-08-01.. at 3,501                                             | PASS   |
| Second upload        | nothing new                                                        | still 2 entities, 60 people, 70 contracts; no failed runs                                                      | PASS   |
| Dropdowns in Numbers | enums stay selectors                                               | opened via AppleScript: enum cells report `pop up menu`; cells that pick from another sheet report `automatic` | PASS   |
