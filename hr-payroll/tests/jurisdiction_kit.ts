/**
 * The suites' one synthetic jurisdiction, `XX`, and one employer on it. Every row is written here, small and invented —
 * no country's law — so a test proves a mechanism over the values it states. `world` seeds a fresh workspace with them.
 */
import assert from 'node:assert/strict';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import { TestWorkspace, type Caller } from '@norbital-ai/bolt/test';
import {
	fieldValue,
	moneyNumber,
	Reads,
	readsFrom,
	type CallerRead
} from '../src/lib/payroll_engine/foundation.js';
import { fixtureId, fixtureRows, nativeId } from './fixture_values.js';
import { workspace } from './kit.js';

export type Row = Record<string, unknown>;
export type Tables = Map<string, Row[]>;

/** The `XX` version's payroll settings: every key the engine requires. */
export const PAYROLL = {
	currency: 'USD',
	timezone: 'UTC',
	tax_year_start_month: 1,
	pay_date: 'period.to',
	week_start: 0,
	semi_monthly_split: 15,
	roster_week: 'ROLLING',
	rolling_hours_months: 3,
	base_salary_required: true,
	off_cycle_families: ['ADHOC', 'CLAIM'],
	ten_day_splits: [10, 20],
	permanent_when: 'true',
	monthly_wage: 'terms.base_salary + sum(terms.allowances.map(a, a.amount))',
	negative_net: 'refuse',
	exit_raise_when: 'employment.exit_date >= add_months(period.from, -1)',
	exit_overpayment: 'note',
	history_months: 12,
	attendance: {
		step_hours: 0.5,
		rounding: 'DOWN',
		overtime_window: 'AFTER_SHIFT',
		untimed_credit_day_types: ['REST', 'OFF']
	}
} as const;

const id = <C extends string>(collection: C, label: string) =>
	nativeId(collection, fixtureId(`xx-${label}`));
export const VERSION = id('jurisdiction_settings', 'version');
export const COMPANY = id('entity', 'company');
export const WORK = id('shift_definition', 'work');
export const REST = id('shift_definition', 'rest');
export const WEEK = id('shift_pattern', 'week');
export const CATALOG = {
	BONUS: id('adhoc_catalog', 'bonus'),
	DAMAGE: id('adhoc_catalog', 'damage'),
	MEAL_CLAIM: id('claim_catalog', 'meal-claim'),
	ADVANCE: id('loan_catalog', 'advance'),
	ANNUAL: id('leave_catalog', 'annual'),
	UNPAID: id('leave_catalog', 'unpaid')
} as const;
export const employment = (key: string) => id('employment_contract', `k-${key}`);
export const profile = (key: string) => id('employment_profile', `p-${key}`);

/** Every line counts toward the three schemes. */
const SCHEMES = ['FUND', 'WHT', 'PIT'];
/**
 * The schemes, one per mechanism: FUND charges the rate of the band its wage falls in (a band covers up to its ceiling
 * inclusive), WHT withholds a percentage only from a minimum wage, PIT is a progressive ladder over the month's wage.
 */
const STATUTORY = {
	FUND: 'round(base.assessed * bracket(base.assessed, [[3000.0, 0.05], [null, 0.1]]), 0.01, "HALF_UP")',
	WHT: 'round(base.assessed * 0.1, 0.01, "HALF_UP")',
	PIT: 'round(ladder(base.assessed, [[1000.0, 0.0], [5000.0, 0.1], [null, 0.2]]), 0.01, "HALF_UP")'
} as const;
const WHEN = {
	FUND: 'base.assessed > 0.0',
	WHT: 'base.assessed >= 2000.0',
	PIT: 'base.assessed > 0.0'
};

