# What the payroll engine evaluates

Rendered from `src/lib/expressions/contexts.ts` — do not edit by hand; `pnpm exec node --experimental-strip-types --import ./scripts/ts-source-resolve.mjs scripts/render-expression-context.ts` rewrites it and `tests/expression-context-doc.test.ts` holds it current.

Every expression in a sealed version is CEL over one of the sites below. A site carries the roots listed here and nothing else: a member the site does not declare is refused at write. Open prefixes (`limits.<key>`, `year.earned.<code>`, `produced.<code>`, `scheme.elections.<key>`, `company.facts.<key>`, `person.company.facts.<key>`, `terms.facts.<key>`, `day_facts.<key>`, `payment.facts.<key>`, `settlement.facts.<key>`) are keys the version itself declares.

## `entity` — The employing entity and its declared jurisdiction inputs.

Used by: `jurisdiction_settings.facts[].required_when` — entity input requirements.

Open prefixes: `company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `company.settings_code` | Jurisdiction settings lineage |
| `company.region` | Registered payroll region |
| `company.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY |
| `company.facts.<key>` | Declared jurisdiction input |
| `company.fact_keys` | Keys explicitly recorded on the entity |

| Function | Meaning |
| --- | --- |
| `round_cent(value)` | Round to the nearest cent |
| `truncate_cent(value)` | Truncate to the cent |
| `up_5_cents(value)` | Round up to the next five cents |
| `round_unit(value)` | Round to the nearest whole unit |
| `floor_unit(value)` | Floor to the whole unit |
| `up_to_unit(value)` | Round up to the whole unit |
| `bracket(base, up_to, step)` | Round a figure up to the next bracket |
| `ladder(base, grades)` | Step a figure up to the next grade in a table |
| `progressive(value, table)` | Apply a progressive [from, base, rate] table |
| `add_months(date, months)` | The calendar day `months` months after a `YYYY-MM-DD` day, clamped to the month’s last day; empty for an empty day |
| `months_through(from, through)` | Months from one `YYYY-MM-DD` day through another inclusive: completed months plus the part month by its days; 0 when either is empty or `through` is before `from` |

## `person` — The person on the rule date: catalogue and scheme eligibility.

Used by: catalogue eligibility, a scheme’s person conditions, `wages.applies_when`, `overtime_when`, `terms_facts[]` and `work_day_facts[]` conditions.

Bare names: `wage_floor`.

Open prefixes: `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `terms.facts.<key>`, `event.case.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `employee.gender` | Recorded gender |
| `employee.age` | Completed years on the rule date |
| `employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `employee.birthday(age)` | Date the given age is reached, as `YYYY-MM-DD`, or empty without a birth date. A leap-day anniversary in a non-leap year falls on 1 March, matching age_on. |
| `employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `employee.citizenship` | Residency standing from the effective terms |
| `employee.marital_status` | Marital status |
| `employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `employee.dependents_count` | Declared dependant count for schemes such as ID PTKP and TW exemptions; child-specific rules read `children` |
| `employee.solo_parent` | Solo-parent flag |
| `employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `employee.disabled` | Disability flag |
| `employee.race` | Recorded race, upper-cased, as a self-help fund row reads it |
| `employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `employee.presence_recorded` | Whether any stay in the jurisdiction is recorded (`presence_periods`); false leaves a presence test to the declared residency and elections |
| `employee.presence_days` | Days present in the jurisdiction in the rule date’s calendar year through the rule date, an entry or exit day whole (MY ITA 1967 s.7(1)(a), (1A); Sch.6 para 21(a)) |
| `employee.presence_linked_days` | Consecutive days in the previous calendar year of a stay running unbroken into this one, else 0 (MY ITA s.7(1)(b)) |
| `employee.presence_days_in(years_back)` | Days present in the calendar year that many years before the rule date’s, counted as `presence_days` (1 is the previous year; 0 where none is recorded) — MY ITA s.7(1)(c)(ii) counts the preceding years with 90 or more |
| `employee.employment_days` | Days present on stays recorded `employment_exercised`, within the stint: the days the employment was exercised in the jurisdiction this calendar year through the rule date (MY ITA Sch.6 para 21(a), 22(a)) |
| `employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `employment.classification` | Work classification |
| `employment.risk_class` | The employment risk class, or empty |
| `employment.service_days` | Calendar days in the current stint through the rule date, capped at exit; not event-specific employment history |
| `employment.service_days_before(date, months)` | Distinct days employed by this entity in the stated calendar-month window immediately before the event date; all same-entity stints are supplied by payroll, and missing history refuses |
| `employment.service_months` | Completed months since the stint began; a leaver counts through the exit day |
| `employment.service_months_exact` | Completed months plus the part month as a share of its days, for a pro-rata part year |
| `employment.service_years` | Completed years since the stint began; a leaver counts through the exit day |
| `employment.service_years_on(date)` | Completed service years on a specified calendar date on or after hire |
| `employment.notice_days_remaining(days, given_on, waived_days)` | Unserved calendar notice days after the last service day; written notice includes its giving day, empty given_on means no notice. Waived days remove the final unserved days; excessive waiver or invalid dates refuse |
| `employment.notice_monthly_wages(monthly_wage, days, given_on, waived_days)` | Constant monthly wages over the unserved notice interval, divided separately by each calendar month’s actual length. Does not select the legal wage components or handle changing/non-monthly wages; rounding belongs to the rule |
| `employment.payday_notice_days(given_on, pay_frequency, company_pay_frequency)` | Notice length, as `days` for the two functions above, that takes effect on the payday after the first payday on or after given_on (TH LPA s.17 para.2); empty given_on prices from the removal day |
| `employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `employment.rule_date` | The rule date as `YYYY-MM-DD`; a `wages.contract_rules` rule reads the first day of its floor segment |
| `employment.exit_date` | Last day of work, or empty while open |
| `employment.days_to_exit` | Calendar days from the rule date to the exit date: 0 on the exit day or while open. A leave rule reads it on each day charged (TW 勞基法 §16(2): only inside the notice, `employment.days_to_exit < employment.exit_facts.notice_days_given`) |
| `employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `employment.contract_days` | Calendar days of a fixed-term contract, first day to last inclusive (LHDN MTD Specification 2026 D(a) note: a foreign employee on a contract of 182 days or more is withheld at resident MTD); 0 where open-ended |
| `employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `employment.exit_facts.<key>` | Departure inputs declared by the settings version effective on the final service day |
| `employment.exit_fact_keys` | Departure keys explicitly recorded on the employment, before defaults |
| `employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `employment.earned_monthly_average(months)` | The wages earlier payslips paid (basic, regular cash for work, overtime, less unpaid days; no bonus or reimbursement) over the `months` calendar months before the rule date’s month, per month of service, a part first month counted as its share (ID Permenaker 6/2016 art.3(3)–(4); MY reg.6(2) as twelve of them). Refused where a month of service has no payslip; read on a pay request or a leave cash-out |
| `employment.piece_wages_last_workdays(days)` | Earned units times unit rate on the last `days` piece-rate workdays through the final service day; refuses when a scheduled recent workday lacks earnings or explicit absence (TH LPA s.118) |
| `employment.earned_monthly_average(months, excluded)` | That average with the named filed codes taken back out of each month; `["OVERTIME"]` is every priced work-day line (CN 企业职工带薪年休假实施办法 art.11: 剔除加班工资) |
| `employment.earned_monthly_average(months, excluded, fallback)` | That average, or `fallback` where the stint served no month before the rule date’s month (CN 实施条例 art.27: a leaver in the hiring month averages the one month worked) |
| `employment.prior_service_months` | Months worked for earlier employers before this stint, as recorded on the contract; 0 unrecorded (CN 企业职工带薪年休假实施办法 art.4: annual leave counts cumulative service across employers) |
| `employment.average_daily_wage(months, codes)` | Those wages over the calendar days of the `months` months before the rule date’s month, with the days 施行細則 §2 leaves out removed with their wages: every calendar day the named leave codes’ approved time off spans, paid or not, and — with a third list, `average_daily_wage(months, codes, reduced)` — the days those codes cut the wage (TW 勞基法 §2(4)). Refused where a month of service has no payslip; read on a pay request only |
| `employment.average_monthly_wage(months, codes)` | That daily average times the covered months’ average days — one month’s average wage (勞動部 台(83)勞動二字第25564號: six months’ wages ÷ 6 where nothing is left out) |
| `employment.on_leave(date, codes)` | Whether approved time off of one of the named leave codes spans that day (TW 勞基法 §13: no employer termination inside the §50 stop or the §59 medical period); none where the site has no leave record |
| `employment.service_months_net(codes, days)` | Completed months of service with the named leave codes’ calendar days disregarded in each twelve months of service where they exceed `days` (MY EA s.60E(3B)); read on a leave rule only |
| `terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — the work-pricing day; leave cash-out has a separate dated rule; 0 where no divisor was evaluated |
| `terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed, less the classes `work_rules.wage_excluded_allowances` names (MY EA s.2 “wages” (c): travelling); on a scheme’s own expression, those counting toward that scheme |
| `terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `terms.gross_monthly` | The gross rate of pay as a month: `terms.monthly_basic` plus the contract’s allowances less the classes `work_rules.gross_excluded_allowances` names (SG EA s.2: travelling, food, housing); at the work day the exclusions apply, elsewhere every allowance counts |
| `terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `terms.statutory_work_category` | Statutory work category of the terms: a code the governing version declares in payroll.vocabularies |
| `terms.weather_dependent_piece` | Weather-dependent piece work uses twelve paid months for ID JKK, JKM and JHT |
| `terms.worksite` | The worksite the terms record: a province or province/locality, or empty |
| `terms.worksite_sector` | The worksite sector the terms record (ID: the five-digit KBLI), or empty |
| `terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `terms.payroll_group` | Payroll group — an employer’s own label, never a statute’s |
| `terms.paid_rest_days` | The contract pays every day of the month, unworked rest days, special days and regular holidays included (the DOLE Handbook’s monthly-paid employee, factor 365) |
| `terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `terms.pass_type` | The work pass: a code the governing version declares in payroll.vocabularies, or empty |
| `terms.tax_residency` | Tax residence declared on the contract, a code the governing version declares in payroll.vocabularies, or empty when unrecorded; each scheme supplies its statutory default |
| `terms.residency_since` | Date residency began as `YYYY-MM-DD`, or empty when unrecorded |
| `terms.notice_days` | Notice days the contract states, 0 when none |
| `terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `terms.comparable_full_time_daily_hours` | Similar full-time employee’s declared normal daily hours, or 0 when unrecorded |
| `terms.comparable_full_time_presence` | PRESENT if a similar full-time employee exists, ABSENT for the statutory fallback, or empty if unknown |
| `terms.working_days_per_week` | Roster-measured working week, days |
| `terms.facts.<key>` | Jurisdiction inputs the version declares in `terms_facts`, recorded on the terms in force; a declared default where unrecorded |
| `terms.fact_keys` | Terms input keys explicitly recorded on the terms in force, before defaults |
| `children.count` | Recorded child relationships active on the rule date, regardless of relationship or recorded death; a legal living-natural-child test needs its own dated function |
| `children.under(n)` | Children under n completed years |
| `children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `children.multiple_born_on(date)` | The infants of a multiple birth: children born on that day, refusing fewer than two (CN Order 619 art.7: 15 days per extra infant) |
| `children.natural_surviving_on(date)` | Natural CHILD records alive on that date, including children born that day; excludes adopted, stepchildren and wards. A death on the same date needs a time-specific determination. |
| `children.natural_surviving_before(date)` | Natural children alive before the named confinement, excluding its newborns |
| `children.natural_surviving_confinements_before(date)` | Previous confinements that produced a natural child still alive at this confinement; children born in one confinement count once |
| `children.citizens` | Children recorded as citizens |
| `children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `children.citizens_under(n)` | Of them, those under n completed years |
| `children.prior_childcare_days` | Childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG GPCL and EA s.87A lifetime caps count every employer) |
| `children.prior_extended_childcare_days` | Extended childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12B(2)(a)(ii)) |
| `children.prior_infant_care_days` | Unpaid infant care leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12D(2)(a)) |
| `children.classed(x)` | Family records in classification x; these counts do not establish tax-relief claims |
| `children.unclassed_under(n)` | Family records with no classification under n completed years; MY tax relief reads scheme.child_claims instead |
| `company.region` | Employing entity region |
| `company.headcount` | Active employments in the entity |
| `company.headcount_citizens` | Of them, the citizens |
| `company.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY; empty outside a payroll |
| `company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `wage_floor_pay.BASE` | The part of BASE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.OVERTIME` | The part of OVERTIME paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.DAY_PAY` | The part of DAY_PAY paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.NIGHT_PREMIUM` | The part of NIGHT_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.OVERTIME_PREMIUM` | The part of OVERTIME_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.ABSENCE` | The part of ABSENCE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.NO_PAY_LEAVE` | The part of NO_PAY_LEAVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.ENCASHMENT` | The part of ENCASHMENT paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.INCENTIVE` | The part of INCENTIVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.NIGHT_WAGE` | The part of NIGHT_WAGE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `facts.<CODE>.elections.<key>` | Declared scheme inputs resolved from the statutory facts effective on the rule date |
| `facts.<CODE>.election_keys` | Keys explicitly supplied on that effective statutory declaration; distinct from resolved defaults |
| `event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `event.wife_prior_living_biological_children` | Wife’s prior living biological children at this birth, or -1 when unrecorded (VN Decree 168/2026 art.2(1)(b)) |
| `event.date` | The day of the event, or empty |
| `event.case.facts.<key>` | The recorded facts and qualifications of the benefit case this event opened (`payroll.benefit_cases`); absent without a case, so read `has(event.case.facts.<key>) && event.case.facts.<key>` |
| `event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `event.child_age` | The named child’s completed years, -1 when none is named |
| `event.child_shared_weeks` | The named child’s allocated shared-parental weeks; -1 when unrecorded, 0 for an explicit zero share |
| `event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `event.estimated_delivery_date` | The named child’s estimated delivery date as certified by a medical practitioner (SG CDCA s.2), or empty |
| `event.adoption_eligibility_date` | The eligibility date of the application to adopt the named child (SG CDCA s.2: the application date for a citizen or PR child, else the dependant’s pass issue date), or empty |
| `period.unpaid_full_days` | Scheduled dates wholly unpaid, counted once per date; paid fractions do not count |
| `period.leave_days.<CODE>` | Approved working-day leave fractions of the named code in the assessment window |
| `period.leave_full_days.<CODE>` | Approved full working dates of the named leave code in the assessment window |
| `period.leave_pay.<CODE>` | The salary the assessment window attributes to the named leave code’s days: salary × leave days ÷ working days, at most the salary |
| `period.working_days` | Scheduled working days of the pay month |
| `period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `period.overtime_days` | Dates in the assessment window with overtime hours or hours inside the night window, counted once per date |
| `period.arrears` | The wage of a deferred earlier period (a joiner after the cut-off) this payslip pays as back pay, already inside BASE; 0 otherwise. A law that prices each contribution month on its own wage caps it separately (ID PP 45/2015 art.29(1)) |

| Function | Meaning |
| --- | --- |
| `round_cent(value)` | Round to the nearest cent |
| `truncate_cent(value)` | Truncate to the cent |
| `up_5_cents(value)` | Round up to the next five cents |
| `round_unit(value)` | Round to the nearest whole unit |
| `floor_unit(value)` | Floor to the whole unit |
| `up_to_unit(value)` | Round up to the whole unit |
| `bracket(base, up_to, step)` | Round a figure up to the next bracket |
| `ladder(base, grades)` | Step a figure up to the next grade in a table |
| `progressive(value, table)` | Apply a progressive [from, base, rate] table |
| `add_months(date, months)` | The calendar day `months` months after a `YYYY-MM-DD` day, clamped to the month’s last day; empty for an empty day |
| `months_through(from, through)` | Months from one `YYYY-MM-DD` day through another inclusive: completed months plus the part month by its days; 0 when either is empty or `through` is before `from` |
| `minimum_wage(region)` | The version’s minimum wage for a region |

## `entry` — One catalogue entry as the run collects it: band amounts and the charged days.

Used by: catalogue bands and entitlement amounts — one claim, allowance or loan entry.

