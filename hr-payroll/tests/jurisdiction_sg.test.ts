/** SG public seed: version snapshots, CEL on the engine context, and the statutory amounts each version charges. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
	effectWrites,
	planBehaviours,
	type Behaviours
} from '../src/lib/payroll_engine/behaviours.ts';
import { electionKeysOf } from '../src/lib/payroll_engine/employment_facts.ts';
import { dutiesOf, DUTY_KEYS, raiseDuties, triggerOf } from './duties.ts';
import { Effect } from 'effect';
import { Reads } from '../src/lib/payroll_engine/foundation.ts';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.ts';
import { configuredProgram, evaluateConfigured } from '../src/lib/payroll_engine/expressions.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = { [key: string]: Json };
type Band = { when: string; amount: string; limit?: { amount: string } | null };
type Contribution = { when?: string; contribution?: string; employee?: string; employer?: string };
type Configuration = {
	person?: Record<string, string>;
	assessable?: Record<string, string>;
	assessment?: string;
	refuse_when?: { when: string; message: string }[];
	rules?: Contribution[];
};
type FieldSpec = { kind: string; values?: readonly string[] };

const ROOT = process.cwd();
const LAW = resolve(ROOT, 'seed/jurisdiction/SG');
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
/** The keys whose string value the engine evaluates as CEL. */
const CEL_KEYS = new Set([
	'eligibility',
	'qualifies_when',
	'quantity',
	'rate',
	'when',
	'amount',
	'assessment',
	'contribution',
	'employee',
	'employer',
	'effect',
	'days',
	'age',
	'ordinary',
	'additional',
	'due'
]);

const versions = readdirSync(LAW)
	.filter((entry) => entry.startsWith('version_'))
	.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const loaded = new Map<string, Row[]>();
const load = (version: string, table: string): Row[] => {
	const key = `${version}/${table}`;
	let rows = loaded.get(key);
	if (rows === undefined) {
		rows = JSON.parse(readFileSync(resolve(LAW, version, `${table}.json`), 'utf8')) as Row[];
		loaded.set(key, rows);
	}
	return rows;
};
const settingsOf = (version: string): Row => load(version, 'jurisdiction_settings')[0]!;
const row = (version: string, table: string, code: string): Row => {
	const found = load(version, table).find((item) => item.code === code);
	assert.ok(found, `${version} ${table} ${code}`);
	return found;
};
const configuration = (version: string, code: string): Configuration =>
	row(version, 'statutory_contribution_catalog', code).configuration as Configuration;
const nextDay = (day: string): string =>
	new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const modelFields = (table: string): Record<string, FieldSpec> => {
	const path = readdirSync(resolve(ROOT, 'src/data/model'), { recursive: true, encoding: 'utf8' })
		.map((entry) => entry.split('\\').join('/'))
		.find((entry) => entry.endsWith(`${table}/+model.ts`));
	assert.ok(path, `${table} has a model`);
	const fields = readFileSync(resolve(ROOT, 'src/data/model', path), 'utf8');
	// A field is a top-level key of `fields: { … }`: one tab deeper than `fields`, followed by `{`.
	const body = fields.slice(fields.indexOf('\tfields: {'));
	const out: Record<string, FieldSpec> = {};
	const heads = [...body.matchAll(/^\t\t([a-z_]+): \{/gm)];
	heads.forEach((head, index) => {
		const block = body.slice(head.index, heads[index + 1]?.index ?? body.length);
		// The field's own kind is its first `kind:`; nested shapes come later in the block.
		const kind = /kind: '([a-z]+)'/.exec(block)?.[1] ?? 'json';
		const values = kind === 'enum' ? /values: \[([^\]]*)\]/.exec(block)?.[1] : undefined;
		out[head[1]!] = {
			kind,
			...(values == null
				? {}
				: { values: values.split(',').map((value) => value.trim().slice(1, -1)) })
		};
	});
	return out;
};

/** Every CEL string in a value, with where it sits. */
const celOf = (value: Json, path: string, out: [string, string][] = []): [string, string][] => {
	if (Array.isArray(value)) value.forEach((item, index) => celOf(item, `${path}[${index}]`, out));
	else if (value != null && typeof value === 'object')
		for (const [key, item] of Object.entries(value)) {
			if (typeof item === 'string' && CEL_KEYS.has(key) && item.trim() !== '')
				out.push([`${path}.${key}`, item]);
			else celOf(item, `${path}.${key}`, out);
		}
	return out;
};

/** The CPF month for one assessable wage, as the engine's statutory step evaluates it. */
const charge = (
	version: string,
	code: string,
	assessed: number,
	person: Row,
	from = '2026-03-01',
	elections: Row = {},
	immigration_status?: string
): { employee: number; employer: number } | 'REFUSED' | null => {
	const config = configuration(version, code);
	const base = { ordinary: assessed, additional: 0, assessed, amount: assessed };
	const context = {
		base,
		// The engine always supplies these person keys, null when unknown.
		person: { race: null, religion: null, nationality: null, residency_since: null, ...person },
		period: { key: from.slice(0, 7), from, days: 31 },
		// The employee's declared standing for this scheme (employment_profile.facts.employment_statutory_facts).
		scheme: { code, standing: '', elections },
		employee: { facts: immigration_status == null ? {} : { immigration_status } }
	};
	for (const guard of config.refuse_when ?? [])
		if (evaluateConfigured(guard.when, context) === true) return 'REFUSED';
	for (const rule of config.rules ?? []) {
		if (rule.when != null && evaluateConfigured(rule.when, context) !== true) continue;
		const on =
			config.assessment == null ? assessed : Number(evaluateConfigured(config.assessment, context));
		const ruled = { ...context, base: { ...base, assessed: on, amount: on } };
		if (rule.contribution != null)
			return evaluateConfigured(rule.contribution, ruled) as { employee: number; employer: number };
		return {
			employee: rule.employee == null ? 0 : Number(evaluateConfigured(rule.employee, ruled)),
			employer: rule.employer == null ? 0 : Number(evaluateConfigured(rule.employer, ruled))
		};
	}
	return null;
};

/** CPF First Schedule in exact integer arithmetic: [employer, employee, 500–750 coefficient] per 10,000. */
const cpfExact = ([er, ee, k]: readonly number[], cents: number) => {
	const halfUp = (numerator: number) => Math.floor((2 * numerator + 1e6) / 2e6);
	if (cents <= 5000) return { employee: 0, employer: 0 };
	if (cents <= 50000) return { employee: 0, employer: halfUp(er! * cents) };
	if (cents <= 75000) {
		const employee = Math.floor((k! * (cents - 50000)) / 1e6);
		return { employee, employer: halfUp(er! * cents + k! * (cents - 50000)) - employee };
	}
	const employee = Math.floor((ee! * cents) / 1e6);
	return { employee, employer: halfUp((er! + ee!) * cents) - employee };
};
const AGES = [30, 57, 62, 67, 72] as const;
/** Citizen / SPR third year onwards, by age band (≤55, 55–60, 60–65, 65–70, >70). */
const SC: Record<string, readonly (readonly number[])[]> = {
	version_1: [
		[1700, 2000, 6000],
		[1550, 1700, 5100],
		[1200, 1150, 3450],
		[900, 750, 2250],
		[750, 500, 1500]
	],
	version_2: [
		[1700, 2000, 6000],
		[1600, 1800, 5400],
		[1250, 1250, 3750],
		[900, 750, 2250],
		[750, 500, 1500]
	],
	version_4: [
		[1700, 2000, 6000],
		[1650, 1900, 5700],
		[1300, 1300, 3900],
		[900, 750, 2250],
		[750, 500, 1500]
	]
};
SC.version_3 = SC.version_2!;
/** SPR graduated employer and graduated employee rates (Tables 2–3), first and second year. */
const PR1 = [
	[400, 500, 1500],
	[400, 500, 1500],
	[350, 500, 1500],
	[350, 500, 1500],
	[350, 500, 1500]
] as const;
const PR2 = [
	[900, 1500, 4500],
	[600, 1250, 3750],
	[350, 750, 2250],
	[350, 500, 1500],
	[350, 500, 1500]
] as const;

/** The CEL subject roots `subjectContext` (services.ts) builds, with a test's overrides merged per root. */
const subject = (over: { employee?: Row; employment?: Row; terms?: Row; company?: Row } = {}) => {
	const employment = {
		classification: 'EA_COVERED',
		start_date: '2010-01-01',
		service_months: 12,
		exit_date: '',
		exit_ground: '',
		exit_facts: {},
		...over.employment
	};
	const employee = {
		gender: '',
		marital_status: '',
		spouse_status: '',
		solo_parent: false,
		disabled: false,
		receiving_pension: false,
		nationality: '',
		date_of_birth: '1990-01-01',
		age: 36,
		children: [],
		dependents_count: 0,
		facts: {},
		...over.employee
	};
	const terms = {
		work_classification: employment.classification,
		statutory_work_category: 'NON_MANUAL',
		employment_type: 'PERMANENT',
		residency_status: 'CITIZEN',
		residency_since: '',
		base_salary: 5000,
		monthly_wage: 5000,
		...over.terms
	};
	return {
		employee,
		company: { region: '', risk_class: '', pay_frequency: 'MONTHLY', facts: {}, ...over.company },
		terms,
		employment,
		person: {
			employment,
			race: null,
			religion: null,
			nationality: null,
			residency_status: terms.residency_status,
			residency_since: terms.residency_since
		}
	};
};

/** The context `admitEntry` (services.ts) evaluates a leave class's eligibility in: subject, rules, entry. */
const admission = (over: Parameters<typeof subject>[0], occurred_on: string, facts: Row = {}) => ({
	...subject(over),
	rules: {},
	entry: {
		days: 1,
		...facts,
		amount: 0,
		quantity: 1,
		occurred_on,
		due_on: occurred_on,
		incurred_on: occurred_on,
		facts
	}
});

/** A JSON Schema 2020-12 node: only known keywords, each of the right shape, recursively. */
const KEYWORDS = new Set([
	'$schema',
	'type',
	'title',
	'description',
	'additionalProperties',
	'properties',
	'required',
	'items',
	'enum',
	'const',
	'format',
	'default',
	'minimum',
	'maximum',
	'exclusiveMinimum'
]);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const schemaProblems = (node: Json, path: string, out: string[] = []): string[] => {
	if (node === true || node === false) return out;
	if (node == null || typeof node !== 'object' || Array.isArray(node))
		return [...out, `${path} is not a schema`];
	for (const [key, value] of Object.entries(node)) {
		if (!KEYWORDS.has(key)) out.push(`${path}.${key} is not a keyword`);
		if (key === 'type' && ![value].flat().every((type) => TYPES.has(String(type))))
			out.push(`${path}.type`);
		if (key === 'properties') {
			if (value == null || typeof value !== 'object' || Array.isArray(value))
				out.push(`${path}.properties`);
			else
				for (const [name, child] of Object.entries(value))
					schemaProblems(child, `${path}.${name}`, out);
		}
		if (key === 'items' || key === 'additionalProperties')
			schemaProblems(value, `${path}.${key}`, out);
		if (key === 'enum' && (!Array.isArray(value) || value.length === 0)) out.push(`${path}.enum`);
		if (key === 'required' && !Array.isArray(value)) out.push(`${path}.required`);
		if (['minimum', 'maximum', 'exclusiveMinimum'].includes(key) && typeof value !== 'number')
			out.push(`${path}.${key}`);
	}
	return out;
};
const propertiesAt = (schema: Json, ...path: string[]): Set<string> => {
	let node = schema as Row | undefined;
	for (const key of path) node = (node?.[key] ?? undefined) as Row | undefined;
	return new Set(Object.keys((node?.properties ?? {}) as Row));
};

/**
 * The payroll engine over the SG law tables and four fixture people (an SPR, and Citizens of the Chinese, Malay-Muslim,
 * Indian and Eurasian communities, so every scheme charges), read through a host-like reader as tests/payroll_engine
 * does. People are fixtures here, never the bank.
 */
