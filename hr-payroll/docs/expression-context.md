# What the payroll engine evaluates

Rendered from `library/runtime-expression-contexts.json` — do not edit by hand; `pnpm exec node --experimental-strip-types --import ./scripts/ts-source-resolve.mjs scripts/render-expression-context.ts` rewrites it and `tests/expression-context-doc.test.ts` holds it current.

Every expression in a sealed version is CEL over one of the sites below. A site carries the roots listed here and nothing else: a member the site does not declare is refused at write. Open prefixes (`limits.<key>`, `year.earned.<code>`, `produced.<code>`, `scheme.elections.<key>`, `company.facts.<key>`, `person.company.facts.<key>`, `terms.facts.<key>`, `day_facts.<key>`, `payment.facts.<key>`, `settlement.facts.<key>`) are keys the version itself declares.

## `entity` — Stored runtime expression declaration

Used by: `jurisdiction_settings.facts[].required_when` — entity input requirements.

Bare names: `company`.

Open prefixes: `company.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `company.settings_code` | Qualified by the stored root schema |
| `company.region` | Qualified by the stored root schema |
| `company.pay_frequency` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `company.fact_keys` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `person` — Stored runtime expression declaration

Used by: catalogue eligibility, a scheme’s person conditions, `wages.applies_when`, `overtime_when`, `ordinary_overtime_when`, `terms_facts[]` conditions and guaranteed-pay scope/week start and `ordinary_rate_reference.when` and `leave_catalogue.time_off_basis_when` and `leave_catalogue.entitlement.forfeit_when` and `leave_catalogue.entitlement.day_rounding_when`.

Bare names: `record`, `history`, `employee`, `worksite`, `employment`, `terms`, `children`, `company`, `wage_floor`, `wage_floor_pay`, `period`, `facts`, `event`.

Open prefixes: `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_flag_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `employee.facts.<key>`, `worksite.facts.<key>`, `terms.facts.<key>`, `event.facts.<key>`, `event.case.facts.<key>`, `record.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `record.observed_at` | Qualified by the stored root schema |
| `record.assessed_on` | Qualified by the stored root schema |
| `record.from` | Qualified by the stored root schema |
| `record.to` | Qualified by the stored root schema |
| `record.facts` | Qualified by the stored root schema |
| `record.minimum_wage` | Qualified by the stored root schema |
| `history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `employee.gender` | Qualified by the stored root schema |
| `employee.age` | Qualified by the stored root schema |
| `employee.age_months` | Qualified by the stored root schema |
| `employee.birth_date` | Qualified by the stored root schema |
| `employee.birthday` | Qualified by the stored root schema |
| `employee.age_months_on` | Qualified by the stored root schema |
| `employee.age_on` | Qualified by the stored root schema |
| `employee.citizenship` | Qualified by the stored root schema |
| `employee.facts` | Qualified by the stored root schema |
| `employee.fact_keys` | Qualified by the stored root schema |
| `worksite.code` | Qualified by the stored root schema |
| `worksite.region` | Qualified by the stored root schema |
| `worksite.facts` | Qualified by the stored root schema |
| `employee.marital_status` | Qualified by the stored root schema |
| `employee.spouse_status` | Qualified by the stored root schema |
| `employee.dependents_count` | Qualified by the stored root schema |
| `employee.solo_parent` | Qualified by the stored root schema |
| `employee.receiving_pension` | Qualified by the stored root schema |
| `employee.disabled` | Qualified by the stored root schema |
| `employee.race` | Qualified by the stored root schema |
| `employee.religion` | Qualified by the stored root schema |
| `employee.residency_months` | Qualified by the stored root schema |
| `employee.presence_recorded` | Qualified by the stored root schema |
| `employee.presence_days` | Qualified by the stored root schema |
| `employee.presence_linked_days` | Qualified by the stored root schema |
| `employee.presence_days_in` | Qualified by the stored root schema |
| `employee.employment_days` | Qualified by the stored root schema |
| `employment.type` | Qualified by the stored root schema |
| `employment.classification` | Qualified by the stored root schema |
| `employment.risk_class` | Qualified by the stored root schema |
| `employment.service_days` | Qualified by the stored root schema |
| `employment.service_days_before` | Qualified by the stored root schema |
| `employment.service_months` | Qualified by the stored root schema |
| `employment.service_months_exact` | Qualified by the stored root schema |
| `employment.service_years` | Qualified by the stored root schema |
| `employment.service_years_on` | Qualified by the stored root schema |
| `employment.notice_days_remaining` | Qualified by the stored root schema |
| `employment.notice_monthly_wages` | Qualified by the stored root schema |
| `employment.payday_notice_days` | Qualified by the stored root schema |
| `employment.service_start` | Qualified by the stored root schema |
| `employment.rule_date` | Qualified by the stored root schema |
| `employment.rule_end` | Qualified by the stored root schema |
| `employment.exit_date` | Qualified by the stored root schema |
| `employment.signed_contract_end` | Qualified by the stored root schema |
| `employment.days_to_exit` | Qualified by the stored root schema |
| `employment.open_ended` | Qualified by the stored root schema |
| `employment.contract_months` | Qualified by the stored root schema |
| `employment.contract_days` | Qualified by the stored root schema |
| `employment.exit_ground` | Qualified by the stored root schema |
| `employment.exit_facts` | Qualified by the stored root schema |
| `employment.exit_fact_keys` | Qualified by the stored root schema |
| `employment.absent_days_12m` | Qualified by the stored root schema |
| `employment.service_periods` | Qualified by the stored root schema |
| `employment.service_scope` | Qualified by the stored root schema |
| `employment.aggregate_service_scope` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.prior_service_months` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.contract_workdays` | Qualified by the stored root schema |
| `employment.exact_received_components` | Qualified by the stored root schema |
| `employment.exact_rate_wages` | Qualified by the stored root schema |
| `employment.comparable_rate_wages` | Qualified by the stored root schema |
| `employment.exact_service_wages` | Qualified by the stored root schema |
| `employment.exact_wages` | Qualified by the stored root schema |
| `employment.exact_wage_window` | Qualified by the stored root schema |
| `employment.average_daily_wage` | Qualified by the stored root schema |
| `employment.average_monthly_wage` | Qualified by the stored root schema |
| `employment.on_leave` | Qualified by the stored root schema |
| `employment.service_excluding_leave` | Qualified by the stored root schema |
| `employment.service_months_net` | Qualified by the stored root schema |
| `terms.basic_salary` | Qualified by the stored root schema |
| `terms.monthly_basic` | Qualified by the stored root schema |
| `terms.ordinary_day` | Qualified by the stored root schema |
| `terms.fixed_allowances` | Qualified by the stored root schema |
| `terms.monthly_wage` | Qualified by the stored root schema |
| `terms.gross_monthly` | Qualified by the stored root schema |
| `terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `terms.statutory_wages` | Qualified by the stored root schema |
| `terms.statutory_work_category` | Qualified by the stored root schema |
| `terms.weather_dependent_piece` | Qualified by the stored root schema |
| `terms.worksite` | Qualified by the stored root schema |
| `terms.worksite_sector` | Qualified by the stored root schema |
| `terms.department` | Qualified by the stored root schema |
| `terms.payroll_group` | Qualified by the stored root schema |
| `terms.paid_rest_days` | Qualified by the stored root schema |
| `terms.grade` | Qualified by the stored root schema |
| `terms.pay_frequency` | Qualified by the stored root schema |
| `terms.pass_type` | Qualified by the stored root schema |
| `terms.tax_residency` | Qualified by the stored root schema |
| `terms.residency_since` | Qualified by the stored root schema |
| `terms.notice_days` | Qualified by the stored root schema |
| `terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `terms.contract_week_work_days` | Qualified by the stored root schema |
| `terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `terms.working_days_per_week` | Qualified by the stored root schema |
| `terms.facts` | Qualified by the stored root schema |
| `terms.fact_keys` | Qualified by the stored root schema |
| `children.count` | Qualified by the stored root schema |
| `children.birthdates` | Qualified by the stored root schema |
| `children.under` | Qualified by the stored root schema |
| `children.born_on` | Qualified by the stored root schema |
| `children.multiple_born_on` | Qualified by the stored root schema |
| `children.natural_surviving_on` | Qualified by the stored root schema |
| `children.natural_surviving_before` | Qualified by the stored root schema |
| `children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `children.citizens` | Qualified by the stored root schema |
| `children.births` | Qualified by the stored root schema |
| `children.citizens_under` | Qualified by the stored root schema |
| `children.prior_childcare_days` | Qualified by the stored root schema |
| `children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `children.prior_infant_care_days` | Qualified by the stored root schema |
| `children.classed` | Qualified by the stored root schema |
| `children.unclassed_under` | Qualified by the stored root schema |
| `company.region` | Qualified by the stored root schema |
| `company.headcount` | Qualified by the stored root schema |
| `company.headcount_citizens` | Qualified by the stored root schema |
| `company.pay_frequency` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `wage_floor` | Qualified by the stored root schema |
| `wage_floor_pay.BASE` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `event.kind` | Qualified by the stored root schema |
| `event.relationship` | Qualified by the stored root schema |
| `event.child_index` | Qualified by the stored root schema |
| `event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `event.delivery_children_count` | Qualified by the stored root schema |
| `event.date` | Qualified by the stored root schema |
| `event.facts` | Qualified by the stored root schema |
| `event.case.facts` | Qualified by the stored root schema |
| `event.child_citizenship` | Qualified by the stored root schema |
| `event.child_age` | Qualified by the stored root schema |
| `event.child_shared_weeks` | Qualified by the stored root schema |
| `event.prior_employment_days` | Qualified by the stored root schema |
| `event.estimated_delivery_date` | Qualified by the stored root schema |
| `event.adoption_eligibility_date` | Qualified by the stored root schema |
| `period.unpaid_full_days` | Qualified by the stored root schema |
| `period.leave_flag_days` | Qualified by the stored root schema |
| `period.leave_days` | Qualified by the stored root schema |
| `period.leave_full_days` | Qualified by the stored root schema |
| `period.leave_pay` | Qualified by the stored root schema |
| `period.working_days` | Qualified by the stored root schema |
| `period.unpaid_days` | Qualified by the stored root schema |
| `period.overtime_days` | Qualified by the stored root schema |
| `period.arrears` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `entry` — Stored runtime expression declaration

Used by: catalogue bands and entitlement amounts — one claim, allowance or loan entry.

Bare names: `person`, `entry`, `rates`, `limits`, `period`, `year`, `leave`.

Open prefixes: `limits.<key>`, `year.<key>`, `person.company.facts.<key>`, `person.facts.<key>`, `person.period.leave_full_days.<key>`, `person.period.leave_days.<key>`, `person.period.leave_flag_days.<key>`, `person.period.leave_pay.<key>`, `person.employment.exit_facts.<key>`, `person.employee.facts.<key>`, `person.worksite.facts.<key>`, `person.terms.facts.<key>`, `entry.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.record.observed_at` | Qualified by the stored root schema |
| `person.record.assessed_on` | Qualified by the stored root schema |
| `person.record.from` | Qualified by the stored root schema |
| `person.record.to` | Qualified by the stored root schema |
| `person.record.facts` | Qualified by the stored root schema |
| `person.record.minimum_wage` | Qualified by the stored root schema |
| `person.history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `person.employee.gender` | Qualified by the stored root schema |
| `person.employee.age` | Qualified by the stored root schema |
| `person.employee.age_months` | Qualified by the stored root schema |
| `person.employee.birth_date` | Qualified by the stored root schema |
| `person.employee.birthday` | Qualified by the stored root schema |
| `person.employee.age_months_on` | Qualified by the stored root schema |
| `person.employee.age_on` | Qualified by the stored root schema |
| `person.employee.citizenship` | Qualified by the stored root schema |
| `person.employee.facts` | Qualified by the stored root schema |
| `person.employee.fact_keys` | Qualified by the stored root schema |
| `person.worksite.code` | Qualified by the stored root schema |
| `person.worksite.region` | Qualified by the stored root schema |
| `person.worksite.facts` | Qualified by the stored root schema |
| `person.employee.marital_status` | Qualified by the stored root schema |
| `person.employee.spouse_status` | Qualified by the stored root schema |
| `person.employee.dependents_count` | Qualified by the stored root schema |
| `person.employee.solo_parent` | Qualified by the stored root schema |
| `person.employee.receiving_pension` | Qualified by the stored root schema |
| `person.employee.disabled` | Qualified by the stored root schema |
| `person.employee.race` | Qualified by the stored root schema |
| `person.employee.religion` | Qualified by the stored root schema |
| `person.employee.residency_months` | Qualified by the stored root schema |
| `person.employee.presence_recorded` | Qualified by the stored root schema |
| `person.employee.presence_days` | Qualified by the stored root schema |
| `person.employee.presence_linked_days` | Qualified by the stored root schema |
| `person.employee.presence_days_in` | Qualified by the stored root schema |
| `person.employee.employment_days` | Qualified by the stored root schema |
| `person.employment.type` | Qualified by the stored root schema |
| `person.employment.classification` | Qualified by the stored root schema |
| `person.employment.risk_class` | Qualified by the stored root schema |
| `person.employment.service_days` | Qualified by the stored root schema |
| `person.employment.service_days_before` | Qualified by the stored root schema |
| `person.employment.service_months` | Qualified by the stored root schema |
| `person.employment.service_months_exact` | Qualified by the stored root schema |
| `person.employment.service_years` | Qualified by the stored root schema |
| `person.employment.service_years_on` | Qualified by the stored root schema |
| `person.employment.notice_days_remaining` | Qualified by the stored root schema |
| `person.employment.notice_monthly_wages` | Qualified by the stored root schema |
| `person.employment.payday_notice_days` | Qualified by the stored root schema |
| `person.employment.service_start` | Qualified by the stored root schema |
| `person.employment.rule_date` | Qualified by the stored root schema |
| `person.employment.rule_end` | Qualified by the stored root schema |
| `person.employment.exit_date` | Qualified by the stored root schema |
| `person.employment.signed_contract_end` | Qualified by the stored root schema |
| `person.employment.days_to_exit` | Qualified by the stored root schema |
| `person.employment.open_ended` | Qualified by the stored root schema |
| `person.employment.contract_months` | Qualified by the stored root schema |
| `person.employment.contract_days` | Qualified by the stored root schema |
| `person.employment.exit_ground` | Qualified by the stored root schema |
| `person.employment.exit_facts` | Qualified by the stored root schema |
| `person.employment.exit_fact_keys` | Qualified by the stored root schema |
| `person.employment.absent_days_12m` | Qualified by the stored root schema |
| `person.employment.service_periods` | Qualified by the stored root schema |
| `person.employment.service_scope` | Qualified by the stored root schema |
| `person.employment.aggregate_service_scope` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.prior_service_months` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.contract_workdays` | Qualified by the stored root schema |
| `person.employment.exact_received_components` | Qualified by the stored root schema |
| `person.employment.exact_rate_wages` | Qualified by the stored root schema |
| `person.employment.comparable_rate_wages` | Qualified by the stored root schema |
| `person.employment.exact_service_wages` | Qualified by the stored root schema |
| `person.employment.exact_wages` | Qualified by the stored root schema |
| `person.employment.exact_wage_window` | Qualified by the stored root schema |
| `person.employment.average_daily_wage` | Qualified by the stored root schema |
| `person.employment.average_monthly_wage` | Qualified by the stored root schema |
| `person.employment.on_leave` | Qualified by the stored root schema |
| `person.employment.service_excluding_leave` | Qualified by the stored root schema |
| `person.employment.service_months_net` | Qualified by the stored root schema |
| `person.terms.basic_salary` | Qualified by the stored root schema |
| `person.terms.monthly_basic` | Qualified by the stored root schema |
| `person.terms.ordinary_day` | Qualified by the stored root schema |
| `person.terms.fixed_allowances` | Qualified by the stored root schema |
| `person.terms.monthly_wage` | Qualified by the stored root schema |
| `person.terms.gross_monthly` | Qualified by the stored root schema |
| `person.terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `person.terms.statutory_wages` | Qualified by the stored root schema |
| `person.terms.statutory_work_category` | Qualified by the stored root schema |
| `person.terms.weather_dependent_piece` | Qualified by the stored root schema |
| `person.terms.worksite` | Qualified by the stored root schema |
| `person.terms.worksite_sector` | Qualified by the stored root schema |
| `person.terms.department` | Qualified by the stored root schema |
| `person.terms.payroll_group` | Qualified by the stored root schema |
| `person.terms.paid_rest_days` | Qualified by the stored root schema |
| `person.terms.grade` | Qualified by the stored root schema |
| `person.terms.pay_frequency` | Qualified by the stored root schema |
| `person.terms.pass_type` | Qualified by the stored root schema |
| `person.terms.tax_residency` | Qualified by the stored root schema |
| `person.terms.residency_since` | Qualified by the stored root schema |
| `person.terms.notice_days` | Qualified by the stored root schema |
| `person.terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `person.terms.contract_week_work_days` | Qualified by the stored root schema |
| `person.terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `person.terms.working_days_per_week` | Qualified by the stored root schema |
| `person.terms.facts` | Qualified by the stored root schema |
| `person.terms.fact_keys` | Qualified by the stored root schema |
| `person.children.count` | Qualified by the stored root schema |
| `person.children.birthdates` | Qualified by the stored root schema |
| `person.children.under` | Qualified by the stored root schema |
| `person.children.born_on` | Qualified by the stored root schema |
| `person.children.multiple_born_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_before` | Qualified by the stored root schema |
| `person.children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `person.children.citizens` | Qualified by the stored root schema |
| `person.children.births` | Qualified by the stored root schema |
| `person.children.citizens_under` | Qualified by the stored root schema |
| `person.children.prior_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_infant_care_days` | Qualified by the stored root schema |
| `person.children.classed` | Qualified by the stored root schema |
| `person.children.unclassed_under` | Qualified by the stored root schema |
| `person.company.region` | Qualified by the stored root schema |
| `person.company.headcount` | Qualified by the stored root schema |
| `person.company.headcount_citizens` | Qualified by the stored root schema |
| `person.company.pay_frequency` | Qualified by the stored root schema |
| `person.company.facts` | Qualified by the stored root schema |
| `person.wage_floor` | Qualified by the stored root schema |
| `person.wage_floor_pay.BASE` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `person.wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `person.wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.event.kind` | Qualified by the stored root schema |
| `person.event.relationship` | Qualified by the stored root schema |
| `person.event.child_index` | Qualified by the stored root schema |
| `person.event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `person.event.delivery_children_count` | Qualified by the stored root schema |
| `person.event.date` | Qualified by the stored root schema |
| `person.event.facts` | Qualified by the stored root schema |
| `person.event.case.facts` | Qualified by the stored root schema |
| `person.event.child_citizenship` | Qualified by the stored root schema |
| `person.event.child_age` | Qualified by the stored root schema |
| `person.event.child_shared_weeks` | Qualified by the stored root schema |
| `person.event.prior_employment_days` | Qualified by the stored root schema |
| `person.event.estimated_delivery_date` | Qualified by the stored root schema |
| `person.event.adoption_eligibility_date` | Qualified by the stored root schema |
| `person.period.unpaid_full_days` | Qualified by the stored root schema |
| `person.period.leave_flag_days` | Qualified by the stored root schema |
| `person.period.leave_days` | Qualified by the stored root schema |
| `person.period.leave_full_days` | Qualified by the stored root schema |
| `person.period.leave_pay` | Qualified by the stored root schema |
| `person.period.working_days` | Qualified by the stored root schema |
| `person.period.unpaid_days` | Qualified by the stored root schema |
| `person.period.overtime_days` | Qualified by the stored root schema |
| `person.period.arrears` | Qualified by the stored root schema |
| `entry.amount` | Qualified by the stored root schema |
| `entry.is_adjustment` | Qualified by the stored root schema |
| `entry.days` | Qualified by the stored root schema |
| `entry.hours` | Qualified by the stored root schema |
| `entry.quantity` | Qualified by the stored root schema |
| `entry.event_date` | Qualified by the stored root schema |
| `entry.period` | Qualified by the stored root schema |
| `entry.religious_holidays` | Qualified by the stored root schema |
| `entry.incurred_on` | Qualified by the stored root schema |
| `entry.due_on` | Qualified by the stored root schema |
| `entry.facts` | Qualified by the stored root schema |
| `entry.wage_attribution.recorded` | Qualified by the stored root schema |
| `entry.wage_attribution.earned_from` | Qualified by the stored root schema |
| `entry.wage_attribution.earned_to` | Qualified by the stored root schema |
| `entry.wage_attribution.earned_month` | Qualified by the stored root schema |
| `entry.wage_attribution.single_month` | Qualified by the stored root schema |
| `entry.wage_attribution.payable_on` | Qualified by the stored root schema |
| `entry.wage_attribution.payable_days_after_month` | Qualified by the stored root schema |
| `entry.wage_attribution.component_code` | Qualified by the stored root schema |
| `entry.wage_attribution.purpose` | Qualified by the stored root schema |
| `entry.wage_attribution.original_payslip_id` | Qualified by the stored root schema |
| `entry.wage_attribution.original_source_id` | Qualified by the stored root schema |
| `entry.wage_attribution.evidence_reference` | Qualified by the stored root schema |
| `entry.paid_source.source_id` | Qualified by the stored root schema |
| `entry.paid_source.event_date` | Qualified by the stored root schema |
| `entry.paid_source.paid_on` | Qualified by the stored root schema |
| `entry.paid_source.amount` | Qualified by the stored root schema |
| `entry.paid_source.payslip_ids` | Qualified by the stored root schema |
| `entry.late_wage.due_on` | Qualified by the stored root schema |
| `entry.late_wage.paid_on` | Qualified by the stored root schema |
| `entry.late_wage.days` | Qualified by the stored root schema |
| `entry.late_wage.deposit_rate` | Qualified by the stored root schema |
| `entry.late_wage.force_majeure` | Qualified by the stored root schema |
| `entry.window.start` | Qualified by the stored root schema |
| `entry.window.end` | Qualified by the stored root schema |
| `entry.captures.remaining` | Qualified by the stored root schema |
| `rates.ordinary_day` | Qualified by the stored root schema |
| `entry.unpaid_salary` | Qualified by the stored root schema |
| `rates.ordinary_hour` | Qualified by the stored root schema |
| `limits` | Qualified by the stored root schema |
| `period.key` | Qualified by the stored root schema |
| `period.month` | Qualified by the stored root schema |
| `period.start` | Qualified by the stored root schema |
| `period.end` | Qualified by the stored root schema |
| `period.pay_date` | Qualified by the stored root schema |
| `period.index` | Qualified by the stored root schema |
| `period.instalments` | Qualified by the stored root schema |
| `period.month_factor` | Qualified by the stored root schema |
| `period.last_of_year` | Qualified by the stored root schema |
| `period.days_employed` | Qualified by the stored root schema |
| `period.days_in_month` | Qualified by the stored root schema |
| `year.start` | Qualified by the stored root schema |
| `year.end` | Qualified by the stored root schema |
| `year.months_employed` | Qualified by the stored root schema |
| `year.earned` | Qualified by the stored root schema |
| `year.earned.ABSENCE` | Qualified by the stored root schema |
| `leave.days` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `annual_source` — Stored runtime expression declaration

Used by: undefined.

Bare names: `entry`, `source`.

Open prefixes: `entry.facts.<key>`, `source.paid_amounts.<key>`, `source.known_sources.<key>`.

| Member | Meaning |
| --- | --- |
| `entry.facts` | Qualified by the stored root schema |
| `source.paid_amounts` | Qualified by the stored root schema |
| `source.known_sources` | Qualified by the stored root schema |
| `source.payer_tax_identifier` | Qualified by the stored root schema |
| `source.basis_year` | Qualified by the stored root schema |
| `source.recipient_identity` | Qualified by the stored root schema |
| `source.source_reference` | Qualified by the stored root schema |
| `source.source_as_of` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `work_day_capture` — Stored runtime expression declaration

Used by: `work_day_facts[]` requirements, evidence and validation — actual person with raw recorded day_facts and day_fact_keys; no priced attendance, roster or presumed day values.

Bare names: `record`, `history`, `employee`, `worksite`, `employment`, `terms`, `children`, `company`, `wage_floor`, `wage_floor_pay`, `period`, `facts`, `event`, `day_facts`, `day_fact_keys`.

Open prefixes: `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_flag_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `employee.facts.<key>`, `worksite.facts.<key>`, `terms.facts.<key>`, `event.facts.<key>`, `event.case.facts.<key>`, `record.facts.<key>`, `day_facts.<key>`.

