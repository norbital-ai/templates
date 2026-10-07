/** ID public lineage: version structure, input schemas, obligations, CEL on the engine context and the statutory amounts in force. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { Effect, Schema } from 'effect';
import { Behaviours, effectWrites, planBehaviours } from '../src/lib/payroll_engine/behaviours.js';
import { dutiesOf, raiseDuties, triggerOf, withBalances } from './duties.ts';
import { evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { Reads } from '../src/lib/payroll_engine/foundation.js';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.js';

type Row = Record<string, any>;

const lineages = resolve(process.cwd(), 'seed/jurisdiction');
const root = resolve(lineages, 'ID');
const CATALOGS = [
	'adhoc_catalog',
	'allowance_catalog',
	'claim_catalog',
	'leave_catalog',
	'loan_catalog',
	'rule_set',
	'statutory_contribution_catalog',
	'work_catalog'
] as const;
const versions = readdirSync(root)
	.filter((entry) => entry.startsWith('version_'))
	.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const read = (version: string, table: string): Row[] =>
	JSON.parse(readFileSync(resolve(root, version, `${table}.json`), 'utf8'));
const settingsOf = (version: string): Row => read(version, 'jurisdiction_settings')[0]!;
const scheme = (version: string, code: string): Row =>
	read(version, 'statutory_contribution_catalog').find((row) => row.code === code)!;
const catalog = (version: string, table: string, code: string): Row =>
	read(version, table).find((row) => row.code === code)!;
/** Every duty row, its trigger named by lifecycle. */
const obligations = (version: string) =>
	dutiesOf(read(version, 'rule_set')).map((row) => ({
		...row,
		rules: { ...(row.rules as Row), trigger: triggerOf(row) }
	}));
const payrollRules = (version: string) =>
	Object.fromEntries(
		read(version, 'rule_set')
			.filter((row) => row.family === 'PAYROLL')
			.map((row) => [row.code, row.rules])
	);

const modelFields = async (table: string): Promise<Set<string>> => {
	const model = (await import(`../src/data/model/jurisdiction/${table}/+model.ts`)).default;
	const fields = new Set(['id', ...Object.keys(model.fields)]);
	const relationships = readFileSync(resolve(process.cwd(), 'src/data/+relationship.ts'), 'utf8');
	for (const [, field] of relationships.matchAll(new RegExp(`'${table}\\.(\\w+)'`, 'g')))
		fields.add(field!);
	return fields;
};

const nextDay = (day: string): string => {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
};

// ── The subject `subjectContext` builds (services.ts), with the facts the ID records read. ─────────────────────
const subject = (over: { employee?: Row; company?: Row; terms?: Row; employment?: Row } = {}) => {
	const employment = {
		classification: 'ORDINARY',
		service_months: 40,
		exit_date: '',
		start_date: '2022-08-01',
		exit_ground: '',
		exit_facts: {},
		...over.employment
	};
	const terms = {
		work_classification: 'ORDINARY',
		statutory_work_category: 'NON_MANUAL',
		employment_type: 'PERMANENT',
		residency_status: 'CITIZEN',
		residency_since: '',
		facts: { working_days_per_week: 5 },
		base_salary: 8_000_000,
		monthly_wage: 8_000_000,
		...over.terms
	};
	return {
		employee: {
			gender: 'MALE',
			marital_status: 'MARRIED',
			spouse_status: '',
			solo_parent: false,
			disabled: false,
			receiving_pension: false,
			nationality: 'ID',
			date_of_birth: '1990-05-01',
			age: 35,
			children: [],
			dependents_count: 1,
			facts: {},
			...over.employee
		},
		company: {
			region: 'Provinsi DKI Jakarta',
			risk_class: 'II',
			pay_frequency: 'MONTHLY',
			facts: { leave_cash_out_day_divisor: 25, leave_cash_out_wage_basis: 'BASIC' },
			...over.company
		},
		terms,
		employment,
		person: {
			employment,
			race: null,
			religion: null,
			nationality: 'ID',
			residency_status: terms.residency_status,
			residency_since: null
		}
	};
};

const SCHEMES = [
	'JHT',
	'JP',
	'JKK',
	'JKM',
	'KESEHATAN',
	'JKP',
	'PPH21',
	'PPH21_FINAL_SEVERANCE',
	'PPH26'
];
/** `charged.month` / `charged.year`: every scheme at zero unless given. */
const chargedOf = (given: Row = {}) =>
	Object.fromEntries(SCHEMES.map((code) => [code, { employee: 0, employer: 0, ...given[code] }]));

/**
 * One scheme's month charge exactly as `assessStatutory` evaluates it: person facts, assessable parts, the guards
 * and the first matching rule. `wage` is the month's raw parts; `year` the earlier months' stored parts; `charged`
 * the schemes' charges (`month` so far, earlier `year`); `elections` this scheme's declared elections.
 */
const assess = (
	row: Row,
	wage: Row,
	options: {
		subject?: ReturnType<typeof subject>;
		period?: string;
		year?: Row;
		charged?: { month?: Row; year?: Row };
		elections?: Row;
		version?: string;
	} = {}
): { employee: number; employer: number; parts: Row } | 'REFUSED' | null => {
	const base = options.subject ?? subject();
	const key = options.period ?? '2026-03';
	const to = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0))
		.toISOString()
		.slice(0, 10);
	const configuration = row.configuration;
	const parts = new Set([
		'ordinary',
		...Object.keys(wage),
		...Object.keys(configuration.assessable ?? {})
	]);
	const month = Object.fromEntries([...parts].map((part) => [part, wage[part] ?? 0]));
	const year = Object.fromEntries([...parts].map((part) => [part, options.year?.[part] ?? 0]));
	let context: Row = {
		...base,
		wage: month,
		month,
		year,
		rules: payrollRules(options.version ?? 'version_3'),
		charged: { month: chargedOf(options.charged?.month), year: chargedOf(options.charged?.year) },
		elections: { [row.code]: options.elections ?? {} },
		scheme: { code: row.code, standing: 'REGISTERED', elections: options.elections ?? {} },
		period: {
			key,
			from: `${key}-01`,
			to,
			days: Number(to.slice(8)),
			month: Number(key.slice(5)),
			salary_paid: false
		}
	};
	const person: Row = {};
	for (const [fact, expression] of Object.entries(configuration.person ?? {}))
		person[fact] = evaluateConfigured(expression as string, context);
	context = { ...context, person: { ...base.person, ...person } };
	const assessed: Row = {};
	for (const part of parts) {
		const expression = configuration.assessable?.[part];
		assessed[part] = Math.max(
			0,
			expression == null ? month[part] : Number(evaluateConfigured(expression, context))
		);
	}
	const total = Object.values(assessed).reduce((sum: number, value) => sum + Number(value), 0);
	context = { ...context, base: { ...assessed, assessed: total, amount: total } };
	for (const guard of configuration.refuse_when ?? [])
		if (evaluateConfigured(guard.when, context) === true) return 'REFUSED';
	for (const rule of configuration.rules ?? []) {
		if (rule.when != null && evaluateConfigured(rule.when, context) !== true) continue;
		return {
			employee: rule.employee == null ? 0 : Number(evaluateConfigured(rule.employee, context)),
			employer: rule.employer == null ? 0 : Number(evaluateConfigured(rule.employer, context)),
			parts: assessed
		};
	}
	return null;
};

/** One `work.days[]` entry as `workDay` (services.ts) builds it. */
const day = (over: Row = {}) => ({
	date: '2026-03-09',
	day_type: 'WORK',
	shift_code: 'D8',
	holiday_kind: '',
	scheduled_hours: 8,
	worked_hours: 8,
	overtime_hours: 0,
	incentive_hours: 0,
	intervals: [],
	...over
});
/** One `leave.rows[]` entry as the payslip projects it. */
const leaveRow = (over: Row = {}) => ({
	code: 'ANNUAL_LEAVE',
	activity: 'TIME_OFF',
	days: 1,
	from: '2026-03-02',
	to: '2026-03-02',
	is_npl: false,
	can_encash: false,
	event_id: '',
	month_index: 1,
	facts: {},
	pay_fraction: 1,
	...over
});

// The payslip context `buildPayslip` builds.
const period = { key: '2026-03', from: '2026-03-01', to: '2026-03-31', days: 31, paid_days: 31 };
const payslipOf = (over: Parameters<typeof subject>[0] = {}, version = 'version_3') => ({
	...subject(over),
	rules: payrollRules(version),
	period,
	work: {
		overtime_hours: 2,
		incentive_hours: 0,
		dates: ['2026-03-09'],
		holidays: [],
		// One ordinary working day with 2 approved overtime hours.
		days: [day({ overtime_hours: 2 })]
	},
	leave: {
		rows: [
			leaveRow({ code: 'ANNUAL_LEAVE', activity: 'ENCASHMENT', days: 2, can_encash: true }),
			leaveRow({ code: 'UNPAID_LEAVE', days: 1, is_npl: true })
		]
	}
});
const entry = (facts: Row = {}) => ({
	amount: 500_000,
	quantity: 1,
	occurred_on: '2026-03-02',
	due_on: '2026-03-02',
	incurred_on: '2026-03-02',
	...facts,
	facts
});
const EXIT_FACTS = {
	termination_cause: 'EFFICIENCY_ACTUAL_LOSS',
	separation_wage_basis: 'MONTHLY',
	separation_daily_wage: 0,
	output_average_12m: 0,
	micro_small_enterprise: false,
	agreed_pesangon_amount: 0,
	agreed_upmk_amount: 0,
	agreed_pkwt_compensation_amount: 0,
	separation_pay_amount: 7_000_000,
	pension_offset_applies: true,
	employer_funded_pension_benefit: 5_000_000
};

/** Every CEL a version's rows carry, with where it sits. */
const celOf = (version: string): string[] => {
	const out: string[] = [];
	const walk = (value: unknown, key = ''): void => {
		if (typeof value === 'string') {
			if (
				/^(when|employee|employer|eligibility|qualifies_when|quantity|rate|amount|due|assessment|days|pay_fraction)$/.test(
					key
				) ||
				/[.(]/.test(value) // person/assessable map values
			)
				out.push(value);
			return;
		}
		if (Array.isArray(value)) for (const item of value) walk(item, key);
		else if (value != null && typeof value === 'object')
			for (const [child, item] of Object.entries(value))
				if (child !== 'authority' && child !== 'limitation' && child !== 'description')
					walk(item, child);
	};
	for (const table of CATALOGS)
		for (const row of read(version, table))
			walk(table === 'statutory_contribution_catalog' ? row.configuration : row);
	return out;
};

/** A structural JSON Schema 2020-12 check of the keywords these schemas use. */
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
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
	'minLength',
	'pattern',
	'default'
]);
const checkSchema = (node: Row, path: string): void => {
	for (const key of Object.keys(node))
		assert.ok(KEYWORDS.has(key), `${path}: unknown keyword ${key}`);
	const types = node.type == null ? [] : Array.isArray(node.type) ? node.type : [node.type];
	for (const type of types) assert.ok(TYPES.has(type), `${path}: type ${type}`);
	if (node.enum != null)
		assert.ok(Array.isArray(node.enum) && node.enum.length > 0, `${path}: enum`);
	if (node.pattern != null) new RegExp(node.pattern);
	if (node.properties != null) {
		assert.ok(types.includes('object'), `${path}: properties on a non-object`);
		for (const [key, child] of Object.entries(node.properties))
			checkSchema(child as Row, `${path}.${key}`);
	}
	if (node.items != null) checkSchema(node.items, `${path}[]`);
};

