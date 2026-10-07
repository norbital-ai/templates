/** MY public lineage: every sealed version's structure, CEL on the engine contexts, obligations and the statutory amounts. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import relationships from '../src/data/+relationship.js';
import adhocModel from '../src/data/model/jurisdiction/adhoc_catalog/+model.js';
import allowanceModel from '../src/data/model/jurisdiction/allowance_catalog/+model.js';
import claimModel from '../src/data/model/jurisdiction/claim_catalog/+model.js';
import settingsModel from '../src/data/model/jurisdiction/jurisdiction_settings/+model.js';
import leaveModel from '../src/data/model/jurisdiction/leave_catalog/+model.js';
import loanModel from '../src/data/model/jurisdiction/loan_catalog/+model.js';
import ruleSetModel from '../src/data/model/jurisdiction/rule_set/+model.js';
import statutoryModel from '../src/data/model/jurisdiction/statutory_contribution_catalog/+model.js';
import workModel from '../src/data/model/jurisdiction/work_catalog/+model.js';
import {
	behavioursOf,
	effectWrites,
	planBehaviours,
	resolveWhere
} from '../src/lib/payroll_engine/behaviours.js';
import { evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { entitlementDays } from '../src/lib/payroll_engine/leave.js';
import { Effect } from 'effect';
import { Reads } from '../src/lib/payroll_engine/foundation.js';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.js';
import { DUTY_KEYS, dutiesOf, raiseDuties, triggerOf } from './duties.ts';
import {
	classFromRow,
	leaveBalances,
	movementFromRow,
	serviceMonthsAt
} from '../src/lib/payroll_engine/leave.js';

type Row = { [field: string]: unknown };
type Rule = { when?: string; employee?: string; employer?: string };
type Configuration = {
	person?: { [fact: string]: string };
	assessable?: { [part: string]: string };
	rules: Rule[];
};
type Band = { when: string; amount: string; limit?: { amount: string } };

const MODELS = {
	jurisdiction_settings: settingsModel,
	rule_set: ruleSetModel,
	statutory_contribution_catalog: statutoryModel,
	leave_catalog: leaveModel,
	claim_catalog: claimModel,
	adhoc_catalog: adhocModel,
	loan_catalog: loanModel,
	allowance_catalog: allowanceModel,
	work_catalog: workModel
} as const;
type Table = keyof typeof MODELS;
const TABLES = Object.keys(MODELS) as Table[];
const CATALOGS = TABLES.filter(
	(table) => table !== 'jurisdiction_settings' && table !== 'rule_set'
);

const lineages = resolve(process.cwd(), 'seed/jurisdiction');
const root = resolve(lineages, 'MY');
const versionsOf = (directory: string) =>
	readdirSync(directory)
		.filter((entry) => entry.startsWith('version_'))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const versions = versionsOf(root);
const rows = (version: string, table: Table): Row[] =>
	JSON.parse(readFileSync(resolve(root, version, `${table}.json`), 'utf8')) as Row[];
const settingsOf = (version: string): Row => {
	const [row, ...rest] = rows(version, 'jurisdiction_settings');
	assert.ok(row && rest.length === 0, `${version} holds exactly one settings row`);
	return row;
};
const at = (day: string): string => {
	const version = versions.find((name) => {
		const range = settingsOf(name).effective_range as { from: string; to: string | null };
		return range.from <= day && (range.to == null || day <= range.to);
	});
	assert.ok(version, `a MY version governs ${day}`);
	return version;
};
const byCode = (version: string, table: Table, code: string): Row => {
	const row = rows(version, table).find((item) => item.code === code);
	assert.ok(row, `${version} ${table} ${code}`);
	return row;
};
const nextDay = (day: string): string => {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
};
const round2 = (value: number): number => Math.round(value * 100) / 100;
const monthEnd = (day: string): string => String(evaluateConfigured(`month_end("${day}")`, {}));

/** The subject `subjectContext` builds: `employee`, `company`, `terms`, `employment` and `person`. */
type Subject = {
	age?: number | null;
	residency_status?: string;
	employee?: Row;
	facts?: Row;
	company?: Row;
	terms?: Row;
	service_months?: number;
	start_date?: string;
	day?: string;
	/** This scheme's declared standing (`scheme.standing` / `scheme.elections`). */
	standing?: string;
	elections?: Row;
	/** Earlier months of the year: the scheme's wage parts (`year`) and every scheme's charges (`charged.year`). */
	year?: { [part: string]: number };
	charged?: { [code: string]: { employee: number; employer: number } };
	/** Other schemes' standing elections (`elections.<CODE>`). */
	all_elections?: Row;
};
const subject = (input: Subject = {}) => {
	const day = input.day ?? '2026-02-15';
	const before = String(evaluateConfigured(`add_days(month_start("${day}"), -1)`, {}));
	const age = input.age === undefined ? 40 : input.age;
	const employment = {
		classification: 'EA_COVERED',
		service_months: input.service_months ?? 30,
		start_date: input.start_date ?? '2023-08-01',
		exit_date: '',
		exit_ground: '',
		exit_facts: {}
	};
	const residency_status = input.residency_status ?? 'CITIZEN';
	return {
		employee: {
			gender: '',
			marital_status: 'SINGLE',
			spouse_status: 'NONE',
			solo_parent: false,
			disabled: false,
			receiving_pension: false,
			nationality: '',
			// Born on the day before the month starts, so `age_on(dob, period.from - 1)` is exactly `age`.
			date_of_birth: age == null ? '' : `${Number(before.slice(0, 4)) - age}${before.slice(4)}`,
			age,
			children: [],
			dependents_count: 0,
			...input.employee,
			facts: { ...input.facts }
		},
		company: { region: '', risk_class: '', pay_frequency: 'MONTHLY', facts: { ...input.company } },
		terms: {
			work_classification: 'EA_COVERED',
			statutory_work_category: 'MANUAL_LABOUR',
			employment_type: 'PERMANENT',
			residency_status,
			residency_since: '',
			base_salary: 3000,
			monthly_wage: 3000,
			facts: {},
			...input.terms
		},
		employment,
		person: {
			employment,
			race: null,
			religion: null,
			nationality: null,
			residency_status,
			residency_since: null
		}
	};
};

/** One month's charge the way `assessStatutory` makes it for a single slip: person facts, assessable parts, rules. */
const statutory = (
	version: string,
	code: string,
	wage: number | { [part: string]: number },
	input: Subject = {}
): { employee: number; employer: number } | null => {
	const configuration = byCode(version, 'statutory_contribution_catalog', code)
		.configuration as Configuration;
	const parts = typeof wage === 'number' ? { ordinary: wage } : wage;
	const key = (input.day ?? '2026-02-15').slice(0, 7);
	const from = `${key}-01`;
	const to = monthEnd(from);
	const held = subject(input);
	let context: Row = {
		...held,
		wage: parts,
		month: parts,
		year: input.year ?? {},
		rules: {},
		charged: { year: input.charged ?? {}, month: {} },
		elections: { [code]: input.elections ?? {}, ...input.all_elections },
		scheme: { code, standing: input.standing ?? '', elections: input.elections ?? {} },
		period: {
			key,
			from,
			to,
			days: Number(to.slice(8)),
			month: Number(key.slice(5)),
			salary_paid: false
		}
	};
	const person: Row = { ...held.person };
	for (const [fact, expression] of Object.entries(configuration.person ?? {}))
		person[fact] = evaluateConfigured(expression, context);
	context = { ...context, person };
	const assessed: { [part: string]: number } = {};
	for (const [part, amount] of Object.entries(parts)) {
		const expression = configuration.assessable?.[part];
		assessed[part] = round2(
			Math.max(0, expression == null ? amount : Number(evaluateConfigured(expression, context)))
		);
	}
	const total = round2(Object.values(assessed).reduce((sum, value) => sum + value, 0));
	context = { ...context, base: { ...assessed, assessed: total, amount: total } };
	for (const rule of configuration.rules) {
		if (rule.when != null && evaluateConfigured(rule.when, context) !== true) continue;
		const amount = (expression?: string) =>
			expression == null ? 0 : round2(Number(evaluateConfigured(expression, context)));
		return { employee: amount(rule.employee), employer: amount(rule.employer) };
	}
	return null;
};
/** Every PCB part a catalogue row can count toward, so `base.<part>` exists as the engine builds it. */
const pcb = (parts: { [part: string]: number }) => ({
	ordinary: 0,
	additional: 0,
	non_epf: 0,
	additional_non_epf: 0,
	...parts
});

/** The context `admitEntry` builds for one entry. */
const admitContext = (facts: Row = {}, input: Subject = {}, columns: Row = {}) => ({
	...subject(input),
	rules: {},
	entry: {
		days: 1,
		...columns,
		...facts,
		amount: 100,
		quantity: 1,
		occurred_on: '2026-02-10',
		due_on: '2026-02-10',
		incurred_on: '2026-02-10',
		facts
	}
});
/** One `work.days[]` entry as `buildPayslip` projects it. */
const workDay = (date: string, fields: Row = {}) => ({
	date,
	day_type: 'WORK',
	shift_code: 'AM0830',
	holiday_kind: '',
	scheduled_hours: 8,
	worked_hours: 8,
	overtime_hours: 0,
	incentive_hours: 0,
	intervals: [],
	...fields
});
/** One `leave.rows[]` entry as `buildPayslip` projects it. */
const leaveRow = (fields: Row) => ({
	activity: 'TIME_OFF',
	from: '2026-02-05',
	to: '2026-02-05',
	is_npl: false,
	can_encash: false,
	event_id: '',
	month_index: 1,
	facts: {},
	pay_fraction: 1,
	...fields
});
/** The context `buildPayslip` builds for a salary run. */
const payslipContext = (input: Subject = {}, overrides: Row = {}) => ({
	...subject(input),
	rules: {},
	period: {
		key: '2026-02',
		from: '2026-02-01',
		to: '2026-02-28',
		days: 28,
		paid_days: 28,
		covered_days: 28,
		working_days: 20
	},
	work: {
		overtime_hours: 10,
		incentive_hours: 0,
		dates: ['2026-02-03', '2026-02-10'],
		holidays: [{ date: '2026-02-10', kind: 'PUBLIC_HOLIDAY', given_to: 'EVERYONE', replaces: '' }],
		holiday_dates: ['2026-02-10'],
		days: [workDay('2026-02-03', { overtime_hours: 10, worked_hours: 18 })]
	},
	hours: {
		month: { worked_hours: 18, overtime_hours: 10, incentive_hours: 0 },
		previous_month: { worked_hours: 0, overtime_hours: 0, incentive_hours: 0 },
		year: { worked_hours: 18, overtime_hours: 10, incentive_hours: 0 },
		rolling: { worked_hours: 18, overtime_hours: 10, incentive_hours: 0 }
	},
	earned: {},
	leave: {
		rows: [
			leaveRow({ code: 'UNPAID_LEAVE', days: 2, is_npl: true }),
			leaveRow({ code: 'ANNUAL_LEAVE', activity: 'ENCASHMENT', days: 1, can_encash: true })
		]
	},
	...overrides
});
/** `event.leave_balances` as `leaveState` builds it on a contract event: the balances on the exit day, on the subject. */
const withBalances = <C extends { event: Row; catalogues?: unknown; movements?: unknown }>(
	context: C
): C => {
	const row = context.event.row as Row;
	const range = (row.effective_range ?? {}) as { from?: string; to?: string | null };
	const asOf = range.to ?? range.from ?? '2026-01-01';
	return {
		...context,
		event: {
			...context.event,
			leave_balances: leaveBalances({
				classes: ((context.catalogues ?? []) as Row[]).map((held) => classFromRow(held as never)),
				movements: ((context.movements ?? []) as Row[]).map((held) =>
					movementFromRow(held as never)
				),
				serviceMonths: serviceMonthsAt(range.from ?? null, asOf, row.prior_service_months),
				asOf,
				employmentStart: range.from ?? null,
				context: subject({ day: asOf }) as never
			})
		}
	};
};
/** A class's entitlement as `leaveState` reads it: the subject roots plus the days `taken` in each window. */
const entitled = (row: Row, service_months: number, taken: Row = {}, input: Subject = {}) =>
	entitlementDays(row.entitlement as never, service_months, {
		...subject(input),
		taken: { calendar_year: 0, service_year: 0, lifetime: 0, event: 0, ...taken }
	} as never);