| Member | Meaning |
| --- | --- |
| `record.observed_at` | Qualified by the stored root schema |
| `record.assessed_on` | Qualified by the stored root schema |
| `record.from` | Qualified by the stored root schema |
| `record.to` | Qualified by the stored root schema |
| `record.facts` | Qualified by the stored root schema |
| `record.minimum_wage` | Qualified by the stored root schema |
| `history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `employee.gender` | Qualified by the stored root schema |
| `employee.age` | Qualified by the stored root schema |
| `employee.age_months` | Qualified by the stored root schema |
| `employee.birth_date` | Qualified by the stored root schema |
| `employee.birthday` | Qualified by the stored root schema |
| `employee.age_months_on` | Qualified by the stored root schema |
| `employee.age_on` | Qualified by the stored root schema |
| `employee.citizenship` | Qualified by the stored root schema |
| `employee.facts` | Qualified by the stored root schema |
| `employee.fact_keys` | Qualified by the stored root schema |
| `worksite.code` | Qualified by the stored root schema |
| `worksite.region` | Qualified by the stored root schema |
| `worksite.facts` | Qualified by the stored root schema |
| `employee.marital_status` | Qualified by the stored root schema |
| `employee.spouse_status` | Qualified by the stored root schema |
| `employee.dependents_count` | Qualified by the stored root schema |
| `employee.solo_parent` | Qualified by the stored root schema |
| `employee.receiving_pension` | Qualified by the stored root schema |
| `employee.disabled` | Qualified by the stored root schema |
| `employee.race` | Qualified by the stored root schema |
| `employee.religion` | Qualified by the stored root schema |
| `employee.residency_months` | Qualified by the stored root schema |
| `employee.presence_recorded` | Qualified by the stored root schema |
| `employee.presence_days` | Qualified by the stored root schema |
| `employee.presence_linked_days` | Qualified by the stored root schema |
| `employee.presence_days_in` | Qualified by the stored root schema |
| `employee.employment_days` | Qualified by the stored root schema |
| `employment.type` | Qualified by the stored root schema |
| `employment.classification` | Qualified by the stored root schema |
| `employment.risk_class` | Qualified by the stored root schema |
| `employment.service_days` | Qualified by the stored root schema |
| `employment.service_days_before` | Qualified by the stored root schema |
| `employment.service_months` | Qualified by the stored root schema |
| `employment.service_months_exact` | Qualified by the stored root schema |
| `employment.service_years` | Qualified by the stored root schema |
| `employment.service_years_on` | Qualified by the stored root schema |
| `employment.notice_days_remaining` | Qualified by the stored root schema |
| `employment.notice_monthly_wages` | Qualified by the stored root schema |
| `employment.payday_notice_days` | Qualified by the stored root schema |
| `employment.service_start` | Qualified by the stored root schema |
| `employment.rule_date` | Qualified by the stored root schema |
| `employment.rule_end` | Qualified by the stored root schema |
| `employment.exit_date` | Qualified by the stored root schema |
| `employment.signed_contract_end` | Qualified by the stored root schema |
| `employment.days_to_exit` | Qualified by the stored root schema |
| `employment.open_ended` | Qualified by the stored root schema |
| `employment.contract_months` | Qualified by the stored root schema |
| `employment.contract_days` | Qualified by the stored root schema |
| `employment.exit_ground` | Qualified by the stored root schema |
| `employment.exit_facts` | Qualified by the stored root schema |
| `employment.exit_fact_keys` | Qualified by the stored root schema |
| `employment.absent_days_12m` | Qualified by the stored root schema |
| `employment.service_periods` | Qualified by the stored root schema |
| `employment.service_scope` | Qualified by the stored root schema |
| `employment.aggregate_service_scope` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.prior_service_months` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.contract_workdays` | Qualified by the stored root schema |
| `employment.exact_received_components` | Qualified by the stored root schema |
| `employment.exact_rate_wages` | Qualified by the stored root schema |
| `employment.comparable_rate_wages` | Qualified by the stored root schema |
| `employment.exact_service_wages` | Qualified by the stored root schema |
| `employment.exact_wages` | Qualified by the stored root schema |
| `employment.exact_wage_window` | Qualified by the stored root schema |
| `employment.average_daily_wage` | Qualified by the stored root schema |
| `employment.average_monthly_wage` | Qualified by the stored root schema |
| `employment.on_leave` | Qualified by the stored root schema |
| `employment.service_excluding_leave` | Qualified by the stored root schema |
| `employment.service_months_net` | Qualified by the stored root schema |
| `terms.basic_salary` | Qualified by the stored root schema |
| `terms.monthly_basic` | Qualified by the stored root schema |
| `terms.ordinary_day` | Qualified by the stored root schema |
| `terms.fixed_allowances` | Qualified by the stored root schema |
| `terms.monthly_wage` | Qualified by the stored root schema |
| `terms.gross_monthly` | Qualified by the stored root schema |
| `terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `terms.statutory_wages` | Qualified by the stored root schema |
| `terms.statutory_work_category` | Qualified by the stored root schema |
| `terms.weather_dependent_piece` | Qualified by the stored root schema |
| `terms.worksite` | Qualified by the stored root schema |
| `terms.worksite_sector` | Qualified by the stored root schema |
| `terms.department` | Qualified by the stored root schema |
| `terms.payroll_group` | Qualified by the stored root schema |
| `terms.paid_rest_days` | Qualified by the stored root schema |
| `terms.grade` | Qualified by the stored root schema |
| `terms.pay_frequency` | Qualified by the stored root schema |
| `terms.pass_type` | Qualified by the stored root schema |
| `terms.tax_residency` | Qualified by the stored root schema |
| `terms.residency_since` | Qualified by the stored root schema |
| `terms.notice_days` | Qualified by the stored root schema |
| `terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `terms.contract_week_work_days` | Qualified by the stored root schema |
| `terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `terms.working_days_per_week` | Qualified by the stored root schema |
| `terms.facts` | Qualified by the stored root schema |
| `terms.fact_keys` | Qualified by the stored root schema |
| `children.count` | Qualified by the stored root schema |
| `children.birthdates` | Qualified by the stored root schema |
| `children.under` | Qualified by the stored root schema |
| `children.born_on` | Qualified by the stored root schema |
| `children.multiple_born_on` | Qualified by the stored root schema |
| `children.natural_surviving_on` | Qualified by the stored root schema |
| `children.natural_surviving_before` | Qualified by the stored root schema |
| `children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `children.citizens` | Qualified by the stored root schema |
| `children.births` | Qualified by the stored root schema |
| `children.citizens_under` | Qualified by the stored root schema |
| `children.prior_childcare_days` | Qualified by the stored root schema |
| `children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `children.prior_infant_care_days` | Qualified by the stored root schema |
| `children.classed` | Qualified by the stored root schema |
| `children.unclassed_under` | Qualified by the stored root schema |
| `company.region` | Qualified by the stored root schema |
| `company.headcount` | Qualified by the stored root schema |
| `company.headcount_citizens` | Qualified by the stored root schema |
| `company.pay_frequency` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `wage_floor` | Qualified by the stored root schema |
| `wage_floor_pay.BASE` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `event.kind` | Qualified by the stored root schema |
| `event.relationship` | Qualified by the stored root schema |
| `event.child_index` | Qualified by the stored root schema |
| `event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `event.delivery_children_count` | Qualified by the stored root schema |
| `event.date` | Qualified by the stored root schema |
| `event.facts` | Qualified by the stored root schema |
| `event.case.facts` | Qualified by the stored root schema |
| `event.child_citizenship` | Qualified by the stored root schema |
| `event.child_age` | Qualified by the stored root schema |
| `event.child_shared_weeks` | Qualified by the stored root schema |
| `event.prior_employment_days` | Qualified by the stored root schema |
| `event.estimated_delivery_date` | Qualified by the stored root schema |
| `event.adoption_eligibility_date` | Qualified by the stored root schema |
| `period.unpaid_full_days` | Qualified by the stored root schema |
| `period.leave_flag_days` | Qualified by the stored root schema |
| `period.leave_days` | Qualified by the stored root schema |
| `period.leave_full_days` | Qualified by the stored root schema |
| `period.leave_pay` | Qualified by the stored root schema |
| `period.working_days` | Qualified by the stored root schema |
| `period.unpaid_days` | Qualified by the stored root schema |
| `period.overtime_days` | Qualified by the stored root schema |
| `period.arrears` | Qualified by the stored root schema |
| `day_facts` | Qualified by the stored root schema |
| `day_fact_keys` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `work_day` — Stored runtime expression declaration

Used by: work bands, breaks, limits (including person-scoped `limits[].max_hours_expression` and actual-day `limits[].emergency_excluded_when`), the night premium and dated `absence_when` and guaranteed-pay units/day wages (recorded day facts without defaults) — one priced person-day.

Bare names: `person`, `shift_change`, `date`, `day_type`, `piece_units`, `piece_overtime_units`, `piece_unit_rate`, `worked_hours`, `actual_worked_hours`, `normal_paid_rest_hours`, `normal_hours`, `comparable_full_time_daily_hours`, `hours_beyond_normal`, `hours_from_start_fraction`, `overtime_hours`, `consecutive_hours`, `continuous_attendance`, `rest_day`, `statutory_rest`, `off_day`, `night_hours`, `requested_by`, `emergency_cause`, `time_off_in_lieu`, `ordinary_hour`, `day_wage`, `hours`, `limits`, `prior_hours`, `holiday`, `day_facts`, `day_fact_keys`, `age_years`, `attendance_recorded`, `first_work_at`, `night_worked`, `first_night_at`, `holiday_work`, `overtime_work`, `declared_overtime_hours`, `rest_minutes_total`, `longest_rest_minutes`, `longest_run_hours`, `rest_before_overtime_minutes`, `shift_hours`, `shift_start_at`, `stated_day_hours`.

Open prefixes: `prior_hours.<key>`, `limits.<key>`, `day_facts.<key>`, `person.company.facts.<key>`, `person.facts.<key>`, `person.period.leave_full_days.<key>`, `person.period.leave_days.<key>`, `person.period.leave_flag_days.<key>`, `person.period.leave_pay.<key>`, `person.employment.exit_facts.<key>`, `person.employee.facts.<key>`, `person.worksite.facts.<key>`, `person.terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `normal_paid_rest_hours` | Qualified by the stored root schema |
| `person.record.observed_at` | Qualified by the stored root schema |
| `person.record.assessed_on` | Qualified by the stored root schema |
| `person.record.from` | Qualified by the stored root schema |
| `person.record.to` | Qualified by the stored root schema |
| `person.record.facts` | Qualified by the stored root schema |
| `person.record.minimum_wage` | Qualified by the stored root schema |
| `person.history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `person.employee.gender` | Qualified by the stored root schema |
| `person.employee.age` | Qualified by the stored root schema |
| `person.employee.age_months` | Qualified by the stored root schema |
| `person.employee.birth_date` | Qualified by the stored root schema |
| `person.employee.birthday` | Qualified by the stored root schema |
| `person.employee.age_months_on` | Qualified by the stored root schema |
| `person.employee.age_on` | Qualified by the stored root schema |
| `person.employee.citizenship` | Qualified by the stored root schema |
| `person.employee.facts` | Qualified by the stored root schema |
| `person.employee.fact_keys` | Qualified by the stored root schema |
| `person.worksite.code` | Qualified by the stored root schema |
| `person.worksite.region` | Qualified by the stored root schema |
| `person.worksite.facts` | Qualified by the stored root schema |
| `person.employee.marital_status` | Qualified by the stored root schema |
| `person.employee.spouse_status` | Qualified by the stored root schema |
| `person.employee.dependents_count` | Qualified by the stored root schema |
| `person.employee.solo_parent` | Qualified by the stored root schema |
| `person.employee.receiving_pension` | Qualified by the stored root schema |
| `person.employee.disabled` | Qualified by the stored root schema |
| `person.employee.race` | Qualified by the stored root schema |
| `person.employee.religion` | Qualified by the stored root schema |
| `person.employee.residency_months` | Qualified by the stored root schema |
| `person.employee.presence_recorded` | Qualified by the stored root schema |
| `person.employee.presence_days` | Qualified by the stored root schema |
| `person.employee.presence_linked_days` | Qualified by the stored root schema |
| `person.employee.presence_days_in` | Qualified by the stored root schema |
| `person.employee.employment_days` | Qualified by the stored root schema |
| `person.employment.type` | Qualified by the stored root schema |
| `person.employment.classification` | Qualified by the stored root schema |
| `person.employment.risk_class` | Qualified by the stored root schema |
| `person.employment.service_days` | Qualified by the stored root schema |
| `person.employment.service_days_before` | Qualified by the stored root schema |
| `person.employment.service_months` | Qualified by the stored root schema |
| `person.employment.service_months_exact` | Qualified by the stored root schema |
| `person.employment.service_years` | Qualified by the stored root schema |
| `person.employment.service_years_on` | Qualified by the stored root schema |
| `person.employment.notice_days_remaining` | Qualified by the stored root schema |
| `person.employment.notice_monthly_wages` | Qualified by the stored root schema |
| `person.employment.payday_notice_days` | Qualified by the stored root schema |
| `person.employment.service_start` | Qualified by the stored root schema |
| `person.employment.rule_date` | Qualified by the stored root schema |
| `person.employment.rule_end` | Qualified by the stored root schema |
| `person.employment.exit_date` | Qualified by the stored root schema |
| `person.employment.signed_contract_end` | Qualified by the stored root schema |
| `person.employment.days_to_exit` | Qualified by the stored root schema |
| `person.employment.open_ended` | Qualified by the stored root schema |
| `person.employment.contract_months` | Qualified by the stored root schema |
| `person.employment.contract_days` | Qualified by the stored root schema |
| `person.employment.exit_ground` | Qualified by the stored root schema |
| `person.employment.exit_facts` | Qualified by the stored root schema |
| `person.employment.exit_fact_keys` | Qualified by the stored root schema |
| `person.employment.absent_days_12m` | Qualified by the stored root schema |
| `person.employment.service_periods` | Qualified by the stored root schema |
| `person.employment.service_scope` | Qualified by the stored root schema |
| `person.employment.aggregate_service_scope` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.prior_service_months` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.contract_workdays` | Qualified by the stored root schema |
| `person.employment.exact_received_components` | Qualified by the stored root schema |
| `person.employment.exact_rate_wages` | Qualified by the stored root schema |
| `person.employment.comparable_rate_wages` | Qualified by the stored root schema |
| `person.employment.exact_service_wages` | Qualified by the stored root schema |
| `person.employment.exact_wages` | Qualified by the stored root schema |
| `person.employment.exact_wage_window` | Qualified by the stored root schema |
| `person.employment.average_daily_wage` | Qualified by the stored root schema |
| `person.employment.average_monthly_wage` | Qualified by the stored root schema |
| `person.employment.on_leave` | Qualified by the stored root schema |
| `person.employment.service_excluding_leave` | Qualified by the stored root schema |
| `person.employment.service_months_net` | Qualified by the stored root schema |
| `person.terms.basic_salary` | Qualified by the stored root schema |
| `person.terms.monthly_basic` | Qualified by the stored root schema |
| `person.terms.ordinary_day` | Qualified by the stored root schema |
| `person.terms.fixed_allowances` | Qualified by the stored root schema |
| `person.terms.monthly_wage` | Qualified by the stored root schema |
| `person.terms.gross_monthly` | Qualified by the stored root schema |
| `person.terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `person.terms.statutory_wages` | Qualified by the stored root schema |
| `person.terms.statutory_work_category` | Qualified by the stored root schema |
| `person.terms.weather_dependent_piece` | Qualified by the stored root schema |
| `person.terms.worksite` | Qualified by the stored root schema |
| `person.terms.worksite_sector` | Qualified by the stored root schema |
| `person.terms.department` | Qualified by the stored root schema |
| `person.terms.payroll_group` | Qualified by the stored root schema |
| `person.terms.paid_rest_days` | Qualified by the stored root schema |
| `person.terms.grade` | Qualified by the stored root schema |
| `person.terms.pay_frequency` | Qualified by the stored root schema |
| `person.terms.pass_type` | Qualified by the stored root schema |
| `person.terms.tax_residency` | Qualified by the stored root schema |
| `person.terms.residency_since` | Qualified by the stored root schema |
| `person.terms.notice_days` | Qualified by the stored root schema |
| `person.terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `person.terms.contract_week_work_days` | Qualified by the stored root schema |
| `person.terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `person.terms.working_days_per_week` | Qualified by the stored root schema |
| `person.terms.facts` | Qualified by the stored root schema |
| `person.terms.fact_keys` | Qualified by the stored root schema |
| `person.children.count` | Qualified by the stored root schema |
| `person.children.birthdates` | Qualified by the stored root schema |
| `person.children.under` | Qualified by the stored root schema |
| `person.children.born_on` | Qualified by the stored root schema |
| `person.children.multiple_born_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_before` | Qualified by the stored root schema |
| `person.children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `person.children.citizens` | Qualified by the stored root schema |
| `person.children.births` | Qualified by the stored root schema |
| `person.children.citizens_under` | Qualified by the stored root schema |
| `person.children.prior_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_infant_care_days` | Qualified by the stored root schema |
| `person.children.classed` | Qualified by the stored root schema |
| `person.children.unclassed_under` | Qualified by the stored root schema |
| `person.company.region` | Qualified by the stored root schema |
| `person.company.headcount` | Qualified by the stored root schema |
| `person.company.headcount_citizens` | Qualified by the stored root schema |
| `person.company.pay_frequency` | Qualified by the stored root schema |
| `person.company.facts` | Qualified by the stored root schema |
| `person.wage_floor` | Qualified by the stored root schema |
| `person.wage_floor_pay.BASE` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `person.wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `person.wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.event.kind` | Qualified by the stored root schema |
| `person.event.relationship` | Qualified by the stored root schema |
| `person.event.child_index` | Qualified by the stored root schema |
| `person.event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `person.event.delivery_children_count` | Qualified by the stored root schema |
| `person.event.date` | Qualified by the stored root schema |
| `person.event.facts` | Qualified by the stored root schema |
| `person.event.case.facts` | Qualified by the stored root schema |
| `person.event.child_citizenship` | Qualified by the stored root schema |
| `person.event.child_age` | Qualified by the stored root schema |
| `person.event.child_shared_weeks` | Qualified by the stored root schema |
| `person.event.prior_employment_days` | Qualified by the stored root schema |
| `person.event.estimated_delivery_date` | Qualified by the stored root schema |
| `person.event.adoption_eligibility_date` | Qualified by the stored root schema |
| `person.period.unpaid_full_days` | Qualified by the stored root schema |
| `person.period.leave_flag_days` | Qualified by the stored root schema |
| `person.period.leave_days` | Qualified by the stored root schema |
| `person.period.leave_full_days` | Qualified by the stored root schema |
| `person.period.leave_pay` | Qualified by the stored root schema |
| `person.period.working_days` | Qualified by the stored root schema |
| `person.period.unpaid_days` | Qualified by the stored root schema |
| `person.period.overtime_days` | Qualified by the stored root schema |
| `person.period.arrears` | Qualified by the stored root schema |
| `date` | Qualified by the stored root schema |
| `shift_change.identity` | Qualified by the stored root schema |
| `shift_change.previous_end_at` | Qualified by the stored root schema |
| `shift_change.starts_at` | Qualified by the stored root schema |
| `shift_change.previous_shift` | Qualified by the stored root schema |
| `shift_change.next_shift` | Qualified by the stored root schema |
| `shift_change.weekly_rotation` | Qualified by the stored root schema |
| `shift_change.worker_consented` | Qualified by the stored root schema |
| `shift_change.eight_hour_exception` | Qualified by the stored root schema |
| `shift_change.employee_count` | Qualified by the stored root schema |
| `shift_change.exception_announced` | Qualified by the stored root schema |
| `shift_change.collective_approval` | Qualified by the stored root schema |
| `shift_change.authority_filed` | Qualified by the stored root schema |
| `shift_change.reference` | Qualified by the stored root schema |
| `day_type` | Qualified by the stored root schema |
| `piece_units` | Qualified by the stored root schema |
| `piece_overtime_units` | Qualified by the stored root schema |
| `piece_unit_rate` | Qualified by the stored root schema |
| `worked_hours` | Qualified by the stored root schema |
| `actual_worked_hours` | Qualified by the stored root schema |
| `normal_hours` | Qualified by the stored root schema |
| `comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `hours_beyond_normal` | Qualified by the stored root schema |
| `hours_from_start_fraction` | Qualified by the stored root schema |
| `overtime_hours` | Qualified by the stored root schema |
| `consecutive_hours` | Qualified by the stored root schema |
| `continuous_attendance` | Qualified by the stored root schema |
| `rest_day` | Qualified by the stored root schema |
| `statutory_rest` | Qualified by the stored root schema |
| `off_day` | Qualified by the stored root schema |
| `night_hours` | Qualified by the stored root schema |
| `requested_by` | Qualified by the stored root schema |
| `emergency_cause` | Qualified by the stored root schema |
| `time_off_in_lieu` | Qualified by the stored root schema |
| `ordinary_hour` | Qualified by the stored root schema |
| `day_wage` | Qualified by the stored root schema |
| `hours` | Qualified by the stored root schema |
| `limits` | Qualified by the stored root schema |
| `prior_hours` | Qualified by the stored root schema |
| `holiday.kind` | Qualified by the stored root schema |
| `holiday.name` | Qualified by the stored root schema |
| `holiday.prior_day_present` | Qualified by the stored root schema |
| `holiday.pay_eligible` | Qualified by the stored root schema |
| `day_facts` | Qualified by the stored root schema |
| `work_window_hours` | Qualified by the stored root schema |
| `work_window_hours_between` | Qualified by the stored root schema |
| `extended_work_hours_between` | Qualified by the stored root schema |
| `day_fact_keys` | Qualified by the stored root schema |
| `age_years` | Qualified by the stored root schema |
| `attendance_recorded` | Qualified by the stored root schema |
| `first_work_at` | Qualified by the stored root schema |
| `night_worked` | Qualified by the stored root schema |
| `first_night_at` | Qualified by the stored root schema |
| `holiday_work` | Qualified by the stored root schema |
| `overtime_work` | Qualified by the stored root schema |
| `declared_overtime_hours` | Qualified by the stored root schema |
| `rest_minutes_total` | Qualified by the stored root schema |
| `longest_rest_minutes` | Qualified by the stored root schema |
| `longest_run_hours` | Qualified by the stored root schema |
| `rest_before_overtime_minutes` | Qualified by the stored root schema |
| `shift_hours` | Qualified by the stored root schema |
| `shift_start_at` | Qualified by the stored root schema |
| `stated_day_hours` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `leave_work` — Stored runtime expression declaration

