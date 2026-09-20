# HR and payroll compliance coverage

Review date: 20 September 2026. Scope: Singapore, Peninsular Malaysia and Labuan, the
Philippines, Indonesia, Vietnam and Taiwan. A country code does not establish coverage of every
territory, industry, occupation or employment arrangement.

**Calculation mechanism verification: incomplete.** Acceptance covers supported legal rules,
required input capture, formula wiring, history, rounding and independently derived synthetic
results. Missing values in customer or seed employee records do not count as mechanism defects.
Missing capture capability, ignored inputs and unsupported applicable calculations do.

## Calculation acceptance

Acceptance is assessed against an explicit jurisdiction, effective date and supported employment
profile. Every applicable calculation requires:

1. An authoritative rule and commencement date.
2. Fields for each fact that changes the result, including prior-period and prior-employer amounts.
3. A trace from the saved facts to the selected rule and rounded payment or deduction.
4. Independently derived expected amounts at thresholds, date boundaries and correction cases.
5. Form-to-payroll verification and a statutory default or clear refusal for missing required facts.

An empty customer field does not fail this gate when the required capture and unknown-input
behaviour are verified. An absent field, an ignored declaration, an incorrect formula, or an
untested applicable branch remains a mechanism gap. Passing the existing test suite measures its
assertions; it does not establish that the suite contains every applicable rule. Operational
obligations outside calculation are tracked separately below.

Employee declarations and operational obligations are separate readiness checks. An employer's
historical payroll is reconciliation evidence, not legal authority. A difference from that
payroll must not override the applicable law.

## Status definitions

| Status     | Meaning                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Tested     | Named automated cases exercise the implementation; legal scope and current rates still require source review.     |
| Partial    | Some cases are implemented, but a material calculation or workflow remains unresolved.                            |
| External   | An HR or finance procedure is required outside the payroll calculation. Retain its evidence.                      |
| Unverified | The primary authority, effective date, supported calculation profile or expected result has not been established. |

## Payroll coverage

The remaining items below concern calculation mechanisms. Payment deadlines, filings, approvals
and documentary evidence are listed under obligations outside calculation and do not determine
the status in this table.

| Jurisdiction | Calculations represented                                                                                                    | Automated evidence                                                                                | Remaining verification                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SG           | CPF, SDL, self-help funds, work premiums, leave and separation catalogue                                                    | `statutory-golden-sg.test.ts`, `statutory-work-bands.test.ts`, `leave-entitlement-golden.test.ts` | Verify allowance classifications, PR-date boundaries and fund-election handling. **Partial.**                                                                                 |
| MY           | EPF, SOCSO, EIS, HRD levy, PCB, overtime, leave and termination catalogue                                                   | `statutory-golden-my.test.ts`, `ordinary-rate-divisor.test.ts`                                    | Complete variable/daily/hourly wage and encashment bases, special PCB profiles and voluntary/compulsory contribution relief interaction. **Partial.**                         |
| PH           | SSS, PhilHealth, Pag-IBIG, withholding tax, wage floors, work premiums and separation catalogue                             | `statutory-golden-ph.test.ts`, `semi-monthly-runs.test.ts`                                        | Verify employee-category rules, regional wage-order commencement, tax annualisation and SIL conversion bases. **Partial.**                                                    |
| ID           | BPJS schemes, PPh21, work premiums, THR and separation catalogue                                                            | `statutory-golden-id.test.ts`, `statutory-work-bands.test.ts`                                     | Cash-out is blocked pending an evidenced daily basis; verify termination-category calculations and regional wage-order selection. **Partial.**                                |
| VN           | Social, health and unemployment insurance, PIT, union fee, leave and separation catalogue                                   | `statutory-golden-vn.test.ts`, `leave-entitlement-golden.test.ts`                                 | Reference-month cash-out is tested; continued-insurance agreements, sickness/maternity exceptions, variable remuneration and legal-version evidence remain open. **Partial.** |
| TW           | Labour insurance, occupational accident insurance, employment insurance, NHI, labour pension, withholding and work premiums | `statutory-golden-tw.test.ts`, `leave-entitlement-golden.test.ts`                                 | Verify deferred joiners, dated insurance changes, departure-bonus bases, withholding-declaration change dates and leave-conversion exceptions. **Partial.**                   |

Every effective version needs cases immediately before and after commencement, at each monetary
and age boundary, and for each supported employee category. Prior-employer balances, residency,
coverage elections and exemptions require documentary evidence; a missing fact is not an exemption.

## Calculation input audit

Reviewed against the source models, forms, catalogue expressions and payroll context on
20 September 2026. Capture, rule wiring and legal verification are separate requirements.
The following findings are not resolved by increasing the number of existing golden tests.

