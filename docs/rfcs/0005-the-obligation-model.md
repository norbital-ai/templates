# RFC 0005 — What the law owes: the model as captured, and the gap list

Status: analysis, 2026-09-16. The architecture that closes the list is open; the owner is designing
it. §5 records the one step that landed before the design was reopened.

## 0. Why gaps keep appearing

RFC 0004 inventoried 96 residues and closed 4 of them. Closing the rest one primitive at a time
would leave the next vetting finding more, because the residues are symptoms of five decisions
taken before any RFC:

1. **The catalogue was transcribed from the customers' spreadsheets.** Whatever a workbook keyed
   by hand became a keyed entry; whatever it computed outside payroll got no row. The register was
   the specification, so the law's own triggers (a date, a separation, a birth) had nowhere to live.
2. **The expression context grew one member at a time.** CEL can express any arithmetic; it cannot
   read a fact the context does not carry. Most residues are missing context members (a year
   axis, an election, a company fact, a window), not missing operators.
3. **Six money families are six shapes.** Claim, allowance, payment, leave, loan and contribution
   each grew from a UI family with its own row, hooks and read path. A primitive landed for one
   family is not landed for the others.
4. **Verification compared the engine to the same spreadsheets.** The host audit checks the
   register's own law checks; the goldens covered contribution schemes only; the fixtures did not
   carry a payment catalogue. What the spreadsheet also lacked stayed invisible and green.
5. **The gap list was hand-written.** Every NOT APPLIED list is what a vetting pass noticed. It
   cannot contain what nobody noticed. Termination pay, the largest single payment the law owes,
   appeared in no lineage's list.

## 1. What the model captures today

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

## 2. What the law owes, by category

Status per cell: **M** modelled and seeded · **K** keyed by hand today · **A** absent from the
model · **S** seeded as a SCHEDULE row · — no such obligation.

### 2.1 Wages and time

| Obligation                                             | MY  | SG  | PH  | ID  | VN  | TW  |
| ------------------------------------------------------ | --- | --- | --- | --- | --- | --- |
| Basic wage, proration, minimum-wage floor and coverage | M   | M   | M   | M   | M   | M   |
| Overtime ladders, rest-day and holiday work            | M   | M   | M   | M   | M   | M   |
| Night premium                                          | M   | —   | M   | —   | M   | —   |
| Compounded day types (holiday on a rest day)           | —   | —   | A   | M   | A   | —   |
| Pay for an unworked regular holiday                    | M   | M   | A   | —   | —   | —   |
| Daily-rated rest-day pay, `pay_basis`                  | A   | —   | A   | —   | —   | —   |
| Hours ceilings, breaks, weekly rest                    | M   | M   | M   | M   | M   | M   |

### 2.2 Payments the law owes on its own calendar

| Obligation                                                                                                           | Trigger                             | Status | Family       |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------ | ------------ |
| PH 13th month pay (P.D. 851)                                                                                         | 24 Dec, separation                  | S      | PAYMENT      |
| ID THR (Permenaker 6/2016): one month's wage after 12 months, pro rata from 1 month; wage = basic + fixed allowances | 7 days before the religious holiday | S      | PAYMENT      |
| SG AWS, TW year-end bonus, VN Tết bonus                                                                              | contractual, not statutory          | —      | —            |
| TW NHI supplementary premium on bonuses over 4× the insured salary (健保法 §31)                                      | each bonus payment                  | A      | CONTRIBUTION |

### 2.3 Payments the law owes on separation

Every jurisdiction but Singapore owes money on the day an employment ends. None of it is in any
lineage's residue list; all of it is keyed by hand today.