Open prefixes: `limits.<key>`, `year.<key>`, `person.company.facts.<key>`, `person.facts.<key>`, `person.period.leave_full_days.<key>`, `person.period.leave_days.<key>`, `person.period.leave_pay.<key>`, `person.employment.exit_facts.<key>`, `person.terms.facts.<key>`, `entry.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `person.employee.birthday(age)` | Date the given age is reached, as `YYYY-MM-DD`, or empty without a birth date. A leap-day anniversary in a non-leap year falls on 1 March, matching age_on. |
| `person.employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `person.employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Declared dependant count for schemes such as ID PTKP and TW exemptions; child-specific rules read `children` |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race, upper-cased, as a self-help fund row reads it |
| `person.employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employee.presence_recorded` | Whether any stay in the jurisdiction is recorded (`presence_periods`); false leaves a presence test to the declared residency and elections |
| `person.employee.presence_days` | Days present in the jurisdiction in the rule date’s calendar year through the rule date, an entry or exit day whole (MY ITA 1967 s.7(1)(a), (1A); Sch.6 para 21(a)) |
| `person.employee.presence_linked_days` | Consecutive days in the previous calendar year of a stay running unbroken into this one, else 0 (MY ITA s.7(1)(b)) |
| `person.employee.presence_days_in(years_back)` | Days present in the calendar year that many years before the rule date’s, counted as `presence_days` (1 is the previous year; 0 where none is recorded) — MY ITA s.7(1)(c)(ii) counts the preceding years with 90 or more |
| `person.employee.employment_days` | Days present on stays recorded `employment_exercised`, within the stint: the days the employment was exercised in the jurisdiction this calendar year through the rule date (MY ITA Sch.6 para 21(a), 22(a)) |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_days` | Calendar days in the current stint through the rule date, capped at exit; not event-specific employment history |
| `person.employment.service_days_before(date, months)` | Distinct days employed by this entity in the stated calendar-month window immediately before the event date; all same-entity stints are supplied by payroll, and missing history refuses |
| `person.employment.service_months` | Completed months since the stint began; a leaver counts through the exit day |
| `person.employment.service_months_exact` | Completed months plus the part month as a share of its days, for a pro-rata part year |
| `person.employment.service_years` | Completed years since the stint began; a leaver counts through the exit day |
| `person.employment.service_years_on(date)` | Completed service years on a specified calendar date on or after hire |
| `person.employment.notice_days_remaining(days, given_on, waived_days)` | Unserved calendar notice days after the last service day; written notice includes its giving day, empty given_on means no notice. Waived days remove the final unserved days; excessive waiver or invalid dates refuse |
| `person.employment.notice_monthly_wages(monthly_wage, days, given_on, waived_days)` | Constant monthly wages over the unserved notice interval, divided separately by each calendar month’s actual length. Does not select the legal wage components or handle changing/non-monthly wages; rounding belongs to the rule |
| `person.employment.payday_notice_days(given_on, pay_frequency, company_pay_frequency)` | Notice length, as `days` for the two functions above, that takes effect on the payday after the first payday on or after given_on (TH LPA s.17 para.2); empty given_on prices from the removal day |
| `person.employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `person.employment.rule_date` | The rule date as `YYYY-MM-DD`; a `wages.contract_rules` rule reads the first day of its floor segment |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.days_to_exit` | Calendar days from the rule date to the exit date: 0 on the exit day or while open. A leave rule reads it on each day charged (TW 勞基法 §16(2): only inside the notice, `employment.days_to_exit < employment.exit_facts.notice_days_given`) |
| `person.employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `person.employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `person.employment.contract_days` | Calendar days of a fixed-term contract, first day to last inclusive (LHDN MTD Specification 2026 D(a) note: a foreign employee on a contract of 182 days or more is withheld at resident MTD); 0 where open-ended |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.exit_facts.<key>` | Departure inputs declared by the settings version effective on the final service day |
| `person.employment.exit_fact_keys` | Departure keys explicitly recorded on the employment, before defaults |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.employment.earned_monthly_average(months)` | The wages earlier payslips paid (basic, regular cash for work, overtime, less unpaid days; no bonus or reimbursement) over the `months` calendar months before the rule date’s month, per month of service, a part first month counted as its share (ID Permenaker 6/2016 art.3(3)–(4); MY reg.6(2) as twelve of them). Refused where a month of service has no payslip; read on a pay request or a leave cash-out |
| `person.employment.piece_wages_last_workdays(days)` | Earned units times unit rate on the last `days` piece-rate workdays through the final service day; refuses when a scheduled recent workday lacks earnings or explicit absence (TH LPA s.118) |
| `person.employment.earned_monthly_average(months, excluded)` | That average with the named filed codes taken back out of each month; `["OVERTIME"]` is every priced work-day line (CN 企业职工带薪年休假实施办法 art.11: 剔除加班工资) |
| `person.employment.earned_monthly_average(months, excluded, fallback)` | That average, or `fallback` where the stint served no month before the rule date’s month (CN 实施条例 art.27: a leaver in the hiring month averages the one month worked) |
| `person.employment.prior_service_months` | Months worked for earlier employers before this stint, as recorded on the contract; 0 unrecorded (CN 企业职工带薪年休假实施办法 art.4: annual leave counts cumulative service across employers) |
| `person.employment.average_daily_wage(months, codes)` | Those wages over the calendar days of the `months` months before the rule date’s month, with the days 施行細則 §2 leaves out removed with their wages: every calendar day the named leave codes’ approved time off spans, paid or not, and — with a third list, `average_daily_wage(months, codes, reduced)` — the days those codes cut the wage (TW 勞基法 §2(4)). Refused where a month of service has no payslip; read on a pay request only |
| `person.employment.average_monthly_wage(months, codes)` | That daily average times the covered months’ average days — one month’s average wage (勞動部 台(83)勞動二字第25564號: six months’ wages ÷ 6 where nothing is left out) |
| `person.employment.on_leave(date, codes)` | Whether approved time off of one of the named leave codes spans that day (TW 勞基法 §13: no employer termination inside the §50 stop or the §59 medical period); none where the site has no leave record |
| `person.employment.service_months_net(codes, days)` | Completed months of service with the named leave codes’ calendar days disregarded in each twelve months of service where they exceed `days` (MY EA s.60E(3B)); read on a leave rule only |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — the work-pricing day; leave cash-out has a separate dated rule; 0 where no divisor was evaluated |
| `person.terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed, less the classes `work_rules.wage_excluded_allowances` names (MY EA s.2 “wages” (c): travelling); on a scheme’s own expression, those counting toward that scheme |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.gross_monthly` | The gross rate of pay as a month: `terms.monthly_basic` plus the contract’s allowances less the classes `work_rules.gross_excluded_allowances` names (SG EA s.2: travelling, food, housing); at the work day the exclusions apply, elsewhere every allowance counts |
| `person.terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.statutory_work_category` | Statutory work category of the terms: a code the governing version declares in payroll.vocabularies |
| `person.terms.weather_dependent_piece` | Weather-dependent piece work uses twelve paid months for ID JKK, JKM and JHT |
| `person.terms.worksite` | The worksite the terms record: a province or province/locality, or empty |
| `person.terms.worksite_sector` | The worksite sector the terms record (ID: the five-digit KBLI), or empty |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group — an employer’s own label, never a statute’s |
| `person.terms.paid_rest_days` | The contract pays every day of the month, unworked rest days, special days and regular holidays included (the DOLE Handbook’s monthly-paid employee, factor 365) |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | The work pass: a code the governing version declares in payroll.vocabularies, or empty |
| `person.terms.tax_residency` | Tax residence declared on the contract, a code the governing version declares in payroll.vocabularies, or empty when unrecorded; each scheme supplies its statutory default |
| `person.terms.residency_since` | Date residency began as `YYYY-MM-DD`, or empty when unrecorded |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.comparable_full_time_daily_hours` | Similar full-time employee’s declared normal daily hours, or 0 when unrecorded |
| `person.terms.comparable_full_time_presence` | PRESENT if a similar full-time employee exists, ABSENT for the statutory fallback, or empty if unknown |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.terms.facts.<key>` | Jurisdiction inputs the version declares in `terms_facts`, recorded on the terms in force; a declared default where unrecorded |
| `person.terms.fact_keys` | Terms input keys explicitly recorded on the terms in force, before defaults |
| `person.children.count` | Recorded child relationships active on the rule date, regardless of relationship or recorded death; a legal living-natural-child test needs its own dated function |
| `person.children.under(n)` | Children under n completed years |
| `person.children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `person.children.multiple_born_on(date)` | The infants of a multiple birth: children born on that day, refusing fewer than two (CN Order 619 art.7: 15 days per extra infant) |
| `person.children.natural_surviving_on(date)` | Natural CHILD records alive on that date, including children born that day; excludes adopted, stepchildren and wards. A death on the same date needs a time-specific determination. |
| `person.children.natural_surviving_before(date)` | Natural children alive before the named confinement, excluding its newborns |
| `person.children.natural_surviving_confinements_before(date)` | Previous confinements that produced a natural child still alive at this confinement; children born in one confinement count once |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.children.prior_childcare_days` | Childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG GPCL and EA s.87A lifetime caps count every employer) |
| `person.children.prior_extended_childcare_days` | Extended childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12B(2)(a)(ii)) |
| `person.children.prior_infant_care_days` | Unpaid infant care leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12D(2)(a)) |
| `person.children.classed(x)` | Family records in classification x; these counts do not establish tax-relief claims |
| `person.children.unclassed_under(n)` | Family records with no classification under n completed years; MY tax relief reads scheme.child_claims instead |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY; empty outside a payroll |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.wage_floor_pay.BASE` | The part of BASE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.OVERTIME` | The part of OVERTIME paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.DAY_PAY` | The part of DAY_PAY paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NIGHT_PREMIUM` | The part of NIGHT_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.OVERTIME_PREMIUM` | The part of OVERTIME_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.ABSENCE` | The part of ABSENCE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NO_PAY_LEAVE` | The part of NO_PAY_LEAVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.ENCASHMENT` | The part of ENCASHMENT paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.INCENTIVE` | The part of INCENTIVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NIGHT_WAGE` | The part of NIGHT_WAGE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `person.facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `person.facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `person.facts.<CODE>.elections.<key>` | Declared scheme inputs resolved from the statutory facts effective on the rule date |
| `person.facts.<CODE>.election_keys` | Keys explicitly supplied on that effective statutory declaration; distinct from resolved defaults |
| `person.event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `person.event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `person.event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `person.event.wife_prior_living_biological_children` | Wife’s prior living biological children at this birth, or -1 when unrecorded (VN Decree 168/2026 art.2(1)(b)) |
| `person.event.date` | The day of the event, or empty |
| `person.event.case.facts.<key>` | The recorded facts and qualifications of the benefit case this event opened (`payroll.benefit_cases`); absent without a case, so read `has(event.case.facts.<key>) && event.case.facts.<key>` |
| `person.event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `person.event.child_age` | The named child’s completed years, -1 when none is named |
| `person.event.child_shared_weeks` | The named child’s allocated shared-parental weeks; -1 when unrecorded, 0 for an explicit zero share |
| `person.event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `person.event.estimated_delivery_date` | The named child’s estimated delivery date as certified by a medical practitioner (SG CDCA s.2), or empty |
| `person.event.adoption_eligibility_date` | The eligibility date of the application to adopt the named child (SG CDCA s.2: the application date for a citizen or PR child, else the dependant’s pass issue date), or empty |
| `person.period.unpaid_full_days` | Scheduled dates wholly unpaid, counted once per date; paid fractions do not count |
| `person.period.leave_days.<CODE>` | Approved working-day leave fractions of the named code in the assessment window |
| `person.period.leave_full_days.<CODE>` | Approved full working dates of the named leave code in the assessment window |
| `person.period.leave_pay.<CODE>` | The salary the assessment window attributes to the named leave code’s days: salary × leave days ÷ working days, at most the salary |
| `person.period.working_days` | Scheduled working days of the pay month |
| `person.period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `person.period.overtime_days` | Dates in the assessment window with overtime hours or hours inside the night window, counted once per date |
| `person.period.arrears` | The wage of a deferred earlier period (a joiner after the cut-off) this payslip pays as back pay, already inside BASE; 0 otherwise. A law that prices each contribution month on its own wage caps it separately (ID PP 45/2015 art.29(1)) |
| `entry.amount` | The keyed amount; zero where the entry carries none |
| `entry.days` | Charged days |
| `entry.hours` | Recorded hours |
| `entry.quantity` | Recorded quantity |
| `entry.event_date` | The day the entry belongs to |
| `entry.period` | Pay period key the entry settles in |
| `entry.religious_holidays` | Published holidays of the entity in the entry’s calendar year that name the employee’s recorded religion (`jurisdiction_holidays.religion`); 0 without a religion or a tagged day. ID Permenaker 6/2016 art.5(2): the same holiday twice in a year is two THRs |
| `entry.incurred_on` | The day a claimed expense was incurred; empty off a claim |
| `entry.due_on` | The day a claim becomes payable where later than the expense (`claim_requests.due_on`), else empty |
| `entry.facts.<key>` | Request inputs the catalogue row declares in `request_facts`, recorded on the request; a declared default where unrecorded |
| `entry.late_wage.due_on` | Day the late wage was due |
| `entry.late_wage.paid_on` | Day the late wage was paid |
| `entry.late_wage.days` | Calendar days from the due day to the paid day; 0 without a late wage |
| `entry.late_wage.deposit_rate` | The payroll bank’s published 1-month term-deposit rate (% a year) on the paid day (VN Labour Code art.97(4)) |
| `entry.late_wage.force_majeure` | The delay was caused by force majeure |
| `entry.window.start` | Standing allowance window start |
| `entry.window.end` | Standing allowance window end |
| `entry.captures.remaining` | Amount still to settle |
| `rates.ordinary_day` | Ordinary day rate for the entry date |
| `entry.unpaid_salary` | Salary earned but unpaid on this final payslip, before tax and statutory deductions (PH RA 10361 s.32) |
| `rates.ordinary_hour` | Ordinary hour rate for the entry date |
| `limits.<key>` | Evaluated work limit, net worked hours |
| `period.key` | YYYY-MM or YYYY-MM-n |
| `period.month` | The pay month, 1–12 |
| `period.start` | First day of the pay period |
| `period.end` | Last day of the pay period |
| `period.pay_date` | Scheduled day this payroll run pays income |
| `period.index` | Which instalment of the month this period is |
| `period.instalments` | Instalments the month is paid in |
| `period.month_factor` | What this instalment’s wage is multiplied by to state the month’s: 1 for a month, 2 for a half, 52/12 for a week — a MONTH-assessed scheme’s base is scaled by it, so a base that already states the month divides by it |
| `period.last_of_year` | This period closes the tax year, or is a leaver’s last |
| `period.days_employed` | Days of the pay month the employment covered, in the proration basis’s units (the payslip’s proration segments summed) |
| `period.days_in_month` | Calendar days of the pay month |
| `year.start` | First day of the tax year |
| `year.end` | Last day of the tax year |
| `year.months_employed` | The calendar months of the tax year this employment touches through the period end, the join and exit months counted whole |
| `year.earned.<code>` | Earned under a component code this tax year: earlier PAID payslips only, plus this run’s own lines where the site prices them |
| `year.earned.ABSENCE` | Every unpaid day this tax year, absence and no-pay leave, as a magnitude: `earned.BASIC - earned.ABSENCE` is the basic actually earned |
| `leave.days(code)` | Charged days of one leave code in the leave window this payslip settles |

| Function | Meaning |
| --- | --- |
| `round_cent(value)` | Round to the nearest cent |
| `truncate_cent(value)` | Truncate to the cent |
| `up_5_cents(value)` | Round up to the next five cents |
| `round_unit(value)` | Round to the nearest whole unit |
| `floor_unit(value)` | Floor to the whole unit |
| `up_to_unit(value)` | Round up to the whole unit |
| `bracket(base, up_to, step)` | Round a figure up to the next bracket |
| `ladder(base, grades)` | Step a figure up to the next grade in a table |
| `progressive(value, table)` | Apply a progressive [from, base, rate] table |
| `add_months(date, months)` | The calendar day `months` months after a `YYYY-MM-DD` day, clamped to the month’s last day; empty for an empty day |
| `months_through(from, through)` | Months from one `YYYY-MM-DD` day through another inclusive: completed months plus the part month by its days; 0 when either is empty or `through` is before `from` |
| `minimum_wage(region)` | The version’s minimum wage for a region |
| `leave.days(code)` | Charged days of one leave code in the leave window this payslip settles |