/** The engine's own behaviour records: admit a run, pin what it settled, hold what a validation held, write holidays. */
const BEHAVIOURS = {
	version: 1,
	rules: [
		{
			id: 'payroll-run',
			catalog: 'WORK',
			events: ['PAYROLL_CREATE'],
			when: 'event.data.request.kind in ["REGULAR", "OFF_CYCLE"]'
		},
		{
			id: 'pin-settled-entries',
			target_collection: 'payroll_run',
			events: ['created'],
			when: 'true',
			fields: ['pins'],
			reads: {
				slips: {
					collection: 'payslip',
					where: { payroll_run_id: { eq: 'event.row.id' } },
					select: ['id', 'employment_id']
				}
			},
			effect:
				'event.row.pins.map(p, { "collection": p.collection, "operation": "update", "data": { "target": [p.id], "set": { "payslip_id": first(slips.filter(s, s.employment_id == p.employment_id).map(s, s.id)) } } }).filter(w, w.data.set.payslip_id != null)'
		},
		{
			id: 'hold-payslips',
			target_collection: 'payroll_run',
			events: ['created'],
			when: 'has(event.row.holds) && event.row.holds != null && size(event.row.holds) > 0',
			fields: ['holds'],
			reads: {
				slips: {
					collection: 'payslip',
					where: { payroll_run_id: { eq: 'event.row.id' }, status: { eq: '"DRAFT"' } },
					select: ['id', 'employment_id']
				}
			},
			effect:
				'event.row.holds.map(h, { "collection": "payslip", "operation": "update", "data": { "target": slips.filter(s, s.employment_id == h.employment_id).map(s, s.id), "set": { "status": "ON_HOLD" } } }).filter(w, size(w.data.target) > 0)'
		},
		{
			id: 'write-public-holidays',
			target_collection: 'entity',
			events: ['created', 'calendar'],
			when: 'true',
			reads: {
				calendar: {
					collection: 'rule_set',
					where: {
						settings_id: { eq: 'event.settings_id' },
						family: { eq: '"PAYROLL"' },
						code: { eq: '"public_holidays"' }
					},
					select: ['rules']
				},
				held: {
					collection: 'holiday',
					where: { company_id: { eq: 'event.company_id' } },
					select: ['date']
				}
			},
			effect:
				'calendar.exists(c, has(c.rules.holidays)) ? first(calendar).rules.holidays.filter(h, !held.exists(x, x.date == h.date)).map(h, { "collection": "holiday", "operation": "create", "data": { "company_id": event.company_id, "date": h.date, "name": h.name, "kind": "PUBLIC_HOLIDAY", "replaces": null, "given_to": "EVERYONE" } }) : []'
		}
	]
};

const rule = (family: string, code: string, rules: Row): Row => ({
	id: id('rule_set', code),
	settings_id: VERSION,
	family,
	scope: 'JURISDICTION',
	code,
	name: code,
	rules
});
const work = (code: string, row: Row): Row => ({
	id: id('work_catalog', code),
	settings_id: VERSION,
	code,
	name: code,
	component_code: code,
	destination: 'PAY',
	direction: 'ADD',
	counts_toward: SCHEMES,
	...row
});
const entryClass = (row: Row & { readonly id: string; readonly code: string }): Row => ({
	settings_id: VERSION,
	name: row.code,
	eligibility: '',
	bands: [{ when: '', amount: 'entry.amount', limit: null }],
	...row
});

