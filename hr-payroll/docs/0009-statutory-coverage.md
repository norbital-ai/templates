# Statutory coverage in the seed

<!-- coverage:head -->

The tables in this document are derived from `seed/public/jurisdiction/**` by a script, not typed by hand: 49 sealed law versions of 9 jurisdictions were read. Each country is shown as its latest version; "Value changed" gives the dates inside the seeded window from which a row's values differ.

<!-- coverage:head:end -->

What law the public seed carries for each of its nine jurisdictions: the versions, the contributions and taxes, the leave types, the overtime rules, the other catalogue rows, and the rules and tasks the law registers. How these rows are used is in [the architecture](0001-hrms-calculation-architecture.md) and [the mechanisms, run through](0008-mechanisms-walkthrough.md).

<!-- coverage:begin -->

## China (CN)

### Law versions

| Version | From       | To         | State  |
| ------- | ---------- | ---------- | ------ |
| 1       | 2025-12-01 | 2025-12-31 | sealed |
| 2       | 2026-01-01 | 2026-06-30 | sealed |
| 3       | 2026-07-01 | 2026-08-14 | sealed |
| 4       | 2026-08-15 | 2026-08-31 | sealed |
| 5       | 2026-09-01 | open       | sealed |

Rows whose values differ from the version before:

- Version 2, from 2026-01-01: rules `BUSINESS_CASE_DOCUMENT_REQUIRED`, `BUSINESS_CASE_SIGNED_CONSENT`, `BUSINESS_CASE_SUBJECT_AND_REFERENCE`, `CONTRACT_CATEGORIES`, `FIXED_TERM_REQUEST_DATES` and 20 more; settings `lookup`.
- Version 3, from 2026-07-01: statutory `MAJOR_MEDICAL`, `MEDICAL`, `PENSION`, `UNEMPLOYMENT`; leave `SICK_LEAVE`; rules `RETIREMENT_AGE_REACHED`; effects `OVER_AGE_AGREEMENT`; settings `lookup`.
- Version 4, from 2026-08-15: leave `SICK_LEAVE`.
- Version 5, from 2026-09-01: statutory `MAJOR_MEDICAL`, `MEDICAL`; settings `lookup`.

### Conversions and subtotal chain

Currency CNY. Tax year starts in month 1. Day rate `FIXED ÷ 21.75`, hour rate `FIXED ÷ 174`, proration `DAY_RATE`, rounding `HALF_UP` to 2 places. Year-to-date totals restart per `EMPLOYER`.

Chain: `BASIC` → `PRORATED` → `PAID_BASIC` → `ORDINARY_WAGES` → `ANNUAL_BONUS_WAGES` → `ADDITIONAL_WAGES` → `FOREIGN_ALLOWANCES` → `GROSS` → `SEVERANCE` → `FINAL_PAY` → `NET`.

### Contributions and taxes

