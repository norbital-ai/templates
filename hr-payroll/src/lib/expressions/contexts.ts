/**
 * The expression contexts, as data.
 *
 * Every CEL a catalogue, band, scheme, schedule or assessment rule carries is compiled against
 * exactly one of these contexts. The catalogue is the single source of truth: the engine's builders
 * assemble an object of this shape, the compiler checks an expression's members and result type
 * against the blank instance below, and the UI's Fields panel renders `fields` and `functions` so
 * an operator can see what is available before typing it.
 *
 * Five sites, one subject each: `person` (who), `entry` (one catalogue entry), `work_day` (one
 * priced day), `assessment` (one scheme's wage) and `scheme` (one scheme's charge). Six roots —
 * `person`, `period`, `year`, `scheme`, `produced`, `limits` — carry the same members wherever they
 * appear; a root cannot drift between sites because every site is built from the one definition.
 *
 * The person site *is* the person object, so its members are `employee.*`, `employment.*` and so
 * on without the prefix; on every other site the same object sits under `person.`. Everything a
 * site's own subject is, is bare. Open prefixes (`limits.*`, `year.earned.*`, `produced.*`,
 * `scheme.elections.*`, `person.company.facts.*`) are the deliberate exception: their remaining
 * segments are data keys supplied by the version being evaluated. Every other member is refused at
 * write when the site does not declare it.
 */

export type ExpressionSite =
	'person' | 'entry' | 'work_day' | 'assessment' | 'scheme' | 'leave_day';
/** What an expression returns: a boolean, or a number in the unit its field is named for. */
export type ExpressionType = 'boolean' | 'money' | 'hours' | 'minutes' | 'days' | 'number';

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
	{ path: 'employee.gender', description: 'Recorded gender' },
	{ path: 'employee.age', description: 'Completed years on the rule date' },
	{
		path: 'employee.age_months',
		description:
			'Whole calendar months since birth, for a band that moves the month after a birthday'
	},
	{ path: 'employee.citizenship', description: 'Residency standing from the effective terms' },
	{ path: 'employee.marital_status', description: 'Marital status' },
	{ path: 'employee.spouse_status', description: 'NONE | WITHOUT_INCOME | WITH_INCOME' },
	{
		path: 'employee.dependents_count',
		description:
			'Dependants the person declares for a tax relief (MY child relief, ID PTKP, TW exemptions); leave and family schemes count `children` instead'
	},
	{ path: 'employee.solo_parent', description: 'Solo-parent flag' },
	{ path: 'employee.disabled', description: 'Disability flag' },
	{ path: 'employee.race', description: 'Recorded race' },
	{ path: 'employee.religion', description: 'Recorded religion' },
	{
		path: 'employee.residency_months',
		description:
			'Whole calendar months since residency began, for a ladder that moves the month after an anniversary'
	},
	{
		path: 'employment.type',
		description:
			'PERMANENT | CONTRACT | PROBATION | INTERN | CONSULTANT | PART_TIME | APPRENTICE | DOMESTIC'
	},
	{ path: 'employment.classification', description: 'Work classification' },
	{ path: 'employment.risk_class', description: 'The employment risk class, or empty' },
	{ path: 'employment.service_months', description: 'Completed months since the stint began' },
	{ path: 'employment.service_years', description: 'Completed years since the stint began' },
	{ path: 'employment.exit_date', description: 'Last day of work, or empty while open' },
	{
		path: 'employment.exit_reason',
		description:
			'RESIGNATION | DISMISSAL | REDUNDANCY | RETIREMENT | END_OF_CONTRACT | MUTUAL | DEATH, or empty'
	},
	{
		path: 'employment.absent_days_12m',
		description:
			'Rostered days with an empty punch in the twelve months to the rule date (leave rules only)'
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
		path: 'terms.fixed_allowances',
		description: 'Standing PAY allowances in force on the rule date'
	},
	{
		path: 'terms.monthly_wage',
		description:
			'Basic salary plus the fixed allowances — the “one month’s wage” a separation or festival payment is a multiple of'
	},
	{
		path: 'terms.statutory_wages',
		description:
			'Wages a statutory ceiling reads: basic plus every other cash payment for work in the run'
	},
	{ path: 'terms.workman', description: 'Statutory work category starts with MANUAL_LABOUR' },
	{ path: 'terms.statutory_work_category', description: 'Statutory work category of the terms' },
	{
		path: 'terms.department',
		description: 'Department — an employer’s own catalogue tier, never a statute’s'
	},
	{ path: 'terms.payroll_group', description: 'Payroll group' },
	{
		path: 'terms.grade',
		description: 'Grade — an employer’s own catalogue tier, never a statute’s'
	},
	{ path: 'terms.pay_frequency', description: 'MONTHLY | SEMI_MONTHLY | WEEKLY | DAILY | HOURLY' },
	{
		path: 'terms.pass_type',
		description: 'EMPLOYMENT_PASS | S_PASS | WORK_PERMIT | OTHER, or empty'
	},
	{
		path: 'terms.tax_residency',
		description:
			'RESIDENT | NON_RESIDENT declared on the contract, or empty for the citizenship default'
	},
	{ path: 'terms.notice_days', description: 'Notice days the contract states, 0 when none' },
	{ path: 'terms.ordinary_hours_per_week', description: 'Roster-measured working week, hours' },
	{ path: 'terms.working_days_per_week', description: 'Roster-measured working week, days' },
	{
		path: 'children.count',
		description:
			'Recorded children alive on the rule date — leave and family schemes read these; tax reliefs read `employee.dependents_count`'
	},
	{ path: 'children.under(n)', description: 'Children under n completed years' },
	{ path: 'children.citizens', description: 'Children recorded as citizens' },
	{ path: 'children.citizens_under(n)', description: 'Of them, those under n completed years' },
	{ path: 'company.region', description: 'Employing entity region' },
	{ path: 'company.headcount', description: 'Active employments in the entity' },
	{ path: 'company.headcount_citizens', description: 'Of them, the citizens' },
	{
		path: 'company.facts.<key>',
		description: 'Entity facts the version declares: sector, establishment tests'
	},
	{
		path: 'wage_floor',
		description: 'The region’s minimum wage, or 0 when the wages order excludes this person'
	},
	{
		path: 'facts.<CODE>.registered',
		description: 'Whether the employment is registered with the scheme of that code'
	},
	{
		path: 'facts.<CODE>.since_months',
		description:
			'Completed months since the employment registered with that scheme, 0 when unrecorded'
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
	{ path: 'event.date', description: 'The day of the event, or empty' },
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
			'The weeks of the couple’s shared parental pool this parent takes for the named child, as recorded; 0 when unrecorded'
	},
	{
		path: 'event.prior_employment_days',
		description:
			'Days employed elsewhere before the named child’s confinement, as declared; 0 when unrecorded'
	},
	{ path: 'period.working_days', description: 'Scheduled working days of the pay month' },
	{
		path: 'period.unpaid_days',
		description:
			'Working days of the pay month the employment covered but did not pay: no-pay leave charged and rostered days with no punch'
	}
];