/** The `XX` version with its rules and catalogues: fresh rows on every call. */
export function law(): Tables {
	return new Map<string, Row[]>([
		[
			'jurisdiction_settings',
			[
				{
					id: VERSION,
					code: 'XX',
					jurisdiction_code: 'XX',
					name: 'Fixture jurisdiction',
					effective_range: { from: '2020-01-01', to: null },
					sealed_at: '2020-01-01T00:00:00.000Z',
					voided_at: null,
					sources: { entries: [] },
					payroll: PAYROLL,
					behaviours: BEHAVIOURS
				}
			]
		],
		[
			'rule_set',
			[
				rule('PAYROLL', 'record_retention', { until: 'add_years(employment.exit_date, 6)' }),
				rule('PAYROLL', 'exit_grounds', { kinds: [{ code: 'RESIGNATION', name: 'Resignation' }] }),
				rule('PAYROLL', 'holiday_kinds', {
					kinds: [{ code: 'PUBLIC_HOLIDAY', name: 'Public holiday' }]
				}),
				rule('PAYROLL', 'public_holidays', {
					holidays: [{ date: '2026-03-25', name: 'Founders Day' }]
				}),
				rule('VALIDATIONS', 'HELD_PAY', {
					site: 'payslip',
					kind: 'hold',
					when: 'has(employee.facts.held) && employee.facts.held == true',
					message: 'Pay is held for review.'
				})
			]
		],
		[
			'work_catalog',
			[
				work('BASIC', {
					// a part month pays its covered working days over the month's working days; a whole month pays one
					quantity:
						'employment.start_date > period.month_from || period.covered_working_days < period.working_days ? double(period.covered_working_days) / double(period.month_working_days + period.month_holiday_work_days) : 1.0',
					rate: 'terms.base_salary',
					eligibility: 'true',
					prorated: true,
					denominator: 'double(period.month_working_days + period.month_holiday_work_days)'
				}),
				work('OVERTIME', {
					quantity: 'work.overtime_hours',
					rate: '15.0',
					eligibility: 'work.overtime_hours > 0.0'
				}),
				work('HOLIDAY', {
					quantity: 'double(size(work.days.filter(d, d.holiday_kind == "PUBLIC_HOLIDAY")))',
					rate: '100.0',
					eligibility: 'work.days.exists(d, d.holiday_kind == "PUBLIC_HOLIDAY")'
				}),
				work('NO_PAY_LEAVE', {
					quantity:
						'sum(leave.rows.filter(r, r.activity == "TIME_OFF").map(r, r.is_npl ? r.days : r.days * (1.0 - r.pay_fraction)))',
					rate: 'terms.monthly_wage / double(period.month_working_days + period.month_holiday_work_days)',
					eligibility:
						'leave.rows.exists(r, r.activity == "TIME_OFF" && r.days > 0.0 && (r.is_npl || r.pay_fraction < 1.0))',
					direction: 'SUBTRACT'
				})
			]
		],
		[
			'allowance_catalog',
			[
				{
					id: id('allowance_catalog', 'meal'),
					settings_id: VERSION,
					code: 'MEAL',
					name: 'Meal allowance',
					eligibility: 'true',
					amount: 'allowance.amount',
					destination: 'PAY',
					direction: 'ADD',
					counts_toward: SCHEMES
				}
			]
		],
		[
			'adhoc_catalog',
			[
				entryClass({
					id: CATALOG.BONUS,
					code: 'BONUS',
					destination: 'PAY',
					direction: 'ADD',
					counts_toward: SCHEMES
				}),
				entryClass({
					id: CATALOG.DAMAGE,
					code: 'DAMAGE',
					destination: 'NET',
					direction: 'SUBTRACT',
					counts_toward: []
				})
			]
		],
		[
			'claim_catalog',
			[
				entryClass({
					id: CATALOG.MEAL_CLAIM,
					code: 'MEAL_CLAIM',
					destination: 'NET',
					direction: 'ADD',
					counts_toward: []
				})
			]
		],
		[
			'loan_catalog',
			[
				{
					id: CATALOG.ADVANCE,
					settings_id: VERSION,
					code: 'ADVANCE',
					name: 'Salary advance',
					destination: 'NET',
					direction: 'SUBTRACT',
					eligibility: '',
					bands: []
				}
			]
		],
		[
			'leave_catalog',
			[
				{
					id: CATALOG.ANNUAL,
					settings_id: VERSION,
					code: 'ANNUAL',
					name: 'Annual leave',
					eligibility: '',
					unit: 'DAY',
					can_encash: true,
					is_npl: false,
					pay_fraction: '',
					entitlement: { unit: 'DAY', days: '5.0', overdraw: '0', window: 'CALENDAR_YEAR' }
				},
				{
					id: CATALOG.UNPAID,
					settings_id: VERSION,
					code: 'UNPAID',
					name: 'Unpaid leave',
					eligibility: '',
					unit: 'DAY',
					can_encash: false,
					is_npl: true,
					pay_fraction: '',
					entitlement: null
				}
			]
		],
		[
			'statutory_contribution_catalog',
			(['FUND', 'WHT', 'PIT'] as const).map((code) => ({
				id: id('statutory_contribution_catalog', code),
				settings_id: VERSION,
				code,
				name: code,
				configuration: { rules: [{ when: WHEN[code], employee: STATUTORY[code], employer: '0.0' }] }
			}))
		]
	]);
}