/** An ID company with four people on the engine's own read surface, and a run helper that stores what it plans. */
const idWorld = () => {
	const COMPANY = 'c0000000-0000-4000-8000-0000000000id';
	const law = (name: string): Row[] =>
		versions
			.flatMap((version) => read(version, name))
			.map((row) => ({ approval_id: null, ...row }));
	const contract = (id: string, salary: number, residency: string, to: string | null = null) => ({
		id: `k-${id}`,
		employee_id: id,
		company_id: COMPANY,
		approval_id: null,
		effective_range: { from: '2024-01-01', to },
		facts: {
			contract_terms: [
				{
					base_salary: { value: salary, currency: 'IDR' },
					effective_range: { from: '2024-01-01', to: null },
					residency_status: residency,
					work_classification: 'ORDINARY',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					allowances: []
				}
			]
		}
	});
	const tables = new Map<string, Row[]>([
		...['jurisdiction_settings', 'rule_set', ...CATALOGS.filter((name) => name !== 'rule_set')].map(
			(name) => [name, law(name)] as [string, Row[]]
		),
		[
			'entity',
			[
				{
					id: COMPANY,
					name: 'Nusantara',
					settings_code: 'ID',
					pay_frequency: 'MONTHLY',
					region: 'Provinsi DKI Jakarta',
					risk_class: 'II',
					facts: {},
					approval_id: null
				}
			]
		],
		[
			'employment_profile',
			[
				{
					id: 'p1',
					name: 'Budi',
					gender: 'MALE',
					marital_status: 'MARRIED',
					dependents_count: 1,
					date_of_birth: '1990-02-01',
					nationality: 'ID',
					facts: {}
				},
				{
					id: 'p2',
					name: 'Sari',
					gender: 'FEMALE',
					marital_status: 'MARRIED',
					dependents_count: 2,
					date_of_birth: '1992-07-12',
					nationality: 'ID',
					facts: {}
				},
				{
					id: 'p3',
					name: 'Ken',
					gender: 'MALE',
					marital_status: 'SINGLE',
					dependents_count: 0,
					date_of_birth: '1985-07-12',
					nationality: 'JP',
					facts: {}
				},
				{
					id: 'p4',
					name: 'Dewi',
					gender: 'FEMALE',
					marital_status: 'SINGLE',
					dependents_count: 0,
					date_of_birth: '1995-07-12',
					nationality: 'ID',
					facts: {}
				}
			]
		],
		[
			'employment_contract',
			[
				contract('p1', 10_000_000, 'CITIZEN'),
				contract('p2', 20_000_000, 'CITIZEN'),
				contract('p3', 30_000_000, 'NON_RESIDENT'),
				contract('p4', 10_000_000, 'CITIZEN', '2026-06-30')
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
	const run = async (month: string, kind: PayrollRunKind, sources?: string[]) => {
		const plan = await Effect.runPromise(
			buildPayrollRun({
				company_id: COMPANY,
				period: month,
				kind,
				...(sources ? { sources } : {})
			}).pipe(Effect.provideService(Reads, reads))
		);
		const id = `run-${++runs}`;
		tables.get('payroll_run')!.push({ ...plan.run, id });
		for (const slip of plan.payslips) {
			const slipId = `${id}-${slip.employment_id}`;
			tables.get('payslip')!.push({ ...slip, id: slipId, payroll_run_id: id });
			// What `pin-settled-entries` does after the run: each consumed entry is settled on its slip.
			for (const pin of slip.pins)
				for (const row of tables.get(pin.collection) ?? [])
					if (row.id === pin.id) row.payslip_id = slipId;
		}
		return plan;
	};
	const lines = (plan: Awaited<ReturnType<typeof run>>, who: string) =>
		Object.fromEntries(
			plan.payslips
				.find((slip) => slip.employment_id === `k-${who}`)!
				.statutory.filter((line) => line.employee_amount !== 0 || line.employer_amount !== 0)
				.map((line) => [line.scheme_code, [line.employee_amount, line.employer_amount]])
		);
	return { COMPANY, tables, run, lines };
};

describe('ID jurisdiction seed', () => {
	it('every version holds settings, rule_set and every catalogue, with unique ids owned by its own settings row', async () => {
		const seen = new Map<string, string>();
		for (const version of versions) {
			const settings = settingsOf(version);
			assert.equal(settings.code, 'ID');
			assert.equal(settings.jurisdiction_code, 'ID');
			for (const table of ['jurisdiction_settings', ...CATALOGS]) {
				const fields = await modelFields(table);
				for (const row of read(version, table)) {
					assert.equal(
						seen.has(row.id),
						false,
						`${version}/${table} ${row.id} also in ${seen.get(row.id)}`
					);
					seen.set(row.id, `${version}/${table}`);
					for (const key of Object.keys(row))
						assert.ok(
							fields.has(key),
							`${version}/${table} ${row.code}: ${key} is not on the model`
						);
					if (table !== 'jurisdiction_settings')
						assert.equal(row.settings_id, settings.id, `${version}/${table} ${row.code}`);
				}
			}
		}
		// No id is shared with another lineage.
		const others = new Set(
			readdirSync(lineages)
				.filter((lineage) => lineage !== 'ID')
				.flatMap((lineage) =>
					readdirSync(resolve(lineages, lineage))
						.filter((entry) => entry.startsWith('version_'))
						.flatMap((version) =>
							readdirSync(resolve(lineages, lineage, version))
								.filter((name) => name.endsWith('.json'))
								.flatMap((name) =>
									(
										JSON.parse(
											readFileSync(resolve(lineages, lineage, version, name), 'utf8')
										) as Row[]
									).map((row) => String(row.id))
								)
						)
				)
		);
		assert.deepEqual(
			[...seen.keys()].filter((id) => others.has(id)),
			[]
		);
	});

	it('versions chain by cloned_from_id and their ranges are contiguous, inclusive and open-ended last', () => {
		const rows = versions.map(settingsOf);
		assert.equal(rows[0]!.cloned_from_id, undefined);
		rows.forEach((row, index) => {
			assert.match(row.effective_range.from, /^\d{4}-\d{2}-01$/);
			assert.equal(row.sealed_at, `${row.effective_range.from}T00:00:00.000Z`);
			if (index === 0) return;
			const previous = rows[index - 1]!;
			assert.equal(row.cloned_from_id, previous.id);
			assert.equal(nextDay(previous.effective_range.to), row.effective_range.from);
		});
		assert.equal(rows.at(-1)!.effective_range.to, null);
	});

	it('catalogue and rule-set codes are stable across versions', () => {
		for (const table of CATALOGS) {
			const codes = versions.map((version) =>
				read(version, table)
					.map((row) => `${row.family ?? ''}:${row.code}`)
					.toSorted()
					.join(',')
			);
			assert.equal(new Set(codes).size, 1, table);
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
				assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
				assert.equal(schema.type, 'object');
				checkSchema(schema, name);
			}
			const term = employee.properties.contract_terms.items.properties;
			assert.deepEqual(term.residency_status.enum, [
				'CITIZEN',
				'RESIDENT_FOREIGNER',
				'NON_RESIDENT'
			]);
			assert.deepEqual(term.employment_type.enum, ['PERMANENT', 'CONTRACT', 'PART_TIME', 'DAILY']);
			assert.equal(term.base_salary.properties.currency.const, 'IDR');
			// One layout: profile and entity columns (gender, marital_status, dependents_count, region, risk_class) are
			// model fields, not schema keys.
			assert.deepEqual(Object.keys(employee.properties), [
				'contract_terms',
				'exit_facts',
				'employment_statutory_facts',
				'facts'
			]);
			for (const column of ['region', 'risk_class'])
				assert.equal(column in entity.properties, false);
			const status = employee.properties.employment_statutory_facts.items.properties.status;
			for (const key of [
				'npwp',
				'bpjs_ketenagakerjaan_npp',
				'bpjs_kesehatan_kode_badan_usaha',
				'wlkp_registration'
			])
				assert.ok(key in entity.properties, key);
			const declared = {
				'employee.facts': new Set(Object.keys(employee.properties.facts.properties)),
				'company.facts': new Set(Object.keys(entity.properties)),
				'employment.exit_facts': new Set(Object.keys(employee.properties.exit_facts.properties)),
				// terms: the term object's own keys plus what subjectContext derives from them.
				terms: new Set([...Object.keys(term), 'monthly_wage']),
				'terms.facts': new Set(Object.keys(term.facts.properties)),
				'scheme.elections': new Set(Object.keys(status.properties.elections.properties))
			};
			const source = celOf(version).join('\n');
			for (const [prefix, keys] of Object.entries(declared))
				for (const [, key] of source.matchAll(
					new RegExp(`(?<![\\w.])${prefix.replace('.', '\\.')}\\.(\\w+)`, 'g')
				))
					assert.ok(keys.has(key!), `${version}: ${prefix}.${key} is read but not declared`);
			// The purged blobs are gone; the minimum wages moved to a PAYROLL rule.
			for (const key of ['obligations', 'duty_types', 'facts', 'terms_facts', 'exit_facts'])
				assert.equal(key in settings.reference_tables, false, key);
			assert.equal('wages' in settings.reference_tables.work_rules, false);
		}
	});

	it('every OBLIGATIONS row is a dated duty whose due evaluates for its trigger', () => {
		const counts = versions.map((version) => obligations(version).length);
		assert.deepEqual(counts, [22, 22, 22]);
		for (const version of versions)
			for (const row of obligations(version)) {
				const rules = row.rules;
				assert.ok(rules.description.length > 0 && rules.authority.length > 0, row.code);
				assert.ok(
					[
						'PAYROLL_RUN',
						'HIRE',
						'EXIT',
						'entity.created',
						'payslip.updated',
						'roster_entry.updated',
						'leave_catalog_entry.created'
					].includes(rules.trigger),
					row.code
				);
				for (const month of rules.months ?? []) assert.match(month, /^(0[1-9]|1[0-2])$/);
				const context = {
					holidays: [],
					holidays_named: [{ date: '2026-12-25', name: 'Christmas Day', kind: 'PUBLIC_HOLIDAY' }],
					headcount: 12,
					today: '2026-12-01',
					company: {
						facts: {
							wlkp_first_reported_on: '2023-12-04',
							company_regulation_valid_until: '2026-12-15'
						}
					},
					row: {
						work_date: '2026-12-07',
						approved_overtime_hours: 2,
						overtime_consented_at: null,
						paid_on: '2026-12-28',
						from: '2026-12-07',
						occurred_on: '2026-12-07',
						catalog_code: 'WORK_ACCIDENT_LEAVE'
					},
					...(rules.trigger === 'HIRE'
						? { hired_on: '2026-03-16' }
						: rules.trigger === 'EXIT'
							? { exit_on: '2026-03-16' }
							: { period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' } })
				};
				assert.match(
					String(evaluateConfigured(rules.due, context)),
					/^\d{4}-\d{2}-\d{2}$/,
					row.code
				);
				if (rules.when != null && rules.trigger !== 'EXIT')
					assert.equal(evaluateConfigured(rules.when, context), true, row.code);
				if (rules.applies_when != null)
					for (const extra of [
						{ contract: { exit_facts: null }, employee: null, company: null },
						{
							contract: { exit_facts: EXIT_FACTS, facts: { contract_terms: [] } },
							employee: { nationality: 'ID' },
							company: {}
						}
					])
						assert.equal(
							typeof evaluateConfigured(rules.applies_when, { ...context, ...extra }),
							'boolean',
							row.code
						);
			}
		const due = (code: string, context: Row) =>
			evaluateConfigured(obligations('version_3').find((row) => row.code === code)!.rules.due, {
				holidays: [],
				...context
			});
		const march = { period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' } };
		// PPh 21: deposit by the 15th, SPT Masa by the 20th of the next month; BPJS TK 15th next, Kesehatan 10th same.
		assert.equal(due('PPH21_PAYMENT', march), '2026-04-15');
		assert.equal(due('PPH21_SPT_MASA', march), '2026-04-20');
		assert.equal(due('BPJS_KETENAGAKERJAAN_REMITTANCE', march), '2026-04-15');
		assert.equal(due('BPJS_KESEHATAN_REMITTANCE', march), '2026-03-10');
		assert.equal(
			due('PPH21_BPA1_YEAR_END', {
				period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' }
			}),
			'2027-01-31'
		);
		assert.equal(
			due('THR_PAYMENT', {
				period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' },
				holidays_named: [{ date: '2026-12-25', name: 'Christmas Day', kind: 'PUBLIC_HOLIDAY' }]
			}),
			'2026-12-18'
		);
		assert.equal(
			due('BPJS_KETENAGAKERJAAN_REGISTRATION', { hired_on: '2026-03-16' }),
			'2026-04-15'
		);
		assert.equal(due('PPH21_BPA1_EXIT', { exit_on: '2026-03-16' }), '2026-04-30');
		// PP 44/2015 art.21(3), Perpres 82/2018 art.39(4), PMK 81/2024: a due day on a weekend or published holiday
		// rolls to the next working day — 15 August 2026 is a Saturday and 17 August Independence Day.
		const july = { period: { key: '2026-07', from: '2026-07-01', to: '2026-07-31' } };
		assert.equal(due('PPH21_PAYMENT', { ...july, holidays: ['2026-08-17'] }), '2026-08-18');
		assert.equal(due('BPJS_KETENAGAKERJAAN_REMITTANCE', july), '2026-08-17');
		// PP 35/2021 art.14: PKWT registration in 3 working days; Permenaker 2/2025 art.9: JKP notice in 7.
		assert.equal(due('PKWT_REGISTRATION', { hired_on: '2026-03-13' }), '2026-03-18');
		assert.equal(due('JKP_PHK_NOTIFICATION', { exit_on: '2026-06-30' }), '2026-07-09');
		assert.equal(due('WLKP_ESTABLISHMENT_REPORT', march), '2026-03-31');
	});

	it('the canonical duty behaviours are present and raise obligation and task writes', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = settings.behaviours;
			assert.ok(Schema.is(Behaviours)(behaviours), version);
			for (const [id, target] of [
				['raise-obligations', 'payroll_run'],
				['raise-tasks', undefined]
			])
				assert.equal(
					behaviours.rules.filter(
						(rule: Row) => rule.id === id && rule.target_collection === target
					).length,
					1,
					id
				);
			const rows = read(version, 'rule_set');
			const company = [{ region: 'Provinsi DKI Jakarta', risk_class: 'II', facts: {} }];
			const raise = (collection: string, event: string, row: Row, reads: Row = {}) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection,
					event,
					row,
					reads: { company, ...reads }
				});
			const run = raise(
				'payroll_run',
				'created',
				{ id: 'r1', approval_id: null, period: '2026-12', company_id: 'c1' },
				{
					raised: [{ duty_code: 'PPH21_PAYMENT', occurrence_key: '' }],
					holidays: [{ date: '2026-12-25', name: 'Christmas Day', kind: 'PUBLIC_HOLIDAY' }]
				}
			);
			const runCodes = run.map((write) => write.duty_code);
			assert.ok(runCodes.includes('PPH21_BPA1_YEAR_END') && runCodes.includes('THR_PAYMENT'));
			assert.equal(runCodes.includes('PPH21_PAYMENT'), false);
			assert.equal(runCodes.includes('PTKP_STATUS_ANNUAL'), false);
			assert.equal(run.find((write) => write.duty_code === 'PPH21_SPT_MASA')!.due_on, '2027-01-20');
			const hire = (nationality: string, facts?: Row) =>
				raise(
					'employment_contract',
					'created',
					{
						id: 'k1',
						approval_id: null,
						company_id: 'c1',
						employee_id: 'p1',
						effective_range: { from: '2026-03-16', to: null },
						...(facts ? { facts } : {})
					},
					{ employee: [{ nationality, gender: 'MALE', date_of_birth: '1990-01-01', facts: {} }] }
				);
			const codes = (writes: Row[]) => writes.map((write) => String(write.duty_code)).toSorted();
			// A contract without terms raises the PKWT registration; permanent terms do not.
			assert.deepEqual(codes(hire('ID')), [
				'BPJS_KESEHATAN_REGISTRATION',
				'BPJS_KETENAGAKERJAAN_REGISTRATION',
				'PKWT_REGISTRATION',
				'PTKP_STATUS_AT_HIRE'
			]);
			assert.ok(codes(hire('JP')).includes('FOREIGN_WORKER_RPTKA_DKPTKA'));
			const pkwtt = { contract_terms: [{ employment_type: 'PERMANENT' }] };
			assert.equal(codes(hire('ID', pkwtt)).includes('PKWT_REGISTRATION'), false);
			assert.ok(
				codes(hire('ID', { contract_terms: [{ employment_type: 'CONTRACT' }] })).includes(
					'PKWT_REGISTRATION'
				)
			);
			assert.ok(hire('ID').every((write) => write.subject_collection === 'employment_contract'));
			const exit = (cause: string | null, nationality = 'ID') =>
				Object.fromEntries(
					raise(
						'employment_contract',
						'updated',
						{
							id: 'k1',
							approval_id: null,
							company_id: 'c1',
							employee_id: 'p1',
							exit_facts: cause == null ? {} : { termination_cause: cause },
							effective_range: { from: '2024-01-01', to: '2026-06-30' }
						},
						{ employee: [{ nationality, gender: 'MALE', date_of_birth: '1990-01-01', facts: {} }] }
					).map((write) => [write.duty_code, write.due_on])
				);
			// Retrenchment of a national: JKP notice in 7 days and the art.38 report; a resignation or a PKWT
			// expiry (no cause) takes only the BPA1; a foreigner is outside JKP.
			assert.deepEqual(exit('EFFICIENCY_ACTUAL_LOSS'), {
				PPH21_BPA1_EXIT: '2026-07-31',
				JKP_PHK_NOTIFICATION: '2026-07-09',
				TERMINATION_REPORT: '2026-06-30'
			});
			assert.deepEqual(exit('VOLUNTARY_RESIGNATION'), { PPH21_BPA1_EXIT: '2026-07-31' });
			assert.deepEqual(exit(null), { PPH21_BPA1_EXIT: '2026-07-31' });
			assert.deepEqual(Object.keys(exit('EFFICIENCY_ACTUAL_LOSS', 'JP')).toSorted(), [
				'PPH21_BPA1_EXIT',
				'TERMINATION_REPORT'
			]);
		}
	});

	it('every CEL expression evaluates on the engine context it runs in, except the reported context gaps', () => {
		const KNOWN_GAPS = new Set<string>();
		const failures = new Set<string>();
		const run = (where: string, expression: unknown, context: object) => {
			if (typeof expression !== 'string' || expression.trim() === '') return;
			try {
				evaluateConfigured(expression, context);
			} catch {
				failures.add(where);
			}
		};
		const people = [
			{},
			{ terms: { residency_status: 'NON_RESIDENT' } },
			{
				terms: { residency_status: 'RESIDENT_FOREIGNER' },
				employee: { gender: 'FEMALE', dependents_count: 3 }
			},
			{ employee: { date_of_birth: '', marital_status: 'SINGLE', dependents_count: 0 } },
			{ company: { risk_class: '' } },
			{ employment: { exit_date: '2026-03-20' } }
		];
		for (const version of versions) {
			for (const row of read(version, 'statutory_contribution_catalog'))
				for (const over of people)
					for (const wage of [0, 5_000_000, 30_000_000])
						try {
							const result = assess(
								row,
								{ ordinary: wage, additional: 0, bpjs: wage },
								{ subject: subject(over) }
							);
							if (result !== null && result !== 'REFUSED')
								assert.ok(Number.isFinite(result.employee) && Number.isFinite(result.employer));
						} catch {
							failures.add(`statutory/${row.code}`);
						}
			const payslip = payslipOf({ employment: { exit_facts: EXIT_FACTS } }, version);
			for (const table of ['work_catalog', 'allowance_catalog'])
				for (const row of read(version, table))
					for (const field of ['eligibility', 'quantity', 'rate', 'amount'])
						run(`${table}/${row.code}.${field}`, row[field], {
							...payslip,
							allowance: { code: row.code, amount: 1_000_000 }
						});
			for (const table of ['adhoc_catalog', 'claim_catalog', 'loan_catalog', 'leave_catalog'])
				for (const row of read(version, table)) {
					const context = {
						...payslip,
						entry: entry({ holiday_date: '2026-03-20', event_kind: 'BIRTH', relationship: 'SELF' })
					};
					for (const field of ['eligibility', 'qualifies_when'])
						run(`${table}/${row.code}.${field}`, row[field], context);
					// `pay_fraction` runs per leave row, with `leave` = that row.
					run(`${table}/${row.code}.pay_fraction`, row.pay_fraction, {
						...context,
						leave: leaveRow({ code: row.code, month_index: 6 })
					});
					for (const band of row.bands ?? [])
						for (const expression of [band.when, band.amount, band.limit?.amount])
							run(`${table}/${row.code}.bands`, expression, context);
					// Admission without event facts still answers (has() guards).
					run(`${table}/${row.code}.eligibility`, row.eligibility, {
						...subject(),
						rules: {},
						entry: entry()
					});
				}
		}
		assert.deepEqual(
			[...failures].filter((where) => !KNOWN_GAPS.has(where)),
			[]
		);
	});

	it('behaviours decode, admit payroll, pin settled entries and encash unused annual leave on exit', () => {
		for (const version of versions) {
			const behaviours = settingsOf(version).behaviours;
			const planned = planBehaviours(
				behaviours,
				{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
				{ event: { data: { request: { kind: 'REGULAR', period: '2026-03' } } } }
			);
			assert.ok(planned.some((rule) => rule.id === 'payroll-run'));
			const pin = behaviours.rules.find((rule: Row) => rule.id === 'pin-settled-entries')!;
			assert.deepEqual(
				effectWrites(pin, {
					event: {
						row: {
							id: 'run',
							approval_id: null,
							pins: [{ employment_id: 'e1', collection: 'roster_entry', id: 'r1' }]
						}
					},
					slips: [{ id: 's1', employment_id: 'e1' }]
				}).map((write) => write.data),
				[{ target: ['r1'], set: { payslip_id: 's1' } }]
			);
			const annual = catalog(version, 'leave_catalog', 'ANNUAL_LEAVE');
			const encash = behaviours.rules.find((rule: Row) => rule.id === 'encash-leave-on-exit')!;
			const exit = (to: string) =>
				effectWrites(
					encash,
					withBalances({
						event: {
							settings_id: settingsOf(version).id,
							row: {
								id: 'c1',
								approval_id: null,
								exit_facts: {},
								prior_service_months: null,
								effective_range: { from: '2022-08-01', to }
							}
						},
						catalogues: [annual],
						movements: [
							{
								catalog_id: annual.id,
								activity: 'TIME_OFF',
								days: 2.5,
								occurred_on: '2026-01-05',
								reference: 'x'
							}
						]
					})
				).map((write) => write.data.days);
			// UU 13/2003 art.79(3): 12 days after each 12 months of continuous service; none before. Owner ruling: the
			// service year resets the balance and carries at most 5 unused days — 12 + 5 − 2.5 taken this year.
			assert.deepEqual(exit('2026-01-31'), [14.5]);
			assert.deepEqual(exit('2023-06-30'), []);
		}
	});

	it('BPJS Ketenagakerjaan and Kesehatan charge the rates in force per version', () => {
		const at = (
			version: string,
			code: string,
			wage: number,
			over: Parameters<typeof subject>[0] = {},
			elections: Row = {}
		) => {
			const result = assess(
				scheme(version, code),
				{ ordinary: wage },
				{ subject: subject(over), version, elections }
			);
			return result === null || result === 'REFUSED'
				? result
				: { employee: result.employee, employer: result.employer };
		};
		const foreigner = {
			terms: { residency_status: 'RESIDENT_FOREIGNER', monthly_wage: 62_000_000 }
		};
		for (const version of versions) {
			// PP 46/2015 art.16: JHT 2% / 3.7% of the contract's monthly rate, no ceiling (owner rule 2026-09-28: whole rate).
			assert.deepEqual(at(version, 'JHT', 31_000_000, foreigner), {
				employee: 1_240_000,
				employer: 2_294_000
			});
			assert.deepEqual(at(version, 'JHT', 4_000_000, { terms: { monthly_wage: 8_000_000 } }), {
				employee: 160_000,
				employer: 296_000
			});
			// PP 44/2015 art.16(1): JKK by risk group; art.18(1) JKM 0.30%; employer only.
			for (const [group, employer] of [
				['I', 17_709],
				['II', 39_845],
				['III', 65_670],
				['IV', 93_709],
				['V', 128_389]
			] as const)
				assert.deepEqual(
					at(version, 'JKK', 0, {
						terms: { monthly_wage: 7_378_688 },
						company: { risk_class: group }
					}),
					{ employee: 0, employer }
				);
			assert.equal(at(version, 'JKK', 7_378_688, { company: { risk_class: '' } }), 'REFUSED');
			assert.deepEqual(at(version, 'JKM', 0, { terms: { monthly_wage: 22_380_750 } }), {
				employee: 0,
				employer: 67_142
			});
			// PP 44/2015 art.19(3): a daily worker's month is 25 days of the agreed daily wage (else the wage paid).
			assert.deepEqual(
				at(version, 'JKM', 3_000_000, {
					terms: { employment_type: 'DAILY', facts: { daily_wage: 200_000 } }
				}),
				{ employee: 0, employer: 15_000 }
			);
			assert.deepEqual(at(version, 'JKM', 3_000_000, { terms: { employment_type: 'DAILY' } }), {
				employee: 0,
				employer: 9_000
			});
			// PP 37/2021 art.11 as amended by PP 6/2025: JKP is government money plus recomposed JKK — no payslip charge.
			assert.equal(at(version, 'JKP', 10_000_000), null);
			// Perpres 82/2018 art.30 as amended: 1% / 4% on a wage capped at 12,000,000; +1% per extra member (art.36).
			assert.deepEqual(at(version, 'KESEHATAN', 27_880_750), {
				employee: 120_000,
				employer: 480_000
			});
			assert.deepEqual(at(version, 'KESEHATAN', 8_000_000, {}, { extra_members: 2 }), {
				employee: 240_000,
				employer: 320_000
			});
			// Perpres 82/2018 art.32(2)–(5): floored at the workplace UMK/UMP outside a micro or small enterprise.
			const floor = payrollRules(version).minimum_wage.by_region['Provinsi DKI Jakarta'];
			assert.deepEqual(at(version, 'KESEHATAN', 3_000_000), {
				employee: Math.round(floor * 0.01),
				employer: Math.round(floor * 0.04)
			});
			assert.deepEqual(
				at(version, 'KESEHATAN', 3_000_000, {
					company: { facts: { enterprise_size_class: 'MICRO_OR_SMALL' } }
				}),
				{ employee: 30_000, employer: 120_000 }
			);
			assert.equal(
				at(version, 'KESEHATAN', 3_000_000, { company: { region: 'Atlantis' } }),
				'REFUSED'
			);
			// PP 45/2015 art.28 1% / 2%: citizens only, stopping at the pension age of 59 (art.15).
			assert.deepEqual(at(version, 'JP', 9_000_000, foreigner), null);
			assert.deepEqual(
				at(version, 'JP', 9_000_000, { employee: { date_of_birth: '1966-01-01' } }),
				null
			);
			assert.deepEqual(at(version, 'JP', 9_000_000, { employee: { date_of_birth: '' } }), {
				employee: 90_000,
				employer: 180_000
			});
		}
		// The JP ceiling: 10,547,400 through February 2026, 11,086,300 from 1 March 2026 (SE BPJS Ketenagakerjaan B/1226/022026).
		assert.deepEqual(
			versions.map((version) => at(version, 'JP', 22_380_750)),
			[
				{ employee: 105_474, employer: 210_948 },
				{ employee: 105_474, employer: 210_948 },
				{ employee: 110_863, employer: 221_726 }
			]
		);
	});

	it('PPh 21 TER bulanan by PTKP category, at the PMK 168/2023 bracket edges', () => {
		const ter = (gross: number, employee: Row, version = 'version_3') => {
			const result = assess(
				scheme(version, 'PPH21'),
				{ ordinary: gross, additional: 0, bpjs: 0, premium: 0, iuran: 0, withheld: 0 },
				{ subject: subject({ employee, terms: { monthly_wage: 0 } }), period: '2026-03' }
			);
			assert.ok(result !== null && result !== 'REFUSED');
			return result.employee;
		};
		const A = { marital_status: 'SINGLE', dependents_count: 0 };
		const B = { marital_status: 'MARRIED', dependents_count: 1 };
		const C = { marital_status: 'MARRIED', dependents_count: 3 };
		for (const version of versions) {
			// Category A: 0% to 5,400,000, 0.25% from 5,400,001; 9% to 24,150,000; 34% above 1,400,000,000.
			assert.equal(ter(5_400_000, A, version), 0);
			assert.equal(ter(5_400_001, A, version), 13_500);
			assert.equal(ter(24_150_000, A, version), 2_173_500);
			assert.equal(ter(1_500_000_000, A, version), 510_000_000);
			// TK/1 and K/0 are A as well.
			assert.equal(
				ter(5_400_001, { marital_status: 'SINGLE', dependents_count: 1 }, version),
				13_500
			);
			assert.equal(
				ter(5_400_001, { marital_status: 'MARRIED', dependents_count: 0 }, version),
				13_500
			);
			// Category B (K/1): 0% to 6,200,000; 1% to 9,200,000; 1.5% to 10,750,000.
			assert.equal(ter(6_200_000, B, version), 0);
			assert.equal(ter(9_200_000, B, version), 92_000);
			assert.equal(ter(10_484_000, B, version), 157_260);
			assert.equal(
				ter(6_500_000, { marital_status: 'SINGLE', dependents_count: 2 }, version),
				16_250
			);
			// Category C (K/3, dependants capped at three): 0% to 6,600,000; 1.25% to 9,800,000.
			assert.equal(ter(6_600_000, C, version), 0);
			assert.equal(ter(9_800_000, C, version), 122_500);
			assert.equal(
				ter(9_800_000, { marital_status: 'MARRIED', dependents_count: 5 }, version),
				122_500
			);
			// A married woman without the kelurahan statement takes TK/0 (A); with it, K/3 (C).
			assert.equal(ter(9_800_000, { ...C, gender: 'FEMALE' }, version), 196_000);
			assert.equal(
				ter(
					9_800_000,
					{ ...C, gender: 'FEMALE', facts: { husband_no_income_certified: true } },
					version
				),
				122_500
			);
		}
		const pph21 = scheme('version_3', 'PPH21');
		const subjectOf = (terms: Row, employee: Row = {}) => subject({ terms, employee });
		// Residency and marital status are required; a daily worker is refused until TER harian has its daily wage.
		assert.equal(
			assess(
				pph21,
				{ ordinary: 8_000_000, additional: 0, bpjs: 8_000_000 },
				{ subject: subjectOf({ residency_status: '' }) }
			),
			'REFUSED'
		);
		assert.equal(
			assess(
				pph21,
				{ ordinary: 8_000_000, additional: 0, bpjs: 8_000_000 },
				{ subject: subjectOf({}, { marital_status: '' }) }
			),
			'REFUSED'
		);
		assert.equal(
			assess(
				pph21,
				{ ordinary: 8_000_000, additional: 0, bpjs: 8_000_000 },
				{ subject: subjectOf({ employment_type: 'DAILY' }) }
			),
			'REFUSED'
		);
		assert.equal(
			assess(
				pph21,
				{ ordinary: 8_000_000, additional: 0, bpjs: 8_000_000 },
				{ subject: subjectOf({ residency_status: 'NON_RESIDENT' }) }
			),
			null
		);
		// TER harian on the agreed daily wage: 0% to 450,000 a day, 0.5% to 2,500,000, on the month's daily gross.
		const daily = (daily_wage: number) =>
			assess(
				pph21,
				{ ordinary: 8_000_000, additional: 0 },
				{ subject: subjectOf({ employment_type: 'DAILY', facts: { daily_wage } }) }
			);
		assert.equal((daily(450_000) as Row).employee, 0);
		assert.equal((daily(500_000) as Row).employee, 40_000);
		// Above 2,500,000 a day: the art.17 rates on 50% of each day's gross (PMK 168/2023 arts.12(2)(b), 16(2)(b)):
		// 5% of 1,300,000 = 65,000 a day, i.e. 2.5% of the month's 8,000,000.
		assert.equal((daily(2_600_000) as Row).employee, 200_000);
		// The month's gross takes the employer premiums the BPJS schemes charged before PPh 21 on the slip.
		const premiums = assess(
			pph21,
			{ ordinary: 10_000_000, additional: 0 },
			{
				charged: {
					month: {
						JKK: { employer: 54_000 },
						JKM: { employer: 30_000 },
						KESEHATAN: { employer: 400_000 }
					}
				}
			}
		) as Row;
		assert.equal(premiums.employee, 157_260);
	});

	it('PPh 26 is 20% for a non-resident and PP 68/2009 art.4 bands severance', () => {
		for (const version of versions) {
			const pph26 = (residency: string) =>
				assess(
					scheme(version, 'PPH26'),
					{ ordinary: 10_000_000 },
					{ subject: subject({ terms: { residency_status: residency } }) }
				);
			assert.equal((pph26('NON_RESIDENT') as Row).employee, 2_000_000);
			assert.equal(pph26('CITIZEN'), null);
			assert.equal(pph26('RESIDENT_FOREIGNER'), null);
			const severance = (amount: number) =>
				(assess(scheme(version, 'PPH21_FINAL_SEVERANCE'), { ordinary: amount }) as Row).employee;
			assert.equal(severance(50_000_000), 0);
			assert.equal(severance(80_000_000), 1_500_000);
			assert.equal(severance(300_000_000), 32_500_000);
			assert.equal(severance(600_000_000), 87_500_000);
		}
	});

	it('severance, THR and leave pay price on the engine context', () => {
		for (const version of versions) {
			const price = (code: string, over: Parameters<typeof subject>[0], facts: Row = {}) => {
				const row = catalog(version, 'adhoc_catalog', code);
				const context = { ...payslipOf(over, version), entry: entry(facts) };
				if (evaluateConfigured(row.eligibility || 'true', context) !== true) return null;
				return Number(evaluateConfigured(row.bands[0].amount, context));
			};
			const wage = { terms: { monthly_wage: 10_000_000 } };
			const leaver = (facts: Row, months = 40, terms: Row = {}) => ({
				terms: { monthly_wage: 10_000_000, ...terms },
				employment: {
					service_months: months,
					exit_date: '2026-03-31',
					exit_facts: { ...EXIT_FACTS, ...facts }
				}
			});
			// PP 35/2021 art.40(2) 40 months → 4 months' wage, art.43(1) efficiency due to loss × 0.5; art.40(3) UPMK 2 months.
			assert.equal(price('PESANGON', leaver({})), 20_000_000);
			assert.equal(price('UPMK', leaver({})), 20_000_000);
			assert.equal(price('UPMK', leaver({}, 30)), null);
			// Art.157(3)–(4): the output average is floored at the workplace minimum wage (rules.minimum_wage.by_region).
			const floor = payrollRules(version).minimum_wage.by_region['Provinsi DKI Jakarta'];
			assert.equal(
				price(
					'PESANGON',
					leaver({ separation_wage_basis: 'OUTPUT', output_average_12m: 3_000_000 })
				),
				Math.round(floor * 4 * 0.5)
			);
			// Uang pisah on a voluntary resignation; no pesangon.
			assert.equal(
				price('UANG_PISAH', leaver({ termination_cause: 'VOLUNTARY_RESIGNATION' })),
				7_000_000
			);
			assert.equal(price('PESANGON', leaver({ termination_cause: 'VOLUNTARY_RESIGNATION' })), null);
			// PP 35/2021 art.16: PKWT compensation = monthly wage × months / 12; never for a foreigner.
			assert.equal(
				price('PKWT_COMPENSATION', leaver({}, 18, { employment_type: 'CONTRACT' })),
				15_000_000
			);
			assert.equal(
				price(
					'PKWT_COMPENSATION',
					leaver({}, 18, { employment_type: 'CONTRACT', residency_status: 'RESIDENT_FOREIGNER' })
				),
				null
			);
			assert.equal(price('PESANGON', leaver({}, 18, { employment_type: 'CONTRACT' })), null);
			// PP 35/2021 art.58: the employer pension benefit offsets the separation pay, up to it.
			assert.equal(price('PENSION_OFFSET', leaver({})), 5_000_000);
			// Permenaker 6/2016 art.3: THR is one month's wage from 12 months, pro rata from one; a PKWTT leaver within
			// 30 days before the holiday keeps it (art.7(1)), a PKWT leaver does not.
			assert.equal(
				price('THR_HOLIDAY', { ...wage, employment: { service_months: 40 } }),
				10_000_000
			);
			assert.equal(price('THR_HOLIDAY', { ...wage, employment: { service_months: 6 } }), 5_000_000);
			assert.equal(price('THR_HOLIDAY', { ...wage, employment: { service_months: 0 } }), null);
			const thrLeaver = (employment_type: string) =>
				price(
					'THR',
					{
						terms: { monthly_wage: 10_000_000, employment_type },
						employment: { service_months: 40, exit_date: '2026-03-01' }
					},
					{ holiday_date: '2026-03-20' }
				);
			assert.equal(thrLeaver('PERMANENT'), 10_000_000);
			assert.equal(thrLeaver('CONTRACT'), null);
			// Work lines: overtime and holiday work on the monthly wage (PP 35/2021 art.32(2)); none for the art.27(2) group.
			const payslip = payslipOf(
				{ terms: { base_salary: 8_000_000, monthly_wage: 9_000_000 } },
				version
			);
			const work = (code: string, context: Row = payslip) => {
				const row = catalog(version, 'work_catalog', code);
				if (evaluateConfigured(row.eligibility, context) !== true) return 0;
				return (
					Number(evaluateConfigured(row.quantity, context)) *
					Number(evaluateConfigured(row.rate, context))
				);
			};
			// Two ordinary-day hours: the first at 1.5×, the second at 2× (art.31(1)).
			assert.equal(work('OVERTIME'), ((1.5 + 2) * 9_000_000) / 173);
			assert.equal(
				work('OVERTIME', payslipOf({ terms: { work_classification: 'MANAGERIAL' } }, version)),
				0
			);
			// PP 35/2021 art.31(2)–(3): rest-day and holiday hours are all overtime, on the week's ladder; the result is
			// in hour-units of 1/173 of a 17,300,000 monthly wage (100,000 an hour).
			const ladder = (days: Row[], week: number) =>
				work('OVERTIME', {
					...payslipOf(
						{ terms: { monthly_wage: 17_300_000, facts: { working_days_per_week: week } } },
						version
					),
					work: { overtime_hours: 1, incentive_hours: 0, dates: [], holidays: [], days }
				}) / 100_000;
			const holiday = (hours: number, over: Row = {}) =>
				day({ holiday_kind: 'PUBLIC_HOLIDAY', overtime_hours: hours, ...over });
			// 5-day week: hours 1–8 at 2×, hour 9 at 3×, hours 10–12 at 4×.
			assert.equal(ladder([holiday(9)], 5), 16 + 3);
			assert.equal(ladder([holiday(12)], 5), 16 + 3 + 12);
			// 6-day week: hours 1–7 at 2×, hour 8 at 3×, hours 9–11 at 4×.
			assert.equal(ladder([holiday(9)], 6), 14 + 3 + 4);
			// A holiday on the shortest day (5 scheduled hours): 1–5 at 2×, 6 at 3×, 7–9 at 4×.
			assert.equal(ladder([holiday(7, { scheduled_hours: 5 })], 6), 10 + 3 + 4);
			// A rest day is priced like a holiday; an ordinary day is 1.5× then 2×.
			assert.equal(ladder([day({ day_type: 'REST', overtime_hours: 8 })], 5), 16);
			assert.equal(ladder([day({ overtime_hours: 3 })], 5), 1.5 + 4);
			// art.33(1): a daily-paid worker's month is the day × 25 (6-day week) or × 21 (5-day week).
			const daily = (week: number) =>
				work('OVERTIME', {
					...payslipOf(
						{
							terms: {
								employment_type: 'DAILY',
								facts: { daily_wage: 173_000, working_days_per_week: week }
							}
						},
						version
					),
					work: {
						overtime_hours: 1,
						incentive_hours: 0,
						dates: [],
						holidays: [],
						days: [day({ overtime_hours: 1 })]
					}
				});
			assert.equal(daily(6), 1.5 * 25_000);
			assert.equal(daily(5), 1.5 * 21_000);
			// Unused leave cashed out at basic ÷ the entity's divisor (owner ruling): 2 days × 8,000,000 / 25.
			assert.equal(work('ENCASHMENT'), 640_000);
			assert.equal(work('EXIT_ENCASHMENT'), 0);
			// The exit encashment (written on the last day) is uang penggantian hak — the PP 68/2009 final base.
			const exitSlip = {
				...payslip,
				employment: { ...payslip.employment, exit_date: '2026-03-31' },
				leave: {
					rows: [
						leaveRow({ activity: 'ENCASHMENT', days: 16, can_encash: true, from: '2026-03-31' })
					]
				}
			};
			assert.equal(work('EXIT_ENCASHMENT', exitSlip), 16 * 320_000);
			assert.equal(work('ENCASHMENT', exitSlip), 0);
			// UU 13/2003 art.93(3): sick pay 100 / 75 / 50 / 25% by four-month band; the unpaid share is deducted.
			const sick = catalog(version, 'leave_catalog', 'MEDICAL_LEAVE').pay_fraction;
			assert.deepEqual(
				[1, 4, 5, 9, 13].map((month_index) =>
					evaluateConfigured(sick, { leave: leaveRow({ month_index }) })
				),
				[1, 1, 0.75, 0.5, 0.25]
			);
			const maternity = catalog(version, 'leave_catalog', 'MATERNITY_LEAVE').pay_fraction;
			assert.equal(evaluateConfigured(maternity, { leave: leaveRow({ month_index: 5 }) }), 0.75);
			const partial = {
				...payslip,
				leave: { rows: [leaveRow({ code: 'MEDICAL_LEAVE', days: 10, pay_fraction: 0.75 })] }
			};
			assert.equal(
				Math.round(work('PARTIAL_PAY_LEAVE', partial)),
				Math.round((2.5 * 8_000_000) / 31)
			);
			// Event-based leave reads the entry's facts and the employee.
			const leave = (code: string, employee: Row, facts: Row) =>
				evaluateConfigured(catalog(version, 'leave_catalog', code).eligibility, {
					...subject({ employee }),
					rules: {},
					entry: entry(facts)
				});
			assert.equal(leave('MATERNITY_LEAVE', { gender: 'FEMALE' }, { event_kind: 'BIRTH' }), true);
			assert.equal(leave('MATERNITY_LEAVE', { gender: 'MALE' }, { event_kind: 'BIRTH' }), false);
			assert.equal(leave('PATERNITY_LEAVE', { gender: 'MALE' }, { event_kind: 'BIRTH' }), true);
			assert.equal(
				leave('BEREAVEMENT_LEAVE', {}, { event_kind: 'DEATH', relationship: 'PARENT' }),
				true
			);
			assert.equal(leave('MARRIAGE_LEAVE', {}, {}), false);
			assert.equal(leave('MENSTRUAL_LEAVE', { gender: 'FEMALE' }, {}), true);
		}
	});

	it('pay lines feed the schemes their wage concept names, once', () => {
		for (const version of versions) {
			const counts = (table: string, code: string) =>
				catalog(version, table, code).counts_toward as string[];
			assert.equal(counts('work_catalog', 'BASIC').includes('PPH21_FINAL_SEVERANCE'), false);
			// Upah pokok + tunjangan tetap is the BPJS wage; overtime and holiday work are not.
			assert.ok(counts('work_catalog', 'EXIT_ENCASHMENT').includes('PPH21_FINAL_SEVERANCE'));
			assert.equal(counts('work_catalog', 'ENCASHMENT').includes('PPH21_FINAL_SEVERANCE'), false);
			for (const code of ['OVERTIME', 'ENCASHMENT', 'EXIT_ENCASHMENT'])
				for (const bpjs of ['JHT', 'JP', 'JKK', 'JKM', 'KESEHATAN'])
					assert.equal(counts('work_catalog', code).includes(bpjs), false, `${code} ${bpjs}`);
			// PPh 21 is fed only its cash parts; premiums and contributions come from the schemes' own charges.
			for (const table of ['work_catalog', 'allowance_catalog', 'adhoc_catalog'])
				for (const row of read(version, table))
					for (const target of row.counts_toward as string[])
						if (target.startsWith('PPH21.'))
							assert.ok(
								['PPH21.ORDINARY', 'PPH21.ADDITIONAL'].includes(target),
								`${row.code} ${target}`
							);
			for (const code of ['PESANGON', 'UPMK', 'UANG_PISAH', 'PKWT_COMPENSATION']) {
				assert.ok(counts('adhoc_catalog', code).includes('PPH21_FINAL_SEVERANCE'), code);
				assert.equal(
					counts('adhoc_catalog', code).some((target) => target.startsWith('PPH21.')),
					false,
					code
				);
			}
			for (const code of ['THR', 'THR_HOLIDAY'])
				assert.equal(catalog(version, 'adhoc_catalog', code).destination, 'PAY');
		}
	});

	it('an ID year settles through the engine: TER January to November, the art.17 reckoning in December', async () => {
		const { COMPANY, tables, run, lines } = idWorld();

		const january = await run('2026-01', 'REGULAR');
		// Budi, K/1 (category B), 10,000,000, risk group II: PPh 21 gross adds JKK 54,000 + JKM 30,000 + Kesehatan
		// 400,000 = 10,484,000, TER B 1.5% = 157,260.
		assert.deepEqual(lines(january, 'p1'), {
			JHT: [200_000, 370_000],
			JP: [100_000, 200_000],
			JKK: [0, 54_000],
			JKM: [0, 30_000],
			KESEHATAN: [100_000, 400_000],
			PPH21: [157_260, 0]
		});
		assert.equal(
			january.payslips.find((slip) => slip.employment_id === 'k-p1')!.net,
			10_000_000 - 200_000 - 100_000 - 100_000 - 157_260
		);
		// The PPh 21 line's base is the cash gross; premiums and contributions are read from the schemes' charges.
		const budi = january.payslips.find((slip) => slip.employment_id === 'k-p1')!;
		assert.equal(
			budi.statutory.find((line) => line.scheme_code === 'PPH21')!.base_amount,
			10_000_000
		);
		// Sari, married woman without the kelurahan statement: TK/0 (A); 20,648,000 at 9% = 1,858,320.
		assert.equal(lines(january, 'p2').PPH21![0], 1_858_320);
		// Ken, non-resident: PPh 26 20% of the gross, no PPh 21 and no JP.
		assert.deepEqual(lines(january, 'p3').PPH26, [6_000_000, 0]);
		assert.equal('PPH21' in lines(january, 'p3') || 'JP' in lines(january, 'p3'), false);

		await run('2026-02', 'REGULAR');
		const march = await run('2026-03', 'REGULAR');
		assert.equal(lines(march, 'p1').PPH21![0], 157_260);
		// THR in March, paid off-cycle: March gross 20,484,000 is TER B 8% = 1,638,720, less the 157,260 withheld.
		const thr = catalog('version_3', 'adhoc_catalog', 'THR_HOLIDAY');
		tables.get('adhoc_catalog_entry')!.push({
			id: 't1',
			catalog_id: thr.id,
			employment_id: 'k-p1',
			company_id: COMPANY,
			approval_id: null,
			payslip_id: null,
			occurred_on: '2026-03-13',
			amount: 1,
			activity: 'PAYMENT'
		});
		const offCycle = await run('2026-03', 'OFF_CYCLE', ['t1']);
		assert.deepEqual(lines(offCycle, 'p1'), { PPH21: [1_481_460, 0] });

		let june;
		for (const month of [
			'2026-04',
			'2026-05',
			'2026-06',
			'2026-07',
			'2026-08',
			'2026-09',
			'2026-10',
			'2026-11'
		]) {
			const plan = await run(month, 'REGULAR');
			if (month === '2026-06') june = plan;
		}
		// Dewi (TK/0, category A) leaves on 30 June, her last tax period. 10,484,000 a month is A's 2.5% bracket:
		// 5 × 262,100 withheld. The part year: 6 × 10,484,000 = 62,904,000, less biaya jabatan capped at 6 × 500,000
		// (PMK 168/2023 art.10(2) and its worked examples) and JHT/JP 1,800,000 = 58,104,000, less PTKP 54,000,000 =
		// PKP 4,104,000 at 5% = 205,200; the excess is returned.
		assert.equal(lines(june!, 'p4').PPH21![0], 205_200 - 5 * 262_100);
		const december = await run('2026-12', 'REGULAR');
		// Budi's year: gross 12 × 10,484,000 + THR 10,000,000 = 135,808,000; biaya jabatan capped at 6,000,000; JHT/JP
		// 3,600,000; PTKP K/1 63,000,000; PKP 63,208,000 → 3,000,000 + 15% × 3,208,000 = 3,481,200; withheld January
		// to November 10 × 157,260 + 1,638,720 = 3,211,320; December withholds the difference.
		assert.equal(lines(december, 'p1').PPH21![0], 269_880);
		assert.equal(
			'k-p4' in Object.fromEntries(december.payslips.map((slip) => [slip.employment_id, 1])),
			false
		);
		// An off-cycle THR settles the same January totals whether it is paid before or after the regular run.
		const snapshot = structuredClone([...tables]);
		const restore = () => {
			tables.clear();
			for (const [name, held] of structuredClone(snapshot)) tables.set(name, held);
		};
		const january2027 = async (order: 'bonus-first' | 'together' | 'bonus-after') => {
			restore();
			const pin = (plan: Awaited<ReturnType<typeof run>>) => {
				for (const slip of plan.payslips)
					for (const held of slip.pins)
						tables.get(held.collection)!.find((row) => row.id === held.id)!.payslip_id = 'paid';
				return plan;
			};
			const before = order === 'bonus-after' ? [pin(await run('2027-01', 'REGULAR'))] : [];
			tables.get('adhoc_catalog_entry')!.push({
				id: 't27',
				catalog_id: thr.id,
				employment_id: 'k-p1',
				company_id: COMPANY,
				approval_id: null,
				payslip_id: null,
				occurred_on: '2027-01-08',
				amount: 1,
				activity: 'PAYMENT'
			});
			const plans =
				order === 'bonus-after'
					? [...before, pin(await run('2027-01', 'OFF_CYCLE', ['t27']))]
					: order === 'bonus-first'
						? [
								pin(await run('2027-01', 'OFF_CYCLE', ['t27'])),
								pin(await run('2027-01', 'REGULAR'))
							]
						: [pin(await run('2027-01', 'REGULAR'))];
			const total = (scheme: string) =>
				plans
					.flatMap((plan) => plan.payslips)
					.filter((slip) => slip.employment_id === 'k-p1')
					.flatMap((slip) => slip.statutory)
					.filter((line) => line.scheme_code === scheme)
					.reduce(
						(sum, line) => [sum[0]! + line.employee_amount, sum[1]! + line.employer_amount],
						[0, 0]
					);
			return ['PPH21', 'JHT', 'JP', 'KESEHATAN'].map(total);
		};
		const bonusFirst = await january2027('bonus-first');
		assert.ok(bonusFirst[0]![0]! > 157_260, 'the THR is taxed in January');
		assert.deepEqual(await january2027('together'), bonusFirst);
		assert.deepEqual(await january2027('bonus-after'), bonusFirst);
	});
	const BANK = resolve(process.cwd(), '../../seed_bank/norbital_hr/records/kdit');
	const bank = (name: string): Row[] =>
		JSON.parse(readFileSync(resolve(BANK, `${name}.json`), 'utf8'));

	it(
		'the KDIT sample records resolve every reference onto the ID lineage',
		{ skip: !existsSync(BANK) },
		() => {
			const settings = versions.map(settingsOf);
			const versionOn = (day: string) =>
				settings.find(
					(row) =>
						row.effective_range.from <= day &&
						(row.effective_range.to == null || day <= row.effective_range.to)
				)!;
			const ids = (rows: Row[]) => new Set(rows.map((row) => row.id));
			const [entity] = bank('entity');
			assert.equal(entity.settings_code, 'ID');
			for (const version of versions)
				assert.ok(entity.region in payrollRules(version).minimum_wage.by_region, version);
			assert.ok(['I', 'II', 'III', 'IV', 'V'].includes(entity.risk_class));
			const entityKeys = new Set(Object.keys(settings[0]!.entity_input_schema.properties));
			for (const key of Object.keys(entity.facts)) assert.ok(entityKeys.has(key), key);
			const shifts = ids(bank('shift_definition'));
			const patterns = ids(bank('shift_pattern'));
			for (const pattern of bank('shift_pattern'))
				for (const cycle of pattern.pattern.days) assert.ok(shifts.has(cycle.roster_code_id));
			const profiles = bank('employment_profile');
			const statutory = new Map(
				versions.flatMap((version) =>
					read(version, 'statutory_contribution_catalog').map((row) => [row.id, row.code])
				)
			);
			const schema = settings[0]!.employee_input_schema.properties;
			const elections = new Set(
				Object.keys(
					schema.employment_statutory_facts.items.properties.status.properties.elections.properties
				)
			);
			const statusKeys = new Set(
				Object.keys(schema.employment_statutory_facts.items.properties.status.properties)
			);
			for (const profile of profiles) {
				assert.match(profile.nationality, /^[A-Z]{2}$/);
				assert.ok(profile.phone == null || /^\+\d{8,15}$/.test(profile.phone), profile.name);
				for (const fact of profile.facts.employment_statutory_facts) {
					assert.ok(statutory.has(fact.statutory_contribution_id), fact.id);
					for (const key of Object.keys(fact.status)) assert.ok(statusKeys.has(key), key);
					for (const key of Object.keys(fact.status.elections ?? {}))
						assert.ok(elections.has(key), key);
				}
			}
			const termKeys = new Set(Object.keys(schema.contract_terms.items.properties));
			const termFacts = new Set(
				Object.keys(schema.contract_terms.items.properties.facts.properties)
			);
			const exitKeys = new Set(Object.keys(schema.exit_facts.properties));
			const contracts = bank('employment_contract');
			const people = ids(profiles);
			const allowances = new Set(read('version_3', 'allowance_catalog').map((row) => row.code));
			for (const contract of contracts) {
				assert.ok(people.has(contract.employee_id), contract.employee_number);
				assert.equal(contract.company_id, entity.id);
				for (const key of Object.keys(contract.exit_facts ?? {})) assert.ok(exitKeys.has(key), key);
				for (const term of contract.facts.contract_terms) {
					for (const key of Object.keys(term)) assert.ok(termKeys.has(key), key);
					for (const key of Object.keys(term.facts)) assert.ok(termFacts.has(key), key);
					assert.ok(patterns.has(term.shift_pattern_id), term.id);
					assert.ok(
						schema.contract_terms.items.properties.residency_status.enum.includes(
							term.residency_status
						)
					);
					for (const line of term.allowances) assert.ok(allowances.has(line.code), line.code);
				}
			}
			const employments = ids(contracts);
			for (const name of ['roster', 'roster_entry', 'leave_catalog_entry', 'adhoc_catalog_entry'])
				for (const row of bank(name))
					assert.ok(employments.has(row.employment_id), `${name} ${row.id}`);
			for (const row of bank('roster_entry'))
				assert.ok(shifts.has(row.shift_definition_id), row.id);
			for (const [name, table] of [
				['leave_catalog_entry', 'leave_catalog'],
				['adhoc_catalog_entry', 'adhoc_catalog']
			] as const)
				for (const row of bank(name)) {
					const version = versionOn(row.occurred_on);
					assert.ok(
						read(versions[settings.indexOf(version)]!, table).some(
							(held) => held.id === row.catalog_id
						),
						`${name} ${row.id}`
					);
				}
			for (const holiday of bank('holiday')) assert.equal(holiday.company_id, entity.id);
		}
	);

	it(
		'the KDIT sample pays January and February 2026 through the engine',
		{ skip: !existsSync(BANK) },
		async () => {
			const tables = new Map<string, Row[]>();
			for (const version of versions)
				for (const name of ['jurisdiction_settings', ...CATALOGS])
					tables.set(name, [
						...(tables.get(name) ?? []),
						...read(version, name).map((row) => ({ approval_id: null, ...row }))
					]);
			for (const file of readdirSync(BANK))
				tables.set(
					file.replace('.json', ''),
					bank(file.replace('.json', '')).map((row) => ({
						approval_id: null,
						payslip_id: null,
						...row
					}))
				);
			for (const name of ['claim_catalog_entry', 'loan_catalog_entry', 'payslip', 'payroll_run'])
				tables.set(name, tables.get(name) ?? []);
			const match = (value: unknown, spec: unknown): boolean => {
				if (spec == null || typeof spec !== 'object') return value === spec;
				return Object.entries(spec as Row).every(([op, operand]) =>
					op === 'eq'
						? value === operand
						: op === 'in'
							? (operand as unknown[]).includes(value)
							: op === 'isNull'
								? operand === (value == null)
								: op === 'gte'
									? value != null && (value as string) >= (operand as string)
									: (value as string) <= (operand as string)
				);
			};
			const reads = {
				read: (collection: unknown, query: unknown) => {
					const { where = {}, select = {} } = query as { where?: Row; select?: Row };
					return Effect.succeed({
						rows: (tables.get(String(collection)) ?? [])
							.filter((row) => Object.entries(where).every(([key, spec]) => match(row[key], spec)))
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
			const company = bank('entity')[0]!.id;
			const number = new Map(
				bank('employment_contract').map((row) => [row.id, row.employee_number])
			);
			const slips: Record<string, Record<string, Row>> = {};
			for (const period of ['2026-01', '2026-02']) {
				const plan = await Effect.runPromise(
					buildPayrollRun({ company_id: company, period, kind: 'REGULAR' }).pipe(
						Effect.provideService(Reads, reads)
					)
				);
				slips[period] = Object.fromEntries(
					plan.payslips.map((slip) => [number.get(slip.employment_id), slip])
				);
				plan.payslips.forEach((slip, index) =>
					tables.get('payslip')!.push({ ...slip, id: `${period}-${index}`, payroll_run_id: period })
				);
				tables.get('payroll_run')!.push({ ...plan.run, id: period });
			}
			const line = (period: string, who: string, code: string) =>
				(slips[period]![who]!.statutory as Row[]).find((held) => held.scheme_code === code);
			// 14 employed in January (KDIT0016 starts 1 Feb), 14 in February (KDIT0001 left on 31 Jan).
			assert.equal(Object.keys(slips['2026-01']!).length, 14);
			assert.equal(Object.keys(slips['2026-02']!).length, 14);
			// KDIT0003's KESEHATAN election of one extra family member: 2% of 7,254,993, as the listing charges.
			assert.equal(line('2026-02', 'KDIT0003', 'KESEHATAN')!.employee_amount, 145_100);
			// JKK risk group III at 0.89%, as the listing's JKK column; no JP for the Japanese employee.
			assert.equal(line('2026-02', 'KDIT0011', 'JKK')!.employer_amount, 65_670);
			const jp = line('2026-02', 'KDIT0014', 'JP');
			assert.equal((jp?.employee_amount ?? 0) + (jp?.employer_amount ?? 0), 0);
			// KDIT0001's exit month is his last tax period: the year's tax on one month is nil, as the listing withholds.
			assert.equal(line('2026-01', 'KDIT0001', 'PPH21')!.employee_amount, 0);
		}
	);

	it('validations: minimum wage, basic share, overtime limits and the deduction ceiling', () => {
		for (const version of versions) {
			const checks = Object.fromEntries(
				read(version, 'rule_set')
					.filter((row) => row.family === 'VALIDATIONS')
					.map((row) => [row.code, row.rules])
			);
			assert.deepEqual(Object.keys(checks).toSorted(), [
				'BASIC_WAGE_SHARE',
				'MINIMUM_WAGE_FLOOR',
				'OVERTIME_DAILY_LIMIT',
				'OVERTIME_WEEKLY_LIMIT',
				'SECTOR_MINIMUM_WAGE',
				'WAGE_DEDUCTION_CEILING'
			]);
			for (const check of Object.values(checks)) assert.ok(check.authority.length > 0);
			const floor = payrollRules(version).minimum_wage.by_region['Provinsi DKI Jakarta'];
			// A contract write: the term as the subject context builds it, plus `term` and `rules`.
			// A worker in the first year of service: the minimum wage binds below 12 months (UU 13/2003 art.88E(1)).
			const contract = (term: Row, company: Row = {}, service_months = 6) => {
				const base = subject({ terms: term, company, employment: { service_months } });
				return { ...base, rules: payrollRules(version), term: base.terms };
			};
			const trips = (code: string, context: Row) =>
				evaluateConfigured(checks[code].when, context) === true;
			// UU 13/2003 art.88E(2): the monthly wage may not be below the workplace UMK/UMP.
			assert.equal(
				trips('MINIMUM_WAGE_FLOOR', contract({ base_salary: floor - 1, monthly_wage: floor - 1 })),
				true
			);
			assert.equal(
				trips('MINIMUM_WAGE_FLOOR', contract({ base_salary: floor, monthly_wage: floor })),
				false
			);
			// Micro and small enterprises (PP 36/2021 art.36) and part-time pay are outside it.
			assert.equal(
				trips(
					'MINIMUM_WAGE_FLOOR',
					contract(
						{ base_salary: 1_000_000, monthly_wage: 1_000_000 },
						{ facts: { enterprise_size_class: 'MICRO_OR_SMALL' } }
					)
				),
				false
			);
			assert.equal(
				trips(
					'MINIMUM_WAGE_FLOOR',
					contract({
						base_salary: 1_000_000,
						monthly_wage: 1_000_000,
						employment_type: 'PART_TIME'
					})
				),
				false
			);
			assert.equal(
				trips(
					'MINIMUM_WAGE_FLOOR',
					contract({ base_salary: floor - 1, monthly_wage: floor - 1 }, {}, 12)
				),
				false
			);
			// Kep. Gubernur DKI 33/2026: the sector wage for the worksite KBLI, under one year of service, with its conditions.
			if (version !== 'version_1') {
				const sector = (term: Row, company: Row = {}, months = 6) =>
					trips(
						'SECTOR_MINIMUM_WAGE',
						contract({ base_salary: 5_800_000, monthly_wage: 5_800_000, ...term }, company, months)
					);
				assert.equal(sector({ facts: { worksite_kbli: '20118' } }), true); // 5,844,336
				assert.equal(sector({ facts: { worksite_kbli: '10437' } }), false); // 5,741,201
				assert.equal(sector({ facts: { worksite_kbli: '20118' } }, {}, 12), false);
				assert.equal(sector({ facts: { worksite_kbli: '14111' } }), false); // exporters only
				assert.equal(
					sector({ facts: { worksite_kbli: '14111' } }, { facts: { umsp_export_oriented: true } }),
					true
				);
				assert.equal(
					sector({ facts: { worksite_kbli: '20118' } }, { region: 'Provinsi Banten' }),
					false
				);
				assert.equal(
					sector(
						{ facts: { worksite_kbli: '86103', umsp_job_category: 'NURSING_MIDWIFERY' } },
						{ facts: { umsp_class_a_private_hospital: true } }
					),
					false
				); // 5,743,449 < 5,800,000
				assert.equal(
					payrollRules(version).minimum_wage.by_sector['Provinsi DKI Jakarta'].length,
					61
				);
			}
			// PP 36/2021 art.7(2): basic at least 75% of basic plus fixed allowances.
			assert.equal(
				trips('BASIC_WAGE_SHARE', contract({ base_salary: 7_000_000, monthly_wage: 10_000_000 })),
				true
			);
			assert.equal(
				trips('BASIC_WAGE_SHARE', contract({ base_salary: 7_500_000, monthly_wage: 10_000_000 })),
				false
			);
			// PP 35/2021 art.26: 4 hours a day, 18 in seven consecutive days; rest-day and holiday hours are outside.
			const slip = (days: Row[], lines: Row = {}, gross = 10_000_000) => ({
				...payslipOf({}, version),
				work: { overtime_hours: 0, incentive_hours: 0, dates: [], holidays: [], days },
				payslip: { gross, net: gross, total_deductions: 0, lines },
				statutory: {}
			});
			assert.equal(trips('OVERTIME_DAILY_LIMIT', slip([day({ overtime_hours: 5 })])), true);
			assert.equal(trips('OVERTIME_DAILY_LIMIT', slip([day({ overtime_hours: 4 })])), false);
			assert.equal(
				trips(
					'OVERTIME_DAILY_LIMIT',
					slip([day({ overtime_hours: 8, holiday_kind: 'PUBLIC_HOLIDAY' })])
				),
				false
			);
			const week = (hours: number, gap = 1) =>
				[0, 1, 2, 3, 4].map((offset) =>
					day({
						date: `2026-03-${String(2 + offset * gap).padStart(2, '0')}`,
						overtime_hours: hours
					})
				);
			assert.equal(trips('OVERTIME_WEEKLY_LIMIT', slip(week(4))), true);
			assert.equal(trips('OVERTIME_WEEKLY_LIMIT', slip(week(3.6))), false);
			assert.equal(trips('OVERTIME_WEEKLY_LIMIT', slip(week(4, 3))), false);
			// PP 36/2021 art.65: deductions at most 50% of the wage paid; statutory contributions are outside.
			assert.equal(trips('WAGE_DEDUCTION_CEILING', slip([], { STAFF_LOAN: -5_000_001 })), true);
			assert.equal(trips('WAGE_DEDUCTION_CEILING', slip([], { STAFF_LOAN: -5_000_000 })), false);
			assert.equal(
				trips(
					'WAGE_DEDUCTION_CEILING',
					slip([], { STAFF_LOAN: -3_000_000, CLAWBACK_OVERTIME: -2_000_000 }, 8_000_000)
				),
				false
			);
		}
	});

	it('a run warns on an overtime breach and holds a slip over the deduction ceiling', async () => {
		const { COMPANY, tables, run } = idWorld();
		tables.get('roster_entry')!.push({
			id: 'ot1',
			employment_id: 'k-p1',
			work_date: '2026-01-14',
			approved_overtime_hours: 5,
			approval_id: null,
			payslip_id: null,
			facts: {}
		});
		const loan = catalog('version_2', 'loan_catalog', 'STAFF_LOAN');
		tables.get('loan_catalog_entry')!.push({
			id: 'l1',
			catalog_id: loan.id,
			employment_id: 'k-p2',
			company_id: COMPANY,
			approval_id: null,
			payslip_id: null,
			occurred_on: '2026-01-15',
			amount: 11_000_000
		});
		const plan = await run('2026-01', 'REGULAR');
		assert.ok(plan.warnings.some((line) => line.startsWith('Budi: Overtime above 4 hours')));
		const sari = plan.payslips.find((slip) => slip.employment_id === 'k-p2')!;
		assert.match(String(sari.hold), /exceed 50% of this wage payment/);
		assert.equal(plan.payslips.find((slip) => slip.employment_id === 'k-p1')!.hold, null);
	});

	it('the new duties: annual WLKP, accident report, company regulations, payslip issue', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const rows = read(version, 'rule_set');
			const raise = (collection: string, event: string, row: Row, extra: Row = {}) =>
				Object.fromEntries(
					raiseDuties({
						behaviours: settings.behaviours,
						settings_id: settings.id,
						rows,
						collection,
						event,
						row,
						...extra
					}).map((write) => [write.duty_code, write.due_on])
				);
			const run = (period: string, facts: Row, headcount = 12) =>
				raise(
					'payroll_run',
					'created',
					{ id: `r-${period}`, approval_id: null, period, company_id: 'c1' },
					{ reads: { company: [{ region: 'Provinsi DKI Jakarta', facts }] }, headcount }
				);
			// UU 7/1981 art.8: the WLKP report on each anniversary of the first one.
			const wlkp = { wlkp_first_reported_on: '2023-12-04' };
			assert.equal(run('2026-12', wlkp).WLKP_ANNUAL_REPORT, '2026-12-04');
			assert.equal(run('2026-11', wlkp).WLKP_ANNUAL_REPORT, undefined);
			assert.equal(run('2023-12', wlkp).WLKP_ANNUAL_REPORT, undefined);
			// UU 13/2003 arts.108, 111(3): company regulations renewed when they lapse, for 10 or more workers.
			const lapse = { company_regulation_valid_until: '2026-12-15' };
			assert.equal(run('2026-12', lapse).COMPANY_REGULATION_RENEWAL, '2026-12-15');
			assert.equal(run('2026-12', lapse, 9).COMPANY_REGULATION_RENEWAL, undefined);
			// PP 44/2015 art.43: a work accident reported within 2 × 24 hours.
			const accident = (catalog_code: string) =>
				raise('leave_catalog_entry', 'created', {
					id: 'a1',
					approval_id: null,
					company_id: 'c1',
					employment_id: 'k1',
					occurred_on: '2026-03-10',
					from: '2026-03-10',
					catalog_code
				});
			assert.equal(accident('WORK_ACCIDENT_LEAVE').WORK_ACCIDENT_REPORT, '2026-03-12');
			assert.equal(accident('ANNUAL_LEAVE').WORK_ACCIDENT_REPORT, undefined);
			// PP 36/2021 art.53(2): the wage slip when the wage is paid.
			const paid = raise('payslip', 'updated', {
				id: 's1',
				approval_id: null,
				company_id: 'c1',
				employment_id: 'k1',
				paid_on: '2026-03-27'
			});
			assert.equal(paid.PAYSLIP_ISSUE, '2026-03-27');
			// PP 35/2021 art.28: overtime needs a written order and consent; an approved day without one raises it.
			const roster = (consent: string | null) =>
				raise('roster_entry', 'updated', {
					id: 'w1',
					approval_id: null,
					company_id: 'c1',
					employment_id: 'k1',
					work_date: '2026-03-11',
					approved_overtime_hours: 2,
					overtime_consented_at: consent
				});
			assert.equal(roster(null).OVERTIME_WRITTEN_ORDER, '2026-03-11');
			assert.equal(roster('2026-03-10T09:00:00.000Z').OVERTIME_WRITTEN_ORDER, undefined);
		}
	});

	it('family-event leave meters its UU 13/2003 art.93(4) days per event', () => {
		for (const version of versions) {
			const days = (code: string) => {
				const row = catalog(version, 'leave_catalog', code);
				assert.equal(row.entitlement.window, 'EVENT', code);
				return evaluateConfigured(row.entitlement.days, { service_months: 1, bands: [] });
			};
			assert.deepEqual(
				[
					'MARRIAGE_LEAVE',
					'CHILD_MARRIAGE_LEAVE',
					'CHILD_CIRCUMCISION_LEAVE',
					'CHILD_BAPTISM_LEAVE',
					'PATERNITY_LEAVE',
					'BEREAVEMENT_LEAVE',
					'BEREAVEMENT_HOUSEHOLD_LEAVE',
					'MENSTRUAL_LEAVE'
				].map(days),
				[3, 2, 2, 2, 2, 2, 1, 2]
			);
			assert.equal(catalog(version, 'leave_catalog', 'WORK_ACCIDENT_LEAVE').encash_on_exit, false);
		}
	});

	it('PPh 21 part-year reckoning reproduces the PMK 168/2023 worked examples (Tuan B and Tuan C)', () => {
		for (const version of versions) {
			const pph21 = scheme(version, 'PPH21');
			const december = (terms: Row, employee: Row, jht: number) =>
				(
					assess(
						pph21,
						{ ordinary: 15_500_000, additional: 0 },
						{
							subject: subject({
								terms: { monthly_wage: 0, ...terms },
								employee: { marital_status: 'SINGLE', dependents_count: 0, ...employee },
								employment: { start_date: '2026-09-01' }
							}),
							period: '2026-12',
							year: { ordinary: 46_500_000, additional: 0 },
							charged: {
								month: { JHT: { employee: jht } },
								year: { JHT: { employee: 3 * jht }, PPH21: { employee: 3_255_000 } }
							}
						}
					) as Row
				).employee;
			// Tuan B: resident all year, joins 1 September: biaya jabatan at most 4 × 500,000, no annualisation;
			// 62,000,000 − 2,000,000 − 400,000 − 54,000,000 = 5,600,000 at 5% = 280,000, less 3,255,000 withheld.
			assert.equal(december({}, {}, 100_000), 280_000 - 3_255_000);
			// Tuan C: becomes a resident on 1 September (art.15(3)): net 62,000,000 − 2,000,000 − zakat 3,100,000 =
			// 56,900,000 annualised × 12/4 = 170,700,000; PKP 116,700,000 → 11,505,000 × 4/12 = 3,835,000.
			assert.equal(
				december(
					{ facts: { tax_subject_from: '2026-09-01' } },
					{ facts: { zakat_monthly: 775_000 } },
					0
				),
				3_835_000 - 3_255_000
			);
		}
	});

	it('THR is raised 7 days before each named religious holiday', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const thr = (period: string, holidays: Row[]) =>
				Object.fromEntries(
					raiseDuties({
						behaviours: settings.behaviours,
						settings_id: settings.id,
						rows: read(version, 'rule_set'),
						collection: 'payroll_run',
						event: 'created',
						row: { id: `r-${period}`, approval_id: null, period, company_id: 'c1' },
						reads: { company: [{ region: 'Provinsi DKI Jakarta', facts: {} }], holidays }
					}).map((write) => [write.duty_code, write.due_on])
				).THR_PAYMENT;
			const kdit = [
				{ date: '2026-03-20', name: 'Eid al-Fitr 1447 Hijri', kind: 'PUBLIC_HOLIDAY' },
				{ date: '2026-03-21', name: 'Eid al-Fitr 1447 Hijri', kind: 'PUBLIC_HOLIDAY' },
				{ date: '2026-05-31', name: 'Vesak Day 2570 BE', kind: 'PUBLIC_HOLIDAY' },
				{
					date: '2026-08-17',
					name: 'Independence Day of the Republic of Indonesia',
					kind: 'PUBLIC_HOLIDAY'
				}
			];
			// Permenaker 6/2016 art.5(4): at the latest 7 days before the holiday.
			assert.equal(thr('2026-03', kdit), '2026-03-13');
			assert.equal(thr('2026-05', kdit), '2026-05-24');
			assert.equal(thr('2026-08', kdit), undefined);
			assert.equal(thr('2026-04', kdit), undefined);
		}
	});

	it('an off-cycle THR run before or after the regular run settles to the same month totals', async () => {
		const month = async (thrFirst: boolean) => {
			const { COMPANY, tables, run } = idWorld();
			await run('2026-01', 'REGULAR');
			await run('2026-02', 'REGULAR');
			const thr = catalog('version_3', 'adhoc_catalog', 'THR_HOLIDAY');
			// The THR is entered when it is paid: before the regular run, or after it.
			const enter = () =>
				tables.get('adhoc_catalog_entry')!.push({
					id: 't1',
					catalog_id: thr.id,
					employment_id: 'k-p1',
					company_id: COMPANY,
					approval_id: null,
					payslip_id: null,
					occurred_on: '2026-03-13',
					amount: 1,
					activity: 'AWARD'
				});
			const plans = [];
			if (thrFirst) {
				enter();
				plans.push(await run('2026-03', 'OFF_CYCLE', ['t1']), await run('2026-03', 'REGULAR'));
			} else {
				plans.push(await run('2026-03', 'REGULAR'));
				enter();
				plans.push(await run('2026-03', 'OFF_CYCLE', ['t1']));
			}
			const totals: Record<string, [number, number]> = {};
			for (const plan of plans)
				for (const slip of plan.payslips.filter((slip) => slip.employment_id === 'k-p1'))
					for (const line of slip.statutory) {
						const held = (totals[line.scheme_code] ??= [0, 0]);
						held[0] = Math.round((held[0] + line.employee_amount) * 100) / 100;
						held[1] = Math.round((held[1] + line.employer_amount) * 100) / 100;
					}
			const gross = plans
				.flatMap((plan) => plan.payslips.filter((slip) => slip.employment_id === 'k-p1'))
				.reduce((sum, slip) => sum + slip.gross, 0);
			return { totals, gross };
		};
		const after = await month(false);
		const before = await month(true);
		assert.deepEqual(before, after);
		// The month's PPh 21 is TER B 8% on 10,000,000 + THR 10,000,000 + premiums 484,000, whichever run goes first.
		assert.equal(after.totals.PPH21![0], 1_638_720);
		assert.equal(after.gross, 20_000_000);
		for (const code of ['JHT', 'JP', 'JKK', 'JKM', 'KESEHATAN'])
			assert.ok(after.totals[code]![0] + after.totals[code]![1] > 0, code);
	});
});
