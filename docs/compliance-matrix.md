# HR and payroll compliance coverage

Review date: 23 September 2026 (independent audit per lineage, rounds 1–5). Scope: Singapore,
Peninsular Malaysia and Labuan, the Philippines, Indonesia, Vietnam and Taiwan. A country code
does not establish coverage of every territory, industry, occupation or employment arrangement.

**Calculation mechanism acceptance: complete for the supported profiles.** Every other item the audit raised is decided, with its
authority and a hand-derived test. Missing values in customer records do not count as mechanism
defects; missing capture, ignored inputs and unsupported applicable calculations do.

## Calculation acceptance

Acceptance is assessed against an explicit jurisdiction, effective date and supported employment
profile. Every applicable calculation requires:

1. An authoritative rule and commencement date.
2. Fields for each fact that changes the result, including prior-period and prior-employer amounts.
3. A trace from the saved facts to the selected rule and rounded payment or deduction.
4. Independently derived expected amounts at thresholds, date boundaries and correction cases.
5. Form-to-payroll verification and a statutory default or clear refusal for missing required facts.

Passing the suite measures its assertions; it does not establish that the suite contains every
applicable rule. An employer's historical payroll is reconciliation evidence, not legal
authority, and must not override the applicable law.

## Status definitions

| Status   | Meaning                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Tested   | Named automated cases with hand-derived expected figures exercise the rule in every affected version.     |
| External | An HR or Finance procedure outside the calculation, recorded in the version's obligations register.       |
| Watch    | A future instrument is announced but not published; the drift automation watches the named official page. |

## Payroll coverage

| Jurisdiction | Calculations represented                                                                                                                                                                                                                                      | Automated evidence                                                                                              | Status                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| SG           | CPF, SDL, self-help funds, work premiums (44-hour divisor, gross rate), leave incl. part-time proration, salary in lieu of notice, deduction ceiling, separation                                                                                              | `statutory-golden-sg`, `statutory-audit-sg`, `statutory-round5-T`, `statutory-sg-declarations`                  | **Tested**; childcare in progress |
| MY           | EPF (incl. Part F, pre-1998 members), SOCSO, SKBBK phases, EIS, HRD levy, PCB with TP1/TP3 (YA2025–2026), overtime and 104-hour ceiling, minimum wage by day/hour, leave, termination benefit, notice, deduction ceiling                                      | `statutory-golden-my`, `statutory-audit-my`, `statutory-audit-my-nihon`, `statutory-tp1-my`, `round4-O`         | **Tested**                        |
| PH           | SSS, PhilHealth, Pag-IBIG, withholding (residency, per-day MWE, de minimis by item, maternity exempt), regional and domestic wage floors, holiday premiums, 13th month, SIL incl. weekly, separation and retirement by establishment                          | `statutory-golden-ph`, `statutory-audit-ph`, `round4-N`, `round5-S`, `statutory-ph-declarations`                | **Tested**; OT meal in progress   |
| ID           | BPJS (daily ×25), PPh21 TER with PTKP at 1 January, residency and no-tax-id surcharge, PKWT compensation at final rates, uang pisah, work premiums, THR on the declared holiday, leave cash-out on the declared basis, deduction ceiling, separation by cause | `statutory-golden-id`, `statutory-audit-id`, `statutory-coverage-id`, `round4-L`, `round4-Q`                    | **Tested**                        |
| VN           | SI/HI/UI (retirement age by hire year, pension-qualified UI exclusion), PIT with residency, night-work and leave exemptions, finalisation, union dues, hourly minimum wage, overtime ceilings, severance on six-month average                                 | `statutory-golden-vn`, `statutory-audit-vn`, `statutory-audit-lead`, `round4-Q`, `statutory-vn-id-declarations` | **Tested**                        |
| TW           | LI/EI (§73 subsidy, 育嬰留職停薪), occupational accident, NHI incl. part-time supplement, labour pension and old-system reserve, withholding, §32-1 hours and 補休 balance, §32(2) ceilings, §24-1 cash-out, severance on the §2 average wage                 | `statutory-golden-tw`, `statutory-audit-tw`, `statutory-mechanisms-tw`, `round4-M`, `round5-U`                  | **Tested**                        |

