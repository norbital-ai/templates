/**
 * The expression contexts, as data.
 *
 * Every CEL a catalogue, band, scheme or schedule rule carries is compiled against exactly one
 * of these contexts. The catalogue is the single source of truth: the engine's builders assemble
 * an object of this shape, the compiler checks an expression's members and result type against
 * the blank instance below, and the UI's Fields panel renders `fields` so an operator can see
 * what is available before typing it.
 *
 * A member not listed here is refused at write time, not discovered at payroll. Open prefixes
 * (`limits.*`, `produced.*`) are the deliberate exception: their remaining segments are data
 * keys supplied by the version being evaluated.
 */

export type ExpressionSite = 'person' | 'entry' | 'work_day' | 'scheme';
/** What an expression returns: a boolean, or a number in the unit its field is named for. */
export type ExpressionType = 'boolean' | 'money' | 'hours' | 'minutes' | 'days';

type ContextField = {
	readonly path: string;
	readonly description: string;
};

export type ExpressionContext = {
	readonly site: ExpressionSite;
	readonly description: string;
	readonly fields: readonly ContextField[];
	/** Value members used bare (no dot), e.g. a scheme's `base`. */
	readonly bare: readonly string[];
	/** Path roots whose remaining segments are keys, not schema members. */
	readonly open: readonly string[];
	readonly blank: Record<string, unknown>;
};

const PERSON_FIELDS: readonly ContextField[] = [
	{ path: 'employee.gender', description: 'Recorded gender' },
	{ path: 'employee.age', description: 'Completed years on the rule date' },
	{ path: 'employee.citizenship', description: 'Residency standing from the effective terms' },
	{ path: 'employee.marital_status', description: 'Marital status' },
	{ path: 'employee.spouse_status', description: 'NONE | WITHOUT_INCOME | WITH_INCOME' },
	{ path: 'employee.dependents_count', description: 'Dependants recorded for statutory reliefs' },
	{ path: 'employee.solo_parent', description: 'Solo-parent flag' },
	{ path: 'employee.race', description: 'Recorded race' },
	{ path: 'employee.religion', description: 'Recorded religion' },
	{ path: 'employee.residency_months', description: 'Completed months since residency began' },
	{ path: 'employment.type', description: 'Employment type from the effective terms' },
	{ path: 'employment.classification', description: 'Work classification' },
	{ path: 'employment.service_months', description: 'Completed months since the stint began' },
	{ path: 'employment.service_start', description: 'First day of the stint' },
	{ path: 'employment.service_years', description: 'Completed years since the stint began' },
	{ path: 'employment.exit_date', description: 'Last day of work, or empty while open' },
	{
		path: 'employment.exit_reason',
		description:
			'RESIGNATION | DISMISSAL | REDUNDANCY | RETIREMENT | END_OF_CONTRACT | MUTUAL | DEATH, or empty'
	},
	{ path: 'terms.basic_salary', description: 'Contracted monthly base salary' },
	{
		path: 'terms.fixed_allowances',
		description: 'Standing PAY allowances in force on the rule date'
	},
	{ path: 'terms.monthly_wage', description: 'Basic salary plus the fixed allowances' },
	{
		path: 'terms.statutory_wages',
		description:
			'Wages a statutory ceiling reads: basic plus every other cash payment for work in the run'
	},
	{ path: 'terms.workman', description: 'Statutory work category starts with MANUAL_LABOUR' },
	{ path: 'terms.statutory_work_category', description: 'Statutory work category of the terms' },
	{ path: 'terms.department', description: 'Department' },
	{ path: 'terms.payroll_group', description: 'Payroll group' },
	{ path: 'terms.grade', description: 'Grade' },
	{ path: 'terms.ordinary_hours_per_week', description: 'Roster-measured working week, hours' },
	{ path: 'terms.working_days_per_week', description: 'Roster-measured working week, days' },
	{ path: 'children.count', description: 'Recorded children on the rule date' },
	{ path: 'children.under(n)', description: 'Children under n completed years' },
	{ path: 'company.region', description: 'Employing entity region' },
	{ path: 'period.working_days', description: 'Scheduled working days of the pay month' }
];

