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
import { evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { electionKeysOf } from '../src/lib/payroll_engine/employment_facts.js';
import { DUTY_KEYS, dutiesOf, raiseDuties, triggerOf, withBalances } from './duties.ts';
import { classFromRow, leaveBalances, movementFromRow } from '../src/lib/payroll_engine/leave.ts';
import { Reads } from '../src/lib/payroll_engine/foundation.js';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.js';

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
};
/** `assessStatutory`'s context for one scheme: the subject, the month's wage parts, the year before, the period. */
const statutoryContext = (ordinary: number, over: Over = {}): Row => {
	const period = over.period ?? '2026-03';
	const additional = over.additional ?? 0;
	return {
		...subject(over),
		wage: { ordinary, additional },
		month: { ordinary, additional },
		year: { ordinary: 0, additional: over.year ?? 0 },
		period: {
			key: period,
			from: `${period}-01`,
			to: `${period}-28`,
			days: 31,
			month: Number(period.slice(5)),
			salary_paid: false
		},
		base: { ordinary, additional, assessed: ordinary + additional, amount: ordinary + additional },
		rules: {},
		charged: { month: {}, year: {} },
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
		month_key: '2026-03'
	},
	work: {
		overtime_hours: 3,
		incentive_hours: 0,
		dates: ['2026-03-10'],
		holidays: [{ date: '2026-03-10', kind: 'PUBLIC_HOLIDAY', given_to: 'EVERYONE', replaces: '' }],
		holiday_dates: ['2026-03-10'],
		// One working day with 3 overtime hours, a worked 休息日 (OFF) of 10 hours, a worked 例假 (REST) and a holiday.
		days: [
			['2026-03-10', 'WORK', 'PUBLIC_HOLIDAY', 8, 0],
			['2026-03-11', 'WORK', '', 8, 3],
			['2026-03-14', 'OFF', '', 10, 0],
			['2026-03-15', 'REST', '', 8, 0]
		].map(([date, day_type, holiday_kind, worked_hours, overtime_hours]) => ({
			date,
			day_type,
			shift_code: '',
			holiday_kind,
			scheduled_hours: day_type === 'WORK' ? 8 : 0,
			worked_hours,
			overtime_hours,
			incentive_hours: 0,
			intervals: []
		}))
	},
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

	return { tables, run, lines, COMPANY };
};

