/** TH public lineage: snapshot structure, CEL on the engine context, obligations and statutory amounts per version. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
	effectWrites,
	planBehaviours,
	type Behaviours
} from '../src/lib/payroll_engine/behaviours.js';
import { Effect } from 'effect';
import { evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { Reads } from '../src/lib/payroll_engine/foundation.js';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.js';
import { entitlementDays } from '../src/lib/payroll_engine/leave.js';
import { dutiesOf, raiseDuties, triggerOf, withBalances } from './duties.ts';

type Row = { [key: string]: unknown };
type Rule = { when?: string; employee?: string; employer?: string };
type Configuration = {
	assessment?: string;
	assessable?: { [part: string]: string };
	rules?: Rule[];
	refuse_when?: { when: string; message: string }[];
};
type Schema = {
	type?: unknown;
	properties?: { [key: string]: Schema };
	items?: Schema;
	[key: string]: unknown;
};

const root = resolve(process.cwd(), 'seed/jurisdiction');
const lineage = resolve(root, 'TH');
const FILES = [
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
const versionsOf = (directory: string) =>
	readdirSync(directory)
		.filter((name) => name.startsWith('version_'))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const VERSIONS = versionsOf(lineage);
const load = (directory: string, file: string): Row[] =>
	JSON.parse(readFileSync(resolve(directory, `${file}.json`), 'utf8')) as Row[];
const rows = (version: string, file: string) => load(resolve(lineage, version), file);
const settings = (version: string): Row => {
	const [row] = rows(version, 'jurisdiction_settings');
	assert.ok(row);
	return row;
};
const find = (version: string, file: string, code: string): Row => {
	const row = rows(version, file).find((item) => item.code === code);
	assert.ok(row, `${version} ${file} ${code}`);
	return row;
};

/** The subject roots `subjectContext` builds. */
const subject = (
	overrides: { employee?: Row; company?: Row; terms?: Row; employment?: Row } = {}
) => {
	const employment = {
		classification: 'ORDINARY',
		service_months: 40,
		exit_date: '',
		exit_ground: '',
		exit_facts: {},
		start_date: '2020-01-01',
		...overrides.employment
	};
	return {
		employee: {
			gender: 'FEMALE',
			marital_status: 'SINGLE',
			spouse_status: 'NONE',
			solo_parent: false,
			disabled: false,
			receiving_pension: false,
			nationality: 'TH',
			date_of_birth: '1990-01-01',
			age: 36,
			children: [],
			dependents_count: 0,
			facts: {},
			...overrides.employee
		},
		company: {
			region: 'BANGKOK',
			risk_class: '0101',
			pay_frequency: 'MONTHLY',
			facts: { wcf_rate_percent: 0.2 },
			...overrides.company
		},
		terms: {
			work_classification: 'ORDINARY',
			statutory_work_category: '',
			employment_type: 'PERMANENT',
			residency_status: 'RESIDENT',
			residency_since: '',
			base_salary: 30_000,
			monthly_wage: 30_000,
			facts: {},
			...overrides.terms
		},
		employment,
		person: { employment, residency_status: 'RESIDENT' }
	};
};

type Standing = { [code: string]: { kind: string; elections: Row } };
type Amounts = { employee: number; employer: number };
type SlipOptions = {
	/** The scheme's assessed wage in earlier months of the year (`year.ordinary`). */
	year?: number;
	/** The calendar month of the slip (`period.month`); January by default, so annualising starts afresh. */
	month?: number;
	standing?: Standing;
	/** Earlier months' charges per scheme (`charged.year`). */
	charged?: { [code: string]: Amounts };
	/** This slip's PND1 severance part (`wage.severance`). */
	severance?: number;
	/** The entity's contracts in force (`headcount`). */
	headcount?: number;
};

/** One salary slip's statutory lines the way `assessStatutory` makes them: every scheme in catalogue order. */
const slip = (
	version: string,
	wage: number,
	overrides: Parameters<typeof subject>[0] = {},
	options: SlipOptions = {}
): { [code: string]: Amounts } => {
	const schemes = rows(version, 'statutory_contribution_catalog') as (Row & {
		code: string;
		configuration: Configuration;
	})[];
	const zero = () =>
		Object.fromEntries(schemes.map((row) => [row.code, { employee: 0, employer: 0 }]));
	const charged = { year: { ...zero(), ...options.charged }, month: zero() };
	const standing = options.standing ?? {};
	const month = options.month ?? 1;
	const base = subject({ ...overrides, terms: { monthly_wage: wage, ...overrides.terms } });
	const out: { [code: string]: Amounts } = {};
	for (const { code, configuration } of schemes) {
		let context: Row = {
			...base,
			wage: { ordinary: wage, severance: options.severance ?? 0 },
			month: { ordinary: wage, severance: options.severance ?? 0 },
			year: { ordinary: options.year ?? 0, severance: 0 },
			period: {
				key: `2026-${String(month).padStart(2, '0')}`,
				from: `2026-${String(month).padStart(2, '0')}-01`,
				days: 30,
				month,
				salary_paid: false,
				part: 1,
				parts: 1
			},
			rules: payrollRules(version),
			headcount: options.headcount ?? 5,
			charged,
			elections: Object.fromEntries(
				Object.entries(standing).map(([key, held]) => [key, held.elections])
			),
			scheme: {
				code,
				standing: standing[code]?.kind ?? '',
				elections: standing[code]?.elections ?? {}
			}
		};
		const part = (name: 'ordinary' | 'severance', paid: number) => {
			const expression = configuration.assessable?.[name];
			return Math.max(
				0,
				expression == null ? paid : Number(evaluateConfigured(expression, context))
			);
		};
		const ordinary = part('ordinary', wage);
		const severance = part('severance', options.severance ?? 0);
		const assessed = ordinary + severance;
		context = { ...context, base: { ordinary, severance, assessed, amount: assessed } };
		for (const guard of configuration.refuse_when ?? [])
			if (evaluateConfigured(guard.when, context) === true) throw new Error(guard.message);
		out[code] = { employee: 0, employer: 0 };
		for (const rule of configuration.rules ?? []) {
			if (rule.when != null && evaluateConfigured(rule.when, context) !== true) continue;
			out[code] = {
				employee: Number(evaluateConfigured(rule.employee ?? '0.0', context)),
				employer: Number(evaluateConfigured(rule.employer ?? '0.0', context))
			};
			break;
		}
		charged.month[code] = out[code];
	}
	return out;
};
const charge = (
	version: string,
	code: string,
	wage: number,
	overrides: Parameters<typeof subject>[0] = {},
	options: SlipOptions = {}
): Amounts => slip(version, wage, overrides, options)[code]!;
const member = (employee_percent: number): SlipOptions => ({
	standing: { PVD: { kind: 'MEMBER', elections: { employee_percent } } }
});
const taxpayer = (elections: Row, others: Standing = {}): SlipOptions => ({
	standing: { PND1: { kind: 'TAXPAYER', elections }, ...others }
});

const payrollRules = (version: string) =>
	Object.fromEntries(
		rows(version, 'rule_set')
			.filter((row) => row.family === 'PAYROLL')
			.map((row) => [String(row.code), row.rules])
	);
