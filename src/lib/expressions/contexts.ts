/**
 * The expression contexts, as data: every CEL a catalogue, band, scheme, schedule or assessment rule
 * carries is compiled against one of them, the engine builds objects of this shape, and the Fields
 * panel renders them. The person site is the person object (`employee.*`, `employment.*`); elsewhere
 * it sits under `person.`. Open prefixes (`limits.*`, `year.earned.*`, `produced.*`,
 * `scheme.elections.*`, `person.company.facts.*`) take the version's own keys; any other undeclared
 * member is refused at write. `terms.facts.*`, `day_facts.*`, `payment.facts.*` and
 * `settlement.facts.*` are the declared inputs of `jurisdiction_settings.terms_facts`,
 * `work_day_facts`, `payment_facts` and `settlement_facts`, and `entry.facts.*` those of a catalogue
 * row's `request_facts`: their names are data.
 */

import { DEDUCTION_TOTAL_KEYS } from '../statutory-deductions.js';
import { REGISTERED_FUNCTIONS } from './functions/index.js';

export type ExpressionSite =
	| 'entity'
	| 'person'
	| 'entry'
	| 'work_day'
	| 'assessment'
	| 'scheme'
	| 'leave_day'
	| 'rest_break'
	| 'payment'
	| 'rate'
	| 'obligation'
	| 'filing'
	| 'case'
	| 'check'
	| 'order'
	| 'derived_line';
/**
 * What an expression returns: a boolean, a number in the unit its field is named for, a
 * `YYYY-MM-DD` date, or a text-or-number cell (a return column).
 */
export type ExpressionType =
	'boolean' | 'money' | 'hours' | 'minutes' | 'days' | 'number' | 'date' | 'text';

type ContextField = {
	readonly path: string;
	readonly description: string;
};

type ExpressionFunction = {
	readonly path: string;
	readonly description: string;
};

export type ExpressionContext = {
	readonly site: ExpressionSite;
	readonly description: string;
	readonly fields: readonly ContextField[];
	/** Value members used bare (no dot), e.g. a scheme's `base` and the assessment reserved lines. */
	readonly bare: readonly string[];
	/** Path roots whose remaining segments are keys, not schema members. */
	readonly open: readonly string[];
	/** The callable functions this site declares, for the Fields panel. */
	readonly functions: readonly ExpressionFunction[];
	readonly blank: Record<string, unknown>;
};

/**
 * The six roots and their members. Each is defined once; every site that carries a root carries
 * this list, prefixed where the site is not the root's own subject.
 */