describe('TW public lineage', () => {
	it('every version holds settings, rule_set and every catalogue, each row on its own version', () => {
		assert.deepEqual(versions, ['version_1', 'version_2']);
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
			// RISK_CLASS now lives in OCC_INJURY's own CEL; the exit grounds are enums the UI reads.
			assert.deepEqual(Object.keys(settings.reference_tables as Row).toSorted(), [
				'LSA_TERMINATION_GROUND',
				'TERMINATION_GROUND'
			]);
			assert.deepEqual((settings.payroll as Row).currency, 'TWD');
			const families = new Set(file(version, 'rule_set').map((row) => row.family));
			assert.deepEqual([...families].toSorted(), [
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
			for (const key of read(/\bterms\.([a-z_]+)/g))
				assert.ok(term.has(key) || derived.has(key), `${version} terms.${key} is declared`);
			for (const key of read(/\bemployee\.facts\.([a-z_]+)/g))
				assert.ok(profile.has(key), `${version} employee.facts.${key} is declared`);
			for (const key of read(/\bexit_facts\.([a-z_]+)/g))
				assert.ok(exit.has(key), `${version} exit_facts.${key} is declared`);
			for (const key of read(/\bcompany\.facts\.([a-z_]+)/g))
				assert.ok(company.has(key), `${version} company.facts.${key} is declared`);
			for (const key of [
				...read(/\bscheme\.elections\.([a-z_]+)/g),
				...read(/\belections\.[A-Z_]+\.([a-z_]+)/g)
			])
				assert.ok(elections.has(key), `${version} election ${key} is declared`);
			assert.deepEqual(
				[...read(/\bemployee\.facts\.([a-z_]+)/g)].toSorted(),
				version === 'version_1'
					? ['foreign_spouse_of_national']
					: ['foreign_professional', 'foreign_spouse_of_national', 'migrant_worker']
			);
			assert.deepEqual([...elections].toSorted(), [
				'employer_rate',
				'enrolled_dependants',
				'exempt',
				'exemptions',
				'insured_amount',
				'insured_elsewhere',
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
		assert.equal(Number(fund.employer.toFixed(2)), 11.45);
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
		assert.deepEqual(at('version_2', 'NHI_PART_TIME', 29500, elsewhere), {
			employee: 622,
			employer: 0
		});
		assert.equal(at('version_2', 'NHI_PART_TIME', 29499, elsewhere), null);
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
		assert.deepEqual(at('version_1', 'NHI_PART_TIME', 28590, { ...elsewhere, period: '2025-12' }), {
			employee: 603,
			employer: 0
		});
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
		// From 1 April 2026 a migrant worker under ten years at the unit leaves the reserve wage total.
		assert.equal(
			at('version_2', 'LABOR_PENSION_RESERVE', 45800, { ...migrant, period: '2026-04' }),
			null
		);
		assert.deepEqual(
			at('version_2', 'LABOR_PENSION_RESERVE', 45800, {
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
		assert.deepEqual(at('version_2', 'INCOME_TAX_BONUS', 90500), { employee: 0, employer: 0 });
		assert.deepEqual(at('version_2', 'INCOME_TAX_BONUS', 100000), { employee: 5000, employer: 0 });
		assert.deepEqual(at('version_1', 'INCOME_TAX_BONUS', 89000, { period: '2025-12' }), {
			employee: 4450,
			employer: 0
		});
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
					SICK_LEAVE: ['30.0', 'CALENDAR_YEAR'],
					PERSONAL_LEAVE: ['14.0', 'CALENDAR_YEAR'],
					MARRIAGE_LEAVE: ['8.0', 'EVENT'],
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
			assert.equal(available('MARRIAGE_LEAVE', married, '2026-06-30', 'w1'), 3);
			assert.equal(available('MARRIAGE_LEAVE', married, '2026-06-30', 'w2'), 8);
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
				lines: Row = {}
			) => ({
				...payslipContext,
				company: { region: '', risk_class: '42', pay_frequency: 'MONTHLY', facts, headcount },
				work: {
					...payslipContext.work,
					days: days.map(([day_type, worked_hours, overtime_hours], i) => ({
						date: `2026-03-${String(i + 1).padStart(2, '0')}`,
						day_type,
						holiday_kind: '',
						worked_hours,
						overtime_hours
					}))
				},
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
			assert.equal(
				trips(
					'OVERTIME_MONTHLY_CAP',
					slip([...month(2), ['OFF', 8, 0]], { overtime_consent: true })
				),
				false
			);
			assert.equal(
				trips(
					'OVERTIME_EXTENSION_FILING',
					slip([...month(2), ['OFF', 8, 0]], { overtime_consent: true }, 30)
				),
				true
			);
			assert.equal(
				trips(
					'OVERTIME_EXTENSION_FILING',
					slip([...month(2), ['OFF', 8, 0]], { overtime_consent: true }, 29)
				),
				false
			);
			// §32(2): 138 hours in three months under consent, from hours.rolling (休息日 hours count, its overtime column does not).
			const rolling = (overtime: number, offWorked: number, offOvertime = 0) => ({
				...slip([], { overtime_consent: true }),
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
			assert.equal(
				trips('OVERTIME_QUARTER_CAP', { ...rolling(130, 9), company: { facts: {} } }),
				false
			);
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
			assert.equal(adhoc('SEVERANCE_PAY'), 56250);
			assert.equal(adhoc('SEVERANCE_PAY', {}), 1000);
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
			EXIT: { exit_on: '2026-06-30', holidays: [] },
			'calendar.daily': { today: '2026-03-01', holidays: [] },
			'leave_catalog_entry.created': { today: '2026-03-10', holidays: [] }
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
			assert.equal(duties.length, version === 'version_1' ? 36 : 37, version);
			const due = (code: string, context: Row) =>
				evaluateConfigured(
					String((duties.find((duty) => duty.code === code)!.rules as Row).due),
					context as never
				);
			for (const duty of duties) {
				const rules = duty.rules as Row;
				assert.deepEqual(
					Object.keys(rules).filter((key) => !DUTY_KEYS.includes(key)),
					[],
					`${version} ${String(duty.code)}`
				);
				assert.ok(String(rules.description).length > 0 && String(rules.authority).length > 0);
				assert.ok(
					['PAYROLL_RUN', 'HIRE', 'EXIT', 'calendar.daily', 'leave_catalog_entry.created'].includes(
						String(rules.trigger)
					),
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
							employee: { nationality: 'TW', gender: '', date_of_birth: '', facts: {} }
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
				COMP_TIME_YEAR_END_PAYMENT: '2026-03-31'
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
			assert.equal(april.length, count('PAYROLL_RUN'));
			assert.equal(april.length, 6);
			assert.equal(
				april.find((write) => write.duty_code === 'WITHHOLDING_TAX_REMITTANCE')!.due_on,
				'2026-05-11' // 10 May is a Sunday
			);
			assert.ok(
				april.every((write) => write.company_id === 'c1' && write.triggered_on === '2026-04-01')
			);
			const january = run('2027-01');
			assert.equal(january.length, count('PAYROLL_RUN', '01'));
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
			assert.equal(run('2026-12').length, count('PAYROLL_RUN', '12') - 1);
			assert.equal(run('2026-12', reserving).length, count('PAYROLL_RUN', '12'));
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
			// The work-rules filing rises only with the hire that brings the entity to thirty.
			assert.equal(hired.length, count('HIRE') - 1);
			assert.equal(hired.length, 5);
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
			assert.equal(exits.length, count('EXIT') - 5);
			assert.equal(exits.length, 7);
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
				['ANNUAL_LEAVE_YEAR_END_PAYMENT', '2026-06-01'],
				['COMP_TIME_YEAR_END_PAYMENT', '2026-06-01']
			]);
			assert.deepEqual(tick('2026-04-29'), []);
			assert.deepEqual(tick('2026-05-01'), []);
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
			WAGE_ARREARS_FUND: [0, 11.45],
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
			WAGE_ARREARS_FUND: [0, 11.45],
			LABOR_PENSION_RESERVE: [0, 1200],
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
});