const engine = () => {
	const COMPANY = 'c-sg';
	const tables = new Map<string, Row[]>();
	for (const table of TABLES)
		tables.set(
			table,
			versions
				.flatMap((version) => load(version, table))
				.map((item) => ({ approval_id: null, ...structuredClone(item) }))
		);
	const people = [
		{
			id: 'p1',
			date_of_birth: '1993-04-18',
			race: 'CHINESE',
			religion: 'OTHER',
			salary: 6500,
			residency: 'PERMANENT_RESIDENT',
			since: '2019-01-01'
		},
		{
			id: 'p2',
			date_of_birth: '1965-11-02',
			race: 'MALAY',
			religion: 'ISLAM',
			salary: 9800,
			residency: 'CITIZEN'
		},
		{
			id: 'p3',
			date_of_birth: '1997-06-30',
			race: 'INDIAN',
			religion: 'HINDUISM',
			salary: 4800,
			residency: 'CITIZEN'
		},
		{
			id: 'p4',
			date_of_birth: '1958-09-30',
			race: 'EURASIAN',
			religion: 'CHRISTIANITY',
			salary: 3000,
			residency: 'CITIZEN'
		}
	];
	tables.set('entity', [
		{
			id: COMPANY,
			name: 'Fixture',
			settings_code: 'SG',
			pay_frequency: 'MONTHLY',
			approval_id: null,
			facts: {}
		}
	]);
	tables.set(
		'employment_profile',
		people.map(({ salary: _s, residency: _r, since: _x, ...person }) => ({
			...person,
			name: person.id,
			facts: {}
		}))
	);
	tables.set(
		'employment_contract',
		people.map((person) => ({
			id: `k-${person.id}`,
			employee_id: person.id,
			company_id: COMPANY,
			approval_id: null,
			effective_range: { from: '2019-01-01', to: null },
			facts: {
				contract_terms: [
					{
						base_salary: { value: person.salary, currency: 'SGD' },
						effective_range: { from: '2019-01-01', to: null },
						residency_status: person.residency,
						...(person.since == null ? {} : { residency_since: person.since }),
						work_classification: 'EA_COVERED',
						statutory_work_category: 'NON_MANUAL',
						employment_type: 'PERMANENT',
						allowances: []
					}
				]
			}
		}))
	);
	for (const name of [
		'adhoc_catalog_entry',
		'claim_catalog_entry',
		'leave_catalog_entry',
		'loan_catalog_entry',
		'roster_entry',
		'holiday',
		'payslip',
		'payroll_run',
		'shift_pattern',
		'shift_definition'
	])
		tables.set(name, []);
	const clause = (value: unknown, spec: unknown): boolean => {
		if (spec == null || typeof spec !== 'object') return value === spec;
		return Object.entries(spec as Row).every(([op, operand]) => {
			if (op === 'eq') return value === operand;
			if (op === 'in') return Array.isArray(operand) && operand.includes(value);
			if (op === 'isNull') return operand ? value == null : value != null;
			if (op === 'gte') return value != null && String(value) >= String(operand);
			if (op === 'lte') return value != null && String(value) <= String(operand);
			throw new Error(`fixture reader: unsupported operator ${op}`);
		});
	};
	const reads = {
		read: (collection: unknown, query: unknown) => {
			const { where = {}, select } = query as { where?: Row; select?: Row };
			if (select == null)
				throw new Error(`fixture reader: ${String(collection)} read without select`);
			return Effect.succeed({
				rows: (tables.get(String(collection)) ?? [])
					.filter((item) => Object.entries(where).every(([key, spec]) => clause(item[key], spec)))
					.map((item) =>
						Object.fromEntries(
							Object.keys(select)
								.filter((key) => key in item)
								.map((key) => [key, item[key]])
						)
					)
			});
		}
	};
	let runs = 0;
	return {
		tables,
		bonus(period: string, amount: number) {
			const version = versions.find((name) => {
				const range = settingsOf(name).effective_range as { from: string; to: string | null };
				return range.from <= `${period}-01` && (range.to == null || range.to >= `${period}-01`);
			})!;
			tables.get('adhoc_catalog_entry')!.push({
				id: 'bonus-1',
				employment_id: 'k-p2',
				company_id: COMPANY,
				catalog_id: row(version, 'adhoc_catalog', 'bonus').id,
				approval_id: null,
				payslip_id: null,
				occurred_on: `${period}-05`,
				amount
			});
		},
		async run(period: string, kind: PayrollRunKind, sources?: string[]) {
			const plan = await Effect.runPromise(
				buildPayrollRun({
					company_id: COMPANY,
					period,
					kind,
					...(sources == null ? {} : { sources })
				}).pipe(Effect.provideService(Reads, reads))
			);
			const id = `run-${++runs}`;
			tables.get('payroll_run')!.push({ ...plan.run, id });
			for (const slip of plan.payslips) {
				const slipId = `${id}-${slip.employment_id}`;
				tables.get('payslip')!.push({ ...slip, id: slipId, payroll_run_id: id });
				for (const pin of slip.pins) {
					const held = tables.get(pin.collection)!.find((candidate) => candidate.id === pin.id);
					if (held != null) held.payslip_id = slipId;
				}
			}
			return plan;
		}
	};
};