| Obligation                                                                                                        | Depends on                                              | Status |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| MY Termination and Lay-Off Benefits Regs 1980: 10 / 15 / 20 days' wages per year of service                       | exit reason, service years, EA coverage                 | K      |
| PH separation pay (Labor Code art. 298–299): ½ or 1 month per year of service by cause                            | exit reason, service years                              | K      |
| PH retirement pay (RA 7641): 22.5 days per year at 60–65 after 5 years' service                                   | age, service years, exit reason                         | K      |
| ID pesangon, UPMK, UPH (PP 35/2021 art. 40–59): multipliers by exit reason and service years                      | exit reason, service years, wage incl. fixed allowances | K      |
| VN severance (Labour Code art. 46) and job-loss allowance (art. 47): ½ / 1 month per year net of UI-insured years | exit reason, service years, SI/UI since                 | K      |
| TW severance (勞退條例 §12, LSA §17): ½ month per year, cap 6 months                                              | exit reason, service years, scheme (old/new)            | K      |
| Leave commutation at exit: PH SIL (art. 95), VN (art. 113(3)), TW (LSA §38(4)), MY (s.60E(3))                     | leave balance on the exit date                          | K      |
| Notice pay in lieu (every jurisdiction)                                                                           | exit reason, notice period from terms                   | K      |
| Final pay timing (PH DOLE LA 06-20: 30 days; ID; VN 14 days)                                                      | exit date                                               | A      |

### 2.4 Leave

| Obligation                                                                                                                                     | Status |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Entitlement by service, eligibility, accrual, proration                                                                                        | M      |
| Pay fraction (TW half-pay sick, ID 100/75/50/25 sick scale, VN)                                                                                | A      |
| Paid by a fund and advanced by the employer (VN SI sick/maternity, PH SSS maternity and sickness, SG government-paid leave, TW 勞保 maternity) | A      |
| Per-event windows (VN art. 115, PH paternity per delivery, SG per child)                                                                       | A      |
| Lifetime caps (MY 5 confinements, PH 4 deliveries, SG 42 days per child)                                                                       | A      |
| Rolling windows (TW 2-in-1 hospitalisation, PH RA 9710 12 months)                                                                              | A      |
| One quota consuming another (TW 家庭照顧假 in 事假, ID cuti bersama, SG outpatient in hospitalisation)                                         | A      |
| Birth, miscarriage, adoption, bereavement variants                                                                                             | A      |

### 2.5 Contributions and levies

| Obligation                                                                                                                                                | Status |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Employee/employer schemes on a declared base, ladders, reliefs                                                                                            | M      |
| Annual ceilings across the year (SG AW ceiling)                                                                                                           | A      |
| Registration since (MY SOCSO first entry ≥ 55, EIS 57, VN sick by insurance years)                                                                        | A      |
| Elections (MY zakat, disabled reliefs; TW voluntary 勞退, withholding table; SG SHG opt-out, SPR full rate; ID PTKP for a married woman; VN union member) | A      |
| Company-level facts (VN 0.3% low-risk rate, ID DTP sector, TW 54-hour consent, PH < 10 employees)                                                         | A      |
| Levies on the establishment, not the employment (VN union fee on the fund, TW 積欠工資墊償基金)                                                           | A      |
| Employer premiums as taxable income (ID JKK/JKM/Kesehatan into PPh 21)                                                                                    | A      |

### 2.6 Tax

| Obligation                                                                       | Status | Notes                                                                                                |
| -------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| Monthly withholding ladders and reliefs                                          | M      |                                                                                                      |
| Year-end true-up (PH RR 11-2018 s.16, ID PMK 168/2023 December, VN finalisation) | K      | opsph keys `PRIOR_YEAR_TAX_DUE` / `PRIOR_YEAR_TAX_REFUND`; KDIT keys `PPH21_PRIOR_PERIOD_ADJUSTMENT` |
| Authority-directed instalments (MY CP38)                                         | K      | correctly keyed: an order from the authority is an entry                                             |
| Prior-period statutory corrections (opsph `STATUTORY_ADJUSTMENT`)                | K      | correctly keyed: a correction is evidence                                                            |
| Annual exemptions inside a base (PH ₱90,000, de minimis)                         | M      | `annual_exempt`, expression form pending                                                             |

## 3. The gap list

Every open item, one row each, deduplicated across the lineage READMEs and RFC 0004 §6. "Captured"
is what the model holds today; "Missing" is the field, context member or primitive without which
the catalogue cannot express the rule. "now" means the current grammar carries it and only a seed
row and a golden are owed.

### 3.1 Contributions, levies and tax