| Requirement                        | Current evidence                                                                                                                                                                                                                                                                                            | Gap and required resolution                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MY tax residency                   | Contract terms capture `tax_residency`. PCB previously read only a separate `rate_override`; explicit non-resident cases reproduced RM123.90 instead of RM1,500.30 on RM5,001.                                                                                                                              | MY and MY-nihon now use 30% for non-residents and employees not known to be resident, as LHDN D(a) prescribes. Resident reliefs require `RESIDENT`; citizenship does not select tax residence. Approved special tax profiles and conflicting overrides still require verification.                                                                                                                             |
| MY allowable tax deductions        | TP1/TP3 deduction claims now capture month, category, signed amount, source and declaration reference. The 2026 catalogue applies category caps, nested limits, EPF/SOCSO shared limits, alimony/spouse sharing, claim intervals and joint-home interest allocation.                                        | Synthetic cases cover MY and MY-nihon. Earlier-year deductions are excluded from the current year; future months are excluded; corrections and prior-employer claims share the same annual cap. Claims outside the verified 2026 rules stop calculation. TP1 external-payment rebates, special tax profiles, and other assessment years remain open. [TP1 form][my-tp1] and [explanatory notes][my-tp1-notes]. |
| MY projected pension relief        | Normal and additional remuneration now have separate EPF bases and relief reads. Current additional-pay contributions are included once; future months repeat the normal contribution only.                                                                                                                 | MY and MY-nihon regressions cross the RM35,000 rebate boundary and check annual caps, prior-employer amounts and year-end zero projection. The calculation trace retains both relief amounts. Unclassified contribution components stop calculation. Voluntary TP1 contributions interacting with projected compulsory contributions still require reconciliation against LHDN examples.                       |
| MY accumulated zakat               | Rebatable payments now persist on statutory payslip lines and accumulate by person and tax year. TP3 opening balances capture prior-employer rebates.                                                                                                                                                       | Monthly cases cover normal offsets, excess zakat retained in full, previous employers and allocation across contracts. Historical rows created without rebate amounts require reconciliation; customer values are outside mechanism acceptance.                                                                                                                                                                |
| MY child relief allocation         | Tax-year declarations capture eligible full and half-entitlement counts by relief category, with an employee declaration reference. MY and MY-nihon formulas consume those shares independently of family records.                                                                                          | Tested: full, half and mixed shares; all five categories; no claim; prior/future tax-year exclusion; turning 18 during the basis year; invalid counts and duplicate categories. Eligibility evidence is an operational responsibility. [LHDN PR 7/2025][my-child-ruling] and [BE explanatory notes][my-child-notes].                                                                                           |
| VN tax residency and exemptions    | PIT now reads declared non-residence before resident short-contract and annualisation rules. Non-residents receive 20% without a duplicate override; pre-July 2026 overtime and leave retain the earlier tax treatment.                                                                                     | Five salary periods, short contracts, conflicting overrides, the June/July overtime boundary and future-departure leave treatment are tested. Unknown residence, changes during a tax year, ordinary night-shift salary and allocation of excess leave payments still require verification. [Government tax guidance][vn-residence] and [Decree 253/2026 interpretation][vn-exemptions].                       |
| Statutory declaration completeness | Catalogue rules can distinguish an omitted election from an explicit zero or false using `scheme.election_keys`. Required unknown inputs and conflicting active declarations can stop calculation with a specific reason.                                                                                   | Apply and test refusal rules wherever a required unknown has no statutory default. TP1 housing facts, conflicting claim intervals and unsupported claim years are covered. Other applicable schemes still require a field-by-field audit.                                                                                                                                                                      |
| Leave cash-out wage basis          | The dated encashment profile captures included/excluded allowances and a formula. ID has no verified profile; daily/hourly/variable remuneration is not covered by the sealed profiles.                                                                                                                     | Establish the applicable legal or contractual basis and the required reference-period wage inputs. Adding an arbitrary divisor would not close the legal gap.                                                                                                                                                                                                                                                  |
| Dated wage history                 | `employment_wage_periods` stores approved, non-overlapping wage periods per employment (normal wages, ordinary earnings with actual days, due and received dates, evidence reference). Payroll reads them in one batched wave and pins every consumed record on the payslip through `payslip_wage_periods`. | `work_rules.ordinary_rate_reference` selects `PREVIOUS_WAGE_PERIOD` (MY s.60I(1C): ordinary earnings over actual days) or `LATEST_DUE_MONTH` (TW: latest full month received or matured, normal wages over 30). `tests/reference-wages.test.ts` covers adjacency, ambiguity, advances and refusals; no sealed profile declares the rule yet, so both jurisdictions' production profiles remain unverified.     |
| Captured-data integration          | Most statutory golden cases supply complete synthetic facts directly to the engine.                                                                                                                                                                                                                         | Add form/write-to-payroll tests for required facts, missing facts, conflicting declarations and changes across effective dates. Every applicable rule needs an independent expected result.                                                                                                                                                                                                                    |

Synthetic cases establish mechanism behaviour independently of customer declarations. Tests must
cover complete inputs, explicit zero or none, missing required inputs, conflicting declarations,
dated changes and settled history. Required unknown inputs must stop calculation or follow an
explicit statutory default; they must not silently become a favourable tax election.

### Jurisdiction input declarations

`jurisdiction_settings.facts` declares entity inputs, and `statutory_contributions.elections`
declares employee scheme inputs. Both use the versioned `fact_keys` datatype. Declarations support
labels, help text, primitive types, allowed values, numeric bounds, whole-number constraints,
minimum text lengths, unconditional or conditional requiredness and explicit statutory defaults. Duplicate keys,
inconsistent constraints and invalid defaults are rejected.

Entity writes validate supplied keys and values against the sealed, unvoided versions in the
selected lineage. A company can span several versions; calculation checks the exact governing
version again. Employee statutory-fact writes validate supplied election keys, types and constraints.
Incomplete records may be saved, but a field marked required stops calculation when unrecorded.
Explicit zero and false satisfy presence checks. A declared default does not replace a supplied value.