## `work_day` — One priced person-day: work bands and owed breaks.

Used by: work bands, breaks, limits and the night premium — one priced person-day.

Bare names: `age_years`, `attendance_recorded`, `first_work_at`, `night_worked`, `first_night_at`, `holiday_work`, `overtime_work`, `rest_minutes_total`, `longest_rest_minutes`, `longest_run_hours`, `rest_before_overtime_minutes`, `shift_hours`, `shift_start_at`, `stated_day_hours`, `day_fact_keys`, `date`, `day_type`, `worked_hours`, `normal_hours`, `comparable_full_time_daily_hours`, `hours_beyond_normal`, `hours_from_start_fraction`, `overtime_hours`, `consecutive_hours`, `continuous_attendance`, `rest_day`, `statutory_rest`, `off_day`, `night_hours`, `requested_by`, `emergency_cause`, `time_off_in_lieu`, `ordinary_hour`, `day_wage`, `hours`.

Open prefixes: `limits.<key>`, `day_facts.<key>`, `person.company.facts.<key>`, `person.facts.<key>`, `person.period.leave_full_days.<key>`, `person.period.leave_days.<key>`, `person.period.leave_pay.<key>`, `person.employment.exit_facts.<key>`, `person.terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `person.employee.birthday(age)` | Date the given age is reached, as `YYYY-MM-DD`, or empty without a birth date. A leap-day anniversary in a non-leap year falls on 1 March, matching age_on. |
| `person.employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `person.employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Declared dependant count for schemes such as ID PTKP and TW exemptions; child-specific rules read `children` |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race, upper-cased, as a self-help fund row reads it |
| `person.employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employee.presence_recorded` | Whether any stay in the jurisdiction is recorded (`presence_periods`); false leaves a presence test to the declared residency and elections |
| `person.employee.presence_days` | Days present in the jurisdiction in the rule date’s calendar year through the rule date, an entry or exit day whole (MY ITA 1967 s.7(1)(a), (1A); Sch.6 para 21(a)) |
| `person.employee.presence_linked_days` | Consecutive days in the previous calendar year of a stay running unbroken into this one, else 0 (MY ITA s.7(1)(b)) |
| `person.employee.presence_days_in(years_back)` | Days present in the calendar year that many years before the rule date’s, counted as `presence_days` (1 is the previous year; 0 where none is recorded) — MY ITA s.7(1)(c)(ii) counts the preceding years with 90 or more |
| `person.employee.employment_days` | Days present on stays recorded `employment_exercised`, within the stint: the days the employment was exercised in the jurisdiction this calendar year through the rule date (MY ITA Sch.6 para 21(a), 22(a)) |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_days` | Calendar days in the current stint through the rule date, capped at exit; not event-specific employment history |
| `person.employment.service_days_before(date, months)` | Distinct days employed by this entity in the stated calendar-month window immediately before the event date; all same-entity stints are supplied by payroll, and missing history refuses |
| `person.employment.service_months` | Completed months since the stint began; a leaver counts through the exit day |
| `person.employment.service_months_exact` | Completed months plus the part month as a share of its days, for a pro-rata part year |
| `person.employment.service_years` | Completed years since the stint began; a leaver counts through the exit day |
| `person.employment.service_years_on(date)` | Completed service years on a specified calendar date on or after hire |
| `person.employment.notice_days_remaining(days, given_on, waived_days)` | Unserved calendar notice days after the last service day; written notice includes its giving day, empty given_on means no notice. Waived days remove the final unserved days; excessive waiver or invalid dates refuse |
| `person.employment.notice_monthly_wages(monthly_wage, days, given_on, waived_days)` | Constant monthly wages over the unserved notice interval, divided separately by each calendar month’s actual length. Does not select the legal wage components or handle changing/non-monthly wages; rounding belongs to the rule |
| `person.employment.payday_notice_days(given_on, pay_frequency, company_pay_frequency)` | Notice length, as `days` for the two functions above, that takes effect on the payday after the first payday on or after given_on (TH LPA s.17 para.2); empty given_on prices from the removal day |
| `person.employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `person.employment.rule_date` | The rule date as `YYYY-MM-DD`; a `wages.contract_rules` rule reads the first day of its floor segment |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.days_to_exit` | Calendar days from the rule date to the exit date: 0 on the exit day or while open. A leave rule reads it on each day charged (TW 勞基法 §16(2): only inside the notice, `employment.days_to_exit < employment.exit_facts.notice_days_given`) |
| `person.employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `person.employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `person.employment.contract_days` | Calendar days of a fixed-term contract, first day to last inclusive (LHDN MTD Specification 2026 D(a) note: a foreign employee on a contract of 182 days or more is withheld at resident MTD); 0 where open-ended |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.exit_facts.<key>` | Departure inputs declared by the settings version effective on the final service day |
| `person.employment.exit_fact_keys` | Departure keys explicitly recorded on the employment, before defaults |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.employment.earned_monthly_average(months)` | The wages earlier payslips paid (basic, regular cash for work, overtime, less unpaid days; no bonus or reimbursement) over the `months` calendar months before the rule date’s month, per month of service, a part first month counted as its share (ID Permenaker 6/2016 art.3(3)–(4); MY reg.6(2) as twelve of them). Refused where a month of service has no payslip; read on a pay request or a leave cash-out |
| `person.employment.piece_wages_last_workdays(days)` | Earned units times unit rate on the last `days` piece-rate workdays through the final service day; refuses when a scheduled recent workday lacks earnings or explicit absence (TH LPA s.118) |
| `person.employment.earned_monthly_average(months, excluded)` | That average with the named filed codes taken back out of each month; `["OVERTIME"]` is every priced work-day line (CN 企业职工带薪年休假实施办法 art.11: 剔除加班工资) |
| `person.employment.earned_monthly_average(months, excluded, fallback)` | That average, or `fallback` where the stint served no month before the rule date’s month (CN 实施条例 art.27: a leaver in the hiring month averages the one month worked) |
| `person.employment.prior_service_months` | Months worked for earlier employers before this stint, as recorded on the contract; 0 unrecorded (CN 企业职工带薪年休假实施办法 art.4: annual leave counts cumulative service across employers) |
| `person.employment.average_daily_wage(months, codes)` | Those wages over the calendar days of the `months` months before the rule date’s month, with the days 施行細則 §2 leaves out removed with their wages: every calendar day the named leave codes’ approved time off spans, paid or not, and — with a third list, `average_daily_wage(months, codes, reduced)` — the days those codes cut the wage (TW 勞基法 §2(4)). Refused where a month of service has no payslip; read on a pay request only |
| `person.employment.average_monthly_wage(months, codes)` | That daily average times the covered months’ average days — one month’s average wage (勞動部 台(83)勞動二字第25564號: six months’ wages ÷ 6 where nothing is left out) |
| `person.employment.on_leave(date, codes)` | Whether approved time off of one of the named leave codes spans that day (TW 勞基法 §13: no employer termination inside the §50 stop or the §59 medical period); none where the site has no leave record |
| `person.employment.service_months_net(codes, days)` | Completed months of service with the named leave codes’ calendar days disregarded in each twelve months of service where they exceed `days` (MY EA s.60E(3B)); read on a leave rule only |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — the work-pricing day; leave cash-out has a separate dated rule; 0 where no divisor was evaluated |
| `person.terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed, less the classes `work_rules.wage_excluded_allowances` names (MY EA s.2 “wages” (c): travelling); on a scheme’s own expression, those counting toward that scheme |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.gross_monthly` | The gross rate of pay as a month: `terms.monthly_basic` plus the contract’s allowances less the classes `work_rules.gross_excluded_allowances` names (SG EA s.2: travelling, food, housing); at the work day the exclusions apply, elsewhere every allowance counts |
| `person.terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.statutory_work_category` | Statutory work category of the terms: a code the governing version declares in payroll.vocabularies |
| `person.terms.weather_dependent_piece` | Weather-dependent piece work uses twelve paid months for ID JKK, JKM and JHT |
| `person.terms.worksite` | The worksite the terms record: a province or province/locality, or empty |
| `person.terms.worksite_sector` | The worksite sector the terms record (ID: the five-digit KBLI), or empty |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group — an employer’s own label, never a statute’s |
| `person.terms.paid_rest_days` | The contract pays every day of the month, unworked rest days, special days and regular holidays included (the DOLE Handbook’s monthly-paid employee, factor 365) |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | The work pass: a code the governing version declares in payroll.vocabularies, or empty |
| `person.terms.tax_residency` | Tax residence declared on the contract, a code the governing version declares in payroll.vocabularies, or empty when unrecorded; each scheme supplies its statutory default |
| `person.terms.residency_since` | Date residency began as `YYYY-MM-DD`, or empty when unrecorded |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.comparable_full_time_daily_hours` | Similar full-time employee’s declared normal daily hours, or 0 when unrecorded |
| `person.terms.comparable_full_time_presence` | PRESENT if a similar full-time employee exists, ABSENT for the statutory fallback, or empty if unknown |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.terms.facts.<key>` | Jurisdiction inputs the version declares in `terms_facts`, recorded on the terms in force; a declared default where unrecorded |
| `person.terms.fact_keys` | Terms input keys explicitly recorded on the terms in force, before defaults |
| `person.children.count` | Recorded child relationships active on the rule date, regardless of relationship or recorded death; a legal living-natural-child test needs its own dated function |
| `person.children.under(n)` | Children under n completed years |
| `person.children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `person.children.multiple_born_on(date)` | The infants of a multiple birth: children born on that day, refusing fewer than two (CN Order 619 art.7: 15 days per extra infant) |
| `person.children.natural_surviving_on(date)` | Natural CHILD records alive on that date, including children born that day; excludes adopted, stepchildren and wards. A death on the same date needs a time-specific determination. |
| `person.children.natural_surviving_before(date)` | Natural children alive before the named confinement, excluding its newborns |
| `person.children.natural_surviving_confinements_before(date)` | Previous confinements that produced a natural child still alive at this confinement; children born in one confinement count once |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.children.prior_childcare_days` | Childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG GPCL and EA s.87A lifetime caps count every employer) |
| `person.children.prior_extended_childcare_days` | Extended childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12B(2)(a)(ii)) |
| `person.children.prior_infant_care_days` | Unpaid infant care leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12D(2)(a)) |
| `person.children.classed(x)` | Family records in classification x; these counts do not establish tax-relief claims |
| `person.children.unclassed_under(n)` | Family records with no classification under n completed years; MY tax relief reads scheme.child_claims instead |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY; empty outside a payroll |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.wage_floor_pay.BASE` | The part of BASE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.OVERTIME` | The part of OVERTIME paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.DAY_PAY` | The part of DAY_PAY paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NIGHT_PREMIUM` | The part of NIGHT_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.OVERTIME_PREMIUM` | The part of OVERTIME_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.ABSENCE` | The part of ABSENCE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NO_PAY_LEAVE` | The part of NO_PAY_LEAVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.ENCASHMENT` | The part of ENCASHMENT paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.INCENTIVE` | The part of INCENTIVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NIGHT_WAGE` | The part of NIGHT_WAGE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `person.facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `person.facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `person.facts.<CODE>.elections.<key>` | Declared scheme inputs resolved from the statutory facts effective on the rule date |
| `person.facts.<CODE>.election_keys` | Keys explicitly supplied on that effective statutory declaration; distinct from resolved defaults |
| `person.event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `person.event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `person.event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `person.event.wife_prior_living_biological_children` | Wife’s prior living biological children at this birth, or -1 when unrecorded (VN Decree 168/2026 art.2(1)(b)) |
| `person.event.date` | The day of the event, or empty |
| `person.event.case.facts.<key>` | The recorded facts and qualifications of the benefit case this event opened (`payroll.benefit_cases`); absent without a case, so read `has(event.case.facts.<key>) && event.case.facts.<key>` |
| `person.event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `person.event.child_age` | The named child’s completed years, -1 when none is named |
| `person.event.child_shared_weeks` | The named child’s allocated shared-parental weeks; -1 when unrecorded, 0 for an explicit zero share |
| `person.event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `person.event.estimated_delivery_date` | The named child’s estimated delivery date as certified by a medical practitioner (SG CDCA s.2), or empty |
| `person.event.adoption_eligibility_date` | The eligibility date of the application to adopt the named child (SG CDCA s.2: the application date for a citizen or PR child, else the dependant’s pass issue date), or empty |
| `person.period.unpaid_full_days` | Scheduled dates wholly unpaid, counted once per date; paid fractions do not count |
| `person.period.leave_days.<CODE>` | Approved working-day leave fractions of the named code in the assessment window |
| `person.period.leave_full_days.<CODE>` | Approved full working dates of the named leave code in the assessment window |
| `person.period.leave_pay.<CODE>` | The salary the assessment window attributes to the named leave code’s days: salary × leave days ÷ working days, at most the salary |
| `person.period.working_days` | Scheduled working days of the pay month |
| `person.period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `person.period.overtime_days` | Dates in the assessment window with overtime hours or hours inside the night window, counted once per date |
| `person.period.arrears` | The wage of a deferred earlier period (a joiner after the cut-off) this payslip pays as back pay, already inside BASE; 0 otherwise. A law that prices each contribution month on its own wage caps it separately (ID PP 45/2015 art.29(1)) |
| `date` | The day |
| `day_type` | ORDINARY \| REST_DAY \| PUBLIC_HOLIDAY \| SPECIAL_HOLIDAY \| OFF_DAY |
| `worked_hours` | Net worked hours |
| `normal_hours` | The scheduled normal hours |
| `comparable_full_time_daily_hours` | Similar full-time employee’s normal hours for this date, or the terms’ usual day |
| `hours_beyond_normal` | Worked hours past the normal day |
| `hours_from_start_fraction` | Worked share of a normal day, 0..1 |
| `overtime_hours` | Payable overtime hours: the approved hours plus the day type’s clock-derived premium |
| `consecutive_hours` | Longest unbroken work run in the day |
| `continuous_attendance` | Work that must be carried on continuously |
| `rest_day` | The roster’s weekly rest day, whatever the holiday made it |
| `statutory_rest` | The rest day the statute forbids work on — a REST code marked `statutory` (TW 勞基法 §36 例假; §40 pays a worked one a further day’s wage and owes a day off in lieu) |
| `off_day` | The roster left the day unassigned before the holiday |
| `night_hours` | Hours inside the night window, 0 where none is declared; a break rule reads it too |
| `requested_by` | EMPLOYER \| EMPLOYEE: who asked for rest-day work |
| `emergency_cause` | The extra hours were forced by a disaster, accident or emergency (`work_days.emergency_cause`; TW 勞基法 §32(4), paid double by §24(1)(3)); outside the hours ceilings |
| `time_off_in_lieu` | The worker elected time off instead of overtime pay (`work_days.time_off_in_lieu`; TW 勞基法 §32-1); bands honouring it leave the hours unpriced and the run warns what they would have paid |
| `ordinary_hour` | Ordinary hour rate |
| `day_wage` | Ordinary day wage |
| `hours` | The hours this band consumed, for its price |
| `limits.<key>` | Evaluated work limit, net worked hours |
| `holiday.kind` | The published row on the date, in the day-type words: PUBLIC_HOLIDAY \| SPECIAL_HOLIDAY \| SUBSTITUTE \| DOUBLE_HOLIDAY (two regular holidays on one date), or empty; unlike `day_type` it does not move with the precedence rule |
| `holiday.name` | Published holiday name, or empty |
| `holiday.prior_day_present` | Present, or on leave with pay, on the workday immediately preceding the holiday — a rest or non-work day, or an unworked holiday, looks further back (PH Handbook ch.2 §D–E); true on a day with no holiday |
| `day_facts.<key>` | Jurisdiction inputs the version declares in `work_day_facts`, recorded on this person-day (`work_days.facts`); a declared default where unrecorded |
| `day_fact_keys` | Work-day input keys explicitly recorded on this person-day, before defaults |
| `age_years` | Completed years on the day; 0 without a birth date — read by `day_rules` and `overtime_consent`, not by bands |
| `attendance_recorded` | The day carries attendance (`worked_intervals` is set); otherwise its shift is presumed worked — read by `day_rules` and `overtime_consent`, not by bands |
| `first_work_at` | The first worked instant, a UTC ISO instant (`YYYY-MM-DDTHH:mm:ss.sssZ`), or empty — read by `day_rules` and `overtime_consent`, not by bands |
| `night_worked` | Some work fell inside `work_rules.night_window` — read by `day_rules` and `overtime_consent`, not by bands |
| `first_night_at` | The first worked instant inside the night window, or empty — read by `day_rules` and `overtime_consent`, not by bands |
| `holiday_work` | Work on a day that is not ORDINARY — read by `day_rules` and `overtime_consent`, not by bands |
| `overtime_work` | Work on an ORDINARY day beyond its normal hours — read by `day_rules` and `overtime_consent`, not by bands |
| `rest_minutes_total` | Minutes of rest between the day’s work spans (a presumed shift’s break) — read by `day_rules` and `overtime_consent`, not by bands |
| `longest_rest_minutes` | The longest single timed rest between work spans — read by `day_rules` and `overtime_consent`, not by bands |
| `longest_run_hours` | The longest unbroken work span — read by `day_rules` and `overtime_consent`, not by bands |
| `rest_before_overtime_minutes` | Minutes between the end of the normal hours and the first overtime hour, 0 without overtime — read by `day_rules` and `overtime_consent`, not by bands |
| `shift_hours` | The rostered shift’s paid hours, 0 without a shift — read by `day_rules` and `overtime_consent`, not by bands |
| `shift_start_at` | The rostered shift’s start, a UTC ISO instant, or empty without a shift — read by `day_rules` and `overtime_consent`, not by bands |
| `stated_day_hours` | The statute’s normal day bounded by the contract’s stated day — read by `shift_day_hours` only, beside `person`, `date` and `day_facts` |

