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
import { evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { Reads } from '../src/lib/payroll_engine/foundation.js';
import { entitlementDays } from '../src/lib/payroll_engine/leave.js';
import { dutiesOf, raiseDuties, triggerOf } from './duties.ts';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.js';

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
	overtime_hours: overtime,
	incentive_hours: 0,
	intervals: []
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
		parts: 1,
		part: 1
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
const statutoryContext = (region: string, facts: Row = {}, employee: Row = {}) => ({
	...subject(region, facts, employee),
	rules: rulesOf('version_3'),
	wage: { ordinary: 20_000, bonus: 0, deductions: 20_000 },
	month: { ordinary: 20_000, bonus: 0, deductions: 20_000 },
	year: { ordinary: 0, bonus: 0, deductions: 0 },
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
		salary_paid: false
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
		assert.deepEqual(VERSIONS, ['version_1', 'version_2', 'version_3']);
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
				tax_year_start_month: 1
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
			for (const version of VERSIONS) assert.deepEqual(codes(version), codes('version_1'), name);
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
					'monthly_wage'
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
					/\b(employee\.facts|company\.facts|scheme\.elections|terms\.facts|employment\.exit_facts|terms)\.(\w+)/g
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
				for (const band of row.bands as {
					when: string;
					amount: string;
					limit?: { amount: string };
				}[]) {
					bool(band.when, payslipContext, where);
					number(band.amount, payslipContext, where);
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
		const month = { ordinary: 30_000, bonus: 0, deductions: 0 };
		const parts = Object.fromEntries(
			Object.entries(iit.assessable).map(([part, expression]) => [
				part,
				evaluateConfigured(expression, { ...context, person, month })
			])
		);
		assert.deepEqual(parts, { ordinary: 30_000, bonus: 0, deductions: 5_000 });
		const ruled = { ...context, person, base: { ...parts, assessed: 35_000, amount: 35_000 } };
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
				context
			);
		const low = (region: string, facts: Row = {}) => {
			const context = statutoryContext(region, facts) as Row & { terms: Row };
			return { ...context, terms: { ...context.terms, monthly_wage: 1_000 } };
		};
		assert.equal(assess('version_1', 'HPF', low('SH')), 2_690);
		assert.equal(assess('version_2', 'HPF', low('SH')), 2_690);
		assert.equal(assess('version_3', 'HPF', low('SH')), 2_740);
		// Kunming class 2 floor from the minimum-wage table on the period start (March 2026: 2,020).
		assert.equal(assess('version_3', 'HPF', low('KM', { km_hpf_zone: '2' })), 2_020);
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

	it('payslip validations warn on the minimum wage, the 36-hour overtime limit and the uncomputed schemes', () => {
		for (const version of VERSIONS) {
			const checks = file(version, 'rule_set').filter((row) => row.family === 'VALIDATIONS');
			assert.deepEqual(checks.map((row) => row.code).toSorted(), [
				'KM_MAJOR_EXPENSE_NOT_COMPUTED',
				'MINIMUM_WAGE',
				'MINIMUM_WAGE_HOURLY',
				'OVERTIME_DAILY_LIMIT',
				'OVERTIME_MONTHLY_LIMIT',
				'UNEMPLOYMENT_NOT_COMPUTED'
			]);
			for (const check of checks) {
				const rules = check.rules as Row;
				assert.equal(rules.site, 'payslip');
				assert.equal(rules.kind, 'warn');
				assert.ok(String(rules.description).length > 20);
			}
		}
		const trips = (wanted: string, over: Row = {}) => {
			const check = file('version_3', 'rule_set').find((row) => row.code === wanted)!;
			return evaluateConfigured(String((check.rules as Row).when), {
				...payslipContext,
				period: {
					...payslipContext.period,
					to: '2026-09-30',
					from: '2026-09-01',
					covered_days: 30,
					days: 30
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
		const wage = (base: number) => ({ terms: { ...payslipContext.terms, base_salary: base } });
		// Shanghai: 3,000 less 510 of the employee's own contributions is 2,490 < 2,740.
		assert.equal(trips('MINIMUM_WAGE', wage(3_000)), true);
		assert.equal(trips('MINIMUM_WAGE', wage(3_300)), false);
		// Kunming class 1 from 1 September 2026: 2,270, contributions included.
		const km = (base: number) => ({ ...wage(base), company: { ...subject('KM').company } });
		assert.equal(trips('MINIMUM_WAGE', km(2_250)), true);
		assert.equal(trips('MINIMUM_WAGE', km(2_300)), false);
		assert.equal(
			trips('MINIMUM_WAGE', {
				...wage(1_000),
				terms: { ...payslipContext.terms, base_salary: 1_000, employment_type: 'PART_TIME' }
			}),
			false
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
		assert.equal(trips('OVERTIME_DAILY_LIMIT'), false);
		assert.equal(
			trips('OVERTIME_DAILY_LIMIT', {
				work: { ...payslipContext.work, days: [day('2026-03-02', 'WORK', 12, 4)] }
			}),
			true
		);
		assert.equal(trips('KM_MAJOR_EXPENSE_NOT_COMPUTED'), false);
		assert.equal(trips('KM_MAJOR_EXPENSE_NOT_COMPUTED', { company: subject('KM').company }), true);
		const partTime = (rate: number) => ({
			terms: { ...payslipContext.terms, employment_type: 'PART_TIME', facts: { hourly_rate: rate } }
		});
		assert.equal(trips('MINIMUM_WAGE_HOURLY', partTime(24)), true);
		assert.equal(trips('MINIMUM_WAGE_HOURLY', partTime(26)), false);
		assert.equal(trips('UNEMPLOYMENT_NOT_COMPUTED'), true);
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
				base: { separation: 0, ...parts, ...(over.base as Row | undefined) }
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
			month: { ordinary: 30_000, bonus: 60_000, deductions: 0 }
		});
		assert.deepEqual(nr.parts, { ordinary: 30_000, bonus: 60_000, deductions: 5_000 });
		assert.equal(nr.tax, 3_590 + 4_740);
		// Half the month worked in China: 15,000 − 5,000 = 10,000 → 790; bonus 30,000 / 6 = 5,000 → (500 − 210) × 6 = 1,740.
		assert.equal(
			assess({
				...nonResident({ china_workday_share: 0.5 }),
				month: { ordinary: 30_000, bonus: 60_000, deductions: 0 }
			}).tax,
			790 + 1_740
		);
		// A second bonus in the year merges into the month for a non-resident too.
		assert.deepEqual(
			assess({
				...nonResident(),
				month: { ordinary: 30_000, bonus: 60_000, deductions: 0 },
				year: { ordinary: 0, bonus: 50_000, deductions: 0 }
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
				month: { ordinary: 0, bonus: 0, deductions: 0 },
				base: { ordinary: 0, bonus: 0, deductions: 0, separation: 500_000 }
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
		const days = (wanted: string, facts: Row = {}, employee: Row = {}) =>
			entitlementDays(
				code('version_3', 'leave_catalog', wanted).entitlement as Parameters<
					typeof entitlementDays
				>[0],
				130,
				{
					as_of: '2026-06-30',
					employment,
					employee: { children: [], ...employee },
					entry: entry({ event_id: 'b1', ...facts })
				}
			);
		assert.equal(days('MATERNITY_LEAVE'), 98);
		assert.equal(days('MATERNITY_LEAVE', { difficult_birth: true, babies: 2 }), 128);
		assert.equal(days('MATERNITY_LEAVE', { miscarriage_months: 3 }), 15);
		assert.equal(days('MATERNITY_LEAVE', { miscarriage_months: 5 }), 42);
		assert.equal(days('MATERNITY_EXTENSION_SH'), 60);
		assert.equal(days('MATERNITY_EXTENSION_KM', { miscarriage_months: 5 }), 0);
		assert.equal(days('PATERNITY_LEAVE_SH'), 10);
		assert.equal(days('PATERNITY_LEAVE_KM'), 30);
		assert.equal(days('MARRIAGE_EXTENSION_KM'), 15);
		const kids = (...births: string[]) => ({
			children: births.map((child_birthdate) => ({ child_birthdate }))
		});
		assert.equal(days('CHILDCARE_LEAVE_SH', {}, kids('2024-01-01')), 5);
		assert.equal(days('CHILDCARE_LEAVE_SH', {}, kids('2020-01-01')), 0);
		assert.equal(days('CHILDCARE_LEAVE_KM', {}, kids('2024-01-01')), 10);
		assert.equal(days('CHILDCARE_LEAVE_KM', {}, kids('2024-01-01', '2025-06-01')), 15);
		for (const wanted of [
			'MATERNITY_LEAVE',
			'PATERNITY_LEAVE_SH',
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
				entitlementDays(entitlement, months, { as_of, employment: { ...employment, ...over } });
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
		}
	});

	it('Shanghai sick pay follows the 沪劳保发〔1995〕83号 scale with the 80% minimum-wage floor; Kunming pays in full', () => {
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
		assert.equal(fraction('KM', '2025-01-01', 1), 1);
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
		const minimum = rulesOf('version_3').minimum_wage as { by_region: Record<string, Row[]> };
		assert.deepEqual(
			minimum.by_region.KM_1!.map((row) => [row.from, row.amount]),
			[
				['2026-09-01', 2270],
				['2025-10-01', 2170]
			]
		);
	});

	it('every obligation names a trigger, cites its authority and its due evaluates to a date', () => {
		const company = { region: 'SH', facts: { established_on: '2026-03-02' } };
		const period = { key: '2026-03', from: '2026-03-01', to: '2026-03-31' };
		const contexts: Record<string, Row> = {
			PAYROLL_RUN: { period, company },
			HIRE: { period, company, hired_on: '2026-03-02' },
			EXIT: { period, company, exit_on: '2026-06-30' },
			'entity.created': { period, company, row: { id: 'c1' } },
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
			assert.equal(rows.length, 26);
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
					String(evaluateConfigured(rules.due, contexts[rules.trigger]!)),
					/^\d{4}-\d{2}-\d{2}$/
				);
				if (rules.applies_when !== undefined)
					assert.equal(
						typeof evaluateConfigured(rules.applies_when, {
							...contexts[rules.trigger]!,
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
					rows,
					collection,
					event,
					row,
					reads: {
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
			assert.equal(april.length, 3);
			assert.equal(due(april, 'IIT_MONTHLY_DECLARATION'), '2026-05-15');
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
					rows,
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
			assert.equal(hired.length, 5);
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
			assert.equal(foreign('HK').length, 5);
			const left = (exit_ground: string) => ({
				...contract,
				exit_ground,
				effective_range: { from: '2026-03-02', to: '2026-06-30' },
				exit_facts: {}
			});
			const exitsOn = (ground: string) =>
				raise('employment_contract', 'updated', left(ground), { catalogues: [], movements: [] });
			const exits = exitsOn('RESIGNATION');
			assert.equal(exits.length, 6);
			assert.equal(due(exits, 'EMPLOYMENT_DEREGISTRATION'), '2026-07-15');
			assert.equal(due(exits, 'ECONOMIC_COMPENSATION_PAYMENT'), undefined);
			const layoff = exitsOn('ECONOMIC_LAYOFF');
			assert.equal(layoff.length, 8);
			assert.equal(due(layoff, 'ECONOMIC_LAYOFF_REPORT'), '2026-05-31');
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
					rows,
					collection: 'employment_contract',
					event: 'updated',
					headcount: 100,
					row: { ...left('ECONOMIC_LAYOFF'), exit_facts: { layoff_batch_size: size } },
					reads: { company: [{ region: 'SH', facts: {} }], catalogues: [], movements: [] }
				}).map((write) => String(write.duty_code));
			assert.equal(batch(3).includes('ECONOMIC_LAYOFF_REPORT'), false);
			assert.equal(batch(25).includes('ECONOMIC_LAYOFF_REPORT'), true);
			assert.equal(due(exits, 'SI_FILE_TRANSFER'), '2026-07-15');
			assert.equal(due(exits, 'TERMINATED_CONTRACT_RETENTION'), '2028-06-30');
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
							facts: { hpf_rate_percent: 12, km_hpf_zone: '1' },
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
		const engine = (tables: Map<string, Row[]>) => {
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
			// 2026: unemployment not seeded (GAP), so 30,000 − 5,000 − 3,000 − 2,100 − 3,500 = 16,400 at 3%.
			assert.deepEqual(lines(january).IIT, [492, 0]);
			assert.equal(lines(january).UNEMPLOYMENT, undefined);
			const february = (await run(COMPANY.SH, '2026-02', 'REGULAR')).payslips[0]!;
			// Cumulative 32,800: 3% up to 36,000 → 984 − 492 = 492.
			assert.deepEqual(lines(february).IIT, [492, 0]);
			const march = (await run(COMPANY.SH, '2026-03', 'REGULAR')).payslips[0]!;
			// Cumulative 49,200 crosses 36,000: 1,080 + 13,200 × 10% = 2,400 − 984 = 1,416.
			assert.deepEqual(lines(march).IIT, [1416, 0]);
			assert.equal(march.net, 30_000 - 2400 - 600 - 2100 - 1416);
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
				UNEMPLOYMENT: [13.07, 30.5],
				WORK_INJURY: [0, 30.5],
				HPF: [360, 360],
				IIT: [65.77, 0]
			});
			const january = of(await run(COMPANY.KM, '2026-01', 'REGULAR'), 'k-p2');
			// 2026: floor 4,403 (云人社发〔2026〕8号); the HPF floor (the class-1 minimum wage) leaves 3,000.
			assert.deepEqual(lines(january).PENSION, [352.24, 704.48]);
			assert.deepEqual(lines(january).WORK_INJURY, [0, 30.82]);
			assert.deepEqual(lines(january).MEDICAL, [86.12, 340.17]);
			// The Kunming HPF floor is the class-1 minimum wage: 2,170 in August, 2,270 from 1 September 2026.
			const august = of(await run(COMPANY.KM, '2026-08', 'REGULAR'), 'k-p3');
			assert.deepEqual(lines(august).HPF, [260, 260]);
			const september = of(await run(COMPANY.KM, '2026-09', 'REGULAR'), 'k-p3');
			assert.deepEqual(lines(september).HPF, [272, 272]);
			// The medical base limits move on 1 September 2026 (云人社发〔2026〕8号): 4,403 floor.
			assert.deepEqual(lines(august).MEDICAL, [86.12, 340.17]);
			assert.deepEqual(lines(september).MEDICAL, [88.06, 347.84]);
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
			assert.deepEqual(after['k-p1:IIT'], [1416 + 5790, 0]);
			assert.ok(after['k-p2:IIT']![0] > 0);
			assert.deepEqual(after['k-p1:PENSION'], [2400, 4800]);
		});
	});
});