| #   | Jur | Obligation (instrument)                                              | Captured                                          | Missing                                                                            |
| --- | --- | -------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | SG  | CPF Additional Wage ceiling, 102,000 − OW (CPF Act)                  | year_to_date per scheme                           | `year.earned.<OW codes>` on the scheme site                                        |
| 2   | SG  | CPF rate band moves the month after the birthday                     | employee.age in years                             | birthday-month test (`employee.age_months`)                                        |
| 3   | SG  | SINDA covers citizens, PRs and EP holders; SHG opt-out               | race, religion                                    | `employee.pass_type`; an opt-out election                                          |
| 4   | SG  | SPR full-rate joint election (Tables 4/5)                            | residency status and since                        | election                                                                           |
| 5   | SG  | SPR residency with no recorded start (records)                       | field exists, value missing                       | records                                                                            |
| 6   | MY  | SOCSO first entry ≥ 55; EIS 57-and-never-contributed                 | registration status                               | `facts.<scheme>.since`                                                             |
| 7   | MY  | HRD Corp Malaysians-only base and headcount; 5–9 election            | headcount, NOT_REGISTERED                         | headcount predicate, `base.entries[].when`; election is now                        |
| 8   | MY  | EPF Parts A/C/E/F round the total, then split                        | rules                                             | now: `up_to_unit(employee + employer)` in the rule                                 |
| 9   | MY  | PCB disabled person RM6,000, disabled spouse RM5,000, zakat          | —                                                 | elections on the PCB fact                                                          |
| 10  | MY  | PCB non-resident 30%                                                 | rate_override on the fact                         | now                                                                                |
| 11  | MY  | SKBBK phases 2–3 (2028, 2031)                                        | —                                                 | future sealed versions                                                             |
| 12  | PH  | PhilHealth premium computed once then split                          | two independent 2.5% legs                         | now: `employer = round_cent(base × 0.05) − employee`                               |
| 13  | PH  | SSS Regular SS / MPF employer split (Circular 2024-006)              | one employer figure                               | now: two schemes in one relief group                                               |
| 14  | PH  | PhilHealth and Pag-IBIG on the contractual, unprorated salary        | base from measured lines                          | `base.salary: CONTRACTUAL`                                                         |
| 15  | PH  | Regional wage orders                                                 | `wages.by_region` empty                           | seed                                                                               |
| 16  | PH  | Minimum-wage earners' premium pay exempt from WTAX (RA 9504)         | —                                                 | base entry `when` over `terms.base_salary <= minimum_wage(region)`                 |
| 17  | PH  | De minimis meal cap, 30% of the minimum wage                         | `annual_exempt` as a number                       | `annual_exempt` as an expression                                                   |
| 18  | VN  | Contribution base is the contractual salary (art. 168)               | measured                                          | `base.salary: CONTRACTUAL`                                                         |
| 19  | VN  | Union fee 2% on the employer's whole salary fund                     | per employment                                    | `assessed_on: COMPANY`                                                             |
| 20  | VN  | Union dues 1% from members                                           | —                                                 | election `union_member`                                                            |
| 21  | VN  | Reduced 0.3% occupational-accident rate for a qualifying employer    | risk_class                                        | `company.facts`                                                                    |
| 22  | VN  | Overtime premium PIT-exempt (pre-July versions)                      | base by line family                               | base entries by band label (`OVERTIME:premium`)                                    |
| 23  | TW  | Sub-minimum insured grades (part-time)                               | employment.type                                   | now                                                                                |
| 24  | TW  | 積欠工資墊償基金 0.025% on the establishment                         | —                                                 | `assessed_on: COMPANY`                                                             |
| 25  | TW  | NHI 補充保費 2.11% on bonuses over 4× the insured salary             | —                                                 | `year.earned.<bonus codes>` on the scheme site; COMPANY employer leg               |
| 26  | TW  | 勞退 voluntary employee contribution up to 6%                        | —                                                 | election `voluntary_rate`                                                          |
| 27  | TW  | 薪資所得扣繳稅額表 election (table vs 5%)                            | —                                                 | election + a second ladder                                                         |
| 28  | TW  | EI nationality and age boundary                                      | rules                                             | now                                                                                |
| 29  | TW  | Insured-grade rounding table                                         | —                                                 | table transcription                                                                |
| 30  | ID  | Non-JKP population, JKP eligibility (< 54, national), JP nationality | nationality; NOT_REGISTERED                       | partly now (`facts.JKP.registered`)                                                |
| 31  | ID  | BPJS Kesehatan floor is the district UMK                             | by_region incl. Kabupaten Bekasi                  | seed the company region by district                                                |
| 32  | ID  | PPh 21 DTP for five labour-intensive sectors (PMK 105/2025)          | —                                                 | `company.facts.sector`                                                             |
| 33  | ID  | Employer JKK/JKM/Kesehatan premiums as taxable income                | —                                                 | base entry naming another scheme's employer share                                  |
| 34  | ID  | PTKP for a married woman (TK/0 unless certified)                     | marital status                                    | election `ptkp`                                                                    |
| 35  | ID  | JP ceiling revision 2027-03                                          | —                                                 | future version                                                                     |
| 36  | PH  | Year-end annualised withholding (RR 11-2018 s.16)                    | year_to_date; last_of_year on the entry site only | `period.last_of_year` on the scheme site; the annual ladder; retires 10 keyed rows |
| 37  | ID  | PPh 21 December reckoning (PMK 168/2023)                             | same                                              | same; retires 13 keyed rows                                                        |
| 38  | VN  | Year-end PIT finalisation                                            | same                                              | same                                                                               |

