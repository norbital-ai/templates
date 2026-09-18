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
| `employee.citizenship` | Residency standing from the effective terms |
| `employee.marital_status` | Marital status |
| `employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `employee.solo_parent` | Solo-parent flag |
| `employee.disabled` | Disability flag |
| `employee.race` | Recorded race |
| `employee.religion` | Recorded religion |
| `employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `employment.classification` | Work classification |
| `employment.risk_class` | The employment risk class, or empty |
| `employment.service_months` | Completed months since the stint began |
| `employment.service_years` | Completed years since the stint began |
| `employment.exit_date` | Last day of work, or empty while open |
| `employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `terms.fixed_allowances` | Standing PAY allowances in force on the rule date |
| `terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `terms.statutory_work_category` | Statutory work category of the terms |
| `terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `terms.payroll_group` | Payroll group |
| `terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| OTHER, or empty |
| `terms.tax_residency` | RESIDENT \| NON_RESIDENT declared on the contract, or empty for the citizenship default |
| `terms.notice_days` | Notice days the contract states, 0 when none |
| `terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `terms.working_days_per_week` | Roster-measured working week, days |
| `children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `children.under(n)` | Children under n completed years |
| `children.citizens` | Children recorded as citizens |
| `children.citizens_under(n)` | Of them, those under n completed years |
| `company.region` | Employing entity region |
| `company.headcount` | Active employments in the entity |
| `company.headcount_citizens` | Of them, the citizens |
| `company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
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
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race |
| `person.employee.religion` | Recorded religion |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_months` | Completed months since the stint began |
| `person.employment.service_years` | Completed years since the stint began |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.fixed_allowances` | Standing PAY allowances in force on the rule date |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `person.terms.statutory_work_category` | Statutory work category of the terms |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| OTHER, or empty |
| `person.terms.tax_residency` | RESIDENT \| NON_RESIDENT declared on the contract, or empty for the citizenship default |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `person.children.under(n)` | Children under n completed years |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
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
| `period.start` | First day of the pay period |
| `period.end` | Last day of the pay period |
| `period.index` | Which instalment of the month this period is |
| `period.instalments` | Instalments the month is paid in |
| `period.last_of_year` | This period closes the tax year, or is a leaver’s last |
| `period.days_employed` | Days of the pay month the employment covered, in the proration basis’s units (the payslip’s proration segments summed) |
| `period.days_in_month` | Calendar days of the pay month |
| `year.start` | First day of the tax year |
| `year.end` | Last day of the tax year |
| `year.months_employed` | Completed months of this employment in the tax year, through the period end |
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
| `leave.days(code)` | Charged days of one leave code in the window |

## `work_day` — One priced person-day: work bands and owed breaks.

Used by: work bands, breaks, limits and the night premium — one priced person-day.

Bare names: `date`, `day_type`, `worked_hours`, `normal_hours`, `hours_beyond_normal`, `hours_from_start_fraction`, `overtime_hours`, `consecutive_hours`, `continuous_attendance`, `rest_day`, `off_day`, `night_hours`, `requested_by`, `ordinary_hour`, `day_wage`, `hours`.

Open prefixes: `limits.<key>`, `person.company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race |
| `person.employee.religion` | Recorded religion |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_months` | Completed months since the stint began |
| `person.employment.service_years` | Completed years since the stint began |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.fixed_allowances` | Standing PAY allowances in force on the rule date |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `person.terms.statutory_work_category` | Statutory work category of the terms |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| OTHER, or empty |
| `person.terms.tax_residency` | RESIDENT \| NON_RESIDENT declared on the contract, or empty for the citizenship default |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `person.children.under(n)` | Children under n completed years |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
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

Bare names: `BASE`, `OVERTIME`, `NIGHT_PREMIUM`, `OVERTIME_PREMIUM`, `ABSENCE`, `NO_PAY_LEAVE`, `ENCASHMENT`.

