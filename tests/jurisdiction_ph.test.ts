/** PH public seed: version snapshots, CEL on the engine context, input schemas, obligations and statutory amounts. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { Effect } from 'effect';
import {
	behavioursOf,
	effectWrites,
	planBehaviours,
	type Behaviours
} from '../src/lib/payroll_engine/behaviours.ts';
import { configuredProgram, evaluateConfigured } from '../src/lib/payroll_engine/expressions.ts';
import { Reads } from '../src/lib/payroll_engine/foundation.ts';
import { dutiesOf, raiseDuties, triggerOf, withBalances } from './duties.ts';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.ts';
import { entitlementDays } from '../src/lib/payroll_engine/leave.ts';

type Row = { [key: string]: any };

const JURISDICTIONS = resolve(process.cwd(), 'seed/jurisdiction');
const LAW = resolve(JURISDICTIONS, 'PH');
const TABLES = [
	'jurisdiction_settings',
	'rule_set',
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'allowance_catalog',
	'work_catalog'
] as const;
/** Relationship and system columns a seed row may carry beside its model's own fields. */
const LINK_KEYS = new Set(['id', 'approval_id', 'settings_id', 'cloned_from_id']);

const versionsOf = (lineage: string) =>
	readdirSync(resolve(JURISDICTIONS, lineage))
		.filter((entry) => entry.startsWith('version_'))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const versions = versionsOf('PH');
const load = (version: string, table: string): Row[] =>
	JSON.parse(readFileSync(resolve(LAW, version, `${table}.json`), 'utf8')) as Row[];
const settingsOf = (version: string): Row => load(version, 'jurisdiction_settings')[0]!;
const latest = versions.at(-1)!;
const scheme = (code: string, version = latest): Row =>
	load(version, 'statutory_contribution_catalog').find((row) => row.code === code)!;
const dayBefore = (day: string): string =>
	new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const cents = (value: unknown): number => Math.round(Number(value) * 100) / 100;

// ── The contexts services.ts builds (subjectContext + the call site's own roots) ──────────────────────────────────
const employee = {
	gender: 'FEMALE',
	marital_status: 'MARRIED',
	spouse_status: 'NONE',
	solo_parent: false,
	disabled: false,
	receiving_pension: false,
	nationality: 'PH',
	date_of_birth: '1990-01-01',
	age: 36,
	children: [],
	dependents_count: 0,
	facts: {}
};
const company = { region: 'NCR', risk_class: '', pay_frequency: 'MONTHLY', facts: {} };
const terms = {
	work_classification: 'RANK_AND_FILE',
	statutory_work_category: 'NON_FIELD',
	employment_type: 'PERMANENT',
	residency_status: 'CITIZEN',
	residency_since: '',
	base_salary: 30000,
	monthly_wage: 32000,
	facts: {}
};
const employment = {
	classification: 'RANK_AND_FILE',
	service_months: 30,
	exit_date: '',
	exit_ground: '',
	exit_facts: {}
};
const SUBJECT = {
	employee,
	company,
	terms,
	employment,
	person: {
		employment,
		race: null,
		religion: null,
		nationality: 'PH',
		residency_status: 'CITIZEN',
		residency_since: null
	},
	rules: {}
};
const entry = {
	amount: 1000,
	quantity: 1,
	days: 5,
	occurred_on: '2026-03-02',
	due_on: '2026-03-02',
	incurred_on: '2026-03-02',
	event_kind: 'BIRTH',
	facts: { event_kind: 'BIRTH' }
};
const ADMISSION = { ...SUBJECT, entry, earlier: { rows: [], calendar_year: 0, lifetime: 0 } };
const RUN = {
	...SUBJECT,
	period: {
		key: '2026-03',
		from: '2026-03-01',
		to: '2026-03-31',
		days: 31,
		paid_days: 31,
		part: 1,
		parts: 1
	},
	work: {
		overtime_hours: 2,
		incentive_hours: 0,
		dates: ['2026-03-10', '2026-03-11'],
		holidays: [
			{ date: '2026-03-10', kind: 'PUBLIC_HOLIDAY', given_to: 'EVERYONE', replaces: '' },
			{ date: '2026-03-11', kind: 'SPECIAL_HOLIDAY', given_to: 'EVERYONE', replaces: '' }
		]
	},
	leave: {
		rows: [{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 1, is_npl: true, can_encash: false }]
	},
	earned: {
		month: {},
		year: { BASIC: 60000, NO_PAY_LEAVE: -500 },
		previous_month: { base_salary: 30000 }
	}
};
/** One `work.days[]` entry as services.ts `workDay` builds it. */
const day = (date: string, day_type: string, extra: Row = {}): Row => ({
	date,
	day_type,
	shift_code: day_type === 'WORK' ? 'DAY' : day_type,
	holiday_kind: '',
	scheduled_hours: day_type === 'WORK' ? 8 : 0,
	worked_hours: 0,
	overtime_hours: 0,
	incentive_hours: 0,
	intervals: [],
	...extra
});
const shift = (date: string, from: string, to: string, next = false) => ({
	start: `${date}T${from}`,
	end: `${next ? dayAfter(date) : date}T${to}`
});
const dayAfter = (date: string): string =>
	new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** A month with an overtime day, a rest day, a regular holiday, a special day and a night shift worked. */
const DAYS = [
	day('2026-03-02', 'WORK', {
		worked_hours: 11,
		overtime_hours: 2,
		intervals: [shift('2026-03-02', '08:00', '19:00')]
	}),
	day('2026-03-08', 'REST', {
		worked_hours: 8,
		intervals: [shift('2026-03-08', '08:00', '16:00')]
	}),
	day('2026-03-10', 'WORK', {
		holiday_kind: 'PUBLIC_HOLIDAY',
		worked_hours: 8,
		intervals: [shift('2026-03-10', '08:00', '16:00')]
	}),
	day('2026-03-11', 'WORK', {
		holiday_kind: 'SPECIAL_HOLIDAY',
		worked_hours: 8,
		intervals: [shift('2026-03-11', '08:00', '16:00')]
	}),
	day('2026-03-12', 'WORK', {
		worked_hours: 8,
		intervals: [shift('2026-03-12', '22:00', '06:00', true)]
	})
];
(RUN.work as Row).days = DAYS;
Object.assign(RUN.period, { covered_days: 31, working_days: 22 });
/** Every WTAX/SSS/… part the version's catalogues count toward, as assessStatutory initialises them. */
const partsOf = (version: string, code: string): string[] => {
	const parts = new Set(['ordinary']);
	for (const table of ['work_catalog', 'allowance_catalog', 'adhoc_catalog', 'claim_catalog'])
		for (const row of load(version, table))
			for (const target of (row.counts_toward ?? []) as string[]) {
				const [schemeCode, part = 'ORDINARY'] = target.split('.');
				if (schemeCode === code) parts.add(part.toLowerCase());
			}
	return [...parts];
};

/** The version's PAYROLL rule_set rows by code: the CEL root `rules`. */
const payrollRules = (version: string) =>
	Object.fromEntries(
		load(version, 'rule_set')
			.filter((row) => row.family === 'PAYROLL')
			.map((row) => [row.code, row.rules])
	);
/** The employee's per-scheme elections (`elections[CODE]`) the statutory assessment reads. */
const SUBJECT_ELECTIONS: { value: { [code: string]: Row } } = { value: {} };

/** One scheme assessed the way `assessStatutory` does it: person facts, assessable parts, assessment, first rule. */
const assess = (version: string, row: Row, wage: { [part: string]: number }, year: object = {}) => {
	const configuration = row.configuration;
	const zero = Object.fromEntries(partsOf(version, row.code).map((part) => [part, 0]));
	let context: Row = {
		...SUBJECT,
		wage: { ...zero, ...wage },
		month: { ...zero, ...wage },
		year: { ...zero, ...year },
		rules: payrollRules(version),
		charged: {
			month: Object.fromEntries(
				load(version, 'statutory_contribution_catalog').map((scheme) => [
					scheme.code,
					{ employee: 0, employer: 0 }
				])
			),
			year: {}
		},
		elections: SUBJECT_ELECTIONS.value,
		scheme: { code: row.code, standing: '', elections: SUBJECT_ELECTIONS.value[row.code] ?? {} },
		period: {
			key: '2026-03',
			from: '2026-03-01',
			to: '2026-03-31',
			days: 31,
			month: 3,
			salary_paid: false
		}
	};
	const person: Row = {};
	for (const [fact, text] of Object.entries(configuration.person ?? {}))
		person[fact] = evaluateConfigured(text as string, context as never);
	context = { ...context, person: { ...context.person, ...person } };
	const base: Row = {};
	for (const part of Object.keys(context.month)) {
		const text = configuration.assessable?.[part];
		base[part] = Math.max(
			0,
			text == null ? context.month[part] : Number(evaluateConfigured(text, context as never))
		);
	}
	const total = Object.values(base).reduce((sum: number, value) => sum + Number(value), 0);
	context = { ...context, base: { ...base, assessed: total, amount: total } };
	for (const guard of configuration.refuse_when ?? [])
		assert.equal(typeof evaluateConfigured(guard.when, context as never), 'boolean');
	for (const rule of configuration.rules) {
		if (evaluateConfigured(rule.when, context as never) !== true) continue;
		const on =
			configuration.assessment == null
				? total
				: Number(evaluateConfigured(configuration.assessment, context as never));
		const ruled = { ...context, base: { ...context.base, assessed: on, amount: on } };
		return {
			employee: cents(evaluateConfigured(rule.employee ?? '0.0', ruled as never)),
			employer: cents(evaluateConfigured(rule.employer ?? '0.0', ruled as never)),
			person
		};
	}
	return { employee: 0, employer: 0, person };
};

/** The month's charge on an assessed base alone (the shared seed test's shape). */
const charge = (row: Row, assessed: number) => {
	const context = { base: { ordinary: assessed, assessed, amount: assessed }, person: { age: 30 } };
	for (const rule of row.configuration.rules) {
		if (evaluateConfigured(rule.when, context as never) !== true) continue;
		return {
			employee: cents(evaluateConfigured(rule.employee, context as never)),
			employer: cents(evaluateConfigured(rule.employer, context as never))
		};
	}
	return { employee: 0, employer: 0 };
};

