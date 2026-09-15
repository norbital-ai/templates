# Statutory gap tracker

What the payroll engine captures, what the law owes that it does not, and the register rows still
keyed by hand. One row per gap; tick a row only with a golden that states the law.

Legend: `open` needs a field, context member or primitive · `seed` the grammar carries it and a seed
row plus a golden are owed (or the law has not issued the figure yet) · `landed` closed, with the
commit.

Sources of truth: the collections under `src/collections/*/+model.ts`, the datatypes under
`src/datatypes/*/+definition.ts`, the expression sites in `src/lib/expressions/contexts.ts`, the
seeded law in `../../seed_bank/norbital_hr/jurisdiction/<lineage>/`, and each lineage's README,
whose NOT APPLIED items cite the row numbers below.

## 1. What the model captures

### 1.1 Collections

| Collection                                                 | Columns                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jurisdiction_settings`                                    | code, jurisdiction_code, name, sealed_at, voided_at, cloned_from_id, `payroll` (currency, timezone, tax_year_start_month), `wages` (by_region, applies_when), `sources`, `work_rules`, effective_range                                                        |
| `statutory_contributions`                                  | settings_id, code, name, authority, assessment_period, employee_share_annual_cap, shared_cap_group, project_relief_annually, `rules` [{when, employee, employer}], `base` {salary, absence, overtime, night_premium, entries [{family, code, annual_exempt}]} |
| `claim_catalogue`                                          | settings_id, code, name, destination, direction, bands [{when, amount, limit}], eligibility, evidence                                                                                                                                                         |
| `allowance_catalogue`                                      | as claim + recurring, prorates, on_day                                                                                                                                                                                                                        |
| `payment_catalogue`                                        | as claim + source (ENTRY \| SCHEDULE), `schedule` {every YEAR \| MONTH \| SEPARATION, month, day, when, from_service_months, on_separation}                                                                                                                   |
| `leave_catalogue`                                          | settings_id, code, name, authority, eligibility, destination, direction, evidence, paid (boolean), evidence_after_days, `entitlement` {availability, year_start_month, proration, bands [{eligibility, days}]}                                                |
| `loan_catalogue`                                           | settings_id, code, name, destination, direction, bands, loan_type, minimum_repayment, eligibility, evidence                                                                                                                                                   |
| `companies`                                                | settings_code, name, registration_number, pay_cutoff_day, pay_frequency, risk_class, region, holiday_source, workbook_layout, disbursement_account, effective_range                                                                                           |
| `employees`                                                | name, date_of_birth, gender, marital_status, solo_parent, race, religion, spouse_status, children [{child_birthdate}], nationality, identity_number, dependents_count, contact, face enrolment                                                                |
| `employments`                                              | employee_id, company_id, employee_number, contract_number, bank, effective_range, exit_reason, comments                                                                                                                                                       |
| `employment_terms`                                         | employment_id, residency_status, residency_since, base_salary, pay_frequency, work_classification, statutory_work_category, employment_type, department, job_title, payroll_group, grade, shift_pattern_id, effective_range                                   |
| `employment_statutory_facts`                               | employee_id, statutory_contribution_id, status {REGISTERED {reference_number, rate_override} \| NOT_REGISTERED {reason}}, effective_range                                                                                                                     |
| `jurisdiction_holidays`                                    | company_id, date, name, kind (PUBLIC \| SPECIAL \| SUBSTITUTE), replaces, given_to, source, published_at                                                                                                                                                      |
| `shift_definitions`, `shift_patterns`, `work_days`         | roster vocabulary, cycles, and the day's assignment, worked intervals, breaks, holiday link                                                                                                                                                                   |
| `leave_entries`                                            | catalogue_id, leave_code, event (TIME_OFF \| ENCASHMENT \| CARRY_FORWARD \| ADJUSTMENT \| REVERSAL), charges, allocations, certificate_file, payslip_id                                                                                                       |
| `claim_requests`, `allowance_requests`, `payment_requests` | employment_id, catalogue_id, amount, the date or recurrence, evidence_file, as_adjustment_entry, payslip_id; payment rows carry reason and schedule_key                                                                                                       |
| `loans`, `loan_repayments`                                 | agreement with principal and range; dated instalments                                                                                                                                                                                                         |
| `payroll_runs`, `payslips`                                 | the frozen run and its slips: base, proration, statutory charges, adjustments, gross, deductions, net, employer cost, status, paid_at                                                                                                                         |

### 1.2 Expression context, by site

- **person** (eligibility, `when`, wages.applies_when): employee.gender, age, citizenship,
  marital_status, spouse_status, dependents_count, solo_parent, race, religion, residency_months;
  employment.type, classification, service_months, service_years, service_start, exit_date,
  exit_reason; terms.basic_salary, fixed_allowances, monthly_wage, statutory_wages, workman,
  statutory_work_category, department, payroll_group, grade, ordinary_hours_per_week,
  working_days_per_week; children.count, children.under(n); company.region; period.working_days.
- **entry** (catalogue bands): person.\*, entry.amount/days/hours/quantity/event_date/period/
  recurring/occurrence_index/window/captures, rates.ordinary_day/ordinary_hour, limits.<key>,
  period.key/start/end/index/instalments/last_of_year, year.start/end/months_employed/
  days_employed/earned.<code>, leave.days(code).
- **work_day** (work bands, breaks, limits): date, day_type, worked_hours, normal_hours,
  hours_beyond_normal, total_work_hours, overtime_hours, month_overtime_hours, consecutive_hours,
  continuous_attendance, roster_code, break_minutes, ordinary_hour/day, day_wage, hours,
  limits.<key>, holiday.kind/name.
- **scheme** (contribution rules): person.\*, base, code, assessment_period, period.key/index/
  instalments, year_to_date.base/employee/employer, projection.\*, region, minimum_wage(region),
  wage_floor, headcount, age, risk_class, rate_override, produced.<code>.employee/employer.

### 1.3 Facts the model does not hold

Exit reason is held since 2026-09-16. Not held: elections (zakat, disabled reliefs, SHG opt-out,
SPR full rate, voluntary 勞退, withholding table, PTKP status, union membership), registration
since dates, pass type, disability, employee events (birth with citizenship, miscarriage,
adoption, marriage, bereavement), company facts (sector, overtime consent, the population a levy
tests), fixed allowances as a contract fact (derived from standing allowance rows instead).

## 2. Open gaps

### 3.1 Contributions, levies and tax

| # | Jur | Obligation (instrument) | Captured | Missing Status |
| --- | --- | -------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- --- |
| 1 | SG | CPF Additional Wage ceiling, 102,000 − OW (CPF Act) | year_to_date per scheme | `year.earned.<OW codes>` on the scheme site open |
| 2 | SG | CPF rate band moves the month after the birthday | employee.age in years | birthday-month test (`employee.age_months`) open |
| 3 | SG | SINDA covers citizens, PRs and EP holders; SHG opt-out | race, religion | `employee.pass_type`; an opt-out election open |
| 4 | SG | SPR full-rate joint election (Tables 4/5) | residency status and since | election open |
| 5 | SG | SPR residency with no recorded start (records) | field exists, value missing | records seed |
| 6 | MY | SOCSO first entry ≥ 55; EIS 57-and-never-contributed | registration status | `facts.<scheme>.since` open |
| 7 | MY | HRD Corp Malaysians-only base and headcount; 5–9 election | headcount, NOT_REGISTERED | headcount predicate, `base.entries[].when`; election is now open |
| 8 | MY | EPF Parts A/C/E/F round the total, then split | rules | now: `up_to_unit(employee + employer)` in the rule seed |
| 9 | MY | PCB disabled person RM6,000, disabled spouse RM5,000, zakat | — | elections on the PCB fact open |
| 10 | MY | PCB non-resident 30% | rate_override on the fact | now seed |
| 11 | MY | SKBBK phases 2–3 (2028, 2031) | — | future sealed versions seed |
| 12 | PH | PhilHealth premium computed once then split | two independent 2.5% legs | now: `employer = round_cent(base × 0.05) − employee` seed |
| 13 | PH | SSS Regular SS / MPF employer split (Circular 2024-006) | one employer figure | now: two schemes in one relief group seed |
| 14 | PH | PhilHealth and Pag-IBIG on the contractual, unprorated salary | base from measured lines | `base.salary: CONTRACTUAL` open |
| 15 | PH | Regional wage orders | `wages.by_region` empty | seed seed |
| 16 | PH | Minimum-wage earners' premium pay exempt from WTAX (RA 9504) | — | base entry `when` over `terms.base_salary <= minimum_wage(region)` open |
| 17 | PH | De minimis meal cap, 30% of the minimum wage | `annual_exempt` as a number | `annual_exempt` as an expression open |
| 18 | VN | Contribution base is the contractual salary (art. 168) | measured | `base.salary: CONTRACTUAL` open |
| 19 | VN | Union fee 2% on the employer's whole salary fund | per employment | `assessed_on: COMPANY` open |
| 20 | VN | Union dues 1% from members | — | election `union_member` open |
| 21 | VN | Reduced 0.3% occupational-accident rate for a qualifying employer | risk_class | `company.facts` open |
| 22 | VN | Overtime premium PIT-exempt (pre-July versions) | base by line family | base entries by band label (`OVERTIME:premium`) open |
| 23 | TW | Sub-minimum insured grades (part-time) | employment.type | now seed |
| 24 | TW | 積欠工資墊償基金 0.025% on the establishment | — | `assessed_on: COMPANY` open |
| 25 | TW | NHI 補充保費 2.11% on bonuses over 4× the insured salary | — | `year.earned.<bonus codes>` on the scheme site; COMPANY employer leg open |
| 26 | TW | 勞退 voluntary employee contribution up to 6% | — | election `voluntary_rate` open |
| 27 | TW | 薪資所得扣繳稅額表 election (table vs 5%) | — | election + a second ladder open |
| 28 | TW | EI nationality and age boundary | rules | now seed |
| 29 | TW | Insured-grade rounding table | — | table transcription seed |
| 30 | ID | Non-JKP population, JKP eligibility (< 54, national), JP nationality | nationality; NOT_REGISTERED | partly now (`facts.JKP.registered`) open |
| 31 | ID | BPJS Kesehatan floor is the district UMK | by_region incl. Kabupaten Bekasi | seed the company region by district seed |
| 32 | ID | PPh 21 DTP for five labour-intensive sectors (PMK 105/2025) | — | `company.facts.sector` open |
| 33 | ID | Employer JKK/JKM/Kesehatan premiums as taxable income | — | base entry naming another scheme's employer share open |
| 34 | ID | PTKP for a married woman (TK/0 unless certified) | marital status | election `ptkp` open |
| 35 | ID | JP ceiling revision 2027-03 | — | future version seed |
| 36 | PH | Year-end annualised withholding (RR 11-2018 s.16) | year_to_date; last_of_year on the entry site only | `period.last_of_year` on the scheme site; the annual ladder; retires 10 keyed rows open |
| 37 | ID | PPh 21 December reckoning (PMK 168/2023) | same | same; retires 13 keyed rows open |
| 38 | VN | Year-end PIT finalisation | same | same open |

### 3.2 Work

| # | Jur | Obligation (instrument) | Captured | Missing Status |
| --- | --- | ---------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------- --- |
| 39 | PH | Compounded day types: 260% holiday-on-rest-day, 150% special | holiday.kind; rest day not exposed | `day.rest_day` in bands open |
| 40 | PH | 100% of the daily wage for an unworked regular holiday (art. 94) | holidays; no unworked pay | a Work row the calendar raises open |
| 41 | PH | Art. 82 coverage exclusions beyond MANAGERIAL | overtime_when | now seed |
| 42 | PH | Art. 85 compensable short breaks | breaks[].when | now seed |
| 43 | PH | 313 / 365 day factors by pay basis | working_days_per_week | `person.terms.pay_basis` in `ordinary_divisor_days` open |
| 44 | PH | Apprentice / learner 75% of the minimum wage | wages.applies_when | `wage_floor` as an expression open |
| 45 | MY | Normal hours declaration: 8 a day, 10 spread (s.60A) | limits | `work_rules.normal_hours` expression open |
| 46 | MY | Rest-day pay for daily-, hourly-, piece-rated (s.60(3)) | — | `pay_basis` in bands open |
| 47 | MY | Domestic employees outside ss.60–60F | — | `employment.type = DOMESTIC` open |
| 48 | MY | s.59(1) rest day suspended during maternity and sick leave | weekly_rest_rule | `suspended_when` open |
| 49 | SG | Part 4 second ceiling SGD 2,600 | overtime_when | now seed |
| 50 | SG | Rest-day work at the employee's request pays half (s.37(2)) | — | `work_day.requested_by` fact open |
| 51 | SG | 5-day / 9-hour week (s.38(1)) | — | `normal_hours` expression open |
| 52 | SG | Public holiday on a non-working day | holiday_rest_precedence | a Work row the calendar raises open |
| 53 | VN | Night overtime adds 20% of the day-type wage (art. 98(3)) | one night rate | night bands by day type open |
| 54 | VN | 300-hour yearly ceiling for art. 107(3) sectors | limits | now: `limits[].when` seed |
| 55 | VN | 45-minute night-shift break (art. 109(1)) | breaks | `breaks[].when` over `night_hours` open |
| 56 | VN | Four-rest-days-a-month average | weekly_rest_rule | `average_over_days` open |
| 57 | VN | Holiday on the weekly rest day at 300% | SUBSTITUTE precedence | `day.rest_day` + holiday.kind open |
| 58 | TW | 54-hour monthly overtime variant on consent (§32(2)) | limits | `company.facts.overtime_consent` in `limits[].when` open |
| 59 | TW | §35 break proviso, §84-1 責任制 | — | `company.facts` open |
| 60 | ID | 75% overtime base where fixed allowances exist (PP 35/2021 art. 32(4)) | `terms.fixed_allowances` on the person site | the divisor reading `terms.monthly_wage` open |
| 61 | ID | Art. 26(2) rest-day and holiday overtime carve-out | limits[].when | now seed |

### 3.3 Leave

| # | Jur | Obligation (instrument) | Captured | Missing Status |
| --- | --- | -------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- --- |
| 62 | MY | Annual-leave fraction rule and 10% forfeiture (s.60E(1)) | — | `year.days_absent_unauthorised`, rounding in the band open |
| 63 | MY | Maternity allowance conditions: 90 days in the 4 months before (s.37(2)) | — | BIRTH event, `pay_fraction` open |
| 64 | MY | Paternity: five confinements in a lifetime, notice (s.60FA) | — | LIFETIME keyed to the child open |
| 65 | PH | SIL exclusions: < 10 employees, field personnel | headcount | `company.facts`, headcount predicate open |
| 66 | PH | Maternity: 60-day miscarriage case, SSS 3-in-12 contribution test | — | BIRTH event kind, `facts.SSS.since` open |
| 67 | PH | Paternity: first four deliveries of the legitimate spouse | — | LIFETIME: child open |
| 68 | PH | RA 9710: six months' aggregate service in the last twelve | service_months | ROLLING_MONTHS: 12 open |
| 69 | PH | Solo-parent leave: forfeitable, ID card | solo_parent flag | ID evidence, forfeiture rule open |
| 70 | SG | Hospitalisation leave includes the outpatient days | two quotas | `consumes` open |
| 71 | SG | Child citizenship, EA maternity conditions, marriage window, lifetime caps, SPL pool, adoption age | children birthdates | child facts (citizenship), BIRTH/ADOPTION events, LIFETIME per child open |
| 72 | SG | Retirement / re-employment ages; NDR 2026 childcare expansion | — | future versions seed |
| 73 | VN | Seniority ladder past 30 years (art. 114) | bands to 30 | entitlement `days` as an expression open |
| 74 | VN | Arduous cohorts, disabled worker | classification enum | classification values, `employee.disabled` open |
| 75 | VN | Maternity and paternity variants (multiple births, surgery) | — | BIRTH facts open |
| 76 | VN | Art. 115 personal leave per event | CALENDAR_YEAR | PER_EVENT keyed to an event open |
| 77 | VN | Sick, maternity, paternity paid by social insurance | paid: false | `paid_by: FUND`, employer reimbursement line open |
| 78 | VN | Sick-leave bands by insurance years, not service | service_months | `facts.SI.since_months` open |
| 79 | VN | Elective National Day adjacent day | — | company holiday row (records) seed |
| 80 | TW | Half-pay leave | paid boolean | `pay_fraction` open |
| 81 | TW | Hospitalised sickness leave: one year within two | — | ROLLING_MONTHS: 24 open |
| 82 | TW | Bereavement and miscarriage tiers by relationship | — | event attributes open |
| 83 | TW | 家庭照顧假 counted inside 事假 | — | `consumes` open |
| 84 | TW | Hourly leave (from 2026-01-01) | half-day units | `leave_event` in hours open |
| 85 | TW | Encashment re-grading of the insured salary | — | `base.entries[].when` open |
| 86 | ID | Sick-pay scale 100 / 75 / 50 / 25 by month (art. 93(3)) | paid boolean | `pay_fraction` over months open |
| 87 | ID | KIA maternity and paternity extensions (UU 4/2024) | — | BIRTH facts open |
| 88 | ID | Cuti bersama set against annual leave | — | `consumes` open |

### 3.4 Separation

| # | Jur | Obligation (instrument) | Captured | Missing Status |
| --- | ---------- | ---------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------- --- |
| 89 | MY | Termination and lay-off benefits: 10 / 15 / 20 days' wages per year (Regs 1980) | exit_reason, service_years | the row, bands over reason and service; EA coverage test open |
| 90 | PH | Separation pay ½ or 1 month per year by cause (art. 298–299) | exit_reason, service_years | the row and bands open |
| 91 | PH | Retirement pay 22.5 days per year, 60–65, 5 years' service (RA 7641) | age, service_years | the row; RETIREMENT reason open |
| 92 | ID | Pesangon, UPMK, UPH multipliers by reason and service (PP 35/2021) | exit_reason, monthly_wage | the row and bands open |
| 93 | VN | Severance and job-loss allowance net of UI-insured years (art. 46–47) | exit_reason, service_years | `facts.UI.since`; the row open |
| 94 | TW | Severance ½ month per year, cap 6 (勞退條例 §12) | exit_reason, service_years | old/new scheme election; the row open |
| 95 | all | Leave commutation at exit (PH art. 95, VN art. 113(3), TW LSA §38(4), MY s.60E(3)) | ENCASHMENT keyed by hand | `leave.balance(code)` on the entry site; the trigger open |
| 96 | all | Notice pay in lieu | — | notice period on the terms; the row open |
| 97 | PH, ID, VN | Final pay timing (30 days; 14 days) | exit_date | a due-date rule open |

## 3. Register rows still keyed by hand

| Register row                                            | Count | Verdict                                                                         |
| ------------------------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| KDIT `PPH21_PRIOR_PERIOD_ADJUSTMENT`                    | 13    | gap 37; evidence until it lands                                                 |
| KDIT `PPH21_PRIOR_PERIOD_REFUND`, `COMPENSATION`        | 6     | evidence (a refund and a settlement are entries)                                |
| opsph `PRIOR_YEAR_TAX_DUE` / `PRIOR_YEAR_TAX_REFUND`    | 10    | gap 36; evidence until it lands                                                 |
| opsph `STATUTORY_ADJUSTMENT`, `BACKPAY_*`               | 9     | evidence (corrections and back pay are entries)                                 |
| opsph `meal`, `transport`, `communication`, `leader`, … | 383   | standing allowances keyed per period; one RECURRING row per employment would do |
| nihon `CP38`                                            | 2     | evidence (an authority's order)                                                 |
| nihon `MEDICAL_CLAIM*`                                  | 88    | claims; correct                                                                 |

## 4. Landed

| Date       | Rows | What                                                                                                                                                                                                                                         | Commit              |
| ---------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 2026-09-15 | —    | Schemes declare their base (`statutory_contributions.base`); work rules as unit-named expressions; `wages.applies_when` and `wage_floor`                                                                                                     | templates 7c2767ea… |
| 2026-09-16 | —    | `payment_catalogue.source` and `catalogue_schedule`; entry-site `year.*`; `base.entries[].annual_exempt`; PH `THIRTEENTH_MONTH_PAY` as a SCHEDULE row                                                                                        | templates b4b865f7  |
| 2026-09-16 | —    | `catalogue_schedule.every: SEPARATION`; `employments.exit_reason`; person-site `exit_date`, `exit_reason`, `service_years`, `fixed_allowances`, `monthly_wage`; ID `THR` as a SCHEDULE row; open-ended standing allowances sliced per period | templates 919811f6  |