Used by: `rule_sets(WORK).rules.data.work_during_leave_when` — actual covering leave identity, first recorded work instant and raw recorded dated permission facts; no person, calendar, rates or presumed attendance.

Bare names: `date`, `covering_leave_id`, `covering_leave_code`, `first_work_at`, `attendance_recorded`, `day_fact_keys`, `day_facts`.

Open prefixes: `day_facts.<key>`.

| Member | Meaning |
| --- | --- |
| `date` | Qualified by the stored root schema |
| `covering_leave_id` | Qualified by the stored root schema |
| `covering_leave_code` | Qualified by the stored root schema |
| `first_work_at` | Qualified by the stored root schema |
| `attendance_recorded` | Qualified by the stored root schema |
| `day_fact_keys` | Qualified by the stored root schema |
| `day_facts` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `component_payment` — Stored runtime expression declaration

Used by: `leave_catalogue.payment_suspend_when` and `payment_release_when` — actual frozen leave identity, documentary instruction and later receipt facts; no person, wages or calendar assumptions.

Bare names: `date`, `leave`, `instruction`, `receipt`.

Open prefixes: `leave.facts.<key>`, `instruction.facts.<key>`, `receipt.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `date` | Qualified by the stored root schema |
| `leave.id` | Qualified by the stored root schema |
| `leave.code` | Qualified by the stored root schema |
| `leave.from` | Qualified by the stored root schema |
| `leave.to` | Qualified by the stored root schema |
| `leave.facts` | Qualified by the stored root schema |
| `instruction.reference` | Qualified by the stored root schema |
| `instruction.held_on` | Qualified by the stored root schema |
| `instruction.recorded_on` | Qualified by the stored root schema |
| `instruction.facts` | Qualified by the stored root schema |
| `receipt.effective_on` | Qualified by the stored root schema |
| `receipt.recorded_on` | Qualified by the stored root schema |
| `receipt.facts` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `assessment` — Stored runtime expression declaration

Used by: `statutory_contributions.assessed_on` and `ordinary_on` — one scheme’s wage.

Bare names: `company`, `person`, `actual`, `period`, `year`, `scheme`, `produced`, `history`, `BASE`, `OVERTIME`, `DAY_PAY`, `NIGHT_PREMIUM`, `OVERTIME_PREMIUM`, `ABSENCE`, `NO_PAY_LEAVE`, `ENCASHMENT`, `INCENTIVE`, `NIGHT_WAGE`, `ALLOWANCES`, `ADHOC`, `CLAIMS`.

Open prefixes: `produced.<key>`, `history.<key>`, `company.facts.<key>`, `year.<key>`, `scheme.elections.<key>`, `scheme.child_claims.<key>`, `scheme.deductions.<key>`, `scheme.deductions_current.<key>`, `scheme.deductions_prior.<key>`, `scheme.deductions_prior_employer.<key>`, `scheme.deduction_claim_counts.<key>`, `scheme.deduction_claims_missing_event.<key>`, `scheme.deduction_claims_negative_event.<key>`, `scheme.deductions_last_year.<key>`, `scheme.deductions_two_years_ago.<key>`, `person.company.facts.<key>`, `person.facts.<key>`, `person.period.leave_full_days.<key>`, `person.period.leave_days.<key>`, `person.period.leave_flag_days.<key>`, `person.period.leave_pay.<key>`, `person.employment.exit_facts.<key>`, `person.employee.facts.<key>`, `person.worksite.facts.<key>`, `person.terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.record.observed_at` | Qualified by the stored root schema |
| `person.record.assessed_on` | Qualified by the stored root schema |
| `person.record.from` | Qualified by the stored root schema |
| `person.record.to` | Qualified by the stored root schema |
| `person.record.facts` | Qualified by the stored root schema |
| `person.record.minimum_wage` | Qualified by the stored root schema |
| `person.history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `person.employee.gender` | Qualified by the stored root schema |
| `person.employee.age` | Qualified by the stored root schema |
| `person.employee.age_months` | Qualified by the stored root schema |
| `person.employee.birth_date` | Qualified by the stored root schema |
| `person.employee.birthday` | Qualified by the stored root schema |
| `person.employee.age_months_on` | Qualified by the stored root schema |
| `person.employee.age_on` | Qualified by the stored root schema |
| `person.employee.citizenship` | Qualified by the stored root schema |
| `person.employee.facts` | Qualified by the stored root schema |
| `person.employee.fact_keys` | Qualified by the stored root schema |
| `person.worksite.code` | Qualified by the stored root schema |
| `person.worksite.region` | Qualified by the stored root schema |
| `person.worksite.facts` | Qualified by the stored root schema |
| `person.employee.marital_status` | Qualified by the stored root schema |
| `person.employee.spouse_status` | Qualified by the stored root schema |
| `person.employee.dependents_count` | Qualified by the stored root schema |
| `person.employee.solo_parent` | Qualified by the stored root schema |
| `person.employee.receiving_pension` | Qualified by the stored root schema |
| `person.employee.disabled` | Qualified by the stored root schema |
| `person.employee.race` | Qualified by the stored root schema |
| `person.employee.religion` | Qualified by the stored root schema |
| `person.employee.residency_months` | Qualified by the stored root schema |
| `person.employee.presence_recorded` | Qualified by the stored root schema |
| `person.employee.presence_days` | Qualified by the stored root schema |
| `person.employee.presence_linked_days` | Qualified by the stored root schema |
| `person.employee.presence_days_in` | Qualified by the stored root schema |
| `person.employee.employment_days` | Qualified by the stored root schema |
| `person.employment.type` | Qualified by the stored root schema |
| `person.employment.classification` | Qualified by the stored root schema |
| `person.employment.risk_class` | Qualified by the stored root schema |
| `person.employment.service_days` | Qualified by the stored root schema |
| `person.employment.service_days_before` | Qualified by the stored root schema |
| `person.employment.service_months` | Qualified by the stored root schema |
| `person.employment.service_months_exact` | Qualified by the stored root schema |
| `person.employment.service_years` | Qualified by the stored root schema |
| `person.employment.service_years_on` | Qualified by the stored root schema |
| `person.employment.notice_days_remaining` | Qualified by the stored root schema |
| `person.employment.notice_monthly_wages` | Qualified by the stored root schema |
| `person.employment.payday_notice_days` | Qualified by the stored root schema |
| `person.employment.service_start` | Qualified by the stored root schema |
| `person.employment.rule_date` | Qualified by the stored root schema |
| `person.employment.rule_end` | Qualified by the stored root schema |
| `person.employment.exit_date` | Qualified by the stored root schema |
| `person.employment.signed_contract_end` | Qualified by the stored root schema |
| `person.employment.days_to_exit` | Qualified by the stored root schema |
| `person.employment.open_ended` | Qualified by the stored root schema |
| `person.employment.contract_months` | Qualified by the stored root schema |
| `person.employment.contract_days` | Qualified by the stored root schema |
| `person.employment.exit_ground` | Qualified by the stored root schema |
| `person.employment.exit_facts` | Qualified by the stored root schema |
| `person.employment.exit_fact_keys` | Qualified by the stored root schema |
| `person.employment.absent_days_12m` | Qualified by the stored root schema |
| `person.employment.service_periods` | Qualified by the stored root schema |
| `person.employment.service_scope` | Qualified by the stored root schema |
| `person.employment.aggregate_service_scope` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.prior_service_months` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.contract_workdays` | Qualified by the stored root schema |
| `person.employment.exact_received_components` | Qualified by the stored root schema |
| `person.employment.exact_rate_wages` | Qualified by the stored root schema |
| `person.employment.comparable_rate_wages` | Qualified by the stored root schema |
| `person.employment.exact_service_wages` | Qualified by the stored root schema |
| `person.employment.exact_wages` | Qualified by the stored root schema |
| `person.employment.exact_wage_window` | Qualified by the stored root schema |
| `person.employment.average_daily_wage` | Qualified by the stored root schema |
| `person.employment.average_monthly_wage` | Qualified by the stored root schema |
| `person.employment.on_leave` | Qualified by the stored root schema |
| `person.employment.service_excluding_leave` | Qualified by the stored root schema |
| `person.employment.service_months_net` | Qualified by the stored root schema |
| `person.terms.basic_salary` | Qualified by the stored root schema |
| `person.terms.monthly_basic` | Qualified by the stored root schema |
| `person.terms.ordinary_day` | Qualified by the stored root schema |
| `person.terms.fixed_allowances` | Qualified by the stored root schema |
| `person.terms.monthly_wage` | Qualified by the stored root schema |
| `person.terms.gross_monthly` | Qualified by the stored root schema |
| `person.terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `person.terms.statutory_wages` | Qualified by the stored root schema |
| `person.terms.statutory_work_category` | Qualified by the stored root schema |
| `person.terms.weather_dependent_piece` | Qualified by the stored root schema |
| `person.terms.worksite` | Qualified by the stored root schema |
| `person.terms.worksite_sector` | Qualified by the stored root schema |
| `person.terms.department` | Qualified by the stored root schema |
| `person.terms.payroll_group` | Qualified by the stored root schema |
| `person.terms.paid_rest_days` | Qualified by the stored root schema |
| `person.terms.grade` | Qualified by the stored root schema |
| `person.terms.pay_frequency` | Qualified by the stored root schema |
| `person.terms.pass_type` | Qualified by the stored root schema |
| `person.terms.tax_residency` | Qualified by the stored root schema |
| `person.terms.residency_since` | Qualified by the stored root schema |
| `person.terms.notice_days` | Qualified by the stored root schema |
| `person.terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `person.terms.contract_week_work_days` | Qualified by the stored root schema |
| `person.terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `person.terms.working_days_per_week` | Qualified by the stored root schema |
| `person.terms.facts` | Qualified by the stored root schema |
| `person.terms.fact_keys` | Qualified by the stored root schema |
| `person.children.count` | Qualified by the stored root schema |
| `person.children.birthdates` | Qualified by the stored root schema |
| `person.children.under` | Qualified by the stored root schema |
| `person.children.born_on` | Qualified by the stored root schema |
| `person.children.multiple_born_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_before` | Qualified by the stored root schema |
| `person.children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `person.children.citizens` | Qualified by the stored root schema |
| `person.children.births` | Qualified by the stored root schema |
| `person.children.citizens_under` | Qualified by the stored root schema |
| `person.children.prior_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_infant_care_days` | Qualified by the stored root schema |
| `person.children.classed` | Qualified by the stored root schema |
| `person.children.unclassed_under` | Qualified by the stored root schema |
| `person.company.region` | Qualified by the stored root schema |
| `person.company.headcount` | Qualified by the stored root schema |
| `person.company.headcount_citizens` | Qualified by the stored root schema |
| `person.company.pay_frequency` | Qualified by the stored root schema |
| `person.company.facts` | Qualified by the stored root schema |
| `person.wage_floor` | Qualified by the stored root schema |
| `person.wage_floor_pay.BASE` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `person.wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `person.wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.event.kind` | Qualified by the stored root schema |
| `person.event.relationship` | Qualified by the stored root schema |
| `person.event.child_index` | Qualified by the stored root schema |
| `person.event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `person.event.delivery_children_count` | Qualified by the stored root schema |
| `person.event.date` | Qualified by the stored root schema |
| `person.event.facts` | Qualified by the stored root schema |
| `person.event.case.facts` | Qualified by the stored root schema |
| `person.event.child_citizenship` | Qualified by the stored root schema |
| `person.event.child_age` | Qualified by the stored root schema |
| `person.event.child_shared_weeks` | Qualified by the stored root schema |
| `person.event.prior_employment_days` | Qualified by the stored root schema |
| `person.event.estimated_delivery_date` | Qualified by the stored root schema |
| `person.event.adoption_eligibility_date` | Qualified by the stored root schema |
| `person.period.unpaid_full_days` | Qualified by the stored root schema |
| `person.period.leave_flag_days` | Qualified by the stored root schema |
| `person.period.leave_days` | Qualified by the stored root schema |
| `person.period.leave_full_days` | Qualified by the stored root schema |
| `person.period.leave_pay` | Qualified by the stored root schema |
| `person.period.working_days` | Qualified by the stored root schema |
| `person.period.unpaid_days` | Qualified by the stored root schema |
| `person.period.overtime_days` | Qualified by the stored root schema |
| `person.period.arrears` | Qualified by the stored root schema |
| `period.key` | Qualified by the stored root schema |
| `period.month` | Qualified by the stored root schema |
| `period.start` | Qualified by the stored root schema |
| `period.end` | Qualified by the stored root schema |
| `period.pay_date` | Qualified by the stored root schema |
| `period.index` | Qualified by the stored root schema |
| `period.instalments` | Qualified by the stored root schema |
| `period.month_factor` | Qualified by the stored root schema |
| `period.last_of_year` | Qualified by the stored root schema |
| `period.days_employed` | Qualified by the stored root schema |
| `period.days_in_month` | Qualified by the stored root schema |
| `period.year` | Qualified by the stored root schema |
| `year.start` | Qualified by the stored root schema |
| `year.end` | Qualified by the stored root schema |
| `year.months_employed` | Qualified by the stored root schema |
| `year.earned` | Qualified by the stored root schema |
| `year.earned.ABSENCE` | Qualified by the stored root schema |
| `year.payments` | Qualified by the stored root schema |
| `scheme.contractual_wage.current_gross` | Qualified by the stored root schema |
| `scheme.contractual_wage.prior_paid_gross` | Qualified by the stored root schema |
| `scheme.contractual_wage.prior_paid_available` | Qualified by the stored root schema |
| `scheme.wage_net.gross` | Qualified by the stored root schema |
| `scheme.wage_net.employee_cash` | Qualified by the stored root schema |
| `scheme.wage_net.net` | Qualified by the stored root schema |
| `scheme.certificate.employee_id` | Qualified by the stored root schema |
| `scheme.certificate.employment_id` | Qualified by the stored root schema |
| `scheme.certificate.company_id` | Qualified by the stored root schema |
| `scheme.certificate.statutory_contribution_id` | Qualified by the stored root schema |
| `scheme.certificate.owned_file.created_at` | Qualified by the stored root schema |
| `scheme.certificate.declaration_id` | Qualified by the stored root schema |
| `scheme.certificate.evidence_id` | Qualified by the stored root schema |
| `scheme.certificate.file_id` | Qualified by the stored root schema |
| `scheme.certificate.instrument` | Qualified by the stored root schema |
| `scheme.certificate.country` | Qualified by the stored root schema |
| `scheme.certificate.authority` | Qualified by the stored root schema |
| `scheme.certificate.reference` | Qualified by the stored root schema |
| `scheme.certificate.coverage` | Qualified by the stored root schema |
| `scheme.certificate.from` | Qualified by the stored root schema |
| `scheme.certificate.to` | Qualified by the stored root schema |
| `scheme.certificate.loss_on` | Qualified by the stored root schema |
| `scheme.certificate.qualification_on` | Qualified by the stored root schema |
| `scheme.certificate.owned_file.id` | Qualified by the stored root schema |
| `scheme.certificate.owned_file.sha256` | Qualified by the stored root schema |
| `scheme.certificate.owned_file.size` | Qualified by the stored root schema |
| `scheme.certificate.observed_at` | Qualified by the stored root schema |
| `scheme.certificate.observation_timezone` | Qualified by the stored root schema |
| `scheme.covered_persons` | Qualified by the stored root schema |
| `scheme.annual_first_payment_on` | Qualified by the stored root schema |
| `scheme.annual_payment_history_available` | Qualified by the stored root schema |
| `scheme.annual_payment_gross_before` | Qualified by the stored root schema |
| `scheme.annual_payment_gross_after` | Qualified by the stored root schema |
| `scheme.code` | Qualified by the stored root schema |
| `scheme.assessment_period` | Qualified by the stored root schema |
| `scheme.registration_status` | Qualified by the stored root schema |
| `scheme.current_registration_status` | Qualified by the stored root schema |
| `scheme.declaration_reference` | Qualified by the stored root schema |
| `scheme.deduction_claims` | Qualified by the stored root schema |
| `scheme.opening_sources` | Qualified by the stored root schema |
| `scheme.opening_wages.available` | Qualified by the stored root schema |
| `scheme.opening_wages.ordinary` | Qualified by the stored root schema |
| `scheme.opening_wages.additional` | Qualified by the stored root schema |
| `scheme.opening_wages.through` | Qualified by the stored root schema |
| `scheme.opening_wages.receipts` | Qualified by the stored root schema |
| `scheme.year_to_date.base` | Qualified by the stored root schema |
| `scheme.year_to_date.ordinary` | Qualified by the stored root schema |
| `scheme.year_to_date.employee` | Qualified by the stored root schema |
| `scheme.year_to_date.employer` | Qualified by the stored root schema |
| `scheme.year_to_date.rebate` | Qualified by the stored root schema |
| `scheme.last_year.base` | Qualified by the stored root schema |
| `scheme.last_year.employee` | Qualified by the stored root schema |
| `scheme.last_year.employer` | Qualified by the stored root schema |
| `scheme.first_year` | Qualified by the stored root schema |
| `scheme.dependent_months` | Qualified by the stored root schema |
| `scheme.trailing_short.base` | Qualified by the stored root schema |
| `scheme.trailing_short.months` | Qualified by the stored root schema |
| `scheme.trailing_long.base` | Qualified by the stored root schema |
| `scheme.trailing_long.months` | Qualified by the stored root schema |
| `scheme.projection.payslips_remaining` | Qualified by the stored root schema |
| `scheme.projection.future_equivalents` | Qualified by the stored root schema |
| `scheme.rate_override` | Qualified by the stored root schema |
| `scheme.since` | Qualified by the stored root schema |
| `scheme.declaration_effective_from` | Qualified by the stored root schema |
| `scheme.first_contribution_due_on` | Qualified by the stored root schema |
| `scheme.since_months` | Qualified by the stored root schema |
| `scheme.elections` | Qualified by the stored root schema |
| `scheme.election_keys` | Qualified by the stored root schema |
| `scheme.child_claims` | Qualified by the stored root schema |
| `scheme.child_claims` | Qualified by the stored root schema |
| `scheme.deductions` | Qualified by the stored root schema |
| `scheme.deductions_current` | Qualified by the stored root schema |
| `scheme.deductions_prior` | Qualified by the stored root schema |
| `scheme.deductions_prior_employer` | Qualified by the stored root schema |
| `scheme.deduction_claim_counts` | Qualified by the stored root schema |
| `scheme.deduction_claims_missing_event` | Qualified by the stored root schema |
| `scheme.deduction_claims_negative_event` | Qualified by the stored root schema |
| `scheme.deductions_last_year` | Qualified by the stored root schema |
| `scheme.deductions_two_years_ago` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `actual.ALLOWANCES` | Qualified by the stored root schema |
| `actual.ADHOC` | Qualified by the stored root schema |
| `actual.CLAIMS` | Qualified by the stored root schema |
| `actual` | Qualified by the stored root schema |
| `actual` | Qualified by the stored root schema |
| `actual` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `company.year.from` | Qualified by the stored root schema |
| `company.year.to` | Qualified by the stored root schema |
| `BASE` | Qualified by the stored root schema |
| `OVERTIME` | Qualified by the stored root schema |
| `DAY_PAY` | Qualified by the stored root schema |
| `NIGHT_PREMIUM` | Qualified by the stored root schema |
| `OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `ABSENCE` | Qualified by the stored root schema |
| `NO_PAY_LEAVE` | Qualified by the stored root schema |
| `ENCASHMENT` | Qualified by the stored root schema |
| `INCENTIVE` | Qualified by the stored root schema |
| `NIGHT_WAGE` | Qualified by the stored root schema |
| `ALLOWANCES` | Qualified by the stored root schema |
| `ADHOC` | Qualified by the stored root schema |
| `CLAIMS` | Qualified by the stored root schema |
| `year.ALLOWANCES` | Qualified by the stored root schema |
| `year.ADHOC` | Qualified by the stored root schema |
| `year.CLAIMS` | Qualified by the stored root schema |
| `year` | Qualified by the stored root schema |
| `year` | Qualified by the stored root schema |
| `year` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `scheme` — Stored runtime expression declaration

Used by: contribution rules and `statutory_contributions.elections[].required_when`.

Bare names: `company`, `person`, `actual`, `period`, `year`, `scheme`, `produced`, `history`, `base`, `raw_base`, `ordinary`.

Open prefixes: `produced.<key>`, `history.<key>`, `company.facts.<key>`, `year.<key>`, `scheme.elections.<key>`, `scheme.child_claims.<key>`, `scheme.deductions.<key>`, `scheme.deductions_current.<key>`, `scheme.deductions_prior.<key>`, `scheme.deductions_prior_employer.<key>`, `scheme.deduction_claim_counts.<key>`, `scheme.deduction_claims_missing_event.<key>`, `scheme.deduction_claims_negative_event.<key>`, `scheme.deductions_last_year.<key>`, `scheme.deductions_two_years_ago.<key>`, `person.company.facts.<key>`, `person.facts.<key>`, `person.period.leave_full_days.<key>`, `person.period.leave_days.<key>`, `person.period.leave_flag_days.<key>`, `person.period.leave_pay.<key>`, `person.employment.exit_facts.<key>`, `person.employee.facts.<key>`, `person.worksite.facts.<key>`, `person.terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.record.observed_at` | Qualified by the stored root schema |
| `person.record.assessed_on` | Qualified by the stored root schema |
| `person.record.from` | Qualified by the stored root schema |
| `person.record.to` | Qualified by the stored root schema |
| `person.record.facts` | Qualified by the stored root schema |
| `person.record.minimum_wage` | Qualified by the stored root schema |
| `person.history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `person.employee.gender` | Qualified by the stored root schema |
| `person.employee.age` | Qualified by the stored root schema |
| `person.employee.age_months` | Qualified by the stored root schema |
| `person.employee.birth_date` | Qualified by the stored root schema |
| `person.employee.birthday` | Qualified by the stored root schema |
| `person.employee.age_months_on` | Qualified by the stored root schema |
| `person.employee.age_on` | Qualified by the stored root schema |
| `person.employee.citizenship` | Qualified by the stored root schema |
| `person.employee.facts` | Qualified by the stored root schema |
| `person.employee.fact_keys` | Qualified by the stored root schema |
| `person.worksite.code` | Qualified by the stored root schema |
| `person.worksite.region` | Qualified by the stored root schema |
| `person.worksite.facts` | Qualified by the stored root schema |
| `person.employee.marital_status` | Qualified by the stored root schema |
| `person.employee.spouse_status` | Qualified by the stored root schema |
| `person.employee.dependents_count` | Qualified by the stored root schema |
| `person.employee.solo_parent` | Qualified by the stored root schema |
| `person.employee.receiving_pension` | Qualified by the stored root schema |
| `person.employee.disabled` | Qualified by the stored root schema |
| `person.employee.race` | Qualified by the stored root schema |
| `person.employee.religion` | Qualified by the stored root schema |
| `person.employee.residency_months` | Qualified by the stored root schema |
| `person.employee.presence_recorded` | Qualified by the stored root schema |
| `person.employee.presence_days` | Qualified by the stored root schema |
| `person.employee.presence_linked_days` | Qualified by the stored root schema |
| `person.employee.presence_days_in` | Qualified by the stored root schema |
| `person.employee.employment_days` | Qualified by the stored root schema |
| `person.employment.type` | Qualified by the stored root schema |
| `person.employment.classification` | Qualified by the stored root schema |
| `person.employment.risk_class` | Qualified by the stored root schema |
| `person.employment.service_days` | Qualified by the stored root schema |
| `person.employment.service_days_before` | Qualified by the stored root schema |
| `person.employment.service_months` | Qualified by the stored root schema |
| `person.employment.service_months_exact` | Qualified by the stored root schema |
| `person.employment.service_years` | Qualified by the stored root schema |
| `person.employment.service_years_on` | Qualified by the stored root schema |
| `person.employment.notice_days_remaining` | Qualified by the stored root schema |
| `person.employment.notice_monthly_wages` | Qualified by the stored root schema |
| `person.employment.payday_notice_days` | Qualified by the stored root schema |
| `person.employment.service_start` | Qualified by the stored root schema |
| `person.employment.rule_date` | Qualified by the stored root schema |
| `person.employment.rule_end` | Qualified by the stored root schema |
| `person.employment.exit_date` | Qualified by the stored root schema |
| `person.employment.signed_contract_end` | Qualified by the stored root schema |
| `person.employment.days_to_exit` | Qualified by the stored root schema |
| `person.employment.open_ended` | Qualified by the stored root schema |
| `person.employment.contract_months` | Qualified by the stored root schema |
| `person.employment.contract_days` | Qualified by the stored root schema |
| `person.employment.exit_ground` | Qualified by the stored root schema |
| `person.employment.exit_facts` | Qualified by the stored root schema |
| `person.employment.exit_fact_keys` | Qualified by the stored root schema |
| `person.employment.absent_days_12m` | Qualified by the stored root schema |
| `person.employment.service_periods` | Qualified by the stored root schema |
| `person.employment.service_scope` | Qualified by the stored root schema |
| `person.employment.aggregate_service_scope` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.prior_service_months` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.contract_workdays` | Qualified by the stored root schema |
| `person.employment.exact_received_components` | Qualified by the stored root schema |
| `person.employment.exact_rate_wages` | Qualified by the stored root schema |
| `person.employment.comparable_rate_wages` | Qualified by the stored root schema |
| `person.employment.exact_service_wages` | Qualified by the stored root schema |
| `person.employment.exact_wages` | Qualified by the stored root schema |
| `person.employment.exact_wage_window` | Qualified by the stored root schema |
| `person.employment.average_daily_wage` | Qualified by the stored root schema |
| `person.employment.average_monthly_wage` | Qualified by the stored root schema |
| `person.employment.on_leave` | Qualified by the stored root schema |
| `person.employment.service_excluding_leave` | Qualified by the stored root schema |
| `person.employment.service_months_net` | Qualified by the stored root schema |
| `person.terms.basic_salary` | Qualified by the stored root schema |
| `person.terms.monthly_basic` | Qualified by the stored root schema |
| `person.terms.ordinary_day` | Qualified by the stored root schema |
| `person.terms.fixed_allowances` | Qualified by the stored root schema |
| `person.terms.monthly_wage` | Qualified by the stored root schema |
| `person.terms.gross_monthly` | Qualified by the stored root schema |
| `person.terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `person.terms.statutory_wages` | Qualified by the stored root schema |
| `person.terms.statutory_work_category` | Qualified by the stored root schema |
| `person.terms.weather_dependent_piece` | Qualified by the stored root schema |
| `person.terms.worksite` | Qualified by the stored root schema |
| `person.terms.worksite_sector` | Qualified by the stored root schema |
| `person.terms.department` | Qualified by the stored root schema |
| `person.terms.payroll_group` | Qualified by the stored root schema |
| `person.terms.paid_rest_days` | Qualified by the stored root schema |
| `person.terms.grade` | Qualified by the stored root schema |
| `person.terms.pay_frequency` | Qualified by the stored root schema |
| `person.terms.pass_type` | Qualified by the stored root schema |
| `person.terms.tax_residency` | Qualified by the stored root schema |
| `person.terms.residency_since` | Qualified by the stored root schema |
| `person.terms.notice_days` | Qualified by the stored root schema |
| `person.terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `person.terms.contract_week_work_days` | Qualified by the stored root schema |
| `person.terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `person.terms.working_days_per_week` | Qualified by the stored root schema |
| `person.terms.facts` | Qualified by the stored root schema |
| `person.terms.fact_keys` | Qualified by the stored root schema |
| `person.children.count` | Qualified by the stored root schema |
| `person.children.birthdates` | Qualified by the stored root schema |
| `person.children.under` | Qualified by the stored root schema |
| `person.children.born_on` | Qualified by the stored root schema |
| `person.children.multiple_born_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_before` | Qualified by the stored root schema |
| `person.children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `person.children.citizens` | Qualified by the stored root schema |
| `person.children.births` | Qualified by the stored root schema |
| `person.children.citizens_under` | Qualified by the stored root schema |
| `person.children.prior_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_infant_care_days` | Qualified by the stored root schema |
| `person.children.classed` | Qualified by the stored root schema |
| `person.children.unclassed_under` | Qualified by the stored root schema |
| `person.company.region` | Qualified by the stored root schema |
| `person.company.headcount` | Qualified by the stored root schema |
| `person.company.headcount_citizens` | Qualified by the stored root schema |
| `person.company.pay_frequency` | Qualified by the stored root schema |
| `person.company.facts` | Qualified by the stored root schema |
| `person.wage_floor` | Qualified by the stored root schema |
| `person.wage_floor_pay.BASE` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `person.wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `person.wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.event.kind` | Qualified by the stored root schema |
| `person.event.relationship` | Qualified by the stored root schema |
| `person.event.child_index` | Qualified by the stored root schema |
| `person.event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `person.event.delivery_children_count` | Qualified by the stored root schema |
| `person.event.date` | Qualified by the stored root schema |
| `person.event.facts` | Qualified by the stored root schema |
| `person.event.case.facts` | Qualified by the stored root schema |
| `person.event.child_citizenship` | Qualified by the stored root schema |
| `person.event.child_age` | Qualified by the stored root schema |
| `person.event.child_shared_weeks` | Qualified by the stored root schema |
| `person.event.prior_employment_days` | Qualified by the stored root schema |
| `person.event.estimated_delivery_date` | Qualified by the stored root schema |
| `person.event.adoption_eligibility_date` | Qualified by the stored root schema |
| `person.period.unpaid_full_days` | Qualified by the stored root schema |
| `person.period.leave_flag_days` | Qualified by the stored root schema |
| `person.period.leave_days` | Qualified by the stored root schema |
| `person.period.leave_full_days` | Qualified by the stored root schema |
| `person.period.leave_pay` | Qualified by the stored root schema |
| `person.period.working_days` | Qualified by the stored root schema |
| `person.period.unpaid_days` | Qualified by the stored root schema |
| `person.period.overtime_days` | Qualified by the stored root schema |
| `person.period.arrears` | Qualified by the stored root schema |
| `period.key` | Qualified by the stored root schema |
| `period.month` | Qualified by the stored root schema |
| `period.start` | Qualified by the stored root schema |
| `period.end` | Qualified by the stored root schema |
| `period.pay_date` | Qualified by the stored root schema |
| `period.index` | Qualified by the stored root schema |
| `period.instalments` | Qualified by the stored root schema |
| `period.month_factor` | Qualified by the stored root schema |
| `period.last_of_year` | Qualified by the stored root schema |
| `period.days_employed` | Qualified by the stored root schema |
| `period.days_in_month` | Qualified by the stored root schema |
| `period.year` | Qualified by the stored root schema |
| `year.start` | Qualified by the stored root schema |
| `year.end` | Qualified by the stored root schema |
| `year.months_employed` | Qualified by the stored root schema |
| `year.earned` | Qualified by the stored root schema |
| `year.earned.ABSENCE` | Qualified by the stored root schema |
| `year.payments` | Qualified by the stored root schema |
| `scheme.contractual_wage.current_gross` | Qualified by the stored root schema |
| `scheme.contractual_wage.prior_paid_gross` | Qualified by the stored root schema |
| `scheme.contractual_wage.prior_paid_available` | Qualified by the stored root schema |
| `scheme.wage_net.gross` | Qualified by the stored root schema |
| `scheme.wage_net.employee_cash` | Qualified by the stored root schema |
| `scheme.wage_net.net` | Qualified by the stored root schema |
| `scheme.certificate.employee_id` | Qualified by the stored root schema |
| `scheme.certificate.employment_id` | Qualified by the stored root schema |
| `scheme.certificate.company_id` | Qualified by the stored root schema |
| `scheme.certificate.statutory_contribution_id` | Qualified by the stored root schema |
| `scheme.certificate.owned_file.created_at` | Qualified by the stored root schema |
| `scheme.certificate.declaration_id` | Qualified by the stored root schema |
| `scheme.certificate.evidence_id` | Qualified by the stored root schema |
| `scheme.certificate.file_id` | Qualified by the stored root schema |
| `scheme.certificate.instrument` | Qualified by the stored root schema |
| `scheme.certificate.country` | Qualified by the stored root schema |
| `scheme.certificate.authority` | Qualified by the stored root schema |
| `scheme.certificate.reference` | Qualified by the stored root schema |
| `scheme.certificate.coverage` | Qualified by the stored root schema |
| `scheme.certificate.from` | Qualified by the stored root schema |
| `scheme.certificate.to` | Qualified by the stored root schema |
| `scheme.certificate.loss_on` | Qualified by the stored root schema |
| `scheme.certificate.qualification_on` | Qualified by the stored root schema |
| `scheme.certificate.owned_file.id` | Qualified by the stored root schema |
| `scheme.certificate.owned_file.sha256` | Qualified by the stored root schema |
| `scheme.certificate.owned_file.size` | Qualified by the stored root schema |
| `scheme.certificate.observed_at` | Qualified by the stored root schema |
| `scheme.certificate.observation_timezone` | Qualified by the stored root schema |
| `scheme.covered_persons` | Qualified by the stored root schema |
| `scheme.annual_first_payment_on` | Qualified by the stored root schema |
| `scheme.annual_payment_history_available` | Qualified by the stored root schema |
| `scheme.annual_payment_gross_before` | Qualified by the stored root schema |
| `scheme.annual_payment_gross_after` | Qualified by the stored root schema |
| `scheme.code` | Qualified by the stored root schema |
| `scheme.assessment_period` | Qualified by the stored root schema |
| `scheme.registration_status` | Qualified by the stored root schema |
| `scheme.current_registration_status` | Qualified by the stored root schema |
| `scheme.declaration_reference` | Qualified by the stored root schema |
| `scheme.deduction_claims` | Qualified by the stored root schema |
| `scheme.opening_sources` | Qualified by the stored root schema |
| `scheme.opening_wages.available` | Qualified by the stored root schema |
| `scheme.opening_wages.ordinary` | Qualified by the stored root schema |
| `scheme.opening_wages.additional` | Qualified by the stored root schema |
| `scheme.opening_wages.through` | Qualified by the stored root schema |
| `scheme.opening_wages.receipts` | Qualified by the stored root schema |
| `scheme.year_to_date.base` | Qualified by the stored root schema |
| `scheme.year_to_date.ordinary` | Qualified by the stored root schema |
| `scheme.year_to_date.employee` | Qualified by the stored root schema |
| `scheme.year_to_date.employer` | Qualified by the stored root schema |
| `scheme.year_to_date.rebate` | Qualified by the stored root schema |
| `scheme.last_year.base` | Qualified by the stored root schema |
| `scheme.last_year.employee` | Qualified by the stored root schema |
| `scheme.last_year.employer` | Qualified by the stored root schema |
| `scheme.first_year` | Qualified by the stored root schema |
| `scheme.dependent_months` | Qualified by the stored root schema |
| `scheme.trailing_short.base` | Qualified by the stored root schema |
| `scheme.trailing_short.months` | Qualified by the stored root schema |
| `scheme.trailing_long.base` | Qualified by the stored root schema |
| `scheme.trailing_long.months` | Qualified by the stored root schema |
| `scheme.projection.payslips_remaining` | Qualified by the stored root schema |
| `scheme.projection.future_equivalents` | Qualified by the stored root schema |
| `scheme.rate_override` | Qualified by the stored root schema |
| `scheme.since` | Qualified by the stored root schema |
| `scheme.declaration_effective_from` | Qualified by the stored root schema |
| `scheme.first_contribution_due_on` | Qualified by the stored root schema |
| `scheme.since_months` | Qualified by the stored root schema |
| `scheme.elections` | Qualified by the stored root schema |
| `scheme.election_keys` | Qualified by the stored root schema |
| `scheme.child_claims` | Qualified by the stored root schema |
| `scheme.child_claims` | Qualified by the stored root schema |
| `scheme.deductions` | Qualified by the stored root schema |
| `scheme.deductions_current` | Qualified by the stored root schema |
| `scheme.deductions_prior` | Qualified by the stored root schema |
| `scheme.deductions_prior_employer` | Qualified by the stored root schema |
| `scheme.deduction_claim_counts` | Qualified by the stored root schema |
| `scheme.deduction_claims_missing_event` | Qualified by the stored root schema |
| `scheme.deduction_claims_negative_event` | Qualified by the stored root schema |
| `scheme.deductions_last_year` | Qualified by the stored root schema |
| `scheme.deductions_two_years_ago` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `produced` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `history` | Qualified by the stored root schema |
| `actual.ALLOWANCES` | Qualified by the stored root schema |
| `actual.ADHOC` | Qualified by the stored root schema |
| `actual.CLAIMS` | Qualified by the stored root schema |
| `actual` | Qualified by the stored root schema |
| `actual` | Qualified by the stored root schema |
| `actual` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `company.year.from` | Qualified by the stored root schema |
| `company.year.to` | Qualified by the stored root schema |
| `base` | Qualified by the stored root schema |
| `raw_base` | Qualified by the stored root schema |
| `scheme.deduction` | Qualified by the stored root schema |
| `ordinary` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `leave_day` — Stored runtime expression declaration