| Function | Meaning |
| --- | --- |
| `round_cent(value)` | Round to the nearest cent |
| `truncate_cent(value)` | Truncate to the cent |
| `up_5_cents(value)` | Round up to the next five cents |
| `round_unit(value)` | Round to the nearest whole unit |
| `floor_unit(value)` | Floor to the whole unit |
| `up_to_unit(value)` | Round up to the whole unit |
| `bracket(base, up_to, step)` | Round a figure up to the next bracket |
| `ladder(base, grades)` | Step a figure up to the next grade in a table |
| `progressive(value, table)` | Apply a progressive [from, base, rate] table |
| `add_months(date, months)` | The calendar day `months` months after a `YYYY-MM-DD` day, clamped to the month’s last day; empty for an empty day |
| `months_through(from, through)` | Months from one `YYYY-MM-DD` day through another inclusive: completed months plus the part month by its days; 0 when either is empty or `through` is before `from` |
| `run_hours_before_rest(minutes)` | Hours worked before the day’s first rest of at least `minutes` (a double, `60.0`); the whole day where none — read by `day_rules` and `overtime_consent` |

## `assessment` — One scheme’s wage: the reserved lines, the catalogue rows and the shared roots.

Used by: `statutory_contributions.assessed_on` and `ordinary_on` — one scheme’s wage.

Bare names: `BASE`, `OVERTIME`, `DAY_PAY`, `NIGHT_PREMIUM`, `OVERTIME_PREMIUM`, `ABSENCE`, `NO_PAY_LEAVE`, `ENCASHMENT`, `INCENTIVE`, `NIGHT_WAGE`, `ALLOWANCES`, `ADHOC`, `CLAIMS`.

Open prefixes: `produced.<key>`, `history.<key>`, `year.<key>`, `scheme.elections.<key>`, `scheme.child_claims.<key>`, `scheme.deductions.<key>`, `scheme.deductions_current.<key>`, `scheme.deductions_prior.<key>`, `scheme.deductions_prior_employer.<key>`, `scheme.deduction_claim_counts.<key>`, `scheme.deduction_claims_missing_event.<key>`, `scheme.deduction_claims_negative_event.<key>`, `scheme.deductions_last_year.<key>`, `scheme.deductions_two_years_ago.<key>`, `person.company.facts.<key>`, `person.facts.<key>`, `person.period.leave_full_days.<key>`, `person.period.leave_days.<key>`, `person.period.leave_pay.<key>`, `person.employment.exit_facts.<key>`, `person.terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `person.employee.birthday(age)` | Date the given age is reached, as `YYYY-MM-DD`, or empty without a birth date. A leap-day anniversary in a non-leap year falls on 1 March, matching age_on. |
| `person.employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `person.employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Declared dependant count for schemes such as ID PTKP and TW exemptions; child-specific rules read `children` |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race, upper-cased, as a self-help fund row reads it |
| `person.employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employee.presence_recorded` | Whether any stay in the jurisdiction is recorded (`presence_periods`); false leaves a presence test to the declared residency and elections |
| `person.employee.presence_days` | Days present in the jurisdiction in the rule date’s calendar year through the rule date, an entry or exit day whole (MY ITA 1967 s.7(1)(a), (1A); Sch.6 para 21(a)) |
| `person.employee.presence_linked_days` | Consecutive days in the previous calendar year of a stay running unbroken into this one, else 0 (MY ITA s.7(1)(b)) |
| `person.employee.presence_days_in(years_back)` | Days present in the calendar year that many years before the rule date’s, counted as `presence_days` (1 is the previous year; 0 where none is recorded) — MY ITA s.7(1)(c)(ii) counts the preceding years with 90 or more |
| `person.employee.employment_days` | Days present on stays recorded `employment_exercised`, within the stint: the days the employment was exercised in the jurisdiction this calendar year through the rule date (MY ITA Sch.6 para 21(a), 22(a)) |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_days` | Calendar days in the current stint through the rule date, capped at exit; not event-specific employment history |
| `person.employment.service_days_before(date, months)` | Distinct days employed by this entity in the stated calendar-month window immediately before the event date; all same-entity stints are supplied by payroll, and missing history refuses |
| `person.employment.service_months` | Completed months since the stint began; a leaver counts through the exit day |
| `person.employment.service_months_exact` | Completed months plus the part month as a share of its days, for a pro-rata part year |
| `person.employment.service_years` | Completed years since the stint began; a leaver counts through the exit day |
| `person.employment.service_years_on(date)` | Completed service years on a specified calendar date on or after hire |
| `person.employment.notice_days_remaining(days, given_on, waived_days)` | Unserved calendar notice days after the last service day; written notice includes its giving day, empty given_on means no notice. Waived days remove the final unserved days; excessive waiver or invalid dates refuse |
| `person.employment.notice_monthly_wages(monthly_wage, days, given_on, waived_days)` | Constant monthly wages over the unserved notice interval, divided separately by each calendar month’s actual length. Does not select the legal wage components or handle changing/non-monthly wages; rounding belongs to the rule |
| `person.employment.payday_notice_days(given_on, pay_frequency, company_pay_frequency)` | Notice length, as `days` for the two functions above, that takes effect on the payday after the first payday on or after given_on (TH LPA s.17 para.2); empty given_on prices from the removal day |
| `person.employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `person.employment.rule_date` | The rule date as `YYYY-MM-DD`; a `wages.contract_rules` rule reads the first day of its floor segment |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.days_to_exit` | Calendar days from the rule date to the exit date: 0 on the exit day or while open. A leave rule reads it on each day charged (TW 勞基法 §16(2): only inside the notice, `employment.days_to_exit < employment.exit_facts.notice_days_given`) |
| `person.employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `person.employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `person.employment.contract_days` | Calendar days of a fixed-term contract, first day to last inclusive (LHDN MTD Specification 2026 D(a) note: a foreign employee on a contract of 182 days or more is withheld at resident MTD); 0 where open-ended |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.exit_facts.<key>` | Departure inputs declared by the settings version effective on the final service day |
| `person.employment.exit_fact_keys` | Departure keys explicitly recorded on the employment, before defaults |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.employment.earned_monthly_average(months)` | The wages earlier payslips paid (basic, regular cash for work, overtime, less unpaid days; no bonus or reimbursement) over the `months` calendar months before the rule date’s month, per month of service, a part first month counted as its share (ID Permenaker 6/2016 art.3(3)–(4); MY reg.6(2) as twelve of them). Refused where a month of service has no payslip; read on a pay request or a leave cash-out |
| `person.employment.piece_wages_last_workdays(days)` | Earned units times unit rate on the last `days` piece-rate workdays through the final service day; refuses when a scheduled recent workday lacks earnings or explicit absence (TH LPA s.118) |
| `person.employment.earned_monthly_average(months, excluded)` | That average with the named filed codes taken back out of each month; `["OVERTIME"]` is every priced work-day line (CN 企业职工带薪年休假实施办法 art.11: 剔除加班工资) |
| `person.employment.earned_monthly_average(months, excluded, fallback)` | That average, or `fallback` where the stint served no month before the rule date’s month (CN 实施条例 art.27: a leaver in the hiring month averages the one month worked) |
| `person.employment.prior_service_months` | Months worked for earlier employers before this stint, as recorded on the contract; 0 unrecorded (CN 企业职工带薪年休假实施办法 art.4: annual leave counts cumulative service across employers) |
| `person.employment.average_daily_wage(months, codes)` | Those wages over the calendar days of the `months` months before the rule date’s month, with the days 施行細則 §2 leaves out removed with their wages: every calendar day the named leave codes’ approved time off spans, paid or not, and — with a third list, `average_daily_wage(months, codes, reduced)` — the days those codes cut the wage (TW 勞基法 §2(4)). Refused where a month of service has no payslip; read on a pay request only |
| `person.employment.average_monthly_wage(months, codes)` | That daily average times the covered months’ average days — one month’s average wage (勞動部 台(83)勞動二字第25564號: six months’ wages ÷ 6 where nothing is left out) |
| `person.employment.on_leave(date, codes)` | Whether approved time off of one of the named leave codes spans that day (TW 勞基法 §13: no employer termination inside the §50 stop or the §59 medical period); none where the site has no leave record |
| `person.employment.service_months_net(codes, days)` | Completed months of service with the named leave codes’ calendar days disregarded in each twelve months of service where they exceed `days` (MY EA s.60E(3B)); read on a leave rule only |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — the work-pricing day; leave cash-out has a separate dated rule; 0 where no divisor was evaluated |
| `person.terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed, less the classes `work_rules.wage_excluded_allowances` names (MY EA s.2 “wages” (c): travelling); on a scheme’s own expression, those counting toward that scheme |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.gross_monthly` | The gross rate of pay as a month: `terms.monthly_basic` plus the contract’s allowances less the classes `work_rules.gross_excluded_allowances` names (SG EA s.2: travelling, food, housing); at the work day the exclusions apply, elsewhere every allowance counts |
| `person.terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.statutory_work_category` | Statutory work category of the terms: a code the governing version declares in payroll.vocabularies |
| `person.terms.weather_dependent_piece` | Weather-dependent piece work uses twelve paid months for ID JKK, JKM and JHT |
| `person.terms.worksite` | The worksite the terms record: a province or province/locality, or empty |
| `person.terms.worksite_sector` | The worksite sector the terms record (ID: the five-digit KBLI), or empty |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group — an employer’s own label, never a statute’s |
| `person.terms.paid_rest_days` | The contract pays every day of the month, unworked rest days, special days and regular holidays included (the DOLE Handbook’s monthly-paid employee, factor 365) |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | The work pass: a code the governing version declares in payroll.vocabularies, or empty |
| `person.terms.tax_residency` | Tax residence declared on the contract, a code the governing version declares in payroll.vocabularies, or empty when unrecorded; each scheme supplies its statutory default |
| `person.terms.residency_since` | Date residency began as `YYYY-MM-DD`, or empty when unrecorded |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.comparable_full_time_daily_hours` | Similar full-time employee’s declared normal daily hours, or 0 when unrecorded |
| `person.terms.comparable_full_time_presence` | PRESENT if a similar full-time employee exists, ABSENT for the statutory fallback, or empty if unknown |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.terms.facts.<key>` | Jurisdiction inputs the version declares in `terms_facts`, recorded on the terms in force; a declared default where unrecorded |
| `person.terms.fact_keys` | Terms input keys explicitly recorded on the terms in force, before defaults |
| `person.children.count` | Recorded child relationships active on the rule date, regardless of relationship or recorded death; a legal living-natural-child test needs its own dated function |
| `person.children.under(n)` | Children under n completed years |
| `person.children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `person.children.multiple_born_on(date)` | The infants of a multiple birth: children born on that day, refusing fewer than two (CN Order 619 art.7: 15 days per extra infant) |
| `person.children.natural_surviving_on(date)` | Natural CHILD records alive on that date, including children born that day; excludes adopted, stepchildren and wards. A death on the same date needs a time-specific determination. |
| `person.children.natural_surviving_before(date)` | Natural children alive before the named confinement, excluding its newborns |
| `person.children.natural_surviving_confinements_before(date)` | Previous confinements that produced a natural child still alive at this confinement; children born in one confinement count once |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.children.prior_childcare_days` | Childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG GPCL and EA s.87A lifetime caps count every employer) |
| `person.children.prior_extended_childcare_days` | Extended childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12B(2)(a)(ii)) |
| `person.children.prior_infant_care_days` | Unpaid infant care leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12D(2)(a)) |
| `person.children.classed(x)` | Family records in classification x; these counts do not establish tax-relief claims |
| `person.children.unclassed_under(n)` | Family records with no classification under n completed years; MY tax relief reads scheme.child_claims instead |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY; empty outside a payroll |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.wage_floor_pay.BASE` | The part of BASE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.OVERTIME` | The part of OVERTIME paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.DAY_PAY` | The part of DAY_PAY paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NIGHT_PREMIUM` | The part of NIGHT_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.OVERTIME_PREMIUM` | The part of OVERTIME_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.ABSENCE` | The part of ABSENCE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NO_PAY_LEAVE` | The part of NO_PAY_LEAVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.ENCASHMENT` | The part of ENCASHMENT paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.INCENTIVE` | The part of INCENTIVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NIGHT_WAGE` | The part of NIGHT_WAGE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `person.facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `person.facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `person.facts.<CODE>.elections.<key>` | Declared scheme inputs resolved from the statutory facts effective on the rule date |
| `person.facts.<CODE>.election_keys` | Keys explicitly supplied on that effective statutory declaration; distinct from resolved defaults |
| `person.event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `person.event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `person.event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `person.event.wife_prior_living_biological_children` | Wife’s prior living biological children at this birth, or -1 when unrecorded (VN Decree 168/2026 art.2(1)(b)) |
| `person.event.date` | The day of the event, or empty |
| `person.event.case.facts.<key>` | The recorded facts and qualifications of the benefit case this event opened (`payroll.benefit_cases`); absent without a case, so read `has(event.case.facts.<key>) && event.case.facts.<key>` |
| `person.event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `person.event.child_age` | The named child’s completed years, -1 when none is named |
| `person.event.child_shared_weeks` | The named child’s allocated shared-parental weeks; -1 when unrecorded, 0 for an explicit zero share |
| `person.event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `person.event.estimated_delivery_date` | The named child’s estimated delivery date as certified by a medical practitioner (SG CDCA s.2), or empty |
| `person.event.adoption_eligibility_date` | The eligibility date of the application to adopt the named child (SG CDCA s.2: the application date for a citizen or PR child, else the dependant’s pass issue date), or empty |
| `person.period.unpaid_full_days` | Scheduled dates wholly unpaid, counted once per date; paid fractions do not count |
| `person.period.leave_days.<CODE>` | Approved working-day leave fractions of the named code in the assessment window |
| `person.period.leave_full_days.<CODE>` | Approved full working dates of the named leave code in the assessment window |
| `person.period.leave_pay.<CODE>` | The salary the assessment window attributes to the named leave code’s days: salary × leave days ÷ working days, at most the salary |
| `person.period.working_days` | Scheduled working days of the pay month |
| `person.period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `person.period.overtime_days` | Dates in the assessment window with overtime hours or hours inside the night window, counted once per date |
| `person.period.arrears` | The wage of a deferred earlier period (a joiner after the cut-off) this payslip pays as back pay, already inside BASE; 0 otherwise. A law that prices each contribution month on its own wage caps it separately (ID PP 45/2015 art.29(1)) |
| `period.key` | YYYY-MM or YYYY-MM-n |
| `period.month` | The pay month, 1–12 |
| `period.start` | First day of the pay period |
| `period.end` | Last day of the pay period |
| `period.pay_date` | Scheduled day this payroll run pays income |
| `period.index` | Which instalment of the month this period is |
| `period.instalments` | Instalments the month is paid in |
| `period.month_factor` | What this instalment’s wage is multiplied by to state the month’s: 1 for a month, 2 for a half, 52/12 for a week — a MONTH-assessed scheme’s base is scaled by it, so a base that already states the month divides by it |
| `period.last_of_year` | This period closes the tax year, or is a leaver’s last |
| `period.days_employed` | Days of the pay month the employment covered, in the proration basis’s units (the payslip’s proration segments summed) |
| `period.days_in_month` | Calendar days of the pay month |
| `period.year` | Calendar year of the pay period |
| `year.start` | First day of the tax year |
| `year.end` | Last day of the tax year |
| `year.months_employed` | The calendar months of the tax year this employment touches through the period end, the join and exit months counted whole |
| `year.earned.<code>` | Earned under a component code this tax year: earlier PAID payslips only, plus this run’s own lines where the site prices them |
| `year.earned.ABSENCE` | Every unpaid day this tax year, absence and no-pay leave, as a magnitude: `earned.BASIC - earned.ABSENCE` is the basic actually earned |
| `year.payments` | The payments due in the tax year at this cadence, from the join to the year end (monthly: months, adding declared prior-employer months as `months_employed` does; semi-monthly: halves; weekly: paydays) |
| `scheme.code` | The scheme code |
| `scheme.assessment_period` | PAY_PERIOD \| MONTH \| MONTH_TO_DATE |
| `scheme.registration_status` | The declaration priced by this rule (a historical covered standing when an insured period ended) |
| `scheme.current_registration_status` | The declaration at assessment end; registration_status may instead be a covered historical standing priced for earlier days |
| `scheme.declaration_reference` | The supporting reference for a documented NOT_REGISTERED election |
| `scheme.year_to_date.base` | Base already charged this tax year: this employer’s earlier slips plus what an earlier employer declared on the fact (`opening`) |
| `scheme.year_to_date.ordinary` | The ordinary part of the base already charged this tax year, where the scheme states `ordinary_on` |
| `scheme.year_to_date.employee` | Employee amount already charged this tax year |
| `scheme.year_to_date.employer` | Employer amount already charged this tax year |
| `scheme.year_to_date.rebate` | Rebatable payments already recorded this tax year, including declared prior-employer payments |
| `scheme.last_year.base` | Base this employer charged in the tax year before this one (no prior-employer opening) — ID PP 68/2009 art.2(2) joins severance parts across two calendar years |
| `scheme.last_year.employee` | Employee amount this employer charged in the tax year before this one |
| `scheme.last_year.employer` | Employer amount this employer charged in the tax year before this one |
| `scheme.first_year` | Earliest tax year in which one of this employer’s earlier slips charged a base on this scheme, 0 when none — ID PP 68/2009 art.6 counts the third calendar year from the first severance part |
| `scheme.dependent_months` | Sum of registered eligible dependant counts over the tax year’s twelve months; required for an authorised annual finalisation (VN Decree 253/2026 art.48) |
| `scheme.trailing_short.base` | Average paid wages over the last payroll.trailing_wage_short_months calendar months of this employment, across tax years, for piece work (ID PP 44/2015 art.19(4): 3) |
| `scheme.trailing_short.months` | Months of this employment in the short lookback |
| `scheme.trailing_long.base` | Average paid wages over the last payroll.trailing_wage_long_months calendar months of this employment, across tax years, for weather-dependent piece work (ID PP 44/2015 art.19(5): 12) |
| `scheme.trailing_long.months` | Months of this employment in the long lookback |
| `scheme.projection.payslips_remaining` | Payslips left in the year, this one included |
| `scheme.projection.future_equivalents` | Future payslips of this size |
| `scheme.rate_override` | The employment flat rate override percentage, 0 when none |
| `scheme.since` | The day this employment registered with the scheme, or empty |
| `scheme.first_contribution_due_on` | First date contributions were legally due under this scheme, including earlier employers, or empty. Independent of registration and payment dates. |
| `scheme.since_months` | Completed months since registration, 0 when unrecorded |
| `scheme.elections.<key>` | The employment’s elections under this scheme, keys the scheme row declares |
| `scheme.election_keys` | Keys explicitly recorded on the effective statutory declaration. Test membership to distinguish a missing input from a declared zero, false or empty value. |
| `scheme.child_claims.<class>.full` | Declared children for this tax year and relief class claimed in whole; zero without a declaration. Independent of family records. |
| `scheme.child_claims.<class>.half` | Declared children for this tax year and relief class whose relief is shared with another claimant; the rule states the share. Zero without a declaration. |
| `scheme.deductions.<category>` | Declared deduction amounts through this month in the current tax year, before category limits |
| `scheme.deductions_current.<category>` | This employer’s accepted deduction claims for the current month, before category limits |
| `scheme.deductions_prior.<category>` | Earlier-month and prior-employer deduction claims in the current tax year, before category limits |
| `scheme.deductions_prior_employer.<category>` | Prior-employer deductions in the current tax year through this month |
| `scheme.deduction_claim_counts.<category>` | Distinct claim references with a positive net amount after corrections, through this month in the current tax year |
| `scheme.deduction_claims_missing_event.<category>` | Deduction claims without a linked event reference in the current tax year through this month |
| `scheme.deduction_claims_negative_event.<category>` | Linked event references whose signed corrections produce a negative net claim in the current tax year through this month |
| `scheme.deductions_last_year.<category>` | Declared deductions in the preceding tax year, for claim-frequency limits |
| `scheme.deductions_two_years_ago.<category>` | Declared deductions two tax years earlier, for claim-frequency limits |
| `produced.<code>.employee` | The relievable employee share, capped and projected; for an uncapped producer it is the year to date plus this period |
| `produced.<code>.employee_normal` | The relievable employee share for normal-pay tax: excludes current additional remuneration from projected producers, with the same prior-year-to-date contributions and annual cap |
| `produced.<code>.employee_this_period` | The employee share charged this period alone, floored at zero — the relief a per-period withholding table subtracts |
| `produced.<code>.employee_month_estimate` | The employee share a month-assessed producer would charge on this instalment’s wage scaled to the month (`period.month_factor`); `employee_this_period` where the month is paid at once — the monthly contribution a per-payment withholding annualises (TH P.96/2543 cl.1(2)) |
| `produced.<code>.employer` | The employer share |
| `produced.<code>.base` | The producer’s assessed base before instalment allocation. Company assessments read the sum of settled bases across their assessment interval. |
| `history.<code>.periods` | Prior paid and declared opening assessment periods normalized to the current cadence; excludes this period |
| `history.<code>.base` | Prior assessed base in the current tax year, including selected opening amounts |
| `history.<code>.ordinary` | Prior ordinary assessed base in the current tax year, including selected opening amounts |
| `history.<code>.employee` | Prior employee charge in the current tax year, including selected opening amounts |
| `history.<code>.employer` | Prior employer charge in the current tax year, including selected opening amounts |
| `history.<code>.triggered` | Whether an earlier assessment met the scheme's `history_trigger`; false when it declares none |
| `history.<code>.has_opening` | Whether a selected prior-employer declaration exists, including an all-zero one |
| `BASE` | The salary line |
| `OVERTIME` | Every overtime and incentive line |
| `DAY_PAY` | Band day pay posted to its own line (`bands[].line`): a day the law prices but does not count as overtime; outside BASE and OVERTIME |
| `NIGHT_PREMIUM` | The night premium line |
| `OVERTIME_PREMIUM` | The part of every overtime line above the ordinary hour: amount less hours × ordinary hour |
| `ABSENCE` | Unexplained absence and every unpaid leave day |
| `NO_PAY_LEAVE` | Unpaid leave days |
| `ENCASHMENT` | Every encashed leave day |
| `INCENTIVE` | The incentive lines: the planned hours beyond the statutory limits, priced at the band’s award; also inside OVERTIME |
| `NIGHT_WAGE` | The ordinary (not overtime) hours inside the night window at the ordinary hour — already inside BASE; a law that exempts the whole night-work wage, not only its premium, subtracts it |
| `ALLOWANCES` | The signed sum of this payslip’s allowance lines whose class counts toward this scheme |
| `ADHOC` | The signed sum of this payslip’s ad hoc lines (bonus, back pay, separation pay, claw-backs) whose class counts toward this scheme |
| `CLAIMS` | The signed sum of this payslip’s claim lines whose class counts toward this scheme |
| `<PART>.ALLOWANCES` | The allowance lines counting toward this scheme as the named part, where the scheme declares parts (SG CPF ORDINARY / ADDITIONAL) |
| `<PART>.ADHOC` | The ad hoc lines counting toward the named part |
| `<PART>.CLAIMS` | The claim lines counting toward the named part |
| `year.ALLOWANCES` | The allowance lines counting toward this scheme over the tax year’s earlier PAID payslips (this payslip excluded — add `ALLOWANCES` for it) |
| `year.ADHOC` | The same over the ad hoc lines |
| `year.CLAIMS` | The same over the claim lines |
| `year.<PART>.ALLOWANCES` | The year’s earlier allowance lines of the named part |
| `year.<PART>.ADHOC` | The year’s earlier ad hoc lines of the named part |
| `year.<PART>.CLAIMS` | The year’s earlier claim lines of the named part |