const PERSON_ROOT_FIELDS: readonly ContextField[] = [
	{
		path: 'history.slips|days|leave|terms|external(window)',
		description:
			'The person’s saved past: `history.slips|days|leave|terms|external(window)` over a window built by `months_before`, `days_before`, `year_of` or `span`'
	},
	{ path: 'employee.gender', description: 'Recorded gender' },
	{ path: 'employee.age', description: 'Completed years on the rule date' },
	{
		path: 'employee.age_months',
		description:
			'Whole calendar months since birth, for a band that moves the month after a birthday'
	},
	{ path: 'employee.birth_date', description: 'Date of birth as `YYYY-MM-DD`, or empty' },
	{
		path: 'employee.birthday(age)',
		description:
			'Date the given age is reached, as `YYYY-MM-DD`, or empty without a birth date. A leap-day anniversary in a non-leap year falls on 1 March, matching age_on.'
	},
	{
		path: 'employee.age_months_on(date)',
		description:
			'Completed months of age on that day — a retirement age stated in years and months (VN Decree 135/2020: 61 years 3 months for a man in 2026)'
	},
	{
		path: 'employee.age_on(date)',
		description:
			'Completed years on that day — a scheme whose cover turns on a birthday (PH SSS s.9(a) at first coverage, TW 勞保 at sixty-five) reads the age on the day that matters'
	},
	{ path: 'employee.citizenship', description: 'Residency standing from the effective terms' },
	{
		path: 'employee.facts.<key>',
		description:
			'A person input the version declares in `person_facts`, from the revision in force on the rule date (an employment’s row over the personal one), defaults filled'
	},
	{ path: 'employee.fact_keys', description: 'The person-fact keys a revision actually records' },
	{
		path: 'worksite.code',
		description:
			'The establishment the terms name (the day’s own on a work day), its revision in force on the rule date; empty where none'
	},
	{ path: 'worksite.region', description: 'That worksite’s region, or empty' },
	{
		path: 'worksite.facts.<key>',
		description:
			'A worksite input the version declares in `worksite_facts` (an industry, a project)'
	},
	{ path: 'employee.marital_status', description: 'Marital status' },
	{ path: 'employee.spouse_status', description: 'NONE | WITHOUT_INCOME | WITH_INCOME' },
	{
		path: 'employee.dependents_count',
		description:
			'Declared dependant count for schemes such as ID PTKP and TW exemptions; child-specific rules read `children`'
	},
	{ path: 'employee.solo_parent', description: 'Solo-parent flag' },
	{
		path: 'employee.receiving_pension',
		description:
			'Drawing a statutory pension while employed — outside compulsory insurance and owed the employer’s rate as wages (VN Law 41/2024 art.2(7)(a), Labour Code art.168(3))'
	},
	{ path: 'employee.disabled', description: 'Disability flag' },
	{
		path: 'employee.race',
		description: 'Recorded race, upper-cased, as a self-help fund row reads it'
	},
	{
		path: 'employee.religion',
		description: 'Recorded religion, upper-cased (SG MBMF reads ISLAM)'
	},
	{
		path: 'employee.residency_months',
		description:
			'Whole calendar months since residency began, for a ladder that moves the month after an anniversary'
	},
	{
		path: 'employee.presence_recorded',
		description:
			'Whether any stay in the jurisdiction is recorded (`presence_periods`); false leaves a presence test to the declared residency and elections'
	},
	{
		path: 'employee.presence_days',
		description:
			'Days present in the jurisdiction in the rule date’s calendar year through the rule date, an entry or exit day whole (MY ITA 1967 s.7(1)(a), (1A); Sch.6 para 21(a))'
	},
	{
		path: 'employee.presence_linked_days',
		description:
			'Consecutive days in the previous calendar year of a stay running unbroken into this one, else 0 (MY ITA s.7(1)(b))'
	},
	{
		path: 'employee.presence_days_in(years_back)',
		description:
			'Days present in the calendar year that many years before the rule date’s, counted as `presence_days` (1 is the previous year; 0 where none is recorded) — MY ITA s.7(1)(c)(ii) counts the preceding years with 90 or more'
	},
	{
		path: 'employee.employment_days',
		description:
			'Days present on stays recorded `employment_exercised`, within the stint: the days the employment was exercised in the jurisdiction this calendar year through the rule date (MY ITA Sch.6 para 21(a), 22(a))'
	},
	{
		path: 'employment.type',
		description:
			'PERMANENT | CONTRACT | PROBATION | INTERN | CONSULTANT | PART_TIME | APPRENTICE | DOMESTIC'
	},
	{ path: 'employment.classification', description: 'Work classification' },
	{ path: 'employment.risk_class', description: 'The employment risk class, or empty' },
	{
		path: 'employment.service_days',
		description:
			'Calendar days in the current stint through the rule date, capped at exit; not event-specific employment history'
	},
	{
		path: 'employment.service_days_before(date, months)',
		description:
			'Distinct days employed by this entity in the stated calendar-month window immediately before the event date; all same-entity stints are supplied by payroll, and missing history refuses'
	},
	{
		path: 'employment.service_months',
		description: 'Completed months since the stint began; a leaver counts through the exit day'
	},
	{
		path: 'employment.service_months_exact',
		description:
			'Completed months plus the part month as a share of its days, for a pro-rata part year'
	},
	{
		path: 'employment.service_years',
		description: 'Completed years since the stint began; a leaver counts through the exit day'
	},
	{
		path: 'employment.service_years_on(date)',
		description: 'Completed service years on a specified calendar date on or after hire'
	},
	{
		path: 'employment.notice_days_remaining(days, given_on, waived_days)',
		description:
			'Unserved calendar notice days after the last service day; written notice includes its giving day, empty given_on means no notice. Waived days remove the final unserved days; excessive waiver or invalid dates refuse'
	},
	{
		path: 'employment.notice_monthly_wages(monthly_wage, days, given_on, waived_days)',
		description:
			'Constant monthly wages over the unserved notice interval, divided separately by each calendar month’s actual length. Does not select the legal wage components or handle changing/non-monthly wages; rounding belongs to the rule'
	},
	{
		path: 'employment.payday_notice_days(given_on, pay_frequency, company_pay_frequency)',
		description:
			'Notice length, as `days` for the two functions above, that takes effect on the payday after the first payday on or after given_on (TH LPA s.17 para.2); empty given_on prices from the removal day'
	},
	{
		path: 'employment.service_start',
		description:
			'First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire'
	},
	{
		path: 'employment.rule_date',
		description:
			'The rule date as `YYYY-MM-DD`; a `wages.contract_rules` rule reads the first day of its floor segment'
	},
	{ path: 'employment.exit_date', description: 'Last day of work, or empty while open' },
	{
		path: 'employment.days_to_exit',
		description:
			'Calendar days from the rule date to the exit date: 0 on the exit day or while open. A leave rule reads it on each day charged (TW 勞基法 §16(2): only inside the notice, `employment.days_to_exit < employment.exit_facts.notice_days_given`)'
	},
	{
		path: 'employment.open_ended',
		description:
			'Whether the contract states no end; a fixed-term contract’s end is its `exit_date`'
	},
	{
		path: 'employment.contract_months',
		description:
			'Whole months of a fixed-term contract, first day to last (VN Decree 253/2026 art.50(2): under three months is the 10% withholding; Law 41/2024 art.2(2): a foreigner is insured from twelve); 0 where open-ended'
	},
	{
		path: 'employment.contract_days',
		description:
			'Calendar days of a fixed-term contract, first day to last inclusive (LHDN MTD Specification 2026 D(a) note: a foreign employee on a contract of 182 days or more is withheld at resident MTD); 0 where open-ended'
	},
	{
		path: 'employment.exit_ground',
		description: 'The recorded termination ground: a `TERMINATION_GROUND` table code, or empty'
	},
	{
		path: 'employment.exit_facts.<key>',
		description:
			'Departure inputs declared by the settings version effective on the final service day'
	},
	{
		path: 'employment.exit_fact_keys',
		description: 'Departure keys explicitly recorded on the employment, before defaults'
	},
	{
		path: 'employment.absent_days_12m',
		description:
			'Rostered days with an empty punch in the twelve months to the rule date (leave rules only)'
	},
	{
		path: 'employment.earned_monthly_average(months)',
		description:
			'The wages earlier payslips paid (basic, regular cash for work, overtime, less unpaid days; no bonus or reimbursement) over the `months` calendar months before the rule date’s month, per month of service, a part first month counted as its share (ID Permenaker 6/2016 art.3(3)–(4); MY reg.6(2) as twelve of them). Refused where a month of service has no payslip; read on a pay request or a leave cash-out'
	},
	{
		path: 'employment.piece_wages_last_workdays(days)',
		description:
			'Earned units times unit rate on the last `days` piece-rate workdays through the final service day; refuses when a scheduled recent workday lacks earnings or explicit absence (TH LPA s.118)'
	},
	{
		path: 'employment.earned_monthly_average(months, excluded)',
		description:
			'That average with the named filed codes taken back out of each month; `["OVERTIME"]` is every priced work-day line (CN 企业职工带薪年休假实施办法 art.11: 剔除加班工资)'
	},
	{
		path: 'employment.earned_monthly_average(months, excluded, fallback)',
		description:
			'That average, or `fallback` where the stint served no month before the rule date’s month (CN 实施条例 art.27: a leaver in the hiring month averages the one month worked)'
	},
	{
		path: 'employment.prior_service_months',
		description:
			'Months worked for earlier employers before this stint, as recorded on the contract; 0 unrecorded (CN 企业职工带薪年休假实施办法 art.4: annual leave counts cumulative service across employers)'
	},
	{
		path: 'employment.average_daily_wage(months, codes)',
		description:
			'Those wages over the calendar days of the `months` months before the rule date’s month, with the days 施行細則 §2 leaves out removed with their wages: every calendar day the named leave codes’ approved time off spans, paid or not, and — with a third list, `average_daily_wage(months, codes, reduced)` — the days those codes cut the wage (TW 勞基法 §2(4)). Refused where a month of service has no payslip; read on a pay request only'
	},
	{
		path: 'employment.average_monthly_wage(months, codes)',
		description:
			'That daily average times the covered months’ average days — one month’s average wage (勞動部 台(83)勞動二字第25564號: six months’ wages ÷ 6 where nothing is left out)'
	},
	{
		path: 'employment.on_leave(date, codes)',
		description:
			'Whether approved time off of one of the named leave codes spans that day (TW 勞基法 §13: no employer termination inside the §50 stop or the §59 medical period); none where the site has no leave record'
	},
	{
		path: 'employment.service_months_net(codes, days)',
		description:
			'Completed months of service with the named leave codes’ calendar days disregarded in each twelve months of service where they exceed `days` (MY EA s.60E(3B)); read on a leave rule only'
	},
	{
		path: 'terms.basic_salary',
		description: 'Contracted base salary, in the cadence it is stated'
	},
	{
		path: 'terms.monthly_basic',
		description:
			'The basic as a month on the version’s ordinary divisor: a daily rate × `ordinary_divisor_days`, an hourly one × the contract’s hours a day × it, a weekly one × it ÷ the days a week'
	},
	{
		path: 'terms.ordinary_day',
		description:
			'One ordinary day’s pay: `terms.monthly_basic` over the version’s `ordinary_divisor_days` — the work-pricing day; leave cash-out has a separate dated rule; 0 where no divisor was evaluated'
	},
	{
		path: 'terms.fixed_allowances',
		description:
			'The allowances on the contract in force on the rule date, summed, less the classes `work_rules.wage_excluded_allowances` names (MY EA s.2 “wages” (c): travelling); on a scheme’s own expression, those counting toward that scheme'
	},
	{
		path: 'terms.monthly_wage',
		description:
			'Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of'
	},
	{
		path: 'terms.gross_monthly',
		description:
			'The gross rate of pay as a month: `terms.monthly_basic` plus the contract’s allowances less the classes `work_rules.gross_excluded_allowances` names (SG EA s.2: travelling, food, housing); at the work day the exclusions apply, elsewhere every allowance counts'
	},
	{
		path: 'terms.monthly_wage_6m_average',
		description:
			'The contractual monthly wage averaged over the last six months of the employment (the terms in force and the standing allowances on the first of each), for a separation payment the law measures on that average (VN art.46); the current monthly wage where the employment is younger'
	},
	{
		path: 'terms.statutory_wages',
		description:
			'Wages a statutory ceiling reads: basic plus every other cash payment for work in the run'
	},
	{
		path: 'terms.statutory_work_category',
		description:
			'Statutory work category of the terms: a code the governing version declares in payroll.vocabularies'
	},
	{
		path: 'terms.weather_dependent_piece',
		description: 'Weather-dependent piece work uses twelve paid months for ID JKK, JKM and JHT'
	},
	{
		path: 'terms.worksite',
		description: 'The worksite the terms record: a province or province/locality, or empty'
	},
	{
		path: 'terms.worksite_sector',
		description: 'The worksite sector the terms record (ID: the five-digit KBLI), or empty'
	},
	{
		path: 'terms.department',
		description: 'Department — an employer’s own catalogue tier, never a statute’s'
	},
	{
		path: 'terms.payroll_group',
		description: 'Payroll group — an employer’s own label, never a statute’s'
	},
	{
		path: 'terms.paid_rest_days',
		description:
			'The contract pays every day of the month, unworked rest days, special days and regular holidays included (the DOLE Handbook’s monthly-paid employee, factor 365)'
	},
	{
		path: 'terms.grade',
		description: 'Grade — an employer’s own catalogue tier, never a statute’s'
	},
	{ path: 'terms.pay_frequency', description: 'MONTHLY | SEMI_MONTHLY | WEEKLY | DAILY | HOURLY' },
	{
		path: 'terms.pass_type',
		description:
			'The work pass: a code the governing version declares in payroll.vocabularies, or empty'
	},
	{
		path: 'terms.tax_residency',
		description:
			'Tax residence declared on the contract, a code the governing version declares in payroll.vocabularies, or empty when unrecorded; each scheme supplies its statutory default'
	},
	{
		path: 'terms.residency_since',
		description: 'Date residency began as `YYYY-MM-DD`, or empty when unrecorded'
	},
	{ path: 'terms.notice_days', description: 'Notice days the contract states, 0 when none' },
	{ path: 'terms.ordinary_hours_per_week', description: 'Roster-measured working week, hours' },
	{
		path: 'terms.comparable_full_time_daily_hours',
		description: 'Similar full-time employee’s declared normal daily hours, or 0 when unrecorded'
	},
	{
		path: 'terms.comparable_full_time_presence',
		description:
			'PRESENT if a similar full-time employee exists, ABSENT for the statutory fallback, or empty if unknown'
	},
	{ path: 'terms.working_days_per_week', description: 'Roster-measured working week, days' },
	{
		path: 'terms.facts.<key>',
		description:
			'Jurisdiction inputs the version declares in `terms_facts`, recorded on the terms in force; a declared default where unrecorded'
	},
	{
		path: 'terms.fact_keys',
		description: 'Terms input keys explicitly recorded on the terms in force, before defaults'
	},
	{
		path: 'children.count',
		description:
			'Recorded child relationships active on the rule date, regardless of relationship or recorded death; a legal living-natural-child test needs its own dated function'
	},
	{ path: 'children.under(n)', description: 'Children under n completed years' },
	{
		path: 'children.born_on(date)',
		description:
			'Children born on that day — the size of one confinement (VN Law 113/2025: a month or three days more per child from the second or third)'
	},
	{
		path: 'children.multiple_born_on(date)',
		description:
			'The infants of a multiple birth: children born on that day, refusing fewer than two (CN Order 619 art.7: 15 days per extra infant)'
	},
	{
		path: 'children.natural_surviving_on(date)',
		description:
			'Natural CHILD records alive on that date, including children born that day; excludes adopted, stepchildren and wards. A death on the same date needs a time-specific determination.'
	},
	{
		path: 'children.natural_surviving_before(date)',
		description: 'Natural children alive before the named confinement, excluding its newborns'
	},
	{
		path: 'children.natural_surviving_confinements_before(date)',
		description:
			'Previous confinements that produced a natural child still alive at this confinement; children born in one confinement count once'
	},
	{ path: 'children.citizens', description: 'Children recorded as citizens' },
	{
		path: 'children.births',
		description:
			'Confinements: the children’s distinct dates of birth, twins one (SG EA s.76(4): no pay where 2+ living children were born in more than one previous confinement)'
	},
	{ path: 'children.citizens_under(n)', description: 'Of them, those under n completed years' },
	{
		path: 'children.prior_childcare_days',
		description:
			'Childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG GPCL and EA s.87A lifetime caps count every employer)'
	},
	{
		path: 'children.prior_extended_childcare_days',
		description:
			'Extended childcare leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12B(2)(a)(ii))'
	},
	{
		path: 'children.prior_infant_care_days',
		description:
			'Unpaid infant care leave days taken for the recorded children with earlier employers, as declared; 0 when unrecorded (SG CDCA s.12D(2)(a))'
	},
	{
		path: 'children.classed(x)',
		description:
			'Family records in classification x; these counts do not establish tax-relief claims'
	},
	{
		path: 'children.unclassed_under(n)',
		description:
			'Family records with no classification under n completed years; MY tax relief reads scheme.child_claims instead'
	},
	{ path: 'company.region', description: 'Employing entity region' },
	{ path: 'company.headcount', description: 'Active employments in the entity' },
	{ path: 'company.headcount_citizens', description: 'Of them, the citizens' },
	{
		path: 'company.pay_frequency',
		description: 'MONTHLY | SEMI_MONTHLY | WEEKLY; empty outside a payroll'
	},
	{
		path: 'company.facts.<key>',
		description: 'Entity facts the version declares: sector, establishment tests'
	},
	{
		path: 'wage_floor',
		description: 'The region’s minimum wage, or 0 when the wages order excludes this person'
	},
	...(
		[
			'BASE',
			'OVERTIME',
			'DAY_PAY',
			'NIGHT_PREMIUM',
			'OVERTIME_PREMIUM',
			'ABSENCE',
			'NO_PAY_LEAVE',
			'ENCASHMENT',
			'INCENTIVE',
			'NIGHT_WAGE'
		] as const
	).map((line) => ({
		path: `wage_floor_pay.${line}`,
		description: `The part of ${line} paid for days on which the contract’s month is at or below the floor of the version in force that day (a minimum-wage earner’s days); dated work-day lines by their date, the rest by the share of paid days; 0 outside payroll`
	})),
	{
		path: 'facts.<CODE>.registered',
		description: 'Whether the employment is registered with the scheme of that code'
	},
	{
		path: 'facts.<CODE>.since',
		description:
			'The day the employment registered with that scheme as `YYYY-MM-DD`, or empty (PH SSS s.9(a): coverage is compulsory for an employee not over sixty when first covered — `employee.age_on(facts.SSS.since)`)'
	},
	{
		path: 'facts.<CODE>.since_months',
		description:
			'Completed months since the employment registered with that scheme, 0 when unrecorded'
	},
	{
		path: 'facts.<CODE>.elections.<key>',
		description:
			'Declared scheme inputs resolved from the statutory facts effective on the rule date'
	},
	{
		path: 'facts.<CODE>.election_keys',
		description:
			'Keys explicitly supplied on that effective statutory declaration; distinct from resolved defaults'
	},
	{
		path: 'event.kind',
		description:
			'The per-event leave’s event: BIRTH | MISCARRIAGE | ADOPTION | MARRIAGE | DEATH | …, or empty'
	},
	{ path: 'event.relationship', description: 'Whose event: SPOUSE | CHILD | PARENT | …, or empty' },
	{
		path: 'event.child_index',
		description: 'Which recorded child the event concerns, 1-based; 0 when none'
	},
	{
		path: 'event.wife_prior_living_biological_children',
		description:
			'Wife’s prior living biological children at this birth, or -1 when unrecorded (VN Decree 168/2026 art.2(1)(b))'
	},
	{ path: 'event.date', description: 'The day of the event, or empty' },
	{
		path: 'event.case.facts.<key>',
		description:
			'The recorded facts and qualifications of the benefit case this event opened (`payroll.benefit_cases`); absent without a case, so read `has(event.case.facts.<key>) && event.case.facts.<key>`'
	},
	{
		path: 'event.child_citizenship',
		description: 'The named child’s recorded citizenship, or empty'
	},
	{
		path: 'event.child_age',
		description: 'The named child’s completed years, -1 when none is named'
	},
	{
		path: 'event.child_shared_weeks',
		description:
			'The named child’s allocated shared-parental weeks; -1 when unrecorded, 0 for an explicit zero share'
	},
	{
		path: 'event.prior_employment_days',
		description:
			'Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded'
	},
	{
		path: 'event.estimated_delivery_date',
		description:
			'The named child’s estimated delivery date as certified by a medical practitioner (SG CDCA s.2), or empty'
	},
	{
		path: 'event.adoption_eligibility_date',
		description:
			'The eligibility date of the application to adopt the named child (SG CDCA s.2: the application date for a citizen or PR child, else the dependant’s pass issue date), or empty'
	},
	{
		path: 'period.unpaid_full_days',
		description: 'Scheduled dates wholly unpaid, counted once per date; paid fractions do not count'
	},
	{
		path: 'period.leave_days.<CODE>',
		description: 'Approved working-day leave fractions of the named code in the assessment window'
	},
	{
		path: 'period.leave_full_days.<CODE>',
		description: 'Approved full working dates of the named leave code in the assessment window'
	},
	{
		path: 'period.leave_pay.<CODE>',
		description:
			'The salary the assessment window attributes to the named leave code’s days: salary × leave days ÷ working days, at most the salary'
	},
	{ path: 'period.working_days', description: 'Scheduled working days of the pay month' },
	{
		path: 'period.unpaid_days',
		description:
			'Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch'
	},
	{
		path: 'period.overtime_days',
		description:
			'Dates in the assessment window with overtime hours or hours inside the night window, counted once per date'
	},
	{
		path: 'period.arrears',
		description:
			'The wage of a deferred earlier period (a joiner after the cut-off) this payslip pays as back pay, already inside BASE; 0 otherwise. A law that prices each contribution month on its own wage caps it separately (ID PP 45/2015 art.29(1))'
	}
];