Every effective version needs cases immediately before and after commencement, at each monetary
and age boundary, and for each supported employee category.

## Independent audit, 23 September 2026

Each lineage (SG, MY, MY-nihon, PH, ID, VN, TW) was audited separately against primary sources:
every statutory mechanism for the supported profiles was inventoried, mapped to its seed row or
engine code, and priced by a test whose expected figure is derived by hand in the test's comment —
never taken from the engine or a re-implementation. Each fix was proven by the test failing on the
previous seed or engine. Expressions were read for hard-coded people, tenant catalogue codes and
unexplained constants.

| File                                                   | Covers                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `statutory-audit-{sg,my,my-nihon,ph,id,vn,tw}.test.ts` | Per-lineage boundary cases (thresholds, caps, ages, commencement dates)                                                                                                              |
| `statutory-audit-lead.test.ts`                         | VN six-month contractual average, MY misconduct notice, TW disability subsidy                                                                                                        |
| `statutory-round2-{A,B,C,D}.test.ts`                   | Deduction ceilings, final-pay working days, exit facts and forfeiture; payslip-history averages; allowance caps, PIT finalisation, EPF/EIS categories, NHI part-time; work-day rates |
| `statutory-round3-{E..K}.test.ts`                      | TW emergency and §32-1 hours, dated versions, ID PTKP at 1 January, rest-day and holiday hours in the ceilings, mid-period wage floors                                               |
| `statutory-round4-{L,M,N,O,Q}.test.ts`                 | ID cash-out basis and PKWT tax; TW §73 rounding and 補休; PH 365 factor and per-day MWE; MY Part F and s.24(8); SG SHG on notice pay; VN/ID residency, exemptions and inputs         |
| `statutory-round5-{S,T,U,V,W,Y,Z}.test.ts`             | PH residency, SIL, de minimis; MY YA2025 TP1, s.24(9)(b); SG childcare, cash-out frequencies, inputs; TW §24-1, §2 average wage, reserve, parental leave, coverage changes           |
| `statutory-{sg,my,ph,vn-id}-declarations.integration`  | Saved declarations reach payroll through the standalone write path: required, missing, conflicting and dated                                                                         |
| `statutory-round5-U.integration.test.ts`               | TW old-system reserve rate saved as a dated entity fact, read by the hosted run                                                                                                      |

Engine changes made in the audit are jurisdiction-free: statutory hourly divisor
(`rate_week_hours`), `daily_month_days`, service through the exit day, `year.earned.ABSENCE`,
`period.leave_pay.<CODE>`, hourly and domestic wage tables, deduction ceilings, working-day
final-pay basis, `encash_on_exit_when`, earnings averages from paid payslips (with the `WAGES`
mark), `gross_monthly`, per-day `emergency_cause` and `time_off_in_lieu`, `DOUBLE_HOLIDAY`,
`counts_day_when` / `counts_beyond_normal_when`, year-start declarations, `ordinary_rate_reference`
(`PREVIOUS_WAGE_PERIOD`, `LATEST_DUE_MONTH`), `paid_rest_days`, and the hosted preload that keeps
dated entity facts and wage periods apart.

## Mechanism status per lineage