Used by: `leave_catalogue.pay_fraction` / `time_off_amount` — one charged leave day.

Bare names: `record`, `history`, `employee`, `worksite`, `employment`, `terms`, `children`, `company`, `wage_floor`, `wage_floor_pay`, `period`, `facts`, `event`, `ordinary_day`, `leave`.

Open prefixes: `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_flag_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `employee.facts.<key>`, `worksite.facts.<key>`, `terms.facts.<key>`, `leave.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `record.observed_at` | Qualified by the stored root schema |
| `record.assessed_on` | Qualified by the stored root schema |
| `record.from` | Qualified by the stored root schema |
| `record.to` | Qualified by the stored root schema |
| `record.facts` | Qualified by the stored root schema |
| `record.minimum_wage` | Qualified by the stored root schema |
| `history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `employee.gender` | Qualified by the stored root schema |
| `employee.age` | Qualified by the stored root schema |
| `employee.age_months` | Qualified by the stored root schema |
| `employee.birth_date` | Qualified by the stored root schema |
| `employee.birthday` | Qualified by the stored root schema |
| `employee.age_months_on` | Qualified by the stored root schema |
| `employee.age_on` | Qualified by the stored root schema |
| `employee.citizenship` | Qualified by the stored root schema |
| `employee.facts` | Qualified by the stored root schema |
| `employee.fact_keys` | Qualified by the stored root schema |
| `worksite.code` | Qualified by the stored root schema |
| `worksite.region` | Qualified by the stored root schema |
| `worksite.facts` | Qualified by the stored root schema |
| `employee.marital_status` | Qualified by the stored root schema |
| `employee.spouse_status` | Qualified by the stored root schema |
| `employee.dependents_count` | Qualified by the stored root schema |
| `employee.solo_parent` | Qualified by the stored root schema |
| `employee.receiving_pension` | Qualified by the stored root schema |
| `employee.disabled` | Qualified by the stored root schema |
| `employee.race` | Qualified by the stored root schema |
| `employee.religion` | Qualified by the stored root schema |
| `employee.residency_months` | Qualified by the stored root schema |
| `employee.presence_recorded` | Qualified by the stored root schema |
| `employee.presence_days` | Qualified by the stored root schema |
| `employee.presence_linked_days` | Qualified by the stored root schema |
| `employee.presence_days_in` | Qualified by the stored root schema |
| `employee.employment_days` | Qualified by the stored root schema |
| `employment.type` | Qualified by the stored root schema |
| `employment.classification` | Qualified by the stored root schema |
| `employment.risk_class` | Qualified by the stored root schema |
| `employment.service_days` | Qualified by the stored root schema |
| `employment.service_days_before` | Qualified by the stored root schema |
| `employment.service_months` | Qualified by the stored root schema |
| `employment.service_months_exact` | Qualified by the stored root schema |
| `employment.service_years` | Qualified by the stored root schema |
| `employment.service_years_on` | Qualified by the stored root schema |
| `employment.notice_days_remaining` | Qualified by the stored root schema |
| `employment.notice_monthly_wages` | Qualified by the stored root schema |
| `employment.payday_notice_days` | Qualified by the stored root schema |
| `employment.service_start` | Qualified by the stored root schema |
| `employment.rule_date` | Qualified by the stored root schema |
| `employment.rule_end` | Qualified by the stored root schema |
| `employment.exit_date` | Qualified by the stored root schema |
| `employment.signed_contract_end` | Qualified by the stored root schema |
| `employment.days_to_exit` | Qualified by the stored root schema |
| `employment.open_ended` | Qualified by the stored root schema |
| `employment.contract_months` | Qualified by the stored root schema |
| `employment.contract_days` | Qualified by the stored root schema |
| `employment.exit_ground` | Qualified by the stored root schema |
| `employment.exit_facts` | Qualified by the stored root schema |
| `employment.exit_fact_keys` | Qualified by the stored root schema |
| `employment.absent_days_12m` | Qualified by the stored root schema |
| `employment.service_periods` | Qualified by the stored root schema |
| `employment.service_scope` | Qualified by the stored root schema |
| `employment.aggregate_service_scope` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.prior_service_months` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.contract_workdays` | Qualified by the stored root schema |
| `employment.exact_received_components` | Qualified by the stored root schema |
| `employment.exact_rate_wages` | Qualified by the stored root schema |
| `employment.comparable_rate_wages` | Qualified by the stored root schema |
| `employment.exact_service_wages` | Qualified by the stored root schema |
| `employment.exact_wages` | Qualified by the stored root schema |
| `employment.exact_wage_window` | Qualified by the stored root schema |
| `employment.average_daily_wage` | Qualified by the stored root schema |
| `employment.average_monthly_wage` | Qualified by the stored root schema |
| `employment.on_leave` | Qualified by the stored root schema |
| `employment.service_excluding_leave` | Qualified by the stored root schema |
| `employment.service_months_net` | Qualified by the stored root schema |
| `terms.basic_salary` | Qualified by the stored root schema |
| `terms.monthly_basic` | Qualified by the stored root schema |
| `terms.ordinary_day` | Qualified by the stored root schema |
| `terms.fixed_allowances` | Qualified by the stored root schema |
| `terms.monthly_wage` | Qualified by the stored root schema |
| `terms.gross_monthly` | Qualified by the stored root schema |
| `terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `terms.statutory_wages` | Qualified by the stored root schema |
| `terms.statutory_work_category` | Qualified by the stored root schema |
| `terms.weather_dependent_piece` | Qualified by the stored root schema |
| `terms.worksite` | Qualified by the stored root schema |
| `terms.worksite_sector` | Qualified by the stored root schema |
| `terms.department` | Qualified by the stored root schema |
| `terms.payroll_group` | Qualified by the stored root schema |
| `terms.paid_rest_days` | Qualified by the stored root schema |
| `terms.grade` | Qualified by the stored root schema |
| `terms.pay_frequency` | Qualified by the stored root schema |
| `terms.pass_type` | Qualified by the stored root schema |
| `terms.tax_residency` | Qualified by the stored root schema |
| `terms.residency_since` | Qualified by the stored root schema |
| `terms.notice_days` | Qualified by the stored root schema |
| `terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `terms.contract_week_work_days` | Qualified by the stored root schema |
| `terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `terms.working_days_per_week` | Qualified by the stored root schema |
| `terms.facts` | Qualified by the stored root schema |
| `terms.fact_keys` | Qualified by the stored root schema |
| `children.count` | Qualified by the stored root schema |
| `children.birthdates` | Qualified by the stored root schema |
| `children.under` | Qualified by the stored root schema |
| `children.born_on` | Qualified by the stored root schema |
| `children.multiple_born_on` | Qualified by the stored root schema |
| `children.natural_surviving_on` | Qualified by the stored root schema |
| `children.natural_surviving_before` | Qualified by the stored root schema |
| `children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `children.citizens` | Qualified by the stored root schema |
| `children.births` | Qualified by the stored root schema |
| `children.citizens_under` | Qualified by the stored root schema |
| `children.prior_childcare_days` | Qualified by the stored root schema |
| `children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `children.prior_infant_care_days` | Qualified by the stored root schema |
| `children.classed` | Qualified by the stored root schema |
| `children.unclassed_under` | Qualified by the stored root schema |
| `company.region` | Qualified by the stored root schema |
| `company.headcount` | Qualified by the stored root schema |
| `company.headcount_citizens` | Qualified by the stored root schema |
| `company.pay_frequency` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `wage_floor` | Qualified by the stored root schema |
| `wage_floor_pay.BASE` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `event.kind` | Qualified by the stored root schema |
| `event.relationship` | Qualified by the stored root schema |
| `event.child_index` | Qualified by the stored root schema |
| `event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `event.delivery_children_count` | Qualified by the stored root schema |
| `event.date` | Qualified by the stored root schema |
| `event.facts` | Qualified by the stored root schema |
| `event.case.facts` | Qualified by the stored root schema |
| `event.child_citizenship` | Qualified by the stored root schema |
| `event.child_age` | Qualified by the stored root schema |
| `event.child_shared_weeks` | Qualified by the stored root schema |
| `event.prior_employment_days` | Qualified by the stored root schema |
| `event.estimated_delivery_date` | Qualified by the stored root schema |
| `event.adoption_eligibility_date` | Qualified by the stored root schema |
| `period.unpaid_full_days` | Qualified by the stored root schema |
| `period.leave_flag_days` | Qualified by the stored root schema |
| `period.leave_days` | Qualified by the stored root schema |
| `period.leave_full_days` | Qualified by the stored root schema |
| `period.leave_pay` | Qualified by the stored root schema |
| `period.working_days` | Qualified by the stored root schema |
| `period.unpaid_days` | Qualified by the stored root schema |
| `period.overtime_days` | Qualified by the stored root schema |
| `period.arrears` | Qualified by the stored root schema |
| `ordinary_day` | Qualified by the stored root schema |
| `leave.month_index` | Qualified by the stored root schema |
| `leave.original_statutory_origin` | Qualified by the stored root schema |
| `leave.original_part_key` | Qualified by the stored root schema |
| `leave.event_from_unit` | Qualified by the stored root schema |
| `leave.date` | Qualified by the stored root schema |
| `leave.from` | Qualified by the stored root schema |
| `leave.to` | Qualified by the stored root schema |
| `leave.original_notice_lead_days` | Qualified by the stored root schema |
| `leave.original_event_service_months` | Qualified by the stored root schema |
| `leave.original_weekly_index` | Qualified by the stored root schema |
| `leave.original_part_unit_days` | Qualified by the stored root schema |
| `leave.original_part_consumed_week_units` | Qualified by the stored root schema |
| `leave.day_index` | Qualified by the stored root schema |
| `leave.days` | Qualified by the stored root schema |
| `leave.event_day` | Qualified by the stored root schema |
| `leave.taken` | Qualified by the stored root schema |
| `leave.facts` | Qualified by the stored root schema |
| `leave.episode_id` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `leave_remuneration` — Stored runtime expression declaration

Used by: Frozen original statutory leave remuneration policy selectors; no mutable person or entry facts..

Bare names: `original`.

| Member | Meaning |
| --- | --- |
| `original.origin` | Qualified by the stored root schema |
| `original.charge_on` | Qualified by the stored root schema |
| `original.eligibility_on` | Qualified by the stored root schema |
| `original.initial_period_through` | Qualified by the stored root schema |
| `original.entitlement_scope` | Qualified by the stored root schema |
| `original.part` | Qualified by the stored root schema |
| `original.weekly_index` | Qualified by the stored root schema |
| `original.event_order` | Qualified by the stored root schema |
| `original.spell_start` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `wage_net_selection` — Stored runtime expression declaration

Used by: undefined.

Bare names: `scheme`, `period`.

Open prefixes: `scheme.elections.<key>`.

| Member | Meaning |
| --- | --- |
| `scheme.registration_status` | Qualified by the stored root schema |
| `scheme.contractual_wage.current_gross` | Qualified by the stored root schema |
| `scheme.contractual_wage.prior_paid_gross` | Qualified by the stored root schema |
| `scheme.contractual_wage.prior_paid_available` | Qualified by the stored root schema |
| `scheme.elections` | Qualified by the stored root schema |
| `period.start` | Qualified by the stored root schema |
| `period.end` | Qualified by the stored root schema |
| `period.pay_date` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `rest_break` — Stored runtime expression declaration

Used by: `rule_sets(WORK).rules.data.breaks[]` — one day’s rest-break obligation.

Bare names: `day`, `record`, `history`, `employee`, `worksite`, `employment`, `terms`, `children`, `company`, `wage_floor`, `wage_floor_pay`, `period`, `facts`, `event`, `consecutive_hours`, `worked_hours`, `overtime_hours`, `continuous_attendance`, `night_hours`.

Open prefixes: `day.facts.<key>`, `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_flag_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `employee.facts.<key>`, `worksite.facts.<key>`, `terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `record.observed_at` | Qualified by the stored root schema |
| `record.assessed_on` | Qualified by the stored root schema |
| `record.from` | Qualified by the stored root schema |
| `record.to` | Qualified by the stored root schema |
| `record.facts` | Qualified by the stored root schema |
| `record.minimum_wage` | Qualified by the stored root schema |
| `history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `employee.gender` | Qualified by the stored root schema |
| `employee.age` | Qualified by the stored root schema |
| `employee.age_months` | Qualified by the stored root schema |
| `employee.birth_date` | Qualified by the stored root schema |
| `employee.birthday` | Qualified by the stored root schema |
| `employee.age_months_on` | Qualified by the stored root schema |
| `employee.age_on` | Qualified by the stored root schema |
| `employee.citizenship` | Qualified by the stored root schema |
| `employee.facts` | Qualified by the stored root schema |
| `employee.fact_keys` | Qualified by the stored root schema |
| `worksite.code` | Qualified by the stored root schema |
| `worksite.region` | Qualified by the stored root schema |
| `worksite.facts` | Qualified by the stored root schema |
| `employee.marital_status` | Qualified by the stored root schema |
| `employee.spouse_status` | Qualified by the stored root schema |
| `employee.dependents_count` | Qualified by the stored root schema |
| `employee.solo_parent` | Qualified by the stored root schema |
| `employee.receiving_pension` | Qualified by the stored root schema |
| `employee.disabled` | Qualified by the stored root schema |
| `employee.race` | Qualified by the stored root schema |
| `employee.religion` | Qualified by the stored root schema |
| `employee.residency_months` | Qualified by the stored root schema |
| `employee.presence_recorded` | Qualified by the stored root schema |
| `employee.presence_days` | Qualified by the stored root schema |
| `employee.presence_linked_days` | Qualified by the stored root schema |
| `employee.presence_days_in` | Qualified by the stored root schema |
| `employee.employment_days` | Qualified by the stored root schema |
| `employment.type` | Qualified by the stored root schema |
| `employment.classification` | Qualified by the stored root schema |
| `employment.risk_class` | Qualified by the stored root schema |
| `employment.service_days` | Qualified by the stored root schema |
| `employment.service_days_before` | Qualified by the stored root schema |
| `employment.service_months` | Qualified by the stored root schema |
| `employment.service_months_exact` | Qualified by the stored root schema |
| `employment.service_years` | Qualified by the stored root schema |
| `employment.service_years_on` | Qualified by the stored root schema |
| `employment.notice_days_remaining` | Qualified by the stored root schema |
| `employment.notice_monthly_wages` | Qualified by the stored root schema |
| `employment.payday_notice_days` | Qualified by the stored root schema |
| `employment.service_start` | Qualified by the stored root schema |
| `employment.rule_date` | Qualified by the stored root schema |
| `employment.rule_end` | Qualified by the stored root schema |
| `employment.exit_date` | Qualified by the stored root schema |
| `employment.signed_contract_end` | Qualified by the stored root schema |
| `employment.days_to_exit` | Qualified by the stored root schema |
| `employment.open_ended` | Qualified by the stored root schema |
| `employment.contract_months` | Qualified by the stored root schema |
| `employment.contract_days` | Qualified by the stored root schema |
| `employment.exit_ground` | Qualified by the stored root schema |
| `employment.exit_facts` | Qualified by the stored root schema |
| `employment.exit_fact_keys` | Qualified by the stored root schema |
| `employment.absent_days_12m` | Qualified by the stored root schema |
| `employment.service_periods` | Qualified by the stored root schema |
| `employment.service_scope` | Qualified by the stored root schema |
| `employment.aggregate_service_scope` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.prior_service_months` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.contract_workdays` | Qualified by the stored root schema |
| `employment.exact_received_components` | Qualified by the stored root schema |
| `employment.exact_rate_wages` | Qualified by the stored root schema |
| `employment.comparable_rate_wages` | Qualified by the stored root schema |
| `employment.exact_service_wages` | Qualified by the stored root schema |
| `employment.exact_wages` | Qualified by the stored root schema |
| `employment.exact_wage_window` | Qualified by the stored root schema |
| `employment.average_daily_wage` | Qualified by the stored root schema |
| `employment.average_monthly_wage` | Qualified by the stored root schema |
| `employment.on_leave` | Qualified by the stored root schema |
| `employment.service_excluding_leave` | Qualified by the stored root schema |
| `employment.service_months_net` | Qualified by the stored root schema |
| `terms.basic_salary` | Qualified by the stored root schema |
| `terms.monthly_basic` | Qualified by the stored root schema |
| `terms.ordinary_day` | Qualified by the stored root schema |
| `terms.fixed_allowances` | Qualified by the stored root schema |
| `terms.monthly_wage` | Qualified by the stored root schema |
| `terms.gross_monthly` | Qualified by the stored root schema |
| `terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `terms.statutory_wages` | Qualified by the stored root schema |
| `terms.statutory_work_category` | Qualified by the stored root schema |
| `terms.weather_dependent_piece` | Qualified by the stored root schema |
| `terms.worksite` | Qualified by the stored root schema |
| `terms.worksite_sector` | Qualified by the stored root schema |
| `terms.department` | Qualified by the stored root schema |
| `terms.payroll_group` | Qualified by the stored root schema |
| `terms.paid_rest_days` | Qualified by the stored root schema |
| `terms.grade` | Qualified by the stored root schema |
| `terms.pay_frequency` | Qualified by the stored root schema |
| `terms.pass_type` | Qualified by the stored root schema |
| `terms.tax_residency` | Qualified by the stored root schema |
| `terms.residency_since` | Qualified by the stored root schema |
| `terms.notice_days` | Qualified by the stored root schema |
| `terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `terms.contract_week_work_days` | Qualified by the stored root schema |
| `terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `terms.working_days_per_week` | Qualified by the stored root schema |
| `terms.facts` | Qualified by the stored root schema |
| `terms.fact_keys` | Qualified by the stored root schema |
| `children.count` | Qualified by the stored root schema |
| `children.birthdates` | Qualified by the stored root schema |
| `children.under` | Qualified by the stored root schema |
| `children.born_on` | Qualified by the stored root schema |
| `children.multiple_born_on` | Qualified by the stored root schema |
| `children.natural_surviving_on` | Qualified by the stored root schema |
| `children.natural_surviving_before` | Qualified by the stored root schema |
| `children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `children.citizens` | Qualified by the stored root schema |
| `children.births` | Qualified by the stored root schema |
| `children.citizens_under` | Qualified by the stored root schema |
| `children.prior_childcare_days` | Qualified by the stored root schema |
| `children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `children.prior_infant_care_days` | Qualified by the stored root schema |
| `children.classed` | Qualified by the stored root schema |
| `children.unclassed_under` | Qualified by the stored root schema |
| `company.region` | Qualified by the stored root schema |
| `company.headcount` | Qualified by the stored root schema |
| `company.headcount_citizens` | Qualified by the stored root schema |
| `company.pay_frequency` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `wage_floor` | Qualified by the stored root schema |
| `wage_floor_pay.BASE` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `event.kind` | Qualified by the stored root schema |
| `event.relationship` | Qualified by the stored root schema |
| `event.child_index` | Qualified by the stored root schema |
| `event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `event.delivery_children_count` | Qualified by the stored root schema |
| `event.date` | Qualified by the stored root schema |
| `event.facts` | Qualified by the stored root schema |
| `event.case.facts` | Qualified by the stored root schema |
| `event.child_citizenship` | Qualified by the stored root schema |
| `event.child_age` | Qualified by the stored root schema |
| `event.child_shared_weeks` | Qualified by the stored root schema |
| `event.prior_employment_days` | Qualified by the stored root schema |
| `event.estimated_delivery_date` | Qualified by the stored root schema |
| `event.adoption_eligibility_date` | Qualified by the stored root schema |
| `period.unpaid_full_days` | Qualified by the stored root schema |
| `period.leave_flag_days` | Qualified by the stored root schema |
| `period.leave_days` | Qualified by the stored root schema |
| `period.leave_full_days` | Qualified by the stored root schema |
| `period.leave_pay` | Qualified by the stored root schema |
| `period.working_days` | Qualified by the stored root schema |
| `period.unpaid_days` | Qualified by the stored root schema |
| `period.overtime_days` | Qualified by the stored root schema |
| `period.arrears` | Qualified by the stored root schema |
| `consecutive_hours` | Qualified by the stored root schema |
| `worked_hours` | Qualified by the stored root schema |
| `overtime_hours` | Qualified by the stored root schema |
| `continuous_attendance` | Qualified by the stored root schema |
| `day.date` | Qualified by the stored root schema |
| `day.facts` | Qualified by the stored root schema |
| `night_hours` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `payment` — Stored runtime expression declaration