const PERSON_BLANK = {
	history: {},
	employee: {
		gender: '',
		age: 0,
		age_months: 0,
		birth_date: '',
		receiving_pension: false,
		citizenship: '',
		marital_status: '',
		spouse_status: '',
		dependents_count: 0,
		solo_parent: false,
		disabled: false,
		race: '',
		religion: '',
		residency_months: 0,
		presence_recorded: false,
		presence_days: 0,
		presence_linked_days: 0,
		presence_by_years_back: {},
		employment_days: 0,
		facts: {},
		fact_keys: []
	},
	worksite: { code: '', region: '', facts: {} },
	employment: {
		type: '',
		classification: '',
		risk_class: '',
		service_days: 0,
		service_periods: null,
		service_months: 0,
		service_months_exact: 0,
		prior_service_months: 0,
		service_years: 0,
		service_start: '',
		rule_date: '',
		exit_date: '',
		days_to_exit: 0,
		open_ended: true,
		contract_months: 0,
		contract_days: 0,
		exit_ground: '',
		exit_facts: {},
		exit_fact_keys: [],
		absent_days_12m: 0,
		history: { as_of: '', through: '', wages: null, piece_wages: null, leave: null }
	},
	terms: {
		basic_salary: 0,
		monthly_basic: 0,
		ordinary_day: 0,
		fixed_allowances: 0,
		monthly_wage: 0,
		gross_monthly: 0,
		monthly_wage_6m_average: 0,
		statutory_work_category: '',
		weather_dependent_piece: false,
		statutory_wages: 0,
		worksite: '',
		worksite_sector: '',
		department: '',
		payroll_group: '',
		paid_rest_days: false,
		grade: '',
		pay_frequency: '',
		pass_type: '',
		tax_residency: '',
		residency_since: '',
		notice_days: 0,
		ordinary_hours_per_week: 0,
		comparable_full_time_daily_hours: 0,
		comparable_full_time_presence: '',
		working_days_per_week: 0,
		facts: {},
		fact_keys: []
	},
	children: {
		records: null,
		count: 0,
		ages: [],
		citizens: 0,
		citizen_ages: [],
		classes: [],
		births: 0,
		birthdates: [],
		prior_childcare_days: 0,
		prior_extended_childcare_days: 0,
		prior_infant_care_days: 0
	},
	company: { region: '', headcount: 1, headcount_citizens: 1, pay_frequency: '', facts: {} },
	wage_floor: 0,
	wage_floor_pay: {
		BASE: 0,
		OVERTIME: 0,
		DAY_PAY: 0,
		NIGHT_PREMIUM: 0,
		OVERTIME_PREMIUM: 0,
		ABSENCE: 0,
		NO_PAY_LEAVE: 0,
		ENCASHMENT: 0,
		INCENTIVE: 0,
		NIGHT_WAGE: 0
	},
	period: {
		working_days: 22,
		unpaid_days: 0,
		unpaid_full_days: 0,
		leave_full_days: {},
		leave_days: {},
		leave_pay: {},
		overtime_days: 0,
		arrears: 0
	},
	facts: {},
	event: {
		kind: '',
		relationship: '',
		child_index: 0,
		wife_prior_living_biological_children: -1,
		date: '',
		child_citizenship: '',
		child_age: -1,
		child_shared_weeks: -1,
		prior_employment_days: 0,
		estimated_delivery_date: '',
		adoption_eligibility_date: '',
		case: { facts: {} }
	}
};

const personFields = (prefix: string): ContextField[] =>
	PERSON_ROOT_FIELDS.map((field) => ({
		path: `${prefix}${field.path}`,
		description: field.description
	}));

/** A shallow clone is not enough: a blank is mutated by no one, but nested objects are shared. */
const personBlank = () => structuredClone(PERSON_BLANK);

const PERIOD_FIELDS: readonly ContextField[] = [
	{ path: 'key', description: 'YYYY-MM or YYYY-MM-n' },
	{ path: 'month', description: 'The pay month, 1–12' },
	{ path: 'start', description: 'First day of the pay period' },
	{ path: 'end', description: 'Last day of the pay period' },
	{ path: 'pay_date', description: 'Scheduled day this payroll run pays income' },
	{ path: 'index', description: 'Which instalment of the month this period is' },
	{ path: 'instalments', description: 'Instalments the month is paid in' },
	{
		path: 'month_factor',
		description:
			'What this instalment’s wage is multiplied by to state the month’s: 1 for a month, 2 for a half, 52/12 for a week — a MONTH-assessed scheme’s base is scaled by it, so a base that already states the month divides by it'
	},
	{ path: 'last_of_year', description: 'This period closes the tax year, or is a leaver’s last' },
	{
		path: 'days_employed',
		description:
			'Days of the pay month the employment covered, in the proration basis’s units (the payslip’s proration segments summed)'
	},
	{ path: 'days_in_month', description: 'Calendar days of the pay month' }
];

const periodFields = (prefix: string): ContextField[] =>
	PERIOD_FIELDS.map((field) => ({
		path: `${prefix}${field.path}`,
		description: field.description
	}));

const PERIOD_BLANK = {
	key: '',
	year: 2026,
	month: 1,
	start: '',
	end: '',
	pay_date: '',
	index: 1,
	instalments: 1,
	month_factor: 1,
	last_of_year: false,
	days_employed: 0,
	days_in_month: 0
};

const YEAR_FIELDS: readonly ContextField[] = [
	{ path: 'start', description: 'First day of the tax year' },
	{ path: 'end', description: 'Last day of the tax year' },
	{
		path: 'months_employed',
		description:
			'The calendar months of the tax year this employment touches through the period end, the join and exit months counted whole'
	},
	{
		path: 'earned.<code>',
		description:
			'Earned under a component code this tax year: earlier PAID payslips only, plus this run’s own lines where the site prices them'
	},
	{
		path: 'earned.ABSENCE',
		description:
			'Every unpaid day this tax year, absence and no-pay leave, as a magnitude: `earned.BASIC - earned.ABSENCE` is the basic actually earned'
	}
];

const yearFields = (prefix: string): ContextField[] =>
	YEAR_FIELDS.map((field) => ({ path: `${prefix}${field.path}`, description: field.description }));

const SCHEME_FIELDS: readonly ContextField[] = [
	{ path: 'code', description: 'The scheme code' },
	{
		path: 'assessment_period',
		description: 'PAY_PERIOD | MONTH | MONTH_TO_DATE | QUARTER | YEAR'
	},
	{
		path: 'registration_status',
		description:
			'The declaration priced by this rule (a historical covered standing when an insured period ended)'
	},
	{
		path: 'current_registration_status',
		description:
			'The declaration at assessment end; registration_status may instead be a covered historical standing priced for earlier days'
	},
	{
		path: 'declaration_reference',
		description: 'The supporting reference for a documented NOT_REGISTERED election'
	},
	{
		path: 'year_to_date.base',
		description:
			'Base already charged this tax year: this employer’s earlier slips plus what an earlier employer declared on the fact (`opening`)'
	},
	{
		path: 'year_to_date.ordinary',
		description:
			'The ordinary part of the base already charged this tax year, where the scheme states `ordinary_on`'
	},
	{ path: 'year_to_date.employee', description: 'Employee amount already charged this tax year' },
	{ path: 'year_to_date.employer', description: 'Employer amount already charged this tax year' },
	{
		path: 'year_to_date.rebate',
		description:
			'Rebatable payments already recorded this tax year, including declared prior-employer payments'
	},
	{
		path: 'last_year.base',
		description:
			'Base this employer charged in the tax year before this one (no prior-employer opening) — ID PP 68/2009 art.2(2) joins severance parts across two calendar years'
	},
	{
		path: 'last_year.employee',
		description: 'Employee amount this employer charged in the tax year before this one'
	},
	{
		path: 'last_year.employer',
		description: 'Employer amount this employer charged in the tax year before this one'
	},
	{
		path: 'first_year',
		description:
			'Earliest tax year in which one of this employer’s earlier slips charged a base on this scheme, 0 when none — ID PP 68/2009 art.6 counts the third calendar year from the first severance part'
	},
	{
		path: 'dependent_months',
		description:
			'Sum of registered eligible dependant counts over the tax year’s twelve months; required for an authorised annual finalisation (VN Decree 253/2026 art.48)'
	},
	{
		path: 'trailing_short.base',
		description:
			'Average paid wages over the last payroll.trailing_wage_short_months calendar months of this employment, across tax years, for piece work (ID PP 44/2015 art.19(4): 3)'
	},
	{
		path: 'trailing_short.months',
		description: 'Months of this employment in the short lookback'
	},
	{
		path: 'trailing_long.base',
		description:
			'Average paid wages over the last payroll.trailing_wage_long_months calendar months of this employment, across tax years, for weather-dependent piece work (ID PP 44/2015 art.19(5): 12)'
	},
	{
		path: 'trailing_long.months',
		description: 'Months of this employment in the long lookback'
	},
	{
		path: 'projection.payslips_remaining',
		description: 'Payslips left in the year, this one included'
	},
	{ path: 'projection.future_equivalents', description: 'Future payslips of this size' },
	{
		path: 'rate_override',
		description: 'The employment flat rate override percentage, 0 when none'
	},
	{ path: 'since', description: 'The day this employment registered with the scheme, or empty' },
	{
		path: 'first_contribution_due_on',
		description:
			'First date contributions were legally due under this scheme, including earlier employers, or empty. Independent of registration and payment dates.'
	},
	{ path: 'since_months', description: 'Completed months since registration, 0 when unrecorded' },
	{
		path: 'elections.<key>',
		description: 'The employment’s elections under this scheme, keys the scheme row declares'
	},
	{
		path: 'election_keys',
		description:
			'Keys explicitly recorded on the effective statutory declaration. Test membership to distinguish a missing input from a declared zero, false or empty value.'
	},
	{
		path: 'child_claims.<class>.full',
		description:
			'Declared children for this tax year and relief class claimed in whole; zero without a declaration. Independent of family records.'
	},
	{
		path: 'child_claims.<class>.half',
		description:
			'Declared children for this tax year and relief class whose relief is shared with another claimant; the rule states the share. Zero without a declaration.'
	},
	{
		path: 'deductions.<category>',
		description:
			'Declared deduction amounts through this month in the current tax year, before category limits'
	},
	{
		path: 'deductions_current.<category>',
		description:
			'This employer’s accepted deduction claims for the current month, before category limits'
	},
	{
		path: 'deductions_prior.<category>',
		description:
			'Earlier-month and prior-employer deduction claims in the current tax year, before category limits'
	},
	{
		path: 'deductions_prior_employer.<category>',
		description: 'Prior-employer deductions in the current tax year through this month'
	},
	{
		path: 'deduction_claim_counts.<category>',
		description:
			'Distinct claim references with a positive net amount after corrections, through this month in the current tax year'
	},
	{
		path: 'deduction_claims_missing_event.<category>',
		description:
			'Deduction claims without a linked event reference in the current tax year through this month'
	},
	{
		path: 'deduction_claims_negative_event.<category>',
		description:
			'Linked event references whose signed corrections produce a negative net claim in the current tax year through this month'
	},
	{
		path: 'deductions_last_year.<category>',
		description: 'Declared deductions in the preceding tax year, for claim-frequency limits'
	},
	{
		path: 'deductions_two_years_ago.<category>',
		description: 'Declared deductions two tax years earlier, for claim-frequency limits'
	}
];

