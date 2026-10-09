/** CN public lineage: snapshot structure, CEL on the engine's contexts, obligations, and statutory amounts through runs. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { Effect } from 'effect';
import {
	effectWrites,
	planBehaviours,
	type Behaviours
} from '../src/lib/payroll_engine/behaviours.js';
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import { evaluateStrict as evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { Reads } from '../src/lib/payroll_engine/foundation.js';
import { entitlementDays } from '../src/lib/payroll_engine/leave.js';
import { recordDocuments } from '../src/lib/payroll_engine/export.js';
import { regionsIn } from '../src/lib/ui/entity/regions.js';
import { dutiesOf, raiseDuties, triggerOf, SEEDED_PAYROLL } from './duties.ts';
import {
	admitContractTerms,
	buildPayrollRun,
	rosterFindings,
	type PayrollRunKind
} from '../src/lib/payroll_engine/services.js';

type Row = Record<string, unknown>;
const root = resolve(process.cwd(), 'seed/jurisdiction');
const CN = resolve(root, 'CN');
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
const versionsOf = (directory: string) =>
	readdirSync(directory)
		.filter((name) => name.startsWith('version_'))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const VERSIONS = versionsOf(CN);
const load = (directory: string, name: string): Row[] =>
	JSON.parse(readFileSync(resolve(directory, `${name}.json`), 'utf8')) as Row[];
const file = (version: string, name: string) => load(resolve(CN, version), name);
const settingsOf = (version: string): Row => file(version, 'jurisdiction_settings')[0]!;
/** The version's regions table, as the duty behaviours read it (`payroll`). */
const regionsOf = (version: string): Row =>
	file(version, 'rule_set').find((row) => row.code === 'regions')!;
const code = (version: string, name: string, wanted: string): Row => {
	const row = file(version, name).find((item) => item.code === wanted);
	assert.ok(row, `${version} ${name} ${wanted}`);
	return row;
};