Used by: `jurisdiction_settings.payment_facts[]` and `settlement_facts[]` conditions — one actual payment.

Bare names: `payment`, `settlement`.

Open prefixes: `payment.facts.<key>`, `settlement.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `payment.kind` | Qualified by the stored root schema |
| `payment.paid_on` | Qualified by the stored root schema |
| `payment.currency` | Qualified by the stored root schema |
| `payment.reference` | Qualified by the stored root schema |
| `payment.gross_amount` | Qualified by the stored root schema |
| `payment.facts` | Qualified by the stored root schema |
| `payment.fact_keys` | Qualified by the stored root schema |
| `settlement.tax_residency` | Qualified by the stored root schema |
| `settlement.facts` | Qualified by the stored root schema |
| `settlement.fact_keys` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `royalty` — Stored runtime expression declaration

Used by: undefined.

Bare names: `base`, `period`, `person`, `scheme`, `royalty`.

Open prefixes: `scheme.elections.<key>`.

| Member | Meaning |
| --- | --- |
| `base` | Qualified by the stored root schema |
| `period.pay_date` | Qualified by the stored root schema |
| `person.tax_residency` | Qualified by the stored root schema |
| `scheme.elections` | Qualified by the stored root schema |
| `royalty.tax_object_reference` | Qualified by the stored root schema |
| `royalty.rights_object_reference` | Qualified by the stored root schema |
| `royalty.object_use_reference` | Qualified by the stored root schema |
| `royalty.original_event_on` | Qualified by the stored root schema |
| `royalty.original_payment_reference` | Qualified by the stored root schema |
| `royalty.first_payment` | Qualified by the stored root schema |
| `royalty.first_payment_on` | Qualified by the stored root schema |
| `royalty.object_gross_before` | Qualified by the stored root schema |
| `royalty.object_gross_current` | Qualified by the stored root schema |
| `royalty.object_gross_after` | Qualified by the stored root schema |
| `royalty.object_withheld_before` | Qualified by the stored root schema |
| `royalty.recipient_withheld_before` | Qualified by the stored root schema |
| `royalty.tax_ownership_class` | Qualified by the stored root schema |
| `royalty.tax_owner_fraction` | Qualified by the stored root schema |
| `royalty.certified_total_contract_gross` | Qualified by the stored root schema |
| `royalty.cross_effective_disposition` | Qualified by the stored root schema |
| `royalty.certified_taxable_income_current` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `rate` — Stored runtime expression declaration

Used by: `rule_sets(WORK).rules.data.ordinary_rate`, `leave_pay_reference`, `encashment_reference` and `proration` — one person’s rates.

Bare names: `record`, `history`, `employee`, `worksite`, `employment`, `terms`, `children`, `company`, `wage_floor`, `wage_floor_pay`, `period`, `facts`, `event`, `contract`, `rate`.

Open prefixes: `event.facts.<key>`, `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_flag_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `employee.facts.<key>`, `worksite.facts.<key>`, `terms.facts.<key>`, `contract.classes.<key>`.

| Member | Meaning |
| --- | --- |
| `record.observed_at` | Qualified by the stored root schema |
| `record.assessed_on` | Qualified by the stored root schema |
| `record.from` | Qualified by the stored root schema |
| `record.to` | Qualified by the stored root schema |
| `record.facts` | Qualified by the stored root schema |
| `record.minimum_wage` | Qualified by the stored root schema |
| `history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `employee.gender` | Qualified by the stored root schema |
| `employee.age` | Qualified by the stored root schema |
| `employee.age_months` | Qualified by the stored root schema |
| `employee.birth_date` | Qualified by the stored root schema |
| `employee.birthday` | Qualified by the stored root schema |
| `employee.age_months_on` | Qualified by the stored root schema |
| `employee.age_on` | Qualified by the stored root schema |
| `employee.citizenship` | Qualified by the stored root schema |
| `employee.facts` | Qualified by the stored root schema |
| `employee.fact_keys` | Qualified by the stored root schema |
| `worksite.code` | Qualified by the stored root schema |
| `worksite.region` | Qualified by the stored root schema |
| `worksite.facts` | Qualified by the stored root schema |
| `employee.marital_status` | Qualified by the stored root schema |
| `employee.spouse_status` | Qualified by the stored root schema |
| `employee.dependents_count` | Qualified by the stored root schema |
| `employee.solo_parent` | Qualified by the stored root schema |
| `employee.receiving_pension` | Qualified by the stored root schema |
| `employee.disabled` | Qualified by the stored root schema |
| `employee.race` | Qualified by the stored root schema |
| `employee.religion` | Qualified by the stored root schema |
| `employee.residency_months` | Qualified by the stored root schema |
| `employee.presence_recorded` | Qualified by the stored root schema |
| `employee.presence_days` | Qualified by the stored root schema |
| `employee.presence_linked_days` | Qualified by the stored root schema |
| `employee.presence_days_in` | Qualified by the stored root schema |
| `employee.employment_days` | Qualified by the stored root schema |
| `employment.type` | Qualified by the stored root schema |
| `employment.classification` | Qualified by the stored root schema |
| `employment.risk_class` | Qualified by the stored root schema |
| `employment.service_days` | Qualified by the stored root schema |
| `employment.service_days_before` | Qualified by the stored root schema |
| `employment.service_months` | Qualified by the stored root schema |
| `employment.service_months_exact` | Qualified by the stored root schema |
| `employment.service_years` | Qualified by the stored root schema |
| `employment.service_years_on` | Qualified by the stored root schema |
| `employment.notice_days_remaining` | Qualified by the stored root schema |
| `employment.notice_monthly_wages` | Qualified by the stored root schema |
| `employment.payday_notice_days` | Qualified by the stored root schema |
| `employment.service_start` | Qualified by the stored root schema |
| `employment.rule_date` | Qualified by the stored root schema |
| `employment.rule_end` | Qualified by the stored root schema |
| `employment.exit_date` | Qualified by the stored root schema |
| `employment.signed_contract_end` | Qualified by the stored root schema |
| `employment.days_to_exit` | Qualified by the stored root schema |
| `employment.open_ended` | Qualified by the stored root schema |
| `employment.contract_months` | Qualified by the stored root schema |
| `employment.contract_days` | Qualified by the stored root schema |
| `employment.exit_ground` | Qualified by the stored root schema |
| `employment.exit_facts` | Qualified by the stored root schema |
| `employment.exit_fact_keys` | Qualified by the stored root schema |
| `employment.absent_days_12m` | Qualified by the stored root schema |
| `employment.service_periods` | Qualified by the stored root schema |
| `employment.service_scope` | Qualified by the stored root schema |
| `employment.aggregate_service_scope` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.prior_service_months` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.contract_workdays` | Qualified by the stored root schema |
| `employment.exact_received_components` | Qualified by the stored root schema |
| `employment.exact_rate_wages` | Qualified by the stored root schema |
| `employment.comparable_rate_wages` | Qualified by the stored root schema |
| `employment.exact_service_wages` | Qualified by the stored root schema |
| `employment.exact_wages` | Qualified by the stored root schema |
| `employment.exact_wage_window` | Qualified by the stored root schema |
| `employment.average_daily_wage` | Qualified by the stored root schema |
| `employment.average_monthly_wage` | Qualified by the stored root schema |
| `employment.on_leave` | Qualified by the stored root schema |
| `employment.service_excluding_leave` | Qualified by the stored root schema |
| `employment.service_months_net` | Qualified by the stored root schema |
| `terms.basic_salary` | Qualified by the stored root schema |
| `terms.monthly_basic` | Qualified by the stored root schema |
| `terms.ordinary_day` | Qualified by the stored root schema |
| `terms.fixed_allowances` | Qualified by the stored root schema |
| `terms.monthly_wage` | Qualified by the stored root schema |
| `terms.gross_monthly` | Qualified by the stored root schema |
| `terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `terms.statutory_wages` | Qualified by the stored root schema |
| `terms.statutory_work_category` | Qualified by the stored root schema |
| `terms.weather_dependent_piece` | Qualified by the stored root schema |
| `terms.worksite` | Qualified by the stored root schema |
| `terms.worksite_sector` | Qualified by the stored root schema |
| `terms.department` | Qualified by the stored root schema |
| `terms.payroll_group` | Qualified by the stored root schema |
| `terms.paid_rest_days` | Qualified by the stored root schema |
| `terms.grade` | Qualified by the stored root schema |
| `terms.pay_frequency` | Qualified by the stored root schema |
| `terms.pass_type` | Qualified by the stored root schema |
| `terms.tax_residency` | Qualified by the stored root schema |
| `terms.residency_since` | Qualified by the stored root schema |
| `terms.notice_days` | Qualified by the stored root schema |
| `terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `terms.contract_week_work_days` | Qualified by the stored root schema |
| `terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `terms.working_days_per_week` | Qualified by the stored root schema |
| `terms.facts` | Qualified by the stored root schema |
| `terms.fact_keys` | Qualified by the stored root schema |
| `children.count` | Qualified by the stored root schema |
| `children.birthdates` | Qualified by the stored root schema |
| `children.under` | Qualified by the stored root schema |
| `children.born_on` | Qualified by the stored root schema |
| `children.multiple_born_on` | Qualified by the stored root schema |
| `children.natural_surviving_on` | Qualified by the stored root schema |
| `children.natural_surviving_before` | Qualified by the stored root schema |
| `children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `children.citizens` | Qualified by the stored root schema |
| `children.births` | Qualified by the stored root schema |
| `children.citizens_under` | Qualified by the stored root schema |
| `children.prior_childcare_days` | Qualified by the stored root schema |
| `children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `children.prior_infant_care_days` | Qualified by the stored root schema |
| `children.classed` | Qualified by the stored root schema |
| `children.unclassed_under` | Qualified by the stored root schema |
| `company.region` | Qualified by the stored root schema |
| `company.headcount` | Qualified by the stored root schema |
| `company.headcount_citizens` | Qualified by the stored root schema |
| `company.pay_frequency` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `wage_floor` | Qualified by the stored root schema |
| `wage_floor_pay.BASE` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `event.kind` | Qualified by the stored root schema |
| `event.relationship` | Qualified by the stored root schema |
| `event.child_index` | Qualified by the stored root schema |
| `event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `event.delivery_children_count` | Qualified by the stored root schema |
| `event.date` | Qualified by the stored root schema |
| `event.facts` | Qualified by the stored root schema |
| `event.case.facts` | Qualified by the stored root schema |
| `event.child_citizenship` | Qualified by the stored root schema |
| `event.child_age` | Qualified by the stored root schema |
| `event.child_shared_weeks` | Qualified by the stored root schema |
| `event.prior_employment_days` | Qualified by the stored root schema |
| `event.estimated_delivery_date` | Qualified by the stored root schema |
| `event.adoption_eligibility_date` | Qualified by the stored root schema |
| `period.unpaid_full_days` | Qualified by the stored root schema |
| `period.leave_flag_days` | Qualified by the stored root schema |
| `period.leave_days` | Qualified by the stored root schema |
| `period.leave_full_days` | Qualified by the stored root schema |
| `period.leave_pay` | Qualified by the stored root schema |
| `period.working_days` | Qualified by the stored root schema |
| `period.unpaid_days` | Qualified by the stored root schema |
| `period.overtime_days` | Qualified by the stored root schema |
| `period.arrears` | Qualified by the stored root schema |
| `contract.classes` | Qualified by the stored root schema |
| `rate.date` | Qualified by the stored root schema |
| `rate.boundary` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `obligation` — Stored runtime expression declaration

Used by: `rule_sets(OBLIGATIONS).rules.data[].due`, `amount`, `late_charge` and `trigger.when` — one duty instance.

Bare names: `employee`, `trigger`, `period`, `recipient`, `company`, `employment`, `worksite`, `run`, `case`, `event`, `obligation`.

Open prefixes: `company.facts.<key>`, `employment.exit_facts.<key>`, `employment.terms_facts.<key>`, `worksite.facts.<key>`, `run.remittances.<key>`, `run.withheld.<key>`, `case.facts.<key>`, `event.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `employee.id` | Qualified by the stored root schema |
| `employee.date_of_birth` | Qualified by the stored root schema |
| `trigger.on` | Qualified by the stored root schema |
| `trigger.date` | Qualified by the stored root schema |
| `trigger.ref` | Qualified by the stored root schema |
| `period.start` | Qualified by the stored root schema |
| `period.end` | Qualified by the stored root schema |
| `recipient.id` | Qualified by the stored root schema |
| `recipient.date_of_birth` | Qualified by the stored root schema |
| `recipient.sex` | Qualified by the stored root schema |
| `recipient.engagement_from` | Qualified by the stored root schema |
| `recipient.engagement_to` | Qualified by the stored root schema |
| `company.settings_code` | Qualified by the stored root schema |
| `company.region` | Qualified by the stored root schema |
| `company.pay_frequency` | Qualified by the stored root schema |
| `company.fact_evidence_keys` | Qualified by the stored root schema |
| `company.headcount` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `employment.terms_id` | Qualified by the stored root schema |
| `employment.terms_facts` | Qualified by the stored root schema |
| `employment.terms_evidence_keys` | Qualified by the stored root schema |
| `employment.service_start` | Qualified by the stored root schema |
| `employment.exit_date` | Qualified by the stored root schema |
| `employment.exit_ground` | Qualified by the stored root schema |
| `employment.exit_facts` | Qualified by the stored root schema |
| `worksite.code` | Qualified by the stored root schema |
| `worksite.region` | Qualified by the stored root schema |
| `worksite.facts` | Qualified by the stored root schema |
| `run.period` | Qualified by the stored root schema |
| `run.pay_date` | Qualified by the stored root schema |
| `run.headcount` | Qualified by the stored root schema |
| `run.gross` | Qualified by the stored root schema |
| `run.net` | Qualified by the stored root schema |
| `run.employer_cost` | Qualified by the stored root schema |
| `run.kind` | Qualified by the stored root schema |
| `run.sequence` | Qualified by the stored root schema |
| `run.pay_due_date` | Qualified by the stored root schema |
| `run.withheld` | Qualified by the stored root schema |
| `run.remittances` | Qualified by the stored root schema |
| `case.type` | Qualified by the stored root schema |
| `case.facts` | Qualified by the stored root schema |
| `event.facts` | Qualified by the stored root schema |
| `obligation.due_on` | Qualified by the stored root schema |
| `obligation.amount_due` | Qualified by the stored root schema |
| `obligation.days_late_excluding_payment_day` | Qualified by the stored root schema |
| `obligation.days_late` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `obligation_completion` — Stored runtime expression declaration