const schemeFields = (prefix: string): ContextField[] =>
	SCHEME_FIELDS.map((field) => ({
		path: `${prefix}${field.path}`,
		description: field.description
	}));

const PRODUCED_FIELDS: readonly ContextField[] = [
	{
		path: 'employee',
		description:
			'The relievable employee share, capped and projected; for an uncapped producer it is the year to date plus this period'
	},
	{
		path: 'employee_normal',
		description:
			'The relievable employee share for normal-pay tax: excludes current additional remuneration from projected producers, with the same prior-year-to-date contributions and annual cap'
	},
	{
		path: 'employee_this_period',
		description:
			'The employee share charged this period alone, floored at zero — the relief a per-period withholding table subtracts'
	},
	{
		path: 'employee_month_estimate',
		description:
			'The employee share a month-assessed producer would charge on this instalment’s wage scaled to the month (`period.month_factor`); `employee_this_period` where the month is paid at once — the monthly contribution a per-payment withholding annualises (TH P.96/2543 cl.1(2))'
	},
	{ path: 'employer', description: 'The employer share' },
	{
		path: 'base',
		description:
			'The producer’s assessed base before instalment allocation. Company assessments read the sum of settled bases across their assessment interval.'
	}
];

const producedFields = (prefix: string): ContextField[] =>
	PRODUCED_FIELDS.map((field) => ({
		path: `${prefix}${field.path}`,
		description: field.description
	}));

const HISTORY_FIELDS: readonly ContextField[] = [
	{
		path: 'history.<code>.periods',
		description:
			'Prior paid and declared opening assessment periods normalized to the current cadence; excludes this period'
	},
	{
		path: 'history.<code>.base',
		description: 'Prior assessed base in the current tax year, including selected opening amounts'
	},
	{
		path: 'history.<code>.ordinary',
		description:
			'Prior ordinary assessed base in the current tax year, including selected opening amounts'
	},
	{
		path: 'history.<code>.employee',
		description: 'Prior employee charge in the current tax year, including selected opening amounts'
	},
	{
		path: 'history.<code>.employer',
		description: 'Prior employer charge in the current tax year, including selected opening amounts'
	},
	{
		path: 'history.<code>.triggered',
		description:
			"Whether an earlier assessment met the scheme's `history_trigger`; false when it declares none"
	},
	{
		path: 'history.<code>.has_opening',
		description: 'Whether a selected prior-employer declaration exists, including an all-zero one'
	}
];

/** The functions every site carries but the assessment site's own. */
const COMMON_FUNCTIONS: readonly ExpressionFunction[] = [
	{ path: 'bracket(base, up_to, step)', description: 'Round a figure up to the next bracket' },
	{ path: 'ladder(base, grades)', description: 'Step a figure up to the next grade in a table' },
	{
		path: 'progressive(value, table)',
		description: 'Apply a progressive [from, base, rate] table'
	},
	{
		path: 'add_months(date, months)',
		description:
			'The calendar day `months` months after a `YYYY-MM-DD` day, clamped to the month’s last day; empty for an empty day'
	},
	{
		path: 'months_through(from, through)',
		description:
			'Months from one `YYYY-MM-DD` day through another inclusive: completed months plus the part month by its days; 0 when either is empty or `through` is before `from`'
	}
];

const EARNED_AVERAGE: ExpressionFunction = {
	path: 'earned_average(code, months_back, months)',
	description:
		'The average of a component’s earnings on the person’s earlier payslips over `months` calendar months, the window ending `months_back` months before this pay month; 0 with no history in the window. `code` may be a list of codes — reserved lines among them (`OVERTIME`) — summed month by month (TW 施行細則 §27: the three-month average of 工資, overtime included); a scheme part (`WTAX.RICE`) sums every class counting toward it'
};

const DAYS_UNDER: ExpressionFunction = {
	path: 'days_under(age)',
	description: 'Calendar days employed in the assessment window before the specified birthday.'
};

const MINIMUM_WAGE: ExpressionFunction = {
	path: 'minimum_wage(region)',
	description: 'The version’s minimum wage for a region'
};

const ANNUAL_EXEMPT: ExpressionFunction = {
	path: 'annual_exempt(amount, earned_before, cap)',
	description: 'The part still inside an annual exemption'
};

const CODE_FUNCTIONS: readonly ExpressionFunction[] = [
	{
		path: "code('X')",
		description:
			'The signed total of the version’s class X this payslip — for a law that caps or exempts one class alone (MY’s termination-benefit exemption, PH’s de-minimis rice subsidy)'
	}
];

/**
 * The catalogue words: one per money catalogue, each the sum of that catalogue's lines on this
 * payslip whose class lists the scheme being assessed in its `counts_toward`. A scheme that
 * declares parts reads a part as `<PART>.<WORD>` — `ORDINARY.ALLOWANCES` — and the tax year's
 * earlier PAID payslips as `year.<WORD>` / `year.<PART>.<WORD>`.
 */
export const CATALOGUE_WORDS = ['ALLOWANCES', 'ADHOC', 'CLAIMS'] as const;
export type CatalogueWord = (typeof CATALOGUE_WORDS)[number];
const CATALOGUE_WORD_FIELDS: readonly ContextField[] = [
	{
		path: 'ALLOWANCES',
		description:
			'The signed sum of this payslip’s allowance lines whose class counts toward this scheme'
	},
	{
		path: 'ADHOC',
		description:
			'The signed sum of this payslip’s ad hoc lines (bonus, back pay, separation pay, claw-backs) whose class counts toward this scheme'
	},
	{
		path: 'CLAIMS',
		description:
			'The signed sum of this payslip’s claim lines whose class counts toward this scheme'
	},
	{
		path: '<PART>.ALLOWANCES',
		description:
			'The allowance lines counting toward this scheme as the named part, where the scheme declares parts (SG CPF ORDINARY / ADDITIONAL)'
	},
	{ path: '<PART>.ADHOC', description: 'The ad hoc lines counting toward the named part' },
	{ path: '<PART>.CLAIMS', description: 'The claim lines counting toward the named part' },
	{
		path: 'year.ALLOWANCES',
		description:
			'The allowance lines counting toward this scheme over the tax year’s earlier PAID payslips (this payslip excluded — add `ALLOWANCES` for it)'
	},
	{ path: 'year.ADHOC', description: 'The same over the ad hoc lines' },
	{ path: 'year.CLAIMS', description: 'The same over the claim lines' },
	{
		path: 'year.<PART>.ALLOWANCES',
		description: 'The year’s earlier allowance lines of the named part'
	},
	{ path: 'year.<PART>.ADHOC', description: 'The year’s earlier ad hoc lines of the named part' },
	{ path: 'year.<PART>.CLAIMS', description: 'The year’s earlier claim lines of the named part' }
];

const functionsFor = (site: ExpressionSite): readonly ExpressionFunction[] => {
	const functions: ExpressionFunction[] = [
		...COMMON_FUNCTIONS,
		...REGISTERED_FUNCTIONS.flatMap((entry) =>
			entry.doc != null && (entry.sites == null || entry.sites.includes(site)) ? [entry.doc] : []
		)
	];
	if (site === 'person' || site === 'entry' || site === 'assessment' || site === 'scheme')
		functions.push(MINIMUM_WAGE);
	if (site === 'assessment') functions.push(...CODE_FUNCTIONS, EARNED_AVERAGE);
	if (site === 'derived_line') functions.push(...CODE_FUNCTIONS);
	if (site === 'assessment' || site === 'scheme')
		functions.push(DAYS_UNDER, {
			path: 'coverage_days(since, age, month_days)',
			description:
				'Covered days in the assessment month on a fixed calendar of month_days days, starting no earlier than employment and registration. Continuing coverage runs to day month_days whatever the month’s length; a termination uses its actual day, and a join its actual day, each capped at month_days. A positive age ends coverage before that birthday; 0 applies no age limit.'
		});
	if (site === 'assessment' || site === 'scheme')
		functions.push(
			ANNUAL_EXEMPT,
			{
				path: 'earned_quantity_exempt(code, limit)',
				description:
					'Earlier paid cash-out exempt within the annual day limit, valued at each payment’s original rate.'
			},
			{
				path: 'earned_monthly_excess(code, limit)',
				description:
					'Earlier payments in the tax year exceeding the allowance limit in each calendar month; `code` may be a scheme part (`WTAX.RICE`), every class counting toward it.'
			},
			{
				path: 'earned_daily_excess(code, share)',
				description:
					'Earlier payments in the tax year exceeding a per-day ceiling in each calendar month: `share` × the monthly `minimum_wage(region)` each earlier payslip was calculated at × its days with overtime or night-window hours (`person.period.overtime_days`) — the floor of that payslip’s own time, not today’s; `code` may be a scheme part (`WTAX.OT_MEAL`).'
			},
			{
				path: 'annual_quantity_exempt(code, limit)',
				description:
					'Current leave cash-out exempt within an annual day limit, after days paid earlier in the tax year. Each entry retains its own rate.'
			}
		);
	if (site === 'work_day')
		functions.push({
			path: 'run_hours_before_rest(minutes)',
			description:
				'Hours worked before the day’s first rest of at least `minutes` (a double, `60.0`); the whole day where none — read by `day_rules` and `overtime_consent`'
		});
	if (site === 'entry')
		functions.push({
			path: 'leave.days(code)',
			description: 'Charged days of one leave code in the leave window this payslip settles'
		});
	return functions;
};

const ENTITY_CONTEXT: ExpressionContext = {
	site: 'entity',
	description: 'The employing entity and its declared jurisdiction inputs.',
	fields: [
		{ path: 'company.settings_code', description: 'Jurisdiction settings lineage' },
		{ path: 'company.region', description: 'Registered payroll region' },
		{ path: 'company.pay_frequency', description: 'MONTHLY | SEMI_MONTHLY | WEEKLY' },
		{ path: 'company.facts.<key>', description: 'Declared jurisdiction input' },
		{ path: 'company.fact_keys', description: 'Keys explicitly recorded on the entity' }
	],
	bare: [],
	open: ['company.facts'],
	functions: functionsFor('entity'),
	blank: {
		company: { settings_code: '', region: '', pay_frequency: 'MONTHLY', facts: {}, fact_keys: [] }
	}
};

const PERSON_CONTEXT: ExpressionContext = {
	site: 'person',
	description: 'The person on the rule date: catalogue and scheme eligibility.',
	fields: PERSON_ROOT_FIELDS,
	bare: ['wage_floor'],
	open: [
		'company.facts',
		'facts',
		'period.leave_full_days',
		'period.leave_days',
		'period.leave_pay',
		'employment.exit_facts',
		'employee.facts',
		'worksite.facts',
		'terms.facts',
		'event.case.facts'
	],
	functions: functionsFor('person'),
	blank: personBlank()
};

/**
 * The rest-break rule's site: the person, plus what the day's punches measured.
 *
 * `selectBreakRule` evaluates a version's `breaks` over exactly this merge — the person context
 * (so a rule may turn on an entity fact) with the run, the overtime and the night hours beside
 * it — which no other site expresses, so the write-time check gets its own.
 */
const REST_BREAK_CONTEXT: ExpressionContext = {
	site: 'rest_break',
	description: 'One day’s rest-break obligation: the person, and what the day’s punches measured.',
	fields: [
		...PERSON_ROOT_FIELDS,
		{ path: 'consecutive_hours', description: 'The longest unbroken work run in the day' },
		{
			path: 'overtime_hours',
			description:
				'Payable overtime hours: the approved hours plus the day type’s clock-derived premium'
		},
		{ path: 'continuous_attendance', description: 'Work that must be carried on continuously' },
		{ path: 'night_hours', description: 'Hours inside the night window, 0 where none is declared' }
	],
	bare: [
		'wage_floor',
		'consecutive_hours',
		'overtime_hours',
		'continuous_attendance',
		'night_hours'
	],
	open: [
		'company.facts',
		'facts',
		'period.leave_full_days',
		'period.leave_days',
		'period.leave_pay',
		'employment.exit_facts',
		'employee.facts',
		'worksite.facts',
		'terms.facts'
	],
	functions: functionsFor('person'),
	blank: {
		...personBlank(),
		consecutive_hours: 0,
		overtime_hours: 0,
		continuous_attendance: false,
		night_hours: 0
	}
};