The entity and statutory registration forms generate controls from these declarations. Users select
allowed choices instead of editing field names or types. Missing values remain unrecorded in the
form. Taiwan tax-table and NHI dependant counts use declared non-negative, whole-number constraints;
conditional presence is declared with `required_when`. NHI requires the count when its assessed
base is positive. The resident withholding table requires the declared count when table withholding
applies; the 5% method and non-resident withholding do not require that table count.

Entity conditions use the declared entity context; employee scheme conditions use the assessed
base and scheme context. Invalid conditions and undeclared election references are refused on
write. Conditional requirements run before rule selection, and raw presence is checked before
defaults can satisfy a required declaration. A condition that reads another scheme's result
participates in dependency ordering. Undeclared entity inputs stop statutory calculation instead
of becoming zero. Sealing checks entity references in ordinary bases, rebates, deductions and
conditional requirements as well as the main assessed bases and charge rules.

Payroll and leave contexts share the value validator. Delayed cash-out checks recorded company
values before current-payroll defaults against the conversion-date version, including a carried
leave year's preserved valuation date. `fact-contracts.test.ts` covers declaration constraints,
entity and employee writes, missing required values, explicit zero/false and defaults reaching
payroll. `public-seed-fact-contracts.integration.test.ts` exercises saved declarations, rejected
writes and payroll readiness through the standalone command path. A delayed-encashment regression
checks that a newer default cannot satisfy an older required declaration.

Remaining work: migrate each applicable field's statutory default or conditional requirement into
an audited input contract. Legacy optional declarations still receive primitive empty placeholders;
some conditional requirements remain in calculation rules. Fixed employee/profile columns also
require an applicability audit. Entity facts remain a current record, so
historical changes need dated capture where they affect valuation. These mechanisms do not replace
independent verification of formulas, statutory coverage or effective dates. Actual customer values
are outside mechanism acceptance.

MY and MY-nihon capture `first_contribution_due_on` separately from current-employer
registration. It records the first statutory contribution liability, including earlier employers,
rather than the first payment. SOCSO uses Second Category when first liability arose at age 55
or above; EIS excludes employees whose first liability arose at age 57 or above. The dated
declaration reaches the calculation trace. Required unknown history and impossible dates stop
calculation; history is optional when it cannot change the age category.
`statutory-coverage-my.test.ts` covers birthday boundaries, employer changes and all three
effective versions. [Act 4, First Schedule paragraph 12][my-act4] and
[Act 800, First Schedule paragraph 9][my-act800] establish these tests. SOCSO also declares
`certified_invalidity_pension`: a certified invalid receiving invalidity pension uses Second
Category under paragraph 12(iii). The generic pension flag does not select this exception.
Tests cover pensioners below 55 and ages 55–59 with unknown prior liability history.

MY tax input requirements above are supported by the [LHDN 2026 specification][my-mtd],
sections D and E, and the [official 2026 testing questions][my-mtd-tests].

[my-mtd]: https://www.hasil.gov.my/wp-content/uploads/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf
[my-tp1]: https://www.hasil.gov.my/wp-content/uploads/bm-borang-tp1-2026.pdf
[my-tp1-notes]: https://www.hasil.gov.my/wp-content/uploads/nota-penerangan-tp1-2026.pdf
[my-mtd-tests]: https://www.hasil.gov.my/wp-content/uploads/mtd-testing-question-2026.pdf
[my-act4]: https://www.perkeso.gov.my/images/akta/ACT%204/Act%204%20-%20EMPLOYEES%E2%80%99%20SOCIAL%20SECURITY%20ACT%201969%20%28As%20at%201%20September%202022%29.pdf
[my-act800]: https://perkeso.gov.my/images/akta/ACT%20800/Akta%20800_EMPLOYMENT%20INSURANCE%20SYSTEM%20ACT%202017.pdf

## Release blockers