const PERSON_BLANK = {
	employee: {
		gender: '',
		age: 0,
		age_months: 0,
		citizenship: '',
		marital_status: '',
		spouse_status: '',
		dependents_count: 0,
		solo_parent: false,
		disabled: false,
		race: '',
		religion: '',
		residency_months: 0
	},
	employment: {
		type: '',
		classification: '',
		risk_class: '',
		service_months: 0,
		service_years: 0,
		exit_date: '',
		exit_reason: '',
		absent_days_12m: 0
	},
	terms: {
		basic_salary: 0,
		monthly_basic: 0,
		fixed_allowances: 0,
		monthly_wage: 0,
		workman: false,
		statutory_work_category: '',
		statutory_wages: 0,
		department: '',
		payroll_group: '',
		grade: '',
		pay_frequency: '',
		pass_type: '',
		tax_residency: '',
		notice_days: 0,
		ordinary_hours_per_week: 0,
		working_days_per_week: 0
	},
	children: { count: 0, ages: [], citizens: 0, citizen_ages: [] },
	company: { region: '', headcount: 1, headcount_citizens: 1, facts: {} },
	wage_floor: 0,
	period: { working_days: 22, unpaid_days: 0 },
	facts: {},
	event: {
		kind: '',
		relationship: '',
		child_index: 0,
		date: '',
		child_citizenship: '',
		child_age: -1,
		child_shared_weeks: 0,
		prior_employment_days: 0
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
	{ path: 'start', description: 'First day of the pay period' },
	{ path: 'end', description: 'Last day of the pay period' },
	{ path: 'index', description: 'Which instalment of the month this period is' },
	{ path: 'instalments', description: 'Instalments the month is paid in' },
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
	start: '',
	end: '',
	index: 1,
	instalments: 1,
	last_of_year: false,
	days_employed: 0,
	days_in_month: 0
};

const YEAR_FIELDS: readonly ContextField[] = [
	{ path: 'start', description: 'First day of the tax year' },
	{ path: 'end', description: 'Last day of the tax year' },
	{
		path: 'months_employed',
		description: 'Completed months of this employment in the tax year, through the period end'
	},
	{
		path: 'earned.<code>',
		description:
			'Earned under a component code this tax year: earlier PAID payslips only, plus this run’s own lines where the site prices them'
	}
];

const yearFields = (prefix: string): ContextField[] =>
	YEAR_FIELDS.map((field) => ({ path: `${prefix}${field.path}`, description: field.description }));

const SCHEME_FIELDS: readonly ContextField[] = [
	{ path: 'code', description: 'The scheme code' },
	{ path: 'assessment_period', description: 'PAY_PERIOD | MONTH' },
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
		path: 'projection.payslips_remaining',
		description: 'Payslips left in the year, this one included'
	},
	{ path: 'projection.future_equivalents', description: 'Future payslips of this size' },
	{
		path: 'rate_override',
		description: 'The employment flat rate override percentage, 0 when none'
	},
	{ path: 'since', description: 'The day this employment registered with the scheme, or empty' },
	{ path: 'since_months', description: 'Completed months since registration, 0 when unrecorded' },
	{
		path: 'elections.<key>',
		description: 'The employment’s elections under this scheme, keys the scheme row declares'
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
		path: 'employee_this_period',
		description:
			'The employee share charged this period alone, floored at zero — the relief a per-period withholding table subtracts'
	},
	{ path: 'employer', description: 'The employer share' },
	{
		path: 'base',
		description:
			'The base the producer was charged on this period — a graded insured amount another scheme measures against; on the company site, the sum over the run'
	}
];