const entry = (facts: Row, amount = 30_000, quantity = 1) => ({
	amount,
	quantity,
	occurred_on: '2026-10-31',
	due_on: '2026-10-31',
	incurred_on: '2026-10-31',
	...facts,
	facts
});
/** One `work.days[]` day: its day type, holiday kind, recorded hours and approved overtime. */
const day = (
	date: string,
	day_type: string,
	holiday_kind: string,
	worked: number,
	overtime: number
) => ({
	date,
	day_type,
	shift_code: day_type === 'WORK' ? 'D' : '',
	holiday_kind,
	scheduled_hours: day_type === 'WORK' ? 8 : 0,
	worked_hours: worked,
	overtime_hours: overtime,
	incentive_hours: 0,
	intervals: []
});
/** One `leave.rows[]` row as the payslip projects it. */
const leaveRow = (code: string, activity: string, days: number, extra: Row = {}) => ({
	code,
	activity,
	days,
	from: '2026-10-20',
	to: '2026-10-20',
	is_npl: false,
	can_encash: false,
	event_id: '',
	month_index: 1,
	facts: {},
	pay_fraction: 1,
	...extra
});
/** The payslip build context (`buildPayslip`). */
const salaryContext = (version: string, overrides: Parameters<typeof subject>[0] = {}) => ({
	...subject(overrides),
	rules: payrollRules(version),
	period: {
		key: '2026-10',
		from: '2026-10-01',
		to: '2026-10-31',
		days: 31,
		paid_days: 31,
		part: 1,
		parts: 1
	},
	work: {
		overtime_hours: 7,
		incentive_hours: 0,
		dates: ['2026-10-12', '2026-10-13', '2026-10-18'],
		holidays: [{ date: '2026-10-13', kind: 'PUBLIC_HOLIDAY', given_to: 'EVERYONE', replaces: '' }],
		days: [
			day('2026-10-12', 'WORK', '', 12, 4),
			day('2026-10-13', 'WORK', 'PUBLIC_HOLIDAY', 10, 2),
			day('2026-10-14', 'WORK', '', 8, 0),
			day('2026-10-18', 'REST', '', 9, 1),
			day('2026-10-19', 'WORK', '', 0, 0)
		]
	},
	leave: {
		rows: [
			leaveRow('UNPAID_LEAVE', 'TIME_OFF', 2, { is_npl: true }),
			leaveRow('CHILD_CARE_LEAVE', 'TIME_OFF', 3, { pay_fraction: 0.5 }),
			leaveRow('SICK_LEAVE', 'TIME_OFF', 1),
			leaveRow('ANNUAL_LEAVE', 'ENCASHMENT', 3, { can_encash: true })
		]
	}
});
const ENTRY_FACTS = { service_from: '2020-01-01' };
const payslipContext = (
	version: string,
	facts: Row = ENTRY_FACTS,
	amount = 30_000,
	quantity = 1
) => ({
	...salaryContext(version),
	entry: entry(facts, amount, quantity)
});
/** The entry admission context (`admitEntry`): the subject and the entry, no rules. */
const admitContext = (overrides: Parameters<typeof subject>[0] = {}) => ({
	...subject(overrides),
	entry: entry(ENTRY_FACTS)
});

const fieldsOf = async (collection: string, path: string): Promise<Set<string>> => {
	const model = (await import(`../src/data/model/${path}/+model.js`)) as {
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

/** Every CEL text a version carries (catalogue rows, statutory configuration, obligation `due`). */
const celOf = (version: string): string[] => {
	const out: string[] = [];
	const CEL = new Set([
		'when',
		'due',
		'eligibility',
		'qualifies_when',
		'quantity',
		'rate',
		'amount',
		'days',
		'employee',
		'employer',
		'ordinary'
	]);
	const walk = (value: unknown, key = ''): void => {
		if (Array.isArray(value)) value.forEach((item) => walk(item, key));
		else if (value != null && typeof value === 'object')
			for (const [child, item] of Object.entries(value)) walk(item, child);
		else if (typeof value === 'string' && CEL.has(key) && value.trim() !== '') out.push(value);
	};
	for (const file of FILES.slice(1)) walk(rows(version, file));
	return out;
};

const schemaShaped = (schema: Schema, where: string): void => {
	if (schema.type != null) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		for (const type of types)
			assert.ok(
				['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(
					String(type)
				),
				`${where}: type ${String(type)}`
			);
	}
	if (schema.enum != null)
		assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0, `${where}: enum`);
	for (const [key, child] of Object.entries(schema.properties ?? {}))
		schemaShaped(child, `${where}.${key}`);
	if (schema.items != null) schemaShaped(schema.items, `${where}[]`);
};

const OBLIGATION_CODES = [
	'SSO_CONTRIBUTION_REMITTANCE',
	'PND1_FILING',
	'PND1_KOR_ANNUAL',
	'WITHHOLDING_CERTIFICATE_ANNUAL',
	'WCF_ANNUAL_CONTRIBUTION',
	'WCF_WAGE_STATEMENT',
	'EMPLOYMENT_CONDITIONS_REPORT',
	'DISABLED_EMPLOYMENT_QUOTA',
	'SSO_REGISTRATION',
	'EMPLOYEE_REGISTER',
	'SSO_EXIT_NOTIFICATION',
	'FINAL_PAY',
	'WITHHOLDING_CERTIFICATE_ON_EXIT',
	'FOREIGN_WORKER_HIRE_NOTIFICATION',
	'FOREIGN_WORKER_EXIT_NOTIFICATION',
	'WCF_ADDITIONAL_CONTRIBUTION',
	'EMPLOYER_REGISTRATION',
	'PVD_REMITTANCE',
	'WORK_RULES',
	'WORK_INJURY_NOTIFICATION',
	'WORK_RULES_FILING',
	'WCF_CLOSING_WAGE_STATEMENT'
];
const codesOn = (version: string) =>
	version === 'version_4'
		? [...OBLIGATION_CODES.slice(0, 18), 'EWF_REMITTANCE', ...OBLIGATION_CODES.slice(18)]
		: OBLIGATION_CODES;