const LEAVE_DAY_CONTEXT: ExpressionContext = {
	site: 'leave_day',
	description: 'One charged day of leave: the person that day, and where in the leave it falls.',
	fields: [
		...PERSON_ROOT_FIELDS,
		{ path: 'leave.month_index', description: 'Which month of the leave the day is in, from 1' },
		{ path: 'leave.day_index', description: 'Which calendar day of the leave, from 1' },
		{ path: 'leave.days', description: 'The days the whole entry charges' },
		{
			path: 'leave.event_day',
			description:
				'Which charged day of the event, from 1, counting this day: across every entry of the code naming the same event date, else this entry’s (VN Labour Code art.99(3): the first 14 working days of a stoppage)'
		},
		{
			path: 'leave.taken(code)',
			description:
				'The days of that leave code charged in the leave year before this day, across every entry (TW 勞工請假規則 §4(3): thirty half-paid 普通傷病假 days a year, hospitalised or not)'
		},
		{
			path: 'leave.facts.<key>',
			description:
				'An event or state input the catalogue row declares in `event_facts`, as the entry records it, defaults filled'
		},
		{
			path: 'leave.episode_id',
			description:
				'The entry that opened this leave’s episode (`leave_entries.episode_id`), the entry itself when it opens one'
		}
	],
	bare: ['wage_floor'],
	open: [
		'company.facts',
		'facts',
		'period.leave_full_days',
		'period.leave_days',
		'period.leave_pay',
		'employment.exit_facts',
		'employee.facts',
		'worksite.facts',
		'terms.facts',
		'leave.facts'
	],
	functions: functionsFor('person'),
	blank: {
		...personBlank(),
		leave: {
			month_index: 1,
			day_index: 1,
			days: 1,
			event_day: 1,
			year_taken: {},
			facts: {},
			episode_id: ''
		}
	}
};

const ENTRY_CONTEXT: ExpressionContext = {
	site: 'entry',
	description: 'One catalogue entry as the run collects it: band amounts and the charged days.',
	fields: [
		...personFields('person.'),
		{ path: 'entry.amount', description: 'The keyed amount; zero where the entry carries none' },
		{ path: 'entry.days', description: 'Charged days' },
		{ path: 'entry.hours', description: 'Recorded hours' },
		{ path: 'entry.quantity', description: 'Recorded quantity' },
		{ path: 'entry.event_date', description: 'The day the entry belongs to' },
		{ path: 'entry.period', description: 'Pay period key the entry settles in' },
		{
			path: 'entry.religious_holidays',
			description:
				'Published holidays of the entity in the entry’s calendar year that name the employee’s recorded religion (`jurisdiction_holidays.religion`); 0 without a religion or a tagged day. ID Permenaker 6/2016 art.5(2): the same holiday twice in a year is two THRs'
		},
		{
			path: 'entry.incurred_on',
			description: 'The day a claimed expense was incurred; empty off a claim'
		},
		{
			path: 'entry.due_on',
			description:
				'The day a claim becomes payable where later than the expense (`claim_requests.due_on`), else empty'
		},
		{
			path: 'entry.facts.<key>',
			description:
				'Request inputs the catalogue row declares in `request_facts`, recorded on the request; a declared default where unrecorded'
		},
		{ path: 'entry.late_wage.due_on', description: 'Day the late wage was due' },
		{ path: 'entry.late_wage.paid_on', description: 'Day the late wage was paid' },
		{
			path: 'entry.late_wage.days',
			description: 'Calendar days from the due day to the paid day; 0 without a late wage'
		},
		{
			path: 'entry.late_wage.deposit_rate',
			description:
				'The payroll bank’s published 1-month term-deposit rate (% a year) on the paid day (VN Labour Code art.97(4))'
		},
		{ path: 'entry.late_wage.force_majeure', description: 'The delay was caused by force majeure' },
		{ path: 'entry.window.start', description: 'Standing allowance window start' },
		{ path: 'entry.window.end', description: 'Standing allowance window end' },
		{ path: 'entry.captures.remaining', description: 'Amount still to settle' },
		{ path: 'rates.ordinary_day', description: 'Ordinary day rate for the entry date' },
		{
			path: 'entry.unpaid_salary',
			description:
				'Salary earned but unpaid on this final payslip, before tax and statutory deductions (PH RA 10361 s.32)'
		},
		{ path: 'rates.ordinary_hour', description: 'Ordinary hour rate for the entry date' },
		{ path: 'limits.<key>', description: 'Evaluated work limit, net worked hours' },
		...periodFields('period.'),
		...yearFields('year.'),
		{
			path: 'leave.days(code)',
			description: 'Charged days of one leave code in the leave window this payslip settles'
		}
	],
	bare: [],
	open: [
		'limits',
		'year',
		'person.company.facts',
		'person.facts',
		'person.period.leave_full_days',
		'person.period.leave_days',
		'person.period.leave_pay',
		'person.employment.exit_facts',
		'person.employee.facts',
		'person.worksite.facts',
		'person.terms.facts',
		'entry.facts'
	],
	functions: functionsFor('entry'),
	blank: {
		person: personBlank(),
		entry: {
			amount: 0,
			unpaid_salary: 0,
			days: 0,
			hours: 0,
			quantity: 0,
			event_date: '',
			period: '',
			religious_holidays: 0,
			incurred_on: '',
			due_on: '',
			facts: {},
			late_wage: { due_on: '', paid_on: '', days: 0, deposit_rate: 0, force_majeure: false },
			window: { start: '', end: '' },
			captures: { remaining: 0 }
		},
		rates: { ordinary_day: 0, ordinary_hour: 0 },
		limits: {},
		period: structuredClone(PERIOD_BLANK),
		year: { start: '', end: '', months_employed: 0, earned: { BASIC: 0, ABSENCE: 0 } },
		leave: {}
	}
};

const WORK_DAY_CONTEXT: ExpressionContext = {
	site: 'work_day',
	description: 'One priced person-day: work bands and owed breaks.',
	fields: [
		...personFields('person.'),
		{ path: 'date', description: 'The day' },
		{
			path: 'day_type',
			description: 'ORDINARY | REST_DAY | PUBLIC_HOLIDAY | SPECIAL_HOLIDAY | OFF_DAY'
		},
		{ path: 'worked_hours', description: 'Net worked hours' },
		{ path: 'normal_hours', description: 'The scheduled normal hours' },
		{
			path: 'comparable_full_time_daily_hours',
			description:
				'Similar full-time employee’s normal hours for this date, or the terms’ usual day'
		},
		{ path: 'hours_beyond_normal', description: 'Worked hours past the normal day' },
		{ path: 'hours_from_start_fraction', description: 'Worked share of a normal day, 0..1' },
		{
			path: 'overtime_hours',
			description:
				'Payable overtime hours: the approved hours plus the day type’s clock-derived premium'
		},
		{ path: 'consecutive_hours', description: 'Longest unbroken work run in the day' },
		{ path: 'continuous_attendance', description: 'Work that must be carried on continuously' },
		{ path: 'rest_day', description: 'The roster’s weekly rest day, whatever the holiday made it' },
		{
			path: 'statutory_rest',
			description:
				'The rest day the statute forbids work on — a REST code marked `statutory` (TW 勞基法 §36 例假; §40 pays a worked one a further day’s wage and owes a day off in lieu)'
		},
		{ path: 'off_day', description: 'The roster left the day unassigned before the holiday' },
		{
			path: 'night_hours',
			description:
				'Hours inside the night window, 0 where none is declared; a break rule reads it too'
		},
		{ path: 'requested_by', description: 'EMPLOYER | EMPLOYEE: who asked for rest-day work' },
		{
			path: 'emergency_cause',
			description:
				'The extra hours were forced by a disaster, accident or emergency (`work_days.emergency_cause`; TW 勞基法 §32(4), paid double by §24(1)(3)); outside the hours ceilings'
		},
		{
			path: 'time_off_in_lieu',
			description:
				'The worker elected time off instead of overtime pay (`work_days.time_off_in_lieu`; TW 勞基法 §32-1); bands honouring it leave the hours unpriced and the run warns what they would have paid'
		},
		{ path: 'ordinary_hour', description: 'Ordinary hour rate' },
		{ path: 'day_wage', description: 'Ordinary day wage' },
		{ path: 'hours', description: 'The hours this band consumed, for its price' },
		{ path: 'limits.<key>', description: 'Evaluated work limit, net worked hours' },
		{
			path: 'holiday.kind',
			description:
				'The published row on the date, in the day-type words: PUBLIC_HOLIDAY | SPECIAL_HOLIDAY | SUBSTITUTE | DOUBLE_HOLIDAY (two regular holidays on one date), or empty; unlike `day_type` it does not move with the precedence rule'
		},
		{ path: 'holiday.name', description: 'Published holiday name, or empty' },
		{
			path: 'holiday.prior_day_present',
			description:
				'Present, or on leave with pay, on the workday immediately preceding the holiday — a rest or non-work day, or an unworked holiday, looks further back (PH Handbook ch.2 §D–E); true on a day with no holiday'
		},
		{
			path: 'day_facts.<key>',
			description:
				'Jurisdiction inputs the version declares in `work_day_facts`, recorded on this person-day (`work_days.facts`); a declared default where unrecorded'
		},
		{
			path: 'day_fact_keys',
			description: 'Work-day input keys explicitly recorded on this person-day, before defaults'
		},
		...[
			['age_years', 'Completed years on the day; 0 without a birth date'],
			[
				'attendance_recorded',
				'The day carries attendance (`worked_intervals` is set); otherwise its shift is presumed worked'
			],
			[
				'first_work_at',
				'The first worked instant, a UTC ISO instant (`YYYY-MM-DDTHH:mm:ss.sssZ`), or empty'
			],
			['night_worked', 'Some work fell inside `work_rules.night_window`'],
			['first_night_at', 'The first worked instant inside the night window, or empty'],
			['holiday_work', 'Work on a day that is not ORDINARY'],
			['overtime_work', 'Work on an ORDINARY day beyond its normal hours'],
			[
				'rest_minutes_total',
				'Minutes of rest between the day’s work spans (a presumed shift’s break)'
			],
			['longest_rest_minutes', 'The longest single timed rest between work spans'],
			['longest_run_hours', 'The longest unbroken work span'],
			[
				'rest_before_overtime_minutes',
				'Minutes between the end of the normal hours and the first overtime hour, 0 without overtime'
			],
			['shift_hours', 'The rostered shift’s paid hours, 0 without a shift'],
			['shift_start_at', 'The rostered shift’s start, a UTC ISO instant, or empty without a shift']
		].map(([path, description]) => ({
			path: path!,
			description: `${description} — read by \`day_rules\` and \`overtime_consent\`, not by bands`
		})),
		{
			path: 'stated_day_hours',
			description:
				'The statute’s normal day bounded by the contract’s stated day — read by `shift_day_hours` only, beside `person`, `date` and `day_facts`'
		}
	],
	bare: [
		'age_years',
		'attendance_recorded',
		'first_work_at',
		'night_worked',
		'first_night_at',
		'holiday_work',
		'overtime_work',
		'rest_minutes_total',
		'longest_rest_minutes',
		'longest_run_hours',
		'rest_before_overtime_minutes',
		'shift_hours',
		'shift_start_at',
		'stated_day_hours',
		'day_fact_keys',
		'date',
		'day_type',
		'worked_hours',
		'normal_hours',
		'comparable_full_time_daily_hours',
		'hours_beyond_normal',
		'hours_from_start_fraction',
		'overtime_hours',
		'consecutive_hours',
		'continuous_attendance',
		'rest_day',
		'statutory_rest',
		'off_day',
		'night_hours',
		'requested_by',
		'emergency_cause',
		'time_off_in_lieu',
		'ordinary_hour',
		'day_wage',
		'hours'
	],
	open: [
		'limits',
		'day_facts',
		'person.company.facts',
		'person.facts',
		'person.period.leave_full_days',
		'person.period.leave_days',
		'person.period.leave_pay',
		'person.employment.exit_facts',
		'person.employee.facts',
		'person.worksite.facts',
		'person.terms.facts'
	],
	functions: functionsFor('work_day'),
	blank: {
		person: personBlank(),
		date: '',
		day_type: 'ORDINARY',
		worked_hours: 13,
		normal_hours: 9,
		comparable_full_time_daily_hours: 8,
		hours_beyond_normal: 4,
		hours_from_start_fraction: 1,
		overtime_hours: 4,
		consecutive_hours: 4,
		continuous_attendance: false,
		rest_day: false,
		statutory_rest: false,
		off_day: false,
		night_hours: 0,
		requested_by: 'EMPLOYER',
		emergency_cause: false,
		time_off_in_lieu: false,
		ordinary_hour: 25.5,
		day_wage: 204,
		hours: 4,
		limits: {},
		holiday: { kind: '', name: '', prior_day_present: true },
		day_facts: {},
		day_fact_keys: [],
		age_years: 40,
		attendance_recorded: true,
		first_work_at: '',
		night_worked: false,
		first_night_at: '',
		holiday_work: false,
		overtime_work: false,
		rest_minutes_total: 60,
		longest_rest_minutes: 60,
		longest_run_hours: 4,
		rest_before_overtime_minutes: 0,
		shift_hours: 9,
		shift_start_at: '',
		stated_day_hours: 8
	}
};

