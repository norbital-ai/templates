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
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import { evaluateStrict as evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { recordDocuments } from '../src/lib/payroll_engine/export.js';
import { Reads, runEngine, type HostRead } from '../src/lib/payroll_engine/foundation.js';
import { planRosterImport } from '../src/lib/payroll_engine/roster_import.js';
import type { SheetRow } from '../src/lib/payroll_engine/roster_sheet.js';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.js';
import { entitlementDays } from '../src/lib/payroll_engine/leave.js';
import { dutiesOf, raiseDuties, triggerOf, withBalances, SEEDED_PAYROLL } from './duties.ts';

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
	'work_catalog',
	'suspension_kind'
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
	earned: { month: {}, year: {}, previous_month: {} },
	hours: { previous_month: {} },
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
	'WCF_CLOSING_WAGE_STATEMENT',
	'YOUNG_WORKER_HIRE_NOTICE',
	'YOUNG_WORKER_EXIT_NOTICE',
	'TEMPORARY_SHUTDOWN_NOTICE',
	'TECHNOLOGY_REDUNDANCY_NOTICE',
	'RETIREMENT_SEVERANCE',
	'SECURITY_DEPOSIT_RETURN',
	'EMPLOYEE_REGISTER_UPDATE',
	'RECORDS_RETENTION',
	'WORK_PERMIT_RENEWAL',
	'SKILL_DEVELOPMENT_REGISTRATION',
	'SKILL_DEVELOPMENT_CONTRIBUTION',
	'SKILL_DEVELOPMENT_COURSE_CERTIFICATION',
	'SSO_LATE_SURCHARGE',
	'PND1_LATE_SURCHARGE',
	'WCF_INSTALMENT_DEPOSIT',
	'WCF_INSTALMENT',
	'WCF_LATE_SURCHARGE',
	'SKILL_DEVELOPMENT_FUND_PAYMENT',
	'PDPA_PRIVACY_NOTICE',
	'PDPA_SENSITIVE_DATA_CONSENT',
	'PDPA_BREACH_NOTICE',
	'PDPA_CROSS_BORDER_TRANSFER',
	'PDPA_PROCESSING_RECORDS',
	'PERSONAL_DATA_DISPOSAL',
	'SKILL_DEVELOPMENT_LATE_SURCHARGE',
	'DISABILITY_FUND_LATE_INTEREST'
];
/** The Employee Welfare Fund versions (from 1 October 2026) add its remittance and its late surcharge. */
const ewf = (version: string) => version >= 'version_4';
const codesOn = (version: string) => {
	if (!ewf(version)) return OBLIGATION_CODES;
	const late = OBLIGATION_CODES.indexOf('PND1_LATE_SURCHARGE') + 1;
	return [
		...OBLIGATION_CODES.slice(0, 18),
		'EWF_REMITTANCE',
		...OBLIGATION_CODES.slice(18, late),
		'EWF_LATE_SURCHARGE',
		...OBLIGATION_CODES.slice(late)
	];
};

/** A work-day sheet import planned against the TH versions: the `roster` validations as HR would see them. */
const rosterImport = (
	people: { number: string; profile: Row; terms?: Row }[],
	sheet: SheetRow[]
) => {
	const law = (file: string) => VERSIONS.flatMap((version) => rows(version, file));
	const tables = new Map<string, Row[]>([
		[
			'entity',
			[
				{
					id: 'c1',
					name: 'Siam',
					settings_code: 'TH',
					time_zone: 'Asia/Bangkok',
					region: 'BANGKOK',
					facts: {}
				}
			]
		],
		['jurisdiction_settings', law('jurisdiction_settings')],
		['rule_set', law('rule_set')],
		['leave_catalog', law('leave_catalog')],
		[
			'employment_contract',
			people.map((person, i) => ({
				id: `k${i}`,
				company_id: 'c1',
				employee_id: `p${i}`,
				employee_number: person.number,
				approval_id: null,
				effective_range: { from: '2026-01-01', to: null },
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-01-01', to: null },
							base_salary: { value: 15_000, currency: 'THB' },
							allowances: [],
							employment_type: 'PERMANENT',
							work_classification: 'ORDINARY',
							facts: {},
							...person.terms
						}
					]
				}
			}))
		],
		[
			'employment_profile',
			people.map((person, i) => ({
				id: `p${i}`,
				name: person.number,
				children: [],
				facts: {},
				...person.profile
			}))
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
				{ id: 'R', company_id: 'c1', code: 'R', variant: { day_type: 'REST' } }
			]
		],
		...[
			'shift_pattern',
			'holiday',
			'roster_entry',
			'leave_catalog_entry',
			'payslip',
			'payroll_run',
			'work_suspension'
		].map((name) => [name, []] as [string, Row[]])
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
	const reader = (async (collection: string, query: { where?: Row }) => ({
		rows: (tables.get(collection) ?? []).filter((row) => matches(row, query.where ?? {}))
	})) as unknown as HostRead;
	return runEngine(
		planRosterImport({ company_id: 'c1', rows: sheet, now: '2026-10-20T00:00:00.000Z' }),
		reader,
		(message) => {
			throw new Error(message);
		}
	);
};