Used by: undefined.

Bare names: `recipient`, `event`, `obligation`.

Open prefixes: `event.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `event.facts` | Qualified by the stored root schema |
| `recipient.id` | Qualified by the stored root schema |
| `recipient.date_of_birth` | Qualified by the stored root schema |
| `recipient.sex` | Qualified by the stored root schema |
| `recipient.engagement_from` | Qualified by the stored root schema |
| `recipient.engagement_to` | Qualified by the stored root schema |
| `obligation.code` | Qualified by the stored root schema |
| `obligation.due_on` | Qualified by the stored root schema |
| `obligation.amount_due` | Qualified by the stored root schema |
| `obligation.fulfilled_on` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `filing` — Stored runtime expression declaration

Used by: `returns[].columns[].value` and `population` — one row of a return or bank file.

Bare names: `filing`, `payee`, `payer`, `row`, `company`, `person`, `bank`, `totals`, `slips`.

Open prefixes: `company.facts.<key>`, `totals.lines.<key>`, `totals.classes.<key>`, `totals.base.<key>`, `totals.employee.<key>`, `totals.employer.<key>`, `person.event.facts.<key>`, `person.company.facts.<key>`, `person.facts.<key>`, `person.period.leave_full_days.<key>`, `person.period.leave_days.<key>`, `person.period.leave_flag_days.<key>`, `person.period.leave_pay.<key>`, `person.employment.exit_facts.<key>`, `person.employee.facts.<key>`, `person.worksite.facts.<key>`, `person.terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `filing.code` | Qualified by the stored root schema |
| `filing.period` | Qualified by the stored root schema |
| `filing.year` | Qualified by the stored root schema |
| `filing.pay_date` | Qualified by the stored root schema |
| `filing.rows` | Qualified by the stored root schema |
| `payee.employee_id` | Qualified by the stored root schema |
| `payee.employment_id` | Qualified by the stored root schema |
| `payee.employee_number` | Qualified by the stored root schema |
| `payee.name` | Qualified by the stored root schema |
| `payee.identity_number` | Qualified by the stored root schema |
| `payee.identity_type` | Qualified by the stored root schema |
| `payee.nationality` | Qualified by the stored root schema |
| `payee.designation` | Qualified by the stored root schema |
| `payee.department` | Qualified by the stored root schema |
| `payee.gender` | Qualified by the stored root schema |
| `payee.birth_date` | Qualified by the stored root schema |
| `payee.hire_date` | Qualified by the stored root schema |
| `payee.last_day` | Qualified by the stored root schema |
| `payee.departure_on` | Qualified by the stored root schema |
| `payer.code` | Qualified by the stored root schema |
| `payer.account` | Qualified by the stored root schema |
| `payer.holder` | Qualified by the stored root schema |
| `payer.bank_name` | Qualified by the stored root schema |
| `row.index` | Qualified by the stored root schema |
| `company.settings_code` | Qualified by the stored root schema |
| `company.name` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `person.record.observed_at` | Qualified by the stored root schema |
| `person.record.assessed_on` | Qualified by the stored root schema |
| `person.record.from` | Qualified by the stored root schema |
| `person.record.to` | Qualified by the stored root schema |
| `person.record.facts` | Qualified by the stored root schema |
| `person.record.minimum_wage` | Qualified by the stored root schema |
| `person.history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `person.employee.gender` | Qualified by the stored root schema |
| `person.employee.age` | Qualified by the stored root schema |
| `person.employee.age_months` | Qualified by the stored root schema |
| `person.employee.birth_date` | Qualified by the stored root schema |
| `person.employee.birthday` | Qualified by the stored root schema |
| `person.employee.age_months_on` | Qualified by the stored root schema |
| `person.employee.age_on` | Qualified by the stored root schema |
| `person.employee.citizenship` | Qualified by the stored root schema |
| `person.employee.facts` | Qualified by the stored root schema |
| `person.employee.fact_keys` | Qualified by the stored root schema |
| `person.worksite.code` | Qualified by the stored root schema |
| `person.worksite.region` | Qualified by the stored root schema |
| `person.worksite.facts` | Qualified by the stored root schema |
| `person.employee.marital_status` | Qualified by the stored root schema |
| `person.employee.spouse_status` | Qualified by the stored root schema |
| `person.employee.dependents_count` | Qualified by the stored root schema |
| `person.employee.solo_parent` | Qualified by the stored root schema |
| `person.employee.receiving_pension` | Qualified by the stored root schema |
| `person.employee.disabled` | Qualified by the stored root schema |
| `person.employee.race` | Qualified by the stored root schema |
| `person.employee.religion` | Qualified by the stored root schema |
| `person.employee.residency_months` | Qualified by the stored root schema |
| `person.employee.presence_recorded` | Qualified by the stored root schema |
| `person.employee.presence_days` | Qualified by the stored root schema |
| `person.employee.presence_linked_days` | Qualified by the stored root schema |
| `person.employee.presence_days_in` | Qualified by the stored root schema |
| `person.employee.employment_days` | Qualified by the stored root schema |
| `person.employment.type` | Qualified by the stored root schema |
| `person.employment.classification` | Qualified by the stored root schema |
| `person.employment.risk_class` | Qualified by the stored root schema |
| `person.employment.service_days` | Qualified by the stored root schema |
| `person.employment.service_days_before` | Qualified by the stored root schema |
| `person.employment.service_months` | Qualified by the stored root schema |
| `person.employment.service_months_exact` | Qualified by the stored root schema |
| `person.employment.service_years` | Qualified by the stored root schema |
| `person.employment.service_years_on` | Qualified by the stored root schema |
| `person.employment.notice_days_remaining` | Qualified by the stored root schema |
| `person.employment.notice_monthly_wages` | Qualified by the stored root schema |
| `person.employment.payday_notice_days` | Qualified by the stored root schema |
| `person.employment.service_start` | Qualified by the stored root schema |
| `person.employment.rule_date` | Qualified by the stored root schema |
| `person.employment.rule_end` | Qualified by the stored root schema |
| `person.employment.exit_date` | Qualified by the stored root schema |
| `person.employment.signed_contract_end` | Qualified by the stored root schema |
| `person.employment.days_to_exit` | Qualified by the stored root schema |
| `person.employment.open_ended` | Qualified by the stored root schema |
| `person.employment.contract_months` | Qualified by the stored root schema |
| `person.employment.contract_days` | Qualified by the stored root schema |
| `person.employment.exit_ground` | Qualified by the stored root schema |
| `person.employment.exit_facts` | Qualified by the stored root schema |
| `person.employment.exit_fact_keys` | Qualified by the stored root schema |
| `person.employment.absent_days_12m` | Qualified by the stored root schema |
| `person.employment.service_periods` | Qualified by the stored root schema |
| `person.employment.service_scope` | Qualified by the stored root schema |
| `person.employment.aggregate_service_scope` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.prior_service_months` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.contract_workdays` | Qualified by the stored root schema |
| `person.employment.exact_received_components` | Qualified by the stored root schema |
| `person.employment.exact_rate_wages` | Qualified by the stored root schema |
| `person.employment.comparable_rate_wages` | Qualified by the stored root schema |
| `person.employment.exact_service_wages` | Qualified by the stored root schema |
| `person.employment.exact_wages` | Qualified by the stored root schema |
| `person.employment.exact_wage_window` | Qualified by the stored root schema |
| `person.employment.average_daily_wage` | Qualified by the stored root schema |
| `person.employment.average_monthly_wage` | Qualified by the stored root schema |
| `person.employment.on_leave` | Qualified by the stored root schema |
| `person.employment.service_excluding_leave` | Qualified by the stored root schema |
| `person.employment.service_months_net` | Qualified by the stored root schema |
| `person.terms.basic_salary` | Qualified by the stored root schema |
| `person.terms.monthly_basic` | Qualified by the stored root schema |
| `person.terms.ordinary_day` | Qualified by the stored root schema |
| `person.terms.fixed_allowances` | Qualified by the stored root schema |
| `person.terms.monthly_wage` | Qualified by the stored root schema |
| `person.terms.gross_monthly` | Qualified by the stored root schema |
| `person.terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `person.terms.statutory_wages` | Qualified by the stored root schema |
| `person.terms.statutory_work_category` | Qualified by the stored root schema |
| `person.terms.weather_dependent_piece` | Qualified by the stored root schema |
| `person.terms.worksite` | Qualified by the stored root schema |
| `person.terms.worksite_sector` | Qualified by the stored root schema |
| `person.terms.department` | Qualified by the stored root schema |
| `person.terms.payroll_group` | Qualified by the stored root schema |
| `person.terms.paid_rest_days` | Qualified by the stored root schema |
| `person.terms.grade` | Qualified by the stored root schema |
| `person.terms.pay_frequency` | Qualified by the stored root schema |
| `person.terms.pass_type` | Qualified by the stored root schema |
| `person.terms.tax_residency` | Qualified by the stored root schema |
| `person.terms.residency_since` | Qualified by the stored root schema |
| `person.terms.notice_days` | Qualified by the stored root schema |
| `person.terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `person.terms.contract_week_work_days` | Qualified by the stored root schema |
| `person.terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `person.terms.working_days_per_week` | Qualified by the stored root schema |
| `person.terms.facts` | Qualified by the stored root schema |
| `person.terms.fact_keys` | Qualified by the stored root schema |
| `person.children.count` | Qualified by the stored root schema |
| `person.children.birthdates` | Qualified by the stored root schema |
| `person.children.under` | Qualified by the stored root schema |
| `person.children.born_on` | Qualified by the stored root schema |
| `person.children.multiple_born_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_before` | Qualified by the stored root schema |
| `person.children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `person.children.citizens` | Qualified by the stored root schema |
| `person.children.births` | Qualified by the stored root schema |
| `person.children.citizens_under` | Qualified by the stored root schema |
| `person.children.prior_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_infant_care_days` | Qualified by the stored root schema |
| `person.children.classed` | Qualified by the stored root schema |
| `person.children.unclassed_under` | Qualified by the stored root schema |
| `person.company.region` | Qualified by the stored root schema |
| `person.company.headcount` | Qualified by the stored root schema |
| `person.company.headcount_citizens` | Qualified by the stored root schema |
| `person.company.pay_frequency` | Qualified by the stored root schema |
| `person.company.facts` | Qualified by the stored root schema |
| `person.wage_floor` | Qualified by the stored root schema |
| `person.wage_floor_pay.BASE` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `person.wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `person.wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.event.kind` | Qualified by the stored root schema |
| `person.event.relationship` | Qualified by the stored root schema |
| `person.event.child_index` | Qualified by the stored root schema |
| `person.event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `person.event.delivery_children_count` | Qualified by the stored root schema |
| `person.event.date` | Qualified by the stored root schema |
| `person.event.facts` | Qualified by the stored root schema |
| `person.event.case.facts` | Qualified by the stored root schema |
| `person.event.child_citizenship` | Qualified by the stored root schema |
| `person.event.child_age` | Qualified by the stored root schema |
| `person.event.child_shared_weeks` | Qualified by the stored root schema |
| `person.event.prior_employment_days` | Qualified by the stored root schema |
| `person.event.estimated_delivery_date` | Qualified by the stored root schema |
| `person.event.adoption_eligibility_date` | Qualified by the stored root schema |
| `person.period.unpaid_full_days` | Qualified by the stored root schema |
| `person.period.leave_flag_days` | Qualified by the stored root schema |
| `person.period.leave_days` | Qualified by the stored root schema |
| `person.period.leave_full_days` | Qualified by the stored root schema |
| `person.period.leave_pay` | Qualified by the stored root schema |
| `person.period.working_days` | Qualified by the stored root schema |
| `person.period.unpaid_days` | Qualified by the stored root schema |
| `person.period.overtime_days` | Qualified by the stored root schema |
| `person.period.arrears` | Qualified by the stored root schema |
| `bank.code` | Qualified by the stored root schema |
| `bank.account` | Qualified by the stored root schema |
| `bank.holder` | Qualified by the stored root schema |
| `totals.gross` | Qualified by the stored root schema |
| `totals.net` | Qualified by the stored root schema |
| `totals.lines` | Qualified by the stored root schema |
| `totals.classes` | Qualified by the stored root schema |
| `totals.base` | Qualified by the stored root schema |
| `totals.employee` | Qualified by the stored root schema |
| `totals.employer` | Qualified by the stored root schema |
| `totals.slips` | Qualified by the stored root schema |
| `slips` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `case` — Stored runtime expression declaration

Used by: `case_types[].phases[].days`, `award` and `qualifications` — one benefit case phase.

Bare names: `person`, `case`, `phase`, `credits`, `earnings`, `previous`.

Open prefixes: `case.facts.<key>`, `person.event.facts.<key>`, `person.company.facts.<key>`, `person.facts.<key>`, `person.period.leave_full_days.<key>`, `person.period.leave_days.<key>`, `person.period.leave_flag_days.<key>`, `person.period.leave_pay.<key>`, `person.employment.exit_facts.<key>`, `person.employee.facts.<key>`, `person.worksite.facts.<key>`, `person.terms.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `person.record.observed_at` | Qualified by the stored root schema |
| `person.record.assessed_on` | Qualified by the stored root schema |
| `person.record.from` | Qualified by the stored root schema |
| `person.record.to` | Qualified by the stored root schema |
| `person.record.facts` | Qualified by the stored root schema |
| `person.record.minimum_wage` | Qualified by the stored root schema |
| `person.history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `person.employee.gender` | Qualified by the stored root schema |
| `person.employee.age` | Qualified by the stored root schema |
| `person.employee.age_months` | Qualified by the stored root schema |
| `person.employee.birth_date` | Qualified by the stored root schema |
| `person.employee.birthday` | Qualified by the stored root schema |
| `person.employee.age_months_on` | Qualified by the stored root schema |
| `person.employee.age_on` | Qualified by the stored root schema |
| `person.employee.citizenship` | Qualified by the stored root schema |
| `person.employee.facts` | Qualified by the stored root schema |
| `person.employee.fact_keys` | Qualified by the stored root schema |
| `person.worksite.code` | Qualified by the stored root schema |
| `person.worksite.region` | Qualified by the stored root schema |
| `person.worksite.facts` | Qualified by the stored root schema |
| `person.employee.marital_status` | Qualified by the stored root schema |
| `person.employee.spouse_status` | Qualified by the stored root schema |
| `person.employee.dependents_count` | Qualified by the stored root schema |
| `person.employee.solo_parent` | Qualified by the stored root schema |
| `person.employee.receiving_pension` | Qualified by the stored root schema |
| `person.employee.disabled` | Qualified by the stored root schema |
| `person.employee.race` | Qualified by the stored root schema |
| `person.employee.religion` | Qualified by the stored root schema |
| `person.employee.residency_months` | Qualified by the stored root schema |
| `person.employee.presence_recorded` | Qualified by the stored root schema |
| `person.employee.presence_days` | Qualified by the stored root schema |
| `person.employee.presence_linked_days` | Qualified by the stored root schema |
| `person.employee.presence_days_in` | Qualified by the stored root schema |
| `person.employee.employment_days` | Qualified by the stored root schema |
| `person.employment.type` | Qualified by the stored root schema |
| `person.employment.classification` | Qualified by the stored root schema |
| `person.employment.risk_class` | Qualified by the stored root schema |
| `person.employment.service_days` | Qualified by the stored root schema |
| `person.employment.service_days_before` | Qualified by the stored root schema |
| `person.employment.service_months` | Qualified by the stored root schema |
| `person.employment.service_months_exact` | Qualified by the stored root schema |
| `person.employment.service_years` | Qualified by the stored root schema |
| `person.employment.service_years_on` | Qualified by the stored root schema |
| `person.employment.notice_days_remaining` | Qualified by the stored root schema |
| `person.employment.notice_monthly_wages` | Qualified by the stored root schema |
| `person.employment.payday_notice_days` | Qualified by the stored root schema |
| `person.employment.service_start` | Qualified by the stored root schema |
| `person.employment.rule_date` | Qualified by the stored root schema |
| `person.employment.rule_end` | Qualified by the stored root schema |
| `person.employment.exit_date` | Qualified by the stored root schema |
| `person.employment.signed_contract_end` | Qualified by the stored root schema |
| `person.employment.days_to_exit` | Qualified by the stored root schema |
| `person.employment.open_ended` | Qualified by the stored root schema |
| `person.employment.contract_months` | Qualified by the stored root schema |
| `person.employment.contract_days` | Qualified by the stored root schema |
| `person.employment.exit_ground` | Qualified by the stored root schema |
| `person.employment.exit_facts` | Qualified by the stored root schema |
| `person.employment.exit_fact_keys` | Qualified by the stored root schema |
| `person.employment.absent_days_12m` | Qualified by the stored root schema |
| `person.employment.service_periods` | Qualified by the stored root schema |
| `person.employment.service_scope` | Qualified by the stored root schema |
| `person.employment.aggregate_service_scope` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.earned_monthly_average` | Qualified by the stored root schema |
| `person.employment.prior_service_months` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.exact_average` | Qualified by the stored root schema |
| `person.employment.contract_workdays` | Qualified by the stored root schema |
| `person.employment.exact_received_components` | Qualified by the stored root schema |
| `person.employment.exact_rate_wages` | Qualified by the stored root schema |
| `person.employment.comparable_rate_wages` | Qualified by the stored root schema |
| `person.employment.exact_service_wages` | Qualified by the stored root schema |
| `person.employment.exact_wages` | Qualified by the stored root schema |
| `person.employment.exact_wage_window` | Qualified by the stored root schema |
| `person.employment.average_daily_wage` | Qualified by the stored root schema |
| `person.employment.average_monthly_wage` | Qualified by the stored root schema |
| `person.employment.on_leave` | Qualified by the stored root schema |
| `person.employment.service_excluding_leave` | Qualified by the stored root schema |
| `person.employment.service_months_net` | Qualified by the stored root schema |
| `person.terms.basic_salary` | Qualified by the stored root schema |
| `person.terms.monthly_basic` | Qualified by the stored root schema |
| `person.terms.ordinary_day` | Qualified by the stored root schema |
| `person.terms.fixed_allowances` | Qualified by the stored root schema |
| `person.terms.monthly_wage` | Qualified by the stored root schema |
| `person.terms.gross_monthly` | Qualified by the stored root schema |
| `person.terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `person.terms.statutory_wages` | Qualified by the stored root schema |
| `person.terms.statutory_work_category` | Qualified by the stored root schema |
| `person.terms.weather_dependent_piece` | Qualified by the stored root schema |
| `person.terms.worksite` | Qualified by the stored root schema |
| `person.terms.worksite_sector` | Qualified by the stored root schema |
| `person.terms.department` | Qualified by the stored root schema |
| `person.terms.payroll_group` | Qualified by the stored root schema |
| `person.terms.paid_rest_days` | Qualified by the stored root schema |
| `person.terms.grade` | Qualified by the stored root schema |
| `person.terms.pay_frequency` | Qualified by the stored root schema |
| `person.terms.pass_type` | Qualified by the stored root schema |
| `person.terms.tax_residency` | Qualified by the stored root schema |
| `person.terms.residency_since` | Qualified by the stored root schema |
| `person.terms.notice_days` | Qualified by the stored root schema |
| `person.terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `person.terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `person.terms.contract_week_work_days` | Qualified by the stored root schema |
| `person.terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `person.terms.working_days_per_week` | Qualified by the stored root schema |
| `person.terms.facts` | Qualified by the stored root schema |
| `person.terms.fact_keys` | Qualified by the stored root schema |
| `person.children.count` | Qualified by the stored root schema |
| `person.children.birthdates` | Qualified by the stored root schema |
| `person.children.under` | Qualified by the stored root schema |
| `person.children.born_on` | Qualified by the stored root schema |
| `person.children.multiple_born_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_on` | Qualified by the stored root schema |
| `person.children.natural_surviving_before` | Qualified by the stored root schema |
| `person.children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `person.children.citizens` | Qualified by the stored root schema |
| `person.children.births` | Qualified by the stored root schema |
| `person.children.citizens_under` | Qualified by the stored root schema |
| `person.children.prior_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `person.children.prior_infant_care_days` | Qualified by the stored root schema |
| `person.children.classed` | Qualified by the stored root schema |
| `person.children.unclassed_under` | Qualified by the stored root schema |
| `person.company.region` | Qualified by the stored root schema |
| `person.company.headcount` | Qualified by the stored root schema |
| `person.company.headcount_citizens` | Qualified by the stored root schema |
| `person.company.pay_frequency` | Qualified by the stored root schema |
| `person.company.facts` | Qualified by the stored root schema |
| `person.wage_floor` | Qualified by the stored root schema |
| `person.wage_floor_pay.BASE` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `person.wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `person.wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `person.wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `person.wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.facts` | Qualified by the stored root schema |
| `person.event.kind` | Qualified by the stored root schema |
| `person.event.relationship` | Qualified by the stored root schema |
| `person.event.child_index` | Qualified by the stored root schema |
| `person.event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `person.event.delivery_children_count` | Qualified by the stored root schema |
| `person.event.date` | Qualified by the stored root schema |
| `person.event.facts` | Qualified by the stored root schema |
| `person.event.case.facts` | Qualified by the stored root schema |
| `person.event.child_citizenship` | Qualified by the stored root schema |
| `person.event.child_age` | Qualified by the stored root schema |
| `person.event.child_shared_weeks` | Qualified by the stored root schema |
| `person.event.prior_employment_days` | Qualified by the stored root schema |
| `person.event.estimated_delivery_date` | Qualified by the stored root schema |
| `person.event.adoption_eligibility_date` | Qualified by the stored root schema |
| `person.period.unpaid_full_days` | Qualified by the stored root schema |
| `person.period.leave_flag_days` | Qualified by the stored root schema |
| `person.period.leave_days` | Qualified by the stored root schema |
| `person.period.leave_full_days` | Qualified by the stored root schema |
| `person.period.leave_pay` | Qualified by the stored root schema |
| `person.period.working_days` | Qualified by the stored root schema |
| `person.period.unpaid_days` | Qualified by the stored root schema |
| `person.period.overtime_days` | Qualified by the stored root schema |
| `person.period.arrears` | Qualified by the stored root schema |
| `case.kind` | Qualified by the stored root schema |
| `case.event_on` | Qualified by the stored root schema |
| `case.started_on` | Qualified by the stored root schema |
| `case.ended_on` | Qualified by the stored root schema |
| `case.facts` | Qualified by the stored root schema |
| `case.event_kind` | Qualified by the stored root schema |
| `case.event_month` | Qualified by the stored root schema |
| `case.application_on` | Qualified by the stored root schema |
| `case.evidenced` | Qualified by the stored root schema |
| `case.award` | Qualified by the stored root schema |
| `case.salary` | Qualified by the stored root schema |
| `case.premiums` | Qualified by the stored root schema |
| `case.reference_daily` | Qualified by the stored root schema |
| `case.reference_monthly` | Qualified by the stored root schema |
| `case.reference_weekly_workdays` | Qualified by the stored root schema |
| `phase.code` | Qualified by the stored root schema |
| `phase.index` | Qualified by the stored root schema |
| `phase.start` | Qualified by the stored root schema |
| `phase.end` | Qualified by the stored root schema |
| `phase.days` | Qualified by the stored root schema |
| `phase.day_index` | Qualified by the stored root schema |
| `phase.award` | Qualified by the stored root schema |
| `phase.wage` | Qualified by the stored root schema |
| `phase.employer_pays` | Qualified by the stored root schema |
| `credits` | Qualified by the stored root schema |
| `earnings` | Qualified by the stored root schema |
| `previous` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `check` — Stored runtime expression declaration

Used by: `rule_sets.rules.entries[].when` — one lifecycle stage of one employment.

Bare names: `record`, `history`, `employee`, `worksite`, `employment`, `terms`, `children`, `company`, `wage_floor`, `wage_floor_pay`, `period`, `facts`, `event`, `workforce_permit`, `check`, `obligations`, `before`, `after`, `deduction`, `leave`, `payslip`.

Open prefixes: `event.facts.<key>`, `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_flag_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `employee.facts.<key>`, `worksite.facts.<key>`, `terms.facts.<key>`, `before.facts.<key>`, `after.facts.<key>`, `leave.facts.<key>`, `payslip.lines.<key>`.