Open prefixes: `produced.<key>`, `year.<key>`, `scheme.elections.<key>`, `person.company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race |
| `person.employee.religion` | Recorded religion |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_months` | Completed months since the stint began |
| `person.employment.service_years` | Completed years since the stint began |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.fixed_allowances` | Standing PAY allowances in force on the rule date |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `person.terms.statutory_work_category` | Statutory work category of the terms |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| OTHER, or empty |
| `person.terms.tax_residency` | RESIDENT \| NON_RESIDENT declared on the contract, or empty for the citizenship default |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `person.children.under(n)` | Children under n completed years |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
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
| `period.start` | First day of the pay period |
| `period.end` | Last day of the pay period |
| `period.index` | Which instalment of the month this period is |
| `period.instalments` | Instalments the month is paid in |
| `period.last_of_year` | This period closes the tax year, or is a leaver’s last |
| `period.days_employed` | Days of the pay month the employment covered, in the proration basis’s units (the payslip’s proration segments summed) |
| `period.days_in_month` | Calendar days of the pay month |
| `year.start` | First day of the tax year |
| `year.end` | Last day of the tax year |
| `year.months_employed` | Completed months of this employment in the tax year, through the period end |
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
| `code('X')` | The signed total of the version’s row X this payslip |
| `catalog('ALLOWANCE' | 'CLAIM' | 'LOAN', { pick | exclude })` | The signed sum of a catalogue’s rows, selected or excluded |
| `annual_exempt(amount, earned_before, cap)` | The part still inside an annual exemption |

## `scheme` — One statutory scheme for one person and period: rules and rate bands.

Used by: contribution rules — the `when`, `employee` and `employer` of each rung.

Bare names: `base`.

Open prefixes: `produced.<key>`, `year.<key>`, `scheme.elections.<key>`, `person.company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.employee.gender` | Recorded gender |
| `person.employee.age` | Completed years on the rule date |
| `person.employee.age_months` | Whole calendar months since birth, for a band that moves the month after a birthday |
| `person.employee.citizenship` | Residency standing from the effective terms |
| `person.employee.marital_status` | Marital status |
| `person.employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `person.employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `person.employee.solo_parent` | Solo-parent flag |
| `person.employee.disabled` | Disability flag |
| `person.employee.race` | Recorded race |
| `person.employee.religion` | Recorded religion |
| `person.employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `person.employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `person.employment.classification` | Work classification |
| `person.employment.risk_class` | The employment risk class, or empty |
| `person.employment.service_months` | Completed months since the stint began |
| `person.employment.service_years` | Completed years since the stint began |
| `person.employment.exit_date` | Last day of work, or empty while open |
| `person.employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `person.employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `person.terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `person.terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `person.terms.fixed_allowances` | Standing PAY allowances in force on the rule date |
| `person.terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `person.terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `person.terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `person.terms.statutory_work_category` | Statutory work category of the terms |
| `person.terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `person.terms.payroll_group` | Payroll group |
| `person.terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `person.terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `person.terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| OTHER, or empty |
| `person.terms.tax_residency` | RESIDENT \| NON_RESIDENT declared on the contract, or empty for the citizenship default |
| `person.terms.notice_days` | Notice days the contract states, 0 when none |
| `person.terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `person.terms.working_days_per_week` | Roster-measured working week, days |
| `person.children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `person.children.under(n)` | Children under n completed years |
| `person.children.citizens` | Children recorded as citizens |
| `person.children.citizens_under(n)` | Of them, those under n completed years |
| `person.company.region` | Employing entity region |
| `person.company.headcount` | Active employments in the entity |
| `person.company.headcount_citizens` | Of them, the citizens |
| `person.company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `person.wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `person.facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
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
| `period.start` | First day of the pay period |
| `period.end` | Last day of the pay period |
| `period.index` | Which instalment of the month this period is |
| `period.instalments` | Instalments the month is paid in |
| `period.last_of_year` | This period closes the tax year, or is a leaver’s last |
| `period.days_employed` | Days of the pay month the employment covered, in the proration basis’s units (the payslip’s proration segments summed) |
| `period.days_in_month` | Calendar days of the pay month |
| `year.start` | First day of the tax year |
| `year.end` | Last day of the tax year |
| `year.months_employed` | Completed months of this employment in the tax year, through the period end |
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
| `employee.citizenship` | Residency standing from the effective terms |
| `employee.marital_status` | Marital status |
| `employee.spouse_status` | NONE \| WITHOUT_INCOME \| WITH_INCOME |
| `employee.dependents_count` | Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead |
| `employee.solo_parent` | Solo-parent flag |
| `employee.disabled` | Disability flag |
| `employee.race` | Recorded race |
| `employee.religion` | Recorded religion |
| `employee.residency_months` | Whole calendar months since residency began, for a ladder that moves the month after an anniversary |
| `employment.type` | PERMANENT \| CONTRACT \| PROBATION \| INTERN \| CONSULTANT \| PART_TIME \| APPRENTICE \| DOMESTIC |
| `employment.classification` | Work classification |
| `employment.risk_class` | The employment risk class, or empty |
| `employment.service_months` | Completed months since the stint began |
| `employment.service_years` | Completed years since the stint began |
| `employment.exit_date` | Last day of work, or empty while open |
| `employment.exit_reason` | RESIGNATION \| DISMISSAL \| REDUNDANCY \| RETIREMENT \| END_OF_CONTRACT \| MUTUAL \| DEATH, or empty |
| `employment.absent_days_12m` | Rostered days with an empty punch in the twelve months to the rule date (leave rules only) |
| `terms.basic_salary` | Contracted base salary, in the cadence it is stated |
| `terms.monthly_basic` | The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week |
| `terms.fixed_allowances` | Standing PAY allowances in force on the rule date |
| `terms.monthly_wage` | Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of |
| `terms.statutory_wages` | Wages a statutory ceiling reads: basic plus every other cash payment for work in the run |
| `terms.workman` | Statutory work category starts with MANUAL_LABOUR |
| `terms.statutory_work_category` | Statutory work category of the terms |
| `terms.department` | Department — an employer’s own catalogue tier, never a statute’s |
| `terms.payroll_group` | Payroll group |
| `terms.grade` | Grade — an employer’s own catalogue tier, never a statute’s |
| `terms.pay_frequency` | MONTHLY \| SEMI_MONTHLY \| WEEKLY \| DAILY \| HOURLY |
| `terms.pass_type` | EMPLOYMENT_PASS \| S_PASS \| WORK_PERMIT \| OTHER, or empty |
| `terms.tax_residency` | RESIDENT \| NON_RESIDENT declared on the contract, or empty for the citizenship default |
| `terms.notice_days` | Notice days the contract states, 0 when none |
| `terms.ordinary_hours_per_week` | Roster-measured working week, hours |
| `terms.working_days_per_week` | Roster-measured working week, days |
| `children.count` | Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count` |
| `children.under(n)` | Children under n completed years |
| `children.citizens` | Children recorded as citizens |
| `children.citizens_under(n)` | Of them, those under n completed years |
| `company.region` | Employing entity region |
| `company.headcount` | Active employments in the entity |
| `company.headcount_citizens` | Of them, the citizens |
| `company.facts.<key>` | Entity facts the version declares: sector, establishment tests |
| `wage_floor` | The region’s minimum wage, or 0 when the wages order excludes this person |
| `facts.<CODE>.registered` | Whether the employment is registered with the scheme of that code |
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
