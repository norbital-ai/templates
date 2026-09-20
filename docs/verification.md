# HR verification record

Updated: 21 September 2026. Environment: local standalone host and synthetic test hosts.
Deployment and complete legal compliance are not established by these results. See the
[compliance matrix](compliance-matrix.md#release-blockers) before payroll approval.
Runtime fixes were tested through the local package overlay. This verification did not publish
packages or deploy an environment.

## Automated acceptance

| Check                                         | Result          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HR formatting and types                       | Pass            | `pnpm lint`: no errors or warnings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| HR calculation, policy and integration suite  | Pass            | 1,490 tests passed; no failures or skips. Bolt sync, doctor, export/import checks and the final Node test run passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| HR browser suite                              | Pass            | 20 tests passed across eight files after fixing message-admission timing and skipped view-transition rejection handling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| HR forms and representations                  | Pass            | Refreshed surface sweep: two browser tests pass across all 25 authored representations and scoped create forms, including child claims, TP1 deduction entry, audit totals, first contribution liability dates, incomplete registration edits, wage-history records and journals, and schema-generated entity and scheme declarations, including Taiwan tax and NHI enrolled-dependant controls. The latest sweep also saves a contribution-funding receipt and verifies its persisted amount and displayed outstanding balance. Dedicated payroll, leave, loan, holiday and employment-timeline cases passed in the earlier full browser run. |
| Departure event, deferral, retry and approval | Pass            | `leave-exit-encashment.test.ts`, `public-seed-exit-encashment.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Daily encashment timer                        | Pass            | A due schedule is seeded before host activation. The production timer creates and settles the occurrence without `automations.start`; one held leave entry is created.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Departure review completion                   | Pass            | HR rejection removes the held request; later catch-up runs skip the completed departure instead of raising it again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Encashment monetary consistency               | Pass            | `leave-payroll-family.test.ts`: MYR, VND and IDR pay lines match captured totals at currency precision; negative and non-finite rates are refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Dated wage history and stored rates           | Pass            | `reference-wages.test.ts`: the preceding complete period (MYR 2,310 / 21 days = 110) and the latest received/matured month (TWD 30,000 / 30 = 1,000) price cash-out and the work context; the consumed record is pinned for capture; missing, ambiguous and future-dated periods refuse by name. No sealed profile declares `ordinary_rate_reference` yet.                                                                                                                                                                                                                                                                                    |
| Monthly drift timer                           | Pass            | `public-seed-statutory-drift.integration.test.ts`: the production timer calls browser tools without a human subject and persists an unsealed proposal. Model and source responses are synthetic.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Drift evidence and draft controls             | Pass            | Changed, unchanged, unavailable, incomplete and conflicting evidence cases; no duplicate open proposal and no sealed-version mutation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Bolt scheduled dispatch and retention         | Pass            | `automations-automations.integration.test.ts`: 11 tests, including occurrence identity, earlier outcomes and retention after real queue cleanup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Bolt unit suite                               | Pass with skips | 918 passed; two skipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Agent-message admission                       | Pass            | 13 focused tests. The new regression failed before the fix and passes for command responses arriving before or after the saved message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Browser profile isolation                     | Pass            | Colony `facilities-host-tools-browser.test.ts`: 10 tests; invocation profiles are separate from person profiles, with form interaction refused without a person                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Standalone CLI                                | Pass            | Environment CLI lint and 54 tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Repository health                             | Pass            | Full syntactic, graph and type-aware assessment: 364 production files; no static errors, warnings or hints. Static assessment does not establish runtime or legal correctness.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

The timer tests seed a past-due occurrence with the declared cron expression. Activation preserves
that occurrence, supplies the automation's authority and starts the real host timer. These tests
exercise startup recovery, dispatch, persistence and settlement without waiting for the calendar's
next daily or monthly boundary.

Daily leave processing reads completed `not_due` outcomes and skips departures with a recorded
completion. It excludes historical contracts that have no recorded deferral. Retain deferral and
completion records together; deleting only a completion can reopen a deferral. Queue cleanup
preserves these outcomes after deleting old task envelopes. Changes after a held request is
created still require HR reconciliation.

## Payroll calculation regressions

Mechanism acceptance uses synthetic declarations with independently derived expected amounts.
Missing customer values are outside this gate. Required election presence is explicit; overlapping
conflicting statutory declarations stop calculation after version alignment. Required capture capabilities, formula use,
statutory defaults, historical balances and rounding remain inside it.

Versioned input declarations carry labels, choices, bounds, requiredness and explicit defaults.
The shared validator checks entity writes, employee elections, payroll and leave contexts.
`fact-contracts.test.ts` verifies missing inputs, explicit zero/false, constraints and default use.
`public-seed-fact-contracts.integration.test.ts` writes declarations through the standalone command
path, confirms invalid values cannot be saved, and builds payroll only after required values exist.
The delayed-cash-out regression checks a conditional requirement in the conversion-date schema
against recorded values before current-period defaults. Conditions are compiled on write and
evaluated before statutory rule selection. Entity and employee conditions distinguish missing
values from explicit zero or false. Tests cover undeclared entity references, condition dependencies,
invalid definitions and the extended seal checks. Taiwan NHI and withholding-table dependant
requirements use the shared declarations across all three fixture versions. A complete field audit
of statutory defaults and applicability remains open in the
[input contract review](compliance-matrix.md#jurisdiction-input-declarations).

Monthly contribution assessments assemble wages before applying monthly floors, ceilings and
bands. Split cut-offs apportion that assessment and reconcile it to actual monthly wages. The
closing calculation removes earlier cut-offs from annual history before reassessing the month;
stored bases, ordinary wages, rebates and contribution deductions are settled once. Monthly tax
reads the full monthly insurance assessment; per-period withholding reads the actual deduction.
Monthly claims remain current-month claims when a run key includes a cut-off suffix.

`monthly-contribution-cadence.test.ts` compares twelve successive monthly payrolls with all three
semi-monthly cut-off policies for SG, VN, MY, MY-nihon, ID and TW. Singapore includes the $8,000 ordinary
wage ceiling and $6,000 additional-wage ceiling on a $10,000 monthly salary. PH cases exercise
minimum SSS and PhilHealth amounts and the regular/MPF salary-credit split. MY and MY-nihon also
compare four- and five-week payroll months with one monthly assessment. Their catalogue schemes
now declare monthly assessment. Sources: [CPF Board](https://www.cpf.gov.sg/service/article/what-is-the-additional-wage-aw-ceiling),
[KWSP](https://www.kwsp.gov.my/en/member/savings/mandatory-contribution) and
[PERKESO](https://www.perkeso.gov.my/?Itemid=1280&id=817&option=com_content&view=article).
Indonesia's BPJS schemes and regular PPh21 now declare monthly assessment across all three
catalogue versions. On January salary of Rp15m, the pension contribution is Rp105,474 employee
and Rp210,948 employer; health insurance is Rp120,000 and Rp480,000. Monthly TER A withholding
is Rp1,092,420, including the applicable employer insurance premiums. The test compares all
twelve monthly settlements, including final-period tax reconciliation. Sources:
[BPJS contribution guidance](https://www.bpjsketenagakerjaan.go.id/penerima-upah.html) and
[PMK 168/2023](https://jdih.kemenkeu.go.id/dok/pmk-168-tahun-2023/summary).

Vietnam cases distribute 13 or 14 unpaid working days across two cut-offs and test FIRST, SPLIT
and LAST deductions. At VND22m monthly insured salary, 13 unpaid days retain VND1,760,000
employee and VND3,850,000 employer SI; 14 days produce zero under the default rule. Earlier
provisional deductions and their wage-history entries are reversed when month-end coverage
ceases. These cases follow [Law 41/2024 article 33(5)](https://xaydungchinhsach.chinhphu.vn/toan-van-luat-so-41-2024-qh15-bao-hiem-xa-hoi-119240723163650489.htm).
The agreement exception in that article, statutory sickness/maternity distinctions, termination
and weekly closing boundaries still require separate tests.

Taiwan cases separate monthly salary withholding from per-payment bonus withholding. Each
NT$60,000 bonus remains below its payment threshold; each NT$140,000 bonus withholds NT$7,000.
The employer health levy uses the whole month, including wages paid before a worker's departure.
Twelve-month cases verify that voluntary pension relief uses the current month's contribution once.
Final pay closes monthly deductions under FIRST, SPLIT and LAST policies.
Withholding boundary cases cover discarded fractional dollars, the NT$40,020 salary threshold,
bonus payments, non-residents and table counts above eleven. Table withholding reads an explicit
dated declaration; absent declarations select 5%. Customer declarations are not required for
these synthetic cases.
[Salary withholding regulations](https://law-out.mof.gov.tw/LawContent.aspx?id=FL005945),
[NHI contribution guidance](https://www.nhi.gov.tw/en/cp-68-8652f-35-2.html).

Tax-residence cases cross residence with citizenship and refuse an unknown residence for taxable
pay. NHI cases supply an enrolled-dependant count independently of family records, including zero,
the three-dependant cap, and missing or invalid declarations. The declaration write-to-payroll
test saves both tax and NHI facts through the collection transform. Cross-jurisdiction cases prevent
a same-named foreign scheme from suppressing withholding while retaining valid declarations across
entity lineages in the same jurisdiction.

Part-time NHI cases retain the NHI minimum insured grade when computing bonus thresholds and the
employer's supplementary premium. Each of the three catalogue versions is exercised; labour-insurance
part-time grades do not lower the NHI base.

Taiwan day cases cover January 16 and 31 joins, February 28 joins and departures, and an age-65
birthday after joining. LI continues for registered workers; missing LI standing at age 65 or above
stops calculation. The wage-arrears fund reproduces BLI's five-worker example: NT$140,970 of
covered wages and NT$35 employer levy. Coverage is independent of calendar-day salary proration.
[BLI premium calculator](https://www.bli.gov.tw/0014162.htm),
[pension calculation](https://www.bli.gov.tw/0017599.html),
[fund example](https://www.bli.gov.tw/0110180.html).
Deferred joiners, mid-month coverage changes and departure-bonus insurance remain open under C08.

Malaysia and MY-nihon regression cases now cover:

- First contribution liability across employers, separate from current-employer registration.
  SOCSO changes category at first liability age 55; EIS excludes first liability age 57 or above.
  Tests cover exact birthdays, three effective versions, required unknown history, impossible
  dates and ages where history cannot change the result. Certified invalidity pensioners use
  SOCSO Second Category independently of the generic pension flag.
- Separate normal/additional MTD minimums, including leave cash-out. The annual additional-pay
  offset uses rounded normal MTD; the TP1 cash-out regression withholds RM114.45 rather than
  RM114.75. LHDN’s worked April example produces RM833.70, and prior withholding above the
  annual liability leaves no additional tax.
- EPF projection separates normal contributions from bonus and encashment contributions. The
  MY and Nihon boundary case withholds RM315.40, with RM1,820 normal-pay relief and RM2,260
  additional-pay relief retained in the calculation trace. Caps, zero remaining months and
  missing component classifications are tested.
- Declared non-resident and unknown-residence withholding at 30%, without resident rebates.
- CP38 excluded from ordinary accumulated MTD and collected once across monthly cut-offs.
- Zakat carried into later months, including payments exceeding current tax and TP3 openings.
- Rebatable payments allocated once across multiple contracts and preserved by drift proposals.
- Child relief declarations by tax year and category, with full and half entitlements independent
  of family records; prior/future years and absent claims receive no deduction.
- TP1 2026 deduction categories, annual caps, medical/education sublimits, shared provident-fund
  and social-insurance limits, alimony/spouse sharing and joint-home interest allocation.
- Dated TP1 and prior-employer deduction claims, signed corrections, future-month exclusion,
  claim-interval refusals and required housing facts.
- Deduction and refusal fields retained when drift proposes an unrelated contribution-rate change.

The hosted `public-seed-payroll.integration.test.ts` writes a rebate declaration through
`collections.write`, builds two payrolls and checks the stored payslip amounts. This tests the
application write path, storage, schema and calculation together. Statutory values are tested
separately against the Malaysia catalogue in `statutory-golden-my.test.ts`. A separate hosted
case writes dated first-liability declarations, builds January and February payrolls and verifies
both saved charges and the date retained in each calculation trace. Another case writes a
child-relief declaration through the same command and verifies that the selected
tax year and 50% share reach the stored payslip. A deduction-ledger case writes prior-employer,
current and future-month claims and verifies two successive payrolls. Expense declarations remain
outside payslip payment lines. `statutory-tp1-my.test.ts` verifies the Malaysia amounts separately,
including the full additional-remuneration tax in a bonus month. TP1 external-payment rebates, special tax profiles, voluntary/compulsory EPF interactions and
assessment years outside 2026 remain outside this verification.

Vietnam's focused run passes 60 tests across statutory goldens, work bands, drift and expression
contracts. New cases cover declared non-residents across five periods, short contracts, conflicting
overrides, June/July 2026 overtime exemptions and leave cash-out before an actual departure.

Vietnam unpaid-leave continuation cases cover the December 2025, January 2026 and July 2026
catalogues under FIRST, SPLIT and LAST contribution policies. At 14 unpaid working days, an
agreement using a VND17 million prior base produces VND1.36 million employee SI and VND2.975
million employer SI, plus VND255,000 employee HI and VND510,000 employer HI. UI remains zero.
The reduced occupational-accident rate produces VND2.941 million employer SI. Separate cases
verify required declarations, invalid bases, agreement start/end dates, the July contribution floor
and an encashment payment alongside continued insurance. Missing customer declarations are not
used as test failures; synthetic declarations exercise the mechanism.
[SI law](https://xaydungchinhsach.chinhphu.vn/toan-van-luat-so-41-2024-qh15-bao-hiem-xa-hoi-119240723163650489.htm),
[HI guidance](https://baohiemxahoi.gov.vn/tintuc/Pages/linh-vuc-bao-hiem-xa-hoi.aspx?CateID=168&ItemID=26671),
[UI law](https://xaydungchinhsach.chinhphu.vn/toan-van-luat-viec-lam-119250711173403835.htm).
Full unpaid months now retain the full contribution assessment with zero cash pay. January cases
with 20, 21 and 22 unpaid working days produce contribution shortfalls of VND0, VND615,000 and
VND1,615,000. A fully unpaid June with 1.5 days of leave cash-out produces VND1,571,429 gross,
VND1,615,000 employee contributions and a VND43,571 shortfall. Unpaid deductions round
cumulatively per employment term and calendar month, so separate daily requests reconcile to the
same deduction as one combined request without exceeding a fully unpaid salary segment.

`public-seed-contribution-funding.integration.test.ts` runs the compiled standalone host. It verifies
persisted shortfalls, refusal of unfunded settlement and later bank export, receipt capture and
successful settlement after funding. `paid-per-slip.test.ts` checks receipt bounds, currency
precision, required evidence, receipt/settlement dates, paid immutability and deletion protection.
Reports show the original shortfall, receipts and the outstanding balance; zero cash pay is omitted
from bank payments. These checks do not establish remittance or authorize later wage deductions.
Partially unpaid days, sickness/maternity and the other C08 cases remain open.

`leave-encashment-valuation.test.ts` checks partial days, qualifying and excluded allowances,
conversion-date salary, delayed payment, Vietnam's prior-month salary and working days, and
Taiwan's original carried-leave salary. Mixed carried and current-year credit is valued separately.
Unsupported profiles, wage frequencies and missing allowance classifications stop calculation.

MY and MY-nihon weekly cases pay MYR165.25 for 1.5 days at MYR601 weekly basic and MYR260
qualifying monthly allowance: `(601 / 6 + 260 / 26) × 1.5`. Delayed payment retains the original
rate after both amounts change. Weekly ordinary-rate tests check the same unit conversion.
A separate payroll regression pays MYR59.27 of a MYR260 monthly allowance for 29 June–5 July,
using `260 × (2/30 + 5/31)` and retaining the weekly basic salary. These cases failed before
the weekly encashment profile and allowance-unit corrections.

`statutory-golden-my.test.ts` preserves Nihon's excess-hours incentive funnel and checks the
ordinary wage including fixed allowances, work-date salary changes, and EPF/SOCSO/EIS/PCB bases.
`statutory-golden-ph.test.ts` checks paid-day exemption history across a salary increase and the
shared ₱90,000 pool for excess leave, excess rice subsidy, bonus and 13th-month pay. Missing paid
day quantities stop the exemption calculation.

The standalone departure integration test approves the automation's request and creates a later
payroll. It verifies seven synthetic days at MYR 3,451 / 26 produce MYR 929.12, preserves the
unrounded daily rate and confirms that the ended contract receives no restarted salary. The
request is linked to its payslip to prevent another settlement.

## Live standalone observations

The standalone was started with `pnpm run env -- serve --template=hr-payroll --port=4182`.
The browser engine and model provider were configured. Private bank data remained in the local
in-memory host. These observations establish command dispatch, live source access and the
recorded outcomes. Synthetic tests separately establish scheduled execution and calculation
behaviour. No employee records are reproduced here.

| Observation                                                | Result                                                                                               | Run identifier                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Singapore statutory research, 09:20–09:31 UTC              | Completed; 18 of 20 cited sources readable; zero proposals; zero execution failures; review required | `6b9b6a98-14d5-4dc5-b5d0-0bca15689b1c:start`        |
| Departure event and retry on the refreshed host, 09:47 UTC | One held positive encashment; retry created no duplicate; HR approval settled the request            | Retry: `6f33f259-0d09-46b2-8dd5-cb3ff4e4ffb1:start` |
| Daily leave run on the current 1,490-test build            | HTTP 200; zero registered deferrals, requests and failures                                           | `5d3a2346-d067-44a9-9aeb-6a515ea5e430:start`        |

The current CLI-started host serves the build verified by the 1,490-test run. Its direct
`leave_encashment_due` invocation verifies command dispatch. Non-empty due-date and departure
execution are covered by the production host-timer and approval integration tests. The Singapore
statutory research row above was observed on the earlier build; this verification did not re-run
drift research against live providers.

The Singapore run required review because two CPF pages lacked readable statutory material,
several quoted passages did not match the independent source reader, and some configured rows
had no verified comparison. No unsupported draft was created. Other jurisdictions were not
researched against live providers in this verification. Approval of leave days does not validate
the money conversion or final-payment deadline.

## Shared-checkout limits

The OSS build and Bolt production type check passed. The full OSS lint remained blocked by
concurrent mobile/PWA fixture changes (`wake` and PWA service types). The full OSS test command
failed on the `UI26` rule's own geolocation and clipboard examples. These failures prevent a claim
that the entire shared checkout passed its gates. The affected files were outside this change.

The six-jurisdiction legal review remains incomplete. Separate leave valuation now has independent
expected amounts for monthly salary cases in SG, MY, PH, VN and TW, plus MY and MY-nihon weekly pay. Indonesia cash-out,
other wage frequencies and unclassified allowances stop pending an evidenced profile. Final-pay
timing, tax-clearance holds, statutory working-time controls and current legal instruments remain
subject to C01–C08. Passing automation tests does not close those items.
