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
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import { evaluateStrict as evaluateConfigured } from '../src/lib/payroll_engine/expressions.ts';
import { Reads } from '../src/lib/payroll_engine/foundation.ts';
import { dutiesOf, raiseDuties, triggerOf, withBalances } from './duties.ts';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.ts';
import { entitlementDays } from '../src/lib/payroll_engine/leave.ts';
import { recordDocuments } from '../src/lib/payroll_engine/export.ts';
import { runEngine, type HostRead } from '../src/lib/payroll_engine/foundation.ts';
import { planRosterImport } from '../src/lib/payroll_engine/roster_import.ts';

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
	'work_catalog',
	'suspension_kind'
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
const company = {
	region: 'NCR',
	risk_class: '',
	pay_frequency: 'SEMI_MONTHLY',
	headcount: 20,
	facts: {}
};
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
	start_date: '2024-01-01',
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
		parts: 1,
		month_key: '2026-03',
		month_from: '2026-03-01',
		month_to: '2026-03-31',
		month_days: 31
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
		previous_month: { base_salary: 30000 },
		months: [],
		history: []
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
	...extra,
	worked: extra.worked ?? Number(extra.worked_hours ?? 0) > 0
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
Object.assign(RUN.period, {
	covered_days: 31,
	working_days: 22,
	part: 1,
	parts: 1,
	month_key: '2026-03',
	month_from: '2026-03-01',
	month_to: '2026-03-31',
	pay_date: '2026-03-31',
	unpaid_working_days: 0
});
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
const assess = (
	version: string,
	row: Row,
	wage: { [part: string]: number },
	year: object = {},
	extra: Row = {}
) => {
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
			salary_paid: false,
			part: 1,
			parts: 1,
			month_key: '2026-03',
			month_from: '2026-03-01',
			month_to: '2026-03-31',
			pay_date: '2026-03-31'
		},
		earned: { month: {}, year: {}, previous_month: {}, months: [], history: [] },
		lines: [],
		work: { days: [], holidays: [], dates: [], overtime_hours: 0, incentive_hours: 0 },
		hours: {},
		leave: { rows: [] },
		...extra
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
						assert.doesNotThrow(() => evaluateConfigured(text, context as never), where);
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
			assert.equal('reference_tables' in settings, false, `${version} reference_tables`);
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
			'entity.updated': {
				row: { name: 'New', region: 'NCR', facts: {}, before: { name: 'Old' } },
				company,
				today: '2026-05-04',
				period: { key: '2026-05', from: '2026-05-01', to: '2026-05-31' }
			},
			'entity.calendar': {
				headcount: 300,
				row: { facts: { npc_registered_on: '2025-11-01' } },
				company: { ...company, facts: { npc_registered_on: '2025-11-01' } },
				today: '2026-10-08',
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' }
			},
			'entity.created': {
				headcount: 20,
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
			},
			'payslip.updated': {
				row: { paid_on: '2026-03-31', line_codes: ['BASIC', 'LOAN_RECOVERY_SSS_SALARY'] },
				employee: PROFILE,
				company,
				today: '2026-03-31',
				period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' }
			},
			'obligation.updated': {
				row: {
					duty_code: 'SSS_CONTRIBUTION_REMITTANCE',
					state: 'FULFILLED',
					due_on: '2026-04-30',
					fulfilled_on: '2026-05-12'
				},
				company,
				today: '2026-05-12',
				period: { key: '2026-05', from: '2026-05-01', to: '2026-05-31' }
			},
			'workplace_case.created': {
				row: { kind: 'WORK_ACCIDENT', opened_on: '2026-03-02', closed_on: null, facts: {} },
				company,
				today: '2026-03-02',
				period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' }
			},
			'employment_profile.updated': {
				row: { facts: { coe_requested_on: '2026-03-10' } },
				employee: PROFILE,
				company,
				today: '2026-03-10',
				period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' }
			}
		} as const;
		for (const version of versions) {
			const duties = dutiesOf(load(version, 'rule_set'));
			assert.equal(duties.length, 63, version);
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
		// The yearly duties run on the entity's calendar: the year-end window from 1 December.
		const yearEnd = { ...contexts['entity.calendar'], headcount: 20, today: '2026-12-05' };
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
		assert.equal(due('BIR_1604C_ANNUAL_ALPHALIST', yearEnd), '2027-01-31');
		assert.equal(due('BIR_2316_CERTIFICATE', yearEnd), '2027-01-31');
		assert.equal(due('BIR_2316_SUBSTITUTED_FILING_LIST', yearEnd), '2027-02-28');
		assert.equal(due('THIRTEENTH_MONTH_PAYMENT', yearEnd), '2026-12-24');
		assert.equal(due('THIRTEENTH_MONTH_DOLE_REPORT', yearEnd), '2027-01-15');
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
		// The rest of the raised duties' due days (review C).
		assert.equal(due('BIR_YEAR_END_ADJUSTMENT', yearEnd), '2027-01-25');
		assert.equal(due('HDMF_EMPLOYEE_REGISTRATION', contexts.HIRE), '2026-04-01');
		assert.equal(due('ALIEN_EMPLOYMENT_PERMIT', contexts.HIRE), '2026-03-02');
		assert.equal(due('KASAMBAHAY_CONTRACT_AND_REGISTRY', contexts.HIRE), '2026-03-02');
		assert.equal(due('PROBATIONARY_STANDARDS', contexts.HIRE), '2026-03-02');
		assert.equal(due('HDMF_SEPARATION_REPORT', contexts.EXIT), '2026-07-30');
		// RR 11-2018: the 1603Q falls on the last day of the month after the quarter.
		const month = (key: string) => ({
			period: { key, from: `${key}-01`, to: `${key}-28` },
			company
		});
		assert.equal(due('BIR_1603Q_FRINGE_BENEFITS', month('2026-01')), '2026-04-30');
		assert.equal(due('BIR_1603Q_FRINGE_BENEFITS', month('2026-02')), '2026-04-30');
		assert.equal(due('BIR_1603Q_FRINGE_BENEFITS', month('2026-03')), '2026-04-30');
		assert.equal(due('BIR_1603Q_FRINGE_BENEFITS', month('2026-12')), '2027-01-31');
		for (const version of versions)
			assert.equal(
				evaluateConfigured(
					load(version, 'rule_set').find((row) => row.code === 'SSS_MATERNITY_NOTIFICATION')!.rules
						.due,
					contexts['leave_catalog_entry.created'] as never
				),
				'2026-04-01'
			);
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
			assert.equal(run('2026-03').length, 5, version);
			const december = run('2026-12');
			assert.equal(december.length, 5, version);
			assert.ok(december.every((write) => write.data.due_on != null));
			// The yearly duties are no longer the December run's (they ride the entity calendar).
			assert.ok(!december.some((write) => write.data.duty_code === 'BIR_1604C_ANNUAL_ALPHALIST'));
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
				['PERSONAL_DATA_DISPOSAL', '2032-12-31'],
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
			// The SIL commutation is now the window-end encashment, not a task.
			assert.deepEqual(tick('2026-03-02', veteran), []);
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
				[
					['HDMF_EMPLOYER_REGISTRATION', '2026-04-01'],
					['BIR_WITHHOLDING_AGENT_REGISTRATION', '2026-03-02'],
					['SSS_EMPLOYER_REGISTRATION', '2026-03-02'],
					['PHILHEALTH_EMPLOYER_REGISTRATION', '2026-03-02'],
					['DOLE_ESTABLISHMENT_REGISTRATION', '2026-03-02'],
					['DPO_DESIGNATION', '2026-03-02']
				]
			);
			// New duties keyed by their own triggers.
			const codes = (writes: { data: Row }[]) =>
				writes.map((write) => [write.data.duty_code, write.data.due_on]);
			const domesticExit = {
				...LEFT,
				exit_ground: 'RESIGNATION',
				facts: { contract_terms: [{ employment_type: 'DOMESTIC' }] }
			};
			assert.ok(
				codes(raise('employment_contract', 'updated', domesticExit)).some(
					([code, due]) => code === 'KASAMBAHAY_TERMINATION_NOTICE' && due === '2026-06-25'
				),
				version
			);
			assert.ok(
				codes(raise('employment_contract', 'updated', { ...LEFT, exit_ground: 'DISMISSAL' })).some(
					([code, due]) => code === 'JUST_CAUSE_TWIN_NOTICE' && due === '2026-06-25'
				),
				version
			);
			assert.ok(
				codes(
					raise('employment_contract', 'created', {
						...HIRED,
						facts: { contract_terms: [{ employment_type: 'CAREGIVER' }] }
					})
				).some(([code, due]) => code === 'CAREGIVER_CONTRACT' && due === '2026-03-02'),
				version
			);
			const leaveEntry = (catalog_code: string, facts: Row, days = 5) =>
				codes(
					raise('leave_catalog_entry', 'created', {
						id: 'l2',
						approval_id: null,
						company_id: 'c',
						employment_id: 'k',
						employee_id: 'p',
						occurred_on: '2026-03-02',
						days,
						catalog_code,
						facts
					})
				);
			assert.deepEqual(leaveEntry('MEDICAL_LEAVE', { work_connected: true }).toSorted(), [
				['EC_CONTINGENCY_REPORT', '2026-03-12'],
				['EC_LOGBOOK_ENTRY', '2026-03-07'],
				['SSS_SICKNESS_NOTIFICATION', '2026-03-07']
			]);
			assert.deepEqual(leaveEntry('MEDICAL_LEAVE', {}, 2), []);
			const slip = (line_codes: string[]) =>
				codes(
					raise(
						'payslip',
						'updated',
						{
							id: 's',
							approval_id: null,
							company_id: 'c',
							employment_id: 'k',
							paid_on: '2026-03-31',
							line_codes
						},
						{ day: '2026-03-31' }
					)
				);
			assert.deepEqual(slip(['BASIC', 'LOAN_RECOVERY_SSS_SALARY', 'HDMF_MP2']).toSorted(), [
				['PAGIBIG_LOAN_REMITTANCE', '2026-04-14'],
				['SSS_LOAN_REMITTANCE', '2026-04-30']
			]);
			assert.deepEqual(slip(['BASIC']), []);
			assert.deepEqual(
				codes(
					raise('employment_profile', 'updated', {
						id: 'p',
						approval_id: null,
						company_id: 'c',
						facts: { coe_requested_on: '2026-03-10' }
					})
				),
				[['CERTIFICATE_OF_EMPLOYMENT_CURRENT', '2026-03-13']]
			);
			assert.deepEqual(
				codes(
					raise(
						'payroll_run',
						'created',
						{ id: 'r2', approval_id: null, period: '2026-03', company_id: 'c' },
						{
							reads: {
								company: [{ ...company, facts: { collects_service_charges: true } }],
								employee: [PROFILE]
							}
						}
					)
				).filter(([code]) => code === 'SERVICE_CHARGE_DISTRIBUTION'),
				[['SERVICE_CHARGE_DISTRIBUTION', '2026-03-31']]
			);
		}
	});

	it('PH-OBLIGATION: unused service incentive leave is paid at the daily rate on the service year’s last day, once; a kasambahay’s is not', () => {
		for (const version of versions) {
			const classes = load(version, 'leave_catalog');
			const annual = classes.find((row) => row.code === 'ANNUAL_LEAVE')!;
			assert.equal(annual.encash_at_window_end, true);
			assert.equal(annual.entitlement.window, 'SERVICE_YEAR');
			assert.ok(!classes.find((row) => row.code === 'ANNUAL_LEAVE_DOMESTIC')!.encash_at_window_end);
			const pack = settingsOf(version).behaviours as Behaviours;
			const context = (day: string, reference: string | null) => ({
				event: {
					collection: 'calendar',
					action: 'daily',
					settings_id: settingsOf(version).id,
					day,
					row: { id: 'k', approval_id: null },
					leave_balances: [{ code: 'ANNUAL_LEAVE', available: 3, window_to: '2027-03-01' }]
				},
				catalogues: [{ id: annual.id, code: 'ANNUAL_LEAVE' }],
				movements: reference == null ? [] : [{ reference }]
			});
			const writes = (day: string, reference: string | null = null) =>
				planBehaviours(
					pack,
					{ kind: 'row', collection: 'calendar', event: 'daily' },
					context(day, reference)
				)
					.filter((rule) => rule.id === 'encash-leave-at-window-end')
					.flatMap((rule) => effectWrites(rule, context(day, reference)))
					.map((write) => write.data as Row);
			// Service year 2 March 2026 – 1 March 2027: three days left on its last day.
			assert.deepEqual(
				writes('2027-03-01').map((w) => [w.activity, w.days, w.reference]),
				[['ENCASHMENT', 3, 'window:k:ANNUAL_LEAVE:2027-03-01']]
			);
			assert.deepEqual(writes('2027-02-28'), []);
			assert.deepEqual(writes('2027-03-01', 'window:k:ANNUAL_LEAVE:2027-03-01'), []);
			// Priced at the daily rate: 3 × 31,300 × 12 ÷ 313 = 3,600.
			const line = load(version, 'work_catalog').find((row) => row.code === 'ENCASHMENT')!;
			const pay = {
				...RUN,
				terms: { ...terms, base_salary: 31300, facts: {} },
				leave: {
					rows: [
						{
							code: 'ANNUAL_LEAVE',
							activity: 'ENCASHMENT',
							days: 3,
							can_encash: true,
							is_npl: false
						}
					]
				}
			};
			assert.equal(evaluateConfigured(line.eligibility, pay as never), true);
			assert.equal(
				cents(
					Number(evaluateConfigured(line.quantity, pay as never)) *
						Number(evaluateConfigured(line.rate, pay as never))
				),
				3600
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
		const at = (
			date_of_birth: string,
			elections: object,
			employment_type = 'PERMANENT',
			start_date = '2024-01-01',
			months: Row[] = []
		) => {
			SUBJECT_ELECTIONS.value = { SSS: elections };
			const saved = { ...SUBJECT };
			Object.assign(SUBJECT, {
				employee: { ...employee, date_of_birth },
				terms: { ...terms, employment_type },
				employment: { ...employment, service_months: 0, start_date }
			});
			try {
				const { employee: share, employer } = assess(
					latest,
					sss,
					{ ordinary: 20000 },
					{},
					{
						earned: { month: {}, year: {}, previous_month: {}, months, history: [] }
					}
				);
				return { employee: share, employer };
			} finally {
				Object.assign(SUBJECT, saved);
				SUBJECT_ELECTIONS.value = {};
			}
		};
		assert.deepEqual(at('1990-01-01', {}), { employee: 1000, employer: 2000 });
		// RA 11199 ss.9(a), 11, 12-B: hired at 59 (2024, born 1964-06) and now 61 — still covered, no election needed.
		assert.deepEqual(at('1964-06-01', {}), { employee: 1000, employer: 2000 });
		// Hired at 61 with no SSS on this payroll: not determinable — nothing charged (and a warning, below) until the override.
		assert.deepEqual(at('1964-06-01', {}, 'PERMANENT', '2026-01-05'), { employee: 0, employer: 0 });
		assert.deepEqual(at('1964-06-01', { covered_before_60: true }, 'PERMANENT', '2026-01-05'), {
			employee: 1000,
			employer: 2000
		});
		// An SSS charge on this payroll in the months before also shows prior coverage.
		assert.deepEqual(
			at('1964-06-01', {}, 'PERMANENT', '2026-01-05', [
				{ month: '2026-02', statutory: { SSS: { employee: 1000, employer: 2000, base: 20000 } } }
			]),
			{ employee: 1000, employer: 2000 }
		);
		// Sixty-five: compulsory retirement (s.12-B(a)(2)) — nothing, even with the election.
		assert.deepEqual(at('1960-01-01', { covered_before_60: true }), { employee: 0, employer: 0 });
		const warnings = (date_of_birth: string, start_date: string) => {
			const context = {
				...SUBJECT,
				employee: { ...employee, date_of_birth },
				employment: { ...employment, start_date },
				elections: {},
				earned: { month: {}, year: {}, previous_month: {}, months: [], history: [] },
				period: { ...RUN.period, from: '2026-03-01' },
				month: { ordinary: 20000 }
			} as Row;
			const person = Object.fromEntries(
				Object.entries(sss.configuration.person as Row).map(([k, text]) => [
					k,
					evaluateConfigured(String(text), context as never)
				])
			);
			return (sss.configuration.warn_when as Row[])
				.filter((w) => evaluateConfigured(w.when, { ...context, person } as never) === true)
				.map((w) => String(w.message).slice(0, 30));
		};
		assert.deepEqual(warnings('1964-06-01', '2026-01-05'), ['SSS coverage past sixty cannot']);
		assert.deepEqual(warnings('1964-06-01', '2024-01-01'), []);
		assert.deepEqual(warnings('1960-01-01', '2024-01-01'), ['SSS stops at sixty-five: the m']);
		// Pag-IBIG follows: compulsorily retired at sixty-five (IRR of RA 9679 Rule V s.10).
		const hdmf = (date_of_birth: string, start_date = '2024-01-01') => {
			const saved = { ...SUBJECT };
			Object.assign(SUBJECT, {
				employee: { ...employee, date_of_birth },
				employment: { ...employment, start_date }
			});
			try {
				const charged = assess(latest, scheme('HDMF'), { ordinary: 20000 });
				return [charged.employee, charged.employer];
			} finally {
				Object.assign(SUBJECT, saved);
			}
		};
		assert.deepEqual(hdmf('1964-06-01'), [200, 200]);
		assert.deepEqual(hdmf('1964-06-01', '2026-01-05'), [0, 0]);
		assert.deepEqual(hdmf('1960-01-01'), [0, 0]);
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
				day: '2026-03-01',
				period: { ...RUN.period, month_key: '2026-03', month_to: '2026-03-31' },
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
				assert.ok(['contract', 'payslip', 'roster'].includes(row.rules.site), row.code);
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
		// Labor Code art.301 / DO 215-20: past six months' suspension, the retrenchment award (30 months → 3 × ½).
		assert.equal(cause('SUSPENSION_OVER_SIX_MONTHS'), 48000);
		// RA 7641: 22.5 days × (30,000 × 12 ÷ 313) × 10 years (125 months).
		const retire = { employee: { ...employee, age: 61 } };
		// Labor Code art.302: sixty-five makes retirement compulsory but does not forfeit the benefit — retired at 66, still paid.
		assert.equal(
			price(
				'RETIREMENT_PAY',
				{ exit_ground: 'RETIREMENT', service_months: 125 },
				{ employee: { ...employee, age: 66 } }
			),
			258785.94
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
				MWE_STATUS: [0, 0],
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

		it('November: 13th month and bonus inside the 90,000 pool; December annualises and refunds the over-withholding', async () => {
			await run('2026-11', 'REGULAR');
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
					occurred_on: '2026-11-15',
					amount,
					activity: 'PAYMENT'
				});
			const settlement = await run('2026-11', 'OFF_CYCLE', ['t13', 'b1']);
			const slip = settlement.payslips.find((row) => row.employment_id === 'k-p1')!;
			// PD 851: a twelfth of the year's basic — March and November's regular slips, 60,000 → 5,000, whatever is keyed.
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
			// December annualises (RR 2-98 s.2.79(B)(5)(b)): 90,000 basic − 7,600 shares + the pool's 5,000 excess = 87,400,
			// under ₱250,000 → no tax for the year; March's 1,007.55 and November's 1,720.05 are refunded.
			const december = await run('2026-12', 'REGULAR');
			assert.deepEqual(lines(december, 'p1').WTAX, [-2727.6, 0]);
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
			MWE_STATUS: [0, 0],
			WTAX: [1007.55, 0]
		});
	});

	it('a switch of pay frequency settles each month exactly: gross, every statutory line and the withholding tax', async () => {
		type Plan = Awaited<ReturnType<ReturnType<typeof harness>['run']>>;
		const settledOf = (plans: readonly Plan[], person: string) => {
			const out = { gross: 0, base: {} as Row, statutory: {} as Row };
			for (const plan of plans)
				for (const slip of plan.payslips.filter((row) => row.employment_id === `k-${person}`)) {
					out.gross = cents(out.gross + slip.gross);
					for (const line of slip.base)
						out.base[line.component_code] = cents(
							Number(out.base[line.component_code] ?? 0) + line.amount
						);
					for (const line of slip.statutory) {
						const [ee, er] = (out.statutory[line.scheme_code] as number[] | undefined) ?? [0, 0];
						out.statutory[line.scheme_code] = [
							cents(ee + line.employee_amount),
							cents(er + line.employer_amount)
						];
					}
				}
			return out;
		};
		const runs = async (frequency: string, changes: Row[], periods: readonly string[]) => {
			const engine = harness(frequency);
			engine.tables.get('entity')![0]!.pay_frequency_changes = changes;
			const plans: Plan[] = [];
			for (const period of periods) plans.push(await engine.run(period, 'REGULAR'));
			return plans;
		};
		const monthly = await runs('MONTHLY', [], ['2026-01', '2026-02', '2026-03']);
		// semi-monthly to monthly from 16 March, inside the tax year: January and February halves, then March's rest
		const switched = await runs(
			'SEMI_MONTHLY',
			[{ from: '2026-03-16', frequency: 'MONTHLY' }],
			['2026-01-1', '2026-01-2', '2026-02-1', '2026-02-2', '2026-03-1', '2026-03']
		);
		// monthly to semi-monthly from 16 February
		const back = await runs(
			'MONTHLY',
			[{ from: '2026-02-16', frequency: 'SEMI_MONTHLY' }],
			['2026-01', '2026-02', '2026-02-2', '2026-03-1', '2026-03-2']
		);
		for (const person of ['p1', 'p2', 'p3', 'p4']) {
			assert.deepEqual(
				settledOf(switched, person),
				settledOf(monthly, person),
				`to monthly ${person}`
			);
			assert.deepEqual(settledOf(back, person), settledOf(monthly, person), `to semi ${person}`);
		}
	});

	it('semi-monthly halves sum to exactly the monthly run: basic, an allowance and a no-pay day at the daily rate', async () => {
		const unpaid = load(latest, 'leave_catalog').find((row) => row.code === 'UNPAID_LEAVE')!;
		assert.equal(unpaid.is_npl, true);
		const withLeave = (frequency: string) => {
			const engine = harness(frequency);
			engine.tables.get('leave_catalog_entry')!.push({
				id: 'npl-1',
				employment_id: 'k-p2',
				catalog_id: unpaid.id,
				approval_id: null,
				activity: 'TIME_OFF',
				occurred_on: '2026-03-20',
				from: '2026-03-20',
				to: '2026-03-20',
				days: 1,
				facts: {}
			});
			return engine;
		};
		const pay = (slips: { base: { component_code: string; amount: number }[] }[]) => {
			const sums: Row = {};
			for (const slip of slips)
				for (const line of slip.base)
					sums[line.component_code] = cents(Number(sums[line.component_code] ?? 0) + line.amount);
			return sums;
		};
		const monthly = await withLeave('MONTHLY').run('2026-03', 'REGULAR');
		const semi = withLeave('SEMI_MONTHLY');
		const halves = [await semi.run('2026-03-1', 'REGULAR'), await semi.run('2026-03-2', 'REGULAR')];
		const mine = (plans: { payslips: Row[] }[]) =>
			plans.flatMap((plan) =>
				plan.payslips.filter((slip) => slip.employment_id === 'k-p2')
			) as never;
		const month = pay(mine([monthly]));
		const sum = pay(mine(halves));
		// 18,000 basic; the 10,000 transport allowance; one no-pay day at 18,000 × 12 ÷ 313 = 690.10.
		assert.deepEqual(month, { BASIC: 18000, transport: 10000, NO_PAY_LEAVE: -690.1 });
		assert.deepEqual(sum, month);
		// Each half pays half the basic and half the allowance; the no-pay day falls in the half that holds it.
		const half = (i: number) => pay(mine([halves[i]!]));
		assert.deepEqual(half(0), { BASIC: 9000, transport: 5000 });
		assert.deepEqual(half(1), { BASIC: 9000, transport: 5000, NO_PAY_LEAVE: -690.1 });
	});

	it('a semi-monthly → monthly switch on the 16th: the 13th month, the loss-and-damage cap and the MWE marker read the month to date', () => {
		const month_days = Array.from({ length: 31 }, (_, i) =>
			day(`2026-03-${String(i + 1).padStart(2, '0')}`, 'WORK')
		);
		// Half 1 (1–15) of the switched month paid 14,516.13 (by days); the monthly 16–31 slip settles the rest.
		const switched = (earnedMonth: number) => ({
			...RUN,
			terms: { ...terms, base_salary: 30000, facts: {} },
			period: {
				...RUN.period,
				key: '2026-03',
				from: '2026-03-16',
				to: '2026-03-31',
				days: 16,
				paid_days: 16,
				part: 1,
				parts: 1,
				switched: true
			},
			work: { ...RUN.work, month_days },
			earned: { ...RUN.earned, year: { BASIC: 60000 }, month: { BASIC: earnedMonth } }
		});
		const normalHalf2 = {
			...RUN,
			terms: { ...terms, base_salary: 30000, facts: {} },
			period: {
				...RUN.period,
				key: '2026-03-2',
				from: '2026-03-16',
				to: '2026-03-31',
				days: 16,
				paid_days: 16,
				part: 2,
				parts: 2
			},
			work: { ...RUN.work, month_days },
			earned: { ...RUN.earned, year: { BASIC: 60000 }, month: { BASIC: 15000 } }
		};
		const normalMonth = {
			...RUN,
			terms: { ...terms, base_salary: 30000, facts: {} },
			work: { ...RUN.work, month_days },
			earned: { ...RUN.earned, year: { BASIC: 60000 }, month: {} }
		};
		for (const version of versions) {
			const price = (code: string, context: Row, amount = 20000) => {
				const line = load(version, 'adhoc_catalog').find((item) => item.code === code)!;
				const band = line.bands[0];
				const value = Number(
					evaluateConfigured(band.amount, { ...context, entry: { ...entry, amount } } as never)
				);
				const cap = band.limit
					? Number(
							evaluateConfigured(band.limit.amount, {
								...context,
								entry: { ...entry, amount }
							} as never)
						)
					: Infinity;
				return cents(Math.min(value, cap));
			};
			// January–February 60,000 + March 30,000 = 90,000 → 7,500 — the same in the switched month as in either normal one
			// (the old per-window rule read the 16–31 slip as a whole month: 105,000 → 8,750).
			for (const code of ['THIRTEENTH_MONTH_PAY', 'THIRTEENTH_MONTH_PAY_YEAR_END']) {
				assert.equal(price(code, switched(14516.13)), 7500, `${version} ${code} switched`);
				assert.equal(price(code, normalHalf2), 7500, `${version} ${code} half 2`);
				assert.equal(price(code, normalMonth), 7500, `${version} ${code} month`);
			}
			// Book III Rule VIII s.14: at most 20% of the slip's basic — the settled 15,483.87 in the switched slip, not 30,000.
			assert.equal(price('LOSS_DAMAGE_DEDUCTION', switched(14516.13)), 3096.77);
			assert.equal(price('LOSS_DAMAGE_DEDUCTION', normalHalf2), 3000);
			assert.equal(price('LOSS_DAMAGE_DEDUCTION', normalMonth), 6000);
			// The semi-monthly half of a switched month (1–15) settles by days too: 30,000 × 15 ÷ 31 = 14,516.13.
			const switchedHalf1 = {
				...RUN,
				terms: { ...terms, base_salary: 30000, facts: {} },
				period: {
					...RUN.period,
					key: '2026-03-1',
					from: '2026-03-01',
					to: '2026-03-15',
					days: 15,
					paid_days: 15,
					part: 1,
					parts: 2,
					switched: true
				},
				work: { ...RUN.work, month_days: month_days.slice(0, 15) },
				earned: { ...RUN.earned, year: { BASIC: 60000 }, month: {} }
			};
			assert.equal(price('THIRTEENTH_MONTH_PAY', switchedHalf1), 6209.68); // (60,000 + 14,516.13) ÷ 12
			assert.equal(price('LOSS_DAMAGE_DEDUCTION', switchedHalf1), 2903.23);
			// A December payment in the first half of a switched December projects the days after the 15th by days:
			// 330,000 + 14,516.13 + 15,483.87 = 360,000 → 30,000 — as in a normal semi-monthly December.
			const december = (switchedMonth: boolean) => ({
				...switchedHalf1,
				period: {
					...switchedHalf1.period,
					key: '2026-12-1',
					from: '2026-12-01',
					to: '2026-12-15',
					month_key: '2026-12',
					month_from: '2026-12-01',
					month_to: '2026-12-31',
					switched: switchedMonth
				},
				earned: { ...RUN.earned, year: { BASIC: 330000 }, month: {} }
			});
			assert.equal(price('THIRTEENTH_MONTH_PAY_YEAR_END', december(true)), 30000);
			assert.equal(price('THIRTEENTH_MONTH_PAY_YEAR_END', december(false)), 30000);
			// The MWE marker's base is the month to date by days: half 1 15/31, the 16–31 monthly slip the whole month.
			const marker = scheme('MWE_STATUS', version);
			const base = (from: string, to: string, part: number, parts: number) => {
				const period = {
					...RUN.period,
					from,
					to,
					part,
					parts,
					month: 3,
					month_from: '2026-03-01',
					month_to: '2026-03-31',
					month_days: 31,
					pay_date: to
				};
				const ctx = {
					...SUBJECT,
					terms: { ...terms, base_salary: 15000 },
					rules: payrollRules(version),
					period,
					month: { ordinary: 0 },
					earned: RUN.earned
				};
				const person = { mwe: evaluateConfigured(marker.configuration.person.mwe, ctx as never) };
				return cents(
					Number(
						evaluateConfigured(marker.configuration.assessable.ordinary, {
							...ctx,
							person
						} as never)
					)
				);
			};
			assert.equal(base('2026-03-01', '2026-03-15', 1, 2), 7258.06);
			assert.equal(base('2026-03-16', '2026-03-31', 1, 1), 15000);
			assert.equal(base('2026-03-16', '2026-03-31', 2, 2), 15000);
		}
	});

	it('through the engine, a semi-monthly → monthly switch on 16 March pays the same month as one monthly run', async () => {
		const sums = (plans: { payslips: Row[] }[], person: string) => {
			const out: Row = {};
			for (const plan of plans)
				for (const slip of plan.payslips.filter((item) => item.employment_id === `k-${person}`)) {
					for (const line of slip.base as Row[])
						out[String(line.component_code)] = cents(
							Number(out[String(line.component_code)] ?? 0) + Number(line.amount)
						);
					for (const line of slip.statutory as Row[])
						out[`${line.scheme_code}.ee`] = cents(
							Number(out[`${line.scheme_code}.ee`] ?? 0) + Number(line.employee_amount)
						);
				}
			return out;
		};
		const monthly = await harness('MONTHLY').run('2026-03', 'REGULAR');
		const engine = harness('SEMI_MONTHLY');
		engine.tables.get('entity')![0]!.pay_frequency_changes = [
			{ from: '2026-03-16', frequency: 'MONTHLY' }
		];
		const split = [
			await engine.run('2026-03-1', 'REGULAR'),
			await engine.run('2026-03', 'REGULAR')
		];
		for (const person of ['p1', 'p2', 'p3'])
			assert.deepEqual(sums(split, person), sums([monthly], person), person);
		// A switched month settles by days: 1–15 pays 30,000 × 15 ÷ 31 = 14,516.13, the 16–31 slip the rest.
		const basic = (i: number) =>
			split[i]!.payslips.find((slip) => slip.employment_id === 'k-p1')!.base.find(
				(line) => line.component_code === 'BASIC'
			)?.amount;
		assert.deepEqual([basic(0), basic(1)], [14516.13, 15483.87]);
		// The reverse switch (monthly 1–15, then semi-monthly 16–31) settles the same month.
		const back = harness('MONTHLY');
		back.tables.get('entity')![0]!.pay_frequency_changes = [
			{ from: '2026-03-16', frequency: 'SEMI_MONTHLY' }
		];
		const reverse = [await back.run('2026-03', 'REGULAR'), await back.run('2026-03-2', 'REGULAR')];
		for (const person of ['p1', 'p2', 'p3'])
			assert.deepEqual(sums(reverse, person), sums([monthly], person), `reverse ${person}`);
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

describe('PH: the whole tracker, row by row', () => {
	const row = (table: string, code: string, version = latest) =>
		load(version, table).find((item) => item.code === code)!;
	/** A work or entry line priced the way buildPayslip prices it: eligibility, then quantity × rate (or the first band). */
	const priceWork = (code: string, context: Row) => {
		const line = row('work_catalog', code);
		if (evaluateConfigured(line.eligibility, context as never) !== true) return 0;
		return cents(
			Number(evaluateConfigured(line.quantity, context as never)) *
				Number(evaluateConfigured(line.rate, context as never))
		);
	};
	const priceEntry = (code: string, context: Row, table = 'adhoc_catalog') => {
		const line = row(table, code);
		if (line.eligibility && evaluateConfigured(line.eligibility, context as never) !== true)
			return null;
		for (const band of line.bands ?? []) {
			if (band.when && evaluateConfigured(band.when, context as never) !== true) continue;
			let amount = Number(evaluateConfigured(band.amount, context as never));
			if (band.limit?.amount)
				amount = Math.min(amount, Number(evaluateConfigured(band.limit.amount, context as never)));
			return cents(amount);
		}
		return null;
	};
	const ctx = (over: Row = {}, days: Row[] = DAYS) =>
		({
			...RUN,
			work: { ...RUN.work, days },
			terms: { ...terms, base_salary: 31300, facts: {} },
			...over
		}) as Row;
	const at = (date: string, day_type: string, extra: Row = {}) =>
		day(date, day_type, { worked_hours: 8, intervals: [shift(date, '08:00', '16:00')], ...extra });

	it('PH-WORK: every multiple of the Handbook ladder, night overtime at 125% × 110%, holiday-pay coverage', () => {
		const one = (d: Row, code: string, over: Row = {}) => priceWork(code, ctx(over, [d]));
		// 31,300 × 12 ÷ 313 = 1,200 a day, 150 an hour; two overtime hours on each day type.
		const ot = (kind: string, type: string) =>
			one(at('2026-04-09', type, { holiday_kind: kind, overtime_hours: 2 }), 'OVERTIME');
		assert.deepEqual(
			[
				ot('', 'REST'),
				ot('SPECIAL_HOLIDAY', 'REST'),
				ot('DOUBLE_SPECIAL', 'REST'),
				ot('PUBLIC_HOLIDAY', 'WORK'),
				ot('PUBLIC_HOLIDAY', 'REST'),
				ot('DOUBLE_HOLIDAY', 'WORK'),
				ot('DOUBLE_HOLIDAY', 'REST')
			],
			[507, 585, 760.5, 780, 1014, 1170, 1521]
		);
		const hol = (kind: string, type: string) =>
			one(at('2026-04-09', type, { holiday_kind: kind }), 'HOLIDAY_WORK');
		assert.deepEqual(
			[hol('PUBLIC_HOLIDAY', 'REST'), hol('DOUBLE_HOLIDAY', 'WORK'), hol('DOUBLE_HOLIDAY', 'REST')],
			[1920, 2400, 3480]
		);
		assert.equal(
			one(at('2026-04-04', 'REST', { holiday_kind: 'SPECIAL_HOLIDAY' }), 'SPECIAL_HOLIDAY_WORK'),
			1800
		);
		// Two night hours that are also overtime on an ordinary day: 10% of the 125% hour, not of the 100% one.
		const nightOt = day('2026-03-16', 'WORK', {
			worked_hours: 10,
			overtime_hours: 2,
			intervals: [shift('2026-03-16', '14:00', '00:00', true)]
		});
		assert.equal(one(nightOt, 'NIGHT_SHIFT_DIFFERENTIAL'), 37.5);
		// Holiday pay excludes a retail or service establishment of fewer than ten; night pay one of five or fewer.
		const small = (headcount: number) => ({
			company: { ...company, headcount, facts: { retail_or_service_establishment: true } }
		});
		assert.equal(
			one(at('2026-04-09', 'WORK', { holiday_kind: 'PUBLIC_HOLIDAY' }), 'HOLIDAY_WORK', small(9)),
			0
		);
		assert.equal(
			one(at('2026-04-09', 'WORK', { holiday_kind: 'PUBLIC_HOLIDAY' }), 'HOLIDAY_WORK', small(10)),
			1200
		);
		assert.equal(one(nightOt, 'NIGHT_SHIFT_DIFFERENTIAL', small(5)), 0);
		assert.equal(one(nightOt, 'NIGHT_SHIFT_DIFFERENTIAL', small(6)), 37.5);
		// NIRC s.24(A)(2); RR 11-2018 (B)(13); owner ruling: holiday, overtime, night, hazard, rest-day and special-day pay are an MWE's exempt wage.
		for (const code of [
			'REST_DAY_WORK',
			'SPECIAL_HOLIDAY_WORK',
			'OVERTIME',
			'HOLIDAY_WORK',
			'NIGHT_SHIFT_DIFFERENTIAL',
			'DOUBLE_HOLIDAY_UNWORKED',
			'DAILY_HOLIDAY_PAY'
		])
			for (const version of versions)
				assert.ok(
					row('work_catalog', code, version).counts_toward.includes('WTAX.WAGE'),
					`${version} ${code}`
				);
		for (const version of versions)
			assert.ok(row('adhoc_catalog', 'HAZARD_PAY', version).counts_toward.includes('WTAX.WAGE'));
	});

	it('PH-WORK: a daily-paid contract — worked and paid-leave days, unworked holidays and the absence before them', () => {
		const daily = (days: Row[], rows: Row[] = []) =>
			ctx(
				{ terms: { ...terms, base_salary: 700, facts: { rate_basis: 'DAILY' } }, leave: { rows } },
				days
			);
		const worked = [
			at('2026-04-06', 'WORK'),
			at('2026-04-07', 'WORK'),
			at('2026-04-08', 'WORK'),
			at('2026-04-11', 'OFF')
		];
		const paidLeave = {
			code: 'ANNUAL_LEAVE',
			activity: 'TIME_OFF',
			days: 1,
			is_npl: false,
			can_encash: true,
			from: '2026-04-10',
			to: '2026-04-10'
		};
		// 4 worked days and a paid-leave day at ₱700.
		assert.equal(priceWork('BASIC', daily(worked, [paidLeave])), 3500);
		assert.equal(priceWork('NO_PAY_LEAVE', daily(worked, [{ ...paidLeave, is_npl: true }])), 0);
		const holiday = day('2026-04-09', 'WORK', { holiday_kind: 'PUBLIC_HOLIDAY' });
		const before = (extra: Row) => day('2026-04-08', 'WORK', extra);
		// Omnibus Rules Book III Rule IV s.6: paid when present (or on paid leave) the working day before; not when absent unpaid.
		assert.equal(
			priceWork('DAILY_HOLIDAY_PAY', daily([before({ worked_hours: 8 }), holiday])),
			700
		);
		assert.equal(priceWork('DAILY_HOLIDAY_PAY', daily([before({}), holiday])), 0);
		assert.equal(
			priceWork(
				'DAILY_HOLIDAY_PAY',
				daily([before({}), holiday], [{ ...paidLeave, from: '2026-04-08', to: '2026-04-08' }])
			),
			700
		);
		// s.6(c): a rest day between is skipped.
		assert.equal(
			priceWork(
				'DAILY_HOLIDAY_PAY',
				daily([day('2026-04-07', 'WORK', { worked_hours: 8 }), day('2026-04-08', 'REST'), holiday])
			),
			700
		);
		// s.10: absent before Maundy Thursday but working it — Good Friday is paid; Maundy Thursday is holiday work at 200%.
		const successive = [
			day('2026-04-01', 'WORK'),
			at('2026-04-02', 'WORK', { holiday_kind: 'PUBLIC_HOLIDAY' }),
			day('2026-04-03', 'WORK', { holiday_kind: 'PUBLIC_HOLIDAY' })
		];
		assert.equal(priceWork('DAILY_HOLIDAY_PAY', daily(successive)), 700);
		assert.equal(priceWork('HOLIDAY_WORK', daily(successive)), 1400);
		// An unworked double holiday: 100% here and 100% on DOUBLE_HOLIDAY_UNWORKED.
		const dbl = [
			before({ worked_hours: 8 }),
			day('2026-04-09', 'WORK', { holiday_kind: 'DOUBLE_HOLIDAY' })
		];
		assert.deepEqual(
			[
				priceWork('DAILY_HOLIDAY_PAY', daily(dbl)),
				priceWork('DOUBLE_HOLIDAY_UNWORKED', daily(dbl))
			],
			[700, 700]
		);
		// A monthly salary pays the holiday itself: no DAILY_HOLIDAY_PAY line.
		assert.equal(
			priceWork('DAILY_HOLIDAY_PAY', ctx({}, [before({ worked_hours: 8 }), holiday])),
			0
		);
	});

	it('PH-TAX: MWE on the daily rate at the workplace floor, NRANETB, the semi-monthly column, exit annualisation, union dues, the OT-meal cap, fringe benefits', () => {
		const wtax = row('statutory_contribution_catalog', 'WTAX');
		const tax = (wage: Row, extra: Row = {}, year: Row = {}, version = latest) =>
			assess(version, row('statutory_contribution_catalog', 'WTAX', version), wage, year, extra);
		// Part-time on 4 hours a day: 9,000 → 345.05 a day, 690.10 for 8 hours ≤ NCR's 695 → MWE; 9,500 → 728.43 → not.
		const parttime = (base_salary: number) =>
			tax({ wage: 9000 }, { terms: { ...terms, base_salary, facts: { hours_per_day: 4 } } }).person
				.mwe;
		assert.equal(parttime(9000), true);
		assert.equal(parttime(9500), false);
		// The workplace floor: 15,000 (575.08 a day) is an MWE in NCR, not at a BARMM province agricultural site (₱376).
		const site = (wage_region?: string) =>
			tax(
				{ wage: 15000 },
				{ terms: { ...terms, base_salary: 15000, facts: wage_region ? { wage_region } : {} } }
			).person.mwe;
		assert.equal(site(), true);
		assert.equal(site('BARMM-PROV-AGRI'), false);
		// An MWE is exempt on the wage part (basic, overtime, holiday) and taxed on other pay.
		const mwe = { terms: { ...terms, base_salary: 15000 } };
		assert.equal(tax({ wage: 20000, ordinary: 30000 }, mwe).employee, 1375.05);
		assert.equal(tax({ wage: 20000, ordinary: 30000 }).employee, 5208.4);
		// Owner ruling: 15,000 basic plus 5,000 of overtime, holiday, night, rest-day and special-day pay is all exempt.
		for (const version of versions)
			assert.equal(tax({ wage: 20000 }, mwe, {}, version).employee, 0);
		// NIRC s.25(B): 25% final on the whole month.
		assert.equal(
			tax(
				{ wage: 30000, special: 5000 },
				{ terms: { ...terms, residency_status: 'NON_RESIDENT_ALIEN_NETB' } }
			).employee,
			8750
		);
		// RR 11-2018 Annex E, semi-monthly column: a 70,000 first half with the month's 3,700 of employee shares charged on
		// it is taxed on 66,300 → 4,270.70 + 25% × (66,300 − 33,333) = 12,512.45; the month (monthly column on 136,300 =
		// 25,950.05) leaves 13,437.60 for the second half — the semi-monthly column on 70,000 would be 13,437.45; the ₱0.15
		// is the columns' own rounding (2 × 33,333 ≠ 66,667) and the December annualisation settles it.
		for (const version of versions) {
			const high = { terms: { ...terms, base_salary: 140000 } };
			const shares = (sss: number, phic: number, hdmf: number) =>
				Object.fromEntries(
					load(version, 'statutory_contribution_catalog').map((item) => [
						item.code,
						{
							employee:
								item.code === 'SSS'
									? sss
									: item.code === 'PHIC'
										? phic
										: item.code === 'HDMF'
											? hdmf
											: 0,
							employer: 0
						}
					])
				);
			const half = (wage: number, part: number) =>
				tax(
					{ wage },
					{
						...high,
						charged: { month: shares(1000, 2500, 200), year: {} },
						period: {
							...RUN.period,
							month: 3,
							parts: 2,
							part,
							to: part === 1 ? '2026-03-15' : '2026-03-31',
							month_to: '2026-03-31'
						}
					},
					{},
					version
				).employee;
			assert.equal(half(70000, 1), 12512.45);
			assert.equal(half(140000, 2), 25950.05);
		}
		// The first half of a semi-monthly month: the semi-monthly column.
		assert.equal(
			tax(
				{ wage: 15000 },
				{ period: { ...RUN.period, month: 3, parts: 2, part: 1, to: '2026-03-15' } }
			).employee,
			687.45
		);
		// The exit month annualises (Steps 1–4) with the previous employer's 2316: 180,000 − 14,700 shares + 100,000 = 265,300
		// → 2,295 for the year, less 5,037.75 withheld here and 8,000 there.
		const shares = (sss: number, mpf: number, phic: number, hdmf: number) => ({
			SSS: { employee: sss, employer: 0 },
			SSS_MPF: { employee: mpf, employer: 0 },
			SSS_EC: { employee: 0, employer: 0 },
			PHIC: { employee: phic, employer: 0 },
			HDMF: { employee: hdmf, employer: 0 },
			WTAX: { employee: 0, employer: 0 },
			FBT: { employee: 0, employer: 0 }
		});
		const leaver = tax(
			{ wage: 30000 },
			{
				employment: { ...employment, exit_date: '2026-06-15' },
				employee: {
					...employee,
					facts: {
						previous_employer_taxable_compensation: 100000,
						previous_employer_tax_withheld: 8000
					}
				},
				period: {
					...RUN.period,
					key: '2026-06',
					from: '2026-06-01',
					to: '2026-06-30',
					month: 6,
					month_to: '2026-06-30'
				},
				charged: {
					month: shares(1000, 500, 750, 200),
					year: { ...shares(5000, 2500, 3750, 1000), WTAX: { employee: 5037.75, employer: 0 } }
				}
			},
			{ wage: 150000 }
		);
		assert.equal(leaver.employee, -10742.75);
		// Union dues are excluded (RR 2-98 s.2.78.1(B)(12)).
		assert.equal(
			tax({ wage: 30000 }, { lines: [{ code: 'UNION_DUES', amount: -500 }] }).employee,
			1300.05
		);
		// The overtime/night meal: exempt to 30% (25% before RR 29-2025) of NCR's ₱695 a day for each overtime day.
		const otDays = {
			work: {
				...RUN.work,
				days: [
					day('2026-03-02', 'WORK', { overtime_hours: 2 }),
					day('2026-03-03', 'WORK', { overtime_hours: 1 })
				]
			}
		};
		assert.equal(cents(tax({ wage: 30000, ot_meal: 1000 }, otDays).person.ot_meal_excess), 583);
		assert.equal(
			cents(tax({ wage: 30000, ot_meal: 1000 }, otDays, {}, versions[0]!).person.ot_meal_excess),
			652.5
		);
		// Fringe benefits: rank-and-file compensation; a supervisor's are the FBT's instead (35% of the value ÷ 65%).
		assert.equal(tax({ wage: 30000, fringe: 10000 }).employee, 3208.4);
		const supervisor = { terms: { ...terms, work_classification: 'SUPERVISORY' } };
		assert.equal(tax({ wage: 30000, fringe: 10000 }, supervisor).employee, 1375.05);
		const fbt = row('statutory_contribution_catalog', 'FBT');
		assert.equal(assess(latest, fbt, { ordinary: 6500 }, {}, supervisor).employer, 3500);
		assert.equal(assess(latest, fbt, { ordinary: 6500 }).employer, 0);
		assert.equal(
			assess(
				latest,
				fbt,
				{ ordinary: 6000 },
				{},
				{
					terms: {
						...terms,
						work_classification: 'MANAGERIAL',
						residency_status: 'NON_RESIDENT_ALIEN_NETB'
					}
				}
			).employer,
			2000
		);
		assert.deepEqual(row('adhoc_catalog', 'FRINGE_BENEFIT').counts_toward, ['FBT', 'WTAX.FRINGE']);
		assert.equal(row('adhoc_catalog', 'FRINGE_BENEFIT').destination, 'EMPLOYER');
		assert.ok(wtax.authority.includes('Annex E'));
	});

	it('PH-TAX: every de minimis ceiling in both versions', () => {
		const excess = (version: string, wage: Row, year: Row) => {
			const { person } = assess(
				version,
				row('statutory_contribution_catalog', 'WTAX', version),
				{ ordinary: 30000, ...wage },
				year
			);
			return cents(Number(person.pool_now) - Number(person.pool_before));
		};
		const [v1, v2] = versions as [string, string];
		// March (three months elapsed) for the monthly ceilings; the year for the annual ones.
		assert.deepEqual(
			[v1, v2].map((v) => excess(v, { laundry: 500 }, { laundry: 800 })),
			// v1: 400 over 3 × 300 now, 200 over 2 × 300 before; v2: 100 over 3 × 400, nothing before.
			[200, 100]
		);
		assert.deepEqual(
			[v1, v2].map((v) => excess(v, { dep_medical: 400 }, { dep_medical: 700 })),
			// ₱1,500 / ₱2,000 a semester as 250 / 333.33 a month.
			[150, 66.67]
		);
		for (const [part, amount, expected] of [
			['medical', 13000, [3000, 1000]],
			['award', 12500, [2500, 500]],
			['gift', 6500, [1500, 500]],
			['cba', 12500, [2500, 500]]
		] as const)
			assert.deepEqual(
				[v1, v2].map((v) => excess(v, { [part]: amount }, {})),
				expected,
				part
			);
		// Claims are actual medical assistance.
		for (const code of ['MEDICAL_CLAIM', 'DENTAL_CLAIM', 'MEDICAL_CLAIM_DIRECT'])
			assert.deepEqual(row('claim_catalog', code).counts_toward, ['WTAX.MEDICAL'], code);
	});

	it('PH-CONTRIBUTION: SSA exemption, PhilHealth household split and daily-paid basic, the DOB warning', () => {
		SUBJECT_ELECTIONS.value = { SSS: { exempt_by_totalisation: true } };
		try {
			for (const code of ['SSS', 'SSS_MPF', 'SSS_EC']) {
				const { employee: share, employer } = assess(
					latest,
					row('statutory_contribution_catalog', code),
					{ ordinary: 30000 }
				);
				assert.deepEqual([share, employer], [0, 0], code);
			}
		} finally {
			SUBJECT_ELECTIONS.value = {};
		}
		const phic = row('statutory_contribution_catalog', 'PHIC');
		const domestic = (base_salary: number) =>
			assess(
				latest,
				phic,
				{ ordinary: base_salary },
				{},
				{ terms: { ...terms, employment_type: 'DOMESTIC', base_salary } }
			);
		assert.deepEqual([domestic(4999).employee, domestic(4999).employer], [0, 500]);
		assert.deepEqual([domestic(5000).employee, domestic(5000).employer], [250, 250]);
		// A daily rate of 700 on 313 days is a 18,258.33 monthly basic: 912.92 premium.
		const dailyPaid = assess(
			latest,
			phic,
			{ ordinary: 14000 },
			{},
			{ terms: { ...terms, base_salary: 700, facts: { rate_basis: 'DAILY' } } }
		);
		assert.deepEqual([dailyPaid.employee, dailyPaid.employer], [456.46, 456.46]);
		const sss = row('statutory_contribution_catalog', 'SSS');
		assert.equal(
			evaluateConfigured(sss.configuration.warn_when[0].when, {
				...SUBJECT,
				employee: { ...employee, date_of_birth: '' }
			} as never),
			true
		);
		assert.match(sss.configuration.warn_when[0].message, /under 60/);
		assert.ok(!/refuses assessment/.test(sss.authority + (sss.configuration.limitation ?? '')));
	});

	it('PH-ADHOC / LOAN / CLAIM: classes, caps, exclusions and tax treatment', () => {
		const entryCtx = (over: Row = {}, amount = 8000) =>
			ctx({ entry: { ...entry, amount }, ...over });
		assert.ok(row('adhoc_catalog', 'HAZARD_PAY').counts_toward.includes('WTAX.WAGE'));
		assert.equal(
			priceEntry(
				'SERVICE_CHARGE_SHARE',
				entryCtx({ employment: { ...employment, classification: 'MANAGERIAL' } })
			),
			null
		);
		assert.equal(priceEntry('SERVICE_CHARGE_SHARE', entryCtx()), 8000);
		// Omnibus Rules Book III Rule VIII s.14: loss or damage capped at 20% of the period's basic (31,300 → 6,260).
		assert.equal(priceEntry('LOSS_DAMAGE_DEDUCTION', entryCtx()), 6260);
		assert.equal(
			priceEntry(
				'LOSS_DAMAGE_DEDUCTION',
				entryCtx({ terms: { ...terms, employment_type: 'DOMESTIC' } })
			),
			null
		);
		for (const code of [
			'UNION_DUES',
			'HDMF_VOLUNTARY',
			'HDMF_MP2',
			'LOSS_DAMAGE_DEDUCTION',
			'PROTECTION_ORDER_SUPPORT'
		]) {
			const line = row('adhoc_catalog', code);
			assert.deepEqual(
				[line.destination, line.direction, line.counts_toward],
				['NET', 'SUBTRACT', []],
				code
			);
		}
		for (const [code, counts] of [
			['SEPARATION_PAY', []],
			['RETIREMENT_PAY', []],
			['SEPARATION_PAY_TAXABLE', ['WTAX.SUPPLEMENTARY']],
			['RETIREMENT_PAY_TAXABLE', ['WTAX.SUPPLEMENTARY']],
			['SSS_SICKNESS_BENEFIT', []],
			['MATERNITY_SALARY_DIFFERENTIAL', []],
			['COMMISSION', ['SSS', 'SSS_EC', 'SSS_MPF', 'HDMF', 'WTAX.SUPPLEMENTARY']],
			['BACKPAY_BASIC', ['SSS', 'SSS_EC', 'SSS_MPF', 'HDMF', 'WTAX.ORDINARY']],
			['STATUTORY_ADJUSTMENT', []]
		] as const)
			assert.deepEqual(row('adhoc_catalog', code).counts_toward, counts, code);
		assert.equal(row('adhoc_catalog', 'STATUTORY_ADJUSTMENT').destination, 'NET');
		// RA 11210 s.5(c): the differential, female employees, unless the employer is exempt.
		const differential = (over: Row) =>
			priceEntry('MATERNITY_SALARY_DIFFERENTIAL', entryCtx(over, 20000));
		assert.equal(differential({}), 20000);
		assert.equal(differential({ employee: { ...employee, gender: 'MALE' } }), null);
		assert.equal(
			differential({ company: { ...company, facts: { maternity_differential_exempt: true } } }),
			null
		);
		// PD 851: the December first half adds the rest of December's basic; managerial, task-basis and under-a-month are out.
		const december = ctx({
			entry: { ...entry, amount: 1 },
			earned: { month: {}, year: { BASIC: 330000 }, previous_month: {} },
			terms: { ...terms, base_salary: 30000 },
			period: {
				...RUN.period,
				key: '2026-12-1',
				month_key: '2026-12',
				part: 1,
				parts: 2,
				paid_days: 15,
				days: 15
			}
		});
		assert.equal(priceEntry('THIRTEENTH_MONTH_PAY_YEAR_END', december), 30000);
		for (const over of [
			{ employment: { ...employment, classification: 'MANAGERIAL' } },
			{ terms: { ...terms, statutory_work_category: 'TASK_BASIS' } },
			{ employment: { ...employment, service_months: 0 } }
		])
			assert.equal(priceEntry('THIRTEENTH_MONTH_PAY_YEAR_END', { ...december, ...over }), null);
		// RA 7641 / RA 10757: 60–65 after five years; a mine worker 50–60.
		const retire = (age: number, months: number, facts: Row = {}) =>
			priceEntry(
				'RETIREMENT_PAY',
				ctx({
					employee: { ...employee, age },
					employment: { ...employment, exit_ground: 'RETIREMENT', service_months: months },
					terms: { ...terms, base_salary: 31300, facts }
				})
			);
		assert.equal(retire(52, 72, { mine_worker: 'UNDERGROUND' }), 162000);
		assert.equal(retire(52, 72), null);
		// Past sixty a mine worker retired late keeps the benefit (the compulsory age does not forfeit it).
		assert.equal(retire(61, 72, { mine_worker: 'SURFACE' }), 162000);
		assert.equal(retire(60, 59), null);
		assert.equal(retire(59, 72), null);
		assert.equal(retire(60, 60), 135000);
		// The leaver's pro-rata 13th month: five months' basic and half of June, over twelve.
		assert.equal(
			priceEntry(
				'THIRTEENTH_MONTH_PAY',
				ctx({
					entry: { ...entry, amount: 1 },
					earned: { month: {}, year: { BASIC: 150000 }, previous_month: {} },
					terms: { ...terms, base_salary: 30000, facts: {} },
					period: {
						...RUN.period,
						key: '2026-06',
						month_key: '2026-06',
						paid_days: 15,
						days: 30,
						month_days: 30
					}
				})
			),
			13750
		);
		for (const code of [
			'LOAN_RECOVERY_SSS_SALARY',
			'LOAN_RECOVERY_PAGIBIG_SALARY',
			'LOAN_RECOVERY_PAGIBIG_CALAMITY'
		]) {
			const loan = row('loan_catalog', code);
			assert.deepEqual([loan.destination, loan.direction], ['NET', 'SUBTRACT'], code);
			assert.equal(
				!loan.eligibility ||
					evaluateConfigured(loan.eligibility, {
						...ADMISSION,
						terms: { ...terms, employment_type: 'DOMESTIC' }
					} as never),
				true,
				code
			);
		}
		assert.equal(row('claim_catalog', 'MEDICAL_CLAIM_DIRECT').destination, 'EMPLOYER');
	});

	it('PH-LEAVE: maternity allocation and extension, the event’s solo-parent claim, SIL coverage, company classes', () => {
		const leave = (code: string) => row('leave_catalog', code);
		const days = (code: string, facts: Row, person: Row = {}) =>
			entitlementDays(leave(code).entitlement, 24, {
				...SUBJECT,
				employee: { ...employee, ...person },
				entry: { facts },
				taken: { calendar_year: 0, service_year: 0, lifetime: 0, event: 0 }
			});
		assert.equal(days('MATERNITY_LEAVE', { event_kind: 'BIRTH', days_allocated_to_father: 7 }), 98);
		assert.equal(days('PATERNITY_LEAVE', { maternity_days_allocated: 7 }), 14);
		assert.equal(
			evaluateConfigured(leave('PATERNITY_LEAVE').eligibility, {
				...ADMISSION,
				employee: { ...employee, gender: 'MALE' },
				entry: {
					...entry,
					days: 14,
					event_kind: 'BIRTH',
					facts: { event_kind: 'BIRTH', event_id: 'b1', maternity_days_allocated: 7 }
				}
			} as never),
			true
		);
		assert.equal(
			days(
				'MATERNITY_LEAVE',
				{ event_kind: 'BIRTH', solo_parent_claimed: false },
				{ solo_parent: true }
			),
			105
		);
		assert.equal(days('MATERNITY_LEAVE', { event_kind: 'BIRTH', solo_parent_claimed: true }), 120);
		const extension = leave('MATERNITY_LEAVE_EXTENSION');
		assert.deepEqual([extension.is_npl, days('MATERNITY_LEAVE_EXTENSION', {})], [true, 30]);
		const sil = (over: Row) =>
			evaluateConfigured(leave('ANNUAL_LEAVE').eligibility, { ...ADMISSION, ...over } as never);
		assert.equal(sil({ employment: { ...employment, classification: 'MANAGERIAL' } }), false);
		assert.equal(sil({ terms: { ...terms, statutory_work_category: 'FIELD_PERSONNEL' } }), false);
		assert.equal(sil({ terms: { ...terms, statutory_work_category: 'TASK_BASIS' } }), false);
		assert.equal(sil({}), true);
		const domestic = leave('ANNUAL_LEAVE_DOMESTIC');
		assert.deepEqual(
			[domestic.can_encash, domestic.encash_on_exit, domestic.entitlement.carry_forward],
			[false, false, undefined]
		);
		assert.equal(
			evaluateConfigured(leave('SPECIAL_LEAVE_FOR_WOMEN').eligibility, {
				...ADMISSION,
				employment: { ...employment, service_months: 5 },
				entry: { ...entry, event_kind: 'SURGERY', facts: { event_kind: 'SURGERY' } }
			} as never),
			false
		);
		for (const [code, npl] of [
			['MEDICAL_LEAVE', false],
			['EMERGENCY_LEAVE', false],
			['COMPASSIONATE_LEAVE', false],
			['HOSPITALIZATION_LEAVE', false],
			['PUBLIC_HOLIDAY_IN_LIEU', false],
			['UNPAID_LEAVE', true],
			['ABSENCE', true]
		] as const) {
			assert.equal(leave(code).is_npl, npl, code);
			assert.equal(
				!leave(code).eligibility ||
					evaluateConfigured(leave(code).eligibility, ADMISSION as never) === true,
				true,
				code
			);
		}
	});

	it('PH-SETTINGS: validations — pay frequency, weekly rest, probation, undertime, substituted filing, minors’ week, floors', () => {
		const check = (code: string, context: Row) =>
			evaluateConfigured(load(latest, 'rule_set').find((item) => item.code === code)!.rules.when, {
				...SUBJECT,
				rules: payrollRules(latest),
				day: '2026-03-01',
				period: { ...RUN.period },
				work: RUN.work,
				...context
			} as never);
		const freq = (pay_frequency: string, over: Row = {}) =>
			check('PAY_FREQUENCY', { company: { ...company, pay_frequency }, ...over });
		assert.equal(freq('MONTHLY'), true);
		assert.equal(freq('SEMI_MONTHLY'), false);
		assert.equal(freq('MONTHLY', { terms: { ...terms, employment_type: 'DOMESTIC' } }), false);
		// Labor Code art.103 (Book III Title II) and Omnibus Rules Bk III Rule VIII s.1 reach managers too.
		assert.equal(
			freq('MONTHLY', { employment: { ...employment, classification: 'MANAGERIAL' } }),
			true
		);
		const week = (n: number) => ({
			work: {
				...RUN.work,
				days: Array.from({ length: n }, (_, i) =>
					at(`2026-03-${String(2 + i).padStart(2, '0')}`, 'WORK')
				)
			}
		});
		assert.equal(check('WEEKLY_REST_DAY', week(7)), true);
		assert.equal(check('WEEKLY_REST_DAY', week(6)), false);
		const probation = {
			terms: { ...terms, employment_type: 'PROBATION' },
			employment: { ...employment, start_date: '2026-03-02' }
		};
		assert.equal(check('PROBATION_PAST_SIX_MONTHS', { ...probation, day: '2026-09-02' }), true);
		assert.equal(check('PROBATION_PAST_SIX_MONTHS', { ...probation, day: '2026-06-01' }), false);
		assert.equal(
			check('PROBATION_STILL_RECORDED', {
				...probation,
				period: { ...RUN.period, to: '2026-09-30' }
			}),
			true
		);
		const ot = (worked_hours: number) => ({
			work: { ...RUN.work, days: [day('2026-03-02', 'WORK', { worked_hours, overtime_hours: 2 })] }
		});
		assert.equal(check('UNDERTIME_OFFSET', ot(9)), true);
		assert.equal(check('UNDERTIME_OFFSET', ot(10)), false);
		assert.equal(
			check('SUBSTITUTED_FILING_DISQUALIFIED', {
				period: { ...RUN.period, month_key: '2026-12', to: '2026-12-31', month_to: '2026-12-31' },
				employee: { ...employee, facts: { previous_employer_taxable_compensation: 1 } }
			}),
			true
		);
		const minor = {
			employee: { ...employee, age: 16 },
			work: {
				...RUN.work,
				days: Array.from({ length: 6 }, (_, i) =>
					day(`2026-03-${String(2 + i).padStart(2, '0')}`, 'WORK', { worked_hours: 7 })
				)
			}
		};
		assert.equal(check('MINOR_WORKING_HOURS', minor), true);
		// The floor: a part-time rate on its hours, the workplace key, a kasambahay's domestic floor on the day.
		const floor = (base_salary: number, facts: Row = {}, over: Row = {}) => {
			const t = { ...terms, base_salary, facts, ...over };
			return check('MINIMUM_WAGE_FLOOR_PAYSLIP', { terms: t, term: t });
		};
		assert.equal(floor(9000, { hours_per_day: 4 }), true);
		assert.equal(floor(9500, { hours_per_day: 4 }), false);
		assert.equal(floor(10000, { wage_region: 'BARMM-PROV-AGRI' }), false);
		assert.equal(floor(13000), true);
		const kasambahay = (base_salary: number, on: string) => {
			const t = { ...terms, base_salary, employment_type: 'DOMESTIC' };
			return check('MINIMUM_WAGE_FLOOR_CONTRACT', {
				terms: t,
				term: t,
				day: on,
				company: { ...company, region: 'BARMM' }
			});
		};
		assert.equal(kasambahay(4900, '2025-12-10'), true);
		assert.equal(kasambahay(5000, '2025-12-10'), false);
		assert.equal(kasambahay(5000, '2026-01-10'), true);
	});

	it('PH-SETTINGS: the national holidays of each version, written unpublished', () => {
		const calendar = (version: string) => payrollRules(version).public_holidays.holidays as Row[];
		const v1 = calendar(versions[0]!);
		assert.deepEqual(
			v1.map((h) => [h.date, h.kind]),
			[
				['2025-12-08', 'SPECIAL_HOLIDAY'],
				['2025-12-24', 'SPECIAL_HOLIDAY'],
				['2025-12-25', 'PUBLIC_HOLIDAY'],
				['2025-12-30', 'PUBLIC_HOLIDAY'],
				['2025-12-31', 'SPECIAL_HOLIDAY'],
				['2026-01-01', 'PUBLIC_HOLIDAY']
			]
		);
		const v2 = calendar(latest);
		assert.equal(v2.filter((h) => h.date.startsWith('2026')).length, 20);
		assert.equal(v2.filter((h) => h.date.startsWith('2027')).length, 14);
		assert.deepEqual(
			v2.filter((h) => h.name.startsWith('Eid')).map((h) => [h.date, h.kind]),
			[
				['2026-03-20', 'PUBLIC_HOLIDAY'],
				['2026-05-27', 'PUBLIC_HOLIDAY']
			]
		);
		// 2027's Chinese New Year, Black Saturday, All Souls' and Christmas Eve are special working days (Proclamation 1427).
		assert.equal(
			v2.some((h) => h.date === '2027-02-06'),
			false
		);
		const rule = (settingsOf(latest).behaviours as Behaviours).rules.find(
			(item) => item.id === 'write-public-holidays'
		)!;
		const writes = effectWrites(rule, {
			event: {
				settings_id: settingsOf(latest).id,
				company_id: 'c',
				row: { id: 'c', approval_id: null, region: 'NCR' }
			},
			calendar: [{ rules: payrollRules(latest).public_holidays }],
			held: [{ date: '2026-01-01' }]
		});
		assert.equal(writes.length, v2.length - 1);
		assert.ok(writes.every((write) => !('published_at' in write.data)));
	});

	it('PH-SETTINGS: every wage key covers the window newest-first; BARMM’s provincial second tranche; the change summary and stale texts', () => {
		for (const version of versions) {
			const table = payrollRules(version).minimum_wage as {
				by_region: Record<string, Row[]>;
				by_employment_type: Record<string, Record<string, Row[]>>;
			};
			const keys = [
				...Object.entries(table.by_region),
				...Object.entries(table.by_employment_type.DOMESTIC!)
			];
			for (const [key, entries] of keys) {
				assert.ok(entries.at(-1)!.from <= '2025-12-01', `${version} ${key} starts in force`);
				assert.deepEqual(
					entries.map((e) => e.from),
					entries
						.map((e) => e.from)
						.toSorted()
						.toReversed(),
					`${version} ${key} newest-first`
				);
				assert.ok(
					entries.every((e) => Number(e.monthly) > 0),
					`${version} ${key}`
				);
			}
			// Matrix footnotes /r and /s: ₱436 and ₱426 a day × 313 ÷ 12 from 1 December 2026.
			assert.deepEqual(
				[table.by_region['BARMM-PROV-NONAGRI']![0], table.by_region['BARMM-PROV-AGRI']![0]],
				[
					{ from: '2026-12-01', monthly: 11372.33 },
					{ from: '2026-12-01', monthly: 11111.5 }
				]
			);
		}
		assert.match(String(settingsOf(latest).change_summary), /uniform ₱7,000 → ₱8,000/);
		const coe = load(latest, 'rule_set').find((item) => item.code === 'CERTIFICATE_OF_EMPLOYMENT')!;
		assert.match(coe.rules.authority, /three days from the employee’s request/);
		assert.match(coe.rules.authority, /RA 10361 s\.35/);
		// Contract allowances enter SSS and Pag-IBIG but not PhilHealth (5% of the basic only).
		for (const allowance of load(latest, 'allowance_catalog'))
			assert.ok(
				allowance.counts_toward.includes('SSS') && !allowance.counts_toward.includes('PHIC'),
				allowance.code
			);
	});

	it('PH-SETTINGS: NCR-27 never took effect — the NCR floor is NCR-26 to 25 September 2026, NCR-28 after, no 2027 tranche', () => {
		const floorOn = (entries: Row[], day: string) => entries.find((e) => e.from <= day)!.monthly;
		for (const version of versions) {
			const table = payrollRules(version).minimum_wage as { by_region: Record<string, Row[]> };
			const ncr = table.by_region.NCR!;
			const small = table.by_region['NCR-AGRI-SMALL']!;
			// NCR-28 recitals: an SQAO (24 July 2026), a TRO and a WPI — "Wage Order No. NCR-27 never took effect".
			assert.ok(!ncr.some((e) => ['2026-07-25', '2027-01-20'].includes(e.from)), version);
			assert.equal(floorOn(ncr, '2026-07-25'), 18127.92); // ₱695 × 313 ÷ 12 (NCR-26)
			assert.equal(floorOn(ncr, '2026-09-25'), 18127.92);
			assert.equal(floorOn(ncr, '2026-09-26'), 19692.92); // ₱755 (NCR-28 s.2)
			assert.equal(floorOn(ncr, '2027-01-20'), 19692.92); // not NCR-27's ₱780
			assert.equal(floorOn(small, '2027-01-20'), 18727.83); // ₱718, not ₱743
		}
	});

	it('PH-SETTINGS: RXIII-DW-06 sets one ₱6,500 kasambahay floor for cities and other municipalities alike', () => {
		for (const version of versions) {
			const domestic = (
				payrollRules(version).minimum_wage as {
					by_employment_type: { DOMESTIC: Record<string, Row[]> };
				}
			).by_employment_type.DOMESTIC;
			// s.1: "Chartered Cities and First-Class Municipalities / Other Municipalities" share one row, ₱6,000 → ₱6,500.
			assert.equal(domestic['XIII-OTHER'], undefined, version);
			assert.deepEqual(domestic.XIII, [
				{ from: '2026-01-03', monthly: 6500 },
				{ from: '2025-12-01', monthly: 6000 }
			]);
		}
	});

	it('PH-OBLIGATION: the Annual Establishment Report on Wages and the Rule 1020 establishment registration', () => {
		const due = (version: string, code: string, context: object) =>
			evaluateConfigured(
				load(version, 'rule_set').find((item) => item.code === code)!.rules.due,
				context as never
			);
		const december = (year: number) => ({
			today: `${year}-12-05`,
			headcount: 20,
			row: { facts: {} },
			period: { key: `${year}-12`, from: `${year}-12-01`, to: `${year}-12-31` },
			company
		});
		// Labor Advisory 08-26: the CY2025 report closes 31 August 2026; CY2026 carries the same day as a recorded default.
		assert.equal(
			due(versions[0]!, 'ANNUAL_ESTABLISHMENT_REPORT_ON_WAGES', december(2025)),
			'2026-08-31'
		);
		assert.equal(due(latest, 'ANNUAL_ESTABLISHMENT_REPORT_ON_WAGES', december(2026)), '2027-08-31');
		for (const version of versions) {
			const report = load(version, 'rule_set').find(
				(item) => item.code === 'ANNUAL_ESTABLISHMENT_REPORT_ON_WAGES'
			)!.rules;
			assert.deepEqual(report.trigger, { collection: 'entity', event: 'calendar' });
			assert.match(report.authority, /art\.124/);
		}
		// OSHS Rule 1023(2): a new establishment registers within thirty days before operation — due on its first day.
		const entity = {
			row: { effective_range: { from: '2026-03-02', to: null }, facts: {} },
			company,
			period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' }
		};
		for (const version of versions)
			assert.equal(due(version, 'DOLE_ESTABLISHMENT_REGISTRATION', entity), '2026-03-02');
		assert.equal(
			due(latest, 'DOLE_ESTABLISHMENT_REGISTRATION', { ...entity, row: { facts: {} } }),
			'2026-03-01'
		);
	});

	it('PH-CONTRIBUTION: a remittance paid late raises the SSS 2%, PhilHealth 3% and Pag-IBIG 0.1%-a-day penalty task', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const paid = (duty_code: string, fulfilled_on: string, state = 'FULFILLED') =>
				raiseDuties({
					behaviours: settings.behaviours as unknown as Behaviours,
					settings_id: settings.id,
					rows: load(version, 'rule_set'),
					collection: 'obligation',
					event: 'updated',
					row: {
						id: `o-${duty_code}`,
						company_id: 'c',
						approval_id: null,
						duty_code,
						state,
						due_on: '2026-04-30',
						fulfilled_on
					},
					reads: { company: [company], employee: [] }
				}).map((write) => [String(write.duty_code), String(write.due_on)]);
			assert.deepEqual(paid('SSS_CONTRIBUTION_REMITTANCE', '2026-05-12'), [
				['SSS_LATE_REMITTANCE_PENALTY', '2026-05-12']
			]);
			assert.deepEqual(paid('PHILHEALTH_PREMIUM_REMITTANCE', '2026-05-02'), [
				['PHILHEALTH_LATE_REMITTANCE_INTEREST', '2026-05-02']
			]);
			assert.deepEqual(paid('HDMF_CONTRIBUTION_REMITTANCE', '2026-05-01'), [
				['HDMF_LATE_REMITTANCE_PENALTY', '2026-05-01']
			]);
			// On time, or not yet paid: nothing.
			assert.deepEqual(paid('SSS_CONTRIBUTION_REMITTANCE', '2026-04-30'), []);
			assert.deepEqual(paid('SSS_CONTRIBUTION_REMITTANCE', '2026-05-12', 'OPEN'), []);
			assert.deepEqual(paid('BIR_1601C_MONTHLY_REMITTANCE', '2026-05-12'), []);
		}
	});

	it('PH-TAX: a weekly or daily entity withholds on the Annex E weekly and daily columns; December’s last week annualises', () => {
		const wtax = (version: string) => row('statutory_contribution_catalog', 'WTAX', version);
		for (const version of versions) {
			const tax = (
				pay_frequency: string,
				wage: number,
				part: number,
				parts: number,
				extra: Row = {}
			) =>
				assess(
					version,
					wtax(version),
					{ wage },
					{},
					{
						company: { ...company, pay_frequency },
						terms: { ...terms, base_salary: 60000 },
						period: {
							key: `2026-03-${part}`,
							from: '2026-03-08',
							to: '2026-03-14',
							days: 7,
							month: 3,
							salary_paid: true,
							part,
							parts,
							month_key: '2026-03',
							month_from: '2026-03-01',
							month_to: '2026-03-31',
							pay_date: '2026-03-14'
						},
						...extra
					}
				).employee;
			// Week 1 of 5, 10,000 taxable: 432.60 + 20% × (10,000 − 7,692) = 894.20.
			assert.equal(tax('WEEKLY', 10000, 1, 5), 894.2);
			// Week 2: 20,000 month to date → 2 × the column on 10,000 = the month's 1,788.40 (894.20 this week).
			assert.equal(tax('WEEKLY', 20000, 2, 5), 1788.4);
			// The last week of a five-week month stays on the weekly column, not the monthly one.
			assert.equal(tax('WEEKLY', 50000, 5, 5), 4471);
			// Day 1, 2,000: 61.65 + 20% × (2,000 − 1,096) = 242.45; day 3 at 6,000 to date = 3 × 242.45.
			assert.equal(tax('DAILY', 2000, 1, 31), 242.45);
			assert.equal(tax('DAILY', 6000, 3, 31), 727.35);
			// Daily top rung: 6,034.30 + 35% × (30,000 − 21,918).
			assert.equal(tax('DAILY', 30000, 1, 31), 8863);
			// A monthly entity is unchanged: the monthly column on 30,000 less contributions.
			assert.equal(tax('MONTHLY', 30000, 1, 1), tax('', 30000, 1, 1));
			// December's last week (27 Dec – 2 Jan) ends in January but still annualises.
			const december = (part: number) =>
				evaluateConfigured(wtax(version).configuration.rules[1].when, {
					terms,
					employment: { ...employment, exit_date: '' },
					period: {
						month: 12,
						part,
						parts: 4,
						to: '2027-01-02',
						month_to: '2026-12-31',
						from: '2026-12-27'
					}
				} as never);
			assert.equal(december(4), true);
			assert.equal(december(3), false);
		}
	});

	it('PH-ADHOC: the SSS maternity benefit — six highest credits of the twelve months before the semester ÷ 180 × 105, 120 or 60 days', () => {
		const benefit = row('adhoc_catalog', 'SSS_MATERNITY_BENEFIT');
		// Birth 10 Aug 2026: Q3 semester Apr–Sep 2026, so the window is Apr 2025 – Mar 2026.
		const month = (key: string, base: number) => ({ month: key, statutory: { SSS: { base } } });
		const history = [
			month('2025-03', 35000), // before the window
			month('2025-04', 18000),
			month('2025-05', 18200), // → 18,000 (₱500 steps)
			month('2025-06', 19000),
			month('2025-07', 25000), // ₱20,000 Regular SS ceiling
			month('2025-08', 15000),
			month('2025-09', 16000),
			month('2025-10', 17000),
			month('2026-03', 30000), // last month of the window → 20,000
			month('2026-04', 35000) // inside the semester: excluded
		];
		const price = (facts: Row, months = history, amount = 1000) =>
			priceEntry('SSS_MATERNITY_BENEFIT', {
				...RUN,
				earned: { ...RUN.earned, history: months },
				entry: { ...entry, amount, occurred_on: '2026-08-10', facts }
			});
		// Six highest: 20,000 + 20,000 + 19,000 + 18,000 + 18,000 + 17,000 = 112,000 → 622.22 a day.
		assert.equal(price({ event_kind: 'BIRTH' }), 65333.33);
		assert.equal(price({ event_kind: 'BIRTH', solo_parent_claimed: true }), 74666.67);
		assert.equal(price({ event_kind: 'MISCARRIAGE' }), 37333.33);
		// The ceiling: six months at 20,000 or more give the published ₱70,000 for 105 days.
		assert.equal(
			price(
				{ event_kind: 'BIRTH' },
				['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09'].map((key) =>
					month(key, 35000)
				)
			),
			70000
		);
		// Fewer than three credits on this payroll (a new hire): the amount SSS computes, keyed.
		assert.equal(price({ event_kind: 'BIRTH' }, history.slice(0, 3), 41000), 41000);
		// A man is refused at admission.
		assert.equal(
			evaluateConfigured(benefit.eligibility, {
				...ADMISSION,
				employee: { ...employee, gender: 'MALE' }
			} as never),
			false
		);
		assert.deepEqual(benefit.counts_toward, []);
	});

	it('PH-OBLIGATION / PH-LEAVE: workplace cases — WAIR, the 24-hour notice, dangerous occurrences, FWA, telecommuting, suspension extension, the solo parent’s schedule; AEDR and AMR', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const kinds = (
				(load(version, 'rule_set').find((item) => item.code === 'case_kinds')!.rules as Row)
					.kinds as { code: string }[]
			).map((kind) => kind.code);
			assert.deepEqual(kinds.toSorted(), [
				'DANGEROUS_OCCURRENCE',
				'FLEXIBLE_WORK_ARRANGEMENT',
				'PERSONAL_DATA_BREACH',
				'SOLO_PARENT_FLEXIBLE_SCHEDULE',
				'SUSPENSION_EXTENSION',
				'TELECOMMUTING_PROGRAM',
				'WORK_ACCIDENT'
			]);
			const opened = (kind: string, facts: Row = {}) =>
				raiseDuties({
					behaviours: settings.behaviours as unknown as Behaviours,
					settings_id: settings.id,
					rows: load(version, 'rule_set'),
					collection: 'workplace_case',
					event: 'created',
					row: {
						id: `case-${kind}`,
						company_id: 'c',
						employment_id: null,
						approval_id: null,
						kind,
						opened_on: '2026-03-02',
						closed_on: null,
						facts
					},
					day: '2026-03-02',
					reads: { company: [company], employee: [] }
				}).map((write) => [String(write.duty_code), String(write.due_on)]);
			// OSHS Rule 1053.01(1): the 20th of the month after the occurrence.
			assert.deepEqual(opened('WORK_ACCIDENT', { occurred_on: '2026-02-27' }), [
				['DOLE_WORK_ACCIDENT_REPORT', '2026-03-20']
			]);
			// Rule 1053.01(2): a death adds the 24-hour notice.
			assert.deepEqual(
				opened('WORK_ACCIDENT', { occurred_on: '2026-03-01', outcome: 'DEATH' }).toSorted(),
				[
					['DOLE_SERIOUS_ACCIDENT_NOTICE', '2026-03-02'],
					['DOLE_WORK_ACCIDENT_REPORT', '2026-04-20']
				]
			);
			assert.deepEqual(opened('DANGEROUS_OCCURRENCE'), [
				['DOLE_DANGEROUS_OCCURRENCE_REPORT', '2026-03-02']
			]);
			// DA 02-09 Part V: before implementation.
			assert.deepEqual(opened('FLEXIBLE_WORK_ARRANGEMENT', { starts_on: '2026-03-16' }), [
				['DOLE_FLEXIBLE_WORK_ARRANGEMENT_NOTICE', '2026-03-15']
			]);
			assert.deepEqual(opened('TELECOMMUTING_PROGRAM', { starts_on: '2026-04-01' }), [
				['DOLE_TELECOMMUTING_NOTICE', '2026-04-01']
			]);
			// DO 215-20: ten days before the extension takes effect.
			assert.deepEqual(opened('SUSPENSION_EXTENSION', { starts_on: '2026-04-01' }), [
				['DOLE_SUSPENSION_EXTENSION_REPORT', '2026-03-22']
			]);
			// RA 8972 s.6: the solo parent's flexible schedule (PH-LEAVE-15).
			assert.deepEqual(opened('SOLO_PARENT_FLEXIBLE_SCHEDULE'), [
				['SOLO_PARENT_FLEXIBLE_SCHEDULE', '2026-03-02']
			]);
			// Rule 1054(2) and Rule 1965.01(4): the year-end calendar raises the AEDR (30 Jan) and the AMR (31 Mar).
			const december = raiseDuties({
				behaviours: settings.behaviours as unknown as Behaviours,
				settings_id: settings.id,
				rows: load(version, 'rule_set'),
				collection: 'entity',
				event: 'calendar',
				row: { id: 'c', company_id: 'c', approval_id: null, facts: {} },
				day: '2026-12-05',
				headcount: 20,
				reads: { company: [company], employee: [] }
			}).map((write) => [String(write.duty_code), String(write.due_on)]);
			assert.ok(
				december.some(([c, d]) => c === 'DOLE_ANNUAL_EXPOSURE_DATA_REPORT' && d === '2027-01-30')
			);
			assert.ok(
				december.some(([c, d]) => c === 'DOLE_ANNUAL_MEDICAL_REPORT' && d === '2027-03-31')
			);
		}
	});

	it('PH-OBLIGATION: wages in legal tender, by cheque or bank only on the Rule VIII s.2 conditions, never paid in a bar or gaming place', () => {
		for (const version of versions) {
			const rule = (code: string) =>
				load(version, 'rule_set').find((item) => item.code === code)!.rules as Row;
			const check = (code: string, facts: Row, companyFacts: Row = {}) =>
				evaluateConfigured(rule(code).when, {
					...SUBJECT,
					company: { ...company, facts: companyFacts },
					terms: { ...terms, facts },
					term: { ...terms, facts },
					day: '2026-03-01'
				} as never);
			assert.equal(rule('WAGE_PAYMENT_IN_TOKENS').kind, 'refuse');
			assert.equal(
				check('WAGE_PAYMENT_IN_TOKENS', { wage_payment_medium: 'TOKEN_OR_VOUCHER' }),
				true
			);
			assert.equal(check('WAGE_PAYMENT_IN_TOKENS', { wage_payment_medium: 'CASH' }), false);
			assert.equal(check('WAGE_PAYMENT_IN_TOKENS', {}), false);
			assert.equal(rule('WAGE_PAYMENT_MEDIUM_CONDITIONS').kind, 'warn');
			for (const medium of ['CHEQUE', 'BANK_TRANSFER', 'E_WALLET']) {
				assert.equal(
					check('WAGE_PAYMENT_MEDIUM_CONDITIONS', { wage_payment_medium: medium }),
					true
				);
				// Owner ruling: the s.2 conditions are one entity fact.
				assert.equal(
					check(
						'WAGE_PAYMENT_MEDIUM_CONDITIONS',
						{ wage_payment_medium: medium },
						{ wage_payment_conditions_met: true }
					),
					false
				);
			}
			assert.equal(check('WAGE_PAYMENT_MEDIUM_CONDITIONS', { wage_payment_medium: 'CASH' }), false);
			assert.equal(rule('WAGE_PAYMENT_PLACE').kind, 'refuse');
			assert.equal(
				check('WAGE_PAYMENT_PLACE', { wage_payment_place: 'BAR_CLUB_OR_GAMING_PLACE' }),
				true
			);
			assert.equal(
				check('WAGE_PAYMENT_PLACE', {
					wage_payment_place: 'BAR_CLUB_OR_GAMING_PLACE',
					employed_at_payment_place: true
				}),
				false
			);
			for (const place of [
				'AT_OR_NEAR_WORKPLACE',
				'ELSEWHERE_EMERGENCY',
				'ELSEWHERE_FREE_TRANSPORT'
			])
				assert.equal(check('WAGE_PAYMENT_PLACE', { wage_payment_place: place }), false);
		}
	});

	it('PH-OBLIGATION: the 1604-C alphalist exports — Schedule 1 for employees, Schedule 2 for minimum wage earners, BIR columns', () => {
		const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
		const slip = (period: string, lines: Row, wtax: number, shares: Row) => ({
			period,
			status: 'PAID',
			gross: Object.values(lines).reduce((t: number, a) => t + Number(a), 0),
			net: 0,
			total_deductions: 0,
			lines,
			statutory: {
				SSS: { employee: shares.SSS, employer: 0, base: 0 },
				PHIC: { employee: shares.PHIC, employer: 0, base: 0 },
				HDMF: { employee: 200, employer: 200, base: 0 },
				WTAX: { employee: wtax, employer: 0, base: 0 },
				...(lines.BASIC != null && shares.MWE
					? { MWE_STATUS: { employee: 0, employer: 0, base: Number(lines.BASIC) } }
					: {})
			}
		});
		for (const version of versions) {
			const templates = load(version, 'rule_set').filter((item) => item.family === 'EXPORTS');
			assert.deepEqual(templates.map((item) => item.code).toSorted(), [
				'BIR_1604C_ALPHALIST_SCHEDULE_1',
				'BIR_1604C_ALPHALIST_SCHEDULE_2'
			]);
			// 30,000 a month and a 30,000 13th month: 23,400 of shares, 336,600 taxable, tax due 12,990.
			const employee = {
				employee: { name: 'JAY DUNGO CARLOS', nationality: 'PH', facts: {} },
				contract: {
					employee_number: 'E-01',
					effective_range: { from: '2020-01-06', to: null },
					exit_ground: null,
					facts: {
						contract_terms: [{ employment_type: 'PERMANENT', base_salary: { value: 30000 } }]
					}
				},
				slips: months.map((m) =>
					slip(
						m,
						m.endsWith('-12')
							? { BASIC: 30000, THIRTEENTH_MONTH_PAY_YEAR_END: 30000 }
							: { BASIC: 30000 },
						m.endsWith('-12') ? 1990 : 1000,
						{ SSS: 1000, PHIC: 750 }
					)
				)
			};
			// A part year exported (OPSPH032's shape): 140,000 over two months, tax withheld — a taxable row, not 7e.
			const partYear = {
				employee: { name: 'JONEL M DELA GENTE', nationality: 'PH', facts: {} },
				contract: {
					effective_range: { from: '2020-01-06', to: null },
					exit_ground: null,
					facts: {
						contract_terms: [{ employment_type: 'PERMANENT', base_salary: { value: 70000 } }]
					}
				},
				slips: ['2026-01', '2026-02'].map((m) =>
					slip(m, { BASIC: 70000 }, 12975.03, { SSS: 1000, PHIC: 650 })
				)
			};
			const named = [
				'ALYSSA MAE DE LOS REYES',
				'JUAN CARLO DEL ROSARIO SANTOS',
				'MARIA STA. ANA',
				'Dela Cruz, Juan Pedro'
			].map((name) => ({
				employee: { name, nationality: 'PH', facts: {} },
				contract: {
					effective_range: { from: '2020-01-06', to: null },
					exit_ground: null,
					facts: {}
				},
				slips: [slip('2026-01', { BASIC: 10000 }, 0, { SSS: 500, PHIC: 250 })]
			}));
			const declared = {
				employee: {
					name: 'ALYSSA MAE DE LOS REYES',
					nationality: 'PH',
					facts: { last_name: 'DE LOS REYES', first_name: 'ALYSSA MAE', middle_name: '' }
				},
				contract: {
					effective_range: { from: '2020-01-06', to: null },
					exit_ground: null,
					facts: {}
				},
				slips: [slip('2026-01', { BASIC: 10000 }, 0, { SSS: 500, PHIC: 250 })]
			};
			named.push(declared);
			// An MWE on 15,000 a month with 1,000 overtime and 500 holiday pay in March.
			const mwe = {
				employee: { name: 'Manarin, Clariz Olivar', nationality: 'PH', facts: {} },
				contract: {
					effective_range: { from: '2026-03-01', to: '2026-10-15' },
					exit_ground: 'RESIGNATION',
					facts: {
						contract_terms: [
							{
								employment_type: 'PROBATION',
								base_salary: { value: 15000 },
								facts: { days_per_year: 313, wage_region: 'NCR' }
							}
						]
					}
				},
				slips: months
					.slice(2, 10)
					.map((m) =>
						slip(
							m,
							m === '2026-03'
								? { BASIC: 15000, OVERTIME: 1000, HOLIDAY_WORK: 500 }
								: { BASIC: 15000 },
							0,
							{ SSS: 750, PHIC: 375, MWE: true }
						)
					)
			};
			const docs = recordDocuments(
				templates.map((item) => ({ code: String(item.code), rules: item.rules })),
				[{ period: '2026-01' }, { period: '2026-12' }],
				[employee, mwe, partYear, ...named]
			);
			const table = (name: string) => {
				const doc = docs.find((d) => d.name === name)!;
				const [header, ...rows] = doc.content.split('\n');
				const cells = (line: string) =>
					line
						.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!
						.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''));
				const heads = cells(header!);
				return rows.map((line) => Object.fromEntries(cells(line).map((c, i) => [heads[i], c])));
			};
			const one = table('1604C-schedule-1-2026.csv');
			assert.equal(one.length, 7);
			const row1 = one[0]!;
			// Index numbers the rows of each file.
			assert.deepEqual(
				one.map((r) => r['Seq. No. (1)']),
				['1', '2', '3', '4', '5', '6', '7']
			);
			const part = one[1]!;
			assert.deepEqual(
				[part['Last Name (2a)'], part['First Name (2b)'], part['Middle Name (2c)']],
				['DELA GENTE', 'JONEL', 'M']
			);
			assert.equal(part['Salaries & Other Forms of Compensation, P250,000 & below (7e)'], '0');
			// 140,000 less 3,300 of shares and 400 Pag-IBIG.
			assert.equal(part['Total Taxable Compensation Income, present employer (7j)'], '136300');
			assert.equal(
				part['Basic Salary, net of SSS, GSIS, PHIC, HDMF Contributions & Union Dues (7g)'],
				'136300'
			);
			assert.equal(part['Tax Withheld Jan–Nov, Present Employer (15b)'], '25950.06');
			const names = one
				.slice(2)
				.map((r) => [r['Last Name (2a)'], r['First Name (2b)'], r['Middle Name (2c)']]);
			assert.deepEqual(names, [
				['DE LOS REYES', 'ALYSSA', 'MAE'],
				['SANTOS', 'JUAN CARLO', 'DEL ROSARIO'],
				['STA. ANA', 'MARIA', ''],
				['Dela Cruz', 'Juan', 'Pedro'],
				['DE LOS REYES', 'ALYSSA MAE', '']
			]);
			// No tax withheld and at most 250,000 taxable: 7e.
			assert.equal(
				one[2]!['Salaries & Other Forms of Compensation, P250,000 & below (7e)'],
				'9050'
			);
			assert.equal(one[2]!['Total Taxable Compensation Income, present employer (7j)'], '0');
			assert.equal(row1['Seq. No. (1)'], '1');
			assert.deepEqual(
				[
					row1['Last Name (2a)'],
					row1['First Name (2b)'],
					row1['Middle Name (2c)'],
					row1['Current Employment Status (4)']
				],
				['CARLOS', 'JAY', 'DUNGO', 'R']
			);
			assert.deepEqual(
				[row1['From (MM/DD) (5a)'], row1['To (MM/DD) (5b)'], row1['Reason of Separation (6)']],
				['01/01', '12/31', '']
			);
			assert.equal(row1['Gross Compensation Income, present employer (7a)'], '390000');
			assert.equal(row1['13th Month Pay & Other Benefits (7b)'], '30000');
			assert.equal(
				row1['SSS, GSIS, PHIC & HDMF Contributions and Union Dues, employee share (7d)'],
				'23400'
			);
			assert.equal(
				row1['Basic Salary, net of SSS, GSIS, PHIC, HDMF Contributions & Union Dues (7g)'],
				'336600'
			);
			assert.equal(row1['Total Taxable Compensation Income, present employer (7j)'], '336600');
			assert.equal(row1['Tax Due (January to December) (14)'], '12990');
			assert.equal(row1['Tax Withheld Jan–Nov, Present Employer (15b)'], '11000');
			assert.equal(row1['Amount Withheld and Paid in December or Last Salary (17a)'], '1990');
			assert.equal(row1['Substituted Filing? (19)'], 'Yes');
			const two = table('1604C-schedule-2-2026.csv');
			assert.equal(two.length, 1);
			const row2 = two[0]!;
			assert.equal(two[0]!['Seq. No. (1)'], '1');
			assert.deepEqual(
				[
					row2['Last Name (2a)'],
					row2['First Name (2b)'],
					row2['Middle Name (2c)'],
					row2['Current Employment Status (4)'],
					row2['Region No. Where Assigned (4)']
				],
				['Manarin', 'Clariz', 'Olivar', 'P', 'NCR']
			);
			assert.deepEqual(
				[row2['From (MM/DD) (5a)'], row2['To (MM/DD) (5b)'], row2['Reason of Separation (6)']],
				['03/01', '10/15', 'T']
			);
			assert.equal(row2['Basic/SMW per Day (7b)'], '575.08'); // 15,000 × 12 ÷ 313
			assert.equal(row2['Holiday Pay (7g)'], '500');
			assert.equal(row2['Overtime Pay (7h)'], '1000');
			// 8 × 15,000 less 8 × 1,325 of shares.
			assert.equal(
				row2['Basic/SMW, actual, net of SSS, GSIS, PHIC, HDMF Contributions & Union Dues (7f)'],
				'109400'
			);
			assert.equal(row2['Total Taxable Compensation Income, present employer (7r)'], '0');
			assert.equal(row2['Tax Due (January to December) (14)'], '0');
			// Header order follows the BIR form's column numbers.
			assert.match(
				docs.find((d) => d.name === '1604C-schedule-1-2026.csv')!.content.split('\n')[0]!,
				/^Seq\. No\. \(1\),Last Name \(2a\)/
			);
		}
	});

	it('PH-OBLIGATION: the MWE_STATUS scheme marks a minimum wage earner’s slip at no charge and lists no payslip line', () => {
		for (const version of versions) {
			const marker = scheme('MWE_STATUS', version);
			assert.equal(marker.configuration.assess_without_wage, true);
			const at = (base_salary: number, part = 1, parts = 1) =>
				assess(
					version,
					marker,
					{},
					{},
					{
						terms: { ...terms, base_salary },
						period: {
							...RUN.period,
							month: 3,
							part,
							parts,
							month_to: '2026-03-31',
							pay_date: '2026-03-31'
						}
					}
				);
			// No charge either way: a zero statutory line is not listed among the payslip's deductions.
			assert.deepEqual([at(15000).employee, at(15000).employer, at(30000).employee], [0, 0, 0]);
			assert.equal(at(15000).person.mwe, true);
			assert.equal(at(30000).person.mwe, false);
			assert.equal(
				load(version, 'work_catalog').some((item) => item.code === 'MWE_STATUS'),
				false
			);
		}
	});

	it('PH-WORK: work suspensions — no work no pay on a bona fide suspension, force majeure, strike or lockout; wages during a work stoppage order', () => {
		for (const version of versions) {
			const kinds = load(version, 'suspension_kind');
			assert.deepEqual(kinds.map((k) => k.code).toSorted(), [
				'BONA_FIDE_SUSPENSION',
				'FORCE_MAJEURE',
				'LOCKOUT',
				'STRIKE',
				'WORK_STOPPAGE_ORDER'
			]);
			const kind = (code: string) => kinds.find((k) => k.code === code)!;
			const evalOr = (text: string, fallback: unknown, context: Row) =>
				text === '' ? fallback : evaluateConfigured(text, context as never);
			const daily = { ...terms, base_salary: 700, facts: { rate_basis: 'DAILY' } };
			const dayCtx = (t: Row) => ({
				...RUN,
				terms: t,
				day: { date: '2026-03-03', worked: false, day_type: 'WORK' },
				suspension: { kind: 'X', facts: {} }
			});
			for (const code of ['BONA_FIDE_SUSPENSION', 'FORCE_MAJEURE', 'STRIKE', 'LOCKOUT']) {
				assert.equal(evalOr(kind(code).counts_as_attended, false, dayCtx(terms)), false, code);
				assert.equal(evalOr(kind(code).scheduled, true, dayCtx(terms)), false, code);
				assert.equal(evalOr(kind(code).pay, 0, dayCtx(daily)), 0, code);
			}
			const wso = kind('WORK_STOPPAGE_ORDER');
			assert.equal(evalOr(wso.counts_as_attended, false, dayCtx(terms)), true);
			assert.equal(evalOr(wso.pay, 0, dayCtx(daily)), 700); // DO 198-18 s.24: the daily-paid paid the day
			assert.equal(evalOr(wso.pay, 0, dayCtx(terms)), 0); // the monthly salary runs on
			// The lines: two unpaid suspension days off a 31,300 monthly salary at 31,300 × 12 ÷ 313 = 1,200 a day; the stoppage day paid to the daily-paid.
			const suspended = (kind: string, pay = 0, facts: Row = {}) => ({
				kind,
				facts,
				counts_as_attended: false,
				scheduled: false,
				pay
			});
			const days = [
				day('2026-03-02', 'WORK', { suspended: suspended('FORCE_MAJEURE') }),
				day('2026-03-03', 'WORK', { suspended: suspended('BONA_FIDE_SUSPENSION') }),
				day('2026-03-04', 'WORK', {
					suspended: suspended('STRIKE', 0, { paid_by_agreement: true })
				}),
				day('2026-03-05', 'WORK', { suspended: suspended('WORK_STOPPAGE_ORDER') }),
				day('2026-03-06', 'WORK', { worked_hours: 8 })
			];
			const price = (code: string, t: Row, ds: Row[]) => {
				const line = row('work_catalog', code, version);
				const context = { ...RUN, terms: t, work: { ...RUN.work, days: ds } };
				if (evaluateConfigured(line.eligibility, context as never) !== true) return 0;
				return cents(
					Number(evaluateConfigured(line.quantity, context as never)) *
						Number(evaluateConfigured(line.rate, context as never))
				);
			};
			assert.equal(
				price('SUSPENSION_DEDUCTION', { ...terms, base_salary: 31300, facts: {} }, days),
				2400
			);
			assert.equal(price('SUSPENSION_DEDUCTION', daily, days), 0);
			const wsoDay = [
				day('2026-03-05', 'WORK', { suspended: suspended('WORK_STOPPAGE_ORDER', 700) })
			];
			assert.equal(price('SUSPENSION_PAY', daily, wsoDay), 700);
			assert.equal(price('SUSPENSION_PAY', daily, days), 0);
		}
	});

	it('PH-OBLIGATION: record retention to 31 December of the exit year + 6 (NIRC s.235 as amended by RA 11976), then disposal', () => {
		for (const version of versions) {
			const retention = load(version, 'rule_set').find((item) => item.code === 'record_retention')!;
			assert.equal(retention.family, 'PAYROLL');
			assert.equal(
				evaluateConfigured(retention.rules.until, {
					...SUBJECT,
					employment: { ...employment, exit_date: '2026-06-30' }
				} as never),
				'2032-12-31'
			);
			assert.match(retention.rules.authority, /five \(5\) years/);
			assert.match(retention.rules.authority, /s\.11\(e\)/);
		}
	});

	describe('PH-WORK: work-day sheet import rules (roster validations)', () => {
		const contractOf = (id: string, number: string, employment_type: string) => ({
			id,
			company_id: 'c1',
			employee_id: `p-${id}`,
			employee_number: number,
			approval_id: null,
			engagement: 'EMPLOYEE',
			effective_range: { from: '2025-01-01', to: null },
			facts: {
				contract_terms: [
					{
						effective_range: { from: '2025-01-01', to: null },
						base_salary: { value: 30000, currency: 'PHP' },
						employment_type,
						work_classification: 'RANK_AND_FILE',
						facts: {}
					}
				]
			}
		});
		const fixture = (): HostRead => {
			const settings = versions.map((version) => settingsOf(version));
			const tables = new Map<string, Row[]>([
				[
					'entity',
					[
						{
							id: 'c1',
							name: 'Acme PH',
							settings_code: 'PH',
							region: 'NCR',
							time_zone: 'Asia/Manila',
							facts: {}
						}
					]
				],
				['jurisdiction_settings', settings],
				[
					'employment_contract',
					[
						contractOf('k1', 'E1', 'PERMANENT'),
						contractOf('k2', 'E2', 'PERMANENT'),
						contractOf('k3', 'E3', 'DOMESTIC'),
						contractOf('k4', 'E4', 'PERMANENT'),
						contractOf('k5', 'E5', 'PERMANENT')
					]
				],
				[
					'employment_profile',
					[
						{ id: 'p-k1', name: 'Adult One', date_of_birth: '1990-01-01', facts: {} },
						{ id: 'p-k2', name: 'Minor Two', date_of_birth: '2010-01-01', facts: {} },
						{ id: 'p-k3', name: 'Kasambahay Three', date_of_birth: '1985-01-01', facts: {} },
						{
							id: 'p-k4',
							name: 'Expecting Four',
							gender: 'FEMALE',
							date_of_birth: '1992-01-01',
							children: [{ estimated_delivery_date: '2026-05-15' }],
							facts: {}
						},
						{
							id: 'p-k5',
							name: 'Certified Five',
							gender: 'FEMALE',
							date_of_birth: '1992-01-01',
							children: [],
							facts: { night_work_alternative_until: '2026-03-03' }
						}
					]
				],
				[
					'shift_definition',
					[
						{
							id: 'D',
							company_id: 'c1',
							code: 'D',
							variant: { day_type: 'WORK', start_time: '08:00', end_time: '17:00' }
						},
						{
							id: 'L',
							company_id: 'c1',
							code: 'L',
							variant: { day_type: 'WORK', start_time: '06:00', end_time: '20:00' }
						}
					]
				],
				['shift_pattern', []],
				['holiday', []],
				['roster_entry', []],
				['leave_catalog', []],
				['leave_catalog_entry', []],
				['payslip', []],
				['payroll_run', []],
				['rule_set', versions.flatMap((version) => load(version, 'rule_set'))],
				['suspension_kind', []],
				['work_suspension', []]
			]);
			const matches = (row: Row, where: Row): boolean =>
				Object.entries(where).every(([key, spec]) =>
					Object.entries(spec as Row).every(([op, operand]) => {
						const value = row[key];
						if (op === 'eq') return value === operand;
						if (op === 'in') return Array.isArray(operand) && operand.includes(value);
						if (op === 'isNull') return operand ? value == null : value != null;
						if (op === 'gte') return value != null && String(value) >= String(operand);
						if (op === 'lte') return value != null && String(value) <= String(operand);
						throw new Error(`fixture reader: unsupported operator ${op}`);
					})
				);
			return (async (collection: string, query: { where?: Row }) => ({
				rows: (tables.get(collection) ?? []).filter((row) => matches(row, query.where ?? {}))
			})) as unknown as HostRead;
		};
		let n = 1;
		const line = (
			employee_number: string,
			work_date: string,
			shift_code = 'D',
			clock_in?: string,
			clock_out?: string
		) => ({
			row: ++n,
			employee_number,
			work_date,
			shift_code,
			...(clock_in == null ? {} : { clock_in, clock_out })
		});
		const findings = async (rows: Row[]) => {
			const plan = await runEngine(
				planRosterImport({
					company_id: 'c1',
					rows: rows as never,
					now: '2026-03-20T00:00:00.000Z'
				}),
				fixture(),
				(message) => {
					throw new Error(message);
				}
			);
			return { errors: plan.errors, warnings: plan.warnings.map((w) => w.message) };
		};
		const week = (number: string, days: number, clock: [string, string] = ['08:00', '17:00']) =>
			Array.from({ length: days }, (_, i) =>
				line(number, `2026-03-0${i + 2}`, 'D', clock[0], clock[1])
			);

		it('Labor Code art.91: the seventh consecutive day worked warns; six do not', async () => {
			const seven = await findings(week('E1', 7));
			assert.deepEqual(seven.errors, []);
			assert.equal(seven.warnings.filter((m) => /seventh consecutive day/.test(m)).length, 1);
			const six = await findings(week('E1', 6));
			assert.equal(six.warnings.filter((m) => /seventh consecutive day/.test(m)).length, 0);
		});

		it('RA 9231: a sixteen-year-old over eight hours or at night warns; an adult does not', async () => {
			const minor = await findings([
				line('E2', '2026-03-02', 'D', '08:00', '18:00'),
				line('E2', '2026-03-03', 'D', '18:00', '23:00')
			]);
			assert.deepEqual(minor.errors, []);
			assert.ok(minor.warnings.some((m) => /under eighteen over the RA 9231 hours/.test(m)));
			assert.ok(minor.warnings.some((m) => /under eighteen worked at night/.test(m)));
			const adult = await findings([
				line('E1', '2026-03-02', 'D', '08:00', '18:00'),
				line('E1', '2026-03-03', 'D', '18:00', '23:00')
			]);
			assert.equal(adult.warnings.filter((m) => /under eighteen/.test(m)).length, 0);
		});

		it('RA 10361 s.20: a kasambahay over sixteen hours in a day warns; an employee does not', async () => {
			const kasambahay = await findings([line('E3', '2026-03-02', 'D', '05:00', '22:00')]);
			assert.ok(
				kasambahay.warnings.some((m) => /kasambahay worked more than sixteen hours/.test(m))
			);
			const other = await findings([line('E1', '2026-03-02', 'D', '05:00', '22:00')]);
			assert.equal(other.warnings.filter((m) => /kasambahay/.test(m)).length, 0);
		});

		it('DA 02-04: a planned day over twelve hours warns; a nine-hour shift does not', async () => {
			const long = await findings([line('E1', '2026-03-02', 'L')]);
			assert.ok(long.warnings.some((m) => /more than twelve hours/.test(m)));
			const normal = await findings([line('E1', '2026-03-02', 'D')]);
			assert.equal(normal.warnings.filter((m) => /twelve hours/.test(m)).length, 0);
		});

		it('Labor Code art.158: night work (midnight–5 a.m.) within sixteen weeks of the expected delivery, or a certified period, warns', async () => {
			const night = (number: string, date: string) => line(number, date, 'D', '22:00', '06:00');
			const flagged = (result: { warnings: string[] }) =>
				result.warnings.filter((m) => /around childbirth worked at night/.test(m)).length;
			// Delivery expected 15 May 2026: 2 March is within sixteen weeks before it.
			assert.equal(flagged(await findings([night('E4', '2026-03-02')])), 1);
			// A day shift is not night work.
			assert.equal(flagged(await findings([line('E4', '2026-03-02', 'D', '08:00', '17:00')])), 0);
			// The medical certificate's period ends 3 March: the night of the 2nd warns, the 4th does not.
			assert.equal(flagged(await findings([night('E5', '2026-03-02')])), 1);
			assert.equal(flagged(await findings([night('E5', '2026-03-04')])), 0);
			// No pregnancy recorded: not flagged.
			assert.equal(flagged(await findings([night('E1', '2026-03-02')])), 0);
		});

		it('every PH roster rule warns — none refuses the record of hours worked', () => {
			for (const version of versions) {
				const roster = load(version, 'rule_set').filter(
					(item) => item.family === 'VALIDATIONS' && (item.rules as Row).site === 'roster'
				);
				assert.deepEqual(roster.map((item) => item.code).toSorted(), [
					'ROSTER_COMPRESSED_WORKWEEK_CAP',
					'ROSTER_KASAMBAHAY_DAILY_REST',
					'ROSTER_MATERNITY_NIGHT_WORK',
					'ROSTER_MINOR_HOURS',
					'ROSTER_MINOR_NIGHT_WORK',
					'ROSTER_WEEKLY_REST'
				]);
				assert.ok(roster.every((item) => (item.rules as Row).kind === 'warn'));
			}
		});
	});

	it('PH-OBLIGATION: re-registration with the DOLE on a change of business name, location or ownership (Rule 1024(2))', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const updated = (before: Row | null) =>
				raiseDuties({
					behaviours: settings.behaviours as unknown as Behaviours,
					settings_id: settings.id,
					rows: load(version, 'rule_set'),
					collection: 'entity',
					event: 'updated',
					row: {
						id: 'c',
						company_id: 'c',
						approval_id: null,
						name: 'New Name Inc',
						region: 'NCR',
						facts: {},
						before
					},
					day: '2026-05-04',
					reads: { company: [company], employee: [] }
				})
					.map((write) => [String(write.duty_code), String(write.due_on)])
					.filter(([code]) => code === 'DOLE_ESTABLISHMENT_REREGISTRATION');
			assert.deepEqual(updated({ name: 'Old Name Inc' }), [
				['DOLE_ESTABLISHMENT_REREGISTRATION', '2026-05-04']
			]);
			assert.deepEqual(updated({ region: 'IV-A' }), [
				['DOLE_ESTABLISHMENT_REREGISTRATION', '2026-05-04']
			]);
			assert.deepEqual(updated({ registration_number: 'CS2019-1' }), [
				['DOLE_ESTABLISHMENT_REREGISTRATION', '2026-05-04']
			]);
			assert.deepEqual(updated({ facts: {} }), []);
			assert.deepEqual(updated(null), []);
		}
	});

	it('PH-TAX: the annualisation exempts each month’s wage on that month’s own MWE status', () => {
		for (const version of versions) {
			const wtax = row('statutory_contribution_catalog', 'WTAX', version);
			const month = (key: string, wage: number, mwe: boolean) => ({
				month: key,
				statutory: {
					WTAX: { employee: 0, employer: 0, base: wage, parts: { wage } },
					SSS: { employee: 1000, employer: 2000, base: 20000 },
					PHIC: { employee: 500, employer: 500, base: wage },
					HDMF: { employee: 200, employer: 200, base: 10000 },
					MWE_STATUS: { employee: 0, employer: 0, base: mwe ? wage : 0 }
				}
			});
			// The year root and the month history agree, as the engine builds them: the year's wage is the months' sum and
			// the year's charged shares are 1,700 a month.
			const december = (months: Row[], base_salary: number, wage: number) =>
				assess(
					version,
					wtax,
					{ wage },
					{ wage: months.reduce((t, m) => t + Number(m.statutory.WTAX.parts.wage), 0) },
					{
						terms: { ...terms, base_salary },
						charged: {
							month: Object.fromEntries(
								load(version, 'statutory_contribution_catalog').map((item) => [
									item.code,
									{ employee: 0, employer: 0 }
								])
							),
							year: {
								SSS: { employee: 1000 * months.length, employer: 0 },
								PHIC: { employee: 500 * months.length, employer: 0 },
								HDMF: { employee: 200 * months.length, employer: 0 }
							}
						},
						earned: { month: {}, year: {}, previous_month: {}, months, history: [] },
						period: {
							...RUN.period,
							key: '2026-12',
							from: '2026-12-01',
							to: '2026-12-31',
							month: 12,
							part: 1,
							parts: 1,
							month_key: '2026-12',
							month_to: '2026-12-31'
						}
					}
				).employee;
			const keys = Array.from({ length: 11 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
			// 40,000 a month taxable January–September, then an MWE (the floor rose past the salary): 9 × (40,000 − 1,700)
			// = 344,700 taxable → (344,700 − 250,000) × 15% = 14,205 — not zero because December happens to be an MWE month.
			const raised = keys.map((k, i) => month(k, i < 9 ? 40000 : 18000, i >= 9));
			assert.equal(december(raised, 18000, 18000), 14205);
			// The reverse: exempt months stay exempt when December is taxable — only December's 40,000 − 1,700 counts.
			const fell = keys.map((k) => month(k, 18000, true));
			assert.equal(december(fell, 40000, 40000), 0);
		}
	});

	it('PH-LEAVE: RA 11210 s.6 — allocated maternity days to an unmarried father or an alternate caregiver; paternity at most 7 + 7; the event’s solo-parent claim', () => {
		for (const version of versions) {
			const leave = (code: string) =>
				load(version, 'leave_catalog').find((item) => item.code === code)!;
			const admit = (code: string, person: Row, facts: Row, days: number) =>
				evaluateConfigured(leave(code).eligibility, {
					...ADMISSION,
					employee: { ...employee, ...person },
					entry: { ...entry, event_kind: 'BIRTH', days, facts: { event_kind: 'BIRTH', ...facts } },
					earlier: { rows: [], calendar_year: 0, lifetime: 0 }
				} as never);
			const single = { gender: 'MALE', marital_status: 'SINGLE' };
			const allocated = (recipient: string) => ({
				allocation_recipient: recipient,
				maternity_days_allocated: 7
			});
			assert.equal(admit('MATERNITY_ALLOCATION_LEAVE', single, allocated('FATHER'), 7), true);
			assert.equal(admit('MATERNITY_ALLOCATION_LEAVE', single, allocated('FATHER'), 8), false);
			assert.equal(
				admit(
					'MATERNITY_ALLOCATION_LEAVE',
					{ gender: 'FEMALE', marital_status: 'SINGLE' },
					allocated('ALTERNATE_CAREGIVER'),
					7
				),
				true
			);
			assert.equal(admit('MATERNITY_ALLOCATION_LEAVE', single, {}, 7), false);
			// A married father takes them on PATERNITY_LEAVE beside his RA 8187 seven: 14, not 15.
			assert.equal(
				admit(
					'MATERNITY_ALLOCATION_LEAVE',
					{ gender: 'MALE', marital_status: 'MARRIED' },
					allocated('FATHER'),
					7
				),
				false
			);
			const married = { gender: 'MALE', marital_status: 'MARRIED' };
			assert.equal(admit('PATERNITY_LEAVE', married, { maternity_days_allocated: 7 }, 14), true);
			assert.equal(admit('PATERNITY_LEAVE', married, { maternity_days_allocated: 7 }, 15), false);
			assert.equal(
				Number(
					evaluateConfigured(leave('MATERNITY_ALLOCATION_LEAVE').entitlement.days, {
						...ADMISSION,
						entry: { facts: { maternity_days_allocated: 10 } }
					} as never)
				),
				7
			);
			// RA 11210 s.3: the event's own solo-parent claim admits 120 days though the profile flag is off.
			assert.equal(
				admit(
					'MATERNITY_LEAVE',
					{ gender: 'FEMALE', solo_parent: false },
					{ solo_parent_claimed: true },
					120
				),
				true
			);
			assert.equal(
				admit('MATERNITY_LEAVE', { gender: 'FEMALE', solo_parent: false }, {}, 120),
				false
			);
		}
	});

	it('PH-ADHOC: a BIR-qualified plan’s retirement benefit is exempt at fifty with ten years’ service, once', () => {
		for (const version of versions) {
			const plan = row('adhoc_catalog', 'RETIREMENT_PAY_QUALIFIED_PLAN', version);
			const eligible = (
				age: number,
				service_months: number,
				companyFacts: Row,
				employeeFacts: Row = {}
			) =>
				evaluateConfigured(plan.eligibility, {
					...RUN,
					employee: { ...employee, age, facts: employeeFacts },
					company: { ...company, facts: companyFacts },
					employment: { ...employment, exit_ground: 'RETIREMENT', service_months }
				} as never);
			const qualified = { bir_qualified_retirement_plan: true };
			assert.equal(eligible(55, 130, qualified), true);
			assert.equal(eligible(49, 130, qualified), false);
			assert.equal(eligible(55, 119, qualified), false);
			assert.equal(eligible(55, 130, {}), false);
			assert.equal(
				eligible(55, 130, qualified, { retirement_plan_exemption_availed: true }),
				false
			);
			assert.deepEqual(plan.counts_toward, []);
		}
	});

	it('PH-OBLIGATION: Data Privacy Act — DPO, NPC registration at 250 employees or 1,000 sensitive records, the 72-hour breach notice and the five-day report', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const raise = (collection: string, row: Row, headcount = 20, facts: Row = {}) =>
				raiseDuties({
					behaviours: settings.behaviours as unknown as Behaviours,
					settings_id: settings.id,
					rows: load(version, 'rule_set'),
					collection,
					event: 'created',
					row,
					headcount,
					day: '2026-03-02',
					reads: { company: [{ ...company, facts }], employee: [] }
				}).map((write) => [String(write.duty_code), String(write.due_on)]);
			const entity = {
				id: 'c',
				approval_id: null,
				effective_range: { from: '2026-03-02', to: null },
				facts: {}
			};
			const npc = (codes: string[][]) =>
				codes.filter(([c]) => c === 'NPC_REGISTRATION' || c === 'DPO_DESIGNATION');
			assert.deepEqual(npc(raise('entity', entity)), [['DPO_DESIGNATION', '2026-03-02']]);
			assert.deepEqual(npc(raise('entity', entity, 300)), [
				['DPO_DESIGNATION', '2026-03-02'],
				['NPC_REGISTRATION', '2026-03-22']
			]);
			assert.deepEqual(npc(raise('entity', entity, 20, { processes_sensitive_pi_1000: true })), [
				['DPO_DESIGNATION', '2026-03-02'],
				['NPC_REGISTRATION', '2026-03-22']
			]);
			const breach = raise('workplace_case', {
				id: 'case-b',
				company_id: 'c',
				employment_id: null,
				approval_id: null,
				kind: 'PERSONAL_DATA_BREACH',
				opened_on: '2026-03-02',
				closed_on: null,
				facts: {}
			});
			assert.deepEqual(breach.toSorted(), [
				['NPC_BREACH_FULL_REPORT', '2026-03-10'],
				['NPC_BREACH_NOTIFICATION', '2026-03-05']
			]);
		}
	});

	it('PH-OBLIGATION: the NPC registration renews yearly in the thirty days before its anniversary, once (entity calendar)', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const tick = (day: string, facts: Row, headcount = 300, raised: Row[] = []) =>
				raiseDuties({
					behaviours: settings.behaviours as unknown as Behaviours,
					settings_id: settings.id,
					rows: load(version, 'rule_set'),
					collection: 'entity',
					event: 'calendar',
					row: { id: 'c', company_id: 'c', approval_id: null, facts },
					day,
					headcount,
					reads: { company: [{ ...company, facts }], employee: [], raised }
				})
					.filter((write) => write.duty_code === 'NPC_REGISTRATION_RENEWAL')
					.map((write) => [String(write.due_on), String(write.occurrence_key)]);
			const registered = { npc_registered_on: '2025-11-01' };
			// 2 Oct 2026 is the first day of the window before 1 Nov 2026; 1 Oct is too early; 1 Nov is the expiry itself.
			assert.deepEqual(tick('2026-10-01', registered), []);
			const raisedOnce = tick('2026-10-02', registered);
			assert.equal(raisedOnce.length, 1);
			assert.equal(raisedOnce[0]![0], '2026-11-01');
			assert.match(raisedOnce[0]![1]!, /2026$/);
			assert.deepEqual(tick('2026-11-01', registered), []);
			// A December window reaches into the next year's anniversary.
			assert.deepEqual(
				tick('2026-12-20', { npc_registered_on: '2026-01-10' }).map(([due]) => due),
				['2027-01-10']
			);
			// Not in the registration's own year, not below the mandatory threshold, not without the date.
			assert.deepEqual(tick('2026-10-20', { npc_registered_on: '2026-11-01' }), []);
			assert.deepEqual(tick('2026-10-20', registered, 20), []);
			assert.deepEqual(
				tick('2026-10-20', { ...registered, processes_sensitive_pi_1000: true }, 20).length,
				1
			);
			assert.deepEqual(tick('2026-10-20', {}), []);
			// 29 February renews on 28 February.
			assert.deepEqual(
				tick('2027-02-10', { npc_registered_on: '2024-02-29' }).map(([due]) => due),
				['2027-02-28']
			);
		}
	});

	it('PH-OBLIGATION: the yearly returns ride the entity calendar — an entity with no December run still owes them, once a year', () => {
		const YEARLY = [
			['BIR_1604C_ANNUAL_ALPHALIST', '2027-01-31'],
			['BIR_2316_CERTIFICATE', '2027-01-31'],
			['BIR_2316_SUBSTITUTED_FILING_LIST', '2027-02-28'],
			['BIR_YEAR_END_ADJUSTMENT', '2027-01-25'],
			['THIRTEENTH_MONTH_PAYMENT', '2026-12-24'],
			['THIRTEENTH_MONTH_DOLE_REPORT', '2027-01-15'],
			['ANNUAL_ESTABLISHMENT_REPORT_ON_WAGES', '2027-08-31'],
			['DOLE_ANNUAL_EXPOSURE_DATA_REPORT', '2027-01-30'],
			['DOLE_ANNUAL_MEDICAL_REPORT', '2027-03-31']
		];
		const codes = new Set(YEARLY.map(([code]) => code));
		for (const version of versions) {
			const settings = settingsOf(version);
			const tick = (day: string, headcount = 20) =>
				raiseDuties({
					behaviours: settings.behaviours as unknown as Behaviours,
					settings_id: settings.id,
					rows: load(version, 'rule_set'),
					collection: 'entity',
					event: 'calendar',
					row: { id: 'c', company_id: 'c', approval_id: null, facts: {} },
					day,
					headcount,
					reads: { company: [company], employee: [] }
				})
					.filter((write) => codes.has(String(write.duty_code)))
					.map((write) => [
						String(write.duty_code),
						String(write.due_on),
						String(write.occurrence_key)
					]);
			// No payroll run at all: the 1 December tick raises the year's nine duties at their legal days.
			const opened = tick('2026-12-01');
			assert.deepEqual(opened.map(([c, d]) => [c, d]).toSorted(), YEARLY.toSorted(), version);
			// A January tick (no December run either) names the same year — the same occurrence keys, so raised once.
			const january = tick('2027-01-10');
			assert.deepEqual(
				january.map(([c]) => c).toSorted(),
				YEARLY.filter(([c]) => c !== 'THIRTEENTH_MONTH_PAYMENT')
					.map(([c]) => c)
					.toSorted()
			);
			for (const [code, , key] of january)
				assert.equal(key, opened.find(([c]) => c === code)![2], `${version} ${code}`);
			assert.ok(january.every(([, , key]) => key!.endsWith('2026')));
			// November is before the window; past each due day it is not raised; no employees, nothing.
			assert.deepEqual(tick('2026-11-30'), []);
			assert.deepEqual(tick('2027-09-01'), []);
			assert.deepEqual(
				tick('2027-04-01').map(([c]) => c),
				['ANNUAL_ESTABLISHMENT_REPORT_ON_WAGES']
			);
			assert.deepEqual(tick('2026-12-05', 0), []);
		}
	});

	it('PH-OBLIGATION: SSS s.14-B — an involuntary separation raises the notice of termination and the certificate the claim relies on', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const codes = raiseDuties({
				behaviours: settings.behaviours as unknown as Behaviours,
				settings_id: settings.id,
				rows: load(version, 'rule_set'),
				collection: 'employment_contract',
				event: 'updated',
				row: {
					id: 'k',
					approval_id: null,
					company_id: 'c',
					employee_id: 'p',
					exit_ground: 'REDUNDANCY',
					effective_range: { from: '2020-03-02', to: '2026-06-30' },
					exit_facts: { ground: 'REDUNDANCY', last_day: '2026-06-30' }
				},
				reads: { company: [company], employee: [{ nationality: 'PH', gender: 'MALE', facts: {} }] }
			}).map((write) => String(write.duty_code));
			assert.ok(codes.includes('AUTHORISED_CAUSE_TERMINATION_NOTICE'), version);
			assert.ok(codes.includes('CERTIFICATE_OF_EMPLOYMENT'), version);
		}
	});

	it('PH-SETTINGS: version names, the dated-table design stated, stale minimum-wage text removed', () => {
		assert.equal(settingsOf(versions[0]!).name, 'Philippines — 1 December 2025');
		assert.equal(settingsOf(latest).name, 'Philippines — 6 January 2026 (RR 29-2025)');
		for (const version of versions) {
			const wages = payrollRules(version).minimum_wage as Row;
			const text = JSON.stringify(wages);
			assert.match(
				String(wages.authority),
				/accepted design for regional wage orders, coordinator design decision/
			);
			assert.match(String(wages.authority), /can exempt days earned before the order/);
			for (const stale of [
				'not transcribed',
				'not yet transcribed',
				'pending an exact sealed',
				'lineage is split',
				'block_below_when',
				'this version states',
				'the version from that date carries',
				'Unrepresented mid-interval',
				'owner direction'
			])
				assert.ok(!text.includes(stale), `${version}: ${stale}`);
			// Rule VIII s.14(c): the loss-and-damage cap is stated as the weekly 20% summed over the period's weeks.
			assert.match(
				String(
					load(version, 'adhoc_catalog').find((item) => item.code === 'LOSS_DAMAGE_DEDUCTION')!
						.authority
				),
				/Recorded default \(weekly cap\)/
			);
		}
	});

	it('PH-WORK: a mid-month hire is prorated by paid days; the MPF line is recorded at zero below the band', () => {
		assert.equal(
			priceWork(
				'BASIC',
				ctx({
					period: { ...RUN.period, paid_days: 15, days: 31 },
					terms: { ...terms, base_salary: 31000, facts: {} }
				})
			),
			15000
		);
		const mpf = assess(latest, row('statutory_contribution_catalog', 'SSS_MPF'), {
			ordinary: 15000
		});
		assert.deepEqual([mpf.employee, mpf.employer], [0, 0]);
		// A matched catch-all rule writes the zero line a later slip of the month reads back.
		assert.equal(
			row('statutory_contribution_catalog', 'SSS_MPF').configuration.rules.at(-1).when,
			'true'
		);
	});

	it('PH-WORK: a compressed-workweek shift is ordinary time; a lactation break does not cut a day’s pay', () => {
		// DA 02-04: under an approved CWW the roster’s 10-hour shift is the normal day, so its overtime_hours is 0.
		const cww = day('2026-03-02', 'WORK', {
			worked_hours: 10,
			overtime_hours: 0,
			intervals: [shift('2026-03-02', '07:00', '17:00')]
		});
		assert.equal(priceWork('OVERTIME', ctx({}, [cww])), 0);
		assert.equal(
			priceWork('OVERTIME', ctx({}, [{ ...cww, worked_hours: 11, overtime_hours: 1 }])),
			187.5
		);
		// RA 10028 s.12: 40 compensable minutes — a daily-paid day of 7h20m worked is still a whole day.
		const lactating = day('2026-03-02', 'WORK', {
			worked_hours: 7 + 1 / 3,
			intervals: [shift('2026-03-02', '08:00', '16:00')]
		});
		assert.equal(
			priceWork(
				'BASIC',
				ctx(
					{
						terms: { ...terms, base_salary: 700, facts: { rate_basis: 'DAILY' } },
						leave: { rows: [] }
					},
					[lactating]
				)
			),
			700
		);
	});

	it('PH-WORK: no-pay leave and encashment priced on the engine; PhilHealth stays on the whole basic', async () => {
		const engine = harness();
		const leaveId = (code: string) =>
			engine.tables
				.get('leave_catalog')!
				.find((item) => item.code === code && item.settings_id === settingsOf(latest).id)!.id;
		engine.tables.get('leave_catalog_entry')!.push(
			{
				id: 'npl',
				catalog_id: leaveId('UNPAID_LEAVE'),
				employment_id: 'k-p1',
				company_id: engine.COMPANY,
				approval_id: null,
				payslip_id: null,
				activity: 'TIME_OFF',
				occurred_on: '2026-03-10',
				from: '2026-03-10',
				to: '2026-03-11',
				days: 2,
				facts: {}
			},
			{
				id: 'enc',
				catalog_id: leaveId('ANNUAL_LEAVE'),
				employment_id: 'k-p1',
				company_id: engine.COMPANY,
				approval_id: null,
				payslip_id: null,
				activity: 'ENCASHMENT',
				occurred_on: '2026-03-20',
				days: 3,
				facts: {}
			}
		);
		const plan = await engine.run('2026-03', 'REGULAR');
		const slip = plan.payslips.find((item) => item.employment_id === 'k-p1')!;
		const base = Object.fromEntries(slip.base.map((line) => [line.component_code, line.amount]));
		assert.equal(base.NO_PAY_LEAVE, -2300.32);
		assert.equal(base.ENCASHMENT, 3450.48);
		const lines = Object.fromEntries(
			slip.statutory.map((line) => [line.scheme_code, [line.employee_amount, line.employer_amount]])
		);
		assert.deepEqual(lines.PHIC, [750, 750]);
		// SSS on 31,150.16 → MSC 31,000; the encashment is inside the 12-day ceiling, so WTAX is on 27,699.68 − 2,500 shares.
		assert.deepEqual(lines.SSS_MPF, [550, 1100]);
		assert.deepEqual(lines.WTAX, [655, 0]);
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
			MWE_STATUS: [0, 0],
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