describe('TH jurisdiction seed', () => {
	it('every version holds settings, rule_set and every catalogue file', () => {
		assert.deepEqual(VERSIONS, [
			'version_1',
			'version_2',
			'version_3',
			'version_4',
			'version_5',
			'version_6',
			'version_7'
		]);
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
				tax_year_start_month: 1,
				...SEEDED_PAYROLL,
				monthly_wage: (settings('version_1').payroll as Row).monthly_wage
			});
			// LPA s.5: the wage is money; only fixed-allowance lines (by code or catalogue id) join the base salary.
			assert.match(String((row.payroll as Row).monthly_wage), /FIXED_ALLOWANCE/);
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
			[...codes('version_3', 'rule_set'), 'EWF_REMITTANCE', 'EWF_LATE_SURCHARGE'].toSorted()
		);
		// The SSO wage-base steps (2029, 2032) and the EWF 0.5% step (October 2031) change rates, not codes.
		for (const version of VERSIONS.slice(4))
			for (const file of ['statutory_contribution_catalog', 'rule_set', 'leave_catalog'])
				assert.deepEqual(codes(version, file), codes('version_4', file), `${version} ${file}`);
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
				'disabled_dependants_count',
				'employee_percent',
				'exempt_190k_used_elsewhere',
				'home_loan_interest',
				'life_insurance',
				'other_annual_deductions',
				'parents_count',
				'parents_health_insurance',
				'pension_insurance',
				'previous_employer_income',
				'previous_employer_tax',
				'second_child_from_2018_count',
				'severance_separate'
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
		// s.33 para 2: insured before 60 and joining this employer without a break, they stay insured.
		for (const version of VERSIONS)
			assert.ok(
				charge(version, 'SSO', 20_000, {
					employee: { date_of_birth: '1963-06-01', facts: { sso_continuing_insured: true } },
					employment: { start_date: '2025-01-01' }
				}).employee > 0,
				version
			);
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

	it('Employee Welfare Fund from 1 October 2026: 0.25% each for an employer of ten or more, unless the business is exempt', () => {
		assert.deepEqual(charge('version_4', 'EWF', 20_000, {}, { headcount: 12 }), {
			employee: 50,
			employer: 50
		});
		assert.deepEqual(charge('version_4', 'EWF', 20_000, {}, { headcount: 9 }), {
			employee: 0,
			employer: 0
		});
		// s.130 para 2 exempts the undertaking whose fund or welfare meets the Ministerial Regulation (owner: per business).
		assert.deepEqual(charge('version_4', 'EWF', 20_000, {}, { ...member(5), headcount: 12 }), {
			employee: 50,
			employer: 50
		});
		assert.deepEqual(
			charge(
				'version_4',
				'EWF',
				20_000,
				{ company: { facts: { wcf_rate_percent: 0.2, ewf_exempt: true } } },
				{ headcount: 12 }
			),
			{ employee: 0, employer: 0 }
		);
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
		const run = async (kind: PayrollRunKind, sources?: string[], period = '2026-10') => {
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

		// A SEMI_MONTHLY entity: each half pays half the monthly salary and allowance; an unpaid day is a day at
		// monthly wage ÷ 30 (LPA s.5) in its own half; the two halves together pay exactly one month.
		reset();
		tables.get('entity')![0]!.pay_frequency = 'SEMI_MONTHLY';
		tables.set(
			'employment_contract',
			tables.get('employment_contract')!.filter((row) => row.id === 'k-p2')
		);
		const term = (
			(tables.get('employment_contract')![0]!.facts as Row).contract_terms as Row[]
		)[0]!;
		term.allowances = [{ code: 'FIXED_ALLOWANCE', amount: { value: 5_000, currency: 'THB' } }];
		const unpaid = find('version_4', 'leave_catalog', 'UNPAID_LEAVE');
		for (const date of ['2026-10-06', '2026-10-20'])
			tables.get('leave_catalog_entry')!.push({
				id: `npl-${date}`,
				catalog_id: unpaid.id,
				employment_id: 'k-p2',
				company_id: COMPANY,
				approval_id: null,
				payslip_id: null,
				activity: 'TIME_OFF',
				occurred_on: date,
				from: date,
				to: date,
				days: 1,
				facts: {}
			});
		const amountOf = (slip: unknown, code: string) =>
			Number(
				(
					(slip as { base: Row[] }).base.find((line) => line.component_code === code) ?? {
						amount: 0
					}
				).amount
			);
		const month: Row = { BASIC: 0, FIXED_ALLOWANCE: 0, NO_PAY_LEAVE: 0 };
		for (const half of ['2026-10-1', '2026-10-2']) {
			const slip = (await run('REGULAR', undefined, half)).payslips[0]!;
			assert.equal(amountOf(slip, 'BASIC'), 12_500, half);
			assert.equal(amountOf(slip, 'FIXED_ALLOWANCE'), 2_500, half);
			// One unpaid day at (25,000 + 5,000) ÷ 30 = 1,000.
			assert.equal(Math.abs(amountOf(slip, 'NO_PAY_LEAVE')), 1_000, half);
			for (const code of Object.keys(month))
				month[code] = (month[code] as number) + Math.abs(amountOf(slip, code));
		}
		assert.deepEqual(month, { BASIC: 25_000, FIXED_ALLOWANCE: 5_000, NO_PAY_LEAVE: 2_000 });
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
		// Holiday 13 Oct and rest day 18 Oct: 8 normal hours each at +1x (monthly); their 3 OT hours at 3x.
		assert.equal(amount('version_3', 'HOLIDAY_WORK'), 16 * 125);
		assert.equal(amount('version_3', 'HOLIDAY_OVERTIME'), 3 * 3 * 125);
		const daily = { terms: { base_salary: 400, facts: { pay_basis: 'DAILY' } } };
		// s.62: a daily-paid employee is paid for the traditional holiday (1x) but not the weekly rest day (2x).
		assert.equal(amount('version_3', 'HOLIDAY_WORK', daily), (8 * 1 + 8 * 2) * 50);
		assert.equal(amount('version_3', 'HOLIDAY_OVERTIME', daily), 3 * 3 * 50);
		assert.equal(amount('version_3', 'OVERTIME', daily), 4 * 1.5 * 50);
		// Daily wages: two plain working days, the worked holiday, 1.5 paid child-care days and a sick day.
		assert.equal(amount('version_3', 'BASIC_DAILY', daily), 5.5 * 400);
		const eligible = (code: string, overrides: Parameters<typeof subject>[0] = {}) =>
			evaluateConfigured(
				String(find('version_3', 'work_catalog', code).eligibility),
				salaryContext('version_3', overrides)
			);
		// s.65(1) managers get no overtime or holiday overtime and (s.66) no holiday work pay; s.65(2)-(8) work is paid 1x.
		const manager = { terms: { facts: { overtime_category: 'MANAGER' } } };
		for (const code of ['OVERTIME', 'HOLIDAY_WORK', 'HOLIDAY_OVERTIME']) {
			assert.equal(eligible(code), true, code);
			assert.equal(eligible(code, manager), false, code);
		}
		const listed = { terms: { facts: { overtime_category: 'SECTION_65_OTHER' } } };
		assert.equal(amount('version_3', 'OVERTIME', listed), 4 * 1 * 125);
		assert.equal(amount('version_3', 'HOLIDAY_OVERTIME', listed), 3 * 1 * 125);
		// s.68: the hourly wage divides by the average normal hours a day the contract records.
		assert.equal(
			amount('version_3', 'OVERTIME', { terms: { facts: { normal_hours_per_day: 7.5 } } }),
			4 * 1.5 * (1_000 / 7.5)
		);
		assert.equal(eligible('BASIC', daily), false);
		assert.equal(eligible('NO_PAY_LEAVE', daily), false);
		assert.equal(eligible('BASIC_DAILY'), false);
		// Two unpaid days and the unpaid half of three child-care days (s.59/1).
		assert.equal(amount('version_3', 'NO_PAY_LEAVE'), 3.5 * 1_000);
		assert.equal(amount('version_3', 'ENCASHMENT'), 3 * 1_000);
		// LPA ss.5, 68: the day and hour wage of a monthly-paid employee is the monthly wage, fixed allowances included,
		// ÷ 30 (and ÷ the normal hours): 30,000 basic + 3,000 position allowance = 1,100 a day, 137.50 an hour.
		for (const version of VERSIONS) {
			const allowance = { terms: { base_salary: 30_000, monthly_wage: 33_000 } };
			assert.equal(amount(version, 'OVERTIME', allowance), 4 * 1.5 * 137.5, version);
			assert.equal(amount(version, 'HOLIDAY_WORK', allowance), 16 * 137.5, version);
			assert.equal(amount(version, 'HOLIDAY_OVERTIME', allowance), 3 * 3 * 137.5, version);
			assert.equal(amount(version, 'NO_PAY_LEAVE', allowance), 3.5 * 1_100, version);
			assert.equal(amount(version, 'ENCASHMENT', allowance), 3 * 1_100, version);
		}
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
				payslip: { gross: 30_000 + (lines.BONUS ?? 0), lines: { BASIC: 30_000, ...lines } },
				statutory: pvd === 0 ? {} : { PVD: { employee: pvd, employer: pvd } }
			});
		assert.equal(slipWith({ WELFARE_LOAN: -3_100 }), true);
		assert.equal(slipWith({ WELFARE_LOAN: -3_000 }), false);
		// s.76 measures on the s.70 money due (wages, overtime, holiday pay): a bonus does not widen the cap.
		assert.equal(slipWith({ WELFARE_LOAN: -3_100, BONUS: 20_000 }), true);
		assert.equal(slipWith({ WELFARE_LOAN: -3_100, OVERTIME: 1_000 }), false);
		assert.equal(slipWith({}), false);
		// s.76: a 15% provident fund election, and 10% + 10.5% together, need the employee's prior consent.
		assert.equal(slipWith({}, 4_500), true);
		assert.equal(slipWith({ WELFARE_LOAN: -3_000 }, 3_150), true);
		assert.equal(slipWith({ WELFARE_LOAN: -3_000 }, 3_000), false);
		assert.equal(slipWith({}, 4_500, { deduction_consent: true }), false);
		for (const version of VERSIONS)
			assert.deepEqual(
				rows(version, 'rule_set')
					.filter((row) => row.family === 'VALIDATIONS' && (row.rules as Row).site !== 'roster')
					.map((row) => row.code),
				[
					'MINIMUM_WAGE',
					'OVERTIME_WEEKLY_CAP',
					'LOAN_DEDUCTION_CAP',
					'NORMAL_HOURS',
					'REST_BREAK',
					'WEEKLY_HOLIDAY',
					'OVERTIME_CONSENT',
					'PREGNANT_EMPLOYEE_WORK',
					'YOUNG_WORKER_WORK',
					'CHILD_EMPLOYMENT',
					'SKILL_STANDARD_WAGE',
					'PIECE_MINIMUM_WAGE'
				]
			);
	});

	it('validations: working time, rest, consent, pregnant and young workers, child employment and skill-standard wages', () => {
		const rule = (code: string) =>
			find('version_4', 'rule_set', code).rules as { site: string; kind: string; when: string };
		const on = (code: string, context: Row) => evaluateConfigured(rule(code).when, context);
		const slipOf = (
			days: ReturnType<typeof day>[],
			overrides: Parameters<typeof subject>[0] = {}
		) => {
			const context = salaryContext('version_4', overrides);
			const holidays = days
				.filter((d) => d.holiday_kind !== '')
				.map((d) => ({ date: d.date, kind: d.holiday_kind, worked: d.worked_hours > 0 }));
			return {
				...context,
				period: { ...context.period, to: '2026-10-31' },
				work: { ...context.work, days, holidays }
			};
		};
		const worked = (date: string, hours: number, overtime = 0, intervals: Row[] = []) => ({
			...day(date, 'WORK', '', hours, overtime),
			worked: hours > 0,
			intervals
		});
		// s.23: 8 a day and 48 a week planned; 7 for hazardous work.
		const planned = (hours: number) => ({ ...worked('2026-10-12', hours), scheduled_hours: hours });
		assert.equal(on('NORMAL_HOURS', slipOf([planned(8)])), false);
		assert.equal(on('NORMAL_HOURS', slipOf([planned(9)])), true);
		assert.equal(
			on('NORMAL_HOURS', slipOf([planned(8)], { terms: { work_classification: 'HAZARDOUS' } })),
			true
		);
		const week = ['12', '13', '14', '15', '16', '17'].map((d) => ({
			...worked(`2026-10-${d}`, 8),
			scheduled_hours: 8
		}));
		assert.equal(on('NORMAL_HOURS', slipOf(week)), false);
		assert.equal(
			on('NORMAL_HOURS', slipOf([...week, { ...worked('2026-10-18', 8), scheduled_hours: 8 }])),
			true
		);
		// s.28: seven worked days in a row; s.27: six unbroken normal hours in one interval.
		assert.equal(on('WEEKLY_HOLIDAY', slipOf(week)), false);
		assert.equal(on('WEEKLY_HOLIDAY', slipOf([...week, worked('2026-10-18', 8)])), true);
		const unbroken = worked('2026-10-12', 8, 0, [
			{ start: '2026-10-12T08:00', end: '2026-10-12T16:00' }
		]);
		const broken = worked('2026-10-12', 8, 0, [
			{ start: '2026-10-12T08:00', end: '2026-10-12T12:00' },
			{ start: '2026-10-12T13:00', end: '2026-10-12T17:00' }
		]);
		assert.equal(on('REST_BREAK', slipOf([unbroken])), true);
		assert.equal(on('REST_BREAK', slipOf([broken])), false);
		// ss.24-25: overtime without the day's recorded consent (per day, owner ruling), unless continuous work.
		const overtime = [worked('2026-10-12', 10, 2)];
		const consented = (d: ReturnType<typeof worked>) => ({
			...d,
			overtime_consented: true,
			overtime_consented_at: `${d.date}T07:00:00Z`
		});
		assert.equal(on('OVERTIME_CONSENT', slipOf(overtime)), true);
		assert.equal(on('OVERTIME_CONSENT', slipOf(overtime.map(consented))), false);
		// One consented day does not cover another day's overtime.
		assert.equal(
			on('OVERTIME_CONSENT', slipOf([consented(overtime[0]!), worked('2026-10-13', 10, 2)])),
			true
		);
		// A worked public holiday needs the day's consent too (s.25).
		const holiday = {
			...day('2026-10-13', 'WORK', 'PUBLIC_HOLIDAY', 8, 0),
			worked: true,
			intervals: []
		};
		assert.equal(on('OVERTIME_CONSENT', slipOf([holiday])), true);
		assert.equal(on('OVERTIME_CONSENT', slipOf([{ ...holiday, overtime_consented: true }])), false);
		assert.equal(
			on('OVERTIME_CONSENT', slipOf(overtime, { terms: { facts: { continuous_work: true } } })),
			false
		);
		assert.equal(on('OVERTIME_CONSENT', slipOf([worked('2026-10-12', 8)])), false);
		// s.39 and ss.47-48: night (22:00-06:00), overtime or holiday work.
		const night = [
			worked('2026-10-12', 8, 0, [{ start: '2026-10-12T20:00', end: '2026-10-13T04:00' }])
		];
		assert.equal(
			on('PREGNANT_EMPLOYEE_WORK', slipOf(night, { employee: { facts: { pregnant: true } } })),
			true
		);
		assert.equal(on('PREGNANT_EMPLOYEE_WORK', slipOf(night)), false);
		assert.equal(
			on('PREGNANT_EMPLOYEE_WORK', slipOf([broken], { employee: { facts: { pregnant: true } } })),
			false
		);
		assert.equal(
			on('YOUNG_WORKER_WORK', slipOf(night, { employee: { date_of_birth: '2010-01-01' } })),
			true
		);
		assert.equal(
			on('YOUNG_WORKER_WORK', slipOf([broken], { employee: { date_of_birth: '2010-01-01' } })),
			false
		);
		assert.equal(on('YOUNG_WORKER_WORK', slipOf(night)), false);
		// s.44: no child under 15; s.90: the skill-standard rate of a certified trade.
		const contract = (overrides: Parameters<typeof subject>[0], dayOf = '2026-10-01') => {
			const roots = subject(overrides);
			return { ...roots, term: roots.terms, day: dayOf, rules: payrollRules('version_4') };
		};
		assert.deepEqual(
			[rule('CHILD_EMPLOYMENT').site, rule('CHILD_EMPLOYMENT').kind],
			['contract', 'refuse']
		);
		assert.equal(
			on('CHILD_EMPLOYMENT', contract({ employee: { date_of_birth: '2011-10-02' } })),
			true
		);
		assert.equal(
			on('CHILD_EMPLOYMENT', contract({ employee: { date_of_birth: '2011-10-01' } })),
			false
		);
		const skilled = (base_salary: number) =>
			on(
				'SKILL_STANDARD_WAGE',
				contract({
					terms: { base_salary, facts: { pay_basis: 'DAILY', skill_standard_day_rate: 520 } }
				})
			);
		assert.equal(skilled(500), true);
		assert.equal(skilled(520), false);
		assert.equal(on('SKILL_STANDARD_WAGE', contract({})), false);
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
			// s.67 para 1: dismissed (no s.119 ground) on 31 July 2026, the exit balance meters 6 × 212/365 days of the year.
			const leaving = { exit_date: '2026-07-31', exit_ground: 'REDUNDANCY', exit_facts: {} };
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
			// A resignation earns no part of the year's leave; s.67 para 2 still pays the days carried forward.
			assert.equal(
				entitlementDays(
					entitlement,
					60,
					onDay({ ...leaving, exit_ground: 'RESIGNATION' }, '2026-07-31')
				),
				0
			);
			const carry = (facts: Row) =>
				evaluateConfigured(String(entitlement.carry_forward), {
					...subject({ terms: { facts } }),
					as_of: '2026-10-31'
				});
			assert.equal(carry({}), 0);
			assert.equal(carry({ annual_leave_carry_forward_days: 4 }), 4);
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
		}
		// s.41/1 grants spouse-support leave to any employee whose spouse gives birth, metered per birth.
		const paternity = find('version_2', 'leave_catalog', 'PATERNITY_LEAVE');
		// The leave is taken within 90 days of the birth (s.41/1 as added by LPA No. 9).
		const within = (occurred_on: string) =>
			evaluateConfigured(String(paternity.eligibility), {
				...subject(),
				entry: { occurred_on, facts: { birth_date: '2026-01-10' } }
			});
		assert.equal(within('2026-04-10'), true);
		assert.equal(within('2026-04-11'), false);
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
					headcount: duty.code === 'WORK_RULES' ? 10 : 100,
					today: '2026-10-20'
				};
				const base: Row =
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
												catalog_code:
													duty.code === 'TEMPORARY_SHUTDOWN_NOTICE'
														? 'TEMPORARY_SHUTDOWN'
														: 'WORK_INJURY_LEAVE',
												facts: {},
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
				// The duties that only some employees or exits raise: their own subject.
				const exiting = base.contract as Row;
				const context: Row = {
					...base,
					...(
						{
							YOUNG_WORKER_HIRE_NOTICE: { employee: { ...employee, date_of_birth: '2010-01-01' } },
							YOUNG_WORKER_EXIT_NOTICE: { employee: { ...employee, date_of_birth: '2010-01-01' } },
							TECHNOLOGY_REDUNDANCY_NOTICE: {
								contract: { ...exiting, exit_facts: { special_severance_ground: 'TECHNOLOGY' } }
							},
							RETIREMENT_SEVERANCE: { contract: { ...exiting, exit_ground: 'RETIREMENT' } },
							SECURITY_DEPOSIT_RETURN: {
								employee: { ...employee, facts: { security_deposit_held: true } }
							},
							WORK_PERMIT_RENEWAL: {
								employee: { ...employee, facts: { work_permit_expires_on: '2026-11-19' } }
							},
							WCF_INSTALMENT_DEPOSIT: { company: { ...company, facts: { wcf_instalments: true } } },
							WCF_INSTALMENT: { company: { ...company, facts: { wcf_instalments: true } } },
							PDPA_BREACH_NOTICE: {
								row: { kind: 'PERSONAL_DATA_BREACH', opened_on: '2026-10-20' }
							},
							PDPA_CROSS_BORDER_TRANSFER: {
								row: { kind: 'PERSONAL_DATA_TRANSFER_ABROAD', opened_on: '2026-10-20' }
							},
							SKILL_DEVELOPMENT_LATE_SURCHARGE: {
								row: {
									duty_code: 'SKILL_DEVELOPMENT_FUND_PAYMENT',
									state: 'FULFILLED',
									due_on: '2027-03-31',
									fulfilled_on: '2027-04-20'
								}
							},
							DISABILITY_FUND_LATE_INTEREST: {
								row: {
									code: 'DISABLED_EMPLOYMENT_QUOTA',
									state: 'DONE',
									due_on: '2027-03-31',
									done_on: '2027-04-10'
								}
							},
							WCF_LATE_SURCHARGE: {
								row: {
									code: 'WCF_ANNUAL_CONTRIBUTION',
									state: 'DONE',
									due_on: '2027-01-31',
									done_on: '2027-02-10'
								}
							},
							...Object.fromEntries(
								[
									['SSO_LATE_SURCHARGE', 'SSO_CONTRIBUTION_REMITTANCE'],
									['PND1_LATE_SURCHARGE', 'PND1_FILING'],
									['EWF_LATE_SURCHARGE', 'EWF_REMITTANCE']
								].map(([late, duty_code]) => [
									late,
									{
										row: {
											duty_code,
											state: 'FULFILLED',
											due_on: '2026-11-15',
											fulfilled_on: '2026-12-02'
										}
									}
								])
							)
						} as { [code: string]: Row }
					)[String(duty.code)]
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
		// s.108 as amended by NCPO Order 21/2560: the rules are announced and kept, no longer filed.
		assert.equal(
			rows('version_3', 'rule_set').some((row) => row.code === 'WORK_RULES_FILING'),
			false
		);
		assert.equal(due('WORK_RULES', { hired_on: '2026-10-20' }), '2026-11-04');
		// s.45: a child employee's start within 15 days, the end within 7; s.121: 60 days before a technology redundancy.
		const child = { employee: { date_of_birth: '2010-01-01', facts: {} } };
		assert.equal(applies('YOUNG_WORKER_HIRE_NOTICE', { ...child, hired_on: '2026-10-20' }), true);
		assert.equal(
			applies('YOUNG_WORKER_HIRE_NOTICE', {
				employee: { date_of_birth: '2000-01-01' },
				hired_on: '2026-10-20'
			}),
			false
		);
		assert.equal(due('YOUNG_WORKER_HIRE_NOTICE', { hired_on: '2026-10-20' }), '2026-11-04');
		assert.equal(due('YOUNG_WORKER_EXIT_NOTICE', { exit_on: '2026-10-20' }), '2026-10-27');
		assert.equal(due('TECHNOLOGY_REDUNDANCY_NOTICE', { exit_on: '2026-10-20' }), '2026-08-21');
		assert.equal(applies('TECHNOLOGY_REDUNDANCY_NOTICE', { contract: { exit_facts: {} } }), false);
		assert.equal(due('SECURITY_DEPOSIT_RETURN', { exit_on: '2026-10-20' }), '2026-10-27');
		assert.equal(due('RECORDS_RETENTION', { exit_on: '2026-10-20' }), '2028-10-20');
		assert.equal(due('EMPLOYEE_REGISTER_UPDATE', { today: '2026-10-20' }), '2026-11-04');
		assert.equal(
			due('TEMPORARY_SHUTDOWN_NOTICE', { row: { from: '2026-10-20', occurred_on: '2026-10-19' } }),
			'2026-10-19'
		);
		assert.equal(
			due('WORK_INJURY_NOTIFICATION', { row: { from: '2026-10-20', occurred_on: '2026-10-21' } }),
			'2026-11-04'
		);
		// The Skill Development Fund: registration on reaching 100, Sor Tor 2 within March, courses by 15 January.
		const skill = (code: string) =>
			find('version_3', 'rule_set', code).rules as { months?: string[] };
		assert.deepEqual(skill('SKILL_DEVELOPMENT_CONTRIBUTION').months, ['03']);
		assert.deepEqual(skill('SKILL_DEVELOPMENT_COURSE_CERTIFICATION').months, ['01']);
		assert.equal(applies('SKILL_DEVELOPMENT_CONTRIBUTION', { headcount: 99 }), false);
		assert.equal(applies('SKILL_DEVELOPMENT_REGISTRATION', { headcount: 100 }), true);
		assert.equal(applies('SKILL_DEVELOPMENT_REGISTRATION', { headcount: 101 }), false);
		assert.equal(
			due('SKILL_DEVELOPMENT_CONTRIBUTION', { period: { from: '2027-03-01' } }),
			'2027-03-31'
		);
		assert.equal(
			due('SKILL_DEVELOPMENT_COURSE_CERTIFICATION', { period: { from: '2027-01-01' } }),
			'2027-01-15'
		);
		const permit = find('version_3', 'rule_set', 'WORK_PERMIT_RENEWAL').rules as { when: string };
		const expiring = (today: string) =>
			evaluateConfigured(permit.when, {
				today,
				employee: { facts: { work_permit_expires_on: '2026-11-19' } }
			});
		assert.equal(expiring('2026-10-20'), true);
		assert.equal(expiring('2026-10-21'), false);
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
		// Ministerial Regulation B.E. 2554 cl.5 para 2 (No. 2 B.E. 2560): the fund is paid by 31 March, raised on the January run.
		assert.equal(
			due('DISABLED_EMPLOYMENT_QUOTA', {
				period: { key: '2027-01', from: '2027-01-01', to: '2027-01-31' }
			}),
			'2027-03-31'
		);
		assert.deepEqual(
			[9, 10, 11].map((headcount) => applies('WORK_RULES', staff(headcount))),
			[false, true, false]
		);
		assert.equal(due('WORK_RULES', { hired_on: '2026-10-20' }), '2026-11-04');
		// WCA s.48: a sick-leave entry marked as a work injury is notified within 15 days of its first day.
		// s.32 para 3: a work-injury absence is its own (WCF-paid) class, not sick leave; it raises the WCA s.48 notice.
		const injury = (catalog_code: string) =>
			evaluateConfigured(
				String(
					(find('version_3', 'rule_set', 'WORK_INJURY_NOTIFICATION').rules as { when: string }).when
				),
				{ row: { catalog_code, facts: {} } }
			);
		assert.equal(injury('WORK_INJURY_LEAVE'), true);
		assert.equal(injury('SICK_LEAVE'), false);
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
				...(ewf(version) ? ['EWF_REMITTANCE'] : [])
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
				[
					['EMPLOYER_REGISTRATION', '2026-11-19'],
					['PDPA_PROCESSING_RECORDS', '2026-01-01']
				]
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
				['EMPLOYEE_REGISTER', '2026-11-04'],
				['PDPA_PRIVACY_NOTICE', '2026-10-20'],
				['PDPA_SENSITIVE_DATA_CONSENT', '2026-10-20']
			]);
			assert.deepEqual(writes('created', contract, 'MM'), [
				['SSO_REGISTRATION', '2026-11-19'],
				['EMPLOYEE_REGISTER', '2026-11-04'],
				['FOREIGN_WORKER_HIRE_NOTIFICATION', '2026-11-04'],
				['PDPA_PRIVACY_NOTICE', '2026-10-20'],
				['PDPA_SENSITIVE_DATA_CONSENT', '2026-10-20']
			]);
			assert.deepEqual(writes('updated', contract, 'TH'), [
				['SSO_EXIT_NOTIFICATION', '2027-01-15'],
				['WITHHOLDING_CERTIFICATE_ON_EXIT', '2027-01-10'],
				['RECORDS_RETENTION', '2028-12-10'],
				['PERSONAL_DATA_DISPOSAL', '2031-12-31']
			]);
			assert.deepEqual(writes('updated', { ...contract, exit_ground: 'REDUNDANCY' }, 'MM'), [
				['SSO_EXIT_NOTIFICATION', '2027-01-15'],
				['FINAL_PAY', '2026-12-13'],
				['WITHHOLDING_CERTIFICATE_ON_EXIT', '2027-01-10'],
				['FOREIGN_WORKER_EXIT_NOTIFICATION', '2026-12-25'],
				['RECORDS_RETENTION', '2028-12-10'],
				['PERSONAL_DATA_DISPOSAL', '2031-12-31']
			]);
			// s.118/1: retirement is a termination owing severance on the exit day.
			assert.deepEqual(writes('updated', { ...contract, exit_ground: 'RETIREMENT' }, 'TH'), [
				['SSO_EXIT_NOTIFICATION', '2027-01-15'],
				['FINAL_PAY', '2026-12-13'],
				['WITHHOLDING_CERTIFICATE_ON_EXIT', '2027-01-10'],
				['RETIREMENT_SEVERANCE', '2026-12-10'],
				['RECORDS_RETENTION', '2028-12-10'],
				['PERSONAL_DATA_DISPOSAL', '2031-12-31']
			]);
		}
	});

	it('PDPA: breaches notified in 72 hours, transfers abroad checked; a late Skill Development Fund payment raises its surcharge', () => {
		for (const version of VERSIONS) {
			const behaviours = settings(version).behaviours as Behaviours;
			const raise = (collection: string, event: string, row: Row, day: string) =>
				raiseDuties({
					behaviours,
					settings_id: String(settings(version).id),
					rows: rows(version, 'rule_set'),
					collection,
					event,
					row: { approval_id: null, company_id: 'c1', ...row },
					day
				}).map((write) => [write.duty_code ?? write.code, write.due_on]);
			const kinds = (find(version, 'rule_set', 'case_kinds').rules as { kinds: Row[] }).kinds.map(
				(kind) => kind.code
			);
			assert.deepEqual(kinds, ['PERSONAL_DATA_BREACH', 'PERSONAL_DATA_TRANSFER_ABROAD'], version);
			// s.37(4): within 72 hours of becoming aware; s.28: before the transfer.
			assert.deepEqual(
				raise(
					'workplace_case',
					'created',
					{ id: 'case-1', kind: 'PERSONAL_DATA_BREACH', opened_on: '2026-10-20' },
					'2026-10-20'
				),
				[['PDPA_BREACH_NOTICE', '2026-10-23']]
			);
			assert.deepEqual(
				raise(
					'workplace_case',
					'created',
					{ id: 'case-2', kind: 'PERSONAL_DATA_TRANSFER_ABROAD', opened_on: '2026-10-20' },
					'2026-10-20'
				),
				[['PDPA_CROSS_BORDER_TRANSFER', '2026-10-20']]
			);
			// SDPA s.31 (DSD guidance): a contribution paid after its March due day raises the 1.5%-a-month surcharge.
			const paid = (fulfilled_on: string) =>
				raise(
					'obligation',
					'updated',
					{
						id: 'o-sdf',
						duty_code: 'SKILL_DEVELOPMENT_FUND_PAYMENT',
						state: 'FULFILLED',
						due_on: '2027-03-31',
						fulfilled_on
					},
					fulfilled_on
				);
			assert.deepEqual(paid('2027-04-20'), [['SKILL_DEVELOPMENT_LATE_SURCHARGE', '2027-04-20']]);
			assert.deepEqual(paid('2027-03-31'), []);
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
			const days = (
				from: string,
				to: string,
				taken: number,
				carried = 0,
				exit_ground = 'RESIGNATION'
			) =>
				effectWrites(
					encash,
					withBalances({
						event: {
							settings_id: settings(version).id,
							row: {
								id: 'c1',
								approval_id: null,
								exit_ground,
								exit_facts: {},
								prior_service_months: 0,
								effective_range: { from, to },
								facts: {
									contract_terms: [
										{
											effective_range: { from, to: null },
											facts: { annual_leave_carry_forward_days: carried }
										}
									]
								}
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
			// s.67 as amended: an exit without an employer termination earns none of the year (the year's pro-rata on a
			// dismissal is metered in the leave test); para 2 pays the days carried forward on every exit: 4 less 2 taken.
			assert.deepEqual(days('2020-01-01', '2026-07-31', 2), []);
			assert.deepEqual(days('2020-01-01', '2026-07-31', 2, 4), [2]);
			// s.67 para 1: dismissed without a s.119 ground, the year in proportion (6 × 212/365 = 3.48) less 2 taken,
			// plus any carried days.
			assert.deepEqual(days('2020-01-01', '2026-07-31', 2, 0, 'REDUNDANCY'), [1.48]);
			assert.deepEqual(days('2020-01-01', '2026-07-31', 2, 4, 'DISMISSAL'), [5.48]);
		}
	});
	it('PND1: 190,000 aged/disabled exemption, earlier employer, Lor Yor 01 items, the 500,000 retirement cap, daily severance and s.48(5)', () => {
		const pnd1 = (
			wage: number,
			overrides: Parameters<typeof subject>[0] = {},
			options: SlipOptions = {}
		) => charge('version_3', 'PND1', wage, overrides, options).employee;
		// The spouse alone: 600,000 - 100,000 - 60,000 - 60,000 - 10,500 = 369,500 → 14,450 a year.
		assert.equal(
			pnd1(50_000, { employee: { marital_status: 'MARRIED', spouse_status: 'WITHOUT_INCOME' } }),
			1_204.17
		);
		// Aged 65 in the tax year (or disabled): 190,000 of income exempt → 239,500 taxable → 4,475 a year.
		assert.equal(pnd1(50_000, { employee: { date_of_birth: '1961-06-01' } }), 372.92);
		assert.equal(pnd1(50_000, { employee: { date_of_birth: '1962-01-01' } }), 1_704.17);
		assert.equal(pnd1(50_000, { employee: { disabled: true } }), 372.92);
		assert.equal(
			pnd1(
				50_000,
				{ employee: { disabled: true } },
				taxpayer({ exempt_190k_used_elsewhere: 190_000 })
			),
			1_704.17
		);
		// Two parents (60,000) and life insurance capped at 100,000: 269,500 taxable → 5,975.
		assert.equal(pnd1(50_000, {}, taxpayer({ parents_count: 2, life_insurance: 150_000 })), 497.92);
		// An earlier employer's 300,000 and 5,000 withheld join the year: 729,500 taxable → 61,925 less 5,000.
		assert.equal(
			pnd1(
				50_000,
				{},
				taxpayer({ previous_employer_income: 300_000, previous_employer_tax: 5_000 })
			),
			4_743.75
		);
		// 900,000 a month at 15% PVD: the provident fund and pension deduction stop at 500,000.
		assert.equal(pnd1(900_000, {}, { ...member(15), headcount: 5 }), 255_027.08);
		// Daily-paid: the severance exemption is 300 day-rates (150,000), not ten monthly wages.
		const exemptFrom = (terms: Row) =>
			evaluateConfigured(
				String(
					(
						find('version_3', 'statutory_contribution_catalog', 'PND1')
							.configuration as Configuration
					).assessable!.severance
				),
				{
					...subject({ terms, employment: { exit_ground: 'REDUNDANCY' } }),
					month: { ordinary: 13_000, severance: 200_000 }
				}
			);
		assert.equal(
			exemptFrom({ base_salary: 500, monthly_wage: 13_000, facts: { pay_basis: 'DAILY' } }),
			50_000
		);
		assert.equal(exemptFrom({ base_salary: 13_000, monthly_wage: 13_000 }), 70_000);
		// s.48(5) on ten years: 500,000 (last wage × years) taxed apart, (500,000 - 70,000) × 50% → 3,250;
		// the other 200,000 of the 700,000 taxable severance joins the year (46,925 - 20,450).
		const separate = (severance_separate: boolean, service_months = 120) =>
			pnd1(
				50_000,
				{ employment: { exit_ground: 'REDUNDANCY', service_months } },
				{ severance: 1_000_000, ...taxpayer({ severance_separate }) }
			);
		assert.equal(separate(true), 31_429.17);
		assert.ok(separate(false) > separate(true));
		assert.equal(separate(true, 59), separate(false, 59));
	});

	it('SSA s.4 exclusions and wage-paid assessment', () => {
		assert.equal(charge('version_3', 'SSO', 20_000).employee, 875);
		assert.deepEqual(
			charge('version_3', 'SSO', 20_000, {
				employee: { facts: { sso_excluded_category: 'POSTED_FROM_ABROAD' } }
			}),
			{ employee: 0, employer: 0 }
		);
		// SSA s.47: deducted each time wages are paid — no assess_without_wage, so a month without a wage charges nothing.
		const sso = find('version_3', 'statutory_contribution_catalog', 'SSO').configuration as Row;
		assert.equal(sso.assess_without_wage, undefined);
	});

	it('leave: work injury under the WCF, temporary shutdown at 75%, suspension at 50% for 7 days', () => {
		for (const version of VERSIONS) {
			const injury = find(version, 'leave_catalog', 'WORK_INJURY_LEAVE');
			assert.equal(injury.is_npl, true);
			assert.equal(find(version, 'leave_catalog', 'TEMPORARY_SHUTDOWN').pay_fraction, '0.75');
			const suspension = find(version, 'leave_catalog', 'SUSPENSION');
			assert.equal(suspension.pay_fraction, '0.5');
			assert.equal(
				entitlementDays(suspension.entitlement as Parameters<typeof entitlementDays>[0], 40, {
					...subject(),
					as_of: '2026-10-31'
				}),
				7
			);
		}
		// Four shutdown days at 75% and one suspension day at 50%: 1.5 unpaid days deducted.
		const context = salaryContext('version_4');
		const priced = {
			...context,
			leave: {
				rows: [
					leaveRow('TEMPORARY_SHUTDOWN', 'TIME_OFF', 4, { pay_fraction: 0.75 }),
					leaveRow('SUSPENSION', 'TIME_OFF', 1, { pay_fraction: 0.5 }),
					leaveRow('WORK_INJURY_LEAVE', 'TIME_OFF', 2, { is_npl: true })
				]
			}
		};
		const nopay = find('version_4', 'work_catalog', 'NO_PAY_LEAVE');
		assert.equal(
			Number(evaluateConfigured(String(nopay.quantity), priced)) *
				Number(evaluateConfigured(String(nopay.rate), priced)),
			(1 + 0.5 + 2) * 1_000
		);
	});

	it('separation pay: s.118 exclusions, s.17/1 notice shortfall, special severance ss.120-122, s.9 interest, s.64 and s.10', () => {
		const adhoc = (code: string) => find('version_4', 'adhoc_catalog', code);
		const priced = (code: string, facts: Row, amount = 30_000, quantity = 1) => {
			const [band] = adhoc(code).bands as { amount: string }[];
			return evaluateConfigured(band!.amount, payslipContext('version_4', facts, amount, quantity));
		};
		const qualifies = (code: string, facts: Row, exit_facts: Row = {}) =>
			evaluateConfigured(String(adhoc(code).qualifies_when), {
				...subject({ employment: { exit_facts } }),
				entry: entry(facts)
			});
		assert.equal(qualifies('SEVERANCE_PAY', ENTRY_FACTS), true);
		assert.equal(qualifies('SEVERANCE_PAY', ENTRY_FACTS, { section_119_ground: true }), false);
		assert.equal(qualifies('SEVERANCE_PAY', ENTRY_FACTS, { fixed_term_project: true }), false);
		assert.equal(priced('PAY_IN_LIEU_OF_NOTICE', { notice_shortfall_days: 15 }), 15_000);
		assert.equal(priced('PAY_IN_LIEU_OF_NOTICE', {}), 30_000);
		// s.122: ten full years and 303 days (a year) → 11 × 15 days; at most 360.
		assert.equal(priced('SPECIAL_SEVERANCE_TECHNOLOGY', { service_from: '2016-01-01' }), 165_000);
		assert.equal(priced('SPECIAL_SEVERANCE_TECHNOLOGY', { service_from: '1990-01-01' }), 360_000);
		assert.equal(qualifies('SPECIAL_SEVERANCE_TECHNOLOGY', { service_from: '2016-01-01' }), true);
		assert.equal(qualifies('SPECIAL_SEVERANCE_TECHNOLOGY', { service_from: '2022-01-01' }), false);
		// s.121: 60 days' wages unless 60 days' notice was given.
		assert.equal(priced('TECHNOLOGY_NOTICE_IN_LIEU', {}), 60_000);
		assert.equal(qualifies('TECHNOLOGY_NOTICE_IN_LIEU', { notice_given_on: '2026-09-01' }), false);
		assert.equal(qualifies('TECHNOLOGY_NOTICE_IN_LIEU', { notice_given_on: '2026-09-02' }), true);
		// s.120: the s.118 scale (six years → 240 days) and 30 days in lieu of notice.
		assert.equal(priced('SPECIAL_SEVERANCE_RELOCATION', { service_from: '2020-01-01' }), 240_000);
		assert.equal(priced('RELOCATION_NOTICE_IN_LIEU', {}), 30_000);
		assert.equal(qualifies('RELOCATION_NOTICE_IN_LIEU', { notice_given_on: '2026-10-01' }), false);
		for (const code of [
			'SPECIAL_SEVERANCE_TECHNOLOGY',
			'TECHNOLOGY_NOTICE_IN_LIEU',
			'SPECIAL_SEVERANCE_RELOCATION',
			'RELOCATION_NOTICE_IN_LIEU'
		])
			assert.deepEqual(adhoc(code).counts_toward, ['PND1.SEVERANCE'], code);
		// s.9: 15% a year; wilful default adds 15% for each full 7 days after the first 7.
		assert.equal(priced('LATE_PAYMENT_INTEREST', { days_late: 10 }, 36_500), 150);
		assert.equal(priced('LATE_PAYMENT_INTEREST', { days_late: 10, wilful: true }, 36_500), 150);
		assert.equal(priced('LATE_PAYMENT_INTEREST', { days_late: 21, wilful: true }, 36_500), 11_265);
		// s.117 balance and s.64 holidays not granted (2× for a daily-paid weekly holiday).
		assert.equal(priced('SUSPENSION_BACK_PAY', {}, 4_000), 4_000);
		assert.equal(priced('HOLIDAY_NOT_GRANTED', {}, 0, 16), 2_000);
		// s.64 on the monthly wage with its fixed allowance (ss.5, 68): 33,000 ÷ 30 ÷ 8 × 16 hours.
		assert.equal(
			evaluateConfigured(
				String((adhoc('HOLIDAY_NOT_GRANTED').bands as { amount: string }[])[0]!.amount),
				{
					...salaryContext('version_4', { terms: { base_salary: 30_000, monthly_wage: 33_000 } }),
					entry: entry({}, 0, 16)
				}
			),
			2_200
		);
		assert.equal(
			evaluateConfigured(
				String((adhoc('HOLIDAY_NOT_GRANTED').bands as { amount: string }[])[0]!.amount),
				{
					...salaryContext('version_4', {
						terms: { base_salary: 400, facts: { pay_basis: 'DAILY' } }
					}),
					entry: entry({ weekly_holiday: true }, 0, 16)
				}
			),
			1_600
		);
		// s.10: a deposit only from a post the notification allows; deducted from net.
		const deposit = adhoc('SECURITY_DEPOSIT');
		assert.deepEqual([deposit.destination, deposit.direction], ['NET', 'SUBTRACT']);
		assert.equal(
			evaluateConfigured(String(deposit.eligibility), salaryContext('version_4')),
			false
		);
		assert.equal(
			evaluateConfigured(
				String(deposit.eligibility),
				salaryContext('version_4', { terms: { facts: { security_deposit_post: true } } })
			),
			true
		);
		// Benefits in kind reach PND1 only; work travel is reimbursed outside every scheme.
		const kind = find('version_4', 'allowance_catalog', 'BENEFIT_IN_KIND');
		assert.deepEqual([kind.destination, kind.counts_toward], ['DISPLAY', ['PND1']]);
		assert.deepEqual(find('version_4', 'claim_catalog', 'TRAVEL_REIMBURSEMENT').counts_toward, []);
	});

	it('the national holiday calendar: December 2025 and the 2026 Cabinet list, with substitutes', () => {
		for (const version of VERSIONS) {
			const calendar = payrollRules(version).public_holidays as {
				holidays: { date: string; name: string; kind: string; replaces?: string }[];
			};
			assert.equal(calendar.holidays.length, 27, version);
			const dates = calendar.holidays.map((holiday) => holiday.date);
			assert.equal(new Set(dates).size, dates.length);
			assert.deepEqual(
				dates.filter((date) => date < '2026-01-01'),
				['2025-12-05', '2025-12-10', '2025-12-31']
			);
			assert.ok(dates.includes('2026-05-01'), 'National Labour Day (s.29)');
			assert.deepEqual(
				calendar.holidays
					.filter((holiday) => holiday.kind === 'SUBSTITUTE')
					.map((h) => [h.date, h.replaces]),
				[
					['2026-06-01', '2026-05-31'],
					['2026-12-07', '2026-12-05']
				]
			);
			assert.deepEqual(
				calendar.holidays
					.filter((holiday) => holiday.kind === 'SPECIAL_HOLIDAY')
					.map((h) => h.date),
				['2026-01-02', '2026-06-02', '2026-07-31']
			);
		}
	});

	it('wage tables: the minimum wage and WCF Table 1 rates are the notified ones', () => {
		const histogram = (values: number[]) =>
			Object.fromEntries(
				[...new Set(values)]
					.toSorted((a, b) => a - b)
					.map((value) => [value, values.filter((v) => v === value).length])
			);
		const rules = payrollRules('version_4');
		assert.deepEqual(
			histogram(
				Object.values((rules.minimum_wage as { by_region: { [k: string]: number } }).by_region)
			),
			{
				337: 3,
				345: 4,
				347: 16,
				348: 5,
				349: 5,
				350: 3,
				351: 3,
				352: 15,
				354: 2,
				355: 3,
				356: 1,
				357: 5,
				358: 1,
				359: 1,
				372: 5,
				380: 2,
				400: 6
			}
		);
		assert.deepEqual(
			histogram(Object.values((rules.wcf_rate as { by_code: { [k: string]: number } }).by_code)),
			{
				0.2: 565,
				0.25: 114,
				0.3: 81,
				0.35: 37,
				0.4: 62,
				0.45: 51,
				0.5: 42,
				0.55: 24,
				0.6: 24,
				0.65: 17,
				0.7: 15,
				0.75: 13,
				0.8: 8,
				0.85: 5,
				0.9: 7,
				0.95: 4,
				1: 22
			}
		);
		// LPA No. 9 starts version_2 on 7 December 2025.
		assert.equal((settings('version_2').effective_range as { from: string }).from, '2025-12-07');
	});
	it('the event meters: two pregnancies and two children each hold their own grant', () => {
		const balances = (code: string, key: string, movements: [string, number, string][]) => {
			const held = find('version_4', 'leave_catalog', code);
			const out = withBalances({
				event: {
					row: {
						id: 'c1',
						exit_facts: {},
						prior_service_months: 0,
						effective_range: { from: '2020-01-01', to: '2026-10-31' }
					}
				},
				catalogues: [{ id: held.id, code, unit: 'DAY', entitlement: held.entitlement }],
				movements: movements.map(([id, days, from]) => ({
					catalog_id: held.id,
					activity: 'TIME_OFF',
					days,
					reference: `${id}-${from}`,
					occurred_on: from,
					from,
					to: from,
					facts: { [key]: id }
				}))
			});
			return (out.event.leave_balances as { window_key: string; available: number }[])
				.filter((view) => view.window_key !== '')
				.map((view) => [view.window_key, view.available]);
		};
		assert.deepEqual(
			balances('MATERNITY_LEAVE', 'pregnancy_id', [
				['p1', 60, '2025-01-10'],
				['p2', 30, '2026-09-01']
			]),
			[
				['p1', 0],
				['p2', 30]
			]
		);
		assert.deepEqual(
			balances('CHILD_CARE_LEAVE', 'child_id', [
				['c1', 15, '2026-01-10'],
				['c2', 5, '2026-08-01']
			]),
			[
				['c1', 0],
				['c2', 10]
			]
		);
	});

	it('the other leaves, allowance and bonus: entitlements, pay and bases', () => {
		const meter = (code: string) =>
			entitlementDays(
				find('version_4', 'leave_catalog', code).entitlement as Parameters<
					typeof entitlementDays
				>[0],
				40,
				{ ...subject(), as_of: '2026-10-31' }
			);
		const leave = (code: string) => find('version_4', 'leave_catalog', code);
		// s.34 and s.57/1: three paid personal days a year; s.35 and s.58: 60 paid military days with evidence.
		assert.equal(meter('PERSONAL_BUSINESS_LEAVE'), 3);
		assert.equal(
			(leave('PERSONAL_BUSINESS_LEAVE').entitlement as { window: string }).window,
			'CALENDAR_YEAR'
		);
		assert.equal(meter('MILITARY_LEAVE'), 60);
		// s.33 and s.57: sterilisation leave paid as certified; s.36: training leave unpaid.
		assert.deepEqual(
			[leave('STERILISATION_LEAVE').is_npl, leave('STERILISATION_LEAVE').pay_fraction],
			[false, '']
		);
		assert.equal(leave('TRAINING_LEAVE').is_npl, true);
		assert.equal(leave('PUBLIC_HOLIDAY').is_npl, false);
		// A fixed allowance is wage for every scheme, prorated to the days paid.
		const allowance = find('version_4', 'allowance_catalog', 'FIXED_ALLOWANCE');
		assert.deepEqual(allowance.counts_toward, ['SSO', 'WCF', 'PND1', 'EWF']);
		const context = salaryContext('version_4');
		assert.equal(
			evaluateConfigured(String(allowance.amount), {
				...context,
				period: { ...context.period, paid_days: 15.5 },
				allowance: { amount: 2_000 }
			}),
			1_000
		);
		// A bonus is employment income for PND1 only, withheld in full in its month (the PND1 test).
		const bonus = find('version_4', 'adhoc_catalog', 'BONUS');
		assert.deepEqual(bonus.counts_toward, ['PND1']);
		assert.equal(
			evaluateConfigured(
				(bonus.bands as { amount: string }[])[0]!.amount,
				payslipContext('version_4', {}, 12_345)
			),
			12_345
		);
		// Declared other deductions (RMF, ThaiESG, health insurance, donations) lower the base like the spouse allowance.
		assert.equal(
			charge('version_3', 'PND1', 50_000, {}, taxpayer({ other_annual_deductions: 60_000 }))
				.employee,
			1_204.17
		);
	});
	it('piece work: units at the piece rate, s.60 holiday and leave pay, ss.61-63 multiples and the minimum wage', () => {
		const piece = {
			terms: { base_salary: 0, monthly_wage: 0, facts: { pay_basis: 'PIECE', piece_rate: 10 } }
		};
		const unitDay = (
			date: string,
			day_type: string,
			holiday_kind: string,
			units: number,
			overtime_units = 0
		) => ({
			...day(date, day_type, holiday_kind, units > 0 ? 8 : 0, 0),
			worked: units > 0,
			facts: { units, overtime_units }
		});
		const context = (days: ReturnType<typeof unitDay>[], previous: Row = {}) => {
			const base = salaryContext('version_4', piece);
			return {
				...base,
				earned: { ...base.earned, previous_month: previous },
				hours: { previous_month: { worked_hours: 160 } },
				work: { ...base.work, days },
				leave: { rows: [leaveRow('SICK_LEAVE', 'TIME_OFF', 1)] }
			};
		};
		const days = [
			unitDay('2026-10-12', 'WORK', '', 40, 6),
			unitDay('2026-10-13', 'WORK', 'PUBLIC_HOLIDAY', 30, 2),
			unitDay('2026-10-14', 'WORK', '', 50),
			unitDay('2026-10-18', 'REST', '', 20, 4)
		];
		const line = (code: string, ctx: Row) => {
			const row = find('version_4', 'work_catalog', code);
			if (evaluateConfigured(String(row.eligibility), ctx) !== true) return 0;
			return (
				Number(evaluateConfigured(String(row.quantity), ctx)) *
				Number(evaluateConfigured(String(row.rate), ctx))
			);
		};
		const ctx = context(days, { PIECE_WORK: 8_000 });
		// Normal units of the working days: 90 × 10; overtime units 6 × 1.5 × 10 (s.61).
		assert.equal(line('PIECE_WORK', ctx), 900);
		assert.equal(line('OVERTIME', ctx), 90);
		// s.62: 30 units on the paid traditional holiday at 1x, 20 on the unpaid weekly holiday at 2x; s.63: 6 OT units at 3x.
		assert.equal(line('HOLIDAY_WORK', ctx), (30 + 40) * 10);
		assert.equal(line('HOLIDAY_OVERTIME', ctx), 6 * 3 * 10);
		// s.60: the holiday and the paid sick day at last month's average day (8,000 over 20 normal days).
		assert.equal(line('PIECE_PAID_DAYS', ctx), 2 * 400);
		for (const code of ['BASIC', 'BASIC_DAILY', 'NO_PAY_LEAVE'])
			assert.equal(line(code, ctx), 0, code);
		// The minimum wage holds a slip whose normal days earn less than the area rate (400 a day in Bangkok).
		const minimum = find('version_4', 'rule_set', 'PIECE_MINIMUM_WAGE').rules as {
			kind: string;
			when: string;
		};
		assert.equal(minimum.kind, 'hold');
		// 900 for two normal days clears 2 × 400; 700 does not.
		assert.equal(evaluateConfigured(minimum.when, ctx), false);
		assert.equal(
			evaluateConfigured(
				minimum.when,
				context([unitDay('2026-10-12', 'WORK', '', 30), unitDay('2026-10-14', 'WORK', '', 40)])
			),
			true
		);
		assert.equal(
			evaluateConfigured(
				minimum.when,
				context([unitDay('2026-10-12', 'WORK', '', 40), unitDay('2026-10-14', 'WORK', '', 41)])
			),
			false
		);
		// The contract-level minimum wage leaves a piece-rate contract to the payslip check.
		const contract = find('version_4', 'rule_set', 'MINIMUM_WAGE').rules as { when: string };
		const roots = subject(piece);
		assert.equal(
			evaluateConfigured(contract.when, {
				...roots,
				term: roots.terms,
				rules: payrollRules('version_4')
			}),
			false
		);
	});

	it('weekly-basis normal time: overtime over the week, holidays and leave counted as working days (s.69)', () => {
		const weekly = (weekly_normal_hours: number) => {
			const base = salaryContext('version_4', { terms: { facts: { weekly_normal_hours } } });
			// 12-18 Oct 2026: 10 + 10 + 10 worked, 13 Oct a holiday not worked, 15 Oct on leave.
			return {
				...base,
				work: {
					...base.work,
					days: [
						{ ...day('2026-10-12', 'WORK', '', 10, 0), worked: true },
						{ ...day('2026-10-13', 'WORK', 'PUBLIC_HOLIDAY', 0, 0), worked: false },
						{ ...day('2026-10-14', 'WORK', '', 10, 0), worked: true },
						{ ...day('2026-10-15', 'WORK', '', 0, 0), worked: false },
						{ ...day('2026-10-16', 'WORK', '', 10, 0), worked: true },
						{ ...day('2026-10-19', 'WORK', '', 9, 0), worked: true }
					]
				},
				leave: {
					rows: [leaveRow('ANNUAL_LEAVE', 'TIME_OFF', 1, { from: '2026-10-15', to: '2026-10-15' })]
				}
			};
		};
		const overtime = find('version_4', 'work_catalog', 'OVERTIME');
		const hours = (limit: number) =>
			Number(evaluateConfigured(String(overtime.quantity), weekly(limit)));
		// 30 worked + 2 × 8 credited = 46 against 40 → 6; the next week's 9 hours are under 40.
		assert.equal(hours(40), 6);
		assert.equal(hours(48), 0);
		// Without a weekly basis the recorded daily overtime is paid.
		assert.equal(
			Number(evaluateConfigured(String(overtime.quantity), salaryContext('version_4'))),
			4
		);
	});

	it('late remittance surcharges and WCF instalments raise their tasks', () => {
		for (const version of VERSIONS) {
			const behaviours = settings(version).behaviours as Behaviours;
			const raise = (collection: string, event: string, row: Row, facts: Row = {}) =>
				raiseDuties({
					behaviours,
					settings_id: String(settings(version).id),
					rows: rows(version, 'rule_set'),
					collection,
					event,
					row,
					headcount: 12,
					reads: { company: [{ region: 'BANGKOK', risk_class: '0101', facts }], employee: [] }
				}).map((write) => [write.duty_code ?? write.code, write.due_on]);
			const paid = (duty_code: string, fulfilled_on: string) =>
				raise('obligation', 'updated', {
					id: `o-${duty_code}`,
					company_id: 'c1',
					approval_id: null,
					duty_code,
					state: 'FULFILLED',
					due_on: '2026-11-15',
					fulfilled_on
				});
			assert.deepEqual(paid('SSO_CONTRIBUTION_REMITTANCE', '2026-12-02'), [
				['SSO_LATE_SURCHARGE', '2026-12-02']
			]);
			assert.deepEqual(paid('SSO_CONTRIBUTION_REMITTANCE', '2026-11-15'), []);
			assert.deepEqual(paid('PND1_FILING', '2026-11-20'), [['PND1_LATE_SURCHARGE', '2026-11-20']]);
			assert.deepEqual(
				paid('EWF_REMITTANCE', '2026-11-20'),
				ewf(version) ? [['EWF_LATE_SURCHARGE', '2026-11-20']] : []
			);
			// WCA s.46: a WCF contribution task done after its due day raises the 2%-a-month surcharge.
			const done = (code: string, done_on: string, state = 'DONE') =>
				raise('regulatory_task', 'updated', {
					id: `t-${code}`,
					company_id: 'c1',
					approval_id: null,
					code,
					state,
					due_on: '2027-01-31',
					done_on
				});
			assert.deepEqual(done('WCF_ANNUAL_CONTRIBUTION', '2027-02-10'), [
				['WCF_LATE_SURCHARGE', '2027-02-10']
			]);
			assert.deepEqual(done('WCF_INSTALMENT', '2027-02-01'), [
				['WCF_LATE_SURCHARGE', '2027-02-01']
			]);
			assert.deepEqual(done('WCF_ANNUAL_CONTRIBUTION', '2027-01-31'), []);
			assert.deepEqual(done('WCF_ANNUAL_CONTRIBUTION', '2027-02-10', 'OPEN'), []);
			assert.deepEqual(done('WCF_WAGE_STATEMENT', '2027-02-10'), []);
			// PDEA s.34 para 2: a fund contribution paid after 31 March bears 7.5% a year interest.
			const quota = (done_on: string) =>
				raise('regulatory_task', 'updated', {
					id: 't-quota',
					company_id: 'c1',
					approval_id: null,
					code: 'DISABLED_EMPLOYMENT_QUOTA',
					state: 'DONE',
					due_on: '2027-03-31',
					done_on
				});
			assert.deepEqual(quota('2027-04-10'), [['DISABILITY_FUND_LATE_INTEREST', '2027-04-10']]);
			assert.deepEqual(quota('2027-03-31'), []);
			const run = (period: string, facts: Row = {}) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r1', company_id: 'c1', period, approval_id: null },
					facts
				)
					.map(([code]) => code)
					.filter((code) => String(code).startsWith('WCF_'));
			assert.deepEqual(run('2027-01'), ['WCF_ANNUAL_CONTRIBUTION']);
			assert.deepEqual(run('2027-01', { wcf_instalments: true }), [
				'WCF_INSTALMENT_DEPOSIT',
				'WCF_INSTALMENT'
			]);
			assert.deepEqual(run('2027-04', { wcf_instalments: true }), ['WCF_INSTALMENT']);
			assert.deepEqual(run('2027-05', { wcf_instalments: true }), []);
		}
	});

	it("s.53 equal pay: no wage, overtime or holiday rule reads the employee's sex", () => {
		// LPA s.53: wage, overtime, holiday and holiday-overtime rates equal for men and women in work of equal value.
		// Only maternity and child-care leave (ss.41, 41/1), the s.113 register's fields and the returns' name title read it.
		const allowed = [
			'MATERNITY_LEAVE',
			'MATERNITY_LEAVE_SSO',
			'CHILD_CARE_LEAVE',
			'EMPLOYEE_REGISTER_UPDATE',
			'SSO_CONTRIBUTION_FILE',
			'PND1_ATTACHMENT_FILE',
			'PND1A_ATTACHMENT_FILE'
		];
		for (const version of VERSIONS)
			for (const file of FILES.filter((name) => name !== 'jurisdiction_settings'))
				for (const row of rows(version, file))
					if (/\bgender\b|\bsex\b/.test(JSON.stringify(row)))
						assert.ok(allowed.includes(String(row.code)), `${version} ${file} ${String(row.code)}`);
	});

	it('Skill Development Fund: the contribution over the year’s month-end headcounts and the trained count', () => {
		for (const version of VERSIONS) {
			const duty = dutiesOf(rows(version, 'rule_set')).find(
				(row) => row.code === 'SKILL_DEVELOPMENT_FUND_PAYMENT'
			)!;
			const rules = duty.rules as {
				amount: string;
				months: string[];
				due: string;
				schemes: string[];
			};
			assert.deepEqual([rules.months, rules.schemes], [['12'], []], version);
			// DSD worked example shape: average 106 (five months at 92, seven at 116) → 53 to train; 25 trained →
			// 28 short; seven months at 100 or more: 337 × 30 × 28 × 7 ÷ 100 = 19,815.60.
			const months = [92, 92, 92, 92, 92, 116, 116, 116, 116, 116, 116, 116].map(
				(headcount, i) => ({
					month: `2026-${String(i + 1).padStart(2, '0')}`,
					headcount
				})
			);
			const amount = (facts: Row, headcount_months = months) =>
				evaluateConfigured(rules.amount, {
					total: 0,
					run: {},
					period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' },
					company: { facts },
					headcount_months
				});
			assert.equal(amount({ sdf_trained_employees: 25 }), 19_815.6, version);
			// Training half the average (53) owes nothing; none recorded is all 53 short.
			assert.equal(amount({ sdf_trained_employees: 53 }), 0);
			assert.equal(amount({}), (337 * 30 * 53 * 7) / 100);
			// Never 100 employed: nothing owed.
			assert.equal(
				amount(
					{},
					months.map((m) => ({ ...m, headcount: 99 }))
				),
				0
			);
			assert.equal(
				evaluateConfigured(rules.due, {
					period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' }
				}),
				'2027-03-31'
			);
		}
	});

	it('work suspensions: a s.75 cessation pays 75%; force majeure pays no working day; record retention', () => {
		for (const version of VERSIONS) {
			const kinds = new Map(rows(version, 'suspension_kind').map((row) => [String(row.code), row]));
			assert.deepEqual([...kinds.keys()], ['TEMPORARY_CESSATION', 'FORCE_MAJEURE'], version);
			const pay = (code: string, day_type: string, facts: Row = {}) =>
				Number(
					evaluateConfigured(String(kinds.get(code)!.pay), {
						terms: {
							base_salary: facts.pay_basis === 'DAILY' ? 400 : 15_000,
							monthly_wage: facts.pay_basis === 'DAILY' ? 400 : 15_000,
							facts
						},
						day: { date: '2026-10-05', day_type, worked: false },
						suspension: { kind: code, facts: {} }
					})
				);
			// Monthly 15,000 is 500 a day (s.68): 375 on every day of a cessation; daily 400: 300 a working day.
			assert.equal(pay('TEMPORARY_CESSATION', 'WORK'), 375);
			assert.equal(pay('TEMPORARY_CESSATION', 'REST'), 375);
			assert.equal(pay('TEMPORARY_CESSATION', 'WORK', { pay_basis: 'DAILY' }), 300);
			assert.equal(pay('TEMPORARY_CESSATION', 'REST', { pay_basis: 'DAILY' }), 0);
			assert.equal(pay('FORCE_MAJEURE', 'WORK'), 0);
			assert.equal(pay('FORCE_MAJEURE', 'REST'), 500);
			assert.equal(pay('FORCE_MAJEURE', 'WORK', { pay_basis: 'DAILY' }), 0);
			// s.75 on the wage (ss.5, 68): 15,000 basic + 1,500 allowance is 550 a day, 412.50 at 75%.
			assert.equal(
				evaluateConfigured(String(kinds.get('TEMPORARY_CESSATION')!.pay), {
					terms: { base_salary: 15_000, monthly_wage: 16_500, facts: {} },
					day: { date: '2026-10-05', day_type: 'WORK', worked: false },
					suspension: { kind: 'TEMPORARY_CESSATION', facts: {} }
				}),
				412.5
			);
			const line = (code: string) =>
				rows(version, 'work_catalog').find((row) => row.code === code)!;
			const slip = (facts: Row, days: Row[]) => ({
				terms: {
					base_salary: facts.pay_basis === 'DAILY' ? 400 : 15_000,
					monthly_wage: facts.pay_basis === 'DAILY' ? 400 : 15_000,
					facts
				},
				work: { days }
			});
			const week = [
				{
					date: '2026-10-05',
					day_type: 'WORK',
					suspended: { kind: 'TEMPORARY_CESSATION', pay: 375 }
				},
				{ date: '2026-10-06', day_type: 'WORK', suspended: { kind: 'FORCE_MAJEURE', pay: 0 } },
				{ date: '2026-10-11', day_type: 'REST', suspended: { kind: 'FORCE_MAJEURE', pay: 500 } },
				{ date: '2026-10-12', day_type: 'WORK', suspended: null }
			];
			const monthly = slip({}, week);
			assert.equal(
				evaluateConfigured(String(line('SUSPENSION_PAY_ADJUSTMENT').eligibility), monthly),
				true
			);
			assert.equal(
				evaluateConfigured(String(line('SUSPENSION_PAY_ADJUSTMENT').rate), monthly),
				125 + 500
			);
			assert.equal(evaluateConfigured(String(line('SUSPENSION_PAY').eligibility), monthly), false);
			const daily = slip({ pay_basis: 'DAILY' }, [
				{
					date: '2026-10-05',
					day_type: 'WORK',
					suspended: { kind: 'TEMPORARY_CESSATION', pay: 300 }
				},
				{ date: '2026-10-06', day_type: 'WORK', suspended: { kind: 'FORCE_MAJEURE', pay: 0 } }
			]);
			assert.equal(evaluateConfigured(String(line('SUSPENSION_PAY').rate), daily), 300);
			assert.equal(
				evaluateConfigured(String(line('SUSPENSION_PAY_ADJUSTMENT').eligibility), daily),
				false
			);
			// Accounting Act s.14: five years from the closing of the exit year's accounts (beyond LPA s.115's two).
			const retention = rows(version, 'rule_set').find(
				(row) => row.family === 'PAYROLL' && row.code === 'record_retention'
			)!.rules as Row;
			assert.equal(
				evaluateConfigured(String(retention.until), { employment: { exit_date: '2026-10-20' } }),
				'2031-12-31'
			);
		}
	});

	it('work-day sheet: the LPA working-time limits warn, a child under 15 refuses the file', async () => {
		// 5 October 2026: 08:00–19:00 in one block with 2 overtime hours: 9 normal hours and no rest break.
		const long = await rosterImport(
			[{ number: 'E1', profile: { date_of_birth: '1990-01-01' } }],
			[
				{
					row: 2,
					employee_number: 'E1',
					work_date: '2026-10-05',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '19:00',
					overtime_hours: '2'
				}
			]
		);
		assert.deepEqual(long.errors, []);
		assert.deepEqual(long.warnings.map((finding) => finding.message).toSorted(), [
			'five or more working hours with no recorded rest break (LPA s.27).',
			'normal hours above 8 in the day (7 in hazardous work) (LPA s.23).',
			"overtime or holiday work on this day without the employee's recorded consent for the day (LPA ss.24-25)."
		]);
		// The same day with the sheet's OT consent column marked: no consent warning (per day, owner ruling).
		const consented = await rosterImport(
			[{ number: 'E1', profile: { date_of_birth: '1990-01-01' } }],
			[
				{
					row: 2,
					employee_number: 'E1',
					work_date: '2026-10-05',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '19:00',
					overtime_hours: '2',
					overtime_consent: 'Y'
				}
			]
		);
		assert.equal(
			consented.warnings.some((finding) => finding.message.startsWith('overtime or holiday work')),
			false
		);
		// s.26: 15 working-day hours plus 6 on the rest day is a lawful week; 30 plus 8 on the rest day is not.
		const weekly = (sheet: SheetRow[]) =>
			rosterImport([{ number: 'E1', profile: { date_of_birth: '1990-01-01' } }], sheet).then(
				(plan) =>
					plan.warnings
						.filter((finding) => finding.message.startsWith('more than 36 overtime hours'))
						.map((finding) => finding.row)
			);
		assert.deepEqual(
			await weekly([
				{
					row: 2,
					employee_number: 'E1',
					work_date: '2026-10-05',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '17:00',
					overtime_hours: '3'
				},
				{
					row: 3,
					employee_number: 'E1',
					work_date: '2026-10-06',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '17:00',
					overtime_hours: '3'
				},
				{
					row: 4,
					employee_number: 'E1',
					work_date: '2026-10-07',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '17:00',
					overtime_hours: '3'
				},
				{
					row: 5,
					employee_number: 'E1',
					work_date: '2026-10-08',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '17:00',
					overtime_hours: '3'
				},
				{
					row: 6,
					employee_number: 'E1',
					work_date: '2026-10-09',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '17:00',
					overtime_hours: '3'
				},
				{
					row: 7,
					employee_number: 'E1',
					work_date: '2026-10-10',
					shift_code: 'R',
					clock_in: '08:00',
					clock_out: '14:00',
					overtime_hours: '6'
				}
			]),
			[]
		);
		assert.deepEqual(
			await weekly([
				{
					row: 2,
					employee_number: 'E1',
					work_date: '2026-10-05',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '17:00',
					overtime_hours: '6'
				},
				{
					row: 3,
					employee_number: 'E1',
					work_date: '2026-10-06',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '17:00',
					overtime_hours: '6'
				},
				{
					row: 4,
					employee_number: 'E1',
					work_date: '2026-10-07',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '17:00',
					overtime_hours: '6'
				},
				{
					row: 5,
					employee_number: 'E1',
					work_date: '2026-10-08',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '17:00',
					overtime_hours: '6'
				},
				{
					row: 6,
					employee_number: 'E1',
					work_date: '2026-10-09',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '17:00',
					overtime_hours: '6'
				},
				{
					row: 7,
					employee_number: 'E1',
					work_date: '2026-10-10',
					shift_code: 'R',
					clock_in: '08:00',
					clock_out: '16:00',
					overtime_hours: '8'
				}
			]),
			[7]
		);
		const child = await rosterImport(
			[{ number: 'E2', profile: { date_of_birth: '2013-01-01' } }],
			[
				{
					row: 2,
					employee_number: 'E2',
					work_date: '2026-10-05',
					shift_code: 'D',
					clock_in: '09:00',
					clock_out: '12:00'
				}
			]
		);
		assert.deepEqual(
			child.errors.map((finding) => finding.row),
			[2]
		);
		assert.match(child.errors[0]!.message, /under 15/);
		for (const version of VERSIONS) {
			const roster = rows(version, 'rule_set').filter((row) =>
				String(row.code).startsWith('ROSTER_')
			);
			assert.deepEqual(
				roster.map((row) => [row.code, (row.rules as Row).kind]),
				[
					['ROSTER_NORMAL_HOURS_DAY', 'warn'],
					['ROSTER_NORMAL_HOURS_WEEK', 'warn'],
					['ROSTER_OVERTIME_WEEK', 'warn'],
					['ROSTER_OVERTIME_CONSENT', 'warn'],
					['ROSTER_REST_BREAK', 'warn'],
					['ROSTER_WEEKLY_HOLIDAY', 'warn'],
					['ROSTER_PREGNANT_WORK', 'warn'],
					['ROSTER_YOUNG_WORKER', 'warn'],
					['ROSTER_UNDER_15', 'refuse']
				],
				version
			);
			const rule = (code: string) => (context: Row) =>
				evaluateConfigured(String((roster.find((row) => row.code === code)!.rules as Row).when), {
					terms: { work_classification: 'ORDINARY', facts: {} },
					employee: { date_of_birth: '1990-01-01', facts: {} },
					week: { worked_hours: 40, overtime_hours: 0, worked_days: 5 },
					...context,
					day: {
						date: '2026-10-05',
						day_type: 'WORK',
						holiday_kind: '',
						worked: true,
						worked_hours: 8,
						overtime_hours: 0,
						intervals: [],
						...(context.day as Row)
					}
				});
			// ss.24-25: the sheet's per-day consent; a day with overtime and none warns, a consented day does not.
			assert.equal(rule('ROSTER_OVERTIME_CONSENT')({ day: { overtime_hours: 2 } }), true);
			assert.equal(
				rule('ROSTER_OVERTIME_CONSENT')({
					day: {
						overtime_hours: 2,
						overtime_consented: true,
						overtime_consented_at: '2026-10-05T01:00:00Z'
					}
				}),
				false
			);
			assert.equal(
				rule('ROSTER_OVERTIME_CONSENT')({ day: { holiday_kind: 'PUBLIC_HOLIDAY' } }),
				true
			);
			assert.equal(rule('ROSTER_OVERTIME_CONSENT')({}), false);
			assert.equal(
				rule('ROSTER_OVERTIME_CONSENT')({
					day: { overtime_hours: 2 },
					terms: { work_classification: 'ORDINARY', facts: { continuous_work: true } }
				}),
				false
			);
			const night = [{ start: '2026-10-05T21:00', end: '2026-10-05T23:00' }];
			assert.equal(
				rule('ROSTER_NORMAL_HOURS_DAY')({
					day: { worked_hours: 8 },
					terms: { work_classification: 'HAZARDOUS', facts: {} }
				}),
				true
			);
			assert.equal(rule('ROSTER_NORMAL_HOURS_DAY')({ day: { worked_hours: 8 } }), false);
			assert.equal(
				rule('ROSTER_NORMAL_HOURS_WEEK')({
					week: { worked_hours: 50, overtime_hours: 1, worked_days: 6 }
				}),
				true
			);
			assert.equal(
				rule('ROSTER_NORMAL_HOURS_WEEK')({
					week: { worked_hours: 50, overtime_hours: 2, worked_days: 6 }
				}),
				false
			);
			assert.equal(
				rule('ROSTER_OVERTIME_WEEK')({
					day: { overtime_hours: 2 },
					week: {
						worked_hours: 80,
						overtime_hours: 37,
						worked_days: 6,
						overtime_hours_by_day_type: { WORK: 29, REST: 8, OFF: 0, HOLIDAY: 0 }
					}
				}),
				true
			);
			// s.26: rest-day and holiday overtime count; a holiday on a working day counts once.
			assert.equal(
				rule('ROSTER_OVERTIME_WEEK')({
					day: { overtime_hours: 2 },
					week: {
						worked_hours: 80,
						overtime_hours: 36,
						worked_days: 6,
						overtime_hours_by_day_type: { WORK: 30, REST: 6, OFF: 0, HOLIDAY: 6 }
					}
				}),
				false
			);
			assert.equal(
				rule('ROSTER_REST_BREAK')({
					day: {
						worked_hours: 6,
						intervals: [{ start: '2026-10-05T08:00', end: '2026-10-05T14:00' }]
					}
				}),
				true
			);
			assert.equal(
				rule('ROSTER_WEEKLY_HOLIDAY')({
					week: { worked_hours: 56, overtime_hours: 0, worked_days: 7 }
				}),
				true
			);
			assert.equal(rule('ROSTER_WEEKLY_HOLIDAY')({}), false);
			const pregnant = { employee: { date_of_birth: '1990-01-01', facts: { pregnant: true } } };
			assert.equal(rule('ROSTER_PREGNANT_WORK')({ ...pregnant, day: { intervals: night } }), true);
			assert.equal(
				rule('ROSTER_PREGNANT_WORK')({ ...pregnant, day: { holiday_kind: 'PUBLIC_HOLIDAY' } }),
				true
			);
			assert.equal(rule('ROSTER_PREGNANT_WORK')({ ...pregnant }), false);
			const young = { employee: { date_of_birth: '2010-01-01', facts: {} } };
			assert.equal(rule('ROSTER_YOUNG_WORKER')({ ...young, day: { overtime_hours: 1 } }), true);
			assert.equal(rule('ROSTER_YOUNG_WORKER')({ ...young }), false);
			assert.equal(
				rule('ROSTER_UNDER_15')({ employee: { date_of_birth: '2012-01-01', facts: {} } }),
				true
			);
			assert.equal(rule('ROSTER_UNDER_15')({ ...young }), false);
		}
	});

	it('enacted steps: SSO 20,000 from 2029 and 23,000 from 2032; EWF 0.5% from 1 October 2031', () => {
		const range = (version: string) =>
			settings(version).effective_range as { from: string; to: string | null };
		assert.deepEqual(range('version_4'), { from: '2026-10-01', to: '2028-12-31' });
		assert.deepEqual(range('version_5'), { from: '2029-01-01', to: '2031-09-30' });
		assert.deepEqual(range('version_6'), { from: '2031-10-01', to: '2031-12-31' });
		assert.deepEqual(range('version_7'), { from: '2032-01-01', to: null });
		assert.deepEqual(charge('version_4', 'SSO', 30_000), { employee: 875, employer: 875 });
		assert.deepEqual(charge('version_5', 'SSO', 30_000), { employee: 1_000, employer: 1_000 });
		assert.deepEqual(charge('version_6', 'SSO', 30_000), { employee: 1_000, employer: 1_000 });
		assert.deepEqual(charge('version_7', 'SSO', 30_000), { employee: 1_150, employer: 1_150 });
		assert.deepEqual(charge('version_5', 'EWF', 20_000, {}, { headcount: 12 }), {
			employee: 50,
			employer: 50
		});
		assert.deepEqual(charge('version_6', 'EWF', 20_000, {}, { headcount: 12 }), {
			employee: 100,
			employer: 100
		});
		assert.deepEqual(charge('version_7', 'EWF', 20_000, {}, { headcount: 12 }), {
			employee: 100,
			employer: 100
		});
	});

	it('returns: the SSO 135-character contribution file and the RD central-format PND1 / PND1 Kor files', () => {
		const company = {
			name: 'บริษัท ตัวอย่าง จำกัด',
			facts: {
				tax_id: '0105551234567',
				sso_employer_account_number: '1090002301',
				sso_branch_number: '000000',
				rd_branch_type: 'V',
				rd_filing_reference: 'REF0001'
			}
		};
		const slip = (period: string, statutory: Row) => ({
			period,
			status: 'APPROVED',
			lines: {},
			statutory
		});
		const nat = {
			employee: {
				name: 'ณัฐ ประกันสังคม',
				gender: 'MALE',
				identity_number: '3100400442136',
				facts: {
					address_district: 'ราชเทวี',
					address_province: 'กรุงเทพมหานคร',
					address_postcode: '10400'
				}
			},
			contract: {},
			slips: [
				slip('2026-10', {
					SSO: { employee: 875, employer: 875, base: 17500 },
					PND1: { employee: 1250.5, employer: 0, base: 30000 }
				})
			]
		};
		const rapee = {
			employee: {
				name: 'รพีภรณ์ น้อยแนม',
				gender: 'FEMALE',
				marital_status: 'SINGLE',
				facts: { tax_id: '3101400588433' }
			},
			contract: {},
			slips: [
				slip('2026-10', {
					SSO: { employee: 83, employer: 83, base: 1650 },
					PND1: { employee: 0, employer: 0, base: 1500 }
				})
			]
		};
		const payee = { employee: { name: 'Payee' }, contract: {}, slips: [slip('2026-10', {})] };
		const blanks = (n: number) => Array.from({ length: n }, () => '');
		for (const version of VERSIONS) {
			const templates = rows(version, 'rule_set')
				.filter((row) => row.family === 'EXPORTS')
				.map((row) => ({ code: String(row.code), rules: row.rules }));
			assert.deepEqual(
				templates.map((row) => row.code),
				['SSO_CONTRIBUTION_FILE', 'PND1_ATTACHMENT_FILE', 'PND1A_ATTACHMENT_FILE']
			);
			const month = recordDocuments(
				templates,
				[{ period: '2026-10', pay_date: '2026-10-31' }],
				[nat, rapee, payee] as never,
				company,
				'2026-11-10T03:00:00.000Z'
			);
			assert.deepEqual(
				month.map((doc) => doc.name),
				['sso-2026-10.txt', 'PND1_0105551234567_000000_2569_10_00_00.txt']
			);
			// SSO Format 135: header record 1 and a detail record 2 per insured person, 135 characters each.
			const sso = month[0]!.content.split('\n');
			assert.deepEqual(
				sso.map((line) => line.length),
				[135, 135, 135]
			);
			assert.equal(
				sso[0],
				'1' +
					'1090002301' +
					'000000' +
					'101169' + // paid 10 November 2569
					'1069' + // wage period October 2569
					'บริษัท ตัวอย่าง จำกัด'.padEnd(45) +
					'0500' +
					'000002' +
					'000000001915000' +
					'00000000191600' +
					'000000095800' +
					'000000095800'
			);
			assert.equal(
				sso[1],
				'2' +
					'3100400442136' +
					'003' +
					'ณัฐ'.padEnd(30) +
					'ประกันสังคม'.padEnd(35) +
					'00000001750000' +
					'000000087500' +
					''.padEnd(27)
			);
			assert.equal(sso[2]!.slice(14, 17), '004'); // นางสาว from gender and marital status
			assert.equal(sso[2]!.slice(1, 14), '3101400588433'); // the tax_id fact before identity_number
			// RD central format: pipe-separated, CR/LF records, H then D per employee paid 40(1) income.
			assert.equal(
				month[1]!.content,
				[
					'H|0000|0105551234567|000000|1|PND1|0105551234567|000000|สำนักงานใหญ่|0|10|2569|V|00|2|31500.00|1250.50|0.00|1250.50|0.00|REF0001|1',
					[
						'D|1|000000|3100400442136|0000000000|นาย|ณัฐ|ประกันสังคม|31102569|4.17|30000.00|1250.50|1|1',
						...blanks(9),
						'ราชเทวี|กรุงเทพมหานคร|10400'
					].join('|'),
					[
						'D|2|000000|3101400588433|0000000000|นางสาว|รพีภรณ์|น้อยแนม|31102569|0.00|1500.00|0.00|1|1',
						...blanks(12)
					].join('|'),
					''
				].join('\r\n')
			);
			// PND1 Kor: the year's runs (December among them), tax month 00, the year end as the paid date.
			const year = recordDocuments(
				templates,
				[
					{ period: '2026-11', pay_date: '2026-11-30' },
					{ period: '2026-12', pay_date: '2026-12-31' }
				],
				[
					{
						...nat,
						slips: [
							...nat.slips,
							slip('2026-12', { PND1: { employee: 1249.5, employer: 0, base: 30000 } })
						]
					}
				] as never,
				company,
				'2027-02-01T03:00:00.000Z'
			);
			assert.deepEqual(
				year.map((doc) => doc.name),
				['PND1A_0105551234567_000000_2569_00_00_00.txt']
			);
			const [header, detail] = year[0]!.content.split('\r\n');
			assert.equal(
				header,
				'H|0000|0105551234567|000000|1|PND1A|0105551234567|000000|สำนักงานใหญ่|0|00|2569|V|00|1|60000.00|2500.00|0.00|2500.00|0.00|REF0001|1'
			);
			assert.ok(
				detail!.startsWith(
					'D|1|000000|3100400442136|0000000000|นาย|ณัฐ|ประกันสังคม|31122569|4.17|60000.00|2500.00|1|1|'
				)
			);
		}
	});

	it('LPA s.5: a benefit in kind is not wage — rates and the minimum wage ignore it, PND1 projects it', () => {
		const fixedIds = VERSIONS.map((version) =>
			String(find(version, 'allowance_catalog', 'FIXED_ALLOWANCE').id)
		);
		for (const version of VERSIONS) {
			const wageOf = (terms: Row) =>
				Number(
					evaluateConfigured(String((settings(version).payroll as Row).monthly_wage), { terms })
				);
			const bik = { code: 'BENEFIT_IN_KIND', amount: 2_000 };
			// Base 10,000 with 2,000 housing: the wage is 10,000; a fixed allowance by code or by catalogue id alone counts.
			assert.equal(wageOf({ base_salary: 10_000, allowances: [bik] }), 10_000, version);
			assert.equal(
				wageOf({
					base_salary: 10_000,
					allowances: [
						bik,
						{
							catalogue_id: String(find(version, 'allowance_catalog', 'BENEFIT_IN_KIND').id),
							amount: 500
						},
						{ code: 'FIXED_ALLOWANCE', amount: 1_000 },
						{ catalogue_id: fixedIds[0], amount: 1_000 }
					]
				}),
				12_000,
				version
			);
			// The contract refuses in Bangkok: 10,000 / 30 = 333.33 a day, below 400 (the housing does not lift it).
			const terms = {
				base_salary: 10_000,
				allowances: [bik],
				monthly_wage: wageOf({ base_salary: 10_000, allowances: [bik] }),
				facts: {}
			};
			const subjectRoots = subject({ company: { region: 'BANGKOK', facts: {} }, terms });
			assert.equal(
				evaluateConfigured(String((find(version, 'rule_set', 'MINIMUM_WAGE').rules as Row).when), {
					...subjectRoots,
					rules: payrollRules(version),
					term: subjectRoots.terms
				}),
				true,
				version
			);
			// The overtime hour is 10,000 / 30 / 8, not 12,000 / 30 / 8.
			const overtime = find(version, 'work_catalog', 'OVERTIME');
			const context = salaryContext(version, { terms });
			assert.equal(
				Number(evaluateConfigured(String(overtime.rate), context)),
				(1.5 * 10_000) / 30 / 8,
				version
			);
			// PND1 projects the housing for the remaining months: 40,000 wage + 20,000 housing (60,000 assessed this month)
			// withholds exactly what a 60,000 cash wage does; leaving it out of the projection would under-withhold.
			const housed = charge(version, 'PND1', 60_000, {
				terms: {
					base_salary: 40_000,
					monthly_wage: 40_000,
					allowances: [{ ...bik, amount: 20_000 }]
				}
			}).employee;
			const cash = charge(version, 'PND1', 60_000, {
				terms: { base_salary: 60_000, monthly_wage: 60_000, allowances: [] }
			}).employee;
			assert.ok(cash > 0, version);
			assert.equal(housed, cash, version);
			// LPA s.5 and s.131: minimum-wage arrears and suspension back pay are wages, so they carry EWF from version_4.
			for (const code of ['MINIMUM_WAGE_ARREARS', 'SUSPENSION_BACK_PAY'])
				assert.equal(
					(find(version, 'adhoc_catalog', code).counts_toward as string[]).includes('EWF'),
					ewf(version),
					`${version} ${code}`
				);
		}
	});
});