describe('TH jurisdiction seed', () => {
	it('every version holds settings, rule_set and every catalogue file', () => {
		assert.deepEqual(VERSIONS, ['version_1', 'version_2', 'version_3', 'version_4']);
		for (const version of VERSIONS)
			for (const file of FILES)
				assert.equal(
					existsSync(resolve(lineage, version, `${file}.json`)),
					true,
					`${version}/${file}`
				);
	});

	it('ids are unique across every lineage and version, and each row names its own version', () => {
		const seen = new Map<string, string>();
		for (const code of readdirSync(root))
			for (const version of versionsOf(resolve(root, code)))
				for (const file of readdirSync(resolve(root, code, version)).filter((name) =>
					name.endsWith('.json')
				))
					for (const row of load(resolve(root, code, version), file.slice(0, -5))) {
						const where = `${code}/${version}/${file}:${String(row.code)}`;
						if (code === 'TH')
							assert.equal(
								seen.has(String(row.id)),
								false,
								`${where} reuses ${seen.get(String(row.id))}`
							);
						seen.set(String(row.id), where);
					}
		const th = [...seen.entries()].filter(([, where]) => where.startsWith('TH/'));
		const ids = new Set(th.map(([id]) => id));
		for (const [id, where] of seen)
			if (!where.startsWith('TH/')) assert.equal(ids.has(id), false, where);
		for (const version of VERSIONS) {
			const id = settings(version).id;
			for (const file of FILES.slice(1))
				for (const row of rows(version, file))
					assert.equal(row.settings_id, id, `${version}/${file}`);
		}
	});

	it('versions chain by cloned_from_id and cover time without a gap or an overlap', () => {
		let previous: Row | undefined;
		for (const version of VERSIONS) {
			const row = settings(version);
			const range = row.effective_range as { from: string; to: string | null };
			assert.equal(row.code, 'TH');
			assert.equal(row.jurisdiction_code, 'TH');
			assert.ok(row.sealed_at, `${version} is sealed`);
			assert.equal(row.voided_at, null);
			if (previous === undefined) {
				assert.equal(row.cloned_from_id, undefined);
				assert.equal(range.from, '2025-12-01');
			} else {
				const before = previous.effective_range as { from: string; to: string | null };
				assert.equal(row.cloned_from_id, previous.id);
				assert.ok(before.to);
				const next = new Date(`${before.to}T00:00:00Z`);
				next.setUTCDate(next.getUTCDate() + 1);
				assert.equal(
					range.from,
					next.toISOString().slice(0, 10),
					`${version} starts the day after`
				);
			}
			assert.deepEqual(row.payroll, {
				currency: 'THB',
				timezone: 'Asia/Bangkok',
				tax_year_start_month: 1
			});
			previous = row;
		}
		assert.equal((previous?.effective_range as { to: unknown }).to, null);
	});

	it('every row key exists on its target model', async () => {
		for (const file of FILES) {
			const fields = await fieldsOf(file, `jurisdiction/${file}`);
			for (const version of VERSIONS)
				for (const row of rows(version, file))
					for (const key of Object.keys(row))
						assert.equal(fields.has(key), true, `${version}/${file}:${String(row.code)}.${key}`);
		}
	});

	it('codes are stable: catalogues keep their codes across versions; LPA No. 9 adds two leaves, the EWF one scheme', () => {
		const codes = (version: string, file: string) =>
			rows(version, file).map((row) => String(row.code));
		for (const file of ['adhoc_catalog', 'allowance_catalog', 'loan_catalog', 'work_catalog'])
			for (const version of VERSIONS)
				assert.deepEqual(codes(version, file), codes('version_1', file), file);
		// The Employee Welfare Fund starts on 1 October 2026 (version_4): one scheme and its remittance.
		for (const file of ['statutory_contribution_catalog', 'rule_set'])
			for (const version of VERSIONS.slice(0, 3))
				assert.deepEqual(codes(version, file), codes('version_1', file), file);
		assert.deepEqual(codes('version_4', 'statutory_contribution_catalog'), [
			...codes('version_3', 'statutory_contribution_catalog'),
			'EWF'
		]);
		assert.deepEqual(
			codes('version_4', 'rule_set').toSorted(),
			[...codes('version_3', 'rule_set'), 'EWF_REMITTANCE'].toSorted()
		);
		assert.deepEqual(
			codes('version_2', 'leave_catalog').filter(
				(code) => !codes('version_1', 'leave_catalog').includes(code)
			),
			['CHILD_CARE_LEAVE', 'PATERNITY_LEAVE']
		);
		assert.deepEqual(codes('version_3', 'leave_catalog'), codes('version_2', 'leave_catalog'));
		assert.deepEqual(codes('version_4', 'leave_catalog'), codes('version_2', 'leave_catalog'));
	});

	it('both input schemas are JSON Schema 2020-12 and declare every fact the CEL reads', () => {
		for (const version of VERSIONS) {
			const row = settings(version);
			const employee = row.employee_input_schema as Schema;
			const entity = row.entity_input_schema as Schema;
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
				assert.equal(schema.type, 'object', name);
				schemaShaped(schema, `${version} ${name}`);
			}
			const terms = employee.properties?.contract_terms?.items?.properties ?? {};
			assert.deepEqual(Object.keys(employee.properties ?? {}), [
				'contract_terms',
				'exit_facts',
				'employment_statutory_facts',
				'facts'
			]);
			const employeeFacts = employee.properties?.facts?.properties ?? {};
			const elections =
				(
					employee.properties?.employment_statutory_facts?.items?.properties?.status?.properties
						?.elections as Schema | undefined
				)?.properties ?? {};
			for (const column of ['gender', 'marital_status', 'nationality', 'region', 'risk_class'])
				assert.equal(column in employeeFacts || column in (entity.properties ?? {}), false, column);
			const entityFacts = entity.properties ?? {};
			assert.equal((terms.currency as Schema).const, 'THB');
			for (const key of ['sso_employer_account_number', 'tax_id', 'wcf_rate_percent'])
				assert.ok(entityFacts[key], key);
			const read = (pattern: RegExp) =>
				new Set(
					celOf(version).flatMap((text) => [...text.matchAll(pattern)].map((match) => match[1]!))
				);
			for (const key of read(/scheme\.elections\.(\w+)/g))
				assert.ok(elections[key], `${version} scheme.elections.${key}`);
			for (const key of read(/employee\.facts\.(\w+)/g))
				assert.ok(employeeFacts[key], `${version} employee.facts.${key}`);
			for (const key of read(/company\.facts\.(\w+)/g))
				assert.ok(entityFacts[key], `${version} company.facts.${key}`);
			// `terms.monthly_wage` is the engine's own sum of base salary and allowances, not an input.
			for (const key of read(/terms\.(\w+)/g))
				if (key !== 'monthly_wage') assert.ok(terms[key], `${version} terms.${key}`);
			assert.deepEqual([...read(/scheme\.elections\.(\w+)/g)].toSorted(), [
				'child_allowance_count',
				'employee_percent',
				'other_annual_deductions',
				'second_child_from_2018_count'
			]);
		}
	});

	it('every catalogue CEL evaluates on the engine context', () => {
		const bool = (expression: unknown, context: Row, where: string) => {
			if (expression == null || String(expression).trim() === '') return;
			assert.equal(typeof evaluateConfigured(String(expression), context), 'boolean', where);
		};
		const number = (expression: unknown, context: Row, where: string) =>
			assert.equal(typeof evaluateConfigured(String(expression), context), 'number', where);
		for (const version of VERSIONS) {
			const salary = salaryContext(version);
			for (const row of rows(version, 'work_catalog')) {
				const where = `${version} work ${String(row.code)}`;
				bool(row.eligibility, salary, where);
				number(row.quantity, salary, where);
				number(row.rate, salary, where);
			}
			for (const row of rows(version, 'allowance_catalog')) {
				bool(row.eligibility, salary, `${version} allowance ${String(row.code)}`);
				number(
					row.amount,
					{ ...salary, allowance: { code: row.code, amount: 2_000 } },
					String(row.code)
				);
			}
			for (const file of ['adhoc_catalog', 'claim_catalog', 'loan_catalog'])
				for (const row of rows(version, file)) {
					const where = `${version} ${file} ${String(row.code)}`;
					for (const context of [admitContext(), payslipContext(version)]) {
						bool(row.eligibility, context, where);
						bool(row.qualifies_when, context, where);
					}
					for (const band of (row.bands ?? []) as { when?: string; amount: string }[]) {
						bool(band.when, payslipContext(version), where);
						number(band.amount, payslipContext(version), where);
					}
				}
			for (const row of rows(version, 'leave_catalog')) {
				bool(row.eligibility, admitContext(), `${version} leave ${String(row.code)}`);
				const entitlement = row.entitlement as Parameters<typeof entitlementDays>[0] | undefined;
				if (entitlement != null)
					assert.ok(
						Number.isFinite(
							entitlementDays(entitlement, 30, { ...subject(), as_of: '2026-10-31' })
						),
						String(row.code)
					);
			}
			for (const code of ['SSO', 'WCF', 'PVD', 'PND1'])
				for (const wage of [1_000, 30_000, 900_000]) {
					const { employee, employer } = charge(
						version,
						code,
						wage,
						{},
						taxpayer({ child_allowance_count: 2 }, member(5).standing)
					);
					assert.ok(Number.isFinite(employee) && Number.isFinite(employer), `${version} ${code}`);
				}
		}
	});

	it('SSF: 5% each side on 1,650 to 15,000, then 17,500 from 1 January 2026', () => {
		for (const version of ['version_1', 'version_2']) {
			assert.deepEqual(charge(version, 'SSO', 10_000), { employee: 500, employer: 500 });
			assert.deepEqual(charge(version, 'SSO', 20_000), { employee: 750, employer: 750 });
		}
		assert.deepEqual(charge('version_3', 'SSO', 20_000), { employee: 875, employer: 875 });
		assert.deepEqual(charge('version_3', 'SSO', 16_000), { employee: 800, employer: 800 });
		assert.deepEqual(charge('version_3', 'SSO', 1_000), { employee: 83, employer: 83 });
		// SSA s.33: insured when aged 15 to 60 at entry; insured staff who reach 60 stay insured.
		const entering = (date_of_birth: string, start_date: string) =>
			charge('version_3', 'SSO', 20_000, {
				employee: { date_of_birth },
				employment: { start_date }
			}).employee;
		assert.equal(entering('1960-01-01', '2015-01-01'), 875);
		assert.equal(entering('1964-06-01', '2025-01-01'), 875);
		assert.equal(entering('1963-06-01', '2025-01-01'), 0);
		assert.equal(entering('', '2025-01-01'), 875);
	});

	it("WCF: the employer's notified rate on at most 240,000 baht a year, refusing without a rate", () => {
		assert.deepEqual(charge('version_3', 'WCF', 30_000), { employee: 0, employer: 60 });
		assert.deepEqual(charge('version_3', 'WCF', 30_000, {}, { year: 230_000 }), {
			employee: 0,
			employer: 20
		});
		assert.deepEqual(charge('version_3', 'WCF', 30_000, {}, { year: 240_000 }), {
			employee: 0,
			employer: 0
		});
		assert.deepEqual(
			charge('version_3', 'WCF', 30_000, { company: { facts: { wcf_rate_percent: 1.0 } } }),
			{
				employee: 0,
				employer: 300
			}
		);
		assert.throws(
			() => charge('version_3', 'WCF', 30_000, { company: { facts: {} } }),
			/wcf_rate_percent/
		);
		// Without a notified experience rate the Table 1 rate of the business code applies, rounded to the baht.
		const byCode = (risk_class: string, wage = 30_000) =>
			charge('version_4', 'WCF', wage, { company: { risk_class, facts: {} } }).employer;
		assert.equal(byCode('01111'), 60);
		assert.equal(byCode('02200'), 300);
		assert.equal(byCode('01136', 10_111), 45);
		const table = (payrollRules('version_1').wcf_rate as { by_code: { [code: string]: number } })
			.by_code;
		assert.equal(Object.keys(table).length, 1_091);
		assert.deepEqual(
			[Math.min(...Object.values(table)), Math.max(...Object.values(table))],
			[0.2, 1.0]
		);
	});

	it('provident fund: members only, employer at least the member rate and at most 15%', () => {
		assert.deepEqual(charge('version_3', 'PVD', 30_000), { employee: 0, employer: 0 });
		assert.deepEqual(charge('version_3', 'PVD', 30_000, {}, member(5)), {
			employee: 1_500,
			employer: 1_500
		});
		assert.deepEqual(
			charge(
				'version_3',
				'PVD',
				30_000,
				{ company: { facts: { wcf_rate_percent: 0.2, pvd_employer_percent: 10 } } },
				member(3)
			),
			{ employee: 900, employer: 3_000 }
		);
	});

	it('PND1: annualised progressive withholding with expense, personal, spouse, child and SSF deductions', () => {
		assert.equal(charge('version_3', 'PND1', 50_000).employee, 1_704.17);
		assert.equal(charge('version_1', 'PND1', 50_000).employee, 1_716.67);
		assert.equal(charge('version_3', 'PND1', 25_000).employee, 0);
		assert.equal(
			charge(
				'version_3',
				'PND1',
				50_000,
				{ employee: { marital_status: 'MARRIED', spouse_status: 'WITHOUT_INCOME' } },
				taxpayer({ child_allowance_count: 2, second_child_from_2018_count: 1 })
			).employee,
			539.58
		);
		// 500,000 a month: 6,000,000 a year; 5,829,500 net; 1,265,000 to 5,000,000 plus 35% of 829,500.
		assert.equal(charge('version_3', 'PND1', 500_000).employee, 129_610.42);
		// A provident fund member deducts the contribution: 5% of 50,000 × 12 = 30,000 less taxable income.
		assert.equal(charge('version_3', 'PND1', 50_000, {}, member(5)).employee, 1_454.17);
		// The SSF and PVD deductions are the charges of the schemes before PND1 on the same slip.
		assert.equal(slip('version_3', 50_000, {}, member(5)).PVD!.employee, 2_500);
	});

	it('PND1: December trues the year up, and a bonus is withheld in full in the month it is paid', () => {
		// Eleven months of 50,000 withheld at 1,704.17: December settles the year's 20,450 exactly.
		const december = charge(
			'version_3',
			'PND1',
			50_000,
			{},
			{
				month: 12,
				year: 550_000,
				charged: {
					PND1: { employee: 18_745.87, employer: 0 },
					SSO: { employee: 9_625, employer: 9_625 }
				}
			}
		);
		assert.equal(december.employee, 1_704.13);
		// A mid-year raise to 60,000 from July: the rest of the year carries the tax not yet withheld.
		const july = charge(
			'version_3',
			'PND1',
			60_000,
			{},
			{
				month: 7,
				year: 300_000,
				charged: {
					PND1: { employee: 10_225.02, employer: 0 },
					SSO: { employee: 5_250, employer: 5_250 }
				}
			}
		);
		// 660,000 a year: 660,000 - 100,000 - 60,000 - 10,500 = 489,500 → 26,450; (26,450 - 10,225.02) / 6.
		assert.equal(july.employee, 2_704.16);
		// January 50,000 salary + 100,000 bonus: 1,704.17 for the salary and the whole 11,475 the bonus adds.
		assert.equal(
			charge('version_3', 'PND1', 150_000, { terms: { monthly_wage: 50_000 } }).employee,
			13_179.17
		);
	});

	it("PND1: severance is exempt up to 300 days' wages and 300,000, except on retirement or a fixed term ending", () => {
		// January, 50,000 salary, 600,000 severance: 300,000 exempt, the other 300,000 withheld in full this month.
		const paid = (exit_ground: string) =>
			charge('version_3', 'PND1', 50_000, { employment: { exit_ground } }, { severance: 600_000 })
				.employee;
		assert.equal(paid('REDUNDANCY'), 43_179.17);
		assert.equal(paid('RETIREMENT'), 103_629.17);
		// A small severance below ten months' base salary is wholly exempt.
		assert.equal(
			charge(
				'version_3',
				'PND1',
				50_000,
				{ employment: { exit_ground: 'DISMISSAL' } },
				{ severance: 150_000 }
			).employee,
			1_704.17
		);
		assert.deepEqual(find('version_3', 'adhoc_catalog', 'SEVERANCE_PAY').counts_toward, [
			'PND1.SEVERANCE'
		]);
	});

	it('Employee Welfare Fund from 1 October 2026: 0.25% each for an employer of ten or more, unless a PVD member', () => {
		assert.deepEqual(charge('version_4', 'EWF', 20_000, {}, { headcount: 12 }), {
			employee: 50,
			employer: 50
		});
		assert.deepEqual(charge('version_4', 'EWF', 20_000, {}, { headcount: 9 }), {
			employee: 0,
			employer: 0
		});
		assert.deepEqual(charge('version_4', 'EWF', 20_000, {}, { ...member(5), headcount: 12 }), {
			employee: 0,
			employer: 0
		});
		assert.equal(
			rows('version_3', 'statutory_contribution_catalog').some((row) => row.code === 'EWF'),
			false
		);
	});

	it('an OFF_CYCLE bonus before or after the REGULAR run settles to the same month totals', async () => {
		const law = (name: string): Row[] =>
			VERSIONS.flatMap((version) =>
				rows(version, name).map((row) => ({ approval_id: null, ...row }))
			);
		const COMPANY = 'th-co';
		const tables = new Map<string, Row[]>();
		const reset = () => {
			tables.clear();
			for (const name of FILES) tables.set(name, law(name));
			tables.set('entity', [
				{
					id: COMPANY,
					name: 'Siam',
					settings_code: 'TH',
					pay_frequency: 'MONTHLY',
					region: 'BANGKOK',
					facts: { wcf_rate_percent: 0.5 },
					approval_id: null
				}
			]);
			const staff = Array.from({ length: 10 }, (_, index) => ({
				id: `p${index + 1}`,
				salary: index === 0 ? 200_000 : 25_000
			}));
			tables.set(
				'employment_profile',
				staff.map(({ id }, index) => ({
					id,
					name: `Person ${id}`,
					gender: index % 2 === 0 ? 'MALE' : 'FEMALE',
					marital_status: 'SINGLE',
					date_of_birth: '1990-01-01'
				}))
			);
			tables.set(
				'employment_contract',
				staff.map(({ id: person, salary }) => ({
					id: `k-${person}`,
					employee_id: person,
					company_id: COMPANY,
					approval_id: null,
					effective_range: { from: '2024-01-01', to: null },
					facts: {
						contract_terms: [
							{
								base_salary: { value: salary, currency: 'THB' },
								effective_range: { from: '2024-01-01', to: null },
								residency_status: 'RESIDENT',
								work_classification: 'ORDINARY',
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
				'payroll_run'
			])
				tables.set(name, []);
		};
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
		const run = async (kind: PayrollRunKind, sources?: string[]) => {
			const plan = await Effect.runPromise(
				buildPayrollRun({
					company_id: COMPANY,
					period: '2026-10',
					kind,
					...(sources == null ? {} : { sources })
				}).pipe(Effect.provideService(Reads, reads))
			);
			const id = `run-${++runs}`;
			tables.get('payroll_run')!.push({ ...plan.run, id });
			for (const slip of plan.payslips) {
				const slipId = `${id}-${slip.employment_id}`;
				tables.get('payslip')!.push({ ...slip, id: slipId, payroll_run_id: id });
				for (const pin of slip.pins)
					tables.get(pin.collection)!.find((row) => row.id === pin.id)!.payslip_id = slipId;
			}
			return plan;
		};
		const bonus = () =>
			tables.get('adhoc_catalog_entry')!.push({
				id: 'bonus-1',
				employment_id: 'k-p1',
				company_id: COMPANY,
				catalog_id: find('version_4', 'adhoc_catalog', 'BONUS').id,
				approval_id: null,
				payslip_id: null,
				occurred_on: '2026-10-10',
				amount: 120_000
			});
		type Plan = Awaited<ReturnType<typeof run>>;
		const totals = (plans: Plan[]) =>
			Object.fromEntries(
				['SSO', 'WCF', 'PND1', 'EWF'].map((code) => {
					const lines = plans
						.flatMap((plan) => plan.payslips)
						.flatMap((slip) => slip.statutory)
						.filter((line) => line.scheme_code === code);
					const sum = (field: 'employee_amount' | 'employer_amount') =>
						Math.round(lines.reduce((total, line) => total + line[field], 0) * 100) / 100;
					return [code, [sum('employee_amount'), sum('employer_amount')]];
				})
			);
		reset();
		bonus();
		const together = totals([await run('REGULAR')]);
		reset();
		bonus();
		const before = totals([await run('OFF_CYCLE', ['bonus-1']), await run('REGULAR')]);
		reset();
		const salary = await run('REGULAR');
		bonus();
		const after = totals([salary, await run('OFF_CYCLE', ['bonus-1'])]);
		assert.deepEqual(before, together);
		assert.deepEqual(after, together);
		// The month as one slip: SSO capped at 17,500 for all ten; EWF (ten contracts in force) 0.25% of the wage only (the bonus is not wage).
		assert.deepEqual(together.SSO, [875 * 10, 875 * 10]);
		assert.deepEqual(together.EWF, [500 + 9 * 62.5, 500 + 9 * 62.5]);
		assert.ok((together.PND1 as number[])[0]! > 0);
	});

	it('work lines price LPA overtime, holiday work and overtime, daily wages, no-pay and part-paid leave and leave cash-out', () => {
		const amount = (
			version: string,
			code: string,
			overrides: Parameters<typeof subject>[0] = {}
		) => {
			const row = find(version, 'work_catalog', code);
			const context = salaryContext(version, overrides);
			return (
				Number(evaluateConfigured(String(row.quantity), context)) *
				Number(evaluateConfigured(String(row.rate), context))
			);
		};
		assert.equal(amount('version_3', 'OVERTIME'), 4 * 1.5 * 125);
		assert.equal(
			Math.round(
				amount('version_3', 'OVERTIME', { terms: { work_classification: 'HAZARDOUS' } }) * 100
			) / 100,
			857.14
		);
		// Holiday 13 Oct and rest day 18 Oct: 8 normal hours each at +1x (monthly) or 2x (daily-paid); their 3 OT hours at 3x.
		assert.equal(amount('version_3', 'HOLIDAY_WORK'), 16 * 125);
		assert.equal(amount('version_3', 'HOLIDAY_OVERTIME'), 3 * 3 * 125);
		const daily = { terms: { base_salary: 400, facts: { pay_basis: 'DAILY' } } };
		assert.equal(amount('version_3', 'HOLIDAY_WORK', daily), 16 * 2 * 50);
		assert.equal(amount('version_3', 'HOLIDAY_OVERTIME', daily), 3 * 3 * 50);
		assert.equal(amount('version_3', 'OVERTIME', daily), 4 * 1.5 * 50);
		// Daily wages: two plain working days, the worked holiday, 1.5 paid child-care days and a sick day.
		assert.equal(amount('version_3', 'BASIC_DAILY', daily), 5.5 * 400);
		const eligible = (code: string, overrides: Parameters<typeof subject>[0] = {}) =>
			evaluateConfigured(
				String(find('version_3', 'work_catalog', code).eligibility),
				salaryContext('version_3', overrides)
			);
		assert.equal(eligible('BASIC', daily), false);
		assert.equal(eligible('NO_PAY_LEAVE', daily), false);
		assert.equal(eligible('BASIC_DAILY'), false);
		// Two unpaid days and the unpaid half of three child-care days (s.59/1).
		assert.equal(amount('version_3', 'NO_PAY_LEAVE'), 3.5 * 1_000);
		assert.equal(amount('version_3', 'ENCASHMENT'), 3 * 1_000);
		// A semi-monthly half pays half the monthly salary for its days.
		const half = {
			...salaryContext('version_4'),
			period: { ...salaryContext('version_4').period, days: 15, paid_days: 15, part: 1, parts: 2 }
		};
		const basic = find('version_4', 'work_catalog', 'BASIC');
		assert.equal(
			Number(evaluateConfigured(String(basic.quantity), half)) *
				Number(evaluateConfigured(String(basic.rate), half)),
			15_000
		);
		// WCA s.5 and SSA s.5: overtime and holiday work are not wages for normal hours.
		for (const code of ['OVERTIME', 'HOLIDAY_WORK', 'HOLIDAY_OVERTIME'])
			assert.deepEqual(find('version_3', 'work_catalog', code).counts_toward, ['PND1'], code);
		assert.deepEqual(find('version_3', 'work_catalog', 'BASIC').counts_toward, [
			'SSO',
			'WCF',
			'PND1',
			'PVD'
		]);
		assert.deepEqual(find('version_4', 'work_catalog', 'BASIC').counts_toward, [
			'SSO',
			'WCF',
			'PND1',
			'PVD',
			'EWF'
		]);
	});

	it('validations: provincial minimum wage on the contract, the 36-hour week and the 10% loan cap on the slip', () => {
		const validation = (code: string) => {
			const row = find('version_4', 'rule_set', code);
			assert.equal(row.family, 'VALIDATIONS');
			return row.rules as { site: string; kind: string; when: string; message: string };
		};
		const minimum = validation('MINIMUM_WAGE');
		assert.deepEqual([minimum.site, minimum.kind], ['contract', 'refuse']);
		const underpaid = (region: string, term: Row, facts: Row = {}) => {
			const subjectRoots = subject({ company: { region, facts }, terms: term });
			return evaluateConfigured(minimum.when, {
				...subjectRoots,
				rules: payrollRules('version_4'),
				term: subjectRoots.terms
			});
		};
		assert.equal(underpaid('BANGKOK', { base_salary: 10_000, monthly_wage: 10_000 }), true);
		assert.equal(underpaid('BANGKOK', { base_salary: 12_000, monthly_wage: 12_000 }), false);
		assert.equal(underpaid('BANGKOK', { base_salary: 380, facts: { pay_basis: 'DAILY' } }), true);
		assert.equal(underpaid('NAN', { base_salary: 10_000, monthly_wage: 10_000 }), true);
		assert.equal(underpaid('NAN', { base_salary: 10_500, monthly_wage: 10_500 }), false);
		assert.equal(
			underpaid(
				'NAN',
				{ base_salary: 11_000, monthly_wage: 11_000 },
				{ minimum_wage_400_business: true }
			),
			true
		);
		assert.equal(underpaid('ATLANTIS', { base_salary: 1_000, monthly_wage: 1_000 }), false);
		assert.equal(
			underpaid(
				'BANGKOK',
				{ base_salary: 1_000, monthly_wage: 1_000 },
				{ minimum_wage_exempt: true }
			),
			false
		);

		const cap = validation('OVERTIME_WEEKLY_CAP');
		assert.deepEqual([cap.site, cap.kind], ['payslip', 'warn']);
		const week = (extra: number) => {
			const context = salaryContext('version_4');
			// 12-18 Oct 2026: 4 + (8 + 2) + 0 + (8 + 1) = 23 hours, plus Thursday's overtime.
			context.work.days.push(day('2026-10-15', 'WORK', '', 8 + extra, extra));
			return evaluateConfigured(cap.when, context);
		};
		assert.equal(week(13), false);
		assert.equal(week(14), true);

		const loan = validation('LOAN_DEDUCTION_CAP');
		assert.deepEqual([loan.site, loan.kind], ['payslip', 'hold']);
		const slipWith = (lines: Row, pvd = 0, facts: Row = {}) =>
			evaluateConfigured(loan.when, {
				...salaryContext('version_4', { employee: { facts } }),
				payslip: { gross: 30_000, lines },
				statutory: pvd === 0 ? {} : { PVD: { employee: pvd, employer: pvd } }
			});
		assert.equal(slipWith({ WELFARE_LOAN: -3_100 }), true);
		assert.equal(slipWith({ WELFARE_LOAN: -3_000 }), false);
		assert.equal(slipWith({}), false);
		// s.76: a 15% provident fund election, and 10% + 10.5% together, need the employee's prior consent.
		assert.equal(slipWith({}, 4_500), true);
		assert.equal(slipWith({ WELFARE_LOAN: -3_000 }, 3_150), true);
		assert.equal(slipWith({ WELFARE_LOAN: -3_000 }, 3_000), false);
		assert.equal(slipWith({}, 4_500, { deduction_consent: true }), false);
		for (const version of VERSIONS)
			assert.deepEqual(
				rows(version, 'rule_set')
					.filter((row) => row.family === 'VALIDATIONS')
					.map((row) => row.code),
				['MINIMUM_WAGE', 'OVERTIME_WEEKLY_CAP', 'LOAN_DEDUCTION_CAP']
			);
	});

	it('event windows: maternity per pregnancy, spouse-support and child-care leave per child', () => {
		const key = (code: string, facts: Row) =>
			evaluateConfigured(
				String(
					(find('version_4', 'leave_catalog', code).entitlement as { window_key: string })
						.window_key
				),
				{ entry: { ...facts, facts } }
			);
		assert.equal(key('MATERNITY_LEAVE', { pregnancy_id: 'preg-2' }), 'preg-2');
		assert.equal(key('MATERNITY_LEAVE_SSO', { pregnancy_id: 'preg-2' }), 'preg-2');
		assert.equal(key('PATERNITY_LEAVE', { child_id: 'c-7' }), 'c-7');
		assert.equal(key('CHILD_CARE_LEAVE', { child_id: 'c-7' }), 'c-7');
		// No key: the movement falls back to its own facts.event_id window.
		assert.equal(key('MATERNITY_LEAVE', {}), '');
	});

	it('severance pay follows the s.118 bands of 30/90/180/240/300/400 days', () => {
		const severance = (service_from: string) => {
			const [band] = find('version_3', 'adhoc_catalog', 'SEVERANCE_PAY').bands as {
				amount: string;
			}[];
			return evaluateConfigured(band!.amount, payslipContext('version_3', { service_from }));
		};
		assert.equal(severance('2026-07-05'), 0);
		assert.equal(severance('2026-07-04'), 30_000);
		assert.equal(severance('2025-11-01'), 90_000);
		assert.equal(severance('2023-11-01'), 180_000);
		assert.equal(severance('2023-11-02'), 90_000);
		assert.equal(severance('2020-01-01'), 240_000);
		assert.equal(severance('2016-11-01'), 300_000);
		assert.equal(severance('2006-11-01'), 400_000);
	});

	it('minimum wage arrears read the provincial table and the 400-baht hotel rule', () => {
		const arrears = (company: Row, quantity: number, paid: number) => {
			const [band] = find('version_3', 'adhoc_catalog', 'MINIMUM_WAGE_ARREARS').bands as {
				amount: string;
			}[];
			return evaluateConfigured(band!.amount, {
				...salaryContext('version_3', { company }),
				entry: entry({}, paid, quantity)
			});
		};
		assert.equal(arrears({ region: 'BANGKOK', facts: {} }, 10, 3_500), 500);
		assert.equal(arrears({ region: 'NAN', facts: {} }, 10, 3_500), 0);
		assert.equal(
			arrears({ region: 'NAN', facts: { minimum_wage_400_business: true } }, 10, 3_500),
			500
		);
		const table = (
			payrollRules('version_1').minimum_wage as { by_region: { [area: string]: number } }
		).by_region;
		assert.equal(Object.keys(table).length, 80);
		assert.equal(table.YALA, 337);
		assert.equal(table.CHIANG_MAI_MUEANG, 380);
		assert.equal(table.NONTHABURI, 372);
		assert.throws(() => arrears({ region: 'ATLANTIS', facts: {} }, 1, 0));
	});

	it('leave: 6 annual days after a year, 30 paid sick days, maternity 98/45 then 120/60 with LPA No. 9 leaves', () => {
		for (const version of VERSIONS) {
			const annual = find(version, 'leave_catalog', 'ANNUAL_LEAVE');
			const entitlement = annual.entitlement as Parameters<typeof entitlementDays>[0];
			const onDay = (exit: Row = {}, as_of = '2026-10-31') => ({
				...subject({ employment: exit }),
				as_of
			});
			assert.equal(entitlementDays(entitlement, 11, onDay()), 0);
			assert.equal(entitlementDays(entitlement, 12, onDay()), 6);
			// s.67: leaving on 31 July 2026 after five years, the exit balance meters 6 × 212/365 days of the year.
			const leaving = { exit_date: '2026-07-31', exit_facts: {} };
			assert.equal(entitlementDays(entitlement, 60, onDay(leaving, '2026-07-31')), 3.48);
			assert.equal(entitlementDays(entitlement, 60, onDay(leaving, '2026-03-01')), 6);
			assert.equal(
				entitlementDays(
					entitlement,
					60,
					onDay({ ...leaving, exit_facts: { section_119_ground: true } }, '2026-07-31')
				),
				0
			);
			assert.equal(annual.encash_on_exit, true);
			const sick = find(version, 'leave_catalog', 'SICK_LEAVE');
			assert.equal(
				entitlementDays(sick.entitlement as Parameters<typeof entitlementDays>[0], 1, {
					...subject(),
					as_of: '2026-10-31'
				}),
				30
			);
			const maternity = find(version, 'leave_catalog', 'MATERNITY_LEAVE');
			assert.equal(evaluateConfigured(String(maternity.eligibility), admitContext()), true);
			assert.equal(
				evaluateConfigured(
					String(maternity.eligibility),
					admitContext({ employee: { gender: 'MALE' } })
				),
				false
			);
			assert.match(
				String(maternity.authority),
				version === 'version_1' ? /98 days.*45 days/ : /120 days.*60 days/
			);
			assert.equal(find(version, 'leave_catalog', 'MATERNITY_LEAVE_SSO').paid_by, 'FUND');
		}
		// s.41/1 grants spouse-support leave to any employee whose spouse gives birth, metered per birth.
		const paternity = find('version_2', 'leave_catalog', 'PATERNITY_LEAVE');
		assert.equal(paternity.eligibility, '');
		const meter = (code: string, version = 'version_4') =>
			find(version, 'leave_catalog', code).entitlement as { days: string; window?: string };
		assert.equal(
			entitlementDays(meter('PATERNITY_LEAVE') as Parameters<typeof entitlementDays>[0], 0, {
				...subject(),
				as_of: '2026-10-31'
			}),
			15
		);
		assert.equal(meter('PATERNITY_LEAVE').window, 'EVENT');
		// Per pregnancy: 45 employer-paid of 98 days before LPA No. 9, 60 of 120 after.
		assert.deepEqual(
			[meter('MATERNITY_LEAVE', 'version_1').days, meter('MATERNITY_LEAVE_SSO', 'version_1').days],
			['45.0', '53.0']
		);
		assert.deepEqual(
			[meter('MATERNITY_LEAVE').days, meter('MATERNITY_LEAVE_SSO').days],
			['60.0', '60.0']
		);
		assert.equal(meter('MATERNITY_LEAVE').window, 'EVENT');
		assert.equal(find('version_4', 'leave_catalog', 'CHILD_CARE_LEAVE').pay_fraction, '0.5');
		for (const code of ['ANNUAL_LEAVE', 'SICK_LEAVE', 'PERSONAL_BUSINESS_LEAVE', 'MILITARY_LEAVE'])
			assert.equal(meter(code).window, 'CALENDAR_YEAR', code);
	});

	it('obligations: one OBLIGATIONS row per duty whose applies_when and due evaluate for its trigger', () => {
		const company = { region: 'BANGKOK', risk_class: '0101', facts: {} };
		const employee = { nationality: 'MM', gender: 'MALE', date_of_birth: '1990-01-01', facts: {} };
		const contract = {
			exit_ground: 'DISMISSAL',
			exit_facts: {},
			effective_range: { from: '2026-10-20', to: null }
		};
		for (const version of VERSIONS) {
			const duties = dutiesOf(rows(version, 'rule_set'));
			assert.deepEqual(
				duties.map((row) => row.code),
				codesOn(version)
			);
			for (const duty of duties) {
				const rules = { ...(duty.rules as object), trigger: triggerOf(duty) } as {
					description: string;
					authority: string;
					trigger: string;
					months?: string[];
					applies_when?: string;
					due: string;
				};
				assert.ok(rules.description && rules.authority, String(duty.code));
				const shared = {
					company,
					holidays: [],
					headcount: ['WORK_RULES', 'WORK_RULES_FILING'].includes(String(duty.code)) ? 10 : 100,
					today: '2026-10-20'
				};
				const context =
					rules.trigger === 'PAYROLL_RUN'
						? { ...shared, period: { key: '2027-02', from: '2027-02-01', to: '2027-02-28' } }
						: rules.trigger === 'HIRE'
							? { ...shared, hired_on: '2026-10-20', contract, employee }
							: rules.trigger.startsWith('entity.')
								? {
										...shared,
										row: {
											facts: { first_employee_on: '2026-10-20', business_closed_on: '2026-10-20' }
										}
									}
								: rules.trigger === 'leave_catalog_entry.created'
									? {
											...shared,
											contract,
											employee,
											row: {
												catalog_code: 'SICK_LEAVE',
												facts: { work_injury: true },
												from: '2026-10-20',
												occurred_on: '2026-10-21'
											}
										}
									: {
											...shared,
											exit_on: '2026-10-20',
											contract: {
												...contract,
												effective_range: { from: '2024-01-01', to: '2026-10-20' }
											},
											employee
										};
				if ((duty.rules as { when?: string }).when != null)
					assert.equal(
						evaluateConfigured(String((duty.rules as { when?: string }).when), context),
						true,
						String(duty.code)
					);
				if (rules.applies_when != null)
					assert.equal(evaluateConfigured(rules.applies_when, context), true, String(duty.code));
				assert.match(
					String(evaluateConfigured(rules.due, context)),
					/^\d{4}-\d{2}-\d{2}$/,
					String(duty.code)
				);
			}
		}
		const rule = (code: string) =>
			find('version_3', 'rule_set', code).rules as { due: string; applies_when?: string };
		const due = (code: string, context: Row) =>
			evaluateConfigured(rule(code).due, { company: { facts: {} }, ...context });
		const applies = (code: string, context: Row) =>
			evaluateConfigured(String(rule(code).applies_when), context);
		const october = { period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' } };
		assert.equal(due('SSO_CONTRIBUTION_REMITTANCE', october), '2026-11-15');
		assert.equal(due('PND1_FILING', october), '2026-11-07');
		// Filed online: the 15th, and PND1 Kor by 8 March, for returns due to 31 January 2027.
		const online = { facts: { files_online: true } };
		assert.equal(due('PND1_FILING', { ...october, company: online }), '2026-11-15');
		assert.equal(
			due('PND1_FILING', {
				period: { key: '2027-01', from: '2027-01-01', to: '2027-01-31' },
				company: online
			}),
			'2027-02-07'
		);
		assert.equal(
			due('PND1_KOR_ANNUAL', {
				period: { key: '2026-02', from: '2026-02-01', to: '2026-02-28' },
				company: online
			}),
			'2026-03-08'
		);
		assert.equal(due('WORK_RULES_FILING', { hired_on: '2026-10-20' }), '2026-11-11');
		assert.equal(
			due('WCF_CLOSING_WAGE_STATEMENT', { row: { facts: { business_closed_on: '2026-10-20' } } }),
			'2026-11-19'
		);
		assert.equal(
			due('PND1_KOR_ANNUAL', { period: { key: '2027-02', from: '2027-02-01', to: '2027-02-28' } }),
			'2027-02-28'
		);
		assert.equal(
			due('WCF_ANNUAL_CONTRIBUTION', {
				period: { key: '2027-01', from: '2027-01-01', to: '2027-01-31' }
			}),
			'2027-01-31'
		);
		assert.equal(due('SSO_REGISTRATION', { hired_on: '2026-10-20' }), '2026-11-19');
		assert.equal(due('SSO_EXIT_NOTIFICATION', { exit_on: '2026-10-20' }), '2026-11-15');
		assert.equal(due('FINAL_PAY', { exit_on: '2026-10-20' }), '2026-10-23');
		assert.equal(due('WITHHOLDING_CERTIFICATE_ON_EXIT', { exit_on: '2026-10-20' }), '2026-11-20');
		assert.equal(due('FOREIGN_WORKER_HIRE_NOTIFICATION', { hired_on: '2026-10-20' }), '2026-11-04');
		const february = { period: { key: '2027-02', from: '2027-02-01', to: '2027-02-28' } };
		assert.equal(due('WITHHOLDING_CERTIFICATE_ANNUAL', february), '2027-02-15');
		assert.equal(
			due('WCF_ADDITIONAL_CONTRIBUTION', {
				period: { key: '2027-03', from: '2027-03-01', to: '2027-03-31' }
			}),
			'2027-03-31'
		);
		// Three working days after wages paid on the last day (Saturday 31 Oct 2026); a listed holiday is skipped too.
		assert.equal(due('PVD_REMITTANCE', { ...october, holidays: [] }), '2026-11-04');
		assert.equal(
			due('PVD_REMITTANCE', {
				period: { key: '2026-09', from: '2026-09-01', to: '2026-09-30' },
				holidays: ['2026-10-02']
			}),
			'2026-10-06'
		);
		assert.equal(
			evaluateConfigured(
				(find('version_4', 'rule_set', 'EWF_REMITTANCE').rules as { due: string }).due,
				october
			),
			'2026-11-15'
		);
		assert.equal(
			due('EMPLOYER_REGISTRATION', { row: { facts: { first_employee_on: '2026-10-20' } } }),
			'2026-11-19'
		);
		assert.equal(applies('EMPLOYER_REGISTRATION', { row: { facts: {} } }), false);
		// Headcount thresholds (the entity's contracts in force): 10 for the register, the Kor Ror 11 report and the work
		// rules (raised on the hire that makes ten), 100 for the disability quota.
		const staff = (headcount: number) => ({ headcount });
		assert.equal(applies('EMPLOYEE_REGISTER', staff(9)), false);
		assert.equal(applies('EMPLOYEE_REGISTER', staff(10)), true);
		assert.equal(applies('EMPLOYMENT_CONDITIONS_REPORT', staff(3)), false);
		assert.equal(applies('DISABLED_EMPLOYMENT_QUOTA', staff(99)), false);
		assert.equal(applies('DISABLED_EMPLOYMENT_QUOTA', staff(100)), true);
		assert.deepEqual(
			[9, 10, 11].map((headcount) => applies('WORK_RULES', staff(headcount))),
			[false, true, false]
		);
		assert.equal(due('WORK_RULES', { hired_on: '2026-10-20' }), '2026-11-04');
		// WCA s.48: a sick-leave entry marked as a work injury is notified within 15 days of its first day.
		const injury = (facts: Row) =>
			evaluateConfigured(
				String(
					(find('version_3', 'rule_set', 'WORK_INJURY_NOTIFICATION').rules as { when: string }).when
				),
				{
					row: { catalog_code: 'SICK_LEAVE', facts }
				}
			);
		assert.equal(injury({ work_injury: true }), true);
		assert.equal(injury({}), false);
		assert.equal(
			due('WORK_INJURY_NOTIFICATION', { row: { from: '2026-10-20', occurred_on: '2026-10-21' } }),
			'2026-11-04'
		);
		// s.70 para 2 binds only a termination by the employer; the foreign-worker notice only a non-Thai.
		const ground = (exit_ground: string) => ({ contract: { exit_ground } });
		assert.equal(applies('FINAL_PAY', ground('REDUNDANCY')), true);
		assert.equal(applies('FINAL_PAY', ground('RESIGNATION')), false);
		const national = (nationality: string) => ({ employee: { nationality } });
		assert.equal(applies('FOREIGN_WORKER_EXIT_NOTIFICATION', national('MM')), true);
		assert.equal(applies('FOREIGN_WORKER_EXIT_NOTIFICATION', national('TH')), false);
		assert.equal(applies('FOREIGN_WORKER_EXIT_NOTIFICATION', national('')), false);
		// s.62: a worker permitted under the investment-promotion or petroleum law needs no s.13 notice.
		assert.equal(
			applies('FOREIGN_WORKER_HIRE_NOTIFICATION', {
				employee: { nationality: 'JP', facts: { work_permit_basis: 'SECTION_62' } }
			}),
			false
		);
	});

	it('the canonical duty behaviour rules are present and raise obligation and task writes', () => {
		for (const version of VERSIONS) {
			const behaviours = settings(version).behaviours as Behaviours;
			const ids = behaviours.rules.map((rule) => rule.id);
			assert.equal(new Set(ids).size, ids.length, `${version} duplicate behaviour id`);
			for (const rule of ['raise-obligations', 'raise-tasks'])
				assert.ok(ids.includes(rule), `${version} ${rule}`);
			const id = String(settings(version).id);
			const ruleRows = rows(version, 'rule_set');
			const company = [{ region: 'BANGKOK', risk_class: '0101', facts: {} }];
			const raise = (
				collection: string,
				event: string,
				row: Row,
				nationality = 'TH',
				headcount = 12
			) =>
				raiseDuties({
					behaviours,
					settings_id: id,
					rows: ruleRows,
					collection,
					event,
					row,
					headcount,
					reads: {
						company,
						employee: [{ nationality, gender: 'FEMALE', date_of_birth: '1990-01-01', facts: {} }]
					}
				});
			const run = (period: string) =>
				raise('payroll_run', 'created', { id: 'r1', company_id: 'c1', period, approval_id: null });
			const remittances = [
				'SSO_CONTRIBUTION_REMITTANCE',
				'PND1_FILING',
				'PVD_REMITTANCE',
				...(version === 'version_4' ? ['EWF_REMITTANCE'] : [])
			];
			const october = run('2026-10');
			assert.deepEqual(
				october.map((write) => write.duty_code),
				remittances
			);
			assert.equal(october[0]!.due_on, '2026-11-15');
			assert.equal(october[0]!.settings_id, id);
			assert.deepEqual(
				run('2027-01').map((write) => write.duty_code),
				[...remittances, 'WCF_ANNUAL_CONTRIBUTION', 'EMPLOYMENT_CONDITIONS_REPORT']
			);
			assert.deepEqual(
				run('2027-02').map((write) => [write.duty_code, write.due_on]),
				[
					...october.map((write) => [
						write.duty_code,
						write.duty_code === 'PVD_REMITTANCE'
							? '2027-03-03'
							: write.duty_code === 'PND1_FILING'
								? '2027-03-07'
								: '2027-03-15'
					]),
					['PND1_KOR_ANNUAL', '2027-02-28'],
					['WITHHOLDING_CERTIFICATE_ANNUAL', '2027-02-15'],
					['WCF_WAGE_STATEMENT', '2027-02-28']
				]
			);
			assert.deepEqual(
				run('2027-03').map((write) => write.duty_code),
				[...remittances, 'WCF_ADDITIONAL_CONTRIBUTION']
			);
			// The business's first employee: employer registration with the SSO and the WCF within 30 days.
			assert.deepEqual(
				raise('entity', 'created', {
					id: 'c1',
					approval_id: null,
					facts: { first_employee_on: '2026-10-20' }
				}).map((write) => [write.duty_code, write.due_on]),
				[['EMPLOYER_REGISTRATION', '2026-11-19']]
			);
			const contract = {
				id: 'e1',
				company_id: 'c1',
				employee_id: 'p1',
				approval_id: null,
				exit_ground: 'RESIGNATION',
				exit_facts: {},
				effective_range: { from: '2026-10-20', to: '2026-12-10' }
			};
			const writes = (event: string, row: Row, nationality: string) =>
				raise('employment_contract', event, row, nationality).map((data) => [
					data.duty_code,
					data.due_on
				]);
			assert.deepEqual(writes('created', contract, 'TH'), [
				['SSO_REGISTRATION', '2026-11-19'],
				['EMPLOYEE_REGISTER', '2026-11-04']
			]);
			assert.deepEqual(writes('created', contract, 'MM'), [
				['SSO_REGISTRATION', '2026-11-19'],
				['EMPLOYEE_REGISTER', '2026-11-04'],
				['FOREIGN_WORKER_HIRE_NOTIFICATION', '2026-11-04']
			]);
			assert.deepEqual(writes('updated', contract, 'TH'), [
				['SSO_EXIT_NOTIFICATION', '2027-01-15'],
				['WITHHOLDING_CERTIFICATE_ON_EXIT', '2027-01-10']
			]);
			assert.deepEqual(writes('updated', { ...contract, exit_ground: 'REDUNDANCY' }, 'MM'), [
				['SSO_EXIT_NOTIFICATION', '2027-01-15'],
				['FINAL_PAY', '2026-12-13'],
				['WITHHOLDING_CERTIFICATE_ON_EXIT', '2027-01-10'],
				['FOREIGN_WORKER_EXIT_NOTIFICATION', '2026-12-25']
			]);
		}
	});

	it('behaviours admit payroll, and exit encashment prices TH annual leave', () => {
		for (const version of VERSIONS) {
			const behaviours = settings(version).behaviours as Behaviours;
			const planned = planBehaviours(
				behaviours,
				{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
				{ event: { data: { request: { kind: 'REGULAR', period: '2026-10' } } } }
			);
			assert.ok(planned.some((rule) => rule.id === 'payroll-run'));
			const annual = find(version, 'leave_catalog', 'ANNUAL_LEAVE');
			const encash = behaviours.rules.find((rule) => rule.id === 'encash-leave-on-exit');
			assert.ok(encash);
			const days = (from: string, to: string, taken: number) =>
				effectWrites(
					encash,
					withBalances({
						event: {
							settings_id: settings(version).id,
							row: {
								id: 'c1',
								approval_id: null,
								exit_facts: {},
								prior_service_months: 0,
								effective_range: { from, to }
							}
						},
						catalogues: [
							{ id: annual.id, code: 'ANNUAL_LEAVE', unit: 'DAY', entitlement: annual.entitlement }
						],
						movements: [
							{
								catalog_id: annual.id,
								activity: 'TIME_OFF',
								days: taken,
								reference: 'x',
								occurred_on: '2026-03-02',
								from: '2026-03-02',
								to: '2026-03-02'
							}
						]
					})
				).map((write) => (write.data as { days: number }).days);
			assert.deepEqual(days('2026-01-01', '2026-07-31', 0), []);
			// s.67: the year of termination in proportion (6 × 212/365 = 3.48) less the 2 days taken.
			assert.deepEqual(days('2020-01-01', '2026-07-31', 2), [1.48]);
		}
	});
});