/**
 * One actual payment and the obligation it settles: the site of `payment_facts` and
 * `settlement_facts` conditions. A settlement's facts are empty until its obligation records them.
 */
const PAYMENT_CONTEXT: ExpressionContext = {
	site: 'payment',
	description: 'One actual payment and the obligation it settles: their declared inputs.',
	fields: [
		{ path: 'payment.kind', description: 'CASH | NON_CASH_SETTLEMENT' },
		{ path: 'payment.paid_on', description: 'The day the payment was made, `YYYY-MM-DD`' },
		{ path: 'payment.currency', description: 'The payment currency' },
		{
			path: 'payment.facts.<key>',
			description:
				'Jurisdiction inputs the version declares in `payment_facts`, recorded with the payment'
		},
		{ path: 'payment.fact_keys', description: 'Payment input keys explicitly recorded' },
		{
			path: 'settlement.tax_residency',
			description:
				'RESIDENT | NON_RESIDENT: the evidenced tax residence of the settled non-contract obligation; empty for a payslip'
		},
		{
			path: 'settlement.facts.<key>',
			description:
				'Jurisdiction inputs the version declares in `settlement_facts`, recorded on the settled obligation'
		},
		{ path: 'settlement.fact_keys', description: 'Settlement input keys explicitly recorded' }
	],
	bare: [],
	open: ['payment.facts', 'settlement.facts'],
	functions: functionsFor('payment'),
	blank: {
		payment: { kind: 'CASH', paid_on: '', currency: '', facts: {}, fact_keys: [] },
		settlement: { tax_residency: '', facts: {}, fact_keys: [] }
	}
};

/** The entity on the scheme and assessment sites (E7): its declared facts and its tax year. */
const COMPANY_FIELDS: readonly ContextField[] = [
	{
		path: 'company.facts.<key>',
		description: 'The entity’s declared inputs (the same values as `person.company.facts`)'
	},
	{ path: 'company.year.from', description: 'The tax year’s first day, `YYYY-MM-DD`' },
	{ path: 'company.year.to', description: 'The tax year’s last day, `YYYY-MM-DD`' }
];
const COMPANY_BLANK = () => ({ facts: {}, year: { from: '', to: '' } });

/** The reserved lines: engine money, magnitudes with the sign written in the formula. */
const RESERVED_LINES: readonly ContextField[] = [
	{ path: 'BASE', description: 'The salary line' },
	{ path: 'OVERTIME', description: 'Every overtime and incentive line' },
	{
		path: 'DAY_PAY',
		description:
			'Band day pay posted to its own line (`bands[].line`): a day the law prices but does not count as overtime; outside BASE and OVERTIME'
	},
	{ path: 'NIGHT_PREMIUM', description: 'The night premium line' },
	{
		path: 'OVERTIME_PREMIUM',
		description:
			'The part of every overtime line above the ordinary hour: amount less hours × ordinary hour'
	},
	{ path: 'ABSENCE', description: 'Unexplained absence and every unpaid leave day' },
	{ path: 'NO_PAY_LEAVE', description: 'Unpaid leave days' },
	{ path: 'ENCASHMENT', description: 'Every encashed leave day' },
	{
		path: 'INCENTIVE',
		description:
			'The incentive lines: the planned hours beyond the statutory limits, priced at the band’s award; also inside OVERTIME'
	},
	{
		path: 'NIGHT_WAGE',
		description:
			'The ordinary (not overtime) hours inside the night window at the ordinary hour — already inside BASE; a law that exempts the whole night-work wage, not only its premium, subtracts it'
	}
];

const ASSESSMENT_CONTEXT: ExpressionContext = {
	site: 'assessment',
	description: 'One scheme’s wage: the reserved lines, the catalogue rows and the shared roots.',
	fields: [
		...personFields('person.'),
		...periodFields('period.'),
		{ path: 'period.year', description: 'Calendar year of the pay period' },
		...yearFields('year.'),
		{
			path: 'year.payments',
			description:
				'The payments due in the tax year at this cadence, from the join to the year end (monthly: months, adding declared prior-employer months as `months_employed` does; semi-monthly: halves; weekly: paydays)'
		},
		...schemeFields('scheme.'),
		...producedFields('produced.<code>.'),
		...HISTORY_FIELDS,
		...COMPANY_FIELDS,
		...RESERVED_LINES,
		...CATALOGUE_WORD_FIELDS
	],
	bare: [...RESERVED_LINES.map((field) => field.path), ...CATALOGUE_WORDS],
	open: [
		'produced',
		'history',
		'company.facts',
		'year',
		'scheme.elections',
		'scheme.child_claims',
		...DEDUCTION_TOTAL_KEYS.map((key) => `scheme.${key}`),
		'person.company.facts',
		'person.facts',
		'person.period.leave_full_days',
		'person.period.leave_days',
		'person.period.leave_pay',
		'person.employment.exit_facts',
		'person.employee.facts',
		'person.worksite.facts',
		'person.terms.facts'
	],
	functions: functionsFor('assessment'),
	blank: {
		company: COMPANY_BLANK(),
		person: personBlank(),
		period: structuredClone(PERIOD_BLANK),
		year: {
			start: '',
			end: '',
			months_employed: 0,
			payments: 12,
			earned: { BASIC: 0, ABSENCE: 0 },
			ALLOWANCES: 0,
			ADHOC: 0,
			CLAIMS: 0
		},
		scheme: {
			code: '',
			assessment_period: 'PAY_PERIOD',
			registration_status: 'UNDECLARED',
			current_registration_status: 'UNDECLARED',
			declaration_reference: '',
			year_to_date: { base: 0, employee: 0, employer: 0, ordinary: 0, rebate: 0 },
			last_year: { base: 0, employee: 0, employer: 0 },
			first_year: 0,
			dependent_months: 0,
			trailing_short: { base: 0, months: 0 },
			trailing_long: { base: 0, months: 0 },
			projection: { payslips_remaining: 1, future_equivalents: 0 },
			rate_override: 0,
			since: '',
			first_contribution_due_on: '',
			since_months: 0,
			elections: {},
			election_keys: [],
			child_claims: {},
			...Object.fromEntries(DEDUCTION_TOTAL_KEYS.map((key) => [key, {}]))
		},
		produced: {
			SCHEME: {
				base: 0,
				employee: 0,
				employee_normal: 0,
				employee_this_period: 0,
				employee_month_estimate: 0,
				employer: 0
			}
		},
		history: {},
		BASE: 0,
		OVERTIME: 0,
		DAY_PAY: 0,
		NIGHT_PREMIUM: 0,
		OVERTIME_PREMIUM: 0,
		ABSENCE: 0,
		NO_PAY_LEAVE: 0,
		ENCASHMENT: 0,
		INCENTIVE: 0,
		NIGHT_WAGE: 0,
		ALLOWANCES: 0,
		ADHOC: 0,
		CLAIMS: 0
	}
};

const SCHEME_CONTEXT: ExpressionContext = {
	site: 'scheme',
	description: 'One statutory scheme for one person and period: rules and rate bands.',
	fields: [
		...personFields('person.'),
		...periodFields('period.'),
		{ path: 'period.year', description: 'Calendar year of the pay period' },
		...yearFields('year.'),
		{
			path: 'year.payments',
			description:
				'The payments due in the tax year at this cadence, from the join to the year end (monthly: months, adding declared prior-employer months as `months_employed` does; semi-monthly: halves; weekly: paydays)'
		},
		...schemeFields('scheme.'),
		...producedFields('produced.<code>.'),
		...HISTORY_FIELDS,
		...COMPANY_FIELDS,
		{ path: 'base', description: 'The result of the scheme’s `assessed_on` formula' },
		{
			path: 'scheme.deduction',
			description:
				'The selected rule’s allowable deduction, evaluated before employee, employer and rebate expressions; zero if omitted'
		},
		{
			path: 'ordinary',
			description:
				'The result of the scheme’s `ordinary_on` formula this period — the base itself where none is stated; `base - ordinary` is the additional part (MY MTD additional remuneration, SG Additional Wages)'
		}
	],
	bare: ['base', 'ordinary'],
	open: [
		'produced',
		'history',
		'company.facts',
		'year',
		'scheme.elections',
		'scheme.child_claims',
		...DEDUCTION_TOTAL_KEYS.map((key) => `scheme.${key}`),
		'person.company.facts',
		'person.facts',
		'person.period.leave_full_days',
		'person.period.leave_days',
		'person.period.leave_pay',
		'person.employment.exit_facts',
		'person.employee.facts',
		'person.worksite.facts',
		'person.terms.facts'
	],
	functions: functionsFor('scheme'),
	blank: {
		company: COMPANY_BLANK(),
		person: personBlank(),
		period: structuredClone(PERIOD_BLANK),
		year: {
			start: '',
			end: '',
			months_employed: 0,
			payments: 12,
			earned: { BASIC: 0, ABSENCE: 0 },
			ALLOWANCES: 0,
			ADHOC: 0,
			CLAIMS: 0
		},
		scheme: {
			code: '',
			deduction: 0,
			assessment_period: 'PAY_PERIOD',
			registration_status: 'UNDECLARED',
			current_registration_status: 'UNDECLARED',
			declaration_reference: '',
			year_to_date: { base: 0, employee: 0, employer: 0, ordinary: 0, rebate: 0 },
			last_year: { base: 0, employee: 0, employer: 0 },
			first_year: 0,
			dependent_months: 0,
			trailing_short: { base: 0, months: 0 },
			trailing_long: { base: 0, months: 0 },
			projection: { payslips_remaining: 1, future_equivalents: 0 },
			rate_override: 0,
			since: '',
			first_contribution_due_on: '',
			since_months: 0,
			elections: {},
			election_keys: [],
			child_claims: {},
			...Object.fromEntries(DEDUCTION_TOTAL_KEYS.map((key) => [key, {}]))
		},
		produced: {
			SCHEME: {
				base: 0,
				employee: 0,
				employee_normal: 0,
				employee_this_period: 0,
				employee_month_estimate: 0,
				employer: 0
			}
		},
		history: {},
		base: 0,
		ordinary: 0
	}
};