export type Person = {
	readonly key: string;
	readonly salary: number;
	/** The employment's first day; 2020-01-01 unless stated. */
	readonly from?: string;
	readonly allowances?: readonly { readonly code: string; readonly amount: number }[];
	readonly facts?: Row;
};

/**
 * The law, one UTC employer paying monthly on a Monday-to-Friday 09:00–18:00 week (an hour's break: eight scheduled
 * hours), and its people; every entry and run model starts empty.
 */
export function employer(people: readonly Person[]): Tables {
	const rows = law();
	rows.set('entity', [
		{
			id: COMPANY,
			name: 'Fixture employer',
			settings_code: 'XX',
			pay_frequency: 'MONTHLY',
			pay_cutoff_day: 1,
			time_zone: 'UTC',
			effective_range: { from: '2020-01-01', to: null },
			facts: {}
		}
	]);
	rows.set(
		'employment_profile',
		people.map((person) => ({
			id: profile(person.key),
			name: `Person ${person.key}`,
			email: `${person.key}@example.com`,
			facts: person.facts ?? {}
		}))
	);
	rows.set(
		'employment_contract',
		people.map((person) => {
			const from = person.from ?? '2020-01-01';
			return {
				id: employment(person.key),
				employee_id: profile(person.key),
				company_id: COMPANY,
				employee_number: person.key,
				contract_number: 1,
				effective_range: { from, to: null },
				facts: {
					contract_terms: [
						{
							effective_range: { from, to: null },
							base_salary: { value: person.salary, currency: 'USD' },
							employment_type: 'PERMANENT',
							shift_pattern_id: WEEK,
							allowances: (person.allowances ?? []).map((line) => ({
								code: line.code,
								amount: { value: line.amount, currency: 'USD' }
							})),
							facts: {}
						}
					]
				}
			};
		})
	);
	rows.set('shift_definition', [
		{
			id: WORK,
			company_id: COMPANY,
			code: 'DAY',
			variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
		},
		{ id: REST, company_id: COMPANY, code: 'REST', variant: { day_type: 'REST' } }
	]);
	rows.set('shift_pattern', [
		{
			id: WEEK,
			company_id: COMPANY,
			code: 'WEEK',
			// a Monday: the cycle's first five days work
			effective_range: { from: '2020-01-06', to: null },
			pattern: {
				days: [WORK, WORK, WORK, WORK, WORK, REST, REST].map((roster_code_id) => ({
					roster_code_id
				}))
			}
		}
	]);
	for (const name of [
		'holiday',
		'roster_entry',
		'adhoc_catalog_entry',
		'claim_catalog_entry',
		'leave_catalog_entry',
		'loan_catalog_entry',
		'loan_repayment_entry',
		'payroll_run',
		'payslip'
	])
		rows.set(name, []);
	return rows;
}

const SeedTable = Schema.Array(Schema.Record(Schema.String, Schema.Json));
/** The tables as a seed pack: each row's omitted model defaults filled, every value plain JSON. */
export const seedPack = (tables: Tables) =>
	Object.fromEntries(
		[...tables].map(([table, rows]): [string, typeof SeedTable.Type] => [
			table,
			Schema.decodeUnknownSync(SeedTable)(JSON.parse(JSON.stringify(fixtureRows(table, rows))))
		])
	);