| Member | Meaning |
| --- | --- |
| `record.observed_at` | Qualified by the stored root schema |
| `record.assessed_on` | Qualified by the stored root schema |
| `record.from` | Qualified by the stored root schema |
| `record.to` | Qualified by the stored root schema |
| `record.facts` | Qualified by the stored root schema |
| `record.minimum_wage` | Qualified by the stored root schema |
| `history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `employee.gender` | Qualified by the stored root schema |
| `employee.age` | Qualified by the stored root schema |
| `employee.age_months` | Qualified by the stored root schema |
| `employee.birth_date` | Qualified by the stored root schema |
| `employee.birthday` | Qualified by the stored root schema |
| `employee.age_months_on` | Qualified by the stored root schema |
| `employee.age_on` | Qualified by the stored root schema |
| `employee.citizenship` | Qualified by the stored root schema |
| `employee.facts` | Qualified by the stored root schema |
| `employee.fact_keys` | Qualified by the stored root schema |
| `worksite.code` | Qualified by the stored root schema |
| `worksite.region` | Qualified by the stored root schema |
| `worksite.facts` | Qualified by the stored root schema |
| `employee.marital_status` | Qualified by the stored root schema |
| `employee.spouse_status` | Qualified by the stored root schema |
| `employee.dependents_count` | Qualified by the stored root schema |
| `employee.solo_parent` | Qualified by the stored root schema |
| `employee.receiving_pension` | Qualified by the stored root schema |
| `employee.disabled` | Qualified by the stored root schema |
| `employee.race` | Qualified by the stored root schema |
| `employee.religion` | Qualified by the stored root schema |
| `employee.residency_months` | Qualified by the stored root schema |
| `employee.presence_recorded` | Qualified by the stored root schema |
| `employee.presence_days` | Qualified by the stored root schema |
| `employee.presence_linked_days` | Qualified by the stored root schema |
| `employee.presence_days_in` | Qualified by the stored root schema |
| `employee.employment_days` | Qualified by the stored root schema |
| `employment.type` | Qualified by the stored root schema |
| `employment.classification` | Qualified by the stored root schema |
| `employment.risk_class` | Qualified by the stored root schema |
| `employment.service_days` | Qualified by the stored root schema |
| `employment.service_days_before` | Qualified by the stored root schema |
| `employment.service_months` | Qualified by the stored root schema |
| `employment.service_months_exact` | Qualified by the stored root schema |
| `employment.service_years` | Qualified by the stored root schema |
| `employment.service_years_on` | Qualified by the stored root schema |
| `employment.notice_days_remaining` | Qualified by the stored root schema |
| `employment.notice_monthly_wages` | Qualified by the stored root schema |
| `employment.payday_notice_days` | Qualified by the stored root schema |
| `employment.service_start` | Qualified by the stored root schema |
| `employment.rule_date` | Qualified by the stored root schema |
| `employment.rule_end` | Qualified by the stored root schema |
| `employment.exit_date` | Qualified by the stored root schema |
| `employment.signed_contract_end` | Qualified by the stored root schema |
| `employment.days_to_exit` | Qualified by the stored root schema |
| `employment.open_ended` | Qualified by the stored root schema |
| `employment.contract_months` | Qualified by the stored root schema |
| `employment.contract_days` | Qualified by the stored root schema |
| `employment.exit_ground` | Qualified by the stored root schema |
| `employment.exit_facts` | Qualified by the stored root schema |
| `employment.exit_fact_keys` | Qualified by the stored root schema |
| `employment.absent_days_12m` | Qualified by the stored root schema |
| `employment.service_periods` | Qualified by the stored root schema |
| `employment.service_scope` | Qualified by the stored root schema |
| `employment.aggregate_service_scope` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.prior_service_months` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.contract_workdays` | Qualified by the stored root schema |
| `employment.exact_received_components` | Qualified by the stored root schema |
| `employment.exact_rate_wages` | Qualified by the stored root schema |
| `employment.comparable_rate_wages` | Qualified by the stored root schema |
| `employment.exact_service_wages` | Qualified by the stored root schema |
| `employment.exact_wages` | Qualified by the stored root schema |
| `employment.exact_wage_window` | Qualified by the stored root schema |
| `employment.average_daily_wage` | Qualified by the stored root schema |
| `employment.average_monthly_wage` | Qualified by the stored root schema |
| `employment.on_leave` | Qualified by the stored root schema |
| `employment.service_excluding_leave` | Qualified by the stored root schema |
| `employment.service_months_net` | Qualified by the stored root schema |
| `terms.basic_salary` | Qualified by the stored root schema |
| `terms.monthly_basic` | Qualified by the stored root schema |
| `terms.ordinary_day` | Qualified by the stored root schema |
| `terms.fixed_allowances` | Qualified by the stored root schema |
| `terms.monthly_wage` | Qualified by the stored root schema |
| `terms.gross_monthly` | Qualified by the stored root schema |
| `terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `terms.statutory_wages` | Qualified by the stored root schema |
| `terms.statutory_work_category` | Qualified by the stored root schema |
| `terms.weather_dependent_piece` | Qualified by the stored root schema |
| `terms.worksite` | Qualified by the stored root schema |
| `terms.worksite_sector` | Qualified by the stored root schema |
| `terms.department` | Qualified by the stored root schema |
| `terms.payroll_group` | Qualified by the stored root schema |
| `terms.paid_rest_days` | Qualified by the stored root schema |
| `terms.grade` | Qualified by the stored root schema |
| `terms.pay_frequency` | Qualified by the stored root schema |
| `terms.pass_type` | Qualified by the stored root schema |
| `terms.tax_residency` | Qualified by the stored root schema |
| `terms.residency_since` | Qualified by the stored root schema |
| `terms.notice_days` | Qualified by the stored root schema |
| `terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `terms.contract_week_work_days` | Qualified by the stored root schema |
| `terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `terms.working_days_per_week` | Qualified by the stored root schema |
| `terms.facts` | Qualified by the stored root schema |
| `terms.fact_keys` | Qualified by the stored root schema |
| `children.count` | Qualified by the stored root schema |
| `children.birthdates` | Qualified by the stored root schema |
| `children.under` | Qualified by the stored root schema |
| `children.born_on` | Qualified by the stored root schema |
| `children.multiple_born_on` | Qualified by the stored root schema |
| `children.natural_surviving_on` | Qualified by the stored root schema |
| `children.natural_surviving_before` | Qualified by the stored root schema |
| `children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `children.citizens` | Qualified by the stored root schema |
| `children.births` | Qualified by the stored root schema |
| `children.citizens_under` | Qualified by the stored root schema |
| `children.prior_childcare_days` | Qualified by the stored root schema |
| `children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `children.prior_infant_care_days` | Qualified by the stored root schema |
| `children.classed` | Qualified by the stored root schema |
| `children.unclassed_under` | Qualified by the stored root schema |
| `company.region` | Qualified by the stored root schema |
| `company.headcount` | Qualified by the stored root schema |
| `company.headcount_citizens` | Qualified by the stored root schema |
| `company.pay_frequency` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `wage_floor` | Qualified by the stored root schema |
| `wage_floor_pay.BASE` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `event.kind` | Qualified by the stored root schema |
| `event.relationship` | Qualified by the stored root schema |
| `event.child_index` | Qualified by the stored root schema |
| `event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `event.delivery_children_count` | Qualified by the stored root schema |
| `event.date` | Qualified by the stored root schema |
| `event.facts` | Qualified by the stored root schema |
| `event.case.facts` | Qualified by the stored root schema |
| `event.child_citizenship` | Qualified by the stored root schema |
| `event.child_age` | Qualified by the stored root schema |
| `event.child_shared_weeks` | Qualified by the stored root schema |
| `event.prior_employment_days` | Qualified by the stored root schema |
| `event.estimated_delivery_date` | Qualified by the stored root schema |
| `event.adoption_eligibility_date` | Qualified by the stored root schema |
| `period.unpaid_full_days` | Qualified by the stored root schema |
| `period.leave_flag_days` | Qualified by the stored root schema |
| `period.leave_days` | Qualified by the stored root schema |
| `period.leave_full_days` | Qualified by the stored root schema |
| `period.leave_pay` | Qualified by the stored root schema |
| `period.working_days` | Qualified by the stored root schema |
| `period.unpaid_days` | Qualified by the stored root schema |
| `period.overtime_days` | Qualified by the stored root schema |
| `period.arrears` | Qualified by the stored root schema |
| `workforce_permit.covered` | Qualified by the stored root schema |
| `workforce_permit.qualified` | Qualified by the stored root schema |
| `workforce_permit.pending` | Qualified by the stored root schema |
| `workforce_permit.faults` | Qualified by the stored root schema |
| `workforce_permit.source_ids` | Qualified by the stored root schema |
| `workforce_permit.case_reference` | Qualified by the stored root schema |
| `workforce_permit.place_reference` | Qualified by the stored root schema |
| `workforce_permit.observed_on` | Qualified by the stored root schema |
| `workforce_permit.checked_through` | Qualified by the stored root schema |
| `check.at` | Qualified by the stored root schema |
| `check.date` | Qualified by the stored root schema |
| `obligations.open` | Qualified by the stored root schema |
| `before.basic_salary` | Qualified by the stored root schema |
| `after.basic_salary` | Qualified by the stored root schema |
| `before.monthly_basic` | Qualified by the stored root schema |
| `after.monthly_basic` | Qualified by the stored root schema |
| `before.ordinary_day` | Qualified by the stored root schema |
| `after.ordinary_day` | Qualified by the stored root schema |
| `before.fixed_allowances` | Qualified by the stored root schema |
| `after.fixed_allowances` | Qualified by the stored root schema |
| `before.monthly_wage` | Qualified by the stored root schema |
| `after.monthly_wage` | Qualified by the stored root schema |
| `before.gross_monthly` | Qualified by the stored root schema |
| `after.gross_monthly` | Qualified by the stored root schema |
| `before.monthly_wage_6m_average` | Qualified by the stored root schema |
| `after.monthly_wage_6m_average` | Qualified by the stored root schema |
| `before.statutory_wages` | Qualified by the stored root schema |
| `after.statutory_wages` | Qualified by the stored root schema |
| `before.statutory_work_category` | Qualified by the stored root schema |
| `after.statutory_work_category` | Qualified by the stored root schema |
| `before.weather_dependent_piece` | Qualified by the stored root schema |
| `after.weather_dependent_piece` | Qualified by the stored root schema |
| `before.worksite` | Qualified by the stored root schema |
| `after.worksite` | Qualified by the stored root schema |
| `before.worksite_sector` | Qualified by the stored root schema |
| `after.worksite_sector` | Qualified by the stored root schema |
| `before.department` | Qualified by the stored root schema |
| `after.department` | Qualified by the stored root schema |
| `before.payroll_group` | Qualified by the stored root schema |
| `after.payroll_group` | Qualified by the stored root schema |
| `before.paid_rest_days` | Qualified by the stored root schema |
| `after.paid_rest_days` | Qualified by the stored root schema |
| `before.grade` | Qualified by the stored root schema |
| `after.grade` | Qualified by the stored root schema |
| `before.pay_frequency` | Qualified by the stored root schema |
| `after.pay_frequency` | Qualified by the stored root schema |
| `before.pass_type` | Qualified by the stored root schema |
| `after.pass_type` | Qualified by the stored root schema |
| `before.tax_residency` | Qualified by the stored root schema |
| `after.tax_residency` | Qualified by the stored root schema |
| `before.residency_since` | Qualified by the stored root schema |
| `after.residency_since` | Qualified by the stored root schema |
| `before.notice_days` | Qualified by the stored root schema |
| `after.notice_days` | Qualified by the stored root schema |
| `before.ordinary_hours_per_week` | Qualified by the stored root schema |
| `after.ordinary_hours_per_week` | Qualified by the stored root schema |
| `before.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `after.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `before.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `after.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `before.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `after.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `before.comparable_full_time_presence` | Qualified by the stored root schema |
| `after.comparable_full_time_presence` | Qualified by the stored root schema |
| `before.contract_week_work_days` | Qualified by the stored root schema |
| `after.contract_week_work_days` | Qualified by the stored root schema |
| `before.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `after.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `before.working_days_per_week` | Qualified by the stored root schema |
| `after.working_days_per_week` | Qualified by the stored root schema |
| `before.facts` | Qualified by the stored root schema |
| `after.facts` | Qualified by the stored root schema |
| `before.fact_keys` | Qualified by the stored root schema |
| `after.fact_keys` | Qualified by the stored root schema |
| `deduction.code` | Qualified by the stored root schema |
| `deduction.amount` | Qualified by the stored root schema |
| `deduction.gross` | Qualified by the stored root schema |
| `deduction.net` | Qualified by the stored root schema |
| `deduction.total` | Qualified by the stored root schema |
| `leave.code` | Qualified by the stored root schema |
| `leave.from` | Qualified by the stored root schema |
| `leave.to` | Qualified by the stored root schema |
| `leave.days` | Qualified by the stored root schema |
| `leave.facts` | Qualified by the stored root schema |
| `payslip.gross` | Qualified by the stored root schema |
| `payslip.net` | Qualified by the stored root schema |
| `payslip.deductions` | Qualified by the stored root schema |
| `payslip.lines` | Qualified by the stored root schema |
| `payslip.pay_date` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `order` — Stored runtime expression declaration

Used by: `loans.recovery_rule` — one deduction order on one payslip.

Bare names: `payment`, `order`, `wage_floor`.

Open prefixes: `order.facts.<key>`.

| Member | Meaning |
| --- | --- |
| `payment.gross` | Qualified by the stored root schema |
| `payment.initial_net` | Qualified by the stored root schema |
| `payment.net` | Qualified by the stored root schema |
| `payment.disposable` | Qualified by the stored root schema |
| `payment.lines` | Qualified by the stored root schema |
| `payment.receipt_on` | Qualified by the stored root schema |
| `payment.receipt_month` | Qualified by the stored root schema |
| `payment.prior_receipts` | Qualified by the stored root schema |
| `order.facts` | Qualified by the stored root schema |
| `payment.final` | Qualified by the stored root schema |
| `order.principal` | Qualified by the stored root schema |
| `order.recovered` | Qualified by the stored root schema |
| `order.balance` | Qualified by the stored root schema |
| `order.priority` | Qualified by the stored root schema |
| `order.creditor` | Qualified by the stored root schema |
| `order.authority` | Qualified by the stored root schema |
| `wage_floor` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `derived_line` — Stored runtime expression declaration

Used by: `rule_sets(WORK).rules.data.derived_lines[].amount` and `when` — a line the period’s totals decide.

Bare names: `record`, `history`, `employee`, `worksite`, `employment`, `terms`, `children`, `company`, `wage_floor`, `wage_floor_pay`, `period`, `facts`, `event`, `BASE`, `OVERTIME`, `DAY_PAY`, `NIGHT_PREMIUM`, `OVERTIME_PREMIUM`, `ABSENCE`, `NO_PAY_LEAVE`, `ENCASHMENT`, `INCENTIVE`, `NIGHT_WAGE`, `day_facts`.

Open prefixes: `event.facts.<key>`, `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_flag_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `employee.facts.<key>`, `worksite.facts.<key>`, `terms.facts.<key>`, `day_facts.<key>`.