const evaluates = (
	expression: unknown,
	context: object,
	where: string,
	kind: 'boolean' | 'number'
) => {
	if (expression == null || String(expression).trim() === '') return;
	const value = evaluateConfigured(String(expression), context);
	assert.equal(typeof value, kind, `${where}: ${String(expression).slice(0, 80)}`);
};
const line = (version: string, code: string, context: object): number => {
	const row = byCode(version, 'work_catalog', code);
	if (evaluateConfigured(String(row.eligibility ?? 'true'), context) !== true) return 0;
	return round2(
		Number(evaluateConfigured(String(row.quantity), context)) *
			Number(evaluateConfigured(String(row.rate), context))
	);
};
type Duty = {
	trigger: string;
	applies_when?: string;
	months?: string[];
	due: string;
	description: string;
	authority: string;
};
const duties = (version: string) =>
	new Map(
		dutiesOf(rows(version, 'rule_set')).map((row) => [
			String(row.code),
			{ ...(row.rules as Duty), trigger: triggerOf(row) }
		])
	);

describe('MY jurisdiction seed', () => {
	it('every version holds its settings, rule set and every catalogue file', () => {
		assert.ok(versions.length >= 1);
		for (const version of versions)
			for (const table of TABLES)
				assert.ok(existsSync(resolve(root, version, `${table}.json`)), `${version}/${table}.json`);
	});

	it('ids are unique across every lineage and every child names its own version', () => {
		const seen = new Map<string, string>();
		for (const lineage of readdirSync(lineages))
			for (const version of versionsOf(resolve(lineages, lineage)))
				for (const table of TABLES) {
					const path = resolve(lineages, lineage, version, `${table}.json`);
					if (!existsSync(path)) continue;
					for (const row of JSON.parse(readFileSync(path, 'utf8')) as Row[]) {
						const where = `${lineage}/${version}/${table}`;
						assert.ok(
							!seen.has(String(row.id)),
							`${where} reuses ${String(row.id)} of ${seen.get(String(row.id))}`
						);
						seen.set(String(row.id), where);
					}
				}
		for (const version of versions) {
			const settings = settingsOf(version);
			for (const table of TABLES)
				for (const row of rows(version, table)) {
					assert.equal(typeof row.id, 'string');
					if (table !== 'jurisdiction_settings')
						assert.equal(row.settings_id, settings.id, `${version} ${table} ${String(row.code)}`);
				}
		}
	});

	it('versions chain by cloned_from_id and their date ranges are contiguous and inclusive', () => {
		let previous: Row | undefined;
		for (const version of versions) {
			const row = settingsOf(version);
			const range = row.effective_range as { from: string; to: string | null };
			assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
			assert.equal(row.code, 'MY');
			assert.equal(typeof row.sealed_at, 'string');
			if (previous === undefined) assert.equal(row.cloned_from_id, undefined);
			else {
				const before = previous.effective_range as { from: string; to: string | null };
				assert.equal(row.cloned_from_id, previous.id, version);
				assert.ok(
					before.to != null && before.to >= before.from,
					`${version} predecessor is closed`
				);
				assert.equal(
					range.from,
					nextDay(before.to),
					`${version} starts the day after its predecessor ends`
				);
			}
			previous = row;
		}
		assert.equal(
			(previous?.effective_range as { to: unknown }).to,
			null,
			'the last version is open'
		);
	});

	it('every row carries only keys its model declares', () => {
		const owned = new Set(Object.keys(relationships).map((key) => key.split('.').join(':')));
		for (const version of versions)
			for (const table of TABLES) {
				const allowed = new Set([
					'id',
					...Object.keys(MODELS[table].fields),
					...[...owned].filter((key) => key.startsWith(`${table}:`)).map((key) => key.split(':')[1])
				]);
				for (const row of rows(version, table))
					for (const key of Object.keys(row))
						assert.ok(
							allowed.has(key),
							`${version} ${table} ${String(row.code)}: stale key ${key}`
						);
			}
	});

	it('a class or duty code never disappears from a later version', () => {
		for (const [index, version] of versions.entries()) {
			if (index === 0) continue;
			for (const table of [...CATALOGS, 'rule_set'] as const) {
				const now = new Set(rows(version, table).map((row) => row.code));
				for (const row of rows(versions[index - 1]!, table))
					assert.ok(now.has(row.code), `${version} ${table} drops ${String(row.code)}`);
			}
		}
	});

	it('every catalogue CEL evaluates on the context the engine builds', () => {
		const people: Subject[] = [
			{},
			{ age: 65, residency_status: 'PERMANENT_RESIDENT', employee: { gender: 'FEMALE' } },
			{
				age: null,
				residency_status: 'FOREIGNER',
				employee: { gender: 'MALE', marital_status: 'MARRIED' }
			}
		];
		for (const version of versions) {
			for (const input of people) {
				for (const row of rows(version, 'work_catalog')) {
					const where = `${version} work ${String(row.code)}`;
					evaluates(row.eligibility, payslipContext(input), where, 'boolean');
					evaluates(row.quantity, payslipContext(input), where, 'number');
					evaluates(row.rate, payslipContext(input), where, 'number');
				}
				for (const row of rows(version, 'allowance_catalog')) {
					const context = { ...payslipContext(input), allowance: { code: row.code, amount: 200 } };
					evaluates(
						row.eligibility,
						context,
						`${version} allowance ${String(row.code)}`,
						'boolean'
					);
					evaluates(row.amount, context, `${version} allowance ${String(row.code)}`, 'number');
				}
				for (const row of rows(version, 'leave_catalog')) {
					const where = `${version} leave ${String(row.code)}`;
					evaluates(row.eligibility, admitContext({}, input), where, 'boolean');
					evaluates(
						row.eligibility,
						admitContext({ event_kind: 'BIRTH' }, input),
						where,
						'boolean'
					);
					evaluates(row.pay_fraction, admitContext({}, input), where, 'number');
					const days = (row.entitlement as { days?: string } | undefined)?.days;
					if (days != null) assert.equal(typeof entitled(row, 30, {}, input), 'number');
				}
				for (const table of ['adhoc_catalog', 'claim_catalog', 'loan_catalog'] as const)
					for (const row of rows(version, table))
						for (const context of [
							admitContext({}, input),
							{ ...payslipContext(input), entry: admitContext().entry }
						]) {
							const where = `${version} ${table} ${String(row.code)}`;
							evaluates(row.eligibility, context, where, 'boolean');
							evaluates(row.qualifies_when, context, where, 'boolean');
							for (const band of (row.bands ?? []) as Band[]) {
								evaluates(band.when, context, where, 'boolean');
								evaluates(band.amount, context, where, 'number');
								evaluates(band.limit?.amount, context, where, 'number');
							}
						}
				for (const row of rows(version, 'statutory_contribution_catalog'))
					for (const wage of [1500, 4999.99, 5000.01, 25000])
						assert.doesNotThrow(
							() =>
								statutory(
									version,
									String(row.code),
									pcb({ ordinary: wage, additional: 1000, non_epf: 300 }),
									input
								),
							`${version} ${String(row.code)}`
						);
			}
		}
	});

	it('both input schemas are JSON Schema 2020-12 and declare every fact the CEL reads', () => {
		const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
		const valid = (node: unknown, where: string): void => {
			assert.ok(node != null && typeof node === 'object' && !Array.isArray(node), where);
			const schema = node as Row;
			for (const type of [schema.type ?? []].flat())
				assert.ok(TYPES.has(String(type)), `${where}.type`);
			if (schema.enum !== undefined)
				assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0, `${where}.enum`);
			if (schema.items !== undefined) valid(schema.items, `${where}.items`);
			if (schema.properties !== undefined)
				for (const [key, child] of Object.entries(schema.properties as Row))
					valid(child, `${where}.${key}`);
		};
		const CEL = new Set([
			'eligibility',
			'qualifies_when',
			'quantity',
			'rate',
			'amount',
			'when',
			'employee',
			'employer',
			'due',
			'applies_when',
			'days',
			'pay_fraction'
		]);
		for (const version of versions) {
			const settings = settingsOf(version);
			const employee = settings.employee_input_schema as Row & { properties: Row };
			const entity = settings.entity_input_schema as Row & { properties: Row };
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
				valid(schema, `${version} ${name}`);
			}
			const props = (schema: unknown) =>
				new Set(Object.keys(((schema as Row | undefined)?.properties ?? {}) as Row));
			// The one layout the engine reads: contract terms, exit facts, statutory standings and person facts.
			assert.deepEqual(Object.keys(employee.properties).toSorted(), [
				'contract_terms',
				'employment_statutory_facts',
				'exit_facts',
				'facts'
			]);
			const standing = (employee.properties.employment_statutory_facts as Row).items as Row & {
				properties: { status: Row & { properties: { kind: Row; elections: Row } } };
			};
			for (const column of [
				'gender',
				'marital_status',
				'spouse_status',
				'children',
				'nationality',
				'date_of_birth',
				'dependents_count'
			])
				assert.equal(
					props(employee.properties.facts).has(column),
					false,
					`${version} ${column} is a profile column`
				);
			for (const column of ['region', 'risk_class']) assert.equal(props(entity).has(column), false);
			const terms = (employee.properties.contract_terms as Row).items as Row & { properties: Row };
			assert.equal(
				((terms.properties.base_salary as Row).properties as Row & { currency: Row }).currency
					.const,
				'MYR'
			);
			assert.deepEqual((terms.properties.residency_status as Row).enum, [
				'CITIZEN',
				'PERMANENT_RESIDENT',
				'FOREIGNER'
			]);
			const declared = {
				employee: props(employee.properties.facts),
				company: props(entity),
				terms: props(terms),
				elections: props(standing.properties.status.properties.elections),
				exit: props(employee.properties.exit_facts)
			};
			for (const key of [
				'epf_employer_number',
				'socso_employer_code',
				'lhdn_employer_number',
				'hrd_employer_code'
			])
				assert.ok(declared.company.has(key), `${version} entity ${key}`);
			const expressions: string[] = [];
			const walk = (value: unknown, key = ''): void => {
				if (typeof value === 'string') {
					if (CEL.has(key)) expressions.push(value);
				} else if (Array.isArray(value)) value.forEach((item) => walk(item, key));
				else if (value != null && typeof value === 'object')
					for (const [child, item] of Object.entries(value))
						walk(item, key === 'assessable' || key === 'person' ? 'when' : child);
			};
			for (const table of TABLES.filter((table) => table !== 'jurisdiction_settings'))
				walk(rows(version, table));
			assert.ok(
				expressions.some((expression) => expression.includes('company.facts.')),
				version
			);
			assert.ok(
				expressions.some((expression) => expression.includes('scheme.elections.')),
				version
			);
			for (const expression of expressions) {
				for (const [, root, fact] of expression.matchAll(/\b(employee|company)\.facts\.([a-z_]+)/g))
					assert.ok(
						declared[root as 'employee' | 'company'].has(String(fact)),
						`${version} ${root}.facts.${fact}`
					);
				for (const [, fact] of expression.matchAll(/\bscheme\.elections\.([a-z_0-9]+)/g))
					assert.ok(declared.elections.has(String(fact)), `${version} scheme.elections.${fact}`);
				for (const [, fact] of expression.matchAll(/\bexit_facts\.([a-z_]+)/g))
					assert.ok(declared.exit.has(String(fact)), `${version} exit_facts.${fact}`);
				for (const [, fact] of expression.matchAll(/\bterms\.([a-z_]+)/g))
					assert.ok(
						declared.terms.has(String(fact)) || fact === 'monthly_wage',
						`${version} terms.${fact}`
					);
			}
			// SKBBK became voluntary for citizens and permanent residents on 8 July 2026: a RELEASED standing from then.
			assert.equal(
				(standing.properties.status.properties.kind.enum as string[]).includes('RELEASED'),
				(settings.effective_range as { from: string }).from >= '2026-07-08',
				version
			);
		}
	});

	it('obligations are rule_set rows whose due date and condition evaluate for their trigger', () => {
		const company = { region: '', risk_class: '', facts: {} };
		const employee = { nationality: 'MAL', gender: 'MALE', date_of_birth: '1990-01-01', facts: {} };
		const contract = (exit_ground: string, exit_facts: Row = {}) => ({
			id: 'c1',
			employee_id: 'p1',
			company_id: 'co1',
			effective_range: { from: '2020-01-01', to: '2026-10-31' },
			exit_ground,
			exit_facts
		});
		const contexts: { [trigger: string]: Row } = {
			PAYROLL_RUN: { period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' }, company },
			HIRE: {
				hired_on: '2026-10-15',
				contract: { ...contract(''), facts: { contract_terms: [] } },
				employee,
				company,
				headcount: 1
			},
			EXIT: { exit_on: '2026-10-31', contract: contract('RESIGNATION'), employee, company },
			'entity.created': {
				row: { id: 'co1', effective_range: { from: '2026-10-15', to: null }, facts: {} },
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				company: { ...company, facts: { hrd_registration_class: 'COMPULSORY' } },
				today: '2026-10-15',
				headcount: 0
			},
			'entity.updated': {
				row: { id: 'co1', effective_range: { from: '2009-12-01', to: '2026-10-31' }, facts: {} },
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				company: { ...company, facts: { hrd_registration_class: 'COMPULSORY' } },
				today: '2026-10-31',
				headcount: 0
			},
			'leave_catalog_entry.created': {
				row: {
					id: 'l1',
					catalog_code: 'MEDICAL_LEAVE',
					occurred_on: '2026-10-20',
					facts: { work_injury: true }
				},
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				company,
				today: '2026-10-20'
			}
		};
		for (const version of versions) {
			const all = duties(version);
			assert.equal(all.size, 28, version);
			for (const [code, rules] of all) {
				const where = `${version} ${code}`;
				for (const key of Object.keys(rules)) assert.ok(DUTY_KEYS.includes(key), `${where}.${key}`);
				assert.ok(rules.description.length > 0 && rules.authority.length > 0, where);
				const context = contexts[rules.trigger];
				assert.ok(context, `${where} trigger ${rules.trigger}`);
				for (const month of rules.months ?? []) assert.match(month, /^(0[1-9]|1[0-2])$/, where);
				assert.match(String(evaluateConfigured(rules.due, context)), /^\d{4}-\d{2}-\d{2}$/, where);
				if ((rules as Row).when != null)
					assert.equal(
						typeof evaluateConfigured(String((rules as Row).when), context),
						'boolean',
						where
					);
				if (rules.applies_when != null)
					assert.equal(typeof evaluateConfigured(rules.applies_when, context), 'boolean', where);
			}
			const tables = settingsOf(version).reference_tables as Row;
			assert.equal(
				tables.obligations,
				undefined,
				`${version} obligations moved out of reference_tables`
			);
			assert.equal(
				tables.duty_types,
				undefined,
				`${version} duty_types moved out of reference_tables`
			);
		}
		const rulesOf = (version: string, code: string) => {
			const rules = duties(version).get(code);
			assert.ok(rules, code);
			return rules;
		};
		const due = (version: string, code: string, context: Row) =>
			evaluateConfigured(rulesOf(version, code).due, context);
		const applies = (version: string, code: string, context: Row) =>
			evaluateConfigured(rulesOf(version, code).applies_when ?? 'true', context);
		const period = (key: string) => ({
			period: { key, from: `${key}-01`, to: monthEnd(`${key}-01`) },
			company
		});
		for (const code of [
			'EPF_MONTHLY_CONTRIBUTION',
			'SOCSO_EIS_MONTHLY_CONTRIBUTION',
			'PCB_REMITTANCE',
			'HRD_LEVY_MONTHLY'
		]) {
			assert.equal(due(at('2026-01-15'), code, period('2026-01')), '2026-02-15', code);
			assert.equal(due(at('2026-12-15'), code, period('2026-12')), '2027-01-15', code);
		}
		assert.equal(due(at('2026-02-15'), 'WAGE_PAYMENT_DEADLINE', period('2026-02')), '2026-03-07');
		assert.deepEqual(duties(at('2027-01-15')).get('EA_FORM')?.months, ['01']);
		assert.equal(due(at('2027-01-15'), 'EA_FORM', period('2027-01')), '2027-02-28');
		assert.equal(due(at('2028-01-15'), 'EA_FORM', period('2028-01')), '2028-02-29');
		assert.equal(due(at('2027-01-15'), 'FORM_E_CP8D', period('2027-01')), '2027-03-31');
		assert.equal(due(at('2026-12-15'), 'PUBLIC_HOLIDAY_NOTICE', period('2026-12')), '2026-12-31');
		// The HRD levy is a duty of a COMPULSORY or OPTIONAL registrant (unrecorded is compulsory), never out of scope.
		const v = at('2026-10-15');
		const levy = (facts: Row | null) =>
			applies(v, 'HRD_LEVY_MONTHLY', { ...period('2026-10'), company: { ...company, facts } });
		assert.equal(levy({}), true);
		assert.equal(levy(null), true);
		assert.equal(levy({ hrd_registration_class: 'OPTIONAL' }), true);
		assert.equal(levy({ hrd_registration_class: 'NOT_REGISTERED' }), false);
		assert.equal(levy({ hrd_scope: 'OUT_OF_SCOPE', hrd_registration_class: 'COMPULSORY' }), false);
		const hired = contexts.HIRE!;
		assert.equal(due(v, 'CP22_NEW_EMPLOYEE', hired), '2026-11-14');
		assert.equal(due(v, 'SOCSO_EIS_EMPLOYEE_REGISTRATION', hired), '2026-11-14');
		assert.equal(due(v, 'EPF_EMPLOYEE_REGISTRATION', hired), '2026-11-15');
		assert.equal(due(v, 'FOREIGN_EMPLOYEE_PARTICULARS', hired), '2026-10-29');
		// Foreign-employee duties follow the contract terms' residency (a permanent resident is not foreign, EA s.60O).
		const withResidency = (residency_status: string) => ({
			...hired,
			contract: { ...contract(''), facts: { contract_terms: [{ residency_status }] } }
		});
		for (const residency of ['CITIZEN', 'PERMANENT_RESIDENT'])
			for (const code of ['FOREIGN_EMPLOYEE_PARTICULARS', 'FOREIGN_WORKER_LEVY'])
				assert.equal(applies(v, code, withResidency(residency)), false, `${code} ${residency}`);
		for (const code of ['FOREIGN_EMPLOYEE_PARTICULARS', 'FOREIGN_WORKER_LEVY'])
			assert.equal(applies(v, code, withResidency('FOREIGNER')), true, code);
		assert.equal(due(v, 'FOREIGN_WORKER_LEVY', withResidency('FOREIGNER')), '2026-10-15');
		const exit = (exit_ground: string, exit_facts: Row = {}, residency_status = 'CITIZEN') => ({
			exit_on: '2026-10-31',
			contract: {
				...contract(exit_ground, exit_facts),
				facts: { contract_terms: [{ residency_status }] }
			},
			employee,
			company
		});
		assert.equal(due(v, 'CP22A_CESSATION_AND_WITHHOLDING', exit('RETIREMENT')), '2026-10-01');
		assert.equal(due(v, 'CP21_LEAVING_MALAYSIA', exit('RESIGNATION')), '2026-10-01');
		assert.equal(due(v, 'TERMINATION_BENEFIT_PAYMENT', exit('RETRENCHMENT')), '2026-11-07');
		assert.equal(due(v, 'TERMINATION_BENEFITS_FINAL_WAGES', exit('RESIGNATION')), '2026-10-31');
		// EA s.21(2): an employee who left without notice is paid by the third day after.
		assert.equal(
			due(
				v,
				'TERMINATION_BENEFITS_FINAL_WAGES',
				exit('RESIGNATION', { terminated_without_notice: true })
			),
			'2026-11-03'
		);
		const raised = (context: Row) =>
			[...duties(v)]
				.filter(
					([, rules]) =>
						rules.trigger === 'EXIT' &&
						evaluateConfigured(rules.applies_when ?? 'true', context) === true
				)
				.map(([code]) => code)
				.toSorted();
		const always = ['TERMINATION_BENEFITS_FINAL_WAGES'];
		assert.deepEqual(raised(exit('RESIGNATION')), always);
		assert.deepEqual(
			raised(exit('RETIREMENT')),
			['CP22A_CESSATION_AND_WITHHOLDING', ...always].toSorted()
		);
		assert.deepEqual(
			raised(exit('RESIGNATION', { leaving_malaysia: true }, 'FOREIGNER')),
			[
				'CP21_LEAVING_MALAYSIA',
				'CP22A_CESSATION_AND_WITHHOLDING',
				'FOREIGN_EMPLOYEE_TERMINATION_NOTICE',
				...always
			].toSorted()
		);
		assert.deepEqual(
			raised(exit('RETRENCHMENT')),
			['RETRENCHMENT_NOTIFICATION', 'TERMINATION_BENEFIT_PAYMENT', ...always].toSorted()
		);
		// Termination benefits: none for a misconduct dismissal or under twelve months' service.
		assert.deepEqual(
			raised(exit('DISMISSAL')),
			['TERMINATION_BENEFIT_PAYMENT', ...always].toSorted()
		);
		assert.deepEqual(raised(exit('DISMISSAL', { misconduct_dismissal: true })), always);
		const short = {
			...exit('RETRENCHMENT'),
			contract: {
				...exit('RETRENCHMENT').contract,
				effective_range: { from: '2026-01-01', to: '2026-10-31' }
			}
		};
		assert.deepEqual(raised(short), ['RETRENCHMENT_NOTIFICATION', ...always].toSorted());
		// SKBBK is remitted with SOCSO from 1 June 2026.
		assert.doesNotMatch(
			duties(at('2026-05-15')).get('SOCSO_EIS_MONTHLY_CONTRIBUTION')!.description,
			/SKBBK/
		);
		assert.match(
			duties(at('2026-06-15')).get('SOCSO_EIS_MONTHLY_CONTRIBUTION')!.description,
			/SKBBK/
		);
	});

	it('round-5 tasks: employer registrations, rest-day roster, s.19(2) wages, accident report', () => {
		const rulesOf = (version: string, code: string) => {
			const row = rows(version, 'rule_set').find((item) => item.code === code);
			assert.ok(row, `${version} ${code}`);
			return row.rules as Row;
		};
		const entity = (from: string, facts: Row = {}) => ({
			row: { id: 'co1', effective_range: { from, to: null }, facts },
			period: { key: from.slice(0, 7), from: `${from.slice(0, 7)}-01`, to: monthEnd(from) },
			company: { region: '', risk_class: '', facts },
			today: from,
			headcount: 0
		});
		for (const version of versions) {
			const due = (code: string, context: Row) =>
				evaluateConfigured(String(rulesOf(version, code).due), context);
			const applies = (code: string, context: Row) =>
				evaluateConfigured(String(rulesOf(version, code).applies_when ?? 'true'), context);
			const when = (code: string, context: Row) =>
				evaluateConfigured(String(rulesOf(version, code).when ?? 'true'), context);
			// EPF Act s.41(1): before the end of the first week of the first wage month.
			assert.equal(due('EPF_EMPLOYER_REGISTRATION', entity('2026-10-03')), '2026-10-07');
			assert.equal(due('EPF_EMPLOYER_REGISTRATION', entity('2026-10-15')), '2026-11-07');
			assert.deepEqual(rulesOf(version, 'EPF_EMPLOYER_REGISTRATION').trigger as Row, {
				collection: 'entity',
				event: 'created'
			});
			// HRD: thirty days after becoming liable, for a COMPULSORY registrant only.
			assert.equal(
				due(
					'HRD_EMPLOYER_REGISTRATION',
					entity('2026-10-15', { hrd_registration_class: 'COMPULSORY' })
				),
				'2026-11-14'
			);
			assert.equal(
				applies(
					'HRD_EMPLOYER_REGISTRATION',
					entity('2026-10-15', { hrd_registration_class: 'COMPULSORY' })
				),
				true
			);
			assert.equal(
				applies(
					'HRD_EMPLOYER_REGISTRATION',
					entity('2026-10-15', { hrd_registration_class: 'OPTIONAL' })
				),
				false
			);
			// PERKESO: within 30 days of the first employee (headcount 1); PERKESO and HRD cessation within 30 days.
			const hire = (headcount: number) => ({
				hired_on: '2026-10-15',
				headcount,
				row: {},
				company: { facts: {} }
			});
			assert.equal(applies('SOCSO_EIS_EMPLOYER_REGISTRATION', hire(1)), true);
			assert.equal(applies('SOCSO_EIS_EMPLOYER_REGISTRATION', hire(12)), false);
			assert.equal(due('SOCSO_EIS_EMPLOYER_REGISTRATION', hire(1)), '2026-11-14');
			const closed = (facts: Row) => ({
				...entity('2009-12-01', facts),
				row: { id: 'co1', effective_range: { from: '2009-12-01', to: '2026-10-31' }, facts }
			});
			assert.equal(when('PERKESO_CESSATION_NOTICE', closed({})), true);
			assert.equal(when('PERKESO_CESSATION_NOTICE', entity('2009-12-01')), false);
			assert.equal(due('PERKESO_CESSATION_NOTICE', closed({})), '2026-11-30');
			assert.equal(
				applies('HRD_CESSATION_NOTICE', closed({ hrd_registration_class: 'COMPULSORY' })),
				true
			);
			assert.equal(
				applies('HRD_CESSATION_NOTICE', closed({ hrd_registration_class: 'NOT_REGISTERED' })),
				false
			);
			// EA s.59(2) before the next month; s.19(2) by the last day of the next wage period.
			const run = {
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				row: { period: '2026-10' }
			};
			assert.equal(due('REST_DAY_ROSTER', run), '2026-10-31');
			assert.equal(due('OVERTIME_REST_HOLIDAY_WAGES_DEADLINE', run), '2026-11-30');
			// The 48-hour accident report, keyed by the sick / hospitalisation class and the work_injury fact.
			const leave = (catalog_code: string, facts: Row) => ({
				row: { id: 'l1', catalog_code, occurred_on: '2026-10-20', facts }
			});
			assert.equal(
				when('SOCSO_ACCIDENT_REPORT', leave('HOSPITALIZATION_LEAVE', { work_injury: true })),
				true
			);
			assert.equal(when('SOCSO_ACCIDENT_REPORT', leave('MEDICAL_LEAVE', {})), false);
			assert.equal(
				when('SOCSO_ACCIDENT_REPORT', leave('ANNUAL_LEAVE', { work_injury: true })),
				false
			);
			assert.equal(
				due('SOCSO_ACCIDENT_REPORT', leave('MEDICAL_LEAVE', { work_injury: true })),
				'2026-10-22'
			);
		}
	});

	it('validations: the RM1,700 minimum wage on contract terms, the s.24(8) deduction ceiling, the 104-hour limit', () => {
		for (const version of versions) {
			const set = rows(version, 'rule_set');
			const minimum = set.find((row) => row.code === 'minimum_wage')!.rules as Row;
			assert.equal(minimum.monthly, 1700);
			assert.equal(minimum.hourly, 8.72);
			const check = (code: string) => {
				const row = set.find((item) => item.code === code);
				assert.ok(row && row.family === 'VALIDATIONS', `${version} ${code}`);
				return row.rules as { site: string; kind: string; when: string; message: string };
			};
			const contract = (term: Row) => ({
				...subject({ terms: term }),
				rules: { minimum_wage: minimum },
				term: { ...subject({ terms: term }).terms }
			});
			const monthly = check('MINIMUM_WAGE_MONTHLY');
			assert.deepEqual([monthly.site, monthly.kind], ['contract', 'refuse']);
			assert.equal(evaluateConfigured(monthly.when, contract({ base_salary: 1699.99 })), true);
			assert.equal(evaluateConfigured(monthly.when, contract({ base_salary: 1700 })), false);
			assert.equal(evaluateConfigured(monthly.when, contract({ base_salary: 0 })), false);
			assert.equal(
				evaluateConfigured(
					monthly.when,
					contract({ base_salary: 900, employment_type: 'DOMESTIC' })
				),
				false
			);
			const territory = check('LABOUR_ORDINANCE_TERRITORY');
			assert.equal(
				evaluateConfigured(territory.when, contract({ facts: { worksite_state: 'SABAH' } })),
				true
			);
			assert.equal(
				evaluateConfigured(territory.when, contract({ facts: { worksite_state: 'JOHOR' } })),
				false
			);
			assert.equal(evaluateConfigured(territory.when, contract({})), false);
			const hourly = check('MINIMUM_WAGE_HOURLY_PART_TIME');
			const part = (base_salary: number, hours: number) =>
				contract({
					base_salary,
					employment_type: 'PART_TIME',
					facts: { contract_hours_per_week: hours }
				});
			// RM8.72 × 52 × 20 ÷ 12 = RM755.73 a month for twenty hours a week.
			assert.equal(evaluateConfigured(hourly.when, part(755, 20)), true);
			assert.equal(evaluateConfigured(hourly.when, part(756, 20)), false);
			const ceiling = check('DEDUCTION_CEILING');
			assert.deepEqual([ceiling.site, ceiling.kind], ['payslip', 'hold']);
			const slip = (total_deductions: number, lines: Row = {}, exit_date = '') => ({
				...payslipContext(),
				employment: { ...subject().employment, exit_date },
				payslip: { gross: 3000, net: 3000 - total_deductions, total_deductions, lines }
			});
			assert.equal(evaluateConfigured(ceiling.when, slip(1500)), false);
			assert.equal(evaluateConfigured(ceiling.when, slip(1500.01)), true);
			assert.equal(evaluateConfigured(ceiling.when, slip(1800, {}, '2026-02-20')), false);
			assert.equal(
				evaluateConfigured(ceiling.when, slip(2000, { APPROVED_HOUSING_LOAN: -1200 })),
				false
			);
			assert.equal(evaluateConfigured(ceiling.when, slip(2000, { NOTICE_INDEMNITY: -600 })), false);
			const overtime = check('OVERTIME_LIMIT');
			assert.equal(evaluateConfigured(overtime.when, payslipContext()), false);
			assert.equal(
				evaluateConfigured(
					overtime.when,
					// The month's hours across every slip of it (hours.month): 100 overtime + 5 incentive.
					payslipContext(
						{},
						{
							hours: {
								...payslipContext().hours,
								month: { worked_hours: 0, overtime_hours: 100, incentive_hours: 5 }
							}
						}
					)
				),
				true
			);
		}
	});

	it('the canonical duty behaviours raise each applicable duty once', () => {
		for (const version of versions) {
			const row = settingsOf(version);
			const behaviours = behavioursOf(row.behaviours);
			assert.ok(behaviours, version);
			const ruleRows = rows(version, 'rule_set');
			const all = dutiesOf(ruleRows).map((item) => ({
				code: item.code,
				family: item.family,
				rules: { ...(item.rules as Row), trigger: triggerOf(item) } as Row
			}));
			const of = (trigger: string) => all.filter((duty) => duty.rules.trigger === trigger);
			const company = [{ region: '', risk_class: '', facts: {} }];
			const local = [
				{ nationality: 'MAL', gender: 'FEMALE', date_of_birth: '1990-01-01', facts: {} }
			];
			const contract = (data: Row) => ({
				id: 'c1',
				approval_id: null,
				company_id: 'co1',
				employee_id: 'p1',
				exit_ground: '',
				...data
			});
			const raise = (collection: string, event: string, data: Row, reads: Row) =>
				raiseDuties({
					behaviours,
					settings_id: row.id,
					rows: ruleRows,
					collection,
					event,
					row: contract(data),
					reads
				});
			const run = (period: string, raised: Row[] = []) =>
				raise('payroll_run', 'created', { period }, { raised, company });
			const monthly = of('PAYROLL_RUN').filter((duty) => duty.rules.months == null);
			const january = run('2027-01');
			assert.equal(january.length, monthly.length + 2, `${version} January adds EA and Form E`);
			assert.equal(run('2026-10').length, monthly.length);
			assert.equal(run('2026-12').length, monthly.length + 1);
			// An employer outside the HRD Act is not raised the levy.
			const outside = raise(
				'payroll_run',
				'created',
				{ period: '2026-10' },
				{
					raised: [],
					company: [{ region: '', risk_class: '', facts: { hrd_scope: 'OUT_OF_SCOPE' } }]
				}
			);
			assert.equal(outside.length, monthly.length - 1);
			for (const data of january) assert.match(String(data.due_on), /^\d{4}-\d{2}-\d{2}$/);
			const epf = january.find((data) => data.duty_code === 'EPF_MONTHLY_CONTRIBUTION');
			assert.equal(epf?.due_on, '2027-02-15');
			assert.equal(
				run('2027-01', [{ duty_code: 'EPF_MONTHLY_CONTRIBUTION' }]).length,
				january.length - 1
			);
			const range = { from: '2026-10-15', to: '2026-12-31' };
			const hire = (employee: Row[]) =>
				raise(
					'employment_contract',
					'created',
					{ effective_range: range, exit_facts: null },
					{ raised: [], company, employee }
				);
			assert.equal(
				hire(local).length,
				of('HIRE').length - 2,
				`${version} a local is raised no foreign-employee duty`
			);
			const foreign = raise(
				'employment_contract',
				'created',
				{
					effective_range: range,
					exit_facts: null,
					facts: { contract_terms: [{ residency_status: 'FOREIGNER' }] }
				},
				{ raised: [], company, employee: local }
			);
			assert.equal(foreign.length, of('HIRE').length);
			assert.ok(hire(local).every((data) => data.triggered_on === '2026-10-15'));
			// Under twelve months' service a retrenchment raises Borang PK and the final wages only.
			const exits = raise(
				'employment_contract',
				'updated',
				{ effective_range: range, exit_ground: 'RETRENCHMENT', exit_facts: {} },
				{ raised: [], company, employee: local }
			);
			assert.deepEqual(exits.map((data) => String(data.duty_code)).toSorted(), [
				'RETRENCHMENT_NOTIFICATION',
				'TERMINATION_BENEFITS_FINAL_WAGES'
			]);
			assert.ok(exits.every((data) => data.triggered_on === '2026-12-31'));
		}
	});

	it('behaviours admit payroll, pin settled entries and encash EA s.60E leave on exit', () => {
		for (const version of versions) {
			const behaviours = behavioursOf(settingsOf(version).behaviours);
			assert.ok(behaviours, `${version} behaviours`);
			for (const rule of behaviours.rules)
				for (const read of Object.values(rule.reads ?? {}))
					assert.doesNotThrow(() =>
						resolveWhere(read.where, {
							event: {
								row: { id: 'c1', company_id: 'co1', employee_id: 'p1', period: '2026-02' },
								settings_id: 's1',
								day: '2026-02-01',
								company_id: 'co1',
								employment_id: 'c1',
								employee_id: 'p1'
							}
						})
					);
			const planned = planBehaviours(
				behaviours,
				{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
				{ event: { data: { request: { kind: 'OFF_CYCLE', period: '2026-02' } } } }
			);
			assert.ok(planned.some((rule) => rule.id === 'payroll-run'));
			const pin = behaviours.rules.find((rule) => rule.id === 'pin-settled-entries');
			assert.ok(pin);
			const pins = effectWrites(pin, {
				event: {
					row: {
						id: 'r1',
						approval_id: null,
						pins: [{ collection: 'leave_catalog_entry', id: 'e1', employment_id: 'c1' }]
					}
				},
				slips: [{ id: 'p1', employment_id: 'c1' }]
			});
			assert.deepEqual(
				pins.map((write) => write.callable),
				['leave_catalog_entry.update']
			);
			const encash = behaviours.rules.find((rule) => rule.id === 'encash-leave-on-exit');
			assert.ok(encash);
			const annual = byCode(version, 'leave_catalog', 'ANNUAL_LEAVE');
			const context = {
				event: {
					settings_id: settingsOf(version).id,
					row: {
						id: 'c1',
						approval_id: null,
						prior_service_months: null,
						exit_facts: {},
						effective_range: { from: '2023-01-01', to: '2026-02-28' }
					}
				},
				catalogues: [
					{ id: annual.id, code: 'ANNUAL_LEAVE', unit: 'DAY', entitlement: annual.entitlement }
				],
				movements: [
					{
						catalog_id: annual.id,
						activity: 'TIME_OFF',
						days: 12,
						from: '2025-06-02',
						occurred_on: '2025-06-02',
						reference: 'y'
					},
					{
						catalog_id: annual.id,
						activity: 'TIME_OFF',
						days: 3,
						from: '2026-01-12',
						occurred_on: '2026-01-12',
						reference: 'x'
					}
				]
			};
			// 37 completed months: s.60E(1) 12 days for the fourth service year (from 1 January 2026), less 3 taken;
			// the third year's 12 were all taken, so nothing carries in.
			const writes = effectWrites(encash, withBalances(context));
			assert.equal(writes.length, 1);
			assert.equal((writes[0]!.data as { days: number }).days, 9);
			// 5 completed months: 8 × 5 / 12 = 3.33, a fraction under a half disregarded → 3 days.
			const short = effectWrites(
				encash,
				withBalances({
					...context,
					event: {
						...context.event,
						row: { ...context.event.row, effective_range: { from: '2025-09-01', to: '2026-02-28' } }
					},
					movements: []
				})
			);
			assert.equal((short[0]!.data as { days: number }).days, 3);
			// Unused days of the previous service year carry in once (EA s.60E(2)): 12 − 4 of the third year, plus 12.
			const carried = effectWrites(
				encash,
				withBalances({
					...context,
					movements: [{ ...context.movements[0]!, days: 4 }]
				})
			);
			assert.equal((carried[0]!.data as { days: number }).days, 20);
			// EA s.60E(3A) proviso: no payment for untaken leave on a s.14(1)(a) misconduct dismissal.
			const dismissed = {
				event: {
					...context.event,
					row: { ...context.event.row, exit_facts: { misconduct_dismissal: true } }
				}
			};
			assert.equal(
				planBehaviours(
					behaviours,
					{ kind: 'row', collection: 'employment_contract', event: 'updated' },
					dismissed
				).includes(encash),
				false
			);
			assert.equal(
				planBehaviours(
					behaviours,
					{ kind: 'row', collection: 'employment_contract', event: 'updated' },
					{ event: context.event }
				).includes(encash),
				true
			);
		}
	});

	it('EPF Third Schedule Parts A, E and F charge the printed bands', () => {
		const citizen = { age: 40, residency_status: 'CITIZEN' };
		// Nihon salary listing Jan/Feb 2026: EPF wage 3,395.34 → 374/442; 3,451 → 381/450.
		assert.deepEqual(
			statutory(at('2026-01-15'), 'EPF', 3395.34, { ...citizen, day: '2026-01-15' }),
			{
				employee: 374,
				employer: 442
			}
		);
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 3451, citizen), {
			employee: 381,
			employer: 450
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 5000, citizen), {
			employee: 550,
			employer: 650
		});
		// Above RM5,000 the employer rate is 12%, on the RM100 band.
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 6050, citizen), {
			employee: 671,
			employer: 732
		});
		// Above RM20,000: exact percentages, only the total rounded up (KWSP example 2.1: RM21,250 → 2,550 + 2,337.50 = 4,888).
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 21250, citizen), {
			employee: 2337.5,
			employer: 2550.5
		});
		// NHPMY0193 RM23,019: 2,532.09 + 2,762.28 = 5,294.37 → 5,295 (the listing's 2,533 / 2,763 over-remits RM1).
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 23019, citizen), {
			employee: 2532.09,
			employer: 2762.91
		});
		// Part C above RM20,000 (KWSP example 2.3: RM21,250 → 1,275 + 1,168.75 = 2,444); Part E 4% only (example 2.2).
		assert.deepEqual(
			statutory(at('2026-02-15'), 'EPF_PR', 21250, {
				age: 62,
				residency_status: 'PERMANENT_RESIDENT'
			}),
			{ employee: 1168.75, employer: 1275.25 }
		);
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 21250, { age: 65 }), {
			employee: 0,
			employer: 850
		});
		// A domestic servant contributes only after giving notice (First Schedule (2)–(3)); a non-citizen one never.
		const domestic = { terms: { employment_type: 'DOMESTIC' } };
		assert.equal(statutory(at('2026-02-15'), 'EPF', 3000, domestic), null);
		assert.deepEqual(
			statutory(at('2026-02-15'), 'EPF', 3000, {
				...domestic,
				all_elections: { EPF: { domestic_servant_notice_given: true } }
			}),
			{ employee: 330, employer: 390 }
		);
		// A non-citizen who elected before 1 August 1998 stays on Part A below 60 and Part C from 60.
		const elector = {
			residency_status: 'FOREIGNER',
			all_elections: { EPF: { elected_before_1998: true } }
		};
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 3000, elector), {
			employee: 330,
			employer: 390
		});
		assert.equal(statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 3000, elector), null);
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF_PR', 3000, { ...elector, age: 62 }), {
			employee: 165,
			employer: 195
		});
		// Part E, a citizen of 69 (listing NHPMY0360, RM12,556): employer 4% only.
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 12556, { age: 69 }), {
			employee: 0,
			employer: 504
		});
		// A permanent resident of 60+ is Part C under EPF_PR alone.
		const pr = { age: 62, residency_status: 'PERMANENT_RESIDENT' };
		assert.equal(statutory(at('2026-02-15'), 'EPF', 3000, pr), null);
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF_PR', 3000, pr), {
			employee: 165,
			employer: 195
		});
		// Part F (Act A1760): 2% each, only the total rounded up (KWSP example 2.4: RM6,710 → 134.20 + 134.20 = 269);
		// the Nihon listing's RM1,954 → 40 / 40 rounds each share and over-remits RM1.
		const foreigner = { age: 30, residency_status: 'FOREIGNER' };
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 6710, foreigner), {
			employee: 134.2,
			employer: 134.8
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 1751, foreigner), {
			employee: 35.02,
			employer: 35.98
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 1954, foreigner), {
			employee: 39.08,
			employer: 39.92
		});
		// Not liable: a domestic worker, a lapsed work pass, a Board-approved other scheme.
		for (const input of [
			{ ...foreigner, terms: { employment_type: 'DOMESTIC' } },
			{ ...foreigner, terms: { facts: { work_pass_valid_until: '2026-01-31' } } },
			{ ...foreigner, elections: { board_approved_other_scheme: true } }
		])
			assert.equal(statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 3000, input), null);
		assert.deepEqual(
			statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 3000, {
				...foreigner,
				terms: { facts: { work_pass_valid_until: '2026-12-31' } }
			}),
			{ employee: 60, employer: 60 }
		);
		// A lapsed pass also leaves the SOCSO invalidity scheme: Second Category (Act 4 First Schedule para 12A).
		assert.deepEqual(
			statutory(at('2026-02-15'), 'SOCSO', 3000, {
				...foreigner,
				terms: { facts: { work_pass_valid_until: '2026-01-31' } }
			}),
			{ employee: 0, employer: 36.9 }
		);
		assert.equal(
			statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 1751, { ...foreigner, age: 75 }),
			null
		);
	});

	it('SOCSO, EIS and HRD levy match the Nihon salary listings and the HRD registration class', () => {
		assert.deepEqual(statutory(at('2026-01-15'), 'SOCSO', 3760.78, { day: '2026-01-15' }), {
			employee: 18.75,
			employer: 65.65
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'SOCSO', 3830.49), {
			employee: 19.25,
			employer: 67.35
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'SOCSO', 10000), {
			employee: 29.75,
			employer: 104.15
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'SOCSO', 12556, { age: 69 }), {
			employee: 0,
			employer: 74.4
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'EIS', 3830.49), { employee: 7.7, employer: 7.7 });
		assert.deepEqual(statutory(at('2026-02-15'), 'EIS', 9000), { employee: 11.9, employer: 11.9 });
		const foreigner = { age: 30, residency_status: 'FOREIGNER' };
		assert.equal(statutory(at('2026-02-15'), 'EIS', 3000, foreigner), null);
		for (const version of versions) {
			// Foreign workers: First Category since 1 July 2024 (listing NHPMY0310, SOCSO wage RM1,855.31 → 9.25 / 32.35).
			assert.deepEqual(statutory(version, 'SOCSO', 1855.31, foreigner), {
				employee: 9.25,
				employer: 32.35
			});
			assert.deepEqual(statutory(version, 'SOCSO', 1855.31, { ...foreigner, age: 61 }), {
				employee: 0,
				employer: 23.1
			});
			// Second Category: first insured at 55 or more, or receiving an invalidity pension (Act 4 First Schedule 12).
			assert.deepEqual(
				statutory(version, 'SOCSO', 3000, {
					age: 56,
					elections: { first_insured_at_55_or_more: true }
				}),
				{ employee: 0, employer: 36.9 }
			);
			assert.deepEqual(statutory(version, 'SOCSO', 3000, { age: 56 }), {
				employee: 14.75,
				employer: 51.65
			});
			assert.deepEqual(
				statutory(version, 'SOCSO', 3000, { employee: { receiving_pension: true } }),
				{ employee: 0, employer: 36.9 }
			);
			// Act A1788 Part IV / A4T: the 1.25% column rounds half to even — RM200.01–300 → 3.10, RM300.01–400 → 4.40.
			for (const [wage, employer] of [
				[250, 3.1],
				[350, 4.4],
				[450, 5.6],
				[5950, 74.4]
			] as const)
				assert.deepEqual(
					statutory(version, 'SOCSO', wage, { age: 65 }),
					{ employee: 0, employer },
					`${wage}`
				);
			// Wages up to RM200: the printed rows of the Third Schedule and the Act 800 Second Schedule.
			for (const [wage, ee, er, er2, eis] of [
				[25, 0.1, 0.4, 0.3, 0.05],
				[45, 0.2, 0.7, 0.5, 0.1],
				[150, 0.85, 2.95, 2.1, 0.35],
				[200, 0.85, 2.95, 2.1, 0.35]
			] as const) {
				assert.deepEqual(
					statutory(version, 'SOCSO', wage),
					{ employee: ee, employer: er },
					`${version} ${wage}`
				);
				assert.deepEqual(statutory(version, 'SOCSO', wage, { age: 65 }), {
					employee: 0,
					employer: er2
				});
				assert.deepEqual(statutory(version, 'EIS', wage), { employee: eis, employer: eis });
			}
			// EIS from 57 only where a contribution was payable before 57 (Act 800 First Schedule para 9).
			assert.equal(
				statutory(version, 'EIS', 3000, {
					age: 57,
					elections: { first_insured_at_57_or_more: true }
				}),
				null
			);
			assert.deepEqual(statutory(version, 'EIS', 3000, { age: 57 }), {
				employee: 5.9,
				employer: 5.9
			});
			// The 2026 HRD levy exemption for scheduled education employers.
			const school = {
				company: { hrd_registration_class: 'COMPULSORY', hrd_education_schedule_code: '85212' }
			};
			const range = settingsOf(version).effective_range as { from: string; to: string | null };
			const in2026 = range.from <= '2026-12-31' && (range.to ?? '9999') >= '2026-01-01';
			const day = in2026 ? (range.from < '2026-01-01' ? '2026-01-15' : range.from) : range.from;
			assert.deepEqual(
				statutory(version, 'HRDF', 3451, { ...school, day }),
				day.startsWith('2026') ? null : { employee: 0, employer: 34.51 },
				version
			);
		}
		for (const version of versions) {
			// Unrecorded class is compulsory: 1% of a citizen's wages (listing NHPMY0053: 3,451 → 34.51).
			assert.deepEqual(statutory(version, 'HRDF', 3451), { employee: 0, employer: 34.51 }, version);
			assert.deepEqual(
				statutory(version, 'HRDF', 3451, { company: { hrd_registration_class: 'COMPULSORY' } }),
				{ employee: 0, employer: 34.51 }
			);
			assert.deepEqual(
				statutory(version, 'HRDF', 3451, { company: { hrd_registration_class: 'OPTIONAL' } }),
				{ employee: 0, employer: 17.26 }
			);
			assert.equal(
				statutory(version, 'HRDF', 3451, { company: { hrd_registration_class: 'NOT_REGISTERED' } }),
				null
			);
			assert.equal(
				statutory(version, 'HRDF', 3451, {
					company: { hrd_scope: 'OUT_OF_SCOPE', hrd_registration_class: 'COMPULSORY' }
				}),
				null
			);
			assert.equal(statutory(version, 'HRDF', 3451, foreigner), null);
			// Act 612 s.2: domestic servants and part-time wages are outside the levy.
			for (const employment_type of ['DOMESTIC', 'PART_TIME'])
				assert.equal(statutory(version, 'HRDF', 3451, { terms: { employment_type } }), null);
			assert.equal(
				statutory(version, 'HRDF', 3451, { residency_status: 'PERMANENT_RESIDENT' }),
				null
			);
		}
	});

	it('MTD: non-resident 30%; resident Specification 2026 D year to date with EPF relief, reliefs, rebates and additional remuneration', () => {
		for (const version of versions) {
			// January: no earlier month, n = 11 — the year-to-date formula equals twelve equal months.
			const mtd = (parts: { [part: string]: number }, input: Subject = {}) =>
				statutory(version, 'PCB', pcb(parts), { day: '2026-01-15', ...input })?.employee;
			// Non-resident at 30% (listing NHPMY0363, RM10,000 → RM3,000), no reliefs.
			assert.equal(mtd({ ordinary: 10000 }, { age: 60, residency_status: 'FOREIGNER' }), 3000);
			// Single, no children, RM7,000: K1 770, K2 = min(770, 3,230 ÷ 11); P = 6,230 + 6,706.36 × 11 − 9,000 = 71,000;
			// tax 3,700 + 1,000 × 19% = 3,890 ÷ 12 = 324.166 → 324.16 → 324.20. (The Nihon listing shows 323.50: its
			// payroll software relieves SOCSO/EIS automatically, which the Specification leaves to a TP1 claim.)
			assert.equal(mtd({ ordinary: 7000 }), 324.2, version);
			// February after that January: Σ(Y − K) = 6,230, X = 324.20, n = 10 → P = 71,000 again;
			// (3,890 − 324.20) ÷ 11 = 324.163 → 324.20.
			const january = {
				year: { ordinary: 7000 },
				charged: { EPF: { employee: 770, employer: 910 }, PCB: { employee: 324.2, employer: 0 } }
			};
			assert.equal(mtd({ ordinary: 7000 }, { day: '2026-02-15', ...january }), 324.2);
			// A raise in February: K2 = min(880, (4,000 − 770 − 880) ÷ 10) = 235;
			// P = 6,230 + (8,000 − 880) + (8,000 − 235) × 10 − 9,000 = 82,000 → 3,700 + 12,000 × 19% = 5,980;
			// (5,980 − 324.20) ÷ 11 = 514.16 → 514.20.
			assert.equal(mtd({ ordinary: 8000 }, { day: '2026-02-15', ...january }), 514.2);
			// RM5,000: P = 47,000; 600 + 12,000 × 6% = 1,320 ÷ 12 = 110.00.
			assert.equal(mtd({ ordinary: 5000 }), 110);
			// RM3,900: P = 33,800; 150 + 13,800 × 3% = 564 − RM400 rebate = 164 ÷ 12 = 13.66 → 13.70.
			assert.equal(mtd({ ordinary: 3900 }), 13.7);
			// Listing NHPMY0053 (RM3,760.78 incl. RM365.44 overtime): 513.88 − 400 → 9.49 a month, under RM10.
			assert.equal(mtd({ ordinary: 3395.34, non_epf: 365.44 }), 0);
			// Overtime is PCB remuneration but not EPF wages: K is 11% of the RM3,000 basic only.
			// P = 60,000 − 3,960 − 9,000 = 47,040; 600 + 12,040 × 6% = 1,322.40 ÷ 12 = 110.20.
			assert.equal(mtd({ ordinary: 3000, non_epf: 2000 }), 110.2);
			// Married, spouse without income, two children under 18: D 9,000 + S 4,000 + 2 × 2,000.
			const spouse = { marital_status: 'MARRIED', spouse_status: 'WITHOUT_INCOME' };
			// P = 60,000 − 4,000 − 17,000 = 39,000; 600 + 4,000 × 6% = 840 ÷ 12 = 70.00 (no rebate above 35,000).
			assert.equal(
				mtd(
					{ ordinary: 5000 },
					{ employee: spouse, elections: { children_under_18_or_studying: 2 } }
				),
				70
			);
			// RM3,900 with the spouse: P = 29,800 → 444 − (400 + 400 spouse rebate) < 0 → nothing.
			assert.equal(mtd({ ordinary: 3900 }, { employee: spouse }), 0);
			// Disabled employee (RM7,000), disabled spouse (further RM6,000), half-share tertiary child (RM4,000):
			// P = 84,000 − 4,000 − (9,000 + 7,000 + 4,000 + 6,000 + 4,000) = 50,000 → 1,500 ÷ 12 = 125.00.
			assert.equal(
				mtd(
					{ ordinary: 7000 },
					{
						employee: { ...spouse, disabled: true },
						elections: { spouse_disabled: true, children_tertiary_or_disabled_half: 1 }
					}
				),
				125
			);
			// A RM7,000 bonus on RM7,000 (K already within the cap): P1 = 78,000 → 3,700 + 8,000 × 19% = 5,220;
			// additional MTD = 5,220 − 12 × 324.20 = 1,329.60; month 324.20 + 1,329.60.
			assert.equal(mtd({ ordinary: 7000, additional: 7000 }), 1653.8);
			// Payroll zakat is rebated from the month's MTD …
			assert.equal(mtd({ ordinary: 7000 }, { elections: { zakat_monthly: 100 } }), 224.2);
			// … and the earlier months' zakat counts with their MTD: February's X + Z = 224.20 + 100.
			assert.equal(
				mtd(
					{ ordinary: 7000 },
					{
						day: '2026-02-15',
						elections: { zakat_monthly: 100 },
						year: { ordinary: 7000 },
						charged: {
							EPF: { employee: 770, employer: 910 },
							PCB: { employee: 224.2, employer: 0 }
						}
					}
				),
				224.2
			);
			// A foreigner declared tax resident: scale rates with Part F EPF (2% = 140) as K.
			// P = 84,000 − 1,680 − 9,000 = 73,320 → 3,700 + 3,320 × 19% = 4,330.80 ÷ 12 = 360.90.
			assert.equal(
				mtd(
					{ ordinary: 7000 },
					{ residency_status: 'FOREIGNER', elections: { tax_residency: 'RESIDENT' } }
				),
				360.9
			);
			// TP1 deductions declared for the month (LP1 RM500, January): P = 71,000 − 500 = 70,500 →
			// 3,700 + 500 × 19% = 3,795 ÷ 12 = 316.25.
			assert.equal(mtd({ ordinary: 7000 }, { elections: { tp1_monthly_deductions: 500 } }), 316.25);
			// TP3 for a February joiner: RM7,000 earlier remuneration, RM770 EPF and RM324.20 MTD at the previous employer.
			assert.equal(
				mtd(
					{ ordinary: 7000 },
					{
						day: '2026-02-15',
						elections: { tp3_prior_remuneration: 7000, tp3_prior_epf: 770, tp3_prior_mtd: 324.2 }
					}
				),
				324.2
			);
			// REP / knowledge worker at 15% of P with the rebates; C-suite at 15% with none (Specification sections 3–5).
			// RM7,000: P = 71,000 → 10,650 ÷ 12 = 887.50 (above RM35,000, no rebate either way).
			const rep = {
				pcb_tax_profile: 'REP',
				pcb_approval_first_year: 2024,
				pcb_approval_last_year: 2028
			};
			assert.equal(mtd({ ordinary: 7000 }, { elections: rep }), 887.5);
			assert.equal(
				mtd({ ordinary: 7000 }, { elections: { ...rep, pcb_approval_last_year: 2025 } }),
				324.2
			);
			assert.equal(
				mtd({ ordinary: 7000 }, { elections: { ...rep, pcb_tax_profile: 'C_SUITE' } }),
				887.5
			);
			// P = 3,000 × 12 − 3,960 − 9,000 = 23,040: REP 3,456 − 400 = 3,056 ÷ 12 = 254.67 → 254.70; C-suite no rebate 288.
			assert.equal(mtd({ ordinary: 3000 }, { elections: rep }), 254.7);
			assert.equal(
				mtd({ ordinary: 3000 }, { elections: { ...rep, pcb_tax_profile: 'C_SUITE' } }),
				288
			);
			// A citizen declared non-resident pays 30%.
			assert.equal(mtd({ ordinary: 7000 }, { elections: { tax_residency: 'NON_RESIDENT' } }), 2100);
		}
	});

	it('SKBBK is an employee contribution from 1 June 2026, phased 0.75% / 1.00% / 1.25%, voluntary for locals from 8 July 2026', () => {
		for (const day of ['2025-12-15', '2026-05-31'])
			assert.equal(
				rows(at(day), 'statutory_contribution_catalog').some((row) => row.code === 'SKBBK'),
				false
			);
		for (const [day, top] of [
			['2026-06-01', 44.65],
			['2026-07-08', 44.65],
			['2028-06-01', 59.5],
			['2031-06-01', 74.4]
		] as const)
			for (const residency_status of ['CITIZEN', 'FOREIGNER'])
				assert.deepEqual(
					statutory(at(day), 'SKBBK', 6000, { age: 30, residency_status, day }),
					{ employee: top, employer: 0 },
					day
				);
		// An accepted release (a RELEASED SKBBK standing) stops a citizen's or permanent resident's contribution; a
		// FOREIGNER stays levied.
		// Act A1788 Parts I–III, RM200.01–300 / RM400.01–500 and up to RM30: 1.85 / 3.35 / 0.20, 2.50 / 4.50 / 0.25,
		// 3.10 / 5.60 / 0.30.
		for (const [day, rows3] of [
			[
				'2026-06-15',
				[
					[250, 1.85],
					[450, 3.35],
					[25, 0.2]
				]
			],
			[
				'2028-06-15',
				[
					[250, 2.5],
					[450, 4.5],
					[25, 0.25]
				]
			],
			[
				'2031-06-15',
				[
					[250, 3.1],
					[450, 5.6],
					[25, 0.3]
				]
			]
		] as const)
			for (const [wage, employee] of rows3)
				assert.deepEqual(
					statutory(at(day), 'SKBBK', wage, { day }),
					{ employee, employer: 0 },
					`${day} ${wage}`
				);
		// Only the employer the employee designated deducts SKBBK (PERKESO FAQ Q21).
		assert.equal(
			statutory(at('2026-09-15'), 'SKBBK', 6000, {
				day: '2026-09-15',
				elections: { designated_employer: false }
			}),
			null
		);
		assert.deepEqual(
			statutory(at('2026-09-15'), 'SKBBK', 6000, {
				day: '2026-09-15',
				elections: { designated_employer: true }
			}),
			{ employee: 44.65, employer: 0 }
		);
		const released = { standing: 'RELEASED' };
		assert.equal(
			statutory(at('2026-09-15'), 'SKBBK', 6000, { day: '2026-09-15', ...released }),
			null
		);
		assert.equal(
			statutory(at('2026-09-15'), 'SKBBK', 6000, {
				residency_status: 'PERMANENT_RESIDENT',
				day: '2026-09-15',
				...released
			}),
			null
		);
		assert.deepEqual(
			statutory(at('2026-09-15'), 'SKBBK', 6000, { day: '2026-09-15', standing: 'REGISTERED' }),
			{ employee: 44.65, employer: 0 }
		);
		assert.deepEqual(
			statutory(at('2026-09-15'), 'SKBBK', 6000, {
				residency_status: 'FOREIGNER',
				day: '2026-09-15',
				...released
			}),
			{ employee: 44.65, employer: 0 }
		);
	});

	it('÷26 for the ordinary rate (EA s.60I) and calendar days for no-pay leave and part months (EA s.18A)', () => {
		for (const version of versions) {
			// February: 28 calendar days.
			const context = payslipContext();
			assert.equal(line(version, 'BASIC', context), 3000);
			// Part month: the days employed × monthly ÷ the days of the month (s.18A(a)–(b)).
			const part = { ...context, period: { ...context.period, paid_days: 10, covered_days: 10 } };
			assert.equal(line(version, 'BASIC', part), round2((3000 / 28) * 10));
			// No-pay leave: monthly ÷ the days of the month (s.18A(c)); listing NHPMY0045 Jan 2026, 1.5 days of RM2,622 → 126.87.
			assert.equal(line(version, 'NO_PAY_LEAVE', context), round2((3000 / 28) * 2));
			const january = payslipContext(
				{ terms: { base_salary: 2622 } },
				{
					period: {
						...context.period,
						key: '2026-01',
						from: '2026-01-01',
						to: '2026-01-31',
						days: 31,
						paid_days: 31
					},
					leave: { rows: [leaveRow({ code: 'UNPAID_LEAVE', days: 1.5, is_npl: true })] }
				}
			);
			assert.equal(line(version, 'NO_PAY_LEAVE', january), 126.87);
			// No-pay days never take more than the days employed.
			const absent = {
				...context,
				leave: { rows: [leaveRow({ code: 'UNPAID_LEAVE', days: 31, is_npl: true })] }
			};
			assert.equal(line(version, 'NO_PAY_LEAVE', absent), 3000);
			// Encashment, overtime and holiday work price the ordinary rate of pay: monthly ÷ 26 (s.60I(1A)).
			assert.equal(line(version, 'ENCASHMENT', context), round2(3000 / 26));
			// Normal-day overtime 1.5 × monthly ÷ 26 ÷ normal daily hours (s.60A(3), s.60I(1)(b)); unrecorded hours are 8.
			assert.equal(line(version, 'OVERTIME', context), round2(10 * 1.5 * (3000 / 26 / 8)));
			const shorter = payslipContext({ company: { normal_daily_hours: 7.5 } });
			assert.equal(line(version, 'OVERTIME', shorter), round2(10 * 1.5 * (3000 / 26 / 7.5)));
			const days = (list: Row[]) => payslipContext({}, { work: { ...context.work, days: list } });
			const capped = days([workDay('2026-02-03', { overtime_hours: 110 })]);
			assert.equal(line(version, 'OVERTIME', capped), round2(104 * 1.5 * (3000 / 26 / 8)));
			assert.equal(line(version, 'INCENTIVE', capped), round2(6 * 1.5 * (3000 / 26 / 8)));
			// Rest days (s.60(3)): up to half the normal hours → half a day's wages, more → a day's; beyond → 2× hourly.
			const rest = days([
				workDay('2026-02-07', { day_type: 'REST', scheduled_hours: 0, worked_hours: 4 }),
				workDay('2026-02-08', {
					day_type: 'REST',
					scheduled_hours: 0,
					worked_hours: 11,
					overtime_hours: 3
				})
			]);
			assert.equal(line(version, 'OVERTIME', rest), 0);
			assert.equal(line(version, 'REST_DAY_WORK', rest), round2((3000 / 26) * 1.5));
			assert.equal(line(version, 'REST_DAY_OVERTIME', rest), round2(3 * 2 * (3000 / 26 / 8)));
			// Public-holiday overtime beyond the normal hours at 3× hourly (s.60D(3)(a)(ii)).
			const holiday = days([
				workDay('2026-02-10', {
					holiday_kind: 'PUBLIC_HOLIDAY',
					worked_hours: 10,
					overtime_hours: 2
				})
			]);
			assert.equal(line(version, 'HOLIDAY_OVERTIME', holiday), round2(2 * 3 * (3000 / 26 / 8)));
			assert.equal(line(version, 'OVERTIME', holiday), 0);
			for (const code of ['REST_DAY_OVERTIME', 'HOLIDAY_OVERTIME']) {
				const counts = byCode(version, 'work_catalog', code).counts_toward as string[];
				assert.equal(
					counts.some((target) => target.startsWith('EPF') || target === 'HRDF'),
					false,
					code
				);
			}
			// Two public holidays worked within normal hours: two days' wages each (s.60D(3)(a)(i)).
			const holidays = payslipContext(
				{},
				{
					work: {
						...context.work,
						dates: ['2026-02-10', '2026-02-12'],
						holidays: ['2026-02-10', '2026-02-12'].map((date) => ({
							date,
							kind: 'PUBLIC_HOLIDAY',
							given_to: 'EVERYONE',
							replaces: ''
						}))
					}
				}
			);
			assert.equal(line(version, 'HOLIDAY_WORK', holidays), round2((3000 / 26) * 2 * 2));
			// A fixed allowance is part of the monthly wages and prorates by calendar days with the salary.
			for (const row of rows(version, 'allowance_catalog'))
				assert.equal(
					evaluateConfigured(String(row.amount), { ...part, allowance: { amount: 280 } }),
					100,
					`${version} ${String(row.code)}`
				);
		}
	});

	it('a CP38 instalment is a net deduction outside every scheme, so it never enters accumulated MTD', () => {
		for (const version of versions) {
			const row = byCode(version, 'adhoc_catalog', 'CP38_INSTALMENT');
			assert.deepEqual(
				[row.destination, row.direction, row.counts_toward],
				['NET', 'SUBTRACT', []]
			);
		}
	});

	it('overtime and other non-EPF pay is PCB remuneration outside the EPF and HRD wage', () => {
		for (const version of versions) {
			for (const code of ['OVERTIME', 'INCENTIVE']) {
				const counts = byCode(version, 'work_catalog', code).counts_toward as string[];
				for (const scheme of ['EPF', 'EPF_PR', 'EPF_NON_CITIZEN', 'HRDF'])
					assert.equal(counts.includes(scheme), false);
				assert.ok(counts.includes('SOCSO') && counts.includes('PCB.NON_EPF'));
			}
			for (const table of ['work_catalog', 'adhoc_catalog', 'allowance_catalog'] as const)
				for (const row of rows(version, table)) {
					const counts = (row.counts_toward ?? []) as string[];
					const epf = counts.some((target) => target.startsWith('EPF'));
					const where = `${version} ${table} ${String(row.code)}`;
					for (const target of counts.filter((item) => item.startsWith('PCB')))
						assert.ok(
							epf
								? ['PCB', 'PCB.ORDINARY', 'PCB.ADDITIONAL'].includes(target)
								: ['PCB.NON_EPF', 'PCB.ADDITIONAL_NON_EPF'].includes(target),
							`${where} ${target}`
						);
				}
		}
	});

	it('leave classes read the person: maternity by surviving children, paternity by gender and marriage', () => {
		const eligible = (version: string, code: string, context: object) =>
			evaluateConfigured(String(byCode(version, 'leave_catalog', code).eligibility), context);
		const born = (dates: string[]) =>
			dates.map((child_birthdate) => ({ child_birthdate, relationship: 'CHILD' }));
		for (const version of versions) {
			const mother = (children: object[], facts: Row = {}) =>
				admitContext(
					{ event_kind: 'BIRTH', ...facts },
					{ employee: { gender: 'FEMALE', children } }
				);
			const two = mother(born(['2019-03-01', '2022-07-01']));
			assert.equal(eligible(version, 'MATERNITY_LEAVE', two), true);
			assert.equal(eligible(version, 'MATERNITY_LEAVE_NO_ALLOWANCE', two), false);
			// Five surviving natural children at confinement: the leave, no allowance (EA s.37(1)(c)).
			const five = mother(
				born(['2012-01-01', '2014-01-01', '2016-01-01', '2018-01-01', '2020-01-01'])
			);
			assert.equal(eligible(version, 'MATERNITY_LEAVE', five), false);
			assert.equal(eligible(version, 'MATERNITY_LEAVE_NO_ALLOWANCE', five), true);
			// A child who died before confinement, an adopted child and the newborn do not count.
			const counted = mother([
				...born(['2012-01-01', '2014-01-01', '2016-01-01', '2026-02-10']),
				{ child_birthdate: '2018-01-01', relationship: 'CHILD', child_deathdate: '2019-01-01' },
				{ child_birthdate: '2018-06-01', relationship: 'ADOPTED' }
			]);
			assert.equal(eligible(version, 'MATERNITY_LEAVE', counted), true);
			// Fewer than 90 days' service in the nine months before confinement: no allowance (s.37(2)(a)).
			assert.equal(
				eligible(version, 'MATERNITY_LEAVE', mother([], { qualifying_service_days: 60 })),
				false
			);
			assert.equal(
				eligible(
					version,
					'MATERNITY_LEAVE_NO_ALLOWANCE',
					mother([], { qualifying_service_days: 60 })
				),
				true
			);
			assert.equal(byCode(version, 'leave_catalog', 'MATERNITY_LEAVE_NO_ALLOWANCE').is_npl, true);
			const man = admitContext(
				{ event_kind: 'BIRTH' },
				{ employee: { gender: 'MALE', marital_status: 'MARRIED' } }
			);
			assert.equal(eligible(version, 'MATERNITY_LEAVE', man), false);
			assert.equal(eligible(version, 'MATERNITY_LEAVE_NO_ALLOWANCE', man), false);
			// Paternity: a married man with twelve months' service, seven days a confinement, five confinements.
			const father = (employee: Row, days: number, service_months = 30) =>
				admitContext({ event_kind: 'BIRTH' }, { employee, service_months }, { days });
			assert.equal(
				eligible(
					version,
					'PATERNITY_LEAVE',
					father({ gender: 'MALE', marital_status: 'MARRIED' }, 7)
				),
				true
			);
			assert.equal(
				eligible(
					version,
					'PATERNITY_LEAVE',
					father({ gender: 'MALE', marital_status: 'SINGLE' }, 7)
				),
				false
			);
			assert.equal(
				eligible(
					version,
					'PATERNITY_LEAVE',
					father({ gender: 'FEMALE', marital_status: 'MARRIED' }, 7)
				),
				false
			);
			assert.equal(
				eligible(
					version,
					'PATERNITY_LEAVE',
					father({ gender: 'MALE', marital_status: 'MARRIED' }, 7, 11)
				),
				false
			);
			const paternity = byCode(version, 'leave_catalog', 'PATERNITY_LEAVE');
			// Seven days a confinement (window EVENT), five confinements: 35 days over the employment.
			assert.equal((paternity.entitlement as Row).window, 'EVENT');
			assert.equal(entitled(paternity, 30), 7);
			assert.equal(entitled(paternity, 30, { lifetime: 28, event: 0 }), 7);
			assert.equal(entitled(paternity, 30, { lifetime: 31, event: 3 }), 7);
			assert.equal(entitled(paternity, 30, { lifetime: 35, event: 0 }), 0);
			// Maternity: 98 days per confinement; sick 14 / 18 / 22 and hospitalisation 60 in each calendar year.
			for (const code of ['MATERNITY_LEAVE', 'MATERNITY_LEAVE_NO_ALLOWANCE']) {
				const row = byCode(version, 'leave_catalog', code);
				assert.equal((row.entitlement as Row).window, 'EVENT');
				assert.equal(entitled(row, 30), 98);
			}
			const sick = byCode(version, 'leave_catalog', 'MEDICAL_LEAVE');
			assert.equal((sick.entitlement as Row).window, 'CALENDAR_YEAR');
			assert.deepEqual(
				[6, 24, 59, 60].map((months) => entitled(sick, months)),
				[14, 18, 18, 22]
			);
			assert.deepEqual(
				[6, 24, 60].map((months) =>
					entitled(sick, months, {}, { terms: { employment_type: 'PART_TIME' } })
				),
				[10, 13, 15]
			);
			const hospital = byCode(version, 'leave_catalog', 'HOSPITALIZATION_LEAVE');
			assert.equal((hospital.entitlement as Row).window, 'CALENDAR_YEAR');
			assert.equal(entitled(hospital, 6), 60);
			assert.equal(paternity.can_encash, false);
			// Court or custody absence is unpaid (EA s.23); attendance as the employer's witness is not this class.
			const court = byCode(version, 'leave_catalog', 'COURT_CUSTODY_ABSENCE');
			assert.equal(court.is_npl, true);
			assert.equal(
				eligible(version, 'COURT_CUSTODY_ABSENCE', admitContext({ absence_ground: 'CUSTODY' })),
				true
			);
			assert.equal(
				eligible(
					version,
					'COURT_CUSTODY_ABSENCE',
					admitContext({ absence_ground: 'EMPLOYER_WITNESS' })
				),
				false
			);
			// No MY leave class is partly paid: unpaid classes are is_npl, the rest are full pay.
			for (const row of rows(version, 'leave_catalog'))
				assert.equal(row.pay_fraction ?? '', '', `${version} ${String(row.code)}`);
		}
	});

	it('annual leave carries the EA s.60E(1) 8/12/16-day bands per service year, carrying one year once', () => {
		for (const version of versions) {
			const annual = byCode(version, 'leave_catalog', 'ANNUAL_LEAVE');
			const entitlement = annual.entitlement as Row;
			assert.equal(entitlement.window, 'SERVICE_YEAR');
			assert.equal(entitlement.carry_forward, entitlement.days);
			assert.deepEqual(
				[5, 12, 24, 59, 60].map((months) => entitled(annual, months)),
				[3, 8, 12, 12, 16]
			);
			// Part-time (Employment (Part-Time Employees) Regulations 2010 reg.7(1)): 6 / 8 / 11 days.
			assert.deepEqual(
				[6, 12, 24, 60].map((months) =>
					entitled(annual, months, {}, { terms: { employment_type: 'PART_TIME' } })
				),
				[3, 6, 8, 11]
			);
		}
	});
});