/** One fresh workspace seeded with `tables` per call, its clock at `now` when given; its reads are the real database's. */
export function world(tables: Tables, now?: string) {
	const layer = Layer.unwrap(
		Effect.sync(() =>
			Layer.effect(
				Reads,
				TestWorkspace.pipe(Effect.map((t) => readsFrom(t.as(t.admin).query)))
			).pipe(
				Layer.provideMerge(
					workspace({ ...(now === undefined ? {} : { now }), seed: seedPack(tables) })
				)
			)
		)
	);
	const withRead = <A, E, R>(use: (read: CallerRead) => Effect.Effect<A, E, R>) =>
		TestWorkspace.pipe(
			Effect.flatMap((t) => use(t.as(t.admin).query)),
			Effect.provide(layer)
		);
	return { withRead };
}

const Pins = Schema.Array(
	Schema.Struct({ collection: Schema.String, id: Schema.String, employment_id: Schema.String })
);
/**
 * The `period` run of `kind` as the caller reads it back: its warnings, its settlement ledger and each payslip by
 * employment, with every line's amount and quantity by code and each scheme's employee share.
 */
export const runOf = Effect.fnUntraced(function* (
	actor: Caller,
	period: string,
	kind: 'REGULAR' | 'OFF_CYCLE' = 'REGULAR'
) {
	const [run] = (yield* actor.query({
		payroll_run: {
			where: { period: { eq: period }, kind: { eq: kind } },
			fields: ['warnings', 'pins']
		}
	})).payroll_run.rows;
	assert.ok(run, `The ${period} ${kind} run exists.`);
	const { rows } = (yield* actor.query({
		payslip: {
			where: { payroll_run_id: { eq: run.id } },
			fields: ['employment_id', 'status', 'base', 'adjustments', 'statutory', 'gross', 'net']
		}
	})).payslip;
	const slips = new Map(
		yield* Effect.forEach(rows, (row) =>
			Effect.gen(function* () {
				const base = (yield* Effect.fromResult(fieldValue(row.base, 'payslip.base'))) ?? [];
				const adjustments =
					(yield* Effect.fromResult(fieldValue(row.adjustments, 'payslip.adjustments'))) ?? [];
				const statutory =
					(yield* Effect.fromResult(fieldValue(row.statutory, 'payslip.statutory'))) ?? [];
				const lines = [...base, ...adjustments];
				return [
					String(row.employment_id),
					{
						id: row.id,
						status: String(row.status),
						gross: moneyNumber(row.gross),
						net: moneyNumber(row.net),
						lines: Object.fromEntries(lines.map((line) => [line.component_code, line.amount])),
						quantities: Object.fromEntries(
							base.map((line) => [line.component_code, line.quantity ?? null])
						),
						statutory: Object.fromEntries(
							statutory.map((line) => [line.scheme_code, line.employee_amount])
						)
					}
				] as const;
			})
		)
	);
	return {
		id: run.id,
		warnings: yield* Effect.fromResult(fieldValue(run.warnings, 'payroll_run.warnings')),
		pins: Schema.decodeUnknownSync(Pins)(
			(yield* Effect.fromResult(fieldValue(run.pins, 'payroll_run.pins'))) ?? []
		),
		/** The payslip of `key`'s employment. */
		slip: (key: string) => {
			const found = slips.get(employment(key));
			assert.ok(found, `The ${period} run pays ${key}.`);
			return found;
		},
		count: slips.size
	};
});

/** The same rejection predicate as node:assert, over an Effect failure rather than a Promise. */
export const assertFailure = Effect.fnUntraced(function* <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	expected?: Parameters<typeof assert.throws>[1]
) {
	const exit = yield* Effect.exit(effect);
	if (Exit.isSuccess(exit)) assert.fail('Expected the operation to refuse.');
	const raised = () => {
		throw Cause.squash(exit.cause);
	};
	if (expected === undefined) assert.throws(raised);
	else assert.throws(raised, expected);
});