| Code                | Kind         | What it is                                                                                             | Employee | Employer | Below zero | First reference on the row                                                                                  | Value changed          |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------ | -------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| `PENSION`           | contribution | Pension: employee 8%, employer 16% of the declared base (si_contribution_base), or of this month's…    | yes      | yes      | stops      | 社会保险法 第十二条、第六十条; 国办发〔2019〕13号 (单位16%, 个人8%); 上海2026年度基数7546… (+1 more)        | 2026-07-01             |
| `MEDICAL`           | contribution | Medical insurance, maternity included: Shanghai employer 9%, Kunming employer 7.9%, employee 2%, on…   | yes      | yes      | stops      | 社会保险法 第二十三条; 沪医保规〔2026〕2号 (2026-03-01至2027-02-28, 单位9%含生育,… (+2 more)                | 2026-07-01, 2026-09-01 |
| `MAJOR_MEDICAL`     | contribution | Supplementary insurance for large medical expenses: a fixed monthly amount for each person, set by…    | yes      | yes      | stops      | 昆明市医疗保障局2026-09标准: 大额医疗费用补助单位44.03元/人/月, 个人1元/人/月 (基数4403–2…                  | 2026-07-01, 2026-09-01 |
| `UNEMPLOYMENT`      | contribution | Unemployment insurance: Shanghai 0.5% employer and 0.5% employee, Kunming 0.7% employer and 0.3% em…   | yes      | yes      | stops      | 社会保险法 第四十四条; 失业保险条例; 沪人社规〔2024〕25号 (0.5%/0.5%, 至2025-12-31)… (+1 more)              | 2026-07-01             |
| `WORK_INJURY`       | contribution | Work-injury insurance contribution for the pay period.                                                 | no       | yes      | stops      | 社会保险法 第三十三条; 工伤保险条例 第八条; 人社部发〔2015〕71号 行业基准费率0.2%–1.9%; 上海实… (+1 more)   | —                      |
| `HPF`               | contribution | Housing provident fund: the employee and the employer each pay the company's chosen percentage of t…   | yes      | yes      | stops      | 住房公积金管理条例 第十六条至第十八条; 沪公积金管委会〔2026〕3号 (2026-07-01起 2740–3773… (+1 more)         | —                      |
| `HPF_SUPPLEMENTARY` | contribution | Supplementary housing provident fund contribution.                                                     | yes      | yes      | stops      | 沪公积金管委会〔2026〕3号: 补充住房公积金比例1%–5%, 基数2740–37731. 未申报缴存基数时以本月实… (+1 more)     | —                      |
| `UNION_FUND`        | contribution | Trade union fund, paid by the employer only: 2% of the employee's total wages, bonuses included (工会… | no       | yes      | stops      | 工会法 第四十三条: 工会经费为全部职工工资总额的2%; 上海市工会条例 第四十一条 (建会筹备组织); 云南省实施《…  | —                      |
| `IIT`               | tax          | Employee income tax withheld from the month’s taxable wages.                                           | yes      | no       | stops      | 个人所得税法 第六条、第十一条; 国家税务总局公告2018年第61号 第六条: 累计预扣法按本扣缴义务人本年累计收入、… | —                      |
| `IIT_ANNUAL_BONUS`  | tax          | Tax on the annual bonus, withheld separately from monthly wages.                                       | yes      | no       | stops      | 财政部 税务总局关于个人所得税法修改后有关优惠政策衔接问题的通知 (财税〔2018〕164号) 第一条第(一)项: 以…     | —                      |
| `IIT_SEVERANCE`     | tax          | Tax on severance paid, withheld separately.                                                            | yes      | no       | stops      | 财税〔2018〕164号 第五条第(一)项: 个人与用人单位解除劳动关系取得一次性补偿收入 (包括经济补偿金、生活补助…   | —                      |

### Leave

| Code                          | Entitlement                                                                                                   | A day taken                  | Value changed          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------- |
| `ANNUAL_LEAVE`                | 5–15 days by length of service; own statutory test; calendar year                                             | full pay, cashable           | —                      |
| `BEREAVEMENT_LEAVE`           | 1 days; opened by `BEREAVEMENT`; per event                                                                    | full pay                     | —                      |
| `CHILDCARE_LEAVE`             | days by region; own statutory test; calendar year                                                             | full pay                     | —                      |
| `ELDER_CARE_LEAVE`            | days by region; own statutory test; calendar year                                                             | full pay                     | —                      |
| `FAMILY_PLANNING_LEAVE`       | days by region; own statutory test; opened by `ABORTION_13W_PLUS`, `ABORTION_UNDER_13W` and 8 more; per event | paid share by the row’s rule | —                      |
| `HOME_LEAVE_PARENTS`          | 20 days; block of 12 months of service                                                                        | full pay                     | —                      |
| `HOME_LEAVE_PARENTS_BIENNIAL` | 45 days; block of 24 months of service                                                                        | full pay                     | —                      |
| `HOME_LEAVE_PARENTS_MARRIED`  | 20 days; block of 48 months of service                                                                        | full pay                     | —                      |
| `HOME_LEAVE_SPOUSE`           | 30 days; block of 12 months of service                                                                        | full pay                     | —                      |
| `MARRIAGE_EXTENSION`          | days by region; own statutory test; opened by `MARRIAGE`; per event                                           | full pay                     | —                      |
| `MARRIAGE_LEAVE`              | 1 days; opened by `MARRIAGE`; per event                                                                       | full pay                     | —                      |
| `MATERNITY_EXTENSION`         | days by region; own statutory test; opened by `CHILD_BIRTH`; per event                                        | paid share 0                 | —                      |
| `MATERNITY_LEAVE`             | 98 days; own statutory test; opened by `ADDITIONAL_BABY`, `CHILD_BIRTH` and 3 more; per event                 | paid share 0                 | —                      |
| `MENSTRUAL_LEAVE`             | days by region; calendar year                                                                                 | full pay                     | —                      |
| `NPL`                         | no limit                                                                                                      | paid share 0                 | —                      |
| `NURSING_BREAK`               | no limit                                                                                                      | full pay                     | —                      |
| `NURSING_LEAVE`               | days by region; own statutory test; opened by `CHILD_BIRTH`; per event                                        | paid share by the row’s rule | —                      |
| `PATERNITY_LEAVE`             | days by region; own statutory test; opened by `CHILD_BIRTH`; per event                                        | full pay                     | —                      |
| `PERSONAL_LEAVE_PAID`         | no limit                                                                                                      | full pay                     | —                      |
| `PRENATAL_CHECKUP`            | no limit                                                                                                      | full pay                     | —                      |
| `PRENATAL_LEAVE`              | days by region; own statutory test; opened by `PREGNANCY`; per event                                          | paid share by the row’s rule | —                      |
| `SICK_LEAVE`                  | opened by `ILLNESS`                                                                                           | paid share by the row’s rule | 2026-07-01, 2026-08-15 |
| `SOCIAL_ACTIVITY`             | no limit                                                                                                      | full pay                     | —                      |
| `WORK_INJURY_LEAVE`           | no limit                                                                                                      | full pay                     | —                      |

### Overtime, rest-day and holiday work

| Code                     | What it pays                                                                                                   | Numbers on the row | Value changed |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------ | ------------- |
| `OVERTIME`               | Normal working-day overtime hours, paid at the statutory multiplier.                                           | multiplier 1.5     | —             |
| `COMPREHENSIVE_OVERTIME` | Overtime beyond the approved comprehensive-hours review, paid at the statutory multiplier.                     | multiplier 1.5     | —             |
| `REST_DAY_WORK`          | Hours worked on a rest day, paid at the statutory rest-day multiplier or the employer's higher rest-day hourl… | multiplier 2       | —             |
| `HOLIDAY_WORK`           | Hours worked on a statutory holiday, paid at the statutory holiday multiplier.                                 | multiplier 3       | —             |

Roster warnings (`ROSTER_OVERTIME_DAILY`): daily hours 11; daily overtime hours 3; monthly overtime hours 36; consecutive days 6; weekly rest days 1.

### Allowance, claim, ad hoc, loan, work event and workplace case rows

- **Allowance** (9): `CHILDCARE_SUBSIDY`, `FIXED_ALLOWANCE`, `FOREIGN_CHILD_EDUCATION_ALLOWANCE`, `FOREIGN_HOUSING_ALLOWANCE`, `FOREIGN_LANGUAGE_ALLOWANCE`, `HIGH_TEMPERATURE_ALLOWANCE`, `MEAL_SUBSIDY_OUT`, `ONLY_CHILD_ALLOWANCE`, `TRAVEL_ALLOWANCE`. Of these, 3 count in the wage a day or hour rate divides.
- **Claim** (1): `HOME_LEAVE_TRAVEL`. Of these, 0 have a yearly limit.
- **Ad hoc** (15): `ANNUAL_BONUS`, `BONUS`, `DAMAGE_COMPENSATION_DEDUCTION`, `EARLY_RETIREMENT_LUMP_SUM`, `ECONOMIC_COMPENSATION`, `INTERNAL_RETIREMENT_LUMP_SUM`, `MATERNITY_ALLOWANCE_PASSTHROUGH`, `MATERNITY_TOPUP`, `NON_COMPETE_COMPENSATION`, `PAY_IN_LIEU_OF_NOTICE`, `STATUTORY_REFUND`, `UNLAWFUL_TERMINATION_COMPENSATION`, `WAGE_ARREARS_PENALTY`, `WORK_INJURY_DISABILITY_ALLOWANCE`, `WORK_INJURY_DISABILITY_SUBSIDY`. Of these, 10 may run off-cycle, 0 post to a balance account (statutory corrections) and 0 are employer cost.
- **Loan** (0): none.
- **Work event** (7): `EMPLOYEE_CAUSED`, `EPIDEMIC`, `FORCE_MAJEURE`, `GOVERNMENT_ORDER`, `HIGH_TEMPERATURE`, `NATURAL_DISASTER`, `STOPPAGE_EMPLOYER`.
- **Workplace case** (5): `BENEFIT_SERVICE_RECORD`, `CONTRACT_RENEWAL_REFUSAL`, `CROSS_BORDER_WORK_RECORD`, `EXTERNAL_WAGE_RECORD`, `FIXED_TERM_CONTRACT_REQUEST`.

### Registered rules: what a write is refused for

- **`employee_contract`** (11): `CONTRACT_CATEGORIES`, `MINIMUM_WAGE_HOURLY`, `OPEN_ENDED_REQUIRED`, `PART_TIME_HOURS`, `PART_TIME_PAY_CYCLE`, `PROBATION_LENGTH`, `PROBATION_ONCE`, `PROBATION_WAGE`, `SHARED_STRUCTURED_EMPLOYEE_INPUTS`, `SI_WAIVER_VOID`, `TERMINATION_PROTECTED`.
- **`entity_profile_version`** (1): `SHARED_STRUCTURED_ENTITY_INPUTS`.
- **`leave_catalog_entry`** (6): `ANNUAL_LEAVE_FORFEITED`, `ELDER_CARE_HOSPITALISATION`, `MEDICAL_PERIOD_EXHAUSTED`, `MENSTRUAL_LEAVE_CONDITIONS`, `NURSING_BREAK_CHILD_AGE`, `WORK_INJURY_LEAVE_12_MONTHS`.
- **`payroll_run`** (1): `WAGE_PAID_LATE`.
- **`roster_entry`** (5): `ROSTER_CHILD_LABOUR`, `ROSTER_OVERTIME_DAILY`, `ROSTER_PART_TIME_WEEK`, `ROSTER_PREGNANT_NURSING`, `ROSTER_WEEKLY_REST`.
- **`workplace_case_catalog_entry`** (5): `BUSINESS_CASE_DOCUMENT_REQUIRED`, `BUSINESS_CASE_SIGNED_CONSENT`, `BUSINESS_CASE_SUBJECT_AND_REFERENCE`, `FIXED_TERM_REQUEST_DATES`, `RENEWAL_REFUSAL_REVIEW_DATES`.

### Registered effects: the tasks raised

48 effects; every one writes `obligation.create`.

- **`employee_contract`** on create, update (11): `DEEMED_OPEN_ENDED_CONTRACT`, `EMPLOYEE_ROSTER`, `EMPLOYMENT_REGISTRATION`, `HPF_DEPOSIT_REGISTRATION`, `JUVENILE_WORKER_ANNUAL_CHECK`, `JUVENILE_WORKER_REGISTRATION`, `OPEN_ENDED_CONTRACT_RIGHT`, `PI_PROCESSING_NOTICE` and 3 more.
- **`employee_contract`** on exit (8): `ECONOMIC_LAYOFF_REPORT`, `EMPLOYMENT_DEREGISTRATION`, `FINAL_WAGES`, `HPF_CHANGE_REGISTRATION`, `PERSONAL_DATA_DISPOSAL`, `SI_FILE_TRANSFER`, `TERMINATED_CONTRACT_RETENTION`, `TERMINATION_CERTIFICATE`.
- **`entity_profile_version`** on create, update (4): `CROSS_BORDER_HR_TRANSFER`, `HPF_UNIT_REGISTRATION`, `SI_UNIT_CHANGE_REGISTRATION`, `SI_UNIT_REGISTRATION`.
- **`leave_catalog_entry`** on create, update (2): `SENSITIVE_PI_CONSENT_MEDICAL`, `WORK_INJURY_RECOGNITION`.
- **`obligation`** on update (1): `SI_LATE_SURCHARGE`.
- **`payroll_run`** on create (16): `ACCOUNTING_VOUCHER_RETENTION`, `DISABLED_EMPLOYMENT_FUND`, `HPF_BASE_ANNUAL_ADJUSTMENT`, `HPF_MONTHLY_REMITTANCE`, `IIT_ANNUAL_RECONCILIATION`, `IIT_INCOME_STATEMENT`, `IIT_MONTHLY_DECLARATION`, `IIT_RECONCILIATION_RECORDS` and 8 more.
- **`payslip`** on create (6): `CN_ANNUAL_LEAVE_REVIEW`, `CN_COMPREHENSIVE_REVIEW`, `CN_HPF_COMMENCEMENT_REVIEW`, `DISABILITY_ALLOWANCE_SI_BASE`, `MINIMUM_WAGE`, `OVER_AGE_AGREEMENT`.

### Employer pay methods

- `rest_day_hourly_multiplier`: `REST_DAY_WORK`.

## Indonesia (ID)

### Law versions

| Version | From       | To         | State  |
| ------- | ---------- | ---------- | ------ |
| 1       | 2025-12-01 | 2025-12-31 | sealed |
| 2       | 2026-01-01 | 2026-02-28 | sealed |
| 3       | 2026-03-01 | 2026-10-27 | sealed |
| 4       | 2026-10-28 | open       | sealed |

Rows whose values differ from the version before:

- Version 2, from 2026-01-01: statutory `PPH21_DTP`; rules `SECTOR_MINIMUM_WAGE`; settings `lookup`.
- Version 3, from 2026-03-01: statutory `JKK`, `JP`.
- Version 4, from 2026-10-28: leave `JOINT_LEAVE`, `LONG_LEAVE`; ad hoc `PESANGON`, `UPMK`; rules `DAILY_MINIMUM_WAGE`, `HOURLY_MINIMUM_WAGE`, `MINIMUM_AGE`, `MINIMUM_WAGE_FLOOR`, `PKWT_MAXIMUM_TERM` and 1 more.

### Conversions and subtotal chain

Currency IDR. Tax year starts in month 1. Day rate `YEAR`, hour rate `FIXED ÷ 173`, proration `DAY_RATE`, rounding `HALF_UP` to 0 places. Year-to-date totals restart per `JURISDICTION`.

Chain: `BASIC` → `PRORATED` → `PAID_BASIC` → `ORDINARY_WAGES` → `ADDITIONAL_WAGES` → `SEVERANCE` → `PENSION_BENEFIT` → `GROSS` → `NET`.

### Contributions and taxes

| Code                     | Kind         | What it is                                                                                           | Employee | Employer | Below zero | First reference on the row                                             | Value changed |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------------------------- | -------- | -------- | ---------- | ---------------------------------------------------------------------- | ------------- |
| `JHT`                    | contribution | BPJS old-age savings (JHT): 2% from the employee and 3.7% from the employer on the monthly wage, wh… | yes      | yes      | stops      | PP 46/2015 (+6 more)                                                   | —             |
| `JP`                     | contribution | BPJS pension (JP): 1% from the employee and 2% from the employer on the monthly wage (basic pay plu… | yes      | yes      | stops      | PP 45/2015 (+5 more)                                                   | 2026-03-01    |
| `JKK`                    | contribution | BPJS work accident insurance (JKK), paid by the employer only: 0.24% to 1.74% of the monthly wage b… | no       | yes      | stops      | PP 44/2015 (+5 more)                                                   | 2026-03-01    |
| `JKM`                    | contribution | BPJS death insurance (JKM), paid by the employer only: 0.30% of the monthly wage (PP 44/2015 art.18… | no       | yes      | stops      | PP 44/2015 (+7 more)                                                   | —             |
| `KESEHATAN`              | contribution | BPJS health insurance: 1% from the employee and 4% from the employer on the monthly wage, between t… | yes      | yes      | stops      | Perpres 82/2018 (+6 more)                                              | —             |
| `JKP`                    | contribution | BPJS job loss insurance (JKP)                                                                        | no       | no       | stops      | PP 37/2021 as amended by PP 6/2025 (+5 more)                           | —             |
| `PPH21`                  | tax          | Income tax withheld from the employee (PPh 21)                                                       | yes      | no       | refund     | PP 58/2023, art.2–3, art.3(4)–(6) (+11 more)                           | —             |
| `PPH21_DTP`              | tax          | PPh 21 borne by the government in 2026 for employees of the labour-intensive industries listed, on…  | yes      | yes      | refund     | PMK 105/2025                                                           | 2026-01-01    |
| `PPH21_FINAL_SEVERANCE`  | tax          | Final income tax on severance pay paid at once or within two calendar years, by its own rate ladder… | yes      | no       | refund     | PP 68/2009 arts.2(2),5–7: first two calendar years aggregat… (+1 more) | —             |
| `PPH21_FINAL_PENSION`    | tax          | Final income tax on a pension benefit, old-age savings or JHT paid at once or within two calendar y… | yes      | no       | refund     | PP 68/2009 arts.2(2),5–7: first two calendar years aggregat… (+1 more) | —             |
| `PPH21_BUKAN_PEGAWAI`    | tax          | Income tax on fees paid to an individual who is not an employee: the yearly rates on 50% of each pa… | yes      | no       | refund     | PMK 168/2023, arts.12(3)–(4), 13 (+2 more)                             | —             |
| `PPH26`                  | tax          | Income tax on pay to a non-resident: 20% of the gross amount, final, or the tax treaty rate where a… | yes      | no       | stops      | UU 36/2008 (PPh) (+2 more)                                             | —             |
| `DKPTKA`                 | contribution | The monthly compensation an employer pays for employing a foreign worker: USD 100 for each position… | no       | yes      | stops      | PP 34/2021, arts.1 angka 7, 23, 25                                     | —             |
| `PPH21_BENEFIT_NONFINAL` | tax          | Income tax on severance or pension instalments paid from the third year after the first payment: th… | yes      | no       | refund     | PP68/2009 art.6; PMK16/PMK.03/2010 art.5 (+1 more)                     | —             |
| `PPH21_EMPLOYER_BORNE`   | tax          | Where the contract says the employer bears the income tax, moves the month's PPh 21 from the employ… | yes      | yes      | refund     | UU 7/1983 on Income Tax as amended by UU 7/2021 (HPP), art.…           | —             |

### Leave

| Code                          | Entitlement                                                       | A day taken                  | Value changed |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------- | ------------- |
| `ANNUAL_LEAVE`                | 12 days; service year; carries one window, at most 5              | full pay, cashable           | —             |
| `BEREAVEMENT_HOUSEHOLD_LEAVE` | 1 days; opened by `BEREAVEMENT_HOUSEHOLD`; per event              | full pay                     | —             |
| `BEREAVEMENT_LEAVE`           | 2 days; opened by `BEREAVEMENT`; per event                        | full pay                     | —             |
| `CHILD_BAPTISM_LEAVE`         | 2 days; opened by `CHILD_BAPTISM`; per event                      | full pay                     | —             |
| `CHILD_CIRCUMCISION_LEAVE`    | 2 days; opened by `CHILD_CIRCUMCISION`; per event                 | full pay                     | —             |
| `CHILD_MARRIAGE_LEAVE`        | 2 days; opened by `CHILD_MARRIAGE`; per event                     | full pay                     | —             |
| `COMPANY_TRAINING_LEAVE`      | no limit                                                          | full pay                     | —             |
| `EMPLOYER_IDLE`               | no limit                                                          | full pay                     | —             |
| `JOINT_LEAVE`                 | no limit                                                          | full pay                     | 2026-10-28    |
| `LONG_LEAVE`                  | 30 days; block of 60 months of service                            | full pay                     | 2026-10-28    |
| `MARRIAGE_LEAVE`              | 3 days; opened by `MARRIAGE`; per event                           | full pay                     | —             |
| `MATERNITY_LEAVE`             | 90 days; opened by `BIRTH_COMPLICATION`, `CHILD_BIRTH`; per event | paid share by the row’s rule | —             |
| `MEDICAL_LEAVE`               | opened by `LONG_ILLNESS`                                          | paid share by the row’s rule | —             |
| `MENSTRUAL_LEAVE`             | no limit                                                          | full pay                     | —             |
| `MISCARRIAGE_LEAVE`           | no limit                                                          | full pay                     | —             |
| `NPL`                         | no limit                                                          | paid share 0                 | —             |
| `PATERNITY_EXTENSION_LEAVE`   | 3 days; opened by `CHILD_BIRTH`; per event                        | full pay                     | —             |
| `PATERNITY_LEAVE`             | 2 days; opened by `CHILD_BIRTH`; per event                        | full pay                     | —             |
| `PUBLIC_HOLIDAY_IN_LIEU`      | none by default; HR grants each day; calendar year                | full pay                     | —             |
| `RELIGIOUS_DUTY_LEAVE`        | no limit                                                          | full pay                     | —             |
| `STATE_DUTY_LEAVE`            | no limit                                                          | full pay                     | —             |
| `SUSPENSION`                  | no limit                                                          | full pay                     | —             |
| `UNION_DUTY_LEAVE`            | no limit                                                          | full pay                     | —             |
| `WORK_ACCIDENT_LEAVE`         | opened by `WORK_ACCIDENT`                                         | paid share by the row’s rule | —             |

### Overtime, rest-day and holiday work

| Code       | What it pays                                                         | Numbers on the row                        | Value changed |
| ---------- | -------------------------------------------------------------------- | ----------------------------------------- | ------------- |
| `OVERTIME` | Normal working-day overtime hours, paid at the statutory multiplier. | short_day_hours 5, wage_floor_factor 0.75 | —             |

Roster warnings (`ROSTER_UNDER_13`): daily hours 8; daily overtime hours 4; monthly overtime hours 78; consecutive days 6; weekly rest days 1.

### Allowance, claim, ad hoc, loan, work event and workplace case rows

- **Allowance** (3): `CAR_ALLOWANCE`, `HOUSE_ALLOWANCE`, `SPECIAL_ALLOWANCE`. Of these, 3 count in the wage a day or hour rate divides.
- **Claim** (2): `MEDICAL_CLAIM`, `SWAB_TEST_REIMBURSEMENT`. Of these, 0 have a yearly limit.
- **Ad hoc** (29): `BACK_PAY_SALARY`, `BANKRUPTCY_ESTATE`, `BONUS_THR`, `COMPENSATION`, `COURT_GARNISHMENT`, `DEDUCTION`, `DETENTION_FAMILY_AID`, `EMPLOYER_PAID_BENEFIT`, `KESEHATAN_TERMINATION_MONTH_EMPLOYEE`, `KESEHATAN_TERMINATION_MONTH_EMPLOYER`, `LATE_THR_FINE`, `LATE_WAGE_FINE`, `MEDICAL_ALLOWANCE`, `NATURA`, `NON_EMPLOYEE_FEE`, `PENSION_LUMPSUM`, `PENSION_OFFSET`, `PESANGON`, `PKWT_COMPENSATION`, `PKWT_EARLY_TERMINATION_BY_WORKER`, `PKWT_EARLY_TERMINATION`, `RETROACTIVE_PAY`, `STATUTORY_ADJUSTMENT`, `STATUTORY_REFUND`, `THR_HOLIDAY`, `THR`, `UANG_PISAH`, `UPH_TRAVEL_HOME`, `UPMK`. Of these, 18 may run off-cycle, 1 post to a balance account (statutory corrections) and 3 are employer cost.
- **Loan** (1): `STAFF_LOAN`.
- **Work event** (4): `EMPLOYER_CAUSED`, `FORCE_MAJEURE`, `STRIKE_NORMATIVE`, `STRIKE_OTHER`.
- **Workplace case** (9): `BENEFIT_SERVICE_RECORD`, `CROSS_BORDER_WORK_RECORD`, `EXTERNAL_WAGE_RECORD`, `PERSONAL_DATA_ACCESS_REQUEST`, `PERSONAL_DATA_BREACH`, `PERSONAL_DATA_CONSENT_WITHDRAWAL`, `PERSONAL_DATA_CORRECTION_REQUEST`, `PERSONAL_DATA_RESTRICTION_REQUEST`, `WORKER_HEALTH_EXAMINATION_COMPLETED`.

### Registered rules: what a write is refused for

- **`employee_contract`** (13): `BASIC_WAGE_SHARE`, `CONTRACT_CATEGORIES`, `DAILY_MINIMUM_WAGE`, `FOREIGN_WORKER_PERSONNEL_POSITION`, `HOURLY_MINIMUM_WAGE`, `MINIMUM_AGE`, `MINIMUM_WAGE_FLOOR`, `MINIMUM_WAGE_REGION_UNKNOWN`, `PKWT_MAXIMUM_TERM`, `PKWT_WRITTEN_INDONESIAN`, `PROBATION_RULES`, `SECTOR_MINIMUM_WAGE`, `SHARED_STRUCTURED_EMPLOYEE_INPUTS`.
- **`entity_profile_version`** (2): `ESTABLISHMENT_EVENT_DATE_REQUIRED`, `SHARED_STRUCTURED_ENTITY_INPUTS`.
- **`roster_entry`** (1): `ROSTER_UNDER_13`.

### Registered effects: the tasks raised

43 effects; every one writes `obligation.create`.

- **`adhoc_catalog_entry`** on create (1): `LATE_THR_FINE`.
- **`employee_contract`** on create, update (11): `BPJS_KESEHATAN_REGISTRATION`, `BPJS_KETENAGAKERJAAN_FAMILY_DATA_CHANGE`, `BPJS_KETENAGAKERJAAN_REGISTRATION`, `BPJS_KETENAGAKERJAAN_WAGE_CHANGE`, `FOREIGN_WORKER_COMPANION_TRAINING`, `FOREIGN_WORKER_RPTKA_DKPTKA`, `PKWT_REGISTRATION`, `PKWT_TERM_END_COMPENSATION` and 3 more.
- **`employee_contract`** on exit (5): `BPJS_KETENAGAKERJAAN_EXIT_REPORT`, `JKP_PHK_NOTIFICATION`, `PERSONAL_DATA_DISPOSAL`, `PPH21_BPA1_EXIT`, `TERMINATION_REPORT`.
- **`entity_profile_version`** on create, update (2): `BPJS_KETENAGAKERJAAN_ENTITY_CHANGE`, `WLKP_ESTABLISHMENT_REPORT`.
- **`leave_catalog_entry`** on create (2): `LONG_ILLNESS_REMINDER`, `WORK_ACCIDENT_REPORT`.
- **`payroll_run`** on create (17): `BPJS_KESEHATAN_REMITTANCE`, `BPJS_KETENAGAKERJAAN_REMITTANCE`, `COMPANY_REGULATION_RENEWAL`, `DISABILITY_QUOTA_REVIEW`, `DKPTKA_PAYMENT`, `K3_SMK3_P2K3`, `LKS_BIPARTIT_FORMATION`, `MINIMUM_WAGE_COMPLIANCE` and 9 more.
- **`payroll_run`** on update (2): `LATE_WAGE_FINE`, `PAYSLIP_ISSUE`.
- **`workplace_case_catalog_entry`** on create (3): `PDP_BREACH_NOTICE`, `PDP_SUBJECT_REQUEST`, `WORKER_HEALTH_EXAMINATION_REPORT`.

### Employer pay methods

- `rest_day_hourly_multiplier`: `OVERTIME`.

## Japan (JP)

### Law versions

| Version | From       | To         | State  |
| ------- | ---------- | ---------- | ------ |
| 1       | 2025-12-01 | 2025-12-31 | sealed |
| 2       | 2026-01-01 | 2026-02-28 | sealed |
| 3       | 2026-03-01 | 2026-03-31 | sealed |
| 4       | 2026-04-01 | 2026-06-30 | sealed |
| 5       | 2026-07-01 | 2026-09-30 | sealed |
| 6       | 2026-10-01 | 2026-11-30 | sealed |
| 7       | 2026-12-01 | 2026-12-31 | sealed |
| 8       | 2027-01-01 | open       | sealed |

Rows whose values differ from the version before:

- Version 2, from 2026-01-01: statutory `INCOME_TAX`.
- Version 3, from 2026-03-01: settings `lookup`.
- Version 4, from 2026-04-01: statutory `CHILD_SUPPORT`, `CHILD_SUPPORT_BONUS`, `HEALTH_BONUS`, `INCOME_TAX`; ad hoc `NIGHT_MEAL_CASH`; settings `lookup`.
- Version 5, from 2026-07-01: effects `DISABILITY_EMPLOYMENT_REPORT`.
- Version 6, from 2026-10-01: effects `HARASSMENT_PREVENTION_2026_AMENDMENT`, `SHORT_TIME_COVERAGE`.
- Version 7, from 2026-12-01: statutory `YEAR_END_ADJUSTMENT`.
- Version 8, from 2027-01-01: statutory `INCOME_TAX`.

### Conversions and subtotal chain

Currency JPY. Tax year starts in month 1. Day rate `HOUR`, hour rate `CONTRACT_WEEKLY`, proration `WORKING_DAYS`, rounding `HALF_UP` to 0 places. Year-to-date totals restart per `JURISDICTION`.

Chain: `BASIC` → `PRORATED` → `PAID_BASIC` → `NON_TAXABLE_PAY` → `ORDINARY_WAGES` → `LONG_PERIOD_BONUS` → `ADDITIONAL_WAGES` → `RETIREMENT_UNDECLARED` → `RETIREMENT` → `FINAL_PAY` → `SOCIAL_INSURANCE_REFUND` → `NET`.

### Contributions and taxes

| Code                      | Kind         | What it is                                                                                           | Employee | Employer | Below zero | First reference on the row                                                                              | Value changed                      |
| ------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- | -------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `HEALTH`                  | contribution | Health insurance premium (with nursing care insurance from age 40): the standard monthly remunerati… | yes      | yes      | stops      | 健康保険法, 40条、41〜43条、45条、156条、160条、161条、167条                                            | —                                  |
| `HEALTH_BONUS`            | contribution | Health insurance premium on a bonus: the bonus, rounded down to 1,000 yen and up to 5,730,000 yen i… | yes      | yes      | refund     | 健康保険法, 45条、156条、167条2項 (+1 more)                                                             | 2026-04-01                         |
| `CHILD_SUPPORT`           | contribution | Child and childcare support levy, collected with the health insurance premium from the April 2026 p… | yes      | yes      | stops      | 健康保険法; 子ども・子育て支援法, 健保法156条1項、160条の2、161条; 子ども・子育て支援法71条の3          | new 2026-04-01                     |
| `CHILD_SUPPORT_BONUS`     | contribution | Child and childcare support levy on a bonus, on the same standard bonus amount and yearly cap as he… | yes      | yes      | refund     | 健康保険法, 156条1項、160条の2 (+1 more)                                                                | new 2026-04-01                     |
| `PENSION`                 | contribution | Employees' pension premium: 18.3% of the standard monthly remuneration (88,000–650,000), shared equ… | yes      | yes      | stops      | 厚生年金保険法, 9条、14条5項、19条1項、20条、24条の4、81条4項、82条、84条                               | —                                  |
| `PENSION_BONUS`           | contribution | Employees' pension premium on a bonus: 18.3% of the bonus, up to 1,500,000 yen in a payment month,…  | yes      | yes      | refund     | 厚生年金保険法, 24条の4、81条、84条2項 (+1 more)                                                        | —                                  |
| `CHILD_CONTRIBUTION`      | contribution | Child and childcare contribution, paid by the employer only: 0.36% of the standard monthly remunera… | no       | yes      | stops      | 子ども・子育て支援法; 子ども・子育て支援法施行令, 69〜71条; 71条2項                                     | —                                  |
| `EI`                      | contribution | Employment insurance premium on the wages paid, at the worker's and the employer's rates for the ty… | yes      | yes      | refund     | 労働保険の保険料の徴収等に関する法律, 11条、12条4項、31条                                               | —                                  |
| `EI_BONUS`                | contribution | Employment insurance premium on a bonus, at the same rates as on wages; the worker's share is deduc… | yes      | yes      | refund     | 労働保険の保険料の徴収等に関する法律; 雇用保険法, 徴収法11条、31条; 雇用保険法4条4項                    | —                                  |
| `WORKERS_ACCIDENT`        | contribution | Workers' accident compensation insurance premium, paid by the employer only: the rate for the type…  | no       | yes      | stops      | 労働者災害補償保険法; 労働保険の保険料の徴収等に関する法律, 労災保険法3条; 徴収法11〜12条、12条3項      | —                                  |
| `ASBESTOS_LEVY`           | contribution | General contribution for asbestos health damage relief, paid by the employer only: 0.02 per 1,000 o… | no       | yes      | stops      | 石綿による健康被害の救済に関する法律; 同法施行令, 35条、37条                                            | —                                  |
| `INCOME_TAX`              | tax          | Employee income tax withheld for the pay period.                                                     | yes      | no       | refund     | 所得税法; 復興財源確保法; 防衛財源確保法, 所得税法183条、185条、186条; 復興財源確保法28〜31条 (+1 more) | 2026-01-01, 2026-04-01, 2027-01-01 |
| `YEAR_END_ADJUSTMENT`     | tax          | Year-end adjustment: at the last salary payment of the year, or when an employee leaves in the case… | yes      | no       | refund     | 所得税法, 190〜193条 (+2 more)                                                                          | 2026-12-01                         |
| `RETIREMENT_TAX`          | tax          | Income tax withheld on a retirement allowance: the retirement income deduction for the years of ser… | yes      | no       | stops      | 所得税法, 30条（退職所得）、89条（税率）、203条（源泉徴収）                                             | —                                  |
| `RESIDENT_TAX_RETIREMENT` | tax          | Resident tax on a retirement allowance, withheld when it is paid: municipal 6% and prefectural 4% o… | yes      | no       | stops      | 地方税法, 50条の5（退職所得の分離課税）、328条の5（特別徴収）                                           | —                                  |
| `RESIDENT_TAX`            | tax          | Individual resident tax deducted each month from June to the following May, in the amounts the muni… | yes      | no       | stops      | 地方税法, 321条の3、321条の4、321条の5                                                                  | —                                  |

### Leave

| Code                            | Entitlement                                                                           | A day taken  | Value changed |
| ------------------------------- | ------------------------------------------------------------------------------------- | ------------ | ------------- |
| `ANNUAL_LEAVE`                  | 10–20 days by length of service; own statutory test; service year; carries one window | full pay     | —             |
| `ANNUAL_LEAVE_HOURS`            | no limit; draws on `ANNUAL_LEAVE`                                                     | full pay     | —             |
| `CHILDCARE_LEAVE`               | no limit                                                                              | paid share 0 | —             |
| `CHILD_NURSING_LEAVE`           | own statutory test; calendar year                                                     | paid share 0 | —             |
| `CIVIC_DUTY_LEAVE`              | no limit                                                                              | paid share 0 | —             |
| `FAMILY_CARE_DAYS`              | own statutory test; calendar year                                                     | paid share 0 | —             |
| `FAMILY_CARE_LEAVE`             | no limit                                                                              | paid share 0 | —             |
| `MATERNAL_HEALTH_CHECK`         | no limit                                                                              | paid share 0 | —             |
| `MENSTRUAL_LEAVE`               | no limit                                                                              | paid share 0 | —             |
| `NPL`                           | no limit                                                                              | paid share 0 | —             |
| `NURSING_TIME`                  | no limit                                                                              | paid share 0 | —             |
| `OCCUPATIONAL_INJURY_ABSENCE`   | no limit                                                                              | paid share 0 | —             |
| `POSTNATAL_LEAVE`               | no limit                                                                              | paid share 0 | —             |
| `POSTNATAL_PATERNITY_LEAVE`     | no limit                                                                              | paid share 0 | —             |
| `PRENATAL_LEAVE`                | no limit                                                                              | paid share 0 | —             |
| `SICKNESS_ABSENCE`              | no limit                                                                              | paid share 0 | —             |
| `SUBSTITUTE_LEAVE_FOR_OVERTIME` | none by default; HR grants each day; calendar year                                    | full pay     | —             |

### Overtime, rest-day and holiday work

| Code                    | What it pays                                                                                                       | Numbers on the row                                    | Value changed |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------- |
| `WITHIN_HOURS_OVERTIME` | Approved overtime past the planned shift that stays within 8 hours a day and 40 a week (法内残業): paid at the or… | multiplier 1                                          | —             |
| `OVERTIME`              | Statutory overtime (past 8 hours a day or 40 a week), the first 60 hours of the month: paid at 125% of the ho…     | multiplier 1.25                                       | —             |
| `OVERTIME_OVER_60`      | Statutory overtime past 60 hours in the month: paid at 150% of the hourly rate.                                    | multiplier 1.5                                        | —             |
| `REST_DAY_WORK`         | Every hour worked on the statutory weekly rest day: paid at 135% of the hourly rate, or the employer's higher…     | multiplier 1.35                                       | —             |
| `NIGHT_WORK`            | Every hour worked between 22:00 and 05:00: a further 25% of the hourly rate, on top of any overtime or rest-d…     | multiplier 0.25                                       | —             |
| `OVERTIME_SUBSTITUTED`  | Deducts the extra 25% on four overtime hours for each hour of substitute leave taken instead of the over-60-h…     | multiplier 0.25, overtime_hours_per_substitute_hour 4 | —             |

Roster warnings (`ROSTER_DAILY_8H`): monthly overtime hours 45; consecutive days 6; weekly rest days 1.

### Allowance, claim, ad hoc, loan, work event and workplace case rows

- **Allowance** (6): `ATTENDANCE_ALLOWANCE`, `COMMUTING_ALLOWANCE_TAXABLE`, `COMMUTING_ALLOWANCE`, `FAMILY_ALLOWANCE`, `FIXED_ALLOWANCE`, `HOUSING_ALLOWANCE`. Of these, 2 count in the wage a day or hour rate divides.
- **Claim** (2): `BUSINESS_TRAVEL`, `EXPENSE_REIMBURSEMENT`. Of these, 0 have a yearly limit.
- **Ad hoc** (18): `BONUS_OVER_SIX_MONTHS`, `BONUS`, `COMMUTER_PASS`, `DISCIPLINARY_DEDUCTION`, `DISMISSAL_NOTICE_ALLOWANCE`, `INJURY_WAITING_COMPENSATION`, `LATE_WAGE_INTEREST`, `NIGHT_DUTY_ALLOWANCE`, `NIGHT_MEAL_CASH`, `RETIREMENT_ALLOWANCE_UNDECLARED`, `RETIREMENT_ALLOWANCE`, `SHUTDOWN_ALLOWANCE`, `SOCIAL_INSURANCE_ADJUSTMENT`, `SOCIAL_INSURANCE_REFUND`, `SPECIAL_ALLOWANCE`, `STATUTORY_ADJUSTMENT`, `STATUTORY_REFUND`, `WAGE_ADJUSTMENT`. Of these, 11 may run off-cycle, 0 post to a balance account (statutory corrections) and 0 are employer cost.
- **Loan** (3): `EMERGENCY_ADVANCE`, `SALARY_ADVANCE`, `STAFF_LOAN`.
- **Work event** (6): `EMPLOYER_CAUSED`, `FORCE_MAJEURE`, `GOVERNMENT_ORDER`, `LOCKOUT`, `STRIKE`, `WRONGFUL_WORK_REFUSAL`.
- **Workplace case** (11): `CHILDCARE_NIGHT_WORK_EXEMPTION_REQUEST`, `CHILDCARE_NO_OVERTIME_REQUEST`, `CHILDCARE_OVERTIME_LIMIT_REQUEST`, `DATA_BREACH`, `DEPENDANT_CHANGE`, `DIGITAL_WAGE_PAYMENT_CONSENT`, `EMPLOYMENT_CERTIFICATE_REQUEST`, `PREGNANCY_WORK_LIMIT_REQUEST`, `RETIREMENT_INCOME_DECLARATION`, `SHORT_TIME_COVERAGE_NOTICE`, `SHORT_TIME_VOLUNTARY_APPROVAL`.

### Registered rules: what a write is refused for

- **`employee_contract`** (3): `CONTRACT_CATEGORIES`, `MINIMUM_WAGE_CONTRACT`, `MINIMUM_WAGE_HOURS_REQUIRED`.
- **`entity_profile_version`** (4): `ESTABLISHMENT_EVENT_DATES_REQUIRED`, `PAYROLL_OFFICE_EVENT_DATE_REQUIRED`, `WAGE_PAYMENT_MONTHLY`, `WORK_WEEK_START_REQUIRED`.
- **`leave_catalog_entry`** (2): `JP_ANNUAL_LEAVE_HOURS_CAP`, `JP_PRENATAL_WINDOW`.
- **`roster_entry`** (15): `ROSTER_BREAK`, `ROSTER_CHILDCARE_NIGHT`, `ROSTER_CHILDCARE_OVERTIME`, `ROSTER_DAILY_8H`, `ROSTER_HAZARDOUS_OVERTIME`, `ROSTER_LEAVE_ON_WORKED_DAY`, `ROSTER_MATERNITY_NIGHT`, `ROSTER_MATERNITY_OVERTIME`, `ROSTER_MINOR_HOURS`, `ROSTER_MINOR_NIGHT`, `ROSTER_MINOR_OVERTIME`, `ROSTER_OVERTIME_UNRECORDED`, `ROSTER_REST_DAY`, `ROSTER_REST_INTERVAL`, `ROSTER_WEEKLY_40H`.
- **`workplace_case_catalog_entry`** (4): `BUSINESS_CASE_EFFECTIVE_INTERVAL`, `BUSINESS_CASE_SIGNED_CONSENT`, `BUSINESS_CASE_SUBJECT_AND_REFERENCE`, `DIGITAL_CONSENT_EFFECTIVE_DATE`.

### Registered effects: the tasks raised

108 effects; every one writes `obligation.create`.

- **`adhoc_catalog_entry`** on create (2): `BONUS_PAYMENT_REPORT`, `RETIREMENT_INCOME_SLIP`.
- **`employee_contract`** on create, update (20): `ANNUAL_LEAVE_FIVE_DAY_DESIGNATION`, `ANNUAL_LEAVE_REGISTER`, `CARE_INFORMATION_AT_40`, `CONTINUED_EMPLOYMENT_CONFIRMATION`, `EMPLOYMENT_INSURANCE_ACQUISITION`, `HEALTH_CHECK_AT_HIRE`, `HEALTH_LOSS_AT_75`, `INDEFINITE_CONVERSION_NOTICE` and 12 more.
- **`employee_contract`** on exit (8): `EMPLOYMENT_INSURANCE_LOSS`, `FINAL_WAGES_ON_REQUEST`, `LEAVER_WITHHOLDING_SLIP`, `NON_RENEWAL_NOTICE`, `PERSONAL_DATA_DISPOSAL`, `RECORDS_RETENTION`, `RESIDENT_TAX_TRANSFER`, `SOCIAL_INSURANCE_LOSS`.
- **`entity_profile_version`** on update (11): `CHILDCARE_ENVIRONMENT_MEASURES`, `EMPLOYMENT_INSURANCE_ESTABLISHMENT`, `HARASSMENT_PREVENTION_2026_AMENDMENT`, `HARASSMENT_PREVENTION_MEASURES`, `LABOUR_INSURANCE_ESTABLISHMENT`, `LABOUR_INSURANCE_OFFICE_CHANGE`, `LABOUR_INSURANCE_PROVISIONAL_DECLARATION`, `PAYROLL_OFFICE_OPENING` and 3 more.
- **`leave_catalog_entry`** on create (10): `CARE_INDIVIDUAL_NOTICE`, `CARE_LEAVE_BENEFIT_APPLICATION`, `CHILDCARE_BENEFIT_APPLICATION`, `CHILDCARE_END_GRADE_CHANGE`, `CHILDCARE_INDIVIDUAL_NOTICE`, `CHILDCARE_PREMIUM_EXEMPTION`, `MATERNITY_END_GRADE_CHANGE`, `MATERNITY_PREMIUM_EXEMPTION` and 2 more.
- **`loan_catalog_entry`** on create (1): `EMERGENCY_PAYMENT`.
- **`payroll_run`** on create (31): `DEPENDANT_DECLARATION_COLLECTION`, `DISABILITY_EMPLOYMENT_REPORT`, `DISABILITY_LEVY_DECLARATION`, `ELDERLY_EMPLOYMENT_REPORT`, `HEALTH_CHECK_REPORT`, `LABOUR_INSURANCE_ANNUAL_DECLARATION`, `LABOUR_INSURANCE_INSTALMENT_2`, `LABOUR_INSURANCE_INSTALMENT_3` and 23 more.
- **`payslip`** on create (20): `ANNUAL_LEAVE_ATTENDANCE_REVIEW`, `CHILDCARE_CARE_LIMITS`, `DAYTIME_STUDENT_EI`, `DIGITAL_WAGE_CONSENT`, `DISCIPLINARY_DEDUCTION_LIMIT`, `EI_COVERAGE_HOURS`, `JP_STANDARD_SHIFT_OVERTIME`, `MATERNITY_LIMITS` and 12 more.
- **`workplace_case_catalog_entry`** on create (5): `DEPENDANT_CHANGE_NOTICE`, `PERSONAL_DATA_BREACH_FINAL`, `PERSONAL_DATA_BREACH_NOTICE`, `PERSONAL_DATA_BREACH_PRELIMINARY`, `SEPARATION_CERTIFICATE`.

### Employer pay methods

- `rest_day_hourly_multiplier`: `REST_DAY_WORK`.

## Malaysia (MY)

### Law versions

| Version | From       | To         | State  |
| ------- | ---------- | ---------- | ------ |
| 1       | 2025-12-01 | 2025-12-31 | sealed |
| 2       | 2026-01-01 | 2026-02-28 | sealed |
| 3       | 2026-03-01 | 2026-05-31 | sealed |
| 4       | 2026-06-01 | 2026-07-07 | sealed |
| 5       | 2026-07-08 | 2026-12-31 | sealed |
| 6       | 2027-01-01 | open       | sealed |

Rows whose values differ from the version before:

- Version 2, from 2026-01-01: statutory `HRDF`.
- Version 3, from 2026-03-01: ad hoc `ACCOMMODATION_RENT`.
- Version 4, from 2026-06-01: statutory `PCB`, `SKBBK`, `SOCSO`; effects `SOCSO_EIS_MONTHLY_CONTRIBUTION`; settings `lookup`.
- Version 5, from 2026-07-08: statutory `SKBBK`.
- Version 6, from 2027-01-01: statutory `HRDF`.

### Conversions and subtotal chain

Currency MYR. Tax year starts in month 1. Day rate `YEAR`, hour rate `CONTRACT_HOURS`, proration `CALENDAR_DAYS`, rounding `HALF_UP` to 2 places. Year-to-date totals restart per `JURISDICTION`.

Chain: `BASIC` → `PRORATED` → `PAID_BASIC` → `REGULAR_PAY` → `EXEMPT_ALLOWANCES` → `CHILDCARE` → `WAGE_ARREARS` → `COMMISSION` → `IRREGULAR_COMMISSION` → `AWARDS` → `LONG_SERVICE` → `INCENTIVE_OT` → `ORDINARY_WAGES` → `ADDITIONAL_WAGES` → `SEPARATION_PAY` → `OFFICIAL_TRAVEL` → `FINAL_PAY` → `ZAKAT` → `NET`.

### Contributions and taxes

| Code              | Kind         | What it is                                                                                           | Employee | Employer | Below zero | First reference on the row                                                                    | Value changed              |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------- | -------- | -------- | ---------- | --------------------------------------------------------------------------------------------- | -------------------------- |
| `EPF`             | contribution | Employees Provident Fund contribution for Malaysian citizens, and for permanent residents and pre-1… | yes      | yes      | refund     | Employees Provident Fund Act 1991 (Act 452), s.43 and Third Schedule Parts A and E (+13 more) | —                          |
| `EPF_PR`          | contribution | Employees Provident Fund contribution for a permanent resident, or a non-citizen who elected before… | yes      | yes      | refund     | Employees Provident Fund Act 1991 (Act 452), s.43 and Third Schedule Part C (+12 more)        | —                          |
| `EPF_NON_CITIZEN` | contribution | Employees Provident Fund contribution for a non-citizen.                                             | yes      | yes      | refund     | Employees Provident Fund (Amendment) Act 2025 (Act A1760), s.10, Part F para 2 (+9 more)      | —                          |
| `SOCSO`           | contribution | Social security (PERKESO) contribution on the month's wages, from the contribution table: about 0.5… | yes      | yes      | refund     | Employees’ Social Security Act 1969 (Act 4) (+8 more)                                         | 2026-06-01                 |
| `SKBBK`           | contribution | Contribution to the social security scheme for injuries outside work, paid by the employee only, fr… | yes      | no       | refund     | Employees’ Social Security (Amendment) Act 2026 (Act A1788) (+8 more)                         | new 2026-06-01, 2026-07-08 |
| `EIS`             | contribution | Employment Insurance System contribution on the month's wages up to RM6,000, from the contribution…  | yes      | yes      | refund     | Employment Insurance System Act 2017 (Act 800) (+7 more)                                      | —                          |
| `PCB`             | tax          | Monthly tax deduction from the employee's pay: the year's tax is worked out from pay to date, relie… | yes      | no       | stops      | Income Tax Act 1967 (Act 53) (+17 more)                                                       | 2026-06-01                 |
| `HRDF`            | contribution | Employer's HRD levy on the month's wages of Malaysian citizens (basic pay and fixed allowances; no…  | no       | yes      | stops      | HRD Corp Employers' Circular 01/2026: education-employer le… (+10 more)                       | 2026-01-01, 2027-01-01     |

### Leave

| Code                           | Entitlement                                                                                                    | A day taken        | Value changed |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------ | ------------- |
| `ANNUAL_LEAVE`                 | 8–16 days by length of service; own statutory test; service year; carries one window, company days capped at 5 | full pay, cashable | —             |
| `COMPASSIONATE_LEAVE`          | no limit                                                                                                       | full pay           | —             |
| `COURT_CUSTODY_ABSENCE`        | no limit                                                                                                       | paid share 0       | —             |
| `EMERGENCY_LEAVE`              | no limit                                                                                                       | full pay           | —             |
| `HOSPITALIZATION_LEAVE`        | 60 days; own statutory test; calendar year                                                                     | full pay           | —             |
| `MATERNITY_LEAVE`              | 98 days; own statutory test; opened by `CHILD_BIRTH`; per event                                                | full pay           | —             |
| `MATERNITY_LEAVE_NO_ALLOWANCE` | 98 days; own statutory test; opened by `CHILD_BIRTH`, `CHILD_BIRTH_NO_ALLOWANCE`; per event                    | paid share 0       | —             |
| `MEDICAL_LEAVE`                | 14–22 days by length of service; own statutory test; calendar year                                             | full pay           | —             |
| `NATIONAL_SERVICE_LEAVE`       | no limit                                                                                                       | paid share 0       | —             |
| `NPL`                          | no limit                                                                                                       | paid share 0       | —             |
| `PATERNITY_LEAVE`              | 7 days; own statutory test; opened by `CHILD_BIRTH`; per event                                                 | full pay           | —             |
| `PUBLIC_HOLIDAY_IN_LIEU`       | none by default; HR grants each day; calendar year                                                             | full pay, cashable | —             |

### Overtime, rest-day and holiday work

| Code                | What it pays                                                                                                   | Numbers on the row                                                    | Value changed |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------- |
| `OVERTIME`          | Overtime beyond normal hours on a working day, and every hour on an off day: 1.5 × the hourly ordinary rate o… | part_time_premium 1, standard_premium 1.5                             | —             |
| `REST_DAY_WORK`     | Work within normal hours on a rest day                                                                         | half_day_hours_factor 0.5, monthly_full_day 1, monthly_half_day 0.5,… | —             |
| `REST_DAY_OVERTIME` | Hours beyond normal hours on a rest day: 2 × the hourly ordinary rate of pay (Employment Act 1955 s.60(3)(c))… | part_time_premium 1.5, rest_day_premium 2                             | —             |
| `HOLIDAY_WORK`      | Work within normal hours on a paid public holiday: two days' wages at the ordinary rate of pay on top of the…  | holiday_work_days 2                                                   | —             |
| `HOLIDAY_OVERTIME`  | Hours beyond normal hours on a paid public holiday: 3 × the hourly ordinary rate of pay (Employment Act 1955…  | holiday_premium 3, part_time_premium 2                                | —             |

Roster warnings (`ROSTER_DAILY_TOTAL`): daily hours 12; daily overtime hours 4; monthly overtime hours 104 on WORK, OFF days; consecutive days 6; weekly rest days 1.

### Allowance, claim, ad hoc, loan, work event and workplace case rows

- **Allowance** (5): `CHILDCARE_ALLOWANCE`, `MEAL_ALLOWANCE`, `ONCALL`, `PARKING_ALLOWANCE`, `SUA`. Of these, 5 count in the wage a day or hour rate divides.
- **Claim** (3): `DENTAL_CLAIM`, `MEDICAL_CLAIM_DIRECT`, `MEDICAL_CLAIM`. Of these, 2 have a yearly limit.
- **Ad hoc** (23): `ACCOMMODATION_RENT`, `ADJ`, `BONUS`, `BPAYBS`, `COMMISSION_IRREGULAR`, `COMMISSION_MONTHLY`, `CP38_INSTALMENT`, `EXCELLENCE_AWARD`, `INCENTIVE_OT`, `LAYOFF_BENEFIT`, `LONG_SERVICE_AWARD`, `NOTICE_INDEMNITY`, `NOTICE_IN_LIEU`, `NO_PAY_ADJUSTMENT`, `NO_PAY_REFUND`, `PAYEE_PAYMENT`, `PIECE_HOLIDAY_OVERTIME`, `PIECE_HOLIDAY_WORK`, `STATUTORY_REFUND`, `TASK_MONTHLY_WAGE`, `TERMINATION_BENEFIT`, `TRAVEL_OFFICIAL`, `ZAKAT`. Of these, 14 may run off-cycle, 1 post to a balance account (statutory corrections) and 0 are employer cost.
- **Loan** (3): `APPROVED_HOUSING_LOAN`, `LOAN_RECOVERY_AIR_TICKET`, `LOAN_RECOVERY_FESTIVE_ADVANCE`.
- **Work event** (1): `EMPLOYER_SHUTDOWN`.
- **Workplace case** (7): `EMPLOYEE_DEATH_NOTICE`, `FLEXIBLE_WORKING_REQUEST`, `NON_BANK_WAGE_PAYMENT_REQUEST`, `OVERSEAS_DEPARTURE_NOTICE`, `PERSONAL_DATA_BREACH`, `SEXUAL_HARASSMENT_COMPLAINT`, `WORKPLACE_ACCIDENT`.

### Registered rules: what a write is refused for

- **`employee_contract`** (13): `CHILD_EMPLOYMENT`, `CHILD_LIGHT_WORK_AGE`, `CONTRACT_CATEGORIES`, `LABOUR_ORDINANCE_TERRITORY`, `MINIMUM_WAGE_DAILY`, `MINIMUM_WAGE_HOURLY_PART_TIME`, `MINIMUM_WAGE_HOURLY`, `MINIMUM_WAGE_MONTHLY`, `MINOR_HAZARDOUS_WORK`, `MINOR_PROHIBITED_EMPLOYMENT`, `NORMAL_HOURS_WEEK`, `SHARED_STRUCTURED_EMPLOYEE_INPUTS`, `WAGE_PAYMENT_METHOD`.
- **`entity_profile_version`** (2): `HRD_LIABILITY_EVENT_DATE_REQUIRED`, `WAGE_PERIOD`.
- **`leave_catalog_entry`** (2): `ANNUAL_LEAVE_SERVICE`, `PATERNITY_QUALIFYING_SERVICE`.
- **`roster_entry`** (2): `ROSTER_CONTINUOUS_HOURS`, `ROSTER_DAILY_TOTAL`.
- **`workplace_case_catalog_entry`** (4): `BUSINESS_CASE_SIGNED_CONSENT`, `BUSINESS_CASE_SUBJECT_AND_REFERENCE`, `DEATH_NOTICE_ACTUAL_RECEIPT`, `DEPARTURE_CASE_ACTUAL_SCHEDULE`.

### Registered effects: the tasks raised

51 effects; every one writes `obligation.create`.

- **`employee_contract`** on create, update (12): `CP22_NEW_EMPLOYEE`, `CP58_AGENT_STATEMENT`, `EPF_EMPLOYEE_REGISTRATION`, `FOREIGN_DOMESTIC_EMPLOYMENT_NOTICE`, `FOREIGN_EMPLOYEE_PARTICULARS`, `FOREIGN_WORKER_LEVY`, `FOREIGN_WORKER_MEDICAL_EXAMINATION`, `PDPA_PRIVACY_NOTICE` and 4 more.
- **`employee_contract`** on exit (10): `CP22A_CESSATION_AND_WITHHOLDING`, `CP58_AGENT_STATEMENT_ON_EXIT`, `FOREIGN_DOMESTIC_TERMINATION_NOTICE`, `FOREIGN_EMPLOYEE_TERMINATION_NOTICE`, `MATERNITY_PROTECTION_REVIEW`, `PERSONAL_DATA_DISPOSAL`, `RETIREMENT_AGE_REVIEW`, `RETRENCHMENT_NOTIFICATION` and 2 more.
- **`entity_profile_version`** on update (8): `EPF_CESSATION_NOTICE`, `EPF_EMPLOYER_REGISTRATION`, `HRD_CESSATION_NOTICE`, `HRD_EMPLOYER_REGISTRATION`, `PDPA_DPO_APPOINTMENT`, `PERKESO_CESSATION_NOTICE`, `SEXUAL_HARASSMENT_NOTICE`, `SOCSO_EIS_EMPLOYER_REGISTRATION`.
- **`payroll_run`** on create (13): `EA_FORM`, `EMPLOYEE_REGISTER`, `EPF_MONTHLY_CONTRIBUTION`, `FORM_E_CP8D`, `HRD_LEVY_MONTHLY`, `OVERTIME_REST_HOLIDAY_WAGES_DEADLINE`, `PAYSLIP_ISSUE`, `PCB_REMITTANCE` and 5 more.
- **`workplace_case_catalog_entry`** on create (3): `PDPA_BREACH_COMMISSIONER_NOTICE`, `SEXUAL_HARASSMENT_INQUIRY`, `SOCSO_ACCIDENT_REPORT`.
- **`workplace_case_catalog_entry`** on create, update (2): `CP21_LEAVING_MALAYSIA`, `FLEXIBLE_WORKING_REPLY`.
- **`workplace_case_catalog_entry`** on update (3): `PDPA_BREACH_DATA_SUBJECT_NOTICE`, `SEXUAL_HARASSMENT_DG_INQUIRY_REPORT`, `SEXUAL_HARASSMENT_FINDING_ACTION`.

### Employer pay methods

- `overtime_hour_basis`: `HOLIDAY_WORK`.
- `rest_day_hourly_multiplier`: `REST_DAY_OVERTIME`, `REST_DAY_WORK`.

## Philippines (PH)

### Law versions

| Version | From       | To         | State  |
| ------- | ---------- | ---------- | ------ |
| 1       | 2025-12-01 | 2026-01-05 | sealed |
| 2       | 2026-01-06 | open       | sealed |

Rows whose values differ from the version before:

- Version 2, from 2026-01-06: statutory `WTAX`; settings `lookup`.

### Conversions and subtotal chain

Currency PHP. Tax year starts in month 1. Day rate `YEAR_REST_DAYS`, hour rate `CONTRACT_HOURS`, proration `DAY_RATE`, rounding `HALF_UP` to 2 places. Year-to-date totals restart per `JURISDICTION`.

Chain: `BASIC` → `PRORATED` → `PAID_BASIC` → `BASIC_AFTER_UNPAID_LEAVE` → `STATUTORY_WAGES` → `DE_MINIMIS_RICE` → `DE_MINIMIS_LAUNDRY` → `DE_MINIMIS_DEPENDANT_MEDICAL` → `ORDINARY_WAGES` → `ADDITIONAL_WAGES` → `DE_MINIMIS_UNIFORM` → `DE_MINIMIS_MEDICAL` → `DE_MINIMIS_AWARD` → `DE_MINIMIS_GIFT` → `DE_MINIMIS_CBA` → `DE_MINIMIS_OT_MEAL` → `DE_MINIMIS_LEAVE` → `TAXABLE_TERMINATION` → `GROSS` → `FRINGE_BENEFIT` → `UNION_DUES` → `NET`.

### Contributions and taxes

| Code               | Kind         | What it is                                                                                           | Employee | Employer | Below zero | First reference on the row                                                                          | Value changed |
| ------------------ | ------------ | ---------------------------------------------------------------------------------------------------- | -------- | -------- | ---------- | --------------------------------------------------------------------------------------------------- | ------------- |
| `SSS`              | contribution | Social Security System contribution on the monthly salary credit (the month's pay rounded to the ne… | yes      | yes      | refund     | Republic Act 11199 (Social Security Act of 2018), ss.4(a)(9), 8(i), 9(a), 11, 12-B(a), 18 (+5 more) | —             |
| `SSS_MPF`          | contribution | SSS Mandatory Provident Fund: the SSS rates, employee 5% and employer 10%, on the part of the month… | yes      | yes      | refund     | Republic Act 11199 (Social Security Act of 2018), s.4(a)(2) (+5 more)                               | —             |
| `SSS_EC`           | contribution | Employees' Compensation contribution, paid by the employer only: ₱10 a month where the salary credi… | no       | yes      | stops      | Presidential Decree 626 (Employees Compensation) as amended (+6 more)                               | —             |
| `PHIC`             | contribution | PhilHealth premium: 5% of the monthly basic salary, between ₱10,000 and ₱100,000, shared equally by… | yes      | yes      | stops      | Republic Act 11223 (Universal Health Care Act), section 10 (+5 more)                                | —             |
| `HDMF`             | contribution | Pag-IBIG Fund contribution on the month's pay up to ₱10,000: the employee pays 2% (1% on pay of ₱1,… | yes      | yes      | refund     | Republic Act 9679, ss.6-7 (+5 more)                                                                 | —             |
| `WTAX_TAXABLE_PAY` | tax          | A record of the run's taxable regular pay, kept so that a later run in the same month taxes its pay… | no       | yes      | stops      | RR 11-2018 s.2.79(B)(3): supplementary pay is taxed with th…                                        | —             |
| `WTAX`             | tax          | Income tax withheld on compensation: the withholding table for the pay period applied to taxable pa… | yes      | no       | refund     | Read 2026-10-31: rice and laundry ceilings apply independen… (+10 more)                             | 2026-01-06    |
| `FBT`              | tax          | Fringe benefit tax on benefits given to managerial and supervisory employees, paid by the employer:… | no       | yes      | stops      | National Internal Revenue Code (as amended by RA 10963), section 33 (+1 more)                       | —             |

### Leave

| Code                         | Entitlement                                                                               | A day taken        | Value changed |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------ | ------------- |
| `ANNUAL_LEAVE`               | 5 days; own statutory test; service year, accrues and never lapses                        | full pay, cashable | —             |
| `ANNUAL_LEAVE_DOMESTIC`      | 5 days; service year                                                                      | full pay           | —             |
| `COMPASSIONATE_LEAVE`        | no limit                                                                                  | paid share 0       | —             |
| `EMERGENCY_LEAVE`            | no limit                                                                                  | paid share 0       | —             |
| `HOSPITALIZATION_LEAVE`      | no limit                                                                                  | paid share 0       | —             |
| `MATERNITY_ALLOCATION_LEAVE` | 7 days; own statutory test; opened by `MATERNITY_ALLOCATION`; per event                   | full pay           | —             |
| `MATERNITY_LEAVE`            | 105 days; own statutory test; opened by `CHILD_BIRTH`, `PREGNANCY_TERMINATION`; per event | paid share 0       | —             |
| `MATERNITY_LEAVE_EXTENSION`  | 30 days; opened by `BIRTH_EXTENSION`; per event                                           | paid share 0       | —             |
| `MEDICAL_LEAVE`              | no limit                                                                                  | paid share 0       | —             |
| `NPL`                        | no limit                                                                                  | paid share 0       | —             |
| `PATERNITY_LEAVE`            | 7 days; own statutory test; opened by `CHILD_BIRTH`, `PREGNANCY_TERMINATION`; per event   | full pay           | —             |
| `PUBLIC_HOLIDAY_IN_LIEU`     | none by default; HR grants each day; calendar year                                        | full pay           | —             |
| `SOLO_PARENT_LEAVE`          | 7 days; own statutory test; calendar year                                                 | full pay           | —             |
| `SPECIAL_LEAVE_FOR_WOMEN`    | 60 days; opened by `GYNECOLOGICAL_SURGERY`; per event                                     | full pay           | —             |
| `VAWC_LEAVE`                 | 10 days; opened by `VAWC`; per event                                                      | full pay           | —             |

### Overtime, rest-day and holiday work

| Code                       | What it pays                                                                                                   | Numbers on the row | Value changed |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------ | ------------- |
| `OVERTIME`                 | Hours beyond the contract's normal daily hours, at the hour rate × 125% on an ordinary day, 169% on a rest or… | —                  | —             |
| `REST_DAY_WORK`            | Hours worked on a scheduled rest day that is not a holiday, up to the normal daily hours, at 130% of the hour… | —                  | —             |
| `OFF_DAY_WORK`             | Hours worked on the second non-working day of a five-day week, up to the normal daily hours, at 100% of the h… | —                  | —             |
| `HOLIDAY_WORK`             | Hours worked on a regular holiday, up to the normal daily hours, at 200% of the hour rate (260% on the rest d… | —                  | —             |
| `SPECIAL_HOLIDAY_WORK`     | Hours worked on a special non-working day, up to the normal daily hours, at 130% of the hour rate (150% on th… | —                  | —             |
| `NIGHT_SHIFT_DIFFERENTIAL` | 10% of the hour's own rate for each hour worked between 10 p.m. and 6 a.m.: the day's multiple, or the overti… | multiplier 0.1     | —             |
| `DOUBLE_HOLIDAY_UNWORKED`  | One more day's pay (100% of the day rate) for an unworked double regular holiday; a daily-paid employee on un… | —                  | —             |
| `DAILY_HOLIDAY_PAY`        | One day's pay (100% of the day rate) for each unworked regular holiday, for a daily-paid employee not on unpa… | —                  | —             |

Roster warnings (`ROSTER_WARNINGS`): daily hours 12; consecutive days 6; weekly rest days 1.

### Allowance, claim, ad hoc, loan, work event and workplace case rows

- **Allowance** (10): `DEPENDANT_MEDICAL_ALLOWANCE`, `LAUNDRY_ALLOWANCE`, `allowance`, `communication`, `corporate_duty_allowance`, `duty_allowance`, `leader`, `meal`, `position`, `transport`. Of these, 0 count in the wage a day or hour rate divides.
- **Claim** (2): `DENTAL_CLAIM`, `MEDICAL_CLAIM`. Of these, 0 have a yearly limit.
- **Ad hoc** (40): `ACHIEVEMENT_AWARD`, `BACKPAY_ADD_WAGES`, `BACKPAY_BASIC`, `BACKPAY_DUTY_ALLOWANCE`, `CBA_PRODUCTIVITY`, `CHRISTMAS_BONUS`, `CHRISTMAS_GIFT`, `COMMISSION`, `FRINGE_BENEFIT`, `HAZARD_PAY`, `HDMF_MP2`, `HDMF_VOLUNTARY`, `KASAMBAHAY_FORFEITURE`, `KASAMBAHAY_INDEMNITY`, `LOSS_DAMAGE_DEDUCTION`, `MATERNITY_SALARY_DIFFERENTIAL`, `MEDICAL_ASSISTANCE`, `OT_MEAL_ALLOWANCE`, `PHIC_ADJUSTMENT`, `PHIC_EMPLOYER_ADJUSTMENT`, `PHIC_EMPLOYER_REFUND`, `PHIC_REFUND`, `PREMIUM_PAY`, `PROTECTION_ORDER_SUPPORT`, `RETIREMENT_PAY_QUALIFIED_PLAN`, `RETIREMENT_PAY_TAXABLE`, `RETIREMENT_PAY`, `SEPARATION_PAY_TAXABLE`, `SEPARATION_PAY`, `SERVICE_CHARGE_SHARE`, `SSS_ADJUSTMENT`, `SSS_EMPLOYER_ADJUSTMENT`, `SSS_MATERNITY_BENEFIT`, `SSS_SICKNESS_BENEFIT`, `STATUTORY_ADJUSTMENT`, `STATUTORY_REFUND`, `THIRTEENTH_MONTH_PAY`, `UNIFORM_ALLOWANCE`, `UNION_DUES`, `bonus`. Of these, 22 may run off-cycle, 6 post to a balance account (statutory corrections) and 4 are employer cost.
- **Loan** (4): `LOAN_RECOVERY_COMPANY`, `LOAN_RECOVERY_PAGIBIG_CALAMITY`, `LOAN_RECOVERY_PAGIBIG_SALARY`, `LOAN_RECOVERY_SSS_SALARY`.
- **Work event** (5): `BONA_FIDE_SUSPENSION`, `FORCE_MAJEURE`, `LOCKOUT`, `STRIKE`, `WORK_STOPPAGE_ORDER`.
- **Workplace case** (13): `BENEFIT_SERVICE_RECORD`, `BIR_2316_DELIVERED`, `CROSS_BORDER_WORK_RECORD`, `DANGEROUS_OCCURRENCE`, `EMPLOYMENT_CERTIFICATE_REQUEST`, `EXTERNAL_WAGE_RECORD`, `FINAL_COMPENSATION_PAYMENT`, `FLEXIBLE_WORK_ARRANGEMENT`, `PERSONAL_DATA_BREACH`, `SOLO_PARENT_FLEXIBLE_SCHEDULE`, `SUSPENSION_EXTENSION`, `TELECOMMUTING_PROGRAM`, `WORK_ACCIDENT`.

### Registered rules: what a write is refused for

- **`employee_contract`** (6): `CONTRACT_CATEGORIES`, `EBET_PROGRAM_RECORDED`, `MINIMUM_WAGE_FLOOR`, `PROBATION_PAST_SIX_MONTHS`, `SHARED_FINAL_PAY_DEADLINE`, `WAGE_PAYMENT_PLACE`.
- **`entity_profile_version`** (1): `NPC_REGISTRATION_SCOPE_REVIEW_REQUIRED`.
- **`roster_entry`** (1): `ROSTER_WARNINGS`.
- **`workplace_case_catalog_entry`** (2): `BUSINESS_CASE_DOCUMENT_REQUIRED`, `BUSINESS_CASE_SUBJECT_AND_REFERENCE`.

### Registered effects: the tasks raised

53 effects; every one writes `obligation.create`.

- **`employee_contract`** on create, seal (10): `ALIEN_EMPLOYMENT_PERMIT`, `BIR_EMPLOYEE_TIN_REGISTRATION`, `CAREGIVER_CONTRACT`, `COMPULSORY_RETIREMENT_AGE`, `HDMF_EMPLOYEE_REGISTRATION`, `KASAMBAHAY_CONTRACT_AND_REGISTRY`, `PHILHEALTH_EMPLOYEE_REPORT`, `PROBATIONARY_STANDARDS` and 2 more.
- **`employee_contract`** on exit (8): `AUTHORISED_CAUSE_TERMINATION_NOTICE`, `FINAL_PAY_RELEASE`, `HDMF_SEPARATION_REPORT`, `JUST_CAUSE_TWIN_NOTICE`, `KASAMBAHAY_TERMINATION_NOTICE`, `PERSONAL_DATA_DISPOSAL`, `PHILHEALTH_SEPARATION_REPORT`, `raise-exit-pay`.
- **`entity_profile_version`** on create, seal (7): `BIR_WITHHOLDING_AGENT_REGISTRATION`, `DOLE_ESTABLISHMENT_REGISTRATION`, `DPO_DESIGNATION`, `HDMF_EMPLOYER_REGISTRATION`, `NPC_REGISTRATION`, `PHILHEALTH_EMPLOYER_REGISTRATION`, `SSS_EMPLOYER_REGISTRATION`.
- **`entity_profile_version`** on create, update (1): `NPC_REGISTRATION_RENEWAL`.
- **`payroll_run`** on create (16): `ANNUAL_ESTABLISHMENT_REPORT_ON_WAGES`, `BIR_1601C_MONTHLY_REMITTANCE`, `BIR_1603Q_FRINGE_BENEFITS`, `BIR_1604C_ANNUAL_ALPHALIST`, `BIR_2316_CERTIFICATE`, `BIR_2316_SUBSTITUTED_FILING_LIST`, `BIR_YEAR_END_ADJUSTMENT`, `DOLE_ANNUAL_EXPOSURE_DATA_REPORT` and 8 more.
- **`workplace_case_catalog_entry`** on create (11): `BIR_2316_LEAVER_CERTIFICATE`, `CERTIFICATE_OF_EMPLOYMENT`, `DOLE_DANGEROUS_OCCURRENCE_REPORT`, `DOLE_FLEXIBLE_WORK_ARRANGEMENT_NOTICE`, `DOLE_SERIOUS_ACCIDENT_NOTICE`, `DOLE_SUSPENSION_EXTENSION_REPORT`, `DOLE_TELECOMMUTING_NOTICE`, `DOLE_WORK_ACCIDENT_REPORT` and 3 more.

### Employer pay methods

- `overtime_hour_basis`: `HOLIDAY_WORK`, `NIGHT_SHIFT_DIFFERENTIAL`, `OFF_DAY_WORK`, `OVERTIME`, `REST_DAY_WORK`, `SPECIAL_HOLIDAY_WORK`.
- `rest_day_hourly_multiplier`: `OVERTIME`, `REST_DAY_WORK`.
- `night_differential_basis`: `NIGHT_SHIFT_DIFFERENTIAL`.
- `contribution_split`: `HDMF`, `PHIC`, `SSS_EC`, `SSS_MPF`, `SSS`.
- `benefit_exclusion`: `WTAX`.

## Singapore (SG)

### Law versions

| Version | From       | To         | State  |
| ------- | ---------- | ---------- | ------ |
| 1       | 2025-12-01 | 2025-12-31 | sealed |
| 2       | 2026-01-01 | 2026-06-30 | sealed |
| 3       | 2026-07-01 | 2026-08-31 | sealed |
| 4       | 2026-09-01 | 2026-12-31 | sealed |
| 5       | 2027-01-01 | 2027-06-30 | sealed |
| 6       | 2027-07-01 | 2027-08-31 | sealed |
| 7       | 2027-09-01 | 2027-12-31 | sealed |
| 8       | 2028-01-01 | 2028-06-30 | sealed |
| 9       | 2028-07-01 | open       | sealed |

Rows whose values differ from the version before:

- Version 2, from 2026-01-01: leave `SHARED_PARENTAL_LEAVE`; settings `lookup`.
- Version 3, from 2026-07-01: effects `LQS_WAGE_FLOOR`, `REEMPLOYMENT_OFFER`; settings `lookup`.
- Version 4, from 2026-09-01: settings `lookup`.
- Version 5, from 2027-01-01: settings `lookup`.
- Version 6, from 2027-07-01: settings `lookup`.
- Version 7, from 2027-09-01: settings `lookup`.
- Version 8, from 2028-01-01: settings `lookup`.
- Version 9, from 2028-07-01: settings `lookup`.

### Conversions and subtotal chain

Currency SGD. Tax year starts in month 1. Day rate `YEAR`, hour rate `CONTRACT_HOURS`, proration `WORKING_DAYS`, rounding `HALF_UP` to 2 places. Year-to-date totals restart per `JURISDICTION`.

Chain: `BASIC` → `PRORATED` → `PAID_BASIC` → `ORDINARY_WAGES` → `ADDITIONAL_WAGES` → `GROSS` → `DIRECTOR_FEES` → `ENTERTAINER_FEES` → `NET`.

### Contributions and taxes

| Code                 | Kind         | What it is                                                                                           | Employee | Employer | Below zero | First reference on the row                                                         | Value changed |
| -------------------- | ------------ | ---------------------------------------------------------------------------------------------------- | -------- | -------- | ---------- | ---------------------------------------------------------------------------------- | ------------- |
| `CPF_AW`             | tax          | A record of the additional wages (bonuses and other irregular pay) that attracted CPF, kept for the… | no       | yes      | stops      | CPF Board: Additional Wage ceiling; estimate the year's Ord…                       | —             |
| `CPF`                | contribution | Central Provident Fund contribution for citizens and permanent residents, by age band and years of…  | yes      | yes      | stops      | CPF Board, What are the changes to the CPF contribution rat…, rate table (+2 more) | —             |
| `CDAC`               | contribution | Monthly contribution to the Chinese Development Assistance Council fund, deducted from the employee… | yes      | no       | stops      | CDAC Rules 1992 r.2; CPF Board, Contributions to self-help…, r.2 (+1 more)         | —             |
| `ECF`                | contribution | Monthly contribution to the Eurasian Community Fund, deducted from the employee by the band of the…  | yes      | no       | stops      | CPF (Contributions to Community Fund — Eurasian Association…, r.2 (+1 more)        | —             |
| `MBMF`               | contribution | Monthly contribution to the Mosque Building and Mendaki Fund, deducted from the employee by the ban… | yes      | no       | stops      | Mosque Building and Mendaki Fund Rules; CPF Board, Contribu…, MBMF (+1 more)       | —             |
| `SINDA`              | contribution | Monthly contribution to the Singapore Indian Development Association fund, deducted from the employ… | yes      | no       | stops      | SINDA Fund Rules; CPF Act 1953 s.76(3); CPF Board, Contribu…, s.76(3) (+1 more)    | —             |
| `SDL`                | contribution | Skills Development Levy, paid by the employer only: 0.25% of the month's total wages, at least $2 a… | no       | yes      | stops      | Skills Development Levy Act 1979 ss.2–4 — 0.25% of wages, m…, ss.2–4               | —             |
| `WHT_NR_DIRECTOR`    | tax          | Withholding tax of 24% on director's fees paid to a non-resident director (Income Tax Act 1947 s.45… | yes      | no       | stops      | Income Tax Act 1947 s.45; IRAS — 24% withholding on directo…, s.45                 | —             |
| `WHT_NR_ENTERTAINER` | tax          | Withholding tax of 15% on the gross income of a non-resident public entertainer (Income Tax Act 194… | yes      | no       | stops      | Income Tax Act 1947 s.45; IRAS — 15% withholding on the gro…, s.45                 | —             |

### Leave

| Code                                | Entitlement                                                                          | A day taken                  | Value changed |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------- | ------------- |
| `ADOPTION_LEAVE`                    | 84 days; opened by `ADOPTION`; per event                                             | full pay                     | —             |
| `ANNUAL_LEAVE`                      | 8–14 days by length of service; service year; carries one window                     | full pay, cashable           | —             |
| `ANNUAL_LEAVE_PART_TIME`            | 8–14 days by length of service; own statutory test; service year; carries one window | full pay, cashable           | —             |
| `CHILDCARE_LEAVE`                   | 2–6 days by length of service; own statutory test; calendar year                     | full pay                     | —             |
| `HOSPITALIZATION_LEAVE`             | 15–60 days by length of service; calendar year                                       | full pay                     | —             |
| `HOSPITALIZATION_LEAVE_PART_TIME`   | 15–60 days by length of service; own statutory test; calendar year                   | full pay                     | —             |
| `MATERNITY_LEAVE`                   | 112 days; opened by `CHILD_BIRTH`; per event                                         | full pay                     | —             |
| `NPL`                               | no limit                                                                             | paid share 0                 | —             |
| `NS_LEAVE`                          | no limit                                                                             | paid share 0                 | —             |
| `PATERNITY_LEAVE`                   | 28 days; opened by `CHILD_BIRTH`; per event                                          | full pay                     | —             |
| `PUBLIC_HOLIDAY_IN_LIEU`            | none by default; HR grants each day; one window for the whole employment             | full pay                     | —             |
| `SHARED_PARENTAL_LEAVE`             | 70 days; own statutory test; opened by `CHILD_BIRTH`; per event                      | full pay                     | 2026-01-01    |
| `SICK_LEAVE`                        | 5–14 days by length of service; calendar year                                        | full pay                     | —             |
| `SICK_LEAVE_PART_TIME`              | 5–14 days by length of service; own statutory test; calendar year                    | full pay                     | —             |
| `UNPAID_INFANT_CARE_LEAVE`          | no limit                                                                             | paid share 0                 | —             |
| `WORK_INJURY_HOSPITALISATION_LEAVE` | opened by `WORK_ACCIDENT`                                                            | paid share by the row’s rule | —             |
| `WORK_INJURY_MEDICAL_LEAVE`         | opened by `WORK_ACCIDENT`                                                            | paid share by the row’s rule | —             |

### Overtime, rest-day and holiday work

| Code                             | What it pays                                                                                                   | Numbers on the row                                                     | Value changed |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------- |
| `OVERTIME`                       | Overtime on a working day, and rest-day hours past the normal day: 1.5 × the hourly basic rate (12 × monthly…  | full_time_weekly_hours 44, manual_monthly_ceiling 4500, multiplier 1.… | —             |
| `PART_TIME_EXTRA_HOURS`          | Part-time hours past the agreed day and up to the comparable full-timer’s day, at 1 × the hourly basic rate (… | multiplier 1                                                           | —             |
| `PART_TIME_OVERTIME`             | Part-time hours past the comparable full-timer’s day, at 1.5 × the hourly basic rate (PT Regulations).         | multiplier 1.5                                                         | —             |
| `REST_DAY_WORK`                  | Work on a rest day, paid at the employer-request rate: one day’s basic pay for up to half the normal hours, t… | employer_request_days_above_half 2, employer_request_days_up_to_half…  | —             |
| `PART_TIME_REST_DAY_EXTRA_HOURS` | Part-time hours past the agreed day and up to the comparable full-timer’s day, at 1 × the hourly basic rate o… | multiplier 1                                                           | —             |
| `PART_TIME_REST_DAY_OVERTIME`    | Part-time hours past the comparable full-timer’s day on a rest day, at 1.5 × the hourly basic rate (PT Regula… | multiplier 1.5                                                         | —             |
| `HOLIDAY_WORK`                   | A public holiday worked: one extra day’s basic pay for each holiday worked, on top of the salary (EA s.88(4)). | holiday_work_days 1                                                    | —             |

Roster warnings (`ROSTER_DAILY_12_HOURS`): daily hours 12; daily overtime hours 3; monthly overtime hours 72; consecutive days 6; weekly rest days 1.

### Allowance, claim, ad hoc, loan, work event and workplace case rows

- **Allowance** (3): `FIXED_MONTHLY`, `PT_ANNUAL_HOURLY_AW`, `PT_ANNUAL_HOURLY_OW`. Of these, 0 count in the wage a day or hour rate divides.
- **Claim** (3): `MEDICAL_CONSULTATION_FEE`, `MEDICAL_TREATMENT_REIMBURSEMENT`, `PER_DIEM_OFFICIAL_REIMBURSEMENT`. Of these, 0 have a yearly limit.
- **Ad hoc** (19): `ACCOMMODATION_RECOVERY`, `ADDITIONAL_BACKPAY`, `AMENITIES_RECOVERY`, `APPROVED_DAMAGE_RECOVERY`, `CONSENT_EMPLOYEE_BENEFIT`, `COOPERATIVE_DUES`, `CPF_MISSED_SHARE_RECOVERY`, `DAMAGE_RECOVERY`, `DIRECTOR_GENERAL_MEETING_FEE`, `EMPLOYMENT_ASSISTANCE_PAYMENT`, `FOOD_ABSENCE_COST`, `NOTICE_BREACH_COMPENSATION_RECOVERY`, `NR_PUBLIC_ENTERTAINER_FEE`, `ORDINARY_BACKPAY`, `PRIOR_WAGE_CASH_REPAYMENT`, `RETRENCHMENT_BENEFIT`, `SALARY_IN_LIEU_OF_NOTICE`, `STATUTORY_REFUND`, `bonus`. Of these, 9 may run off-cycle, 0 post to a balance account (statutory corrections) and 0 are employer cost.
- **Loan** (5): `FESTIVE_ADVANCE`, `SALARY_ADVANCE`, `SALARY_OVERPAYMENT`, `TRAVEL_ADVANCE`, `UNEARNED_BENEFIT_RECOVERY`.
- **Work event** (5): `EMPLOYER_SHUTDOWN`, `GOVERNMENT_ORDER`, `LOCKOUT`, `NATURAL_DISASTER`, `STRIKE`.
- **Workplace case** (21): `BENEFIT_SERVICE_RECORD`, `CROSS_BORDER_WORK_RECORD`, `DANGEROUS_OCCURRENCE`, `DATA_BREACH`, `EMPLOYMENT_CONTRACT_BREACH_DISPUTE`, `EXTERNAL_WAGE_RECORD`, `FLEXIBLE_WORK_REQUEST`, `NOTICE_PAY_DISPUTE`, `NOTICE_PERIOD_EXTENSION_AGREEMENT`, `OCCUPATIONAL_DISEASE_DIAGNOSIS`, `OVERSEAS_DEPARTURE_NOTICE`, `PERSONAL_DATA_ACCESS_REQUEST`, `PERSONAL_DATA_CORRECTION_REQUEST`, `PUBLIC_WORKPLACE_FATALITY`, `PUBLIC_WORKPLACE_HOSPITAL_TREATMENT`, `REEMPLOYMENT_OBLIGATION_TRANSFER_AGREEMENT`, `RETRENCHMENT_EMPLOYEE_NOTICE`, `WORK_ACCIDENT_FATAL`, `WORK_ACCIDENT_LIGHT_DUTY`, `WORK_ACCIDENT_SUBSEQUENT_DEATH`, `YOUNG_PERSON_REST_DAY_PERMISSION`.

### Registered rules: what a write is refused for

- **`employee_contract`** (3): `CONTRACT_CATEGORIES`, `RESIDENCY_SINCE_REQUIRED`, `SHARED_STRUCTURED_EMPLOYEE_INPUTS`.
- **`entity_profile_version`** (1): `SHARED_STRUCTURED_ENTITY_INPUTS`.
- **`leave_catalog_entry`** (1): `SICK_WITHIN_HOSPITALISATION`.
- **`roster_entry`** (6): `ROSTER_CONSECUTIVE_HOURS`, `ROSTER_DAILY_12_HOURS`, `ROSTER_YOUNG_BREAK`, `ROSTER_YOUNG_DAILY_HOURS`, `ROSTER_YOUNG_NIGHT_WORK`, `ROSTER_YOUNG_REST_DAY`.
- **`workplace_case_catalog_entry`** (3): `BUSINESS_CASE_DOCUMENT_REQUIRED`, `BUSINESS_CASE_SUBJECT_AND_REFERENCE`, `DEPARTURE_CASE_ACTUAL_SCHEDULE`.

### Registered effects: the tasks raised

65 effects; every one writes `obligation.create`.

- **`adhoc_catalog_entry`** on create (1): `CPF_CONDITIONAL_WAGE_REFUND`.
- **`employee_contract`** on create, update (7): `KEY_EMPLOYMENT_TERMS`, `PDPA_CONSENT_PURPOSE_NOTIFICATION`, `WORK_INJURY_COMPENSATION_INSURANCE`, `WORK_PASS_IN_FORCE`, `WORK_PASS_MEDICAL_INSURANCE`, `WORK_PERMIT_SECURITY_BOND`, `YOUNG_PERSON_NOTIFICATION`.
- **`employee_contract`** on exit (5): `FINAL_SALARY_PAYMENT`, `MISCONDUCT_DUE_INQUIRY`, `PDPA_RETENTION_DISPOSAL`, `TAX_CLEARANCE_AND_WITHHOLDING`, `WORK_PASS_CANCELLATION`.
- **`entity_profile_version`** on update (1): `PDPA_DATA_PROTECTION_OFFICER`.
- **`leave_catalog_entry`** on create (3): `GOVERNMENT_PAID_LEAVE_CLAIM`, `NS_MAKE_UP_PAY_CLAIM`, `WORK_ACCIDENT_REPORT`.
- **`payroll_run`** on create (12): `ANNUAL_EMPLOYMENT_INCOME_RETURN`, `CHILDCARE_LEAVE_CLAIM`, `CPF_MONTHLY_SUBMISSION_AND_PAYMENT`, `CPF_SUBMISSION_NUMBER`, `FOREIGN_WORKER_LEVY`, `LQS_WAGE_FLOOR`, `NR_DIRECTOR_WITHHOLDING`, `NR_ENTERTAINER_WITHHOLDING` and 4 more.
- **`payroll_run`** on update (2): `CPF_AW_YEAR_END_RECALCULATION`, `ITEMISED_PAYSLIP`.
- **`payslip`** on create (24): `ACCOMMODATION_DEDUCTION_LIMIT`, `DAILY_HOURS_LIMIT`, `DAILY_RATE_WORKING_WEEK_MISSING`, `DAMAGE_DEDUCTION_LIMIT`, `DEDUCTION_LIMIT`, `INSTALMENT_LIMIT`, `IR21_ADDITIONAL_PAYMENT_HOLD`, `IR21_DEPARTURE_PAY_HOLD` and 16 more.
- **`workplace_case_catalog_entry`** on create (7): `FLEXIBLE_WORK_REQUEST_DECISION`, `OCCUPATIONAL_DISEASE_REPORT`, `PDPA_ACCESS_CORRECTION_REPLY`, `PDPA_BREACH_ASSESSMENT`, `SUBSEQUENT_WORK_DEATH_NOTIFICATION`, `WORK_INCIDENT_CASE_REPORT`, `WORK_INCIDENT_NOTIFICATION`.
- **`workplace_case_catalog_entry`** on create, update (3): `IR21_LEAVING_SINGAPORE`, `PDPA_BREACH_NOTIFICATION`, `RETRENCHMENT_NOTIFICATION`.

### Employer pay methods

- `overtime_hour_basis`: `OVERTIME`.
- `rest_day_hourly_multiplier`: `OVERTIME`, `PART_TIME_EXTRA_HOURS`, `PART_TIME_OVERTIME`, `PART_TIME_REST_DAY_EXTRA_HOURS`, `PART_TIME_REST_DAY_OVERTIME`, `REST_DAY_WORK`.

## Thailand (TH)

### Law versions

| Version | From       | To         | State  |
| ------- | ---------- | ---------- | ------ |
| 1       | 2025-12-01 | 2025-12-06 | sealed |
| 2       | 2025-12-07 | 2025-12-31 | sealed |
| 3       | 2026-01-01 | 2026-12-31 | sealed |
| 4       | 2027-01-01 | open       | sealed |

Rows whose values differ from the version before:

- Version 2, from 2025-12-07: statutory `PND1`; leave `CHILD_CARE_LEAVE`, `MATERNITY_LEAVE`, `PATERNITY_LEAVE`.
- Version 3, from 2026-01-01: statutory `SSO`.
- Version 4, from 2027-01-01: statutory `EWF`; workplace case `EQUIVALENT_WELFARE_BENEFICIARY_REQUEST`, `EQUIVALENT_WELFARE_EMPLOYMENT_END`, `EQUIVALENT_WELFARE_FIRST_WITHHOLDING`, `EQUIVALENT_WELFARE_INSPECTION_REQUEST`, `EQUIVALENT_WELFARE_SETUP`; effects `EWF_REMITTANCE`, `EWF_WELFARE_ACCOUNT_DISCLOSURE`, `EWF_WELFARE_ACCOUNT_INSPECTION`, `EWF_WELFARE_ACCOUNT_RETURN`, `EWF_WELFARE_BENEFICIARY_WITHDRAWAL` and 1 more.

### Conversions and subtotal chain

Currency THB. Tax year starts in month 1. Day rate `FIXED ÷ 30`, hour rate `CONTRACT_HOURS`, proration `DAY_RATE`, rounding `HALF_UP` to 2 places. Year-to-date totals restart per `EMPLOYER`.

Chain: `BASIC` → `PRORATED` → `PAID_BASIC` → `ORDINARY_WAGES` → `ADDITIONAL_WAGES` → `GROSS` → `NOTICE_PAY` → `SEVERANCE` → `FINAL_PAY` → `NET`.

### Contributions and taxes

| Code             | Kind         | What it is                                                                                           | Employee | Employer | Below zero | First reference on the row                                                   | Value changed  |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------------------- | -------- | -------- | ---------- | ---------------------------------------------------------------------------- | -------------- |
| `SSO`            | contribution | Social security contribution: 5% each from the employee and the employer on the month's wage, count… | yes      | yes      | stops      | Social Security Act B.E. 2533 (1990) ss.33, 46, 47; Ministe… (+1 more)       | 2026-01-01     |
| `WCF`            | contribution | Workmen's Compensation Fund contribution, paid by the employer only: the rate for the company's bus… | no       | yes      | stops      | Workmen's Compensation Act B.E. 2537 (1994) ss.5, 44-45; Mi…                 | —              |
| `PVD`            | contribution | Provident fund contribution at the rates in the company's registered fund rules: 2% to 15% of wages… | yes      | yes      | stops      | Provident Fund Act B.E. 2530 (1987) s.10 (as amended by Act…, s.10 (+1 more) | —              |
| `PND1`           | tax          | Income tax withheld from pay: the year's regular pay is projected, expenses (50%, up to 100,000 bah… | yes      | no       | stops      | Revenue Code ss.40(1), 42 bis, 47, 48, 50(1); Revenue Depar… (+5 more)       | 2025-12-07     |
| `PND1_SEVERANCE` | tax          | Income tax on a lump sum paid on leaving after at least five years of service, taxed apart from oth… | yes      | no       | stops      | Revenue Code s.48(5), s.48(5) (+2 more)                                      | —              |
| `EWF`            | contribution | Employee Welfare Fund contribution: 0.25% of the month’s ordinary wages each from the employee and…  | yes      | yes      | stops      | Labour Protection Act B.E. 2541 (1998) ss.126-131; Minister… (+2 more)       | new 2027-01-01 |

### Leave

| Code                          | Entitlement                                            | A day taken        | Value changed  |
| ----------------------------- | ------------------------------------------------------ | ------------------ | -------------- |
| `ANNUAL_LEAVE`                | 6 days; service year                                   | full pay, cashable | —              |
| `CHILD_CARE_LEAVE`            | 15 days; opened by `CHILD_BIRTH`; per event            | paid share 0.5     | new 2025-12-07 |
| `MATERNITY_LEAVE`             | 60 days; opened by `CHILD_BIRTH`; per event            | full pay           | 2025-12-07     |
| `MATERNITY_LEAVE_SSO`         | no limit                                               | paid share 0       | —              |
| `MILITARY_LEAVE`              | 60 days; calendar year                                 | full pay           | —              |
| `NPL`                         | no limit                                               | paid share 0       | —              |
| `PATERNITY_LEAVE`             | 15 days; opened by `CHILD_BIRTH`; per event            | full pay           | new 2025-12-07 |
| `PERSONAL_BUSINESS_LEAVE`     | 3 days; calendar year                                  | full pay           | —              |
| `PUBLIC_HOLIDAY_IN_LIEU`      | none by default; HR grants each day; calendar year     | full pay           | —              |
| `SICK_LEAVE`                  | 30 days; calendar year                                 | full pay           | —              |
| `SICK_LEAVE_UNPAID`           | no limit                                               | paid share 0       | —              |
| `STERILISATION_LEAVE`         | no limit                                               | full pay           | —              |
| `SUSPENSION`                  | 7 days; opened by `DISCIPLINARY_SUSPENSION`; per event | paid share 0.5     | —              |
| `TRAINING_LEAVE`              | no limit                                               | paid share 0       | —              |
| `WORK_INJURY_LEAVE`           | no limit                                               | paid share 0       | —              |
| `YOUNG_WORKER_TRAINING_LEAVE` | 30 days; calendar year                                 | full pay           | —              |

### Overtime, rest-day and holiday work

| Code               | What it pays                                                                           | Numbers on the row | Value changed |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------ | ------------- |
| `OVERTIME`         | Normal working-day overtime hours, paid at the statutory multiplier.                   | multiplier 1.5     | —             |
| `HOLIDAY_WORK`     | Hours worked on a statutory holiday, paid at the statutory holiday multiplier.         | —                  | —             |
| `HOLIDAY_OVERTIME` | Overtime hours worked on a statutory holiday, paid at the holiday-overtime multiplier. | multiplier 3       | —             |

Roster warnings (`NORMAL_HOURS`): daily hours 12; daily overtime hours 4; monthly overtime hours 156; consecutive days 6; weekly rest days 1.

### Allowance, claim, ad hoc, loan, work event and workplace case rows

- **Allowance** (2): `BENEFIT_IN_KIND`, `FIXED_ALLOWANCE`. Of these, 2 count in the wage a day or hour rate divides.
- **Claim** (1): `TRAVEL_REIMBURSEMENT`. Of these, 0 have a yearly limit.
- **Ad hoc** (13): `BONUS`, `HOLIDAY_NOT_GRANTED`, `LATE_PAYMENT_INTEREST`, `MINIMUM_WAGE_ARREARS`, `PAY_IN_LIEU_OF_NOTICE`, `RELOCATION_NOTICE_IN_LIEU`, `SECURITY_DEPOSIT`, `SEVERANCE_PAY`, `SPECIAL_SEVERANCE_RELOCATION`, `SPECIAL_SEVERANCE_TECHNOLOGY`, `STATUTORY_REFUND`, `SUSPENSION_BACK_PAY`, `TECHNOLOGY_NOTICE_IN_LIEU`. Of these, 12 may run off-cycle, 0 post to a balance account (statutory corrections) and 0 are employer cost.
- **Loan** (1): `WELFARE_LOAN`.
- **Work event** (2): `FORCE_MAJEURE`, `TEMPORARY_CESSATION`.
- **Workplace case** (14): `DEDUCTION_LIMIT_CONSENT`, `EQUIVALENT_WELFARE_BENEFICIARY_REQUEST`, `EQUIVALENT_WELFARE_EMPLOYMENT_END`, `EQUIVALENT_WELFARE_FIRST_WITHHOLDING`, `EQUIVALENT_WELFARE_INSPECTION_REQUEST`, `EQUIVALENT_WELFARE_SETUP`, `PERSONAL_DATA_BREACH`, `PERSONAL_DATA_TRANSFER_ABROAD`, `RELOCATION_BOARD_ORDER`, `RELOCATION_EMPLOYEE_REFUSAL`, `RELOCATION_EMPLOYER_OBJECTION`, `SECURITY_DEPOSIT_RECEIVED`, `SKILL_DEVELOPMENT_COURSE_COMPLETED`, `WORKPLACE_RELOCATION`.

### Registered rules: what a write is refused for

- **`employee_contract`** (5): `CHILD_EMPLOYMENT`, `CONTRACT_CATEGORIES`, `MINIMUM_WAGE_FLOOR`, `SHARED_STRUCTURED_EMPLOYEE_INPUTS`, `SKILL_STANDARD_WAGE`.
- **`entity_profile_version`** (1): `SHARED_STRUCTURED_ENTITY_INPUTS`.
- **`leave_catalog_entry`** (1): `WORK_INJURY_DAY_REQUIRED`.
- **`roster_entry`** (3): `NORMAL_HOURS`, `REST_BREAK`, `ROSTER_REST_BREAK`.
- **`workplace_case_catalog_entry`** (4): `BUSINESS_CASE_DOCUMENT_REQUIRED`, `BUSINESS_CASE_EFFECTIVE_INTERVAL`, `BUSINESS_CASE_SIGNED_CONSENT`, `DEDUCTION_CONSENT_DISTINCT_SCOPE`.

### Registered effects: the tasks raised

52 effects; every one writes `obligation.create`.

- **`employee_contract`** on create, update (9): `EMPLOYEE_REGISTER_PAYROLL_UPDATE`, `EMPLOYEE_REGISTER`, `FOREIGN_WORKER_HIRE_NOTIFICATION`, `PDPA_PRIVACY_NOTICE`, `PDPA_SENSITIVE_DATA_CONSENT`, `SKILL_DEVELOPMENT_REGISTRATION`, `SSO_REGISTRATION`, `WORK_RULES` and 1 more.
- **`employee_contract`** on exit (10): `FINAL_PAY`, `FOREIGN_WORKER_EXIT_NOTIFICATION`, `PERSONAL_DATA_DISPOSAL`, `RECORDS_RETENTION`, `RETIREMENT_SEVERANCE`, `SECURITY_DEPOSIT_RETURN`, `SSO_EXIT_NOTIFICATION`, `TECHNOLOGY_REDUNDANCY_NOTICE` and 2 more.
- **`employee_profile`** on update (1): `EMPLOYEE_REGISTER_UPDATE`.
- **`entity_profile_version`** on update (3): `EMPLOYER_REGISTRATION`, `PDPA_PROCESSING_RECORDS`, `WCF_CLOSING_WAGE_STATEMENT`.
- **`leave_catalog_entry`** on create (1): `WORK_INJURY_NOTIFICATION`.
- **`payroll_run`** on create (15): `DISABLED_EMPLOYMENT_QUOTA`, `EMPLOYMENT_CONDITIONS_REPORT`, `EWF_REMITTANCE`, `PND1_FILING`, `PND1_KOR_ANNUAL`, `PVD_REMITTANCE`, `SKILL_DEVELOPMENT_COURSE_CERTIFICATION`, `SKILL_DEVELOPMENT_FUND_PAYMENT` and 7 more.
- **`work_event`** on create (1): `TEMPORARY_SHUTDOWN_NOTICE`.
- **`workplace_case_catalog_entry`** on create (12): `EWF_WELFARE_ACCOUNT_DISCLOSURE`, `EWF_WELFARE_ACCOUNT_INSPECTION`, `EWF_WELFARE_ACCOUNT_RETURN`, `EWF_WELFARE_BENEFICIARY_WITHDRAWAL`, `EWF_WELFARE_SETUP_VERIFICATION`, `PDPA_BREACH_NOTICE`, `PDPA_CROSS_BORDER_TRANSFER`, `RELOCATION_BOARD_ORDER_RESPONSE` and 4 more.

### Employer pay methods

- `rest_day_hourly_multiplier`: `HOLIDAY_OVERTIME`, `HOLIDAY_WORK`.

## Taiwan (TW)

### Law versions

| Version | From       | To         | State  |
| ------- | ---------- | ---------- | ------ |
| 1       | 2025-12-01 | 2025-12-31 | sealed |
| 2       | 2026-01-01 | 2026-03-31 | sealed |
| 3       | 2026-04-01 | 2026-09-30 | sealed |
| 4       | 2026-10-01 | 2026-12-31 | sealed |
| 5       | 2027-01-01 | open       | sealed |

Rows whose values differ from the version before:

- Version 2, from 2026-01-01: statutory `INCOME_TAX`, `LABOR_PENSION`, `OCC_INJURY`; leave `PARENTAL_LEAVE_BY_DAY`; rules `MINIMUM_WAGE_HOURLY`; effects `PARENTAL_LEAVE_INSURANCE_CONTINUATION`; settings `lookup`.
- Version 3, from 2026-04-01: statutory `LABOR_PENSION_RESERVE`; effects `FOREIGN_PROFESSIONAL_PENSION_AND_EMPLOYMENT_INSURANCE`.
- Version 4, from 2026-10-01: leave `MARRIAGE_LEAVE`; rules `MARRIAGE_LEAVE_DAYS`; effects `FOREIGN_PROFESSIONAL_PENSION_AND_EMPLOYMENT_INSURANCE`.
- Version 5, from 2027-01-01: statutory `LI`; rules `MINIMUM_WAGE_HOURLY`; settings `lookup`.

### Conversions and subtotal chain

Currency TWD. Tax year starts in month 1. Day rate `FIXED ÷ 30`, hour rate `CONTRACT_HOURS`, proration `DAY_RATE`, rounding `HALF_UP` to 0 places. Year-to-date totals restart per `JURISDICTION`.

Chain: `BASIC` → `PRORATED` → `PAID_BASIC` → `BASIC_AFTER_PARENTAL_LEAVE` → `SALARY_INCOME` → `ORDINARY_WAGES` → `ADDITIONAL_WAGES` → `RETIREMENT` → `FINAL_PAY` → `NET`.

### Contributions and taxes

| Code                         | Kind         | What it is                                                                                                          | Employee | Employer | Below zero | First reference on the row                                                                        | Value changed |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ---------- | ------------------------------------------------------------------------------------------------- | ------------- |
| `LI`                         | contribution | Labour insurance premium: 12% of the insured salary grade for the days covered in the month, shared…                | yes      | yes      | stops      | 勞工保險條例, §6、§8、§9、§13–15 (+3 more)                                                        | 2027-01-01    |
| `WAGE_ARREARS_FUND`          | contribution | Wage arrears payment fund, paid by the employer only: 0.025% of the worker's insured salary for the…                | no       | yes      | stops      | 勞動基準法, §28                                                                                   | —             |
| `EI`                         | contribution | Employment insurance premium: 1% of the insured salary for the days covered in the month, shared 20…                | yes      | yes      | stops      | 就業保險法, §5、§8、§40                                                                           | —             |
| `NHI`                        | contribution | National health insurance premium: 5.17% of the insured amount, 30% from the worker (with up to thr…                | yes      | yes      | stops      | 全民健康保險法; 施行細則, §18、§27、§29、§30; 細則§52 (+1 more)                                   | —             |
| `NHI_SUPPLEMENT`             | contribution | Supplementary health insurance premium of 2.11% on the part of the year's bonuses above four times…                 | yes      | no       | stops      | 全民健康保險法, §31                                                                               | —             |
| `NHI_PART_TIME`              | contribution | Supplementary health insurance premium of 2.11% on salary paid to a person who is not insured throu…                | yes      | no       | stops      | 全民健康保險法, §31(1)(2) (+1 more)                                                               | —             |
| `LABOR_PENSION`              | contribution | Labour pension (new system): the employer contributes at least 6% of the worker's monthly contribut…                | yes      | yes      | stops      | 勞工退休金條例, §7–9、§14、§15、§18 (+1 more)                                                     | 2026-01-01    |
| `OCC_INJURY`                 | contribution | Occupational accident insurance premium, paid by the employer only: the insured salary grade × the…                 | no       | yes      | stops      | 勞工職業災害保險及保護法; 施行細則, §16、§17、§19; 細則§2、§26、§28 (+1 more)                     | 2026-01-01    |
| `INCOME_TAX`                 | tax          | Resident monthly salary withholding: by the 薪資所得扣繳稅額表 with a declared 免稅額申報表, otherwise 5% of the m… | yes      | no       | stops      | 所得稅法; 各類所得扣繳率標準; 薪資所得扣繳辦法, 所得稅法§88; 扣繳率標準§2; 扣繳辦法§6–7 (+1 more) | 2026-01-01    |
| `INCOME_TAX_NON_RESIDENT`    | tax          | Income tax withheld on a non-resident's salary: 6% where the month's whole salary is not more than…                 | yes      | no       | stops      | 所得稅法; 各類所得扣繳率標準, 所得稅法§88; 扣繳率標準§3(1)(1)、§3(2)                              | —             |
| `LABOR_PENSION_RESERVE`      | contribution | Labour pension reserve (old system), paid by the employer only: the company's declared rate, 2% to…                 | no       | yes      | stops      | 勞動基準法, §56(1) (+1 more)                                                                      | 2026-04-01    |
| `INCOME_TAX_BONUS`           | tax          | Income tax withheld on a resident's bonus or other non-monthly pay: 5% of the payment once it reach…                | yes      | no       | stops      | 薪資所得扣繳辦法, §6–7                                                                            | —             |
| `SEVERANCE_TAX`              | tax          | Income tax withheld on a resident's severance or retirement payment: 6% of the part above the fixed…                | yes      | no       | stops      | 所得稅法; 各類所得扣繳率標準, 所得稅法§14(1)(9)、§88; 扣繳率標準§2                                | —             |
| `WELFARE_FUND`               | contribution | Employees' welfare fund: 0.5% of the worker's monthly salary, deducted only where the company has s…                | yes      | no       | stops      | 職工福利金條例, §2(1)(3)                                                                          | —             |
| `SEVERANCE_TAX_NON_RESIDENT` | tax          | Income tax withheld on a non-resident's severance or retirement payment: 18% of the part above the…                 | yes      | no       | stops      | 所得稅法; 各類所得扣繳率標準, 所得稅法§14(1)(9)、§88; 扣繳率標準§2                                | —             |

### Leave

| Code                        | Entitlement                                                         | A day taken                  | Value changed  |
| --------------------------- | ------------------------------------------------------------------- | ---------------------------- | -------------- |
| `ANNUAL_LEAVE`              | 3–30 days by length of service; service year                        | full pay, cashable           | —              |
| `BEREAVEMENT_LEAVE`         | no limit                                                            | full pay                     | —              |
| `BREASTFEEDING_TIME`        | no limit                                                            | full pay                     | —              |
| `CHILDCARE_REDUCED_HOURS`   | no limit                                                            | paid share 0                 | —              |
| `COMPENSATORY_TIME_OFF`     | none by default; HR grants each day; service year; counted in hours | full pay                     | —              |
| `FAMILY_CARE_LEAVE`         | no limit                                                            | paid share 0                 | —              |
| `HOSPITALISED_SICK_LEAVE`   | no limit                                                            | paid share by the row’s rule | —              |
| `INDIGENOUS_RITUAL_HOLIDAY` | 3 days; calendar year                                               | full pay                     | —              |
| `JOB_SEARCH_LEAVE`          | no limit                                                            | full pay                     | —              |
| `MARRIAGE_LEAVE`            | 14 days; opened by `MARRIAGE`; per event                            | full pay                     | 2026-10-01     |
| `MATERNITY_LEAVE`           | no limit                                                            | paid share by the row’s rule | —              |
| `MENSTRUAL_LEAVE`           | no limit                                                            | paid share by the row’s rule | —              |
| `MENSTRUAL_LEAVE_UNPAID`    | no limit                                                            | paid share 0                 | —              |
| `NATURAL_DISASTER_ABSENCE`  | no limit                                                            | paid share 0                 | —              |
| `OCCUPATIONAL_INJURY_LEAVE` | no limit                                                            | full pay                     | —              |
| `OFFICIAL_LEAVE`            | no limit                                                            | full pay                     | —              |
| `PARENTAL_LEAVE`            | no limit                                                            | paid share 0                 | —              |
| `PARENTAL_LEAVE_BY_DAY`     | 30 days; opened by `CHILD_BIRTH`; per event                         | paid share 0                 | new 2026-01-01 |
| `PATERNITY_LEAVE`           | 7 days; opened by `CHILD_BIRTH`; per event                          | full pay                     | —              |
| `PERSONAL_LEAVE`            | no limit                                                            | paid share 0                 | —              |
| `PRENATAL_CHECKUP_LEAVE`    | 7 days; opened by `PREGNANCY`; per event                            | full pay                     | —              |
| `PUBLIC_HOLIDAY_IN_LIEU`    | none by default; HR grants each day; calendar year                  | full pay                     | —              |
| `SICK_LEAVE`                | 30 days; calendar year                                              | paid share by the row’s rule | —              |
| `SICK_LEAVE_SUSPENSION`     | no limit                                                            | paid share 0                 | —              |
| `SICK_LEAVE_UNPAID`         | no limit                                                            | paid share 0                 | —              |
| `STATUTORY_REST_IN_LIEU`    | none by default; HR grants each day; calendar year                  | full pay                     | —              |

### Overtime, rest-day and holiday work

| Code                  | What it pays                                                                                                        | Numbers on the row | Value changed |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------- |
| `OVERTIME`            | Working-day overtime: the hourly wage × 1⅓ for each day’s first two overtime hours and × 1⅔ for every further…      | —                  | —             |
| `STATUTORY_REST_WORK` | A 例假 worked: one further day’s wage for each such day (an hourly worker: their hours up to normal hours), or…     | —                  | —             |
| `REST_DAY_WORK`       | Work on a 休息日: the hourly wage × 1⅓ for the first two hours, × 1⅔ to the eighth and × 2⅔ from the ninth (勞基法… | multiplier 2.66667 | —             |
| `HOLIDAY_WORK`        | A published holiday worked: one further day’s wage for each such day; an hourly worker is paid their hours up…      | —                  | —             |
| `HOLIDAY_OVERTIME`    | Hours past the shift on a published holiday (past the eighth on a planned off day): the hourly wage × 1⅓ for…       | —                  | —             |

Roster warnings (`ROSTER_DAILY_HOURS_CAP`): daily hours 12; daily overtime hours 4; monthly overtime hours 46; consecutive days 6; weekly rest days 2.

### Allowance, claim, ad hoc, loan, work event and workplace case rows

- **Allowance** (3): `FULL_ATTENDANCE_BONUS`, `MEAL_ALLOWANCE_TAXABLE`, `MEAL_ALLOWANCE`. Of these, 3 count in the wage a day or hour rate divides.
- **Claim** (1): `BUSINESS_EXPENSE_REIMBURSEMENT`. Of these, 0 have a yearly limit.
- **Ad hoc** (30): `COURT_GARNISHMENT`, `FOOD_LODGING`, `INDIGENOUS_RITUAL_DAY_WORK`, `NON_COMPETE_COMPENSATION`, `NON_COMPETE_LUMP_SUM`, `NOTICE_PAY`, `OCC_DEATH_COMPENSATION`, `OCC_DEATH_FUNERAL`, `OCC_DISABILITY_G01`, `OCC_DISABILITY_G02`, `OCC_DISABILITY_G03`, `OCC_DISABILITY_G04`, `OCC_DISABILITY_G05`, `OCC_DISABILITY_G06`, `OCC_DISABILITY_G07`, `OCC_DISABILITY_G08`, `OCC_DISABILITY_G09`, `OCC_DISABILITY_G10`, `OCC_DISABILITY_G11`, `OCC_DISABILITY_G12`, `OCC_DISABILITY_G13`, `OCC_DISABILITY_G14`, `OCC_DISABILITY_G15`, `OCC_INJURY_LUMP_SUM`, `OCC_INJURY_MEDICAL`, `OCC_INJURY_OFFSET`, `RETIREMENT_PAY`, `SEVERANCE_PAY`, `STATUTORY_REFUND`, `bonus`. Of these, 7 may run off-cycle, 0 post to a balance account (statutory corrections) and 0 are employer cost.
- **Loan** (1): `SALARY_ADVANCE`.
- **Work event** (5): `EMPLOYER_SHUTDOWN`, `GOVERNMENT_STOP_WORK`, `NATURAL_DISASTER`, `REDUCED_WORK_AGREEMENT`, `STRIKE`.
- **Workplace case** (6): `BENEFIT_SERVICE_RECORD`, `CROSS_BORDER_WORK_RECORD`, `EMERGENCY_OVERTIME`, `EXTERNAL_WAGE_RECORD`, `FOREIGN_WORKER_ABSENCE`, `OCCUPATIONAL_ACCIDENT`.

### Registered rules: what a write is refused for

- **`employee_contract`** (8): `CHILD_WORKER_LIMITS`, `CONTRACT_CATEGORIES`, `DOMESTIC_MIGRANT_WAGE`, `MASS_LAYOFF_WORKSITE_REQUIRED`, `MINIMUM_WAGE_FLOOR`, `MINIMUM_WAGE_HOURLY`, `SHELTERED_EMPLOYMENT_EVIDENCE`, `UNDER_FIFTEEN_EMPLOYMENT`.
- **`leave_catalog_entry`** (2): `MARRIAGE_LEAVE_DAYS`, `SICK_LEAVE_PAY_POOL`.
- **`roster_entry`** (6): `BREAK_AFTER_FOUR_HOURS`, `NORMAL_HOURS`, `OVERTIME_DAILY_CAP`, `ROSTER_ATTENDANCE_TO_THE_MINUTE`, `ROSTER_BREAK_AFTER_FOUR_HOURS`, `ROSTER_DAILY_HOURS_CAP`.

### Registered effects: the tasks raised

60 effects; every one writes `obligation.create`.

- **`employee_contract`** on create, update (9): `EMPLOYMENT_CONTRACT_TERMS`, `LABOUR_EMPLOYMENT_INSURANCE_ENROLMENT`, `LABOUR_PENSION_REGISTRATION`, `NHI_ENROLMENT`, `OCCUPATIONAL_ACCIDENT_INSURANCE_ENROLMENT`, `PERSONAL_DATA_COLLECTION_NOTICE`, `SEXUAL_HARASSMENT_COMPLAINT_CHANNEL`, `SEXUAL_HARASSMENT_PREVENTION_RULES` and 1 more.
- **`employee_contract`** on exit (19): `FINAL_WAGE_SETTLEMENT`, `FOREIGN_WORKER_SEPARATION_NOTICE`, `INSURANCE_PENSION_RECORDS_RETENTION`, `INVOLUNTARY_SEPARATION_CERTIFICATE`, `LABOUR_EMPLOYMENT_INSURANCE_WITHDRAWAL`, `LABOUR_PENSION_DEREGISTRATION`, `LAYOFF_REPORT`, `MASS_LAYOFF_PLAN_ENTITY` and 11 more.
- **`entity_profile_version`** on update (2): `LI_UNIT_CHANGE`, `NHI_UNIT_CHANGE`.
- **`leave_catalog_entry`** on create, update (1): `PARENTAL_LEAVE_INSURANCE_CONTINUATION`.
- **`obligation`** on update (4): `INSURANCE_PREMIUM_LATE_SURCHARGE`, `LABOUR_PENSION_LATE_SURCHARGE`, `NHI_LATE_SURCHARGE`, `WITHHOLDING_TAX_LATE_SURCHARGE`.
- **`payroll_run`** on create (20): `ANNUAL_WITHHOLDING_STATEMENTS`, `ATTENDANCE_RECORDS_RETENTION`, `DISABLED_EMPLOYMENT_QUOTA_LEVY`, `EMPLOYMENT_STABILISATION_FEE`, `INSURANCE_PREMIUM_REMITTANCE`, `INSURED_SALARY_ADJUSTMENT_AUGUST_JANUARY`, `INSURED_SALARY_ADJUSTMENT_FEBRUARY_JULY`, `LABOUR_MANAGEMENT_CONFERENCE` and 12 more.
- **`work_event`** on create, update (1): `REDUCED_HOURS_NOTICE`.
- **`workplace_case_catalog_entry`** on create (3): `EMERGENCY_OVERTIME_NOTICE`, `FOREIGN_WORKER_ABSENCE_NOTICE`, `WORK_ACCIDENT_REPORT`.
- **`workplace_case_catalog_entry`** on update (1): `WORK_ACCIDENT_REPORT_UPDATED`.

### Employer pay methods

- `rest_day_hourly_multiplier`: `REST_DAY_WORK`, `STATUTORY_REST_WORK`.

## Vietnam (VN)

### Law versions

| Version | From       | To         | State  |
| ------- | ---------- | ---------- | ------ |
| 1       | 2025-12-01 | 2025-12-31 | sealed |
| 2       | 2026-01-01 | 2026-04-14 | sealed |
| 3       | 2026-04-15 | 2026-05-15 | sealed |
| 4       | 2026-05-16 | 2026-06-30 | sealed |
| 5       | 2026-07-01 | 2026-12-31 | sealed |
| 6       | 2027-01-01 | open       | sealed |

Rows whose values differ from the version before:

- Version 2, from 2026-01-01: statutory `PIT`, `PIT_PENSION_DEDUCTION`, `PIT_TAXABLE_INCOME`, `UI`; rules `HOURLY_MINIMUM_WAGE`, `MINIMUM_WAGE_FLOOR`; effects `DPD_BREACH_NOTIFICATION`, `DPD_CONSENT_AND_NOTICE`, `DPD_DELETION_ON_REQUEST`, `DPD_IMPACT_ASSESSMENT`, `DPD_SENSITIVE_DATA_PERSONNEL` and 8 more; settings `lookup`.
- Version 3, from 2026-04-15: effects `PIT_WITHHOLDING_DECLARATION`.
- Version 4, from 2026-05-16: statutory `UNION_FEE`; effects `UNION_FEE_REMITTANCE`.
- Version 5, from 2026-07-01: statutory `PIT`, `PIT_PENSION_DEDUCTION`, `PIT_TAXABLE_INCOME`, `UNION_DUES`; leave `PUBLIC_HOLIDAY`; effects `DEPENDANT_TAX_REGISTRATION`, `PIT_TAX_REGISTRATION`; settings `lookup`.
- Version 6, from 2027-01-01: rules `HOURLY_MINIMUM_WAGE`, `MINIMUM_WAGE_FLOOR`; settings `lookup`.

### Conversions and subtotal chain

Currency VND. Tax year starts in month 1. Day rate `WORKING_DAYS`, hour rate `CONTRACT_HOURS`, proration `WORKING_DAYS`, rounding `HALF_UP` to 0 places. Year-to-date totals restart per `JURISDICTION`.

Chain: `BASIC` → `PRORATED` → `PAID_BASIC` → `MEAL_PAY` → `WORK_EXPENSE_PAY` → `HOUSING_PAY` → `PENSION_PAY` → `PIT_EXEMPT_PAY` → `ORDINARY_WAGES` → `ADDITIONAL_WAGES` → `FINAL_PAY` → `NET`.

### Contributions and taxes

| Code                    | Kind         | What it is                                                                                           | Employee | Employer | Below zero | First reference on the row                                                               | Value changed          |
| ----------------------- | ------------ | ---------------------------------------------------------------------------------------------------- | -------- | -------- | ---------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| `SI`                    | contribution | Social insurance: 8% from the employee and 17.5% from the employer on the monthly salary, capped at… | yes      | yes      | refund     | Law 41/2024 arts.31(1)(b), 37(2): use actual qualifying sto… (+14 more)                  | —                      |
| `HI`                    | contribution | Health insurance: 1.5% from the employee and 3% from the employer on the monthly salary, capped at…  | yes      | yes      | refund     | Health Insurance Law art.12(1)(c)-(d), amended by Law 51/20… (+14 more)                  | —                      |
| `UI`                    | contribution | Unemployment insurance: 1% from the employee and 1% from the employer on the monthly wage, capped a… | yes      | yes      | refund     | Law on Employment 74/2025/QH15 (Luật Việc làm), arts.31–33, art.34(1)(b), (2) (+11 more) | 2026-01-01             |
| `UNION_FEE`             | contribution | Trade union fee, paid by the employer only: 2% of the salary on which social insurance is paid, whe… | no       | yes      | stops      | Law on Trade Unions 50/2024/QH15 (Luật Công đoàn), art.29(1)(b) (+9 more)                | 2026-05-16             |
| `PIT_TAXABLE_INCOME`    | tax          | Taxable income carried into income tax.                                                              | no       | yes      | stops      | Decree 253/2026/NĐ-CP art.8(2)(g), (h), art.26, arts.46, 51… (+1 more)                   | 2026-01-01, 2026-07-01 |
| `PIT_PENSION_DEDUCTION` | tax          | A record of the voluntary pension and life insurance contributions that may be taken off taxable in… | no       | yes      | stops      | Decree 253/2026/NĐ-CP art.46(2)(a), arts.69(1)(a), 70(2): p…                             | 2026-01-01, 2026-07-01 |
| `PIT`                   | tax          | Personal income tax withheld from pay                                                                | yes      | yes      | refund     | Resident salary withholding (Decree 253/2026/NĐ-CP art.50(1… (+11 more)                  | 2026-01-01, 2026-07-01 |
| `UNION_DUES`            | contribution | Union membership dues, deducted from union members only: 0.5% of the salary on which social insuran… | yes      | no       | refund     | Law on Trade Unions 50/2024/QH15 (Luật Công đoàn), art.29 (+11 more)                     | 2026-07-01             |

### Leave

| Code                            | Entitlement                                                        | A day taken        | Value changed |
| ------------------------------- | ------------------------------------------------------------------ | ------------------ | ------------- |
| `ANNUAL_LEAVE`                  | 12–22 days by length of service; own statutory test; calendar year | full pay, cashable | —             |
| `BEREAVEMENT_LEAVE`             | 3 days; opened by `BEREAVEMENT`; per event                         | full pay           | —             |
| `BEREAVEMENT_LEAVE_UNPAID`      | no limit                                                           | paid share 0       | —             |
| `CHILD_MARRIAGE_LEAVE`          | 1 days; opened by `CHILD_MARRIAGE`; per event                      | full pay           | —             |
| `CHILD_SICK_CARE`               | no limit                                                           | paid share 0       | —             |
| `CONTRACEPTION_LEAVE`           | no limit                                                           | paid share 0       | —             |
| `CONVALESCENCE_LEAVE`           | no limit                                                           | paid share 0       | —             |
| `FOREIGN_NATIONAL_LEAVE`        | 2 days; calendar year                                              | full pay           | —             |
| `MARRIAGE_LEAVE`                | 3 days; opened by `MARRIAGE`; per event                            | full pay           | —             |
| `MATERNITY_LEAVE`               | no limit                                                           | paid share 0       | —             |
| `MISCARRIAGE_LEAVE`             | no limit                                                           | paid share 0       | —             |
| `NPL`                           | no limit                                                           | paid share 0       | —             |
| `OCCUPATIONAL_ACCIDENT_LEAVE`   | no limit                                                           | full pay           | —             |
| `PATERNITY_LEAVE`               | no limit                                                           | paid share 0       | —             |
| `PRENATAL_CHECKUP`              | no limit                                                           | paid share 0       | —             |
| `PUBLIC_HOLIDAY`                | 12 days; calendar year                                             | full pay           | 2026-07-01    |
| `PUBLIC_HOLIDAY_IN_LIEU`        | none by default; HR grants each day; calendar year                 | full pay           | —             |
| `SICK_LEAVE`                    | no limit                                                           | paid share 0       | —             |
| `STOPPAGE_WORKER_FAULT`         | no limit                                                           | paid share 0       | —             |
| `SUSPENSION_PENDING_DISCIPLINE` | no limit                                                           | paid share 0.5     | —             |

### Overtime, rest-day and holiday work

| Code                | What it pays                                                                                                   | Numbers on the row | Value changed |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------ | ------------- |
| `OVERTIME`          | Clocked overtime hours on a working or off day that is neither a weekly rest day nor a holiday, at 150% of th… | multiplier 1.5     | —             |
| `REST_DAY_OVERTIME` | Every hour worked on a weekly rest day that is not a holiday, at 200% of the normal hour, or the employer's h… | —                  | —             |
| `HOLIDAY_WORK`      | Every hour worked on a public holiday or paid day off, at 300% of the normal hour on top of the holiday's own… | multiplier 3       | —             |
| `NIGHT_WORK`        | Every clocked hour between 22:00 and 06:00, normal or overtime, earns 30% of the normal hour on top of its pa… | multiplier 0.3     | —             |
| `NIGHT_OVERTIME`    | Overtime hours worked between 22:00 and 06:00 add 20% of that day's daytime hour wage: 100% on a normal day,…  | multiplier 0.2     | —             |

Roster warnings (`ROSTER_WARNINGS`): daily hours 12; daily overtime hours 4; monthly overtime hours 40; consecutive days 6; weekly rest days 1.

### Allowance, claim, ad hoc, loan, work event and workplace case rows

- **Allowance** (5): `FIXED_ALLOWANCE`, `HOUSING`, `INSURANCE_EQUIVALENT`, `MEAL_ALLOWANCE`, `WORK_EXPENSE_ALLOWANCE`. Of these, 1 count in the wage a day or hour rate divides.
- **Claim** (0): none.
- **Ad hoc** (16): `BONUS`, `EMPLOYEE_UNLAWFUL_TERMINATION`, `EMPLOYER_PENSION_CONTRIBUTION`, `JOB_LOSS_ALLOWANCE`, `LATE_WAGE_COMPENSATION`, `NON_ACCUMULATING_INSURANCE`, `OCCUPATIONAL_ACCIDENT_COMPENSATION`, `OCCUPATIONAL_ACCIDENT_MEDICAL`, `PROPERTY_DAMAGE_COMPENSATION`, `SEVERANCE_ALLOWANCE`, `STATUTORY_ADJUSTMENT`, `STATUTORY_REFUND`, `SUSPENSION_SETTLEMENT`, `TRAINING_COST_REFUND`, `TRAINING_SUPPORT`, `UNLAWFUL_TERMINATION_COMPENSATION`. Of these, 9 may run off-cycle, 0 post to a balance account (statutory corrections) and 3 are employer cost.
- **Loan** (1): `SALARY_ADVANCE`.
- **Work event** (5): `COWORKER_FAULT`, `EMPLOYER_FAULT`, `OBJECTIVE_CAUSE`, `STRIKE_NON_PARTICIPANT`, `STRIKE_PARTICIPANT`.
- **Workplace case** (5): `ANNUAL_LEAVE_COMBINING_AGREEMENT`, `BENEFIT_SERVICE_RECORD`, `CROSS_BORDER_WORK_RECORD`, `EXTERNAL_WAGE_RECORD`, `PERSONAL_DATA_BREACH`.

### Registered rules: what a write is refused for

- **`adhoc_catalog_entry`** (1): `DAMAGE_DEDUCTION_CEILING`.
- **`employee_contract`** (9): `ANNUAL_SERVICE_EXIT_REVIEW`, `CONTRACT_CATEGORIES`, `HOURLY_MINIMUM_WAGE`, `MINIMUM_WAGE_FLOOR`, `PROBATION_PERIOD`, `PROBATION_WAGE`, `REGION_REQUIRED`, `SHARED_ORIGINAL_AGREEMENT_INTENT`, `SHARED_STRUCTURED_EMPLOYEE_INPUTS`.
- **`entity_profile_version`** (1): `OPERATIONS_EVENT_DATE_REQUIRED`.
- **`leave_catalog_entry`** (1): `ENCASHMENT_PRIOR_WAGE_REVIEW`.
- **`roster_entry`** (14): `MINOR_WORKING_TIME`, `OVERTIME_ANNUAL_CAP`, `OVERTIME_DAILY_CAP`, `OVERTIME_MONTHLY_CAP`, `PREGNANT_OR_INFANT_NIGHT_OVERTIME`, `ROSTER_MATERNITY_NIGHT_OVERTIME`, `ROSTER_MINOR_WORKING_TIME`, `ROSTER_NORMAL_HOURS_DAY`, `ROSTER_NORMAL_HOURS_WEEK`, `ROSTER_OVERTIME_DAY`, `ROSTER_SHIFT_CHANGE_REST`, `ROSTER_UNDER_13`, `ROSTER_WARNINGS`, `WEEKLY_REST`.
- **`workplace_case_catalog_entry`** (4): `ANNUAL_LEAVE_COMBINING_MAXIMUM`, `BUSINESS_CASE_DOCUMENT_REQUIRED`, `BUSINESS_CASE_EFFECTIVE_INTERVAL`, `BUSINESS_CASE_SUBJECT_AND_REFERENCE`.

### Registered effects: the tasks raised

61 effects; every one writes `obligation.create`.

- **`employee_contract`** on create, update (11): `FOREIGN_WORKER_NEW_DECREE_REVIEW`, `FOREIGN_WORK_PERMIT`, `LABOUR_CONTRACT`, `LABOUR_MANAGEMENT_BOOK`, `OSH_INDUCTION_TRAINING`, `PDPL_CONSENT`, `PDPL_PROCESSING_START_REVIEW`, `PIT_TAX_REGISTRATION` and 3 more.
- **`employee_contract`** on exit (10): `FINAL_SETTLEMENT`, `FOREIGN_EXIT_PIT_FINALISATION`, `PDPL_RECRUITMENT_AND_EMPLOYMENT`, `PERSONAL_DATA_DISPOSAL`, `PIT_WITHHOLDING_CERTIFICATE`, `RESTRUCTURING_LABOUR_PLAN`, `SI_CONFIRMATION_ON_TERMINATION`, `TERMINATION_NOTICE` and 2 more.
- **`employee_contract`** on update (2): `WORK_AUTHORISATION_INVALIDATION_RETURN_393`, `WORK_AUTHORISATION_LOCATION_NOTICE_393`.
- **`entity_profile_version`** on update (2): `LABOUR_USE_DECLARATION`, `PDPL_INITIAL_IMPACT_FILING`.
- **`leave_catalog_entry`** on create, update (2): `SI_BENEFIT_CLAIMS`, `SI_BENEFIT_FILE_RECEIPT_REVIEW`.
- **`payroll_run`** on create (26): `ANNUAL_LEAVE_SCHEDULE`, `DEPENDANT_TAX_REGISTRATION`, `INSURANCE_EQUIVALENT_PAYMENT`, `INTERNAL_LABOUR_RULES`, `LABOUR_USE_REPORT`, `MINIMUM_WAGE`, `NIGHT_OVERTIME_STATEMENT`, `OCCUPATIONAL_ACCIDENT_REPORT` and 18 more.
- **`payslip`** on create (7): `FOREIGN_WORKER_NEW_DECREE_TRANSITION`, `FOREIGN_WORKER_REPORT_393`, `WORK_AUTHORISATION_EXPIRY_INPUTS_393`, `WORK_AUTHORISATION_EXTENSION_393`, `WORK_AUTHORISATION_FRESH_ISSUE_393`, `WORK_PERMIT_EXTENSION`, `WORK_PERMIT_TRANSITION_REVIEW`.
- **`workplace_case_catalog_entry`** on create (1): `PDPL_BREACH_NOTIFICATION`.

### Employer pay methods

- `rest_day_hourly_multiplier`: `PIT_TAXABLE_INCOME`, `REST_DAY_OVERTIME`.

<!-- coverage:end -->

## How to read the tables

- **Law versions.** A version exists because something changed on its first day. The seed starts on 1 December 2025, and versions are contiguous and sealed. A change already enacted is seeded in advance, so some versions start in the future (the latest on 2028-07-01). Each lineage's last version is open-ended.
- **Rounding.** Every law rounds the day rate before it multiplies the days, except the Philippines, which rounds only the amount (`rounding.day_rate: AMOUNT`).
- **A run reads only its own law.** A payroll run reads the catalogues of its own jurisdiction's version, never another country's.
- **Contributions and taxes.** "Employee" and "Employer" say whether the row computes that side. "Below zero" says what the row does when a month's figure comes out negative: `refund` pays a refund line because its statute has the employer repay; `stops` stops at zero and the next run nets it. "First reference on the row" is the first of the row's own `references`; the row holds the full list, with locators, quotes and links.
- **Leave.** "Entitlement" is read from the row's `lookup`. "Own statutory test" means the row states its test as an expression. "A day taken" is the row's `paid_share`: full pay when empty, a stated share, or the row's rule; "cashable" means the row has a `payout`.
- **Overtime.** "Numbers on the row" are the plain numbers in the row's `lookup`; the row's `conversion` holds the full rule.
- **Registered rules** refuse a write. **Registered effects** raise a task after a write.
- **Employer pay methods.** The list shows the rows that read a method by name. `overtime_hour_basis` also lifts the hour rate every overtime row reads, in every jurisdiction, where the employer's hour is higher than the law's.

The tables are derived from the seed. After a seed change they are derived again; nothing in them is typed by hand.

## Not enforced by the seed

The seed carries no row for these, so nothing computes or enforces them.

| Jurisdiction | Not enforced                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CN           | No rule caps a shift template's ordinary hours at eight a day. No registered rule in any jurisdiction checks a shift definition                                            |
| CN           | No row values an equity incentive or applies its separate tax method                                                                                                       |
| MY           | No row values a benefit in kind or living accommodation for the monthly tax deduction (PCB)                                                                                |
| MY           | No row adjusts a results-paid worker's month with no results (Minimum Wages Order 2024 para 5(2))                                                                          |
| PH           | No claim row carries a yearly limit, so a medical claim is not held to one                                                                                                 |
| SG           | The Government's reimbursement of government-paid leave is not computed or recorded as money. An effect raises the task to claim it; the employee is paid by the leave row |
| SG           | No row records the employer's recovery of work-injury medical costs from its insurer                                                                                       |
| All          | A change of law not yet enacted is not seeded. Research files it as a finding and HR merges it as the next version once enacted                                            |

Each row's legal sources (title, link, the quoted passage) are on the row itself, in its `references`.

## How it is verified

- **Mechanisms are proved by tests.** The tests under `tests/` use invented fixtures. They prove that the engine applies what a row says: the chain, proration, statutory order, refunds, limits, carry, corrections of a paid period, approvals, exits. They do not certify that a seeded rate or threshold is the law.
- **Legal values are proved by reconciliation.** Private data is run through the seed and reconciled, payslip line by payslip line, to real payrolls. That data and its record are kept outside this repository.
- **Reconciled to real payrolls:** MY, ID, PH.
- **Not reconciled to a real payroll:** CN, JP, SG, TH, TW, VN. Their rows are encoded from the statutes each row cites and are exercised only by the mechanism tests.
- **Every row names its statute.** A reader can check a value against the row's `references` in Settings, or in the seed files under `seed/public/jurisdiction/<CODE>/version_<n>/`.