| Function | Meaning |
| --- | --- |
| `round_cent(value)` | Round to the nearest cent |
| `truncate_cent(value)` | Truncate to the cent |
| `up_5_cents(value)` | Round up to the next five cents |
| `round_unit(value)` | Round to the nearest whole unit |
| `floor_unit(value)` | Floor to the whole unit |
| `up_to_unit(value)` | Round up to the whole unit |
| `bracket(base, up_to, step)` | Round a figure up to the next bracket |
| `ladder(base, grades)` | Step a figure up to the next grade in a table |
| `progressive(value, table)` | Apply a progressive [from, base, rate] table |
| `add_months(date, months)` | The calendar day `months` months after a `YYYY-MM-DD` day, clamped to the month’s last day; empty for an empty day |
| `months_through(from, through)` | Months from one `YYYY-MM-DD` day through another inclusive: completed months plus the part month by its days; 0 when either is empty or `through` is before `from` |
| `minimum_wage(region)` | The version’s minimum wage for a region |
| `code('X')` | The signed total of the version’s class X this payslip — for a law that caps or exempts one class alone (MY’s termination-benefit exemption, PH’s de-minimis rice subsidy) |
| `earned_average(code, months_back, months)` | The average of a component’s earnings on the person’s earlier payslips over `months` calendar months, the window ending `months_back` months before this pay month; 0 with no history in the window. `code` may be a list of codes — reserved lines among them (`OVERTIME`) — summed month by month (TW 施行細則 §27: the three-month average of 工資, overtime included); a scheme part (`WTAX.RICE`) sums every class counting toward it |
| `days_under(age)` | Calendar days employed in the assessment window before the specified birthday. |
| `coverage_days(since, age, month_days)` | Covered days in the assessment month on a fixed calendar of `month_days` days, starting no earlier than employment and registration. Continuing coverage runs to day `month_days` whatever the month’s length; a termination uses its actual day, and a join its actual day, each capped at `month_days`. A positive age ends coverage before that birthday; 0 applies no age limit. |
| `annual_exempt(amount, earned_before, cap)` | The part still inside an annual exemption |
| `earned_quantity_exempt(code, limit)` | Earlier paid cash-out exempt within the annual day limit, valued at each payment’s original rate. |
| `earned_monthly_excess(code, limit)` | Earlier payments in the tax year exceeding the allowance limit in each calendar month; `code` may be a scheme part (`WTAX.RICE`), every class counting toward it. |
| `earned_daily_excess(code, share)` | Earlier payments in the tax year exceeding a per-day ceiling in each calendar month: `share` × the monthly `minimum_wage(region)` each earlier payslip was calculated at × its days with overtime or night-window hours (`person.period.overtime_days`) — the floor of that payslip’s own time, not today’s; `code` may be a scheme part (`WTAX.OT_MEAL`). |
| `annual_quantity_exempt(code, limit)` | Current leave cash-out exempt within an annual day limit, after days paid earlier in the tax year. Each entry retains its own rate. |

## `scheme` — One statutory scheme for one person and period: rules and rate bands.

Used by: contribution rules and `statutory_contributions.elections[].required_when`.

Bare names: `base`, `ordinary`.