const producedFields = (prefix: string): ContextField[] =>
	PRODUCED_FIELDS.map((field) => ({
		path: `${prefix}${field.path}`,
		description: field.description
	}));

/** Representative evaluated limits for compile-time and previews; the builders supply the real ones. */
const LIMITS_BLANK = {
	daily_total: 11,
	normal_day: 8,
	spread_day: 10,
	weekly_total: 45,
	monthly_ot: 104,
	quarter_ot: 138,
	year_ot: 200
};

/** The functions every site carries but the assessment site's own. */
const COMMON_FUNCTIONS: readonly ExpressionFunction[] = [
	{ path: 'round_cent(value)', description: 'Round to the nearest cent' },
	{ path: 'truncate_cent(value)', description: 'Truncate to the cent' },
	{ path: 'up_5_cents(value)', description: 'Round up to the next five cents' },
	{ path: 'round_unit(value)', description: 'Round to the nearest whole unit' },
	{ path: 'floor_unit(value)', description: 'Floor to the whole unit' },
	{ path: 'up_to_unit(value)', description: 'Round up to the whole unit' },
	{ path: 'bracket(base, up_to, step)', description: 'Round a figure up to the next bracket' },
	{ path: 'ladder(base, grades)', description: 'Step a figure up to the next grade in a table' },
	{ path: 'progressive(value, table)', description: 'Apply a progressive [from, base, rate] table' }
];

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
		description: 'The signed total of the version’s row X this payslip'
	},
	{
		path: "catalog('ALLOWANCE' | 'CLAIM' | 'LOAN', { pick | exclude })",
		description: 'The signed sum of a catalogue’s rows, selected or excluded'
	}
];

const functionsFor = (site: ExpressionSite): readonly ExpressionFunction[] => {
	const functions: ExpressionFunction[] = [...COMMON_FUNCTIONS];
	if (site === 'person' || site === 'assessment' || site === 'scheme') functions.push(MINIMUM_WAGE);
	if (site === 'assessment') functions.push(...CODE_FUNCTIONS);
	if (site === 'assessment' || site === 'scheme') functions.push(ANNUAL_EXEMPT);
	if (site === 'entry')
		functions.push({
			path: 'leave.days(code)',
			description: 'Charged days of one leave code in the window'
		});
	return functions;
};

const PERSON_CONTEXT: ExpressionContext = {
	site: 'person',
	description: 'The person on the rule date: catalogue and scheme eligibility.',
	fields: PERSON_ROOT_FIELDS,
	bare: ['wage_floor'],
	open: ['company.facts'],
	functions: functionsFor('person'),
	blank: personBlank()
};