/** The person site's open prefixes, carried by the sites that read the person flat. */
const PERSON_OPEN = [
	'company.facts',
	'facts',
	'period.leave_full_days',
	'period.leave_days',
	'period.leave_pay',
	'employment.exit_facts',
	'employee.facts',
	'worksite.facts',
	'terms.facts'
] as const;

/** The person site's prefixes under `person.`, for the sites that carry the person as a root. */
const PERSON_OPEN_UNDER = [
	'person.company.facts',
	'person.facts',
	'person.period.leave_full_days',
	'person.period.leave_days',
	'person.period.leave_pay',
	'person.employment.exit_facts',
	'person.employee.facts',
	'person.worksite.facts',
	'person.terms.facts'
] as const;

/**
 * The rate site: the person on the rate's date, plus the contract's recurring pay by class — what
 * `work_rules.ordinary_rate`, `leave_pay_reference`, `encashment_reference` and `proration` state
 * the ordinary hour, the ordinary day and a leave day's pay from.
 */
const RATE_CONTEXT: ExpressionContext = {
	site: 'rate',
	description: 'The person on the rate’s date and the contract’s recurring pay by class.',
	fields: [
		...PERSON_ROOT_FIELDS,
		{
			path: 'contract.classes.<class>',
			description:
				'The contract’s recurring monthly amount of one component class in force on the rate’s date; 0 where the contract carries none'
		},
		{
			path: 'rate.date',
			description: 'The rate’s date `YYYY-MM-DD`: the rule date, or a cash-out’s event date'
		},
		{
			path: 'rate.boundary',
			description:
				'A leave cash-out’s boundary `YYYY-MM-DD`: the day after the leave year ends, or the exit; empty otherwise'
		}
	],
	bare: ['wage_floor'],
	open: [...PERSON_OPEN, 'contract.classes'],
	functions: functionsFor('rate'),
	blank: { ...personBlank(), contract: { classes: {} }, rate: { date: '', boundary: '' } }
};

/**
 * The obligation site: one duty instance — its trigger and what the trigger carries — for a duty
 * type's `due` (a `YYYY-MM-DD` date), `amount`, `late_charge` and `trigger.when`. Every root is
 * present on every trigger, blank where the trigger has none (`lib/obligations/materialise.ts`
 * builds it). `obligation.*` is the instance itself, read by `late_charge`.
 */
const OBLIGATION_CONTEXT: ExpressionContext = {
	site: 'obligation',
	description:
		'One duty instance: its trigger and what the trigger carries. Write money literals as doubles (`2.0`): a double member times an int literal has no overload.',
	fields: [
		{
			path: 'trigger.on',
			description:
				'RUN_FINALISED | PERIOD_CLOSE | HIRE | EXIT | FACT_CHANGE | CALENDAR | CASE_EVENT'
		},
		{
			path: 'trigger.date',
			description:
				'The event day `YYYY-MM-DD`: the pay date, service start, exit day, revision start or occurrence start'
		},
		{
			path: 'trigger.ref',
			description:
				'The event’s identity under its subject: run period, calendar occurrence, revision id, exit day'
		},
		{
			path: 'period.start',
			description: 'The run’s wage month start, or the occurrence’s first day; empty otherwise'
		},
		{
			path: 'period.end',
			description: 'The run’s wage month end, or the occurrence’s last day; empty otherwise'
		},
		{ path: 'company.settings_code', description: 'Jurisdiction settings lineage' },
		{ path: 'company.region', description: 'Registered payroll region' },
		{ path: 'company.pay_frequency', description: 'MONTHLY | SEMI_MONTHLY | WEEKLY' },
		{ path: 'company.headcount', description: 'Employments in force on `trigger.date`' },
		{
			path: 'company.facts.<key>',
			description: 'Declared entity input (the revision’s on FACT_CHANGE)'
		},
		{ path: 'employment.service_start', description: 'HIRE / EXIT: the service start day' },
		{ path: 'employment.exit_date', description: 'EXIT: the last day of employment' },
		{
			path: 'employment.exit_ground',
			description: 'EXIT: the recorded termination ground (a `TERMINATION_GROUND` code)'
		},
		{
			path: 'employment.exit_facts.<key>',
			description: 'EXIT: the departure inputs the version declares'
		},
		{ path: 'worksite.code', description: 'WORKSITE subject: the worksite’s code' },
		{ path: 'worksite.region', description: 'WORKSITE subject: the worksite’s region' },
		{
			path: 'worksite.facts.<key>',
			description: 'WORKSITE subject: the worksite’s declared facts'
		},
		{ path: 'run.period', description: 'RUN_FINALISED: the run’s period' },
		{ path: 'run.pay_date', description: 'RUN_FINALISED: the run’s pay date' },
		{ path: 'run.headcount', description: 'RUN_FINALISED: payslips the run settled' },
		{ path: 'run.gross', description: 'RUN_FINALISED: the run’s gross pay' },
		{ path: 'run.net', description: 'RUN_FINALISED: the run’s net pay' },
		{ path: 'run.employer_cost', description: 'RUN_FINALISED: the run’s employer cost' },
		{
			path: 'run.kind',
			description: 'RUN_FINALISED: REGULAR | OFF_CYCLE | FINAL | CORRECTION'
		},
		{
			path: 'run.sequence',
			description: 'RUN_FINALISED: the run’s place among its period’s runs, from 1'
		},
		{
			path: 'run.pay_due_date',
			description: 'RUN_FINALISED: the day the run’s wages fall due `YYYY-MM-DD`; empty where none'
		},
		{
			path: 'run.withheld.<code>',
			description:
				'RUN_FINALISED: what the run withheld for third parties under that loan catalogue code'
		},
		{
			path: 'run.remittances.<scheme>',
			description: 'RUN_FINALISED: the amount payable to one scheme'
		},
		{ path: 'case.type', description: 'CASE subject: the case type’s code' },
		{ path: 'case.facts.<key>', description: 'CASE subject: the case’s declared facts' },
		{ path: 'event.facts.<key>', description: 'The triggering record’s own declared facts' },
		{ path: 'obligation.due_on', description: '`late_charge`: the instance’s due day' },
		{ path: 'obligation.amount_due', description: '`late_charge`: the money the instance owes' },
		{
			path: 'obligation.days_late',
			description: '`late_charge`: calendar days past `due_on`, 0 while on time'
		}
	],
	bare: [],
	open: [
		'company.facts',
		'employment.exit_facts',
		'worksite.facts',
		'run.remittances',
		'run.withheld',
		'case.facts',
		'event.facts'
	],
	functions: functionsFor('obligation'),
	blank: {
		trigger: { on: '', date: '', ref: '' },
		period: { start: '', end: '' },
		company: { settings_code: '', region: '', pay_frequency: '', headcount: 0, facts: {} },
		employment: { service_start: '', exit_date: '', exit_ground: '', exit_facts: {} },
		worksite: { code: '', region: '', facts: {} },
		run: {
			period: '',
			pay_date: '',
			headcount: 0,
			gross: 0,
			net: 0,
			employer_cost: 0,
			remittances: {},
			kind: 'REGULAR',
			sequence: 1,
			pay_due_date: '',
			withheld: {}
		},
		case: { type: '', facts: {} },
		event: { facts: {} },
		obligation: { due_on: '', amount_due: 0, days_late: 0 }
	}
};

/** The money maps of one settled payslip, or of the row's payslips summed. */
const SLIP_MONEY = (prefix: string, what: string): ContextField[] => [
	{ path: `${prefix}gross`, description: `Gross pay of ${what}` },
	{ path: `${prefix}net`, description: `Net pay of ${what}` },
	{
		path: `${prefix}lines.<code>`,
		description: `The signed total of one catalogue code on ${what}`
	},
	{
		path: `${prefix}classes.<class>`,
		description: `The signed total of one component class on ${what}`
	},
	{ path: `${prefix}base.<scheme>`, description: `The assessed base of one scheme on ${what}` },
	{
		path: `${prefix}employee.<scheme>`,
		description: `The employee share of one scheme on ${what}`
	},
	{ path: `${prefix}employer.<scheme>`, description: `The employer share of one scheme on ${what}` }
];
const SLIP_BLANK = () => ({
	gross: 0,
	net: 0,
	lines: {},
	classes: {},
	base: {},
	employee: {},
	employer: {}
});
const SLIP_OPEN = ['lines', 'classes', 'base', 'employee', 'employer'] as const;

/**
 * The filing site: one row of a return or bank file — the person, the payslips the row covers and
 * their sums — for `returns[].columns[].value` and `population`.
 */
const FILING_CONTEXT: ExpressionContext = {
	site: 'filing',
	description:
		'One row of a return or bank file: the person, the settled payslips it covers, their sums.',
	fields: [
		{ path: 'filing.code', description: 'The return’s code' },
		{
			path: 'filing.period',
			description: 'The period the return covers: `YYYY-MM`, `YYYY-Qn`, or the year'
		},
		{ path: 'filing.year', description: 'The calendar or tax year the return covers' },
		{ path: 'filing.pay_date', description: 'The governing run’s pay day `YYYY-MM-DD`' },
		{
			path: 'filing.rows',
			description: 'Detail rows the file carries; on header and trailer records, the file’s count'
		},
		...[
			'employee_id',
			'employment_id',
			'employee_number',
			'name',
			'identity_number',
			'identity_type',
			'nationality',
			'designation',
			'department',
			'gender',
			'birth_date',
			'hire_date',
			'last_day',
			'departure_on'
		].map((key) => ({
			path: `payee.${key}`,
			description:
				key === 'identity_type'
					? 'The declared `identity_patterns` type the identity number matches'
					: `The row’s ${key.replaceAll('_', ' ')} as its latest settled payslip names it`
		})),
		{ path: 'payer.code', description: 'The entity’s originator bank code on the run' },
		{ path: 'payer.account', description: 'The entity’s originator account number' },
		{ path: 'payer.holder', description: 'The originator account holder’s name' },
		{ path: 'payer.bank_name', description: 'The originator bank’s name' },
		{ path: 'row.index', description: 'The row’s position in the file, from 1' },
		{ path: 'company.settings_code', description: 'Jurisdiction settings lineage' },
		{ path: 'company.name', description: 'The employing entity’s legal name' },
		{ path: 'company.facts.<key>', description: 'Declared entity input (registration numbers)' },
		...personFields('person.'),
		{ path: 'bank.code', description: 'The payee’s bank code; empty where none is recorded' },
		{ path: 'bank.account', description: 'The payee’s account number' },
		{ path: 'bank.holder', description: 'The account holder’s name' },
		...SLIP_MONEY('totals.', 'the row’s payslips summed'),
		{ path: 'totals.slips', description: 'How many payslips the row covers' },
		{
			path: 'slips',
			description:
				'The row’s payslips, oldest first, each `{period, pay_date, gross, net, lines, classes, base, employee, employer}` — `sum(slips.map(s, s.employee.CODE))`'
		}
	],
	bare: ['slips'],
	open: ['company.facts', ...SLIP_OPEN.map((key) => `totals.${key}`), ...PERSON_OPEN_UNDER],
	functions: functionsFor('filing'),
	blank: {
		filing: { code: '', period: '', year: 2026, pay_date: '', rows: 0 },
		payee: {
			employee_id: '',
			employment_id: '',
			employee_number: '',
			name: '',
			identity_number: '',
			identity_type: '',
			nationality: '',
			designation: '',
			department: '',
			gender: '',
			birth_date: '',
			hire_date: '',
			last_day: '',
			departure_on: ''
		},
		payer: { code: '', account: '', holder: '', bank_name: '' },
		row: { index: 1 },
		company: { settings_code: '', name: '', facts: {} },
		person: personBlank(),
		bank: { code: '', account: '', holder: '' },
		totals: { ...SLIP_BLANK(), slips: 0 },
		slips: []
	}
};

/**
 * The case site: one benefit case on one phase — its facts, the phase's days and the person's
 * contribution credits and earnings — for `case_types[].phases[].days`, `award` and
 * `qualifications`.
 */
