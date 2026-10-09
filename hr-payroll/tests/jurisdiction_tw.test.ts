/** The TW public lineage: snapshot structure, CEL on the engine's own contexts, and statutory amounts through a run. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { Effect } from 'effect';
import {
	planBehaviours,
	effectWrites,
	type Behaviours
} from '../src/lib/payroll_engine/behaviours.js';
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import { evaluateStrict as evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { electionKeysOf } from '../src/lib/payroll_engine/employment_facts.js';
import { DUTY_KEYS, dutiesOf, raiseDuties, triggerOf, withBalances } from './duties.ts';
import { classFromRow, leaveBalances, movementFromRow } from '../src/lib/payroll_engine/leave.ts';
import { Reads } from '../src/lib/payroll_engine/foundation.js';
import { recordDocuments } from '../src/lib/payroll_engine/export.js';
import {
	admitCase,
	buildPayrollRun,
	rosterFindings,
	type PayrollRunKind
} from '../src/lib/payroll_engine/services.js';

type Row = Record<string, unknown>;
const lineages = resolve(process.cwd(), 'seed/jurisdiction');
const TW = resolve(lineages, 'TW');
const CATALOGS = [
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'allowance_catalog',
	'work_catalog'
];
const FILES = ['jurisdiction_settings', 'rule_set', ...CATALOGS];
const versions = readdirSync(TW)
	.filter((entry) => entry.startsWith('version_'))
	.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const file = (version: string, name: string): Row[] =>
	JSON.parse(readFileSync(resolve(TW, version, `${name}.json`), 'utf8')) as Row[];
const settingsOf = (version: string): Row => file(version, 'jurisdiction_settings')[0]!;
const scheme = (version: string, code: string): Row =>
	file(version, 'statutory_contribution_catalog').find((row) => row.code === code)!;

/** The model's own field names, read from its `+model.ts` (top-level keys of `fields`) plus the seeded FK and id. */
const modelFields = (name: string): Set<string> => {
	const search = (dir: string): string | undefined => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = resolve(dir, entry.name);
			if (entry.name === name) return resolve(path, '+model.ts');
			const found = search(path);
			if (found) return found;
		}
		return undefined;
	};
	const source = readFileSync(search(resolve(process.cwd(), 'src/data/model'))!, 'utf8');
	const body = source.slice(source.indexOf('fields: {') + 'fields: {'.length);
	const keys = new Set(['id', 'settings_id', 'cloned_from_id', 'approval_id']);
	let depth = 0;
	for (const match of body.matchAll(/([{}])|^\t\t([a-z_]+): /gm)) {
		if (match[1] === '{') depth++;
		else if (match[1] === '}') {
			if (depth === 0) break;
			depth--;
		} else if (depth === 0 && match[2]) keys.add(match[2]);
	}
	return keys;
};

/** The CEL subject roots `subjectContext` (services.ts) builds, with a test's overrides merged per root. */
const subject = (
	over: { employee?: Row; employment?: Row; terms?: Row; company?: Row } = {}
): Row => {
	const employment = {
		classification: 'EA_COVERED',
		service_months: 30,
		exit_date: '',
		exit_ground: '',
		exit_facts: {},
		...over.employment
	};
	const employee = {
		gender: 'FEMALE',
		marital_status: '',
		spouse_status: '',
		solo_parent: false,
		disabled: false,
		receiving_pension: false,
		nationality: 'TW',
		date_of_birth: '1990-02-01',
		age: 36,
		children: [],
		dependents_count: 0,
		facts: {},
		...over.employee
	};
	const terms = {
		work_classification: employment.classification,
		statutory_work_category: 'NON_MANUAL',
		employment_type: 'FULL_TIME',
		residency_status: 'CITIZEN',
		residency_since: '',
		base_salary: 45000,
		monthly_wage: 45000,
		allowances: [],
		facts: {},
		...over.terms
	};
	return {
		employee,
		company: { region: '', risk_class: '42', pay_frequency: 'MONTHLY', facts: {}, ...over.company },
		terms,
		employment,
		person: {
			employment,
			race: null,
			religion: null,
			nationality: employee.nationality,
			residency_status: terms.residency_status === '' ? null : terms.residency_status,
			residency_since: terms.residency_since === '' ? null : terms.residency_since
		}
	};
};

type Over = Parameters<typeof subject>[0] & {
	period?: string;
	additional?: number;
	year?: number;
	/** The employee's declared elections per scheme code (`employment_statutory_facts`). */
	elections?: Record<string, Row>;
	/** Days of the month inside the employment (`period.covered_days`); the month's days when unset. */
	covered?: number;
	/** The slip's priced lines (`lines[]`), each a payment. */
	lines?: { code: string; amount: number }[];
	/** This month's earlier charges by scheme (`charged.month`). */
	charged?: Record<string, Row>;
	/** The slip's leave rows (`leave.rows`). */
	leave?: Row[];
};
/** `assessStatutory`'s context for one scheme: the subject, the month's wage parts, the year before, the period. */
const statutoryContext = (ordinary: number, over: Over = {}): Row => {
	const period = over.period ?? '2026-03';
	const additional = over.additional ?? 0;
	const to = String(evaluateConfigured(`month_end("${period}-01")`, {}));
	const days = Number(to.slice(8));
	return {
		...subject({ ...over, terms: { monthly_wage: ordinary, ...over.terms } }),
		wage: { ordinary, additional },
		month: { ordinary, additional },
		year: { ordinary: 0, additional: over.year ?? 0 },
		period: {
			key: period,
			from: `${period}-01`,
			to,
			days,
			month: Number(period.slice(5)),
			salary_paid: false,
			covered_days: over.covered ?? days,
			month_key: period,
			month_from: `${period}-01`,
			month_to: to,
			month_days: days,
			part: 1,
			parts: 1
		},
		base: { ordinary, additional, assessed: ordinary + additional, amount: ordinary + additional },
		rules: {},
		lines: over.lines ?? [],
		leave: { rows: over.leave ?? [] },
		charged: { month: over.charged ?? {}, year: {} },
		elections: over.elections ?? {}
	};
};
/** One scheme's charge exactly as `assessStatutory` evaluates it: person facts, guards, first matching rule. */
const charge = (row: Row, input: Row) => {
	const configuration = row.configuration as {
		person?: Record<string, string>;
		assessment?: string;
		refuse_when?: { when: string; message: string }[];
		rules: { when?: string; employee?: string; employer?: string }[];
	};
	const person: Row = { ...(input.person as Row) };
	for (const [fact, expression] of Object.entries(configuration.person ?? {}))
		person[fact] = evaluateConfigured(expression, input as never);
	const elections = (input.elections ?? {}) as Record<string, Row>;
	const code = String(row.code);
	const context = {
		...input,
		person,
		scheme: {
			code,
			standing: code in elections ? 'REGISTERED' : '',
			elections: elections[code] ?? {}
		}
	} as Row & { base: Row };
	for (const guard of configuration.refuse_when ?? [])
		if (evaluateConfigured(guard.when, context as never) === true) return 'REFUSED';
	for (const rule of configuration.rules) {
		if (rule.when != null && evaluateConfigured(rule.when, context as never) !== true) continue;
		const assessed =
			configuration.assessment == null
				? Number(context.base.assessed)
				: Number(evaluateConfigured(configuration.assessment, context as never));
		const ruled = { ...context, base: { ...context.base, assessed, amount: assessed } };
		return {
			employee:
				rule.employee == null ? 0 : Number(evaluateConfigured(rule.employee, ruled as never)),
			employer:
				rule.employer == null ? 0 : Number(evaluateConfigured(rule.employer, ruled as never))
		};
	}
	return null;
};
/** The annual class's own entitlement CEL: the version keeps it. */
const annualDays = (rows: Row[]) =>
	(rows.find((row) => row.code === 'ANNUAL_LEAVE')!.entitlement as Row).days;
const at = (version: string, code: string, wage: number, over: Over = {}) =>
	charge(scheme(version, code), statutoryContext(wage, over));

const payslipContext = {
	...subject(),
	rules: {},
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
		overtime_hours: 3,
		incentive_hours: 0,
		dates: ['2026-03-10'],
		// A worked holiday (10 March) and one not worked (12 March): only the first earns §39 pay.
		holidays: [
			{
				date: '2026-03-10',
				name: '',
				kind: 'PUBLIC_HOLIDAY',
				day_type: 'WORK',
				worked: true,
				worked_hours: 8
			},
			{
				date: '2026-03-12',
				name: '',
				kind: 'PUBLIC_HOLIDAY',
				day_type: 'WORK',
				worked: false,
				worked_hours: 0
			}
		],
		holiday_dates: ['2026-03-10', '2026-03-12'],
		// One working day with 3 overtime hours, a worked 休息日 (OFF) of 10 hours, a worked 例假 (REST) and a holiday.
		days: [
			['2026-03-10', 'WORK', 'PUBLIC_HOLIDAY', 8, 0],
			['2026-03-11', 'WORK', '', 8, 3],
			['2026-03-12', 'WORK', 'PUBLIC_HOLIDAY', 0, 0],
			['2026-03-14', 'OFF', '', 10, 0],
			['2026-03-15', 'REST', '', 8, 0]
		].map(([date, day_type, holiday_kind, worked_hours, overtime_hours]) => ({
			date,
			day_type,
			shift_code: '',
			holiday_kind,
			holiday_name: '',
			scheduled_hours: day_type === 'WORK' ? 8 : 0,
			worked_hours,
			worked: Number(worked_hours) > 0,
			worksite: '',
			facts: {},
			overtime_hours,
			incentive_hours: 0,
			intervals: []
		}))
	},
	earned: { month: {}, year: {}, previous_month: {}, months: [] },
	hours: { month: {}, previous_month: {}, year: {}, rolling: {}, months: [] },
	leave: {
		rows: [
			{
				code: 'PERSONAL_LEAVE',
				activity: 'TIME_OFF',
				days: 1,
				is_npl: true,
				can_encash: false,
				pay_fraction: 1
			},
			{
				code: 'SICK_LEAVE',
				activity: 'TIME_OFF',
				days: 2,
				is_npl: false,
				can_encash: true,
				pay_fraction: 0.5
			},
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
};
// The month to date (`work.month_days`) is the period itself on a monthly slip.
(payslipContext.work as Row).month_days = payslipContext.work.days;
const entry = (facts: Row) => ({
	amount: 1000,
	quantity: 1,
	occurred_on: '2026-03-10',
	due_on: '2026-03-31',
	incurred_on: '2026-03-10',
	...facts,
	facts
});
const ENTRY_FACTS = {
	average_daily_wage: 1500,
	average_monthly_wage: 45000,
	old_system_service_months: 200,
	event_kind: 'BIRTH'
};
const admission = (over: Parameters<typeof subject>[0] = {}, facts: Row = ENTRY_FACTS) => ({
	...subject(over),
	rules: {},
	entry: { ...entry(facts), days: 1 }
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
	'maximum'
]);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const schemaProblems = (node: unknown, path: string, out: string[] = []): string[] => {
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
		if (['minimum', 'maximum'].includes(key) && typeof value !== 'number')
			out.push(`${path}.${key}`);
	}
	return out;
};
const propertiesAt = (schema: unknown, ...path: string[]): Set<string> => {
	let node = schema as Row | undefined;
	for (const key of path) node = node?.[key] as Row | undefined;
	return new Set(Object.keys((node?.properties ?? {}) as Row));
};

/** A TW company with a national and a foreign worker on the fixture reader the engine's `Reads` serve. */
/**
 * A payroll run's duty context as the behaviour runner hands it: one unit of every scheme a remittance names in
 * `totals.schemes`, and `statutory` (the per-scheme sums with `charged_base`), empty unless a case sets it.
 */