const PERSON_BLANK = {
	employee: {
		gender: '',
		age: 0,
		citizenship: '',
		marital_status: '',
		spouse_status: '',
		dependents_count: 0,
		solo_parent: false,
		race: '',
		religion: '',
		residency_months: 0
	},
	employment: {
		type: '',
		classification: '',
		service_months: 0,
		service_years: 0,
		service_start: '',
		exit_date: '',
		exit_reason: ''
	},
	terms: {
		basic_salary: 0,
		fixed_allowances: 0,
		monthly_wage: 0,
		workman: false,
		statutory_work_category: '',
		statutory_wages: 0,
		department: '',
		payroll_group: '',
		grade: '',
		ordinary_hours_per_week: 0,
		working_days_per_week: 0
	},
	children: { count: 0, ages: [] },
	company: { region: '' },
	period: { working_days: 22 }
};

const personFields = (prefix: string): ContextField[] =>
	PERSON_FIELDS.map((field) => ({
		path: `${prefix}${field.path}`,
		description: field.description
	}));

const personBlank = () => structuredClone(PERSON_BLANK);

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

const PERSON_CONTEXT: ExpressionContext = {
	site: 'person',
	description: 'The person on the rule date: catalogue and scheme eligibility.',
	fields: PERSON_FIELDS,
	bare: [],
	open: [],
	blank: personBlank()
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
		{ path: 'entry.recurring', description: 'Whether the entry recurs' },
		{ path: 'entry.occurrence_index', description: 'Instalment number of a recurring entry' },
		{ path: 'entry.window.start', description: 'Standing entry window start' },
		{ path: 'entry.window.end', description: 'Standing entry window end' },
		{ path: 'entry.captures.paid_to_date', description: 'Amount already settled' },
		{ path: 'entry.captures.remaining', description: 'Amount still to settle' },
		{ path: 'rates.ordinary_day', description: 'Ordinary day rate for the entry date' },
		{ path: 'rates.ordinary_hour', description: 'Ordinary hour rate for the entry date' },
		{ path: 'limits.<key>', description: 'Evaluated work limit, net worked hours' },
		{ path: 'period.key', description: 'Pay period key' },
		{ path: 'period.start', description: 'Pay period start' },
		{ path: 'period.end', description: 'Pay period end' },
		{ path: 'period.index', description: 'Which instalment of the month this period is' },
		{ path: 'period.instalments', description: 'Instalments the month is paid in' },
		{
			path: 'period.last_of_year',
			description: 'This period closes the tax year, or is a leaver’s last'
		},
		{ path: 'year.start', description: 'First day of the tax year' },
		{ path: 'year.end', description: 'Last day of the tax year' },
		{
			path: 'year.months_employed',
			description: 'Completed months of this employment in the tax year, through the period end'
		},
		{
			path: 'year.days_employed',
			description: 'Days of this employment in the tax year, through the period end'
		},
		{
			path: 'year.earned.<code>',
			description:
				'Earned under a component code this tax year: prior paid payslips plus this period’s own lines'
		},
		{ path: 'leave.days(code)', description: 'Charged days of one leave code in the window' }
	],
	bare: [],
	open: ['limits', 'year'],
	blank: {
		person: personBlank(),
		entry: {
			amount: 0,
			days: 0,
			hours: 0,
			quantity: 0,
			event_date: '',
			period: '',
			recurring: false,
			occurrence_index: 1,
			window: { start: '', end: '' },
			captures: { paid_to_date: 0, remaining: 0 }
		},
		rates: { ordinary_day: 0, ordinary_hour: 0 },
		limits: structuredClone(LIMITS_BLANK),
		period: { key: '', start: '', end: '', index: 1, instalments: 1, last_of_year: false },
		year: { start: '', end: '', months_employed: 0, days_employed: 0, earned: { BASIC: 0 } },
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
		{ path: 'total_work_hours', description: 'Net worked hours, the day in full' },
		{ path: 'overtime_hours', description: 'Derived overtime hours' },
		{ path: 'month_overtime_hours', description: 'Overtime hours already counted this month' },
		{ path: 'consecutive_hours', description: 'Longest unbroken work run in the day' },
		{ path: 'continuous_attendance', description: 'Work that must be carried on continuously' },
		{ path: 'roster_code', description: 'The roster code that planned the day' },
		{ path: 'break_minutes', description: 'Break the shift grants' },
		{ path: 'ordinary_hour', description: 'Ordinary hour rate' },
		{ path: 'ordinary_day', description: 'Ordinary day rate' },
		{ path: 'day_wage', description: 'Ordinary day wage' },
		{ path: 'hours', description: 'The hours this band consumed, for its price' },
		{ path: 'limits.<key>', description: 'Evaluated work limit, net worked hours' },
		{ path: 'holiday.kind', description: 'PUBLIC | SPECIAL | SUBSTITUTE, or empty' },
		{ path: 'holiday.name', description: 'Published holiday name, or empty' }
	],
	bare: [
		'date',
		'day_type',
		'worked_hours',
		'normal_hours',
		'hours_beyond_normal',
		'hours_from_start_fraction',
		'total_work_hours',
		'overtime_hours',
		'month_overtime_hours',
		'consecutive_hours',
		'continuous_attendance',
		'roster_code',
		'break_minutes',
		'ordinary_hour',
		'ordinary_day',
		'day_wage',
		'hours'
	],
	open: ['limits'],
	blank: {
		person: personBlank(),
		date: '',
		day_type: 'ORDINARY',
		worked_hours: 13,
		normal_hours: 9,
		hours_beyond_normal: 4,
		hours_from_start_fraction: 1,
		total_work_hours: 13,
		overtime_hours: 4,
		month_overtime_hours: 20,
		consecutive_hours: 4,
		continuous_attendance: false,
		roster_code: 'AM0830',
		break_minutes: 60,
		ordinary_hour: 25.5,
		ordinary_day: 204,
		day_wage: 204,
		hours: 4,
		limits: structuredClone(LIMITS_BLANK),
		holiday: { kind: '', name: '' }
	}
};