Open prefixes: `produced.<key>`, `history.<key>`, `year.<key>`, `scheme.elections.<key>`, `scheme.child_claims.<key>`, `scheme.deductions.<key>`, `scheme.deductions_current.<key>`, `scheme.deductions_prior.<key>`, `scheme.deductions_prior_employer.<key>`, `scheme.deduction_claim_counts.<key>`, `scheme.deduction_claims_missing_event.<key>`, `scheme.deduction_claims_negative_event.<key>`, `scheme.deductions_last_year.<key>`, `scheme.deductions_two_years_ago.<key>`, `person.company.facts.<key>`, `person.facts.<key>`, `person.period.leave_full_days.<key>`, `person.period.leave_days.<key>`, `person.period.leave_pay.<key>`, `person.employment.exit_facts.<key>`, `person.terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `person.employee.birthday(age)` | Date the given age is reached, as `YYYY-MM-DD`, or empty without a birth date. A leap-day anniversary in a non-leap year falls on 1 March, matching age_on. |
| `person.employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `person.employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Declared dependant count for schemes such as ID PTKP and TW exemptions; child-specific rules read `children` |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race, upper-cased, as a self-help fund row reads it |
| `person.employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employee.presence_recorded` | Whether any stay in the jurisdiction is recorded (`presence_periods`); false leaves a presence test to the declared residency and elections |
| `person.employee.presence_days` | Days present in the jurisdiction in the rule date’s calendar year through the rule date, an entry or exit day whole (MY ITA 1967 s.7(1)(a), (1A); Sch.6 para 21(a)) |
| `person.employee.presence_linked_days` | Consecutive days in the previous calendar year of a stay running unbroken into this one, else 0 (MY ITA s.7(1)(b)) |
| `person.employee.presence_days_in(years_back)` | Days present in the calendar year that many years before the rule date’s, counted as `presence_days` (1 is the previous year; 0 where none is recorded) — MY ITA s.7(1)(c)(ii) counts the preceding years with 90 or more |
| `person.employee.employment_days` | Days present on stays recorded `employment_exercised`, within the stint: the days the employment was exercised in the jurisdiction this calendar year through the rule date (MY ITA Sch.6 para 21(a), 22(a)) |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_days` | Calendar days in the current stint through the rule date, capped at exit; not event-specific employment history |
| `person.employment.service_days_before(date, months)` | Distinct days employed by this entity in the stated calendar-month window immediately before the event date; all same-entity stints are supplied by payroll, and missing history refuses |
| `person.employment.service_months` | Completed months since the stint began; a leaver counts through the exit day |
| `person.employment.service_months_exact` | Completed months plus the part month as a share of its days, for a pro-rata part year |
| `person.employment.service_years` | Completed years since the stint began; a leaver counts through the exit day |
| `person.employment.service_years_on(date)` | Completed service years on a specified calendar date on or after hire |
| `person.employment.notice_days_remaining(days, given_on, waived_days)` | Unserved calendar notice days after the last service day; written notice includes its giving day, empty given_on means no notice. Waived days remove the final unserved days; excessive waiver or invalid dates refuse |
| `person.employment.notice_monthly_wages(monthly_wage, days, given_on, waived_days)` | Constant monthly wages over the unserved notice interval, divided separately by each calendar month’s actual length. Does not select the legal wage components or handle changing/non-monthly wages; rounding belongs to the rule |
| `person.employment.payday_notice_days(given_on, pay_frequency, company_pay_frequency)` | Notice length, as `days` for the two functions above, that takes effect on the payday after the first payday on or after given_on (TH LPA s.17 para.2); empty given_on prices from the removal day |
| `person.employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `person.employment.rule_date` | The rule date as `YYYY-MM-DD`; a `wages.contract_rules` rule reads the first day of its floor segment |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.days_to_exit` | Calendar days from the rule date to the exit date: 0 on the exit day or while open. A leave rule reads it on each day charged (TW 勞基法 §16(2): only inside the notice, `employment.days_to_exit < employment.exit_facts.notice_days_given`) |
| `person.employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `person.employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `person.employment.contract_days` | Calendar days of a fixed-term contract, first day to last inclusive (LHDN MTD Specification 2026 D(a) note: a foreign employee on a contract of 182 days or more is withheld at resident MTD); 0 where open-ended |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.exit_facts.<key>` | Departure inputs declared by the settings version effective on the final service day |
| `person.employment.exit_fact_keys` | Departure keys explicitly recorded on the employment, before defaults |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.employment.earned_monthly_average(months)` | The wages earlier payslips paid (basic, regular cash for work, overtime, less unpaid days; no bonus or reimbursement) over the `months` calendar months before the rule date’s month, per month of service, a part first month counted as its share (ID Permenaker 6/2016 art.3(3)–(4); MY reg.6(2) as twelve of them). Refused where a month of service has no payslip; read on a pay request or a leave cash-out |
| `person.employment.piece_wages_last_workdays(days)` | Earned units times unit rate on the last `days` piece-rate workdays through the final service day; refuses when a scheduled recent workday lacks earnings or explicit absence (TH LPA s.118) |
| `person.employment.earned_monthly_average(months, excluded)` | That average with the named filed codes taken back out of each month; `["OVERTIME"]` is every priced work-day line (CN 企业职工带薪年休假实施办法 art.11: 剔除加班工资) |
| `person.employment.earned_monthly_average(months, excluded, fallback)` | That average, or `fallback` where the stint served no month before the rule date’s month (CN 实施条例 art.27: a leaver in the hiring month averages the one month worked) |
| `person.employment.prior_service_months` | Months worked for earlier employers before this stint, as recorded on the contract; 0 unrecorded (CN 企业职工带薪年休假实施办法 art.4: annual leave counts cumulative service across employers) |
| `person.employment.average_daily_wage(months, codes)` | Those wages over the calendar days of the `months` months before the rule date’s month, with the days 施行細則 §2 leaves out removed with their wages: every calendar day the named leave codes’ approved time off spans, paid or not, and — with a third list, `average_daily_wage(months, codes, reduced)` — the days those codes cut the wage (TW 勞基法 §2(4)). Refused where a month of service has no payslip; read on a pay request only |
| `person.employment.average_monthly_wage(months, codes)` | That daily average times the covered months’ average days — one month’s average wage (勞動部 台(83)勞動二字第25564號: six months’ wages ÷ 6 where nothing is left out) |
| `person.employment.on_leave(date, codes)` | Whether approved time off of one of the named leave codes spans that day (TW 勞基法 §13: no employer termination inside the §50 stop or the §59 medical period); none where the site has no leave record |
| `person.employment.service_months_net(codes, days)` | Completed months of service with the named leave codes’ calendar days disregarded in each twelve months of service where they exceed `days` (MY EA s.60E(3B)); read on a leave rule only |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — the work-pricing day; leave cash-out has a separate dated rule; 0 where no divisor was evaluated |
| `person.terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed, less the classes `work_rules.wage_excluded_allowances` names (MY EA s.2 “wages” (c): travelling); on a scheme’s own expression, those counting toward that scheme |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.gross_monthly` | The gross rate of pay as a month: `terms.monthly_basic` plus the contract’s allowances less the classes `work_rules.gross_excluded_allowances` names (SG EA s.2: travelling, food, housing); at the work day the exclusions apply, elsewhere every allowance counts |
| `person.terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.statutory_work_category` | Statutory work category of the terms: a code the governing version declares in payroll.vocabularies |
| `person.terms.weather_dependent_piece` | Weather-dependent piece work uses twelve paid months for ID JKK, JKM and JHT |
| `person.terms.worksite` | The worksite the terms record: a province or province/locality, or empty |
| `person.terms.worksite_sector` | The worksite sector the terms record (ID: the five-digit KBLI), or empty |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group — an employer’s own label, never a statute’s |
| `person.terms.paid_rest_days` | The contract pays every day of the month, unworked rest days, special days and regular holidays included (the DOLE Handbook’s monthly-paid employee, factor 365) |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | The work pass: a code the governing version declares in payroll.vocabularies, or empty |
| `person.terms.tax_residency` | Tax residence declared on the contract, a code the governing version declares in payroll.vocabularies, or empty when unrecorded; each scheme supplies its statutory default |
| `person.terms.residency_since` | Date residency began as `YYYY-MM-DD`, or empty when unrecorded |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.comparable_full_time_daily_hours` | Similar full-time employee’s declared normal daily hours, or 0 when unrecorded |
| `person.terms.comparable_full_time_presence` | PRESENT if a similar full-time employee exists, ABSENT for the statutory fallback, or empty if unknown |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.terms.facts.<key>` | Jurisdiction inputs the version declares in `terms_facts`, recorded on the terms in force; a declared default where unrecorded |
| `person.terms.fact_keys` | Terms input keys explicitly recorded on the terms in force, before defaults |
| `person.children.count` | Recorded child relationships active on the rule date, regardless of relationship or recorded death; a legal living-natural-child test needs its own dated function |
| `person.children.under(n)` | Children under n completed years |
| `person.children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `person.children.multiple_born_on(date)` | The infants of a multiple birth: children born on that day, refusing fewer than two (CN Order 619 art.7: 15 days per extra infant) |
| `person.children.natural_surviving_on(date)` | Natural CHILD records alive on that date, including children born that day; excludes adopted, stepchildren and wards. A death on the same date needs a time-specific determination. |
| `person.children.natural_surviving_before(date)` | Natural children alive before the named confinement, excluding its newborns |
| `person.children.natural_surviving_confinements_before(date)` | Previous confinements that produced a natural child still alive at this confinement; children born in one confinement count once |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.children.prior_childcare_days` | Childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG GPCL and EA s.87A lifetime caps count every employer) |
| `person.children.prior_extended_childcare_days` | Extended childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12B(2)(a)(ii)) |
| `person.children.prior_infant_care_days` | Unpaid infant care leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12D(2)(a)) |
| `person.children.classed(x)` | Family records in classification x; these counts do not establish tax-relief claims |
| `person.children.unclassed_under(n)` | Family records with no classification under n completed years; MY tax relief reads scheme.child_claims instead |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY; empty outside a payroll |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.wage_floor_pay.BASE` | The part of BASE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.OVERTIME` | The part of OVERTIME paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.DAY_PAY` | The part of DAY_PAY paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NIGHT_PREMIUM` | The part of NIGHT_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.OVERTIME_PREMIUM` | The part of OVERTIME_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.ABSENCE` | The part of ABSENCE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NO_PAY_LEAVE` | The part of NO_PAY_LEAVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.ENCASHMENT` | The part of ENCASHMENT paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.INCENTIVE` | The part of INCENTIVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.wage_floor_pay.NIGHT_WAGE` | The part of NIGHT_WAGE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `person.facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `person.facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `person.facts.<CODE>.elections.<key>` | Declared scheme inputs resolved from the statutory facts effective on the rule date |
| `person.facts.<CODE>.election_keys` | Keys explicitly supplied on that effective statutory declaration; distinct from resolved defaults |
| `person.event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `person.event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `person.event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `person.event.wife_prior_living_biological_children` | Wife’s prior living biological children at this birth, or -1 when unrecorded (VN Decree 168/2026 art.2(1)(b)) |
| `person.event.date` | The day of the event, or empty |
| `person.event.case.facts.<key>` | The recorded facts and qualifications of the benefit case this event opened (`payroll.benefit_cases`); absent without a case, so read `has(event.case.facts.<key>) && event.case.facts.<key>` |
| `person.event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `person.event.child_age` | The named child’s completed years, -1 when none is named |
| `person.event.child_shared_weeks` | The named child’s allocated shared-parental weeks; -1 when unrecorded, 0 for an explicit zero share |
| `person.event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `person.event.estimated_delivery_date` | The named child’s estimated delivery date as certified by a medical practitioner (SG CDCA s.2), or empty |
| `person.event.adoption_eligibility_date` | The eligibility date of the application to adopt the named child (SG CDCA s.2: the application date for a citizen or PR child, else the dependant’s pass issue date), or empty |
| `person.period.unpaid_full_days` | Scheduled dates wholly unpaid, counted once per date; paid fractions do not count |
| `person.period.leave_days.<CODE>` | Approved working-day leave fractions of the named code in the assessment window |
| `person.period.leave_full_days.<CODE>` | Approved full working dates of the named leave code in the assessment window |
| `person.period.leave_pay.<CODE>` | The salary the assessment window attributes to the named leave code’s days: salary × leave days ÷ working days, at most the salary |
| `person.period.working_days` | Scheduled working days of the pay month |
| `person.period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `person.period.overtime_days` | Dates in the assessment window with overtime hours or hours inside the night window, counted once per date |
| `person.period.arrears` | The wage of a deferred earlier period (a joiner after the cut-off) this payslip pays as back pay, already inside BASE; 0 otherwise. A law that prices each contribution month on its own wage caps it separately (ID PP 45/2015 art.29(1)) |
| `period.key` | YYYY-MM or YYYY-MM-n |
| `period.month` | The pay month, 1–12 |
| `period.start` | First day of the pay period |
| `period.end` | Last day of the pay period |
| `period.pay_date` | Scheduled day this payroll run pays income |
| `period.index` | Which instalment of the month this period is |
| `period.instalments` | Instalments the month is paid in |
| `period.month_factor` | What this instalment’s wage is multiplied by to state the month’s: 1 for a month, 2 for a half, 52/12 for a week — a MONTH-assessed scheme’s base is scaled by it, so a base that already states the month divides by it |
| `period.last_of_year` | This period closes the tax year, or is a leaver’s last |
| `period.days_employed` | Days of the pay month the employment covered, in the proration basis’s units (the payslip’s proration segments summed) |
| `period.days_in_month` | Calendar days of the pay month |
| `period.year` | Calendar year of the pay period |
| `year.start` | First day of the tax year |
| `year.end` | Last day of the tax year |
| `year.months_employed` | The calendar months of the tax year this employment touches through the period end, the join and exit months counted whole |
| `year.earned.<code>` | Earned under a component code this tax year: earlier PAID payslips only, plus this run’s own lines where the site prices them |
| `year.earned.ABSENCE` | Every unpaid day this tax year, absence and no-pay leave, as a magnitude: `earned.BASIC - earned.ABSENCE` is the basic actually earned |
| `year.payments` | The payments due in the tax year at this cadence, from the join to the year end (monthly: months, adding declared prior-employer months as `months_employed` does; semi-monthly: halves; weekly: paydays) |
| `scheme.code` | The scheme code |
| `scheme.assessment_period` | PAY_PERIOD \| MONTH \| MONTH_TO_DATE |
| `scheme.registration_status` | The declaration priced by this rule (a historical covered standing when an insured period ended) |
| `scheme.current_registration_status` | The declaration at assessment end; registration_status may instead be a covered historical standing priced for earlier days |
| `scheme.declaration_reference` | The supporting reference for a documented NOT_REGISTERED election |
| `scheme.year_to_date.base` | Base already charged this tax year: this employer’s earlier slips plus what an earlier employer declared on the fact (`opening`) |
| `scheme.year_to_date.ordinary` | The ordinary part of the base already charged this tax year, where the scheme states `ordinary_on` |
| `scheme.year_to_date.employee` | Employee amount already charged this tax year |
| `scheme.year_to_date.employer` | Employer amount already charged this tax year |
| `scheme.year_to_date.rebate` | Rebatable payments already recorded this tax year, including declared prior-employer payments |
| `scheme.last_year.base` | Base this employer charged in the tax year before this one (no prior-employer opening) — ID PP 68/2009 art.2(2) joins severance parts across two calendar years |
| `scheme.last_year.employee` | Employee amount this employer charged in the tax year before this one |
| `scheme.last_year.employer` | Employer amount this employer charged in the tax year before this one |
| `scheme.first_year` | Earliest tax year in which one of this employer’s earlier slips charged a base on this scheme, 0 when none — ID PP 68/2009 art.6 counts the third calendar year from the first severance part |
| `scheme.dependent_months` | Sum of registered eligible dependant counts over the tax year’s twelve months; required for an authorised annual finalisation (VN Decree 253/2026 art.48) |
| `scheme.trailing_short.base` | Average paid wages over the last payroll.trailing_wage_short_months calendar months of this employment, across tax years, for piece work (ID PP 44/2015 art.19(4): 3) |
| `scheme.trailing_short.months` | Months of this employment in the short lookback |
| `scheme.trailing_long.base` | Average paid wages over the last payroll.trailing_wage_long_months calendar months of this employment, across tax years, for weather-dependent piece work (ID PP 44/2015 art.19(5): 12) |
| `scheme.trailing_long.months` | Months of this employment in the long lookback |
| `scheme.projection.payslips_remaining` | Payslips left in the year, this one included |
| `scheme.projection.future_equivalents` | Future payslips of this size |
| `scheme.rate_override` | The employment flat rate override percentage, 0 when none |
| `scheme.since` | The day this employment registered with the scheme, or empty |
| `scheme.first_contribution_due_on` | First date contributions were legally due under this scheme, including earlier employers, or empty. Independent of registration and payment dates. |
| `scheme.since_months` | Completed months since registration, 0 when unrecorded |
| `scheme.elections.<key>` | The employment’s elections under this scheme, keys the scheme row declares |
| `scheme.election_keys` | Keys explicitly recorded on the effective statutory declaration. Test membership to distinguish a missing input from a declared zero, false or empty value. |
| `scheme.child_claims.<class>.full` | Declared children for this tax year and relief class claimed in whole; zero without a declaration. Independent of family records. |
| `scheme.child_claims.<class>.half` | Declared children for this tax year and relief class whose relief is shared with another claimant; the rule states the share. Zero without a declaration. |
| `scheme.deductions.<category>` | Declared deduction amounts through this month in the current tax year, before category limits |
| `scheme.deductions_current.<category>` | This employer’s accepted deduction claims for the current month, before category limits |
| `scheme.deductions_prior.<category>` | Earlier-month and prior-employer deduction claims in the current tax year, before category limits |
| `scheme.deductions_prior_employer.<category>` | Prior-employer deductions in the current tax year through this month |
| `scheme.deduction_claim_counts.<category>` | Distinct claim references with a positive net amount after corrections, through this month in the current tax year |
| `scheme.deduction_claims_missing_event.<category>` | Deduction claims without a linked event reference in the current tax year through this month |
| `scheme.deduction_claims_negative_event.<category>` | Linked event references whose signed corrections produce a negative net claim in the current tax year through this month |
| `scheme.deductions_last_year.<category>` | Declared deductions in the preceding tax year, for claim-frequency limits |
| `scheme.deductions_two_years_ago.<category>` | Declared deductions two tax years earlier, for claim-frequency limits |
| `produced.<code>.employee` | The relievable employee share, capped and projected; for an uncapped producer it is the year to date plus this period |
| `produced.<code>.employee_normal` | The relievable employee share for normal-pay tax: excludes current additional remuneration from projected producers, with the same prior-year-to-date contributions and annual cap |
| `produced.<code>.employee_this_period` | The employee share charged this period alone, floored at zero — the relief a per-period withholding table subtracts |
| `produced.<code>.employee_month_estimate` | The employee share a month-assessed producer would charge on this instalment’s wage scaled to the month (`period.month_factor`); `employee_this_period` where the month is paid at once — the monthly contribution a per-payment withholding annualises (TH P.96/2543 cl.1(2)) |
| `produced.<code>.employer` | The employer share |
| `produced.<code>.base` | The producer’s assessed base before instalment allocation. Company assessments read the sum of settled bases across their assessment interval. |
| `history.<code>.periods` | Prior paid and declared opening assessment periods normalized to the current cadence; excludes this period |
| `history.<code>.base` | Prior assessed base in the current tax year, including selected opening amounts |
| `history.<code>.ordinary` | Prior ordinary assessed base in the current tax year, including selected opening amounts |
| `history.<code>.employee` | Prior employee charge in the current tax year, including selected opening amounts |
| `history.<code>.employer` | Prior employer charge in the current tax year, including selected opening amounts |
| `history.<code>.triggered` | Whether an earlier assessment met the scheme's `history_trigger`; false when it declares none |
| `history.<code>.has_opening` | Whether a selected prior-employer declaration exists, including an all-zero one |
| `base` | The result of the scheme’s `assessed_on` formula |
| `scheme.deduction` | The selected rule’s allowable deduction, evaluated before employee, employer and rebate expressions; zero if omitted |
| `ordinary` | The result of the scheme’s `ordinary_on` formula this period — the base itself where none is stated; `base - ordinary` is the additional part (MY MTD additional remuneration, SG Additional Wages) |