const LEAVE_DAY_CONTEXT: ExpressionContext = {
	site: 'leave_day',
	description: 'One charged day of leave: the person that day, and where in the leave it falls.',
	fields: [
		...PERSON_ROOT_FIELDS,
		{ path: 'leave.month_index', description: 'Which month of the leave the day is in, from 1' },
		{ path: 'leave.day_index', description: 'Which calendar day of the leave, from 1' },
		{ path: 'leave.days', description: 'The days the whole entry charges' }
	],
	bare: ['wage_floor'],
	open: ['company.facts'],
	functions: functionsFor('person'),
	blank: { ...personBlank(), leave: { month_index: 1, day_index: 1, days: 1 } }
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
		{ path: 'entry.window.start', description: 'Standing allowance window start' },
		{ path: 'entry.window.end', description: 'Standing allowance window end' },
		{ path: 'entry.captures.remaining', description: 'Amount still to settle' },
		{ path: 'rates.ordinary_day', description: 'Ordinary day rate for the entry date' },
		{ path: 'rates.ordinary_hour', description: 'Ordinary hour rate for the entry date' },
		{ path: 'limits.<key>', description: 'Evaluated work limit, net worked hours' },
		...periodFields('period.'),
		...yearFields('year.'),
		{ path: 'leave.days(code)', description: 'Charged days of one leave code in the window' }
	],
	bare: [],
	open: ['limits', 'year', 'person.company.facts'],
	functions: functionsFor('entry'),
	blank: {
		person: personBlank(),
		entry: {
			amount: 0,
			days: 0,
			hours: 0,
			quantity: 0,
			event_date: '',
			period: '',
			window: { start: '', end: '' },
			captures: { remaining: 0 }
		},
		rates: { ordinary_day: 0, ordinary_hour: 0 },
		limits: structuredClone(LIMITS_BLANK),
		period: structuredClone(PERIOD_BLANK),
		year: { start: '', end: '', months_employed: 0, earned: { BASIC: 0 } },
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
		{ path: 'hours_beyond_normal', description: 'Worked hours past the normal day' },
		{ path: 'hours_from_start_fraction', description: 'Worked share of a normal day, 0..1' },
		{ path: 'overtime_hours', description: 'Derived overtime hours' },
		{ path: 'consecutive_hours', description: 'Longest unbroken work run in the day' },
		{ path: 'continuous_attendance', description: 'Work that must be carried on continuously' },
		{ path: 'rest_day', description: 'The roster’s weekly rest day, whatever the holiday made it' },
		{ path: 'off_day', description: 'The roster left the day unassigned before the holiday' },
		{
			path: 'night_hours',
			description:
				'Hours inside the night window, 0 where none is declared; a break rule reads it too'
		},
		{ path: 'requested_by', description: 'EMPLOYER | EMPLOYEE: who asked for rest-day work' },
		{ path: 'ordinary_hour', description: 'Ordinary hour rate' },
		{ path: 'day_wage', description: 'Ordinary day wage' },
		{ path: 'hours', description: 'The hours this band consumed, for its price' },
		{ path: 'limits.<key>', description: 'Evaluated work limit, net worked hours' },
		{
			path: 'holiday.kind',
			description:
				'The published row on the date, in the day-type words: PUBLIC_HOLIDAY | SPECIAL_HOLIDAY | SUBSTITUTE, or empty; unlike `day_type` it does not move with the precedence rule'
		},
		{ path: 'holiday.name', description: 'Published holiday name, or empty' }
	],
	bare: [
		'date',
		'day_type',
		'worked_hours',
		'normal_hours',
		'hours_beyond_normal',
		'hours_from_start_fraction',
		'overtime_hours',
		'consecutive_hours',
		'continuous_attendance',
		'rest_day',
		'off_day',
		'night_hours',
		'requested_by',
		'ordinary_hour',
		'day_wage',
		'hours'
	],
	open: ['limits', 'person.company.facts'],
	functions: functionsFor('work_day'),
	blank: {
		person: personBlank(),
		date: '',
		day_type: 'ORDINARY',
		worked_hours: 13,
		normal_hours: 9,
		hours_beyond_normal: 4,
		hours_from_start_fraction: 1,
		overtime_hours: 4,
		consecutive_hours: 4,
		continuous_attendance: false,
		rest_day: false,
		off_day: false,
		night_hours: 0,
		requested_by: 'EMPLOYER',
		ordinary_hour: 25.5,
		day_wage: 204,
		hours: 4,
		limits: structuredClone(LIMITS_BLANK),
		holiday: { kind: '', name: '' }
	}
};