describe('SG public seed', () => {
	it('holds four contiguous, inclusive, cloned settings versions ending open', () => {
		assert.deepEqual(versions, ['version_1', 'version_2', 'version_3', 'version_4']);
		let previous: Row | undefined;
		for (const version of versions) {
			for (const table of TABLES)
				assert.equal(
					existsSync(resolve(LAW, version, `${table}.json`)),
					true,
					`${version}/${table}`
				);
			const rows = load(version, 'jurisdiction_settings');
			assert.equal(rows.length, 1);
			const settings = rows[0]!;
			assert.equal(settings.code, 'SG');
			assert.equal(settings.jurisdiction_code, 'SG');
			assert.equal(typeof settings.sealed_at, 'string');
			assert.equal(settings.voided_at, null);
			assert.deepEqual(settings.payroll, {
				currency: 'SGD',
				timezone: 'Asia/Singapore',
				tax_year_start_month: 1
			});
			const range = settings.effective_range as { from: string; to: string | null };
			// A date period is inclusive both ends (Bolt daterange '[]', engine dayInRange): next from = previous to + 1.
			if (previous == null) {
				assert.equal(range.from, '2025-12-01');
				assert.equal(settings.cloned_from_id, null);
			} else {
				const before = previous.effective_range as { from: string; to: string | null };
				assert.ok(before.to != null && range.from === nextDay(before.to), version);
				assert.equal(settings.cloned_from_id, previous.id);
			}
			assert.ok(range.to == null || range.to >= range.from);
			previous = settings;
		}
		assert.equal((previous!.effective_range as { to: string | null }).to, null);
	});

	it('every row id is unique across versions and every child names its own version', () => {
		const seen = new Set<string>();
		for (const version of versions) {
			const settingsId = settingsOf(version).id;
			for (const table of TABLES)
				for (const item of load(version, table)) {
					assert.equal(typeof item.id, 'string');
					assert.equal(seen.has(String(item.id)), false, `${version} ${table} ${item.id}`);
					seen.add(String(item.id));
					if (table !== 'jurisdiction_settings')
						assert.equal(item.settings_id, settingsId, `${version} ${table} ${item.code}`);
				}
		}
	});

	it('every row key is a field of its model and every enum value is declared', () => {
		for (const table of TABLES) {
			const fields = modelFields(table);
			for (const version of versions)
				for (const item of load(version, table))
					for (const [key, value] of Object.entries(item)) {
						assert.ok(LINK_KEYS.has(key) || key in fields, `${version} ${table}.${key}`);
						const values = fields[key]?.values;
						if (fields[key]?.kind === 'enum' && values != null && value != null)
							assert.ok(values.includes(String(value)), `${version} ${table}.${key}=${value}`);
					}
		}
		// rule_set.rules is a record; scalar rules are wrapped as { value }.
		for (const version of versions)
			for (const item of load(version, 'rule_set'))
				assert.ok(
					item.rules != null && typeof item.rules === 'object' && !Array.isArray(item.rules),
					`${version} rule_set ${item.code}`
				);
	});

	it('catalogue codes are the same in every version', () => {
		for (const table of TABLES.filter((name) => name !== 'jurisdiction_settings')) {
			const key = (item: Row) => `${item.family ?? ''}/${item.code}`;
			const first = load(versions[0]!, table).map(key).toSorted();
			for (const version of versions)
				assert.deepEqual(load(version, table).map(key).toSorted(), first, `${version} ${table}`);
		}
	});

	it('every CEL expression parses', () => {
		for (const version of versions)
			for (const table of TABLES)
				for (const item of load(version, table))
					for (const [path, expression] of celOf(item, `${table}:${item.code ?? item.id}`))
						assert.doesNotThrow(() => configuredProgram(expression), `${version} ${path}`);
	});

	it('work, allowance, claim, adhoc and loan CEL evaluates on the payroll context', () => {
		const employment = {
			classification: 'EA_COVERED',
			service_months: 40,
			exit_date: '2026-08-31',
			exit_ground: 'RETIREMENT',
			exit_facts: { eap_decision: 'AWARD', eap_gross_monthly: 3000 }
		};
		const payroll = {
			...subject({ employment, employee: { date_of_birth: '1962-03-15' } }),
			rules: {},
			period: {
				key: '2026-03',
				from: '2026-03-01',
				to: '2026-03-31',
				days: 31,
				paid_days: 31,
				working_days: 22,
				covered_working_days: 22
			},
			work: { overtime_hours: 4, incentive_hours: 2, dates: [], holidays: [] },
			leave: {
				rows: [
					{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 1, is_npl: true, can_encash: false },
					{ code: 'ANNUAL_LEAVE', activity: 'ENCASHMENT', days: 2, is_npl: false, can_encash: true }
				]
			}
		};
		// Facts an entry of each class carries; the engine merges them into `entry`.
		const facts: Record<string, Row> = {
			DIRECTOR_GENERAL_MEETING_FEE: { general_meeting_voted: true, general_meeting_ref: 'AGM-1' },
			MEDICAL_TREATMENT_REIMBURSEMENT: {
				amount_incurred: 120,
				patient: 'EMPLOYEE',
				practitioner_qualified: true,
				treatment: 'MEDICAL',
				treatment_necessary: true,
				solely_aesthetic: false
			},
			PER_DIEM_OFFICIAL_REIMBURSEMENT: {
				official_purpose: true,
				actual_expenditure: 100,
				purpose_reference: 'TRIP-1'
			},
			...Object.fromEntries(
				[
					'ADOPTION_REIMBURSEMENT',
					'GPML_REIMBURSEMENT',
					'GPPL_REIMBURSEMENT',
					'GPSPL_REIMBURSEMENT',
					'GPCL_REIMBURSEMENT'
				].map((code) => [
					code,
					{ service_months: 12, cdca_original_statutory_origin: 'S9_1A_II_B' }
				])
			)
		};
		const entry = (code: string, amount = 100, quantity = 1) => ({
			...payroll,
			entry: {
				amount,
				quantity,
				occurred_on: '2026-03-10',
				due_on: '2026-03-10',
				incurred_on: '2026-03-05',
				facts: facts[code] ?? {},
				...(facts[code] ?? {})
			},
			earlier: { rows: [], calendar_year: 0, lifetime: 0 }
		});
		for (const version of versions) {
			const work = Object.fromEntries(
				load(version, 'work_catalog').map((item) => [
					item.code,
					// As the run prices a work line: quantity and rate only once eligibility holds.
					evaluateConfigured(String(item.eligibility), payroll) === true
						? ['eligibility', 'quantity', 'rate'].map((field) =>
								evaluateConfigured(String(item[field]), payroll)
							)
						: [false]
				])
			);
			assert.deepEqual(work.BASIC, [true, 1, 5000]);
			// EA s.38(4)/(8): 1.5 × 12 × min(basic, 2,250) ÷ 2,288 for a non-workman.
			assert.deepEqual(work.OVERTIME, [true, 4, (1.5 * 2250 * 12) / 2288]);
			assert.deepEqual(work.NO_PAY_LEAVE, [true, 1, 5000 / 22]);
			assert.deepEqual(work.ENCASHMENT, [true, 2, 5000 / 22]);
			assert.deepEqual(work.HOLIDAY_WORK, [false]);
			for (const item of load(version, 'allowance_catalog'))
				assert.equal(typeof evaluateConfigured(String(item.eligibility), payroll), 'boolean');
			for (const table of ['claim_catalog', 'adhoc_catalog', 'loan_catalog'])
				for (const item of load(version, table)) {
					const context = entry(String(item.code));
					for (const field of ['eligibility', 'qualifies_when'])
						if (typeof item[field] === 'string' && String(item[field]).trim() !== '')
							assert.equal(
								evaluateConfigured(String(item[field]), context),
								// A class given the facts it names qualifies; the rest only need to answer true or false.
								facts[String(item.code)] == null
									? Boolean(evaluateConfigured(String(item[field]), context))
									: true,
								`${version} ${table} ${item.code}.${field}`
							);
					for (const band of (item.bands ?? []) as Band[]) {
						if (band.when.trim() !== '')
							assert.equal(evaluateConfigured(band.when, context), true, `${item.code}`);
						if (item.code !== 'EMPLOYMENT_ASSISTANCE_PAYMENT')
							assert.equal(evaluateConfigured(band.amount, context), 100, `${item.code}`);
					}
				}
			// CDCA reimbursement: at most SGD 2,500 a week of leave, the claim's quantity being its weeks.
			const gpml = String(row(version, 'claim_catalog', 'GPML_REIMBURSEMENT').qualifies_when);
			assert.deepEqual(
				[
					[2500, 1],
					[2500.01, 1],
					[20000, 8],
					[20000.01, 8]
				].map(([amount, weeks]) =>
					evaluateConfigured(gpml, entry('GPML_REIMBURSEMENT', amount, weeks))
				),
				[true, false, true, false]
			);
		}
	});

	it('public holiday work pays an extra day at the daily basic rate', () => {
		for (const version of versions) {
			const item = row(version, 'work_catalog', 'HOLIDAY_WORK');
			const at = (facts: Row, holidays: Row[], terms: Row = {}) => {
				const context = {
					...subject({ employee: { facts }, terms: { base_salary: 5200, ...terms } }),
					work: { overtime_hours: 0, incentive_hours: 0, dates: ['2026-03-10'], holidays }
				};
				return evaluateConfigured(String(item.eligibility), context) === true
					? ['eligibility', 'quantity', 'rate'].map((field) =>
							evaluateConfigured(String(item[field]), context)
						)
					: [false];
			};
			const holiday = {
				date: '2026-03-10',
				kind: 'PUBLIC_HOLIDAY',
				given_to: 'EVERYONE',
				replaces: ''
			};
			// 12 × 5,200 ÷ (52 × 5) = 240 a day.
			assert.deepEqual(at({ working_days_per_week: 5 }, [holiday]), [true, 1, 240]);
			assert.deepEqual(
				at({ working_days_per_week: 5.5 }, [holiday, { ...holiday, kind: 'SUBSTITUTE' }]),
				[true, 2, (12 * 5200) / (52 * 5.5)]
			);
			assert.equal(at({}, [holiday])[0], false);
			assert.equal(at({ working_days_per_week: 5 }, [])[0], false);
			assert.equal(
				at({ working_days_per_week: 5 }, [holiday], { employment_type: 'PART_TIME' })[0],
				false
			);
		}
	});

	it('the Employment Assistance Payment evaluates on the exit facts', () => {
		for (const version of versions) {
			const item = row(version, 'adhoc_catalog', 'EMPLOYMENT_ASSISTANCE_PAYMENT');
			const amount = (item.bands as Band[])[0]!.amount;
			const at = (birth: string, exit: string, exit_facts: Row, terms: Row = {}) => {
				const context = {
					...subject({
						employee: { date_of_birth: birth },
						employment: { exit_date: exit, exit_ground: 'RETIREMENT', exit_facts },
						terms
					}),
					entry: { amount: 0, quantity: 1, facts: {} }
				};
				const eligible = evaluateConfigured(String(item.eligibility), context);
				return eligible === true ? evaluateConfigured(amount, context) : eligible;
			};
			const award = { eap_decision: 'AWARD', eap_gross_monthly: 3000 };
			// Born 1962-03: 64y5m on 1 Sep 2026, between retirement (63, cohort 1960-07 – 1963-06) and re-employment (69):
			// the regular guide, 3.5 × 3,000, inside 6,250–14,750.
			assert.equal(at('1962-03-15', '2026-08-31', award), 10500);
			// 66y on the day after exit: the stepped-down guide, 2 × 3,000 inside 4,000–8,500.
			assert.equal(at('1960-08-15', '2026-08-31', award), 6000);
			// A part-time employee's bounds pro-rate by weekly hours: 3.5 × 1,200 = 4,200 against a 6,250 × 20/40 floor.
			assert.equal(
				at(
					'1962-03-15',
					'2026-08-31',
					{
						eap_decision: 'AWARD',
						eap_gross_monthly: 1200,
						eap_prorate_bounds: true,
						eap_weekly_hours: 20,
						eap_fulltime_weekly_hours: 40
					},
					{ employment_type: 'PART_TIME' }
				),
				4200
			);
			assert.equal(at('1962-03-15', '2026-08-31', { eap_decision: 'NOT_AWARDED' }), false);
			assert.equal(at('1962-03-15', '2026-08-31', {}), false);
			assert.equal(at('1980-01-01', '2026-08-31', award), false);
			assert.equal(at('1962-03-15', '2026-08-31', award, { residency_status: 'FOREIGNER' }), false);
		}
	});

	it('the behaviours plan a REGULAR and an OFF_CYCLE run and pin only committed runs', () => {
		for (const version of versions) {
			const behaviours = settingsOf(version).behaviours as unknown as Behaviours;
			for (const kind of ['REGULAR', 'OFF_CYCLE'])
				assert.ok(
					planBehaviours(
						behaviours,
						{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
						{ event: { data: { request: { kind, period: '2026-03' } } } }
					).some((rule) => rule.id === 'payroll-run')
				);
			const pin = (behaviours as unknown as { rules: { id: string; when?: string }[] }).rules.find(
				(rule) => rule.id === 'pin-settled-entries'
			);
			assert.equal(evaluateConfigured(pin!.when!, { event: { row: { approval_id: null } } }), true);
			assert.equal(evaluateConfigured(pin!.when!, { event: { row: { approval_id: 'a' } } }), false);
		}
	});

	it('CPF charges the First Schedule exactly in every version, cent by cent across the graduated band', () => {
		for (const version of versions)
			for (const [table, since] of [
				[SC[version]!, null],
				[PR1, '2025-09-15'],
				[PR2, '2024-09-15']
			] as const)
				AGES.forEach((age, band) => {
					const person = {
						age,
						residency_status: since == null ? 'CITIZEN' : 'PERMANENT_RESIDENT',
						residency_since: since
					};
					for (let cents = 0; cents <= 900000; cents += cents >= 50000 && cents < 76000 ? 7 : 997)
						assert.deepEqual(
							charge(version, 'CPF', cents / 100, person),
							cpfExact(table[band]!, cents),
							`${version} ${person.residency_status} ${since} age ${age} wage ${cents / 100}`
						);
				});
	});

	it('an SPR jointly elected to full rates pays Table 1 in the first two years', () => {
		for (const version of versions)
			for (const since of ['2025-09-15', '2024-09-15'])
				AGES.forEach((age, band) => {
					const person = { age, residency_status: 'PERMANENT_RESIDENT', residency_since: since };
					for (const cents of [40000, 60000, 500000]) {
						assert.deepEqual(
							charge(version, 'CPF', cents / 100, person, '2026-03-01', { spr_full_rates: true }),
							cpfExact(SC[version]![band]!, cents),
							`${version} ${since} age ${age} wage ${cents / 100}`
						);
						assert.deepEqual(
							charge(version, 'CPF', cents / 100, person, '2026-03-01', { spr_full_rates: false }),
							cpfExact((since === '2025-09-15' ? PR1 : PR2)[band]!, cents)
						);
					}
				});
	});

	it('CPF ceilings, refusals and the foreigner exclusion', () => {
		/** The CPF record's assessable parts for one month, as the engine evaluates them. */
		const assessable = (
			version: string,
			month: { ordinary: number; additional: number },
			facts: { month?: number; salary_paid?: boolean; monthly_wage?: number; year?: number } = {}
		) => {
			const parts = configuration(version, 'CPF').assessable!;
			const context = {
				wage: month,
				month,
				year: { ordinary: facts.year ?? 0, additional: 0 },
				period: { month: facts.month ?? 3, salary_paid: facts.salary_paid ?? false },
				terms: { monthly_wage: facts.monthly_wage ?? month.ordinary }
			};
			return [
				evaluateConfigured(parts.ordinary!, context),
				evaluateConfigured(parts.additional!, context)
			];
		};
		// OW ceiling 7,400 then 8,000 from January 2026.
		assert.deepEqual(assessable('version_1', { ordinary: 9000, additional: 0 }), [7400, 0]);
		for (const version of ['version_2', 'version_3', 'version_4'])
			assert.deepEqual(assessable(version, { ordinary: 9000, additional: 0 }), [8000, 0]);
		for (const version of versions) {
			const ceiling = version === 'version_1' ? 7400 : 8000;
			// A March bonus before any salary: 102,000 − capped OW projected over March–December.
			assert.deepEqual(
				assessable(version, { ordinary: 0, additional: 50000 }, { monthly_wage: 10000 }),
				[0, 102000 - ceiling * 10]
			);
			// December, salary paid, 11 months already charged at the ceiling.
			assert.deepEqual(
				assessable(
					version,
					{ ordinary: 10000, additional: 50000 },
					{ month: 12, salary_paid: true, year: ceiling * 11 }
				),
				[ceiling, 102000 - ceiling * 12]
			);
			// The age basis is the previous month's last day: the band moves the month after the birthday.
			const age = configuration(version, 'CPF').person!.age!;
			const on = (birth: string) =>
				evaluateConfigured(age, {
					employee: { date_of_birth: birth },
					period: { from: '2026-03-01' }
				});
			assert.deepEqual([on('1971-02-10'), on('1971-03-01'), on('')], [55, 54, null]);
		}
		// The 2027 senior step's graduated band: 16.5% × 700 + 0.57 × 200 = 229.5 → 230; employee 114 (not 113.99…).
		assert.deepEqual(charge('version_4', 'CPF', 700, { age: 57, residency_status: 'CITIZEN' }), {
			employee: 114,
			employer: 116
		});
		assert.equal(
			charge('version_2', 'CPF', 5000, { age: 30, residency_status: 'FOREIGNER' }),
			null
		);
		assert.equal(
			charge('version_2', 'CPF', 5000, { age: null, residency_status: 'CITIZEN' }),
			'REFUSED'
		);
		assert.equal(
			charge('version_2', 'CPF', 5000, { age: 40, residency_status: 'PERMANENT_RESIDENT' }),
			'REFUSED'
		);
	});

	it('SDL and the self-help group funds charge their schedules', () => {
		const citizen = (race: string, religion: string | null = null) => ({
			age: 30,
			residency_status: 'CITIZEN',
			race,
			religion
		});
		for (const version of versions) {
			const sdl = (wage: number) => charge(version, 'SDL', wage, citizen('CHINESE'));
			assert.deepEqual(sdl(500), { employee: 0, employer: 2 });
			assert.deepEqual(sdl(2000), { employee: 0, employer: 5 });
			assert.deepEqual(sdl(4500), { employee: 0, employer: 11.25 });
			assert.deepEqual(sdl(9000), { employee: 0, employer: 11.25 });
			const fund = (code: string, wage: number, person: Row) =>
				(charge(version, code, wage, person) as { employee: number } | null)?.employee ?? 0;
			const chinese = citizen('CHINESE');
			assert.deepEqual(
				[2000, 2000.01, 3500, 5000, 7500, 7500.01].map((w) => fund('CDAC', w, chinese)),
				[0.5, 1, 1, 1.5, 2, 3]
			);
			const eurasian = citizen('EURASIAN');
			assert.deepEqual(
				[1000, 1500, 2500, 4000, 7000, 10000, 10000.01].map((w) => fund('ECF', w, eurasian)),
				[2, 4, 6, 9, 12, 16, 20]
			);
			const muslim = citizen('MALAY', 'ISLAM');
			assert.deepEqual(
				[1000, 2000, 3000, 4000, 6000, 8000, 10000, 10000.01].map((w) => fund('MBMF', w, muslim)),
				[3, 4.5, 6.5, 15, 19.5, 22, 24, 26]
			);
			const indian = citizen('INDIAN');
			assert.deepEqual(
				[1000, 1500, 2500, 4500, 7500, 10000, 15000, 15000.01].map((w) => fund('SINDA', w, indian)),
				[1, 3, 5, 7, 9, 12, 18, 30]
			);
			assert.equal(fund('CDAC', 5000, { ...chinese, residency_status: 'FOREIGNER' }), 0);
		}
	});

	it('statutory leave carries the Employment Act service ladders', () => {
		for (const version of versions) {
			const days = (code: string) =>
				(
					(row(version, 'leave_catalog', code).entitlement as {
						bands: { service_months: number; days: number }[];
					}) ?? { bands: [] }
				).bands.map((band) => [band.service_months, band.days]);
			// EA s.89(1)–(2): outpatient 5/8/11/14 and hospitalisation 15/30/45/60 at 3/4/5/6 months.
			assert.deepEqual(days('SICK_LEAVE'), [
				[6, 14],
				[5, 11],
				[4, 8],
				[3, 5]
			]);
			assert.deepEqual(days('HOSPITALIZATION_LEAVE'), [
				[6, 60],
				[5, 45],
				[4, 30],
				[3, 15]
			]);
			assert.equal(
				row(version, 'leave_catalog', 'SICK_LEAVE').consumes_code,
				'HOSPITALIZATION_LEAVE'
			);
			// EA s.88A(1)–(2) / MOM table: 7 days in the 1st year (pro-rated under 12 months), 8 in the 2nd, +1 a
			// year, 14 from the 8th year (84 completed months).
			const annual = row(version, 'leave_catalog', 'ANNUAL_LEAVE').entitlement as {
				days: string;
				bands: { service_months: number; days: number }[];
			};
			assert.deepEqual(
				[1, 6, 11].map((service_months) =>
					evaluateConfigured(annual.days, { service_months, bands: annual.bands })
				),
				[1, 4, 6]
			);
			assert.deepEqual(
				annual.bands.map((band) => [band.service_months, band.days]),
				[
					[84, 14],
					[72, 13],
					[60, 12],
					[48, 11],
					[36, 10],
					[24, 9],
					[12, 8]
				]
			);
		}
	});

	it('every leave class evaluates on the admission context, the family-event classes by their facts', () => {
		const birth = '2026-03-10';
		const female = { gender: 'FEMALE', marital_status: 'MARRIED' };
		const male = { gender: 'MALE', marital_status: 'MARRIED' };
		const citizenBirth = {
			event_kind: 'BIRTH',
			child_citizenship: 'CITIZEN',
			cdca_birth_on: birth,
			cdca_child_citizen_at_birth: true,
			cdca_citizenship_on: birth,
			cdca_maternity_arrangement: 'A',
			cdca_is_natural_father: true,
			cdca_married_at_conception: true,
			cdca_original_spell_from: birth,
			cdca_original_taking_mode: 'CONTINUOUS',
			cdca_original_ea76_arrangement: 'NONE'
		};
		const adoption = {
			event_kind: 'ADOPTION',
			child_citizenship: 'CITIZEN',
			cdca_adoption_eligibility_on: birth,
			cdca_adoption_application_on: birth,
			cdca_birth_on: '2025-12-01',
			cdca_is_natural_mother: false,
			cdca_child_status_at_application: 'SC',
			cdca_adoption_arrangement: 'A'
		};
		const kids = (...children: Row[]) => children;
		for (const version of versions) {
			const eligible = (
				code: string,
				over: Parameters<typeof subject>[0],
				facts: Row = {},
				on = birth
			) =>
				evaluateConfigured(
					String(row(version, 'leave_catalog', code).eligibility || 'true'),
					admission(over, on, facts)
				);
			// Every class answers true or false for an ordinary employee with no event.
			for (const item of load(version, 'leave_catalog'))
				if (
					String(item.eligibility).trim() !== '' &&
					![
						'MATERNITY_LEAVE',
						'PATERNITY_LEAVE',
						'ADOPTION_LEAVE',
						'SHARED_PARENTAL_LEAVE'
					].includes(String(item.code))
				)
					assert.equal(
						typeof eligible(String(item.code), {}),
						'boolean',
						`${version} ${item.code}`
					);
			// CDCA s.9: a citizen child, arrangement A, 3 months' service before the birth.
			assert.equal(eligible('MATERNITY_LEAVE', { employee: female }, citizenBirth), true);
			assert.equal(eligible('MATERNITY_LEAVE', { employee: male }, citizenBirth), false);
			assert.equal(
				eligible(
					'MATERNITY_LEAVE',
					{ employee: female, employment: { service_months: 2 } },
					citizenBirth
				),
				false
			);
			// The entry day is the event day: a later entry day does not match the recorded birth.
			assert.equal(
				eligible('MATERNITY_LEAVE', { employee: female }, citizenBirth, '2026-04-01'),
				false
			);
			// CDCA ss.12H–12I: a married natural father of a citizen child.
			assert.equal(eligible('PATERNITY_LEAVE', { employee: male }, citizenBirth), true);
			assert.equal(eligible('PATERNITY_LEAVE', { employee: female }, citizenBirth), false);
			// CDCA s.12AA: an adoptive mother of a citizen child under 12 months.
			assert.equal(eligible('ADOPTION_LEAVE', { employee: female }, adoption), true);
			assert.equal(
				eligible(
					'ADOPTION_LEAVE',
					{ employee: female },
					{ ...adoption, cdca_birth_on: '2025-01-01' }
				),
				false
			);
			// CDCA s.12DA: either parent of a citizen child born or adopted.
			assert.equal(eligible('SHARED_PARENTAL_LEAVE', { employee: male }, citizenBirth), true);
			assert.equal(
				eligible(
					'SHARED_PARENTAL_LEAVE',
					{ employee: male },
					{ ...citizenBirth, child_citizenship: 'FOREIGNER' }
				),
				false
			);
			// CDCA s.12B / EA s.87A: a child under 7 (any, EA-covered) or a citizen child under 13.
			const under7 = { child_birthdate: '2022-05-01', relationship: 'CHILD' };
			const citizen10 = {
				child_birthdate: '2016-01-01',
				relationship: 'CHILD',
				citizenship: 'CITIZEN'
			};
			const foreign10 = {
				child_birthdate: '2016-01-01',
				relationship: 'CHILD',
				citizenship: 'FOREIGNER'
			};
			assert.equal(eligible('CHILDCARE_LEAVE', { employee: { children: kids(under7) } }), true);
			assert.equal(eligible('CHILDCARE_LEAVE', { employee: { children: kids(citizen10) } }), true);
			assert.equal(eligible('CHILDCARE_LEAVE', { employee: { children: kids(foreign10) } }), false);
			assert.equal(
				eligible('CHILDCARE_LEAVE', {
					employee: { children: kids(under7) },
					employment: { classification: 'NON_EA' }
				}),
				false
			);
			assert.equal(eligible('CHILDCARE_LEAVE', { employee: { children: kids() } }), false);
			assert.equal(
				eligible('CHILDCARE_LEAVE', {
					employee: { children: kids({ ...under7, child_deathdate: '2024-01-01' }) }
				}),
				false
			);
			// CDCA s.12D: a citizen child under 2.
			const infant = {
				child_birthdate: '2025-06-01',
				relationship: 'CHILD',
				citizenship: 'CITIZEN'
			};
			assert.equal(
				eligible('UNPAID_INFANT_CARE_LEAVE', {
					employee: { children: kids(infant), marital_status: 'MARRIED' }
				}),
				true
			);
			assert.equal(
				eligible('UNPAID_INFANT_CARE_LEAVE', {
					employee: { children: kids(citizen10), marital_status: 'MARRIED' }
				}),
				false
			);
			// Enlistment Act: a male citizen or SPR.
			assert.equal(eligible('NS_LEAVE', { employee: male }), true);
			assert.equal(
				eligible('NS_LEAVE', { employee: male, terms: { residency_status: 'PERMANENT_RESIDENT' } }),
				true
			);
			assert.equal(
				eligible('NS_LEAVE', { employee: male, terms: { residency_status: 'FOREIGNER' } }),
				false
			);
			assert.equal(eligible('NS_LEAVE', { employee: female }), false);
		}
	});

	it('both input schemas are JSON Schema 2020-12 in the one layout, and declare every fact the CEL reads', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const employee = settings.employee_input_schema as Json;
			const entity = settings.entity_input_schema as Json;
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal((schema as Row).$schema, 'https://json-schema.org/draft/2020-12/schema');
				assert.equal((schema as Row).type, 'object');
				assert.deepEqual(schemaProblems(schema, `${version} ${name}`), []);
			}
			// The layout the engine reads: terms, exit facts, per-scheme standings, person facts; no profile columns.
			assert.deepEqual([...propertiesAt(employee)].toSorted(), [
				'contract_terms',
				'employment_statutory_facts',
				'exit_facts',
				'facts'
			]);
			assert.deepEqual(
				[...propertiesAt(employee, 'properties', 'employment_statutory_facts', 'items')].toSorted(),
				['effective_range', 'status', 'statutory_contribution_id']
			);
			const status = ['properties', 'employment_statutory_facts', 'items', 'properties', 'status'];
			assert.deepEqual([...propertiesAt(employee, ...status)].toSorted(), ['elections', 'kind']);
			const elections = propertiesAt(employee, ...status, 'properties', 'elections');
			// electionKeysOf reads exactly this path.
			assert.deepEqual(electionKeysOf(employee).toSorted(), [...elections].toSorted());
			const term = propertiesAt(employee, 'properties', 'contract_terms', 'items');
			const person = propertiesAt(employee, 'properties', 'facts');
			const exit = propertiesAt(employee, 'properties', 'exit_facts');
			const company = propertiesAt(entity);
			assert.deepEqual([...company].toSorted(), [
				'cpf_submission_number',
				'foreign_worker_levy_payer',
				'uen'
			]);
			const terms = (((employee as Row).properties as Row).contract_terms as Row).items as Row;
			assert.equal(((terms.properties as Row).currency as Row).const, 'SGD');
			// `terms` keys the engine derives rather than reads from the term.
			const derived = new Set(['monthly_wage']);
			const text = TABLES.map((table) => JSON.stringify(load(version, table))).join('\n');
			const read = (pattern: RegExp) =>
				new Set([...text.matchAll(pattern)].map((match) => match[1]!));
			for (const key of read(/\bterms\.([a-z_]+)/g))
				assert.ok(term.has(key) || derived.has(key), `${version} terms.${key} is declared`);
			for (const key of read(/\bemployee\.facts\.([a-z_]+)/g))
				assert.ok(person.has(key), `${version} employee.facts.${key} is declared`);
			for (const key of read(/\bexit_facts\.([a-z0-9_]+)/g))
				assert.ok(exit.has(key), `${version} exit_facts.${key} is declared`);
			for (const key of read(/\bcompany\.facts\.([a-z_]+)/g))
				assert.ok(company.has(key), `${version} company.facts.${key} is declared`);
			for (const key of read(/\bscheme\.elections\.([a-z_]+)/g))
				assert.ok(elections.has(key), `${version} scheme.elections.${key} is declared`);
			assert.equal(read(/\belections\.[A-Z]+\.([a-z_]+)/g).size, 0);
			// The enums are the values the CEL compares against.
			const values = (key: string) => ((terms.properties as Row)[key] as Row).enum as string[];
			assert.deepEqual(values('residency_status'), ['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER']);
			assert.ok(values('work_classification').includes('NON_EA'));
			assert.ok(values('statutory_work_category').includes('NON_MANUAL'));
			assert.ok(values('employment_type').includes('PART_TIME'));
		}
	});

	/** A hire/exit `due` / `applies_when` context as the v2 rules build it: the contract row, profile and entity. */
	const lifecycle = (
		over: { contract?: Row; employee?: Row | null; company?: Row | null } = {}
	) => ({
		contract: {
			id: 'k1',
			company_id: 'c1',
			employee_id: 'p1',
			approval_id: null,
			effective_range: { from: '2026-03-02', to: '2026-06-30' },
			exit_ground: 'RESIGNATION',
			exit_facts: { notice_served: true },
			...over.contract
		},
		employee:
			over.employee === undefined
				? {
						nationality: 'IN',
						gender: 'MALE',
						date_of_birth: '1990-01-01',
						facts: { immigration_status: 'S_PASS' }
					}
				: over.employee,
		company: over.company === undefined ? { region: '', risk_class: '', facts: {} } : over.company
	});

	it('remittances are OBLIGATIONS, everything else is a TASK, and every due and condition evaluates for its trigger', () => {
		const field = (version: string, code: string, key: string, context: Row) =>
			evaluateConfigured(
				String((row(version, 'rule_set', code).rules as Row)[key]),
				context as Parameters<typeof evaluateConfigured>[1]
			);
		const due = (version: string, code: string, context: Row) =>
			field(version, code, 'due', context);
		const applies = (version: string, code: string, context: Row) =>
			field(version, code, 'applies_when', context);
		// 2026-04-14 is a Tuesday; 2026-05-17 a Sunday; 2027-04-14 a Wednesday.
		const holidays = ['2026-04-03', '2026-05-01', '2026-06-01'];
		const company = { region: '', risk_class: '', facts: {} };
		const march = {
			period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' },
			company,
			holidays
		};
		const april = {
			period: { key: '2026-04', from: '2026-04-01', to: '2026-04-30' },
			company,
			holidays
		};
		const hire = {
			hired_on: '2026-03-02',
			holidays,
			...lifecycle({ contract: { exit_ground: null, exit_facts: null } })
		};
		const exit = { exit_on: '2026-06-30', holidays, headcount: 12, ...lifecycle() };
		// Paid on Thursday 2 April 2026; Good Friday and the weekend do not count.
		const paid = { ...april, row: { id: 's1', status: 'PAID', paid_on: '2026-04-02' } };
		const leaveRow = (facts: Row, days = 5, extra: Row = {}) => ({
			holidays,
			company,
			period: { key: '2026-05', from: '2026-05-01', to: '2026-05-31' },
			row: {
				id: 'l1',
				catalog_code: 'MATERNITY_LEAVE',
				activity: 'TIME_OFF',
				occurred_on: '2026-05-04',
				from: '2026-05-04',
				to: '2026-05-08',
				days,
				facts,
				...extra
			}
		});
		const contextOf = (duty: Row): Row => {
			const trigger = triggerOf(duty);
			if (trigger === 'PAYROLL_RUN') return march;
			if (trigger === 'HIRE') return hire;
			if (trigger === 'EXIT') return exit;
			if (trigger === 'entity.created') return { ...march, row: { id: 'c1', facts: {} } };
			if (trigger === 'payslip.updated') return paid;
			if (trigger === 'calendar.daily')
				return {
					today: '2026-03-02',
					holidays,
					...lifecycle({ employee: { date_of_birth: '1963-09-02', facts: {} } })
				};
			return leaveRow({ event_kind: 'BIRTH', work_accident_on: '2026-05-04' }, 5, {
				catalog_code: 'SICK_LEAVE'
			});
		};
		for (const version of versions) {
			const duties = dutiesOf(load(version, 'rule_set'));
			const obligations = duties.filter((duty) => duty.family === 'OBLIGATIONS');
			assert.deepEqual(
				obligations.map((duty) => duty.code).toSorted(),
				['CPF_MONTHLY_SUBMISSION_AND_PAYMENT', 'SDL_REMITTANCE', 'SHG_DEDUCTION_REMITTANCE'],
				version
			);
			assert.deepEqual(
				obligations.map((duty) => (duty.rules as Row).schemes),
				[['CPF'], ['SDL'], ['CDAC', 'ECF', 'MBMF', 'SINDA']]
			);
			assert.equal(duties.length, 21, version);
			for (const duty of duties) {
				const rules = duty.rules as Row;
				assert.deepEqual(
					Object.keys(rules).filter((key) => !DUTY_KEYS.includes(key)),
					[],
					`${version} ${duty.code}`
				);
				assert.ok(
					String(rules.description).length > 0 && String(rules.authority).length > 0,
					String(duty.code)
				);
				const context = contextOf(duty);
				for (const key of ['when', 'applies_when'])
					if (rules[key] != null)
						assert.equal(
							typeof field(version, String(duty.code), key, context),
							'boolean',
							`${duty.code}.${key}`
						);
				if (duty.code !== 'RETRENCHMENT_NOTIFICATION')
					assert.match(
						String(due(version, String(duty.code), context)),
						/^\d{4}-\d{2}-\d{2}$/,
						String(duty.code)
					);
			}
			// CPF Regulations reg.3 with the CPF Board grace: the 14th, rolled past a weekend or public holiday.
			assert.equal(due(version, 'CPF_MONTHLY_SUBMISSION_AND_PAYMENT', march), '2026-04-14');
			assert.equal(due(version, 'SDL_REMITTANCE', march), '2026-04-14');
			assert.equal(due(version, 'SHG_DEDUCTION_REMITTANCE', april), '2026-05-14');
			assert.equal(due(version, 'FOREIGN_WORKER_LEVY', march), '2026-04-17');
			// 17 May 2026 is a Sunday: the levy rolls to Monday 18 May.
			assert.equal(due(version, 'FOREIGN_WORKER_LEVY', april), '2026-05-18');
			assert.equal(due(version, 'SALARY_PAYMENT_DEADLINE', march), '2026-04-07');
			assert.equal(due(version, 'OVERTIME_PAYMENT_DEADLINE', march), '2026-04-14');
			assert.equal(due(version, 'ITEMISED_PAYSLIP', paid), '2026-04-08');
			assert.equal(
				due(version, 'ANNUAL_EMPLOYMENT_INCOME_RETURN', {
					...march,
					period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' }
				}),
				'2027-03-01'
			);
			assert.equal(
				due(version, 'CHILDCARE_LEAVE_CLAIM', {
					...march,
					period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' }
				}),
				'2027-03-31'
			);
			assert.equal(due(version, 'KEY_EMPLOYMENT_TERMS', hire), '2026-03-16');
			assert.equal(due(version, 'WORK_PASS_IN_FORCE', hire), '2026-03-02');
			assert.equal(due(version, 'TAX_CLEARANCE_AND_WITHHOLDING', exit), '2026-05-30');
			assert.equal(due(version, 'WORK_PASS_CANCELLATION', exit), '2026-07-07');
			assert.equal(due(version, 'FINAL_SALARY_PAYMENT', exit), '2026-06-30');
			assert.equal(
				due(version, 'FINAL_SALARY_PAYMENT', {
					...exit,
					...lifecycle({ contract: { exit_facts: {} } })
				}),
				'2026-07-07'
			);
			// The levy: unless the entity records that it employs no levy-paying pass holder.
			assert.equal(applies(version, 'FOREIGN_WORKER_LEVY', march), true);
			assert.equal(
				applies(version, 'FOREIGN_WORKER_LEVY', {
					...march,
					company: { facts: { foreign_worker_levy_payer: false } }
				}),
				false
			);
			// IR21 for every non-Citizen; the pass duties for a pass holder; an unrecorded status raises them.
			const as = (immigration_status: string | null) => ({
				...exit,
				...lifecycle({
					employee: { facts: immigration_status == null ? {} : { immigration_status } }
				})
			});
			for (const [status, ir21, pass] of [
				['CITIZEN', false, false],
				['PERMANENT_RESIDENT', true, false],
				['EMPLOYMENT_PASS', true, true],
				[null, true, true]
			] as const) {
				assert.equal(
					applies(version, 'TAX_CLEARANCE_AND_WITHHOLDING', as(status)),
					ir21,
					`${status}`
				);
				assert.equal(applies(version, 'WORK_PASS_CANCELLATION', as(status)), pass, `${status}`);
				assert.equal(
					applies(version, 'WORK_PASS_IN_FORCE', { ...hire, ...as(status) }),
					pass,
					`${status}`
				);
			}
			// MOM retrenchment notification: 5 working days after the notice (Mon 4 May 2026 → Mon 11 May), ≥ 10 employees.
			const retrenched = (headcount: number) => ({
				...exit,
				headcount,
				...lifecycle({
					contract: {
						exit_ground: 'RETRENCHMENT',
						exit_facts: { retrenchment_notified_on: '2026-05-04' }
					},
					company: { facts: {} }
				})
			});
			assert.equal(applies(version, 'RETRENCHMENT_NOTIFICATION', retrenched(10)), true);
			assert.equal(due(version, 'RETRENCHMENT_NOTIFICATION', retrenched(10)), '2026-05-11');
			assert.equal(applies(version, 'RETRENCHMENT_NOTIFICATION', retrenched(9)), false);
			// GPL claim: 3 months after the spell's last day, for a family-event leave only.
			assert.equal(
				field(version, 'GOVERNMENT_PAID_LEAVE_CLAIM', 'when', leaveRow({ event_kind: 'BIRTH' })),
				true
			);
			assert.equal(
				field(
					version,
					'GOVERNMENT_PAID_LEAVE_CLAIM',
					'when',
					leaveRow({}, 5, { catalog_code: 'ANNUAL_LEAVE' })
				),
				false
			);
			assert.equal(
				due(version, 'GOVERNMENT_PAID_LEAVE_CLAIM', leaveRow({ event_kind: 'BIRTH' })),
				'2026-08-08'
			);
			// Work accident: raised by a medical leave entry recording the accident; 4 days of MC, or a fatality.
			const accident = (days: number, facts: Row = {}) =>
				leaveRow({ work_accident_on: '2026-05-02', ...facts }, days, {
					catalog_code: 'SICK_LEAVE'
				});
			assert.equal(field(version, 'WORK_ACCIDENT_REPORT', 'when', accident(4)), true);
			assert.equal(field(version, 'WORK_ACCIDENT_REPORT', 'when', leaveRow({}, 4)), false);
			assert.equal(applies(version, 'WORK_ACCIDENT_REPORT', accident(3)), false);
			assert.equal(applies(version, 'WORK_ACCIDENT_REPORT', accident(4)), true);
			assert.equal(due(version, 'WORK_ACCIDENT_REPORT', accident(4)), '2026-05-12');
			assert.equal(
				due(version, 'WORK_ACCIDENT_REPORT', accident(4, { accident_notified_on: '2026-05-05' })),
				'2026-05-15'
			);
			// CSN: raised for an entity created without one; the first CPF deadline of its first month.
			const entity = (facts: Row) => ({ ...march, company: { facts }, row: { id: 'c1', facts } });
			assert.equal(applies(version, 'CPF_SUBMISSION_NUMBER', entity({})), true);
			assert.equal(
				applies(
					version,
					'CPF_SUBMISSION_NUMBER',
					entity({ cpf_submission_number: '201912345A-PTE-01' })
				),
				false
			);
			assert.equal(due(version, 'CPF_SUBMISSION_NUMBER', entity({})), '2026-04-14');
		}
	});

	it('the canonical behaviours raise the remittances with their run amounts and the tasks on their trigger rows', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = settings.behaviours as unknown as Behaviours;
			const rows = load(version, 'rule_set');
			const raise = (collection: string, event: string, row: Row, extra: Row = {}) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection,
					event,
					row,
					...extra
				});
			const codes = (writes: Row[]) => writes.map((write) => String(write.duty_code)).toSorted();
			const run = (period: string) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r1', company_id: 'c1', period, approval_id: null },
					{
						run: {
							totals: {
								gross: 10000,
								net: 8000,
								employer_cost: 11700,
								schemes: {
									CPF: { employee: 2000, employer: 1700 },
									SDL: { employee: 0, employer: 11.25 },
									CDAC: { employee: 3, employer: 0 }
								}
							}
						}
					}
				);
			const march = run('2026-03');
			const due = (writes: Row[], code: string) => writes.find((write) => write.duty_code === code);
			assert.equal(due(march, 'CPF_MONTHLY_SUBMISSION_AND_PAYMENT')!.amount_due, 3700);
			assert.equal(due(march, 'SDL_REMITTANCE')!.amount_due, 11.25);
			assert.equal(due(march, 'SHG_DEDUCTION_REMITTANCE')!.amount_due, 3);
			const payrollTasks = dutiesOf(rows)
				.filter((duty) => duty.family === 'TASKS' && triggerOf(duty) === 'PAYROLL_RUN')
				.map((duty) => String(duty.code));
			assert.deepEqual(
				codes(march).filter((code) => payrollTasks.includes(code)),
				payrollTasks
					.filter(
						(code) => !['ANNUAL_EMPLOYMENT_INCOME_RETURN', 'CHILDCARE_LEAVE_CLAIM'].includes(code)
					)
					.toSorted()
			);
			assert.ok(codes(run('2026-12')).includes('ANNUAL_EMPLOYMENT_INCOME_RETURN'));
			assert.ok(codes(run('2026-12')).includes('CHILDCARE_LEAVE_CLAIM'));
			// A contract created and one closed: the hire and exit tasks for a pass holder, none of the pass duties for a Citizen.
			const contract = {
				id: 'k1',
				company_id: 'c1',
				employee_id: 'p1',
				approval_id: null,
				effective_range: { from: '2026-03-02', to: null },
				exit_ground: null,
				exit_facts: null
			};
			const person = (immigration_status: string) => ({
				employee: [
					{
						nationality: '',
						gender: 'FEMALE',
						date_of_birth: '1990-01-01',
						facts: { immigration_status }
					}
				]
			});
			assert.deepEqual(
				codes(raise('employment_contract', 'created', contract, { reads: person('S_PASS') })),
				[
					'KEY_EMPLOYMENT_TERMS',
					'PDPA_CONSENT_PURPOSE_NOTIFICATION',
					'WORK_INJURY_COMPENSATION_INSURANCE',
					'WORK_PASS_IN_FORCE'
				]
			);
			const left = {
				...contract,
				effective_range: { from: '2026-03-02', to: '2026-06-30' },
				exit_ground: 'RESIGNATION',
				exit_facts: { notice_served: true }
			};
			const exits = (immigration_status: string) =>
				codes(
					raise('employment_contract', 'updated', left, {
						reads: { ...person(immigration_status), catalogues: [], movements: [] }
					})
				);
			assert.deepEqual(exits('WORK_PERMIT'), [
				'FINAL_SALARY_PAYMENT',
				'TAX_CLEARANCE_AND_WITHHOLDING',
				'WORK_PASS_CANCELLATION'
			]);
			assert.deepEqual(exits('CITIZEN'), ['FINAL_SALARY_PAYMENT']);
			// A family-event leave spell raises its GPL claim; an entity without a CSN raises the registration.
			assert.deepEqual(
				codes(
					raise('leave_catalog_entry', 'created', {
						id: 'l1',
						company_id: 'c1',
						employment_id: 'k1',
						approval_id: null,
						activity: 'TIME_OFF',
						occurred_on: '2026-05-04',
						to: '2026-08-23',
						days: 80,
						catalog_code: 'MATERNITY_LEAVE',
						facts: { event_kind: 'BIRTH' }
					})
				),
				['GOVERNMENT_PAID_LEAVE_CLAIM']
			);
			assert.deepEqual(
				codes(raise('entity', 'created', { id: 'c1', approval_id: null, facts: {} })),
				['CPF_SUBMISSION_NUMBER']
			);
			// Already raised: nothing again.
			assert.equal(
				raise('employment_contract', 'updated', left, {
					raisedAll: true,
					reads: person('WORK_PERMIT')
				}).length,
				0
			);
		}
	});

	it('untaken annual leave is encashed on exit except on a dismissal for misconduct', () => {
		for (const version of versions) {
			const behaviours = settingsOf(version).behaviours as unknown as Behaviours;
			const encashes = (exit_ground: string, exit_facts: Row) =>
				planBehaviours(
					behaviours,
					{ kind: 'row', collection: 'employment_contract', event: 'updated' },
					{
						event: {
							row: {
								id: 'k1',
								approval_id: null,
								exit_ground,
								exit_facts,
								effective_range: { from: '2020-01-01', to: '2026-06-30' }
							}
						}
					}
				).some((rule) => rule.id === 'encash-leave-on-exit');
			assert.equal(encashes('RESIGNATION', {}), true);
			assert.equal(encashes('DISMISSAL', { dismissed_for_misconduct: false }), true);
			assert.equal(encashes('DISMISSAL', {}), true);
			assert.equal(encashes('DISMISSAL', { dismissed_for_misconduct: true }), false);
		}
	});

	it('leave windows and caps: service-year EA leave, per-event family leave, calendar-year childcare', () => {
		for (const version of versions) {
			const ent = (code: string) => row(version, 'leave_catalog', code).entitlement as Row;
			assert.equal(ent('ANNUAL_LEAVE').window, 'SERVICE_YEAR');
			assert.equal(ent('SICK_LEAVE').window, 'SERVICE_YEAR');
			assert.equal(ent('HOSPITALIZATION_LEAVE').window, 'SERVICE_YEAR');
			const days = (
				code: string,
				over: Parameters<typeof subject>[0] = {},
				entry: Row = { facts: {} },
				taken: Row = {}
			) =>
				evaluateConfigured(String(ent(code).days), {
					...subject({ employment: { start_date: '2020-01-01', service_months: 75 }, ...over }),
					service_months: 75,
					bands: [],
					as_of: '2026-04-15',
					entry,
					taken: { calendar_year: 0, service_year: 0, lifetime: 0, event: 0, ...taken }
				});
			for (const [code, weeks] of [
				['MATERNITY_LEAVE', 16],
				['PATERNITY_LEAVE', 4],
				['ADOPTION_LEAVE', 12]
			] as const) {
				assert.equal(ent(code).window, 'EVENT');
				assert.equal(days(code, { employee: { facts: { working_days_per_week: 5 } } }), weeks * 5);
				assert.equal(days(code), weeks * 7);
			}
			// As of April 2026 (start 2020-01 + 75 months): a citizen child under 7 → 6; plus extended childcare for a
			// citizen child 7–12, capped at 6 combined; a non-citizen child under 7 → EA s.87A 2 days.
			const child = (child_birthdate: string, citizenship?: string) => ({
				child_birthdate,
				relationship: 'CHILD',
				...(citizenship == null ? {} : { citizenship })
			});
			assert.equal(ent('CHILDCARE_LEAVE').window, 'EVENT');
			assert.equal(
				days('CHILDCARE_LEAVE', { employee: { children: [child('2022-01-01', 'CITIZEN')] } }),
				6
			);
			assert.equal(
				days('CHILDCARE_LEAVE', { employee: { children: [child('2017-01-01', 'CITIZEN')] } }),
				2
			);
			assert.equal(days('CHILDCARE_LEAVE', { employee: { children: [child('2022-01-01')] } }), 2);
			assert.equal(
				days('CHILDCARE_LEAVE', {
					employee: { children: [child('2022-01-01', 'CITIZEN'), child('2017-01-01', 'CITIZEN')] }
				}),
				6
			);
			assert.equal(days('CHILDCARE_LEAVE', { employee: { children: [] } }), 0);
			assert.equal(
				days('UNPAID_INFANT_CARE_LEAVE', {
					employee: { children: [child('2025-06-01', 'CITIZEN')] }
				}),
				12
			);
			assert.equal(
				days('UNPAID_INFANT_CARE_LEAVE', {
					employee: { children: [child('2022-01-01', 'CITIZEN')] }
				}),
				0
			);
			// One view per child (window_key = child_id): the child's lifetime cap beside the employee's year.
			const kid = { child_id: 'k1', child_birthdate: '2022-01-01', child_citizenship: 'CITIZEN' };
			const under7 = { employee: { children: [child('2022-01-01', 'CITIZEN')] } };
			// 40 of the child's 42 days used in earlier years, none this year: 2 remain for this child.
			assert.equal(
				(days(
					'CHILDCARE_LEAVE',
					under7,
					{ facts: kid },
					{ event: 40, calendar_year: 0 }
				) as number) - 40,
				2
			);
			// 10 used, 4 of the year's 6 used on another child: 2 remain this year.
			assert.equal(
				(days(
					'CHILDCARE_LEAVE',
					under7,
					{ facts: kid },
					{ event: 10, calendar_year: 4 }
				) as number) - 10,
				2
			);
			// The class view: the year's remainder across children.
			assert.equal(days('CHILDCARE_LEAVE', under7, { facts: {} }, { calendar_year: 4 }), 2);
			// A non-citizen child: EA s.87A, 14 a child, 2 a year.
			const foreign = {
				child_id: 'k2',
				child_birthdate: '2022-01-01',
				child_citizenship: 'FOREIGNER'
			};
			assert.equal(
				(days(
					'CHILDCARE_LEAVE',
					{ employee: { children: [child('2022-01-01')] } },
					{ facts: foreign },
					{ event: 13 }
				) as number) - 13,
				1
			);
			// Infant care: 24 a child beside 12 a year.
			const baby = {
				employee: { children: [child('2025-06-01', 'CITIZEN')], marital_status: 'MARRIED' }
			};
			assert.equal(
				(days(
					'UNPAID_INFANT_CARE_LEAVE',
					baby,
					{
						facts: { child_id: 'b1', child_birthdate: '2025-06-01', child_citizenship: 'CITIZEN' }
					},
					{ event: 20 }
				) as number) - 20,
				4
			);
			// Shared parental leave: the parent's allocation within the 6- or 10-week pool, half by default.
			const spl = (entry: Row, over: Parameters<typeof subject>[0] = {}) =>
				days(
					'SHARED_PARENTAL_LEAVE',
					{ employee: { facts: { working_days_per_week: 5 }, ...over.employee } },
					entry
				);
			assert.equal(spl({ occurred_on: '2026-05-01', facts: {} }), 25);
			assert.equal(spl({ occurred_on: '2026-03-01', facts: {} }), 15);
			assert.equal(spl({ occurred_on: '2026-05-01', facts: { spl_weeks_allocated: 7 } }), 35);
			assert.equal(spl({ occurred_on: '2026-05-01', facts: { spl_weeks_allocated: 12 } }), 50);
			assert.equal(
				spl({ occurred_on: '2026-05-01', facts: {} }, { employee: { solo_parent: true } }),
				50
			);
		}
	});

	it('maternity pay fraction: CDCA full pay, the EA s.76 unpaid weeks and half pay on short notice, priced by NO_PAY_LEAVE', () => {
		for (const version of versions) {
			const fraction = String(row(version, 'leave_catalog', 'MATERNITY_LEAVE').pay_fraction);
			const at = (from: string, facts: Row) =>
				evaluateConfigured(fraction, {
					...subject({ employee: { gender: 'FEMALE' } }),
					entry: { facts, ...facts },
					leave: {
						code: 'MATERNITY_LEAVE',
						activity: 'TIME_OFF',
						days: 5,
						from,
						to: from,
						facts,
						event_id: 'b1',
						month_index: 1
					}
				});
			assert.equal(at('2026-03-10', {}), 1);
			assert.equal(at('2026-03-10', { cdca_original_statutory_origin: 'S9_1_A' }), 1);
			// EA s.76 (non-citizen child, two or more living children from earlier confinements): unpaid.
			const ea = {
				cdca_original_statutory_origin: 'EA76_A',
				cdca_original_absence_from: '2026-03-01',
				ea_maternity_prior_living_children: 1
			};
			assert.equal(at('2026-03-10', ea), 1);
			assert.equal(at('2026-05-01', ea), 0); // the ninth week
			assert.equal(
				at('2026-03-10', {
					...ea,
					ea_maternity_prior_living_children: 2,
					ea_maternity_prior_confinements_with_living_children: 2
				}),
				0
			);
			// Notice short of the 28 days (births from April 2025) without sufficient cause: half pay.
			assert.equal(
				at('2026-03-10', { cdca_original_statutory_origin: 'S9_1_A', cdca_notice_lead_days: 10 }),
				0.5
			);
			assert.equal(
				at('2026-03-10', {
					cdca_original_statutory_origin: 'S9_1_A',
					cdca_notice_lead_days: 10,
					maternity_notice_sufficient_cause: true
				}),
				1
			);
			// NO_PAY_LEAVE deducts the unpaid part of a partially paid row beside no-pay leave.
			const npl = row(version, 'work_catalog', 'NO_PAY_LEAVE');
			const context = {
				...subject({ terms: { base_salary: 3100, monthly_wage: 3100 } }),
				// s.20A: a day is the monthly rate over the month's 20 planned working days.
				period: {
					key: '2026-05',
					from: '2026-05-01',
					to: '2026-05-31',
					days: 31,
					paid_days: 31,
					working_days: 20,
					covered_working_days: 20
				},
				leave: {
					rows: [
						{
							code: 'MATERNITY_LEAVE',
							activity: 'TIME_OFF',
							days: 5,
							is_npl: false,
							pay_fraction: 0.5
						},
						{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 1, is_npl: true, pay_fraction: 1 },
						{ code: 'ANNUAL_LEAVE', activity: 'TIME_OFF', days: 2, is_npl: false, pay_fraction: 1 }
					]
				}
			};
			assert.deepEqual(
				['eligibility', 'quantity', 'rate'].map((key) =>
					evaluateConfigured(String(npl[key]), context)
				),
				[true, 3.5, 155]
			);
		}
	});

	it('an SPR whose employer alone elected the full rate pays CPF Tables 4–5 (F/G)', () => {
		/** Tables 4–5 per year, [employer rate ≤ $500, employee rate, total rate] per band in basis points. */
		const FG: Record<string, readonly (readonly number[])[][]> = {
			version_1: [
				[
					[1700, 500, 2200],
					[1550, 500, 2050],
					[1200, 500, 1700],
					[900, 500, 1400],
					[750, 500, 1250]
				],
				[
					[1700, 1500, 3200],
					[1550, 1250, 2800],
					[1200, 750, 1950],
					[900, 500, 1400],
					[750, 500, 1250]
				]
			],
			version_2: [
				[
					[1700, 500, 2200],
					[1600, 500, 2100],
					[1250, 500, 1750],
					[900, 500, 1400],
					[750, 500, 1250]
				],
				[
					[1700, 1500, 3200],
					[1600, 1250, 2850],
					[1250, 750, 2000],
					[900, 500, 1400],
					[750, 500, 1250]
				]
			],
			version_4: [
				[
					[1700, 500, 2200],
					[1650, 500, 2150],
					[1300, 500, 1800],
					[900, 500, 1400],
					[750, 500, 1250]
				],
				[
					[1700, 1500, 3200],
					[1650, 1250, 2900],
					[1300, 750, 2050],
					[900, 500, 1400],
					[750, 500, 1250]
				]
			]
		};
		FG.version_3 = FG.version_2!;
		const exact = ([low, ee, total]: readonly number[], cents: number) => {
			const halfUp = (n: number) => Math.floor((2 * n + 1e6) / 2e6);
			const k = ee! * 3; // the 500–750 coefficient is three times the employee rate
			if (cents <= 5000) return { employee: 0, employer: 0 };
			if (cents <= 50000) return { employee: 0, employer: halfUp(low! * cents) };
			if (cents <= 75000) {
				const employee = Math.floor((k * (cents - 50000)) / 1e6);
				return { employee, employer: halfUp(low! * cents + k * (cents - 50000)) - employee };
			}
			const employee = Math.floor((ee! * cents) / 1e6);
			return { employee, employer: halfUp(total! * cents) - employee };
		};
		for (const version of versions)
			for (const [year, since] of [
				[0, '2025-09-15'],
				[1, '2024-09-15']
			] as const)
				[30, 57, 62, 67, 72].forEach((age, band) => {
					const person = { age, residency_status: 'PERMANENT_RESIDENT', residency_since: since };
					for (const cents of [40000, 60000, 74000, 500000])
						assert.deepEqual(
							charge(version, 'CPF', cents / 100, person, '2026-03-01', {
								spr_employer_full_rates: true
							}),
							exact(FG[version]![year]![band]!, cents),
							`${version} year ${year + 1} age ${age} wage ${cents / 100}`
						);
					// Both elections: the joint full rate (Table 1) wins.
					assert.deepEqual(
						charge(version, 'CPF', 5000, person, '2026-03-01', {
							spr_employer_full_rates: true,
							spr_full_rates: true
						}),
						cpfExact(SC[version]![band]!, 500000)
					);
				});
	});

	it('SINDA reaches Citizens, SPRs and Employment Pass holders only; the EAP stops at the oldest covered cohort', () => {
		for (const version of versions) {
			const indian = (residency_status: string, immigration_status?: string) =>
				(
					charge(
						version,
						'SINDA',
						3000,
						{ age: 30, residency_status, race: 'INDIAN', religion: null },
						'2026-03-01',
						{},
						immigration_status
					) as { employee: number } | null
				)?.employee ?? 0;
			assert.equal(indian('CITIZEN'), 7);
			assert.equal(indian('PERMANENT_RESIDENT'), 7);
			assert.equal(indian('FOREIGNER', 'EMPLOYMENT_PASS'), 7);
			assert.equal(indian('FOREIGNER', 'S_PASS'), 0);
			assert.equal(indian('FOREIGNER'), 0);
			const eap = String(
				row(version, 'adhoc_catalog', 'EMPLOYMENT_ASSISTANCE_PAYMENT').eligibility
			);
			const eligible = (birth: string, exit: string) =>
				evaluateConfigured(eap, {
					...subject({
						employee: { date_of_birth: birth },
						employment: {
							exit_date: exit,
							exit_facts: { eap_decision: 'AWARD', eap_gross_monthly: 3000 }
						}
					}),
					entry: { amount: 0, quantity: 1, facts: {} }
				});
			assert.equal(eligible('1958-08-01', '2026-08-31'), true); // 68: the 7-year transitional cohort
			assert.equal(eligible('1958-06-01', '2026-08-31'), false); // born before 1 Jul 1958: past the window
			assert.equal(eligible('1958-08-01', '2026-03-31'), true); // before July 2026: 67, inside 62 to 68
			assert.equal(eligible('1955-06-01', '2026-03-31'), false);
		}
	});

	it('off-cycle bonus before or after the regular run settles the same month totals', async () => {
		const total = (
			plans: {
				payslips: {
					statutory: { scheme_code: string; employee_amount: number; employer_amount: number }[];
				}[];
			}[],
			scheme: string
		) =>
			plans
				.flatMap((plan) => plan.payslips)
				.flatMap((slip) => slip.statutory)
				.filter((line) => line.scheme_code === scheme)
				.reduce((sum, line) => sum + line.employee_amount + line.employer_amount, 0);
		for (const period of ['2025-12', '2026-03', '2026-08', '2027-02']) {
			const before = engine();
			before.bonus(period, 9000);
			const first = [
				await before.run(period, 'OFF_CYCLE', ['bonus-1']),
				await before.run(period, 'REGULAR')
			];
			const after = engine();
			const regular = await after.run(period, 'REGULAR');
			after.bonus(period, 9000);
			const second = [regular, await after.run(period, 'OFF_CYCLE', ['bonus-1'])];
			for (const scheme of ['CPF', 'SDL', 'CDAC', 'ECF', 'MBMF', 'SINDA'])
				assert.equal(
					Math.round(total(first, scheme) * 100),
					Math.round(total(second, scheme) * 100),
					`${period} ${scheme}`
				);
			// The bonus is Additional Wage: CPF on it is charged, so the month total exceeds the salary-only month.
			assert.ok(total(first, 'CPF') > 0);
		}
	});

	it('the SG sample records resolve: every reference names a seeded row and every catalogue code is SG’s', () => {
		const bank = resolve(ROOT, '../../seed_bank/norbital_hr/records');
		const entities = ['norbital', 'opssg'].filter((entity) => existsSync(resolve(bank, entity)));
		if (entities.length === 0) return;
		const read = (entity: string, collection: string): Row[] => {
			const path = resolve(bank, entity, `${collection}.json`);
			return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Row[]) : [];
		};
		const all = (collection: string) => entities.flatMap((entity) => read(entity, collection));
		const ids = (collection: string) => new Set(all(collection).map((item) => String(item.id)));
		const lawIds = (table: string) =>
			new Set(versions.flatMap((version) => load(version, table).map((item) => String(item.id))));
		const teams = ids('sys_team');
		const users = ids('sys_user');
		const companies = ids('entity');
		const profiles = ids('employment_profile');
		const contracts = ids('employment_contract');
		const patterns = ids('shift_pattern');
		const definitions = ids('shift_definition');
		const statutory = lawIds('statutory_contribution_catalog');
		assert.ok(companies.size === entities.length);
		for (const user of all('sys_user'))
			assert.ok(user.team == null || teams.has(String(user.team)), `user ${user.id}`);
		for (const company of all('entity')) assert.equal(company.settings_code, 'SG');
		for (const profile of all('employment_profile')) {
			assert.ok(
				profile.user_id == null || users.has(String(profile.user_id)),
				`profile ${profile.id}`
			);
			const standings = ((profile.facts as Row | undefined)?.employment_statutory_facts ??
				[]) as Row[];
			for (const standing of standings)
				assert.ok(
					statutory.has(String(standing.statutory_contribution_id)),
					`standing ${profile.id}`
				);
		}
		for (const contract of all('employment_contract')) {
			assert.ok(
				profiles.has(String(contract.employee_id)) && companies.has(String(contract.company_id)),
				`contract ${contract.id}`
			);
			for (const term of ((contract.facts as Row).contract_terms ?? []) as Row[])
				assert.ok(
					term.shift_pattern_id == null || patterns.has(String(term.shift_pattern_id)),
					`term ${term.id}`
				);
		}
		for (const pattern of all('shift_pattern')) {
			assert.ok(companies.has(String(pattern.company_id)));
			for (const day of (pattern.pattern as { days: Row[] }).days)
				assert.ok(definitions.has(String(day.roster_code_id)), `pattern ${pattern.id}`);
		}
		for (const collection of ['shift_definition', 'holiday'])
			for (const item of all(collection))
				assert.ok(companies.has(String(item.company_id)), `${collection} ${item.id}`);
		for (const collection of [
			'roster',
			'roster_entry',
			'leave_catalog_entry',
			'claim_catalog_entry',
			'adhoc_catalog_entry',
			'loan_catalog_entry'
		])
			for (const item of all(collection))
				assert.ok(contracts.has(String(item.employment_id)), `${collection} ${item.id}`);
		for (const family of ['leave', 'claim', 'adhoc', 'loan'])
			for (const item of all(`${family}_catalog_entry`))
				assert.ok(lawIds(`${family}_catalog`).has(String(item.catalog_id)), `${family} ${item.id}`);
	});

	it('payslip validations: the IR21 hold on a non-Citizen’s final pay, the 50% deduction limit, the 72-hour overtime warning', async () => {
		for (const period of ['2025-12', '2026-03', '2026-08', '2027-02']) {
			const last =
				String(
					new Date(Date.parse(`${period}-01T00:00:00Z`) + 32 * 86_400_000).toISOString().slice(0, 7)
				) + '-01';
			const end = new Date(Date.parse(`${last}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
			const version = versions.find((name) => {
				const range = settingsOf(name).effective_range as { from: string; to: string | null };
				return range.from <= `${period}-01` && (range.to == null || range.to >= `${period}-01`);
			})!;
			const fixture = engine();
			const contract = (id: string) =>
				fixture.tables.get('employment_contract')!.find((item) => item.id === id)!;
			// The SPR leaves at the month end without a clearance; the Citizen leaves too, unheld.
			contract('k-p1').effective_range = { from: '2019-01-01', to: end };
			contract('k-p4').effective_range = { from: '2019-01-01', to: end };
			// $3,000 of damage recovery on a $4,800 salary: with CPF it passes 50%.
			fixture.tables.get('adhoc_catalog_entry')!.push({
				id: 'damage-1',
				employment_id: 'k-p3',
				company_id: 'c-sg',
				catalog_id: row(version, 'adhoc_catalog', 'DAMAGE_RECOVERY').id,
				approval_id: null,
				payslip_id: null,
				occurred_on: `${period}-10`,
				amount: 2000
			});
			fixture.tables.get('roster_entry')!.push({
				id: 'ot-1',
				employment_id: 'k-p2',
				work_date: `${period}-10`,
				approved_overtime_hours: 80,
				incentive_hours: 0,
				approval_id: null,
				payslip_id: null
			});
			const plan = await fixture.run(period, 'REGULAR');
			const slip = (id: string) => plan.payslips.find((item) => item.employment_id === id)!;
			assert.match(String(slip('k-p1').hold), /tax clearance/, period);
			assert.equal(slip('k-p4').hold, null, period);
			assert.match(String(slip('k-p3').hold), /50%/, period);
			assert.equal(slip('k-p2').hold, null, period);
			assert.ok(
				plan.warnings.some((warning) => /72 hours/.test(warning)),
				period
			);
			// Recorded clearance releases the final pay; the last salary is outside the 50% limit.
			const cleared = engine();
			const held = cleared.tables.get('employment_contract')!.find((item) => item.id === 'k-p1')!;
			held.effective_range = { from: '2019-01-01', to: end };
			held.exit_facts = { ir21_clearance_on: end };
			assert.equal(
				(await cleared.run(period, 'REGULAR')).payslips.find(
					(item) => item.employment_id === 'k-p1'
				)!.hold,
				null
			);
		}
	});

	it('self-help group opt-outs and changed amounts, and the SDL Act s.2 exclusions, read the scheme standing', () => {
		for (const version of versions) {
			const chinese = { age: 30, residency_status: 'CITIZEN', race: 'CHINESE', religion: null };
			const cdac = (elections: Row) =>
				(
					charge(version, 'CDAC', 5000, chinese, '2026-03-01', elections) as {
						employee: number;
					} | null
				)?.employee ?? 0;
			assert.equal(cdac({}), 1.5);
			assert.equal(cdac({ shg_opted_out: true }), 0);
			assert.equal(cdac({ shg_monthly_amount: 10 }), 10);
			const sdl = (elections: Row) =>
				(
					charge(version, 'SDL', 3000, chinese, '2026-03-01', elections) as {
						employer: number;
					} | null
				)?.employer ?? 0;
			assert.equal(sdl({}), 7.5);
			assert.equal(sdl({ sdl_service_scope: 'SINGAPORE_SERVICE' }), 7.5);
			assert.equal(sdl({ sdl_service_scope: 'OUTSIDE_SINGAPORE' }), 0);
			const household = {
				sdl_household_role: 'DOMESTIC_SERVANT',
				sdl_wholly_exclusive: true,
				sdl_nonbusiness: true
			};
			assert.equal(sdl(household), 0);
			assert.equal(sdl({ ...household, sdl_nonbusiness: false }), 7.5);
		}
	});

	it('government-paid leave reimbursements stay within the per-child totals across claims', () => {
		for (const version of versions) {
			const claim = (code: string, amount: number, earlier: number[], facts: Row = {}) =>
				evaluateConfigured(String(row(version, 'claim_catalog', code).qualifies_when), {
					...subject(),
					entry: {
						amount,
						quantity: 8,
						facts: {
							service_months: 12,
							cdca_original_statutory_origin: 'S9_1_A',
							child_id: 'c1',
							...facts
						},
						service_months: 12,
						cdca_original_statutory_origin: 'S9_1_A',
						child_id: 'c1',
						...facts
					},
					earlier: {
						rows: earlier.map((value, index) => ({
							id: `e${index}`,
							amount: value,
							child_id: 'c1'
						})),
						calendar_year: 0,
						lifetime: 0
					}
				});
			assert.equal(claim('GPML_REIMBURSEMENT', 10000, [10000]), true);
			assert.equal(claim('GPML_REIMBURSEMENT', 10000, [10000, 1]), false);
			assert.equal(claim('GPML_REIMBURSEMENT', 20000, [10000, 10000], { child_order: 3 }), true);
			assert.equal(claim('GPML_REIMBURSEMENT', 10000, [10000, 1], { child_id: 'c2' }), true);
			assert.equal(claim('GPPL_REIMBURSEMENT', 5000, [5000]), true);
			assert.equal(claim('GPPL_REIMBURSEMENT', 5000, [5001]), false);
			assert.equal(
				claim('ADOPTION_REIMBURSEMENT', 10000, [10000, 10000], { child_order: 3 }),
				true
			);
			assert.equal(claim('ADOPTION_REIMBURSEMENT', 10000, [10000, 1]), false);
		}
	});

	it('the re-employment offer rises on the daily tick six months before the retirement age, due three months before', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const rows = load(version, 'rule_set');
			const tick = (today: string, date_of_birth: string, immigration_status = 'CITIZEN') =>
				raiseDuties({
					behaviours: settings.behaviours as unknown as Behaviours,
					settings_id: settings.id,
					rows,
					collection: 'calendar',
					event: 'daily',
					row: {
						id: 'k1',
						company_id: 'c1',
						employee_id: 'p1',
						approval_id: null,
						effective_range: { from: '2010-01-01', to: null }
					},
					reads: {
						employee: [
							{ nationality: '', gender: 'MALE', date_of_birth, facts: { immigration_status } }
						]
					},
					day: today
				}).filter((write) => write.duty_code === 'REEMPLOYMENT_OFFER');
			// Born 2 Sep 1963 (main cohort): 64 on 2 Sep 2027; raised 2 Mar 2027, due 2 Jun 2027.
			const raised = tick('2027-03-02', '1963-09-02');
			assert.equal(raised.length, 1, version);
			assert.equal(raised[0]!.due_on, '2027-06-02');
			assert.equal(tick('2027-03-03', '1963-09-02').length, 0);
			// Born 2 Sep 1962: 63 on 2 Sep 2025, raised 2 Mar 2025.
			assert.equal(tick('2025-03-02', '1962-09-02').length, 1);
			assert.equal(tick('2027-03-02', '1963-09-02', 'EMPLOYMENT_PASS').length, 0);
		}
	});

	it('no-pay leave deducts at the monthly gross rate over the month’s working days (EA s.20A); encashment at the gross daily rate', () => {
		for (const version of versions) {
			const work = (code: string) => row(version, 'work_catalog', code);
			const context = (facts: Row) => ({
				...subject({ terms: { base_salary: 5000, monthly_wage: 5500 }, employee: { facts } }),
				period: {
					key: '2026-03',
					from: '2026-03-01',
					to: '2026-03-31',
					days: 31,
					paid_days: 31,
					working_days: 22,
					covered_working_days: 22
				},
				leave: {
					rows: [
						{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 1, is_npl: true, pay_fraction: 1 },
						{
							code: 'ANNUAL_LEAVE',
							activity: 'ENCASHMENT',
							days: 2,
							is_npl: false,
							can_encash: true,
							pay_fraction: 1
						}
					]
				}
			});
			assert.equal(evaluateConfigured(String(work('NO_PAY_LEAVE').rate), context({})), 5500 / 22);
			assert.equal(
				evaluateConfigured(String(work('ENCASHMENT').rate), context({ working_days_per_week: 5 })),
				(12 * 5500) / (52 * 5)
			);
			assert.equal(evaluateConfigured(String(work('ENCASHMENT').rate), context({})), 5500 / 22);
			assert.deepEqual(
				['quantity', 'rate'].map((key) =>
					evaluateConfigured(String(work('BASIC')[key]), context({}))
				),
				[1, 5000]
			);
		}
	});

	it('customer-input pay: rest-day work by who asked (EA s.37), part-time holiday work, and the employer-paid claim weeks', () => {
		for (const version of versions) {
			const price = (code: string, context: Row) => {
				const item = row(version, 'work_catalog', code);
				return evaluateConfigured(String(item.eligibility), context) === true
					? ['quantity', 'rate'].map((key) => evaluateConfigured(String(item[key]), context))
					: null;
			};
			const day = (date: string, day_type: string, worked_hours: number, extra: Row = {}) => ({
				date,
				day_type,
				worked_hours,
				scheduled_hours: day_type === 'WORK' ? 8 : 0,
				overtime_hours: 0,
				...extra
			});
			const at = (facts: Row, days: Row[], terms: Row = {}) => ({
				...subject({ terms: { base_salary: 2600, ...terms }, employee: { facts } }),
				work: { overtime_hours: 0, incentive_hours: 0, dates: [], holidays: [], days }
			});
			const asker = { normal_daily_hours: 8, working_days_per_week: 5 };
			const rest = [day('2026-03-08', 'REST', 3), day('2026-03-15', 'REST', 8)];
			// Employer's request: 1 day for ≤ half the normal hours, 2 for more; employee's: half a day, then 1.
			assert.deepEqual(
				price('REST_DAY_WORK', at({ ...asker, rest_day_work_requester: 'EMPLOYER' }, rest)),
				[3, 120]
			);
			assert.deepEqual(
				price('REST_DAY_WORK', at({ ...asker, rest_day_work_requester: 'EMPLOYEE' }, rest)),
				[1.5, 120]
			);
			assert.equal(price('REST_DAY_WORK', at(asker, rest)), null);
			assert.equal(
				price(
					'REST_DAY_WORK',
					at({ ...asker, rest_day_work_requester: 'EMPLOYER' }, rest, { base_salary: 5000 })
				),
				null
			); // outside Part 4
			// A part-timer on 20 hours a week working a 6-hour public holiday: 6 × 12 × 2,600 ÷ (52 × 20).
			const holiday = [
				day('2026-05-01', 'WORK', 6, { scheduled_hours: 6, holiday_kind: 'PUBLIC_HOLIDAY' })
			];
			assert.deepEqual(
				price(
					'PART_TIME_HOLIDAY_WORK',
					at({ part_time_weekly_hours: 20 }, holiday, { employment_type: 'PART_TIME' })
				),
				[6, 30]
			);
			assert.equal(
				price('PART_TIME_HOLIDAY_WORK', at({}, holiday, { employment_type: 'PART_TIME' })),
				null
			);
			// GPML weeks 1–8 of a 1st or 2nd child are the employer's; a claim starting at week 9 qualifies.
			const claim = (facts: Row) =>
				evaluateConfigured(
					String(row(version, 'claim_catalog', 'GPML_REIMBURSEMENT').qualifies_when),
					{
						...subject(),
						entry: {
							amount: 2500,
							quantity: 1,
							facts: { service_months: 12, cdca_original_statutory_origin: 'S9_1_A', ...facts },
							service_months: 12,
							cdca_original_statutory_origin: 'S9_1_A',
							...facts
						},
						earlier: { rows: [], calendar_year: 0, lifetime: 0 }
					}
				);
			assert.equal(claim({ claim_from_week: 9 }), true);
			assert.equal(claim({ claim_from_week: 3 }), false);
			assert.equal(claim({ claim_from_week: 3, child_order: 3 }), true);
			assert.equal(claim({}), true);
		}
	});

	it('Part 4 annual leave carries one year; the EAP needs 2 years’ service of a hire at 55 or older', () => {
		for (const version of versions) {
			const carry = String(
				(row(version, 'leave_catalog', 'ANNUAL_LEAVE').entitlement as Row).carry_forward
			);
			const cap = (terms: Row) =>
				evaluateConfigured(carry, {
					...subject({ terms }),
					terms,
					service_months: 30,
					bands: [],
					taken: {}
				});
			assert.equal(cap({ statutory_work_category: 'NON_MANUAL', base_salary: 2600 }), 14);
			assert.equal(cap({ statutory_work_category: 'MANUAL_LABOUR', base_salary: 4500 }), 14);
			assert.equal(cap({ statutory_work_category: 'NON_MANUAL', base_salary: 2601 }), 0);
			assert.equal(cap({}), 0);
			const eap = String(
				row(version, 'adhoc_catalog', 'EMPLOYMENT_ASSISTANCE_PAYMENT').eligibility
			);
			const eligible = (start_date: string, service_months: number) =>
				evaluateConfigured(eap, {
					...subject({
						employee: { date_of_birth: '1962-03-15' },
						employment: {
							start_date,
							service_months,
							exit_date: '2026-08-31',
							exit_facts: { eap_decision: 'AWARD', eap_gross_monthly: 3000 }
						}
					}),
					entry: { amount: 0, quantity: 1, facts: {} }
				});
			assert.equal(eligible('2010-01-01', 199), true);
			assert.equal(eligible('2025-01-01', 19), false); // hired at 62, 19 months
			assert.equal(eligible('2024-01-01', 31), true); // hired at 61, 31 months
		}
	});
});