### 3.2 Work

| #   | Jur | Obligation (instrument)                                                | Captured                                    | Missing                                             |
| --- | --- | ---------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| 39  | PH  | Compounded day types: 260% holiday-on-rest-day, 150% special           | holiday.kind; rest day not exposed          | `day.rest_day` in bands                             |
| 40  | PH  | 100% of the daily wage for an unworked regular holiday (art. 94)       | holidays; no unworked pay                   | a Work row the calendar raises                      |
| 41  | PH  | Art. 82 coverage exclusions beyond MANAGERIAL                          | overtime_when                               | now                                                 |
| 42  | PH  | Art. 85 compensable short breaks                                       | breaks[].when                               | now                                                 |
| 43  | PH  | 313 / 365 day factors by pay basis                                     | working_days_per_week                       | `person.terms.pay_basis` in `ordinary_divisor_days` |
| 44  | PH  | Apprentice / learner 75% of the minimum wage                           | wages.applies_when                          | `wage_floor` as an expression                       |
| 45  | MY  | Normal hours declaration: 8 a day, 10 spread (s.60A)                   | limits                                      | `work_rules.normal_hours` expression                |
| 46  | MY  | Rest-day pay for daily-, hourly-, piece-rated (s.60(3))                | —                                           | `pay_basis` in bands                                |
| 47  | MY  | Domestic employees outside ss.60–60F                                   | —                                           | `employment.type = DOMESTIC`                        |
| 48  | MY  | s.59(1) rest day suspended during maternity and sick leave             | weekly_rest_rule                            | `suspended_when`                                    |
| 49  | SG  | Part 4 second ceiling SGD 2,600                                        | overtime_when                               | now                                                 |
| 50  | SG  | Rest-day work at the employee's request pays half (s.37(2))            | —                                           | `work_day.requested_by` fact                        |
| 51  | SG  | 5-day / 9-hour week (s.38(1))                                          | —                                           | `normal_hours` expression                           |
| 52  | SG  | Public holiday on a non-working day                                    | holiday_rest_precedence                     | a Work row the calendar raises                      |
| 53  | VN  | Night overtime adds 20% of the day-type wage (art. 98(3))              | one night rate                              | night bands by day type                             |
| 54  | VN  | 300-hour yearly ceiling for art. 107(3) sectors                        | limits                                      | now: `limits[].when`                                |
| 55  | VN  | 45-minute night-shift break (art. 109(1))                              | breaks                                      | `breaks[].when` over `night_hours`                  |
| 56  | VN  | Four-rest-days-a-month average                                         | weekly_rest_rule                            | `average_over_days`                                 |
| 57  | VN  | Holiday on the weekly rest day at 300%                                 | SUBSTITUTE precedence                       | `day.rest_day` + holiday.kind                       |
| 58  | TW  | 54-hour monthly overtime variant on consent (§32(2))                   | limits                                      | `company.facts.overtime_consent` in `limits[].when` |
| 59  | TW  | §35 break proviso, §84-1 責任制                                        | —                                           | `company.facts`                                     |
| 60  | ID  | 75% overtime base where fixed allowances exist (PP 35/2021 art. 32(4)) | `terms.fixed_allowances` on the person site | the divisor reading `terms.monthly_wage`            |
| 61  | ID  | Art. 26(2) rest-day and holiday overtime carve-out                     | limits[].when                               | now                                                 |