/** The six reserved lines: engine money, magnitudes with the sign written in the formula. */
const RESERVED_LINES: readonly ContextField[] = [
	{ path: 'BASE', description: 'The salary line' },
	{ path: 'OVERTIME', description: 'Every overtime and incentive line' },
	{ path: 'NIGHT_PREMIUM', description: 'The night premium line' },
	{
		path: 'OVERTIME_PREMIUM',
		description:
			'The part of every overtime line above the ordinary hour: amount less hours × ordinary hour'
	},
	{ path: 'ABSENCE', description: 'Unexplained absence and every unpaid leave day' },
	{ path: 'NO_PAY_LEAVE', description: 'Unpaid leave days' },
	{ path: 'ENCASHMENT', description: 'Every encashed leave day' }
];

const ASSESSMENT_CONTEXT: ExpressionContext = {
	site: 'assessment',
	description: 'One scheme’s wage: the reserved lines, the catalogue rows and the shared roots.',
	fields: [
		...personFields('person.'),
		...periodFields('period.'),
		...yearFields('year.'),
		...schemeFields('scheme.'),
		...producedFields('produced.<code>.'),
		...RESERVED_LINES
	],
	bare: RESERVED_LINES.map((field) => field.path),
	open: ['produced', 'year', 'scheme.elections', 'person.company.facts'],
	functions: functionsFor('assessment'),
	blank: {
		person: personBlank(),
		period: structuredClone(PERIOD_BLANK),
		year: { start: '', end: '', months_employed: 0, earned: { BASIC: 0 } },
		scheme: {
			code: '',
			assessment_period: 'PAY_PERIOD',
			year_to_date: { base: 0, employee: 0, employer: 0, ordinary: 0 },
			projection: { payslips_remaining: 1, future_equivalents: 0 },
			rate_override: 0,
			since: '',
			since_months: 0,
			elections: {}
		},
		produced: { EPF: { base: 0, employee: 0, employee_this_period: 0, employer: 0 } },
		BASE: 0,
		OVERTIME: 0,
		NIGHT_PREMIUM: 0,
		OVERTIME_PREMIUM: 0,
		ABSENCE: 0,
		NO_PAY_LEAVE: 0,
		ENCASHMENT: 0
	}
};

const SCHEME_CONTEXT: ExpressionContext = {
	site: 'scheme',
	description: 'One statutory scheme for one person and period: rules and rate bands.',
	fields: [
		...personFields('person.'),
		...periodFields('period.'),
		...yearFields('year.'),
		...schemeFields('scheme.'),
		...producedFields('produced.<code>.'),
		{ path: 'base', description: 'The result of the scheme’s `assessed_on` formula' }
	],
	bare: ['base'],
	open: ['produced', 'year', 'scheme.elections', 'person.company.facts'],
	functions: functionsFor('scheme'),
	blank: {
		person: personBlank(),
		period: structuredClone(PERIOD_BLANK),
		year: { start: '', end: '', months_employed: 0, earned: { BASIC: 0 } },
		scheme: {
			code: '',
			assessment_period: 'PAY_PERIOD',
			year_to_date: { base: 0, employee: 0, employer: 0, ordinary: 0 },
			projection: { payslips_remaining: 1, future_equivalents: 0 },
			rate_override: 0,
			since: '',
			since_months: 0,
			elections: {}
		},
		produced: { EPF: { base: 0, employee: 0, employee_this_period: 0, employer: 0 } },
		base: 0
	}
};

export const EXPRESSION_CONTEXTS: Readonly<Record<ExpressionSite, ExpressionContext>> = {
	person: PERSON_CONTEXT,
	entry: ENTRY_CONTEXT,
	work_day: WORK_DAY_CONTEXT,
	assessment: ASSESSMENT_CONTEXT,
	scheme: SCHEME_CONTEXT,
	leave_day: LEAVE_DAY_CONTEXT
};

/** Every open key an expression names under one prefix, as the compiler and builders fill them. */
export function openKeyMentions(expression: string, prefix: string): readonly string[] {
	const pattern = new RegExp(`${prefix.replace(/\./g, '\\.')}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g');
	return [...new Set([...expression.matchAll(pattern)].map((match) => match[1]!))];
}