| Function | Meaning |
| --- | --- |
| `round_cent(value)` | Round to the nearest cent |
| `truncate_cent(value)` | Truncate to the cent |
| `up_5_cents(value)` | Round up to the next five cents |
| `round_unit(value)` | Round to the nearest whole unit |
| `floor_unit(value)` | Floor to the whole unit |
| `up_to_unit(value)` | Round up to the whole unit |
| `bracket(base, up_to, step)` | Round a figure up to the next bracket |
| `ladder(base, grades)` | Step a figure up to the next grade in a table |
| `progressive(value, table)` | Apply a progressive [from, base, rate] table |
| `add_months(date, months)` | The calendar day `months` months after a `YYYY-MM-DD` day, clamped to the month’s last day; empty for an empty day |
| `months_through(from, through)` | Months from one `YYYY-MM-DD` day through another inclusive: completed months plus the part month by its days; 0 when either is empty or `through` is before `from` |
| `minimum_wage(region)` | The version’s minimum wage for a region |
| `days_under(age)` | Calendar days employed in the assessment window before the specified birthday. |
| `coverage_days(since, age, month_days)` | Covered days in the assessment month on a fixed calendar of `month_days` days, starting no earlier than employment and registration. Continuing coverage runs to day `month_days` whatever the month’s length; a termination uses its actual day, and a join its actual day, each capped at `month_days`. A positive age ends coverage before that birthday; 0 applies no age limit. |
| `annual_exempt(amount, earned_before, cap)` | The part still inside an annual exemption |
| `earned_quantity_exempt(code, limit)` | Earlier paid cash-out exempt within the annual day limit, valued at each payment’s original rate. |
| `earned_monthly_excess(code, limit)` | Earlier payments in the tax year exceeding the allowance limit in each calendar month; `code` may be a scheme part (`WTAX.RICE`), every class counting toward it. |
| `earned_daily_excess(code, share)` | Earlier payments in the tax year exceeding a per-day ceiling in each calendar month: `share` × the monthly `minimum_wage(region)` each earlier payslip was calculated at × its days with overtime or night-window hours (`person.period.overtime_days`) — the floor of that payslip’s own time, not today’s; `code` may be a scheme part (`WTAX.OT_MEAL`). |
| `annual_quantity_exempt(code, limit)` | Current leave cash-out exempt within an annual day limit, after days paid earlier in the tax year. Each entry retains its own rate. |

## `leave_day` — One charged day of leave: the person that day, and where in the leave it falls.

Used by: `leave_catalogue.pay_fraction` — one charged leave day.

Bare names: `wage_floor`.

Open prefixes: `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `employee.gender` | Recorded gender |
| `employee.age` | Completed years on the rule date |
| `employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `employee.birthday(age)` | Date the given age is reached, as `YYYY-MM-DD`, or empty without a birth date. A leap-day anniversary in a non-leap year falls on 1 March, matching age_on. |
| `employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `employee.citizenship` | Residency standing from the effective terms |
| `employee.marital_status` | Marital status |
| `employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `employee.dependents_count` | Declared dependant count for schemes such as ID PTKP and TW exemptions; child-specific rules read `children` |
| `employee.solo_parent` | Solo-parent flag |
| `employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `employee.disabled` | Disability flag |
| `employee.race` | Recorded race, upper-cased, as a self-help fund row reads it |
| `employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `employee.presence_recorded` | Whether any stay in the jurisdiction is recorded (`presence_periods`); false leaves a presence test to the declared residency and elections |
| `employee.presence_days` | Days present in the jurisdiction in the rule date’s calendar year through the rule date, an entry or exit day whole (MY ITA 1967 s.7(1)(a), (1A); Sch.6 para 21(a)) |
| `employee.presence_linked_days` | Consecutive days in the previous calendar year of a stay running unbroken into this one, else 0 (MY ITA s.7(1)(b)) |
| `employee.presence_days_in(years_back)` | Days present in the calendar year that many years before the rule date’s, counted as `presence_days` (1 is the previous year; 0 where none is recorded) — MY ITA s.7(1)(c)(ii) counts the preceding years with 90 or more |
| `employee.employment_days` | Days present on stays recorded `employment_exercised`, within the stint: the days the employment was exercised in the jurisdiction this calendar year through the rule date (MY ITA Sch.6 para 21(a), 22(a)) |
| `employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `employment.classification` | Work classification |
| `employment.risk_class` | The employment risk class, or empty |
| `employment.service_days` | Calendar days in the current stint through the rule date, capped at exit; not event-specific employment history |
| `employment.service_days_before(date, months)` | Distinct days employed by this entity in the stated calendar-month window immediately before the event date; all same-entity stints are supplied by payroll, and missing history refuses |
| `employment.service_months` | Completed months since the stint began; a leaver counts through the exit day |
| `employment.service_months_exact` | Completed months plus the part month as a share of its days, for a pro-rata part year |
| `employment.service_years` | Completed years since the stint began; a leaver counts through the exit day |
| `employment.service_years_on(date)` | Completed service years on a specified calendar date on or after hire |
| `employment.notice_days_remaining(days, given_on, waived_days)` | Unserved calendar notice days after the last service day; written notice includes its giving day, empty given_on means no notice. Waived days remove the final unserved days; excessive waiver or invalid dates refuse |
| `employment.notice_monthly_wages(monthly_wage, days, given_on, waived_days)` | Constant monthly wages over the unserved notice interval, divided separately by each calendar month’s actual length. Does not select the legal wage components or handle changing/non-monthly wages; rounding belongs to the rule |
| `employment.payday_notice_days(given_on, pay_frequency, company_pay_frequency)` | Notice length, as `days` for the two functions above, that takes effect on the payday after the first payday on or after given_on (TH LPA s.17 para.2); empty given_on prices from the removal day |
| `employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `employment.rule_date` | The rule date as `YYYY-MM-DD`; a `wages.contract_rules` rule reads the first day of its floor segment |
| `employment.exit_date` | Last day of work, or empty while open |
| `employment.days_to_exit` | Calendar days from the rule date to the exit date: 0 on the exit day or while open. A leave rule reads it on each day charged (TW 勞基法 §16(2): only inside the notice, `employment.days_to_exit < employment.exit_facts.notice_days_given`) |
| `employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `employment.contract_days` | Calendar days of a fixed-term contract, first day to last inclusive (LHDN MTD Specification 2026 D(a) note: a foreign employee on a contract of 182 days or more is withheld at resident MTD); 0 where open-ended |
| `employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `employment.exit_facts.<key>` | Departure inputs declared by the settings version effective on the final service day |
| `employment.exit_fact_keys` | Departure keys explicitly recorded on the employment, before defaults |
| `employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `employment.earned_monthly_average(months)` | The wages earlier payslips paid (basic, regular cash for work, overtime, less unpaid days; no bonus or reimbursement) over the `months` calendar months before the rule date’s month, per month of service, a part first month counted as its share (ID Permenaker 6/2016 art.3(3)–(4); MY reg.6(2) as twelve of them). Refused where a month of service has no payslip; read on a pay request or a leave cash-out |
| `employment.piece_wages_last_workdays(days)` | Earned units times unit rate on the last `days` piece-rate workdays through the final service day; refuses when a scheduled recent workday lacks earnings or explicit absence (TH LPA s.118) |
| `employment.earned_monthly_average(months, excluded)` | That average with the named filed codes taken back out of each month; `["OVERTIME"]` is every priced work-day line (CN 企业职工带薪年休假实施办法 art.11: 剔除加班工资) |
| `employment.earned_monthly_average(months, excluded, fallback)` | That average, or `fallback` where the stint served no month before the rule date’s month (CN 实施条例 art.27: a leaver in the hiring month averages the one month worked) |
| `employment.prior_service_months` | Months worked for earlier employers before this stint, as recorded on the contract; 0 unrecorded (CN 企业职工带薪年休假实施办法 art.4: annual leave counts cumulative service across employers) |
| `employment.average_daily_wage(months, codes)` | Those wages over the calendar days of the `months` months before the rule date’s month, with the days 施行細則 §2 leaves out removed with their wages: every calendar day the named leave codes’ approved time off spans, paid or not, and — with a third list, `average_daily_wage(months, codes, reduced)` — the days those codes cut the wage (TW 勞基法 §2(4)). Refused where a month of service has no payslip; read on a pay request only |
| `employment.average_monthly_wage(months, codes)` | That daily average times the covered months’ average days — one month’s average wage (勞動部 台(83)勞動二字第25564號: six months’ wages ÷ 6 where nothing is left out) |
| `employment.on_leave(date, codes)` | Whether approved time off of one of the named leave codes spans that day (TW 勞基法 §13: no employer termination inside the §50 stop or the §59 medical period); none where the site has no leave record |
| `employment.service_months_net(codes, days)` | Completed months of service with the named leave codes’ calendar days disregarded in each twelve months of service where they exceed `days` (MY EA s.60E(3B)); read on a leave rule only |
| `terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — the work-pricing day; leave cash-out has a separate dated rule; 0 where no divisor was evaluated |
| `terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed, less the classes `work_rules.wage_excluded_allowances` names (MY EA s.2 “wages” (c): travelling); on a scheme’s own expression, those counting toward that scheme |
| `terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `terms.gross_monthly` | The gross rate of pay as a month: `terms.monthly_basic` plus the contract’s allowances less the classes `work_rules.gross_excluded_allowances` names (SG EA s.2: travelling, food, housing); at the work day the exclusions apply, elsewhere every allowance counts |
| `terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `terms.statutory_work_category` | Statutory work category of the terms: a code the governing version declares in payroll.vocabularies |
| `terms.weather_dependent_piece` | Weather-dependent piece work uses twelve paid months for ID JKK, JKM and JHT |
| `terms.worksite` | The worksite the terms record: a province or province/locality, or empty |
| `terms.worksite_sector` | The worksite sector the terms record (ID: the five-digit KBLI), or empty |
| `terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `terms.payroll_group` | Payroll group — an employer’s own label, never a statute’s |
| `terms.paid_rest_days` | The contract pays every day of the month, unworked rest days, special days and regular holidays included (the DOLE Handbook’s monthly-paid employee, factor 365) |
| `terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `terms.pass_type` | The work pass: a code the governing version declares in payroll.vocabularies, or empty |
| `terms.tax_residency` | Tax residence declared on the contract, a code the governing version declares in payroll.vocabularies, or empty when unrecorded; each scheme supplies its statutory default |
| `terms.residency_since` | Date residency began as `YYYY-MM-DD`, or empty when unrecorded |
| `terms.notice_days` | Notice days the contract states, 0 when none |
| `terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `terms.comparable_full_time_daily_hours` | Similar full-time employee’s declared normal daily hours, or 0 when unrecorded |
| `terms.comparable_full_time_presence` | PRESENT if a similar full-time employee exists, ABSENT for the statutory fallback, or empty if unknown |
| `terms.working_days_per_week` | Roster-measured working week, days |
| `terms.facts.<key>` | Jurisdiction inputs the version declares in `terms_facts`, recorded on the terms in force; a declared default where unrecorded |
| `terms.fact_keys` | Terms input keys explicitly recorded on the terms in force, before defaults |
| `children.count` | Recorded child relationships active on the rule date, regardless of relationship or recorded death; a legal living-natural-child test needs its own dated function |
| `children.under(n)` | Children under n completed years |
| `children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `children.multiple_born_on(date)` | The infants of a multiple birth: children born on that day, refusing fewer than two (CN Order 619 art.7: 15 days per extra infant) |
| `children.natural_surviving_on(date)` | Natural CHILD records alive on that date, including children born that day; excludes adopted, stepchildren and wards. A death on the same date needs a time-specific determination. |
| `children.natural_surviving_before(date)` | Natural children alive before the named confinement, excluding its newborns |
| `children.natural_surviving_confinements_before(date)` | Previous confinements that produced a natural child still alive at this confinement; children born in one confinement count once |
| `children.citizens` | Children recorded as citizens |
| `children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `children.citizens_under(n)` | Of them, those under n completed years |
| `children.prior_childcare_days` | Childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG GPCL and EA s.87A lifetime caps count every employer) |
| `children.prior_extended_childcare_days` | Extended childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12B(2)(a)(ii)) |
| `children.prior_infant_care_days` | Unpaid infant care leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12D(2)(a)) |
| `children.classed(x)` | Family records in classification x; these counts do not establish tax-relief claims |
| `children.unclassed_under(n)` | Family records with no classification under n completed years; MY tax relief reads scheme.child_claims instead |
| `company.region` | Employing entity region |
| `company.headcount` | Active employments in the entity |
| `company.headcount_citizens` | Of them, the citizens |
| `company.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY; empty outside a payroll |
| `company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `wage_floor_pay.BASE` | The part of BASE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.OVERTIME` | The part of OVERTIME paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.DAY_PAY` | The part of DAY_PAY paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.NIGHT_PREMIUM` | The part of NIGHT_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.OVERTIME_PREMIUM` | The part of OVERTIME_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.ABSENCE` | The part of ABSENCE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.NO_PAY_LEAVE` | The part of NO_PAY_LEAVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.ENCASHMENT` | The part of ENCASHMENT paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.INCENTIVE` | The part of INCENTIVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.NIGHT_WAGE` | The part of NIGHT_WAGE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `facts.<CODE>.elections.<key>` | Declared scheme inputs resolved from the statutory facts effective on the rule date |
| `facts.<CODE>.election_keys` | Keys explicitly supplied on that effective statutory declaration; distinct from resolved defaults |
| `event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `event.wife_prior_living_biological_children` | Wife’s prior living biological children at this birth, or -1 when unrecorded (VN Decree 168/2026 art.2(1)(b)) |
| `event.date` | The day of the event, or empty |
| `event.case.facts.<key>` | The recorded facts and qualifications of the benefit case this event opened (`payroll.benefit_cases`); absent without a case, so read `has(event.case.facts.<key>) && event.case.facts.<key>` |
| `event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `event.child_age` | The named child’s completed years, -1 when none is named |
| `event.child_shared_weeks` | The named child’s allocated shared-parental weeks; -1 when unrecorded, 0 for an explicit zero share |
| `event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `event.estimated_delivery_date` | The named child’s estimated delivery date as certified by a medical practitioner (SG CDCA s.2), or empty |
| `event.adoption_eligibility_date` | The eligibility date of the application to adopt the named child (SG CDCA s.2: the application date for a citizen or PR child, else the dependant’s pass issue date), or empty |
| `period.unpaid_full_days` | Scheduled dates wholly unpaid, counted once per date; paid fractions do not count |
| `period.leave_days.<CODE>` | Approved working-day leave fractions of the named code in the assessment window |
| `period.leave_full_days.<CODE>` | Approved full working dates of the named leave code in the assessment window |
| `period.leave_pay.<CODE>` | The salary the assessment window attributes to the named leave code’s days: salary × leave days ÷ working days, at most the salary |
| `period.working_days` | Scheduled working days of the pay month |
| `period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `period.overtime_days` | Dates in the assessment window with overtime hours or hours inside the night window, counted once per date |
| `period.arrears` | The wage of a deferred earlier period (a joiner after the cut-off) this payslip pays as back pay, already inside BASE; 0 otherwise. A law that prices each contribution month on its own wage caps it separately (ID PP 45/2015 art.29(1)) |
| `leave.month_index` | Which month of the leave the day is in, from 1 |
| `leave.day_index` | Which calendar day of the leave, from 1 |
| `leave.days` | The days the whole entry charges |
| `leave.event_day` | Which charged day of the event, from 1, counting this day: across every entry of the code naming the same event date, else this entry’s (VN Labour Code art.99(3): the first 14 working days of a stoppage) |
| `leave.agreed_fraction` | The share of the day wage the parties agreed for this entry, 0 when none was recorded (VN Labour Code art.99(2), (3)) |
| `leave.taken(code)` | The days of that leave code charged in the leave year before this day, across every entry (TW 勞工請假規則 §4(3): thirty half-paid 普通傷病假 days a year, hospitalised or not) |

| Function | Meaning |
| --- | --- |
| `round_cent(value)` | Round to the nearest cent |
| `truncate_cent(value)` | Truncate to the cent |
| `up_5_cents(value)` | Round up to the next five cents |
| `round_unit(value)` | Round to the nearest whole unit |
| `floor_unit(value)` | Floor to the whole unit |
| `up_to_unit(value)` | Round up to the whole unit |
| `bracket(base, up_to, step)` | Round a figure up to the next bracket |
| `ladder(base, grades)` | Step a figure up to the next grade in a table |
| `progressive(value, table)` | Apply a progressive [from, base, rate] table |
| `add_months(date, months)` | The calendar day `months` months after a `YYYY-MM-DD` day, clamped to the month’s last day; empty for an empty day |
| `months_through(from, through)` | Months from one `YYYY-MM-DD` day through another inclusive: completed months plus the part month by its days; 0 when either is empty or `through` is before `from` |
| `minimum_wage(region)` | The version’s minimum wage for a region |

## `rest_break` — One day’s rest-break obligation: the person, and what the day’s punches measured.

Used by: `work_rules.breaks[]` — one day’s rest-break obligation.

Bare names: `wage_floor`, `consecutive_hours`, `overtime_hours`, `continuous_attendance`, `night_hours`.

Open prefixes: `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `employee.gender` | Recorded gender |
| `employee.age` | Completed years on the rule date |
| `employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `employee.birthday(age)` | Date the given age is reached, as `YYYY-MM-DD`, or empty without a birth date. A leap-day anniversary in a non-leap year falls on 1 March, matching age_on. |
| `employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `employee.citizenship` | Residency standing from the effective terms |
| `employee.marital_status` | Marital status |
| `employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `employee.dependents_count` | Declared dependant count for schemes such as ID PTKP and TW exemptions; child-specific rules read `children` |
| `employee.solo_parent` | Solo-parent flag |
| `employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `employee.disabled` | Disability flag |
| `employee.race` | Recorded race, upper-cased, as a self-help fund row reads it |
| `employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `employee.presence_recorded` | Whether any stay in the jurisdiction is recorded (`presence_periods`); false leaves a presence test to the declared residency and elections |
| `employee.presence_days` | Days present in the jurisdiction in the rule date’s calendar year through the rule date, an entry or exit day whole (MY ITA 1967 s.7(1)(a), (1A); Sch.6 para 21(a)) |
| `employee.presence_linked_days` | Consecutive days in the previous calendar year of a stay running unbroken into this one, else 0 (MY ITA s.7(1)(b)) |
| `employee.presence_days_in(years_back)` | Days present in the calendar year that many years before the rule date’s, counted as `presence_days` (1 is the previous year; 0 where none is recorded) — MY ITA s.7(1)(c)(ii) counts the preceding years with 90 or more |
| `employee.employment_days` | Days present on stays recorded `employment_exercised`, within the stint: the days the employment was exercised in the jurisdiction this calendar year through the rule date (MY ITA Sch.6 para 21(a), 22(a)) |
| `employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `employment.classification` | Work classification |
| `employment.risk_class` | The employment risk class, or empty |
| `employment.service_days` | Calendar days in the current stint through the rule date, capped at exit; not event-specific employment history |
| `employment.service_days_before(date, months)` | Distinct days employed by this entity in the stated calendar-month window immediately before the event date; all same-entity stints are supplied by payroll, and missing history refuses |
| `employment.service_months` | Completed months since the stint began; a leaver counts through the exit day |
| `employment.service_months_exact` | Completed months plus the part month as a share of its days, for a pro-rata part year |
| `employment.service_years` | Completed years since the stint began; a leaver counts through the exit day |
| `employment.service_years_on(date)` | Completed service years on a specified calendar date on or after hire |
| `employment.notice_days_remaining(days, given_on, waived_days)` | Unserved calendar notice days after the last service day; written notice includes its giving day, empty given_on means no notice. Waived days remove the final unserved days; excessive waiver or invalid dates refuse |
| `employment.notice_monthly_wages(monthly_wage, days, given_on, waived_days)` | Constant monthly wages over the unserved notice interval, divided separately by each calendar month’s actual length. Does not select the legal wage components or handle changing/non-monthly wages; rounding belongs to the rule |
| `employment.payday_notice_days(given_on, pay_frequency, company_pay_frequency)` | Notice length, as `days` for the two functions above, that takes effect on the payday after the first payday on or after given_on (TH LPA s.17 para.2); empty given_on prices from the removal day |
| `employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `employment.rule_date` | The rule date as `YYYY-MM-DD`; a `wages.contract_rules` rule reads the first day of its floor segment |
| `employment.exit_date` | Last day of work, or empty while open |
| `employment.days_to_exit` | Calendar days from the rule date to the exit date: 0 on the exit day or while open. A leave rule reads it on each day charged (TW 勞基法 §16(2): only inside the notice, `employment.days_to_exit < employment.exit_facts.notice_days_given`) |
| `employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `employment.contract_days` | Calendar days of a fixed-term contract, first day to last inclusive (LHDN MTD Specification 2026 D(a) note: a foreign employee on a contract of 182 days or more is withheld at resident MTD); 0 where open-ended |
| `employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `employment.exit_facts.<key>` | Departure inputs declared by the settings version effective on the final service day |
| `employment.exit_fact_keys` | Departure keys explicitly recorded on the employment, before defaults |
| `employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `employment.earned_monthly_average(months)` | The wages earlier payslips paid (basic, regular cash for work, overtime, less unpaid days; no bonus or reimbursement) over the `months` calendar months before the rule date’s month, per month of service, a part first month counted as its share (ID Permenaker 6/2016 art.3(3)–(4); MY reg.6(2) as twelve of them). Refused where a month of service has no payslip; read on a pay request or a leave cash-out |
| `employment.piece_wages_last_workdays(days)` | Earned units times unit rate on the last `days` piece-rate workdays through the final service day; refuses when a scheduled recent workday lacks earnings or explicit absence (TH LPA s.118) |
| `employment.earned_monthly_average(months, excluded)` | That average with the named filed codes taken back out of each month; `["OVERTIME"]` is every priced work-day line (CN 企业职工带薪年休假实施办法 art.11: 剔除加班工资) |
| `employment.earned_monthly_average(months, excluded, fallback)` | That average, or `fallback` where the stint served no month before the rule date’s month (CN 实施条例 art.27: a leaver in the hiring month averages the one month worked) |
| `employment.prior_service_months` | Months worked for earlier employers before this stint, as recorded on the contract; 0 unrecorded (CN 企业职工带薪年休假实施办法 art.4: annual leave counts cumulative service across employers) |
| `employment.average_daily_wage(months, codes)` | Those wages over the calendar days of the `months` months before the rule date’s month, with the days 施行細則 §2 leaves out removed with their wages: every calendar day the named leave codes’ approved time off spans, paid or not, and — with a third list, `average_daily_wage(months, codes, reduced)` — the days those codes cut the wage (TW 勞基法 §2(4)). Refused where a month of service has no payslip; read on a pay request only |
| `employment.average_monthly_wage(months, codes)` | That daily average times the covered months’ average days — one month’s average wage (勞動部 台(83)勞動二字第25564號: six months’ wages ÷ 6 where nothing is left out) |
| `employment.on_leave(date, codes)` | Whether approved time off of one of the named leave codes spans that day (TW 勞基法 §13: no employer termination inside the §50 stop or the §59 medical period); none where the site has no leave record |
| `employment.service_months_net(codes, days)` | Completed months of service with the named leave codes’ calendar days disregarded in each twelve months of service where they exceed `days` (MY EA s.60E(3B)); read on a leave rule only |
| `terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — the work-pricing day; leave cash-out has a separate dated rule; 0 where no divisor was evaluated |
| `terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed, less the classes `work_rules.wage_excluded_allowances` names (MY EA s.2 “wages” (c): travelling); on a scheme’s own expression, those counting toward that scheme |
| `terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `terms.gross_monthly` | The gross rate of pay as a month: `terms.monthly_basic` plus the contract’s allowances less the classes `work_rules.gross_excluded_allowances` names (SG EA s.2: travelling, food, housing); at the work day the exclusions apply, elsewhere every allowance counts |
| `terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `terms.statutory_work_category` | Statutory work category of the terms: a code the governing version declares in payroll.vocabularies |
| `terms.weather_dependent_piece` | Weather-dependent piece work uses twelve paid months for ID JKK, JKM and JHT |
| `terms.worksite` | The worksite the terms record: a province or province/locality, or empty |
| `terms.worksite_sector` | The worksite sector the terms record (ID: the five-digit KBLI), or empty |
| `terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `terms.payroll_group` | Payroll group — an employer’s own label, never a statute’s |
| `terms.paid_rest_days` | The contract pays every day of the month, unworked rest days, special days and regular holidays included (the DOLE Handbook’s monthly-paid employee, factor 365) |
| `terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `terms.pass_type` | The work pass: a code the governing version declares in payroll.vocabularies, or empty |
| `terms.tax_residency` | Tax residence declared on the contract, a code the governing version declares in payroll.vocabularies, or empty when unrecorded; each scheme supplies its statutory default |
| `terms.residency_since` | Date residency began as `YYYY-MM-DD`, or empty when unrecorded |
| `terms.notice_days` | Notice days the contract states, 0 when none |
| `terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `terms.comparable_full_time_daily_hours` | Similar full-time employee’s declared normal daily hours, or 0 when unrecorded |
| `terms.comparable_full_time_presence` | PRESENT if a similar full-time employee exists, ABSENT for the statutory fallback, or empty if unknown |
| `terms.working_days_per_week` | Roster-measured working week, days |
| `terms.facts.<key>` | Jurisdiction inputs the version declares in `terms_facts`, recorded on the terms in force; a declared default where unrecorded |
| `terms.fact_keys` | Terms input keys explicitly recorded on the terms in force, before defaults |
| `children.count` | Recorded child relationships active on the rule date, regardless of relationship or recorded death; a legal living-natural-child test needs its own dated function |
| `children.under(n)` | Children under n completed years |
| `children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `children.multiple_born_on(date)` | The infants of a multiple birth: children born on that day, refusing fewer than two (CN Order 619 art.7: 15 days per extra infant) |
| `children.natural_surviving_on(date)` | Natural CHILD records alive on that date, including children born that day; excludes adopted, stepchildren and wards. A death on the same date needs a time-specific determination. |
| `children.natural_surviving_before(date)` | Natural children alive before the named confinement, excluding its newborns |
| `children.natural_surviving_confinements_before(date)` | Previous confinements that produced a natural child still alive at this confinement; children born in one confinement count once |
| `children.citizens` | Children recorded as citizens |
| `children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `children.citizens_under(n)` | Of them, those under n completed years |
| `children.prior_childcare_days` | Childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG GPCL and EA s.87A lifetime caps count every employer) |
| `children.prior_extended_childcare_days` | Extended childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12B(2)(a)(ii)) |
| `children.prior_infant_care_days` | Unpaid infant care leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12D(2)(a)) |
| `children.classed(x)` | Family records in classification x; these counts do not establish tax-relief claims |
| `children.unclassed_under(n)` | Family records with no classification under n completed years; MY tax relief reads scheme.child_claims instead |
| `company.region` | Employing entity region |
| `company.headcount` | Active employments in the entity |
| `company.headcount_citizens` | Of them, the citizens |
| `company.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY; empty outside a payroll |
| `company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `wage_floor_pay.BASE` | The part of BASE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.OVERTIME` | The part of OVERTIME paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.DAY_PAY` | The part of DAY_PAY paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.NIGHT_PREMIUM` | The part of NIGHT_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.OVERTIME_PREMIUM` | The part of OVERTIME_PREMIUM paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.ABSENCE` | The part of ABSENCE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.NO_PAY_LEAVE` | The part of NO_PAY_LEAVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.ENCASHMENT` | The part of ENCASHMENT paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.INCENTIVE` | The part of INCENTIVE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `wage_floor_pay.NIGHT_WAGE` | The part of NIGHT_WAGE paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll |
| `facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `facts.<CODE>.elections.<key>` | Declared scheme inputs resolved from the statutory facts effective on the rule date |
| `facts.<CODE>.election_keys` | Keys explicitly supplied on that effective statutory declaration; distinct from resolved defaults |
| `event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `event.wife_prior_living_biological_children` | Wife’s prior living biological children at this birth, or -1 when unrecorded (VN Decree 168/2026 art.2(1)(b)) |
| `event.date` | The day of the event, or empty |
| `event.case.facts.<key>` | The recorded facts and qualifications of the benefit case this event opened (`payroll.benefit_cases`); absent without a case, so read `has(event.case.facts.<key>) && event.case.facts.<key>` |
| `event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `event.child_age` | The named child’s completed years, -1 when none is named |
| `event.child_shared_weeks` | The named child’s allocated shared-parental weeks; -1 when unrecorded, 0 for an explicit zero share |
| `event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `event.estimated_delivery_date` | The named child’s estimated delivery date as certified by a medical practitioner (SG CDCA s.2), or empty |
| `event.adoption_eligibility_date` | The eligibility date of the application to adopt the named child (SG CDCA s.2: the application date for a citizen or PR child, else the dependant’s pass issue date), or empty |
| `period.unpaid_full_days` | Scheduled dates wholly unpaid, counted once per date; paid fractions do not count |
| `period.leave_days.<CODE>` | Approved working-day leave fractions of the named code in the assessment window |
| `period.leave_full_days.<CODE>` | Approved full working dates of the named leave code in the assessment window |
| `period.leave_pay.<CODE>` | The salary the assessment window attributes to the named leave code’s days: salary × leave days ÷ working days, at most the salary |
| `period.working_days` | Scheduled working days of the pay month |
| `period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `period.overtime_days` | Dates in the assessment window with overtime hours or hours inside the night window, counted once per date |
| `period.arrears` | The wage of a deferred earlier period (a joiner after the cut-off) this payslip pays as back pay, already inside BASE; 0 otherwise. A law that prices each contribution month on its own wage caps it separately (ID PP 45/2015 art.29(1)) |
| `consecutive_hours` | The longest unbroken work run in the day |
| `overtime_hours` | Payable overtime hours: the approved hours plus the day type’s clock-derived premium |
| `continuous_attendance` | Work that must be carried on continuously |
| `night_hours` | Hours inside the night window, 0 where none is declared |