describe('MY engine runs', () => {
	const COMPANY = 'my-co-1';
	const LAW = [
		'jurisdiction_settings',
		'rule_set',
		'statutory_contribution_catalog',
		'work_catalog',
		'allowance_catalog',
		'adhoc_catalog',
		'claim_catalog',
		'leave_catalog',
		'loan_catalog'
	] as const;
	const people = [
		{
			id: 'p1',
			name: 'Aminah',
			date_of_birth: '1986-03-02',
			gender: 'FEMALE',
			salary: 7000,
			residency: 'CITIZEN'
		},
		{
			id: 'p2',
			name: 'Ram',
			date_of_birth: '1994-07-19',
			gender: 'MALE',
			salary: 3000,
			residency: 'FOREIGNER'
		}
	];
	let tables: Map<string, Row[]>;
	const reset = () => {
		tables = new Map<string, Row[]>([
			...LAW.map(
				(name) =>
					[
						name,
						versions
							.flatMap((version) => rows(version, name))
							.map((row) => ({ approval_id: null, ...row }))
					] as [string, Row[]]
			),
			[
				'entity',
				[
					{
						id: COMPANY,
						name: 'Nihon',
						settings_code: 'MY',
						pay_frequency: 'MONTHLY',
						approval_id: null,
						facts: { hrd_scope: 'PART_I', hrd_registration_class: 'COMPULSORY' }
					}
				]
			],
			[
				'employment_profile',
				people.map(({ salary: _s, residency: _r, ...person }) => ({
					...person,
					marital_status: 'SINGLE',
					spouse_status: 'NONE',
					children: [],
					facts: {}
				}))
			],
			[
				'employment_contract',
				people.map((person) => ({
					id: `k-${person.id}`,
					employee_id: person.id,
					company_id: COMPANY,
					approval_id: null,
					effective_range: { from: '2020-01-01', to: null },
					facts: {
						contract_terms: [
							{
								base_salary: { value: person.salary, currency: 'MYR' },
								effective_range: { from: '2020-01-01', to: null },
								residency_status: person.residency,
								work_classification: 'EA_COVERED',
								statutory_work_category: 'NON_MANUAL',
								employment_type: 'PERMANENT',
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
				'payroll_run',
				'shift_definition',
				'shift_pattern'
			].map((name) => [name, []] as [string, Row[]])
		]);
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
			const { where = {}, select } = query as { where?: Row; select?: Row };
			if (select == null)
				throw new Error(`fixture reader: ${String(collection)} read without select`);
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
				...(sources == null ? {} : { sources })
			}).pipe(Effect.provideService(Reads, reads))
		);
		const id = `run-${++runs}`;
		tables.get('payroll_run')!.push({ ...plan.run, id });
		for (const slip of plan.payslips) {
			const slipId = `${id}-${slip.employment_id}`;
			tables.get('payslip')!.push({ ...slip, id: slipId, payroll_run_id: id });
			for (const pin of slip.pins) {
				const row = tables.get(pin.collection)!.find((candidate) => candidate.id === pin.id)!;
				row.payslip_id = slipId;
			}
		}
		return plan;
	};
	type Plan = Awaited<ReturnType<typeof run>>;
	const bonus = () =>
		tables.get('adhoc_catalog_entry')!.push({
			id: 'bonus-1',
			employment_id: 'k-p1',
			company_id: COMPANY,
			catalog_id: byCode(at('2026-02-15'), 'adhoc_catalog', 'BONUS').id,
			approval_id: null,
			payslip_id: null,
			occurred_on: '2026-02-05',
			amount: 7000
		});
	const totals = (plans: Plan[]) => {
		const out: { [key: string]: number } = {};
		for (const slip of plans.flatMap((plan) => plan.payslips))
			for (const line of slip.statutory) {
				out[`${line.scheme_code}.employee`] = round2(
					(out[`${line.scheme_code}.employee`] ?? 0) + line.employee_amount
				);
				out[`${line.scheme_code}.employer`] = round2(
					(out[`${line.scheme_code}.employer`] ?? 0) + line.employer_amount
				);
			}
		return out;
	};

	it('a REGULAR February run prices basic, EPF, SOCSO, EIS, MTD and the HRD levy from the records', async () => {
		reset();
		const plan = await run('2026-02', 'REGULAR');
		const slip = (id: string) => plan.payslips.find((row) => row.employment_id === `k-${id}`)!;
		const line = (id: string, code: string) =>
			slip(id).statutory.find((row) => row.scheme_code === code);
		assert.equal(slip('p1').gross, 7000);
		assert.deepEqual(
			[line('p1', 'EPF')?.employee_amount, line('p1', 'EPF')?.employer_amount],
			[770, 840]
		);
		assert.deepEqual(
			[line('p1', 'SOCSO')?.employee_amount, line('p1', 'SOCSO')?.employer_amount],
			[29.75, 104.15]
		);
		assert.equal(line('p1', 'HRDF')?.employer_amount, 70);
		// February with no January slip: n = 10, P = 6,230 + (7,000 − 323) × 10 − 9,000 = 64,000 → 3,040 ÷ 11.
		assert.equal(line('p1', 'PCB')?.employee_amount, 276.4);
		// The foreign worker: Part F 2% each way, SOCSO First Category, no EIS or HRD levy.
		assert.deepEqual(
			[
				line('p2', 'EPF_NON_CITIZEN')?.employee_amount,
				line('p2', 'EPF_NON_CITIZEN')?.employer_amount
			],
			[60, 60]
		);
		assert.deepEqual(
			[line('p2', 'SOCSO')?.employee_amount, line('p2', 'SOCSO')?.employer_amount],
			[14.75, 51.65]
		);
		assert.deepEqual(
			[line('p2', 'EIS')?.employee_amount ?? 0, line('p2', 'EIS')?.employer_amount ?? 0],
			[0, 0]
		);
		assert.equal(line('p2', 'HRDF')?.employer_amount ?? 0, 0);
	});

	it('an OFF_CYCLE bonus run before or after the REGULAR run yields the same month totals', async () => {
		reset();
		bonus();
		const before = [
			await run('2026-02', 'OFF_CYCLE', ['bonus-1']),
			await run('2026-02', 'REGULAR')
		];
		assert.equal(before[0]!.payslips[0]!.base.length, 0);
		reset();
		const salary = await run('2026-02', 'REGULAR');
		bonus();
		const after = [salary, await run('2026-02', 'OFF_CYCLE', ['bonus-1'])];
		reset();
		bonus();
		const together = [await run('2026-02', 'REGULAR')];
		const expected = totals(together);
		for (const scheme of ['EPF', 'SOCSO', 'EIS', 'PCB', 'HRDF', 'EPF_NON_CITIZEN'])
			for (const side of ['employee', 'employer'])
				assert.ok(
					`${scheme}.${side}` in expected || scheme === 'EPF_NON_CITIZEN',
					`${scheme}.${side}`
				);
		assert.deepEqual(totals(before), expected);
		assert.deepEqual(totals(after), expected);
		// The bonus is EPF additional wages: 11% / 12% of RM14,000 in the month, and MTD on additional remuneration.
		assert.equal(expected['EPF.employee'], 1540);
		assert.ok(expected['PCB.employee']! > 1000);
	});
});

describe('MY sample records (Nihon bank)', () => {
	const bank = resolve(process.cwd(), '../../seed_bank/norbital_hr/records/nihon');
	const present = existsSync(bank);
	const read = (name: string): Row[] =>
		existsSync(resolve(bank, `${name}.json`))
			? (JSON.parse(readFileSync(resolve(bank, `${name}.json`), 'utf8')) as Row[])
			: [];
	it(
		'every reference resolves to a sample row or a MY catalogue row of the version in force',
		{ skip: !present },
		() => {
			const ids = (name: string) => new Set(read(name).map((row) => String(row.id)));
			const entity = ids('entity');
			const profiles = ids('employment_profile');
			const contracts = read('employment_contract');
			const contractIds = new Set(contracts.map((row) => String(row.id)));
			const shifts = ids('shift_definition');
			const patterns = ids('shift_pattern');
			assert.equal(entity.size, 1);
			for (const row of [...read('shift_definition'), ...read('shift_pattern'), ...read('holiday')])
				assert.ok(entity.has(String(row.company_id)), `company of ${String(row.id)}`);
			for (const pattern of read('shift_pattern'))
				for (const day of ((pattern.pattern as Row).days ?? []) as Row[])
					assert.ok(shifts.has(String(day.roster_code_id)), `${String(pattern.code)} day`);
			const schemes = new Map(
				versions.flatMap((version) =>
					rows(version, 'statutory_contribution_catalog').map(
						(row) => [String(row.id), String(row.code)] as const
					)
				)
			);
			const electionKeys = new Set(
				Object.keys(
					(
						(
							(
								(settingsOf(versions.at(-1)!).employee_input_schema as Row).properties as {
									employment_statutory_facts: Row;
								}
							).employment_statutory_facts.items as { properties: { status: Row } }
						).properties.status.properties as { elections: { properties: Row } }
					).elections.properties
				)
			);
			for (const profile of read('employment_profile'))
				for (const standing of ((profile.facts as Row).employment_statutory_facts ?? []) as Row[]) {
					assert.ok(
						schemes.has(String(standing.statutory_contribution_id)),
						`scheme of ${String(standing.id)}`
					);
					for (const key of Object.keys(((standing.status as Row).elections ?? {}) as Row))
						assert.ok(electionKeys.has(key), `election ${key}`);
				}
			for (const contract of contracts) {
				assert.ok(profiles.has(String(contract.employee_id)), `employee of ${String(contract.id)}`);
				assert.ok(entity.has(String(contract.company_id)));
				for (const term of ((contract.facts as Row).contract_terms ?? []) as Row[]) {
					if (term.shift_pattern_id != null) assert.ok(patterns.has(String(term.shift_pattern_id)));
					assert.equal((term.base_salary as Row).currency, 'MYR');
				}
			}
			for (const row of read('roster')) assert.ok(contractIds.has(String(row.employment_id)));
			for (const row of read('roster_entry')) {
				assert.ok(contractIds.has(String(row.employment_id)), `roster ${String(row.id)}`);
				assert.ok(shifts.has(String(row.shift_definition_id)), `shift of ${String(row.id)}`);
				for (const interval of row.worked_intervals as Row[])
					assert.match(String(interval.start), /Z$/);
			}
			// Each entry names the class of the version in force on its day (or the first version before the lineage).
			for (const [collection, table] of [
				['leave_catalog_entry', 'leave_catalog'],
				['claim_catalog_entry', 'claim_catalog'],
				['adhoc_catalog_entry', 'adhoc_catalog'],
				['loan_catalog_entry', 'loan_catalog']
			] as const)
				for (const row of read(collection)) {
					const day = String(row.occurred_on);
					const version = day < '2025-12-01' ? versions[0]! : at(day);
					assert.ok(
						rows(version, table).some((item) => item.id === row.catalog_id),
						`${collection} ${String(row.id)} class of ${version}`
					);
					assert.ok(contractIds.has(String(row.employment_id)));
					assert.ok(entity.has(String(row.company_id)));
				}
			// Derived amounts are never seeded: no payslip, run, obligation or statutory line in the bank.
			for (const derived of ['payslip', 'payroll_run', 'obligation', 'regulatory_task'])
				assert.equal(existsSync(resolve(bank, `${derived}.json`)), false, derived);
			assert.equal(contracts.length, 290);
			assert.equal(read('roster_entry').length, 5390);
			assert.equal(read('leave_catalog_entry').length, 472);
		}
	);
});