Calculation acceptance and operational readiness are separate. C02, C03 and the procedural parts
of C04 and C07 belong to operational readiness; they do not reduce calculation test coverage.
C01 concerns valuation scope, C05 rule-maintenance coverage, C06 legal-version evidence, and C08
calculation cadence.

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                 | Required resolution                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | Dated cash-out rules cover monthly and semi-monthly SG, MY, PH, VN and TW salaries, plus MY weekly wages. Unsupported frequencies and unclassified allowances stop payroll. ID has no verified default profile. Approved dated wage history (`employment_wage_periods`) and the `work_rules.ordinary_rate_reference` selector now exist for the prior-period (MY) and latest-due-month (TW) bases; no sealed profile declares them yet. | Independent fractional-day, allowance, salary-change and delayed-payment tests are in `leave-encashment-valuation.test.ts`; the reference-wage selector is covered by `reference-wages.test.ts`. Resolve ID’s contractual/statutory daily basis and variable/daily/hourly arrangements before enabling them, then declare the selector on the verified profiles. |
| C02 | One regular payroll per entity and period does not enforce termination-specific payment deadlines.                                                                                                                                                                                                                                                                                                                                      | Establish a supported final-pay process and test its settlement timing. A later regular period is not automatically lawful.                                                                                                                                                                                                                                      |
| C03 | The template has no explicit IR21 tax-clearance hold and release workflow.                                                                                                                                                                                                                                                                                                                                                              | Prevent disbursement where clearance applies, retain the directive and reconcile withheld and released amounts.                                                                                                                                                                                                                                                  |
| C04 | Future departures are deferred and a daily catch-up calculates the balance when due. Changes after a request is held still require reconciliation before approval.                                                                                                                                                                                                                                                                      | Due-date deferral and duplicate prevention are tested. Establish the final HR cut-off and correction procedure; a scheduled run does not freeze all subsequent attendance or leave changes.                                                                                                                                                                      |
| C05 | Drift automation compares contribution rule expressions (including deductions and rebates), refusal reasons and leave entitlements. It does not automatically update work rules, wage floors, contribution bases, eligibility, required input declarations or filing duties.                                                                                                                                                            | Review these fields separately against official sources for every relevant effective date. An automated no-change result cannot close this requirement.                                                                                                                                                                                                          |
| C06 | Tests and historical registers contain future-dated tables and claims whose full authority chain has not been revalidated in this review.                                                                                                                                                                                                                                                                                               | Verify the instrument, publication and commencement date of each future version. Announcements without a settled instrument remain unverified.                                                                                                                                                                                                                   |
| C07 | Nihon retains its configured transfer of excess overtime into OT incentives. Tests preserve the hours and statutory payment multiple, including qualifying fixed allowances.                                                                                                                                                                                                                                                            | Verify coverage, consent, exemptions, actual-hours reporting and statutory pay. Monetary classification must not be treated as permission to exceed a limit.                                                                                                                                                                                                     |
| C08 | Monthly salary cases reconcile across SG, VN, MY, MY-nihon, ID and TW. TW also has separate bonus withholding, monthly company levies, final-pay reconciliation and thirty-day insurance coverage cases. VN's default 13/14 unpaid-day threshold reads the complete month.                                                                                                                                                              | Verify deferred joiners, weekly closing, mid-month registration changes, departure bonuses, sickness/maternity and partially unpaid days. Payroll deferral must not omit insurance owed for the joining month.                                                                                                                                                   |