| Member | Meaning |
| --- | --- |
| `record.observed_at` | Qualified by the stored root schema |
| `record.assessed_on` | Qualified by the stored root schema |
| `record.from` | Qualified by the stored root schema |
| `record.to` | Qualified by the stored root schema |
| `record.facts` | Qualified by the stored root schema |
| `record.minimum_wage` | Qualified by the stored root schema |
| `history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `employee.gender` | Qualified by the stored root schema |
| `employee.age` | Qualified by the stored root schema |
| `employee.age_months` | Qualified by the stored root schema |
| `employee.birth_date` | Qualified by the stored root schema |
| `employee.birthday` | Qualified by the stored root schema |
| `employee.age_months_on` | Qualified by the stored root schema |
| `employee.age_on` | Qualified by the stored root schema |
| `employee.citizenship` | Qualified by the stored root schema |
| `employee.facts` | Qualified by the stored root schema |
| `employee.fact_keys` | Qualified by the stored root schema |
| `worksite.code` | Qualified by the stored root schema |
| `worksite.region` | Qualified by the stored root schema |
| `worksite.facts` | Qualified by the stored root schema |
| `employee.marital_status` | Qualified by the stored root schema |
| `employee.spouse_status` | Qualified by the stored root schema |
| `employee.dependents_count` | Qualified by the stored root schema |
| `employee.solo_parent` | Qualified by the stored root schema |
| `employee.receiving_pension` | Qualified by the stored root schema |
| `employee.disabled` | Qualified by the stored root schema |
| `employee.race` | Qualified by the stored root schema |
| `employee.religion` | Qualified by the stored root schema |
| `employee.residency_months` | Qualified by the stored root schema |
| `employee.presence_recorded` | Qualified by the stored root schema |
| `employee.presence_days` | Qualified by the stored root schema |
| `employee.presence_linked_days` | Qualified by the stored root schema |
| `employee.presence_days_in` | Qualified by the stored root schema |
| `employee.employment_days` | Qualified by the stored root schema |
| `employment.type` | Qualified by the stored root schema |
| `employment.classification` | Qualified by the stored root schema |
| `employment.risk_class` | Qualified by the stored root schema |
| `employment.service_days` | Qualified by the stored root schema |
| `employment.service_days_before` | Qualified by the stored root schema |
| `employment.service_months` | Qualified by the stored root schema |
| `employment.service_months_exact` | Qualified by the stored root schema |
| `employment.service_years` | Qualified by the stored root schema |
| `employment.service_years_on` | Qualified by the stored root schema |
| `employment.notice_days_remaining` | Qualified by the stored root schema |
| `employment.notice_monthly_wages` | Qualified by the stored root schema |
| `employment.payday_notice_days` | Qualified by the stored root schema |
| `employment.service_start` | Qualified by the stored root schema |
| `employment.rule_date` | Qualified by the stored root schema |
| `employment.rule_end` | Qualified by the stored root schema |
| `employment.exit_date` | Qualified by the stored root schema |
| `employment.signed_contract_end` | Qualified by the stored root schema |
| `employment.days_to_exit` | Qualified by the stored root schema |
| `employment.open_ended` | Qualified by the stored root schema |
| `employment.contract_months` | Qualified by the stored root schema |
| `employment.contract_days` | Qualified by the stored root schema |
| `employment.exit_ground` | Qualified by the stored root schema |
| `employment.exit_facts` | Qualified by the stored root schema |
| `employment.exit_fact_keys` | Qualified by the stored root schema |
| `employment.absent_days_12m` | Qualified by the stored root schema |
| `employment.service_periods` | Qualified by the stored root schema |
| `employment.service_scope` | Qualified by the stored root schema |
| `employment.aggregate_service_scope` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.prior_service_months` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.contract_workdays` | Qualified by the stored root schema |
| `employment.exact_received_components` | Qualified by the stored root schema |
| `employment.exact_rate_wages` | Qualified by the stored root schema |
| `employment.comparable_rate_wages` | Qualified by the stored root schema |
| `employment.exact_service_wages` | Qualified by the stored root schema |
| `employment.exact_wages` | Qualified by the stored root schema |
| `employment.exact_wage_window` | Qualified by the stored root schema |
| `employment.average_daily_wage` | Qualified by the stored root schema |
| `employment.average_monthly_wage` | Qualified by the stored root schema |
| `employment.on_leave` | Qualified by the stored root schema |
| `employment.service_excluding_leave` | Qualified by the stored root schema |
| `employment.service_months_net` | Qualified by the stored root schema |
| `terms.basic_salary` | Qualified by the stored root schema |
| `terms.monthly_basic` | Qualified by the stored root schema |
| `terms.ordinary_day` | Qualified by the stored root schema |
| `terms.fixed_allowances` | Qualified by the stored root schema |
| `terms.monthly_wage` | Qualified by the stored root schema |
| `terms.gross_monthly` | Qualified by the stored root schema |
| `terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `terms.statutory_wages` | Qualified by the stored root schema |
| `terms.statutory_work_category` | Qualified by the stored root schema |
| `terms.weather_dependent_piece` | Qualified by the stored root schema |
| `terms.worksite` | Qualified by the stored root schema |
| `terms.worksite_sector` | Qualified by the stored root schema |
| `terms.department` | Qualified by the stored root schema |
| `terms.payroll_group` | Qualified by the stored root schema |
| `terms.paid_rest_days` | Qualified by the stored root schema |
| `terms.grade` | Qualified by the stored root schema |
| `terms.pay_frequency` | Qualified by the stored root schema |
| `terms.pass_type` | Qualified by the stored root schema |
| `terms.tax_residency` | Qualified by the stored root schema |
| `terms.residency_since` | Qualified by the stored root schema |
| `terms.notice_days` | Qualified by the stored root schema |
| `terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `terms.contract_week_work_days` | Qualified by the stored root schema |
| `terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `terms.working_days_per_week` | Qualified by the stored root schema |
| `terms.facts` | Qualified by the stored root schema |
| `terms.fact_keys` | Qualified by the stored root schema |
| `children.count` | Qualified by the stored root schema |
| `children.birthdates` | Qualified by the stored root schema |
| `children.under` | Qualified by the stored root schema |
| `children.born_on` | Qualified by the stored root schema |
| `children.multiple_born_on` | Qualified by the stored root schema |
| `children.natural_surviving_on` | Qualified by the stored root schema |
| `children.natural_surviving_before` | Qualified by the stored root schema |
| `children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `children.citizens` | Qualified by the stored root schema |
| `children.births` | Qualified by the stored root schema |
| `children.citizens_under` | Qualified by the stored root schema |
| `children.prior_childcare_days` | Qualified by the stored root schema |
| `children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `children.prior_infant_care_days` | Qualified by the stored root schema |
| `children.classed` | Qualified by the stored root schema |
| `children.unclassed_under` | Qualified by the stored root schema |
| `company.region` | Qualified by the stored root schema |
| `company.headcount` | Qualified by the stored root schema |
| `company.headcount_citizens` | Qualified by the stored root schema |
| `company.pay_frequency` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `wage_floor` | Qualified by the stored root schema |
| `wage_floor_pay.BASE` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `event.kind` | Qualified by the stored root schema |
| `event.relationship` | Qualified by the stored root schema |
| `event.child_index` | Qualified by the stored root schema |
| `event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `event.delivery_children_count` | Qualified by the stored root schema |
| `event.date` | Qualified by the stored root schema |
| `event.facts` | Qualified by the stored root schema |
| `event.case.facts` | Qualified by the stored root schema |
| `event.child_citizenship` | Qualified by the stored root schema |
| `event.child_age` | Qualified by the stored root schema |
| `event.child_shared_weeks` | Qualified by the stored root schema |
| `event.prior_employment_days` | Qualified by the stored root schema |
| `event.estimated_delivery_date` | Qualified by the stored root schema |
| `event.adoption_eligibility_date` | Qualified by the stored root schema |
| `period.unpaid_full_days` | Qualified by the stored root schema |
| `period.leave_flag_days` | Qualified by the stored root schema |
| `period.leave_days` | Qualified by the stored root schema |
| `period.leave_full_days` | Qualified by the stored root schema |
| `period.leave_pay` | Qualified by the stored root schema |
| `period.working_days` | Qualified by the stored root schema |
| `period.unpaid_days` | Qualified by the stored root schema |
| `period.overtime_days` | Qualified by the stored root schema |
| `period.arrears` | Qualified by the stored root schema |
| `BASE` | Qualified by the stored root schema |
| `OVERTIME` | Qualified by the stored root schema |
| `DAY_PAY` | Qualified by the stored root schema |
| `NIGHT_PREMIUM` | Qualified by the stored root schema |
| `OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `ABSENCE` | Qualified by the stored root schema |
| `NO_PAY_LEAVE` | Qualified by the stored root schema |
| `ENCASHMENT` | Qualified by the stored root schema |
| `INCENTIVE` | Qualified by the stored root schema |
| `NIGHT_WAGE` | Qualified by the stored root schema |
| `day_facts` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |

## `earned_wage` — Stored runtime expression declaration

Used by: Earned-wage component classification and assessment rules — actual dated component source.

Bare names: `record`, `history`, `employee`, `worksite`, `employment`, `terms`, `children`, `company`, `wage_floor`, `wage_floor_pay`, `period`, `facts`, `event`, `wage`, `line`, `training`, `interruption`, `entry`.

Open prefixes: `company.facts.<key>`, `facts.<key>`, `period.leave_full_days.<key>`, `period.leave_days.<key>`, `period.leave_flag_days.<key>`, `period.leave_pay.<key>`, `employment.exit_facts.<key>`, `employee.facts.<key>`, `worksite.facts.<key>`, `terms.facts.<key>`, `event.facts.<key>`, `event.case.facts.<key>`, `record.facts.<key>`, `wage.components.<key>`, `wage.role_first_on.<key>`, `wage.role_service_months.<key>`, `training.<key>`.

| Member | Meaning |
| --- | --- |
| `record.observed_at` | Qualified by the stored root schema |
| `record.assessed_on` | Qualified by the stored root schema |
| `record.from` | Qualified by the stored root schema |
| `record.to` | Qualified by the stored root schema |
| `record.facts` | Qualified by the stored root schema |
| `record.minimum_wage` | Qualified by the stored root schema |
| `history.slips|days|leave|terms|external` | Qualified by the stored root schema |
| `employee.gender` | Qualified by the stored root schema |
| `employee.age` | Qualified by the stored root schema |
| `employee.age_months` | Qualified by the stored root schema |
| `employee.birth_date` | Qualified by the stored root schema |
| `employee.birthday` | Qualified by the stored root schema |
| `employee.age_months_on` | Qualified by the stored root schema |
| `employee.age_on` | Qualified by the stored root schema |
| `employee.citizenship` | Qualified by the stored root schema |
| `employee.facts` | Qualified by the stored root schema |
| `employee.fact_keys` | Qualified by the stored root schema |
| `worksite.code` | Qualified by the stored root schema |
| `worksite.region` | Qualified by the stored root schema |
| `worksite.facts` | Qualified by the stored root schema |
| `employee.marital_status` | Qualified by the stored root schema |
| `employee.spouse_status` | Qualified by the stored root schema |
| `employee.dependents_count` | Qualified by the stored root schema |
| `employee.solo_parent` | Qualified by the stored root schema |
| `employee.receiving_pension` | Qualified by the stored root schema |
| `employee.disabled` | Qualified by the stored root schema |
| `employee.race` | Qualified by the stored root schema |
| `employee.religion` | Qualified by the stored root schema |
| `employee.residency_months` | Qualified by the stored root schema |
| `employee.presence_recorded` | Qualified by the stored root schema |
| `employee.presence_days` | Qualified by the stored root schema |
| `employee.presence_linked_days` | Qualified by the stored root schema |
| `employee.presence_days_in` | Qualified by the stored root schema |
| `employee.employment_days` | Qualified by the stored root schema |
| `employment.type` | Qualified by the stored root schema |
| `employment.classification` | Qualified by the stored root schema |
| `employment.risk_class` | Qualified by the stored root schema |
| `employment.service_days` | Qualified by the stored root schema |
| `employment.service_days_before` | Qualified by the stored root schema |
| `employment.service_months` | Qualified by the stored root schema |
| `employment.service_months_exact` | Qualified by the stored root schema |
| `employment.service_years` | Qualified by the stored root schema |
| `employment.service_years_on` | Qualified by the stored root schema |
| `employment.notice_days_remaining` | Qualified by the stored root schema |
| `employment.notice_monthly_wages` | Qualified by the stored root schema |
| `employment.payday_notice_days` | Qualified by the stored root schema |
| `employment.service_start` | Qualified by the stored root schema |
| `employment.rule_date` | Qualified by the stored root schema |
| `employment.rule_end` | Qualified by the stored root schema |
| `employment.exit_date` | Qualified by the stored root schema |
| `employment.signed_contract_end` | Qualified by the stored root schema |
| `employment.days_to_exit` | Qualified by the stored root schema |
| `employment.open_ended` | Qualified by the stored root schema |
| `employment.contract_months` | Qualified by the stored root schema |
| `employment.contract_days` | Qualified by the stored root schema |
| `employment.exit_ground` | Qualified by the stored root schema |
| `employment.exit_facts` | Qualified by the stored root schema |
| `employment.exit_fact_keys` | Qualified by the stored root schema |
| `employment.absent_days_12m` | Qualified by the stored root schema |
| `employment.service_periods` | Qualified by the stored root schema |
| `employment.service_scope` | Qualified by the stored root schema |
| `employment.aggregate_service_scope` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.piece_wages_last_workdays` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.earned_monthly_average` | Qualified by the stored root schema |
| `employment.prior_service_months` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.exact_average` | Qualified by the stored root schema |
| `employment.contract_workdays` | Qualified by the stored root schema |
| `employment.exact_received_components` | Qualified by the stored root schema |
| `employment.exact_rate_wages` | Qualified by the stored root schema |
| `employment.comparable_rate_wages` | Qualified by the stored root schema |
| `employment.exact_service_wages` | Qualified by the stored root schema |
| `employment.exact_wages` | Qualified by the stored root schema |
| `employment.exact_wage_window` | Qualified by the stored root schema |
| `employment.average_daily_wage` | Qualified by the stored root schema |
| `employment.average_monthly_wage` | Qualified by the stored root schema |
| `employment.on_leave` | Qualified by the stored root schema |
| `employment.service_excluding_leave` | Qualified by the stored root schema |
| `employment.service_months_net` | Qualified by the stored root schema |
| `terms.basic_salary` | Qualified by the stored root schema |
| `terms.monthly_basic` | Qualified by the stored root schema |
| `terms.ordinary_day` | Qualified by the stored root schema |
| `terms.fixed_allowances` | Qualified by the stored root schema |
| `terms.monthly_wage` | Qualified by the stored root schema |
| `terms.gross_monthly` | Qualified by the stored root schema |
| `terms.monthly_wage_6m_average` | Qualified by the stored root schema |
| `terms.statutory_wages` | Qualified by the stored root schema |
| `terms.statutory_work_category` | Qualified by the stored root schema |
| `terms.weather_dependent_piece` | Qualified by the stored root schema |
| `terms.worksite` | Qualified by the stored root schema |
| `terms.worksite_sector` | Qualified by the stored root schema |
| `terms.department` | Qualified by the stored root schema |
| `terms.payroll_group` | Qualified by the stored root schema |
| `terms.paid_rest_days` | Qualified by the stored root schema |
| `terms.grade` | Qualified by the stored root schema |
| `terms.pay_frequency` | Qualified by the stored root schema |
| `terms.pass_type` | Qualified by the stored root schema |
| `terms.tax_residency` | Qualified by the stored root schema |
| `terms.residency_since` | Qualified by the stored root schema |
| `terms.notice_days` | Qualified by the stored root schema |
| `terms.ordinary_hours_per_week` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_daily_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_weekly_hours` | Qualified by the stored root schema |
| `terms.comparable_full_time_presence` | Qualified by the stored root schema |
| `terms.contract_week_work_days` | Qualified by the stored root schema |
| `terms.contract_week_shortest_work_hours` | Qualified by the stored root schema |
| `terms.working_days_per_week` | Qualified by the stored root schema |
| `terms.facts` | Qualified by the stored root schema |
| `terms.fact_keys` | Qualified by the stored root schema |
| `children.count` | Qualified by the stored root schema |
| `children.birthdates` | Qualified by the stored root schema |
| `children.under` | Qualified by the stored root schema |
| `children.born_on` | Qualified by the stored root schema |
| `children.multiple_born_on` | Qualified by the stored root schema |
| `children.natural_surviving_on` | Qualified by the stored root schema |
| `children.natural_surviving_before` | Qualified by the stored root schema |
| `children.natural_surviving_confinements_before` | Qualified by the stored root schema |
| `children.citizens` | Qualified by the stored root schema |
| `children.births` | Qualified by the stored root schema |
| `children.citizens_under` | Qualified by the stored root schema |
| `children.prior_childcare_days` | Qualified by the stored root schema |
| `children.prior_extended_childcare_days` | Qualified by the stored root schema |
| `children.prior_infant_care_days` | Qualified by the stored root schema |
| `children.classed` | Qualified by the stored root schema |
| `children.unclassed_under` | Qualified by the stored root schema |
| `company.region` | Qualified by the stored root schema |
| `company.headcount` | Qualified by the stored root schema |
| `company.headcount_citizens` | Qualified by the stored root schema |
| `company.pay_frequency` | Qualified by the stored root schema |
| `company.facts` | Qualified by the stored root schema |
| `wage_floor` | Qualified by the stored root schema |
| `wage_floor_pay.BASE` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME` | Qualified by the stored root schema |
| `wage_floor_pay.DAY_PAY` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.OVERTIME_PREMIUM` | Qualified by the stored root schema |
| `wage_floor_pay.ABSENCE` | Qualified by the stored root schema |
| `wage_floor_pay.NO_PAY_LEAVE` | Qualified by the stored root schema |
| `wage_floor_pay.ENCASHMENT` | Qualified by the stored root schema |
| `wage_floor_pay.INCENTIVE` | Qualified by the stored root schema |
| `wage_floor_pay.NIGHT_WAGE` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `facts` | Qualified by the stored root schema |
| `event.kind` | Qualified by the stored root schema |
| `event.relationship` | Qualified by the stored root schema |
| `event.child_index` | Qualified by the stored root schema |
| `event.wife_prior_living_biological_children` | Qualified by the stored root schema |
| `event.delivery_children_count` | Qualified by the stored root schema |
| `event.date` | Qualified by the stored root schema |
| `event.facts` | Qualified by the stored root schema |
| `event.case.facts` | Qualified by the stored root schema |
| `event.child_citizenship` | Qualified by the stored root schema |
| `event.child_age` | Qualified by the stored root schema |
| `event.child_shared_weeks` | Qualified by the stored root schema |
| `event.prior_employment_days` | Qualified by the stored root schema |
| `event.estimated_delivery_date` | Qualified by the stored root schema |
| `event.adoption_eligibility_date` | Qualified by the stored root schema |
| `period.unpaid_full_days` | Qualified by the stored root schema |
| `period.leave_flag_days` | Qualified by the stored root schema |
| `period.leave_days` | Qualified by the stored root schema |
| `period.leave_full_days` | Qualified by the stored root schema |
| `period.leave_pay` | Qualified by the stored root schema |
| `period.working_days` | Qualified by the stored root schema |
| `period.unpaid_days` | Qualified by the stored root schema |
| `period.overtime_days` | Qualified by the stored root schema |
| `period.arrears` | Qualified by the stored root schema |
| `wage.role` | Qualified by the stored root schema |
| `wage.month` | Qualified by the stored root schema |
| `wage.date` | Qualified by the stored root schema |
| `wage.hours` | Qualified by the stored root schema |
| `wage.overtime` | Qualified by the stored root schema |
| `wage.paid_share` | Qualified by the stored root schema |
| `wage.roster_evidenced` | Qualified by the stored root schema |
| `wage.basic` | Qualified by the stored root schema |
| `wage.contract_basic` | Qualified by the stored root schema |
| `wage.contract_hours` | Qualified by the stored root schema |
| `wage.ordinary_hours` | Qualified by the stored root schema |
| `wage.bonus_deadline` | Qualified by the stored root schema |
| `wage.bonus_year` | Qualified by the stored root schema |
| `wage.bonus_basis` | Qualified by the stored root schema |
| `wage.bonus_hours` | Qualified by the stored root schema |
| `wage.part_four` | Qualified by the stored root schema |
| `wage.role_first_on` | Qualified by the stored root schema |
| `wage.role_service_months` | Qualified by the stored root schema |
| `wage.service_months` | Qualified by the stored root schema |
| `wage.prior_year_basic` | Qualified by the stored root schema |
| `line.code` | Qualified by the stored root schema |
| `line.amount` | Qualified by the stored root schema |
| `line.family` | Qualified by the stored root schema |
| `line.source` | Qualified by the stored root schema |
| `line.marks` | Qualified by the stored root schema |
| `interruption.from` | Qualified by the stored root schema |
| `interruption.to` | Qualified by the stored root schema |
| `interruption.reason` | Qualified by the stored root schema |
| `interruption.reference` | Qualified by the stored root schema |
| `entry.key` | Qualified by the stored root schema |
| `entry.month` | Qualified by the stored root schema |
| `entry.role` | Qualified by the stored root schema |
| `entry.from` | Qualified by the stored root schema |
| `entry.to` | Qualified by the stored root schema |
| `entry.qualifying` | Qualified by the stored root schema |
| `entry.minimum` | Qualified by the stored root schema |
| `entry.contractual_hours` | Qualified by the stored root schema |
| `entry.contract_basic` | Qualified by the stored root schema |
| `training` | Qualified by the stored root schema |

| Function | Meaning |
| --- | --- |
| `add_days(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `annual_date_on_or_after(string, int, int): string` | Stored callable signature; actual source bindings are required at execution |
| `avg(list): double` | Stored callable signature; actual source bindings are required at execution |
| `count(list): double` | Stored callable signature; actual source bindings are required at execution |
| `cumulative_service_months(list, string, int): double` | Stored callable signature; actual source bindings are required at execution |
| `days_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `exact_months(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `floor_product_ratio(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `list.top(int): list` | Stored callable signature; actual source bindings are required at execution |
| `map.account_transfers(string, map, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.attendance_days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.calendar_months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.contains(string): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_status(string, string, string, string, string, string, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.days(): list` | Stored callable signature; actual source bindings are required at execution |
| `map.days(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external(string, map, string, string): list` | Stored callable signature; actual source bindings are required at execution |
| `map.external_one(string, map, string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_average(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.headcount_on(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.holidays(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.intersect(map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.leave(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.months(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.rest_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `map.slips(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.terms(map): list` | Stored callable signature; actual source bindings are required at execution |
| `map.working_days(): double` | Stored callable signature; actual source bindings are required at execution |
| `max_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `min_of(list): double` | Stored callable signature; actual source bindings are required at execution |
| `month_end(string): string` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_before(string, int, int): map` | Stored callable signature; actual source bindings are required at execution |
| `months_end(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `rolling(list, int): list` | Stored callable signature; actual source bindings are required at execution |
| `service_year_of(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `span(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `subtract_spans(list, list): list` | Stored callable signature; actual source bindings are required at execution |
| `sum(list): double` | Stored callable signature; actual source bindings are required at execution |
| `union_spans(list): list` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string): map` | Stored callable signature; actual source bindings are required at execution |
| `year_of(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `table_at(string, string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `table(string, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `band(string, dyn, dyn, dyn, dyn): dyn` | Stored callable signature; actual source bindings are required at execution |
| `bands(string, dyn, dyn, dyn): list` | Stored callable signature; actual source bindings are required at execution |
| `minimum_wage(string): double` | Stored callable signature; actual source bindings are required at execution |
| `add_months(string, int): string` | Stored callable signature; actual source bindings are required at execution |
| `months_through(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `bracket(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `ladder(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `progressive(dyn, list<dyn>): double` | Stored callable signature; actual source bindings are required at execution |
| `map.under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.citizens_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.classed(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.unclassed_under(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.multiple_born_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.natural_surviving_confinements_before(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.age_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.birthday(int): string` | Stored callable signature; actual source bindings are required at execution |
| `map.age_months_on(string): int` | Stored callable signature; actual source bindings are required at execution |
| `map.presence_days_in(int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.taken(string): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average_complete(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.piece_wages_last_workdays(int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.earned_monthly_average(int, list, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_service_wages(map, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_remuneration(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_received_components(map, string, list): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_rate_wages(map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.comparable_rate_wages(string, map, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.contract_workdays(map, double, double, double): double` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_average(string, int, bool, double, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.exact_wage_window(string, int, list, bool): map` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_daily_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.average_monthly_wage(int, list, list): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_months_net(list, dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_excluding_leave(list, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.on_leave(string, list): bool` | Stored callable signature; actual source bindings are required at execution |
| `map.service_days_before(dyn, int): int` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_scope(string, string, int, map): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_since(string, string): map` | Stored callable signature; actual source bindings are required at execution |
| `map.aggregate_service_scope(string, int): map` | Stored callable signature; actual source bindings are required at execution |
| `map.service_aggregate_months(dyn, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.service_years_on(dyn): int` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_days_remaining(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.notice_monthly_wages(dyn, dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `map.payday_notice_days(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `work_window_hours_between(string, string, string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `extended_work_hours_between(string, string): double` | Stored callable signature; actual source bindings are required at execution |
| `days_under(int): double` | Stored callable signature; actual source bindings are required at execution |
| `run_hours_before_rest(double): double` | Stored callable signature; actual source bindings are required at execution |
| `coverage_days(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `map.days(string): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_quantity_exempt(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_monthly_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_daily_excess(string, dyn): double` | Stored callable signature; actual source bindings are required at execution |
| `code(string): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(string, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `earned_average(list, int, int): double` | Stored callable signature; actual source bindings are required at execution |
| `annual_exempt(dyn, dyn, dyn): double` | Stored callable signature; actual source bindings are required at execution |