Decided items, each with the authority it rests on. Where the law defers a figure to the
contract, company regulation or an election, it is a required declared input (see
[Declared-input contract](#declared-input-contract)).

| Lineage    | Item                                                | Decision                                                                                                                                                                                                                                                                                            | Authority                                                                                    | Evidence                                  |
| ---------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------- |
| SG         | SHG funds on salary in lieu of notice               | Excluded in every version                                                                                                                                                                                                                                                                           | CPF Board FAQ (CPF not payable on notice pay; SHG payable if CPF payable); Muis MBMF Table 2 | `round4-O`                                |
| SG         | Last-salary deductions                              | Outside the 50% limit                                                                                                                                                                                                                                                                               | EA s.32(2)                                                                                   | `round5-T`                                |
| SG         | Cash-out for weekly, daily, hourly pay              | Priced at the gross rate of pay                                                                                                                                                                                                                                                                     | EA s.2                                                                                       | `round5-T` (D19)                          |
| SG         | Childcare with an earlier employer                  | Declared `prior_childcare_days` reduce the 42-day lifetime room                                                                                                                                                                                                                                     | CDCSA / EA s.87A; MOM changing-employer rules                                                | `round5-T` (G10)                          |
| SG         | Unrecorded residency, race, religion                | Refuse instead of skipping CPF or a fund                                                                                                                                                                                                                                                            | CPF Act; SHG schedules                                                                       | `round5-T`, `statutory-sg-declarations`   |
| SG         | Childcare, extended childcare and infant care leave | s.12B(1) months-of-service ladder (2–6 days, 2 at least); childcare and extended childcare share 6 a year; per-child lifetime caps 42 / 12 / 14 and infant care 24, less that child's declared earlier-employer days                                                                                | CDCA ss.12B(1)–(3), 12D(1)–(2); EA s.87A                                                     | `round5-W`                                |
| MY, nihon  | EPF Part F rounding                                 | Total rounded to the next ringgit, then split                                                                                                                                                                                                                                                       | EPF Act Third Schedule Part F para 2; KWSP example 2.4                                       | `round4-O`                                |
| MY, nihon  | s.24(8) half                                        | Statutory deductions count inside the half; on the final payslip only amounts due to the employer leave it                                                                                                                                                                                          | EA 1955 s.24(2)(d), (8), (9)(b)                                                              | `round4-O`, `round5-T`                    |
| MY, nihon  | YA2025 TP1 and approved profiles                    | 2025-12 version carries the 2025 caps; YA2026-only reliefs refuse                                                                                                                                                                                                                                   | LHDN MTD 2025 specification amendment, part E                                                | `round5-T` (D07)                          |
| MY, nihon  | Special tax profiles, TP1 rebates                   | REP/C-suite profiles within approval years; zakat and departure-levy rebates                                                                                                                                                                                                                        | LHDN MTD 2026 D, E                                                                           | `statutory-tp1-my`                        |
| MY, nihon  | Daily/hourly ordinary rate                          | Preceding complete wage period over days worked                                                                                                                                                                                                                                                     | EA 1955 s.60I(1C)                                                                            | `statutory-golden-my`, `reference-wages`  |
| MY, nihon  | SKBBK phases                                        | Sealed 1.00% from 1 June 2028 and 1.25% from 1 June 2031                                                                                                                                                                                                                                            | Act A1788 s.3, s.17; P.U.(B) 196/2026                                                        | `round4-O` (every version)                |
| PH         | 365-day factor                                      | Read from `employment_terms.paid_rest_days`, not a payroll-group label                                                                                                                                                                                                                              | DOLE Handbook 2023 ch.2 §D                                                                   | `round4-N`                                |
| PH         | Minimum-wage-earner exemption                       | Split by day across wage-order commencement                                                                                                                                                                                                                                                         | RR 11-2018 s.2.78.1(B)(13); NCR-28 from 26 Sep 2026                                          | `round4-N`                                |
| PH         | Tax residency                                       | Table for residents and engaged aliens, 25% for not engaged; unknown refuses                                                                                                                                                                                                                        | NIRC s.22, s.24(A), s.25(A)–(B)                                                              | `round5-S` (D11)                          |
| PH         | SIL: weekly pay, fractions                          | Week's pay over days paid; accrual unrounded                                                                                                                                                                                                                                                        | DOLE Handbook ch.7 §D                                                                        | `round5-S` (D19, D41)                     |
| PH         | De minimis caps                                     | Each item to its RR 29-2025 cap, excess into the ₱90,000 pool                                                                                                                                                                                                                                       | RR 29-2025 (effective 6 Jan 2026); RMC 50-2018                                               | `round5-S`, `round3-F`                    |
| PH         | OT/night-shift meal allowance                       | Paid in full; exempt to 25% (30% from 6 Jan 2026) of the day's regional minimum wage per overtime or night day; excess, including earlier payslips' excess at their own floor, enters the ₱90,000 pool                                                                                              | RR 11-2018 s.2.78.1(A)(3); RR 29-2025; RMC 50-2018                                           | `round5-V`, `round5-Z`                    |
| ID         | Leave cash-out basis (C01)                          | Entity declares PK/PP/PKB wage basis and divisor; unrecorded stops by name                                                                                                                                                                                                                          | UU 13/2003 arts.79(4), 156(4)(a) as amended; PP 35/2021 art.40(4)(a)                         | `round4-L`                                |
| ID         | PKWT compensation tax                               | Final PPh 21 at 0/5/15/25%; PPh 26 20% for non-residents                                                                                                                                                                                                                                            | PP 68/2009 arts.1(4), 5; PP 35/2021 art.15(2)                                                | `round4-L`                                |
| ID         | Residency, tax identity                             | Unknown residency refuses; declared missing NPWP adds 20%                                                                                                                                                                                                                                           | UU 36/2008 arts.2(3)–(4), 21(5a)                                                             | `round4-Q`                                |
| ID         | THR window for any year                             | Judged against the declared `thr_holiday_date`                                                                                                                                                                                                                                                      | Permenaker 6/2016 art.7(1)                                                                   | `round4-Q` (G14)                          |
| VN         | Residency and mid-year change                       | Unknown refuses; each month on its recorded status; finalisation re-prices the year                                                                                                                                                                                                                 | Decree 253/2026 arts.4–5, 46(3), 51, 66(1)(a)                                                | `round4-Q` (D11, D12)                     |
| VN         | Night-work wage                                     | Exempt (residents from 2026, non-residents from 1 July 2026)                                                                                                                                                                                                                                        | Decree 253/2026 arts.26(1), 69(1)                                                            | `round4-Q` (D13)                          |
| VN         | Excess leave pay                                    | Income of the month paid                                                                                                                                                                                                                                                                            | Decree 253/2026 arts.26(2)–(3), 46(3)                                                        | `round4-Q` (D14)                          |
| TW         | §73 disability subsidy                              | Subsidy on the unrounded share, rounded on its own; NHI per insured and dependant                                                                                                                                                                                                                   | 補助辦法 §§4–5; BLI worked example; 健保法 §27, 細則 §52                                     | `round4-M`                                |
| TW         | §32-1 補休 balance                                  | Hours credited by the settling run; untaken hours paid at expiry or exit at the day's rates                                                                                                                                                                                                         | 勞基法 §32-1; 細則 §22-2                                                                     | `round4-M`, `round5-U`                    |
| TW         | §24-1 cash-out                                      | Latest month's normal wage read from its payslip; none recorded stops by name                                                                                                                                                                                                                       | 勞基法施行細則 §24-1                                                                         | `round5-U` (D21)                          |
| TW         | Average wage                                        | §2 exclusions (公傷病假, 留職停薪, reduced-pay leave); `WAGES`-marked classes enter the history                                                                                                                                                                                                     | 勞基法 §2(3)(4); 細則 §2                                                                     | `round5-U`                                |
| TW         | Old-system reserve                                  | Rate required when an old-system worker is present                                                                                                                                                                                                                                                  | 勞基法 §56(1)                                                                                | `round5-U`, `round5-U.integration` (G15b) |
| TW         | 育嬰留職停薪                                        | Employer share waived for leave days; worker billed directly; 職災/勞退 left registered refuses                                                                                                                                                                                                     | 性別平等工作法 §16(2); 就業保險法                                                            | `round5-U` (D31)                          |
| TW         | Coverage changes within a month                     | Each enrolment on its own grade and days; grade change inside continuous cover refuses                                                                                                                                                                                                              | 勞保條例 §14(2)                                                                              | `round5-U` (D36)                          |
| All        | Captured-data integration                           | Saved declarations reach payroll: required, missing, conflicting, dated                                                                                                                                                                                                                             | —                                                                                            | `*-declarations.integration` (D22)        |
| VN, TW, ID | Cash-out for other pay frequencies                  | VN daily/weekly/hourly from the prior month's contract wage; TW weekly as the week's wage over its working days; ID daily and hourly. ID has no weekly wage unit in law (PP 36/2021 art.15 allows hourly, daily or monthly only), so a weekly ID contract is refused as unlawful rather than valued | VN Decree 145/2020 arts.54(1), 67(3); TW 細則 §24-1(2); PP 36/2021 arts.15–16                | `round5-Y`                                |

## Declared-input contract

`jurisdiction_settings.facts` (entity), `statutory_contributions.elections` (employee scheme) and
the version's exit facts use the versioned `fact_keys` datatype: type, allowed values, bounds,
`required`, `required_when` and a cited `default_value`. Every key in every sealed version is
required, conditionally required, or carries a statutory default that is the statute's own rule,
never its exception (`round4-Q`, `round5-T`, `round5-U` assert this per lineage).

| Behaviour              | Rule                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required, unrecorded   | Calculation stops with a named refusal. Raw presence is checked before defaults; conditions run before rule selection.                                                                          |
| Statutory default      | Applies only when nothing is recorded; never replaces a supplied value. Examples: TW `overtime_consent` false (§32(2) 46 hours), MY `pcb_tax_profile` STANDARD, VN `commitment_form` false.     |
| Absence is the law     | A few keys are read only when present: SG `shg_monthly_amount` (absent = Schedule amount), MY `wages_12m` (absent = payslips), TW `table_declaration_reference` (absent = statutory 5% method). |
| Explicit zero or false | Satisfies presence.                                                                                                                                                                             |
| Fixed profile columns  | Nullable employee and contract columns a rule reads (tax residency, race, religion, marital status, nationality, birth date, industry class) refuse when unrecorded.                            |
| Undeclared or invalid  | Undeclared keys, invalid conditions and constraint violations are refused on write; incomplete records may be saved.                                                                            |

Entity facts are dated (`company_facts`); a delayed cash-out reads the conversion-date version.
Declarations align across versions and entity lineages only within one payroll jurisdiction.
Prior-employer balances, residency and elections are declared with evidence; verifying that
evidence is operational.

## Legal-source watch

Values below stay on the current instrument until the successor is published. The drift
automation watches each page and proposes a sealed version on publication.

| Instrument awaited                         | Seed today                                                                        | Watch page                                                                                                                                                         | Expected          |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| TW 116年 minimum wage and grade tables     | 2027 version keeps the 115年 ladders (29,500); LI 12% from 2027 is statutory      | [MOL RSS](https://www.mol.gov.tw/1607/1632/1633/RssList), [BLI news](https://www.bli.gov.tw/news.xml)                                                              | Oct–Dec 2026      |
| ID JP wage ceiling from March 2027         | Rp11,086,300 (SE B/1226/022026)                                                   | [BPJS Ketenagakerjaan berita](https://www.bpjsketenagakerjaan.go.id/berita.html)                                                                                   | late Feb 2027     |
| MY MTD/PCB 2027 specification and TP1 2027 | YA2027 TP1 claims and approved profiles refuse; standard PCB on the 2026 schedule | [LHDN PCB schedules and specification](https://www.hasil.gov.my/en/majikan/jadual-pcb-dan-spesifikasi-data/)                                                       | Dec 2026–Jan 2027 |
| VN 2027 regional minimum wage decree       | Decree 293/2025 (Region I 5,310,000); UI cap 20× regional minimum                 | [Government legal documents](https://vanban.chinhphu.vn/he-thong-van-ban?mode=0)                                                                                   | Nov–Dec 2026      |
| SG NDR 2026 childcare leave (CCL + ECL)    | Current CCL/ECL; announced, not legislated, no start date                         | [MSF childcare leave](https://www.profamilyleave.msf.gov.sg/schemes/childcare-leave), [SSO new legislation](https://sso.agc.gov.sg/What's-New/New-Legislation/RSS) | not dated         |
| PH NCR-27 second tranche                   | NCR-28 (₱755 / ₱718 from 26 Sep 2026); NCR-27 enjoined                            | [NWPC NCR](https://nwpc.dole.gov.ph/ncr/)                                                                                                                          | court-dependent   |
| SG CPF First Schedule order for 2027       | 2027 rates sealed from CPF Board Tables 1–5 (matched)                             | [SSO CPF Act subsidiary legislation](https://sso.agc.gov.sg/Act/CPFA1953?ViewType=Sl-Rss)                                                                          | Q4 2026           |

Per-version and per-entity source review (commencement, coverage, amendments) remains a human
duty; a `no_changes_detected` drift result does not certify it.

## Obligations outside calculation

The register lives on each sealed version (`jurisdiction_settings.obligations`): trigger, due
date in the authority's own terms, responsible role and instrument, with status EXTERNAL (an HR or
Finance procedure) or PARTIAL (the engine does a named part, such as a final-pay deadline warning
or a tax-clearance hold). No row is UNVERIFIED.

Operational items the audit raised belong here, not in the calculation status: final-pay process
and HR cut-off, IR21/CP21/CP22A filing, remittance and collection, lawful recovery of a
contribution shortfall, Nihon's overtime-incentive consent and reporting, NS make-up claims,
paternity notice, declaration evidence, residency day counts, and customer data reconciliation
(zakat history, SPR start dates, NRIC race). A refusal on incomplete customer history is by design.

| Lineage      | Rows per version | Covers                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SG           | 25               | CPF/SDL/SHG payment by the 14th, FWL by the 17th, IR8A/AIS by 1 March, IR21 one month before cessation, itemised payslips in 3 working days, KETs in 14 days, records, the 50% deduction cap, retrenchment notification, work-injury insurance, government-paid leave claims, retirement and re-employment (64/69 from 1 July 2026), PDPA                                                                  |
| MY, MY-nihon | 44–46            | EPF/SOCSO/EIS/HRD registration and monthly remittance, PCB by the 15th, CP22/CP22A/CP21, EA form and Form E/CP8D, TP1/TP3, wage-payment deadlines, payslips, registers and retention, overtime limits and permission, rest-day roster and public-holiday notice, retrenchment notice and the foreign-first rule, foreign worker approval, notice and levy, lawful deductions, flexible-work replies, SKBBK |
| PH           | 23               | SSS/PhilHealth/Pag-IBIG registration and remittance with penalties, BIR 1902/1905, 1601-C, 2316, 1604-C and year-end refund, 13th month by 24 December and DOLE report, wage frequency, minimum wage, payslips, records, termination notice, final pay and certificate of employment, kasambahay duties, work permits, RA 10173                                                                            |
| ID           | 28               | BPJS registration and remittance by the 10th/15th, SPT Masa PPh 21, BPA1, THR by H-7, PKWT registration, termination notice and report, WLKP, RPTKA/DKPTKA, UU 27/2022 personal data protection                                                                                                                                                                                                            |
| VN           | 37               | SI/HI/UI registration and monthly payment, union fee (timing from 16 May 2026, Decree 105/2026), PIT withholding, declaration and finalisation, tax registration of employees and dependants, labour contracts, wage scales and work rules, overtime consent, limits and reports, final settlement in 14 working days, Law 91/2025 personal data protection (from 2026)                                    |
| TW           | 36–37            | LI/EI/occupational accident/NHI enrolment and withdrawal, premium payment, labour pension contributions and the old-system reserve, NHI supplementary withholding and annual statement, withholding statements, wage records and retention, overtime consent and limits, work rules filing, foreign-professional pension and EI from 2026                                                                  |

Tax returns, annual statements and remittance are Finance procedures; a calculation or workbook
export is not a submission.

## Automation acceptance

`statutory_drift` runs monthly and can be started for one settings group. Research is two model
turns with the host browser. The discovery turn reads each version's issuance listings, feeds,
statute amendment histories and official site searches (a general web search is a lead only) and
lists every instrument issued, amended or announced since the version commenced, as REFLECTED,
REVIEW or NOT_APPLICABLE. The comparison turn opens those instruments and the current-table pages
and compares every sealed contribution, leave, work-rule and declaration row, the obligations
register and the final-pay and clearance rules. The automation rereads every cited page itself and
keeps a finding only when its quoted passage is on the page (compared without whitespace, after
NFKC). It proposes an unsealed draft only for verified changes with one commencement date inside the
version's range. Unknown rule conditions, obligation changes, pending drafts of law, a missing
instrument list and conflicting version timelines require review. Each version's `sources` names
the watch pages (issuance listings, RSS feeds, gazettes), the current-table pages and the
consolidated statutes, with navigation notes for sites that only render in a browser.

A live run on 23 September 2026 (TW, `env serve`, real browser) listed the Ministry of Labour's
pre-announced marriage-leave amendment (8 to 14 days, targeted for 1 October 2026) as pending, not
law, and the Income Tax Act §17 amendment promulgated 11 September 2026 with effect from 1 January
2026, noting that the 2026 salary withholding table has not been reissued.

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

A link does not validate every row in a jurisdiction's catalogue. Seed rows carry their own
authority and `sources`; the pages below are the ones this document relies on beyond the tables.

- MY: [LHDN MTD 2026 specification](https://www.hasil.gov.my/wp-content/uploads/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf),
  [Employment Act 1955](https://jtksm.mohr.gov.my/sites/default/files/2023-11/Akta%20Kerja%201955%20%28Akta%20265%29.pdf),
  [Act A1788](https://www.perkeso.gov.my/images/akta/ACT%204/Act_A1788_-_EMPLOYEES_SOCIAL_SECURITY_AMENDMENT_ACT_2026.pdf)
- PH: [DOLE Handbook 2023](https://nwpc.dole.gov.ph/wp-content/uploads/2023/08/2023-07-25-Handbook-on-Workers-Statutory-Monetary-Benefits-2023_edition.pdf),
  [RR 29-2025](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2029-2025.pdf),
  [RMC 50-2018](https://bir-cdn.bir.gov.ph/local/pdf/RMC%20No%2050-2018.pdf)
- ID: [PP 35/2021](https://peraturan.bpk.go.id/Home/Download/154582/PP%20Nomor%2035%20Tahun%202021.pdf)
- VN: [Decree 145/2020](https://datafiles.chinhphu.vn/cpp/files/vbpq/2020/12/145.signed.pdf)
- TW: [Labor Standards Act](https://laws.mol.gov.tw/Eng/PrintFLAWDAT0201.aspx?id=FL014930),
  [Enforcement Rules](https://laws.mol.gov.tw/Eng/PrintFLAWDAT0202.aspx?flno=1-51&id=FL014931)
- SG: [MOM monthly and daily salary](https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary),
  [CPF rates from 1 January 2027](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf)