/** Every CEL leaf of one catalogue row with the context its engine call site evaluates it on. */
const expressions = (table: string, row: Row): { text: string; context: object }[] => {
	const out: { text: string; context: object }[] = [];
	const add = (text: unknown, context: object) => {
		if (typeof text === 'string' && text.trim() !== '') out.push({ text, context });
	};
	if (table === 'work_catalog')
		for (const field of ['eligibility', 'quantity', 'rate']) add(row[field], RUN);
	if (table === 'allowance_catalog') {
		add(row.eligibility, RUN);
		add(row.amount, { ...RUN, allowance: { code: row.code, amount: 1000 } });
	}
	if (table === 'leave_catalog') add(row.eligibility, ADMISSION);
	if (table === 'adhoc_catalog' || table === 'claim_catalog' || table === 'loan_catalog') {
		for (const field of ['eligibility', 'qualifies_when']) {
			add(row[field], ADMISSION);
			add(row[field], { ...RUN, entry });
		}
		for (const band of row.bands ?? []) {
			add(band.when, { ...RUN, entry });
			add(band.amount, { ...RUN, entry });
		}
	}
	return out;
};

/** Every CEL string a version carries, for the schema-coverage scan. */
const celOf = (version: string): string[] => {
	const out: string[] = [];
	const walk = (value: unknown) => {
		if (typeof value === 'string') out.push(value);
		else if (Array.isArray(value)) value.forEach(walk);
		else if (value != null && typeof value === 'object') Object.values(value).forEach(walk);
	};
	for (const table of TABLES.filter((name) => name !== 'jurisdiction_settings'))
		for (const row of load(version, table))
			for (const field of [
				'eligibility',
				'qualifies_when',
				'quantity',
				'rate',
				'amount',
				'bands',
				'configuration',
				'entitlement'
			])
				walk(field === 'configuration' ? { ...row.configuration, limitation: '' } : row[field]);
	return out;
};

/** A minimal JSON Schema 2020-12 shape check: known keywords, known types, nested schemas well formed. */
const KEYWORDS = new Set([
	'$schema',
	'type',
	'title',
	'description',
	'additionalProperties',
	'properties',
	'items',
	'enum',
	'const',
	'format',
	'minimum',
	'maximum',
	'default',
	'required'
]);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const validSchema = (node: Row, where: string): void => {
	for (const key of Object.keys(node)) assert.ok(KEYWORDS.has(key), `${where}: keyword ${key}`);
	for (const type of [node.type].flat().filter((value) => value != null))
		assert.ok(TYPES.has(type), `${where}: type ${type}`);
	if (node.enum != null) assert.ok(Array.isArray(node.enum) && node.enum.length > 0, where);
	if (node.required != null)
		for (const key of node.required) assert.ok(key in (node.properties ?? {}), where);
	if (typeof node.additionalProperties === 'object')
		validSchema(node.additionalProperties, `${where}.*`);
	for (const [key, child] of Object.entries(node.properties ?? {}))
		validSchema(child as Row, `${where}.${key}`);
	if (node.items != null) validSchema(node.items, `${where}[]`);
};

/** The engine over the PH seed with four fixture people, fresh tables per call. */
const harness = (pay_frequency = 'MONTHLY') => {
	const law = (name: string): Row[] =>
		versions
			.flatMap((version) => load(version, name))
			.map((row) => ({ approval_id: null, ...row }));
	const COMPANY = 'c0000000-0000-4000-8000-0000000000ph';
	const transport = (period: string) => ({
		code: 'transport',
		amount: { value: 10000, currency: 'PHP' },
		period
	});
	const people: [string, number, string, object[]][] = [
		['p1', 30000, 'PERMANENT', []],
		['p2', 18000, 'PERMANENT', [transport('')]],
		['p3', 18600, 'PERMANENT', [transport('')]],
		['p4', 4500, 'DOMESTIC', []]
	];
	const tables = new Map<string, Row[]>([
		...[
			'jurisdiction_settings',
			'statutory_contribution_catalog',
			'work_catalog',
			'allowance_catalog',
			'adhoc_catalog',
			'claim_catalog',
			'leave_catalog',
			'loan_catalog',
			'rule_set'
		].map((name) => [name, law(name)] as [string, Row[]]),
		[
			'entity',
			[
				{
					id: COMPANY,
					name: 'Maynila',
					settings_code: 'PH',
					pay_frequency,
					region: 'NCR',
					facts: { small_establishment: false },
					approval_id: null
				}
			]
		],
		[
			'employment_profile',
			people.map(([id]) => ({ id, name: id, date_of_birth: '1990-02-01', nationality: 'PH' }))
		],
		[
			'employment_contract',
			people.map(([id, salary, employment_type, allowances]) => ({
				id: `k-${id}`,
				employee_id: id,
				company_id: COMPANY,
				approval_id: null,
				effective_range: { from: '2024-01-01', to: null },
				facts: {
					contract_terms: [
						{
							base_salary: { value: salary, currency: 'PHP' },
							effective_range: { from: '2024-01-01', to: null },
							residency_status: 'CITIZEN',
							work_classification: 'RANK_AND_FILE',
							statutory_work_category: 'NON_FIELD',
							employment_type,
							allowances: allowances.map(({ code, amount }: Row) => ({ code, amount }))
						}
					]
				}
			}))
		],
		...[
			'adhoc_catalog_entry',
			'claim_catalog_entry',
			'leave_catalog_entry',
			'loan_catalog_entry',
			'roster_entry',
			'holiday',
			'payslip',
			'payroll_run'
		].map((name) => [name, []] as [string, Row[]])
	]);
	const clause = (row: Row, key: string, spec: unknown): boolean => {
		const value = row[key];
		if (spec == null || typeof spec !== 'object') return value === spec;
		return Object.entries(spec as Row).every(([op, operand]) => {
			if (op === 'eq') return value === operand;
			if (op === 'in') return Array.isArray(operand) && operand.includes(value);
			if (op === 'isNull') return operand ? value == null : value != null;
			if (op === 'gte') return value != null && value >= operand;
			if (op === 'lte') return value != null && value <= operand;
			throw new Error(`fixture reader: unsupported operator ${op}`);
		});
	};
	const reads = {
		read: (collection: unknown, query: unknown) => {
			const { where = {}, select = {} } = query as { where?: Row; select?: Row };
			return Effect.succeed({
				rows: (tables.get(String(collection)) ?? [])
					.filter((row) => Object.entries(where).every(([key, spec]) => clause(row, key, spec)))
					.map((row) =>
						Object.fromEntries(
							Object.keys(select)
								.filter((key) => key in row)
								.map((key) => [key, row[key]])
						)
					)
			});
		}
	};
	let runs = 0;
	const run = async (period: string, kind: PayrollRunKind, sources?: string[]) => {
		const plan = await Effect.runPromise(
			buildPayrollRun({
				company_id: COMPANY,
				period,
				kind,
				...(sources ? { sources } : {})
			}).pipe(Effect.provideService(Reads, reads))
		);
		const id = `run-${++runs}`;
		tables.get('payroll_run')!.push({ ...plan.run, id });
		for (const slip of plan.payslips) {
			const slipId = `${id}-${slip.employment_id}`;
			tables.get('payslip')!.push({ ...slip, id: slipId, payroll_run_id: id });
			for (const pin of slip.pins) {
				const pinned = tables.get(pin.collection)?.find((row) => row.id === pin.id);
				if (pinned != null) pinned.payslip_id = slipId;
			}
		}
		return plan;
	};
	const lines = (plan: Awaited<ReturnType<typeof run>>, person: string) =>
		Object.fromEntries(
			plan.payslips
				.find((slip) => slip.employment_id === `k-${person}`)!
				.statutory.map((line) => [line.scheme_code, [line.employee_amount, line.employer_amount]])
		);

	return { tables, run, lines, COMPANY };
};

