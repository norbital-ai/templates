/** The JP public lineage: snapshot structure, CEL on the engine's own contexts, obligations, and amounts through a run. */
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
import { electionKeysOf } from '../src/lib/payroll_engine/employment_facts.js';
import { dutiesOf, raiseDuties, triggerOf } from './duties.ts';
import { evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { Reads } from '../src/lib/payroll_engine/foundation.js';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.js';

type Row = Record<string, unknown>;
const lineages = resolve(process.cwd(), 'seed/jurisdiction');
const JP = resolve(lineages, 'JP');
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
const versions = readdirSync(JP)
	.filter((entry) => entry.startsWith('version_'))
	.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const file = (version: string, name: string): Row[] =>
	JSON.parse(readFileSync(resolve(JP, version, `${name}.json`), 'utf8')) as Row[];
const settingsOf = (version: string): Row => file(version, 'jurisdiction_settings')[0]!;
const payrollRules = (version: string): Row =>
	Object.fromEntries(
		file(version, 'rule_set')
			.filter((row) => row.family === 'PAYROLL')
			.map((row) => [row.code, row.rules])
	);
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

// ── the statutory context exactly as `assessStatutory` builds it ────────────────────────────────────────────────────
type Person = {
	dob?: string;
	region?: string;
	category?: string;
	residency?: string;
	classification?: string;
	monthly_wage?: number;
	elections?: Record<string, Row>;
	company?: Row;
	exit_date?: string;
	start_date?: string;
	service_months?: number;
	earned?: Row;
	terms_facts?: Row;
};
type Month = { ordinary?: number; bonus?: number; commuting?: number; retirement?: number };
const periodOf = (key: string) => {
	const [year, month] = key.split('-').map(Number) as [number, number];
	const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return {
		key,
		from: `${key}-01`,
		to: `${key}-${String(days).padStart(2, '0')}`,
		days,
		month,
		salary_paid: false
	};
};
const statutoryContext = (key: string, person: Person = {}, month: Month = {}) => {
	const parts = { ordinary: 0, bonus: 0, commuting: 0, retirement: 0, ...month };
	const employment = {
		classification: person.classification ?? 'ORDINARY',
		service_months: person.service_months ?? 60,
		exit_date: person.exit_date ?? '',
		start_date: person.start_date ?? '2020-04-01',
		exit_ground: '',
		exit_facts: {}
	};
	return {
		employee: {
			gender: 'MALE',
			date_of_birth: person.dob ?? '1990-06-15',
			age: null,
			facts: {}
		},
		company: {
			region: person.region ?? 'TOKYO',
			risk_class: '',
			pay_frequency: 'MONTHLY',
			facts: person.company ?? {
				workers_accident_rate_per_mille: 3,
				monthly_average_scheduled_hours: 160
			}
		},
		terms: {
			work_classification: person.classification ?? 'ORDINARY',
			statutory_work_category: person.category ?? 'SOCIAL_AND_EMPLOYMENT',
			employment_type: 'INDEFINITE',
			residency_status: person.residency ?? 'RESIDENT',
			residency_since: '',
			base_salary: person.monthly_wage ?? parts.ordinary,
			monthly_wage: person.monthly_wage ?? parts.ordinary,
			facts: person.terms_facts ?? {}
		},
		earned: person.earned ?? { month: {}, year: {}, previous_month: {} },
		work: { days: [] },
		employment,
		person: { employment, residency_status: person.residency ?? 'RESIDENT' },
		wage: parts,
		month: parts,
		year: { ordinary: 0, bonus: 0, commuting: 0, retirement: 0 },
		period: periodOf(key)
	};
};
type Configuration = {
	person?: Record<string, string>;
	assessable?: Record<string, string>;
	assessment?: string;
	refuse_when?: { when: string; message: string }[];
	rules: { when?: string; employee?: string; employer?: string }[];
};
/** One scheme's month charge as `assessStatutory` evaluates it: person facts, assessable parts, guards, first rule. */
const charge = (row: Row, base: Row & { person: Row; month: Row }) => {
	const configuration = row.configuration as Configuration;
	let context: Row = { ...base };
	const facts: Row = {};
	for (const [fact, expression] of Object.entries(configuration.person ?? {}))
		facts[fact] = evaluateConfigured(expression, context as never);
	context = { ...context, person: { ...base.person, ...facts } };
	const parts: Record<string, number> = {};
	for (const part of Object.keys(base.month)) {
		const expression = configuration.assessable?.[part];
		const value =
			expression == null
				? (base.month as Record<string, number>)[part]!
				: Number(evaluateConfigured(expression, context as never));
		parts[part] = Math.round(Math.max(0, value) * 100) / 100;
	}
	const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
	context = { ...context, base: { ...parts, assessed: total, amount: total } };
	for (const guard of configuration.refuse_when ?? [])
		if (evaluateConfigured(guard.when, context as never) === true) return 'REFUSED';
	for (const rule of configuration.rules) {
		if (rule.when != null && evaluateConfigured(rule.when, context as never) !== true) continue;
		const assessed =
			configuration.assessment == null
				? total
				: Number(evaluateConfigured(configuration.assessment, context as never));
		const ruled = { ...context, base: { ...parts, assessed, amount: assessed } };
		return {
			employee:
				rule.employee == null ? 0 : Number(evaluateConfigured(rule.employee, ruled as never)),
			employer:
				rule.employer == null ? 0 : Number(evaluateConfigured(rule.employer, ruled as never))
		};
	}
	return null;
};
/** Every scheme of a version in catalogue order, each seeing the version's `rules`, the employee's `elections` and the
 * `charged.month` of the schemes before it — as one slip of `assessStatutory`. */
const slip = (version: string, key: string, person: Person = {}, month: Month = {}) => {
	const base = statutoryContext(key, person, month);
	const elections = person.elections ?? {};
	const rows = file(version, 'statutory_contribution_catalog');
	const rules = Object.fromEntries(
		file(version, 'rule_set')
			.filter((row) => row.family === 'PAYROLL')
			.map((row) => [row.code, row.rules])
	);
	const charged = {
		year: Object.fromEntries(rows.map((row) => [row.code, { employee: 0, employer: 0 }])),
		month: Object.fromEntries(rows.map((row) => [row.code, { employee: 0, employer: 0 }]))
	};
	const out: Record<string, ReturnType<typeof charge>> = {};
	for (const row of rows) {
		const code = String(row.code);
		const result = charge(row, {
			...base,
			rules,
			charged,
			elections,
			scheme: { code, standing: '', elections: elections[code] ?? {} }
		});
		out[code] = result;
		// A refusal stops the whole payslip, as in the engine.
		if (result === 'REFUSED') {
			for (const later of rows) out[String(later.code)] ??= 'REFUSED';
			break;
		}
		if (result !== null) charged.month[code] = { ...result };
	}
	return out;
};
const at = (version: string, code: string, key: string, person: Person, month: Month) =>
	slip(version, key, person, month)[code];

const employment = { classification: 'ORDINARY', service_months: 30, exit_date: '' };
const payslipContext = {
	period: { key: '2026-04', from: '2026-04-01', to: '2026-04-30', days: 30, paid_days: 30 },
	terms: {
		base_salary: 180000,
		monthly_wage: 180000,
		work_classification: 'ORDINARY',
		statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
		employment_type: 'INDEFINITE',
		residency_status: 'RESIDENT'
	},
	employee: { gender: 'FEMALE', facts: {} },
	company: {
		region: 'TOKYO',
		facts: { monthly_average_scheduled_hours: 160, wage_deduction_agreement: true }
	},
	employment,
	person: { employment },
	work: {
		overtime_hours: 70,
		incentive_hours: 0,
		dates: ['2026-04-10', '2026-04-12'],
		holidays: [],
		days: [
			{
				date: '2026-04-10',
				day_type: 'WORK',
				worked_hours: 10,
				overtime_hours: 2,
				intervals: [{ start: '2026-04-10T15:00', end: '2026-04-11T01:00' }]
			},
			{
				date: '2026-04-12',
				day_type: 'REST',
				worked_hours: 8,
				overtime_hours: 0,
				intervals: [{ start: '2026-04-12T09:00', end: '2026-04-12T18:00' }]
			}
		]
	},
	leave: {
		rows: [{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 2, is_npl: true, can_encash: false }]
	},
	allowance: { code: 'FIXED_ALLOWANCE', amount: 30000 }
};
const entry = (facts: Row, quantity = 1) => ({
	amount: 1000,
	quantity,
	occurred_on: '2026-04-10',
	due_on: '2026-04-30',
	incurred_on: '2026-04-10',
	...facts,
	facts
});

/** Every CEL string a version holds, with where it lives. */
const celOf = (version: string): [string, string][] => {
	const out: [string, string][] = [];
	const walk = (value: unknown, where: string, cel: boolean) => {
		if (typeof value === 'string') {
			if (cel && value !== '') out.push([where, value]);
		} else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${where}[${i}]`, cel));
		else if (value != null && typeof value === 'object')
			for (const [key, child] of Object.entries(value))
				walk(
					child,
					`${where}.${key}`,
					cel ||
						[
							'eligibility',
							'qualifies_when',
							'quantity',
							'rate',
							'amount',
							'when',
							'employee',
							'employer',
							'assessment',
							'due',
							'days',
							'configuration'
						].includes(key)
				);
	};
	for (const name of ['rule_set', ...CATALOGS])
		for (const row of file(version, name)) {
			const { authority: _a, name: _n, order_authority: _o, ...rest } = row;
			const configuration = rest.configuration as Configuration | undefined;
			if (configuration?.refuse_when)
				rest.configuration = {
					...configuration,
					refuse_when: configuration.refuse_when.map((guard) => ({ when: guard.when }))
				};
			if (name === 'rule_set') {
				const rules = rest.rules as Row;
				walk({ due: rules.due }, `${version}/${name}:${String(row.code)}`, false);
			} else walk(rest, `${version}/${name}:${String(row.code)}`, false);
		}
	return out;
};

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
	'exclusiveMinimum',
	'multipleOf',
	'pattern'
]);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
/** A structural JSON Schema 2020-12 check: known keywords of the right shape, recursively. */
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
		if (key === 'required' && !(Array.isArray(value) && value.every((v) => typeof v === 'string')))
			out.push(`${path}.required`);
		if (key === 'pattern') new RegExp(String(value));
		if (
			['minimum', 'maximum', 'exclusiveMinimum', 'multipleOf'].includes(key) &&
			typeof value !== 'number'
		)
			out.push(`${path}.${key}`);
	}
	return out;
};
const propertiesAt = (schema: unknown, ...path: string[]): Set<string> => {
	let node = schema as Row | undefined;
	for (const key of path) node = node?.[key] as Row | undefined;
	return new Set(Object.keys((node?.properties ?? {}) as Row));
};

describe('JP public lineage', () => {
	it('every version holds settings, rule_set and every catalogue, each row on its own version', () => {
		assert.equal(versions.length, 8);
		for (const version of versions) {
			for (const name of FILES)
				assert.equal(existsSync(resolve(JP, version, `${name}.json`)), true, `${version}/${name}`);
			const settings = file(version, 'jurisdiction_settings');
			assert.equal(settings.length, 1);
			for (const name of ['rule_set', ...CATALOGS])
				for (const row of file(version, name))
					assert.equal(row.settings_id, settings[0]!.id, `${version}/${name}:${String(row.code)}`);
			for (const name of CATALOGS)
				assert.ok(file(version, name).length > 0, `${version}/${name} is empty`);
			assert.deepEqual(settings[0]!.payroll, {
				currency: 'JPY',
				timezone: 'Asia/Tokyo',
				tax_year_start_month: 1
			});
		}
	});

	it('ids are unique across JP versions and collide with no other lineage', () => {
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
		const own = ids('JP');
		assert.equal(new Set(own).size, own.length);
		const others = new Set(
			readdirSync(lineages)
				.filter((lineage) => lineage !== 'JP')
				.flatMap(ids)
		);
		assert.deepEqual(
			own.filter((id) => others.has(id)),
			[]
		);
	});

	it('the lineage is one contiguous chain of inclusive date ranges, the last open', () => {
		let previous: Row | undefined;
		for (const version of versions) {
			const settings = settingsOf(version);
			const range = settings.effective_range as { from: string; to: string | null };
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
		assert.equal((settingsOf('version_1').effective_range as Row).from, '2025-12-01');
		assert.equal((previous!.effective_range as Row).to, null);
		assert.deepEqual(
			versions.map((version) => (settingsOf(version).effective_range as Row).from),
			[
				'2025-12-01',
				'2026-01-01',
				'2026-03-01',
				'2026-04-01',
				'2026-07-01',
				'2026-10-01',
				'2026-12-01',
				'2027-01-01'
			]
		);
	});

	it('every row carries only its model’s fields, and every value cites its authority', () => {
		for (const version of versions)
			for (const name of FILES) {
				const fields = modelFields(name);
				for (const row of file(version, name)) {
					for (const key of Object.keys(row))
						assert.ok(fields.has(key), `${version}/${name}:${String(row.code)} carries ${key}`);
					const authority =
						name === 'rule_set'
							? (row.rules as Row).authority
							: name === 'loan_catalog'
								? row.order_authority
								: name === 'jurisdiction_settings'
									? row.change_summary
									: row.authority;
					assert.ok(
						typeof authority === 'string' && authority.length > 40,
						`${version}/${name}:${String(row.code)}`
					);
				}
			}
	});

	it('codes are stable across versions; the support levy joins from April 2026', () => {
		for (const name of ['rule_set', ...CATALOGS]) {
			const codes = (version: string) =>
				file(version, name)
					.map((row) => String(row.code))
					.filter((code) => code !== 'CHILD_SUPPORT')
					.join(',');
			for (const version of versions) assert.equal(codes(version), codes('version_1'), name);
		}
		for (const version of versions)
			assert.equal(
				file(version, 'statutory_contribution_catalog').some((row) => row.code === 'CHILD_SUPPORT'),
				Number(version.slice(8)) >= 4,
				version
			);
	});

	it('both input schemas are JSON Schema 2020-12 and declare every fact the CEL reads', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const employee = settings.employee_input_schema as Row;
			const entity = settings.entity_input_schema as Row;
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
				assert.equal(schema.type, 'object');
				assert.deepEqual(schemaProblems(schema, `${version} ${name}`), []);
			}
			// The one layout every lineage shares (employment_facts.ts reads elections at exactly this path).
			assert.deepEqual(Object.keys(employee.properties as Row).toSorted(), [
				'contract_terms',
				'employment_statutory_facts',
				'exit_facts',
				'facts'
			]);
			const terms = propertiesAt(employee, 'properties', 'contract_terms', 'items');
			const elections = new Set(electionKeysOf(employee));
			assert.deepEqual([...elections].toSorted(), [
				'basic_pension_number',
				'dependency_declaration_filed',
				'employment_insurance_number',
				'june_amount',
				'monthly_amount',
				'retirement_due_to_disability',
				'retirement_income_declaration_filed',
				'secondary_dependants',
				'specified_officer',
				'standard_monthly_remuneration',
				'withholding_dependants'
			]);
			for (const column of ['region', 'risk_class'])
				assert.equal(propertiesAt(entity).has(column), false);
			const declared: Record<string, Set<string>> = {
				'employee.facts': propertiesAt(employee, 'properties', 'facts'),
				'company.facts': propertiesAt(entity),
				'scheme.elections': elections,
				elections,
				terms: new Set([...terms, 'monthly_wage', 'facts'])
			};
			const enums = (key: string) =>
				(
					(employee.properties as Row).contract_terms as {
						items: { properties: Record<string, { enum?: string[] }> };
					}
				).items.properties[key]!.enum;
			assert.deepEqual(enums('residency_status'), ['RESIDENT', 'NON_RESIDENT']);
			assert.deepEqual(enums('statutory_work_category'), [
				'SOCIAL_AND_EMPLOYMENT',
				'SOCIAL_ONLY',
				'EMPLOYMENT_ONLY',
				'NONE'
			]);
			let reads = 0;
			for (const [where, cel] of celOf(version))
				for (const [, root, key, election] of cel.matchAll(
					/\b(employee\.facts|company\.facts|scheme\.elections|terms)\.(\w+)|\belections\.[A-Z_]+\.(\w+)/g
				)) {
					reads++;
					const set = root == null ? declared.elections! : declared[root]!;
					const name = root == null ? election! : key!;
					assert.equal(
						set.has(name),
						true,
						`${where} reads undeclared ${root ?? 'elections'}.${name}`
					);
				}
			assert.ok(reads > 60);
			// The settings' prefecture table is the region vocabulary the CEL reads.
			const prefectures = Object.keys(
				(settings.reference_tables as { PREFECTURE: Row }).PREFECTURE
			);
			assert.equal(prefectures.length, 47);
			const wage = file(version, 'rule_set').find((row) => row.code === 'minimum_wage')!;
			assert.deepEqual(Object.keys((wage.rules as { by_region: Row }).by_region), prefectures);
		}
	});

	it('every CEL expression evaluates on the context its engine surface supplies', () => {
		const people: Person[] = [
			{},
			{ dob: '1980-01-01' },
			{ dob: '1950-01-01' },
			{ dob: '1955-03-20' },
			{ category: 'EMPLOYMENT_ONLY' },
			{ category: 'SOCIAL_ONLY', classification: 'OFFICER' },
			{ category: 'NONE', residency: 'NON_RESIDENT' },
			{
				elections: { INCOME_TAX: { dependency_declaration_filed: true, withholding_dependants: 9 } }
			},
			{
				elections: {
					HEALTH: { standard_monthly_remuneration: 1390000 },
					RESIDENT_TAX: { monthly_amount: 9000 }
				}
			},
			{
				exit_date: '2026-04-15',
				elections: { RETIREMENT_TAX: { retirement_income_declaration_filed: true } }
			}
		];
		const months: Month[] = [
			{},
			{ ordinary: 50000 },
			{ ordinary: 300000, commuting: 20000 },
			{ ordinary: 3000000, commuting: 200000 },
			{ bonus: 800000 },
			{ ordinary: 250000, bonus: 9000000 },
			{ retirement: 25000000 }
		];
		for (const version of versions) {
			const key = String((settingsOf(version).effective_range as Row).from).slice(0, 7);
			for (const person of people)
				for (const month of months)
					for (const [code, result] of Object.entries(slip(version, key, person, month))) {
						const row = { code };
						if (result === null || result === 'REFUSED') continue;
						assert.ok(
							Number.isFinite(result.employee) &&
								Number.isFinite(result.employer) &&
								result.employee >= 0 &&
								result.employer >= 0,
							`${version} ${String(row.code)} ${JSON.stringify([person, month, result])}`
						);
					}
			for (const row of [...file(version, 'work_catalog'), ...file(version, 'allowance_catalog')])
				for (const field of ['eligibility', 'quantity', 'rate', 'amount'])
					if (typeof row[field] === 'string' && row[field] !== '')
						assert.notEqual(
							evaluateConfigured(String(row[field]), {
								...payslipContext,
								rules: payrollRules(version)
							}),
							undefined
						);
			for (const name of ['adhoc_catalog', 'claim_catalog', 'loan_catalog'])
				for (const row of file(version, name))
					for (const facts of [{ average_daily_wage: 10000, notice_days_given: 10 }, {}]) {
						const context = { ...payslipContext, entry: entry(facts, 2) };
						for (const field of ['eligibility', 'qualifies_when'])
							if (typeof row[field] === 'string' && row[field] !== '')
								assert.equal(typeof evaluateConfigured(String(row[field]), context), 'boolean');
						for (const band of (row.bands ?? []) as { when: string; amount: string }[])
							if (evaluateConfigured(band.when, context) === true)
								assert.equal(typeof evaluateConfigured(band.amount, context), 'number');
					}
			for (const row of file(version, 'leave_catalog'))
				if (row.eligibility !== '')
					assert.equal(
						typeof evaluateConfigured(String(row.eligibility), payslipContext),
						'boolean'
					);
		}
	});

	it('health and nursing care: the 協会けんぽ prefectural rate on the standard monthly remuneration', () => {
		const salary = (wage: number): Month => ({ ordinary: wage });
		// FY2025 Tokyo 9.91%: grade 22 (300,000) → 29,730, half 14,865.
		assert.deepEqual(at('version_1', 'HEALTH', '2025-12', {}, salary(300000)), {
			employee: 14865,
			employer: 14865
		});
		// FY2026 Tokyo 9.85% + nursing 1.62% at 45: the 協会けんぽ table's 34,410 / 17,205.
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', { dob: '1981-01-10' }, salary(300000)), {
			employee: 17205,
			employer: 17205
		});
		// Grade 1 (under 63,000): 5,713 total, 2,856.5 → 2,856 (50 sen drops), employer 2,857.
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', {}, salary(62999)), {
			employee: 2856,
			employer: 2857
		});
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', {}, salary(63000)), {
			employee: 3349,
			employer: 3349
		});
		// The decided grade governs over the paid wage; Osaka 10.13% on 1,390,000 (grade 50): 140,807 → 70,403.5 → 70,403.
		assert.deepEqual(
			at(
				'version_4',
				'HEALTH',
				'2026-04',
				{ region: 'OSAKA', elections: { HEALTH: { standard_monthly_remuneration: 1390000 } } },
				salary(100000)
			),
			{ employee: 70403, employer: 70404 }
		);
		// Nursing from the month the day before the 40th birthday falls in: born 2 May → May, born 1 May → April.
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', { dob: '1986-05-02' }, salary(300000)), {
			employee: 14775,
			employer: 14775
		});
		assert.deepEqual(at('version_4', 'HEALTH', '2026-05', { dob: '1986-05-02' }, salary(300000)), {
			employee: 17205,
			employer: 17205
		});
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', { dob: '1986-05-01' }, salary(300000)), {
			employee: 17205,
			employer: 17205
		});
		// At 75 the person leaves employee health insurance; the exit month (loss mid-month) is not charged.
		assert.equal(at('version_4', 'HEALTH', '2026-04', { dob: '1951-04-10' }, salary(300000)), null);
		assert.equal(
			at('version_4', 'HEALTH', '2026-04', { exit_date: '2026-04-20' }, salary(300000)),
			null
		);
		assert.notEqual(
			at('version_4', 'HEALTH', '2026-04', { exit_date: '2026-04-30' }, salary(300000)),
			null
		);
		// 同月得喪: hired and gone in the same month is still charged.
		assert.notEqual(
			at(
				'version_4',
				'HEALTH',
				'2026-04',
				{ start_date: '2026-04-06', exit_date: '2026-04-20' },
				salary(300000)
			),
			null
		);
		// Standard bonus: under 1,000 dropped. 1,234,567 → 1,234,000 × 9.85% / 2 = 60,774.5 → 60,774.
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', {}, { bonus: 1234567 }), {
			employee: 60774,
			employer: 60775
		});
		assert.equal(
			at('version_4', 'HEALTH', '2026-04', { region: 'EDO' }, salary(300000)),
			'REFUSED'
		);
		assert.equal(at('version_4', 'HEALTH', '2026-04', { dob: '' }, salary(300000)), 'REFUSED');
		assert.equal(at('version_4', 'HEALTH', '2026-04', { category: 'NONE' }, salary(300000)), null);
	});

	it('the support levy, welfare pension, child contribution and labour insurance', () => {
		assert.deepEqual(at('version_4', 'CHILD_SUPPORT', '2026-04', {}, { ordinary: 300000 }), {
			employee: 345,
			employer: 345
		});
		assert.deepEqual(at('version_4', 'PENSION', '2026-04', {}, { ordinary: 300000 }), {
			employee: 27450,
			employer: 27450
		});
		// Pension floor grade 88,000 and ceiling 650,000; the bonus cap is 1,500,000 a month.
		assert.deepEqual(at('version_4', 'PENSION', '2026-04', {}, { ordinary: 60000 }), {
			employee: 8052,
			employer: 8052
		});
		assert.deepEqual(at('version_4', 'PENSION', '2026-04', {}, { ordinary: 2000000 }), {
			employee: 59475,
			employer: 59475
		});
		assert.deepEqual(at('version_4', 'PENSION', '2026-04', {}, { bonus: 2000000 }), {
			employee: 137250,
			employer: 137250
		});
		assert.equal(
			at('version_4', 'PENSION', '2026-04', { dob: '1956-04-20' }, { ordinary: 300000 }),
			null
		);
		assert.deepEqual(at('version_4', 'CHILD_CONTRIBUTION', '2026-04', {}, { ordinary: 300000 }), {
			employee: 0,
			employer: 1080
		});
		// Employment insurance on every wage: 5.5/9 per mille in FY2025, 5/8.5 from April 2026; construction 6/10.5.
		assert.deepEqual(at('version_1', 'EI', '2025-12', {}, { ordinary: 300000 }), {
			employee: 1650,
			employer: 2700
		});
		assert.deepEqual(at('version_4', 'EI', '2026-04', {}, { ordinary: 300000 }), {
			employee: 1500,
			employer: 2550
		});
		assert.deepEqual(
			at(
				'version_4',
				'EI',
				'2026-04',
				{ company: { ei_industry_class: 'CONSTRUCTION', workers_accident_rate_per_mille: 9.5 } },
				{ ordinary: 300100 }
			),
			{ employee: 1801, employer: 3151 }
		);
		// 0.5 yen at 5/1000 drops: 300,100 × 0.005 = 1,500.5 → 1,500.
		assert.deepEqual(at('version_4', 'EI', '2026-04', {}, { ordinary: 300100 }), {
			employee: 1500,
			employer: 2550
		});
		assert.equal(
			at('version_4', 'EI', '2026-04', { category: 'SOCIAL_ONLY' }, { ordinary: 300000 }),
			null
		);
		assert.deepEqual(at('version_4', 'WORKERS_ACCIDENT', '2026-04', {}, { ordinary: 300000 }), {
			employee: 0,
			employer: 900
		});
		assert.equal(
			at('version_4', 'WORKERS_ACCIDENT', '2026-04', { company: {} }, { ordinary: 300000 }),
			'REFUSED'
		);
		assert.deepEqual(at('version_4', 'ASBESTOS_LEVY', '2026-04', {}, { ordinary: 300000 }), {
			employee: 0,
			employer: 6
		});
	});

	it('withholding: 甲欄 by the electronic method, 乙欄 by the table, bonus rates and non-residents', () => {
		const declared = { dependency_declaration_filed: true, withholding_dependants: 1 };
		// The previous period's salary-run pay and premiums (earned.previous_month): 300,000 − 46,500 = 253,500.
		const previous = {
			month: {},
			year: {},
			previous_month: {
				gross: 300000,
				statutory: {
					HEALTH: { employee: 17205 },
					CHILD_SUPPORT: { employee: 345 },
					PENSION: { employee: 27450 },
					EI: { employee: 1500 }
				}
			}
		};
		const person = {
			dob: '1981-01-10',
			elections: { INCOME_TAX: declared },
			monthly_wage: 300000,
			earned: previous
		};
		// 300,000 less 17,205 + 345 + 27,450 + 1,500 = 253,500; 2026 甲 1 dependant:
		// 253,500 − (253,500 × 30% + 6,667) − 48,334 − 31,667 = 90,782 × 5.105% = 4,634.4 → 4,630.
		assert.deepEqual(at('version_4', 'INCOME_TAX', '2026-04', person, { ordinary: 300000 }), {
			employee: 4630,
			employer: 0
		});
		// 2025 tables, Tokyo 9.91% and no nursing at 35: 300,000 − (14,865 + 27,450 + 1,650) = 256,035;
		// 256,035 − 83,478 − 40,000 − 31,667 = 100,890 × 5.105% = 5,150.4 → 5,150.
		assert.deepEqual(
			at(
				'version_1',
				'INCOME_TAX',
				'2025-12',
				{ ...person, dob: '1990-01-10' },
				{ ordinary: 300000 }
			),
			{ employee: 5150, employer: 0 }
		);
		// 乙欄 (no declaration): 2026 row 251,000–254,000 is 36,600.
		assert.deepEqual(
			at('version_4', 'INCOME_TAX', '2026-04', { ...person, elections: {} }, { ordinary: 300000 }),
			{ employee: 36600, employer: 0 }
		);
		// A 従たる給与 declaration with 2 dependants: 36,600 − 2 × 1,610.
		assert.deepEqual(
			at(
				'version_4',
				'INCOME_TAX',
				'2026-04',
				{ ...person, elections: { INCOME_TAX: { secondary_dependants: 2 } } },
				{ ordinary: 300000 }
			),
			{ employee: 36600 - 3220, employer: 0 }
		);
		// The commuting allowance is exempt up to 150,000; non-residents 20.42% of the taxable pay.
		assert.deepEqual(
			at(
				'version_4',
				'INCOME_TAX',
				'2026-04',
				{ ...person, residency: 'NON_RESIDENT' },
				{
					ordinary: 300000,
					commuting: 160000
				}
			),
			{ employee: 63302, employer: 0 }
		);
		// Bonus 500,000 after 28,675 + 575 + 45,750 + 2,500 = 422,500; previous month 253,500 with 1 dependant
		// falls in 250,000–289,000 → 4.084% → 17,254.
		assert.deepEqual(at('version_4', 'INCOME_TAX', '2026-04', person, { bonus: 500000 }), {
			employee: 17254,
			employer: 0
		});
		// 乙 bonus rate for a previous month of 253,500: 224,000–295,000 → 20.42%.
		assert.deepEqual(
			at('version_4', 'INCOME_TAX', '2026-04', { ...person, elections: {} }, { bonus: 500000 }),
			{ employee: 86274, employer: 0 }
		);
		// No salary the previous month (別表第三 備考4): the 月額表 on one sixth — 70,416 is under the 甲 1-dependant floor.
		assert.deepEqual(
			at('version_4', 'INCOME_TAX', '2026-04', { ...person, earned: undefined }, { bonus: 500000 }),
			{ employee: 0, employer: 0 }
		);
		// A car commuter (30 km, parking 8,000): 19,700 + 5,000 is exempt from April 2026, the other 5,300 taxed.
		// 300,000 + 5,300 − (17,205 + 345 + 27,450 + 1,650) = 258,650 → 94,387 × 5.105% → 4,820.
		assert.deepEqual(
			at(
				'version_4',
				'INCOME_TAX',
				'2026-04',
				{ ...person, terms_facts: { commute_car_km_one_way: 30, commute_parking_fee: 8000 } },
				{ ordinary: 300000, commuting: 30000 }
			),
			{ employee: 4820, employer: 0 }
		);
		// A bonus above ten times the previous month goes through the 月額表 on one sixth.
		const big = at(
			'version_4',
			'INCOME_TAX',
			'2026-04',
			{ ...person, monthly_wage: 100000 },
			{
				bonus: 2000000
			}
		) as { employee: number };
		assert.ok(big.employee > 0);
		assert.equal(
			at('version_4', 'INCOME_TAX', '2026-04', { ...person, residency: 'ALIEN' }, { ordinary: 1 }),
			'REFUSED'
		);
	});

	it('retirement income withholding and resident tax special collection', () => {
		const ten = {
			service_months: 120,
			elections: { RETIREMENT_TAX: { retirement_income_declaration_filed: true } }
		};
		// 5,000,000 − 4,000,000 = 1,000,000; half 500,000 × 5% × 102.1% = 25,525.
		assert.deepEqual(at('version_4', 'RETIREMENT_TAX', '2026-04', ten, { retirement: 5000000 }), {
			employee: 25525,
			employer: 0
		});
		// Four years: 1,600,000 deduction; 6,000,000 − 1,600,000 = 4,400,000 → 1,500,000 + 1,400,000 = 2,900,000.
		assert.deepEqual(
			at(
				'version_4',
				'RETIREMENT_TAX',
				'2026-04',
				{ ...ten, service_months: 40 },
				{ retirement: 6000000 }
			),
			{ employee: Math.floor((2900000 * 0.1 - 97500) * 1.021), employer: 0 }
		);
		assert.deepEqual(
			at(
				'version_4',
				'RETIREMENT_TAX',
				'2026-04',
				{ service_months: 120 },
				{ retirement: 5000000 }
			),
			{ employee: 1021000, employer: 0 }
		);
		// A specified officer of 4 years: no halving — 6,000,000 − 1,600,000 = 4,400,000 × 20% − 427,500 = 452,500 × 102.1%.
		assert.deepEqual(
			at(
				'version_4',
				'RETIREMENT_TAX',
				'2026-04',
				{
					service_months: 40,
					elections: {
						RETIREMENT_TAX: { retirement_income_declaration_filed: true, specified_officer: true }
					}
				},
				{ retirement: 6000000 }
			),
			{ employee: Math.floor(452500 * 1.021), employer: 0 }
		);
		// Retiring on becoming disabled: 1,000,000 more deduction — 5,000,000 − 5,000,000 = 0.
		assert.deepEqual(
			at(
				'version_4',
				'RETIREMENT_TAX',
				'2026-04',
				{
					service_months: 120,
					elections: {
						RETIREMENT_TAX: {
							retirement_income_declaration_filed: true,
							retirement_due_to_disability: true
						}
					}
				},
				{ retirement: 5000000 }
			),
			{ employee: 0, employer: 0 }
		);
		const notice = { elections: { RESIDENT_TAX: { june_amount: 12300, monthly_amount: 12000 } } };
		assert.deepEqual(at('version_4', 'RESIDENT_TAX', '2026-06', notice, { ordinary: 300000 }), {
			employee: 12300,
			employer: 0
		});
		assert.deepEqual(at('version_4', 'RESIDENT_TAX', '2026-07', notice, { ordinary: 300000 }), {
			employee: 12000,
			employer: 0
		});
		assert.equal(at('version_4', 'RESIDENT_TAX', '2026-07', {}, { ordinary: 300000 }), null);
	});

	it('work lines: overtime 125% / 150% over 60 hours, unpaid absence and the minimum wage top-up', () => {
		const line = (version: string, code: string, context: Row = payslipContext) => {
			const row = file(version, 'work_catalog').find((item) => item.code === code)!;
			const full = {
				...context,
				rules: payrollRules(version)
			};
			if (evaluateConfigured(String(row.eligibility), full) !== true) return 0;
			return (
				Number(evaluateConfigured(String(row.quantity), full)) *
				Number(evaluateConfigured(String(row.rate), full))
			);
		};
		// 180,000 / 160 = 1,125 an hour: 60 h × 1,406 (1,406.25) and 10 h × 1,688 (1,687.5).
		assert.equal(line('version_4', 'OVERTIME'), 60 * 1406);
		assert.equal(line('version_4', 'OVERTIME_OVER_60'), 10 * 1688);
		assert.equal(line('version_4', 'NO_PAY_LEAVE'), 12000);
		// Rest-day work 8 h × 1,519 (1,518.75, 135%); late-night 22:00–01:00 = 3 h × 281 (281.25, 25%).
		assert.equal(line('version_4', 'REST_DAY_WORK'), 8 * 1519);
		assert.equal(line('version_4', 'NIGHT_WORK'), 3 * 281);
		assert.equal(line('version_1', 'NIGHT_WORK'), 3 * 281);
		// Tokyo 1,226 until 30 September 2026, 1,280 from 1 October: 160 h × (1,226 − 1,125).
		assert.equal(Math.round(line('version_4', 'MINIMUM_WAGE_TOP_UP')), 160 * 101);
		const october = {
			...payslipContext,
			period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31', days: 31, paid_days: 31 }
		};
		assert.equal(Math.round(line('version_5', 'MINIMUM_WAGE_TOP_UP', october)), 160 * 155);
		const manager = {
			...payslipContext,
			terms: { ...payslipContext.terms, work_classification: 'MANAGERIAL' }
		};
		assert.equal(line('version_4', 'OVERTIME', manager), 0);
		assert.equal(line('version_4', 'REST_DAY_WORK', manager), 0);
		assert.equal(line('version_4', 'NIGHT_WORK', manager), 3 * 281);
		// One effective-dated rule in every version: the amount in force on the period's last day.
		const inForce = (version: string, region: string, day: string) =>
			evaluateConfigured(
				'double(first(rules.minimum_wage.by_region[company.region].filter(e, e["from"] <= period.to)).amount)',
				{
					rules: payrollRules(version),
					company: { region },
					period: { to: day }
				}
			);
		const rule = (version: string) =>
			file(version, 'rule_set').find((r) => r.code === 'minimum_wage')!.rules;
		for (const version of versions) assert.deepEqual(rule(version), rule('version_1'));
		assert.equal(inForce('version_1', 'YAMAGATA', '2025-12-22'), 955);
		assert.equal(inForce('version_1', 'YAMAGATA', '2025-12-31'), 1032);
		assert.equal(inForce('version_3', 'GUNMA', '2026-03-31'), 1063);
		assert.equal(inForce('version_3', 'AKITA', '2026-03-30'), 951);
		assert.equal(inForce('version_3', 'AKITA', '2026-03-31'), 1031);
		assert.equal(inForce('version_5', 'NAGANO', '2026-10-31'), 1117);
		assert.equal(inForce('version_5', 'FUKUOKA', '2026-10-31'), 1114);
		assert.equal(inForce('version_5', 'OKINAWA', '2026-11-30'), 1023);
		assert.equal(inForce('version_5', 'OKINAWA', '2026-12-31'), 1086);
		assert.throws(() => inForce('version_1', 'YAMAGATA', '2024-01-31'));
	});

	it('ad hoc lines: the shutdown allowance floor, injury waiting days and pay in lieu of notice', () => {
		const amount = (code: string, facts: Row, quantity: number) => {
			const row = file('version_4', 'adhoc_catalog').find((item) => item.code === code)!;
			const band = (row.bands as { when: string; amount: string }[])[0]!;
			const context = { ...payslipContext, entry: entry(facts, quantity) };
			return evaluateConfigured(band.when, context) === true
				? Number(evaluateConfigured(band.amount, context))
				: 1000;
		};
		assert.equal(amount('SHUTDOWN_ALLOWANCE', { average_daily_wage: 10000 }, 5), 30000);
		assert.equal(amount('INJURY_WAITING_COMPENSATION', { average_daily_wage: 10000 }, 5), 18000);
		assert.equal(
			amount('DISMISSAL_NOTICE_ALLOWANCE', { average_daily_wage: 10000, notice_days_given: 10 }, 1),
			200000
		);
		assert.equal(amount('SHUTDOWN_ALLOWANCE', {}, 5), 1000);
	});

	it('annual leave grants follow 労働基準法 art.39 and are neither encashable nor settled on exit', () => {
		const annual = file('version_4', 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE')!;
		const entitlement = annual.entitlement as { days: string; bands: Row[] };
		const days = (service_months: number, facts: Row = {}) =>
			evaluateConfigured(entitlement.days, {
				service_months,
				bands: entitlement.bands,
				terms: { facts }
			});
		assert.deepEqual(
			[5, 6, 17, 18, 30, 42, 54, 66, 77, 78, 400].map((months) => days(months)),
			[0, 10, 10, 11, 12, 14, 16, 18, 18, 20, 20]
		);
		// 施行規則 art.24の3: 3 days and 24 hours a week; 4 days but 32 hours is a full grant.
		const three = { weekly_scheduled_days: 3, weekly_scheduled_hours: 24 };
		assert.deepEqual(
			[5, 6, 18, 30, 42, 54, 66, 78].map((months) => days(months, three)),
			[0, 5, 6, 6, 8, 9, 10, 11]
		);
		assert.equal(days(6, { weekly_scheduled_days: 1, weekly_scheduled_hours: 6 }), 1);
		assert.equal(days(78, { weekly_scheduled_days: 4, weekly_scheduled_hours: 28 }), 15);
		assert.equal(days(78, { weekly_scheduled_days: 4, weekly_scheduled_hours: 32 }), 20);
		assert.equal((entitlement as Row).window, 'SERVICE_YEAR');
		assert.equal(annual.can_encash, false);
		assert.equal(annual.encash_on_exit, false);
	});

	it('validations, payslip warnings and the 2027 withholding tables', () => {
		const validation = (version: string, code: string) =>
			file(version, 'rule_set').find((row) => row.family === 'VALIDATIONS' && row.code === code)!
				.rules as { site: string; kind: string; when: string; message: string; authority: string };
		for (const version of versions) {
			const checks = file(version, 'rule_set').filter((row) => row.family === 'VALIDATIONS');
			assert.deepEqual(checks.map((row) => row.code).toSorted(), [
				'MINIMUM_WAGE_CONTRACT',
				'OVERTIME_AVERAGE_80H',
				'OVERTIME_MONTHLY_45H',
				'OVERTIME_REST_DAY_100H',
				'OVERTIME_WITHOUT_AGREEMENT',
				'OVERTIME_YEAR_360H',
				'OVERTIME_YEAR_720H'
			]);
			for (const check of checks) {
				const rules = check.rules as Row;
				assert.ok(['contract', 'payslip'].includes(String(rules.site)));
				assert.ok(['refuse', 'warn', 'hold'].includes(String(rules.kind)));
				assert.ok(String(rules.message).length > 20 && String(rules.authority).length > 40);
			}
		}
		// 36 agreement limits (労働基準法 art.36): 70 h overtime is over 45; with 8 rest-day hours it stays under 100.
		const slip = { ...payslipContext, rules: payrollRules('version_4') };
		const trips = (code: string, context: Row) =>
			evaluateConfigured(validation('version_4', code).when, context);
		assert.equal(trips('OVERTIME_MONTHLY_45H', slip), true);
		assert.equal(trips('OVERTIME_REST_DAY_100H', slip), false);
		assert.equal(
			trips('OVERTIME_REST_DAY_100H', { ...slip, work: { ...slip.work, overtime_hours: 95 } }),
			true
		);
		assert.equal(
			trips('OVERTIME_MONTHLY_45H', {
				...slip,
				terms: { ...slip.terms, work_classification: 'MANAGERIAL' }
			}),
			false
		);
		// Yearly and multi-month limits from hours.year / previous_month / rolling (rest-day overtime excluded).
		const hours = (year: number, month: number, previous: number, rolling: number, rest = 0) => ({
			...slip,
			hours: {
				year: {
					overtime_hours: year,
					day_type: { REST: { overtime_hours: rest, worked_hours: rest } }
				},
				month: { overtime_hours: month },
				previous_month: { overtime_hours: previous },
				rolling: { overtime_hours: rolling }
			}
		});
		assert.equal(trips('OVERTIME_YEAR_360H', hours(361, 40, 40, 120)), true);
		assert.equal(trips('OVERTIME_YEAR_360H', hours(365, 40, 40, 120, 10)), false);
		assert.equal(trips('OVERTIME_YEAR_720H', hours(721, 40, 40, 120)), true);
		assert.equal(trips('OVERTIME_YEAR_720H', hours(700, 40, 40, 120)), false);
		assert.equal(trips('OVERTIME_AVERAGE_80H', hours(300, 90, 75, 200)), true);
		assert.equal(trips('OVERTIME_AVERAGE_80H', hours(300, 80, 75, 241)), true);
		assert.equal(trips('OVERTIME_AVERAGE_80H', hours(300, 80, 75, 230)), false);
		const agreement = (to: string) => ({
			...slip,
			company: { ...slip.company, facts: { ...slip.company.facts, overtime_agreement_to: to } }
		});
		assert.equal(trips('OVERTIME_WITHOUT_AGREEMENT', agreement('2026-03-31')), true);
		assert.equal(trips('OVERTIME_WITHOUT_AGREEMENT', agreement('2027-03-31')), false);
		assert.equal(trips('OVERTIME_WITHOUT_AGREEMENT', slip), false);
		// A contract base below Tokyo's lowest listed minimum (1,226 an hour over 160 hours) is refused.
		const term = (base_salary: number) => ({
			...slip,
			terms: { ...slip.terms, base_salary, monthly_wage: base_salary },
			company: { region: 'TOKYO', facts: { monthly_average_scheduled_hours: 160 } }
		});
		assert.equal(validation('version_4', 'MINIMUM_WAGE_CONTRACT').kind, 'refuse');
		assert.equal(trips('MINIMUM_WAGE_CONTRACT', term(150000)), true);
		assert.equal(trips('MINIMUM_WAGE_CONTRACT', term(300000)), false);
		// Statutory warnings: the grade estimated from the contract wage; the 乙欄 without a declaration.
		const health = (
			scheme('version_4', 'HEALTH').configuration as Configuration & {
				warn_when: { when: string }[];
			}
		).warn_when[0]!.when;
		const base = statutoryContext('2026-04', {}, { ordinary: 300000 });
		assert.equal(evaluateConfigured(health, { ...base, elections: {} }), true);
		assert.equal(
			evaluateConfigured(health, {
				...base,
				elections: { HEALTH: { standard_monthly_remuneration: 300000 } }
			}),
			false
		);
		// 令和9年分 (告示127号・128号): 253,500 → 253,500 − 82,717 − 51,667 − 31,667 = 87,449 × 5.105% → 4,460;
		// the 乙欄 row 251,000–254,000 is 36,200; the bonus rate for 253,500 with 1 dependant stays 4.084%.
		const declared = { dependency_declaration_filed: true, withholding_dependants: 1 };
		const person = {
			dob: '1981-01-10',
			elections: { INCOME_TAX: declared },
			monthly_wage: 300000,
			earned: {
				month: {},
				year: {},
				previous_month: {
					gross: 300000,
					statutory: {
						HEALTH: { employee: 17205 },
						CHILD_SUPPORT: { employee: 345 },
						PENSION: { employee: 27450 },
						EI: { employee: 1500 }
					}
				}
			}
		};
		assert.deepEqual(at('version_8', 'INCOME_TAX', '2027-01', person, { ordinary: 300000 }), {
			employee: 4460,
			employer: 0
		});
		assert.deepEqual(at('version_7', 'INCOME_TAX', '2026-12', person, { ordinary: 300000 }), {
			employee: 4630,
			employer: 0
		});
		assert.deepEqual(
			at('version_8', 'INCOME_TAX', '2027-01', { ...person, elections: {} }, { ordinary: 300000 }),
			{ employee: 36200, employer: 0 }
		);
		assert.deepEqual(at('version_8', 'INCOME_TAX', '2027-01', person, { bonus: 500000 }), {
			employee: 17254,
			employer: 0
		});
	});

	it('child-nursing and family-care days: per business year, by children and family members', () => {
		const leave = (code: string) =>
			file('version_4', 'leave_catalog').find((row) => row.code === code)!;
		const days = (code: string, as_of: string, employee: Row) =>
			evaluateConfigured((leave(code).entitlement as { days: string }).days, {
				as_of,
				employee,
				service_months: 12,
				bands: []
			});
		const key = (code: string, from: string) =>
			evaluateConfigured((leave(code).entitlement as { window_key: string }).window_key, {
				entry: { from }
			});
		assert.equal((leave('CHILD_NURSING_LEAVE').entitlement as Row).window, 'EVENT');
		assert.equal(key('CHILD_NURSING_LEAVE', '2026-03-31'), '2025');
		assert.equal(key('CHILD_NURSING_LEAVE', '2026-04-01'), '2026');
		const child = (child_birthdate: string) => ({ child_birthdate, relationship: 'CHILD' });
		// Born 2 April 2017: third grade in the 2026 school year (under 9 on 1 April) — counts; born 1 April 2017 does not.
		assert.equal(days('CHILD_NURSING_LEAVE', '2026-06-01', { children: [child('2017-04-02')] }), 5);
		assert.equal(days('CHILD_NURSING_LEAVE', '2026-06-01', { children: [child('2017-04-01')] }), 0);
		assert.equal(
			days('CHILD_NURSING_LEAVE', '2026-06-01', {
				children: [child('2017-04-02'), child('2022-01-15')]
			}),
			10
		);
		assert.equal(days('CHILD_NURSING_LEAVE', '2026-06-01', { children: [child('2026-08-01')] }), 0);
		assert.equal(days('FAMILY_CARE_DAYS', '2026-06-01', { facts: {} }), 5);
		assert.equal(
			days('FAMILY_CARE_DAYS', '2026-06-01', { facts: { family_care_recipients: 2 } }),
			10
		);
		// Per-event grants read the event's first entry: 42 prenatal days (98 for a multiple pregnancy), 56 postnatal,
		// 28 for 産後パパ育休, 93 care-leave days per family member.
		const grant = (code: string, facts: Row) =>
			evaluateConfigured((leave(code).entitlement as { days: string }).days, {
				entry: { facts },
				service_months: 12,
				bands: []
			});
		assert.equal(grant('PRENATAL_LEAVE', {}), 42);
		assert.equal(grant('PRENATAL_LEAVE', { multiple_pregnancy: true }), 98);
		assert.equal(grant('POSTNATAL_LEAVE', {}), 56);
		assert.equal(grant('POSTNATAL_PATERNITY_LEAVE', {}), 28);
		assert.equal(grant('FAMILY_CARE_LEAVE', {}), 93);
		assert.equal(
			evaluateConfigured(
				(leave('FAMILY_CARE_LEAVE').entitlement as { window_key: string }).window_key,
				{ entry: { facts: { care_recipient_id: 'mother' } } }
			),
			'mother'
		);
	});

	it('obligations: every due day evaluates for its trigger and the behaviours raise them', () => {
		const ISO = /^\d{4}-\d{2}-\d{2}$/;
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = settings.behaviours as Behaviours;
			const ids = behaviours.rules.map((rule) => rule.id);
			assert.equal(new Set(ids).size, ids.length);
			for (const id of [
				'payroll-run',
				'pin-settled-entries',
				'encash-leave-on-exit',
				'raise-obligations',
				'raise-tasks'
			])
				assert.ok(ids.includes(id), `${version} ${id}`);
			const rows = file(version, 'rule_set');
			const duties = dutiesOf(rows).map((row) => ({
				code: row.code,
				rules: { ...(row.rules as Row), trigger: triggerOf(row) } as Row
			}));
			assert.equal(duties.length, 42);
			const plain = { region: 'TOKYO', risk_class: '', facts: {} };
			const japanese = {
				nationality: 'JP',
				gender: 'MALE',
				date_of_birth: '1990-01-01',
				facts: {}
			};
			for (const duty of duties) {
				const trigger = duty.rules.trigger as string;
				assert.ok(
					[
						'PAYROLL_RUN',
						'HIRE',
						'EXIT',
						'entity.created',
						'calendar.daily',
						'adhoc_catalog_entry.created',
						'leave_catalog_entry.created',
						'payslip.updated'
					].includes(trigger)
				);
				const period = { key: '2026-02', from: '2026-02-01', to: '2026-02-28' };
				const context =
					trigger === 'PAYROLL_RUN'
						? { period, company: plain, holidays: [], headcount: 10 }
						: trigger.endsWith('_entry.created') || trigger === 'payslip.updated'
							? {
									row: {
										line_codes: ['BASIC'],
										paid_on: '2026-02-25',
										catalog_code: 'X',
										occurred_on: '2026-02-03',
										from: '2026-02-03',
										to: '2026-02-20',
										days: 5
									},
									period,
									company: plain,
									contract: { facts: { contract_terms: [] } },
									employee: japanese,
									holidays: [],
									headcount: 10
								}
							: trigger === 'calendar.daily'
								? {
										today: '2026-02-03',
										hired_on: '2025-08-03',
										contract: { facts: { contract_terms: [] } },
										employee: japanese,
										company: plain,
										holidays: [],
										headcount: 10
									}
								: trigger === 'entity.created'
									? {
											row: { effective_range: { from: '2026-02-02' } },
											period,
											company: plain,
											holidays: []
										}
									: {
											[trigger === 'HIRE' ? 'hired_on' : 'exit_on']: '2026-01-31',
											contract: {
												exit_ground: 'RESIGNATION',
												exit_facts: {},
												facts: { contract_terms: [] }
											},
											employee: japanese,
											company: plain,
											holidays: []
										};
				assert.match(
					String(evaluateConfigured(String(duty.rules.due), context)),
					ISO,
					duty.code as string
				);
				if (duty.rules.applies_when != null)
					assert.equal(
						typeof evaluateConfigured(String(duty.rules.applies_when), context),
						'boolean'
					);
			}
			const raise = (
				collection: string,
				event: string,
				row: Row,
				company: Row = plain,
				employee: Row = japanese,
				extra: { headcount?: number; day?: string } = {}
			) =>
				Object.fromEntries(
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection,
						event,
						row,
						reads: { company: [company], employee: [employee] },
						...extra
					}).map((write) => [write.duty_code, write.due_on])
				);
			const run = (period: string, company: Row = plain) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r1', company_id: 'c1', period, approval_id: null },
					company
				);
			// Filings and remittances falling on a weekend or published holiday move to the next working day.
			assert.deepEqual(run('2027-01'), {
				SOCIAL_INSURANCE_PAYMENT: '2027-03-01',
				WITHHOLDING_TAX_PAYMENT: '2027-02-10',
				RESIDENT_TAX_PAYMENT: '2027-02-10',
				WAGE_LEDGER: '2027-01-31',
				WITHHOLDING_SLIPS_TO_EMPLOYEES: '2027-01-31',
				STATUTORY_RETURNS_SUMMARY: '2027-02-01',
				SALARY_PAYMENT_REPORT: '2027-02-01'
			});
			assert.equal(run('2026-07').SANTEI_KISO_REPORT, '2026-07-10');
			assert.equal(run('2026-06').LABOUR_INSURANCE_ANNUAL_DECLARATION, '2026-07-10');
			assert.ok(run('2026-12').YEAR_END_ADJUSTMENT);
			// Semi-annual special rules (所得税法 art.216, 地方税法 art.321の5の2) replace the monthly payments.
			const small = {
				...plain,
				facts: { withholding_semiannual_special: true, resident_tax_semiannual_special: true }
			};
			// Each month's remittance of a semi-annual payer is raised with its own amount and the half-year's due day.
			const june = run('2026-06', small);
			assert.equal(june.WITHHOLDING_TAX_PAYMENT, undefined);
			assert.equal(june.RESIDENT_TAX_PAYMENT, undefined);
			assert.equal(june.WITHHOLDING_TAX_SEMIANNUAL, '2026-07-10');
			assert.equal(run('2026-02', small).WITHHOLDING_TAX_SEMIANNUAL, '2026-07-10');
			assert.equal(run('2026-12', small).WITHHOLDING_TAX_SEMIANNUAL, '2027-01-20');
			assert.equal(run('2026-07', small).WITHHOLDING_TAX_SEMIANNUAL, '2027-01-20');
			assert.equal(run('2026-05', small).RESIDENT_TAX_SEMIANNUAL, '2026-06-10');
			assert.equal(run('2026-12', small).RESIDENT_TAX_SEMIANNUAL, '2027-06-10');
			assert.equal(run('2026-06', small).RESIDENT_TAX_SEMIANNUAL, '2026-12-10');
			assert.equal(run('2026-11', small).RESIDENT_TAX_SEMIANNUAL, '2026-12-10');
			assert.equal(run('2026-12').WITHHOLDING_TAX_SEMIANNUAL, undefined);
			// Headcount-bound reports: the disability quota binds from 40 (2.5%), then 37.5 from July 2026 (2.7%).
			const sized = (count: number) => ({ ...plain, facts: { regular_employee_count: count } });
			assert.equal(
				run('2027-06', sized(39)).DISABILITY_EMPLOYMENT_REPORT,
				Number(version.slice(8)) >= 5 ? '2027-07-15' : undefined
			);
			assert.equal(run('2026-06', sized(40)).DISABILITY_EMPLOYMENT_REPORT, '2026-07-15');
			// The older-workers report binds every employer (高年齢者雇用安定法 art.52(1)).
			assert.equal(run('2026-06').ELDERLY_EMPLOYMENT_REPORT, '2026-07-15');
			assert.equal(run('2026-05', sized(100)).DISABILITY_LEVY_DECLARATION, undefined);
			assert.equal(run('2026-05', sized(101)).DISABILITY_LEVY_DECLARATION, '2026-05-15');
			assert.equal(run('2026-06').DISABILITY_EMPLOYMENT_REPORT, undefined);
			const contract = {
				id: 'k1',
				company_id: 'c1',
				employee_id: 'p1',
				approval_id: null,
				exit_ground: 'RESIGNATION',
				exit_facts: { ground: 'RESIGNATION', last_day: '2026-05-20' },
				effective_range: { from: '2026-04-01', to: '2026-05-20' },
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-04-01', to: null },
							statutory_work_category: 'SOCIAL_AND_EMPLOYMENT'
						}
					]
				}
			};
			const uninsured = {
				...contract,
				facts: {
					contract_terms: [
						{ effective_range: { from: '2026-04-01', to: null }, statutory_work_category: 'NONE' }
					]
				}
			};
			const hire = (row: Row = contract, employee: Row = japanese) =>
				raise('employment_contract', 'created', row, plain, employee);
			const exit = (row: Row = contract, employee: Row = japanese) =>
				raise('employment_contract', 'updated', row, plain, employee);
			// 当該事実があった日から五日以内: 1 April → 5 April (a Sunday) → 6 April; 10 May (a Sunday) → 11 May.
			assert.deepEqual(hire(), {
				SOCIAL_INSURANCE_ACQUISITION: '2026-04-06',
				EMPLOYMENT_INSURANCE_ACQUISITION: '2026-05-11',
				WORKING_CONDITIONS_NOTICE: '2026-04-01',
				WORKER_REGISTER: '2026-04-01'
			});
			assert.deepEqual(exit(), {
				SOCIAL_INSURANCE_LOSS: '2026-05-25',
				EMPLOYMENT_INSURANCE_LOSS: '2026-06-01',
				RESIDENT_TAX_TRANSFER: '2026-06-10',
				LEAVER_WITHHOLDING_SLIP: '2026-06-20',
				FINAL_WAGES_ON_REQUEST: '2026-05-27'
			});
			// Coverage on the contract terms gates the insurance notices; an insured foreigner is reported on the EI forms.
			assert.deepEqual(Object.keys(hire(uninsured)).toSorted(), [
				'WORKER_REGISTER',
				'WORKING_CONDITIONS_NOTICE'
			]);
			// The daily tick: the 5-day designation on each grant day (6 months after hire, then yearly), once.
			const daily = (day: string, row: Row = contract) =>
				raise('calendar', 'daily', row, plain, japanese, { day });
			assert.deepEqual(daily('2026-10-01'), { ANNUAL_LEAVE_FIVE_DAY_DESIGNATION: '2027-09-30' });
			assert.deepEqual(daily('2027-10-01'), { ANNUAL_LEAVE_FIVE_DAY_DESIGNATION: '2028-09-30' });
			assert.deepEqual(daily('2026-10-02'), {});
			assert.deepEqual(daily('2026-07-01'), {});
			const shortWeek = {
				...contract,
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-04-01', to: null },
							statutory_work_category: 'EMPLOYMENT_ONLY',
							facts: { weekly_scheduled_days: 3, weekly_scheduled_hours: 18 }
						}
					]
				}
			};
			assert.deepEqual(daily('2026-10-01', shortWeek), {});
			// Entry-class tasks (row.catalog_code): bonus report, premium exemptions and the work-injury report.
			const entry = (collection: string, catalog_code: string, row: Row = {}) =>
				raise(collection, 'created', {
					id: 'e1',
					company_id: 'c1',
					employment_id: 'k1',
					employee_id: 'p1',
					approval_id: null,
					catalog_code,
					...row
				});
			const withContract = (collection: string, code: string, row: Row) =>
				Object.fromEntries(
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection,
						event: 'created',
						row: {
							id: 'e1',
							company_id: 'c1',
							employment_id: 'k1',
							employee_id: 'p1',
							approval_id: null,
							catalog_code: code,
							...row
						},
						reads: { company: [plain], employee: [japanese], contract: [contract] }
					}).map((write) => [write.duty_code, write.due_on])
				);
			// The bonus payment report: a paid payslip carrying a BONUS line (row.line_codes, row.paid_on).
			const paidSlip = (line_codes: string[]) =>
				Object.fromEntries(
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection: 'payslip',
						event: 'updated',
						row: {
							id: 's1',
							company_id: 'c1',
							employment_id: 'k1',
							employee_id: 'p1',
							approval_id: null,
							status: 'PAID',
							line_codes,
							paid_on: '2026-07-10'
						},
						day: '2026-07-10',
						reads: { company: [plain], employee: [japanese], contract: [contract] }
					}).map((write) => [write.duty_code, write.due_on])
				);
			assert.deepEqual(paidSlip(['BASIC', 'BONUS']), { BONUS_PAYMENT_REPORT: '2026-07-14' });
			assert.deepEqual(paidSlip(['BASIC']), {});
			assert.deepEqual(
				withContract('adhoc_catalog_entry', 'BONUS', { occurred_on: '2026-07-10' }),
				{}
			);
			// The 36 agreement on record (customer input): its renewal is raised in the month before the expiry month.
			const agreed = { ...plain, facts: { overtime_agreement_to: '2027-03-31' } };
			const renewal = (period: string) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r7', company_id: 'c1', period, approval_id: null },
					agreed
				).OVERTIME_AGREEMENT_RENEWAL;
			assert.equal(renewal('2027-02'), '2027-03-31');
			assert.equal(renewal('2027-03'), undefined);
			assert.deepEqual(
				entry('adhoc_catalog_entry', 'SHUTDOWN_ALLOWANCE', { occurred_on: '2026-07-10' }),
				{}
			);
			assert.deepEqual(
				withContract('leave_catalog_entry', 'PRENATAL_LEAVE', {
					from: '2026-06-01',
					to: '2026-07-12',
					days: 42
				}),
				{ MATERNITY_PREMIUM_EXEMPTION: '2026-07-13' }
			);
			assert.deepEqual(
				withContract('leave_catalog_entry', 'CHILDCARE_LEAVE', {
					from: '2026-08-01',
					to: '2027-03-31',
					days: 243
				}),
				{ CHILDCARE_PREMIUM_EXEMPTION: '2027-03-31' }
			);
			assert.deepEqual(
				entry('leave_catalog_entry', 'OCCUPATIONAL_INJURY_ABSENCE', {
					from: '2026-05-11',
					days: 6
				}),
				{ WORK_INJURY_REPORT: '2026-05-14' }
			);
			assert.deepEqual(
				entry('leave_catalog_entry', 'OCCUPATIONAL_INJURY_ABSENCE', {
					from: '2026-05-11',
					days: 2
				}),
				{ WORK_INJURY_REPORT_QUARTERLY: '2026-07-31' }
			);
			// Headcount (the entity's employments in force): women's advancement publication from 101, disability quota.
			const publisher = { ...plain, facts: { business_year_end_month: 3 } };
			const april = (headcount: number, company: Row = publisher) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r9', company_id: 'c1', period: '2027-04', approval_id: null },
					company,
					japanese,
					{ headcount }
				);
			assert.equal(april(101).WOMEN_ADVANCEMENT_PUBLICATION, '2027-06-30');
			assert.equal(april(100).WOMEN_ADVANCEMENT_PUBLICATION, undefined);
			assert.equal(april(500, plain).WOMEN_ADVANCEMENT_PUBLICATION, undefined);
			const juneRun = (headcount: number) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r8', company_id: 'c1', period: '2026-06', approval_id: null },
					plain,
					japanese,
					{ headcount }
				);
			assert.equal(juneRun(45).DISABILITY_EMPLOYMENT_REPORT, '2026-07-15');
			assert.equal(juneRun(30).DISABILITY_EMPLOYMENT_REPORT, undefined);
			const foreigner = { ...japanese, nationality: 'VN' };
			assert.equal(hire(contract, foreigner).FOREIGN_WORKER_HIRE_NOTIFICATION, undefined);
			assert.equal(hire(uninsured, foreigner).FOREIGN_WORKER_HIRE_NOTIFICATION, '2026-06-01');
			assert.equal(exit(uninsured, foreigner).FOREIGN_WORKER_EXIT_NOTIFICATION, '2026-06-30');
			// Business start: the establishment notices count from the entity's own start day.
			assert.deepEqual(
				raise('entity', 'created', {
					id: 'c1',
					approval_id: null,
					effective_range: { from: '2026-04-01', to: null }
				}),
				{
					SOCIAL_INSURANCE_NEW_ESTABLISHMENT: '2026-04-06',
					LABOUR_INSURANCE_ESTABLISHMENT: '2026-04-13',
					LABOUR_INSURANCE_PROVISIONAL_DECLARATION: '2026-05-21',
					EMPLOYMENT_INSURANCE_ESTABLISHMENT: '2026-04-13',
					PAYROLL_OFFICE_OPENING: '2026-05-01'
				}
			);
			assert.equal(exit({ ...contract, exit_ground: 'DISMISSAL' }).DISMISSAL_NOTICE, '2026-04-20');
		}
	});

	it('a JP regular run and an off-cycle bonus settle through the engine', async () => {
		const COMPANY = 'c0000000-0000-4000-8000-0000000000jp';
		const law = (name: string): Row[] =>
			versions
				.flatMap((version) => file(version, name))
				.map((row) => ({ approval_id: null, ...row }));
		const makeTables = () =>
			new Map<string, Row[]>([
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
							name: 'Edo KK',
							settings_code: 'JP',
							pay_frequency: 'MONTHLY',
							region: 'TOKYO',
							facts: { monthly_average_scheduled_hours: 160, workers_accident_rate_per_mille: 3 },
							approval_id: null
						}
					]
				],
				[
					'employment_profile',
					[
						{
							id: 'p1',
							name: 'Haruto',
							date_of_birth: '1981-01-10',
							nationality: 'JP',
							facts: {
								employment_statutory_facts: [
									{
										statutory_contribution_id: scheme('version_2', 'INCOME_TAX').id,
										effective_range: { from: '2026-01-01', to: null },
										status: {
											kind: 'DECLARED',
											elections: { dependency_declaration_filed: true, withholding_dependants: 1 }
										}
									},
									{
										statutory_contribution_id: scheme('version_4', 'RESIDENT_TAX').id,
										effective_range: { from: '2025-06-01', to: null },
										status: {
											kind: 'NOTIFIED',
											elections: { june_amount: 10400, monthly_amount: 10000 }
										}
									}
								]
							}
						},
						{ id: 'p2', name: 'Ava', date_of_birth: '1995-07-12', nationality: 'US', facts: {} }
					]
				],
				[
					'employment_contract',
					[
						['p1', 300000, 'RESIDENT'],
						['p2', 400000, 'NON_RESIDENT']
					].map(([id, salary, residency]) => ({
						id: `k-${id}`,
						employee_id: id,
						company_id: COMPANY,
						approval_id: null,
						effective_range: { from: '2024-04-01', to: null },
						facts: {
							contract_terms: [
								{
									base_salary: { value: salary, currency: 'JPY' },
									effective_range: { from: '2024-04-01', to: null },
									residency_status: residency,
									work_classification: 'ORDINARY',
									statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
									employment_type: 'INDEFINITE',
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
		let tables = makeTables();
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

		// March first: the April bonus is withheld at the rate the previous month's salary sets.
		await run('2026-03', 'REGULAR');
		const regular = await run('2026-04', 'REGULAR');
		assert.equal(regular.run.settings_id, settingsOf('version_4').id);
		const haruto = regular.payslips.find((slip) => slip.employment_id === 'k-p1')!;
		assert.deepEqual(lines(haruto), {
			HEALTH: [17205, 17205],
			CHILD_SUPPORT: [345, 345],
			PENSION: [27450, 27450],
			CHILD_CONTRIBUTION: [0, 1080],
			EI: [1500, 2550],
			WORKERS_ACCIDENT: [0, 900],
			ASBESTOS_LEVY: [0, 6],
			INCOME_TAX: [4630, 0],
			RESIDENT_TAX: [10000, 0]
		});
		assert.equal(haruto.net, 300000 - 17205 - 345 - 27450 - 1500 - 4630 - 10000);
		const ava = regular.payslips.find((slip) => slip.employment_id === 'k-p2')!;
		// 400,000 → grade 410,000 (395,000–425,000): 9.85% → 20,192.5 → 20,192; pension 37,515; levy 471.5 → 471.
		assert.deepEqual(lines(ava), {
			HEALTH: [20192, 20193],
			CHILD_SUPPORT: [471, 472],
			PENSION: [37515, 37515],
			CHILD_CONTRIBUTION: [0, 1476],
			EI: [2000, 3400],
			WORKERS_ACCIDENT: [0, 1200],
			ASBESTOS_LEVY: [0, 8],
			INCOME_TAX: [81680, 0]
		});

		const bonus = file('version_4', 'adhoc_catalog').find((row) => row.code === 'BONUS')!;
		tables.get('adhoc_catalog_entry')!.push({
			id: 'b1',
			catalog_id: bonus.id,
			employment_id: 'k-p1',
			company_id: COMPANY,
			approval_id: null,
			payslip_id: null,
			occurred_on: '2026-04-20',
			amount: 500000,
			activity: 'PAYMENT'
		});
		const offCycle = await run('2026-04', 'OFF_CYCLE', ['b1']);
		const paid = offCycle.payslips.find((slip) => slip.employment_id === 'k-p1')!;
		// The month is settled again: the salary's premiums move by nothing, the bonus adds its own.
		assert.deepEqual(
			Object.fromEntries(
				Object.entries(lines(paid)).filter(
					([, [employee, employer]]) => employee !== 0 || employer !== 0
				)
			),
			{
				HEALTH: [28675, 28675],
				CHILD_SUPPORT: [575, 575],
				PENSION: [45750, 45750],
				CHILD_CONTRIBUTION: [0, 1800],
				EI: [2500, 4250],
				WORKERS_ACCIDENT: [0, 1500],
				ASBESTOS_LEVY: [0, 10],
				INCOME_TAX: [17254, 0]
			}
		);

		// Off-cycle order (owner requirement): the bonus paid before the salary gives the same month totals.
		const monthTotals = () => {
			const out: Record<string, [number, number]> = {};
			for (const slip of tables.get('payslip')! as {
				employment_id: string;
				salary_from: string;
				statutory: { scheme_code: string; employee_amount: number; employer_amount: number }[];
			}[])
				if (slip.employment_id === 'k-p1' && slip.salary_from.startsWith('2026-04'))
					for (const line of slip.statutory) {
						const held = (out[line.scheme_code] ??= [0, 0]);
						held[0] = Math.round((held[0] + line.employee_amount) * 100) / 100;
						held[1] = Math.round((held[1] + line.employer_amount) * 100) / 100;
					}
			return out;
		};
		const salaryFirst = monthTotals();
		assert.equal(salaryFirst.INCOME_TAX![0], 4630 + 17254);
		tables = makeTables();
		await run('2026-03', 'REGULAR');
		tables.get('adhoc_catalog_entry')!.push({
			id: 'b1',
			catalog_id: bonus.id,
			employment_id: 'k-p1',
			company_id: COMPANY,
			approval_id: null,
			payslip_id: null,
			occurred_on: '2026-04-20',
			amount: 500000,
			activity: 'PAYMENT'
		});
		await run('2026-04', 'OFF_CYCLE', ['b1']);
		// The run pins the bonus it paid (the pin behaviour), so the regular run does not pay it again.
		tables.get('adhoc_catalog_entry')![0]!.payslip_id = 'pinned';
		await run('2026-04', 'REGULAR');
		assert.deepEqual(monthTotals(), salaryFirst);
	});
});