/** Every CEL string a version's rows carry, with where it sits. */
const celOf = (version: string): [string, string][] => {
	const out: [string, string][] = [];
	const KEYS = new Set([
		'when',
		'employee',
		'employer',
		'eligibility',
		'qualifies_when',
		'quantity',
		'rate',
		'amount',
		'due',
		'days',
		'ordinary',
		'bonus',
		'deductions',
		'elections'
	]);
	const walk = (value: unknown, where: string): void => {
		if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${where}[${index}]`));
		else if (value != null && typeof value === 'object')
			for (const [key, item] of Object.entries(value)) {
				if (KEYS.has(key) && typeof item === 'string' && item.trim() !== '')
					out.push([`${where}.${key}`, item]);
				else walk(item, `${where}.${key}`);
			}
	};
	for (const name of ['rule_set', ...CATALOGS]) walk(file(version, name), `${version}/${name}`);
	return out;
};

// ── engine-shaped contexts ─────────────────────────────────────────────────────────────────────────────────────────
const employment = {
	classification: 'STANDARD',
	service_months: 130,
	start_date: '2016-01-01',
	exit_date: '',
	exit_ground: '',
	exit_facts: {}
};
const subject = (region = 'SH', facts: Row = {}, employee: Row = {}) => ({
	employee: {
		gender: 'FEMALE',
		marital_status: 'MARRIED',
		spouse_status: '',
		solo_parent: false,
		disabled: false,
		receiving_pension: false,
		nationality: 'CN',
		date_of_birth: '1990-01-01',
		age: 36,
		children: [],
		dependents_count: 0,
		facts: employee
	},
	company: {
		region,
		risk_class: '1',
		pay_frequency: 'MONTHLY',
		facts: { hpf_rate_percent: 7, ...facts }
	},
	terms: {
		work_classification: 'STANDARD',
		statutory_work_category: '',
		employment_type: 'PERMANENT',
		residency_status: 'RESIDENT',
		residency_since: '',
		base_salary: 20_000,
		monthly_wage: 20_000,
		allowances: [] as Row[],
		facts: {}
	},
	employment,
	person: {
		employment,
		race: null,
		religion: null,
		nationality: 'CN',
		residency_status: 'RESIDENT',
		residency_since: null
	}
});
const entry = (facts: Row, amount = 30_000) => ({
	amount,
	quantity: 1,
	occurred_on: '2026-03-15',
	due_on: '2026-03-15',
	incurred_on: '2026-03-15',
	...facts,
	facts
});
const ENTRY_FACTS = { qualifying_months: 41, local_average_monthly_wage: 12_577 };
/** The version's PAYROLL rule-set rows by code, as the engine's `rules` root. */
const rulesOf = (version: string): Row =>
	Object.fromEntries(
		file(version, 'rule_set')
			.filter((row) => row.family === 'PAYROLL')
			.map((row) => [row.code, row.rules])
	);
const day = (date: string, day_type: string, worked: number, overtime = 0, holiday_kind = '') => ({
	date,
	day_type,
	shift_code: '',
	holiday_kind,
	scheduled_hours: day_type === 'WORK' ? 8 : 0,
	worked_hours: worked,
	worked: worked > 0,
	overtime_hours: overtime,
	incentive_hours: 0,
	worksite: '',
	facts: {},
	intervals: [] as { start: string; end: string | null }[],
	suspended: null as Row | null
});
const HOURS = (worked: number, holiday = 0) => ({
	worked_hours: worked,
	overtime_hours: 0,
	incentive_hours: 0,
	holiday_kind:
		holiday > 0
			? { PUBLIC_HOLIDAY: { worked_hours: holiday, overtime_hours: 0, incentive_hours: 0 } }
			: {}
});
const payslipContext = {
	...subject(),
	rules: rulesOf('version_3'),
	period: {
		key: '2026-03',
		from: '2026-03-01',
		to: '2026-03-31',
		days: 31,
		paid_days: 31,
		covered_days: 31,
		working_days: 22,
		covered_working_days: 22,
		unpaid_working_days: 0,
		month_key: '2026-03',
		month_from: '2026-03-01',
		month_to: '2026-03-31',
		month_days: 31,
		pay_date: '2026-04-05',
		parts: 1,
		part: 1
	},
	earned: { months: [] as Row[] },
	hours: {
		month: HOURS(180),
		previous_month: HOURS(0),
		year: HOURS(500),
		rolling: HOURS(520),
		months: [] as Row[]
	},
	work: {
		overtime_hours: 4,
		incentive_hours: 0,
		dates: ['2026-04-05'],
		holidays: [{ date: '2026-04-05', kind: 'PUBLIC_HOLIDAY', given_to: 'EVERYONE', replaces: '' }],
		days: [
			day('2026-03-02', 'WORK', 11, 3),
			day('2026-03-03', 'WORK', 9, 1),
			day('2026-03-07', 'REST', 6),
			day('2026-03-08', 'OFF', 0),
			day('2026-04-05', 'REST', 8, 0, 'PUBLIC_HOLIDAY'),
			day('2026-04-06', 'REST', 5, 0, 'SUBSTITUTE')
		]
	},
	leave: {
		rows: [
			{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 2, is_npl: true, can_encash: false },
			{ code: 'ANNUAL_LEAVE', activity: 'ENCASHMENT', days: 3, is_npl: false, can_encash: true },
			{
				code: 'SICK_LEAVE',
				activity: 'TIME_OFF',
				days: 2,
				is_npl: false,
				can_encash: false,
				pay_fraction: 0.7,
				month_index: 1
			}
		]
	},
	entry: entry(ENTRY_FACTS)
};
/** Whether a version_3 validation trips on the September 2026 payslip context with these overrides. */
/** The version governing a day, as the engine picks it. */
const versionOn = (day: string) =>
	day >= '2026-09-01'
		? 'version_4'
		: day >= '2026-07-01'
			? 'version_3'
			: day >= '2026-01-01'
				? 'version_2'
				: 'version_1';
const trips = (wanted: string, over: Row = {}) => {
	const version = versionOn(String((over.period as Row | undefined)?.from ?? '2026-09-01'));
	const check = file(version, 'rule_set').find((row) => row.code === wanted)!;
	return evaluateConfigured(String((check.rules as Row).when), {
		...payslipContext,
		rules: rulesOf(version),
		period: {
			...payslipContext.period,
			to: '2026-09-30',
			from: '2026-09-01',
			month_from: '2026-09-01',
			month_to: '2026-09-30',
			covered_days: 30,
			days: 30,
			pay_date: ''
		},
		statutory: {
			PENSION: { employee: 240, employer: 480 },
			MEDICAL: { employee: 60, employer: 270 },
			HPF: { employee: 210, employer: 210 }
		},
		payslip: { gross: 3_000, net: 2_490 },
		...over
	});
};
const PARTS = {
	separation: 0,
	foreign_allowance: 0,
	equity: 0,
	early_retirement: 0,
	internal_retirement: 0
};
const statutoryContext = (region: string, facts: Row = {}, employee: Row = {}) => ({
	...subject(region, facts, employee),
	rules: rulesOf('version_3'),
	earned: { months: [] as Row[] },
	wage: { ordinary: 20_000, bonus: 0, deductions: 20_000, ...PARTS },
	month: { ordinary: 20_000, bonus: 0, deductions: 20_000, ...PARTS },
	year: { ordinary: 0, bonus: 0, deductions: 0, ...PARTS },
	charged: {
		year: { IIT: { employee: 0, employer: 0 } },
		month: { IIT: { employee: 0, employer: 0 } }
	},
	elections: {},
	scheme: {
		code: 'IIT',
		standing: 'REGISTERED',
		since: '2025-01-01',
		elections: { children_education_children: 1, housing_rent: true }
	},
	period: {
		key: '2026-03',
		from: '2026-03-01',
		to: '2026-03-31',
		days: 31,
		month: 3,
		salary_paid: false,
		covered_days: 31,
		working_days: 22,
		covered_working_days: 22,
		unpaid_working_days: 0,
		parts: 1,
		part: 1,
		pay_date: '2026-04-05'
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

const fieldsOf = async (collection: string): Promise<Set<string>> => {
	const model = (await import(`../src/data/model/jurisdiction/${collection}/+model.js`)) as {
		default: { fields: Row };
	};
	const relationships = (await import('../src/data/+relationship.js')) as { default: Row };
	return new Set([
		'id',
		...Object.keys(model.default.fields),
		...Object.keys(relationships.default)
			.filter((key) => key.startsWith(`${collection}.`))
			.map((key) => key.slice(collection.length + 1))
	]);
};

describe('CN public lineage', () => {
	it('every version holds settings, rule_set and every catalogue, each row on its own version', () => {
		assert.deepEqual(VERSIONS, ['version_1', 'version_2', 'version_3', 'version_4']);
		for (const version of VERSIONS) {
			for (const name of FILES)
				assert.equal(existsSync(resolve(CN, version, `${name}.json`)), true, `${version}/${name}`);
			const settings = file(version, 'jurisdiction_settings');
			assert.equal(settings.length, 1);
			for (const name of ['rule_set', ...CATALOGS])
				for (const row of file(version, name))
					assert.equal(row.settings_id, settings[0]!.id, `${version}/${name}:${String(row.code)}`);
		}
	});

	it('ids are unique across every lineage and version', () => {
		const seen = new Map<string, string>();
		for (const lineage of readdirSync(root))
			for (const version of versionsOf(resolve(root, lineage)))
				for (const name of readdirSync(resolve(root, lineage, version)).filter((entry) =>
					entry.endsWith('.json')
				))
					for (const row of load(resolve(root, lineage, version), name.slice(0, -5))) {
						const where = `${lineage}/${version}/${name}:${String(row.code)}`;
						assert.equal(
							seen.has(String(row.id)),
							false,
							`${where} reuses ${seen.get(String(row.id))}`
						);
						seen.set(String(row.id), where);
					}
	});

	it('versions chain, are sealed and cover time contiguously from 1 December 2025', () => {
		let previous: Row | undefined;
		for (const version of VERSIONS) {
			const row = settingsOf(version);
			const range = row.effective_range as { from: string; to: string | null };
			assert.equal(row.code, 'CN');
			assert.equal(row.jurisdiction_code, 'CN');
			assert.ok(row.sealed_at);
			assert.equal(row.voided_at, null);
			assert.deepEqual(row.payroll, {
				currency: 'CNY',
				timezone: 'Asia/Shanghai',
				tax_year_start_month: 1,
				...SEEDED_PAYROLL
			});
			if (previous === undefined) {
				assert.equal(range.from, '2025-12-01');
				assert.equal(row.cloned_from_id, undefined);
			} else {
				const before = previous.effective_range as { to: string };
				assert.equal(row.cloned_from_id, previous.id);
				const next = new Date(`${before.to}T00:00:00Z`);
				next.setUTCDate(next.getUTCDate() + 1);
				assert.equal(
					range.from,
					next.toISOString().slice(0, 10),
					`${version} starts the day after`
				);
			}
			previous = row;
		}
		assert.equal((previous?.effective_range as { to: unknown }).to, null);
	});

	it('every row key exists on its model and codes are stable across versions', async () => {
		for (const name of FILES) {
			const fields = await fieldsOf(name);
			for (const version of VERSIONS)
				for (const row of file(version, name))
					for (const key of Object.keys(row))
						assert.equal(fields.has(key), true, `${version}/${name}:${String(row.code)}.${key}`);
		}
		for (const name of ['rule_set', ...CATALOGS]) {
			const codes = (version: string) => file(version, name).map((row) => String(row.code));
			// The same codes in every version, except the 2026 provisional unemployment warning, absent from version 1.
			for (const version of VERSIONS)
				assert.deepEqual(
					codes(version),
					codes('version_2').filter(
						(code) => version !== 'version_1' || code !== 'UNEMPLOYMENT_RATE_PROVISIONAL'
					),
					`${version} ${name}`
				);
		}
	});

	it('both input schemas are JSON Schema 2020-12 and declare every fact the CEL reads', () => {
		for (const version of VERSIONS) {
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
			// One layout for every lineage: these four keys, and nothing else, on the employee schema.
			assert.deepEqual([...propertiesAt(employee)].toSorted(), [
				'contract_terms',
				'employment_statutory_facts',
				'exit_facts',
				'facts'
			]);
			for (const column of ['region', 'risk_class'])
				assert.equal(propertiesAt(entity).has(column), false);
			const declared = {
				employee: propertiesAt(employee, 'properties', 'facts'),
				company: propertiesAt(entity),
				terms: new Set([
					...propertiesAt(employee, 'properties', 'contract_terms', 'items'),
					'monthly_wage',
					'effective_from',
					'effective_to'
				]),
				termFacts: propertiesAt(
					employee,
					'properties',
					'contract_terms',
					'items',
					'properties',
					'facts'
				),
				exit: propertiesAt(employee, 'properties', 'exit_facts'),
				elections: propertiesAt(
					employee,
					'properties',
					'employment_statutory_facts',
					'items',
					'properties',
					'status',
					'properties',
					'elections'
				)
			};
			const enums = (key: string) =>
				(
					(employee.properties as Row).contract_terms as {
						items: { properties: Record<string, { enum?: string[] }> };
					}
				).items.properties[key]!.enum;
			assert.deepEqual(enums('residency_status'), ['RESIDENT', 'NON_RESIDENT']);
			assert.ok(declared.elections.has('annual_bonus_separate'));
			let reads = 0;
			for (const [where, cel] of celOf(version)) {
				for (const [, root, key] of cel.matchAll(
					/(?<![\w.])(employee\.facts|company\.facts|scheme\.elections|terms\.facts|employment\.exit_facts|terms)\.(\w+)/g
				)) {
					reads++;
					const set = {
						'employee.facts': declared.employee,
						'company.facts': declared.company,
						'scheme.elections': declared.elections,
						'terms.facts': declared.termFacts,
						'employment.exit_facts': declared.exit,
						terms: declared.terms
					}[root!]!;
					assert.equal(set.has(key!), true, `${where} reads undeclared ${root}.${key}`);
				}
			}
			assert.ok(reads > 50);
		}
	});

	it('every catalogue and statutory CEL evaluates on the engine context', () => {
		const bool = (expression: unknown, context: Row, where: string) => {
			if (expression == null || String(expression).trim() === '') return;
			assert.equal(typeof evaluateConfigured(String(expression), context), 'boolean', where);
		};
		const number = (expression: unknown, context: Row, where: string) =>
			assert.equal(typeof evaluateConfigured(String(expression), context), 'number', where);
		for (const version of VERSIONS) {
			for (const row of file(version, 'work_catalog')) {
				const where = `${version} work ${String(row.code)}`;
				bool(row.eligibility, payslipContext, where);
				number(row.quantity, payslipContext, where);
				number(row.rate, payslipContext, where);
			}
			for (const row of file(version, 'allowance_catalog'))
				number(
					row.amount,
					{ ...payslipContext, allowance: { code: 'FIXED_ALLOWANCE', amount: 500 } },
					version
				);
			for (const row of file(version, 'adhoc_catalog')) {
				const where = `${version} adhoc ${String(row.code)}`;
				bool(row.eligibility, payslipContext, where);
				bool(row.qualifies_when, payslipContext, where);
				// The engine prices a band only after the class qualifies; the test does the same.
				const qualifies =
					String(row.qualifies_when ?? '').trim() === '' ||
					evaluateConfigured(String(row.qualifies_when), payslipContext) === true;
				for (const band of row.bands as {
					when: string;
					amount: string;
					limit?: { amount: string };
				}[]) {
					bool(band.when, payslipContext, where);
					if (qualifies) number(band.amount, payslipContext, where);
					if (band.limit) number(band.limit.amount, payslipContext, where);
				}
			}
			for (const row of file(version, 'leave_catalog'))
				for (const region of ['SH', 'KM'])
					bool(
						row.eligibility,
						{ ...subject(region), entry: entry({}) },
						`${version} leave ${String(row.code)}`
					);
			for (const row of file(version, 'statutory_contribution_catalog')) {
				const configuration = row.configuration as {
					person?: Row;
					assessable?: Record<string, string>;
					refuse_when?: { when: string }[];
					rules: { when: string; employee: string; employer: string }[];
				};
				assert.equal(configuration.person, undefined);
				for (const region of ['SH', 'KM']) {
					const context: Row = statutoryContext(region);
					for (const expression of Object.values(configuration.assessable ?? {}))
						number(expression, context, `${version} ${String(row.code)} assessable`);
					const ruled = {
						...context,
						base: {
							ordinary: 20_000,
							bonus: 0,
							deductions: 8_000,
							...PARTS,
							assessed: 28_000,
							amount: 28_000
						}
					};
					for (const guard of configuration.refuse_when ?? [])
						bool(guard.when, ruled, String(row.code));
					for (const rule of configuration.rules) {
						bool(rule.when, ruled, String(row.code));
						number(rule.employee, ruled, String(row.code));
						number(rule.employer, ruled, String(row.code));
					}
				}
			}
		}
	});

	it('IIT: a non-resident on the monthly table, and the scheme refuses an unknown residence or region', () => {
		const iit = code('version_3', 'statutory_contribution_catalog', 'IIT').configuration as {
			assessable: Record<string, string>;
			refuse_when: { when: string }[];
			rules: { when: string; employee: string }[];
		};
		const context = statutoryContext('SH');
		const person = {
			...(context.person as Row),
			residency_status: 'NON_RESIDENT'
		};
		const month = { ordinary: 30_000, bonus: 0, deductions: 0, ...PARTS };
		const parts = Object.fromEntries(
			Object.entries(iit.assessable).map(([part, expression]) => [
				part,
				evaluateConfigured(expression, { ...context, person, month })
			])
		);
		assert.deepEqual(parts, {
			ordinary: 30_000,
			bonus: 0,
			deductions: 5_000,
			foreign_allowance: 0
		});
		const ruled = {
			...context,
			person,
			base: { ...PARTS, ...parts, assessed: 35_000, amount: 35_000 }
		};
		const rule = iit.rules.find((item) => evaluateConfigured(item.when, ruled) === true)!;
		// 25,000 on the monthly table: 3,000 × 3% + 9,000 × 10% + 13,000 × 20%.
		assert.equal(evaluateConfigured(rule.employee, ruled), 3_590);
		const refused = (over: Row) =>
			iit.refuse_when.some(
				(guard) => evaluateConfigured(guard.when, { ...ruled, ...over }) === true
			);
		assert.equal(refused({}), false);
		assert.equal(refused({ person: { ...person, residency_status: '' } }), true);
		assert.equal(refused({ company: { ...(context.company as Row), region: 'BJ' } }), true);
	});

	it('Shanghai HPF floor 2,690 for the 2025 year and 2,740 from July 2026; voluntary work injury for interns', () => {
		const assess = (version: string, schemeCode: string, context: Row) =>
			evaluateConfigured(
				String(
					(
						code(version, 'statutory_contribution_catalog', schemeCode).configuration as {
							assessable: { ordinary: string };
						}
					).assessable.ordinary
				),
				{ ...context, rules: rulesOf(version) }
			);
		const low = (region: string, facts: Row = {}) => {
			const context = statutoryContext(region, facts) as Row & { terms: Row };
			return { ...context, terms: { ...context.terms, monthly_wage: 1_000 } };
		};
		assert.equal(assess('version_1', 'HPF', low('SH')), 2_690);
		assert.equal(assess('version_2', 'HPF', low('SH')), 2_690);
		assert.equal(assess('version_3', 'HPF', low('SH')), 2_740);
		// Kunming class 2 floor from the minimum-wage table on the period start (March 2026: 2,020).
		assert.equal(assess('version_3', 'HPF', low('KM', { wage_zone: '2' })), 2_020);
		const [rule] = (
			code('version_3', 'statutory_contribution_catalog', 'WORK_INJURY').configuration as {
				rules: { when: string }[];
			}
		).rules;
		const intern = (facts: Row) => {
			const context = statutoryContext('SH', facts) as Row & { terms: Row };
			return evaluateConfigured(rule!.when, {
				...context,
				terms: { ...context.terms, employment_type: 'INTERN' }
			});
		};
		assert.equal(intern({}), false);
		assert.equal(intern({ wi_voluntary_interns_and_retirees: true }), true);
	});

	it('payslip validations: minimum wage (monthly and hourly, both cities and classes), overtime limits, part-time limits, weekly rest', () => {
		for (const version of VERSIONS) {
			const checks = file(version, 'rule_set').filter(
				(row) => row.family === 'VALIDATIONS' && (row.rules as Row).site !== 'roster'
			);
			assert.deepEqual(checks.map((row) => row.code).toSorted(), [
				'DISABILITY_ALLOWANCE_SI_BASE',
				'LIVING_ALLOWANCE_NOT_RECORDED',
				'MEDICAL_PERIOD_EXHAUSTED',
				'MINIMUM_WAGE',
				'MINIMUM_WAGE_HOURLY',
				'OPEN_ENDED_REQUIRED',
				'OVERTIME_DAILY_LIMIT',
				'OVERTIME_MONTHLY_LIMIT',
				'PART_TIME_HOURS',
				'PART_TIME_PAY_CYCLE',
				'PREGNANT_NURSING_OVERTIME',
				'PROBATION_LENGTH',
				'PROBATION_ONCE',
				'PROBATION_WAGE',
				'RETIREMENT_AGE_REACHED',
				'SI_WAIVER_VOID',
				'TERMINATION_PROTECTED',
				// The 2026 provisional unemployment rate warns from version 2; version 1 (December 2025) has the 2025 law.
				...(version === 'version_1' ? [] : ['UNEMPLOYMENT_RATE_PROVISIONAL']),
				'WAGE_PAID_LATE',
				'WEEKLY_REST',
				'WORK_INJURY_LEAVE_12_MONTHS'
			]);
			for (const check of checks) {
				const rules = check.rules as Row;
				assert.ok(['payslip', 'contract'].includes(String(rules.site)), String(check.code));
				assert.ok(['warn', 'refuse', 'hold'].includes(String(rules.kind)), String(check.code));
				assert.ok(String(rules.description).length > 20, String(check.code));
			}
		}
		const wage = (base: number, over: Row = {}) => ({
			terms: { ...payslipContext.terms, base_salary: base, monthly_wage: base, ...over }
		});
		// Shanghai: 3,000 less 510 of the employee's own contributions is 2,490 < 2,740.
		assert.equal(trips('MINIMUM_WAGE', wage(3_000)), true);
		assert.equal(trips('MINIMUM_WAGE', wage(3_300)), false);
		// A semi-monthly entity is checked on the last part, against the month's contributions (both halves: 255 + 255).
		const halves = (part: number, earlier: number) => ({
			...wage(3_200),
			period: {
				...payslipContext.period,
				from: part === 1 ? '2026-09-01' : '2026-09-16',
				to: part === 1 ? '2026-09-15' : '2026-09-30',
				month_from: '2026-09-01',
				month_to: '2026-09-30',
				part,
				parts: 2,
				covered_days: 15,
				days: 15
			},
			statutory: { PENSION: { employee: 255, employer: 510 } },
			earned: {
				months: [],
				month: { statutory: { PENSION: { employee: earlier, employer: earlier * 2 } } }
			}
		});
		assert.equal(trips('MINIMUM_WAGE', halves(1, 0)), false);
		assert.equal(trips('MINIMUM_WAGE', halves(2, 255)), true); // 3,200 − 510 = 2,690 < 2,740
		assert.equal(trips('MINIMUM_WAGE', halves(2, 0)), false); // one half's 255 alone would pass
		// A fixed allowance counts toward the monthly wage: 2,800 + 500 passes.
		assert.equal(trips('MINIMUM_WAGE', wage(2_800, { monthly_wage: 3_300 })), false);
		// Kunming: class 1 2,270 from September 2026; classes 2 and 3 2,120 / 1,970; class 2 in March 2026 2,020.
		const km = (base: number, zone = '1', over: Row = {}) => ({
			...wage(base),
			company: { ...subject('KM').company, facts: { hpf_rate_percent: 12, wage_zone: zone } },
			...over
		});
		assert.equal(trips('MINIMUM_WAGE', km(2_250)), true);
		assert.equal(trips('MINIMUM_WAGE', km(2_300)), false);
		assert.equal(trips('MINIMUM_WAGE', km(2_100, '2')), true);
		assert.equal(trips('MINIMUM_WAGE', km(2_130, '2')), false);
		assert.equal(trips('MINIMUM_WAGE', km(1_960, '3')), true);
		const march = { period: { ...payslipContext.period } };
		assert.equal(trips('MINIMUM_WAGE', km(2_050, '2', march)), false);
		assert.equal(trips('MINIMUM_WAGE', wage(1_000, { employment_type: 'PART_TIME' })), false);
		// Hourly minimum: SH 25; KM class 1 22, class 3 20 from September 2026, class 2 20 in March.
		const partTime = (rate: number) =>
			wage(3_000, { employment_type: 'PART_TIME', facts: { hourly_rate: rate } });
		assert.equal(trips('MINIMUM_WAGE_HOURLY', partTime(24)), true);
		assert.equal(trips('MINIMUM_WAGE_HOURLY', partTime(26)), false);
		assert.equal(trips('MINIMUM_WAGE_HOURLY', { ...partTime(21.5), company: km(0).company }), true);
		assert.equal(
			trips('MINIMUM_WAGE_HOURLY', { ...partTime(20.5), company: km(0, '3').company }),
			false
		);
		assert.equal(
			trips('MINIMUM_WAGE_HOURLY', { ...partTime(19.5), ...march, company: km(0, '2').company }),
			true
		);
		// Overtime: 4 h on working days + 11 h on rest days + 8 h on the holiday = 23 h.
		assert.equal(trips('OVERTIME_MONTHLY_LIMIT'), false);
		const heavy = {
			work: {
				...payslipContext.work,
				days: [
					...payslipContext.work.days,
					day('2026-03-14', 'REST', 10),
					day('2026-03-15', 'REST', 10)
				]
			}
		};
		assert.equal(trips('OVERTIME_MONTHLY_LIMIT', heavy), true);
		assert.equal(
			trips('OVERTIME_MONTHLY_LIMIT', {
				...heavy,
				...wage(20_000, { work_classification: 'FLEXIBLE' })
			}),
			false
		);
		assert.equal(trips('OVERTIME_DAILY_LIMIT'), false);
		assert.equal(
			trips('OVERTIME_DAILY_LIMIT', {
				work: { ...payslipContext.work, days: [day('2026-03-02', 'WORK', 12, 4)] }
			}),
			true
		);
		// Part-time: 5 h in a day, or 25 h in 7 days; and a monthly entity.
		const pt = wage(3_000, { employment_type: 'PART_TIME' });
		const days = (...hours: number[]) => ({
			work: {
				...payslipContext.work,
				days: hours.map((h, i) => day(`2026-09-0${i + 1}`, 'WORK', h))
			}
		});
		assert.equal(trips('PART_TIME_HOURS', { ...pt, ...days(4, 4, 4) }), false);
		assert.equal(trips('PART_TIME_HOURS', { ...pt, ...days(5) }), true);
		assert.equal(trips('PART_TIME_HOURS', { ...pt, ...days(4, 4, 4, 4, 4, 4, 1) }), true);
		assert.equal(trips('PART_TIME_PAY_CYCLE', pt), true);
		assert.equal(
			trips('PART_TIME_PAY_CYCLE', {
				...pt,
				company: { ...subject().company, pay_frequency: 'SEMI_MONTHLY' }
			}),
			false
		);
		// Weekly rest: seven worked days in a row.
		assert.equal(trips('WEEKLY_REST', days(8, 8, 8, 8, 8, 8)), false);
		assert.equal(trips('WEEKLY_REST', days(8, 8, 8, 8, 8, 8, 8)), true);
		// Owner ruling: 2026 unemployment at 0.5% / 0.5% in both cities, provisional and warned.
		assert.equal(trips('UNEMPLOYMENT_RATE_PROVISIONAL'), true);
		assert.match(
			String((code('version_4', 'rule_set', 'UNEMPLOYMENT_RATE_PROVISIONAL').rules as Row).message),
			/owner ruling, provisional until a 2026 rate notice/
		);
		assert.equal(
			file('version_1', 'rule_set').some((row) => row.code === 'UNEMPLOYMENT_RATE_PROVISIONAL'),
			false
		);
	});

	it('payslip validations: pay day, medical period, work-injury leave, protected termination, retirement age, pregnancy and nursing', () => {
		const wage = (base: number, over: Row = {}) => ({
			terms: { ...payslipContext.terms, base_salary: base, monthly_wage: base, ...over }
		});
		// Agreed pay day: the 10th of the next month.
		const pay = (date: string) => ({
			company: {
				...subject().company,
				facts: { hpf_rate_percent: 7, wage_payday: 10, wage_payday_month_offset: 1 }
			},
			period: { ...payslipContext.period, from: '2026-09-01', to: '2026-09-30', pay_date: date }
		});
		assert.equal(trips('WAGE_PAID_LATE', pay('2026-10-09')), false);
		assert.equal(trips('WAGE_PAID_LATE', pay('2026-10-12')), true);
		assert.equal(trips('WAGE_PAID_LATE'), false);
		// Medical period: SH 3 months + 1 a year here (2016 start → 13 by 2026); national: 10+ years total, 10–15 here → 12.
		const sick = (month_index: number, region = 'SH', start = '2016-01-01') => ({
			company: { ...subject(region).company },
			employment: { ...employment, start_date: start, service_months: 130 },
			leave: {
				rows: [
					{
						code: 'SICK_LEAVE',
						activity: 'TIME_OFF',
						days: 5,
						is_npl: false,
						can_encash: false,
						pay_fraction: 0.8,
						month_index
					}
				]
			}
		});
		assert.equal(trips('MEDICAL_PERIOD_EXHAUSTED', sick(13)), false);
		assert.equal(trips('MEDICAL_PERIOD_EXHAUSTED', sick(14)), true);
		assert.equal(trips('MEDICAL_PERIOD_EXHAUSTED', sick(4, 'SH', '2026-01-01')), true);
		assert.equal(trips('MEDICAL_PERIOD_EXHAUSTED', sick(12, 'KM')), false);
		assert.equal(trips('MEDICAL_PERIOD_EXHAUSTED', sick(13, 'KM')), true);
		assert.equal(trips('MEDICAL_PERIOD_EXHAUSTED', sick(7, 'KM', '2024-01-01')), true); // 10+ years total, under 5 here: 6
		// Work-injury paid leave beyond 12 months.
		const wil = (month_index: number) => ({
			leave: {
				rows: [
					{
						code: 'WORK_INJURY_LEAVE',
						activity: 'TIME_OFF',
						days: 20,
						is_npl: false,
						can_encash: false,
						pay_fraction: 1,
						month_index
					}
				]
			}
		});
		assert.equal(trips('WORK_INJURY_LEAVE_12_MONTHS', wil(12)), false);
		assert.equal(trips('WORK_INJURY_LEAVE_12_MONTHS', wil(13)), true);
		// Protected termination: a layoff of a nursing mother, a sick employee in her medical period, a 15-year veteran near retirement.
		const leaving = (ground: string, over: Row = {}, emp: Row = {}) => ({
			employment: {
				...employment,
				exit_ground: ground,
				exit_date: '2026-09-30',
				exit_facts: {},
				...over
			},
			employee: { ...subject().employee, ...emp },
			leave: { rows: [] }
		});
		assert.equal(trips('TERMINATION_PROTECTED', leaving('ECONOMIC_LAYOFF')), false);
		assert.equal(
			trips(
				'TERMINATION_PROTECTED',
				leaving('ECONOMIC_LAYOFF', {}, { children: [{ child_birthdate: '2026-03-01' }] })
			),
			true
		);
		assert.equal(
			trips(
				'TERMINATION_PROTECTED',
				leaving('RESIGNATION', {}, { children: [{ child_birthdate: '2026-03-01' }] })
			),
			false
		);
		assert.equal(
			trips(
				'TERMINATION_PROTECTED',
				leaving(
					'CONTRACT_EXPIRY',
					{},
					{ children: [{ child_birthdate: '', estimated_delivery_date: '2027-01-15' }] }
				)
			),
			true
		);
		assert.equal(
			trips('TERMINATION_PROTECTED', {
				...leaving('INCAPACITY'),
				...sick(3),
				employment: {
					...employment,
					exit_ground: 'INCAPACITY',
					exit_date: '2026-09-30',
					exit_facts: {}
				}
			}),
			true
		);
		assert.equal(
			trips(
				'TERMINATION_PROTECTED',
				leaving('INCAPACITY', { exit_facts: { occupational_disease_or_injury: true } })
			),
			true
		);
		// A woman born 1974-06-01 (worker, 50): retires 2024-06-01; a man born 1968-03-15: 60 + 13 months → 2029-04-15.
		const veteran = leaving(
			'ECONOMIC_LAYOFF',
			{ start_date: '2005-01-01' },
			{ gender: 'MALE', date_of_birth: '1968-03-15' }
		);
		assert.equal(trips('TERMINATION_PROTECTED', veteran), true);
		assert.equal(
			trips('TERMINATION_PROTECTED', {
				...veteran,
				employment: { ...(veteran.employment as Row), start_date: '2015-01-01' }
			}),
			false
		);
		// Retirement age: a male born 1965-06-10 retires at 60 + 2 months on 2025-08-10; a female worker born 1975-03-10 at 50 + 2 months.
		const aged = (dob: string, gender: string, facts: Row = {}) => ({
			employee: { ...subject().employee, gender, date_of_birth: dob, facts }
		});
		assert.equal(trips('RETIREMENT_AGE_REACHED', aged('1965-06-10', 'MALE')), true);
		assert.equal(trips('RETIREMENT_AGE_REACHED', aged('1966-12-10', 'MALE')), false);
		assert.equal(trips('RETIREMENT_AGE_REACHED', aged('1975-03-10', 'FEMALE')), true);
		assert.equal(
			trips(
				'RETIREMENT_AGE_REACHED',
				aged('1975-03-10', 'FEMALE', { retirement_category: 'FEMALE_55' })
			),
			false
		);
		assert.equal(
			trips('RETIREMENT_AGE_REACHED', {
				...aged('1965-06-10', 'MALE'),
				...wage(20_000, { employment_type: 'RETIREE_REHIRE' })
			}),
			false
		);
		// Pregnancy from the 7th month, or nursing a child under 1: no overtime, no night work.
		const mother = (children: Row[], days: Row[]) => ({
			employee: { ...subject().employee, children },
			work: { ...payslipContext.work, days }
		});
		const night = {
			...day('2026-09-02', 'WORK', 8),
			intervals: [{ start: '2026-09-02T18:00', end: '2026-09-03T02:00' }]
		};
		assert.equal(
			trips(
				'PREGNANT_NURSING_OVERTIME',
				mother(
					[{ child_birthdate: '', estimated_delivery_date: '2026-11-20' }],
					[day('2026-09-02', 'WORK', 10, 2)]
				)
			),
			true
		);
		assert.equal(
			trips(
				'PREGNANT_NURSING_OVERTIME',
				mother(
					[{ child_birthdate: '', estimated_delivery_date: '2027-03-20' }],
					[day('2026-09-02', 'WORK', 10, 2)]
				)
			),
			false
		);
		assert.equal(
			trips('PREGNANT_NURSING_OVERTIME', mother([{ child_birthdate: '2026-02-01' }], [night])),
			true
		);
		assert.equal(
			trips('PREGNANT_NURSING_OVERTIME', mother([{ child_birthdate: '2025-02-01' }], [night])),
			false
		);
	});

	it('contract validations refuse an over-long or under-paid probation and a social insurance waiver', () => {
		const refuses = (wanted: string, terms: Row, emp: Row = {}) => {
			const check = file('version_3', 'rule_set').find((row) => row.code === wanted)!;
			const t = {
				...payslipContext.terms,
				effective_from: '2026-03-01',
				effective_to: '',
				...terms
			};
			return evaluateConfigured(String((check.rules as Row).when), {
				...subject(),
				rules: rulesOf('version_3'),
				employment: { ...employment, start_date: '2026-03-01', exit_date: '', ...emp },
				term: t,
				terms: t,
				day: '2026-03-01'
			});
		};
		const probation = (to: string, over: Row = {}) => ({
			effective_to: to,
			facts: { probation: true, contract_wage: 20_000, ...over }
		});
		// Open-ended contract: 6 months allowed.
		assert.equal(refuses('PROBATION_LENGTH', probation('2026-08-31')), false);
		assert.equal(refuses('PROBATION_LENGTH', probation('2026-09-30')), true);
		// 1–3 year contract: 2 months; under 1 year: 1 month; under 3 months: none.
		assert.equal(
			refuses('PROBATION_LENGTH', probation('2026-04-30'), { exit_date: '2028-02-28' }),
			false
		);
		assert.equal(
			refuses('PROBATION_LENGTH', probation('2026-05-31'), { exit_date: '2028-02-28' }),
			true
		);
		assert.equal(
			refuses('PROBATION_LENGTH', probation('2026-04-30'), { exit_date: '2026-12-31' }),
			true
		);
		assert.equal(
			refuses('PROBATION_LENGTH', probation('2026-03-31'), { exit_date: '2026-12-31' }),
			false
		);
		assert.equal(
			refuses('PROBATION_LENGTH', probation('2026-03-15'), { exit_date: '2026-04-30' }),
			true
		);
		assert.equal(
			refuses('PROBATION_LENGTH', { ...probation('2026-03-31'), employment_type: 'PART_TIME' }),
			true
		);
		assert.equal(refuses('PROBATION_LENGTH', { effective_to: '2026-12-31', facts: {} }), false);
		// Probation pay: at least 80% of the contract wage (or the post's lowest) and the minimum wage.
		assert.equal(
			refuses('PROBATION_WAGE', { base_salary: 16_000, ...probation('2026-08-31') }),
			false
		);
		assert.equal(
			refuses('PROBATION_WAGE', { base_salary: 15_000, ...probation('2026-08-31') }),
			true
		);
		assert.equal(
			refuses('PROBATION_WAGE', {
				base_salary: 15_000,
				...probation('2026-08-31', { post_lowest_wage: 14_000 })
			}),
			false
		);
		assert.equal(
			refuses('PROBATION_WAGE', {
				base_salary: 2_500,
				...probation('2026-08-31', { contract_wage: 3_000 })
			}),
			true
		);
		assert.equal(refuses('SI_WAIVER_VOID', { facts: { social_insurance_waived: true } }), true);
		assert.equal(refuses('SI_WAIVER_VOID', { facts: {} }), false);
	});

	it('IIT: non-resident bonus over six months, termination pay above 3× the local wage, a mid-year declaration back-dated', () => {
		const iit = code('version_3', 'statutory_contribution_catalog', 'IIT').configuration as {
			assessable: Record<string, string>;
			refuse_when: { when: string }[];
			rules: { when: string; employee: string }[];
		};
		const assess = (over: Row) => {
			const context = { ...statutoryContext('SH'), ...over } as Row;
			const parts = Object.fromEntries(
				Object.entries(iit.assessable).map(([part, expression]) => [
					part,
					evaluateConfigured(expression, context)
				])
			);
			const ruled = {
				...context,
				base: { ...PARTS, ...parts, ...(over.base as Row | undefined) }
			};
			const rule = iit.rules.find((item) => evaluateConfigured(item.when, ruled) === true)!;
			return {
				parts,
				tax: evaluateConfigured(rule.employee, ruled),
				refused: iit.refuse_when.some((guard) => evaluateConfigured(guard.when, ruled) === true)
			};
		};
		const nonResident = (facts: Row = {}) => ({
			person: { ...(statutoryContext('SH').person as Row), residency_status: 'NON_RESIDENT' },
			employee: { ...(statutoryContext('SH').employee as Row), facts }
		});
		// 60,000 bonus: ((60,000 / 6) × 10% − 210) × 6 = 4,740, beside 25,000 of wages on the monthly table (3,590).
		const nr = assess({
			...nonResident(),
			month: { ordinary: 30_000, bonus: 60_000, deductions: 0, ...PARTS }
		});
		assert.deepEqual(nr.parts, {
			ordinary: 30_000,
			bonus: 60_000,
			deductions: 5_000,
			foreign_allowance: 0
		});
		assert.equal(nr.tax, 3_590 + 4_740);
		// Half the month worked in China: 15,000 − 5,000 = 10,000 → 790; bonus 30,000 / 6 = 5,000 → (500 − 210) × 6 = 1,740.
		assert.equal(
			assess({
				...nonResident({ china_workday_share: 0.5 }),
				month: { ordinary: 30_000, bonus: 60_000, deductions: 0, ...PARTS }
			}).tax,
			790 + 1_740
		);
		// A second bonus in the year merges into the month for a non-resident too.
		assert.deepEqual(
			assess({
				...nonResident(),
				month: { ordinary: 30_000, bonus: 60_000, deductions: 0, ...PARTS },
				year: { ordinary: 0, bonus: 50_000, deductions: 0, ...PARTS }
			}).parts.bonus,
			0
		);
		// Termination pay: 500,000 against 3 × 130,000 = 390,000 → 110,000 on the annual table = 1,080 + 7,400 = 8,480.
		const leaving = (facts: Row) =>
			assess({
				company: {
					...(statutoryContext('SH').company as Row),
					facts: { hpf_rate_percent: 7, ...facts }
				},
				month: { ordinary: 0, bonus: 0, deductions: 0, ...PARTS },
				base: { ordinary: 0, bonus: 0, deductions: 0, ...PARTS, separation: 500_000 }
			});
		assert.equal(leaving({ local_average_annual_wage: 130_000 }).tax, 8_480);
		assert.equal(leaving({}).refused, true);
		// A standing declared in May back-dates January–April: 4 × (2,000 + 1,500) on top of May's own.
		const may = {
			key: '2026-05',
			from: '2026-05-01',
			to: '2026-05-31',
			days: 31,
			month: 5,
			salary_paid: false
		};
		const declared = (since: string) =>
			Number(
				assess({
					period: may,
					scheme: {
						code: 'IIT',
						standing: 'REGISTERED',
						since,
						elections: { children_education_children: 1, housing_rent: true }
					}
				}).parts.deductions
			);
		assert.equal(declared('2026-05-10') - declared('2026-01-01'), 4 * 3_500);
	});

	it('per-event leave caps: maternity per birth, city extensions, paternity, marriage; childcare per year by children under 3', () => {
		const days = (wanted: string, facts: Row = {}, employee: Row = {}, region = 'SH') =>
			entitlementDays(
				code('version_3', 'leave_catalog', wanted).entitlement as Parameters<
					typeof entitlementDays
				>[0],
				130,
				{
					as_of: '2026-06-30',
					employment,
					company: subject(region).company,
					rules: rulesOf('version_3'),
					employee: { children: [], ...employee },
					entry: entry({ event_id: 'b1', ...facts })
				}
			);
		assert.equal(days('MATERNITY_LEAVE'), 98);
		assert.equal(days('MATERNITY_LEAVE', { difficult_birth: true, babies: 2 }), 128);
		assert.equal(days('MATERNITY_LEAVE', { miscarriage_months: 3 }), 15);
		assert.equal(days('MATERNITY_LEAVE', { miscarriage_months: 5 }), 42);
		assert.equal(days('MATERNITY_EXTENSION'), 60);
		assert.equal(days('MATERNITY_EXTENSION', { miscarriage_months: 5 }, {}, 'KM'), 0);
		assert.equal(days('PATERNITY_LEAVE'), 10);
		assert.equal(days('PATERNITY_LEAVE', {}, {}, 'KM'), 30);
		assert.equal(days('MARRIAGE_EXTENSION', {}, {}, 'KM'), 15);
		const kids = (...births: string[]) => ({
			children: births.map((child_birthdate) => ({ child_birthdate }))
		});
		assert.equal(days('CHILDCARE_LEAVE', {}, kids('2024-01-01')), 5);
		assert.equal(days('CHILDCARE_LEAVE', {}, kids('2020-01-01')), 0);
		assert.equal(days('CHILDCARE_LEAVE', {}, kids('2024-01-01'), 'KM'), 10);
		assert.equal(days('CHILDCARE_LEAVE', {}, kids('2024-01-01', '2025-06-01'), 'KM'), 15);
		for (const wanted of [
			'MATERNITY_LEAVE',
			'PATERNITY_LEAVE',
			'MARRIAGE_LEAVE',
			'BEREAVEMENT_LEAVE'
		])
			assert.equal((code('version_3', 'leave_catalog', wanted).entitlement as Row).window, 'EVENT');
	});

	it('annual leave is 5, 10 or 15 days by cumulative working years', () => {
		for (const version of VERSIONS) {
			const annual = code(version, 'leave_catalog', 'ANNUAL_LEAVE');
			const entitlement = annual.entitlement as Parameters<typeof entitlementDays>[0];
			const at = (months: number, over: Row = {}, as_of = '2026-06-30') =>
				entitlementDays(entitlement, months, {
					as_of,
					employment: { ...employment, ...over },
					terms: { ...subject().terms, facts: termFacts },
					taken_by_class: {
						...(sickDays === 0 ? {} : { SICK_LEAVE: { calendar_year: sickDays } }),
						...(paidPersonal === 0 ? {} : { PERSONAL_LEAVE_PAID: { calendar_year: paidPersonal } })
					}
				});
			let sickDays = 0;
			let paidPersonal = 0;
			let termFacts: Row = {};
			// 条例 第四条(一), 实施办法 第七条: school vacations reduce the year's leave, none when they reach it.
			termFacts = { school_vacation_days: 4 };
			assert.equal(at(130), 6);
			termFacts = { school_vacation_days: 12 };
			assert.equal(at(130), 0);
			termFacts = {};
			// 条例 第四条(二): 20 days or more of personal leave on full pay in the year → none.
			paidPersonal = 19;
			assert.equal(at(130), 10);
			paidPersonal = 20;
			assert.equal(at(130), 0);
			paidPersonal = 0;
			assert.equal(code(version, 'leave_catalog', 'PERSONAL_LEAVE_PAID').is_npl, false);
			assert.equal(at(11), 0);
			assert.equal(at(12), 5);
			assert.equal(at(119), 5);
			assert.equal(at(120), 10);
			assert.equal(at(240), 15);
			assert.equal((annual.entitlement as Row).window, 'CALENDAR_YEAR');
			assert.equal(annual.encash_on_exit, true);
			// 实施办法 第十二条: a leaver gets the exit year's days worked ÷ 365, rounded down.
			const leaver = { exit_ground: 'RESIGNATION', exit_date: '2026-06-30' };
			assert.equal(at(130, leaver), 4); // 181 / 365 × 10 = 4.96 → 4
			assert.equal(at(130, { ...leaver, start_date: '2026-04-01' }), 2); // 91 / 365 × 10
			assert.equal(at(130, { exit_ground: '', exit_date: '2027-12-31' }), 10); // a fixed term end alone is no exit
			// 实施办法 第五条: a new hire's first year counts the calendar days left in it (2026-04-01 → 275 days).
			assert.equal(at(130, { start_date: '2026-04-01' }), 7); // 275 / 365 × 10 = 7.53 → 7
			assert.equal(at(130, { start_date: '2026-04-01' }, '2027-03-01'), 10); // the next year is whole
			// A leaver's past year read later is not reduced: only the year of exit is.
			assert.equal(at(130, leaver, '2025-11-30'), 10);
			// 条例 第四条: no leave in a year with sick leave of 2 months (under 10 years), 3 (10–20) or 4 (20+).
			sickDays = 60;
			assert.equal(at(119), 0);
			assert.equal(at(130), 10);
			sickDays = 90;
			assert.equal(at(130), 0);
			assert.equal(at(240), 15);
			sickDays = 120;
			assert.equal(at(240), 0);
			sickDays = 0;
			// 条例 第五条第二款: unused days may be carried into the next year once.
			assert.equal((annual.entitlement as Row).carry_forward, '15.0');
		}
	});

	it('Shanghai sick pay follows the 沪劳保发〔1995〕83号 scale with the 80% minimum-wage floor; Kunming at the 80% floor unless the employer records more', () => {
		const sick = code('version_3', 'leave_catalog', 'SICK_LEAVE');
		const fraction = (region: string, start: string, month_index: number, base = 20_000) =>
			evaluateConfigured(String(sick.pay_fraction), {
				...payslipContext,
				...subject(region),
				terms: { ...payslipContext.terms, base_salary: base },
				employment: { ...employment, start_date: start },
				rules: rulesOf('version_3'),
				leave: { code: 'SICK_LEAVE', from: '2026-03-10', month_index, days: 1 },
				entry: entry({})
			});
		assert.equal(fraction('SH', '2025-01-01', 1), 0.6);
		assert.equal(fraction('SH', '2023-03-10', 1), 0.7);
		assert.equal(fraction('SH', '2022-03-10', 1), 0.8);
		assert.equal(fraction('SH', '2016-01-01', 1), 1);
		assert.equal(fraction('SH', '2016-01-01', 7), 0.6);
		assert.equal(fraction('SH', '2025-06-01', 8), 0.4);
		// 80% of 2,740 on a 3,000 salary beats the 60% scale.
		assert.equal(fraction('SH', '2025-01-01', 1, 3_000), (0.8 * 2_740) / 3_000);
		// Kunming: 80% of the class minimum wage (2,170 in March 2026) on a 20,000 salary, unless the employer pays more.
		assert.equal(fraction('KM', '2025-01-01', 1), (0.8 * 2_170) / 20_000);
		const row = code('version_3', 'work_catalog', 'SICK_PAY_REDUCTION');
		assert.ok(
			Math.abs(
				Number(evaluateConfigured(String(row.quantity), payslipContext)) *
					Number(evaluateConfigured(String(row.rate), payslipContext)) -
					2 * 0.3 * (20_000 / 21.75)
			) < 1e-9
		);
	});

	it('work lines price 150% overtime, 300% holiday work, no-pay days and the further 200% for untaken leave', () => {
		const amount = (wanted: string) => {
			const row = code('version_3', 'work_catalog', wanted);
			return (
				Number(evaluateConfigured(String(row.quantity), payslipContext)) *
				Number(evaluateConfigured(String(row.rate), payslipContext))
			);
		};
		const hourly = 20_000 / 21.75 / 8;
		// Working-day overtime 3 + 1; rest days 6 h (REST) + 5 h (substitute day off); public holiday 8 h.
		assert.equal(amount('OVERTIME'), 4 * 1.5 * hourly);
		assert.equal(amount('REST_DAY_WORK'), 11 * 2 * hourly);
		assert.equal(amount('HOLIDAY_WORK'), 8 * 3 * hourly);
		// A weekend declared a working day (调休上班) prices at 150% overtime, not as rest-day work.
		const makeup = {
			...payslipContext,
			work: { ...payslipContext.work, days: [day('2026-02-14', 'REST', 10, 2, 'MAKEUP_WORKDAY')] }
		};
		const at = (wanted: string) => {
			const row = code('version_3', 'work_catalog', wanted);
			return Number(evaluateConfigured(String(row.quantity), makeup));
		};
		assert.equal(at('REST_DAY_WORK'), 0);
		assert.equal(at('OVERTIME'), 2);
		const compensated = code('version_3', 'work_catalog', 'REST_DAY_WORK');
		assert.equal(
			evaluateConfigured(String(compensated.quantity), {
				...payslipContext,
				company: { ...payslipContext.company, facts: { rest_day_work_compensated: true } }
			}),
			0
		);
		assert.equal(amount('NO_PAY_LEAVE'), 2 * (20_000 / 21.75));
		assert.equal(amount('ENCASHMENT'), 3 * 2 * (20_000 / 21.75));
	});

	it('economic compensation: N months, half a month under six, capped at 3× the local average and 12 years', () => {
		const pay = (months: number, wage: number) => {
			const [band] = code('version_3', 'adhoc_catalog', 'ECONOMIC_COMPENSATION').bands as {
				amount: string;
			}[];
			return evaluateConfigured(band!.amount, {
				...payslipContext,
				entry: entry({ qualifying_months: months, local_average_monthly_wage: 12_577 }, wage)
			});
		};
		assert.equal(pay(41, 20_000), 20_000 * 3.5);
		assert.equal(pay(43, 20_000), 20_000 * 4);
		assert.equal(pay(3, 20_000), 10_000);
		assert.equal(pay(200, 20_000), 20_000 * 17);
		assert.equal(pay(200, 50_000), 37_731 * 12);
		const [damage] = code('version_3', 'adhoc_catalog', 'DAMAGE_COMPENSATION_DEDUCTION').bands as {
			limit: { amount: string };
		}[];
		assert.equal(evaluateConfigured(damage!.limit.amount, payslipContext), 4_000);
		// 20% of 3,000 would leave 2,400; the remaining wage may not fall below Shanghai's 2,740.
		const low = { ...payslipContext, terms: { ...payslipContext.terms, monthly_wage: 3_000 } };
		assert.equal(evaluateConfigured(damage!.limit.amount, low), 260);
		// Each version carries only the minimum wage in force for it: 2,170 to 31 August 2026, 2,270 from 1 September.
		for (const [version, zones] of [
			['version_1', [2170, 2020, 1870]],
			['version_3', [2170, 2020, 1870]],
			['version_4', [2270, 2120, 1970]]
		] as const) {
			const km = (rulesOf(version).regions as { by_region: Record<string, Row> }).by_region.KM!;
			const table = (km.minimum_wage as { zones: Record<string, { amount: number }> }).zones;
			assert.deepEqual(
				['1', '2', '3'].map((zone) => table[zone]!.amount),
				[...zones],
				version
			);
		}
	});

	it('every obligation names a trigger, cites its authority and its due evaluates to a date', () => {
		const company = { region: 'SH', facts: { established_on: '2026-03-02' } };
		const period = { key: '2026-03', from: '2026-03-01', to: '2026-03-31' };
		const contexts: Record<string, Row> = {
			PAYROLL_RUN: {
				period,
				company,
				headcount: 50,
				holidays: [],
				run: {
					pay_date: '2026-04-05',
					totals: { gross: 0, net: 0, employer_cost: 0, schemes: {} }
				},
				row: { period: '2026-03', pay_date: '2026-04-05' }
			},
			HIRE: { period, company, hired_on: '2026-03-02' },
			EXIT: { period, company, exit_on: '2026-06-30', today: '2026-06-30' },
			'obligation.updated': {
				period,
				company,
				today: '2026-04-20',
				row: { duty_code: 'SI_MONTHLY_PAYMENT', due_on: '2026-04-15', fulfilled_on: '2026-04-20' }
			},
			'entity.created': { period, company, row: { id: 'c1' } },
			'entity.updated': {
				period,
				company,
				today: '2026-04-02',
				row: { id: 'c1', name: 'New', before: { name: 'Old' } }
			},
			'calendar.daily': {
				period,
				company,
				today: '2026-04-02',
				hired_on: '2026-03-02',
				contract: { facts: { contract_terms: [] } }
			},
			'leave_catalog_entry.created': {
				period,
				company,
				row: { catalog_id: 'x', occurred_on: '2026-03-10', facts: { accident_date: '2026-03-09' } }
			}
		};
		for (const version of VERSIONS) {
			const rows = dutiesOf(file(version, 'rule_set'));
			assert.equal(rows.length, 49);
			for (const row of rows) {
				const rules = { ...(row.rules as object), trigger: triggerOf(row) } as {
					trigger: string;
					due: string;
					applies_when?: string;
					authority: string;
					months?: string[];
				};
				assert.ok(['OBLIGATIONS', 'TASKS'].includes(String(row.family)));
				assert.ok(rules.authority.length > 20, String(row.code));
				assert.match(
					String(
						evaluateConfigured(rules.due, {
							...contexts[rules.trigger]!,
							rules: { regions: regionsOf(version).rules }
						})
					),
					/^\d{4}-\d{2}-\d{2}$/
				);
				if (rules.applies_when !== undefined)
					assert.equal(
						typeof evaluateConfigured(rules.applies_when, {
							...contexts[rules.trigger]!,
							rules: rulesOf(version),
							contract: { exit_ground: 'RESIGNATION', exit_facts: {}, effective_range: {} },
							employee: { nationality: 'CN' },
							company: { region: 'SH', facts: {} }
						}),
						'boolean'
					);
			}
		}
	});

	it('the canonical obligation behaviours raise one obligation per duty for their trigger', () => {
		for (const version of VERSIONS) {
			const settings = settingsOf(version);
			const behaviours = settings.behaviours as Behaviours;
			const ids = behaviours.rules.map((rule) => rule.id);
			for (const id of ['raise-obligations', 'raise-tasks'])
				assert.equal(ids.filter((candidate) => candidate === id).length, 1, `${version} ${id}`);
			const rows = dutiesOf(file(version, 'rule_set'));
			const raise = (collection: string, event: string, row: Row, reads: Row = {}) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows: [...rows, ...file(version, 'rule_set').filter((row) => row.family === 'PAYROLL')],
					collection,
					event,
					row,
					reads: {
						payroll: [regionsOf(version)],
						company: [{ region: 'SH', risk_class: '1', facts: { hpf_rate_percent: 7 } }],
						employee: [
							{ nationality: 'CN', gender: 'FEMALE', date_of_birth: '1990-01-01', facts: {} }
						],
						...reads
					}
				});
			const run = (period: string) =>
				raise('payroll_run', 'created', { id: 'r1', company_id: 'c1', period, approval_id: null });
			const due = (writes: Row[], duty: string) =>
				writes.find((write) => write.duty_code === duty)?.due_on;
			const april = run('2026-04');
			// Three remittances, the payslip statement and the wage-record retention.
			assert.equal(april.length, 5);
			// No pay day on the run: the period end's month is the payment month (filing in May, extended to 22 May).
			assert.equal(due(april, 'IIT_MONTHLY_DECLARATION'), '2026-05-22');
			assert.equal(due(april, 'WAGE_STATEMENT'), '2026-04-30');
			assert.equal(due(april, 'WAGE_RECORDS_RETENTION'), '2028-04-30');
			const at = (
				period: string,
				opts: { pay_date?: string; region?: string; headcount?: number; facts?: Row } = {}
			) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows: [...rows, ...file(version, 'rule_set').filter((row) => row.family === 'PAYROLL')],
					collection: 'payroll_run',
					event: 'created',
					headcount: opts.headcount ?? 10,
					row: {
						id: `r-${period}`,
						company_id: 'c1',
						period,
						approval_id: null,
						pay_date: opts.pay_date ?? null
					},
					run: {
						pay_date: opts.pay_date ?? null,
						totals: {
							gross: 0,
							net: 0,
							employer_cost: 0,
							schemes: {
								PENSION: { employee: 1, employer: 1 },
								HPF: { employee: 1, employer: 1 },
								IIT: { employee: 1, employer: 0 },
								UNION_FUND: { employee: 0, employer: 1 }
							}
						}
					},
					reads: {
						payroll: [regionsOf(version)],
						company: [
							{
								region: opts.region ?? 'SH',
								risk_class: '1',
								facts: { hpf_rate_percent: 7, ...(opts.facts ?? {}) }
							}
						]
					}
				});
			// The IIT period is the payment month, with the 2026 filing calendar's extensions (税总办征科函〔2025〕64号).
			assert.equal(
				due(at('2026-09', { pay_date: '2026-09-30' }), 'IIT_MONTHLY_DECLARATION'),
				'2026-10-26'
			);
			assert.equal(
				due(at('2026-09', { pay_date: '2026-10-08' }), 'IIT_MONTHLY_DECLARATION'),
				'2026-11-16'
			);
			assert.equal(
				due(at('2026-01', { pay_date: '2026-01-31' }), 'IIT_MONTHLY_DECLARATION'),
				'2026-02-24'
			);
			assert.equal(
				due(at('2026-11', { pay_date: '2026-12-05' }), 'IIT_MONTHLY_DECLARATION'),
				'2027-01-15'
			);
			// HPF within 5 days of the pay day; the statement on the pay day.
			assert.equal(
				due(at('2026-09', { pay_date: '2026-10-08' }), 'HPF_MONTHLY_REMITTANCE'),
				'2026-10-13'
			);
			assert.equal(due(at('2026-09', { pay_date: '2026-10-08' }), 'WAGE_STATEMENT'), '2026-10-08');
			// Migrant-worker employers keep the wage ledger 3 years.
			assert.equal(
				due(at('2026-04', { facts: { employs_migrant_workers: true } }), 'WAGE_RECORDS_RETENTION'),
				'2029-04-30'
			);
			// One union-fund remittance, its day the region's: Kunming next month's end, only with a union (a preparatory
			// organisation does not count there); Shanghai by the 15th, with a union or a preparatory organisation.
			assert.equal(
				due(
					at('2026-04', { region: 'KM', facts: { union_established: true } }),
					'UNION_FUND_REMITTANCE'
				),
				'2026-05-31'
			);
			assert.equal(due(at('2026-04', { region: 'KM' }), 'UNION_FUND_REMITTANCE'), undefined);
			assert.equal(
				due(
					at('2026-04', { region: 'KM', facts: { union_preparatory: true } }),
					'UNION_FUND_REMITTANCE'
				),
				undefined
			);
			assert.equal(
				due(at('2026-04', { facts: { union_established: true } }), 'UNION_FUND_REMITTANCE'),
				'2026-05-15'
			);
			assert.equal(
				due(at('2026-04', { facts: { union_preparatory: true } }), 'UNION_FUND_REMITTANCE'),
				'2026-05-15'
			);
			assert.equal(due(at('2026-04'), 'UNION_FUND_REMITTANCE'), undefined);
			// Kunming union preparatory fund (云工通〔2021〕1号): without a union, in the period after the quarter; the
			// fourth quarter by 15 December.
			const prep = (period: string, opts: { region?: string; facts?: Row } = {}) =>
				due(at(period, { region: 'KM', ...opts }), 'UNION_PREPARATORY_FUND');
			assert.equal(prep('2026-01'), '2026-04-15');
			assert.equal(prep('2026-03'), '2026-04-15');
			assert.equal(prep('2026-04'), '2026-07-15');
			assert.equal(prep('2026-09'), '2026-10-15');
			assert.equal(prep('2026-10'), '2026-12-15');
			assert.equal(prep('2026-12'), '2026-12-15');
			assert.equal(prep('2026-04', { facts: { union_established: true } }), undefined);
			assert.equal(prep('2026-04', { region: 'SH' }), undefined);
			// HPF annual base adjustment: Shanghai in July, Kunming in January.
			assert.equal(due(at('2026-07'), 'HPF_BASE_ANNUAL_ADJUSTMENT'), '2026-08-05');
			assert.equal(due(at('2026-01'), 'HPF_BASE_ANNUAL_ADJUSTMENT'), undefined);
			assert.equal(
				due(at('2026-01', { region: 'KM' }), 'HPF_BASE_ANNUAL_ADJUSTMENT'),
				'2026-02-05'
			);
			// Retention: special-deduction forms 5 years from the next year; reconciliation records 5 years from 30 June.
			assert.equal(due(at('2027-01'), 'SAD_RECORD_RETENTION'), '2031-12-31');
			assert.equal(due(at('2027-06'), 'IIT_RECONCILIATION_RECORDS'), '2032-06-30');
			// Disabled persons' employment fund: over 30 staff; Shanghai declares in October, Kunming pays in November.
			assert.equal(due(at('2026-10', { headcount: 31 }), 'DISABLED_EMPLOYMENT_FUND'), '2026-10-31');
			assert.equal(due(at('2026-10', { headcount: 30 }), 'DISABLED_EMPLOYMENT_FUND'), undefined);
			assert.equal(
				due(at('2026-11', { headcount: 31, region: 'KM' }), 'DISABLED_EMPLOYMENT_FUND'),
				'2026-11-30'
			);
			assert.equal(due(april, 'HPF_MONTHLY_REMITTANCE'), '2026-05-05');
			assert.equal(due(april, 'SI_MONTHLY_PAYMENT'), '2026-04-15');
			assert.equal(due(run('2027-01'), 'IIT_INCOME_STATEMENT'), '2027-02-28');
			assert.equal(due(run('2027-03'), 'IIT_ANNUAL_RECONCILIATION'), '2027-06-30');
			// Kunming pays its social insurance by the 20th; Shanghai declares the base in May (due 25 June).
			const kmCompany = {
				company: [{ region: 'KM', risk_class: '3', facts: { hpf_rate_percent: 12 } }]
			};
			assert.equal(
				due(
					raise(
						'payroll_run',
						'created',
						{ id: 'r2', company_id: 'c1', period: '2026-04', approval_id: null },
						kmCompany
					),
					'SI_MONTHLY_PAYMENT'
				),
				'2026-04-20'
			);
			assert.equal(due(run('2026-05'), 'SI_BASE_ANNUAL_DECLARATION'), '2026-06-25');
			assert.equal(
				due(
					raise(
						'payroll_run',
						'created',
						{ id: 'r3', company_id: 'c1', period: '2026-05', approval_id: null },
						kmCompany
					),
					'SI_BASE_ANNUAL_DECLARATION'
				),
				undefined
			);
			// Kunming declares one wage for all five insurances by 31 January (云南税务 2026-01-08), raised in December.
			const kmRun = (period: string) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r4', company_id: 'c1', period, approval_id: null },
					kmCompany
				);
			assert.equal(due(kmRun('2025-12'), 'SI_BASE_ANNUAL_DECLARATION'), '2026-01-31');
			assert.equal(due(kmRun('2026-01'), 'SI_BASE_ANNUAL_DECLARATION'), undefined);
			assert.equal(due(run('2025-12'), 'SI_BASE_ANNUAL_DECLARATION'), undefined);
			// A new employer's two unit registrations run 30 days from its establishment.
			const founded = raise(
				'entity',
				'created',
				{ id: 'c1', approval_id: null, facts: { established_on: '2026-03-02' } },
				{ company: [{ region: 'SH', facts: { established_on: '2026-03-02' } }] }
			);
			assert.equal(due(founded, 'SI_UNIT_REGISTRATION'), '2026-04-01');
			assert.equal(due(founded, 'HPF_UNIT_REGISTRATION'), '2026-04-01');
			// A work-injury leave entry raises the recognition application, 30 days after the accident.
			const injury = code(version, 'leave_catalog', 'WORK_INJURY_LEAVE');
			const injured = (catalog_id: unknown) =>
				raise('leave_catalog_entry', 'created', {
					id: 'l1',
					company_id: 'c1',
					employment_id: 'k1',
					catalog_id,
					catalog_code: catalog_id === injury.id ? 'WORK_INJURY_LEAVE' : 'SICK_LEAVE',
					occurred_on: '2026-03-12',
					facts: { accident_date: '2026-03-10' },
					approval_id: null
				});
			assert.equal(due(injured(injury.id), 'WORK_INJURY_RECOGNITION'), '2026-04-09');
			assert.equal(due(injured('other'), 'WORK_INJURY_RECOGNITION'), undefined);
			// The daily tick: one month after hire without a written contract (double wages), and the one-year deeming.
			const tick = (
				today: string,
				terms: Row[] = [{ effective_range: { from: '2026-03-02', to: null } }]
			) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows: [...rows, ...file(version, 'rule_set').filter((row) => row.family === 'PAYROLL')],
					collection: 'calendar',
					event: 'daily',
					day: today,
					row: {
						id: 'k1',
						company_id: 'c1',
						approval_id: null,
						effective_range: { from: '2026-03-02', to: null },
						facts: { contract_terms: terms }
					},
					reads: { company: [{ region: 'SH', facts: {} }] }
				}).map((write) => String(write.duty_code));
			assert.deepEqual(tick('2026-04-02'), ['WRITTEN_CONTRACT_OVERDUE']);
			assert.deepEqual(tick('2026-04-03'), []);
			assert.deepEqual(tick('2027-03-02'), ['DEEMED_OPEN_ENDED_CONTRACT']);
			assert.deepEqual(
				tick('2026-04-02', [{ facts: { written_contract_signed_on: '2026-03-10' } }]),
				[]
			);
			const contract = {
				id: 'k1',
				company_id: 'c1',
				approval_id: null,
				effective_range: { from: '2026-03-02', to: null },
				exit_facts: null
			};
			const hired = raise('employment_contract', 'created', contract);
			assert.equal(hired.length, 7);
			// 个人信息保护法 第十七条、第二十九条: the notice and the sensitive-data consent at hire.
			assert.equal(due(hired, 'PI_PROCESSING_NOTICE'), '2026-03-02');
			assert.equal(due(hired, 'SENSITIVE_PI_CONSENT'), '2026-03-02');
			assert.equal(due(hired, 'EMPLOYMENT_REGISTRATION'), '2026-04-01');
			assert.equal(due(hired, 'SI_REGISTRATION'), '2026-04-01');
			assert.equal(due(hired, 'LABOUR_CONTRACT'), '2026-04-02');
			assert.equal(due(hired, 'WORK_PERMIT'), undefined);
			// A foreign national also needs the work permit; a Hong Kong resident does not.
			const foreign = (nationality: string) =>
				raise('employment_contract', 'created', contract, {
					employee: [{ nationality, gender: 'MALE', date_of_birth: '1985-01-01', facts: {} }]
				});
			assert.equal(due(foreign('DE'), 'WORK_PERMIT'), '2026-03-02');
			assert.equal(foreign('HK').length, 7);
			const left = (exit_ground: string) => ({
				...contract,
				exit_ground,
				effective_range: { from: '2026-03-02', to: '2026-06-30' },
				exit_facts: {}
			});
			const exitsOn = (ground: string) =>
				raise('employment_contract', 'updated', left(ground), { catalogues: [], movements: [] });
			const exits = exitsOn('RESIGNATION');
			assert.equal(exits.length, 7);
			assert.equal(due(exits, 'EMPLOYMENT_DEREGISTRATION'), '2026-07-15');
			assert.equal(due(exits, 'ECONOMIC_COMPENSATION_PAYMENT'), undefined);
			const layoff = exitsOn('ECONOMIC_LAYOFF');
			assert.equal(layoff.length, 9);
			assert.equal(due(layoff, 'ECONOMIC_LAYOFF_REPORT'), '2026-05-31');
			// 社会保险法 第五十七条第二款: a change of the employer's name is registered within 30 days; any other change raises none.
			const renamed = (before: Row) =>
				raise('entity', 'updated', {
					id: 'c1',
					name: 'Xuhui Trading',
					occurred_on: '2026-04-02',
					approval_id: null,
					before
				});
			assert.equal(due(renamed({ name: 'Xuhui' }), 'SI_UNIT_CHANGE_REGISTRATION'), '2026-05-02');
			assert.equal(due(renamed({ facts: {} }), 'SI_UNIT_CHANGE_REGISTRATION'), undefined);
			// 个人信息保护法 第四十七条: personal data disposed of once the longest retention (30 years) has run.
			assert.equal(due(exits, 'PERSONAL_DATA_DISPOSAL'), '2036-12-31');
			assert.equal(due(layoff, 'ECONOMIC_COMPENSATION_PAYMENT'), '2026-06-30');
			assert.equal(due(exitsOn('INCAPACITY'), 'TERMINATION_NOTICE_ART40'), '2026-05-31');
			// Kunming final wages within 5 working days (2026-06-30 Tue → 2026-07-07).
			assert.equal(
				due(
					raise('employment_contract', 'updated', left('RESIGNATION'), {
						catalogues: [],
						movements: [],
						company: [{ region: 'KM', facts: {} }]
					}),
					'FINAL_WAGES'
				),
				'2026-07-07'
			);
			assert.equal(due(exits, 'FINAL_WAGES'), '2026-06-30');
			// A layoff of 3 out of 100 is under both thresholds; 25 is over.
			const batch = (size: number) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows: [...rows, ...file(version, 'rule_set').filter((row) => row.family === 'PAYROLL')],
					collection: 'employment_contract',
					event: 'updated',
					headcount: 100,
					row: { ...left('ECONOMIC_LAYOFF'), exit_facts: { layoff_batch_size: size } },
					reads: {
						payroll: [regionsOf(version)],
						company: [{ region: 'SH', facts: {} }],
						catalogues: [],
						movements: []
					}
				}).map((write) => String(write.duty_code));
			assert.equal(batch(3).includes('ECONOMIC_LAYOFF_REPORT'), false);
			assert.equal(batch(25).includes('ECONOMIC_LAYOFF_REPORT'), true);
			assert.equal(due(exits, 'SI_FILE_TRANSFER'), '2026-07-15');
			assert.equal(due(exits, 'TERMINATED_CONTRACT_RETENTION'), '2028-06-30');
		}
	});

	describe('round 7 records', () => {
		const V3 = 'version_3';
		const work = (wanted: string, over: Row = {}) => {
			const row = code(V3, 'work_catalog', wanted);
			const context = { ...payslipContext, ...over };
			if (evaluateConfigured(String(row.eligibility), context) !== true) return 0;
			return (
				Number(evaluateConfigured(String(row.quantity), context)) *
				Number(evaluateConfigured(String(row.rate), context))
			);
		};
		const hourly = 20_000 / 21.75 / 8;
		const classified = (work_classification: string, region = 'SH', facts: Row = {}) => ({
			...subject(region),
			terms: { ...payslipContext.terms, work_classification, facts }
		});

		it('the 2026 national holiday calendar: 13 statutory days, bridging rest days, make-up working days, partial holidays', () => {
			for (const version of VERSIONS) {
				const calendar = (code(version, 'rule_set', 'public_holidays').rules as { holidays: Row[] })
					.holidays;
				const of = (kind: string) => calendar.filter((h) => h.kind === kind).map((h) => h.date);
				assert.deepEqual(of('PUBLIC_HOLIDAY'), [
					'2026-01-01',
					'2026-02-16',
					'2026-02-17',
					'2026-02-18',
					'2026-02-19',
					'2026-04-05',
					'2026-05-01',
					'2026-05-02',
					'2026-06-19',
					'2026-09-25',
					'2026-10-01',
					'2026-10-02',
					'2026-10-03'
				]);
				assert.deepEqual(of('MAKEUP_WORKDAY'), [
					'2026-01-04',
					'2026-02-14',
					'2026-02-28',
					'2026-05-09',
					'2026-09-20',
					'2026-10-10'
				]);
				assert.deepEqual(of('SPECIAL_HOLIDAY'), ['2026-03-08', '2026-08-01']);
				assert.equal(of('SUBSTITUTE').length, 20); // 33 days off − 13 statutory
			}
			// The canonical rule writes each holiday the entity lacks, unpublished.
			const behaviours = settingsOf(V3).behaviours as Behaviours;
			const rule = behaviours.rules.find((item) => item.id === 'write-public-holidays')!;
			const writes = effectWrites(rule, {
				event: {
					row: { id: 'c1', region: 'SH', approval_id: null },
					company_id: 'c1',
					settings_id: settingsOf(V3).id
				},
				calendar: [{ rules: code(V3, 'rule_set', 'public_holidays').rules }],
				held: [{ date: '2026-01-01' }]
			});
			assert.equal(writes.length, 40); // 41 calendar days less the one already held
			assert.equal((writes[0]!.data as Row).date, '2026-01-02');
			// A worked partial holiday is ordinary time: no 300%.
			const womensDay = {
				work: { ...payslipContext.work, days: [day('2026-03-09', 'WORK', 8, 0, 'SPECIAL_HOLIDAY')] }
			};
			assert.equal(work('HOLIDAY_WORK', womensDay), 0);
		});

		it('hours systems drive overtime: standard daily rules, comprehensive cycles, flexible hours', () => {
			const days = payslipContext.work.days;
			// Flexible hours: no overtime or rest-day pay; holiday work 300% only in Shanghai.
			assert.equal(work('OVERTIME', classified('FLEXIBLE')), 0);
			assert.equal(work('REST_DAY_WORK', classified('FLEXIBLE')), 0);
			assert.equal(work('HOLIDAY_WORK', classified('FLEXIBLE')), 8 * 3 * hourly);
			assert.equal(work('HOLIDAY_WORK', classified('FLEXIBLE', 'KM')), 0);
			// Comprehensive hours: no daily overtime or rest-day 200%; holiday 300%; the cycle's excess at 150%.
			assert.equal(work('OVERTIME', classified('COMPREHENSIVE')), 0);
			assert.equal(work('REST_DAY_WORK', classified('COMPREHENSIVE')), 0);
			assert.equal(work('HOLIDAY_WORK', classified('COMPREHENSIVE')), 8 * 3 * hourly);
			const cycle = (months: number, period: Row, hours: Row) =>
				work('COMPREHENSIVE_OVERTIME', {
					...classified('COMPREHENSIVE', 'SH', { comprehensive_cycle_months: months }),
					period: { ...payslipContext.period, ...period },
					hours: { ...payslipContext.hours, ...hours }
				});
			// Monthly: 180 worked, 4 on a public holiday → 176 − 165.33 = 10.67 hours.
			assert.ok(
				Math.abs(cycle(1, {}, { month: HOURS(180, 4) }) - (180 - 4 - 165.33) * 1.5 * hourly) < 1e-6
			);
			// Quarterly: only at a quarter end (March), on the three months' 520 hours.
			assert.ok(
				Math.abs(cycle(3, {}, { rolling: HOURS(520) }) - (520 - 496) * 1.5 * hourly) < 1e-6
			);
			assert.equal(cycle(3, { from: '2026-02-01', to: '2026-02-28' }, { rolling: HOURS(520) }), 0);
			// Yearly: only in December, against 1,984 hours.
			assert.equal(cycle(12, {}, { year: HOURS(2_100) }), 0);
			assert.ok(
				Math.abs(
					cycle(12, { from: '2026-12-01', to: '2026-12-31' }, { year: HOURS(2_100) }) -
						116 * 1.5 * hourly
				) < 1e-6
			);
			assert.equal(work('COMPREHENSIVE_OVERTIME'), 0);
			assert.ok(days.length > 0);
		});

		it('part-month salary, no-pay deduction and partially paid leave on the 21.75 working-day basis', () => {
			const period = (over: Row) => ({ period: { ...payslipContext.period, ...over } });
			// Full month: the whole salary whatever the working days.
			assert.equal(work('BASIC', period({ covered_working_days: 20 })), 20_000);
			// A hire on the 16th of March: 12 working days covered of the plan → 12 / 21.75.
			assert.equal(
				work('BASIC', period({ covered_days: 16, covered_working_days: 12 })),
				(20_000 * 12) / 21.75
			);
			// Without a shift plan: calendar days, 16 / 31.
			assert.equal(
				work('BASIC', period({ covered_days: 16, covered_working_days: 0 })),
				(20_000 * 16) / 31
			);
			// No-pay leave: 2 working days at 20,000 / 21.75.
			assert.equal(work('NO_PAY_LEAVE'), 2 * (20_000 / 21.75));
			// A month whose working days are all unpaid (fund-paid maternity) deducts the whole salary — never more.
			const fundPaid = {
				...period({ covered_working_days: 22, unpaid_working_days: 22 }),
				leave: {
					rows: [
						{
							code: 'MATERNITY_LEAVE',
							activity: 'TIME_OFF',
							days: 22,
							is_npl: true,
							can_encash: false,
							pay_fraction: 1,
							month_index: 2
						}
					]
				}
			};
			assert.equal(work('NO_PAY_LEAVE', fundPaid), 20_000);
			// Without a shift plan the calendar days convert: 30 of 31 days → 30 × 21.75 / 31 daily wages.
			const calendarPaid = {
				...period({ covered_working_days: 0, unpaid_working_days: 0 }),
				leave: {
					rows: [
						{
							code: 'MATERNITY_LEAVE',
							activity: 'TIME_OFF',
							days: 30,
							is_npl: true,
							can_encash: false,
							pay_fraction: 1,
							month_index: 1
						}
					]
				}
			};
			assert.ok(Math.abs(work('NO_PAY_LEAVE', calendarPaid) - (20_000 * 30) / 31) < 1e-6);
			// Work-injury and prenatal check-up days are paid: no deduction.
			const paid = (code_: string) => ({
				leave: {
					rows: [
						{
							code: code_,
							activity: 'TIME_OFF',
							days: 20,
							is_npl: false,
							can_encash: false,
							pay_fraction: 1,
							month_index: 1
						}
					]
				}
			});
			assert.equal(work('NO_PAY_LEAVE', paid('WORK_INJURY_LEAVE')), 0);
			assert.equal(work('SICK_PAY_REDUCTION', paid('PRENATAL_CHECKUP')), 0);
			// Shanghai prenatal leave at 80%: 10 days → 2 days' wage deducted.
			const prenatal = {
				leave: {
					rows: [
						{
							code: 'PRENATAL_LEAVE',
							activity: 'TIME_OFF',
							days: 10,
							is_npl: false,
							can_encash: false,
							pay_fraction: 0.8,
							month_index: 1
						}
					]
				}
			};
			assert.ok(
				Math.abs(work('SICK_PAY_REDUCTION', prenatal) - 10 * 0.2 * (20_000 / 21.75)) < 1e-6
			);
			// Untaken annual leave at the prior 12 months' average excluding overtime: (22,000 − 2,000 + 21,000 − 1,000) / 2.
			const earned = {
				earned: {
					months: [
						{ month: '2026-01', gross: 22_000, OVERTIME: 2_000 },
						{ month: '2026-02', gross: 21_000, HOLIDAY_WORK: 1_000 }
					]
				}
			};
			assert.ok(Math.abs(work('ENCASHMENT', earned) - 3 * 2 * (20_000 / 21.75)) < 1e-6);
			// A fixed allowance prorates like the salary: 500 for 16 of 31 days.
			const allowance = code(V3, 'allowance_catalog', 'FIXED_ALLOWANCE');
			assert.equal(
				evaluateConfigured(String(allowance.amount), {
					...payslipContext,
					...period({ covered_days: 16 }),
					allowance: { amount: 500 }
				}),
				(500 * 16) / 31
			);
			assert.ok((allowance.counts_toward as string[]).includes('IIT'));
			assert.ok((allowance.counts_toward as string[]).includes('PENSION'));
		});

		it('high-temperature allowance: Shanghai 300 a month June–September, Kunming 10 a hot working day', () => {
			const sh = (month: string, exposed: boolean) => ({
				...subject('SH'),
				terms: { ...payslipContext.terms, facts: { high_temperature_exposed: exposed } },
				period: { ...payslipContext.period, from: `2026-${month}-01`, to: `2026-${month}-28` }
			});
			assert.equal(work('HIGH_TEMPERATURE_ALLOWANCE', sh('07', true)), 300);
			assert.equal(work('HIGH_TEMPERATURE_ALLOWANCE', sh('10', true)), 0);
			assert.equal(work('HIGH_TEMPERATURE_ALLOWANCE', sh('07', false)), 0);
			const hot = { ...day('2026-07-02', 'WORK', 8), facts: { high_temperature: true } };
			const km = {
				...subject('KM'),
				work: { ...payslipContext.work, days: [hot, hot, day('2026-07-03', 'WORK', 8)] }
			};
			assert.equal(work('HIGH_TEMPERATURE_ALLOWANCE', km), 20);
			const row = code(V3, 'work_catalog', 'HIGH_TEMPERATURE_ALLOWANCE');
			assert.deepEqual(row.counts_toward, ['UNION_FUND', 'IIT']);
		});

		it('new leave classes: stoppage, social activities, nursing break, Shanghai antenatal and nursing leave, family-planning surgery, parent care', () => {
			const leave = (wanted: string) => code(V3, 'leave_catalog', wanted);
			const fraction = (wanted: string, row: Row, entryFacts: Row = {}, terms: Row = {}) =>
				evaluateConfigured(String(leave(wanted).pay_fraction), {
					...payslipContext,
					terms: { ...payslipContext.terms, ...terms },
					leave: { from: '2026-03-10', days: 5, ...row },
					entry: entry(entryFacts)
				});
			// Stoppage: full pay in the first cycle; then the agreed fraction, never below the minimum wage.
			assert.equal(
				fraction('STOPPAGE_NOT_EMPLOYEE_FAULT', { month_index: 1 }, { agreed_pay_fraction: 0.5 }),
				1
			);
			assert.equal(
				fraction('STOPPAGE_NOT_EMPLOYEE_FAULT', { month_index: 2 }, { agreed_pay_fraction: 0.5 }),
				0.5
			);
			assert.equal(
				fraction(
					'STOPPAGE_NOT_EMPLOYEE_FAULT',
					{ month_index: 2 },
					{ agreed_pay_fraction: 0.5 },
					{ base_salary: 4_000 }
				),
				2_740 / 4_000
			);
			assert.equal(fraction('STOPPAGE_NOT_EMPLOYEE_FAULT', { month_index: 2 }), 1);
			for (const wanted of [
				'SOCIAL_ACTIVITY',
				'NURSING_BREAK',
				'FAMILY_PLANNING_LEAVE',
				'ELDER_CARE_LEAVE',
				'ELDER_CARE_LEAVE',
				'STOPPAGE_NOT_EMPLOYEE_FAULT'
			])
				assert.equal(leave(wanted).is_npl, false, wanted);
			// Kunming's family-planning leave is fund-paid (the salary stops: pay fraction 0); Shanghai's is paid.
			const cityFraction = (wanted: string, region: string) =>
				evaluateConfigured(String(leave(wanted).pay_fraction), {
					...subject(region),
					rules: rulesOf(V3)
				});
			assert.equal(cityFraction('FAMILY_PLANNING_LEAVE', 'KM'), 0);
			assert.equal(cityFraction('FAMILY_PLANNING_LEAVE', 'SH'), 1);
			assert.equal(leave('NURSING_BREAK').unit, 'HOUR');
			assert.equal(cityFraction('PRENATAL_LEAVE', 'SH'), 0.8);
			assert.equal(cityFraction('NURSING_LEAVE', 'SH'), 0.8);
			const female = { ...subject('SH'), entry: entry({}) };
			assert.equal(evaluateConfigured(String(leave('NURSING_BREAK').eligibility), female), true);
			const days = (wanted: string, facts: Row = {}, employee: Row = {}, region = 'SH') =>
				entitlementDays(leave(wanted).entitlement as Parameters<typeof entitlementDays>[0], 130, {
					as_of: '2026-06-30',
					employment,
					company: subject(region).company,
					rules: rulesOf(V3),
					employee: { children: [], facts: {}, ...employee },
					entry: entry({ event_id: 'e1', ...facts }),
					taken_by_class: {}
				});
			assert.equal(days('PRENATAL_LEAVE'), 76);
			assert.equal(days('NURSING_LEAVE'), 198);
			// Kunming grants no antenatal or nursing leave: the class gives 0 days there.
			assert.equal(days('PRENATAL_LEAVE', {}, {}, 'KM'), 0);
			assert.equal(days('NURSING_LEAVE', {}, {}, 'KM'), 0);
			assert.equal(days('FAMILY_PLANNING_LEAVE', { surgery_type: 'TUBAL_LIGATION' }), 30);
			assert.equal(days('FAMILY_PLANNING_LEAVE', { surgery_type: 'VASECTOMY' }), 7);
			assert.equal(days('FAMILY_PLANNING_LEAVE', { surgery_type: 'IUD_INSERTION' }), 2);
			assert.equal(days('FAMILY_PLANNING_LEAVE', { surgery_type: 'IUD_INSERTION' }, {}, 'KM'), 7);
			assert.equal(days('FAMILY_PLANNING_LEAVE', { surgery_type: 'VASECTOMY' }, {}, 'KM'), 15);
			assert.equal(days('FAMILY_PLANNING_LEAVE', { surgery_type: 'UNKNOWN' }, {}, 'KM'), 0);
			assert.equal(days('MARRIAGE_EXTENSION'), 7);
			assert.equal(days('ELDER_CARE_LEAVE'), 5);
			assert.equal(days('ELDER_CARE_LEAVE', {}, { facts: { only_child: true } }), 7);
			assert.equal(days('ELDER_CARE_LEAVE', {}, {}, 'KM'), 10);
			assert.equal(days('ELDER_CARE_LEAVE', {}, { facts: { only_child: true } }, 'KM'), 20);
			// Shanghai childcare leave accumulates by children under 3.
			const kids = {
				children: [{ child_birthdate: '2024-05-01' }, { child_birthdate: '2025-11-01' }]
			};
			assert.equal(days('CHILDCARE_LEAVE', {}, kids), 10);
			// Kunming sick pay above the floor when the employer records it.
			const sick = code(V3, 'leave_catalog', 'SICK_LEAVE');
			assert.equal(
				evaluateConfigured(String(sick.pay_fraction), {
					...payslipContext,
					...subject('KM', { sick_pay_percent: 100 }),
					rules: rulesOf(V3),
					leave: { code: 'SICK_LEAVE', from: '2026-03-10', month_index: 1, days: 1 },
					entry: entry({})
				}),
				1
			);
		});

		it('ad hoc: compensation floors and pre-2008 service, 2N, owed grounds, work-injury subsidy, maternity top-up, arrears penalty', () => {
			const band = (wanted: string, facts: Row, amount = 20_000, over: Row = {}) => {
				const row = code(V3, 'adhoc_catalog', wanted);
				const context = { ...payslipContext, entry: entry(facts, amount), ...over };
				assert.equal(
					evaluateConfigured(String(row.qualifies_when || 'true'), context),
					true,
					wanted
				);
				return evaluateConfigured((row.bands as { amount: string }[])[0]!.amount, context);
			};
			const base = { qualifying_months: 41, local_average_monthly_wage: 12_577 };
			// The base is floored at the minimum wage: a 2,000 average pays as 2,740 (Shanghai, March 2026).
			assert.equal(band('ECONOMIC_COMPENSATION', base, 2_000), 2_740 * 3.5);
			// Pre-2008 service under 劳部发〔1994〕481号: 30 months → 3 years, uncapped by 3×.
			assert.equal(
				band('ECONOMIC_COMPENSATION', { ...base, pre_2008_months: 30 }),
				20_000 * (3.5 + 3)
			);
			assert.equal(
				band('ECONOMIC_COMPENSATION', { ...base, pre_2008_months: 200, pre_2008_capped: true }),
				20_000 * (3.5 + 12)
			);
			// Unlawful termination: twice the compensation.
			assert.equal(band('UNLAWFUL_TERMINATION_COMPENSATION', base), 2 * 20_000 * 3.5);
			// 实施条例 第二十五条: 赔偿金 counts from the start of employment on the 第四十七条 method — 30 pre-2008 months
			// plus 41 = 71 months = 5 years 11 months → 6, not 3.5 + 3 under 481号.
			assert.equal(
				band('UNLAWFUL_TERMINATION_COMPENSATION', { ...base, pre_2008_months: 30 }),
				2 * 20_000 * 6
			);
			// Above 3× the local average the 12-year cap applies to the whole service: 200 + 41 months → 12.
			assert.equal(
				band('UNLAWFUL_TERMINATION_COMPENSATION', { ...base, pre_2008_months: 200 }, 50_000),
				2 * 3 * 12_577 * 12
			);
			// 工伤保险条例 第三十六条: grade 5 → 70%, grade 6 → 60% of the own wage, at least the minimum wage.
			assert.equal(
				band('WORK_INJURY_DISABILITY_ALLOWANCE', { disability_grade: 5, own_wage: 10_000 }, 0),
				7_000
			);
			assert.equal(
				band('WORK_INJURY_DISABILITY_ALLOWANCE', { disability_grade: 6, own_wage: 10_000 }, 0),
				6_000
			);
			assert.equal(
				band('WORK_INJURY_DISABILITY_ALLOWANCE', { disability_grade: 6, own_wage: 3_000 }, 0),
				2_740
			);
			// 第三十六条: the allowance is the pension and medical base (no IIT: 工伤待遇 exempt); a payslip warns until the
			// declared base matches it.
			assert.deepEqual(
				code(V3, 'adhoc_catalog', 'WORK_INJURY_DISABILITY_ALLOWANCE').counts_toward,
				['PENSION', 'MEDICAL', 'MAJOR_MEDICAL']
			);
			const siBase = (declared?: number) =>
				evaluateConfigured(
					String((code(V3, 'rule_set', 'DISABILITY_ALLOWANCE_SI_BASE').rules as Row).when),
					{
						...payslipContext,
						terms: {
							...payslipContext.terms,
							facts: declared === undefined ? {} : { si_contribution_base: declared }
						},
						payslip: {
							gross: 7_000,
							net: 7_000,
							lines: { WORK_INJURY_DISABILITY_ALLOWANCE: 7_000 }
						}
					}
				);
			assert.equal(siBase(), true);
			assert.equal(siBase(20_000), true);
			assert.equal(siBase(7_000), false);
			// Owed grounds only.
			const comp = code(V3, 'adhoc_catalog', 'ECONOMIC_COMPENSATION');
			const owed = (exit_ground: string, exit_facts: Row = {}) =>
				evaluateConfigured(String(comp.eligibility), {
					...payslipContext,
					employment: { ...employment, exit_ground, exit_facts }
				});
			assert.equal(owed('MUTUAL_EMPLOYER_PROPOSED'), true);
			assert.equal(owed('MUTUAL_EMPLOYEE_PROPOSED'), false);
			assert.equal(owed('RESIGNATION'), false);
			assert.equal(owed('CONTRACT_EXPIRY'), true);
			assert.equal(
				owed('CONTRACT_EXPIRY', { employee_refused_renewal_on_equal_terms: true }),
				false
			);
			assert.equal(owed('BANKRUPTCY'), true);
			const lieu = code(V3, 'adhoc_catalog', 'PAY_IN_LIEU_OF_NOTICE');
			assert.equal(
				evaluateConfigured(String(lieu.eligibility), {
					...payslipContext,
					employment: { ...employment, exit_ground: 'INCAPACITY' }
				}),
				true
			);
			assert.deepEqual(lieu.counts_toward, ['IIT.SEPARATION']);
			// Shanghai work-injury subsidy: grade 7 → 12 months of the city average; resigning 3 years before retirement → 60%.
			assert.equal(
				band('WORK_INJURY_DISABILITY_SUBSIDY', {
					disability_grade: 7,
					local_average_monthly_wage: 12_577
				}),
				12 * 12_577
			);
			const nearRetirement = {
				employment: { ...employment, exit_ground: 'RESIGNATION' },
				employee: { ...subject().employee, gender: 'MALE', date_of_birth: '1967-03-15' }
			};
			// Born 1967-03-15: 60 + 7 months (one per 4 from 1965-01) → 2027-10-15; from 2026-03-15 that is 1 completed year → 1 − 0.2 × 4 = 0.2.
			assert.ok(
				Math.abs(
					Number(
						band(
							'WORK_INJURY_DISABILITY_SUBSIDY',
							{ disability_grade: 10, local_average_monthly_wage: 12_577 },
							0,
							nearRetirement
						)
					) -
						3 * 12_577 * 0.2
				) < 0.01
			);
			// Kunming work-injury subsidy (云政发〔2011〕255号 第三十六、三十七条): grade 5 → 33, grade 10 → 7 months of the provincial
			// average; none once retired (第三十八条). One class for every region; a region not in the table has none.
			const kmCompany = { company: { ...payslipContext.company, region: 'KM' } };
			const km = { ...payslipContext, ...kmCompany };
			const injury = code(V3, 'adhoc_catalog', 'WORK_INJURY_DISABILITY_SUBSIDY');
			assert.equal(evaluateConfigured(String(injury.eligibility), km), true);
			const elsewhere = { ...payslipContext, company: { ...payslipContext.company, region: 'XX' } };
			assert.equal(evaluateConfigured(String(injury.eligibility), elsewhere), false);
			const yunnan = { local_average_monthly_wage: 8_000 };
			assert.equal(
				band('WORK_INJURY_DISABILITY_SUBSIDY', { disability_grade: 5, ...yunnan }, 0, kmCompany),
				33 * 8_000
			);
			assert.equal(
				band('WORK_INJURY_DISABILITY_SUBSIDY', { disability_grade: 10, ...yunnan }, 0, kmCompany),
				7 * 8_000
			);
			assert.equal(
				evaluateConfigured(String(injury.qualifies_when), {
					...payslipContext,
					...km,
					employment: { ...employment, exit_ground: 'RETIREMENT' },
					entry: entry({ disability_grade: 7, ...yunnan })
				}),
				false
			);
			// Kunming maternity top-up on the national no-reduction rule: 9,000 ÷ 30 × 158 − 39,500 = 7,900.
			const topup = code(V3, 'adhoc_catalog', 'MATERNITY_TOPUP');
			assert.equal(evaluateConfigured(String(topup.eligibility), km), true);
			assert.equal(evaluateConfigured(String(topup.eligibility), elsewhere), false);
			assert.equal(
				band(
					'MATERNITY_TOPUP',
					{ pre_leave_monthly_wage: 9_000, leave_days: 158, allowance_received: 39_500 },
					0,
					kmCompany
				),
				7_900
			);
			// Shanghai maternity top-up: 15,000 a month ÷ 30 × 158 days − 60,000 allowance.
			assert.equal(
				band(
					'MATERNITY_TOPUP',
					{ pre_leave_monthly_wage: 15_000, leave_days: 158, allowance_received: 60_000 },
					0
				),
				19_000
			);
			assert.equal(
				band(
					'MATERNITY_TOPUP',
					{ pre_leave_monthly_wage: 10_000, leave_days: 158, allowance_received: 60_000 },
					0
				),
				0
			);
			// Arrears penalty at the ordered rate.
			assert.equal(band('WAGE_ARREARS_PENALTY', { penalty_rate: 0.5 }, 10_000), 5_000);
			const arrears = code(V3, 'adhoc_catalog', 'WAGE_ARREARS_PENALTY');
			assert.equal(
				evaluateConfigured(String(arrears.qualifies_when), {
					...payslipContext,
					entry: entry({ penalty_rate: 1.5 })
				}),
				false
			);
			assert.deepEqual(
				code(V3, 'adhoc_catalog', 'MATERNITY_ALLOWANCE_PASSTHROUGH').counts_toward,
				[]
			);
			assert.deepEqual(code(V3, 'adhoc_catalog', 'EQUITY_INCENTIVE').counts_toward, ['IIT.EQUITY']);
			assert.deepEqual(code(V3, 'adhoc_catalog', 'EARLY_RETIREMENT_LUMP_SUM').counts_toward, [
				'IIT.EARLY_RETIREMENT'
			]);
			// Exempt expatriate allowances are still wages for the contribution base (工资总额组成的规定 第四条).
			for (const allowance of [
				'FOREIGN_HOUSING_ALLOWANCE',
				'FOREIGN_LANGUAGE_ALLOWANCE',
				'FOREIGN_CHILD_EDUCATION_ALLOWANCE'
			]) {
				const counts = code(V3, 'allowance_catalog', allowance).counts_toward as string[];
				assert.ok(
					counts.includes('IIT.FOREIGN_ALLOWANCE') &&
						!counts.includes('IIT') &&
						counts.includes('PENSION'),
					allowance
				);
			}
			for (const allowance of [
				'ONLY_CHILD_ALLOWANCE',
				'CHILDCARE_SUBSIDY',
				'TRAVEL_ALLOWANCE',
				'MEAL_SUBSIDY_OUT'
			])
				assert.deepEqual(code(V3, 'allowance_catalog', allowance).counts_toward, [], allowance);
		});

		it('IIT reliefs and separate items: 60,000 rule, first job, interns, pension/health/annuity, all special deductions, equity, early retirement, foreign allowances', () => {
			const iit = code(V3, 'statutory_contribution_catalog', 'IIT').configuration as {
				assessable: Record<string, string>;
				rules: { when: string; employee: string }[];
				refuse_when: { when: string }[];
			};
			const run = (over: Row) => {
				const base = statutoryContext('SH') as Row;
				const context = { ...base, ...over } as Row;
				const parts = Object.fromEntries(
					Object.entries(iit.assessable).map(([part, expression]) => [
						part,
						evaluateConfigured(expression, context)
					])
				) as Record<string, number>;
				const ruled = {
					...context,
					base: { ...PARTS, ...parts, ...(over.base as Row | undefined) }
				};
				const rule = iit.rules.find((item) => evaluateConfigured(item.when, ruled) === true)!;
				return {
					parts,
					tax: Number(evaluateConfigured(rule.employee, ruled)),
					refused: iit.refuse_when.some((g) => evaluateConfigured(g.when, ruled) === true)
				};
			};
			const elect = (elections: Row, extra: Row = {}) => ({
				scheme: { code: 'IIT', standing: 'REGISTERED', since: '2025-01-01', elections },
				...extra
			});
			const jan = {
				key: '2026-01',
				from: '2026-01-01',
				to: '2026-01-31',
				days: 31,
				month: 1,
				salary_paid: false,
				covered_days: 31,
				working_days: 22,
				covered_working_days: 22,
				unpaid_working_days: 0,
				parts: 1,
				part: 1,
				pay_date: ''
			};
			const deductions = (over: Row) => run(over).parts.deductions;
			const SI = 1_600 + 400 + 100 + 1_400; // 20,000 base: pension, medical, unemployment, HPF 7%
			// Standard: 5,000 + contributions + no special deduction.
			assert.equal(deductions(elect({})), 5_000 + SI);
			// 公告2020年第19号: 60,000 in January, nothing in later months.
			assert.equal(deductions(elect({ prior_year_60000: true }, { period: jan })), 60_000 + SI);
			assert.equal(deductions(elect({ prior_year_60000: true })), SI);
			// 公告2020年第13号: hired in March, first job of the year → January and February too.
			assert.equal(
				deductions(
					elect(
						{ first_job_in_year: true },
						{ employment: { ...employment, start_date: '2026-03-10' } }
					)
				),
				15_000 + SI
			);
			// Personal pension (capped by the year's running total), health 200, annuity ≤4%.
			assert.equal(deductions(elect({ personal_pension_monthly: 1_000 })), 6_000 + SI);
			assert.equal(deductions(elect({ personal_pension_monthly: 6_000 })), 5_000 + SI); // 12,000 − 2 × 6,000 = 0 left in March
			assert.equal(deductions(elect({ commercial_health_monthly: 300 })), 5_200 + SI);
			assert.equal(deductions(elect({ annuity_employee_monthly: 1_000 })), 5_800 + SI);
			// Every special deduction: children 2 × 2,000 split 50%, infant 2,000, degree 400, loan 1,000, elderly share 1,500 cap.
			const all = {
				children_education_children: 2,
				children_education_split: true,
				infant_care_children: 1,
				continuing_education_degree: true,
				housing_loan_interest: true,
				elderly_support_monthly: 2_000
			};
			assert.equal(deductions(elect(all)), 5_000 + SI + 2_000 + 2_000 + 400 + 1_000 + 1_500);
			assert.equal(deductions(elect({ elderly_support_only_child: true })), 5_000 + SI + 3_000);
			assert.equal(run(elect({ housing_loan_interest: true, housing_rent: true })).refused, true);
			// The foreign-allowance exemption replaces special deductions.
			assert.equal(deductions(elect({ ...all, foreign_allowance_exemption: true })), 5_000 + SI);
			const fa = (elections: Row) =>
				run({
					...elect(elections),
					month: { ...(statutoryContext('SH').month as Row), foreign_allowance: 5_000 }
				}).parts.foreign_allowance;
			assert.equal(fa({}), 5_000);
			assert.equal(fa({ foreign_allowance_exemption: true }), 0);
			// An intern's pay is 80% income: 3,000 → 2,400 − 5,000 → no tax.
			const intern = {
				terms: {
					...payslipContext.terms,
					employment_type: 'INTERN',
					base_salary: 3_000,
					monthly_wage: 3_000
				},
				month: { ...PARTS, ordinary: 3_000, bonus: 0, deductions: 0 }
			};
			assert.equal(run({ ...elect({}), ...intern }).tax, 0);
			assert.equal(run({ ...elect({}), ...intern }).parts.deductions, 5_000);
			// A resident's cumulative tax never refunds: a year withheld 1,000 against a cumulative of 0 → 0.
			assert.equal(
				run({
					...elect({}),
					month: { ...PARTS, ordinary: 0, bonus: 0, deductions: 0 },
					charged: {
						year: { IIT: { employee: 1_000, employer: 0 } },
						month: { IIT: { employee: 0, employer: 0 } }
					}
				}).tax,
				0
			);
			// A second annual bonus in the year (one already taxed separately) merges into the cumulative.
			const second = run({
				...elect({ annual_bonus_separate: true }),
				month: { ...PARTS, ordinary: 20_000, bonus: 10_000, deductions: 0 },
				year: { ...PARTS, ordinary: 0, bonus: 50_000, deductions: 0 }
			});
			assert.equal(second.parts.bonus, 0);
			assert.equal(second.parts.ordinary, 30_000);
			// Equity: cumulative on the annual table, separate from wages: 100,000 → 1,080 + 64,000 × 10% = 7,480.
			const quiet = { month: { ...PARTS, ordinary: 0, bonus: 0, deductions: 0 } };
			assert.equal(
				run({ ...elect({}), ...quiet, base: { ordinary: 0, deductions: 0, equity: 100_000 } }).tax,
				7_480
			);
			// Early retirement (财税〔2018〕164号): born 1970-01 → 60 + 16 months = 2031-05-01; 62 months from March 2026 → 6 years.
			// 200,000 / 6 < 60,000 → 0; 900,000 / 6 − 60,000 = 90,000 → 1,080 + 5,400 = 6,480 a year × 6.
			const early = {
				employee: { ...subject().employee, gender: 'MALE', date_of_birth: '1970-01-01' }
			};
			assert.equal(
				run({
					...elect({}),
					...quiet,
					...early,
					base: { ordinary: 0, deductions: 0, early_retirement: 200_000 }
				}).tax,
				0
			);
			assert.equal(
				run({
					...elect({}),
					...quiet,
					...early,
					base: { ordinary: 0, deductions: 0, early_retirement: 900_000 }
				}).tax,
				6_480 * 6
			);
			// 内退 (财税〔2018〕164号 五(三); 浙江省税务局 百问百答 问21): born 1967-04-01 → retires 2027-11-01, 20 months from
			// March 2026. 100,000 ÷ 20 + 7,000 − 5,000 = 7,000 → 10% − 210: 102,000 × 10% − 210 = 9,990, less the wage's own
			// 60 → 9,930 on top of the cumulative wage tax.
			const internal = (lump: number) =>
				run({
					...elect({}),
					employee: { ...subject().employee, gender: 'MALE', date_of_birth: '1967-04-01' },
					base: { ordinary: 7_000, deductions: 5_000, internal_retirement: lump }
				}).tax;
			assert.equal(internal(100_000) - internal(0), 9_930);
			assert.deepEqual(code(V3, 'adhoc_catalog', 'INTERNAL_RETIREMENT_LUMP_SUM').counts_toward, [
				'IIT.INTERNAL_RETIREMENT'
			]);
			// A resident without domicile (公告2019年第35号 二(二), 公式三): only wages paid from abroad for work abroad drop
			// out, within the first six consecutive years. Fully paid by the PRC entity: no reduction.
			const resident = (facts: Row) =>
				run({
					...elect({}),
					employee: { ...subject().employee, facts: { non_domiciled_resident: true, ...facts } }
				}).tax;
			const full = run(elect({})).tax;
			assert.equal(resident({ china_workday_share: 0.5 }), full);
			// Half paid abroad, half the days abroad: 1 − 0.5 × 0.5 = 75% of the wage taxed — the same as a 15,000 wage.
			const quarterOff = resident({ china_workday_share: 0.5, offshore_paid_share: 0.5 });
			assert.ok(quarterOff < full);
			assert.equal(
				quarterOff,
				run({
					...elect({}),
					month: { ...(statutoryContext('SH').month as Row), ordinary: 15_000 },
					wage: { ...(statutoryContext('SH').wage as Row), ordinary: 15_000 }
				}).tax
			);
			// From the 7th consecutive year everything is taxed.
			assert.equal(
				resident({
					china_workday_share: 0.5,
					offshore_paid_share: 0.5,
					consecutive_resident_years: 6
				}),
				full
			);
		});

		it('obligations and tasks of round 7: owed-ground compensation, union notice, registration and exit dates', () => {
			const settings = settingsOf(V3);
			const behaviours = settings.behaviours as Behaviours;
			const rows = dutiesOf(file(V3, 'rule_set'));
			const raise = (collection: string, event: string, row: Row) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows: [...rows, ...file(V3, 'rule_set').filter((row) => row.family === 'PAYROLL')],
					collection,
					event,
					row,
					reads: {
						payroll: [regionsOf(V3)],
						company: [{ region: 'SH', facts: {} }],
						catalogues: [],
						movements: []
					}
				});
			const due = (writes: Row[], duty: string) =>
				writes.find((write) => write.duty_code === duty)?.due_on;
			const contract = {
				id: 'k9',
				company_id: 'c1',
				approval_id: null,
				effective_range: { from: '2026-03-02', to: null },
				exit_facts: null
			};
			const hired = raise('employment_contract', 'created', contract);
			assert.equal(due(hired, 'HPF_DEPOSIT_REGISTRATION'), '2026-04-01');
			assert.equal(due(hired, 'EMPLOYEE_ROSTER'), '2026-03-02');
			const exit = (exit_ground: string, exit_facts: Row = {}) =>
				raise('employment_contract', 'updated', {
					...contract,
					exit_ground,
					exit_facts,
					effective_range: { from: '2026-03-02', to: '2026-06-30' }
				});
			const resign = exit('RESIGNATION');
			assert.equal(due(resign, 'TERMINATION_CERTIFICATE'), '2026-06-30');
			assert.equal(due(resign, 'HPF_CHANGE_REGISTRATION'), '2026-07-30');
			assert.equal(due(resign, 'UNION_NOTICE_UNILATERAL'), undefined);
			assert.equal(due(exit('EMPLOYER_FAULT_DISMISSAL'), 'UNION_NOTICE_UNILATERAL'), '2026-06-30');
			assert.equal(due(exit('INCAPACITY'), 'UNION_NOTICE_UNILATERAL'), '2026-06-30');
			assert.equal(
				due(exit('MUTUAL_EMPLOYEE_PROPOSED'), 'ECONOMIC_COMPENSATION_PAYMENT'),
				undefined
			);
			assert.equal(
				due(exit('MUTUAL_EMPLOYER_PROPOSED'), 'ECONOMIC_COMPENSATION_PAYMENT'),
				'2026-06-30'
			);
			assert.equal(due(exit('CONTRACT_EXPIRY'), 'ECONOMIC_COMPENSATION_PAYMENT'), '2026-06-30');
			assert.equal(
				due(
					exit('CONTRACT_EXPIRY', { employee_refused_renewal_on_equal_terms: true }),
					'ECONOMIC_COMPENSATION_PAYMENT'
				),
				undefined
			);
			assert.equal(due(exit('CLOSURE'), 'ECONOMIC_COMPENSATION_PAYMENT'), '2026-06-30');
			// The exit grounds are a PAYROLL record; a bare MUTUAL is not one of them (who proposed it decides).
			const grounds = file(V3, 'rule_set').find((row) => row.code === 'exit_grounds')!.rules as {
				kinds: { code: string }[];
			};
			assert.equal(
				grounds.kinds.some((kind) => kind.code === 'MUTUAL'),
				false
			);
		});
	});

	it('re-verification fixes: overtime base, data protection, foreign and juvenile workers, open-ended contracts, probation, surcharge, disabled fund, retention', () => {
		for (const version of VERSIONS) {
			// 上海市企业工资支付办法 第九条: the post's normal monthly wage with its fixed allowances, at least the minimum wage.
			const overtime = code(version, 'work_catalog', 'OVERTIME');
			const rate = (region: string, base: number, allowances: Row[] = []) =>
				Number(
					evaluateConfigured(String(overtime.rate), {
						...payslipContext,
						rules: rulesOf(version),
						company: { ...payslipContext.company, region },
						terms: { ...payslipContext.terms, base_salary: base, allowances }
					})
				);
			const fixed = [
				{ code: 'FIXED_ALLOWANCE', amount: 2_000 },
				{ code: 'MEAL_SUBSIDY_OUT', amount: 500 }
			];
			assert.ok(Math.abs(rate('SH', 20_000, fixed) - (1.5 * 22_000) / 21.75 / 8) < 1e-9, version);
			assert.ok(Math.abs(rate('SH', 2_000) - (1.5 * 2_740) / 21.75 / 8) < 1e-9, version);
			assert.ok(Math.abs(rate('KM', 2_000, fixed) - (1.5 * 4_000) / 21.75 / 8) < 1e-9, version);
			// Sick-pay and antenatal deductions use the same base: 20,000 + 2,000 fixed allowance ÷ 21.75.
			const sick = code(version, 'work_catalog', 'SICK_PAY_REDUCTION');
			assert.ok(
				Math.abs(
					Number(
						evaluateConfigured(String(sick.rate), {
							...payslipContext,
							rules: rulesOf(version),
							terms: { ...payslipContext.terms, base_salary: 20_000, allowances: fixed }
						})
					) -
						22_000 / 21.75
				) < 1e-9,
				version
			);

			const settings = settingsOf(version);
			const behaviours = settings.behaviours as Behaviours;
			const rows = dutiesOf(file(version, 'rule_set'));
			const raise = (collection: string, event: string, row: Row, reads: Row = {}, day?: string) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows: [...rows, ...file(version, 'rule_set').filter((row) => row.family === 'PAYROLL')],
					collection,
					event,
					row,
					...(day ? { day } : {}),
					reads: {
						payroll: [regionsOf(version)],
						company: [{ region: 'SH', risk_class: '1', facts: { hpf_rate_percent: 7 } }],
						employee: [
							{ nationality: 'CN', gender: 'FEMALE', date_of_birth: '1990-01-01', facts: {} }
						],
						...reads
					}
				});
			const due = (writes: Row[], duty: string) =>
				writes.find((write) => write.duty_code === duty)?.due_on;
			const contract = {
				id: 'k1',
				company_id: 'c1',
				approval_id: null,
				effective_range: { from: '2016-03-02', to: '2026-09-30' },
				exit_facts: null,
				facts: { contract_terms: [] }
			};
			const exited = { ...contract, exit_ground: 'RESIGNATION', exit_facts: {} };
			const person = (over: Row) => ({
				employee: [
					{ nationality: 'CN', gender: 'MALE', date_of_birth: '1990-01-01', facts: {}, ...over }
				]
			});
			// 外国人在中国就业管理规定 第二十条: the work permit and residence document returned at the exit.
			assert.equal(
				due(
					raise('employment_contract', 'updated', exited, person({ nationality: 'DE' })),
					'WORK_PERMIT_CANCELLATION'
				),
				'2026-09-30'
			);
			assert.equal(
				due(raise('employment_contract', 'updated', exited), 'WORK_PERMIT_CANCELLATION'),
				undefined
			);
			// 未成年工特殊保护规定 第九条: a 17-year-old hire is registered; a 19-year-old is not.
			const hire = { ...contract, effective_range: { from: '2026-03-02', to: null } };
			assert.equal(
				due(
					raise('employment_contract', 'created', hire, person({ date_of_birth: '2009-01-01' })),
					'JUVENILE_WORKER_REGISTRATION'
				),
				'2026-03-02'
			);
			assert.equal(
				due(
					raise('employment_contract', 'created', hire, person({ date_of_birth: '2007-01-01' })),
					'JUVENILE_WORKER_REGISTRATION'
				),
				undefined
			);
			// 第六条(二): the check after a year of work, while still under 18.
			const tick = (row: Row, day: string, over: Row = {}) =>
				raise('calendar', 'daily', { ...row, employee_id: 'p1' }, person(over), day);
			assert.equal(
				due(
					tick(hire, '2027-03-02', { date_of_birth: '2009-06-01' }),
					'JUVENILE_WORKER_ANNUAL_CHECK'
				),
				'2027-03-02'
			);
			assert.equal(due(tick(hire, '2027-03-02'), 'JUVENILE_WORKER_ANNUAL_CHECK'), undefined);
			// 劳动合同法 第十四条: ten years on a fixed-term contract.
			assert.equal(due(tick(contract, '2026-03-02'), 'OPEN_ENDED_CONTRACT_RIGHT'), '2026-03-02');
			assert.equal(due(tick(contract, '2026-03-03'), 'OPEN_ENDED_CONTRACT_RIGHT'), undefined);
			// 劳动合同法 第十九条第二款 and 第十四条第二款: contract refusals over the employment's terms and the person's contracts.
			const refuses = (
				wanted: string,
				term: Row,
				extra: { terms?: Row[]; contracts?: Row[]; service?: number } = {}
			) => {
				const check = file(version, 'rule_set').find((row) => row.code === wanted)!;
				assert.equal((check.rules as Row).site, 'contract');
				assert.equal((check.rules as Row).kind, 'refuse');
				const written = {
					...payslipContext.terms,
					employment_type: 'FIXED_TERM',
					effective_from: '2026-07-01',
					effective_to: '2027-06-30',
					facts: {},
					...term
				};
				return evaluateConfigured(String((check.rules as Row).when), {
					...payslipContext,
					terms: written,
					term: written,
					day: written.effective_from,
					employment: {
						...employment,
						start_date: '2026-07-01',
						service_months: extra.service ?? 0,
						terms: extra.terms ?? []
					},
					person: { ...payslipContext.person, contracts: extra.contracts ?? [] }
				});
			};
			const probationTerm = { facts: { probation: true }, effective_to: '2026-08-31' };
			assert.equal(refuses('PROBATION_ONCE', probationTerm), false);
			// A second probation in the same employment is refused; one continued by an adjoining term is the same probation.
			const earlierProbation = (from: string, to: string) => ({
				facts: { probation: true },
				effective_range: { from, to }
			});
			assert.equal(
				refuses('PROBATION_ONCE', probationTerm, {
					terms: [earlierProbation('2025-01-01', '2025-02-28')]
				}),
				true
			);
			assert.equal(
				refuses('PROBATION_ONCE', probationTerm, {
					terms: [earlierProbation('2026-06-01', '2026-06-30')]
				}),
				false
			);
			// An earlier contract with this employer that had a probation.
			const earlier = (
				start: string,
				end: string,
				contract_type = 'FIXED_TERM',
				facts: Row = {}
			) => ({
				id: `c-${start}`,
				start,
				end,
				exit_ground: 'CONTRACT_EXPIRY',
				contract_type,
				facts
			});
			assert.equal(
				refuses('PROBATION_ONCE', probationTerm, {
					contracts: [earlier('2025-07-01', '2026-06-30', 'FIXED_TERM', { probation: true })]
				}),
				true
			);
			// A probation in an earlier contract's first term, its last term without one: still refused.
			assert.equal(
				refuses('PROBATION_ONCE', probationTerm, {
					contracts: [
						{
							...earlier('2025-07-01', '2026-06-30'),
							terms: [
								{
									from: '2025-07-01',
									to: '2025-08-31',
									contract_type: 'FIXED_TERM',
									facts: { probation: true }
								},
								{ from: '2025-09-01', to: '2026-06-30', contract_type: 'FIXED_TERM', facts: {} }
							]
						}
					]
				}),
				true
			);
			assert.equal(
				refuses(
					'PROBATION_ONCE',
					{ facts: {} },
					{ terms: [earlierProbation('2025-01-01', '2025-02-28')] }
				),
				false
			);
			// Two consecutive fixed terms before this one: a third fixed term is refused, unless the employee asked for it.
			const twoFixed = [earlier('2024-07-01', '2025-06-30'), earlier('2025-07-01', '2026-06-30')];
			assert.equal(refuses('OPEN_ENDED_REQUIRED', {}, { contracts: twoFixed }), true);
			assert.equal(
				refuses(
					'OPEN_ENDED_REQUIRED',
					{ facts: { employee_requested_fixed_term: true } },
					{ contracts: twoFixed }
				),
				false
			);
			assert.equal(
				refuses(
					'OPEN_ENDED_REQUIRED',
					{ employment_type: 'PERMANENT', effective_to: '' },
					{ contracts: twoFixed }
				),
				false
			);
			// Not consecutive (a gap), or only one earlier fixed term: no right yet.
			assert.equal(
				refuses(
					'OPEN_ENDED_REQUIRED',
					{},
					{ contracts: [earlier('2024-07-01', '2025-05-31'), earlier('2025-07-01', '2026-06-30')] }
				),
				false
			);
			assert.equal(
				refuses('OPEN_ENDED_REQUIRED', {}, { contracts: [earlier('2025-07-01', '2026-06-30')] }),
				false
			);
			// Ten years of continuous service (第(一)项).
			assert.equal(refuses('OPEN_ENDED_REQUIRED', {}, { service: 120 }), true);
			// A later term of the same contract (a pay change) is not a renewal.
			assert.equal(
				refuses('OPEN_ENDED_REQUIRED', { effective_from: '2026-09-01' }, { contracts: twoFixed }),
				false
			);
			// 社会保险法 第八十六条: the remittance settled late raises the surcharge task.
			const settled = (fulfilled_on: string) =>
				raise('obligation', 'updated', {
					id: 'o1',
					company_id: 'c1',
					approval_id: null,
					duty_code: 'SI_MONTHLY_PAYMENT',
					due_on: '2026-04-15',
					fulfilled_on,
					occurred_on: fulfilled_on
				});
			assert.equal(due(settled('2026-04-20'), 'SI_LATE_SURCHARGE'), '2026-04-20');
			assert.equal(due(settled('2026-04-15'), 'SI_LATE_SURCHARGE'), undefined);
			// 个人信息保护法 第二十九条: a sick-leave record carries health data.
			const leave = (catalog_code: string) =>
				raise('leave_catalog_entry', 'created', {
					id: 'l1',
					company_id: 'c1',
					employment_id: 'k1',
					approval_id: null,
					catalog_code,
					occurred_on: '2026-03-10'
				});
			assert.equal(due(leave('SICK_LEAVE'), 'SENSITIVE_PI_CONSENT_MEDICAL'), '2026-03-10');
			assert.equal(due(leave('ANNUAL_LEAVE'), 'SENSITIVE_PI_CONSENT_MEDICAL'), undefined);
			// 促进和规范数据跨境流动规定 第五条(二), 个人信息保护法 第三十九条: notice and consent for an HR transfer abroad.
			const abroad = (facts: Row) =>
				raise(
					'entity',
					'updated',
					{ id: 'c1', approval_id: null, occurred_on: '2026-04-02', before: { facts: {} } },
					{ company: [{ region: 'SH', risk_class: '1', facts }] }
				);
			assert.equal(
				due(abroad({ transfers_hr_data_abroad: true }), 'CROSS_BORDER_HR_TRANSFER'),
				'2026-04-02'
			);
			assert.equal(due(abroad({}), 'CROSS_BORDER_HR_TRANSFER'), undefined);
			// 个人信息保护法 第五十四条 and the payroll vouchers kept 30 years from the year end, each December.
			const december = raise('payroll_run', 'created', {
				id: 'r12',
				company_id: 'c1',
				period: '2026-12',
				approval_id: null
			});
			assert.equal(due(december, 'PI_COMPLIANCE_AUDIT'), '2026-12-31');
			assert.equal(due(december, 'ACCOUNTING_VOUCHER_RETENTION'), '2056-12-31');
			// 残疾人就业保障金 (财税〔2015〕72号; 财政部公告2023年第98号), Shanghai in October:
			// 200 × 1.5% − 1 = 2 short × 150,000 (under 2 × 140,000) × 90% (ratio 0.5%) = 270,000; at 1% the half rate.
			const fund = (disabled: number, headcount = 200) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r10', company_id: 'c1', period: '2026-10', approval_id: null },
					{
						company: [
							{
								region: 'SH',
								risk_class: '1',
								facts: {
									hpf_rate_percent: 7,
									prior_year_average_headcount: headcount,
									prior_year_disabled_employees: disabled,
									prior_year_average_wage: 150_000,
									local_average_annual_wage: 140_000
								}
							}
						]
					}
				).find((write) => write.duty_code === 'DISABLED_EMPLOYMENT_FUND_PAYMENT');
			assert.equal(fund(1)?.amount_due, 270_000);
			assert.equal(fund(2)?.amount_due, 75_000);
			assert.equal(fund(0, 30), undefined);

			// Retention per record type: personal data to the end of the 10th year after the exit year.
			const retention = file(version, 'rule_set').find((row) => row.code === 'record_retention')!;
			assert.equal(
				evaluateConfigured(String((retention.rules as Row).until), {
					...payslipContext,
					employment: { ...employment, exit_date: '2026-03-31' }
				}),
				'2036-12-31'
			);
		}
	});

	it('round 10 records: work suspensions, personal-data retention, the IIT withholding return', () => {
		for (const version of VERSIONS) {
			// Work suspensions (工资支付暂行规定 第十二条; 人社厅明电〔2020〕5号).
			const kinds = file(version, 'suspension_kind');
			assert.deepEqual(
				kinds.map((row) => row.code),
				['STOPPAGE_EMPLOYER', 'FORCE_MAJEURE', 'GOVERNMENT_ORDER', 'EMPLOYEE_CAUSED']
			);
			const daily = 20_000 / 21.75;
			const effect = (
				kind: string,
				date: string,
				worked: boolean,
				facts: Row = {},
				from = '2026-03-10'
			) => {
				const row = kinds.find((item) => item.code === kind)!;
				assert.match(String(row.authority), /第十二条|第五十条/);
				const context = {
					...payslipContext,
					day: { date, worked, day_type: 'WORK' },
					suspension: { kind, from, to: '2026-06-30', facts, working_days_elapsed: 1 }
				};
				return {
					attended: evaluateConfigured(String(row.counts_as_attended), context),
					pay: Number(evaluateConfigured(String(row.pay), context))
				};
			};
			for (const kind of ['STOPPAGE_EMPLOYER', 'FORCE_MAJEURE', 'GOVERNMENT_ORDER']) {
				// The first cycle (a month from the suspension's first day) pays the contract wage; the day counts as attended.
				assert.deepEqual(effect(kind, '2026-04-09', false), { attended: true, pay: daily });
				// After it: a day worked pays the new agreement, at least the Shanghai minimum wage (2,740 ÷ 21.75) …
				assert.equal(effect(kind, '2026-04-10', true, { agreed_daily_pay: 50 }).pay, 2_740 / 21.75);
				assert.equal(effect(kind, '2026-04-10', true, { agreed_daily_pay: 500 }).pay, 500);
				// … a day not worked pays the living allowance by the employer's rules or contract (云南人社厅 政策解答 四),
				// not the new wage for days worked; no statutory amount, so nothing unless recorded.
				assert.equal(effect(kind, '2026-04-10', false).pay, 0);
				assert.equal(effect(kind, '2026-04-10', false, { agreed_daily_pay: 500 }).pay, 0);
				assert.equal(effect(kind, '2026-04-10', false, { living_allowance_daily: 80 }).pay, 80);
				// WORK-22: an unworked later-cycle day without a recorded living allowance warns (a data gap, not a lawful 0).
				const allowanceCheck = file(version, 'rule_set').find(
					(row) => row.code === 'LIVING_ALLOWANCE_NOT_RECORDED'
				)!;
				const stoppageDay = (date: string, facts: Row) => ({
					...payslipContext,
					work: {
						...payslipContext.work,
						days: [
							{
								...day(date, 'WORK', 0),
								suspended: {
									kind,
									from: '2026-03-10',
									to: '2026-06-30',
									facts,
									counts_as_attended: true,
									scheduled: true,
									pay: 0
								}
							}
						]
					}
				});
				assert.equal(
					evaluateConfigured(
						String((allowanceCheck.rules as Row).when),
						stoppageDay('2026-04-10', {})
					),
					true
				);
				assert.equal(
					evaluateConfigured(
						String((allowanceCheck.rules as Row).when),
						stoppageDay('2026-04-10', { living_allowance_daily: 80 })
					),
					false
				);
				assert.equal(
					evaluateConfigured(
						String((allowanceCheck.rules as Row).when),
						stoppageDay('2026-04-09', {})
					),
					false
				);
				assert.match(
					String(kinds.find((item) => item.code === kind)!.authority),
					/企业规章制度规定或者集体合同、劳动合同约定的标准发放生活费/
				);
				// The cycle runs across pay periods: a suspension from 20 March still pays in full on 15 April.
				assert.equal(effect(kind, '2026-04-15', false, {}, '2026-03-20').pay, daily);
			}
			assert.deepEqual(effect('EMPLOYEE_CAUSED', '2026-04-09', false), { attended: false, pay: 0 });
			// The work line deducts each suspended WORK day's shortfall against the daily wage.
			const reduction = code(version, 'work_catalog', 'SUSPENSION_PAY_REDUCTION');
			const suspendedDay = (date: string, pay: number) => ({
				...day(date, 'WORK', 0),
				suspended: {
					kind: 'STOPPAGE_EMPLOYER',
					facts: {},
					counts_as_attended: true,
					scheduled: true,
					pay
				}
			});
			const withDays = {
				...payslipContext,
				work: {
					...payslipContext.work,
					days: [
						suspendedDay('2026-04-13', 0),
						suspendedDay('2026-04-14', daily),
						day('2026-04-15', 'WORK', 8)
					]
				}
			};
			assert.equal(evaluateConfigured(String(reduction.eligibility), withDays), true);
			assert.ok(
				Math.abs(Number(evaluateConfigured(String(reduction.rate), withDays)) - daily) < 1e-9
			);
			assert.equal(evaluateConfigured(String(reduction.eligibility), payslipContext), false);

			// Personal-data retention: 30 years after the exit (会计档案管理办法 第十四条 and 附表; 个人信息保护法 第四十七条).
			const retention = file(version, 'rule_set').find((row) => row.code === 'record_retention')!;
			assert.equal(retention.family, 'PAYROLL');
			assert.equal(
				evaluateConfigured(String((retention.rules as Row).until), {
					...payslipContext,
					employment: { ...employment, exit_date: '2026-06-30' }
				}),
				'2036-12-31'
			);

			// The IIT withholding return (公告2019年第7号 附件2): its 40 columns, and one employee over two months.
			const returns = file(version, 'rule_set').filter((row) => row.family === 'EXPORTS');
			assert.deepEqual(
				returns.map((row) => row.code),
				['IIT_WITHHOLDING_RETURN']
			);
			const slip = (period: string, iit: number) => ({
				period,
				status: 'PAID',
				gross: 20_000,
				net: 20_000 - 4_100 - iit,
				total_deductions: 4_100 + iit,
				lines: { BASIC: 20_000 },
				statutory: {
					PENSION: { employee: 1_600, employer: 3_200, base: 20_000 },
					MEDICAL: { employee: 400, employer: 1_800, base: 20_000 },
					UNEMPLOYMENT: { employee: 100, employer: 100, base: 20_000 },
					HPF: { employee: 1_400, employer: 1_400, base: 20_000 },
					HPF_SUPPLEMENTARY: { employee: 600, employer: 600, base: 20_000 },
					IIT: { employee: iit, employer: 0, base: 20_000 }
				}
			});
			const [document] = recordDocuments(
				returns as { code: string; rules: unknown }[],
				[{ period: '2026-01' }, { period: '2026-02' }],
				[
					{
						employee: { name: '李雷', identity_number: '310101199001010011', nationality: 'CN' },
						contract: { facts: { contract_terms: [{ residency_status: 'RESIDENT' }] } },
						slips: [slip('2026-01', 297), slip('2026-02', 297)]
					}
				] as Parameters<typeof recordDocuments>[2]
			);
			// 公告2020年第19号: an employee elected to the 60,000 rule deducts 60,000 in January (columns 11 and 23).
			const [elected] = recordDocuments(
				returns as { code: string; rules: unknown }[],
				[{ period: '2026-01' }],
				[
					{
						employee: {
							name: '韩梅梅',
							identity_number: '310101199202020022',
							nationality: 'CN',
							facts: {
								employment_statutory_facts: [{ status: { elections: { prior_year_60000: true } } }]
							}
						},
						contract: { facts: { contract_terms: [{ residency_status: 'RESIDENT' }] } },
						slips: [slip('2026-01', 0)]
					}
				] as Parameters<typeof recordDocuments>[2]
			);
			const cells = elected!.content.split('\n')[1]!.split(',');
			assert.deepEqual([cells[10], cells[22]], ['60000', '60000']);
			assert.equal(document?.name, '个人所得税扣缴申报表-2026-02.csv');
			const [header, row] = document!.content.split('\n');
			assert.equal(
				header,
				'序号,姓名,身份证件类型,身份证件号码,纳税人识别号,是否为非居民个人,所得项目,收入,费用,免税收入,减除费用,基本养老保险费,基本医疗保险费,失业保险费,住房公积金,年金,商业健康保险,税延养老保险,财产原值,允许扣除的税费,其他,累计收入额,累计减除费用,累计专项扣除,子女教育,赡养老人,住房贷款利息,住房租金,继续教育,累计其他扣除,减按计税比例,准予扣除的捐赠额,应纳税所得额,税率/预扣率,速算扣除数,应纳税额,减免税额,已缴税额,应补/退税额,备注'
			);
			assert.equal(
				row,
				'1,李雷,居民身份证,310101199001010011,310101199001010011,否,正常工资薪金,20000,,,5000,1600,400,100,2000,,,,,,,40000,10000,8200,,,,,,,,,,,,594,,297,297,'
			);
		}
	});

	it('home-visit leave (探亲假) and its fares for state-owned units; the Kunming union preparatory fund', () => {
		for (const version of VERSIONS) {
			const leave = (wanted: string) => code(version, 'leave_catalog', wanted);
			const eligible = (wanted: string, facts: Row, marital: string) => {
				const context = subject('SH', facts);
				return evaluateConfigured(String(leave(wanted).eligibility), {
					...context,
					employee: { ...context.employee, marital_status: marital },
					entry: entry({})
				});
			};
			const so = { state_owned: true };
			// 第二条: state-owned units only; spouse visits for the married, parent visits split by marital status.
			assert.equal(eligible('HOME_LEAVE_SPOUSE', so, 'MARRIED'), true, version);
			assert.equal(eligible('HOME_LEAVE_SPOUSE', {}, 'MARRIED'), false);
			assert.equal(eligible('HOME_LEAVE_SPOUSE', so, 'SINGLE'), false);
			assert.equal(eligible('HOME_LEAVE_PARENTS', so, 'SINGLE'), true);
			assert.equal(eligible('HOME_LEAVE_PARENTS', so, 'MARRIED'), false);
			assert.equal(eligible('HOME_LEAVE_PARENTS_BIENNIAL', so, 'SINGLE'), true);
			assert.equal(eligible('HOME_LEAVE_PARENTS_MARRIED', so, 'MARRIED'), true);
			assert.equal(eligible('HOME_LEAVE_PARENTS_MARRIED', so, 'SINGLE'), false);
			for (const wanted of [
				'HOME_LEAVE_SPOUSE',
				'HOME_LEAVE_PARENTS',
				'HOME_LEAVE_PARENTS_BIENNIAL',
				'HOME_LEAVE_PARENTS_MARRIED'
			]) {
				// 第三条: rest days and holidays inside; 第五条: the standard wage.
				assert.equal(leave(wanted).unit, 'CALENDAR_DAY');
				assert.equal(leave(wanted).is_npl, false);
				assert.equal(leave(wanted).pay_fraction, '');
			}
			const windows = (wanted: string) => leave(wanted).entitlement as Row;
			assert.equal(windows('HOME_LEAVE_SPOUSE').window, 'CALENDAR_YEAR');
			assert.equal(windows('HOME_LEAVE_PARENTS').window, 'CALENDAR_YEAR');
			assert.deepEqual(
				[
					windows('HOME_LEAVE_PARENTS_BIENNIAL').window,
					windows('HOME_LEAVE_PARENTS_BIENNIAL').window_months
				],
				['ROLLING', 24]
			);
			assert.deepEqual(
				[
					windows('HOME_LEAVE_PARENTS_MARRIED').window,
					windows('HOME_LEAVE_PARENTS_MARRIED').window_months
				],
				['ROLLING', 48]
			);
			const days = (wanted: string, facts: Row = {}, over: Row = {}) =>
				entitlementDays(leave(wanted).entitlement as Parameters<typeof entitlementDays>[0], 130, {
					as_of: '2026-06-30',
					employment,
					employee: { children: [], facts: {} },
					entry: entry(facts),
					taken_by_class: {},
					...over
				});
			assert.equal(days('HOME_LEAVE_SPOUSE'), 30);
			// Travel days granted add to the grant.
			assert.equal(days('HOME_LEAVE_SPOUSE', { travel_days: 4 }), 34);
			assert.equal(days('HOME_LEAVE_PARENTS'), 20);
			assert.equal(days('HOME_LEAVE_PARENTS_BIENNIAL'), 45);
			assert.equal(days('HOME_LEAVE_PARENTS_MARRIED'), 20);
			// 工作满一年 with this employer: prior service elsewhere does not count.
			const newcomer = { employment: { ...employment, start_date: '2025-09-01' } };
			assert.equal(days('HOME_LEAVE_SPOUSE', {}, newcomer), 0);
			assert.equal(days('HOME_LEAVE_PARENTS_MARRIED', {}, newcomer), 0);
			assert.equal(
				days('HOME_LEAVE_SPOUSE', {}, { employment: { ...employment, start_date: '2025-06-30' } }),
				30
			);
			// The yearly and the two-year parent visit exclude each other.
			const took = (code: string) => ({
				taken_by_class: {
					[code]: { calendar_year: 0, service_year: 0, lifetime: 20, event: 0, rolling: 20 }
				}
			});
			assert.equal(days('HOME_LEAVE_PARENTS', {}, took('HOME_LEAVE_PARENTS_BIENNIAL')), 0);
			assert.equal(days('HOME_LEAVE_PARENTS_BIENNIAL', {}, took('HOME_LEAVE_PARENTS')), 0);
			// 第六条: the unit bears the fare; a married employee visiting parents bears up to 30% of the monthly wage.
			const claim = code(version, 'claim_catalog', 'HOME_LEAVE_TRAVEL');
			assert.equal(evaluateConfigured(String(claim.eligibility), subject('SH', so)), true);
			assert.equal(evaluateConfigured(String(claim.eligibility), subject('SH')), false);
			assert.deepEqual(claim.counts_toward, []);
			const fare = (visit: string, amount: number) => {
				const context = { ...payslipContext, entry: entry({ visit }, amount) };
				const band = (claim.bands as { when: string; amount: string }[]).find(
					(candidate) =>
						candidate.when === '' || evaluateConfigured(candidate.when, context) === true
				)!;
				return evaluateConfigured(band.amount, context);
			};
			assert.equal(fare('SPOUSE', 1_200), 1_200);
			assert.equal(fare('PARENTS', 1_200), 1_200);
			assert.equal(fare('PARENTS_MARRIED', 7_000), 1_000);
			assert.equal(fare('PARENTS_MARRIED', 5_000), 0);
			// The union fund scheme: 2% with a union; a Kunming unit without one pays the 2% preparatory fund.
			const scheme = code(version, 'statutory_contribution_catalog', 'UNION_FUND');
			const rules = (scheme.configuration as { rules: { when: string; employer: string }[] }).rules;
			const charge = (region: string, facts: Row = {}) => {
				const context = {
					...statutoryContext(region, facts),
					base: {
						ordinary: 10_000,
						bonus: 0,
						deductions: 0,
						...PARTS,
						assessed: 10_000,
						amount: 10_000
					}
				};
				const rule = rules.find(
					(candidate) => evaluateConfigured(candidate.when, context) === true
				);
				return rule == null ? 0 : evaluateConfigured(rule.employer, context);
			};
			assert.equal(charge('KM'), 200);
			assert.equal(charge('KM', { union_established: true }), 200);
			assert.equal(charge('SH'), 0);
			assert.equal(charge('SH', { union_established: true }), 200);
		}
	});

	describe('statutory amounts through the engine', () => {
		const COMPANY = {
			SH: 'c0000000-0000-4000-8000-0000000000sh',
			KM: 'c0000000-0000-4000-8000-0000000000km'
		};
		const iitIds = VERSIONS.map(
			(version) => code(version, 'statutory_contribution_catalog', 'IIT').id
		);
		const setup = () => {
			const law = (name: string): Row[] =>
				VERSIONS.flatMap((version) => file(version, name)).map((row) => ({
					approval_id: null,
					...row
				}));
			const contract = (id: string, company: string, salary: number, facts: Row = {}) => ({
				id: `k-${id}`,
				employee_id: id,
				company_id: company,
				approval_id: null,
				effective_range: { from: '2020-01-01', to: null },
				facts: {
					contract_terms: [
						{
							base_salary: { value: salary, currency: 'CNY' },
							effective_range: { from: '2020-01-01', to: null },
							residency_status: 'RESIDENT',
							work_classification: 'STANDARD',
							employment_type: 'PERMANENT',
							allowances: [],
							facts
						}
					]
				}
			});
			return new Map<string, Row[]>([
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
							id: COMPANY.SH,
							name: 'Huangpu',
							settings_code: 'CN',
							pay_frequency: 'MONTHLY',
							region: 'SH',
							risk_class: '1',
							facts: { hpf_rate_percent: 7 },
							approval_id: null
						},
						{
							id: COMPANY.KM,
							name: 'Dianchi',
							settings_code: 'CN',
							pay_frequency: 'MONTHLY',
							region: 'KM',
							risk_class: '3',
							facts: { hpf_rate_percent: 12, wage_zone: '1' },
							approval_id: null
						}
					]
				],
				[
					'employment_profile',
					[
						{
							id: 'p1',
							name: 'Lin',
							date_of_birth: '1990-02-01',
							nationality: 'CN',
							facts: {
								employment_statutory_facts: [
									{
										id: 's1',
										employment_id: 'k-p1',
										statutory_contribution_id: iitIds[0],
										effective_range: { from: '2025-01-01', to: null },
										status: {
											kind: 'REGISTERED',
											elections: {
												children_education_children: 1,
												housing_rent: true,
												annual_bonus_separate: true
											}
										}
									}
								]
							}
						},
						{
							id: 'p2',
							name: 'He',
							date_of_birth: '1985-07-12',
							nationality: 'CN',
							facts: {}
						}
					]
				],
				[
					'employment_contract',
					[
						contract('p1', COMPANY.SH, 30_000),
						contract('p2', COMPANY.KM, 8_000, { si_contribution_base: 3_000 }),
						contract('p3', COMPANY.KM, 6_000, { si_contribution_base: 2_000 })
					]
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
		};
		const readsOf = (tables: Map<string, Row[]>) => {
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
			return reads;
		};
		const engine = (tables: Map<string, Row[]>) => {
			const reads = readsOf(tables);
			let runs = 0;
			return async (company: string, period: string, kind: PayrollRunKind, sources?: string[]) => {
				const plan = await Effect.runPromise(
					buildPayrollRun({
						company_id: company,
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
					// The run's ledger pins every consumed entry to its payslip, as pin-settled-entries does.
					for (const pin of (slip as { pins?: { collection: string; id: string }[] }).pins ?? [])
						for (const held of tables.get(pin.collection) ?? [])
							if (held.id === pin.id) held.payslip_id = slipId;
				}
				return plan;
			};
		};
		const lines = (slip: {
			statutory: { scheme_code: string; employee_amount: number; employer_amount: number }[];
		}) =>
			Object.fromEntries(
				slip.statutory
					.filter((line) => line.employee_amount !== 0 || line.employer_amount !== 0)
					.map((line) => [line.scheme_code, [line.employee_amount, line.employer_amount]])
			);

		it('a semi-monthly month pays one month: salary, fixed allowance, Shanghai high-temperature pay; an unpaid half nets to zero', async () => {
			const tables = setup();
			const huangpu = tables.get('entity')!.find((row) => row.id === COMPANY.SH)!;
			huangpu.pay_frequency = 'SEMI_MONTHLY';
			const p1 = tables.get('employment_contract')!.find((row) => row.id === 'k-p1')!;
			const term = (p1.facts as { contract_terms: Row[] }).contract_terms[0]!;
			term.allowances = [{ code: 'FIXED_ALLOWANCE', amount: { value: 2_000, currency: 'CNY' } }];
			term.facts = { high_temperature_exposed: true };
			// p4 (20,000, no shift plan: calendar days) takes unpaid leave for the whole second half of June, 15 days.
			tables.get('employment_contract')!.push({
				...p1,
				id: 'k-p4',
				employee_id: 'p4',
				facts: {
					contract_terms: [
						{ ...term, base_salary: { value: 20_000, currency: 'CNY' }, allowances: [], facts: {} }
					]
				}
			});
			tables.get('employment_profile')!.push({
				id: 'p4',
				name: 'Zhao',
				date_of_birth: '1990-01-01',
				nationality: 'CN',
				facts: {}
			});
			tables.get('leave_catalog_entry')!.push({
				id: 'npl',
				catalog_id: code('version_3', 'leave_catalog', 'UNPAID_LEAVE').id,
				employment_id: 'k-p4',
				company_id: COMPANY.SH,
				approval_id: null,
				payslip_id: null,
				activity: 'TIME_OFF',
				occurred_on: '2026-06-16',
				from: '2026-06-16',
				to: '2026-06-30',
				days: 15,
				facts: {}
			});
			const run = engine(tables);
			const amount = (slip: unknown, code: string) =>
				[
					...((slip as { base: Row[] }).base ?? []),
					...((slip as { adjustments: Row[] }).adjustments ?? [])
				]
					.filter((line) => line.component_code === code)
					.reduce((sum, line) => sum + Number(line.amount), 0);
			const month: Record<string, number> = {};
			const p4: number[] = [];
			for (const half of ['2026-06-1', '2026-06-2']) {
				const plan = await run(COMPANY.SH, half, 'REGULAR');
				const slip = plan.payslips.find((row) => row.employment_id === 'k-p1')!;
				for (const code of ['BASIC', 'FIXED_ALLOWANCE', 'HIGH_TEMPERATURE_ALLOWANCE'])
					month[code] = Math.round(((month[code] ?? 0) + amount(slip, code)) * 100) / 100;
				const other = plan.payslips.find((row) => row.employment_id === 'k-p4');
				p4.push(other == null ? 0 : amount(other, 'BASIC') + amount(other, 'NO_PAY_LEAVE'));
			}
			// Each half pays half; the month together pays the monthly salary, allowance and 300 once.
			assert.deepEqual(month, {
				BASIC: 30_000,
				FIXED_ALLOWANCE: 2_000,
				HIGH_TEMPERATURE_ALLOWANCE: 300
			});
			// The unpaid half deducts its own half of the salary (15 × 21.75 ÷ 30 = 10.875 days, the part's cap), never the whole month.
			assert.deepEqual(p4, [10_000, 0]);
			// With a shift plan, a part whose every working day is unpaid deducts 21.75 ÷ 2 days (its half), not 21.75;
			// Shanghai's 300 likewise splits per part.
			for (const version of VERSIONS) {
				const npl = code(version, 'work_catalog', 'NO_PAY_LEAVE');
				const half = {
					...payslipContext,
					period: {
						...payslipContext.period,
						from: '2026-06-16',
						to: '2026-06-30',
						days: 15,
						covered_days: 15,
						working_days: 10,
						covered_working_days: 10,
						unpaid_working_days: 10,
						part: 2,
						parts: 2
					}
				};
				assert.equal(evaluateConfigured(String(npl.quantity), half), 21.75 / 2, version);
				const heat = code(version, 'work_catalog', 'HIGH_TEMPERATURE_ALLOWANCE');
				assert.equal(evaluateConfigured(String(heat.rate), half), 150, version);
			}
		});

		it('a frequency switch mid-month: the minimum-wage check runs once, on the run ending the month, on the month to date', async () => {
			const below = /contract wage is below the local monthly minimum wage/;
			const warned = async (frequency: string, changes: Row[], periods: string[], wage: number) => {
				const tables = setup();
				Object.assign(
					tables.get('entity')!.find((row) => row.id === COMPANY.SH)!,
					{
						pay_frequency: frequency,
						pay_frequency_changes: changes
					}
				);
				const p1 = tables.get('employment_contract')!.find((row) => row.id === 'k-p1')!;
				(p1.facts as { contract_terms: Row[] }).contract_terms[0]!.base_salary = {
					value: wage,
					currency: 'CNY'
				};
				const run = engine(tables);
				const out: number[] = [];
				for (const period of periods) {
					const plan = await run(COMPANY.SH, period, 'REGULAR');
					out.push(plan.warnings.filter((w) => below.test(w)).length);
				}
				return out;
			};
			// 3,700 less the month's own contributions (7,546 floor × 10.5% + 3,700 × 7%) = 2,648.67 < 2,740: warned once,
			// on the run that ends 30 September, whichever way the month is cut.
			const semiToMonthly = [{ from: '2026-09-16', frequency: 'MONTHLY' }];
			const monthlyToSemi = [{ from: '2026-09-16', frequency: 'SEMI_MONTHLY' }];
			assert.deepEqual(
				await warned('SEMI_MONTHLY', semiToMonthly, ['2026-09-1', '2026-09'], 3_700),
				[0, 1]
			);
			assert.deepEqual(
				await warned('MONTHLY', monthlyToSemi, ['2026-09', '2026-09-2'], 3_700),
				[0, 1]
			);
			// 4,000 less 1,072.33 = 2,927.67: never warned in either cut.
			assert.deepEqual(
				await warned('SEMI_MONTHLY', semiToMonthly, ['2026-09-1', '2026-09'], 4_000),
				[0, 0]
			);
			assert.deepEqual(
				await warned('MONTHLY', monthlyToSemi, ['2026-09', '2026-09-2'], 4_000),
				[0, 0]
			);
		});

		it('contract writes: one probation per employee and the open-ended right after two consecutive fixed terms', async () => {
			const tables = setup();
			const base = tables.get('employment_contract')!.find((row) => row.id === 'k-p1')!;
			const terms = (base.facts as { contract_terms: Row[] }).contract_terms[0]!;
			const term = (from: string, to: string | null, over: Row = {}) => ({
				...terms,
				employment_type: 'FIXED_TERM',
				effective_range: { from, to },
				...over
			});
			// p1's earlier fixed-term contracts with Huangpu: back to back, the second with a probation in its first term only.
			tables.set('employment_contract', [
				{
					...base,
					id: 'k-a',
					effective_range: { from: '2025-12-01', to: '2026-02-28' },
					exit_ground: 'CONTRACT_EXPIRY',
					facts: { contract_terms: [term('2025-12-01', '2026-02-28')] }
				},
				{
					...base,
					id: 'k-b',
					effective_range: { from: '2026-03-01', to: '2026-06-30' },
					exit_ground: 'CONTRACT_EXPIRY',
					facts: {
						contract_terms: [
							term('2026-03-01', '2026-03-31', { facts: { probation: true } }),
							term('2026-04-01', '2026-06-30')
						]
					}
				}
			]);
			const admit = (written: Row) =>
				Effect.runPromise(
					Effect.result(
						admitContractTerms({
							contract: {
								...base,
								id: 'k-c',
								effective_range: { from: '2026-07-01', to: null },
								facts: { contract_terms: [written] }
							},
							before: null
						}).pipe(Effect.provideService(Reads, readsOf(tables)))
					)
				);
			const third = await admit(term('2026-07-01', '2027-06-30'));
			assert.ok(
				third._tag === 'Failure' &&
					/open-ended contract must be concluded/.test(third.failure.message)
			);
			const asked = await admit(
				term('2026-07-01', '2027-06-30', { facts: { employee_requested_fixed_term: true } })
			);
			assert.equal(asked._tag, 'Success');
			const probationAgain = await admit(
				term('2026-07-01', '2026-08-31', {
					employment_type: 'PERMANENT',
					facts: { probation: true }
				})
			);
			assert.ok(
				probationAgain._tag === 'Failure' &&
					/only one probation/.test(probationAgain.failure.message)
			);
			assert.equal(
				(await admit(term('2026-07-01', null, { employment_type: 'PERMANENT' })))._tag,
				'Success'
			);
		});

		it('work-day import: roster validations warn on working-time limits and refuse a child worker', async () => {
			const tables = setup();
			tables.get('entity')!.find((row) => row.id === COMPANY.SH)!.time_zone = 'Asia/Shanghai';
			const base = tables.get('employment_contract')!.find((row) => row.id === 'k-p1')!;
			const terms = (base.facts as { contract_terms: Row[] }).contract_terms[0]!;
			const person = (id: string, over: Row, termOver: Row = {}) => {
				tables.get('employment_contract')!.push({
					...base,
					id: `k-${id}`,
					employee_id: id,
					facts: { contract_terms: [{ ...terms, ...termOver }] }
				});
				tables.get('employment_profile')!.push({
					id,
					name: id,
					date_of_birth: '1990-01-01',
					nationality: 'CN',
					facts: {},
					...over
				});
			};
			person('pt', {}, { employment_type: 'PART_TIME' });
			person('preg', {
				gender: 'FEMALE',
				children: [{ estimated_delivery_date: '2026-04-20' }]
			});
			person('kid', { date_of_birth: '2011-06-01' });
			person('kid-ok', { date_of_birth: '2011-06-01', facts: { minor_employment_approved: true } });
			let ref = 0;
			const drafts: Parameters<typeof rosterFindings>[1][number][] = [];
			// Local Shanghai clocks (UTC+8) on a day, with approved overtime.
			const work = (id: string, date: string, from: string, to: string, overtime = 0) => {
				const at = (clock: string) => {
					const [h, m] = clock.split(':').map(Number) as [number, number];
					return new Date(
						Date.parse(`${date}T00:00:00Z`) + ((h - 8) * 60 + m) * 60_000
					).toISOString();
				};
				drafts.push({
					ref: ++ref,
					employment_id: `k-${id}`,
					work_date: date,
					worked_intervals: [{ start: at(from), end: at(to) }],
					approved_overtime_hours: overtime,
					leave_code: ''
				});
				return ref;
			};
			const overtime = work('p1', '2026-03-02', '08:00', '20:00', 4); // 12 h, 4 approved: over the 3-hour cap
			const unrecorded = work('p1', '2026-03-03', '08:00', '18:00'); // 10 h, none approved
			for (const date of ['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'])
				work('p1', date, '09:00', '17:00');
			const seventh = work('p1', '2026-03-08', '09:00', '17:00');
			let partTime = 0;
			for (const date of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'])
				partTime = work('pt', date, '09:00', '14:00'); // 5 × 5 h: 25 h by the fifth day
			const night = work('preg', '2026-03-10', '22:00', '23:30');
			work('preg', '2026-03-11', '09:00', '17:00');
			const child = work('kid', '2026-03-10', '09:00', '13:00');
			work('kid-ok', '2026-03-10', '09:00', '13:00');
			const findings = await Effect.runPromise(
				rosterFindings(COMPANY.SH, drafts).pipe(Effect.provideService(Reads, readsOf(tables)))
			);
			assert.deepEqual(
				findings.map((finding) => [finding.ref, finding.code, finding.kind, finding.column]),
				[
					[overtime, 'ROSTER_OVERTIME_DAILY', 'warn', 'overtime_hours'],
					[unrecorded, 'ROSTER_UNRECORDED_OVERTIME', 'warn', 'overtime_hours'],
					[seventh, 'ROSTER_WEEKLY_REST', 'warn', ''],
					[partTime, 'ROSTER_PART_TIME_WEEK', 'warn', ''],
					[night, 'ROSTER_PREGNANT_NURSING', 'warn', ''],
					[child, 'ROSTER_CHILD_LABOUR', 'refuse', '']
				]
			);
		});

		it('a third region is a table row: priced from rules.regions alone; a region not in the table is refused', async () => {
			const tables = setup();
			// A fixture city, added to every version's regions table and nowhere else.
			for (const row of tables.get('rule_set')!.filter((held) => held.code === 'regions')) {
				const table = (row.rules as { by_region: Record<string, Row> }).by_region;
				row.rules = {
					...(row.rules as Row),
					by_region: {
						...table,
						XX: {
							...table.SH!,
							name: 'Fixture city',
							si_base: { floor: 5_000, ceiling: 30_000 },
							medical_base: { floor: 5_000, ceiling: 30_000 },
							medical_rate: { employee: 0.02, employer: 0.07 },
							unemployment_rate: { employee: 0.002, employer: 0.008 },
							major_medical: null,
							hpf: {
								floor: 2_500,
								ceiling: 30_000,
								rate_percent: { min: 5, max: 12 },
								supplementary_percent: null
							},
							minimum_wage: {
								default_zone: '1',
								zones: { '1': { amount: 2_500, hourly: 23 } },
								excludes_employee_contributions: false
							},
							si_payment_due_day: 25,
							leave: {
								...(table.SH!.leave as Row),
								paternity_days: 20,
								prenatal_days: null,
								nursing_days: null
							},
							sources: ['fixture']
						}
					}
				};
			}
			const city = (id: string, region: string) => {
				tables.get('entity')!.push({
					id,
					name: id,
					settings_code: 'CN',
					pay_frequency: 'MONTHLY',
					region,
					risk_class: '1',
					facts: { hpf_rate_percent: 7 },
					approval_id: null
				});
				const p1 = tables.get('employment_contract')!.find((row) => row.id === 'k-p1')!;
				tables
					.get('employment_contract')!
					.push({ ...p1, id: `k-${id}`, employee_id: 'p2', company_id: id });
			};
			city('c-xx', 'XX');
			city('c-zz', 'ZZ');
			const run = engine(tables);
			const slip = (await run('c-xx', '2026-09', 'REGULAR')).payslips[0]!;
			// 30,000 capped at the fixture ceiling 30,000: pension 8% / 16%, medical 2% / 7%, unemployment 0.2% / 0.8%,
			// work injury class 1 0.2%, HPF 7% — every figure from the XX row.
			assert.deepEqual(lines(slip), {
				PENSION: [2400, 4800],
				MEDICAL: [600, 2100],
				UNEMPLOYMENT: [60, 240],
				WORK_INJURY: [0, 60],
				HPF: [2100, 2100],
				// IIT: 30,000 − 5,000 − 5,160 = 19,840 at 3%.
				IIT: [595.2, 0]
			});
			await assert.rejects(run('c-zz', '2026-09', 'REGULAR'), /regions table/);
			// A duty reads the row: social insurance due on the fixture's 25th.
			const v4 = tables
				.get('rule_set')!
				.filter((row) => row.settings_id === settingsOf('version_4').id);
			const raised = raiseDuties({
				behaviours: settingsOf('version_4').behaviours as Behaviours,
				settings_id: settingsOf('version_4').id,
				rows: v4,
				collection: 'payroll_run',
				event: 'created',
				row: { id: 'r-xx', company_id: 'c-xx', period: '2026-09', approval_id: null },
				reads: { company: [{ region: 'XX', risk_class: '1', facts: { hpf_rate_percent: 7 } }] }
			});
			assert.equal(
				raised.find((write) => write.duty_code === 'SI_MONTHLY_PAYMENT')?.due_on,
				'2026-09-25'
			);
			// A leave class reads the row: 20 paternity days, no antenatal leave.
			const regions = v4.find((row) => row.code === 'regions')!.rules;
			const leaveDays = (wanted: string) =>
				entitlementDays(
					code('version_4', 'leave_catalog', wanted).entitlement as Parameters<
						typeof entitlementDays
					>[0],
					130,
					{
						as_of: '2026-09-30',
						employment,
						company: { region: 'XX', facts: {} },
						rules: { ...rulesOf('version_4'), regions },
						employee: { children: [], facts: {} },
						entry: entry({ event_id: 'b1' })
					}
				);
			assert.equal(leaveDays('PATERNITY_LEAVE'), 20);
			assert.equal(leaveDays('PRENATAL_LEAVE'), 0);
			assert.equal(leaveDays('ELDER_CARE_LEAVE'), 5);
			// The entity region picker offers the table's keys, one per city.
			for (const version of VERSIONS)
				assert.deepEqual(
					regionsIn(file(version, 'rule_set').map((row) => row.rules)),
					['KM', 'SH'],
					version
				);
		});

		it('Shanghai: capped base, 2025 then 2026 contribution year, and cumulative IIT month on month', async () => {
			const tables = setup();
			const run = engine(tables);
			const december = (await run(COMPANY.SH, '2025-12', 'REGULAR')).payslips[0]!;
			// 30,000 within 7,460–37,302; unemployment 0.5%/0.5% to 31 December 2025.
			assert.deepEqual(lines(december), {
				PENSION: [2400, 4800],
				MEDICAL: [600, 2700],
				UNEMPLOYMENT: [150, 150],
				WORK_INJURY: [0, 60],
				HPF: [2100, 2100],
				// IIT December, no earlier slips this year: 30,000 − 5,000 − 3,150 − 2,100 − 2,000 − 1,500 = 16,250 at 3%.
				IIT: [487.5, 0]
			});
			const january = (await run(COMPANY.SH, '2026-01', 'REGULAR')).payslips[0]!;
			// 2026: unemployment at the provisional 0.5% / 0.5% (owner ruling), 9% / 2% medical (沪医保规〔2026〕2号):
			// 30,000 − 5,000 − 3,150 − 2,100 − 3,500 = 16,250 at 3%.
			assert.deepEqual(lines(january), {
				PENSION: [2400, 4800],
				MEDICAL: [600, 2700],
				UNEMPLOYMENT: [150, 150],
				WORK_INJURY: [0, 60],
				HPF: [2100, 2100],
				IIT: [487.5, 0]
			});
			const february = (await run(COMPANY.SH, '2026-02', 'REGULAR')).payslips[0]!;
			// Cumulative 32,500: 975 − 487.5 = 487.5.
			assert.deepEqual(lines(february).IIT, [487.5, 0]);
			const march = (await run(COMPANY.SH, '2026-03', 'REGULAR')).payslips[0]!;
			// Cumulative 48,750 crosses 36,000: 1,080 + 12,750 × 10% = 2,355 − 975 = 1,380.
			assert.deepEqual(lines(march).IIT, [1380, 0]);
			assert.deepEqual(lines(march).MEDICAL, [600, 2700]);
			assert.equal(march.net, 30_000 - 2400 - 600 - 150 - 2100 - 1380);
			// The annual bonus, off cycle in March, elected for separate taxation: 60,000 / 12 = 5,000 → 10% − 210.
			const bonus = code('version_2', 'adhoc_catalog', 'ANNUAL_BONUS');
			tables.get('adhoc_catalog_entry')!.push({
				id: 'b1',
				catalog_id: bonus.id,
				employment_id: 'k-p1',
				company_id: COMPANY.SH,
				approval_id: null,
				payslip_id: null,
				occurred_on: '2026-03-20',
				amount: 60_000,
				activity: 'PAYMENT'
			});
			const paid = (await run(COMPANY.SH, '2026-03', 'OFF_CYCLE', ['b1'])).payslips[0]!;
			assert.deepEqual(
				Object.fromEntries(
					Object.entries(lines(paid)).filter(
						([, [employee, employer]]) => employee !== 0 || employer !== 0
					)
				),
				{ IIT: [5790, 0] }
			);
			const july = (await run(COMPANY.SH, '2026-07', 'REGULAR')).payslips[0]!;
			// 2026 contribution year from 1 July: base floor 7,546 / ceiling 37,731 — 30,000 unchanged.
			assert.deepEqual(lines(july).PENSION, [2400, 4800]);
		});

		it('内退 lump sum: taxed apart on the merged-month rule, outside the cumulative wage tax; union fund of a Shanghai preparatory organisation', async () => {
			const tables = setup();
			const huangpu = tables.get('entity')!.find((row) => row.id === COMPANY.SH)!;
			huangpu.facts = { hpf_rate_percent: 7, union_preparatory: true };
			const run = engine(tables);
			const january = (await run(COMPANY.SH, '2026-01', 'REGULAR')).payslips[0]!;
			// 上海市工会条例 第四十一条: a preparatory organisation remits 2% of wages, as a union does.
			assert.deepEqual(lines(january).UNION_FUND, [0, 600]);
			assert.deepEqual(lines(january).IIT, [487.5, 0]);
			await run(COMPANY.SH, '2026-02', 'REGULAR');
			tables.get('adhoc_catalog_entry')!.push({
				id: 'ir1',
				catalog_id: code('version_2', 'adhoc_catalog', 'INTERNAL_RETIREMENT_LUMP_SUM').id,
				employment_id: 'k-p1',
				company_id: COMPANY.SH,
				approval_id: null,
				payslip_id: null,
				occurred_on: '2026-02-20',
				amount: 228_000,
				activity: 'PAYMENT'
			});
			// Born 1990-02-01 (female, 50 + 60 months): retires 2045-02-01, 228 months from February 2026.
			// 228,000 ÷ 228 + 30,000 − 5,000 = 26,000 → 25% − 2,660: 253,000 × 25% − 2,660 = 60,590, less the month's
			// own wage tax at the monthly table (25,000 → 3,590) = 57,000.
			const lump = (await run(COMPANY.SH, '2026-02', 'OFF_CYCLE', ['ir1'])).payslips[0]!;
			assert.deepEqual(lines(lump).IIT, [57_000, 0]);
			assert.equal(lines(lump).UNION_FUND, undefined);
			// March's cumulative wage tax is untouched by February's lump: 2,355 − 975 = 1,380, as without it.
			const march = (await run(COMPANY.SH, '2026-03', 'REGULAR')).payslips[0]!;
			assert.deepEqual(lines(march).IIT, [1380, 0]);
		});

		it('non-compete compensation after exit: 30% of the 12 months before it, at least the minimum wage, or the agreed sum', async () => {
			const tables = setup();
			const run = engine(tables);
			for (const period of ['2025-12', '2026-01', '2026-02'])
				await run(COMPANY.SH, period, 'REGULAR');
			const leaver = tables.get('employment_contract')!.find((row) => row.id === 'k-p1')!;
			Object.assign(leaver, {
				effective_range: { from: '2020-01-01', to: '2026-02-28' },
				exit_ground: 'RESIGNATION'
			});
			const nc = code('version_2', 'adhoc_catalog', 'NON_COMPETE_COMPENSATION');
			assert.equal(nc.payable_after_exit, true);
			const pay = (id: string, occurred_on: string, facts: Row = {}) =>
				tables.get('adhoc_catalog_entry')!.push({
					id,
					catalog_id: nc.id,
					employment_id: 'k-p1',
					company_id: COMPANY.SH,
					approval_id: null,
					payslip_id: null,
					occurred_on,
					amount: 0,
					activity: 'PAYMENT',
					facts
				});
			const paid = async (period: string) => {
				const slip = (await run(COMPANY.SH, period, 'REGULAR')).payslips.find(
					(row) => row.employment_id === 'k-p1'
				) as unknown as { base: Row[]; adjustments: { component_code: string; amount: number }[] };
				assert.deepEqual(slip.base, []);
				return slip.adjustments.map((line) => [line.component_code, line.amount]);
			};
			// 法释〔2020〕26号 第三十六条: no agreed sum → 30% of the three slips' 30,000 average = 9,000 a month.
			pay('nc-3', '2026-03-31');
			assert.deepEqual(await paid('2026-03'), [['NON_COMPETE_COMPENSATION', 9_000]]);
			// The agreed sum governs when there is one.
			pay('nc-4', '2026-04-30', { agreed_monthly_compensation: 12_000 });
			assert.deepEqual(await paid('2026-04'), [['NON_COMPETE_COMPENSATION', 12_000]]);
			// Floored at the Shanghai minimum wage (2,740): a 6,000 average gives 1,800 → 2,740.
			pay('nc-5', '2026-05-31', { pre_exit_average_monthly_wage: 6_000 });
			assert.deepEqual(await paid('2026-05'), [['NON_COMPETE_COMPENSATION', 2_740]]);
			// 劳动合同法 第二十四条: at most two years after the exit.
			const qualifies = (occurred_on: string) =>
				evaluateConfigured(String(nc.qualifies_when), {
					...payslipContext,
					employment: { ...employment, exit_date: '2026-02-28', exit_ground: 'RESIGNATION' },
					entry: { ...entry({ pre_exit_average_monthly_wage: 30_000 }), occurred_on }
				});
			assert.equal(qualifies('2028-02-28'), true);
			assert.equal(qualifies('2028-03-01'), false);
			assert.equal(qualifies('2026-02-20'), false);
		});

		it('Shanghai employer facts: ceiling, notified work-injury rate, supplementary HPF, union fund, interns, treaty exemptions, fund-paid maternity', async () => {
			const tables = setup();
			const SX = 'c0000000-0000-4000-8000-0000000000sx';
			tables.get('entity')!.push({
				id: SX,
				name: 'Xuhui',
				settings_code: 'CN',
				pay_frequency: 'MONTHLY',
				region: 'SH',
				risk_class: '1',
				facts: {
					hpf_rate_percent: 7,
					hpf_supplementary_rate_percent: 3,
					union_established: true,
					work_injury_rate_percent: 0.5,
					wi_voluntary_interns_and_retirees: true
				},
				approval_id: null
			});
			const template = tables.get('employment_contract')![0]!;
			const terms = (template.facts as { contract_terms: Row[] }).contract_terms[0]!;
			const hire = (id: string, salary: number, over: Row = {}) => {
				tables.get('employment_contract')!.push({
					...template,
					id: `k-${id}`,
					employee_id: id,
					company_id: SX,
					facts: {
						contract_terms: [{ ...terms, base_salary: { value: salary, currency: 'CNY' }, ...over }]
					}
				});
				tables
					.get('employment_profile')!
					.push({ id, name: id, date_of_birth: '1990-01-01', nationality: 'CN', facts: {} });
			};
			hire('p4', 50_000);
			hire('p5', 3_000, { employment_type: 'INTERN' });
			hire('p6', 40_000);
			Object.assign(tables.get('employment_profile')!.at(-1)!, {
				nationality: 'DE',
				facts: { si_exempt_schemes: ['PENSION', 'UNEMPLOYMENT'] }
			});
			hire('p7', 20_000);
			tables.get('leave_catalog_entry')!.push({
				id: 'mat',
				catalog_id: code('version_3', 'leave_catalog', 'MATERNITY_LEAVE').id,
				employment_id: 'k-p7',
				company_id: SX,
				approval_id: null,
				payslip_id: null,
				activity: 'TIME_OFF',
				occurred_on: '2026-03-02',
				from: '2026-03-02',
				to: '2026-08-06',
				days: 158,
				facts: {}
			});
			const run = engine(tables);
			const march = await run(SX, '2026-03', 'REGULAR');
			const p7 = march.payslips.find((slip) => slip.employment_id === 'k-p7') as unknown as {
				net: number;
				gross: number;
				adjustments: { component_code: string; amount: number }[];
			} & Parameters<typeof lines>[0];
			const carried = (slip: typeof p7) =>
				Object.fromEntries(
					slip.adjustments
						.filter((line) => line.component_code.endsWith('_CARRIED'))
						.map((line) => [line.component_code, line.amount])
				);
			// CN-CONTRIBUTION-20: a fund-paid month is still charged in full on the declared base (20,000); the employee
			// share its one-day wage cannot bear is advanced (carry_uncovered), so the slip nets 0 instead of refusing.
			assert.deepEqual(lines(p7).PENSION, [1600, 3200]);
			assert.equal(p7.net, 0);
			assert.deepEqual(carried(p7), {
				HPF_CARRIED: 1400,
				HPF_SUPPLEMENTARY_CARRIED: 600,
				MEDICAL_CARRIED: 400,
				PENSION_CARRIED: 1054.84
			});
			const slipOf = async (period: string) =>
				(await run(SX, period, 'REGULAR')).payslips.find(
					(row) => row.employment_id === 'k-p7'
				) as unknown as typeof p7;
			// April–July pay no wage: assessed without it, each month's 4,100 employee share advanced in full.
			for (const period of ['2026-04', '2026-05', '2026-06', '2026-07']) {
				const slip = await slipOf(period);
				assert.equal(slip.gross, 0);
				assert.deepEqual(lines(slip).UNEMPLOYMENT, [100, 100]);
				assert.equal(
					Object.values(carried(slip)).reduce((sum, amount) => sum + amount, 0),
					4_100,
					period
				);
			}
			// Back from 7 August: the advance (3,454.84 + 4 × 4,100 = 19,854.84) is recovered as far as each net allows.
			const august = await slipOf('2026-08');
			const september = await slipOf('2026-09');
			assert.equal(august.net, 0);
			const recovered = [august, september].flatMap((slip) => Object.values(carried(slip)));
			assert.equal(
				Math.round(recovered.reduce((sum, amount) => sum + amount, 0) * 100) / 100,
				-19_854.84
			);
			assert.equal(september.net, 8_074.19);
			assert.deepEqual(carried(await slipOf('2026-10')), {});
			const of = (id: string) =>
				march.payslips.find((slip) => slip.employment_id === `k-${id}`) as Parameters<
					typeof lines
				>[0] & { net: number };
			// 50,000 capped at the 2025 ceiling 37,302; work injury at the notified 0.5%; HPF to the yuan at 7% and 3%; union 2% of wages.
			assert.deepEqual(lines(of('p4')), {
				PENSION: [2984.16, 5968.32],
				MEDICAL: [746.04, 3357.18],
				UNEMPLOYMENT: [186.51, 186.51],
				WORK_INJURY: [0, 186.51],
				HPF: [2611, 2611],
				HPF_SUPPLEMENTARY: [1119, 1119],
				UNION_FUND: [0, 1000],
				// 50,000 − 5,000 − 7,646.71 = 37,353.29 → 1,080 + 1,353.33 × 10%.
				IIT: [1215.33, 0]
			});
			// An intern: only the voluntary work-injury cover on the floor 7,460; pay taxed at 80% → none.
			assert.deepEqual(lines(of('p5')), { WORK_INJURY: [0, 37.3], UNION_FUND: [0, 60] });
			assert.equal(of('p5').net, 3_000);
			// A German national under the China–Germany agreement: no pension or unemployment, no HPF.
			assert.deepEqual(lines(of('p6')), {
				MEDICAL: [746.04, 3357.18],
				WORK_INJURY: [0, 186.51],
				UNION_FUND: [0, 800],
				IIT: [1027.62, 0]
			});
		});

		it('Kunming: the base is floored at the Yunnan limit, HPF at the zone floor, medical 7.9% / 2% on its own base', async () => {
			const tables = setup();
			const run = engine(tables);
			const of = (plan: { payslips: { employment_id: string }[] }, id: string) =>
				plan.payslips.find((slip) => slip.employment_id === id) as Parameters<typeof lines>[0];
			const december = of(await run(COMPANY.KM, '2025-12', 'REGULAR'), 'k-p2');
			// Declared base 3,000 floored at 4,357 (2025) for social insurance; within 2,070–32,470 for HPF at 12%.
			// Medical on its own 2025 base floor 4,306: 2% and 7.9% (7% + 0.9% maternity).
			// IIT: 8,000 − 5,000 − 348.56 − 86.12 − 13.07 − 360 = 2,192.25 at 3%.
			assert.deepEqual(lines(december), {
				PENSION: [348.56, 697.12],
				MEDICAL: [86.12, 340.17],
				// Inferred: 0.6% of 7,177, the average behind the medical base 4,306–21,531 in force.
				MAJOR_MEDICAL: [1, 43.06],
				UNEMPLOYMENT: [13.07, 30.5],
				WORK_INJURY: [0, 30.5],
				HPF: [360, 360],
				IIT: [65.77, 0],
				// No union recorded: the 2% union preparatory fund (建会筹备金, 中国工会章程 第三十八条) on 8,000.
				UNION_FUND: [0, 160]
			});
			// The 2025 Kunming housing-fund ceiling is 32,470 (version 1), 32,543 from 2026: 40,000 → 32,470 × 12% = 3,896.40,
			// rounded to the yuan (按元计算) → 3,896.
			const fresh = setup();
			const k2 = fresh.get('employment_contract')!.find((row) => row.id === 'k-p2')!;
			const k2terms = (k2.facts as { contract_terms: Row[] }).contract_terms[0]!;
			fresh.set('employment_contract', [
				{
					...k2,
					facts: {
						contract_terms: [
							{ ...k2terms, base_salary: { value: 40_000, currency: 'CNY' }, facts: {} }
						]
					}
				}
			]);
			const run40 = engine(fresh);
			assert.deepEqual(
				lines(of(await run40(COMPANY.KM, '2025-12', 'REGULAR'), 'k-p2')).HPF,
				[3_896, 3_896]
			);
			// 2026: 32,543 × 12% = 3,905.16 → 3,905.
			assert.deepEqual(
				lines(of(await run40(COMPANY.KM, '2026-01', 'REGULAR'), 'k-p2')).HPF,
				[3_905, 3_905]
			);
			const january = of(await run(COMPANY.KM, '2026-01', 'REGULAR'), 'k-p2');
			// 2026: floor 4,403 (云人社发〔2026〕8号); the HPF floor (the class-1 minimum wage) leaves 3,000.
			assert.deepEqual(lines(january).PENSION, [352.24, 704.48]);
			assert.deepEqual(lines(january).WORK_INJURY, [0, 30.82]);
			assert.deepEqual(lines(january).MEDICAL, [86.12, 340.17]);
			// 2026 unemployment by owner ruling: 0.5% / 0.5% in Kunming as in Shanghai, on the 4,403 floor.
			assert.deepEqual(lines(january).UNEMPLOYMENT, [22.02, 22.02]);
			// The Kunming HPF floor is the class-1 minimum wage: 2,170 in August, 2,270 from 1 September 2026.
			const august = of(await run(COMPANY.KM, '2026-08', 'REGULAR'), 'k-p3');
			assert.deepEqual(lines(august).HPF, [260, 260]);
			const september = of(await run(COMPANY.KM, '2026-09', 'REGULAR'), 'k-p3');
			assert.deepEqual(lines(september).HPF, [272, 272]);
			// The medical base limits move on 1 September 2026 (云人社发〔2026〕8号): 4,403 floor.
			assert.deepEqual(lines(august).MEDICAL, [86.12, 340.17]);
			assert.deepEqual(lines(september).MEDICAL, [88.06, 347.84]);
			// The per-head major-expense supplement (inferred): 0.6% of 7,177 to August 2026 (version 3), of 7,339 from
			// September (version 4, with the 4,403–22,017 medical base); employee 1 yuan.
			assert.deepEqual(lines(august).MAJOR_MEDICAL, [1, 43.06]);
			assert.deepEqual(lines(september).MAJOR_MEDICAL, [1, 44.03]);
		});

		it('an off-cycle bonus before or after the regular run settles the same month totals', async () => {
			const monthTotals = async (bonusFirst: boolean) => {
				const tables = setup();
				const run = engine(tables);
				for (const period of ['2026-01', '2026-02']) await run(COMPANY.SH, period, 'REGULAR');
				await run(COMPANY.KM, '2026-02', 'REGULAR');
				const annual = code('version_2', 'adhoc_catalog', 'ANNUAL_BONUS');
				const other = code('version_2', 'adhoc_catalog', 'BONUS');
				const addBonuses = () => {
					for (const [id, catalog, employment, company, amount] of [
						['b1', annual.id, 'k-p1', COMPANY.SH, 60_000],
						['b2', other.id, 'k-p2', COMPANY.KM, 20_000]
					] as const)
						tables.get('adhoc_catalog_entry')!.push({
							id,
							catalog_id: catalog,
							employment_id: employment,
							company_id: company,
							approval_id: null,
							payslip_id: null,
							occurred_on: '2026-03-20',
							amount,
							activity: 'PAYMENT'
						});
				};
				const slips: Parameters<typeof lines>[0][] = [];
				const order = bonusFirst
					? [
							['BONUSES'],
							['OFF_CYCLE', COMPANY.SH, ['b1']],
							['OFF_CYCLE', COMPANY.KM, ['b2']],
							['REGULAR', COMPANY.SH, undefined],
							['REGULAR', COMPANY.KM, undefined]
						]
					: [
							['REGULAR', COMPANY.SH, undefined],
							['REGULAR', COMPANY.KM, undefined],
							['BONUSES'],
							['OFF_CYCLE', COMPANY.SH, ['b1']],
							['OFF_CYCLE', COMPANY.KM, ['b2']]
						];
				for (const [kind, company, sources] of order) {
					if (kind === 'BONUSES') {
						addBonuses();
						continue;
					}
					slips.push(
						...(
							await run(
								company as string,
								'2026-03',
								kind as PayrollRunKind,
								sources as string[] | undefined
							)
						).payslips.filter((slip) => slip.employment_id !== 'k-p3')
					);
				}
				const totals: Record<string, [number, number]> = {};
				for (const slip of slips)
					for (const [scheme, [employee, employer]] of Object.entries(lines(slip))) {
						const held = totals[
							`${(slip as { employment_id?: string }).employment_id}:${scheme}`
						] ?? [0, 0];
						totals[`${(slip as { employment_id?: string }).employment_id}:${scheme}`] = [
							Math.round((held[0] + employee) * 100) / 100,
							Math.round((held[1] + employer) * 100) / 100
						];
					}
				return totals;
			};
			const after = await monthTotals(false);
			const before = await monthTotals(true);
			assert.deepEqual(before, after);
			// The separately taxed annual bonus and the merged bonus both land in the month's IIT.
			assert.deepEqual(after['k-p1:IIT'], [1380 + 5790, 0]);
			assert.ok(after['k-p2:IIT']![0] > 0);
			assert.deepEqual(after['k-p1:PENSION'], [2400, 4800]);
		});
	});
});