const CASE_CONTEXT: ExpressionContext = {
	site: 'case',
	description:
		'One benefit case on one phase: its facts, the phase’s days, the credits and earnings behind it.',
	fields: [
		...personFields('person.'),
		{ path: 'case.kind', description: 'The case type’s code' },
		{ path: 'case.event_on', description: 'The `YYYY-MM-DD` day of the event the case is for' },
		{ path: 'case.started_on', description: 'The first day of the case' },
		{ path: 'case.ended_on', description: 'The last day of the case; empty while it runs' },
		{ path: 'case.facts.<key>', description: 'Inputs the case type declares, as recorded' },
		{ path: 'case.event_kind', description: 'The recorded event kind; empty before the event' },
		{ path: 'case.event_month', description: 'The event’s month, 1–12; 0 before the event' },
		{ path: 'case.application_on', description: 'The application day `YYYY-MM-DD`' },
		{
			path: 'case.evidenced',
			description:
				"The fact keys whose `fact_evidence` the declaration accepts — `'k' in case.evidenced`"
		},
		{ path: 'case.award', description: 'The actual award recorded; 0 until recorded' },
		{
			path: 'case.salary',
			description: 'The monthly salary the case’s pay replaces; 0 where the caller has none'
		},
		{ path: 'case.premiums', description: 'The employee’s premium shares over the case, summed' },
		{ path: 'phase.code', description: 'The phase’s code' },
		{ path: 'phase.index', description: 'Which phase of the case, from 1' },
		{ path: 'phase.start', description: 'The phase’s first day' },
		{ path: 'phase.end', description: 'The phase’s last day' },
		{ path: 'phase.days', description: 'Calendar days of the phase' },
		{
			path: 'phase.day_index',
			description: 'Which day of the phase is priced, from 1; 0 for a whole award'
		},
		{
			path: 'phase.award',
			description: 'The phase’s award, already priced (`wage` and later read it)'
		},
		{ path: 'phase.wage', description: 'The phase’s full wage, already priced' },
		{
			path: 'phase.employer_pays',
			description: 'What the employer pays for the phase, already priced (`reimbursable` reads it)'
		},
		{
			path: 'credits',
			description:
				'The person’s contribution credits before the event, oldest first, each `{period, amount, paid_on}` — `sum(credits.map(c, c.amount).top(6))`'
		},
		{
			path: 'earnings',
			description:
				'The person’s monthly earnings before the event, oldest first, each `{period, amount}`'
		},
		{
			path: 'previous',
			description:
				'The person’s earlier cases, oldest first, each `{kind, started_on, ended_on, days}` — `previous.filter(p, p.kind == case.kind).size()`'
		}
	],
	bare: ['credits', 'earnings', 'previous'],
	open: ['case.facts', ...PERSON_OPEN_UNDER],
	functions: functionsFor('case'),
	blank: {
		person: personBlank(),
		case: {
			kind: '',
			event_on: '',
			started_on: '',
			ended_on: '',
			facts: {},
			event_kind: '',
			event_month: 0,
			application_on: '',
			evidenced: [],
			award: 0,
			salary: 0,
			premiums: 0
		},
		phase: {
			code: '',
			index: 1,
			start: '',
			end: '',
			days: 0,
			day_index: 0,
			award: 0,
			wage: 0,
			employer_pays: 0
		},
		credits: [],
		earnings: [],
		previous: []
	}
};

/**
 * The check site (E9): the person on the stage's rule date, flat, with the stage's own roots —
 * `lib/checks.ts` `checkContext` builds it. Absent roots read blank, never fail.
 */
const CHECK_CONTEXT: ExpressionContext = {
	site: 'check',
	description:
		'One lifecycle stage of one employment: the person that day and what the stage carries.',
	fields: [
		...PERSON_ROOT_FIELDS,
		{
			path: 'check.at',
			description: 'EMPLOYMENT_START | TERMS_CHANGE | EXIT | PAYSLIP | LEAVE_ENTRY | DEDUCTION'
		},
		{ path: 'check.date', description: 'The stage’s rule date `YYYY-MM-DD`' },
		{
			path: 'obligations.open',
			description: "The duty codes still OPEN on the subject — `'X' in obligations.open`"
		},
		...PERSON_ROOT_FIELDS.filter((field) => field.path.startsWith('terms.')).flatMap((field) => [
			{
				path: `before.${field.path.slice(6)}`,
				description: `TERMS_CHANGE: the terms in force the day before — ${field.description}`
			},
			{
				path: `after.${field.path.slice(6)}`,
				description: `TERMS_CHANGE: the terms as they will be written — ${field.description}`
			}
		]),
		{ path: 'deduction.code', description: 'DEDUCTION: the deduction’s catalogue code' },
		{ path: 'deduction.amount', description: 'DEDUCTION: the line’s amount' },
		{ path: 'deduction.gross', description: 'DEDUCTION: the payslip’s gross pay' },
		{ path: 'deduction.net', description: 'DEDUCTION: net pay before this line' },
		{
			path: 'deduction.total',
			description: 'DEDUCTION: every deduction of the payslip, this one included'
		},
		{ path: 'leave.code', description: 'LEAVE_ENTRY: the leave catalogue code' },
		{ path: 'leave.from', description: 'LEAVE_ENTRY: the entry’s first day' },
		{ path: 'leave.to', description: 'LEAVE_ENTRY: the entry’s last day' },
		{ path: 'leave.days', description: 'LEAVE_ENTRY: the days it charges' },
		{ path: 'leave.facts.<key>', description: 'LEAVE_ENTRY: the entry’s declared event facts' },
		{ path: 'payslip.gross', description: 'PAYSLIP: gross pay' },
		{ path: 'payslip.net', description: 'PAYSLIP: net pay' },
		{ path: 'payslip.deductions', description: 'PAYSLIP: every deduction, summed' },
		{
			path: 'payslip.lines.<code>',
			description: 'PAYSLIP: the signed total of one catalogue code'
		},
		{ path: 'payslip.pay_date', description: 'PAYSLIP: the run’s pay date `YYYY-MM-DD`' }
	],
	bare: ['wage_floor'],
	open: [...PERSON_OPEN, 'before.facts', 'after.facts', 'leave.facts', 'payslip.lines'],
	functions: functionsFor('check'),
	blank: {
		...personBlank(),
		check: { at: '', date: '' },
		obligations: { open: [] },
		before: structuredClone(PERSON_BLANK.terms),
		after: structuredClone(PERSON_BLANK.terms),
		deduction: { code: '', amount: 0, gross: 0, net: 0, total: 0 },
		leave: { code: '', from: '', to: '', days: 0, facts: {} },
		payslip: { gross: 0, net: 0, deductions: 0, lines: {}, pay_date: '' }
	}
};

/**
 * The order site (L6): one deduction order on one payslip — `loans.recovery_rule`, evaluated by
 * `settleWithOrders` in `lib/payroll/loan.ts`. Money members are doubles: write `0.25`, `2200.0`.
 */
const ORDER_CONTEXT: ExpressionContext = {
	site: 'order',
	description:
		'One deduction order on one payslip. Money members are doubles: write literals as `0.25`, `2200.0`.',
	fields: [
		{ path: 'payment.gross', description: 'The payslip’s gross pay' },
		{
			path: 'payment.net',
			description: 'Net pay left after every non-order deduction and every higher-priority order'
		},
		{
			path: 'payment.disposable',
			description: 'Gross less the employee’s statutory contributions'
		},
		{ path: 'payment.final', description: 'Whether this is the contract’s last payslip' },
		{ path: 'order.principal', description: 'The order’s principal' },
		{ path: 'order.recovered', description: 'What earlier payslips recovered under it' },
		{ path: 'order.balance', description: 'What is still owed' },
		{ path: 'order.priority', description: 'The order’s priority; a lower number is taken first' },
		{ path: 'order.creditor', description: 'EMPLOYER | THIRD_PARTY' },
		{ path: 'order.authority', description: 'Who issued the order, and its reference' },
		{ path: 'wage_floor', description: 'The period’s minimum wage' }
	],
	bare: ['wage_floor'],
	open: [],
	functions: functionsFor('order'),
	blank: {
		payment: { gross: 0, net: 0, disposable: 0, final: false },
		order: {
			principal: 0,
			recovered: 0,
			balance: 0,
			priority: 0,
			creditor: 'EMPLOYER',
			authority: ''
		},
		wage_floor: 0
	}
};

/**
 * The derived-line site (E6): the person, flat, with this payslip's lines so far — for
 * `work_rules.derived_lines[].amount` and `.when`, evaluated by `deriveLines` in `run/accumulate.ts`
 * after every work, leave and money line.
 */
const DERIVED_LINE_CONTEXT: ExpressionContext = {
	site: 'derived_line',
	description:
		'A line the period’s totals decide: the person, this payslip’s lines so far and the period’s day facts.',
	fields: [
		...PERSON_ROOT_FIELDS,
		...RESERVED_LINES.map((field) => ({
			...field,
			description: `${field.description} — this payslip so far, earlier derived lines included`
		})),
		{
			path: 'day_facts.<key>',
			description: 'The period total of one declared numeric `work_day_facts` input'
		}
	],
	bare: ['wage_floor', ...RESERVED_LINES.map((field) => field.path)],
	open: [...PERSON_OPEN, 'day_facts'],
	functions: functionsFor('derived_line'),
	blank: {
		...personBlank(),
		...Object.fromEntries(RESERVED_LINES.map((field) => [field.path, 0])),
		day_facts: {}
	}
};

export const EXPRESSION_CONTEXTS: Readonly<Record<ExpressionSite, ExpressionContext>> = {
	entity: ENTITY_CONTEXT,
	person: PERSON_CONTEXT,
	entry: ENTRY_CONTEXT,
	work_day: WORK_DAY_CONTEXT,
	assessment: ASSESSMENT_CONTEXT,
	scheme: SCHEME_CONTEXT,
	leave_day: LEAVE_DAY_CONTEXT,
	rest_break: REST_BREAK_CONTEXT,
	payment: PAYMENT_CONTEXT,
	rate: RATE_CONTEXT,
	obligation: OBLIGATION_CONTEXT,
	filing: FILING_CONTEXT,
	case: CASE_CONTEXT,
	check: CHECK_CONTEXT,
	order: ORDER_CONTEXT,
	derived_line: DERIVED_LINE_CONTEXT
};

const MENTION_CACHE_CAP = 50_000;
const mentionPatterns = new Map<string, RegExp>();
const mentionKeys = new Map<string, readonly string[]>();
const NO_KEYS: readonly string[] = Object.freeze([]);

/**
 * Every open key an expression names under one prefix, as the compiler and builders fill them.
 *
 * Callers scan whole formula ladders — a withholding table is thousands of band expressions — and
 * the same handful of (prefix, expression) pairs recurs across every context build. The pattern
 * and the key list are both pure functions of their inputs, so both are memoized.
 */
export function openKeyMentions(
	expression: string | null | undefined,
	prefix: string
): readonly string[] {
	// No `<prefix>.` in the text, no key: most of a ladder names none, and the cache key alone
	// copies the whole expression.
	if (expression == null || !expression.includes(`${prefix}.`)) return NO_KEYS;
	const cacheKey = `${prefix}\u0000${expression}`;
	const cached = mentionKeys.get(cacheKey);
	if (cached !== undefined) return cached;
	let pattern = mentionPatterns.get(prefix);
	if (pattern === undefined) {
		pattern = new RegExp(`${prefix.replace(/\./g, '\\.')}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g');
		mentionPatterns.set(prefix, pattern);
	}
	pattern.lastIndex = 0;
	const keys = [...new Set([...expression.matchAll(pattern)].map((match) => match[1]!))];
	// A ladder holds thousands of expressions and every prefix reads each of them; the cap is
	// sized to keep a whole workspace's pairs resident rather than to evict, because clearing
	// re-scans every pair on the next build.
	if (mentionKeys.size < MENTION_CACHE_CAP) mentionKeys.set(cacheKey, keys);
	return keys;
}