const runOf = (rows: Row[], statutory: Row = {}) => ({
	totals: {
		gross: 0,
		net: 0,
		employer_cost: 0,
		schemes: Object.fromEntries(
			dutiesOf(rows)
				.filter((duty) => duty.family === 'OBLIGATIONS')
				.flatMap((duty) =>
					((duty.rules as Row).schemes as string[]).map((code) => [
						code,
						{ employee: 1, employer: 1 }
					])
				)
		)
	},
	statutory
});
const tw = () => {
	const COMPANY = 'c0000000-0000-4000-8000-0000000000tw';
	const law = (name: string): Row[] =>
		versions
			.flatMap((version) => file(version, name))
			.map((row) => ({ approval_id: null, ...row }));
	const tables = new Map<string, Row[]>([
		...[
			'jurisdiction_settings',
			'statutory_contribution_catalog',
			'work_catalog',
			'allowance_catalog',
			'adhoc_catalog',
			'claim_catalog',
			'leave_catalog',
			'loan_catalog'
		].map((name) => [name, law(name)] as [string, Row[]]),
		[
			'entity',
			[
				{
					id: COMPANY,
					name: 'Formosa',
					settings_code: 'TW',
					pay_frequency: 'MONTHLY',
					risk_class: '42',
					facts: { pension_reserve_rate: 2 },
					approval_id: null
				}
			]
		],
		[
			'employment_profile',
			[
				{ id: 'p1', name: 'Mei', date_of_birth: '1990-02-01', nationality: 'TW' },
				{ id: 'p2', name: 'Arjun', date_of_birth: '1988-07-12', nationality: 'IN' }
			]
		],
		[
			'employment_contract',
			[
				['p1', 45800, 'CITIZEN'],
				['p2', 60000, 'FOREIGNER']
			].map(([id, salary, residency]) => ({
				id: `k-${id}`,
				employee_id: id,
				company_id: COMPANY,
				approval_id: null,
				effective_range: { from: '2024-01-01', to: null },
				facts: {
					contract_terms: [
						{
							base_salary: { value: salary, currency: 'TWD' },
							effective_range: { from: '2024-01-01', to: null },
							residency_status: residency,
							work_classification: 'EA_COVERED',
							statutory_work_category: 'NON_MANUAL',
							employment_type: 'FULL_TIME',
							allowances: []
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
		const value = row[key] as string | number | null | undefined;
		if (spec == null || typeof spec !== 'object') return value === spec;
		return Object.entries(spec as Row).every(([op, operand]) => {
			if (op === 'eq') return value === operand;
			if (op === 'in') return Array.isArray(operand) && operand.includes(value);
			if (op === 'isNull') return operand ? value == null : value != null;
			if (op === 'gte') return value != null && value >= (operand as string);
			if (op === 'lte') return value != null && value <= (operand as string);
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
		for (const slip of plan.payslips)
			tables
				.get('payslip')!
				.push({ ...slip, id: `${id}-${slip.employment_id}`, payroll_run_id: id });
		return plan;
	};
	const lines = (slip: {
		statutory: { scheme_code: string; employee_amount: number; employer_amount: number }[];
	}) =>
		Object.fromEntries(
			slip.statutory
				.filter((line) => line.employee_amount !== 0 || line.employer_amount !== 0)
				.map((line) => [line.scheme_code, [line.employee_amount, line.employer_amount]])
		);

	return { tables, run, lines, COMPANY, reads };
};

describe('TW public lineage', () => {
	it('every version holds settings, rule_set and every catalogue, each row on its own version', () => {
		assert.deepEqual(versions, ['version_1', 'version_2', 'version_3', 'version_4']);
		for (const version of versions) {
			for (const name of FILES)
				assert.equal(existsSync(resolve(TW, version, `${name}.json`)), true, `${version}/${name}`);
			const settings = file(version, 'jurisdiction_settings');
			assert.equal(settings.length, 1);
			for (const name of ['rule_set', ...CATALOGS])
				for (const row of file(version, name))
					assert.equal(row.settings_id, settings[0]!.id, `${version}/${name}:${String(row.code)}`);
			for (const name of CATALOGS)
				assert.ok(file(version, name).length > 0, `${version}/${name} is empty`);
		}
	});

	it('ids are unique across TW versions and collide with no other lineage', () => {
		const ids = (lineage: string): string[] =>
			readdirSync(resolve(lineages, lineage))
				.filter((entry) => entry.startsWith('version_'))
				.flatMap((version) =>
					readdirSync(resolve(lineages, lineage, version))
						.filter((name) => name.endsWith('.json'))
						.flatMap((name) =>
							(
								JSON.parse(readFileSync(resolve(lineages, lineage, version, name), 'utf8')) as Row[]
							).map((row) => String(row.id))
						)
				);
		const own = ids('TW');
		assert.equal(new Set(own).size, own.length);
		const others = new Set(
			readdirSync(lineages)
				.filter((lineage) => lineage !== 'TW')
				.flatMap(ids)
		);
		assert.deepEqual(
			own.filter((id) => others.has(id)),
			[]
		);
	});

	it('the lineage is one contiguous chain of date ranges', () => {
		let previous: Row | undefined;
		for (const version of versions) {
			const settings = settingsOf(version);
			const range = settings.effective_range as { from: string; to: string | null };
			assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
			if (previous === undefined) assert.equal(settings.cloned_from_id, undefined);
			else {
				assert.equal(settings.cloned_from_id, previous.id);
				const day = new Date(`${(previous.effective_range as { to: string }).to}T00:00:00Z`);
				day.setUTCDate(day.getUTCDate() + 1);
				assert.equal(range.from, day.toISOString().slice(0, 10));
			}
			assert.ok(range.to === null || range.to >= range.from);
			previous = settings;
		}
		assert.deepEqual(settingsOf('version_1').effective_range, {
			from: '2025-12-01',
			to: '2025-12-31'
		});
	});

	it('every row carries only its model’s fields', () => {
		for (const version of versions)
			for (const name of FILES) {
				const fields = modelFields(name);
				for (const row of file(version, name))
					for (const key of Object.keys(row))
						assert.ok(fields.has(key), `${version}/${name}:${String(row.code)} carries ${key}`);
			}
	});

	it('settings hold no purged blobs and the rule set is the duties only', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			// RISK_CLASS now lives in OCC_INJURY's own CEL; the exit grounds are the PAYROLL exit_grounds record.
			assert.deepEqual(Object.keys(settings.reference_tables as Row), ['LSA_TERMINATION_GROUND']);
			assert.deepEqual((settings.payroll as Row).currency, 'TWD');
			const families = new Set(file(version, 'rule_set').map((row) => row.family));
			assert.deepEqual([...families].toSorted(), [
				'EXPORTS',
				'OBLIGATIONS',
				'PAYROLL',
				'TASKS',
				'VALIDATIONS'
			]);
		}
	});

	it('codes are stable across versions', () => {
		// 2026 law added one obligation: the foreign professionals' pension election.
		const obligations = versions.map((version) =>
			file(version, 'rule_set').map((row) => String(row.code))
		);
		assert.deepEqual(
			obligations[1]!.filter((code) => !obligations[0]!.includes(code)),
			['FOREIGN_PROFESSIONAL_PENSION_AND_EMPLOYMENT_INSURANCE']
		);
		assert.deepEqual(
			obligations[0]!.filter((code) => !obligations[1]!.includes(code)),
			[]
		);
		for (const name of CATALOGS) {
			const codes = versions.map((version) =>
				file(version, name)
					.map((row) => String(row.code))
					.toSorted()
					.join(',')
			);
			assert.equal(new Set(codes).size, 1, name);
		}
	});

	it('both input schemas are JSON Schema 2020-12 and declare every fact the CEL reads', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const employee = settings.employee_input_schema;
			const entity = settings.entity_input_schema;
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal((schema as Row).$schema, 'https://json-schema.org/draft/2020-12/schema');
				assert.equal((schema as Row).type, 'object');
				assert.deepEqual(schemaProblems(schema, `${version} ${name}`), []);
			}
			const term = propertiesAt(employee, 'properties', 'contract_terms', 'items');
			// The one layout every lineage shares: terms, exit facts, per-scheme standings, person facts.
			assert.deepEqual(
				[...propertiesAt(employee)],
				['contract_terms', 'exit_facts', 'employment_statutory_facts', 'facts']
			);
			const profile = propertiesAt(employee, 'properties', 'facts');
			const elections = propertiesAt(
				employee,
				'properties',
				'employment_statutory_facts',
				'items',
				'properties',
				'status',
				'properties',
				'elections'
			);
			assert.deepEqual(new Set(electionKeysOf(employee)), elections);
			const exit = propertiesAt(employee, 'properties', 'exit_facts');
			const company = propertiesAt(entity);
			for (const key of ['bli_insurance_unit_number', 'nhi_unit_code', 'withholding_agent_number'])
				assert.ok(company.has(key), `${version} entity ${key}`);
			const props = (
				((employee as Row).properties as Row).contract_terms as { items: { properties: Row } }
			).items.properties;
			assert.equal((props.currency as Row).const, 'TWD');
			assert.deepEqual((props.residency_status as Row).enum, [
				'CITIZEN',
				'PERMANENT_RESIDENT',
				'FOREIGNER'
			]);
			assert.ok(((props.employment_type as Row).enum as string[]).includes('PART_TIME'));
			const text = FILES.map((name) => JSON.stringify(file(version, name))).join('\n');
			const read = (pattern: RegExp) =>
				new Set([...text.matchAll(pattern)].map((match) => match[1]!));
			const derived = new Set(['monthly_wage']);
			for (const key of read(/\bterms\.([a-z_0-9]+)/g))
				assert.ok(term.has(key) || derived.has(key), `${version} terms.${key} is declared`);
			for (const key of read(/\bemployee\.facts\.([a-z_0-9]+)/g))
				assert.ok(profile.has(key), `${version} employee.facts.${key} is declared`);
			for (const key of read(/\bexit_facts\.([a-z_0-9]+)/g))
				assert.ok(exit.has(key), `${version} exit_facts.${key} is declared`);
			for (const key of read(/\bcompany\.facts\.([a-z_0-9]+)/g))
				assert.ok(company.has(key), `${version} company.facts.${key} is declared`);
			for (const key of [
				...read(/\bscheme\.elections\.([a-z_0-9]+)/g),
				...read(/\belections\.[A-Z_]+\.([a-z_0-9]+)/g)
			])
				assert.ok(elections.has(key), `${version} election ${key} is declared`);
			assert.deepEqual(
				[...read(/\bemployee\.facts\.([a-z_0-9]+)/g)].toSorted(),
				version === 'version_1'
					? ['food_lodging_monthly_cap', 'foreign_spouse_of_national', 'indigenous', 'voting_right']
					: version === 'version_2'
						? [
								'food_lodging_monthly_cap',
								'foreign_professional',
								'foreign_spouse_of_national',
								'indigenous',
								'voting_right'
							]
						: [
								'food_lodging_monthly_cap',
								'foreign_professional',
								'foreign_spouse_of_national',
								'indigenous',
								'migrant_worker',
								'voting_right'
							]
			);
			assert.deepEqual([...elections].toSorted(), [
				'continued_after_65',
				'disability_subsidy',
				'employer_rate',
				'enrolled_dependants',
				'exempt',
				'exemptions',
				'insured_amount',
				'insured_elsewhere',
				'part_time_income',
				'pension_system',
				'voluntary_rate'
			]);
		}
	});

	it('every CEL expression evaluates on the context its engine surface supplies', () => {
		const people: Over[] = [
			{},
			{ terms: { residency_status: 'FOREIGNER' } },
			{ terms: { residency_status: 'FOREIGNER', residency_since: '2025-06-01' } },
			{
				terms: { residency_status: 'PERMANENT_RESIDENT' },
				employee: { date_of_birth: '1959-01-01' }
			},
			{ employee: { date_of_birth: '' } },
			{ terms: { residency_status: '' } },
			{
				employee: {
					facts: {
						foreign_spouse_of_national: true,
						foreign_professional: true,
						migrant_worker: true
					}
				},
				elections: {
					LABOR_PENSION: { pension_system: 'LSA', employer_rate: 8, voluntary_rate: 6 },
					NHI: { insured_elsewhere: true, enrolled_dependants: 5 },
					NHI_PART_TIME: { exempt: false }
				},
				company: { facts: { welfare_committee_established: true, pension_reserve_rate: 2 } }
			},
			{ company: { risk_class: '' } }
		];
		for (const version of versions) {
			for (const row of file(version, 'statutory_contribution_catalog'))
				for (const wage of [0, 15000, 45800, 400000])
					for (const person of people) {
						const result = at(version, String(row.code), wage, { ...person, additional: 50000 });
						if (result === null || result === 'REFUSED') continue;
						assert.ok(
							Number.isFinite(result.employee) && Number.isFinite(result.employer),
							String(row.code)
						);
					}
			for (const row of [...file(version, 'work_catalog'), ...file(version, 'allowance_catalog')])
				for (const field of ['eligibility', 'quantity', 'rate'])
					if (typeof row[field] === 'string' && row[field] !== '')
						assert.notEqual(
							evaluateConfigured(String(row[field]), payslipContext as never),
							undefined
						);
			for (const name of ['adhoc_catalog', 'claim_catalog', 'loan_catalog'])
				for (const row of file(version, name))
					for (const facts of [ENTRY_FACTS, {}]) {
						const context = { ...payslipContext, entry: entry(facts) };
						for (const field of ['eligibility', 'qualifies_when'])
							if (typeof row[field] === 'string' && row[field] !== '') {
								assert.equal(
									typeof evaluateConfigured(String(row[field]), context as never),
									'boolean'
								);
								assert.equal(
									typeof evaluateConfigured(String(row[field]), admission({}, facts) as never),
									'boolean'
								);
							}
						for (const band of (row.bands ?? []) as { when: string; amount: string }[])
							assert.equal(
								typeof evaluateConfigured(band.amount, context as never),
								'number',
								String(row.code)
							);
					}
			for (const row of file(version, 'leave_catalog')) {
				if (row.eligibility !== '')
					for (const gender of ['FEMALE', 'MALE', ''])
						assert.equal(
							typeof evaluateConfigured(
								String(row.eligibility),
								admission({ employee: { gender } }) as never
							),
							'boolean'
						);
				if (row.pay_fraction !== '')
					assert.equal(
						typeof evaluateConfigured(String(row.pay_fraction), admission() as never),
						'number'
					);
			}
		}
	});

	it('LI, EI, NHI, labour pension and the wage arrears fund at the published grades', () => {
		// 115年: the 45,800 top LI grade, 11.5% + EI 1%, worker 20% / employer 70%.
		assert.deepEqual(at('version_2', 'LI', 45800), { employee: 1053, employer: 3687 });
		assert.deepEqual(at('version_2', 'LI', 120000), { employee: 1053, employer: 3687 });
		assert.deepEqual(at('version_2', 'EI', 45800), { employee: 92, employer: 321 });
		const foreigner = { terms: { residency_status: 'FOREIGNER' } };
		assert.deepEqual(at('version_2', 'EI', 45800, foreigner), { employee: 0, employer: 0 });
		assert.deepEqual(at('version_2', 'LI', 45800, { employee: { date_of_birth: '1959-01-01' } }), {
			employee: 0,
			employer: 0
		});
		assert.equal(at('version_2', 'LI', 45800, { employee: { date_of_birth: '' } }), 'REFUSED');
		// The wage is lifted to its grade: 30,000 → 30,300; 28,700 → 28,800 in 114年, 29,500 in 115年.
		assert.deepEqual(at('version_2', 'LI', 30000), { employee: 697, employer: 2439 });
		assert.deepEqual(at('version_1', 'LI', 28700, { period: '2025-12' }), {
			employee: 662,
			employer: 2318
		});
		assert.deepEqual(at('version_2', 'LI', 28700), { employee: 679, employer: 2375 });
		// NHI 5.17%: worker 30%, employer 60% × 1.56; the top grade is 313,000.
		assert.deepEqual(at('version_2', 'NHI', 45800), { employee: 710, employer: 2216 });
		assert.deepEqual(at('version_2', 'NHI', 400000), { employee: 4855, employer: 15146 });
		// Labour pension 6% of the 月提繳工資 grade, nationals and permanent residents only.
		assert.deepEqual(at('version_2', 'LABOR_PENSION', 29500), { employee: 0, employer: 1770 });
		assert.deepEqual(at('version_2', 'LABOR_PENSION', 200000), { employee: 0, employer: 9000 });
		assert.equal(at('version_2', 'LABOR_PENSION', 45800, foreigner), null);
		const fund = at('version_2', 'WAGE_ARREARS_FUND', 45800) as { employer: number };
		// 0.025% of 45,800 = 11.45, billed per insured person to the dollar (BLI 分擔金額表).
		assert.equal(fund.employer, 11);
	});

	it('the person and entity facts: dependants, NHI elsewhere, pension elections, foreign spouses and professionals', () => {
		const facts = (employee: Row, over: Over = {}) => ({
			...over,
			employee: { facts: employee, ...over.employee }
		});
		const elected = (elections: Record<string, Row>, over: Over = {}) => ({ ...over, elections });
		// 全民健康保險法 §18(2): the worker pays for up to three enrolled dependants, per person rounded.
		assert.deepEqual(at('version_2', 'NHI', 45800, elected({ NHI: { enrolled_dependants: 2 } })), {
			employee: 2130,
			employer: 2216
		});
		assert.deepEqual(at('version_2', 'NHI', 45800, elected({ NHI: { enrolled_dependants: 5 } })), {
			employee: 2840,
			employer: 2216
		});
		const elsewhere = elected({ NHI: { insured_elsewhere: true } });
		assert.deepEqual(at('version_2', 'NHI', 45800, elsewhere), { employee: 0, employer: 0 });
		assert.deepEqual(
			at('version_2', 'NHI_SUPPLEMENT', 45800, { ...elsewhere, additional: 300000 }),
			{ employee: 0, employer: 0 }
		);
		// 兼職薪資所得: 2.11% of a payment at or above the minimum wage, from someone insured elsewhere.
		const pay = (salary: number, ...bonuses: number[]) => [
			{ code: 'BASIC', amount: salary },
			...bonuses.map((amount) => ({ code: 'bonus', amount }))
		];
		assert.deepEqual(at('version_2', 'NHI_PART_TIME', 29500, { ...elsewhere, lines: pay(29500) }), {
			employee: 622,
			employer: 0
		});
		assert.deepEqual(at('version_2', 'NHI_PART_TIME', 29499, { ...elsewhere, lines: pay(29499) }), {
			employee: 0,
			employer: 0
		});
		// Each payment on its own: a 20,000 salary and a 40,000 bonus — only the bonus reaches the minimum wage.
		assert.deepEqual(
			at('version_2', 'NHI_PART_TIME', 60000, { ...elsewhere, lines: pay(20000, 40000) }),
			{
				employee: 844,
				employer: 0
			}
		);
		// A later slip of the month adds its own payments to the month's earlier charge.
		assert.deepEqual(
			at('version_2', 'NHI_PART_TIME', 40000, {
				...elsewhere,
				lines: pay(0, 40000),
				charged: { NHI_PART_TIME: { employee: 622, employer: 0 } }
			}),
			{ employee: 1466, employer: 0 }
		);
		assert.equal(at('version_2', 'NHI_PART_TIME', 45800), null);
		assert.equal(
			at(
				'version_2',
				'NHI_PART_TIME',
				45800,
				elected({ NHI: { insured_elsewhere: true }, NHI_PART_TIME: { exempt: true } })
			),
			null
		);
		assert.deepEqual(
			at('version_1', 'NHI_PART_TIME', 28590, {
				...elsewhere,
				period: '2025-12',
				lines: pay(28590)
			}),
			{
				employee: 603,
				employer: 0
			}
		);
		// The insurer-confirmed grade, where declared, replaces the grade of the wage; EI reads the LI one.
		assert.deepEqual(at('version_2', 'LI', 45800, elected({ LI: { insured_amount: 30300 } })), {
			employee: 697,
			employer: 2439
		});
		assert.deepEqual(at('version_2', 'EI', 45800, elected({ LI: { insured_amount: 30300 } })), {
			employee: 61,
			employer: 212
		});
		assert.deepEqual(at('version_2', 'NHI', 45800, elected({ NHI: { insured_amount: 30300 } })), {
			employee: 470,
			employer: 1466
		});
		assert.deepEqual(
			at('version_2', 'NHI_SUPPLEMENT', 45800, {
				...elected({ NHI: { insured_amount: 30300 } }),
				additional: 200000
			}),
			{ employee: 1663, employer: 0 }
		);
		// 勞退條例 §14: a higher declared employer rate and the worker's voluntary 6%; nothing on the LSA pension.
		assert.deepEqual(
			at('version_2', 'LABOR_PENSION', 45800, elected({ LABOR_PENSION: { voluntary_rate: 6 } })),
			{ employee: 2748, employer: 2748 }
		);
		assert.deepEqual(
			at('version_2', 'LABOR_PENSION', 45800, elected({ LABOR_PENSION: { employer_rate: 10 } })),
			{ employee: 0, employer: 4580 }
		);
		assert.equal(
			at(
				'version_2',
				'LABOR_PENSION',
				45800,
				elected({ LABOR_PENSION: { pension_system: 'LSA' } })
			),
			null
		);
		// A foreign spouse of a national is in EI and the new pension in both versions; a foreign professional from 2026.
		const spouse = facts(
			{ foreign_spouse_of_national: true },
			{ terms: { residency_status: 'FOREIGNER' } }
		);
		for (const version of versions) {
			assert.deepEqual(at(version, 'EI', 45800, spouse), { employee: 92, employer: 321 });
			assert.deepEqual(at(version, 'LABOR_PENSION', 45800, spouse), {
				employee: 0,
				employer: 2748
			});
		}
		const professional = (residency_status: string) =>
			facts({ foreign_professional: true }, { terms: { residency_status } });
		assert.deepEqual(at('version_2', 'LABOR_PENSION', 45800, professional('FOREIGNER')), {
			employee: 0,
			employer: 2748
		});
		assert.equal(at('version_1', 'LABOR_PENSION', 45800, professional('FOREIGNER')), null);
		assert.deepEqual(at('version_2', 'EI', 45800, professional('PERMANENT_RESIDENT')), {
			employee: 92,
			employer: 321
		});
		assert.deepEqual(at('version_1', 'EI', 45800, professional('PERMANENT_RESIDENT')), {
			employee: 0,
			employer: 0
		});
	});

	it('occupational accident insurance: the entity’s industry rate on the 職保 grade, employer paid', () => {
		// Class 42 (電腦程式設計) 0.05% + 0.07% commuting = 0.12%; class 3 (礦業) 0.96%; the 72,800 top grade.
		assert.deepEqual(at('version_2', 'OCC_INJURY', 45800), { employee: 0, employer: 55 });
		assert.deepEqual(at('version_2', 'OCC_INJURY', 45800, { company: { risk_class: '3' } }), {
			employee: 0,
			employer: 440
		});
		assert.deepEqual(at('version_2', 'OCC_INJURY', 100000), { employee: 0, employer: 87 });
		assert.deepEqual(at('version_2', 'OCC_INJURY', 15000), { employee: 0, employer: 35 });
		assert.deepEqual(at('version_1', 'OCC_INJURY', 28700, { period: '2025-12' }), {
			employee: 0,
			employer: 35
		});
		// Every worker: over 65 and foreigners included.
		assert.deepEqual(
			at('version_2', 'OCC_INJURY', 45800, {
				employee: { date_of_birth: '1950-01-01' },
				terms: { residency_status: 'FOREIGNER' }
			}),
			{ employee: 0, employer: 55 }
		);
		assert.equal(at('version_2', 'OCC_INJURY', 45800, { company: { risk_class: '' } }), 'REFUSED');
		// §16(4) 實績費率: the Bureau-notified unit rate replaces the table rate (customer input).
		assert.deepEqual(
			at('version_2', 'OCC_INJURY', 45800, {
				company: { risk_class: '', facts: { occ_experience_rate_percent: 0.3 } }
			}),
			{ employee: 0, employer: 137 }
		);
		assert.equal(
			at('version_2', 'OCC_INJURY', 45800, { company: { risk_class: '56' } }),
			'REFUSED'
		);
	});

	it('the welfare fund, the LSA pension reserve and severance withholding', () => {
		const committee = { company: { facts: { welfare_committee_established: true } } };
		assert.deepEqual(at('version_2', 'WELFARE_FUND', 45800, committee), {
			employee: 229,
			employer: 0
		});
		assert.equal(at('version_2', 'WELFARE_FUND', 45800), null);
		// 勞基法 §56(1): the approved 2–15% on an LSA worker's wage; refused while the rate is unrecorded.
		const lsa = {
			elections: { LABOR_PENSION: { pension_system: 'LSA' } },
			company: { facts: { pension_reserve_rate: 2 } }
		};
		assert.deepEqual(at('version_2', 'LABOR_PENSION_RESERVE', 45800, lsa), {
			employee: 0,
			employer: 916
		});
		assert.equal(
			at('version_2', 'LABOR_PENSION_RESERVE', 45800, { elections: lsa.elections }),
			'REFUSED'
		);
		assert.equal(at('version_2', 'LABOR_PENSION_RESERVE', 45800), null);
		const migrant = {
			terms: { residency_status: 'FOREIGNER' },
			employee: { facts: { migrant_worker: true } },
			company: lsa.company
		};
		assert.deepEqual(at('version_2', 'LABOR_PENSION_RESERVE', 45800, migrant), {
			employee: 0,
			employer: 916
		});
		// From 1 April 2026 (version_3, its own change of law) the employer MAY leave a migrant worker under ten years
		// at the unit out of the reserve wage total (可不計入): only with the entity's election; the January–March
		// version keeps them in either way.
		const electing = {
			...migrant,
			company: {
				facts: { pension_reserve_rate: 2, pension_reserve_excludes_short_service_migrants: true }
			}
		};
		for (const later of ['version_3', 'version_4']) {
			assert.equal(
				at(later, 'LABOR_PENSION_RESERVE', 45800, { ...electing, period: '2026-04' }),
				null
			);
			assert.deepEqual(
				at(later, 'LABOR_PENSION_RESERVE', 45800, { ...migrant, period: '2026-04' }),
				{
					employee: 0,
					employer: 916
				}
			);
		}
		assert.deepEqual(
			at('version_2', 'LABOR_PENSION_RESERVE', 45800, { ...electing, period: '2026-03' }),
			{
				employee: 0,
				employer: 916
			}
		);
		assert.deepEqual(
			at('version_2', 'LABOR_PENSION_RESERVE', 45800, { ...migrant, period: '2026-03' }),
			{
				employee: 0,
				employer: 916
			}
		);
		assert.ok(!JSON.stringify(scheme('version_2', 'LABOR_PENSION_RESERVE')).includes('2026-04-01'));
		assert.ok(!JSON.stringify(scheme('version_3', 'LABOR_PENSION_RESERVE')).includes('2026-04-01'));
		assert.deepEqual(
			at('version_3', 'LABOR_PENSION_RESERVE', 45800, {
				...migrant,
				period: '2026-04',
				employment: { service_months: 120 }
			}),
			{ employee: 0, employer: 916 }
		);
		// 退職所得: 6% (resident) / 18% (non-resident) above 定額免稅 × 年資; a 30-month tail of 6 counts a whole year.
		assert.deepEqual(at('version_2', 'SEVERANCE_TAX', 700000), { employee: 4920, employer: 0 });
		assert.deepEqual(
			at('version_2', 'SEVERANCE_TAX', 700000, { terms: { residency_status: 'FOREIGNER' } }),
			{ employee: 14760, employer: 0 }
		);
		assert.deepEqual(
			at('version_2', 'SEVERANCE_TAX', 700000, { employment: { service_months: 25 } }),
			{
				employee: 11100,
				employer: 0
			}
		);
		assert.deepEqual(at('version_2', 'SEVERANCE_TAX', 500000), { employee: 0, employer: 0 });
		assert.deepEqual(at('version_1', 'SEVERANCE_TAX', 700000, { period: '2025-12' }), {
			employee: 6360,
			employer: 0
		});
	});

	it('withholding: resident 5%, the bonus threshold and the non-resident breakpoint', () => {
		const foreigner = { terms: { residency_status: 'FOREIGNER' } };
		assert.deepEqual(at('version_2', 'INCOME_TAX', 40000), { employee: 0, employer: 0 });
		assert.deepEqual(at('version_2', 'INCOME_TAX', 40020), { employee: 2001, employer: 0 });
		const bonus = (...amounts: number[]) => ({
			lines: amounts.map((amount) => ({ code: 'bonus', amount }))
		});
		assert.deepEqual(at('version_2', 'INCOME_TAX_BONUS', 90500, bonus(90500)), {
			employee: 0,
			employer: 0
		});
		assert.deepEqual(at('version_2', 'INCOME_TAX_BONUS', 100000, bonus(100000)), {
			employee: 5000,
			employer: 0
		});
		// 薪資所得扣繳辦法 §7: the threshold is per payment — two 60,000 bonuses in a month withhold nothing.
		assert.deepEqual(at('version_2', 'INCOME_TAX_BONUS', 120000, bonus(60000, 60000)), {
			employee: 0,
			employer: 0
		});
		assert.deepEqual(at('version_2', 'INCOME_TAX_BONUS', 160000, bonus(60000, 100000)), {
			employee: 5000,
			employer: 0
		});
		assert.deepEqual(
			at('version_1', 'INCOME_TAX_BONUS', 89000, { period: '2025-12', ...bonus(89000) }),
			{
				employee: 4450,
				employer: 0
			}
		);
		assert.equal(at('version_2', 'INCOME_TAX', 50000, foreigner), null);
		assert.deepEqual(at('version_2', 'INCOME_TAX_NON_RESIDENT', 44250, foreigner), {
			employee: 2655,
			employer: 0
		});
		assert.deepEqual(at('version_2', 'INCOME_TAX_NON_RESIDENT', 44251, foreigner), {
			employee: 7965,
			employer: 0
		});
		assert.deepEqual(
			at('version_1', 'INCOME_TAX_NON_RESIDENT', 44250, { ...foreigner, period: '2025-12' }),
			{
				employee: 7965,
				employer: 0
			}
		);
		assert.equal(at('version_2', 'INCOME_TAX_NON_RESIDENT', 50000), null);
		assert.deepEqual(
			at('version_2', 'INCOME_TAX', 50000, {
				terms: { residency_status: 'FOREIGNER', residency_since: '2026-01-01' }
			}),
			{ employee: 2500, employer: 0 }
		);
		assert.equal(
			at('version_2', 'INCOME_TAX', 50000, { terms: { residency_status: '' } }),
			'REFUSED'
		);
	});

	it('LI is 12.5% outside employment insurance and 11.5% with it (就業保險法 §41(2))', () => {
		const foreigner = { terms: { residency_status: 'FOREIGNER' } };
		for (const version of versions) {
			const period = version === 'version_1' ? '2025-12' : '2026-03';
			// BLI 分擔金額表 (115): 45,800 for 30 days — worker 1,145, employer 4,008, LI and EI together.
			assert.deepEqual(at(version, 'LI', 45800, { ...foreigner, period }), {
				employee: 1145,
				employer: 4008
			});
			assert.deepEqual(at(version, 'LI', 45800, { period }), { employee: 1053, employer: 3687 });
			assert.deepEqual(at(version, 'EI', 45800, { period }), { employee: 92, employer: 321 });
		}
	});

	it('the 扣繳稅額表 by declared exemptions, cell for cell, and the formula above 500,000', () => {
		const table = (version: string, wage: number, exemptions: number) =>
			(
				at(version, 'INCOME_TAX', wage, {
					period: version === 'version_1' ? '2025-12' : '2026-03',
					elections: { INCOME_TAX: { exemptions } }
				}) as { employee: number }
			).employee;
		// 115年度 table cells (財政部 114-12-04): the row 90,501–91,000 with none declared is 2,020.
		assert.equal(table('version_2', 90750, 0), 2020);
		assert.equal(table('version_2', 90500, 0), 0);
		assert.equal(table('version_2', 100250, 1), 2070);
		assert.equal(table('version_2', 150250, 6), 2470);
		assert.equal(table('version_2', 150250, 8), 0);
		assert.equal(table('version_2', 499750, 0), 100700);
		assert.equal(table('version_2', 600000, 0), 140908);
		// 114年度 table: the first taxed row with none declared is 88,501–89,000 at 2,020.
		assert.equal(table('version_1', 88750, 0), 2020);
		assert.equal(table('version_1', 499750, 1), 101350);
		// Without a declaration the 5% method stands.
		assert.deepEqual(at('version_2', 'INCOME_TAX', 90750), { employee: 4537, employer: 0 });
	});

	it('notice pay: the unserved §16 days at the day wage or the average daily wage, on §11/§13/§20 only', () => {
		for (const version of versions) {
			const row = file(version, 'adhoc_catalog').find((item) => item.code === 'NOTICE_PAY')!;
			const context = (exit_ground: string, exit_facts: Row, service_months = 30) => ({
				...payslipContext,
				employment: {
					...(payslipContext.employment as Row),
					exit_date: '2026-03-31',
					exit_ground,
					exit_facts,
					service_months
				},
				entry: entry({})
			});
			const amount = (c: Row) =>
				evaluateConfigured((row.bands as { amount: string }[])[0]!.amount, c as never);
			// 30 months' service: 20 days' notice, 5 given — 15 × 1,500, or × the higher average daily wage.
			assert.equal(amount(context('REDUNDANCY', { notice_days_given: 5 })), 22500);
			assert.equal(
				amount(context('REDUNDANCY', { notice_days_given: 5, average_daily_wage: 1600 })),
				24000
			);
			assert.equal(amount(context('REDUNDANCY', { notice_days_given: 0 }, 40)), 45000);
			assert.equal(amount(context('REDUNDANCY', { notice_days_given: 0 }, 2)), 0);
			assert.equal(amount(context('REDUNDANCY', {})), 1000);
			const qualifies = (c: Row) => evaluateConfigured(String(row.qualifies_when), c as never);
			assert.equal(qualifies(context('REDUNDANCY', {})), true);
			assert.equal(
				qualifies(context('RESIGNATION', { lsa_termination_ground: 'ARTICLE_14' })),
				false
			);
			assert.equal(qualifies(context('DISMISSAL', { lsa_termination_ground: 'ARTICLE_20' })), true);
		}
	});

	it('leave caps are metered per calendar year or per event', () => {
		for (const version of versions) {
			const rows = file(version, 'leave_catalog');
			const classes = rows.map((row) => classFromRow(row as never));
			const id = (code: string) => rows.find((row) => row.code === code)!.id as never;
			const available = (
				code: string,
				movements: Row[],
				asOf: string,
				eventId?: string,
				view = ''
			) =>
				leaveBalances({
					classes,
					movements: movements.map((m) =>
						movementFromRow({ activity: 'TIME_OFF', approval_id: 'a', ...m } as never)
					),
					serviceMonths: 30,
					asOf,
					employmentStart: '2023-09-01',
					...(eventId ? { eventId } : {}),
					context: { ...subject(), entry: { facts: {} } } as never
				}).find((balance) => balance.code === code && balance.window_key === view)!.available;
			assert.deepEqual(
				Object.fromEntries(
					[
						'SICK_LEAVE',
						'PERSONAL_LEAVE',
						'MARRIAGE_LEAVE',
						'PATERNITY_LEAVE',
						'PRENATAL_CHECKUP_LEAVE',
						'PARENTAL_LEAVE',
						'ANNUAL_LEAVE'
					].map((code) => {
						const e = rows.find((row) => row.code === code)!.entitlement as Row;
						return [code, [e.days === undefined ? 'bands' : e.days, e.window]];
					})
				),
				{
					SICK_LEAVE: [
						(rows.find((row) => row.code === 'SICK_LEAVE')!.entitlement as Row).days,
						'CALENDAR_YEAR'
					],
					PERSONAL_LEAVE: ['14.0', 'CALENDAR_YEAR'],
					MARRIAGE_LEAVE: [
						(rows.find((row) => row.code === 'MARRIAGE_LEAVE')!.entitlement as Row).days,
						'EVENT'
					],
					PATERNITY_LEAVE: ['7.0', 'EVENT'],
					PRENATAL_CHECKUP_LEAVE: ['7.0', 'EVENT'],
					PARENTAL_LEAVE: ['730.0', 'EVENT'],
					ANNUAL_LEAVE: [annualDays(rows), 'SERVICE_YEAR']
				}
			);
			// 勞工請假規則 §4: 30 sick days a year — 20 taken in 2026 leave 10; last year's do not count.
			const sick = [
				{ catalog_id: id('SICK_LEAVE'), occurred_on: '2026-02-02', from: '2026-02-02', days: 20 },
				{ catalog_id: id('SICK_LEAVE'), occurred_on: '2025-05-05', from: '2025-05-05', days: 25 }
			];
			assert.equal(available('SICK_LEAVE', sick, '2026-06-30'), 10);
			assert.equal(available('PERSONAL_LEAVE', [], '2026-06-30'), 14);
			// 勞工請假規則 §2: eight marriage days per marriage.
			const married = [
				{
					catalog_id: id('MARRIAGE_LEAVE'),
					occurred_on: '2026-04-01',
					from: '2026-04-01',
					days: 5,
					facts: { event_id: 'w1' }
				}
			];
			// 勞工請假規則 §2 (2026-09-30): 8 days to 30 September, 14 from 1 October — 8 / 8 / 8 / 14 by version.
			const days = version === 'version_4' ? 14 : 8;
			assert.equal(available('MARRIAGE_LEAVE', married, '2026-06-30', 'w1'), days - 5);
			assert.equal(available('MARRIAGE_LEAVE', married, '2026-06-30', 'w2'), days);
			// Per-event grants read on the balance listing, one view per event keyed by its first entry's facts.
			const event = (code: string, from: string, days: number, facts: Row) => ({
				catalog_id: id(code),
				occurred_on: from,
				from,
				days,
				facts
			});
			const deaths = [
				event('BEREAVEMENT_LEAVE', '2026-02-02', 3, { event_id: 'd1', relationship: 'PARENT' }),
				event('BEREAVEMENT_LEAVE', '2026-04-06', 1, { event_id: 'd2', relationship: 'SIBLING' })
			];
			// 勞工請假規則 §3: a parent 8 days (3 taken), a sibling 3 (1 taken); the next death’s own view grants nothing until its relationship is entered.
			assert.equal(available('BEREAVEMENT_LEAVE', deaths, '2026-06-30', undefined, 'd1'), 5);
			assert.equal(available('BEREAVEMENT_LEAVE', deaths, '2026-06-30', undefined, 'd2'), 2);
			assert.equal(available('BEREAVEMENT_LEAVE', deaths, '2026-06-30'), 0);
			// 勞基法 §50: eight weeks for a birth, one week for a miscarriage at two months.
			const births = [
				event('MATERNITY_LEAVE', '2026-01-05', 20, { event_id: 'b1', event_kind: 'BIRTH' }),
				event('MATERNITY_LEAVE', '2026-05-04', 2, { event_id: 'b2', event_kind: 'MISCARRIAGE_2M' })
			];
			assert.equal(available('MATERNITY_LEAVE', births, '2026-06-30', undefined, 'b1'), 36);
			assert.equal(available('MATERNITY_LEAVE', births, '2026-06-30', undefined, 'b2'), 5);
			const late = [
				event('MATERNITY_LEAVE', '2026-05-04', 8, { event_id: 'b3', event_kind: 'MISCARRIAGE_3M' })
			];
			assert.equal(available('MATERNITY_LEAVE', late, '2026-06-30', undefined, 'b3'), 20);
			// 性別平等工作法 §14: one menstrual day a month.
			const periods = [event('MENSTRUAL_LEAVE', '2026-03-05', 1, {})];
			assert.equal(available('MENSTRUAL_LEAVE', periods, '2026-06-30', undefined, '2026-03'), 0);
		}
	});

	it('validations: the minimum wage on contract terms, overtime ceilings and the §40 report on payslips', () => {
		for (const version of versions) {
			const rows = file(version, 'rule_set');
			const check = (code: string) => rows.find((row) => row.code === code)!.rules as Row;
			const trips = (code: string, context: Row) =>
				evaluateConfigured(String(check(code).when), context as never);
			const minimum = (rows.find((row) => row.code === 'minimum_wage')!.rules as Row)
				.monthly as number;
			assert.equal(minimum, version === 'version_1' ? 28590 : 29500);
			const contract = (terms: Row) => ({
				...subject({ terms }),
				rules: { minimum_wage: rows.find((row) => row.code === 'minimum_wage')!.rules },
				term: terms
			});
			assert.deepEqual(
				[check('MINIMUM_WAGE_FLOOR').site, check('MINIMUM_WAGE_FLOOR').kind],
				['contract', 'refuse']
			);
			assert.equal(trips('MINIMUM_WAGE_FLOOR', contract({ monthly_wage: minimum - 1 })), true);
			assert.equal(trips('MINIMUM_WAGE_FLOOR', contract({ monthly_wage: minimum })), false);
			assert.equal(
				trips(
					'MINIMUM_WAGE_FLOOR',
					contract({ monthly_wage: 12000, employment_type: 'PART_TIME' })
				),
				false
			);
			const slip = (
				days: [string, number, number][],
				facts: Row = {},
				headcount = 10,
				lines: Row = {},
				consented = false
			) => ({
				...payslipContext,
				company: { region: '', risk_class: '42', pay_frequency: 'MONTHLY', facts, headcount },
				work: ((list) => ({ ...payslipContext.work, days: list, month_days: list }))(
					days.map(([day_type, worked_hours, overtime_hours], i) => ({
						date: `2026-03-${String(i + 1).padStart(2, '0')}`,
						day_type,
						holiday_kind: '',
						worked_hours,
						overtime_hours,
						overtime_consented: consented,
						overtime_consented_at: consented
							? `2026-03-${String(i + 1).padStart(2, '0')}T01:00:00Z`
							: null
					}))
				),
				payslip: { gross: 0, net: 0, lines },
				statutory: {}
			});
			const month = (overtime: number) =>
				Array.from(
					{ length: 23 },
					() => ['WORK', 8 + overtime, overtime] as [string, number, number]
				);
			// 23 working days × 2 h = 46 h: at the ceiling; one 休息日 of 1 h more trips it.
			assert.equal(trips('OVERTIME_MONTHLY_CAP', slip(month(2))), false);
			assert.equal(trips('OVERTIME_MONTHLY_CAP', slip([...month(2), ['OFF', 1, 0]])), true);
			// §32(1)–(2): the collective approval (the union, or the labour-management conference), dated, lifts the month
			// to 54 hours; the worker's per-day consent does not; without the approval the statute's 46 stays.
			const approved = {
				overtime_extension_approval_on: '2026-01-15',
				overtime_extension_approved_by: 'UNION'
			};
			const conference = {
				...approved,
				overtime_extension_approved_by: 'LABOUR_MANAGEMENT_CONFERENCE'
			};
			const over = [...month(2), ['OFF', 8, 0]] as [string, number, number][];
			for (const [facts, consented, tripped] of [
				[approved, true, false],
				[approved, false, false],
				[conference, false, false],
				[{}, true, true],
				[{}, false, true],
				[{ ...approved, overtime_extension_approval_on: '2026-04-01' }, true, true],
				[{ overtime_extension_approval_on: '2026-01-15' }, true, true],
				[{ overtime_consent: true }, true, true]
			] as [Row, boolean, boolean][])
				assert.equal(
					trips('OVERTIME_MONTHLY_CAP', slip(over, facts, 10, {}, consented)),
					tripped,
					JSON.stringify([facts, consented])
				);
			// The extension used by an employer of thirty or more is filed; under thirty it is not; no approval, no filing.
			assert.equal(trips('OVERTIME_EXTENSION_FILING', slip(over, approved, 30)), true);
			assert.equal(trips('OVERTIME_EXTENSION_FILING', slip(over, approved, 29)), false);
			assert.equal(trips('OVERTIME_EXTENSION_FILING', slip(over, {}, 30, {}, true)), false);
			// §32(2): 138 hours in three months under the approval, from hours.rolling (休息日 hours count, its overtime
			// column does not); without the approval the rule does not apply (the 46-hour month governs).
			const rolling = (
				overtime: number,
				offWorked: number,
				offOvertime = 0,
				facts: Row = approved
			) => ({
				...slip([['WORK', 10, 2]], facts),
				hours: {
					rolling: {
						worked_hours: 0,
						overtime_hours: overtime + offOvertime,
						incentive_hours: 0,
						day_type: {
							OFF: { worked_hours: offWorked, overtime_hours: offOvertime, incentive_hours: 0 }
						},
						holiday_kind: {}
					}
				}
			});
			assert.equal(trips('OVERTIME_QUARTER_CAP', rolling(130, 8)), false);
			assert.equal(trips('OVERTIME_QUARTER_CAP', rolling(130, 9, 5)), true);
			assert.equal(trips('OVERTIME_QUARTER_CAP', rolling(130, 9, 0, {})), false);
			// The taxable over-limit overtime follows the same cap: 54 hours approved, else 46.
			const excess = file(version, 'work_catalog').find(
				(row) => row.code === 'OVERTIME_TAXABLE_EXCESS'
			)!;
			const taxed = (facts: Row) =>
				evaluateConfigured(String(excess.eligibility), slip(over, facts, 10, {}, true) as never);
			assert.equal(taxed({}), true);
			assert.equal(taxed(approved), false);
			assert.equal(
				trips(
					'MINIMUM_WAGE_HOURLY',
					contract({
						employment_type: 'PART_TIME',
						facts: { hourly_wage: version === 'version_1' ? 189 : 195 }
					})
				),
				true
			);
			assert.equal(
				trips(
					'MINIMUM_WAGE_HOURLY',
					contract({
						employment_type: 'PART_TIME',
						facts: { hourly_wage: version === 'version_1' ? 190 : 196 }
					})
				),
				false
			);
			assert.equal(trips('MINIMUM_WAGE_HOURLY', contract({ facts: {} })), false);
			// A household's foreign caregiver is outside the minimum wage but held to the MOL's NT$20,000.
			const caregiver = (monthly_wage: number) =>
				contract({
					work_classification: 'NON_EA',
					monthly_wage,
					facts: { worker_category: 'DOMESTIC_CAREGIVER' }
				});
			assert.equal(trips('DOMESTIC_MIGRANT_WAGE', caregiver(19999)), true);
			assert.equal(trips('DOMESTIC_MIGRANT_WAGE', caregiver(20000)), false);
			assert.equal(trips('MINIMUM_WAGE_FLOOR', caregiver(20000)), false);
			assert.equal(trips('OVERTIME_DAILY_CAP', slip([['WORK', 12, 4]])), false);
			assert.equal(trips('OVERTIME_DAILY_CAP', slip([['WORK', 12.5, 4.5]])), true);
			assert.equal(
				trips('EMERGENCY_REST_DAY_REPORT', slip([], {}, 10, { STATUTORY_REST_WORK: 1500 })),
				true
			);
			assert.equal(trips('EMERGENCY_REST_DAY_REPORT', slip([])), false);
			for (const code of [
				'OVERTIME_MONTHLY_CAP',
				'OVERTIME_DAILY_CAP',
				'OVERTIME_EXTENSION_FILING',
				'EMERGENCY_REST_DAY_REPORT'
			])
				assert.deepEqual([check(code).site, check(code).kind], ['payslip', 'warn'], code);
		}
	});

	it('insured grade from the monthly wage: covered days, 育嬰留停, NHI month end, small units, after 65, disability', () => {
		const leaveRow = (days: number, to: string, from = '2026-03-22') => ({
			code: 'PARENTAL_LEAVE',
			activity: 'TIME_OFF',
			from,
			to,
			period_calendar_days: days
		});
		for (const version of versions) {
			const period = version === 'version_1' ? '2025-12' : '2026-03';
			const at2 = (code: string, wage: number, over: Over = {}) =>
				at(version, code, wage, { period, ...over });
			// 勞保條例 §14: the reported grade, not the month's reduced pay — 30,000 paid on a 45,800 monthly wage.
			assert.deepEqual(at2('LI', 30000, { terms: { monthly_wage: 45800 } }), {
				employee: 1053,
				employer: 3687
			});
			// 施行細則 §27 / 勞退條例 §16: a 15-day month is 15/30 of the premium.
			assert.deepEqual(at2('LI', 45800, { covered: 15 }), { employee: 527, employer: 1843 });
			assert.deepEqual(at2('EI', 45800, { covered: 15 }), { employee: 46, employer: 160 });
			assert.deepEqual(at2('LABOR_PENSION', 45800, { covered: 15 }), {
				employee: 0,
				employer: 1374
			});
			assert.deepEqual(at2('OCC_INJURY', 45800, { covered: 15 }), { employee: 0, employer: 27 });
			// 性別平等工作法 §16(2): ten days of 育嬰留職停薪 leave 20/30 of the month charged; on leave at month end, no NHI.
			const parental = { leave: [leaveRow(10, '2026-04-30', `${period}-22`)] };
			assert.deepEqual(at2('LI', 45800, parental), { employee: 702, employer: 2458 });
			assert.deepEqual(at2('LABOR_PENSION', 45800, parental), { employee: 0, employer: 1832 });
			assert.deepEqual(at2('NHI', 45800, parental), { employee: 0, employer: 0 });
			// 健保法 §30: a leaver before the month's last day owes nothing; a joiner owes the whole month.
			assert.deepEqual(at2('NHI', 45800, { employment: { exit_date: `${period}-20` } }), {
				employee: 0,
				employer: 0
			});
			assert.deepEqual(at2('NHI', 45800, { covered: 10 }), { employee: 710, employer: 2216 });
			// 勞保條例 §6, §8: a unit under five that never entered compulsory cover — no LI, EI still.
			const small = { company: { facts: { li_no_insurance_unit: true } } };
			assert.deepEqual(at2('LI', 45800, small), { employee: 0, employer: 0 });
			assert.deepEqual(at2('EI', 45800, small), { employee: 92, employer: 321 });
			// After 65: no LI unless continued (then 12.5%, no EI); 64 is still 11.5% with EI.
			const sixtyFive = {
				employee: { date_of_birth: version === 'version_1' ? '1960-11-01' : '1961-02-01' }
			};
			const sixtyFour = {
				employee: { date_of_birth: version === 'version_1' ? '1961-12-01' : '1961-04-01' }
			};
			assert.deepEqual(at2('LI', 45800, sixtyFive), { employee: 0, employer: 0 });
			assert.deepEqual(at2('EI', 45800, sixtyFive), { employee: 0, employer: 0 });
			assert.equal(
				(
					at2('LI', 45800, { ...sixtyFive, elections: { LI: { continued_after_65: true } } }) as {
						employee: number;
					}
				).employee,
				1145
			);
			assert.deepEqual(at2('LI', 45800, sixtyFour), { employee: 1053, employer: 3687 });
			assert.deepEqual(at2('EI', 45800, sixtyFour), { employee: 92, employer: 321 });
			// 身心障礙者權益保障法 §73: a 50% subsidy halves the worker's own share.
			assert.deepEqual(at2('LI', 45800, { elections: { LI: { disability_subsidy: 50 } } }), {
				employee: 527,
				employer: 3687
			});
			assert.deepEqual(
				at2('NHI', 45800, {
					elections: { NHI: { disability_subsidy: 50, enrolled_dependants: 1 } }
				}),
				{
					employee: 355 + 710,
					employer: 2216
				}
			);
			// 勞退條例 §7: a permanent resident is in the new pension.
			assert.deepEqual(
				at2('LABOR_PENSION', 45800, { terms: { residency_status: 'PERMANENT_RESIDENT' } }),
				{
					employee: 0,
					employer: 2748
				}
			);
		}
		// A February joiner on the 15th: 14 days of 30; a whole February is a whole month.
		assert.deepEqual(at('version_2', 'LI', 45800, { period: '2026-02', covered: 14 }), {
			employee: 492,
			employer: 1721
		});
		assert.deepEqual(at('version_2', 'LI', 45800, { period: '2026-02' }), {
			employee: 1053,
			employer: 3687
		});
		// The supplementary premium on a bonus stops at NT$10,000,000 a payment.
		assert.deepEqual(at('version_2', 'NHI_SUPPLEMENT', 45800, { additional: 20000000 }), {
			employee: 211000,
			employer: 0
		});
	});

	it('withholding: the voluntary pension out of the base, 兼職所得 per payment, the meal exemption and over-limit overtime', () => {
		for (const version of versions) {
			const period = version === 'version_1' ? '2025-12' : '2026-03';
			const at2 = (code: string, wage: number, over: Over = {}) =>
				at(version, code, wage, { period, ...over });
			// 勞退條例 §14(3): 60,000 less a 2,748 voluntary contribution, at 5%.
			assert.deepEqual(
				at2('INCOME_TAX', 60000, {
					charged: { LABOR_PENSION: { employee: 2748, employer: 3600 } }
				}),
				{
					employee: 2862,
					employer: 0
				}
			);
			const partTime = { elections: { INCOME_TAX: { part_time_income: true } } };
			const threshold = version === 'version_1' ? 88501 : 90501;
			assert.deepEqual(
				at2('INCOME_TAX', 95000, { ...partTime, lines: [{ code: 'BASIC', amount: 95000 }] }),
				{
					employee: 4750,
					employer: 0
				}
			);
			assert.deepEqual(
				at2('INCOME_TAX', threshold - 1, {
					...partTime,
					lines: [{ code: 'BASIC', amount: threshold - 1 }]
				}),
				{ employee: 0, employer: 0 }
			);
			assert.deepEqual(
				at2('INCOME_TAX_BONUS', 100000, {
					...partTime,
					lines: [{ code: 'bonus', amount: 100000 }]
				}),
				{ employee: 0, employer: 0 }
			);
			const line = (code: string, context: Row) => {
				const row = file(version, 'work_catalog').find((item) => item.code === code)!;
				if (evaluateConfigured(String(row.eligibility), context as never) !== true) return 0;
				return (
					Number(evaluateConfigured(String(row.quantity), context as never)) *
					Number(evaluateConfigured(String(row.rate), context as never))
				);
			};
			// 查核準則 §88: NT$3,000 of a meal allowance is exempt; the rest enters the tax base.
			const meal = (amount: number) => ({
				...payslipContext,
				terms: {
					...payslipContext.terms,
					allowances: [{ code: 'MEAL_ALLOWANCE', catalogue_id: '', amount }]
				}
			});
			assert.equal(line('MEAL_TAXABLE_EXCESS', meal(3500)), 500);
			assert.equal(line('MEAL_TAXABLE_EXCESS', meal(2400)), 0);
			const meals = file(version, 'allowance_catalog').find(
				(item) => item.code === 'MEAL_ALLOWANCE'
			)!;
			assert.equal((meals.counts_toward as string[]).includes('INCOME_TAX'), false);
			// 所得稅法 §14 第三類: 30 days × 2 overtime hours = 60 h; the 14 above 46 are taxable — 15,075 × 14/60.
			const sixty = {
				...payslipContext,
				work: ((list) => ({ ...payslipContext.work, holidays: [], days: list, month_days: list }))(
					Array.from({ length: 30 }, (_, i) => ({
						date: `2026-04-${String(i + 1).padStart(2, '0')}`,
						day_type: 'WORK',
						holiday_kind: '',
						worked: true,
						worked_hours: 10,
						overtime_hours: 2,
						intervals: []
					}))
				)
			};
			assert.equal(Number(line('OVERTIME_TAXABLE_EXCESS', sixty).toFixed(2)), 3517.5);
			assert.equal(line('OVERTIME_TAXABLE_EXCESS', payslipContext), 0);
			const overtime = file(version, 'work_catalog').find(
				(item) => item.code === 'OVERTIME_TAXABLE_EXCESS'
			)!;
			assert.deepEqual(
				[overtime.destination, (overtime.counts_toward as string[]).includes('INCOME_TAX')],
				['EMPLOYER', true]
			);
		}
	});

	it('holidays: the 2025 law’s sixteen days are seeded, pay only when worked, hours beyond eight at §24 rates', () => {
		const list = (version: string) =>
			(
				(file(version, 'rule_set').find((row) => row.code === 'public_holidays')!.rules as Row)
					.holidays as Row[]
			).map((holiday) => holiday.date);
		assert.deepEqual(list('version_1'), ['2025-12-25']);
		assert.deepEqual(list('version_2'), [
			'2026-01-01',
			'2026-02-15',
			'2026-02-16',
			'2026-02-17',
			'2026-02-18',
			'2026-02-19',
			'2026-02-28',
			'2026-04-04',
			'2026-04-05',
			'2026-05-01',
			'2026-06-19',
			'2026-09-25',
			'2026-09-28',
			'2026-10-10',
			'2026-10-25',
			'2026-12-25'
		]);
		for (const version of versions) {
			const row = file(version, 'work_catalog').find((item) => item.code === 'HOLIDAY_OVERTIME')!;
			const eleven = {
				...payslipContext,
				work: {
					...payslipContext.work,
					days: [
						{
							date: '2026-03-10',
							day_type: 'WORK',
							holiday_kind: 'PUBLIC_HOLIDAY',
							worked: true,
							worked_hours: 11,
							overtime_hours: 0,
							intervals: []
						}
					]
				}
			};
			assert.equal(
				Number(
					(
						Number(evaluateConfigured(String(row.quantity), eleven as never)) *
						Number(evaluateConfigured(String(row.rate), eleven as never))
					).toFixed(3)
				),
				815.625
			);
		}
	});

	it('leave: the shared half-pay sick pool, unpaid and suspended sickness, by-day parental leave, reduced hours, weekly job search', () => {
		for (const version of versions) {
			const rows = file(version, 'leave_catalog');
			const classes = rows.map((row) => classFromRow(row as never));
			const id = (code: string) => rows.find((row) => row.code === code)!.id as never;
			const balances = (movements: Row[], eventId?: string) =>
				leaveBalances({
					classes,
					movements: movements.map((m) =>
						movementFromRow({ activity: 'TIME_OFF', approval_id: 'a', ...m } as never)
					),
					serviceMonths: 30,
					asOf: '2026-06-30',
					employmentStart: '2023-09-01',
					...(eventId ? { eventId } : {}),
					context: { ...subject(), entry: { facts: {} } } as never
				});
			const available = (code: string, movements: Row[], eventId?: string, view = '') =>
				balances(movements, eventId).find((b) => b.code === code && b.window_key === view)!
					.available;
			const taken = (code: string, from: string, days: number, facts: Row = {}) => ({
				catalog_id: id(code),
				occurred_on: from,
				from,
				days,
				facts
			});
			// 勞工請假規則 §4(3): thirty half-paid days a year shared by outpatient and hospitalised sickness.
			const hospital = [taken('HOSPITALISED_SICK_LEAVE', '2026-02-02', 20)];
			assert.equal(available('SICK_LEAVE', hospital), 10);
			assert.equal(available('HOSPITALISED_SICK_LEAVE', hospital), 10);
			// 性平法 §14: three menstrual days a year are outside the pool; the fourth and fifth come out of it.
			const menstrual = ['01', '02', '03', '04', '05'].map((m) =>
				taken('MENSTRUAL_LEAVE', `2026-${m}-05`, 1)
			);
			assert.equal(available('SICK_LEAVE', menstrual), 28);
			// §4(1)(2): one year of sickness in any two; the unpaid remainder after 20 + 25 days.
			const two = [
				taken('SICK_LEAVE', '2026-01-05', 20),
				taken('HOSPITALISED_SICK_LEAVE', '2025-09-01', 25)
			];
			assert.equal(available('SICK_LEAVE_UNPAID', two), 320);
			assert.equal(available('SICK_LEAVE_SUSPENSION', [], 'ill-1'), 365);
			// 育嬰留職停薪實施辦法 (2026): thirty days by the day per child, inside the two-year leave.
			const daily = [taken('PARENTAL_LEAVE_BY_DAY', '2026-03-02', 3, { event_id: 'c1' })];
			assert.equal(available('PARENTAL_LEAVE_BY_DAY', daily, 'c1'), 27);
			// 性平法 §20: seven family-care days a year by the hour (seven eight-hour days = 56 hours).
			assert.equal(
				available('FAMILY_CARE_LEAVE', [taken('FAMILY_CARE_LEAVE', '2026-03-02', 2)]),
				54
			);
			// 勞基法 §16(2): two job-search days in each week of the notice.
			const search = [
				taken('JOB_SEARCH_LEAVE', '2026-03-02', 1),
				taken('JOB_SEARCH_LEAVE', '2026-03-04', 1)
			];
			assert.equal(available('JOB_SEARCH_LEAVE', search, undefined, '2026-03-02'), 0);
			const eligible = (code: string, over: Parameters<typeof subject>[0]) =>
				evaluateConfigured(
					String(rows.find((row) => row.code === code)!.eligibility),
					admission(over) as never
				);
			// 性平法 §19: an employer of thirty or more, a child under three.
			const toddler = { children: [{ child_birthdate: '2024-06-01', relationship: 'CHILD' }] };
			assert.equal(
				eligible('CHILDCARE_REDUCED_HOURS', { company: { headcount: 30 }, employee: toddler }),
				true
			);
			assert.equal(
				eligible('CHILDCARE_REDUCED_HOURS', { company: { headcount: 29 }, employee: toddler }),
				false
			);
			assert.equal(
				eligible('CHILDCARE_REDUCED_HOURS', {
					company: { headcount: 30 },
					employee: { children: [{ child_birthdate: '2022-01-01', relationship: 'CHILD' }] }
				}),
				false
			);
			const exit = (exit_ground: string, exit_facts: Row = {}) => ({
				employment: { exit_date: '2026-04-30', exit_ground, exit_facts }
			});
			assert.equal(eligible('JOB_SEARCH_LEAVE', exit('REDUNDANCY')), true);
			assert.equal(
				eligible('JOB_SEARCH_LEAVE', exit('RESIGNATION', { lsa_termination_ground: 'ARTICLE_14' })),
				false
			);
			assert.equal(eligible('PARENTAL_LEAVE_BY_DAY', { employment: { service_months: 5 } }), false);
			assert.equal(eligible('PARENTAL_LEAVE', { employment: { service_months: 6 } }), true);
			assert.equal(eligible('PARENTAL_LEAVE', { employment: { service_months: 5 } }), false);
			// Paid as working time or with pay, unpaid by law: the class flags the work lines read.
			const flag = (code: string) => rows.find((row) => row.code === code)!.is_npl;
			assert.deepEqual(
				[
					'BREASTFEEDING_TIME',
					'OFFICIAL_LEAVE',
					'PUBLIC_HOLIDAY_IN_LIEU',
					'OCCUPATIONAL_INJURY_LEAVE',
					'STATUTORY_REST_IN_LIEU'
				].map(flag),
				[false, false, false, false, false]
			);
			assert.deepEqual(
				[
					'CHILDCARE_REDUCED_HOURS',
					'NATURAL_DISASTER_ABSENCE',
					'SICK_LEAVE_UNPAID',
					'SICK_LEAVE_SUSPENSION'
				].map(flag),
				[true, true, true, true]
			);
		}
	});

	it('the full-attendance bonus loses only bonus ÷ 30 a sick or personal day (勞工請假規則 §9)', () => {
		for (const version of versions) {
			const row = file(version, 'allowance_catalog').find(
				(item) => item.code === 'FULL_ATTENDANCE_BONUS'
			)!;
			const bonus = (rows: Row[]) =>
				Number(
					evaluateConfigured(String(row.amount), {
						...payslipContext,
						allowance: { code: 'FULL_ATTENDANCE_BONUS', amount: 3000 },
						leave: { rows }
					} as never)
				);
			const off = (code: string, days: number) => ({
				code,
				activity: 'TIME_OFF',
				days,
				is_npl: false,
				pay_fraction: 1
			});
			assert.equal(bonus([]), 3000);
			assert.equal(bonus([off('SICK_LEAVE', 2)]), 2800);
			assert.equal(bonus([off('PERSONAL_LEAVE', 1), off('SICK_LEAVE', 2)]), 2700);
			// §9(1) and 性平法 §21(2): protected leaves take nothing.
			for (const code of [
				'MARRIAGE_LEAVE',
				'BEREAVEMENT_LEAVE',
				'OFFICIAL_LEAVE',
				'MENSTRUAL_LEAVE',
				'MATERNITY_LEAVE',
				'FAMILY_CARE_LEAVE',
				'PATERNITY_LEAVE',
				'NATURAL_DISASTER_ABSENCE'
			])
				assert.equal(bonus([off(code, 2)]), 3000, code);
		}
	});

	it('validations: working time, child and night work, pregnancy wage, deductions', () => {
		for (const version of versions) {
			const rows = file(version, 'rule_set');
			const check = (code: string) => rows.find((row) => row.code === code)!.rules as Row;
			const trips = (code: string, context: Row) =>
				evaluateConfigured(String(check(code).when), context as never);
			const day = (
				date: string,
				day_type: string,
				intervals: [string, string][],
				worked_hours = 8,
				scheduled_hours = 8
			) => ({
				date,
				day_type,
				holiday_kind: '',
				worked: worked_hours > 0,
				worked_hours,
				overtime_hours: 0,
				scheduled_hours,
				intervals: intervals.map(([start, end]) => ({
					start: `${date}T${start}`,
					end:
						end < start
							? `2026-03-${String(Number(date.slice(8)) + 1).padStart(2, '0')}T${end}`
							: `${date}T${end}`
				}))
			});
			const slip = (days: Row[], over: Parameters<typeof subject>[0] = {}, extra: Row = {}) => ({
				...payslipContext,
				...subject(over),
				work: { ...payslipContext.work, days },
				payslip: { gross: 45000, net: 40000, lines: {} },
				statutory: {},
				...extra
			});
			const split = (date: string) =>
				day(date, 'WORK', [
					['08:00', '12:00'],
					['13:00', '17:00']
				]);
			// 勞基法 §44–§48: a 15-year-old's nine-hour day or evening work.
			assert.equal(
				trips(
					'CHILD_WORKER_LIMITS',
					slip(
						[
							day(
								'2026-03-02',
								'WORK',
								[
									['08:00', '12:00'],
									['13:00', '18:00']
								],
								9
							)
						],
						{ employee: { age: 15 } }
					)
				),
				true
			);
			assert.equal(
				trips(
					'CHILD_WORKER_LIMITS',
					slip(
						[
							day(
								'2026-03-02',
								'WORK',
								[
									['14:00', '18:00'],
									['18:30', '20:30']
								],
								6
							)
						],
						{ employee: { age: 15 } }
					)
				),
				true
			);
			assert.equal(
				trips('CHILD_WORKER_LIMITS', slip([split('2026-03-02')], { employee: { age: 17 } })),
				false
			);
			assert.equal(
				evaluateConfigured(String(check('UNDER_FIFTEEN_EMPLOYMENT').when), {
					...subject({ employee: { age: 14 } }),
					term: {}
				} as never),
				true
			);
			assert.equal(
				evaluateConfigured(String(check('UNDER_FIFTEEN_EMPLOYMENT').when), {
					...subject({
						employee: { age: 14 },
						terms: { facts: { under_15_exception_reference: 'permit 1' } }
					}),
					term: {}
				} as never),
				false
			);
			// §49: a woman between 22:00 and 06:00 needs the consent.
			const late = [
				day('2026-03-02', 'WORK', [
					['15:00', '19:00'],
					['19:30', '23:30']
				])
			];
			assert.equal(trips('WOMEN_NIGHT_WORK', slip(late, { employee: { gender: 'FEMALE' } })), true);
			assert.equal(
				trips(
					'WOMEN_NIGHT_WORK',
					slip(late, {
						employee: { gender: 'FEMALE' },
						company: { facts: { women_night_work_consent: true } }
					})
				),
				false
			);
			assert.equal(trips('WOMEN_NIGHT_WORK', slip(late, { employee: { gender: 'MALE' } })), false);
			// §34(2): 23:00 to 06:00 is seven hours of rest; 23:00 to 10:00 is eleven.
			const closing = day('2026-03-02', 'WORK', [
				['14:00', '18:00'],
				['19:00', '23:00']
			]);
			assert.equal(
				trips(
					'REST_BETWEEN_SHIFTS',
					slip([
						closing,
						day('2026-03-03', 'WORK', [
							['06:00', '10:00'],
							['11:00', '15:00']
						])
					])
				),
				true
			);
			assert.equal(
				trips(
					'REST_BETWEEN_SHIFTS',
					slip([
						closing,
						day('2026-03-03', 'WORK', [
							['10:00', '14:00'],
							['15:00', '19:00']
						])
					])
				),
				false
			);
			// §35: four and a half hours without a break.
			assert.equal(
				trips(
					'BREAK_AFTER_FOUR_HOURS',
					slip([day('2026-03-02', 'WORK', [['08:00', '12:30']], 4.5)])
				),
				true
			);
			assert.equal(trips('BREAK_AFTER_FOUR_HOURS', slip([split('2026-03-02')])), false);
			// §36: seven working days in a row; §30: nine scheduled hours a day.
			const week = (types: string[]) =>
				types.map((type, i) =>
					day(
						`2026-03-0${i + 2}`,
						type,
						type === 'WORK'
							? [
									['08:00', '12:00'],
									['13:00', '17:00']
								]
							: [],
						type === 'WORK' ? 8 : 0,
						type === 'WORK' ? 8 : 0
					)
				);
			assert.equal(
				trips(
					'SEVEN_DAY_REST',
					slip(week(['WORK', 'WORK', 'WORK', 'WORK', 'WORK', 'WORK', 'WORK']))
				),
				true
			);
			assert.equal(
				trips(
					'SEVEN_DAY_REST',
					slip(week(['WORK', 'WORK', 'WORK', 'WORK', 'WORK', 'OFF', 'REST']))
				),
				false
			);
			assert.equal(
				trips(
					'SEVEN_DAY_REST',
					slip(week(['WORK', 'WORK', 'WORK', 'WORK', 'WORK', 'WORK', 'WORK']), {
						company: { facts: { flexible_working_time: true } }
					})
				),
				false
			);
			assert.equal(
				trips(
					'NORMAL_HOURS',
					slip([
						day(
							'2026-03-02',
							'WORK',
							[
								['08:00', '12:00'],
								['13:00', '18:00']
							],
							9,
							9
						)
					])
				),
				true
			);
			assert.equal(
				trips('NORMAL_HOURS', slip(week(['WORK', 'WORK', 'WORK', 'WORK', 'WORK', 'OFF', 'REST']))),
				false
			);
			// §51: a pregnant worker's base salary may not fall.
			const pregnant = {
				employee: { children: [{ estimated_delivery_date: '2026-08-01', relationship: 'CHILD' }] }
			};
			assert.equal(
				trips(
					'PREGNANCY_WAGE_PROTECTION',
					slip([], pregnant, { earned: { previous_month: { base_salary: 46000 } } })
				),
				true
			);
			assert.equal(
				trips(
					'PREGNANCY_WAGE_PROTECTION',
					slip([], pregnant, { earned: { previous_month: { base_salary: 45000 } } })
				),
				false
			);
			// §22(2), §26 and 強制執行法 §115-1: deductions.
			const lines = (l: Row) => slip([], {}, { payslip: { gross: 45000, net: 40000, lines: l } });
			assert.equal(trips('NO_PENALTY_DEDUCTION', lines({ PENALTY: -500 })), true);
			assert.equal(
				trips(
					'NO_PENALTY_DEDUCTION',
					lines({ COURT_GARNISHMENT: -500, NO_PAY_LEAVE: -1500, SALARY_ADVANCE: -1000 })
				),
				false
			);
			assert.equal(trips('GARNISHMENT_ONE_THIRD', lines({ COURT_GARNISHMENT: -16000 })), true);
			assert.equal(trips('GARNISHMENT_ONE_THIRD', lines({ COURT_GARNISHMENT: -15000 })), false);
			const migrant = (deducted: number) =>
				slip(
					[],
					{ employee: { facts: { food_lodging_monthly_cap: 4000 } } },
					{ payslip: { gross: 30000, net: 25000, lines: { FOOD_LODGING: -deducted } } }
				);
			assert.equal(trips('FOOD_LODGING_CAP', migrant(4500)), true);
			assert.equal(trips('FOOD_LODGING_CAP', migrant(4000)), false);
			assert.deepEqual(
				[check('FOOD_LODGING_CAP').kind, check('UNDER_FIFTEEN_EMPLOYMENT').kind],
				['refuse', 'refuse']
			);
		}
	});

	it('tasks on their facts: involuntary separation, foreign workers, the disabled quota, parental insurance', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = settings.behaviours as Behaviours;
			const rows = file(version, 'rule_set');
			const company = { region: '', risk_class: '42', facts: {} };
			const codes = (
				collection: string,
				event: string,
				row: Row,
				reads: Row = {},
				headcount = 10,
				run?: Row
			) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection,
					event,
					row,
					headcount,
					...(run ? { run } : collection === 'payroll_run' ? { run: runOf(rows) } : {}),
					reads: {
						company: [company],
						employee: [
							{ nationality: 'TW', gender: 'MALE', date_of_birth: '1990-01-01', facts: {} }
						],
						...reads
					}
				}).map((write) => [String(write.duty_code), String(write.due_on)]);
			const left = (row: Row) => ({
				id: 'k1',
				company_id: 'c1',
				approval_id: null,
				effective_range: { from: '2024-03-02', to: '2026-06-30' },
				exit_facts: {},
				...row
			});
			const has = (list: string[][], code: string) => list.find(([duty]) => duty === code)?.[1];
			assert.equal(
				has(
					codes('employment_contract', 'updated', left({ exit_ground: 'REDUNDANCY' })),
					'INVOLUNTARY_SEPARATION_CERTIFICATE'
				),
				'2026-06-30'
			);
			assert.equal(
				has(
					codes('employment_contract', 'updated', left({ exit_ground: 'RESIGNATION' })),
					'INVOLUNTARY_SEPARATION_CERTIFICATE'
				),
				undefined
			);
			assert.equal(
				has(
					codes('employment_contract', 'updated', left({ exit_ground: 'RESIGNATION' })),
					'SERVICE_CERTIFICATE'
				),
				'2026-06-30'
			);
			const foreign = {
				employee: [{ nationality: 'VN', gender: 'MALE', date_of_birth: '1990-01-01', facts: {} }]
			};
			assert.equal(
				has(
					codes(
						'employment_contract',
						'updated',
						left({ exit_ground: 'END_OF_CONTRACT' }),
						foreign
					),
					'FOREIGN_WORKER_SEPARATION_NOTICE'
				),
				'2026-07-03'
			);
			assert.equal(
				has(
					codes('employment_contract', 'updated', left({ exit_ground: 'END_OF_CONTRACT' })),
					'FOREIGN_WORKER_SEPARATION_NOTICE'
				),
				undefined
			);
			const absent = (days: number) =>
				has(
					codes(
						'roster_entry',
						'updated',
						{
							id: 'r1',
							approval_id: null,
							company_id: 'c1',
							employment_id: 'k1',
							employee_id: 'p1',
							work_date: '2026-03-12',
							facts: { absent_without_contact: true, consecutive_absent_days: days }
						},
						foreign
					),
					'FOREIGN_WORKER_ABSENCE_NOTICE'
				);
			assert.equal(absent(3), '2026-03-16');
			assert.equal(absent(2), undefined);
			const run = (headcount: number, disabled: number) =>
				has(
					codes(
						'payroll_run',
						'created',
						{ id: 'r1', company_id: 'c1', period: '2026-03', approval_id: null },
						{ company: [{ ...company, facts: { disabled_employees_counted: disabled } }] },
						headcount
					),
					'DISABLED_EMPLOYMENT_QUOTA_LEVY'
				);
			assert.equal(run(67, 0), '2026-04-10');
			assert.equal(run(67, 1), undefined);
			assert.equal(run(250, 1), '2026-04-10');
			assert.equal(run(66, 0), undefined);
			assert.equal(
				has(
					codes('leave_catalog_entry', 'created', {
						id: 'l1',
						approval_id: null,
						company_id: 'c1',
						employment_id: 'k1',
						occurred_on: '2026-03-09',
						catalog_code: 'PARENTAL_LEAVE_BY_DAY',
						facts: {}
					}),
					'PARENTAL_LEAVE_INSURANCE_CONTINUATION'
				),
				'2026-03-09'
			);
			assert.equal(
				has(
					codes(
						'payroll_run',
						'created',
						{ id: 'r1', company_id: 'c1', period: '2026-03', approval_id: null },
						{},
						10,
						{
							totals: {
								gross: 0,
								net: 0,
								employer_cost: 0,
								schemes: {
									NHI_SUPPLEMENT_EMPLOYER: { employee: 0, employer: 627, base: 105000 }
								}
							},
							statutory: {
								NHI_SUPPLEMENT_EMPLOYER: {
									base: 105000,
									employee: 0,
									employer: 627,
									charged_base: 76100,
									parts: {}
								}
							}
						}
					),
					'NHI_EMPLOYER_SUPPLEMENTARY_PREMIUM'
				),
				'2026-04-30'
			);
		}
	});

	it('a run with allowances, a reimbursement, an advance, a garnishment and an insurer offset', async () => {
		const { tables, run, lines } = tw();
		const contract = tables.get('employment_contract')!.find((row) => row.id === 'k-p1')!;
		const term = ((contract.facts as Row).contract_terms as Row[])[0]!;
		term.base_salary = { value: 40000, currency: 'TWD' };
		term.allowances = [
			{ code: 'MEAL_ALLOWANCE', amount: { value: 3000 } },
			{ code: 'FULL_ATTENDANCE_BONUS', amount: { value: 2000 } }
		];
		const entryOf = (table: string, catalog: string, code: string, id: string, amount: number) => {
			const row = file('version_2', catalog).find((item) => item.code === code)!;
			tables.get(table)!.push({
				id,
				catalog_id: row.id,
				employment_id: 'k-p1',
				company_id: tables.get('entity')![0]!.id,
				approval_id: null,
				payslip_id: null,
				occurred_on: '2026-03-20',
				amount,
				activity: 'AWARD'
			});
		};
		entryOf('claim_catalog_entry', 'claim_catalog', 'BUSINESS_EXPENSE_REIMBURSEMENT', 'c1', 5000);
		entryOf('loan_catalog_entry', 'loan_catalog', 'SALARY_ADVANCE', 'n1', 3000);
		entryOf('adhoc_catalog_entry', 'adhoc_catalog', 'COURT_GARNISHMENT', 'g1', 1000);
		entryOf('adhoc_catalog_entry', 'adhoc_catalog', 'OCC_INJURY_OFFSET', 'o1', 500);
		const plan = await run('2026-03', 'REGULAR');
		const mei = plan.payslips.find((slip) => slip.employment_id === 'k-p1')!;
		const got = lines(mei);
		// The 45,000 monthly wage (allowances are 工資) sits in the 45,800 grade; the meal allowance is outside the tax base.
		assert.deepEqual(got.LI, [1053, 3687]);
		assert.deepEqual(got.NHI, [710, 2216]);
		assert.deepEqual(got.LABOR_PENSION, [0, 2748]);
		assert.deepEqual(got.INCOME_TAX, [2100, 0]);
		// §34: salary 45,000 below the 45,800 insured amount owes nothing on this slip (never a negative share).
		assert.equal(got.NHI_SUPPLEMENT_EMPLOYER, undefined);
		// …while the slip records its salary (base) and its insured amount (charged_base) for the unit's netted remittance.
		const unit = (mei.statutory as unknown as Row[]).find(
			(line) => line.scheme_code === 'NHI_SUPPLEMENT_EMPLOYER'
		)!;
		assert.deepEqual(
			[unit.base_amount, unit.charged_base, unit.employer_amount],
			[42000, 45800, 0]
		);
		assert.equal(mei.gross, 45000);
		// NET lines move only the net: +5,000 reimbursed, −3,000 advance, −1,000 garnished, −500 offset.
		assert.equal(mei.net, 45000 - 1053 - 92 - 710 - 2100 + 5000 - 3000 - 1000 - 500);
	});

	it('NHI supplementary premium: 2.11% of the year’s bonus above four times the insured grade', () => {
		const bonus = (additional: number, year: number) =>
			at('version_2', 'NHI_SUPPLEMENT', 45800, { additional, year });
		assert.deepEqual(bonus(200000, 0), { employee: 354, employer: 0 });
		assert.deepEqual(bonus(100000, 0), { employee: 0, employer: 0 });
		assert.deepEqual(bonus(50000, 150000), { employee: 354, employer: 0 });
		assert.deepEqual(bonus(0, 0), { employee: 0, employer: 0 });
	});

	it('work lines and separation / injury pay price as the records state', () => {
		for (const version of versions) {
			const work = (code: string) => {
				const row = file(version, 'work_catalog').find((item) => item.code === code)!;
				if (evaluateConfigured(String(row.eligibility), payslipContext as never) !== true) return 0;
				return (
					Number(evaluateConfigured(String(row.quantity), payslipContext as never)) *
					Number(evaluateConfigured(String(row.rate), payslipContext as never))
				);
			};
			// Base 45,000: a day is 1/30 of the month (1,500), an hour 1/8 of the day.
			assert.equal(work('BASIC'), 45000);
			// 勞動2字第1020083156號: a part month is the days employed at monthly ÷ 30 (or ÷ the calendar days by agreement).
			const part = (calendar: boolean) => {
				const c = {
					...payslipContext,
					company: {
						...(payslipContext.company as Row),
						facts: { day_wage_calendar_days: calendar }
					},
					period: { ...payslipContext.period, paid_days: 15 }
				};
				const basic = file(version, 'work_catalog').find((item) => item.code === 'BASIC')!;
				return (
					Number(evaluateConfigured(String(basic.quantity), c as never)) *
					Number(evaluateConfigured(String(basic.rate), c as never))
				);
			};
			assert.equal(part(false), 22500);
			assert.equal(Number(part(true).toFixed(2)), Number(((45000 / 31) * 15).toFixed(2)));
			// A semi-monthly half (勞基法 §23: at least twice a month unless agreed) pays half the month's salary.
			const half = {
				...payslipContext,
				period: {
					...payslipContext.period,
					key: '2026-03-1',
					days: 15,
					paid_days: 15,
					part: 1,
					parts: 2
				}
			};
			const basic = file(version, 'work_catalog').find((item) => item.code === 'BASIC')!;
			assert.equal(
				Number(evaluateConfigured(String(basic.quantity), half as never)) *
					Number(evaluateConfigured(String(basic.rate), half as never)),
				22500
			);
			// §24(1): 2 h × 1.34 + 1 h × 1.67 at 187.5 an hour; the holiday's hours are §39's, not overtime.
			assert.equal(Number(work('OVERTIME').toFixed(3)), 815.625);
			// §24(2): a 10-hour 休息日 — 2 h × 1.34 + 6 h × 1.67 + 2 h × 2.67.
			assert.equal(Number(work('REST_DAY_WORK').toFixed(2)), 3382.5);
			assert.equal(work('STATUTORY_REST_WORK'), 1500); // §40: one further day's wage
			assert.equal(work('HOLIDAY_WORK'), 1500); // §39: one further day's wage
			assert.equal(work('NO_PAY_LEAVE'), 1500);
			assert.equal(work('PARTIAL_PAY_LEAVE'), 1500); // 勞工請假規則 §4(3): 2 sick days at half pay
			// 勞基法 §50(2): maternity at half pay under six months' service; an early miscarriage leave is unpaid.
			const maternity = String(
				file(version, 'leave_catalog').find((item) => item.code === 'MATERNITY_LEAVE')!.pay_fraction
			);
			const fraction = (service_months: number, event_kind: string) =>
				evaluateConfigured(maternity, {
					...admission({ employment: { service_months } }, { event_kind })
				} as never);
			assert.deepEqual(
				[fraction(3, 'BIRTH'), fraction(6, 'BIRTH'), fraction(30, 'MISCARRIAGE_UNDER_2M')],
				[0.5, 1, 0]
			);
			assert.equal(work('ENCASHMENT'), 3000); // §38(4): 2 days × 1,500
			const adhoc = (code: string, facts: Row = ENTRY_FACTS) => {
				const row = file(version, 'adhoc_catalog').find((item) => item.code === code)!;
				const context = { ...payslipContext, entry: entry(facts) };
				return Number(
					evaluateConfigured((row.bands as { amount: string }[])[0]!.amount, context as never)
				);
			};
			// 勞退條例 §12: half a month a year, 30 months → 1.25 months.
			// 勞退條例 §12: half a month a year of new-system service (30 months → 1.25 months).
			assert.equal(adhoc('SEVERANCE_PAY', { average_monthly_wage: 45000 }), 56250);
			// 勞基法 §17 on retained old-system service: 200 old months → 16.67 months, uncapped.
			assert.equal(adhoc('SEVERANCE_PAY'), 750000);
			assert.equal(
				adhoc('SEVERANCE_PAY', { average_monthly_wage: 45000, old_system_service_months: 12 }),
				78750
			);
			// No declared average: the last six months' wages from the payslips (gross less bonus) ÷ their days × 30.
			const sixMonths = {
				...payslipContext,
				earned: {
					...payslipContext.earned,
					months: ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'].map(
						(month) => ({
							month,
							gross: month === '2025-12' ? 95000 : 45000,
							bonus: month === '2025-12' ? 50000 : 0
						})
					)
				},
				entry: entry({})
			};
			const severance = file(version, 'adhoc_catalog').find(
				(item) => item.code === 'SEVERANCE_PAY'
			)!;
			assert.equal(
				Number(
					evaluateConfigured(
						(severance.bands as { amount: string }[])[0]!.amount,
						sixMonths as never
					)
				),
				Math.round(((6 * 45000) / 181) * 30 * 1.25)
			);
			// 勞基法 §55: 200 old-system months = 16 years 8 months → 17 units → 30 + 2 = 32 bases.
			assert.equal(adhoc('RETIREMENT_PAY'), 32 * 45000);
			// 勞基法 §53–54: who may retire.
			const retire = (age: number, months: number, exit_facts: Row = {}) =>
				evaluateConfigured(
					String(
						file(version, 'adhoc_catalog').find((item) => item.code === 'RETIREMENT_PAY')!
							.eligibility
					),
					admission({
						employee: { age },
						employment: {
							exit_date: '2026-03-31',
							exit_ground: 'RETIREMENT',
							service_months: months,
							exit_facts
						}
					}) as never
				);
			assert.deepEqual(
				[
					retire(55, 180),
					retire(54, 299),
					retire(40, 300),
					retire(60, 120),
					retire(59, 179),
					retire(65, 1)
				],
				[true, false, true, true, false, true]
			);
			assert.equal(retire(40, 12, { retirement_disability: true }), true);
			assert.equal(adhoc('OCC_DISABILITY_G01'), 1800 * 1500);
			assert.equal(adhoc('OCC_DISABILITY_G15'), 45 * 1500);
			assert.equal(adhoc('OCC_INJURY_LUMP_SUM'), 40 * 45000);
			assert.equal(adhoc('OCC_DEATH_FUNERAL'), 5 * 45000);
			assert.equal(adhoc('OCC_DEATH_COMPENSATION'), 40 * 45000);
		}
	});

	it('annual leave bands follow 勞基法 §38; the women-only classes read the gender', () => {
		const annual = file('version_2', 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE')!;
		const bands = (annual.entitlement as { bands: { service_months: number; days: number }[] })
			.bands;
		const days = (months: number) => bands.find((band) => months >= band.service_months)!.days;
		assert.deepEqual(
			[5, 6, 12, 24, 36, 60, 119, 120, 132, 288, 400].map(days),
			[0, 3, 7, 10, 14, 15, 15, 16, 17, 30, 30]
		);
		assert.equal(annual.encash_on_exit, true);
		for (const version of versions)
			for (const code of ['MATERNITY_LEAVE', 'MENSTRUAL_LEAVE', 'PRENATAL_CHECKUP_LEAVE']) {
				const row = file(version, 'leave_catalog').find((item) => item.code === code)!;
				const eligible = (gender: string) =>
					evaluateConfigured(String(row.eligibility), admission({ employee: { gender } }) as never);
				assert.deepEqual(
					[eligible('FEMALE'), eligible('MALE'), eligible('')],
					[true, false, false],
					code
				);
			}
	});

	it('the exit encashment behaviour credits the §38 days less those taken', () => {
		for (const version of versions) {
			const behaviours = settingsOf(version).behaviours as Behaviours;
			const leave = file(version, 'leave_catalog');
			const catalogues = leave
				.filter((row) => row.encash_on_exit === true)
				.map((row) => ({
					id: row.id,
					code: row.code,
					unit: row.unit,
					entitlement: row.entitlement ?? null
				}));
			const annual = leave.find((row) => row.code === 'ANNUAL_LEAVE')!;
			for (const [to, expected] of [
				['2026-03-31', 7 - 2],
				['2025-10-31', 3 - 2],
				['2025-06-30', 0],
				['2025-07-15', 3 - 2]
			] as const) {
				const context = {
					event: {
						row: {
							id: 'k1',
							approval_id: null,
							exit_facts: {},
							prior_service_months: null,
							effective_range: { from: '2025-01-01', to }
						},
						settings_id: settingsOf(version).id
					},
					catalogues,
					movements: [
						{
							catalog_id: annual.id,
							activity: 'TIME_OFF',
							days: 2,
							occurred_on: to,
							reference: null
						}
					]
				};
				const [rule] = planBehaviours(
					behaviours,
					{ kind: 'row', collection: 'employment_contract', event: 'updated' },
					context
				).filter((candidate) => candidate.id === 'encash-leave-on-exit');
				const writes = effectWrites(rule!, withBalances(context));
				assert.deepEqual(
					writes.map((write) => (write.data as { days: number }).days),
					expected > 0 ? [expected] : []
				);
			}
		}
	});

	it('every OBLIGATIONS row is one dated duty whose due evaluates for its trigger', () => {
		const contexts: Record<string, Row> = {
			PAYROLL_RUN: {
				period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' },
				holidays: []
			},
			HIRE: { hired_on: '2026-03-02', holidays: [] },
			EXIT: {
				exit_on: '2026-06-30',
				holidays: [],
				separations: [],
				headcount: 10,
				headcount_permanent: 10,
				headcount_by_worksite: {},
				headcount_permanent_by_worksite: {}
			},
			'calendar.daily': { today: '2026-03-01', holidays: [] },
			'leave_catalog_entry.created': { today: '2026-03-10', holidays: [] },
			'roster_entry.updated': { today: '2026-03-10', holidays: [] },
			'workplace_case.created': {
				row: { kind: 'OCCUPATIONAL_ACCIDENT', opened_on: '2026-03-10', facts: {} },
				today: '2026-03-10',
				holidays: []
			},
			'workplace_case.updated': {
				row: { kind: 'OCCUPATIONAL_ACCIDENT', opened_on: '2026-03-10', facts: {}, before: {} },
				today: '2026-03-12',
				holidays: []
			},
			'entity.updated': {
				row: { name: 'Formosa Ltd', facts: {}, before: { name: 'Formosa' } },
				today: '2026-03-10',
				holidays: []
			},
			'work_suspension.created': {
				row: { kind: 'REDUCED_WORK_AGREEMENT', starts_on: '2026-04-01', ends_on: '2026-06-30' },
				today: '2026-04-01',
				holidays: []
			},
			'obligation.updated': {
				row: { state: 'FULFILLED', due_on: '2026-04-30', fulfilled_on: '2026-05-20' },
				today: '2026-05-20',
				holidays: []
			}
		};
		const month = (key: string) => ({
			holidays: [],
			period: {
				key,
				from: `${key}-01`,
				to: String(evaluateConfigured(`month_end("${key}-01")`, {}))
			}
		});
		for (const version of versions) {
			const duties = dutiesOf(file(version, 'rule_set')).map((duty) => ({
				...duty,
				rules: { ...(duty.rules as Row), trigger: triggerOf(duty) }
			}));
			assert.equal(duties.length, version === 'version_1' ? 64 : 65, version);
			const due = (code: string, context: Row) =>
				evaluateConfigured(
					String((duties.find((duty) => duty.code === code)!.rules as Row).due),
					context as never
				);
			for (const duty of duties) {
				const rules = duty.rules as Row;
				assert.deepEqual(
					Object.keys(rules).filter((key) => ![...DUTY_KEYS, 'amount'].includes(key)),
					[],
					`${version} ${String(duty.code)}`
				);
				assert.ok(String(rules.description).length > 0 && String(rules.authority).length > 0);
				assert.ok(
					[
						'PAYROLL_RUN',
						'HIRE',
						'EXIT',
						'calendar.daily',
						'leave_catalog_entry.created',
						'roster_entry.updated',
						'workplace_case.created',
						'workplace_case.updated',
						'work_suspension.created',
						'entity.updated',
						'obligation.updated'
					].includes(String(rules.trigger)),
					String(duty.code)
				);
				if (rules.months !== undefined)
					assert.ok(
						(rules.months as string[]).every((m) => /^(0[1-9]|1[0-2])$/.test(m)),
						String(duty.code)
					);
				assert.match(
					String(due(String(duty.code), contexts[String(rules.trigger)]!)),
					/^\d{4}-\d{2}-\d{2}$/
				);
				if (rules.applies_when !== undefined)
					assert.equal(
						typeof evaluateConfigured(String(rules.applies_when), {
							...contexts[String(rules.trigger)]!,
							company: { region: '', risk_class: '42', facts: {} },
							contract: {
								exit_ground: null,
								exit_facts: {},
								effective_range: { from: '2026-03-02', to: null }
							},
							employee: { nationality: 'TW', gender: '', date_of_birth: '', facts: {} },
							headcount: 10
						} as never),
						'boolean',
						String(duty.code)
					);
			}
			// An annual duty is evaluated in its own (first) month of 2026; the rest in March 2026, on 2 March, on 30 June.
			const expected: Record<string, string> = {
				INSURANCE_PREMIUM_REMITTANCE: '2026-04-30',
				NHI_PREMIUM_REMITTANCE: '2026-04-30',
				NHI_SUPPLEMENTARY_PREMIUM_WITHHOLDING: '2026-04-30',
				LABOUR_PENSION_REMITTANCE: '2026-06-01', // 31 May is a Sunday
				NHI_EMPLOYER_SUPPLEMENTARY_PREMIUM: '2026-04-30',
				SERVICE_CERTIFICATE: '2026-06-30',
				INVOLUNTARY_SEPARATION_CERTIFICATE: '2026-06-30',
				PARENTAL_LEAVE_INSURANCE_CONTINUATION: '2026-03-10',
				FOREIGN_WORKER_SEPARATION_NOTICE: '2026-07-03',
				FOREIGN_WORKER_ABSENCE_NOTICE: '2026-03-13',
				PENSION_CONTRIBUTION_NOTICE: '2026-03-31',
				DISABLED_EMPLOYMENT_QUOTA_LEVY: '2026-04-10',
				WAGE_ROSTER_RETENTION: '2031-03-31',
				ATTENDANCE_RECORDS_RETENTION: '2031-03-31',
				INSURANCE_PENSION_RECORDS_RETENTION: '2031-06-30',
				WITHHOLDING_TAX_REMITTANCE: '2026-04-10',
				WAGE_PAYMENT_AND_PAYSLIP: '2026-03-31',
				ANNUAL_WITHHOLDING_STATEMENTS: '2026-02-02', // 31 January is a Saturday
				WITHHOLDING_CERTIFICATE_ISSUE: '2026-02-10',
				NHI_SUPPLEMENTARY_PREMIUM_STATEMENT: '2026-02-02',
				INSURED_SALARY_ADJUSTMENT_FEBRUARY_JULY: '2026-08-31',
				INSURED_SALARY_ADJUSTMENT_AUGUST_JANUARY: '2026-03-02',
				EMPLOYMENT_STABILISATION_FEE: '2026-02-25',
				LABOUR_MANAGEMENT_CONFERENCE: '2026-03-31',
				OLD_SYSTEM_PENSION_RESERVE_ESTIMATE: '2026-12-31',
				OLD_SYSTEM_PENSION_RESERVE_SHORTFALL: '2026-03-31',
				LABOUR_EMPLOYMENT_INSURANCE_ENROLMENT: '2026-03-02',
				OCCUPATIONAL_ACCIDENT_INSURANCE_ENROLMENT: '2026-03-02',
				NHI_ENROLMENT: '2026-03-05',
				LABOUR_PENSION_REGISTRATION: '2026-03-09',
				EMPLOYMENT_CONTRACT_TERMS: '2026-03-02',
				LABOUR_EMPLOYMENT_INSURANCE_WITHDRAWAL: '2026-06-30',
				OCCUPATIONAL_ACCIDENT_INSURANCE_WITHDRAWAL: '2026-06-30',
				NHI_WITHDRAWAL: '2026-07-03',
				LABOUR_PENSION_DEREGISTRATION: '2026-07-07',
				FINAL_WAGE_SETTLEMENT: '2026-06-30',
				UNUSED_ANNUAL_LEAVE_SETTLEMENT: '2026-06-30',
				OVERTIME_COMP_TIME_SETTLEMENT: '2026-06-30',
				SEVERANCE_PAYMENT: '2026-07-30',
				RETIREMENT_PAYMENT: '2026-07-30',
				LAYOFF_REPORT: '2026-06-20',
				TERMINATION_NOTICE: '2026-06-30',
				FOREIGN_PROFESSIONAL_PENSION_AND_EMPLOYMENT_INSURANCE: '2026-06-30',
				WORK_RULES_FILING: '2026-04-01',
				OCCUPATIONAL_ACCIDENT_REPORT: '2026-03-10',
				OCCUPATIONAL_FATALITY_REPORT: '2026-06-30',
				ANNUAL_LEAVE_YEAR_END_PAYMENT: '2026-03-31',
				COMP_TIME_YEAR_END_PAYMENT: '2026-03-31',
				MASS_LAYOFF_PLAN: '2026-05-01', // 60 days before the exit when no window meets a threshold
				PERSONAL_DATA_DISPOSAL: '2032-05-15',
				EMERGENCY_OVERTIME_NOTICE: '2026-03-11',
				WORK_ACCIDENT_REPORT: '2026-03-10',
				WORK_ACCIDENT_REPORT_UPDATED: '2026-03-12',
				REDUCED_HOURS_NOTICE: '2026-04-01', // labelled default: the first reduced day
				LI_UNIT_CHANGE: '2026-04-09',
				ANNUAL_LEAVE_ENTITLEMENT_NOTICE: '2026-03-31',
				ANNUAL_LEAVE_WRITTEN_STATEMENT: '2026-03-31',
				SEXUAL_HARASSMENT_COMPLAINT_CHANNEL: '2026-03-02',
				SEXUAL_HARASSMENT_PREVENTION_RULES: '2026-03-02',
				PERSONAL_DATA_COLLECTION_NOTICE: '2026-03-02',
				NHI_UNIT_CHANGE: '2026-03-25',
				INSURANCE_PREMIUM_LATE_SURCHARGE: '2026-05-20',
				NHI_LATE_SURCHARGE: '2026-05-20',
				LABOUR_PENSION_LATE_SURCHARGE: '2026-05-20',
				WITHHOLDING_TAX_LATE_SURCHARGE: '2026-05-20'
			};
			for (const duty of duties) {
				const rules = duty.rules as { trigger: string; months?: string[] };
				const context =
					rules.months === undefined ? contexts[rules.trigger]! : month(`2026-${rules.months[0]!}`);
				assert.equal(
					due(String(duty.code), context),
					expected[String(duty.code)],
					String(duty.code)
				);
			}
			assert.equal(due('INSURED_SALARY_ADJUSTMENT_AUGUST_JANUARY', month('2028-02')), '2028-02-29');
			// 稅捐稽徵法 / 行政程序法 §48(4): September's withholding falls due on Saturday 10 October, a holiday — Monday the 12th.
			assert.equal(
				due('WITHHOLDING_TAX_REMITTANCE', { ...month('2026-09'), holidays: ['2026-10-10'] }),
				'2026-10-12'
			);
			// A published holiday on the last day moves the deadline to the next working day; same-day duties do not move.
			assert.equal(
				due('NHI_ENROLMENT', { hired_on: '2026-03-02', holidays: ['2026-03-05'] }),
				'2026-03-06'
			);
			assert.equal(
				due('LABOUR_EMPLOYMENT_INSURANCE_ENROLMENT', { hired_on: '2026-03-07', holidays: [] }),
				'2026-03-07'
			);
		}
	});

	it('the canonical obligation behaviours raise one obligation per duty for their trigger', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = settings.behaviours as Behaviours;
			const ids = (behaviours as unknown as { rules: { id: string }[] }).rules.map(
				(rule) => rule.id
			);
			for (const id of ['raise-obligations', 'raise-tasks'])
				assert.equal(ids.filter((candidate) => candidate === id).length, 1, `${version} ${id}`);
			const rows = file(version, 'rule_set');
			const duties = dutiesOf(rows).map((item) => ({
				code: item.code,
				rules: { ...(item.rules as Row), trigger: triggerOf(item) }
			}));
			const count = (trigger: string, month?: string) =>
				duties.filter((duty) => {
					const rules = duty.rules as { trigger: string; months?: string[] };
					return (
						rules.trigger === trigger &&
						(rules.months === undefined || (month !== undefined && rules.months.includes(month)))
					);
				}).length;
			const company = { region: '', risk_class: '42', facts: {} };
			const employee = {
				nationality: 'TW',
				gender: 'FEMALE',
				date_of_birth: '1990-02-01',
				facts: {}
			};
			const raise = (collection: string, event: string, row: Row, reads: Row = {}) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection,
					event,
					row,
					...(collection === 'payroll_run' ? { run: runOf(rows) } : {}),
					reads: { company: [company], employee: [employee], ...reads }
				});
			const run = (period: string, reads: Row = {}) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r1', company_id: 'c1', period, approval_id: null },
					reads
				);
			const april = run('2026-04');
			// The disabled-quota levy falls only on an employer of 67 or more below its quota; the §34 premium is the
			// run's netted total, nil on these totals (no salary base), so it is not raised.
			assert.equal(april.length, count('PAYROLL_RUN') - 2);
			assert.equal(april.length, 9);
			assert.equal(
				april.find((write) => write.duty_code === 'WITHHOLDING_TAX_REMITTANCE')!.due_on,
				'2026-05-11' // 10 May is a Sunday
			);
			assert.ok(
				april.every((write) => write.company_id === 'c1' && write.triggered_on === '2026-04-01')
			);
			const january = run('2027-01');
			assert.equal(january.length, count('PAYROLL_RUN', '01') - 2);
			assert.equal(
				january.find((write) => write.duty_code === 'WITHHOLDING_CERTIFICATE_ISSUE')!.due_on,
				'2027-02-10'
			);
			// The stabilisation fee falls only on an entity that employs §46(1)(8)–(10) foreign workers.
			const levy = {
				company: [{ ...company, facts: { employment_stabilisation_fee_payer: true } }]
			};
			const fee = (period: string, reads: Row = {}) =>
				run(period, reads).find((write) => write.duty_code === 'EMPLOYMENT_STABILISATION_FEE');
			assert.equal(fee('2026-05'), undefined);
			assert.equal(fee('2026-04', levy), undefined);
			assert.equal(fee('2026-05', levy)!.due_on, '2026-05-25');
			assert.equal(fee('2026-11', levy)!.due_on, '2026-11-25');
			// The LSA reserve duties fall only on an entity that records its approved reserve rate.
			const reserving = { company: [{ ...company, facts: { pension_reserve_rate: 2 } }] };
			assert.equal(run('2026-12').length, count('PAYROLL_RUN', '12') - 3);
			assert.equal(run('2026-12', reserving).length, count('PAYROLL_RUN', '12') - 2);
			assert.ok(
				run('2026-03', reserving).some(
					(write) => write.duty_code === 'OLD_SYSTEM_PENSION_RESERVE_SHORTFALL'
				)
			);
			const contract = {
				id: 'k1',
				company_id: 'c1',
				approval_id: null,
				effective_range: { from: '2026-03-02', to: null },
				exit_facts: null
			};
			const hired = raise('employment_contract', 'created', contract);
			// The work-rules filing rises with each hire of an entity of thirty or more until it records the approval.
			// The work-rules filing (30+) and the 性平法 §13 duties (10+, 30+) wait for the headcount.
			assert.equal(hired.length, count('HIRE') - 3);
			assert.equal(hired.length, 6);
			const thirtieth = raiseDuties({
				behaviours,
				settings_id: settings.id,
				rows,
				collection: 'employment_contract',
				event: 'created',
				row: contract,
				headcount: 30,
				reads: { company: [company], employee: [employee] }
			});
			assert.equal(
				thirtieth.find((write) => write.duty_code === 'WORK_RULES_FILING')!.due_on,
				'2026-04-01'
			);
			const filing = (headcount: number, facts: Row) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection: 'employment_contract',
					event: 'created',
					row: contract,
					headcount,
					reads: { company: [{ ...company, facts }], employee: [employee] }
				}).some((write) => write.duty_code === 'WORK_RULES_FILING');
			assert.equal(filing(31, {}), true);
			assert.equal(filing(31, { work_rules_approval_reference: '府勞動字第1號' }), false);
			assert.equal(filing(29, {}), false);
			assert.equal(
				hired.find((write) => write.duty_code === 'NHI_ENROLMENT')!.due_on,
				'2026-03-05'
			);
			const left = {
				...contract,
				effective_range: { from: '2026-03-02', to: '2026-06-30' },
				exit_facts: { lsa_termination_ground: 'OTHER' }
			};
			const exit = (row: Row) =>
				raise(
					'employment_contract',
					'updated',
					{ ...left, ...row },
					{ catalogues: [], movements: [] }
				);
			const exits = exit({});
			// A ground that owes nothing: no severance, notice pay, layoff report or retirement pay.
			// Owed only on their facts: severance, notice, layoff, retirement, the fatality report, the
			// involuntary-separation certificate, the foreign worker's notice and the mass-layoff plan; the
			// service certificate always.
			assert.equal(exits.length, count('EXIT') - 8);
			assert.equal(exits.length, 10);
			const owed = (row: Row) =>
				exit(row)
					.map((write) => String(write.duty_code))
					.filter((code) =>
						[
							'SEVERANCE_PAYMENT',
							'TERMINATION_NOTICE',
							'LAYOFF_REPORT',
							'RETIREMENT_PAYMENT'
						].includes(code)
					)
					.toSorted();
			// A redundancy is read as §11; a worker's own §14 termination owes severance only.
			assert.deepEqual(owed({ exit_ground: 'REDUNDANCY', exit_facts: {} }), [
				'LAYOFF_REPORT',
				'SEVERANCE_PAYMENT',
				'TERMINATION_NOTICE'
			]);
			assert.deepEqual(
				owed({ exit_ground: 'RESIGNATION', exit_facts: { lsa_termination_ground: 'ARTICLE_14' } }),
				['SEVERANCE_PAYMENT']
			);
			assert.deepEqual(owed({ exit_ground: 'DISMISSAL', exit_facts: {} }), []);
			assert.deepEqual(
				owed({ exit_ground: 'RETIREMENT', exit_facts: { old_system_service_months: 120 } }),
				['RETIREMENT_PAYMENT']
			);
			assert.deepEqual(owed({ exit_ground: 'RETIREMENT', exit_facts: {} }), []);
			assert.ok(
				exit({ exit_ground: 'DEATH', exit_facts: { occupational_death: true } }).some(
					(write) =>
						write.duty_code === 'OCCUPATIONAL_FATALITY_REPORT' && write.due_on === '2026-06-30'
				)
			);
			// 職安法 §37(2): an occupational injury needing hospital treatment is reported the same day.
			const injury = (facts: Row) =>
				raise('leave_catalog_entry', 'created', {
					id: 'l1',
					approval_id: null,
					company_id: 'c1',
					employment_id: 'k1',
					occurred_on: '2026-04-09',
					catalog_code: 'OCCUPATIONAL_INJURY_LEAVE',
					facts
				}).map((write) => [write.duty_code, write.due_on]);
			assert.deepEqual(injury({ hospitalised: true }), [
				['OCCUPATIONAL_ACCIDENT_REPORT', '2026-04-09']
			]);
			assert.deepEqual(injury({}), []);
			// The daily tick: the service year's last day raises the year-end leave and 補休 payments, once.
			const tick = (day: string) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection: 'calendar',
					event: 'daily',
					row: { ...contract, effective_range: { from: '2024-05-01', to: null } },
					day,
					reads: { company: [company], employee: [employee] }
				}).map((write) => [write.duty_code, write.due_on]);
			assert.deepEqual(tick('2026-04-30').toSorted(), [
				['ANNUAL_LEAVE_WRITTEN_STATEMENT', '2026-06-01'],
				['ANNUAL_LEAVE_YEAR_END_PAYMENT', '2026-06-01'],
				['COMP_TIME_YEAR_END_PAYMENT', '2026-06-01']
			]);
			assert.deepEqual(tick('2026-04-29'), []);
			// 勞基法 §38(3), 施行細則 §24(3): the new service year's entitlement told within thirty days (31 May a Sunday).
			assert.deepEqual(tick('2026-05-01'), [['ANNUAL_LEAVE_ENTITLEMENT_NOTICE', '2026-06-01']]);
			assert.deepEqual(tick('2026-05-02'), []);
			assert.equal(
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection: 'calendar',
					event: 'daily',
					row: { ...contract, effective_range: { from: '2025-11-01', to: null } },
					day: '2026-04-30',
					reads: { company: [company], employee: [employee] }
				}).length,
				0
			);
			// Six months from a 1 November hire: the first entitlement notice on 1 May.
			assert.deepEqual(
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection: 'calendar',
					event: 'daily',
					row: { ...contract, effective_range: { from: '2025-11-01', to: null } },
					day: '2026-05-01',
					reads: { company: [company], employee: [employee] }
				}).map((write) => write.duty_code),
				['ANNUAL_LEAVE_ENTITLEMENT_NOTICE']
			);
			assert.equal(
				exits.find((write) => write.duty_code === 'LABOUR_PENSION_DEREGISTRATION')!.due_on,
				'2026-07-07'
			);
			// Already raised: nothing again.
			assert.equal(
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection: 'employment_contract',
					event: 'updated',
					row: left,
					reads: { company: [company], employee: [employee] },
					raisedAll: true
				}).length,
				0
			);
		}
	});

	it('a TW regular run and an off-cycle bonus settle through the engine', async () => {
		const { tables, run, lines, COMPANY } = tw();
		const regular = await run('2026-03', 'REGULAR');
		const mei = regular.payslips.find((slip) => slip.employment_id === 'k-p1')!;
		assert.deepEqual(lines(mei), {
			LI: [1053, 3687],
			EI: [92, 321],
			NHI: [710, 2216],
			LABOR_PENSION: [0, 2748],
			OCC_INJURY: [0, 55],
			WAGE_ARREARS_FUND: [0, 11], // 0.025% of 45,800 = 11.45, billed in whole dollars
			INCOME_TAX: [2290, 0]
		});
		assert.equal(mei.net, 45800 - 1053 - 92 - 710 - 2290);
		const arjun = regular.payslips.find((slip) => slip.employment_id === 'k-p2')!;
		// A foreign worker: LI at the 12.5% rate outside EI, NHI and 職保, no EI or new-system pension but the entity's 2% LSA reserve;
		// non-resident 18% above 44,250.
		assert.deepEqual(lines(arjun), {
			LI: [1145, 4008],
			NHI: [943, 2942],
			OCC_INJURY: [0, 73],
			WAGE_ARREARS_FUND: [0, 11], // 0.025% of 45,800 = 11.45, billed in whole dollars
			LABOR_PENSION_RESERVE: [0, 1200],
			// §34: 60,000 paid against a 60,800 insured amount owes nothing (never a negative share).
			INCOME_TAX_NON_RESIDENT: [10800, 0]
		});

		const bonus = file('version_2', 'adhoc_catalog').find((row) => row.code === 'bonus')!;
		tables.get('adhoc_catalog_entry')!.push({
			id: 'b1',
			catalog_id: bonus.id,
			employment_id: 'k-p1',
			company_id: COMPANY,
			approval_id: null,
			payslip_id: null,
			occurred_on: '2026-03-20',
			amount: 200000,
			activity: 'PAYMENT'
		});
		const offCycle = await run('2026-03', 'OFF_CYCLE', ['b1']);
		const paid = offCycle.payslips.find((slip) => slip.employment_id === 'k-p1')!;
		// The month is settled again: every scheme the salary already charged moves by nothing.
		assert.deepEqual(
			Object.fromEntries(
				Object.entries(lines(paid)).filter(
					([, [employee, employer]]) => employee !== 0 || employer !== 0
				)
			),
			{ NHI_SUPPLEMENT: [354, 0], INCOME_TAX_BONUS: [10000, 0] }
		);
	});
	it('an OFF_CYCLE bonus before or after the REGULAR run settles the same month totals', async () => {
		const bonusRow = (COMPANY: string) => ({
			id: 'b1',
			catalog_id: file('version_2', 'adhoc_catalog').find((row) => row.code === 'bonus')!.id,
			employment_id: 'k-p1',
			company_id: COMPANY,
			approval_id: null,
			payslip_id: null,
			occurred_on: '2026-03-20',
			amount: 200000,
			activity: 'PAYMENT'
		});
		const totals = (tables: Map<string, Row[]>) => {
			const out: Record<string, [number, number]> = {};
			for (const slip of tables.get('payslip')! as {
				employment_id: string;
				net: number;
				statutory: { scheme_code: string; employee_amount: number; employer_amount: number }[];
			}[])
				for (const line of slip.statutory) {
					const key = `${slip.employment_id}:${line.scheme_code}`;
					const held = out[key] ?? [0, 0];
					out[key] = [
						Math.round((held[0] + line.employee_amount) * 100) / 100,
						Math.round((held[1] + line.employer_amount) * 100) / 100
					];
				}
			return Object.fromEntries(
				Object.entries(out).filter(([, [employee, employer]]) => employee !== 0 || employer !== 0)
			);
		};
		const after = tw();
		await after.run('2026-03', 'REGULAR');
		after.tables.get('adhoc_catalog_entry')!.push(bonusRow(after.COMPANY));
		await after.run('2026-03', 'OFF_CYCLE', ['b1']);
		const before = tw();
		before.tables.get('adhoc_catalog_entry')!.push(bonusRow(before.COMPANY));
		await before.run('2026-03', 'OFF_CYCLE', ['b1']);
		// The off-cycle slip consumed the entry: the regular run must not pay it again.
		before.tables.get('adhoc_catalog_entry')![0]!.payslip_id = 'settled';
		await before.run('2026-03', 'REGULAR');
		assert.deepEqual(totals(before.tables), totals(after.tables));
		assert.deepEqual(totals(after.tables)['k-p1:NHI_SUPPLEMENT'], [354, 0]);
		assert.deepEqual(totals(after.tables)['k-p1:INCOME_TAX_BONUS'], [10000, 0]);
		assert.deepEqual(totals(after.tables)['k-p1:LI'], [1053, 3687]);
	});
	it('mass layoffs, emergency overtime, work accidents and late remittances raise their tasks', async () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = settings.behaviours as Behaviours;
			const rows = file(version, 'rule_set');
			const company = { region: '', risk_class: '42', facts: {} };
			const employee = { nationality: 'TW', gender: '', date_of_birth: '', facts: {} };
			const raise = (
				collection: string,
				event: string,
				row: Row,
				over: { headcount?: number; separations?: Row[] } = {}
			) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection,
					event,
					row,
					...over,
					reads: { company: [company], employee: [employee], catalogues: [], movements: [] }
				}).map((write) => [write.duty_code, write.due_on]);
			const only = (code: string, writes: unknown[][]) => writes.filter(([duty]) => duty === code);
			// 大量解僱勞工保護法 §2/§4: the entity's separations (a §11 ground unless they say otherwise), by worksite.
			const sep = (
				n: number,
				exit_date: string,
				exit_ground = 'REDUNDANCY',
				exit_facts: Row = {},
				worksite = '',
				fixed_term = false
			) =>
				Array.from({ length: n }, (_, i) => ({
					employment_id: `${worksite}${exit_date}-${exit_ground}-${i}`,
					exit_date,
					exit_ground,
					exit_facts,
					term_facts: {},
					worksite,
					fixed_term
				}));
			const leaver = (to: string, exit_ground = 'REDUNDANCY', exit_facts: Row = {}) => ({
				id: 'k-last',
				company_id: 'c1',
				approval_id: null,
				exit_ground,
				exit_facts,
				effective_range: { from: '2020-01-01', to }
			});
			const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((d) =>
				sep(1, `2026-06-${String(d).padStart(2, '0')}`)
			);
			// The tap's event, as the behaviour runner builds it with the entity's staffing on the exit day.
			const layoff = (
				row: Row,
				sites: Record<string, number>,
				separations: Row[],
				raised: string[] = [],
				fixedTermInForce = 0
			) => {
				const day = String((row.effective_range as Row).to);
				const headcount = Object.values(sites).reduce((total, n) => total + n, 0);
				// The tap hands the CEL its separations sorted by exit date.
				separations = separations.toSorted((a, b) =>
					String(a.exit_date).localeCompare(String(b.exit_date))
				);
				return raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection: 'employment_contract',
					event: 'updated',
					row,
					headcount,
					separations,
					reads: {
						company: [company],
						employee: [employee],
						catalogues: [],
						movements: [],
						raised: raised.map((occurrence_key) => ({ occurrence_key })),
						event: {
							collection: 'employment_contract',
							action: 'updated',
							row,
							settings_id: settings.id,
							day,
							headcount,
							headcount_permanent: headcount - fixedTermInForce,
							// Fixed-term workers in force sit at the first site; a site with none permanent is absent.
							headcount_permanent_by_worksite: Object.fromEntries(
								Object.entries(sites)
									.map(([site, n], i) => [site, i === 0 ? n - fixedTermInForce : n] as const)
									.filter(([, n]) => n > 0)
							),
							headcount_by_worksite: sites,
							separations,
							period: { key: day.slice(0, 7), from: `${day.slice(0, 7)}-01`, to: day },
							company_id: 'c1',
							employment_id: row.id,
							employee_id: null
						}
					}
				})
					.filter((write) => write.duty_code === 'MASS_LAYOFF_PLAN')
					.map((write) => [write.due_on, write.occurrence_key]);
			};
			const KEY = 'MASS_LAYOFF_PLAN:c1:2026-06-30';
			const one = { '': 25 };
			// Under thirty: more than ten in sixty days. The window ending 30 June first holds eleven; due 1 May.
			assert.deepEqual(layoff(leaver('2026-06-30'), one, [...ten, ...sep(1, '2026-06-30')]), [
				['2026-05-01', KEY]
			]);
			assert.deepEqual(layoff(leaver('2026-06-10'), one, ten), []);
			// The sixty days are a window: the tenth of June is 51 days before 31 July, the first is 61.
			assert.deepEqual(layoff(leaver('2026-07-31'), one, [...ten, ...sep(1, '2026-07-31')]), []);
			// An exit recorded out of order meets the same window, the same day and the same occurrence.
			assert.deepEqual(
				layoff(leaver('2026-06-01'), one, [
					...ten.slice(1),
					...sep(1, '2026-06-01'),
					...sep(1, '2026-06-30')
				]),
				[['2026-05-01', KEY]]
			);
			// Raised once per layoff: a later exit, or an edit of another, meets the raised occurrence.
			const twelve = [...ten, ...sep(1, '2026-06-30'), ...sep(1, '2026-07-20')];
			assert.deepEqual(layoff(leaver('2026-07-20'), one, twelve), [['2026-05-01', KEY]]);
			assert.deepEqual(layoff(leaver('2026-07-20'), one, twelve, [KEY]), []);
			assert.deepEqual(layoff(leaver('2026-06-05'), one, twelve, [KEY]), []);
			// A dismissal for cause (§12) and a §46 fixed-term worker are not counted; a §20 reorganisation is.
			assert.deepEqual(
				layoff(leaver('2026-06-30'), one, [
					...ten.slice(1),
					...sep(1, '2026-06-09', 'DISMISSAL'),
					...sep(1, '2026-06-30')
				]),
				[]
			);
			assert.deepEqual(
				layoff(leaver('2026-06-30'), one, [
					...ten.slice(1),
					...sep(1, '2026-06-09', 'REDUNDANCY', {}, '', true),
					...sep(1, '2026-06-30')
				]),
				[]
			);
			assert.deepEqual(
				layoff(leaver('2026-06-30', 'DISMISSAL'), one, [
					...ten,
					...sep(1, '2026-06-30', 'DISMISSAL')
				]),
				[]
			);
			assert.deepEqual(
				layoff(leaver('2026-06-30', 'OTHER', { lsa_termination_ground: 'ARTICLE_20' }), one, [
					...ten,
					...sep(1, '2026-06-30', 'OTHER', { lsa_termination_ground: 'ARTICLE_20' })
				]),
				[['2026-05-01', KEY]]
			);
			// §2(2): fixed-term workers are out of the 僱用 count too: 33 in force with 5 fixed-term reads 28 (more
			// than ten in sixty days), not 33 (more than a third, eleven).
			assert.equal(
				layoff(leaver('2026-06-30'), { '': 33 }, [...ten, ...sep(1, '2026-06-30')], [], 5).length,
				1
			);
			assert.equal(
				layoff(leaver('2026-06-30'), { '': 33 }, [...ten, ...sep(1, '2026-06-30')]).length,
				0
			);
			// Per 廠場: eleven at a site of 25 is a mass layoff even when the entity employs 225.
			const atA = (n: number, site = 'A') =>
				Array.from({ length: n }, (_, i) =>
					sep(1, `2026-06-${String(i + 10).padStart(2, '0')}`, 'REDUNDANCY', {}, site)
				).flat();
			assert.deepEqual(layoff(leaver('2026-06-30'), { A: 25, B: 200 }, atA(11)).length, 1);
			assert.deepEqual(layoff(leaver('2026-06-30'), { '': 225 }, atA(11, '')).length, 0);
			assert.deepEqual(
				layoff(leaver('2026-06-30'), { A: 25, B: 25 }, [
					...atA(6),
					...sep(5, '2026-06-20', 'REDUNDANCY', {}, 'B')
				]).length,
				0
			);
			// …and per site without its fixed-term workers (headcount_permanent_by_worksite): site A of 33 with five
			// fixed-term reads 28, so eleven exits there carry it; at 33 they are not more than a third.
			assert.equal(layoff(leaver('2026-06-30'), { A: 33, B: 200 }, atA(11), [], 5).length, 1);
			assert.equal(layoff(leaver('2026-06-30'), { A: 33, B: 200 }, atA(11)).length, 0);
			// 30–199: a third in sixty days (34 of 100), or more than twenty in one day.
			const hundred = { '': 100 };
			assert.deepEqual(layoff(leaver('2026-06-30'), hundred, sep(21, '2026-06-30')), [
				['2026-05-01', KEY]
			]);
			assert.deepEqual(layoff(leaver('2026-06-30'), hundred, sep(20, '2026-06-30')), []);
			assert.deepEqual(
				layoff(leaver('2026-06-30'), hundred, [
					...sep(15, '2026-05-15'),
					...sep(18, '2026-06-01'),
					...sep(1, '2026-06-30')
				]),
				[['2026-05-01', KEY]]
			);
			assert.deepEqual(
				layoff(leaver('2026-06-30'), hundred, [
					...sep(14, '2026-05-15'),
					...sep(18, '2026-06-01'),
					...sep(1, '2026-06-30')
				]),
				[]
			);
			// 200–499 a quarter or 50 a day; 500 or more a fifth or 80 a day; any employer more than 200 in sixty days
			// (201 of 2,000 is under the site's fifth and never 80 in a day).
			assert.equal(layoff(leaver('2026-06-30'), { '': 300 }, sep(51, '2026-06-30')).length, 1);
			assert.equal(layoff(leaver('2026-06-30'), { '': 300 }, sep(50, '2026-06-30')).length, 0);
			assert.equal(layoff(leaver('2026-06-30'), { '': 600 }, sep(81, '2026-06-30')).length, 1);
			assert.deepEqual(
				layoff(leaver('2026-06-30'), { '': 2000 }, [
					...sep(80, '2026-05-20'),
					...sep(80, '2026-06-10'),
					...sep(41, '2026-06-30')
				]),
				[['2026-05-01', KEY]]
			);
			// count_within over the sorted separations: 201 exits in under 500 ms on the host (guest budget 2 s at ≈3×).
			const big = [...sep(80, '2026-05-20'), ...sep(80, '2026-06-10'), ...sep(41, '2026-06-30')];
			const started = performance.now();
			layoff(leaver('2026-06-30'), { '': 2000 }, big);
			const elapsed = performance.now() - started;
			assert.ok(elapsed < 500, `201 exits took ${elapsed} ms`);
			console.log(`TW mass layoff, 201 exits: ${elapsed.toFixed(1)} ms`);
			// 勞基法 §32(4) and 職安法 §37(2): workplace cases.
			const opened = (kind: string, facts: Row) =>
				raise('workplace_case', 'created', {
					id: 'case-1',
					company_id: 'c1',
					approval_id: null,
					kind,
					opened_on: '2026-08-08',
					closed_on: null,
					facts
				});
			assert.deepEqual(opened('EMERGENCY_OVERTIME', {}), [
				['EMERGENCY_OVERTIME_NOTICE', '2026-08-09']
			]);
			for (const facts of [{ deaths: 1 }, { injured: 3 }, { hospitalised: 1 }])
				assert.deepEqual(opened('OCCUPATIONAL_ACCIDENT', facts), [
					['WORK_ACCIDENT_REPORT', '2026-08-08']
				]);
			assert.deepEqual(opened('OCCUPATIONAL_ACCIDENT', { injured: 2 }), []);
			// A case updated to a reportable count raises the eight-hour report once; one already reportable does not.
			const updated = (facts: Row, before: Row) =>
				raise('workplace_case', 'updated', {
					id: 'case-1',
					company_id: 'c1',
					approval_id: null,
					kind: 'OCCUPATIONAL_ACCIDENT',
					opened_on: '2026-08-08',
					closed_on: null,
					facts,
					before
				}).filter(([code]) => code === 'WORK_ACCIDENT_REPORT_UPDATED');
			assert.equal(updated({ injured: 1, hospitalised: 1 }, { facts: { injured: 1 } }).length, 1);
			assert.equal(updated({ injured: 4 }, { facts: { injured: 3 } }).length, 0);
			assert.equal(updated({ injured: 2 }, { facts: { injured: 1 } }).length, 0);
			assert.equal(updated({ injured: 3 }, { closed_on: null }).length, 0);
			// 減班休息: the agreement's notice to the authority, by the first reduced day (labelled default).
			const suspension = (kind: string) =>
				raise('work_suspension', 'created', {
					id: 'ws-1',
					company_id: 'c1',
					approval_id: null,
					kind,
					starts_on: '2026-09-01',
					ends_on: '2026-11-30',
					employment_ids: [],
					facts: {}
				});
			assert.deepEqual(suspension('REDUCED_WORK_AGREEMENT'), [
				['REDUCED_HOURS_NOTICE', '2026-09-01']
			]);
			assert.deepEqual(suspension('STRIKE'), []);
			// Late remittances: LI/EI/職保 and NHI after a fifteen-day grace, pension and withholding from the day after.
			const paid = (duty_code: string, due_on: string, fulfilled_on: string, state = 'FULFILLED') =>
				raise('obligation', 'updated', {
					id: 'o1',
					company_id: 'c1',
					approval_id: null,
					duty_code,
					state,
					due_on,
					fulfilled_on
				});
			assert.deepEqual(paid('INSURANCE_PREMIUM_REMITTANCE', '2026-04-30', '2026-05-15'), []);
			assert.deepEqual(paid('INSURANCE_PREMIUM_REMITTANCE', '2026-04-30', '2026-05-16'), [
				['INSURANCE_PREMIUM_LATE_SURCHARGE', '2026-05-16']
			]);
			assert.deepEqual(paid('NHI_SUPPLEMENTARY_PREMIUM_WITHHOLDING', '2026-04-30', '2026-05-16'), [
				['NHI_LATE_SURCHARGE', '2026-05-16']
			]);
			assert.deepEqual(paid('NHI_PREMIUM_REMITTANCE', '2026-04-30', '2026-05-15'), []);
			assert.deepEqual(paid('LABOUR_PENSION_REMITTANCE', '2026-06-01', '2026-06-02'), [
				['LABOUR_PENSION_LATE_SURCHARGE', '2026-06-02']
			]);
			assert.deepEqual(paid('WITHHOLDING_TAX_REMITTANCE', '2026-04-10', '2026-04-11'), [
				['WITHHOLDING_TAX_LATE_SURCHARGE', '2026-04-11']
			]);
			assert.deepEqual(paid('WITHHOLDING_TAX_REMITTANCE', '2026-04-10', '2026-04-10'), []);
			assert.deepEqual(paid('WITHHOLDING_TAX_REMITTANCE', '2026-04-10', '2026-05-01', 'OPEN'), []);
		}
		// The case kinds the version lists are the ones a workplace case may be opened with.
		const { tables, COMPANY } = tw();
		tables.set(
			'rule_set',
			versions
				.flatMap((version) => file(version, 'rule_set'))
				.map((row) => ({ approval_id: null, ...row }))
		);
		const reads = {
			read: (collection: unknown, query: unknown) => {
				const { where = {} } = query as { where?: Record<string, { eq?: unknown }> };
				return Effect.succeed({
					rows: (tables.get(String(collection)) ?? []).filter((row) =>
						Object.entries(where).every(([key, spec]) =>
							spec != null && typeof spec === 'object' && 'eq' in spec ? row[key] === spec.eq : true
						)
					)
				});
			}
		};
		const open = (kind: string, opened_on: string) =>
			Effect.runPromise(
				admitCase({
					company_id: COMPANY as never,
					employment_id: null,
					kind,
					opened_on,
					closed_on: null
				}).pipe(
					Effect.provideService(Reads, reads as never),
					Effect.match({
						onFailure: (error) => String(error.message),
						onSuccess: (id) => String(id)
					})
				)
			);
		for (const day of ['2025-12-15', '2026-08-08']) {
			assert.equal(await open('OCCUPATIONAL_ACCIDENT', day), COMPANY);
			assert.equal(await open('EMERGENCY_OVERTIME', day), COMPANY);
			assert.match(await open('DATA_BREACH', day), /lists no case kind DATA_BREACH/);
		}
	});
	it('non-compete compensation after exit: salary withholding, the 兼職 NHI premium and the half-wage floor (owner ruling)', async () => {
		const { tables, run, lines, COMPANY } = tw();
		// The payslip validations are the versions' rule sets.
		tables.set(
			'rule_set',
			versions
				.flatMap((version) => file(version, 'rule_set'))
				.map((row) => ({ approval_id: null, ...row }))
		);
		const leaver = tables.get('employment_contract')!.find((row) => row.id === 'k-p1')!;
		Object.assign(leaver, {
			effective_range: { from: '2024-01-01', to: '2026-02-28' },
			exit_ground: 'RESIGNATION',
			exit_facts: {}
		});
		const pay = (code: string, id: string, occurred_on: string, amount: number) => {
			const row = file('version_2', 'adhoc_catalog').find((item) => item.code === code)!;
			assert.equal(row.payable_after_exit, true);
			tables.get('adhoc_catalog_entry')!.push({
				id,
				catalog_id: row.id,
				employment_id: 'k-p1',
				company_id: COMPANY,
				approval_id: null,
				payslip_id: null,
				occurred_on,
				amount,
				activity: 'PAYMENT',
				facts: {}
			});
		};
		const paid = async (period: string) => {
			const plan = await run(period, 'REGULAR');
			const slip = plan.payslips.find((row) => row.employment_id === 'k-p1')!;
			return { plan, slip, got: lines(slip) };
		};
		// A monthly 30,000 (above half of the 45,800 wage): its own slip, no insurance; 5% of it is 1,500 — under the
		// NT$2,000 floor, so nothing withheld; the former worker is not insured here, so 2.11% 兼職 premium and the
		// unit's §34 total carry it with no insured amount.
		pay('NON_COMPETE_COMPENSATION', 'nc-3', '2026-03-31', 30000);
		const march = await paid('2026-03');
		assert.deepEqual(march.slip.base, []);
		assert.deepEqual(
			march.slip.adjustments.map((line) => [line.component_code, line.amount]),
			[['NON_COMPETE_COMPENSATION', 30000]]
		);
		assert.deepEqual(march.got, { NHI_PART_TIME: [633, 0], NHI_SUPPLEMENT_EMPLOYER: [0, 633] });
		assert.equal(march.slip.net, 29367);
		const floor = (plan: { warnings: readonly string[] }) =>
			plan.warnings.filter((line) => line.startsWith('Mei: Non-compete'));
		assert.deepEqual(floor(march.plan), []);
		pay('NON_COMPETE_COMPENSATION', 'nc-4', '2026-04-30', 60000);
		const april = await paid('2026-04');
		// 60,000 a month: 5% withheld as monthly salary (no exemptions declared).
		assert.deepEqual(april.got, {
			INCOME_TAX: [3000, 0],
			NHI_PART_TIME: [1266, 0],
			NHI_SUPPLEMENT_EMPLOYER: [0, 1266]
		});
		pay('NON_COMPETE_COMPENSATION', 'nc-5', '2026-05-31', 20000);
		const may = await paid('2026-05');
		// 20,000 is below half of 45,800 (§7-3) and below the minimum wage (no 兼職 premium): the run warns.
		assert.deepEqual(may.got, { NHI_SUPPLEMENT_EMPLOYER: [0, 422] });
		assert.equal(floor(may.plan).length, 1);
		pay('NON_COMPETE_LUMP_SUM', 'nc-6', '2026-06-15', 200000);
		const june = await paid('2026-06');
		// One sum of 200,000: a non-monthly payment above the 90,501 起扣標準, 5% of itself.
		assert.deepEqual(june.got, {
			INCOME_TAX_BONUS: [10000, 0],
			NHI_PART_TIME: [4220, 0],
			NHI_SUPPLEMENT_EMPLOYER: [0, 4220]
		});
		// §9-1(2): at most two years after the exit; never before it. Both versions carry the classes.
		for (const version of versions) {
			const monthly = file(version, 'adhoc_catalog').find(
				(item) => item.code === 'NON_COMPETE_COMPENSATION'
			)!;
			const qualifies = (occurred_on: string) =>
				evaluateConfigured(String(monthly.qualifies_when), {
					...payslipContext,
					employment: { exit_date: '2026-02-28' },
					entry: { ...entry({}), occurred_on }
				} as never);
			assert.equal(qualifies('2028-02-28'), true);
			assert.equal(qualifies('2028-02-29'), false);
			assert.equal(qualifies('2026-02-28'), false);
			assert.ok(
				file(version, 'adhoc_catalog').some(
					(item) => item.code === 'NON_COMPETE_LUMP_SUM' && item.payable_after_exit === true
				)
			);
		}
	});
	it('round-10 roots: suspension kinds, record retention, the wage roster, menstrual overflow, banked comp time and hourly family care', () => {
		const KINDS = [
			'EMPLOYER_SHUTDOWN',
			'GOVERNMENT_STOP_WORK',
			'NATURAL_DISASTER',
			'STRIKE',
			'REDUCED_WORK_AGREEMENT'
		];
		const fields = modelFields('suspension_kind');
		for (const version of versions) {
			// 民法 §487, 職安法 §36(2), the typhoon 要點, a strike and 減班休息: what a suspended day does.
			const kinds = file(version, 'suspension_kind');
			assert.deepEqual(
				kinds.map((row) => row.code),
				KINDS
			);
			const effect = (code: string) => {
				const kind = kinds.find((row) => row.code === code)!;
				for (const key of Object.keys(kind)) assert.ok(fields.has(key), `${code} ${key}`);
				assert.equal(kind.settings_id, settingsOf(version).id);
				assert.doesNotMatch(String(kind.name), /§/);
				assert.match(String(kind.authority), /民法|職業安全衛生法|要點|勞資爭議處理法|注意事項/);
				const context = {
					day: { date: '2026-08-03', worked: false, day_type: 'WORK' },
					suspension: {}
				};
				return [
					evaluateConfigured(String(kind.counts_as_attended), context),
					evaluateConfigured(String(kind.scheduled), context),
					kind.pay
				];
			};
			assert.deepEqual(effect('EMPLOYER_SHUTDOWN'), [true, true, '']);
			assert.deepEqual(effect('GOVERNMENT_STOP_WORK'), [true, true, '']);
			assert.deepEqual(effect('NATURAL_DISASTER'), [true, true, '']);
			assert.deepEqual(effect('STRIKE'), [false, true, '']);
			assert.deepEqual(effect('REDUCED_WORK_AGREEMENT'), [false, false, '']);
			// The unpaid suspended working days at the day wage (45,000 ÷ 30 = 1,500): a strike day and a typhoon day
			// whose wage is withheld; a shutdown, a typhoon day paid, a worked day and a rest day cost nothing.
			const deduction = file(version, 'work_catalog').find(
				(row) => row.code === 'SUSPENSION_DEDUCTION'
			)!;
			const suspended = (kind: string, facts: Row = {}, day_type = 'WORK', worked = false) => ({
				date: '2026-08-03',
				day_type,
				worked,
				suspended: { kind, facts, counts_as_attended: false, scheduled: true, pay: 0 }
			});
			const slip = (days: Row[], terms: Row = {}) => ({
				...payslipContext,
				terms: { ...payslipContext.terms, ...terms },
				rules: { minimum_wage: { monthly: 29500 } },
				work: { ...payslipContext.work, days }
			});
			const deducts = (context: Row) =>
				evaluateConfigured(String(deduction.eligibility), context as never) === true
					? evaluateConfigured(String(deduction.rate), context as never)
					: 0;
			assert.equal(
				deducts(
					slip([
						suspended('STRIKE'),
						suspended('NATURAL_DISASTER', { withhold_wage: true }),
						suspended('NATURAL_DISASTER'),
						suspended('EMPLOYER_SHUTDOWN'),
						suspended('GOVERNMENT_STOP_WORK'),
						suspended('STRIKE', {}, 'WORK', true),
						suspended('STRIKE', {}, 'REST')
					])
				),
				3000
			);
			assert.equal(deducts(slip([suspended('EMPLOYER_SHUTDOWN')])), 0);
			// 減班休息: three days off from 30,000 would leave 27,000 — the month keeps the 29,500 minimum wage.
			const reduced = [1, 2, 3].map(() => suspended('REDUCED_WORK_AGREEMENT'));
			assert.equal(deducts(slip(reduced, { base_salary: 30000 })), 500);
			assert.equal(deducts(slip(reduced, { base_salary: 60000 })), 6000);
			assert.equal(
				deducts(slip(reduced, { base_salary: 30000, employment_type: 'PART_TIME' })),
				3000
			);

			// Record retention: the exit year's salary vouchers five years after its settlement (商業會計法 §§38, 65).
			const payroll = Object.fromEntries(
				file(version, 'rule_set')
					.filter((row) => row.family === 'PAYROLL')
					.map((row) => [row.code, row.rules])
			) as Record<string, Row>;
			const until = String(payroll.record_retention!.until);
			assert.equal(
				evaluateConfigured(until, { employment: { exit_date: '2026-05-20' } }),
				'2032-05-15'
			);
			assert.equal(
				evaluateConfigured(until, { employment: { exit_date: '2026-12-31' } }),
				'2032-05-15'
			);
			// …always later than five years from leaving (勞基法 §7, 勞退條例 §21(2)).
			assert.ok(
				String(evaluateConfigured(until, { employment: { exit_date: '2026-12-31' } })) >
					'2031-12-31'
			);
			const disposal = file(version, 'rule_set').find(
				(row) => row.code === 'PERSONAL_DATA_DISPOSAL'
			)!;
			assert.equal(
				evaluateConfigured(String((disposal.rules as Row).due), { exit_on: '2026-05-20' }),
				'2032-05-15'
			);

			// 工資清冊 (勞基法 §23(2), 施行細則 §14-1) as a CSV: the header and one worker's row.
			const roster = file(version, 'rule_set').find((row) => row.code === 'WAGE_ROSTER_CSV')!;
			assert.equal(roster.family, 'EXPORTS');
			const [document] = recordDocuments(
				[{ code: 'WAGE_ROSTER_CSV', rules: roster.rules }],
				[{ period: '2026-04' }],
				[
					{
						employee: { name: '王小明' },
						contract: {},
						slips: [
							{
								period: '2026-04',
								gross: 49300,
								net: 47000,
								total_deductions: 3300,
								lines: {
									BASIC: 45800,
									NO_PAY_LEAVE: -1500,
									OVERTIME: 1000,
									HOLIDAY_WORK: 1527,
									FULL_ATTENDANCE_BONUS: 1000,
									MEAL_ALLOWANCE: 1473,
									bonus: 0
								},
								statutory: {
									LI: { employee: 1053, employer: 3687, base: 45800 },
									EI: { employee: 92, employer: 321, base: 45800 },
									NHI: { employee: 710, employer: 2216, base: 45800 },
									INCOME_TAX: { employee: 1000, employer: 0, base: 0 },
									LABOR_PENSION: { employee: 0, employer: 2748, base: 45800 },
									WELFARE_FUND: { employee: 245, employer: 0, base: 0 }
								}
							}
						]
					} as never
				]
			);
			const [header, row] = document!.content.split('\n');
			assert.equal(document!.name, 'wage-roster-2026-04.csv');
			assert.equal(
				header,
				'姓名,工資給付期間,本薪,延長工時工資,例假及休假出勤工資,全勤獎金,伙食津貼,其他給付,工資總額,勞工保險費,全民健康保險費,健保補充保險費,勞工退休金自提,所得稅,職工福利金,其他扣除,扣除額合計,實發金額'
			);
			assert.equal(
				row,
				'王小明,2026-04,44300,1000,1527,1000,1473,0,49300,1145,710,0,0,1000,245,200,3300,47000'
			);

			// Leave: the three free menstrual days, then the half-paid pool; once both are spent the day is unpaid.
			const rows = file(version, 'leave_catalog');
			const classes = rows.map((item) => classFromRow(item as never));
			const id = (code: string) => rows.find((item) => item.code === code)!.id as never;
			const taken = (code: string, from: string, days: number) => ({
				catalog_id: id(code),
				occurred_on: from,
				from,
				days,
				facts: {}
			});
			const admits = (
				code: string,
				movements: Row[],
				from: string,
				terms: Row = {},
				attendanceDays?: unknown[]
			) =>
				leaveBalances({
					classes,
					movements: movements.map((m) =>
						movementFromRow({ activity: 'TIME_OFF', approval_id: null, ...m } as never)
					),
					serviceMonths: 30,
					asOf: from,
					employmentStart: '2023-09-01',
					entry: movementFromRow({
						activity: 'TIME_OFF',
						approval_id: null,
						...taken(code, from, 1)
					} as never),
					...(attendanceDays === undefined ? {} : { attendanceDays: attendanceDays as never }),
					context: { ...subject({ terms }), entry: { facts: {} } } as never
				}).find((balance) => balance.code === code)!.available;
			const three = ['01', '02', '03'].map((m) => taken('MENSTRUAL_LEAVE', `2026-${m}-05`, 1));
			const spent = [...three, taken('SICK_LEAVE', '2026-01-12', 30)];
			assert.equal(admits('MENSTRUAL_LEAVE', spent, '2026-04-10'), 0);
			assert.equal(admits('MENSTRUAL_LEAVE_UNPAID', spent, '2026-04-10'), 1);
			const left = [...three, taken('SICK_LEAVE', '2026-01-12', 10)];
			assert.equal(admits('MENSTRUAL_LEAVE', left, '2026-04-10'), 1);
			assert.equal(admits('MENSTRUAL_LEAVE_UNPAID', left, '2026-04-10'), 0);
			// Before the three free days are used the pool does not matter; one unpaid day a month at most.
			assert.equal(
				admits('MENSTRUAL_LEAVE', [taken('SICK_LEAVE', '2026-01-12', 30)], '2026-04-10'),
				1
			);
			assert.equal(
				admits(
					'MENSTRUAL_LEAVE_UNPAID',
					[...spent, taken('MENSTRUAL_LEAVE_UNPAID', '2026-04-02', 1)],
					'2026-04-10'
				),
				0
			);
			// The fourth and fifth menstrual days come out of the pool (consumes_after_days 3).
			const five = ['01', '02', '03', '04', '05'].map((m) =>
				taken('MENSTRUAL_LEAVE', `2026-${m}-05`, 1)
			);
			assert.equal(admits('SICK_LEAVE', five, '2026-06-10'), 28);
			// 性平法 §20 by the hour: seven days of a six-hour worker are 42 hours; six hours take a whole personal day.
			const six = { facts: { daily_hours: 6 } };
			assert.equal(admits('FAMILY_CARE_LEAVE', [], '2026-03-02', six), 42);
			assert.equal(
				admits('PERSONAL_LEAVE', [taken('FAMILY_CARE_LEAVE', '2026-03-02', 6)], '2026-03-09', six),
				13
			);
			// 勞基法 §32-1: the comp-time balance is the hours banked this leave year less those taken.
			const banked = ['2026-02-02', '2026-02-03', '2026-02-04'].map((date) => ({
				date,
				scheduled: true,
				worked: true,
				holiday: false,
				leave: [],
				banked_hours: 2
			}));
			assert.equal(
				admits(
					'COMPENSATORY_TIME_OFF',
					[taken('COMPENSATORY_TIME_OFF', '2026-02-20', 2)],
					'2026-03-02',
					{},
					banked
				),
				4
			);
			// §32-1(2): the untaken hours at the band of the day worked, the oldest taken first. 2 h at 1.34 on
			// 2 February are taken; 2 h at 1.67 and 2 h at 2.67 are left: 3.34 + 5.34 = 8.68 straight-time hours.
			const attended = [
				['2026-02-02', '1.34'],
				['2026-02-03', '1.67'],
				['2026-02-07', '2.67']
			].map(([date, band]) => ({
				date: date!,
				scheduled: true,
				worked: true,
				holiday: false,
				leave: [],
				banked_hours: 2,
				banked_band: band
			}));
			const value = (movements: Row[]) =>
				admits('COMP_TIME_PAYOUT_VALUE', movements, '2026-03-02', {}, attended);
			assert.equal(value([taken('COMPENSATORY_TIME_OFF', '2026-02-20', 2)]), 8.68);
			assert.equal(value([]), 11.36);
			assert.equal(value([taken('COMPENSATORY_TIME_OFF', '2026-02-20', 6)]), 0);
			// The exit encashment pays it at the hourly wage (45,000 ÷ 30 ÷ 8 = 187.5): 8.68 h → 1,627.50; the leave
			// encashment line leaves it out.
			const work = file(version, 'work_catalog');
			const payout = work.find((item) => item.code === 'COMP_TIME_PAYOUT')!;
			const encash = work.find((item) => item.code === 'ENCASHMENT')!;
			const exitSlip = {
				...payslipContext,
				leave: {
					rows: [
						{
							code: 'COMP_TIME_PAYOUT_VALUE',
							activity: 'ENCASHMENT',
							days: 8.68,
							can_encash: true,
							is_npl: false
						}
					]
				}
			};
			assert.equal(
				Number(evaluateConfigured(String(payout.quantity), exitSlip as never)) *
					Number(evaluateConfigured(String(payout.rate), exitSlip as never)),
				1627.5
			);
			assert.equal(evaluateConfigured(String(encash.eligibility), exitSlip as never), false);
			assert.ok(
				file(version, 'leave_catalog').some(
					(item) => item.code === 'COMP_TIME_PAYOUT_VALUE' && item.encash_on_exit === true
				)
			);
		}
	});
	it('round-12 roots: work-day import rules, unit changes re-registered, suspension authorities', async () => {
		const { tables, COMPANY, reads } = tw();
		tables.set(
			'rule_set',
			versions
				.flatMap((version) => file(version, 'rule_set'))
				.map((row) => ({ approval_id: null, ...row }))
		);
		tables.set('shift_definition', [
			{
				id: 'sd-work',
				company_id: COMPANY,
				code: 'D',
				variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00' }
			},
			{ id: 'sd-rest', company_id: COMPANY, code: 'R', variant: { day_type: 'REST' } }
		]);
		tables.set('shift_pattern', []);
		const profile = tables.get('employment_profile')!.find((row) => row.id === 'p1')!;
		const findings = async (
			days: {
				date: string;
				from?: string;
				to?: string;
				ot?: number;
				shift?: string;
				consent?: boolean;
			}[],
			over: { employee?: Row; company?: Row } = {}
		) => {
			Object.assign(profile, {
				gender: 'FEMALE',
				children: [],
				date_of_birth: '1990-02-01',
				...over.employee
			});
			// The clocks below are written as local wall time in UTC: the entity counts its days in UTC.
			Object.assign(tables.get('entity')![0]!, {
				time_zone: 'UTC',
				facts: { pension_reserve_rate: 2, ...over.company }
			});
			const found = await Effect.runPromise(
				rosterFindings(
					COMPANY,
					days.map((day, ref) => ({
						ref,
						employment_id: 'k-p1',
						work_date: day.date,
						shift_definition_id: day.shift ?? 'sd-work',
						worked_intervals:
							day.from == null
								? []
								: [
										{
											start: `${day.date}T${day.from}:00Z`,
											end: `${day.to!.startsWith('+') ? String(evaluateConfigured(`add_days("${day.date}", 1)`, {})) + 'T' + day.to!.slice(1) : day.date + 'T' + day.to}:00Z`
										}
									],
						approved_overtime_hours: day.ot ?? 0,
						// Owner ruling: overtime consent is the day's own; the sheet consents unless a case says not.
						overtime_consented_at: day.consent === false ? null : `${day.date}T00:00:00Z`,
						leave_code: ''
					}))
				).pipe(Effect.provideService(Reads, reads as never))
			);
			return found.map((row) => `${row.code}:${row.kind}`).toSorted();
		};
		// A lawful week: Monday–Friday 09:00–13:00 and 13:30–17:30 recorded as two blocks would be ideal; one
		// eight-hour block with no break trips §35 alone.
		const day = (date: string, from = '09:00', to = '17:00', ot = 0, shift?: string) => ({
			date,
			from,
			to,
			ot,
			...(shift ? { shift } : {})
		});
		assert.deepEqual(await findings([day('2026-03-02', '09:00', '13:00')]), []);
		assert.deepEqual(await findings([day('2026-03-02')]), ['ROSTER_BREAK_AFTER_FOUR_HOURS:warn']);
		const quiet = { shift_or_continuous_work: true };
		// §32(2) twelve a day; §30(1) eight normal hours.
		assert.deepEqual(await findings([day('2026-03-02', '06:00', '19:00', 5)], { company: quiet }), [
			'ROSTER_DAILY_HOURS_CAP:warn'
		]);
		assert.deepEqual(await findings([day('2026-03-02', '08:00', '18:00', 0)], { company: quiet }), [
			'ROSTER_NORMAL_HOURS:warn'
		]);
		assert.deepEqual(
			await findings([day('2026-03-02', '08:00', '18:00', 2)], { company: quiet }),
			[]
		);
		// §30(1) forty a week: six eight-hour days are 48 normal hours (and work on the sixth is a 休息日 at best).
		const six = ['02', '03', '04', '05', '06', '07'].map((d) =>
			day(`2026-03-${d}`, '09:00', '17:00')
		);
		assert.ok((await findings(six, { company: quiet })).includes('ROSTER_NORMAL_HOURS:warn'));
		assert.deepEqual(
			await findings(six, { company: { ...quiet, flexible_working_time: true } }),
			[]
		);
		// §36(1) seven days without a 例假; §40 work on the 例假.
		const seven = ['02', '03', '04', '05', '06', '07', '08'].map((d) =>
			day(`2026-03-${d}`, '09:00', '13:00')
		);
		assert.deepEqual(await findings(seven), ['ROSTER_SEVEN_DAY_REST:warn']);
		assert.deepEqual(await findings([day('2026-03-08', '09:00', '13:00', 0, 'sd-rest')]), [
			'ROSTER_REGULAR_DAY_OFF_WORKED:warn'
		]);
		// §34(2) eleven hours between shifts (eight by announced exception).
		const turn = [day('2026-03-02', '13:00', '17:00'), day('2026-03-03', '02:00', '06:00')];
		assert.deepEqual(await findings(turn), [
			'ROSTER_REST_BETWEEN_SHIFTS:warn',
			'ROSTER_WOMEN_NIGHT_WORK:warn'
		]);
		assert.deepEqual(
			await findings(turn, {
				company: { shift_change_rest_eight_hours: true, women_night_work_consent: true }
			}),
			[]
		);
		// §49(1) women at night without consent; §49(5) a pregnant worker even with it.
		const night = [day('2026-03-02', '19:00', '22:30')];
		assert.deepEqual(await findings(night, { company: { women_night_work_consent: true } }), []);
		assert.deepEqual(
			await findings(night, {
				company: { women_night_work_consent: true },
				employee: { children: [{ estimated_delivery_date: '2026-07-01' }] }
			}),
			['ROSTER_PREGNANT_NIGHT_WORK:warn']
		);
		assert.deepEqual(await findings(night, { employee: { gender: 'MALE' } }), []);
		// §§47–48 a child worker: no work after 20:00.
		assert.deepEqual(
			await findings([day('2026-03-02', '17:00', '20:30')], {
				employee: { gender: 'MALE', date_of_birth: '2011-01-01' }
			}),
			['ROSTER_CHILD_WORKER:warn']
		);
		// §32(1)–(2), owner ruling: overtime on a day without its own consent warns.
		assert.deepEqual(
			await findings([{ ...day('2026-03-02', '08:00', '18:00', 2), consent: false }], {
				company: quiet
			}),
			['ROSTER_OVERTIME_WITHOUT_CONSENT:warn']
		);
		assert.deepEqual(
			await findings([day('2026-03-02', '08:00', '18:00', 2)], { company: quiet }),
			[]
		);
		// §30(5)–(6): approved overtime with no clock record is refused, not warned.
		assert.deepEqual(await findings([{ date: '2026-03-02', ot: 2 }]), [
			'ROSTER_ATTENDANCE_TO_THE_MINUTE:refuse'
		]);
		assert.deepEqual(await findings([{ date: '2026-03-02' }]), []);
		// 勞保細則 §17 (30 days) and 健保細則 §42 (15 days): a change of the unit's name, address or responsible person.
		for (const version of versions) {
			const settings = settingsOf(version);
			const changed = (row: Row) =>
				raiseDuties({
					behaviours: settings.behaviours as Behaviours,
					settings_id: settings.id,
					rows: file(version, 'rule_set'),
					collection: 'entity',
					event: 'updated',
					row: { id: 'c1', approval_id: null, name: 'Formosa', facts: {}, ...row },
					day: '2026-03-10',
					reads: { company: [], employee: [] }
				})
					.filter((write) => String(write.duty_code).endsWith('_UNIT_CHANGE'))
					.map((write) => [write.duty_code, write.due_on])
					.toSorted();
			const both = [
				['LI_UNIT_CHANGE', '2026-04-09'],
				['NHI_UNIT_CHANGE', '2026-03-25']
			];
			assert.deepEqual(changed({ name: 'Formosa Ltd', before: { name: 'Formosa' } }), both);
			assert.deepEqual(
				changed({ facts: { address: 'B' }, before: { facts: { address: 'A' } } }),
				both
			);
			assert.deepEqual(
				changed({ facts: { responsible_person: '林' }, before: { facts: {} } }),
				both
			);
			assert.deepEqual(
				changed({
					facts: { address: 'A', welfare_committee_established: true },
					before: { facts: { address: 'A' } }
				}),
				[]
			);
			assert.deepEqual(changed({ risk_class: '7', before: { risk_class: '42' } }), []);
			// The roster rules are the import's; every one names its site and cites its article.
			const roster = file(version, 'rule_set').filter(
				(row) => (row.rules as Row).site === 'roster'
			);
			assert.equal(roster.length, 11);
			for (const row of roster)
				assert.match(String((row.rules as Row).description), /勞動基準法 §/);
		}
	});
	it('verify2 fixes: the election day, indigenous ritual day, §84-1, 性平法 §13, 個資法 §8, the 6% cap and the withholding day', () => {
		const voter = (employee: Row) => ({
			...subject({ employee }),
			employee: { ...subject().employee, ...employee }
		});
		for (const version of versions) {
			const work = file(version, 'work_catalog');
			const line = (code: string) => work.find((row) => row.code === code)!;
			// 投票日 (SPECIAL_HOLIDAY): a national of twenty or more worked it — one further day (1,500); a foreign
			// worker or a nineteen-year-old worked an ordinary day, whose two overtime hours stay ordinary overtime.
			const day = {
				date: '2026-11-28',
				day_type: 'WORK',
				holiday_kind: 'SPECIAL_HOLIDAY',
				worked: true,
				worked_hours: 10,
				overtime_hours: 2,
				scheduled_hours: 8,
				facts: {},
				intervals: []
			};
			const slip = (employee: Row) => ({
				...payslipContext,
				...voter(employee),
				work: {
					...payslipContext.work,
					days: [day],
					holidays: [
						{
							date: '2026-11-28',
							name: '地方公職人員選舉投票日',
							kind: 'SPECIAL_HOLIDAY',
							day_type: 'WORK',
							worked: true,
							worked_hours: 10
						}
					]
				}
			});
			const priced = (code: string, context: Row) =>
				evaluateConfigured(String(line(code).eligibility), context as never) === true
					? Number(evaluateConfigured(String(line(code).quantity), context as never)) *
						Number(evaluateConfigured(String(line(code).rate), context as never))
					: 0;
			const national = slip({ nationality: 'TW', date_of_birth: '1990-02-01' });
			assert.equal(priced('HOLIDAY_WORK', national), 1500);
			assert.equal(priced('HOLIDAY_OVERTIME', national), 2.68 * 187.5);
			assert.equal(priced('OVERTIME', national), 0);
			for (const other of [
				{ nationality: 'IN', date_of_birth: '1990-02-01' },
				{ nationality: 'TW', date_of_birth: '2007-06-01' },
				{ nationality: 'TW', date_of_birth: '1990-02-01', facts: { voting_right: false } }
			]) {
				assert.equal(priced('HOLIDAY_WORK', slip(other)), 0);
				assert.equal(priced('OVERTIME', slip(other)), 2.68 * 187.5);
			}
			const holidays = (
				file(version, 'rule_set').find((row) => row.code === 'public_holidays')!.rules as {
					holidays: Row[];
				}
			).holidays;
			assert.deepEqual(
				holidays.filter((h) => h.kind === 'SPECIAL_HOLIDAY'),
				version === 'version_3' || version === 'version_4'
					? [{ date: '2026-11-28', name: '地方公職人員選舉投票日', kind: 'SPECIAL_HOLIDAY' }]
					: []
			);
			// 原住民族歲時祭儀: one paid day a year for an indigenous worker; worked, one further day.
			const leave = file(version, 'leave_catalog').find(
				(row) => row.code === 'INDIGENOUS_RITUAL_HOLIDAY'
			)!;
			assert.equal(leave.pay_fraction, '');
			assert.equal(
				evaluateConfigured(
					String(leave.eligibility),
					admission({ employee: { facts: { indigenous: true } } }) as never
				),
				true
			);
			assert.equal(evaluateConfigured(String(leave.eligibility), admission() as never), false);
			const ritual = {
				...payslipContext,
				...voter({ facts: { indigenous: true } }),
				work: {
					...payslipContext.work,
					days: [{ ...day, holiday_kind: '', facts: { indigenous_ritual_day: true } }]
				}
			};
			assert.equal(priced('INDIGENOUS_RITUAL_DAY_WORK', ritual), 1500);
			assert.equal(priced('INDIGENOUS_RITUAL_DAY_WORK', { ...ritual, ...voter({}) }), 0);
			// 勞退 §14(3): a voluntary rate of 8 is held at 6 (2,748 on 45,800).
			assert.deepEqual(
				at(version, 'LABOR_PENSION', 45800, {
					elections: { LABOR_PENSION: { voluntary_rate: 8 } }
				}),
				{ employee: 2748, employer: 2748 }
			);
			// 所得稅法 §92(1): the first half of a semi-monthly month remits by the 10th of the next month.
			const withholding = file(version, 'rule_set').find(
				(row) => row.code === 'WITHHOLDING_TAX_REMITTANCE'
			)!;
			assert.equal(
				evaluateConfigured(String((withholding.rules as Row).due), {
					period: { key: '2026-03-1', from: '2026-03-01', to: '2026-03-15' },
					holidays: []
				} as never),
				'2026-04-10'
			);
			// §84-1: an approved responsibility-system worker with a filed agreement is outside the hours checks.
			const daily = file(version, 'rule_set').find((row) => row.code === 'OVERTIME_DAILY_CAP')!;
			const long = {
				...payslipContext,
				work: { ...payslipContext.work, days: [{ ...day, holiday_kind: '', worked_hours: 13 }] }
			};
			const trips = (context: Row) =>
				evaluateConfigured(String((daily.rules as Row).when), context as never);
			assert.equal(trips(long), true);
			assert.equal(
				trips({
					...long,
					company: { ...payslipContext.company, facts: { responsibility_system: true } },
					terms: {
						...payslipContext.terms,
						facts: { responsibility_system_agreement: '府勞動字第2號' }
					}
				}),
				false
			);
			assert.equal(
				trips({
					...long,
					company: { ...payslipContext.company, facts: { responsibility_system: true } }
				}),
				true
			);
			// 性平法 §13 by headcount, and 個資法 §8 on every hire.
			const settings = settingsOf(version);
			const hire = (headcount: number, facts: Row = {}) =>
				raiseDuties({
					behaviours: settings.behaviours as Behaviours,
					settings_id: settings.id,
					rows: file(version, 'rule_set'),
					collection: 'employment_contract',
					event: 'created',
					row: {
						id: 'k1',
						company_id: 'c1',
						approval_id: null,
						effective_range: { from: '2026-03-02', to: null },
						exit_facts: null
					},
					headcount,
					reads: { company: [{ region: '', facts }], employee: [{ nationality: 'TW', facts: {} }] }
				})
					.map((write) => String(write.duty_code))
					.filter((code) => code.startsWith('SEXUAL') || code === 'PERSONAL_DATA_COLLECTION_NOTICE')
					.toSorted();
			assert.deepEqual(hire(9), ['PERSONAL_DATA_COLLECTION_NOTICE']);
			assert.deepEqual(hire(10), [
				'PERSONAL_DATA_COLLECTION_NOTICE',
				'SEXUAL_HARASSMENT_COMPLAINT_CHANNEL'
			]);
			assert.deepEqual(hire(10, { sexual_harassment_complaint_channel: true }), [
				'PERSONAL_DATA_COLLECTION_NOTICE'
			]);
			assert.deepEqual(hire(30), [
				'PERSONAL_DATA_COLLECTION_NOTICE',
				'SEXUAL_HARASSMENT_PREVENTION_RULES'
			]);
			assert.deepEqual(hire(30, { sexual_harassment_prevention_rules: true }), [
				'PERSONAL_DATA_COLLECTION_NOTICE'
			]);
		}
		// The version chain: 1 January–31 March 2026, 1 April–30 September (the migrant carve-out), then
		// 1 October–31 December (婚假 fourteen days).
		assert.deepEqual(settingsOf('version_2').effective_range, {
			from: '2026-01-01',
			to: '2026-03-31'
		});
		assert.deepEqual(settingsOf('version_3').effective_range, {
			from: '2026-04-01',
			to: '2026-09-30'
		});
		assert.deepEqual(settingsOf('version_4').effective_range, {
			from: '2026-10-01',
			to: '2026-12-31'
		});
	});
	it('§34 employer supplementary premium: never negative on a slip, netted across the unit, and the meal exemption per part', () => {
		for (const version of versions) {
			const share = (wage: number, over: Over = {}) =>
				(at(version, 'NHI_SUPPLEMENT_EMPLOYER', wage, over) as { employer: number }).employer;
			const insured = (wage: number, over: Over = {}) =>
				(at(version, 'NHI', wage, over) as { employer: number }).employer;
			// P: 45,000 paid on a 45,800 insured amount; Q: 60,000 paid on the insurer-confirmed 30,300.
			const q = { elections: { NHI: { insured_amount: 30300 } } };
			assert.equal(share(45000), 0);
			assert.equal(share(60000, q), Math.round((60000 - 30300) * 0.0211));
			// The remittance nets the unit: (105,000 − 76,100) × 2.11% = 609.79 → 610, not the slips' 0 + 627.
			const duty = file(version, 'rule_set').find(
				(row) => row.code === 'NHI_EMPLOYER_SUPPLEMENTARY_PREMIUM'
			)!;
			// run.statutory carries each slip's salary (base) and insured amount (charged_base, the scheme's assessment).
			const assessment = String(
				(scheme(version, 'NHI_SUPPLEMENT_EMPLOYER').configuration as Row).assessment
			);
			const insuredOn = (wage: number, over: Over = {}) =>
				Number(evaluateConfigured(assessment, statutoryContext(wage, over) as never));
			assert.equal(insuredOn(45000), 45800);
			assert.equal(insuredOn(60000, q), 30300);
			assert.equal(insuredOn(60000, { employment: { exit_date: '2026-03-20' } }), 0);
			assert.equal(insuredOn(60000, { elections: { NHI: { insured_elsewhere: true } } }), 0);
			const remit = (base: number, charged_base: number) =>
				evaluateConfigured(String((duty.rules as Row).amount), {
					total: 0,
					run: {
						totals: { schemes: {} },
						statutory: {
							NHI_SUPPLEMENT_EMPLOYER: { base, employee: 0, employer: 0, charged_base, parts: {} }
						}
					},
					period: {},
					company: {}
				} as never);
			// Exact: (105,000 − 76,100) × 2.11% = 609.79 → 610, against the slips' 0 + 627.
			assert.equal(remit(105000, insuredOn(45000) + insuredOn(60000, q)), 610);
			// Salary below the insured amounts in total: nothing owed, and no obligation is raised.
			assert.equal(remit(105000, insuredOn(45000) + insuredOn(60000)), 0);
			// A former worker's non-compete pay has no insured amount: the whole of it is in the base.
			assert.equal(remit(30000, 0), 633);
			// 營利事業所得稅查核準則 §88(2)(1): NT$3,000 a month, so 1,500 a semi-monthly part (4,000 → 500 each half).
			const meal = file(version, 'work_catalog').find((row) => row.code === 'MEAL_TAXABLE_EXCESS')!;
			const half = (parts: number) =>
				evaluateConfigured(String(meal.rate), {
					...payslipContext,
					terms: {
						...payslipContext.terms,
						allowances: [{ code: 'MEAL_ALLOWANCE', amount: 4000 }]
					},
					period: { ...payslipContext.period, parts, days: 15, paid_days: 15 }
				} as never);
			assert.equal(half(2), 500);
			assert.equal(half(1), 1000);
			// Fixed allowances divide by the parts too: a 3,000 meal allowance is 1,500 a half.
			const allowance = file(version, 'allowance_catalog').find(
				(row) => row.code === 'MEAL_ALLOWANCE'
			)!;
			assert.equal(
				evaluateConfigured(String(allowance.amount), {
					...payslipContext,
					allowance: { amount: 3000 },
					period: { ...payslipContext.period, parts: 2, days: 15, paid_days: 15 }
				} as never),
				1500
			);
		}
	});
	it('a semi-monthly month sums to exactly one month: BASIC, allowances, the day-rate deduction and the per-part floors', async () => {
		const { tables, run } = tw();
		tables.get('entity')![0]!.pay_frequency = 'SEMI_MONTHLY';
		const contract = tables.get('employment_contract')!.find((row) => row.id === 'k-p1')!;
		const term = ((contract.facts as Row).contract_terms as Row[])[0]!;
		term.base_salary = { value: 45000, currency: 'TWD' };
		term.allowances = [
			{ code: 'MEAL_ALLOWANCE', amount: { value: 3000 } },
			{ code: 'FULL_ATTENDANCE_BONUS', amount: { value: 2000 } }
		];
		tables.get('employment_contract')!.splice(
			tables.get('employment_contract')!.findIndex((row) => row.id === 'k-p2'),
			1
		);
		const leave = file('version_2', 'leave_catalog').find((row) => row.code === 'PERSONAL_LEAVE')!;
		tables.get('leave_catalog_entry')!.push({
			id: 'pl1',
			catalog_id: leave.id,
			employment_id: 'k-p1',
			company_id: tables.get('entity')![0]!.id,
			approval_id: null,
			payslip_id: null,
			activity: 'TIME_OFF',
			occurred_on: '2026-03-20',
			from: '2026-03-20',
			to: '2026-03-20',
			days: 1,
			facts: {}
		});
		const lines = (plan: Awaited<ReturnType<typeof run>>) => {
			const slip = plan.payslips.find((row) => row.employment_id === 'k-p1')!;
			return Object.fromEntries(
				[...slip.base, ...slip.adjustments].map((line) => [line.component_code, line.amount])
			) as Record<string, number>;
		};
		const first = lines(await run('2026-03-1', 'REGULAR'));
		const second = lines(await run('2026-03-2', 'REGULAR'));
		// 1–15 and 16–31 March (15 and 16 days) are each half the month: 22,500 + 22,500 = 45,000; 1,500 + 1,500 meal.
		assert.equal(first.BASIC, 22500);
		assert.equal(second.BASIC, 22500);
		assert.equal(first.MEAL_ALLOWANCE + second.MEAL_ALLOWANCE, 3000);
		// The personal day (20 March) is deducted once at monthly ÷ 30, not the half's 16 days: 1,500.
		assert.equal(first.NO_PAY_LEAVE, undefined);
		assert.equal(second.NO_PAY_LEAVE, -1500);
		// 勞工請假規則 §9: the attendance bonus loses 2,000 ÷ 30 = 66 for the day, once: 1,000 + 934 = 1,934.
		assert.equal(first.FULL_ATTENDANCE_BONUS + second.FULL_ATTENDANCE_BONUS, 2000 - 66);
		// A monthly entity pays the same month the same: 45,000 − 1,500, 3,000 meal, 1,934 bonus.
		const monthly = tw();
		const k = monthly.tables.get('employment_contract')!.find((row) => row.id === 'k-p1')!;
		Object.assign(((k.facts as Row).contract_terms as Row[])[0]!, {
			base_salary: term.base_salary,
			allowances: term.allowances
		});
		monthly.tables.get('leave_catalog_entry')!.push(tables.get('leave_catalog_entry')![0]!);
		const whole = lines(await monthly.run('2026-03', 'REGULAR'));
		assert.equal(
			first.BASIC + second.BASIC + (second.NO_PAY_LEAVE ?? 0),
			whole.BASIC! + whole.NO_PAY_LEAVE!
		);
		assert.equal(first.MEAL_ALLOWANCE + second.MEAL_ALLOWANCE, whole.MEAL_ALLOWANCE);
		assert.equal(
			first.FULL_ATTENDANCE_BONUS + second.FULL_ATTENDANCE_BONUS,
			whole.FULL_ATTENDANCE_BONUS
		);
		// 減班休息 keeps each half's share of the minimum wage: 30,000 − 29,500 = 500 a month, 250 a half.
		for (const version of versions.slice(1)) {
			const deduction = file(version, 'work_catalog').find(
				(row) => row.code === 'SUSPENSION_DEDUCTION'
			)!;
			const reduced = [1, 2, 3].map(() => ({
				date: '2026-03-03',
				day_type: 'WORK',
				worked: false,
				suspended: {
					kind: 'REDUCED_WORK_AGREEMENT',
					facts: {},
					counts_as_attended: false,
					scheduled: false,
					pay: 0
				}
			}));
			const half = (parts: number) =>
				evaluateConfigured(String(deduction.rate), {
					...payslipContext,
					terms: { ...payslipContext.terms, base_salary: 30000 },
					rules: { minimum_wage: { monthly: 29500 } },
					period: { ...payslipContext.period, parts },
					work: { ...payslipContext.work, days: reduced }
				} as never);
			assert.equal(half(1), 500);
			assert.equal(half(2), 250);
			// The migrant food-and-lodging cap is the month's: a second half cannot deduct it again.
			const cap = file(version, 'rule_set').find((row) => row.code === 'FOOD_LODGING_CAP')!;
			const trips = (earlier: number) =>
				evaluateConfigured(String((cap.rules as Row).when), {
					...payslipContext,
					employee: { ...payslipContext.employee, facts: { food_lodging_monthly_cap: 5000 } },
					earned: { ...payslipContext.earned, month: earlier ? { FOOD_LODGING: -earlier } : {} },
					payslip: { lines: { FOOD_LODGING: -2500 } }
				} as never);
			assert.equal(trips(0), false);
			assert.equal(trips(2500), false);
			assert.equal(trips(3000), true);
		}
	});
	it('semi-monthly overtime caps read the month to date: a 30 + 30 h month trips the 46-hour cap and taxes its excess once', () => {
		for (const version of versions) {
			const rows = file(version, 'rule_set');
			const when = (code: string) =>
				String((rows.find((row) => row.code === code)!.rules as Row).when);
			const excess = file(version, 'work_catalog').find(
				(row) => row.code === 'OVERTIME_TAXABLE_EXCESS'
			)!;
			// 15 working days of 2 overtime hours in each half (30 + 30 = 60 h).
			const half = (first: number, in_period: boolean) =>
				Array.from({ length: 15 }, (_, i) => ({
					date: `2026-04-${String(first + i).padStart(2, '0')}`,
					day_type: 'WORK',
					holiday_kind: '',
					worked: true,
					worked_hours: 10,
					overtime_hours: 2,
					intervals: [],
					in_period
				}));
			const context = (days: Row[], month_days: Row[], earlier = 0, facts: Row = {}) => ({
				...payslipContext,
				period: {
					...payslipContext.period,
					key: '2026-04-2',
					from: '2026-04-16',
					to: '2026-04-30',
					part: 2,
					parts: 2
				},
				company: {
					region: '',
					risk_class: '42',
					pay_frequency: 'SEMI_MONTHLY',
					facts,
					headcount: 40
				},
				work: { ...payslipContext.work, holidays: [], days, month_days },
				earned: {
					...payslipContext.earned,
					month: earlier ? { OVERTIME_TAXABLE_EXCESS: earlier } : {}
				},
				payslip: { gross: 0, net: 0, lines: {} },
				statutory: {}
			});
			const first = half(1, false);
			const second = half(16, true);
			// The first half alone (30 h) is under the cap; the second half reads the month: 60 h > 46.
			assert.equal(
				evaluateConfigured(when('OVERTIME_MONTHLY_CAP'), context(first, first) as never),
				false
			);
			assert.equal(
				evaluateConfigured(
					when('OVERTIME_MONTHLY_CAP'),
					context(second, [...first, ...second]) as never
				),
				true
			);
			// Before month_days the half read only its own 30 h and passed.
			assert.equal(
				evaluateConfigured(when('OVERTIME_MONTHLY_CAP'), context(second, second) as never),
				false
			);
			// With the collective approval the month may reach 54: 60 h still trips, and 30+ employed files it.
			const approved = {
				overtime_extension_approval_on: '2026-01-15',
				overtime_extension_approved_by: 'UNION'
			};
			const month = [...first, ...second];
			assert.equal(
				evaluateConfigured(
					when('OVERTIME_MONTHLY_CAP'),
					context(second, month, 0, approved) as never
				),
				true
			);
			assert.equal(
				evaluateConfigured(
					when('OVERTIME_EXTENSION_FILING'),
					context(second, month, 0, approved) as never
				),
				true
			);
			// 所得稅法 §14(1)(3): the 14 hours above 46 are taxable — 15,075 × 14/60 = 3,517.5 for the month, taxed once:
			// the second half carries all of it; with 3,517.5 already in the first half's base, nothing more.
			const taxed = (earlier: number) =>
				evaluateConfigured(String(excess.eligibility), context(second, month, earlier) as never) ===
				true
					? Number(
							evaluateConfigured(String(excess.rate), context(second, month, earlier) as never)
						)
					: 0;
			assert.equal(Number(taxed(0).toFixed(2)), 3517.5);
			assert.equal(Number(taxed(3517.5).toFixed(2)), 0);
			assert.equal(
				evaluateConfigured(String(excess.eligibility), context(first, first) as never),
				false
			);
		}
	});
	it('婚假 fourteen days from 1 October 2026, the claim window and the transition; the protected miscarriage sick day', () => {
		const balance = (
			version: string,
			movements: Row[],
			asOf: string,
			marriage = '2026-09-20',
			facts: Row = {}
		) => {
			const rows = versions.flatMap((v) => file(v, 'leave_catalog'));
			const own = file(version, 'leave_catalog');
			const classes = own.map((row) => classFromRow(row as never));
			const cls = own.find((row) => row.code === 'MARRIAGE_LEAVE')!;
			// The attendance the engine reads: weekdays from 1 September, each movement covering its next working days.
			const covered = new Set<string>();
			for (const m of movements) {
				let day = String(m.from);
				for (
					let left = Number(m.days);
					left > 0;
					day = String(evaluateConfigured(`add_days("${day}", 1)`, {}))
				)
					if (![0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())) {
						covered.add(day);
						left--;
					}
			}
			const attendanceDays: Row[] = [];
			for (
				let day = '2026-09-01';
				day <= asOf;
				day = String(evaluateConfigured(`add_days("${day}", 1)`, {}))
			)
				if (![0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()))
					attendanceDays.push({
						date: day,
						scheduled: true,
						worked: !covered.has(day),
						holiday: false,
						leave: covered.has(day) ? ['MARRIAGE_LEAVE'] : []
					});
			return leaveBalances({
				attendanceDays: attendanceDays as never,
				classes: [
					...classes,
					...rows
						.filter((row) => !own.includes(row) && row.code === 'MARRIAGE_LEAVE')
						.map((row) => classFromRow(row as never))
				],
				movements: movements.map((m) =>
					movementFromRow({ activity: 'TIME_OFF', approval_id: null, ...m } as never)
				),
				serviceMonths: 30,
				asOf,
				employmentStart: '2023-09-01',
				entry: movementFromRow({
					activity: 'TIME_OFF',
					approval_id: null,
					catalog_id: cls.id,
					occurred_on: asOf,
					from: asOf,
					days: 1,
					facts: { event_id: 'w1', marriage_date: marriage, ...facts }
				} as never),
				context: {
					...subject(),
					entry: { facts: { event_id: 'w1', marriage_date: marriage, ...facts } }
				} as never
			}).find((row) => row.catalog_id === cls.id)!.available;
		};
		const taken = (version: string, from: string, days: number) => ({
			catalog_id: file(version, 'leave_catalog').find((row) => row.code === 'MARRIAGE_LEAVE')!.id,
			occurred_on: from,
			from,
			days,
			facts: { event_id: 'w1', marriage_date: '2026-09-20' }
		});
		// Registered 20 September: 8 days under version_3; 5 taken in September leave 3 there.
		assert.equal(balance('version_3', [], '2026-09-25'), 8);
		assert.equal(balance('version_3', [taken('version_3', '2026-09-21', 5)], '2026-09-28'), 3);
		// 勞工請假規則 §2 (in force 1 October): still inside its claim window, the marriage takes 14 less the 5 → 9.
		assert.equal(balance('version_4', [taken('version_3', '2026-09-21', 5)], '2026-10-05'), 9);
		assert.equal(balance('version_4', [], '2026-10-05'), 14);
		// MOL 99111: only a marriage whose eight days were not used up by 30 September is extended — all eight taken in
		// September keeps it at eight (nothing left), seven taken leaves 14 − 7 = 7.
		assert.equal(balance('version_4', [taken('version_3', '2026-09-21', 8)], '2026-10-05'), 0);
		assert.equal(balance('version_4', [taken('version_3', '2026-09-21', 7)], '2026-10-05'), 7);
		// An October marriage is not a transition case: 14.
		assert.equal(balance('version_4', [], '2026-10-12', '2026-10-12'), 14);
		// 勞動3字第1040130270號令: ten days before registration to three months after, or a year by agreement.
		assert.equal(balance('version_4', [], '2026-12-21'), 0);
		assert.equal(
			balance('version_4', [], '2026-12-21', '2026-09-20', {
				taken_within_a_year_by_agreement: true
			}),
			14
		);
		assert.equal(balance('version_4', [], '2026-10-05', '2026-10-12'), 14);
		assert.equal(balance('version_4', [], '2026-10-05', '2026-10-25'), 0);
		// A marriage whose three months ran out before 1 October gains nothing (it can no longer be claimed).
		assert.equal(balance('version_4', [], '2026-10-05', '2026-06-01'), 0);
		// 勞工請假規則 §9(1)(2): a sick day for a miscarriage under three months (no maternity leave) takes nothing
		// from the attendance bonus; an ordinary sick day takes bonus ÷ 30.
		for (const version of versions) {
			const bonus = file(version, 'allowance_catalog').find(
				(row) => row.code === 'FULL_ATTENDANCE_BONUS'
			)!;
			const pay = (facts: Row) =>
				evaluateConfigured(String(bonus.amount), {
					...payslipContext,
					allowance: { amount: 3000 },
					leave: {
						rows: [
							{
								code: 'SICK_LEAVE',
								activity: 'TIME_OFF',
								days: 2,
								is_npl: false,
								can_encash: true,
								pay_fraction: 0.5,
								facts
							}
						]
					}
				} as never);
			assert.equal(pay({}), 2800);
			assert.equal(pay({ miscarriage_under_three_months: true }), 3000);
		}
	});
});