| Function | Meaning |
| --- | --- |
| `round_cent(value)` | Round to the nearest cent |
| `truncate_cent(value)` | Truncate to the cent |
| `up_5_cents(value)` | Round up to the next five cents |
| `round_unit(value)` | Round to the nearest whole unit |
| `floor_unit(value)` | Floor to the whole unit |
| `up_to_unit(value)` | Round up to the whole unit |
| `bracket(base, up_to, step)` | Round a figure up to the next bracket |
| `ladder(base, grades)` | Step a figure up to the next grade in a table |
| `progressive(value, table)` | Apply a progressive [from, base, rate] table |
| `add_months(date, months)` | The calendar day `months` months after a `YYYY-MM-DD` day, clamped to the month’s last day; empty for an empty day |
| `months_through(from, through)` | Months from one `YYYY-MM-DD` day through another inclusive: completed months plus the part month by its days; 0 when either is empty or `through` is before `from` |
| `minimum_wage(region)` | The version’s minimum wage for a region |

## `payment` — One actual payment and the obligation it settles: their declared inputs.

Used by: `jurisdiction_settings.payment_facts[]` and `settlement_facts[]` conditions — one actual payment.

Open prefixes: `payment.facts.<key>`, `settlement.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `payment.kind` | CASH \| NON_CASH_SETTLEMENT |
| `payment.paid_on` | The day the payment was made, `YYYY-MM-DD` |
| `payment.currency` | The payment currency |
| `payment.facts.<key>` | Jurisdiction inputs the version declares in `payment_facts`, recorded with the payment |
| `payment.fact_keys` | Payment input keys explicitly recorded |
| `settlement.tax_residency` | RESIDENT \| NON_RESIDENT: the evidenced tax residence of the settled non-contract obligation; empty for a payslip |
| `settlement.facts.<key>` | Jurisdiction inputs the version declares in `settlement_facts`, recorded on the settled obligation |
| `settlement.fact_keys` | Settlement input keys explicitly recorded |

| Function | Meaning |
| --- | --- |
| `round_cent(value)` | Round to the nearest cent |
| `truncate_cent(value)` | Truncate to the cent |
| `up_5_cents(value)` | Round up to the next five cents |
| `round_unit(value)` | Round to the nearest whole unit |
| `floor_unit(value)` | Floor to the whole unit |
| `up_to_unit(value)` | Round up to the whole unit |
| `bracket(base, up_to, step)` | Round a figure up to the next bracket |
| `ladder(base, grades)` | Step a figure up to the next grade in a table |
| `progressive(value, table)` | Apply a progressive [from, base, rate] table |
| `add_months(date, months)` | The calendar day `months` months after a `YYYY-MM-DD` day, clamped to the month’s last day; empty for an empty day |
| `months_through(from, through)` | Months from one `YYYY-MM-DD` day through another inclusive: completed months plus the part month by its days; 0 when either is empty or `through` is before `from` |
