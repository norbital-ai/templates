# What the payroll engine evaluates

Rendered from `src/lib/expressions/contexts.ts` — do not edit by hand; `pnpm exec node --experimental-strip-types --import ./scripts/ts-source-resolve.mjs scripts/render-expression-context.ts` rewrites it and `tests/expression-context-doc.test.ts` holds it current.

Every expression in a sealed version is CEL over one of six sites. A site carries the roots listed here and nothing else: a member the site does not declare is refused at write. Open prefixes (`limits.<key>`, `year.earned.<code>`, `produced.<code>`, `scheme.elections.<key>`, `person.company.facts.<key>`) are keys the version itself declares.

## `person` — The person on the rule date: catalogue and scheme eligibility.

Used by: catalogue eligibility, a scheme’s person conditions, `wages.applies_when`, `overtime_when`.

Bare names: `wage_floor`.

Open prefixes: `company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `employee.gender` | Recorded gender |
| `employee.age` | Completed years on the rule date |
| `employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `employee.citizenship` | Residency standing from the effective terms |
| `employee.marital_status` | Marital status |
| `employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `employee.solo_parent` | Solo-parent flag |
| `employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `employee.disabled` | Disability flag |
| `employee.race` | Recorded race, upper-cased (SG SHG funds read CHINESE, INDIAN, EURASIAN) |
| `employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `employment.classification` | Work classification |
| `employment.risk_class` | The employment risk class, or empty |
| `employment.service_days` | Calendar days since the stint began, the rule date included (MY s.37(2)(a): ninety days) |
| `employment.service_months` | Completed months since the stint began |
| `employment.service_years` | Completed years since the stint began |
| `employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `employment.exit_date` | Last day of work, or empty while open |
| `employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — what a leave day is encashed or deducted at; 0 where no divisor was evaluated |
| `terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed; on a scheme’s own expression, those counting toward that scheme |
| `terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `terms.statutory_work_category` | Statutory work category of the terms |
| `terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `terms.payroll_group` | Payroll group |
| `terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| INTRA_COMPANY_TRANSFER \| OTHER, or empty (a transferee within the enterprise is outside VN social insurance, Law 41/2024 art.2(2)(a)) |
| `terms.tax_residency` | RESIDENT \| NON_RESIDENT \| NON_RESIDENT_NETB declared on the contract, or empty for the citizenship default (NETB: a non-resident alien not engaged in trade or business, PH NIRC s.25(B)) |
| `terms.notice_days` | Notice days the contract states, 0 when none |
| `terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `terms.working_days_per_week` | Roster-measured working week, days |
| `children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `children.under(n)` | Children under n completed years |
| `children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `children.citizens` | Children recorded as citizens |
| `children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `children.citizens_under(n)` | Of them, those under n completed years |
| `children.classed(x)` | Children in the relief class x declared on the child (MY: STUDYING, TERTIARY, DISABLED, DISABLED_TERTIARY) |
| `children.unclassed_under(n)` | Children with no declared relief class under n completed years — the ordinary child of a relief ladder (MY s.48(1)(a): under eighteen) |
| `company.region` | Employing entity region |
| `company.headcount` | Active employments in the entity |
| `company.headcount_citizens` | Of them, the citizens |
| `company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `event.date` | The day of the event, or empty |
| `event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `event.child_age` | The named child’s completed years, -1 when none is named |
| `event.child_shared_weeks` | The weeks of the couple’s shared parental pool this parent takes for the named child, as recorded; 0 when unrecorded |
| `event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `period.working_days` | Scheduled working days of the pay month |
| `period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |

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
| `minimum_wage(region)` | The version’s minimum wage for a region |

## `entry` — One catalogue entry as the run collects it: band amounts and the charged days.

Used by: catalogue bands and entitlement amounts — one claim, allowance or loan entry.

Open prefixes: `limits.<key>`, `year.<key>`, `person.company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `person.employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `person.employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race, upper-cased (SG SHG funds read CHINESE, INDIAN, EURASIAN) |
| `person.employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_days` | Calendar days since the stint began, the rule date included (MY s.37(2)(a): ninety days) |
| `person.employment.service_months` | Completed months since the stint began |
| `person.employment.service_years` | Completed years since the stint began |
| `person.employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `person.employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — what a leave day is encashed or deducted at; 0 where no divisor was evaluated |
| `person.terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed; on a scheme’s own expression, those counting toward that scheme |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `person.terms.statutory_work_category` | Statutory work category of the terms |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| INTRA_COMPANY_TRANSFER \| OTHER, or empty (a transferee within the enterprise is outside VN social insurance, Law 41/2024 art.2(2)(a)) |
| `person.terms.tax_residency` | RESIDENT \| NON_RESIDENT \| NON_RESIDENT_NETB declared on the contract, or empty for the citizenship default (NETB: a non-resident alien not engaged in trade or business, PH NIRC s.25(B)) |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `person.children.under(n)` | Children under n completed years |
| `person.children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.children.classed(x)` | Children in the relief class x declared on the child (MY: STUDYING, TERTIARY, DISABLED, DISABLED_TERTIARY) |
| `person.children.unclassed_under(n)` | Children with no declared relief class under n completed years — the ordinary child of a relief ladder (MY s.48(1)(a): under eighteen) |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `person.facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `person.facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `person.event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `person.event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `person.event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `person.event.date` | The day of the event, or empty |
| `person.event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `person.event.child_age` | The named child’s completed years, -1 when none is named |
| `person.event.child_shared_weeks` | The weeks of the couple’s shared parental pool this parent takes for the named child, as recorded; 0 when unrecorded |
| `person.event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `person.period.working_days` | Scheduled working days of the pay month |
| `person.period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `entry.amount` | The keyed amount; zero where the entry carries none |
| `entry.days` | Charged days |
| `entry.hours` | Recorded hours |
| `entry.quantity` | Recorded quantity |
| `entry.event_date` | The day the entry belongs to |
| `entry.period` | Pay period key the entry settles in |
| `entry.window.start` | Standing allowance window start |
| `entry.window.end` | Standing allowance window end |
| `entry.captures.remaining` | Amount still to settle |
| `rates.ordinary_day` | Ordinary day rate for the entry date |
| `rates.ordinary_hour` | Ordinary hour rate for the entry date |
| `limits.<key>` | Evaluated work limit, net worked hours |
| `period.key` | YYYY-MM or YYYY-MM-n |
| `period.month` | The pay month, 1–12 |
| `period.start` | First day of the pay period |
| `period.end` | Last day of the pay period |
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
| `leave.days(code)` | Charged days of one leave code in the window |

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
| `minimum_wage(region)` | The version’s minimum wage for a region |
| `leave.days(code)` | Charged days of one leave code in the window |

## `work_day` — One priced person-day: work bands and owed breaks.

Used by: work bands, breaks, limits and the night premium — one priced person-day.

Bare names: `date`, `day_type`, `worked_hours`, `normal_hours`, `hours_beyond_normal`, `hours_from_start_fraction`, `overtime_hours`, `consecutive_hours`, `continuous_attendance`, `rest_day`, `statutory_rest`, `off_day`, `night_hours`, `requested_by`, `ordinary_hour`, `day_wage`, `hours`.

Open prefixes: `limits.<key>`, `person.company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `person.employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `person.employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race, upper-cased (SG SHG funds read CHINESE, INDIAN, EURASIAN) |
| `person.employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_days` | Calendar days since the stint began, the rule date included (MY s.37(2)(a): ninety days) |
| `person.employment.service_months` | Completed months since the stint began |
| `person.employment.service_years` | Completed years since the stint began |
| `person.employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `person.employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — what a leave day is encashed or deducted at; 0 where no divisor was evaluated |
| `person.terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed; on a scheme’s own expression, those counting toward that scheme |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `person.terms.statutory_work_category` | Statutory work category of the terms |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| INTRA_COMPANY_TRANSFER \| OTHER, or empty (a transferee within the enterprise is outside VN social insurance, Law 41/2024 art.2(2)(a)) |
| `person.terms.tax_residency` | RESIDENT \| NON_RESIDENT \| NON_RESIDENT_NETB declared on the contract, or empty for the citizenship default (NETB: a non-resident alien not engaged in trade or business, PH NIRC s.25(B)) |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `person.children.under(n)` | Children under n completed years |
| `person.children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.children.classed(x)` | Children in the relief class x declared on the child (MY: STUDYING, TERTIARY, DISABLED, DISABLED_TERTIARY) |
| `person.children.unclassed_under(n)` | Children with no declared relief class under n completed years — the ordinary child of a relief ladder (MY s.48(1)(a): under eighteen) |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `person.facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `person.facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `person.event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `person.event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `person.event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `person.event.date` | The day of the event, or empty |
| `person.event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `person.event.child_age` | The named child’s completed years, -1 when none is named |
| `person.event.child_shared_weeks` | The weeks of the couple’s shared parental pool this parent takes for the named child, as recorded; 0 when unrecorded |
| `person.event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `person.period.working_days` | Scheduled working days of the pay month |
| `person.period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `date` | The day |
| `day_type` | ORDINARY \| REST_DAY \| PUBLIC_HOLIDAY \| SPECIAL_HOLIDAY \| OFF_DAY |
| `worked_hours` | Net worked hours |
| `normal_hours` | The scheduled normal hours |
| `hours_beyond_normal` | Worked hours past the normal day |
| `hours_from_start_fraction` | Worked share of a normal day, 0..1 |
| `overtime_hours` | Derived overtime hours |
| `consecutive_hours` | Longest unbroken work run in the day |
| `continuous_attendance` | Work that must be carried on continuously |
| `rest_day` | The roster’s weekly rest day, whatever the holiday made it |
| `statutory_rest` | The rest day the statute forbids work on — a REST code marked `statutory` (TW 勞基法 §36 例假; §40 pays a worked one a further day’s wage and owes a day off in lieu) |
| `off_day` | The roster left the day unassigned before the holiday |
| `night_hours` | Hours inside the night window, 0 where none is declared; a break rule reads it too |
| `requested_by` | EMPLOYER \| EMPLOYEE: who asked for rest-day work |
| `ordinary_hour` | Ordinary hour rate |
| `day_wage` | Ordinary day wage |
| `hours` | The hours this band consumed, for its price |
| `limits.<key>` | Evaluated work limit, net worked hours |
| `holiday.kind` | The published row on the date, in the day-type words: PUBLIC_HOLIDAY \| SPECIAL_HOLIDAY \| SUBSTITUTE, or empty; unlike `day_type` it does not move with the precedence rule |
| `holiday.name` | Published holiday name, or empty |

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

## `assessment` — One scheme’s wage: the reserved lines, the catalogue rows and the shared roots.

Used by: `statutory_contributions.assessed_on` and `ordinary_on` — one scheme’s wage.

Bare names: `BASE`, `OVERTIME`, `NIGHT_PREMIUM`, `OVERTIME_PREMIUM`, `ABSENCE`, `NO_PAY_LEAVE`, `ENCASHMENT`, `INCENTIVE`, `ALLOWANCES`, `ADHOC`, `CLAIMS`.

Open prefixes: `produced.<key>`, `year.<key>`, `scheme.elections.<key>`, `person.company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `person.employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `person.employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race, upper-cased (SG SHG funds read CHINESE, INDIAN, EURASIAN) |
| `person.employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_days` | Calendar days since the stint began, the rule date included (MY s.37(2)(a): ninety days) |
| `person.employment.service_months` | Completed months since the stint began |
| `person.employment.service_years` | Completed years since the stint began |
| `person.employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `person.employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — what a leave day is encashed or deducted at; 0 where no divisor was evaluated |
| `person.terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed; on a scheme’s own expression, those counting toward that scheme |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `person.terms.statutory_work_category` | Statutory work category of the terms |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| INTRA_COMPANY_TRANSFER \| OTHER, or empty (a transferee within the enterprise is outside VN social insurance, Law 41/2024 art.2(2)(a)) |
| `person.terms.tax_residency` | RESIDENT \| NON_RESIDENT \| NON_RESIDENT_NETB declared on the contract, or empty for the citizenship default (NETB: a non-resident alien not engaged in trade or business, PH NIRC s.25(B)) |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `person.children.under(n)` | Children under n completed years |
| `person.children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.children.classed(x)` | Children in the relief class x declared on the child (MY: STUDYING, TERTIARY, DISABLED, DISABLED_TERTIARY) |
| `person.children.unclassed_under(n)` | Children with no declared relief class under n completed years — the ordinary child of a relief ladder (MY s.48(1)(a): under eighteen) |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `person.facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `person.facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `person.event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `person.event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `person.event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `person.event.date` | The day of the event, or empty |
| `person.event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `person.event.child_age` | The named child’s completed years, -1 when none is named |
| `person.event.child_shared_weeks` | The weeks of the couple’s shared parental pool this parent takes for the named child, as recorded; 0 when unrecorded |
| `person.event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `person.period.working_days` | Scheduled working days of the pay month |
| `person.period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `period.key` | YYYY-MM or YYYY-MM-n |
| `period.month` | The pay month, 1–12 |
| `period.start` | First day of the pay period |
| `period.end` | Last day of the pay period |
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
| `scheme.code` | The scheme code |
| `scheme.assessment_period` | PAY_PERIOD \| MONTH |
| `scheme.year_to_date.base` | Base already charged this tax year: this employer’s earlier slips plus what an earlier employer declared on the fact (`opening`) |
| `scheme.year_to_date.ordinary` | The ordinary part of the base already charged this tax year, where the scheme states `ordinary_on` |
| `scheme.year_to_date.employee` | Employee amount already charged this tax year |
| `scheme.year_to_date.employer` | Employer amount already charged this tax year |
| `scheme.projection.payslips_remaining` | Payslips left in the year, this one included |
| `scheme.projection.future_equivalents` | Future payslips of this size |
| `scheme.rate_override` | The employment flat rate override percentage, 0 when none |
| `scheme.since` | The day this employment registered with the scheme, or empty |
| `scheme.since_months` | Completed months since registration, 0 when unrecorded |
| `scheme.elections.<key>` | The employment’s elections under this scheme, keys the scheme row declares |
| `produced.<code>.employee` | The relievable employee share, capped and projected; for an uncapped producer it is the year to date plus this period |
| `produced.<code>.employee_this_period` | The employee share charged this period alone, floored at zero — the relief a per-period withholding table subtracts |
| `produced.<code>.employer` | The employer share |
| `produced.<code>.base` | The base the producer was charged on this period — a graded insured amount another scheme measures against; on the company site, the sum over the run |
| `BASE` | The salary line |
| `OVERTIME` | Every overtime and incentive line |
| `NIGHT_PREMIUM` | The night premium line |
| `OVERTIME_PREMIUM` | The part of every overtime line above the ordinary hour: amount less hours × ordinary hour |
| `ABSENCE` | Unexplained absence and every unpaid leave day |
| `NO_PAY_LEAVE` | Unpaid leave days |
| `ENCASHMENT` | Every encashed leave day |
| `INCENTIVE` | The overtime lines a band funnelled above its named limit — the hours beyond the statutory ceiling, priced at the band’s award; also inside OVERTIME |
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
| `minimum_wage(region)` | The version’s minimum wage for a region |
| `code('X')` | The signed total of the version’s class X this payslip — for a law that caps or exempts one class alone (MY’s termination-benefit exemption, PH’s de-minimis rice subsidy) |
| `earned_average(code, months_back, months)` | The average of a component’s earnings on the person’s earlier payslips over `months` calendar months, the window ending `months_back` months before this pay month; 0 with no history in the window. `code` may be a list of codes — reserved lines among them (`OVERTIME`) — summed month by month (TW 施行細則 §27: the three-month average of 工資, overtime included) |
| `days_under(age)` | The calendar days of the pay window on which the person is under that age — a cover that ends on a birthday charges the days before it (TW 勞保條例施行細則 §28-1 at sixty-five) |
| `annual_exempt(amount, earned_before, cap)` | The part still inside an annual exemption |

## `scheme` — One statutory scheme for one person and period: rules and rate bands.

Used by: contribution rules — the `when`, `employee` and `employer` of each rung.

Bare names: `base`, `ordinary`.

Open prefixes: `produced.<key>`, `year.<key>`, `scheme.elections.<key>`, `person.company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `person.employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `person.employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race, upper-cased (SG SHG funds read CHINESE, INDIAN, EURASIAN) |
| `person.employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_days` | Calendar days since the stint began, the rule date included (MY s.37(2)(a): ninety days) |
| `person.employment.service_months` | Completed months since the stint began |
| `person.employment.service_years` | Completed years since the stint began |
| `person.employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `person.employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — what a leave day is encashed or deducted at; 0 where no divisor was evaluated |
| `person.terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed; on a scheme’s own expression, those counting toward that scheme |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `person.terms.statutory_work_category` | Statutory work category of the terms |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| INTRA_COMPANY_TRANSFER \| OTHER, or empty (a transferee within the enterprise is outside VN social insurance, Law 41/2024 art.2(2)(a)) |
| `person.terms.tax_residency` | RESIDENT \| NON_RESIDENT \| NON_RESIDENT_NETB declared on the contract, or empty for the citizenship default (NETB: a non-resident alien not engaged in trade or business, PH NIRC s.25(B)) |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `person.children.under(n)` | Children under n completed years |
| `person.children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.children.classed(x)` | Children in the relief class x declared on the child (MY: STUDYING, TERTIARY, DISABLED, DISABLED_TERTIARY) |
| `person.children.unclassed_under(n)` | Children with no declared relief class under n completed years — the ordinary child of a relief ladder (MY s.48(1)(a): under eighteen) |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `person.facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `person.facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `person.event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `person.event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `person.event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `person.event.date` | The day of the event, or empty |
| `person.event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `person.event.child_age` | The named child’s completed years, -1 when none is named |
| `person.event.child_shared_weeks` | The weeks of the couple’s shared parental pool this parent takes for the named child, as recorded; 0 when unrecorded |
| `person.event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `person.period.working_days` | Scheduled working days of the pay month |
| `person.period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `period.key` | YYYY-MM or YYYY-MM-n |
| `period.month` | The pay month, 1–12 |
| `period.start` | First day of the pay period |
| `period.end` | Last day of the pay period |
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
| `scheme.code` | The scheme code |
| `scheme.assessment_period` | PAY_PERIOD \| MONTH |
| `scheme.year_to_date.base` | Base already charged this tax year: this employer’s earlier slips plus what an earlier employer declared on the fact (`opening`) |
| `scheme.year_to_date.ordinary` | The ordinary part of the base already charged this tax year, where the scheme states `ordinary_on` |
| `scheme.year_to_date.employee` | Employee amount already charged this tax year |
| `scheme.year_to_date.employer` | Employer amount already charged this tax year |
| `scheme.projection.payslips_remaining` | Payslips left in the year, this one included |
| `scheme.projection.future_equivalents` | Future payslips of this size |
| `scheme.rate_override` | The employment flat rate override percentage, 0 when none |
| `scheme.since` | The day this employment registered with the scheme, or empty |
| `scheme.since_months` | Completed months since registration, 0 when unrecorded |
| `scheme.elections.<key>` | The employment’s elections under this scheme, keys the scheme row declares |
| `produced.<code>.employee` | The relievable employee share, capped and projected; for an uncapped producer it is the year to date plus this period |
| `produced.<code>.employee_this_period` | The employee share charged this period alone, floored at zero — the relief a per-period withholding table subtracts |
| `produced.<code>.employer` | The employer share |
| `produced.<code>.base` | The base the producer was charged on this period — a graded insured amount another scheme measures against; on the company site, the sum over the run |
| `base` | The result of the scheme’s `assessed_on` formula |
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
| `minimum_wage(region)` | The version’s minimum wage for a region |
| `days_under(age)` | The calendar days of the pay window on which the person is under that age — a cover that ends on a birthday charges the days before it (TW 勞保條例施行細則 §28-1 at sixty-five) |
| `annual_exempt(amount, earned_before, cap)` | The part still inside an annual exemption |

## `leave_day` — One charged day of leave: the person that day, and where in the leave it falls.

Used by: `leave_catalogue.pay_fraction` — one charged leave day.

Bare names: `wage_floor`.

Open prefixes: `company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `employee.gender` | Recorded gender |
| `employee.age` | Completed years on the rule date |
| `employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `employee.birth_date` | Date of birth as `YYYY-MM-DD`, or empty |
| `employee.age_months_on(date)` | Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026) |
| `employee.age_on(date)` | Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters |
| `employee.citizenship` | Residency standing from the effective terms |
| `employee.marital_status` | Marital status |
| `employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `employee.solo_parent` | Solo-parent flag |
| `employee.receiving_pension` | Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3)) |
| `employee.disabled` | Disability flag |
| `employee.race` | Recorded race, upper-cased (SG SHG funds read CHINESE, INDIAN, EURASIAN) |
| `employee.religion` | Recorded religion, upper-cased (SG MBMF reads ISLAM) |
| `employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `employment.classification` | Work classification |
| `employment.risk_class` | The employment risk class, or empty |
| `employment.service_days` | Calendar days since the stint began, the rule date included (MY s.37(2)(a): ninety days) |
| `employment.service_months` | Completed months since the stint began |
| `employment.service_years` | Completed years since the stint began |
| `employment.service_start` | First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire |
| `employment.exit_date` | Last day of work, or empty while open |
| `employment.open_ended` | Whether the contract states no end; a fixed-term contract’s end is its `exit_date` |
| `employment.contract_months` | Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended |
| `employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETRENCHMENT \| UNILATERAL \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `terms.ordinary_day` | One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — what a leave day is encashed or deducted at; 0 where no divisor was evaluated |
| `terms.fixed_allowances` | The allowances on the contract in force on the rule date, summed; on a scheme’s own expression, those counting toward that scheme |
| `terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `terms.monthly_wage_6m_average` | The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger |
| `terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `terms.statutory_work_category` | Statutory work category of the terms |
| `terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `terms.payroll_group` | Payroll group |
| `terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| INTRA_COMPANY_TRANSFER \| OTHER, or empty (a transferee within the enterprise is outside VN social insurance, Law 41/2024 art.2(2)(a)) |
| `terms.tax_residency` | RESIDENT \| NON_RESIDENT \| NON_RESIDENT_NETB declared on the contract, or empty for the citizenship default (NETB: a non-resident alien not engaged in trade or business, PH NIRC s.25(B)) |
| `terms.notice_days` | Notice days the contract states, 0 when none |
| `terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `terms.working_days_per_week` | Roster-measured working week, days |
| `children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `children.under(n)` | Children under n completed years |
| `children.born_on(date)` | Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third) |
| `children.citizens` | Children recorded as citizens |
| `children.births` | Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement) |
| `children.citizens_under(n)` | Of them, those under n completed years |
| `children.classed(x)` | Children in the relief class x declared on the child (MY: STUDYING, TERTIARY, DISABLED, DISABLED_TERTIARY) |
| `children.unclassed_under(n)` | Children with no declared relief class under n completed years — the ordinary child of a relief ladder (MY s.48(1)(a): under eighteen) |
| `company.region` | Employing entity region |
| `company.headcount` | Active employments in the entity |
| `company.headcount_citizens` | Of them, the citizens |
| `company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
| `facts.<CODE>.since` | The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`) |
| `facts.<CODE>.since_months` | Completed months since the employment registered with that scheme, 0 when unrecorded |
| `event.kind` | The per-event leave’s event: BIRTH \| MISCARRIAGE \| ADOPTION \| MARRIAGE \| DEATH \| …, or empty |
| `event.relationship` | Whose event: SPOUSE \| CHILD \| PARENT \| …, or empty |
| `event.child_index` | Which recorded child the event concerns, 1-based; 0 when none |
| `event.date` | The day of the event, or empty |
| `event.child_citizenship` | The named child’s recorded citizenship, or empty |
| `event.child_age` | The named child’s completed years, -1 when none is named |
| `event.child_shared_weeks` | The weeks of the couple’s shared parental pool this parent takes for the named child, as recorded; 0 when unrecorded |
| `event.prior_employment_days` | Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded |
| `period.working_days` | Scheduled working days of the pay month |
| `period.unpaid_days` | Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch |
| `leave.month_index` | Which month of the leave the day is in, from 1 |
| `leave.day_index` | Which calendar day of the leave, from 1 |
| `leave.days` | The days the whole entry charges |
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
| `minimum_wage(region)` | The version’s minimum wage for a region |