const SCHEME_CONTEXT: ExpressionContext = {
	site: 'scheme',
	description: 'One statutory scheme for one person and period: rules and rate bands.',
	fields: [
		...personFields('person.'),
		{ path: 'base', description: 'The assembled chargeable base' },
		{ path: 'code', description: 'The scheme code' },
		{ path: 'assessment_period', description: 'PAY_PERIOD | MONTH' },
		{ path: 'period.key', description: 'Pay period key' },
		{ path: 'period.index', description: 'Which instalment of the month this period is' },
		{ path: 'period.instalments', description: 'Instalments the month is paid in' },
		{ path: 'year_to_date.base', description: 'Base already paid this tax year' },
		{ path: 'year_to_date.employee', description: 'Employee amount already paid this tax year' },
		{
			path: 'projection.payslips_remaining',
			description: 'Payslips left in the year, this one included'
		},
		{ path: 'projection.future_equivalents', description: 'Future payslips of this size' },
		{ path: 'region', description: 'The employing entity region' },
		{ path: 'minimum_wage(region)', description: 'The version minimum wage for a region' },
		{
			path: 'wage_floor',
			description:
				'The company region minimum wage where the wages order covers this person, else 0'
		},
		{ path: 'headcount', description: 'Active employments in the entity' },
		{ path: 'age', description: 'Completed years on the period end' },
		{ path: 'risk_class', description: 'The employment risk class, or empty' },
		{
			path: 'rate_override',
			description: 'The employment flat rate override percentage, 0 when none'
		},
		{
			path: 'produced.<code>.employee',
			description: 'Employee share another scheme produced, as a relief'
		},
		{ path: 'produced.<code>.employer', description: 'Employer share another scheme produced' }
	],
	bare: [
		'base',
		'code',
		'assessment_period',
		'region',
		'wage_floor',
		'headcount',
		'age',
		'risk_class',
		'rate_override'
	],
	open: ['produced'],
	blank: {
		person: personBlank(),
		base: 0,
		wage_floor: 0,
		code: '',
		assessment_period: 'PAY_PERIOD',
		period: { key: '', index: 1, instalments: 1 },
		year_to_date: { base: 0, employee: 0 },
		projection: { payslips_remaining: 1, future_equivalents: 0 },
		region: '',
		headcount: 1,
		age: 0,
		risk_class: '',
		rate_override: 0,
		produced: { EPF: { employee: 0, employer: 0 } }
	}
};

export const EXPRESSION_CONTEXTS: Readonly<Record<ExpressionSite, ExpressionContext>> = {
	person: PERSON_CONTEXT,
	entry: ENTRY_CONTEXT,
	work_day: WORK_DAY_CONTEXT,
	scheme: SCHEME_CONTEXT
};