Vietnam's SI declarations capture an explicit continuation decision, the most recent contribution
base and an agreement reference. Dated declarations select the applicable agreement; current
statutory floors and caps apply to its historical base. HI follows the continued SI base. UI remains
exempt at 14 unpaid working days under its separate rule. [Law 41/2024 articles 31, 33 and 34][vn-si-law],
[Vietnam Social Security guidance](https://baohiemxahoi.gov.vn/tintuc/Pages/linh-vuc-bao-hiem-xa-hoi.aspx?CateID=168&ItemID=26671),
[Law 74/2025 article 33(4)](https://xaydungchinhsach.chinhphu.vn/toan-van-luat-viec-lam-119250711173403835.htm).

When wages cannot cover employee statutory contributions, settlement retains the full assessment,
sets cash net pay to zero and records the contribution shortfall. Employee funds received outside
payroll are recorded separately, with an amount, receipt date and reference. Settlement requires
full funding; later bank payments require earlier shortfalls to be funded by their payment date.
Paid receipts are immutable, and slips with recorded funds cannot be deleted. Reports distinguish
the original shortfall, funds received and the outstanding balance. Later payroll does not
automatically recover a shortfall.

This mechanism does not establish statutory remittance, collection deadlines, employer-funded
benefits or lawful deductions from later wages. Partial unpaid days and statutory sickness/maternity
treatment also require separate verification. These are mechanism gaps, independent of customer
data completeness.

Taiwan coverage cases distinguish calendar salary proration from the insurance calendar. Registered
labour insurance continues after age 65; employment insurance stops before that birthday. Company
levies retain earlier monthly payslips even when every worker has departed before the closing run.
The wage-arrears fund matches BLI's published five-worker example, including workers with only
occupational accident insurance. [BLI premium calculation](https://www.bli.gov.tw/0014162.htm),
[coverage](https://www.bli.gov.tw/0007758.html),
[employment insurance age limit](https://www.bli.gov.tw/0101714.html),
[wage-arrears fund example](https://www.bli.gov.tw/0110180.html).

The current late-joiner rule can defer wages and their contribution assessment together. A Taiwanese
employee joining after an attendance cut-off can therefore have no joining-month insurance result.
This is a mechanism defect. Multiple coverage changes within a month and bonus insurance bases
at departure also require independent cases; a correct monthly salary result does not establish
those branches.

## Leave conversion requirements

The separate `work_rules.encashment` profile implements the supported monthly salary cases below,
plus weekly basic pay for MY and MY-nihon.
Every standing allowance needs an explicit included or excluded classification. A missing profile
or unsupported wage frequency stops calculation. Confirm coverage and amendments for each entity.

| Jurisdiction | Required basis                                                                                                                                                                                                     | Evidence and remaining work                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SG           | Monthly-rated gross daily rate: `12 × qualifying monthly gross pay ÷ (52 × contractual days per week)`. Termination conversion uses the last drawn salary.                                                         | [MOM salary definitions][sg-rates] and [leave on termination][sg-leave]. Distinguish qualifying allowances from excluded reimbursements, productivity payments, travel, food and housing allowances.                                                                                              |
| MY           | Section 60E(3A) uses ordinary pay. Section 60I distinguishes monthly pay divided by 26, weekly pay divided by 6, and qualifying prior-period earnings divided by actual working days for daily/hourly/piece rates. | [Employment Act sections 60E and 60I][my-act]. A current hourly contract rate alone does not establish the prior-period average; establish the statutory wage base and coverage.                                                                                                                  |
| PH           | SIL conversion uses the salary rate on the conversion date; unused statutory SIL can remain payable on separation.                                                                                                 | [DOLE handbook, printed pages 27–28][ph-handbook]. Verify the employee's SIL coverage, accrued fractions and the daily-rate basis for the wage arrangement. Contractual vacation leave may have separate terms.                                                                                   |
| ID           | PP 35/2021 article 40(4)(a) includes untaken, unexpired annual leave among compensable rights.                                                                                                                     | [PP 35/2021][id-termination]. The provision does not establish the template's overtime divisor as a leave-conversion divisor. The daily conversion basis remains unverified.                                                                                                                      |
| VN           | Decree 145/2020 article 67(3) identifies contract salary for the month preceding cessation/job loss as the unused-leave salary basis.                                                                              | [Official decree][vn-decree]. The prior contract month and its normal work-pattern days are tested. Verify amendments and additional salary components.                                                                                                                                           |
| TW           | Normal-hours daily wages immediately before year end or termination; monthly-rated normal-hours wages for the preceding month divided by 30.                                                                       | [Enforcement Rules article 24-1][tw-rules]. Include qualifying normal-hours wage components and test year-end and termination. Tests also distinguish original carried credit from current-year entitlement in a combined cash-out; multiple transfers of the same credit require reconciliation. |

Acceptance cases must include an allowance included by law, an excluded payment, a dated pay
change, delayed settlement, a partial leave day and each supported wage frequency. Expected
amounts must be derived independently of the engine and identify their rounding basis.

MY weekly conversion uses weekly basic pay divided by 6 plus qualifying monthly allowances
divided by 26. Allowance amounts retain their monthly unit in weekly payroll and are prorated
across calendar-month boundaries. Tests cover both Malaysian lineages, fractional days, delayed
payment and changes to both salary and allowances. Daily, hourly and variable earnings still
require the preceding-period wage and worked-day basis in section 60I(1C).

Indonesia's daily basis needs a supported authority or contractual rule. The ministry's
[2014 explanation][id-leave-2014] uses monthly wages divided by 30; a
[BPHN consultation dated 22 September 2025][id-leave-2025] uses 25 and notes company-policy
differences. The consultation expressly states that its advice is not legally binding.
PP 35/2021 article 40 establishes the entitlement without specifying a daily divisor; its
article 33 conversion rules concern overtime. The default profile therefore remains absent.
This is an unresolved rule-selection requirement, independent of employee-record completeness.

## Calculation corrections verified in this review

- Approved dated wage history now prices a statutory ordinary or normal-wage rate where the
  current contract cannot: `employment_wage_periods` (non-overlapping periods, ordinary
  earnings with actual days, due and received dates, evidence reference) is read in the
  payroll gather, and `work_rules.ordinary_rate_reference` selects the preceding complete
  period (MY s.60I(1C)) or the latest received/matured month (TW). The consumed record is
  pinned on the payslip through `payslip_wage_periods`; a missing adjacent period, an
  ambiguous or future-dated month and a changed currency stop calculation.
  `tests/reference-wages.test.ts` derives the daily amounts independently (MYR 2,310 / 21
  days = 110; TWD 30,000 / 30 = 1,000) and covers the refusal branches.

- Malaysia's departure-levy ledger sums each journey's corrections and refuses when a
  corrected journey reverses more than the accepted payment
  (`scheme.deduction_claims_negative_event`); the two-journey lifetime limit and the
  missing-journey-reference refusal remain. `statutory-tp1-my.test.ts` covers both lineages.

- Indonesia prices termination benefits from the detailed PP 35/2021 cause declared on the
  employment (`employments.exit_facts.termination_cause`) rather than the broad exit reason:
  preventing loss or closure pays the whole award, an actual loss half; retirement 1.75×,
  long illness or death 2×. Article 157 wage bases (monthly, daily, output), micro/small
  enterprise agreements and the article 58 employer-funded pension offset are consumed from
  the same dated declarations. THR remains a festival wage: it prices on the event date and
  does not owe termination inputs. `statutory-golden-id.test.ts` and
  `statutory-coverage-id.test.ts` cover the cause matrix and refusals.

- Taiwan labour insurance, employment insurance, occupational accident, labour pension and
  NHI now assess the declared `insured_amount` grade from the dated statutory registration
  instead of re-deriving the base from the current wage, so a variable-wage employee keeps
  the recorded grade. `wage-averages.test.ts` asserts the declared-grade requirement.

- TW withholding discards fractional NT dollars before applying the NT$2,000 exemption.
  NT$40,001 and NT$40,019 remain exempt; NT$40,020 withholds NT$2,001. Resident 5%,
  non-resident 6%/18% and bonus cases cover all three catalogue versions. The published
  table remains verified against all 10,080 cells; salary above NT$500,000 or more than
  eleven spouse/dependant exemptions uses the actual-salary formula.
  [Tax remittance article 5](https://law-out.mof.gov.tw/LawContent.aspx?id=FL051526),
  [2026 salary-table explanation](https://www.ntbca.gov.tw/download/ec08154ea280452daefa59a110336f6e).

- TW table withholding now requires `table_declaration_reference` and reads `table_dependants`
  from the dated statutory registration. The count includes the declared spouse and dependants,
  excludes the taxpayer, and is independent of family records. Missing declaration evidence
  selects the statutory 5% default; missing, negative or fractional counts stop calculation.
  The registration form provides named declaration and count controls. Saved declarations pass
  through the collection write gate into payroll. Conflicting active declarations across rule
  versions stop calculation instead of overwriting one another.
  [Salary withholding regulations articles 3–7](https://law-out.mof.gov.tw/LawContent.aspx?id=FL005945).
  The declaration effective date must follow article 5: increases apply from the event month;
  divorce, spouse death and dependant reductions apply from the following January. Automatic
  enforcement of those different change dates remains unverified.

- TW withholding reads declared tax residence independently of citizenship. A missing residence
  stops calculation when taxable pay is positive. Resident and non-resident cases cover citizens,
  permanent residents and foreigners in every catalogue version.
  [MOF withholding guidance](https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/individual-income-tax/withheld-rule/rule/NM11BZY).

- TW NHI uses a separate dated `enrolled_dependants` declaration. Family and tax-dependant
  records do not grant or remove NHI enrolment. Missing, negative and fractional counts stop
  calculation; explicit zero is valid. At the NT$40,100 insured grade, employee premiums are
  NT$622 with no enrolled dependants, NT$1,866 with two and NT$2,488 with three or more;
  employer premiums remain NT$1,940. The form has a named count field, and the collection
  write-to-payroll case verifies its use.
  [NHI calculation rules](https://www.nhi.gov.tw/ch/cp-3277-6c895-2588-1.html).

  NHI also applies its own minimum insured grade to part-time employees. The lower labour-insurance
  grades no longer reduce the base used by supplementary premiums. In the 2026 case, NT$12,000
  salary and NT$60,000 bonus use the NT$29,500 NHI grade: no employee supplementary premium and
  NT$897 employer supplementary premium.
  [2026 NHI employee table](https://www.nhi.gov.tw/ch/cp-19418-9eefb-2576-1.html).

- Statutory facts align across catalogue versions and entity lineages only within the same payroll
  jurisdiction. A same-named scheme from another jurisdiction cannot supply an exemption or
  declaration. Regression cases reproduce the former NT$3,000 withholding omission and preserve
  valid declarations across entity lineages in the same jurisdiction.

- VN declared non-residents receive 20% before resident short-contract rules. A tested VND20m
  short-contract salary now withholds VND4m instead of VND2m. Before July 2026, only the
  qualifying overtime premium is exempt for non-residents; full statutory overtime exemption
  starts in July. The leave exemption also distinguishes resident and non-resident commencement,
  and a future exit date no longer makes current-period cash-out exempt.

- MY and MY-nihon child relief uses declared tax-year claims. Recording a child alone no longer
  grants relief. Full and half shares are applied to the statutory category amounts; declarations
  from another tax year are excluded. A child who turns 18 during the basis year can retain the
  qualifying annual declaration. The form records the declaration reference and keeps family
  records available to statutory leave calculations.

- MY and MY-nihon retain qualifying zakat in the annual rebate history and accept prior-employer
  rebates through the statutory opening balance. RM100 paid in January now reduces the tested
  February deduction to RM9.70 rather than RM18.80. A RM1,000 payment is retained in full even
  when January tax is zero, as required by [LHDN 2026 D(1) and E(5)][my-mtd].

- Directed tax instalments remain separate from ordinary withholding in annual and monthly
  history. A January RM1,000 CP38 instalment no longer reduces February's normal PCB from
  RM109.70 to RM18.80. A monthly direction is collected once across settled pay cut-offs,
  including monthly contribution true-ups. [LHDN 2026 section D, definition of X][my-mtd]
  excludes tax instalments from accumulated MTD.
- MY and MY-nihon PCB read the contract's tax residence. Non-residents and employees not
  known to be resident receive the statutory 30% withholding without resident rebates.
  No duplicate rate override is required; customer citizenship does not establish residence.
- MY normal and additional remuneration each receive the RM10 MTD minimum. A tested
  RM96.17 leave cash-out beside RM5,001 normal pay now withholds RM109.90 rather than RM115.65.
  The minimum and rounding follow [LHDN 2026 section E(1–5)][my-mtd].
- Work-day rates use salary and allowances effective on the day worked. Intermediate hourly and
  daily quotients retain precision; finished awards round in the payroll currency.
- MY monthly ordinary pay includes qualifying fixed allowances under section 60I. Nihon's daily
  and monthly incentive boundaries remain in place; the transfer retains its configured multiple. EPF excludes these overtime earnings, while SOCSO, EIS and PCB include them. [KWSP’s definition of overtime payments][my-epf-payments] includes work beyond normal hours; the payslip label does not change that classification.
- PH vacation cash-out consumes an annual day allowance at each payment's original rate. A salary
  increase does not renew used days. Excess vacation and rice benefits share the ₱90,000 exemption
  with 13th-month pay and bonus; only the excess above that pool enters withholding.
  [BIR RMC 50-2018, question 5][ph-benefits] establishes this treatment. The current ceilings are
  in [RR 29-2025][ph-deminimis]. Missing historical day quantities or unresolved reversals stop
  the exemption calculation. Prior payments must be complete for the tax year.
- PH annual daily-rate factors retain `365 / 12` and `313 / 12` precision in absence proration.

The BIR regulation takes effect fifteen days after official publication. Early-January 2026
payments require confirmation of publication and payment dates; a January catalogue label does
not establish commencement. Different wage frequencies, variable wages and benefits outside the
configured catalogue still need explicit rules and evidence.

## Obligations outside calculation

The owner column names the responsible role, not an assigned individual. Each legal entity must
assign a person, record applicability and retain completion evidence. These rows are review
requirements, not claims that the workflow is implemented.

| Jurisdiction | Obligation                                                           | Trigger or timing                                                                  | Owner and evidence                                                  | Status / authority                                                                                                  |
| ------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| SG           | Final salary payment                                                 | Employment ends; timing depends on notice and termination circumstances            | Payroll / payment receipt and termination record                    | External; [MOM payment deadlines][sg-pay]                                                                           |
| SG           | Tax clearance and withholding                                        | Applicable non-citizen cessation, overseas posting or departure; assess exceptions | Finance / IR21 submission, withheld balance and clearance directive | External; [IRAS IR21][sg-clearance]                                                                                 |
| SG           | Misconduct inquiry and leave forfeiture assessment                   | Dismissal alleged to justify forfeiture                                            | HR / inquiry finding and applicable statutory basis                 | External; [MOM termination][sg-termination], [annual leave][sg-leave]                                               |
| SG           | Government-paid leave and NS reimbursement                           | Eligible absence and claim window                                                  | HR / approval, attendance and reimbursement receipt                 | Unverified filing coverage; review scheme-specific agency requirements                                              |
| MY           | Retrenchment notification                                            | Reportable retrenchment, separation scheme, lay-off or pay reduction               | HR / Borang PK and receipt                                          | External; [JTKSM termination guidance][my-termination]                                                              |
| MY           | Paternity notice and eligibility evidence                            | Application under section 60FA                                                     | HR / notice, marriage and confinement evidence                      | External; [Employment Act 1955][my-act]                                                                             |
| MY           | Termination benefits, final wages and permitted deductions           | Contract termination and applicable coverage                                       | HR and Payroll / cause, service calculation and payment receipt     | External timing controls; [Employment Act 1955][my-act]                                                             |
| MY           | EPF registration and remittance                                      | Covered employees, including applicable foreign employees                          | Finance / registration and contribution receipt                     | External; [KWSP employer guidance][my-epf]                                                                          |
| PH           | Final pay and certificate of employment                              | Separation or certificate request                                                  | HR / itemised settlement, payment and certificate delivery          | External; verify Labor Advisory 06-20 itself before configuring deadlines; [DOLE advisory catalogue][ph-advisories] |
| PH           | Contribution remittance and employer reporting                       | SSS, PhilHealth and Pag-IBIG schedules                                             | Finance / accepted returns and remittance receipts                  | External; [SSS contribution guidance][ph-sss]; other agency filing coverage unverified                              |
| PH           | Statutory leave eligibility and proof                                | SIL, maternity, paternity, solo parent, VAWC and special leave applications        | HR / eligibility and supporting records                             | External; [DOLE leave guidance][ph-leave]                                                                           |
| ID           | Termination procedure and compensation entitlement                   | Each legally defined termination cause                                             | HR / notices, consultation, cause and settlement evidence           | External; [PP 35/2021][id-termination]                                                                              |
| ID           | Overtime consent, records and limits                                 | Overtime is requested or worked                                                    | HR / consent and actual-hours records                               | External; [PP 35/2021][id-termination]                                                                              |
| ID           | BPJS registration, wage reporting and remittance                     | Covered employment and reportable wage changes                                     | Finance / registration and accepted contribution records            | External; [BPJS participant guidance][id-bpjs]                                                                      |
| VN           | Contract termination procedure and final settlement                  | Applicable Labour Code termination ground                                          | HR / notice, legal ground and payment record                        | Unverified end-to-end coverage; [Labour Code record][vn-code]                                                       |
| VN           | Social-insurance leave benefit claims                                | Eligible fund-paid absence                                                         | HR / claim, medical evidence and agency decision                    | Unverified claim workflow; fund-paid leave is not an employer reimbursement receipt                                 |
| VN           | Overtime consent, limits and required reporting                      | Overtime arrangement and applicable statutory thresholds                           | HR / consent and labour-authority filings                           | Unverified procedural coverage; [Labour Code record][vn-code]                                                       |
| TW           | Unused annual leave settlement and employee records                  | Year end, agreed carry-forward expiry or contract termination                      | HR and Payroll / leave statement, wage basis and payment            | Partial; [LSA article 38][tw-act], [Enforcement Rules article 24-1][tw-rules]                                       |
| TW           | Compensatory rest for statutory rest-day work                        | Permitted work under article 40                                                    | HR / legal basis, actual hours and compensatory leave record        | External; [LSA articles 36 and 40][tw-act]                                                                          |
| TW           | Old-system pension reserve and committee duties                      | Employer retains workers covered by the old system                                 | Finance / applicability assessment and reserve records              | External; [LSA article 56][tw-act]                                                                                  |
| All          | Tax returns, annual employee statements and agency remittance        | Applicable authority's filing calendar                                             | Finance / accepted filing and payment receipts                      | Unverified filing coverage; calculation or workbook export is not submission                                        |
| All          | Work authorisation, employment records, privacy and workplace safety | Hiring, employment, record retention and termination                               | HR / applicable-law register, permits and retained evidence         | Separate compliance review required; these areas are not implemented by the payroll engine                          |

## Automation acceptance

`statutory_drift` runs monthly and can be started for one settings group. It rereads cited official
pages, verifies quoted passages and proposes unsealed changes only for an identified commencement
date. Unknown rule conditions require manual review of the complete table. Different commencement
dates and conflicting version timelines require review before a draft can be created.

`no_changes_detected` means the supported rows were compared with retrieved evidence. It is not a
statement about every employment law. Missing comparisons, rejected evidence, unavailable sources,
open proposals and drafts are listed for review. Research failures remain in `failures`.

`leave_encashment_on_exit` submits unused leave for approval, including dismissed employees. The
departure reason does not by itself establish forfeiture. The deterministic contract/leave
reference prevents duplicate entries, and the database enforces uniqueness. Approval, lawful
valuation, final payment and any tax-clearance hold are separate requirements.

Future departures return `not_due`. `leave_encashment_due` runs daily at 01:00 UTC, reads recorded
deferrals, checks the departure date in the jurisdiction's time zone and submits due requests
through the same approval policy. Retain deferred run records until settlement. Unregistered
historical departures require HR review and an explicit run. Synthetic integration tests cover
the production timer, deferral, held requests, duplicate prevention and historical-import exclusion.

The integration suites exercise the standalone host and its production timer with synthetic data.
The drift suite substitutes the model and source reader. It proves scheduling, browser-tool calls
without a human caller and persistence, not current provider availability or deployment.
Production verification must identify the tenant release, run ID, evidence and resulting draft
or held entry.

## Official sources

Sources below were located or read during this review. A link does not validate every row in a
jurisdiction's catalogue. Use the applicable consolidated instrument and amendments when resolving
a blocker.

[sg-pay]: https://www.mom.gov.sg/employment-practices/salary/paying-salary
[sg-clearance]: https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-%28ir21%29/getting-tax-clearance-a-step-by-step-guide
[sg-termination]: https://www.mom.gov.sg/employment-practices/termination-of-employment/what-is-termination
[sg-leave]: https://www.mom.gov.sg/employment-practices/termination-of-employment/termination-with-notice
[sg-rates]: https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary
[my-act]: https://jtksm.mohr.gov.my/sites/default/files/2023-11/Akta%20Kerja%201955%20%28Akta%20265%29.pdf
[my-coverage]: https://www.perkeso.gov.my/uncategorised/778-contributions.html
[my-termination]: https://jtksm.mohr.gov.my/ms/soalan-lazim/pemberhentian-pekerja
[my-epf]: https://www.kwsp.gov.my/en/employer/responsibilities/non-malaysian-citizen-employees
[ph-advisories]: https://bwc.dole.gov.ph/issuances/labor-advisories/
[ph-sss]: https://www.sss.gov.ph/pay-contribution/
[ph-leave]: https://bwc.dole.gov.ph/dole-bwc-conducts-informative-discussion-on-statutory-leave-benefits/
[ph-handbook]: https://nwpc.dole.gov.ph/wp-content/uploads/2023/08/2023-07-25-Handbook-on-Workers-Statutory-Monetary-Benefits-2023_edition.pdf
[id-termination]: https://peraturan.bpk.go.id/Home/Download/154582/PP%20Nomor%2035%20Tahun%202021.pdf
[id-leave-2014]: https://jdih.kemnaker.go.id/berita/detail/waktu-istirahat-dan-cuti
[id-leave-2025]: https://literasihukum.bphn.go.id/konsultasi-hukum/24388
[id-bpjs]: https://www.bpjsketenagakerjaan.go.id/artikel/18893/artikel-siapa-sajakah-peserta-dari-bpjs-ketenagakerjaan
[vn-code]: https://vbpl.moj.gov.vn/bocongthuong/Pages/vbpq-vanbanlienquan.aspx?ItemID=139264
[vn-decree]: https://datafiles.chinhphu.vn/cpp/files/vbpq/2020/12/145.signed.pdf
[tw-act]: https://laws.mol.gov.tw/Eng/PrintFLAWDAT0201.aspx?id=FL014930
[tw-rules]: https://laws.mol.gov.tw/Eng/PrintFLAWDAT0202.aspx?flno=1-51&id=FL014931
[ph-benefits]: https://bir-cdn.bir.gov.ph/local/pdf/RMC%20No%2050-2018.pdf
[ph-deminimis]: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2029-2025.pdf
[my-epf-payments]: https://www.kwsp.gov.my/en/employer/introduction
[my-child-ruling]: https://www.hasil.gov.my/media/0jbegsui/pr-7-2025.pdf
[my-child-notes]: https://www.hasil.gov.my/media/pshpbomm/explanatorynotes_be2025_2.pdf
[vn-residence]: https://xaydungchinhsach.chinhphu.vn/quy-dinh-thue-thu-nhap-ca-nhan-doi-voi-thu-nhap-tu-tien-luong-tien-cong-119260327070011016.htm
[vn-exemptions]: https://baochinhphu.vn/cac-truong-hop-tien-luong-tien-cong-duoc-mien-thue-tncn-102260715163431228.htm
[vn-si-law]: https://xaydungchinhsach.chinhphu.vn/toan-van-luat-so-41-2024-qh15-bao-hiem-xa-hoi-119240723163650489.htm