### 3.3 Leave

| #   | Jur | Obligation (instrument)                                                                            | Captured            | Missing                                                              |
| --- | --- | -------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| 62  | MY  | Annual-leave fraction rule and 10% forfeiture (s.60E(1))                                           | —                   | `year.days_absent_unauthorised`, rounding in the band                |
| 63  | MY  | Maternity allowance conditions: 90 days in the 4 months before (s.37(2))                           | —                   | BIRTH event, `pay_fraction`                                          |
| 64  | MY  | Paternity: five confinements in a lifetime, notice (s.60FA)                                        | —                   | LIFETIME keyed to the child                                          |
| 65  | PH  | SIL exclusions: < 10 employees, field personnel                                                    | headcount           | `company.facts`, headcount predicate                                 |
| 66  | PH  | Maternity: 60-day miscarriage case, SSS 3-in-12 contribution test                                  | —                   | BIRTH event kind, `facts.SSS.since`                                  |
| 67  | PH  | Paternity: first four deliveries of the legitimate spouse                                          | —                   | LIFETIME: child                                                      |
| 68  | PH  | RA 9710: six months' aggregate service in the last twelve                                          | service_months      | ROLLING_MONTHS: 12                                                   |
| 69  | PH  | Solo-parent leave: forfeitable, ID card                                                            | solo_parent flag    | ID evidence, forfeiture rule                                         |
| 70  | SG  | Hospitalisation leave includes the outpatient days                                                 | two quotas          | `consumes`                                                           |
| 71  | SG  | Child citizenship, EA maternity conditions, marriage window, lifetime caps, SPL pool, adoption age | children birthdates | child facts (citizenship), BIRTH/ADOPTION events, LIFETIME per child |
| 72  | SG  | Retirement / re-employment ages; NDR 2026 childcare expansion                                      | —                   | future versions                                                      |
| 73  | VN  | Seniority ladder past 30 years (art. 114)                                                          | bands to 30         | entitlement `days` as an expression                                  |
| 74  | VN  | Arduous cohorts, disabled worker                                                                   | classification enum | classification values, `employee.disabled`                           |
| 75  | VN  | Maternity and paternity variants (multiple births, surgery)                                        | —                   | BIRTH facts                                                          |
| 76  | VN  | Art. 115 personal leave per event                                                                  | CALENDAR_YEAR       | PER_EVENT keyed to an event                                          |
| 77  | VN  | Sick, maternity, paternity paid by social insurance                                                | paid: false         | `paid_by: FUND`, employer reimbursement line                         |
| 78  | VN  | Sick-leave bands by insurance years, not service                                                   | service_months      | `facts.SI.since_months`                                              |
| 79  | VN  | Elective National Day adjacent day                                                                 | —                   | company holiday row (records)                                        |
| 80  | TW  | Half-pay leave                                                                                     | paid boolean        | `pay_fraction`                                                       |
| 81  | TW  | Hospitalised sickness leave: one year within two                                                   | —                   | ROLLING_MONTHS: 24                                                   |
| 82  | TW  | Bereavement and miscarriage tiers by relationship                                                  | —                   | event attributes                                                     |
| 83  | TW  | 家庭照顧假 counted inside 事假                                                                     | —                   | `consumes`                                                           |
| 84  | TW  | Hourly leave (from 2026-01-01)                                                                     | half-day units      | `leave_event` in hours                                               |
| 85  | TW  | Encashment re-grading of the insured salary                                                        | —                   | `base.entries[].when`                                                |
| 86  | ID  | Sick-pay scale 100 / 75 / 50 / 25 by month (art. 93(3))                                            | paid boolean        | `pay_fraction` over months                                           |
| 87  | ID  | KIA maternity and paternity extensions (UU 4/2024)                                                 | —                   | BIRTH facts                                                          |
| 88  | ID  | Cuti bersama set against annual leave                                                              | —                   | `consumes`                                                           |