describe('PH jurisdiction seed', () => {
	it('every version holds settings, rule_set and every catalogue file', () => {
		assert.equal(versions.length, 2);
		for (const version of versions) {
			const files = new Set(readdirSync(resolve(LAW, version)));
			for (const table of TABLES) assert.ok(files.has(`${table}.json`), `${version}/${table}`);
			assert.equal(load(version, 'jurisdiction_settings').length, 1, version);
		}
	});

	it('ids are unique across every lineage and every row points at its own version', () => {
		const elsewhere = new Set<string>();
		for (const lineage of readdirSync(JURISDICTIONS).filter((name) => name !== 'PH'))
			for (const version of versionsOf(lineage))
				for (const file of readdirSync(resolve(JURISDICTIONS, lineage, version)))
					for (const row of JSON.parse(
						readFileSync(resolve(JURISDICTIONS, lineage, version, file), 'utf8')
					) as Row[])
						elsewhere.add(row.id);
		const seen = new Map<string, string>();
		for (const version of versions)
			for (const table of TABLES)
				for (const row of load(version, table)) {
					assert.equal(seen.has(row.id), false, `${row.id} in ${version} and ${seen.get(row.id)}`);
					assert.equal(elsewhere.has(row.id), false, `${version}/${table}:${row.code} id reused`);
					seen.set(row.id, version);
				}
		for (const version of versions) {
			const settings = settingsOf(version);
			for (const table of TABLES.filter((name) => name !== 'jurisdiction_settings'))
				for (const row of load(version, table))
					assert.equal(row.settings_id, settings.id, `${version}/${table}:${row.code}`);
		}
	});

	it('versions chain by cloned_from_id over contiguous, non-overlapping date ranges', () => {
		versions.forEach((version, index) => {
			const settings = settingsOf(version);
			assert.equal(settings.code, 'PH');
			assert.equal(settings.payroll.currency, 'PHP');
			assert.ok(settings.sealed_at, `${version} is sealed`);
			assert.ok(settings.change_summary, `${version} states its law change`);
			const next = versions[index + 1];
			if (index === 0) assert.equal(settings.cloned_from_id, undefined);
			else assert.equal(settings.cloned_from_id, settingsOf(versions[index - 1]!).id, version);
			const range = settings.effective_range;
			assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
			if (next === undefined) assert.equal(range.to, null);
			else assert.equal(range.to, dayBefore(settingsOf(next).effective_range.from), version);
		});
		assert.equal(settingsOf(versions[0]!).effective_range.from, '2025-12-01');
	});

	it('every seeded key exists on its target model', async () => {
		for (const table of TABLES) {
			const model = (await import(
				resolve(process.cwd(), 'src/data/model/jurisdiction', table, '+model.ts')
			)) as { default: { fields: Record<string, unknown> } };
			const fields = new Set(Object.keys(model.default.fields));
			for (const version of versions)
				for (const row of load(version, table))
					for (const key of Object.keys(row))
						assert.ok(fields.has(key) || LINK_KEYS.has(key), `${version}/${table}.${key}`);
		}
	});

	it('codes stay stable across versions; wage orders are dated rows of one minimum_wage table', () => {
		for (const table of TABLES.filter((name) => name !== 'jurisdiction_settings')) {
			const first = load(versions[0]!, table).map((row) => row.code);
			for (const version of versions)
				assert.deepEqual(
					load(version, table)
						.map((row) => row.code)
						.toSorted(),
					first.toSorted(),
					`${version}/${table}`
				);
		}
		assert.deepEqual(
			versions.map((version) => settingsOf(version).effective_range),
			[
				{ from: '2025-12-01', to: '2026-01-05' },
				{ from: '2026-01-06', to: null }
			]
		);
		const table = payrollRules(latest).minimum_wage;
		const floor = (key: string, on: string, map = table.by_region) =>
			(map[key] as { from: string; monthly: number }[]).find((entry) => entry.from <= on)?.monthly;
		// NCR-26 ₱695, NCR-28 ₱755 from 26 September 2026 (× 313 ÷ 12); VII Class B ₱500 → ₱542 (ROVII-27).
		assert.equal(floor('NCR', '2026-09-25'), 18127.92);
		assert.equal(floor('NCR', '2026-09-26'), 19692.92);
		assert.equal(floor('VII-B', '2026-10-13'), 13041.67);
		assert.equal(floor('VII-B', '2026-10-14'), 14137.17);
		assert.equal(floor('IV-B-SMALL', '2025-12-31'), 10537.67);
		assert.equal(floor('BARMM-PROV-AGRI', '2026-08-06'), 10459.42);
		assert.equal(floor('VIII-OTHER', '2026-01-01', table.by_employment_type.DOMESTIC), 5800);
		assert.equal(floor('NCR', '2026-02-07', table.by_employment_type.DOMESTIC), 7800);
		for (const entries of [
			...Object.values(table.by_region),
			...Object.values(table.by_employment_type.DOMESTIC)
		] as { from: string }[][])
			assert.deepEqual(
				entries.map((entry) => entry.from),
				entries
					.map((entry) => entry.from)
					.toSorted()
					.toReversed()
			);
	});

	it('every catalogue CEL leaf evaluates on the engine context', () => {
		for (const version of versions)
			for (const table of TABLES)
				for (const row of load(version, table))
					for (const { text, context } of expressions(table, row)) {
						const where = `${version}/${table}:${row.code}: ${text}`;
						const program = configuredProgram(text);
						assert.doesNotThrow(() => program(context as never), where);
					}
	});

	it('every statutory scheme evaluates its person facts, parts, assessment and rules', () => {
		for (const version of versions)
			for (const row of load(version, 'statutory_contribution_catalog'))
				for (const ordinary of [0, 4000, 30000, 250000]) {
					const result = assess(version, row, { ordinary });
					assert.equal(typeof result.employee, 'number', `${version} ${row.code}`);
					assert.ok(Number.isFinite(result.employer), `${version} ${row.code}`);
				}
	});

	it('both input schemas are JSON Schema and declare every fact the CEL reads', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const employeeSchema = settings.employee_input_schema as Row;
			const entitySchema = settings.entity_input_schema as Row;
			for (const [name, schema] of [
				['employee', employeeSchema],
				['entity', entitySchema]
			] as const) {
				assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
				validSchema(schema, `${version} ${name}`);
			}
			assert.deepEqual(Object.keys(employeeSchema.properties), [
				'contract_terms',
				'exit_facts',
				'employment_statutory_facts',
				'facts'
			]);
			const termKeys = new Set([
				...Object.keys(employeeSchema.properties.contract_terms.items.properties),
				'monthly_wage'
			]);
			const declared = {
				'terms.': termKeys,
				'terms.facts.': new Set(
					Object.keys(employeeSchema.properties.contract_terms.items.properties.facts.properties)
				),
				'employee.facts.': new Set(Object.keys(employeeSchema.properties.facts.properties)),
				'elections.SSS.': new Set(
					Object.keys(
						employeeSchema.properties.employment_statutory_facts.items.properties.status.properties
							.elections.properties
					)
				),
				'company.facts.': new Set(Object.keys(entitySchema.properties)),
				'employment.exit_facts.': new Set(
					Object.keys(employeeSchema.properties.exit_facts.properties)
				)
			};
			assert.equal(
				employeeSchema.properties.contract_terms.items.properties.base_salary.properties.currency
					.const,
				'PHP'
			);
			const text = celOf(version).join('\n');
			for (const [root, keys] of Object.entries(declared))
				for (const match of text.matchAll(
					new RegExp(`(?<![\\w.])${root.replaceAll('.', '\\.')}(\\w+)`, 'g')
				))
					assert.ok(keys.has(match[1]!), `${version}: ${root}${match[1]} is not declared`);
			for (const column of ['region', 'risk_class'])
				assert.equal(
					column in entitySchema.properties,
					false,
					`${version} entity column ${column}`
				);
			for (const column of ['gender', 'nationality', 'date_of_birth', 'marital_status'])
				assert.equal(
					column in employeeSchema.properties,
					false,
					`${version} profile column ${column}`
				);
			assert.equal(
				'wages' in settings.reference_tables.work_rules
					? 'by_region' in settings.reference_tables.work_rules.wages
					: false,
				false
			);
			for (const key of ['obligations', 'duty_types', 'facts', 'exit_facts', 'terms_facts'])
				assert.equal(key in settings.reference_tables, false, `${version} reference_tables.${key}`);
		}
	});

	const PROFILE = { nationality: 'PH', gender: 'FEMALE', date_of_birth: '1990-01-01', facts: {} };
	const HIRED = {
		id: 'k',
		approval_id: null,
		company_id: 'c',
		employee_id: 'p',
		exit_ground: null,
		effective_range: { from: '2026-03-02', to: null },
		exit_facts: null
	};
	const LEFT = {
		...HIRED,
		exit_ground: 'RESIGNATION',
		effective_range: { from: '2026-03-02', to: '2026-06-30' },
		exit_facts: { ground: 'RESIGNATION', last_day: '2026-06-30' }
	};

	it('every OBLIGATIONS row states its trigger, authority and a due date for that trigger', () => {
		const contexts = {
			PAYROLL_RUN: { period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' }, company },
			HIRE: { hired_on: '2026-03-02', contract: HIRED, employee: PROFILE, company },
			EXIT: { exit_on: '2026-06-30', contract: LEFT, employee: PROFILE, company },
			'leave_catalog_entry.created': {
				row: {
					occurred_on: '2026-03-02',
					catalog_code: 'MATERNITY_LEAVE',
					facts: { event_kind: 'BIRTH' }
				},
				today: '2026-03-02',
				employee: PROFILE,
				company,
				period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' }
			},
			'entity.created': {
				row: { effective_range: { from: '2026-03-02', to: null }, facts: {} },
				company,
				period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' }
			},
			'adhoc_catalog_entry.created': {
				row: { occurred_on: '2026-03-15', catalog_code: 'PROTECTION_ORDER_SUPPORT', facts: {} },
				employee: PROFILE,
				company,
				today: '2026-03-02',
				period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' }
			},
			'calendar.daily': {
				row: HIRED,
				contract: { ...HIRED, facts: { contract_terms: [{ employment_type: 'PROBATION' }] } },
				employee: PROFILE,
				company,
				today: '2026-08-02',
				period: { key: '2026-08', from: '2026-08-01', to: '2026-08-31' }
			}
		} as const;
		for (const version of versions) {
			const duties = dutiesOf(load(version, 'rule_set'));
			assert.equal(duties.length, 29, version);
			for (const duty of duties) {
				const rules: Row = { ...(duty.rules as Row), trigger: triggerOf(duty) };
				assert.ok(rules.description && rules.authority, `${version} ${duty.code}`);
				assert.ok(rules.trigger in contexts, `${version} ${duty.code}`);
				for (const month of rules.months ?? []) assert.match(month, /^(0[1-9]|1[0-2])$/);
				const due = evaluateConfigured(
					rules.due,
					contexts[rules.trigger as keyof typeof contexts] as never
				);
				assert.match(String(due), /^\d{4}-\d{2}-\d{2}$/, `${version} ${duty.code}`);
				if (rules.applies_when != null)
					assert.equal(
						typeof evaluateConfigured(
							rules.applies_when,
							contexts[rules.trigger as keyof typeof contexts] as never
						),
						'boolean'
					);
			}
		}
		const due = (code: string, context: object) =>
			evaluateConfigured(
				load(latest, 'rule_set').find((row) => row.code === code)!.rules.due,
				context as never
			);
		const march = { period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' }, company };
		const december = contexts.PAYROLL_RUN;
		assert.equal(due('SSS_CONTRIBUTION_REMITTANCE', march), '2026-04-30');
		assert.equal(due('PHILHEALTH_PREMIUM_REMITTANCE', march), '2026-04-15');
		assert.equal(due('HDMF_CONTRIBUTION_REMITTANCE', march), '2026-04-14');
		// The PEN's last digit and the employer's name group move the window (PhilHealth Circular 0001-2014, HDMF 275).
		const elected = (facts: object) => ({ ...march, company: { ...company, facts } });
		assert.equal(
			due(
				'PHILHEALTH_PREMIUM_REMITTANCE',
				elected({ philhealth_employer_number: '01-234567890-7' })
			),
			'2026-04-20'
		);
		assert.equal(
			due('HDMF_CONTRIBUTION_REMITTANCE', elected({ hdmf_remittance_group: 3 })),
			'2026-04-24'
		);
		assert.equal(
			due('HDMF_CONTRIBUTION_REMITTANCE', elected({ hdmf_remittance_group: 4 })),
			'2026-04-30'
		);
		assert.equal(due('BIR_1601C_MONTHLY_REMITTANCE', march), '2026-04-10');
		assert.equal(due('BIR_1601C_MONTHLY_REMITTANCE', december), '2027-01-15');
		assert.equal(due('BIR_1604C_ANNUAL_ALPHALIST', december), '2027-01-31');
		assert.equal(due('BIR_2316_CERTIFICATE', december), '2027-01-31');
		assert.equal(due('BIR_2316_SUBSTITUTED_FILING_LIST', december), '2027-02-28');
		assert.equal(due('THIRTEENTH_MONTH_PAYMENT', december), '2026-12-24');
		assert.equal(due('THIRTEENTH_MONTH_DOLE_REPORT', december), '2027-01-15');
		assert.equal(due('PHILHEALTH_EMPLOYEE_REPORT', contexts.HIRE), '2026-04-01');
		// SSS Employers page: report for coverage within 30 days from hiring date.
		assert.equal(due('SSS_EMPLOYEE_REPORT', contexts.HIRE), '2026-04-01');
		assert.equal(due('PHILHEALTH_SEPARATION_REPORT', contexts.EXIT), '2026-07-30');
		assert.equal(
			due('SSS_MATERNITY_NOTIFICATION', contexts['leave_catalog_entry.created']),
			'2026-04-01'
		);
		assert.equal(due('HDMF_EMPLOYER_REGISTRATION', contexts['entity.created']), '2026-04-01');
		assert.equal(due('BIR_EMPLOYEE_TIN_REGISTRATION', contexts.HIRE), '2026-03-12');
		assert.equal(due('FINAL_PAY_RELEASE', contexts.EXIT), '2026-07-30');
		assert.equal(due('CERTIFICATE_OF_EMPLOYMENT', contexts.EXIT), '2026-07-03');
	});

	it('the three obligation behaviours raise one obligation per due duty', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = behavioursOf(settings.behaviours);
			assert.ok(behaviours, version);
			const rows = load(version, 'rule_set');
			const raise = (
				collection: string,
				event: string,
				row: Row,
				extra: { reads?: Row; day?: string } = {}
			) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection,
					event,
					row,
					...(extra.day == null ? {} : { day: extra.day }),
					reads: extra.reads ?? {
						company: [company],
						employee: [
							row.nationality == null ? PROFILE : { ...PROFILE, nationality: row.nationality }
						]
					}
				}).map((data) => ({ data }));
			const run = (period: string) =>
				raise('payroll_run', 'created', { id: 'r', approval_id: null, period, company_id: 'c' });
			assert.equal(run('2026-03').length, 4, version);
			const december = run('2026-12');
			assert.equal(december.length, 10, version);
			assert.ok(december.every((write) => write.data.due_on != null));
			assert.equal(
				december.find((write) => write.data.duty_code === 'BIR_1604C_ANNUAL_ALPHALIST')?.data
					.due_on,
				'2027-01-31'
			);
			assert.equal(raise('employment_contract', 'created', HIRED).length, 4, version);
			// Labor Code art.40: only a foreign national's hire raises the Alien Employment Permit.
			const foreign = raise('employment_contract', 'created', { ...HIRED, nationality: 'IN' });
			assert.equal(foreign.length, 5, version);
			assert.ok(foreign.some((write) => write.data.duty_code === 'ALIEN_EMPLOYMENT_PERMIT'));
			// Labor Code art.298: a redundancy also owes the one-month notice to the employee and DOLE.
			const redundancy = raise('employment_contract', 'updated', {
				...LEFT,
				exit_ground: 'REDUNDANCY'
			});
			assert.equal(
				redundancy.find((write) => write.data.duty_code === 'AUTHORISED_CAUSE_TERMINATION_NOTICE')
					?.data.due_on,
				'2026-05-30'
			);
			const exit = raise('employment_contract', 'updated', LEFT);
			assert.deepEqual(exit.map((write) => [write.data.duty_code, write.data.due_on]).toSorted(), [
				['BIR_2316_LEAVER_CERTIFICATE', '2026-07-30'],
				['CERTIFICATE_OF_EMPLOYMENT', '2026-07-03'],
				['FINAL_PAY_RELEASE', '2026-07-30'],
				['HDMF_SEPARATION_REPORT', '2026-07-30'],
				['PHILHEALTH_SEPARATION_REPORT', '2026-07-30']
			]);
			// RA 10361 ss.11, 17 and the Omnibus Rules on probation: raised only for those terms.
			const termed = (employment_type: string) =>
				raise('employment_contract', 'created', {
					...HIRED,
					facts: { contract_terms: [{ employment_type }] }
				}).map((write) => write.data.duty_code);
			assert.ok(termed('DOMESTIC').includes('KASAMBAHAY_CONTRACT_AND_REGISTRY'), version);
			assert.ok(termed('PROBATION').includes('PROBATIONARY_STANDARDS'), version);
			assert.equal(termed('PERMANENT').length, 4, version);
			// RA 11210 s.5: a maternity leave entry raises the notice and the 30-day benefit advance.
			const entry = (collection: string, catalog_code: string) =>
				raise(collection, 'created', {
					id: 'l',
					approval_id: null,
					company_id: 'c',
					employment_id: 'k',
					employee_id: 'p',
					occurred_on: '2026-03-02',
					catalog_code,
					facts: { event_kind: 'BIRTH' }
				}).map((write) => [write.data.duty_code, write.data.due_on]);
			assert.deepEqual(entry('leave_catalog_entry', 'MATERNITY_LEAVE'), [
				['SSS_MATERNITY_NOTIFICATION', '2026-04-01']
			]);
			assert.deepEqual(entry('leave_catalog_entry', 'PATERNITY_LEAVE'), []);
			// RA 9262 s.8(g): each protection-order deduction is remitted.
			assert.deepEqual(entry('adhoc_catalog_entry', 'PROTECTION_ORDER_SUPPORT'), [
				['PROTECTION_ORDER_REMITTANCE', '2026-03-02']
			]);
			assert.deepEqual(entry('adhoc_catalog_entry', 'bonus'), []);
			// The daily tick: once on the day each occurrence falls, never on the days around it.
			const tick = (day: string, contract: Row, person: Row = PROFILE) =>
				raise('calendar', 'daily', contract, {
					reads: { company: [company], employee: [person] },
					day
				}).map((write) => [write.data.duty_code, write.data.due_on]);
			const probation = { ...HIRED, facts: { contract_terms: [{ employment_type: 'PROBATION' }] } };
			assert.deepEqual(tick('2026-08-02', probation), [['PROBATION_ENDS', '2026-09-01']]);
			assert.deepEqual(tick('2026-08-03', probation), []);
			const veteran = { ...HIRED, effective_range: { from: '2020-03-02', to: null } };
			assert.deepEqual(tick('2026-03-02', veteran), [['SIL_YEAR_END_COMMUTATION', '2026-03-02']]);
			assert.deepEqual(tick('2026-03-03', veteran), []);
			assert.deepEqual(tick('2026-03-02', HIRED), []);
			assert.deepEqual(tick('2026-05-17', veteran, { ...PROFILE, date_of_birth: '1961-05-17' }), [
				['COMPULSORY_RETIREMENT_AGE', '2026-05-17']
			]);
			assert.deepEqual(
				raise('entity', 'created', {
					id: 'c',
					approval_id: null,
					effective_range: { from: '2026-03-02', to: null },
					facts: {}
				}).map((write) => [write.data.duty_code, write.data.due_on]),
				[['HDMF_EMPLOYER_REGISTRATION', '2026-04-01']]
			);
		}
	});

	it('behaviours admit REGULAR/OFF_CYCLE payroll and encash unused service incentive leave on exit', () => {
		for (const version of versions) {
			const behaviours = settingsOf(version).behaviours as Behaviours;
			for (const kind of ['REGULAR', 'OFF_CYCLE'])
				assert.ok(
					planBehaviours(
						behaviours,
						{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
						{ event: { data: { request: { kind, period: '2026-10' } } } }
					).some((rule) => rule.id === 'payroll-run'),
					version
				);
		}
		const rule = (settingsOf(latest).behaviours as Behaviours).rules.find(
			(item) => item.id === 'encash-leave-on-exit'
		)!;
		const annual = load(latest, 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE')!;
		const exit = (from: string) => ({
			event: {
				settings_id: settingsOf(latest).id,
				row: {
					id: 'contract',
					approval_id: null,
					prior_service_months: 0,
					exit_facts: {},
					effective_range: { from, to: '2026-12-15' }
				}
			},
			catalogues: [
				{ id: annual.id, code: annual.code, unit: annual.unit, entitlement: annual.entitlement }
			],
			movements: [
				{
					catalog_id: annual.id,
					employment_id: 'contract',
					activity: 'TIME_OFF',
					days: 2,
					occurred_on: '2026-03-02',
					approval_id: null,
					reference: 'x'
				}
			]
		});
		// Labor Code art.95: five days a year once a year of service is rendered; none before.
		const [write] = effectWrites(rule, withBalances(exit('2024-01-02')));
		assert.equal(write?.data.days, 3);
		assert.equal(effectWrites(rule, withBalances(exit('2026-06-01'))).length, 0);
	});

	it('SSS Circular 2024-006: 15% split 5/10 on the MSC, Regular SS to 20,000, MPF above, EC 10/30', () => {
		for (const version of [versions[0]!, latest]) {
			const sss = scheme('SSS', version);
			const mpf = scheme('SSS_MPF', version);
			const ec = scheme('SSS_EC', version);
			assert.deepEqual(charge(sss, 4000), { employee: 250, employer: 500 });
			assert.deepEqual(charge(sss, 20000), { employee: 1000, employer: 2000 });
			assert.deepEqual(charge(sss, 50000), { employee: 1000, employer: 2000 });
			assert.deepEqual(charge(mpf, 20000), { employee: 0, employer: 0 });
			assert.deepEqual(charge(mpf, 20250), { employee: 25, employer: 50 });
			assert.deepEqual(charge(mpf, 25000), { employee: 250, employer: 500 });
			assert.deepEqual(charge(mpf, 50000), { employee: 750, employer: 1500 });
			assert.deepEqual(charge(ec, 14749.99), { employee: 0, employer: 10 });
			assert.deepEqual(charge(ec, 14750), { employee: 0, employer: 30 });
		}
	});

	it('SSS past sixty only for a member covered before sixty; a kasambahay in the first month pays nothing', () => {
		const sss = scheme('SSS');
		const at = (date_of_birth: string, elections: object, employment_type = 'PERMANENT') => {
			SUBJECT_ELECTIONS.value = { SSS: elections };
			const saved = { ...SUBJECT };
			Object.assign(SUBJECT, {
				employee: { ...employee, date_of_birth },
				terms: { ...terms, employment_type },
				employment: { ...employment, service_months: 0 }
			});
			try {
				const { employee: share, employer } = assess(latest, sss, { ordinary: 20000 });
				return { employee: share, employer };
			} finally {
				Object.assign(SUBJECT, saved);
				SUBJECT_ELECTIONS.value = {};
			}
		};
		assert.deepEqual(at('1990-01-01', {}), { employee: 1000, employer: 2000 });
		assert.deepEqual(at('1960-01-01', {}), { employee: 0, employer: 0 });
		assert.deepEqual(at('1960-01-01', { covered_before_60: true }), {
			employee: 1000,
			employer: 2000
		});
		assert.deepEqual(at('1990-01-01', {}, 'DOMESTIC'), { employee: 0, employer: 0 });
		// Owner ruling (opsph): an unrecorded date of birth is treated as under sixty.
		assert.deepEqual(at('', {}), { employee: 1000, employer: 2000 });
	});

	it('SSS Circular 2024-007: a household under 5,000 takes the 1,000–5,000 brackets, all paid by the employer', () => {
		const sss = scheme('SSS');
		const household = (ordinary: number) => {
			const saved = { ...SUBJECT };
			Object.assign(SUBJECT, {
				terms: { ...terms, employment_type: 'DOMESTIC', base_salary: ordinary }
			});
			try {
				const { employee: share, employer } = assess(latest, sss, { ordinary });
				return [share, employer];
			} finally {
				Object.assign(SUBJECT, saved);
			}
		};
		assert.deepEqual(household(1249.99), [0, 150]);
		assert.deepEqual(household(1250), [0, 225]);
		assert.deepEqual(household(4500), [0, 675]);
		assert.deepEqual(household(4999.99), [0, 750]);
		assert.deepEqual(household(5000), [250, 500]);
	});

	it('premium, overtime and night pay price each worked day at the Handbook multiple on the days-per-year factor', () => {
		const price = (code: string, facts: Row = {}, base = 31300) => {
			const row = load(latest, 'work_catalog').find((item) => item.code === code)!;
			const context = { ...RUN, terms: { ...terms, base_salary: base, facts } } as never;
			if (evaluateConfigured(row.eligibility, context) !== true) return 0;
			return cents(
				Number(evaluateConfigured(row.quantity, context)) *
					Number(evaluateConfigured(row.rate, context))
			);
		};
		// 31,300 × 12 ÷ 313 = 1,200 a day, 150 an hour.
		assert.equal(price('OVERTIME'), 375); // 2 h × 125%
		assert.equal(price('REST_DAY_WORK'), 1560); // 8 h × 130%: a 313 salary does not pay the rest day
		assert.equal(price('HOLIDAY_WORK'), 1200); // 8 h × (200% − the 100% the salary pays)
		assert.equal(price('SPECIAL_HOLIDAY_WORK'), 360); // 8 h × (130% − 100%)
		assert.equal(price('NIGHT_SHIFT_DIFFERENTIAL'), 120); // 8 night hours × 10%
		// 305: special days unpaid, so the whole 130% (31,300 × 12 ÷ 305 ÷ 8 = 153.93 an hour).
		assert.equal(price('SPECIAL_HOLIDAY_WORK', { days_per_year: 305 }), 1600.92);
		// 365: rest days paid, so only the 30% premium.
		assert.equal(price('REST_DAY_WORK', { days_per_year: 365 }), 308.71);
		// A double holiday not worked pays 200%: the salary pays one day, the line the second (Handbook ch.2 §D.3).
		const withDays = (days: Row[], facts: Row = {}) => {
			const context = {
				...RUN,
				work: { ...RUN.work, days },
				terms: { ...terms, base_salary: 31300, facts }
			} as never;
			return (code: string) => {
				const row = load(latest, 'work_catalog').find((item) => item.code === code)!;
				if (evaluateConfigured(row.eligibility, context) !== true) return 0;
				return cents(
					Number(evaluateConfigured(row.quantity, context)) *
						Number(evaluateConfigured(row.rate, context))
				);
			};
		};
		assert.equal(
			withDays([day('2026-04-09', 'WORK', { holiday_kind: 'DOUBLE_HOLIDAY' })])(
				'DOUBLE_HOLIDAY_UNWORKED'
			),
			1200
		);
		// An OFF day worked on a five-day week (261): 8 h at 100% of 31,300 × 12 ÷ 261 ÷ 8 = 179.89.
		const saturday = [
			day('2026-03-14', 'OFF', {
				worked_hours: 8,
				intervals: [shift('2026-03-14', '08:00', '16:00')]
			})
		];
		assert.equal(withDays(saturday, { days_per_year: 261 })('OFF_DAY_WORK'), 1439.08);
		assert.equal(withDays(saturday, { days_per_year: 313 })('OFF_DAY_WORK'), 0);
		// A double special day: 150% (195% on the rest day), the salary on 313 already paying the special day.
		const doubleSpecial = (day_type: string, extra: Row = {}) =>
			withDays([
				day('2026-11-02', day_type, {
					holiday_kind: 'DOUBLE_SPECIAL',
					worked_hours: 8,
					intervals: [shift('2026-11-02', '08:00', '16:00')],
					...extra
				})
			]);
		assert.equal(doubleSpecial('WORK')('SPECIAL_HOLIDAY_WORK'), 600); // 8 h × (150% − 100%)
		assert.equal(doubleSpecial('REST')('SPECIAL_HOLIDAY_WORK'), 2340); // 8 h × 195%: a 313 salary does not pay the rest day
		assert.equal(doubleSpecial('WORK', { overtime_hours: 2 })('OVERTIME'), 585); // 2 h × 195%
		assert.equal(
			doubleSpecial('WORK', { intervals: [shift('2026-11-02', '22:00', '06:00', true)] })(
				'NIGHT_SHIFT_DIFFERENTIAL'
			),
			180
		); // 8 night hours × 10% × 150%
		const managerial = {
			...RUN,
			employment: { ...employment, classification: 'MANAGERIAL' }
		} as never;
		for (const code of ['OVERTIME', 'REST_DAY_WORK', 'NIGHT_SHIFT_DIFFERENTIAL'])
			assert.equal(
				evaluateConfigured(
					load(latest, 'work_catalog').find((item) => item.code === code)!.eligibility,
					managerial
				),
				false
			);
	});

	it('PhilHealth 5% of the contractual basic between 10,000 and 100,000, employee half truncated', () => {
		const phic = scheme('PHIC');
		assert.deepEqual(charge(phic, 8000), { employee: 250, employer: 250 });
		assert.deepEqual(charge(phic, 15819), { employee: 395.47, employer: 395.48 });
		assert.deepEqual(charge(phic, 20000), { employee: 500, employer: 500 });
		assert.deepEqual(charge(phic, 150000), { employee: 2500, employer: 2500 });
		// A part month paid 10,000 of a 30,000 basic still pays on the whole contractual basic (Advisory 2025-0002).
		const part = assess(latest, phic, { ordinary: 10000 });
		assert.deepEqual([part.employee, part.employer], [750, 750]);
		for (const row of load(latest, 'work_catalog'))
			assert.equal(row.counts_toward.includes('PHIC'), row.code === 'BASIC', row.code);
	});

	it('WTAX de minimis ceilings move with RR 29-2025 and only their excess joins the 90,000 pool', () => {
		const excess = (version: string, wage: object, year: object) => {
			const { person } = assess(version, scheme('WTAX', version), wage, year);
			return cents(Number(person.pool_now) - Number(person.pool_before));
		};
		// March, two earlier months of 3,000 rice: the ceiling is read against three months elapsed.
		assert.equal(excess('version_1', { ordinary: 30000, rice: 3000 }, { rice: 6000 }), 1000);
		assert.equal(excess('version_2', { ordinary: 30000, rice: 3000 }, { rice: 6000 }), 500);
		// Uniform 7,000 a year under RR 4-2025, 8,000 under RR 29-2025.
		assert.equal(excess('version_1', { ordinary: 30000, uniform: 9000 }, {}), 2000);
		assert.equal(excess(latest, { ordinary: 30000, uniform: 9000 }, {}), 1000);
		// Monetised leave: 12 days of 30,000 × 12 ÷ 313 are de minimis from 6 January 2026 (10 before).
		assert.equal(excess(latest, { ordinary: 30000, leave: 15000 }, {}), 1198.08);
		assert.equal(excess('version_1', { ordinary: 30000, leave: 15000 }, {}), 3498.4);
		// The 13th month and the bonus are wholly inside the pool.
		assert.equal(excess(latest, { special: 30000, bonus: 5000 }, {}), 35000);
	});

	it('Pag-IBIG HDMF Circular 460: 1%/2% employee, 2% employer, 10,000 fund salary ceiling', () => {
		const hdmf = scheme('HDMF');
		assert.deepEqual(charge(hdmf, 1500), { employee: 15, employer: 30 });
		assert.deepEqual(charge(hdmf, 5000), { employee: 100, employer: 100 });
		assert.deepEqual(charge(hdmf, 20000), { employee: 200, employer: 200 });
	});

	it('a kasambahay takes only the RA 10361 leave class and no company loan recovery', () => {
		const as = (employment_type: string) => ({
			...ADMISSION,
			terms: { ...ADMISSION.terms, employment_type }
		});
		const leave = load(latest, 'leave_catalog');
		const loans = load(latest, 'loan_catalog');
		const eligible = (row: Row | undefined, type: string) =>
			evaluateConfigured(row!.eligibility, as(type) as never);
		for (const [type, domestic] of [
			['DOMESTIC', true],
			['PERMANENT', false]
		] as const) {
			assert.equal(
				eligible(
					leave.find((row) => row.code === 'ANNUAL_LEAVE_DOMESTIC'),
					type
				),
				domestic
			);
			assert.equal(
				eligible(
					leave.find((row) => row.code === 'ANNUAL_LEAVE'),
					type
				),
				!domestic
			);
			for (const code of ['COMPANY', 'LOAN_RECOVERY_COMPANY'])
				assert.equal(
					eligible(
						loans.find((row) => row.code === code),
						type
					),
					!domestic,
					code
				);
		}
	});

	it('statutory leave classes gate on the person, the event and the statutory length', () => {
		const leave = (code: string) => load(latest, 'leave_catalog').find((row) => row.code === code)!;
		const admit = (code: string, person: object, facts: object, extra: object = {}) =>
			evaluateConfigured(leave(code).eligibility, {
				...ADMISSION,
				employee: { ...employee, ...person },
				entry: { ...entry, event_kind: undefined, ...facts, facts },
				...extra
			} as never);
		const birth = { event_kind: 'BIRTH', days: 105 };
		assert.equal(admit('MATERNITY_LEAVE', {}, birth), true);
		assert.equal(admit('MATERNITY_LEAVE', {}, { ...birth, days: 106 }), false);
		assert.equal(admit('MATERNITY_LEAVE', { solo_parent: true }, { ...birth, days: 120 }), true);
		assert.equal(admit('MATERNITY_LEAVE', {}, { event_kind: 'MISCARRIAGE', days: 61 }), false);
		assert.equal(admit('MATERNITY_LEAVE', { gender: 'MALE' }, birth), false);
		assert.equal(
			admit('PATERNITY_LEAVE', { gender: 'MALE' }, { event_kind: 'BIRTH', days: 7 }),
			true
		);
		assert.equal(
			admit('PATERNITY_LEAVE', { gender: 'MALE' }, { event_kind: 'BIRTH', days: 8 }),
			false
		);
		assert.equal(
			admit(
				'PATERNITY_LEAVE',
				{ gender: 'MALE', marital_status: 'SINGLE' },
				{ event_kind: 'BIRTH' }
			),
			false
		);
		// RA 8187 s.2: the first four deliveries — a fifth is refused, a second entry of the fourth is not.
		const deliveries = (count: number) =>
			Array.from({ length: count }, (_, i) => ({
				id: `p${i}`,
				occurred_on: `202${i}-01-01`,
				facts: { event_id: `birth-${i}` }
			}));
		const father = (rows: Row[], event_id: string) =>
			evaluateConfigured(leave('PATERNITY_LEAVE').eligibility, {
				...ADMISSION,
				employee: { ...employee, gender: 'MALE' },
				entry: { ...entry, event_kind: 'BIRTH', days: 7, facts: { event_kind: 'BIRTH', event_id } },
				earlier: { rows, calendar_year: 0, lifetime: 0 }
			} as never);
		assert.equal(father(deliveries(3), 'birth-new'), true);
		assert.equal(father(deliveries(4), 'birth-new'), false);
		assert.equal(father(deliveries(4), 'birth-3'), true);
		assert.equal(
			father(
				[...deliveries(3), { id: 'p9', occurred_on: '2023-01-02', facts: { event_id: 'birth-2' } }],
				'birth-new'
			),
			true
		);
		assert.equal(admit('SOLO_PARENT_LEAVE', { solo_parent: true }, { days: 7 }), true);
		assert.equal(
			admit(
				'SOLO_PARENT_LEAVE',
				{ solo_parent: true },
				{ days: 7 },
				{
					employment: { ...employment, service_months: 5 }
				}
			),
			false
		);
		assert.equal(admit('VAWC_LEAVE', {}, { days: 10 }), true);
		assert.equal(admit('VAWC_LEAVE', {}, { days: 11 }), false);
		assert.equal(admit('SPECIAL_LEAVE_FOR_WOMEN', {}, { event_kind: 'SURGERY' }), true);
		assert.equal(
			evaluateConfigured(leave('ANNUAL_LEAVE').eligibility, {
				...ADMISSION,
				company: { ...company, facts: { small_establishment: true } }
			} as never),
			false
		);
	});

	it('statutory leave entitlements meter per service year, calendar year or event', () => {
		const leave = (code: string) => load(latest, 'leave_catalog').find((row) => row.code === code)!;
		const days = (code: string, months: number, person: Row = {}, facts: Row = {}) =>
			entitlementDays(leave(code).entitlement, months, {
				...SUBJECT,
				employee: { ...employee, ...person },
				entry: { facts },
				taken: { calendar_year: 0, service_year: 0, lifetime: 0, event: 0 }
			});
		const window = (code: string) => leave(code).entitlement.window;
		assert.deepEqual(
			[days('ANNUAL_LEAVE', 11), days('ANNUAL_LEAVE', 12), window('ANNUAL_LEAVE')],
			[0, 5, 'SERVICE_YEAR']
		);
		assert.deepEqual(
			[days('ANNUAL_LEAVE_DOMESTIC', 12), window('ANNUAL_LEAVE_DOMESTIC')],
			[5, 'SERVICE_YEAR']
		);
		assert.deepEqual(
			[days('SOLO_PARENT_LEAVE', 5), days('SOLO_PARENT_LEAVE', 6), window('SOLO_PARENT_LEAVE')],
			[0, 7, 'CALENDAR_YEAR']
		);
		assert.deepEqual(
			[
				days('MATERNITY_LEAVE', 1),
				days('MATERNITY_LEAVE', 1, { solo_parent: true }),
				window('MATERNITY_LEAVE')
			],
			[105, 120, 'EVENT']
		);
		for (const [code, expected] of [
			['PATERNITY_LEAVE', 7],
			['VAWC_LEAVE', 10],
			['SPECIAL_LEAVE_FOR_WOMEN', 60]
		] as const)
			assert.deepEqual([days(code, 24), window(code)], [expected, 'EVENT'], code);
		// Each pregnancy is its own balance (window_key = facts.event_id), read with its first entry.
		assert.equal(days('MATERNITY_LEAVE', 1, {}, { event_id: 'p1', event_kind: 'MISCARRIAGE' }), 60);
		assert.equal(days('MATERNITY_LEAVE', 1, {}, { event_id: 'p2', event_kind: 'BIRTH' }), 105);
		assert.ok(leave('PATERNITY_LEAVE').entitlement.window_key);
	});

	it('validations: the regional floor on contracts and payslips, minors’ hours and the kasambahay’s daily rest', () => {
		const check = (code: string, context: Row) =>
			evaluateConfigured(load(latest, 'rule_set').find((row) => row.code === code)!.rules.when, {
				...SUBJECT,
				rules: payrollRules(latest),
				...context
			} as never);
		const at = (base_salary: number, extra: Row = {}) => ({
			terms: { ...terms, base_salary, ...extra },
			term: { ...terms, base_salary, ...extra }
		});
		// NCR: the lowest floor in the table is NCR-26's 18,127.92 a month; NCR-28 raises it to 19,692.92 on 26 September 2026.
		assert.equal(check('MINIMUM_WAGE_FLOOR_CONTRACT', at(18000)), true);
		assert.equal(check('MINIMUM_WAGE_FLOOR_CONTRACT', at(19000)), false);
		assert.equal(
			check('MINIMUM_WAGE_FLOOR_CONTRACT', at(13600, { employment_type: 'APPRENTICE' })),
			false
		);
		assert.equal(
			check('MINIMUM_WAGE_FLOOR_CONTRACT', at(13500, { employment_type: 'APPRENTICE' })),
			true
		);
		assert.equal(
			check('MINIMUM_WAGE_FLOOR_CONTRACT', {
				...at(18000),
				company: { ...company, facts: { bmbe_certificate_of_authority: true } }
			}),
			false
		);
		const slip = (base: number, to: string) => ({ ...at(base), period: { ...RUN.period, to } });
		assert.equal(check('MINIMUM_WAGE_FLOOR_PAYSLIP', slip(19000, '2026-09-25')), false);
		assert.equal(check('MINIMUM_WAGE_FLOOR_PAYSLIP', slip(19000, '2026-10-31')), true);
		assert.equal(
			check('MINIMUM_WAGE_FLOOR_PAYSLIP', {
				...slip(7000, '2026-03-31'),
				terms: { ...terms, base_salary: 7000, employment_type: 'DOMESTIC' }
			}),
			true
		);
		const minor = { employee: { ...employee, age: 16 }, work: RUN.work };
		assert.equal(check('MINOR_WORKING_HOURS', minor), true);
		assert.equal(
			check('MINOR_WORKING_HOURS', { ...minor, employee: { ...employee, age: 30 } }),
			false
		);
		const long = { work: { ...RUN.work, days: [day('2026-03-02', 'WORK', { worked_hours: 17 })] } };
		assert.equal(
			check('KASAMBAHAY_DAILY_REST', { ...long, terms: { ...terms, employment_type: 'DOMESTIC' } }),
			true
		);
		assert.equal(check('KASAMBAHAY_DAILY_REST', long), false);
		// RA 12063: a trainee names its EBET programme; a general trainee is on an allowance, an upskilling one keeps the floor.
		const trainee = (employment_type: string, facts: Row) => at(10000, { employment_type, facts });
		assert.equal(check('EBET_PROGRAM_RECORDED', trainee('INTERN', {})), true);
		assert.equal(
			check('EBET_PROGRAM_RECORDED', trainee('APPRENTICE', { ebet_program: 'GENERAL' })),
			true
		);
		assert.equal(
			check('EBET_PROGRAM_RECORDED', trainee('APPRENTICE', { ebet_program: 'APPRENTICESHIP' })),
			false
		);
		assert.equal(
			check('MINIMUM_WAGE_FLOOR_CONTRACT', trainee('INTERN', { ebet_program: 'GENERAL' })),
			false
		);
		assert.equal(
			check('MINIMUM_WAGE_FLOOR_CONTRACT', trainee('INTERN', { ebet_program: 'UPSKILLING' })),
			true
		);
		for (const version of versions)
			for (const row of load(version, 'rule_set').filter((item) => item.family === 'VALIDATIONS')) {
				assert.ok(['contract', 'payslip'].includes(row.rules.site), row.code);
				assert.ok(['refuse', 'warn', 'hold'].includes(row.rules.kind), row.code);
				assert.ok(row.rules.message && row.rules.description, row.code);
			}
	});

	it('separation, retirement and kasambahay exit pay follow the Labor Code and RA 10361', () => {
		const adhoc = (code: string) => load(latest, 'adhoc_catalog').find((row) => row.code === code)!;
		const price = (code: string, exit: object, extra: object = {}) => {
			const context = {
				...RUN,
				entry: { ...entry, amount: 20000 },
				...extra,
				employment: { ...employment, ...exit }
			};
			const row = adhoc(code);
			if (evaluateConfigured(row.eligibility, context as never) !== true) return null;
			for (const band of row.bands)
				if (band.when === '' || evaluateConfigured(band.when, context as never) === true)
					return cents(evaluateConfigured(band.amount, context as never));
			return null;
		};
		// Labor Code art.298: 30 months is 2.5 → 3 years (a fraction of six months counts); 17 months is 1 year.
		assert.equal(price('SEPARATION_PAY', { exit_ground: 'REDUNDANCY' }), 96000);
		assert.equal(price('SEPARATION_PAY', { exit_ground: 'RETRENCHMENT' }), 48000);
		assert.equal(
			price('SEPARATION_PAY', { exit_ground: 'RETRENCHMENT', service_months: 17 }),
			32000
		);
		assert.equal(
			price('SEPARATION_PAY', {
				exit_ground: 'RETRENCHMENT',
				exit_facts: { termination_cause: 'CLOSURE_DUE_TO_SERIOUS_LOSSES' }
			}),
			null
		);
		assert.equal(
			price('SEPARATION_PAY', {
				exit_ground: 'DISMISSAL',
				exit_facts: { terminated_for_disease: true }
			}),
			48000
		);
		assert.equal(price('SEPARATION_PAY', { exit_ground: 'RESIGNATION' }), null);
		// Customer input `termination_cause`: Handbook ch.14 §C's further causes.
		const cause = (termination_cause: string) =>
			price('SEPARATION_PAY', { exit_ground: 'DISMISSAL', exit_facts: { termination_cause } });
		assert.equal(cause('IMPOSSIBLE_REINSTATEMENT'), 96000);
		assert.equal(cause('SECURITY_GUARD_NO_ASSIGNMENT'), 48000);
		assert.equal(cause('CONTRACTOR_NO_ASSIGNMENT'), 48000);
		assert.equal(cause('CLOSURE_DUE_TO_SERIOUS_LOSSES'), null);
		// RA 7641: 22.5 days × (30,000 × 12 ÷ 313) × 10 years (125 months).
		const retire = { employee: { ...employee, age: 61 } };
		// Handbook ch.15 §B: sixty to sixty-five.
		assert.equal(
			price(
				'RETIREMENT_PAY',
				{ exit_ground: 'RETIREMENT', service_months: 125 },
				{ employee: { ...employee, age: 66 } }
			),
			null
		);
		assert.equal(
			price('RETIREMENT_PAY', { exit_ground: 'RETIREMENT', service_months: 125 }, retire),
			258785.94
		);
		assert.equal(
			price(
				'RETIREMENT_PAY',
				{ exit_ground: 'RETIREMENT', service_months: 125 },
				{
					...retire,
					company: { ...company, facts: { retirement_exempt_establishment: true } }
				}
			),
			null
		);
		const domestic = {
			terms: {
				...terms,
				employment_type: 'DOMESTIC',
				base_salary: 7800,
				facts: { days_per_year: 365 }
			}
		};
		// RA 10361 s.32: fifteen days of 7,800 × 12 ÷ 365.
		assert.equal(
			price(
				'KASAMBAHAY_INDEMNITY',
				{ exit_facts: { kasambahay_unjust_dismissal: true } },
				domestic
			),
			3846.58
		);
		assert.equal(
			price(
				'KASAMBAHAY_FORFEITURE',
				{ exit_facts: { kasambahay_unjustified_departure: true } },
				domestic
			),
			3846.58
		);
	});

	describe('a PH payroll on the engine', () => {
		const { tables, run, lines, COMPANY } = harness();
		it('March 2026 (NCR floor 18,127.92): contributions, WTAX net of shares, the MWE and the kasambahay', async () => {
			const march = await run('2026-03', 'REGULAR');
			assert.deepEqual(lines(march, 'p1'), {
				SSS: [1000, 2000],
				SSS_MPF: [500, 1000],
				SSS_EC: [0, 30],
				PHIC: [750, 750],
				HDMF: [200, 200],
				// 30,000 − (1,500 SSS + 750 PHIC + 200 HDMF) = 27,550 → 15% over 20,833.
				WTAX: [1007.55, 0]
			});
			// A minimum wage earner (18,000 ≤ 18,127.92): only the 10,000 allowance is taxable — under the threshold.
			assert.deepEqual(lines(march, 'p2').WTAX, [0, 0]);
			// Above the floor: 28,600 − (1,425 + 465 + 200) = 26,510 → 851.55.
			assert.deepEqual(lines(march, 'p3').WTAX, [851.55, 0]);
			// RA 10361 s.30: under 5,000 the household employer pays the PhilHealth and Pag-IBIG shares.
			const kasambahay = lines(march, 'p4');
			assert.deepEqual(kasambahay.PHIC, [0, 500]);
			assert.deepEqual(kasambahay.HDMF, [0, 180]);
			assert.deepEqual(kasambahay.WTAX, [0, 0]);
		});

		it('December 2026: 13th month and bonus inside the 90,000 pool, only the excess withheld', async () => {
			await run('2026-12', 'REGULAR');
			const at = (code: string) =>
				String(
					tables
						.get('adhoc_catalog')!
						.find((row) => row.code === code && row.settings_id === settingsOf(latest).id)!.id
				);
			for (const [id, code, amount] of [
				['t13', 'THIRTEENTH_MONTH_PAY_YEAR_END', 1],
				['b1', 'bonus', 90000]
			] as const)
				tables.get('adhoc_catalog_entry')!.push({
					id,
					catalog_id: at(code),
					employment_id: 'k-p1',
					company_id: COMPANY,
					approval_id: null,
					payslip_id: null,
					occurred_on: '2026-12-15',
					amount,
					activity: 'PAYMENT'
				});
			const settlement = await run('2026-12', 'OFF_CYCLE', ['t13', 'b1']);
			const slip = settlement.payslips.find((row) => row.employment_id === 'k-p1')!;
			// PD 851: a twelfth of the year's basic — March and December's regular slips, 60,000 → 5,000, whatever is keyed.
			assert.equal(
				slip.adjustments.find((line) => line.component_code === 'THIRTEENTH_MONTH_PAY_YEAR_END')
					?.amount,
				5000
			);
			const paid = lines(settlement, 'p1');
			// SSS base 120,000 → MSC 35,000: MPF 750 (500 already charged). WTAX: 30,000 − 2,700 shares + the pool's
			// excess (5,000 + 90,000 − 90,000) = 32,300 → 1,720.05 for the month, 1,007.55 of it already withheld.
			assert.deepEqual(paid.SSS_MPF, [250, 500]);
			assert.deepEqual(paid.WTAX, [712.5, 0]);
		});
	});

	it('semi-monthly halves pay half the basic each and settle the month’s statutory totals', async () => {
		const engine = harness('SEMI_MONTHLY');
		const halves = [
			await engine.run('2026-03-1', 'REGULAR'),
			await engine.run('2026-03-2', 'REGULAR')
		];
		const p1 = halves.map((plan) => plan.payslips.find((row) => row.employment_id === 'k-p1')!);
		assert.deepEqual(
			p1.map((slip) => slip.base.find((line) => line.component_code === 'BASIC')?.amount),
			[15000, 15000]
		);
		const totals: Row = {};
		for (const slip of p1)
			for (const line of slip.statutory) {
				const held = totals[line.scheme_code] ?? [0, 0];
				totals[line.scheme_code] = [
					cents(held[0] + line.employee_amount),
					cents(held[1] + line.employer_amount)
				];
			}
		// The same month as the monthly March run.
		assert.deepEqual(totals, {
			SSS: [1000, 2000],
			SSS_MPF: [500, 1000],
			SSS_EC: [0, 30],
			PHIC: [750, 750],
			HDMF: [200, 200],
			WTAX: [1007.55, 0]
		});
	});

	it('an OFF_CYCLE bonus before or after the REGULAR run settles the same month totals', async () => {
		const scenario = async (bonusFirst: boolean) => {
			const engine = harness();
			const bonus = engine.tables
				.get('adhoc_catalog')!
				.find((row) => row.code === 'bonus' && row.settings_id === settingsOf(latest).id)!;
			const pay = () =>
				engine.tables.get('adhoc_catalog_entry')!.push({
					id: 'b',
					catalog_id: bonus.id,
					employment_id: 'k-p1',
					company_id: engine.COMPANY,
					approval_id: null,
					payslip_id: null,
					occurred_on: '2026-03-20',
					amount: 120000,
					activity: 'PAYMENT'
				});
			const plans = [];
			if (bonusFirst) {
				pay();
				plans.push(
					await engine.run('2026-03', 'OFF_CYCLE', ['b']),
					await engine.run('2026-03', 'REGULAR')
				);
			} else {
				plans.push(await engine.run('2026-03', 'REGULAR'));
				pay();
				plans.push(await engine.run('2026-03', 'OFF_CYCLE', ['b']));
			}
			const totals: Row = {};
			for (const plan of plans)
				for (const line of plan.payslips.find((row) => row.employment_id === 'k-p1')!.statutory) {
					const held = totals[line.scheme_code] ?? [0, 0];
					totals[line.scheme_code] = [
						cents(held[0] + line.employee_amount),
						cents(held[1] + line.employer_amount)
					];
				}
			return totals;
		};
		const after = await scenario(false);
		assert.deepEqual(await scenario(true), after);
		// 150,000 paid in March: SSS on MSC 35,000; WTAX on 30,000 + 120,000 − 90,000 − 2,700 shares = 57,300.
		assert.deepEqual(after.SSS, [1000, 2000]);
		assert.deepEqual(after.SSS_MPF, [750, 1500]);
		assert.deepEqual(after.WTAX, [6668.4, 0]);
	});
});