### 3.4 Separation

| #   | Jur        | Obligation (instrument)                                                            | Captured                   | Missing                                                  |
| --- | ---------- | ---------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| 89  | MY         | Termination and lay-off benefits: 10 / 15 / 20 days' wages per year (Regs 1980)    | exit_reason, service_years | the row, bands over reason and service; EA coverage test |
| 90  | PH         | Separation pay ½ or 1 month per year by cause (art. 298–299)                       | exit_reason, service_years | the row and bands                                        |
| 91  | PH         | Retirement pay 22.5 days per year, 60–65, 5 years' service (RA 7641)               | age, service_years         | the row; RETIREMENT reason                               |
| 92  | ID         | Pesangon, UPMK, UPH multipliers by reason and service (PP 35/2021)                 | exit_reason, monthly_wage  | the row and bands                                        |
| 93  | VN         | Severance and job-loss allowance net of UI-insured years (art. 46–47)              | exit_reason, service_years | `facts.UI.since`; the row                                |
| 94  | TW         | Severance ½ month per year, cap 6 (勞退條例 §12)                                   | exit_reason, service_years | old/new scheme election; the row                         |
| 95  | all        | Leave commutation at exit (PH art. 95, VN art. 113(3), TW LSA §38(4), MY s.60E(3)) | ENCASHMENT keyed by hand   | `leave.balance(code)` on the entry site; the trigger     |
| 96  | all        | Notice pay in lieu                                                                 | —                          | notice period on the terms; the row                      |
| 97  | PH, ID, VN | Final pay timing (30 days; 14 days)                                                | exit_date                  | a due-date rule                                          |

## 4. Register rows still keyed by hand, and their verdict

| Register row                                            | Count | Verdict                                                                         |
| ------------------------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| KDIT `PPH21_PRIOR_PERIOD_ADJUSTMENT`                    | 13    | gap 37; evidence until it lands                                                 |
| KDIT `PPH21_PRIOR_PERIOD_REFUND`, `COMPENSATION`        | 6     | evidence (a refund and a settlement are entries)                                |
| opsph `PRIOR_YEAR_TAX_DUE` / `PRIOR_YEAR_TAX_REFUND`    | 10    | gap 36; evidence until it lands                                                 |
| opsph `STATUTORY_ADJUSTMENT`, `BACKPAY_*`               | 9     | evidence (corrections and back pay are entries)                                 |
| opsph `meal`, `transport`, `communication`, `leader`, … | 383   | standing allowances keyed per period; one RECURRING row per employment would do |
| nihon `CP38`                                            | 2     | evidence (an authority's order)                                                 |
| nihon `MEDICAL_CLAIM*`                                  | 88    | claims; correct                                                                 |

## 5. Landed 2026-09-16, before the design was reopened

- `payment_catalogue.source` ENTRY \| SCHEDULE with `catalogue_schedule` (every YEAR \| MONTH \|
  SEPARATION); occurrences materialised in GATHER as `payment_requests` rows keyed
  `<row>:<employment>:<occurrence>`; the entry site's `year.*` and `period.last_of_year`;
  `base.entries[].annual_exempt` (RFC 0004 S1).
- `employments.exit_reason`; `employment.exit_date`, `exit_reason`, `service_years` and
  `terms.fixed_allowances`, `monthly_wage` on the person site.
- PH `THIRTEENTH_MONTH_PAY` and ID `THR` as SCHEDULE rows; the KDIT and opsph hand-keyed rows for
  them retired (the seed bank READMEs record the reconciliation).
- An open-ended standing allowance is sliced per period, never pinned as a one-off.