/** The private opsph sample (seed_bank/norbital_hr/records/opsph), when the bank sits beside the template. */
const SAMPLE = resolve(process.cwd(), '../../seed_bank/norbital_hr/records/opsph');
const sample = (name: string): Row[] =>
	existsSync(resolve(SAMPLE, `${name}.json`))
		? (JSON.parse(readFileSync(resolve(SAMPLE, `${name}.json`), 'utf8')) as Row[])
		: [];

describe('opsph sample records', { skip: !existsSync(SAMPLE) }, () => {
	const versionOn = (on: string) =>
		versions.find((version) => {
			const range = settingsOf(version).effective_range;
			return range.from <= on && (range.to == null || on <= range.to);
		}) ?? versions[0]!;
	const ids = (table: string, on?: string) =>
		new Set(
			(on == null ? versions : [versionOn(on)]).flatMap((version) =>
				load(version, table).map((row) => row.id)
			)
		);

	it('every reference resolves to a sample row or to the PH class of the version in force', () => {
		const [entity] = sample('entity');
		assert.equal(entity!.settings_code, 'PH');
		assert.equal(entity!.region, 'IV-A');
		const definitions = new Set(sample('shift_definition').map((row) => row.id));
		const patterns = new Set(sample('shift_pattern').map((row) => row.id));
		for (const pattern of sample('shift_pattern'))
			for (const slot of pattern.pattern.days)
				assert.ok(definitions.has(slot.roster_code_id), pattern.code);
		const profiles = new Map(sample('employment_profile').map((row) => [row.id, row]));
		const users = new Set(sample('sys_user').map((row) => row.id));
		const statutory = ids('statutory_contribution_catalog');
		const settings = settingsOf(latest);
		const schema = settings.employee_input_schema.properties.contract_terms.items.properties;
		for (const profile of profiles.values()) {
			if (profile.user_id != null) assert.ok(users.has(profile.user_id), profile.name);
			assert.equal(profile.date_of_birth, undefined, 'the source states no date of birth');
			for (const standing of profile.facts.employment_statutory_facts)
				assert.ok(statutory.has(standing.statutory_contribution_id), profile.name);
		}
		const contracts = new Map(sample('employment_contract').map((row) => [row.id, row]));
		for (const contract of contracts.values()) {
			assert.ok(profiles.has(contract.employee_id));
			assert.equal(contract.company_id, entity!.id);
			for (const term of contract.facts.contract_terms) {
				assert.ok(patterns.has(term.shift_pattern_id), contract.employee_number);
				for (const key of [
					'employment_type',
					'work_classification',
					'statutory_work_category',
					'residency_status'
				])
					assert.ok(
						schema[key].enum.includes(term[key]),
						`${contract.employee_number} ${key}=${term[key]}`
					);
				assert.ok(schema.facts.properties.days_per_year.enum.includes(term.facts.days_per_year));
				for (const allowance of term.allowances)
					assert.ok(ids('allowance_catalog').has(allowance.catalogue_id), allowance.code);
			}
		}
		for (const row of sample('roster_entry')) {
			assert.ok(contracts.has(row.employment_id));
			assert.ok(definitions.has(row.shift_definition_id));
			for (const interval of row.worked_intervals ?? []) assert.match(interval.start, /Z$/);
		}
		for (const [file, table] of [
			['leave_catalog_entry', 'leave_catalog'],
			['adhoc_catalog_entry', 'adhoc_catalog'],
			['loan_catalog_entry', 'loan_catalog']
		] as const)
			for (const row of sample(file)) {
				assert.ok(contracts.has(row.employment_id), `${file} ${row.id}`);
				assert.ok(
					ids(table, row.occurred_on).has(row.catalog_id),
					`${file} ${row.id} on ${row.occurred_on}`
				);
				assert.ok(Number(row.amount ?? row.days) > 0, `${file} ${row.id}`);
				for (const derived of ['payslip_id', 'pay', 'statutory'])
					assert.equal(derived in row, false);
			}
		const counts = Object.fromEntries(
			[
				'entity',
				'shift_definition',
				'shift_pattern',
				'holiday',
				'employment_profile',
				'employment_contract',
				'roster',
				'roster_entry',
				'leave_catalog_entry',
				'adhoc_catalog_entry',
				'loan_catalog_entry',
				'sys_user'
			].map((name) => [name, sample(name).length])
		);
		assert.deepEqual(counts, {
			entity: 1,
			shift_definition: 4,
			shift_pattern: 3,
			holiday: 30,
			employment_profile: 20,
			employment_contract: 20,
			roster: 39,
			roster_entry: 689,
			leave_catalog_entry: 98,
			adhoc_catalog_entry: 3,
			loan_catalog_entry: 13,
			sys_user: 17
		});
	});
	it('the semi-monthly sample pays both halves of January; the halves settle the month (DOB absent: under sixty)', async () => {
		const tables = new Map<string, Row[]>();
		for (const table of TABLES)
			tables.set(
				table,
				versions
					.flatMap((version) => load(version, table))
					.map((row) => ({ approval_id: null, ...row }))
			);
		for (const name of [
			'entity',
			'shift_definition',
			'shift_pattern',
			'holiday',
			'employment_profile',
			'employment_contract',
			'roster_entry',
			'leave_catalog_entry',
			'adhoc_catalog_entry',
			'loan_catalog_entry'
		])
			tables.set(
				name,
				sample(name).map((row) => ({ approval_id: null, payslip_id: null, ...row }))
			);
		for (const name of ['claim_catalog_entry', 'payslip', 'payroll_run']) tables.set(name, []);
		const clause = (row: Row, key: string, spec: unknown): boolean => {
			const value = row[key];
			if (spec == null || typeof spec !== 'object') return value === spec;
			return Object.entries(spec as Row).every(([op, operand]) => {
				if (op === 'eq') return value === operand;
				if (op === 'in') return Array.isArray(operand) && operand.includes(value);
				if (op === 'isNull') return operand ? value == null : value != null;
				if (op === 'gte') return value != null && value >= operand;
				if (op === 'lte') return value != null && value <= operand;
				throw new Error(`fixture reader: unsupported operator ${op}`);
			});
		};
		const reads = {
			read: (collection: unknown, query: unknown) => {
				const { where = {}, select = {} } = query as { where?: Row; select?: Row };
				return Effect.succeed({
					rows: (tables.get(String(collection)) ?? [])
						.filter((row) => Object.entries(where).every(([key, spec]) => clause(row, key, spec)))
						.map((row) =>
							Object.fromEntries(
								Object.keys(select)
									.filter((key) => key in row)
									.map((key) => [key, row[key]])
							)
						)
				});
			}
		};
		/** One half's run, stored as the next half's history: its slips, and its pins on the rows they consumed. */
		const half = async (period: string) => {
			const plan = await Effect.runPromise(
				buildPayrollRun({
					company_id: sample('entity')[0]!.id,
					period,
					kind: 'REGULAR'
				}).pipe(Effect.provideService(Reads, reads))
			);
			tables.get('payroll_run')!.push({
				id: period,
				company_id: sample('entity')[0]!.id,
				kind: 'REGULAR',
				period
			});
			for (const [i, slip] of plan.payslips.entries()) {
				const id = `${period}:${i}`;
				tables.get('payslip')!.push({ ...slip, id, payroll_run_id: period });
				for (const pin of slip.pins)
					for (const row of tables.get(pin.collection) ?? [])
						if (row.id === pin.id) row.payslip_id = id;
			}
			return plan;
		};
		const first = await half('2026-01-1');
		const second = await half('2026-01-2');
		assert.equal(first.run.salary_to, '2026-01-15');
		assert.equal(second.run.salary_from, '2026-01-16');
		// The 21st cutoff moves the month's attendance to 21 December – 20 January; each half by the same offset.
		assert.deepEqual(
			[first, second].map((plan) => [plan.run.attendance_from, plan.run.attendance_to]),
			[
				['2025-12-21', '2026-01-04'],
				['2026-01-05', '2026-01-20']
			]
		);
		const number = new Map(
			sample('employment_contract').map((row) => [row.id, row.employee_number])
		);
		// 19 employments in force in January 2026 (OPSPH028 left in January 2025).
		assert.equal(first.payslips.length, 19);
		assert.equal(second.payslips.length, 19);
		// Month to date: the second half charges the month's liability less the first half's.
		const statutory = (employee_number: string) => {
			const sums: Record<string, [number, number]> = {};
			for (const line of [...first.payslips, ...second.payslips]
				.filter((row) => number.get(row.employment_id) === employee_number)
				.flatMap((row) => row.statutory)) {
				const [employee, employer] = sums[line.scheme_code] ?? [0, 0];
				sums[line.scheme_code] = [
					Math.round((employee + line.employee_amount) * 100) / 100,
					Math.round((employer + line.employer_amount) * 100) / 100
				];
			}
			return sums;
		};
		const plan = { payslips: [...first.payslips, ...second.payslips] };
		// OPSPH006: 15,650 is IV-A's ₱600 floor × 313 ÷ 12 — a minimum wage earner; 18,610.63 compensation → MSC 18,500.
		assert.deepEqual(statutory('OPSPH006'), {
			HDMF: [200, 200],
			PHIC: [391.25, 391.25],
			SSS: [925, 1850],
			SSS_EC: [0, 30],
			SSS_MPF: [0, 0],
			WTAX: [0, 0]
		});
		// OPSPH034 (130,000 basic): MSC 35,000 over the two halves — Regular SS 1,000/2,000 and MPF 750/1,500 for the month.
		assert.deepEqual(
			[statutory('OPSPH034').SSS, statutory('OPSPH034').SSS_MPF],
			[
				[1000, 2000],
				[750, 1500]
			]
		);
		// No date of birth anywhere in the source: every citizen is still charged SSS (owner ruling: under sixty).
		assert.ok(
			plan.payslips.every((row) => row.statutory.some((line: Row) => line.scheme_code === 'SSS'))
		);
		// …and each half's run says so, once per slip.
		for (const half of [first, second])
			assert.equal(
				half.warnings.filter((warning) => warning.endsWith('SSS treats the employee as under 60.'))
					.length,
				19
			);
	});
});
