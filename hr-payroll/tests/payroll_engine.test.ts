import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { it, vi } from '@effect/vitest';
import { Effect, Result, Schema } from 'effect';
import { isMasked } from '@norbital-ai/bolt';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Reads as NativeReads, type ShapeOf } from '@norbital-ai/bolt/engine';
import { Refusal as WriteRefusal } from '@norbital-ai/bolt/errors';
import { Decimal } from '@norbital-ai/std/decimal';
import { addDays, PlainDate, Instant } from '@norbital-ai/std/date';
import {
	Behaviour,
	behavioursOf,
	effectWrites,
	planBehaviours,
	resolveWhere,
	triggerMatches
} from '../src/lib/payroll_engine/behaviours.js';
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import { evaluateStrict as evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import {
	celValues,
	fieldValue,
	isDynObject,
	isJsonObject,
	moneyNumber,
	payPeriodWindow,
	Reads,
	readsFrom,
	Refusal
} from '../src/lib/payroll_engine/foundation.js';
import { staffingLookup, versionLookup } from '../src/lib/payroll_engine/behaviour_runner.js';
import * as PayrollAdmission from '../src/lib/payroll_engine/admit.js';
import { raiseDuties, withBalances, SEEDED_PAYROLL } from './duties.ts';
import { leaveBalances } from '../src/lib/payroll_engine/leave.js';
import {
	admitAnonymise,
	admitCase,
	anonymousProfile,
	admitSuspension,
	admitContractTerms,
	admitPayrollRun,
	rosterFindings,
	staffingFrom,
	transformEntries,
	type EntryTransformCtx
} from '../src/lib/payroll_engine/admit.js';
import { buildPayrollRun } from '../src/lib/payroll_engine/run.js';
import {
	currencyScale,
	leaveState,
	type CatalogName,
	type EntryCollection,
	type PayrollRunKind
} from '../src/lib/payroll_engine/payslip/context.js';
import { payScheduleRefusal, settlementPeriod } from '../src/lib/payroll_engine/frequency.js';
import { assertFailure, world } from './jurisdiction_kit.js';
import { fixtureId as labelledId, nativeId } from './fixture_values.js';
import { readSeedRows } from './seed_values.js';
import { workspace } from './kit.js';
import { CONTRACT } from '../src/lib/payroll_engine/rows.js';

/**
 * The engine's probes over the public SG seed: regular runs, the salary-less settlement paid before its month's
 * regular run, and one regression per statutory and settlement defect. People are fixtures here, never the bank.
 */

type Row = Record<string, unknown>;
const required = <A>(value: A | null | undefined): A => {
	assert.ok(value !== null && value !== undefined);
	return value;
};
/** Native UUID order preserves the people order asserted by the original payroll scenarios. */
const orderedIds: Readonly<Record<string, string>> = {
	e1: 'd0000000-0000-4000-8000-000000000001',
	e2: 'd0000000-0000-4000-8000-000000000002',
	e3: 'd0000000-0000-4000-8000-000000000003',
	'k-e1': 'e0000000-0000-4000-8000-000000000001',
	'k-e2': 'e0000000-0000-4000-8000-000000000002',
	'k-e3': 'e0000000-0000-4000-8000-000000000003',
	c1: 'f0000000-0000-4000-8000-000000000001',
	c2: 'f0000000-0000-4000-8000-000000000002',
	c3: 'f0000000-0000-4000-8000-000000000003',
	b1: 'f1000000-0000-4000-8000-000000000001',
	b2: 'f1000000-0000-4000-8000-000000000002',
	a1: 'f1000000-0000-4000-8000-000000000003'
};
const fixtureId = (label: string): string => orderedIds[label] ?? labelledId(label);
const seed = resolve(process.cwd(), 'seed/jurisdiction/SG');
const law = (name: string): Row[] =>
	readdirSync(seed)
		.filter((entry) => entry.startsWith('version_'))
		.flatMap((dir) => {
			const path = resolve(seed, dir, `${name}.json`);
			return existsSync(path) ? readSeedRows(resolve(seed, dir), name) : [];
		});

const COMPANY = nativeId('entity', 'c0000000-0000-4000-8000-000000000001');
const record = (value: unknown): Row => {
	assert.ok(Schema.is(Schema.Record(Schema.String, Schema.Unknown))(value));
	return value;
};
const records = (value: unknown): Row[] => {
	assert.ok(Schema.is(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)))(value));
	return [...value];
};
const rangeOf = (value: unknown) =>
	Schema.decodeUnknownSync(
		Schema.Struct({ from: Schema.String, to: Schema.NullOr(Schema.String) })
	)(value);
const provide = <A, E>(effect: Effect.Effect<A, E, Reads>) =>
	world(fixtureTables()).provide(effect);
/** Admission sees the same decoded contract facts and dates as a real stored contract. */
const admitContract = Effect.fnUntraced(function* (draft: Row, before: unknown = null) {
	const source = new Map(tables);
	const id = nativeId('employment_contract', fixtureId('contract-admission-draft'));
	const priorId = nativeId('employment_contract', fixtureId('contract-admission-before'));
	const contract = {
		employee_number: 'admission',
		contract_number: 90,
		...draft,
		id: draft.id ?? id
	};
	const prior = { ...contract, id: priorId, contract_number: 91, facts: before };
	source.set('employment_contract', [
		...(source.get('employment_contract') ?? []),
		contract,
		...(before === null ? [] : [prior])
	]);
	return yield* world(fixtureTables(source)).withRead((read) =>
		Effect.gen(function* () {
			const rows = yield* read('employment_contract', { select: CONTRACT, all: true });
			const held = rows.rows.find((row) => row.id === contract.id);
			assert.ok(held);
			const previous = before === null ? null : rows.rows.find((row) => row.id === priorId);
			assert.ok(before === null || previous);
			return yield* Effect.result(
				admitContractTerms({ contract: held, before: previous?.facts ?? null }).pipe(
					Effect.provideService(Reads, readsFrom(read))
				)
			);
		})
	);
});
type EntryInput<C extends EntryCollection> = Parameters<typeof transformEntries<C>>[1][number];
type TransformOptions = { existing?: readonly string[]; refusals?: string[] };
type TransformArguments = {
	[C in EntryCollection]: [
		collection: C,
		inputs: readonly EntryInput<C>[],
		options?: TransformOptions
	];
}[EntryCollection];
/** Native stored reads supply transform authorization and existing values without caller masking. */
const transformed = Effect.fnUntraced(function* (...args: TransformArguments) {
	const options = args[2] ?? {};
	return yield* world(fixtureTables()).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const apply = <C extends EntryCollection>(
				collection: C,
				inputs: readonly EntryInput<NoInfer<C>>[],
				existing: EntryTransformCtx<NoInfer<C>>['existing']
			) =>
				transformEntries(collection, inputs, {
					existing,
					db: { read: t.storedRead },
					refuse: (message) =>
						Effect.sync(() => options.refusals?.push(message)).pipe(
							Effect.flatMap(() => Effect.fail(new WriteRefusal({ message })))
						)
				});
			switch (args[0]) {
				case 'adhoc_catalog_entry': {
					const stored =
						options.existing === undefined
							? []
							: (yield* t.storedRead('adhoc_catalog_entry', {
									where: {
										id: {
											in: options.existing.map((id) =>
												nativeId('adhoc_catalog_entry', fixtureId(id))
											)
										}
									},
									all: true
								})).rows;
					return yield* apply(
						args[0],
						args[1],
						options.existing?.map((id) => stored.find((row) => row.id === fixtureId(id))) ?? []
					);
				}
				case 'claim_catalog_entry': {
					const stored =
						options.existing === undefined
							? []
							: (yield* t.storedRead('claim_catalog_entry', {
									where: {
										id: {
											in: options.existing.map((id) =>
												nativeId('claim_catalog_entry', fixtureId(id))
											)
										}
									},
									all: true
								})).rows;
					return yield* apply(
						args[0],
						args[1],
						options.existing?.map((id) => stored.find((row) => row.id === fixtureId(id))) ?? []
					);
				}
				case 'leave_catalog_entry': {
					const stored =
						options.existing === undefined
							? []
							: (yield* t.storedRead('leave_catalog_entry', {
									where: {
										id: {
											in: options.existing.map((id) =>
												nativeId('leave_catalog_entry', fixtureId(id))
											)
										}
									},
									all: true
								})).rows;
					return yield* apply(
						args[0],
						args[1],
						options.existing?.map((id) => stored.find((row) => row.id === fixtureId(id))) ?? []
					);
				}
				case 'loan_repayment_entry': {
					const stored =
						options.existing === undefined
							? []
							: (yield* t.storedRead('loan_repayment_entry', {
									where: {
										id: {
											in: options.existing.map((id) =>
												nativeId('loan_repayment_entry', fixtureId(id))
											)
										}
									},
									all: true
								})).rows;
					return yield* apply(
						args[0],
						args[1],
						options.existing?.map((id) => stored.find((row) => row.id === fixtureId(id))) ?? []
					);
				}
			}
		})
	);
});
const people = [
	{
		id: 'e1',
		name: 'Kavriel',
		date_of_birth: PlainDate('1993-04-18'),
		race: 'CHINESE',
		religion: 'OTHER',
		salary: 6500,
		residency: 'PERMANENT_RESIDENT',
		since: '2019-01-01'
	},
	{
		id: 'e2',
		name: 'Shelly',
		date_of_birth: PlainDate('1990-11-02'),
		race: 'CHINESE',
		religion: 'OTHER',
		salary: 5500,
		residency: 'CITIZEN'
	},
	{
		id: 'e3',
		name: 'Dernese',
		date_of_birth: PlainDate('1997-06-30'),
		race: 'CHINESE',
		religion: 'OTHER',
		salary: 4800,
		residency: 'CITIZEN'
	}
];
const contractOf = (person: (typeof people)[number], extra: Row = {}): Row => ({
	id: fixtureId(`k-${person.id}`),
	employee_id: nativeId('employment_profile', fixtureId(person.id)),
	company_id: COMPANY,
	employee_number: person.id,
	contract_number: 1,
	effective_range: { from: PlainDate('2019-01-01'), to: null },
	facts: {
		contract_terms: [
			{
				base_salary: { value: person.salary, currency: 'SGD' },
				effective_range: { from: PlainDate('2019-01-01'), to: null },
				residency_status: person.residency,
				...(person.since == null ? {} : { residency_since: person.since }),
				work_classification: 'EA_COVERED',
				statutory_work_category: 'NON_MANUAL',
				employment_type: 'PERMANENT',
				facts: { race: person.race, religion: person.religion },
				// a Monday-to-Friday week: s.20A prices a part month and a day by its working days
				shift_pattern_id: fixtureId('p-week'),
				allowances: [],
				...extra
			}
		]
	}
});

/**
 * The clock of a p-week day the engine derives `overtime` hours from: from 09:00 Singapore time to that long past a
 * weekday's 18:00 (its planned hour of break netted), or on a weekend rest day `overtime` hours from 09:00.
 */
const clocked = (date: string, overtime: number) => {
	const start = Date.parse(`${date}T01:00:00.000Z`);
	const weekend = [0, 6].includes(new Date(start).getUTCDay());
	return [
		{
			start: Instant(new Date(start).toISOString()),
			end: Instant(new Date(start + ((weekend ? 0 : 9) + overtime) * 3600000).toISOString())
		}
	];
};

let tables = new Map<string, Row[]>();
/** Historical paid markers are actual settlements; 1900 lies outside every history window in this suite. */
const fixtureTables = (source = tables) => {
	const markers = new Set([fixtureId('paid'), fixtureId('paid-in-february')]);
	const settled = [...source.values()].flat().filter((row) => markers.has(String(row.payslip_id)));
	for (const reference of settled) {
		const id = nativeId('payslip', reference.payslip_id);
		if (source.get('payslip')?.some((row) => row.id === id)) continue;
		const [entity] = source.get('entity') ?? [];
		const [settings] = source.get('jurisdiction_settings') ?? [];
		assert.ok(entity && settings);
		const runId = nativeId('payroll_run', fixtureId(`historical-${id}`));
		source.set('payroll_run', [
			...(source.get('payroll_run') ?? []),
			{
				id: runId,
				company_id: nativeId('entity', entity.id),
				settings_id: nativeId('jurisdiction_settings', settings.id),
				period: '1900-01',
				kind: 'OFF_CYCLE',
				sources: [],
				pay_date: PlainDate('1900-01-31'),
				salary_from: PlainDate('1900-01-01'),
				salary_to: PlainDate('1900-01-31'),
				attendance_from: PlainDate('1900-01-01'),
				attendance_to: PlainDate('1900-01-31')
			}
		]);
		source.set('payslip', [
			...(source.get('payslip') ?? []),
			{
				id,
				payroll_run_id: runId,
				employment_id: nativeId('employment_contract', reference.employment_id),
				terms_through: PlainDate('1900-01-31'),
				salary_from: PlainDate('1900-01-01'),
				salary_to: PlainDate('1900-01-31'),
				currency: 'SGD',
				gross: Decimal.of('0'),
				total_deductions: Decimal.of('0'),
				net: Decimal.of('0'),
				employer_cost: Decimal.of('0'),
				base: [],
				proration: [],
				statutory: [],
				adjustments: [],
				status: 'PAID',
				paid_at: Instant('1900-01-31T00:00:00.000Z')
			}
		]);
	}
	return source;
};
const setSuspensionKinds = (rows: readonly Row[]) => {
	for (const settings of tables.get('jurisdiction_settings') ?? [])
		settings.suspension_kinds = rows
			.filter((row) => row.settings_id === settings.id)
			.map(({ settings_id, ...kind }) => kind);
};

const reset = () => {
	tables = new Map<string, Row[]>([
		...[
			'jurisdiction_settings',
			'rule_set',
			'statutory_contribution_catalog',
			'work_catalog',
			'allowance_catalog',
			'adhoc_catalog',
			'claim_catalog',
			'leave_catalog',
			'loan_catalog'
		].map((name): [string, Row[]] => [name, law(name).map((row) => ({ ...row }))]),
		[
			'entity',
			[
				{
					id: COMPANY,
					name: 'Omni',
					settings_code: 'SG',
					pay_frequency: 'MONTHLY',
					pay_cutoff_day: 1,
					effective_range: { from: PlainDate('2019-01-01'), to: null },
					facts: {}
				}
			]
		],
		[
			'employment_profile',
			people.map(({ salary: _s, residency: _r, since: _x, race: _c, religion: _g, ...person }) => ({
				...person,
				id: fixtureId(person.id),
				nationality: 'SG',
				facts: {}
			}))
		],
		['employment_contract', people.map((person) => contractOf(person))],
		[
			'shift_definition',
			[
				{
					id: fixtureId('sd-work'),
					company_id: COMPANY,
					code: 'DAY',
					variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
				},
				{
					id: fixtureId('sd-rest'),
					company_id: COMPANY,
					code: 'REST',
					variant: { day_type: 'REST' }
				}
			]
		],
		[
			'shift_pattern',
			[
				{
					id: fixtureId('p-week'),
					code: 'WEEK',
					company_id: COMPANY,
					// anchored on Monday 31 December 2018
					effective_range: { from: PlainDate('2018-12-31'), to: null },
					pattern: {
						days: [
							...Array.from({ length: 5 }, () => ({
								roster_code_id: nativeId('shift_definition', fixtureId('sd-work'))
							})),
							{ roster_code_id: nativeId('shift_definition', fixtureId('sd-rest')) },
							{ roster_code_id: nativeId('shift_definition', fixtureId('sd-rest')) }
						]
					}
				}
			]
		],
		...[
			'adhoc_catalog_entry',
			'claim_catalog_entry',
			'leave_catalog_entry',
			'loan_repayment_entry',
			'loan_catalog_entry',
			'roster_entry',
			'holiday',
			'payslip',
			'payroll_run'
		].map((name): [string, Row[]] => [name, []])
	]);
};

const run = Effect.fnUntraced(function* (period: string, kind: PayrollRunKind, sources?: string[]) {
	return yield* world(fixtureTables()).run(COMPANY, period, kind, sources?.map(fixtureId));
});
const refused = (period: string, kind: PayrollRunKind, sources?: string[]) =>
	provide(
		Effect.flip(
			buildPayrollRun({
				company_id: COMPANY,
				period,
				kind,
				...(sources === undefined ? {} : { sources: sources.map(fixtureId) })
			})
		)
	).pipe(Effect.map((error) => error.message));

type Plan = Effect.Success<ReturnType<typeof run>>;
const findSlip = (plan: Plan, person: string) =>
	plan.payslips.find((row) => row.employment_id === fixtureId(`k-${person}`));
const slip = (plan: Plan, person: string) => {
	const found = findSlip(plan, person);
	assert.ok(found, `The run includes ${person}'s payslip.`);
	return found;
};
const lastSlipId = (person: string) =>
	required(tables.get('payslip'))
		.filter((row) => row.employment_id === fixtureId(`k-${person}`))
		.at(-1)?.id;
const line = (plan: Plan, person: string, scheme: string) =>
	slip(plan, person).statutory.find((row) => row.scheme_code === scheme);
const shares: readonly ('employee_amount' | 'employer_amount')[] = [
	'employee_amount',
	'employer_amount'
];
const total = (plans: Plan[], scheme: string, field: 'employee_amount' | 'employer_amount') =>
	plans
		.flatMap((plan) => plan.payslips)
		.flatMap((row) => row.statutory)
		.filter((row) => row.scheme_code === scheme)
		.reduce((sum, row) => sum + row[field], 0);
const catalog = <C extends CatalogName<EntryCollection>>(name: C, code: string, period: string) =>
	nativeId(
		name,
		required(
			required(tables.get(name)).find((row) => {
				const version = required(
					required(tables.get('jurisdiction_settings')).find(
						(settings) => settings.id === row.settings_id
					)
				);
				const range = rangeOf(version.effective_range);
				return (
					version.voided_at == null &&
					row.code === code &&
					range.from <= `${period}-01` &&
					(range.to == null || range.to >= `${period}-01`)
				);
			})
		).id
	);
const entry = (
	collection: string,
	id: string,
	person: string,
	catalogId: string,
	occurred_on: string,
	fields: Row,
	activity?: string
) => {
	if (collection === 'loan_repayment_entry') {
		const principal = moneyNumber(fields.amount);
		assert.ok(principal != null);
		required(tables.get('loan_catalog_entry')).push({
			id: fixtureId(`principal-${id}`),
			employment_id: nativeId('employment_contract', fixtureId(`k-${person}`)),
			company_id: COMPANY,
			catalog_id: fixtureId(catalogId),
			principal_amount: Decimal.of(String(principal)),
			repayment_period: { from: PlainDate(occurred_on), to: PlainDate(occurred_on) },
			repayment_frequency: 'MONTHLY',
			...(isDynObject(fields.facts)
				? {
						facts: Object.fromEntries(
							Object.entries(fields.facts).filter(([key]) =>
								['advance_purpose', 'written_agreement_reference'].includes(key)
							)
						),
						...(fields.facts.advance_made_on == null
							? {}
							: { advance_made_on: fields.facts.advance_made_on })
					}
				: {})
		});
	}
	required(tables.get(collection)).push({
		id: fixtureId(id),
		...(collection === 'loan_repayment_entry'
			? { loan_id: fixtureId(`principal-${id}`), sequence: 1, activity: activity ?? 'AWARD' }
			: {}),
		employment_id: nativeId('employment_contract', fixtureId(`k-${person}`)),
		company_id: COMPANY,
		catalog_id: fixtureId(catalogId),
		payslip_id: null,
		occurred_on: PlainDate(occurred_on),
		// These three columns are decimal in all four native entry models.
		...Object.fromEntries(
			Object.entries(fields)
				.filter(
					([key]) =>
						collection !== 'loan_repayment_entry' || !['reference', 'label', 'facts'].includes(key)
				)
				.map(([key, value]) => [
					key,
					['amount', 'quantity', 'days'].includes(key) && typeof value === 'number'
						? Decimal.of(String(value))
						: value
				])
		),
		...(activity == null ? {} : { activity })
	});
};

it('payroll guards retain strict nested values and recursive Decimal conversion without losing masks', () => {
	const json = { nested: { values: [1, 'two', null, true] } };
	assert.equal(isJsonObject(json), true);
	assert.equal(isDynObject(json), true);
	for (const invalid of [
		null,
		undefined,
		[],
		'text',
		{ nested: { value: undefined } },
		{ value: Number.NaN },
		{ value: Number.POSITIVE_INFINITY }
	]) {
		assert.equal(isJsonObject(invalid), false);
		assert.equal(isDynObject(invalid), false);
	}
	assert.equal(isJsonObject({ count: 2n }), false);
	assert.equal(isDynObject({ count: 2n, nested: json }), true);
	assert.equal(isDynObject({ nested: { count: 2n } }), false);
	const changing: { nested: { value: unknown } } = { nested: { value: 1 } };
	assert.equal(isJsonObject(changing), true);
	changing.nested.value = undefined;
	assert.equal(isJsonObject(changing), false);
	assert.equal(isDynObject(changing), false);
	const masked = { $masked: true };
	const amount = Decimal.of('12.30');
	const input = {
		amount,
		nested: [{ amount: Decimal.of('-0.07'), count: 2n, missing: undefined, masked }]
	};
	const converted = celValues(input);
	assert.deepEqual(converted, {
		amount: 12.3,
		nested: [{ amount: -0.07, count: 2n, missing: undefined, masked }]
	});
	assert.equal(input.amount, amount);
	assert.equal(isMasked(celValues(masked)), true);
	const unavailable = fieldValue(celValues(masked), 'payslip.net');
	assert.equal(Result.isFailure(unavailable), true);
	if (Result.isFailure(unavailable))
		assert.equal(unavailable.failure.message, 'This operation needs access to payslip.net.');
});

/** The native decoder owns wire formats; a money consumer accepts only its actual Decimal. */
it('moneyNumber reads decoded money and rejects undecoded wire shapes', () => {
	assert.equal(moneyNumber(Decimal.of('1234.5')), 1234.5);
	assert.equal(moneyNumber(1234.5), null);
	assert.equal(moneyNumber(Decimal.of('7397.00')), 7397);
	assert.equal(moneyNumber(Decimal.of('-1600.00')), -1600);
	assert.equal(moneyNumber(Decimal.of('-0.07')), -0.07);
	assert.equal(moneyNumber(Decimal.of('3193.55')), 3193.55);
	assert.equal(moneyNumber(Decimal.of('12.30')), 12.3);
	assert.equal(moneyNumber('-0.07'), null);
	assert.equal(moneyNumber({ value: 3193.55, currency: 'SGD' }), null);
	assert.equal(moneyNumber({ $dec: '12.30' }), null);
	assert.equal(moneyNumber(null), null);
	assert.equal(moneyNumber(undefined), null);
	assert.equal(moneyNumber({}), null);
	assert.equal(moneyNumber('  '), null);
	assert.equal(moneyNumber(Number.NaN), null);
	assert.equal(moneyNumber(Number.POSITIVE_INFINITY), null);
});

it.effect(
	'SG regular run: 2026 Table 1 rates, CDAC bands, SDL cap',
	Effect.fnUntraced(function* () {
		reset();
		const plan = yield* run('2026-01', 'REGULAR');
		assert.deepEqual(
			plan.payslips.map((row) => row.net).sort((a, b) => a - b),
			[3838.5, 4398, 5198]
		);
		assert.equal(total([plan], 'CPF', 'employee_amount'), 3360);
		assert.equal(total([plan], 'CPF', 'employer_amount'), 2856);
		assert.equal(total([plan], 'CDAC', 'employee_amount'), 5.5);
		assert.equal(total([plan], 'SDL', 'employer_amount'), 33.75);
	})
);

it.effect(
	'a bonus paid before the month run carries no salary and settles the month exactly',
	Effect.fnUntraced(function* () {
		const bonusFirst = Effect.fnUntraced(function* () {
			reset();
			entry(
				'adhoc_catalog_entry',
				'bonus-1',
				'e1',
				catalog('adhoc_catalog', 'bonus', '2026-02'),
				'2026-02-05',
				{ amount: Decimal.of('5000') }
			);
			return [yield* run('2026-02', 'OFF_CYCLE', ['bonus-1']), yield* run('2026-02', 'REGULAR')];
		});
		// Without an earlier settlement the month's regular run pays the approved bonus itself.
		const withSalary = Effect.fnUntraced(function* () {
			reset();
			entry(
				'adhoc_catalog_entry',
				'bonus-1',
				'e1',
				catalog('adhoc_catalog', 'bonus', '2026-02'),
				'2026-02-05',
				{ amount: Decimal.of('5000') }
			);
			const salary = yield* run('2026-02', 'REGULAR');
			assert.equal(slip(salary, 'e1').adjustments.length, 1);
			assert.match(yield* refused('2026-02', 'OFF_CYCLE', ['bonus-1']), /not an approved, unpaid/);
			return [salary];
		});
		const first = yield* bonusFirst();
		const bonus = slip(required(first[0]), 'e1');
		assert.equal(required(first[0]).payslips.length, 1);
		assert.equal(bonus.gross, 5000);
		assert.equal(bonus.base.length, 0);
		assert.deepEqual(
			[
				required(line(required(first[0]), 'e1', 'CPF')).employee_amount,
				required(line(required(first[0]), 'e1', 'CPF')).employer_amount
			],
			[1000, 850]
		);
		assert.equal(required(line(required(first[1]), 'e1', 'CPF')).employee_amount, 1300);
		assert.equal(required(line(required(first[1]), 'e1', 'CDAC')).employee_amount, 1.5);
		assert.equal(required(line(required(first[1]), 'e1', 'SDL')).employer_amount, 0);
		const second = yield* withSalary();
		for (const scheme of ['CPF', 'CDAC', 'SDL'])
			for (const field of shares)
				assert.equal(
					total(first, scheme, field),
					total(second, scheme, field),
					`${scheme} ${field}`
				);
		// Paid after the month run: the off-cycle slip charges the month-to-date delta, to the same totals.
		reset();
		const salaryFirst = [yield* run('2026-02', 'REGULAR')];
		entry(
			'adhoc_catalog_entry',
			'bonus-1',
			'e1',
			catalog('adhoc_catalog', 'bonus', '2026-02'),
			'2026-02-05',
			{ amount: Decimal.of('5000') }
		);
		const after = [...salaryFirst, yield* run('2026-02', 'OFF_CYCLE', ['bonus-1'])];
		assert.equal(slip(required(after[1]), 'e1').base.length, 0);
		for (const scheme of ['CPF', 'CDAC', 'SDL'])
			for (const field of shares)
				assert.equal(
					total(first, scheme, field),
					total(after, scheme, field),
					`after ${scheme} ${field}`
				);
	})
);

it.effect(
	'the age band changes the month after the birthday',
	Effect.fnUntraced(function* () {
		reset();
		required(
			required(tables.get('employment_profile')).find((row) => row.id === fixtureId('e2'))
		).date_of_birth = '1971-02-10';
		const march = yield* run('2026-03', 'REGULAR');
		assert.equal(required(line(march, 'e2', 'CPF')).employee_amount, 990); // 5,500 × 18%
		reset();
		required(
			required(tables.get('employment_profile')).find((row) => row.id === fixtureId('e2'))
		).date_of_birth = '1971-03-10';
		const stillMarch = yield* run('2026-03', 'REGULAR');
		assert.equal(required(line(stillMarch, 'e2', 'CPF')).employee_amount, 1100); // 5,500 × 20%
	})
);

it.effect(
	'the AW ceiling projects the year from capped ordinary wages',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('employment_contract')).splice(
			0,
			3,
			contractOf({ ...required(people[1]), salary: 10000 })
		);
		entry(
			'adhoc_catalog_entry',
			'b',
			'e2',
			catalog('adhoc_catalog', 'bonus', '2026-03'),
			'2026-03-05',
			{ amount: Decimal.of('20000') }
		);
		const plan = yield* run('2026-03', 'OFF_CYCLE', ['b']);
		// 102,000 − 8,000 × 10 (March to December, nothing charged yet) = 22,000 of room: the whole bonus is assessed.
		assert.equal(required(line(plan, 'e2', 'CPF')).base_amount, 20000);
		assert.equal(required(line(plan, 'e2', 'CPF')).employee_amount, 4000);
	})
);

it.effect(
	'a run admitted once builds without re-reading its admission (the sync transform has 40 crossings)',
	Effect.fnUntraced(function* () {
		reset();
		entry(
			'adhoc_catalog_entry',
			'b',
			'e2',
			catalog('adhoc_catalog', 'bonus', '2026-03'),
			'2026-03-05',
			{ amount: Decimal.of('1000') }
		);
		yield* world(fixtureTables()).withRead((read) =>
			Effect.gen(function* () {
				const native = yield* NativeReads;
				const counted = vi.spyOn(native, 'run');
				yield* Effect.addFinalizer(() => Effect.sync(() => counted.mockRestore()));
				const request: Parameters<typeof buildPayrollRun>[0] = {
					company_id: COMPANY,
					period: '2026-03',
					kind: 'OFF_CYCLE',
					sources: [fixtureId('b')]
				};
				const provideRead = <A, E>(effect: Effect.Effect<A, E, Reads>) =>
					effect.pipe(Effect.provideService(Reads, readsFrom(read)));
				const admitted = yield* provideRead(admitPayrollRun(request));
				const admission = counted.mock.calls.length;
				counted.mockClear();
				yield* provideRead(buildPayrollRun(request));
				const alone = counted.mock.calls.length;
				counted.mockClear();
				yield* provideRead(buildPayrollRun(request, admitted));
				assert.equal(counted.mock.calls.length, alone - admission);
			})
		);
	})
);

it.effect(
	'a regular run checks over 1000 open candidates and excludes reservations before asynchronous backlinks',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('employment_contract', [contractOf(required(people[1]))]);
		const catalogId = catalog('adhoc_catalog', 'bonus', '2026-03');
		const candidates = Array.from(
			{ length: 1002 },
			(_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
		);
		for (const id of candidates)
			entry('adhoc_catalog_entry', id, 'e2', catalogId, '2026-03-05', { amount: 1 });
		const reservations = [
			[required(candidates[0])],
			[required(candidates.at(-1))],
			[required(candidates[1]), required(candidates[1000])]
		];
		const reserved = reservations.flat();
		const sharedLedgerId = fixtureId('candidate-reservation-2');
		// Separate ledgers force the final candidate's reservation to be found in its own query partition.
		tables.set(
			'payroll_run',
			reservations.map((ids, index) => ({
				id: fixtureId(`candidate-reservation-${index}`),
				company_id: COMPANY,
				settings_id: versionOn('2026-03'),
				period: '2026-03',
				kind: 'OFF_CYCLE',
				sequence: index + 1,
				sources: ids,
				pay_date: PlainDate('2026-03-05'),
				salary_from: PlainDate('2026-03-01'),
				salary_to: PlainDate('2026-03-31'),
				attendance_from: PlainDate('2026-03-01'),
				attendance_to: PlainDate('2026-03-31'),
				pins: ids.map((id) => ({
					collection: 'adhoc_catalog_entry',
					id,
					employment_id: fixtureId('k-e2')
				}))
			}))
		);
		yield* world(fixtureTables()).withRead((read) =>
			Effect.gen(function* () {
				const open = (yield* read('adhoc_catalog_entry', {
					where: { payslip_id: { isNull: true } },
					select: { id: true, payslip_id: true },
					all: true
				})).rows;
				assert.deepEqual(
					open.map((row) => row.id),
					candidates
				);
				const native = yield* NativeReads;
				const run = native.run;
				const returnedLedgers: string[] = [];
				const counted = vi.spyOn(native, 'run').mockImplementation((batch, reader, bindings) =>
					run(batch, reader, bindings).pipe(
						Effect.tap((answers) =>
							Effect.sync(() => {
								for (const [index, query] of batch.entries())
									if (
										query.kind === 'read' &&
										query.collection === 'payroll_run' &&
										query.select.fields?.includes('pins')
									)
										returnedLedgers.push(
											...records(record(answers[index]).rows).map((row) => String(row.id))
										);
							})
						)
					)
				);
				yield* Effect.addFinalizer(() => Effect.sync(() => counted.mockRestore()));
				const plan = yield* buildPayrollRun({
					company_id: COMPANY,
					period: '2026-03',
					kind: 'REGULAR'
				}).pipe(Effect.provideService(Reads, readsFrom(read)));
				assert.equal(returnedLedgers.filter((id) => id === sharedLedgerId).length, 1);
				const payslip = slip(plan, 'e2');
				const unreserved = candidates.filter((id) => !reserved.includes(id));
				assert.deepEqual(
					payslip.pins
						.filter((pin) => pin.collection === 'adhoc_catalog_entry')
						.map((pin) => pin.id)
						.sort(),
					unreserved
				);
				assert.deepEqual(payslip.adjustments.map((row) => row.source_id).sort(), unreserved);
				assert.equal(
					payslip.adjustments.reduce((sum, row) => sum + row.amount, 0),
					998
				);
				assert.equal(payslip.gross, 6498);
				const locks = yield* PayrollAdmission.entrySettlementLocks(
					readsFrom(read).read,
					'adhoc_catalog_entry',
					candidates
				);
				assert.deepEqual([...locks.keys()].sort(), [...reserved].sort());
				assert.ok([...locks.values()].every((allowed) => allowed.size === 0));
				for (const id of reserved) {
					const source = required(
						(yield* read('adhoc_catalog_entry', {
							where: { id: { eq: nativeId('adhoc_catalog_entry', id) } },
							select: { payslip_id: true },
							all: true
						})).rows[0]
					);
					assert.equal(source.payslip_id, null);
				}
			})
		);
	}),
	15_000
);

it.effect(
	'a June run pages a roster over 4 MiB and prices overtime from its last page',
	Effect.fnUntraced(function* () {
		reset();
		const version = required(
			required(tables.get('jurisdiction_settings')).find((row) => row.id === versionOn('2026-06'))
		);
		version.payroll = { ...record(version.payroll), rolling_hours_months: 24 };
		const contract = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e3'))
		);
		required(records(record(contract.facts).contract_terms)[0]).base_salary = {
			value: 2600,
			currency: 'SGD'
		};
		const roster = required(tables.get('roster_entry'));
		for (let index = 0; index < 1500; index++)
			roster.push({
				id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
				employment_id: nativeId(
					'employment_contract',
					fixtureId(`k-${required(people[index % people.length]).id}`)
				),
				work_date: addDays('2025-01-01', Math.floor(index / people.length)),
				facts: { note: 'x'.repeat(3000) }
			});
		const last = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
		roster.push({
			id: last,
			employment_id: nativeId('employment_contract', contract.id),
			work_date: PlainDate('2026-06-10'),
			planned_overtime_hours: 4,
			worked_intervals: clocked('2026-06-10', 4)
		});
		assert.ok(Buffer.byteLength(JSON.stringify(roster)) > 4 * 1024 * 1024);
		yield* world(fixtureTables()).withRead((read) =>
			Effect.gen(function* () {
				const native = yield* NativeReads;
				const run = native.run;
				const sizes: number[] = [];
				const counted = vi
					.spyOn(native, 'run')
					.mockImplementation((batch, reader, bindings) =>
						run(batch, reader, bindings).pipe(
							Effect.tap((answer) =>
								Effect.sync(() => sizes.push(Buffer.byteLength(JSON.stringify(answer))))
							)
						)
					);
				yield* Effect.addFinalizer(() => Effect.sync(() => counted.mockRestore()));
				const plan = yield* buildPayrollRun({
					company_id: COMPANY,
					period: '2026-06',
					kind: 'REGULAR'
				}).pipe(Effect.provideService(Reads, readsFrom(read)));
				assert.ok(Math.max(...sizes) < 4 * 1024 * 1024);
				assert.ok(counted.mock.calls.length < 40);
				const payslip = slip(plan, 'e3');
				assert.equal(
					required(payslip.base.find((row) => row.component_code === 'OVERTIME')).amount,
					70.8
				);
				assert.ok(payslip.pins.some((pin) => pin.collection === 'roster_entry' && pin.id === last));
			})
		);
	})
);

it.effect(
	'MBMF is charged on the ISLAM religion code; SPR year one uses the graduated rates',
	Effect.fnUntraced(function* () {
		reset();
		const contracts = required(tables.get('employment_contract'));
		contracts.splice(2, 1, contractOf({ ...required(people[2]), religion: 'ISLAM' }));
		contracts.splice(0, 1, contractOf({ ...required(people[0]), since: '2025-10-15' }));
		const plan = yield* run('2026-03', 'REGULAR');
		assert.equal(required(line(plan, 'e3', 'MBMF')).employee_amount, 19.5);
		assert.equal(required(line(plan, 'e1', 'CPF')).employee_amount, 325); // 6,500 × 5%
		assert.equal(required(line(plan, 'e1', 'CPF')).employer_amount, 260); // round(6,500 × 9%) − 325
	})
);

it.effect(
	'settlement runs refuse without sources and salary runs refuse a second time',
	Effect.fnUntraced(function* () {
		reset();
		assert.match(yield* refused('2026-03', 'OFF_CYCLE', []), /select at least one/);
		assert.match(yield* refused('2026-03', 'OFF_CYCLE', ['nope']), /not an approved, unpaid/);
		yield* run('2026-03', 'REGULAR');
		assert.match(yield* refused('2026-03', 'REGULAR'), /already has a salary run/);
	})
);

it.effect(
	'M22: a run is created only as a declared kind; one that names none takes the model default REGULAR',
	Effect.fnUntraced(function* () {
		reset();
		yield* world(fixtureTables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const accepted = yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-03'
				});
				assert.equal(accepted.kind, 'committed');
				const [stored] = (yield* actor.read('payroll_run', { select: { kind: true }, all: true }))
					.rows;
				assert.equal(stored?.kind, 'REGULAR');
			})
		);
	})
);

it.effect(
	'a batch cannot create two salary runs that consume the same work period',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('employment_contract', [contractOf({ ...required(people[2]), salary: 2000 })]);
		const workId = fixtureId('batch-payroll-work');
		required(tables.get('roster_entry')).push({
			id: workId,
			employment_id: nativeId('employment_contract', fixtureId('k-e3')),
			work_date: PlainDate('2026-03-10'),
			planned_overtime_hours: 2,
			worked_intervals: clocked('2026-03-10', 2)
		});
		yield* world(fixtureTables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const request = { company_id: COMPANY, period: '2026-03', kind: 'REGULAR' as const };
				const refused = yield* Effect.flip(actor.act('payroll_run.create', [request, request]));
				assert.match(refused.message, /one payroll run per entity at a time/i);
				assert.equal((yield* actor.read('payroll_run', { all: true })).rows.length, 0);
				assert.equal((yield* actor.read('payslip', { all: true })).rows.length, 0);
				assert.equal((yield* actor.read('roster_entry', { all: true })).rows[0]?.payslip_id, null);
				const accepted = yield* actor.act('payroll_run.create', request);
				assert.equal(accepted.kind, 'committed');
				yield* t.runDue();
				const slips = (yield* actor.read('payslip', { select: { base: true }, all: true })).rows;
				assert.equal(slips.length, 1);
				const paidWork = yield* Effect.fromResult(
					fieldValue(required(slips[0]).base, 'payslip.base')
				);
				assert.equal(
					required(paidWork?.find((line) => line.component_code === 'OVERTIME')).amount,
					31.47
				);
				const work = (yield* actor.read('roster_entry', { all: true })).rows;
				assert.equal(
					required(work.find((row) => row.id === workId)).payslip_id,
					required(slips[0]).id
				);
				const repeated = yield* Effect.flip(actor.act('payroll_run.create', request));
				assert.match(repeated.message, /already has a salary run/i);
				assert.equal((yield* actor.read('payslip', { all: true })).rows.length, 1);
			})
		);
	}),
	15_000
);

const pendingPayrollSources = () => {
	reset();
	tables.set('employment_contract', [
		contractOf(required(people[1]), {
			allowances: [{ code: 'FIXED_MONTHLY', amount: { value: 310, currency: 'SGD' } }]
		})
	]);
	payrollOf('2026-03', { off_cycle_families: ['ADHOC', 'CLAIM', 'LOAN_REPAYMENT'] });
	entry(
		'adhoc_catalog_entry',
		'pending-bonus',
		'e2',
		catalog('adhoc_catalog', 'bonus', '2026-03'),
		'2026-03-05',
		{ amount: Decimal.of('1000') }
	);
	entry(
		'loan_repayment_entry',
		'pending-repayment',
		'e2',
		catalog('loan_catalog', 'SALARY_ADVANCE', '2026-03'),
		'2026-03-20',
		{ amount: Decimal.of('250') }
	);
	return [fixtureId('pending-bonus'), fixtureId('pending-repayment')];
};

it.effect(
	'concurrent payroll creates reserve exact source entries before asynchronous pins and release them after unpaid deletion',
	Effect.fnUntraced(function* () {
		const sources = pendingPayrollSources();
		yield* world(fixtureTables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const request = {
					company_id: COMPANY,
					period: '2026-03',
					kind: 'OFF_CYCLE' as const,
					sources
				};
				const results = yield* Effect.all(
					[
						Effect.result(actor.act('payroll_run.create', request)),
						Effect.result(actor.act('payroll_run.create', request))
					],
					{ concurrency: 'unbounded' }
				);
				const successes = results.filter(Result.isSuccess);
				assert.equal(successes.length, 1);
				assert.equal(results.filter(Result.isFailure).length, 1);
				const first = required(successes[0]).success;
				assert.equal(first.kind, 'committed');
				const originalRun = required(first.records.find((row) => row.collection === 'payroll_run'));
				assert.equal((yield* actor.read('payroll_run', { all: true })).rows.length, 1);
				assert.equal(
					(yield* actor.read('loan_repayment_entry', { all: true })).rows[0]?.payslip_id,
					null
				);
				const repeated = yield* Effect.flip(actor.act('payroll_run.create', request));
				assert.match(repeated.message, /not an approved, unpaid entry/i);
				yield* actor.act('payroll_run.delete', {
					target: [nativeId('payroll_run', originalRun.id)]
				});
				const reused = yield* actor.act('payroll_run.create', request);
				assert.equal(reused.kind, 'committed');
				const reusedRun = required(reused.records.find((row) => row.collection === 'payroll_run'));
				assert.notEqual(reusedRun.id, originalRun.id);
				const regular = yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-03',
					kind: 'REGULAR'
				});
				assert.equal(regular.kind, 'committed');
				const regularRun = required(
					regular.records.find((row) => row.collection === 'payroll_run')
				);
				const regularSlip = required(
					(yield* actor.read('payslip', {
						where: { payroll_run_id: { eq: nativeId('payroll_run', regularRun.id) } },
						select: { base: true, adjustments: true },
						all: true
					})).rows[0]
				);
				const base = yield* Effect.fromResult(fieldValue(regularSlip.base, 'payslip.base'));
				assert.equal(
					required(base?.find((row) => row.component_code === 'FIXED_MONTHLY')).amount,
					310
				);
				const adjustments = yield* Effect.fromResult(
					fieldValue(regularSlip.adjustments, 'payslip.adjustments')
				);
				assert.ok(!(adjustments ?? []).some((row) => sources.includes(row.source_id)));
				yield* t.runDue();
				const repayment = required(
					(yield* actor.read('loan_repayment_entry', { all: true })).rows[0]
				);
				const offSlip = required(
					(yield* actor.read('payslip', {
						where: { payroll_run_id: { eq: nativeId('payroll_run', reusedRun.id) } },
						all: true
					})).rows[0]
				);
				assert.equal(repayment.payslip_id, offSlip.id);
				assert.notEqual(repayment.payslip_id, regularSlip.id);
				assert.equal(
					moneyNumber(
						(yield* actor.read('loan_catalog_entry', { all: true })).rows[0]?.principal_amount
					),
					250
				);
				assert.equal((yield* actor.read('payslip', { all: true })).rows.length, 2);
			})
		);
	}),
	15_000
);

it.effect(
	'a payroll batch requires sequential calculations for one entity, including disjoint entries and different periods',
	Effect.fnUntraced(function* () {
		const sources = pendingPayrollSources();
		entry(
			'adhoc_catalog_entry',
			'next-bonus',
			'e2',
			catalog('adhoc_catalog', 'bonus', '2026-03'),
			'2026-03-06',
			{ amount: Decimal.of('500') }
		);
		yield* world(fixtureTables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const off = { company_id: COMPANY, period: '2026-03', kind: 'OFF_CYCLE' as const, sources };
				const next = { ...off, sources: [fixtureId('next-bonus')] };
				const regular = { company_id: COMPANY, period: '2026-03', kind: 'REGULAR' as const };
				for (const requests of [
					[off, off],
					[regular, off],
					[off, regular],
					[off, next],
					[regular, { ...regular, period: '2026-04' }]
				]) {
					const refused = yield* Effect.flip(actor.act('payroll_run.create', requests));
					assert.match(refused.message, /one payroll run per entity at a time/i);
					assert.equal((yield* actor.read('payroll_run', { all: true })).rows.length, 0);
					assert.equal((yield* actor.read('payslip', { all: true })).rows.length, 0);
					assert.equal(
						(yield* actor.read('loan_repayment_entry', { all: true })).rows[0]?.payslip_id,
						null
					);
				}
				assert.equal((yield* actor.act('payroll_run.create', off)).kind, 'committed');
				assert.equal((yield* actor.act('payroll_run.create', next)).kind, 'committed');
				const slips = (yield* actor.read('payslip', { select: { statutory: true }, all: true }))
					.rows;
				assert.equal(slips.length, 2);
				const statutory = yield* Effect.all(
					slips.map((slip) => Effect.fromResult(fieldValue(slip.statutory, 'payslip.statutory')))
				);
				const sdl = statutory
					.flatMap((lines) => lines ?? [])
					.filter((line) => line.scheme_code === 'SDL');
				assert.deepEqual(
					sdl.map((line) => line.employer_amount).sort((a, b) => a - b),
					[1.25, 2.5]
				);
			})
		);
	}),
	15_000
);

it.effect(
	'a loan principal generates monthly repayments; payroll prorates standing allowances and locks only due repayments',
	Effect.fnUntraced(function* () {
		reset();
		const contract = contractOf(required(people[1]), {
			effective_range: { from: PlainDate('2026-03-16'), to: null },
			allowances: [{ code: 'FIXED_MONTHLY', amount: { value: 310, currency: 'SGD' } }]
		});
		contract.effective_range = { from: PlainDate('2026-03-16'), to: null };
		tables.set('employment_contract', [contract]);
		yield* world(fixtureTables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.admin);
				const created = yield* actor.act('loan_catalog_entry.create', {
					catalog_id: catalog('loan_catalog', 'SALARY_ADVANCE', '2026-03'),
					employment_id: nativeId('employment_contract', fixtureId('k-e2')),
					principal_amount: Decimal.of('1000'),
					repayment_period: { from: PlainDate('2026-03-20'), to: PlainDate('2026-06-20') },
					repayment_frequency: 'MONTHLY'
				});
				assert.ok(created.kind === 'committed');
				const loan = required(
					created.records.find((row) => row.collection === 'loan_catalog_entry')
				);
				const repayments = (yield* actor.read('loan_repayment_entry', {
					where: { loan_id: { eq: nativeId('loan_catalog_entry', loan.id) } },
					select: { occurred_on: true, amount: true, payslip_id: true },
					all: true
				})).rows.toSorted((a, b) => a.occurred_on.localeCompare(b.occurred_on));
				assert.deepEqual(
					repayments.map((row) => [row.occurred_on, moneyNumber(row.amount)]),
					[
						['2026-03-20', 250],
						['2026-04-20', 250],
						['2026-05-20', 250],
						['2026-06-20', 250]
					]
				);
				const due = required(repayments[0]);
				const built = yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-03',
					kind: 'REGULAR'
				});
				assert.ok(built.kind === 'committed');
				yield* t.runDue();
				const run = required(built.records.find((row) => row.collection === 'payroll_run'));
				const slips = (yield* actor.read('payslip', {
					where: { payroll_run_id: { eq: nativeId('payroll_run', run.id) } },
					select: { base: true, adjustments: true, employment_id: true, gross: true },
					all: true
				})).rows;
				const slip = required(slips.find((row) => row.employment_id === fixtureId('k-e2')));
				const base = yield* Effect.fromResult(fieldValue(slip.base, 'payslip.base'));
				// One standing allowance pays 12 of March's 22 working days, alongside the partial-month salary.
				assert.equal(required(base?.find((line) => line.component_code === 'BASIC')).amount, 3000);
				assert.equal(
					required(base?.find((line) => line.component_code === 'FIXED_MONTHLY')).amount,
					169.09
				);
				assert.equal(moneyNumber(slip.gross), 3169.09);
				const adjustments = yield* Effect.fromResult(
					fieldValue(slip.adjustments, 'payslip.adjustments')
				);
				const adjustment = required(adjustments?.find((line) => line.family === 'LOAN_REPAYMENT'));
				assert.equal(adjustment.amount, -250);
				assert.equal(adjustment.source_id, due.id);
				assert.notEqual(adjustment.source_id, loan.id);
				const pinned = (yield* actor.read('loan_repayment_entry', {
					where: { loan_id: { eq: nativeId('loan_catalog_entry', loan.id) } },
					select: { payslip_id: true },
					all: true
				})).rows;
				assert.equal(required(pinned.find((row) => row.id === due.id)).payslip_id, slip.id);
				assert.equal(pinned.filter((row) => row.payslip_id != null).length, 1);
				const edit = yield* Effect.flip(
					actor.act('loan_repayment_entry.update', {
						target: [due.id],
						set: { amount: Decimal.of('200') }
					})
				);
				assert.match(edit.message, /settled|consumed|payroll|payslip/i);
				const unlink = yield* Effect.flip(
					actor.act('loan_repayment_entry.update', {
						target: [due.id],
						set: { payslip_id: null }
					})
				);
				assert.match(unlink.message, /settled|payroll|payslip/i);
				const parentEdit = yield* Effect.flip(
					actor.act('loan_catalog_entry.update', {
						target: [nativeId('loan_catalog_entry', loan.id)],
						set: {
							repayments: {
								update: [
									{ target: due.id, set: { amount: Decimal.of('200') } },
									{ target: required(repayments[1]).id, set: { amount: Decimal.of('300') } }
								]
							}
						}
					})
				);
				assert.match(parentEdit.message, /settled|payslip/i);
				const currentContract = required(
					(yield* actor.read('employment_contract', {
						where: { id: { eq: nativeId('employment_contract', fixtureId('k-e2')) } },
						select: { facts: true },
						all: true
					})).rows[0]
				);
				const facts = yield* Effect.fromResult(
					fieldValue(currentContract.facts, 'employment_contract.facts')
				);
				assert.ok(facts?.contract_terms);
				const changedAllowance = {
					...facts,
					contract_terms: facts.contract_terms.map((term) => ({
						...term,
						...(term.allowances == null
							? {}
							: {
									allowances: term.allowances.map((allowance) => ({
										...allowance,
										amount: { ...allowance.amount, value: 620 }
									}))
								})
					}))
				};
				const allowanceEdit = yield* Effect.flip(
					actor.act('employment_contract.update', {
						target: [currentContract.id],
						set: { facts: changedAllowance }
					})
				);
				assert.match(allowanceEdit.message, /paid through 2026-03-31/i);
				yield* actor.act('payroll_run.delete', { target: [nativeId('payroll_run', run.id)] });
				yield* t.runDue();
				const released = (yield* actor.read('loan_repayment_entry', {
					where: { id: { eq: due.id } },
					select: { payslip_id: true },
					all: true
				})).rows;
				assert.equal(required(released[0]).payslip_id, null);
				yield* actor.act('loan_repayment_entry.update', {
					target: [due.id],
					set: { occurred_on: PlainDate('2026-03-23') }
				});
				const rebuilt = yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-03',
					kind: 'REGULAR'
				});
				assert.ok(rebuilt.kind === 'committed');
				yield* t.runDue();
				const repinned = (yield* actor.read('loan_repayment_entry', {
					where: { id: { eq: due.id } },
					select: { payslip_id: true, occurred_on: true, amount: true },
					all: true
				})).rows;
				const rebuiltSlipId = required(required(repinned[0]).payslip_id);
				assert.notEqual(rebuiltSlipId, slip.id);
				assert.equal(required(repinned[0]).occurred_on, '2026-03-23');
				assert.equal(moneyNumber(required(repinned[0]).amount), 250);
				const rebuiltSlip = required(
					(yield* actor.read('payslip', {
						where: { id: { eq: rebuiltSlipId } },
						select: { base: true, adjustments: true },
						all: true
					})).rows[0]
				);
				const rebuiltAdjustments = yield* Effect.fromResult(
					fieldValue(rebuiltSlip.adjustments, 'payslip.adjustments')
				);
				assert.equal(
					required(rebuiltAdjustments?.find((line) => line.family === 'LOAN_REPAYMENT')).source_id,
					due.id
				);
				assert.equal(
					required(rebuiltAdjustments?.find((line) => line.family === 'LOAN_REPAYMENT')).amount,
					-250
				);
				const april = yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-04',
					kind: 'REGULAR'
				});
				assert.ok(april.kind === 'committed');
				yield* t.runDue();
				const aprilRun = required(april.records.find((row) => row.collection === 'payroll_run'));
				const aprilSlip = required(
					(yield* actor.read('payslip', {
						where: { payroll_run_id: { eq: nativeId('payroll_run', aprilRun.id) } },
						select: { base: true, adjustments: true, gross: true },
						all: true
					})).rows[0]
				);
				const aprilBase = yield* Effect.fromResult(fieldValue(aprilSlip.base, 'payslip.base'));
				assert.equal(
					required(aprilBase?.find((line) => line.component_code === 'FIXED_MONTHLY')).amount,
					310
				);
				assert.equal(moneyNumber(aprilSlip.gross), 5810);
				const aprilAdjustments = yield* Effect.fromResult(
					fieldValue(aprilSlip.adjustments, 'payslip.adjustments')
				);
				assert.equal(
					required(aprilAdjustments?.find((line) => line.family === 'LOAN_REPAYMENT')).source_id,
					required(repayments[1]).id
				);
				assert.equal(
					required(aprilAdjustments?.find((line) => line.family === 'LOAN_REPAYMENT')).amount,
					-250
				);
				yield* actor.act('payslip.update', {
					target: [rebuiltSlipId],
					set: { status: 'PAID', paid_at: Instant('2026-04-01T00:00:00.000Z') }
				});
				yield* Effect.flip(
					actor.act('payslip.update', {
						target: [rebuiltSlipId],
						set: { base: [] }
					})
				);
				const paidState = required(
					(yield* actor.read('payslip', {
						where: { id: { eq: rebuiltSlipId } },
						select: { status: true, payroll_run_id: true },
						all: true
					})).rows[0]
				);
				assert.equal(paidState.status, 'PAID');
				assert.equal(
					paidState.payroll_run_id,
					required(rebuilt.records.find((row) => row.collection === 'payroll_run')).id
				);
				const paidDelete = yield* Effect.flip(
					t.as(t.member(['hr_manager'])).act('payroll_run.delete', {
						target: [
							nativeId(
								'payroll_run',
								required(rebuilt.records.find((row) => row.collection === 'payroll_run')).id
							)
						]
					})
				);
				assert.match(paidDelete.message, /paid payslip/i);
				const paidSlip = required(
					(yield* actor.read('payslip', {
						where: { id: { eq: rebuiltSlipId } },
						select: { base: true, adjustments: true },
						all: true
					})).rows[0]
				);
				assert.deepEqual(paidSlip.base, rebuiltSlip.base);
				assert.deepEqual(paidSlip.adjustments, rebuiltSlip.adjustments);
			})
		);
	}),
	15_000
);

it.effect(
	'the salary export query lists actual consumed loan repayment amounts, keeping the principal out',
	Effect.fnUntraced(function* () {
		reset();
		entry(
			'loan_repayment_entry',
			'export-repayment',
			'e2',
			catalog('loan_catalog', 'SALARY_ADVANCE', '2026-03'),
			'2026-03-20',
			{ amount: Decimal.of('250') }
		);
		yield* run('2026-03', 'REGULAR');
		yield* world(fixtureTables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.admin);
				const run = required(
					(yield* actor.read('payroll_run', { all: true })).rows.find(
						(row) => row.period === '2026-03'
					)
				);
				const exported = yield* actor.query('payroll_run.export_payroll', {
					ids: [run.id],
					kind: 'SALARY'
				});
				assert.equal(exported.documents.length, 0);
				assert.equal(exported.salary_reports.length, 1);
				const listing = required(exported.salary_reports[0]);
				const loanColumn = listing.columns.findIndex(
					(column) => column.family === 'LOAN_REPAYMENT' && column.code === 'SALARY_ADVANCE'
				);
				assert.ok(loanColumn >= 0);
				const employeeRow = required(listing.rows.find((row) => row.employee_number === 'e2'));
				assert.equal(employeeRow.amounts[loanColumn], 250);
				assert.equal(listing.columns.at(-1)?.label, 'Total company payment');
			})
		);
	})
);

it.effect(
	'the salary export query flags only a consumed outside-net cost, using the governing snapshot rather than the source amount',
	Effect.fnUntraced(function* () {
		reset();
		const plan = yield* run('2026-03', 'REGULAR');
		const storedRun = required(required(tables.get('payroll_run')).at(-1));
		for (const storedSlip of required(tables.get('payslip')))
			storedSlip.bank_charges = Decimal.of('0');
		const governing = required(
			required(tables.get('jurisdiction_settings')).find((row) => row.id === storedRun.settings_id)
		);
		const earlier = required(
			required(tables.get('jurisdiction_settings')).find((row) => row.id !== governing.id)
		);
		governing.code = 'ID';
		const code = 'KESEHATAN_TERMINATION_MONTH_EMPLOYER';
		const sourceClass = fixtureId('older-employer-cost');
		required(tables.get('adhoc_catalog')).push(
			{
				id: sourceClass,
				settings_id: earlier.id,
				code,
				name: 'Employer BPJS',
				destination: 'PAY',
				direction: 'ADD',
				counts_toward: [],
				bands: [{ when: '', amount: 'entry.amount' }]
			},
			{
				id: fixtureId('governing-employer-cost'),
				settings_id: governing.id,
				code,
				name: 'Employer BPJS',
				destination: 'EMPLOYER',
				direction: 'ADD',
				counts_toward: [],
				bands: [{ when: '', amount: 'entry.amount' }]
			}
		);
		entry('adhoc_catalog_entry', 'consumed-outside-net', 'e2', sourceClass, '2026-03-10', {
			amount: Decimal.of('999999'),
			payslip_id: lastSlipId('e2')
		});
		entry('adhoc_catalog_entry', 'not-consumed-outside-net', 'e1', sourceClass, '2026-03-10', {
			amount: Decimal.of('999999')
		});
		entry('adhoc_catalog_entry', 'other-run-outside-net', 'e3', sourceClass, '2026-03-10', {
			amount: Decimal.of('999999'),
			payslip_id: fixtureId('paid')
		});
		yield* world(fixtureTables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const listing = required(
					(yield* t.as(t.admin).query('payroll_run.export_payroll', {
						ids: [nativeId('payroll_run', storedRun.id)],
						kind: 'SALARY'
					})).salary_reports[0]
				);
				const company = listing.columns.findIndex((column) => column.code === 'COMPANY_PAYMENT');
				const net = listing.columns.findIndex(
					(column) => column.family === 'TOTAL' && column.code === 'NET'
				);
				const affected = required(listing.rows.find((row) => row.employee_number === 'e2'));
				assert.equal(affected.amounts[company], null);
				assert.equal(affected.amounts[net], slip(plan, 'e2').net);
				for (const employee of ['e1', 'e3'])
					assert.equal(
						typeof required(listing.rows.find((row) => row.employee_number === employee)).amounts[
							company
						],
						'number'
					);
				assert.match(listing.warnings[0] ?? '', /KESEHATAN_TERMINATION_MONTH_EMPLOYER/);
				assert.ok(!listing.columns.some((column) => column.code === code));
			})
		);
	})
);

it.effect(
	'the salary export uses captured company-paid claim limits and reversals, separate from employee pay',
	Effect.fnUntraced(function* () {
		reset();
		const settings_id = versionOn('2026-03');
		const code = 'DIRECT_MEDICAL_TEST';
		const catalog_id = fixtureId('direct-medical-test');
		required(tables.get('claim_catalog')).push({
			id: catalog_id,
			settings_id,
			code,
			name: 'Company-paid medical',
			destination: 'EMPLOYER',
			direction: 'ADD',
			counts_toward: [],
			bands: [
				{
					when: '',
					amount: 'entry.amount',
					limit: { on_exceed: 'BLOCK', amount: '100.0', window: 'PERIOD' }
				}
			]
		});
		const profile = required(
			required(tables.get('rule_set')).find(
				(row) => row.settings_id === settings_id && row.code === 'salary_report'
			)
		);
		const rules = record(profile.rules);
		profile.rules = {
			...rules,
			items: [...records(rules.items), { family: 'CLAIM', code, payment: 'OUTSIDE_NET' }]
		};
		entry('claim_catalog_entry', 'direct-visit-1', 'e2', catalog_id, '2026-03-05', { amount: 70 });
		entry('claim_catalog_entry', 'direct-visit-2', 'e2', catalog_id, '2026-03-06', { amount: 70 });
		entry(
			'claim_catalog_entry',
			'direct-reversal',
			'e2',
			catalog_id,
			'2026-03-07',
			{ amount: 10 },
			'REVERSAL'
		);
		yield* world(fixtureTables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.admin);
				const built = yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-03',
					kind: 'REGULAR'
				});
				assert.ok(built.kind === 'committed');
				yield* t.runDue();
				const storedRun = required(built.records.find((row) => row.collection === 'payroll_run'));
				const runId = nativeId('payroll_run', storedRun.id);
				const slips = (yield* actor.read('payslip', {
					where: { payroll_run_id: { eq: runId } },
					select: {
						employment_id: true,
						company_payments: true,
						adjustments: true,
						statutory: true,
						gross: true,
						net: true
					},
					all: true
				})).rows;
				const settled = required(slips.find((row) => row.employment_id === fixtureId('k-e2')));
				assert.equal(moneyNumber(settled.gross), 5500);
				assert.equal(moneyNumber(settled.net), 4398);
				assert.deepEqual(
					yield* Effect.fromResult(fieldValue(settled.adjustments, 'payslip.adjustments')),
					[]
				);
				const payments = yield* Effect.fromResult(
					fieldValue(settled.company_payments, 'payslip.company_payments')
				);
				assert.equal(payments?.length, 3);
				assert.deepEqual(
					Object.fromEntries(payments?.map((payment) => [payment.source_id, payment.amount]) ?? []),
					{
						[fixtureId('direct-visit-1')]: 70,
						[fixtureId('direct-visit-2')]: 30,
						[fixtureId('direct-reversal')]: -10
					}
				);
				const run = required(
					(yield* actor.read('payroll_run', {
						where: { id: { eq: runId } },
						select: { pins: true },
						all: true
					})).rows[0]
				);
				const pins = records(yield* Effect.fromResult(fieldValue(run.pins, 'payroll_run.pins')));
				const sources = (yield* actor.read('claim_catalog_entry', {
					where: { catalog_id: { eq: nativeId('claim_catalog', catalog_id) } },
					select: { payslip_id: true },
					all: true
				})).rows;
				assert.equal(sources.length, 3);
				for (const source of sources) {
					assert.equal(source.payslip_id, settled.id);
					assert.ok(
						pins.some((pin) => pin.collection === 'claim_catalog_entry' && pin.id === source.id)
					);
				}
				yield* actor.act(
					'payslip.update',
					slips.map((slip) => ({ target: slip.id, set: { bank_charges: Decimal.of('0') } }))
				);
				const listing = required(
					(yield* actor.query('payroll_run.export_payroll', {
						ids: [runId],
						kind: 'SALARY'
					})).salary_reports[0]
				);
				const row = required(listing.rows.find((row) => row.employee_number === 'e2'));
				const companyPaid = listing.columns.findIndex(
					(column) => column.family === 'CLAIM' && column.code === code
				);
				assert.equal(row.amounts[companyPaid], 90);
				assert.equal(listing.columns[companyPaid]?.external, true);
				const charges = yield* Effect.fromResult(
					fieldValue(settled.statutory, 'payslip.statutory')
				);
				const statutory = (charges ?? []).reduce(
					(sum, line) =>
						sum
							.plus(Decimal.of(String(line.employee_amount)))
							.plus(Decimal.of(String(line.employer_amount))),
					Decimal.of('0')
				);
				assert.equal(
					row.amounts.at(-1),
					Decimal.of(String(moneyNumber(settled.net)))
						.plus(statutory)
						.plus(Decimal.of('90'))
						.toNumber()
				);
				assert.deepEqual(listing.warnings, []);
			})
		);
	}),
	15_000
);

it.effect(
	'loan eligibility uses the principal loan, while its payslip line uses only the repayment amount',
	Effect.fnUntraced(function* () {
		reset();
		const loanClass = catalog('loan_catalog', 'SALARY_ADVANCE', '2026-03');
		required(required(tables.get('loan_catalog')).find((row) => row.id === loanClass)).eligibility =
			'entry.facts.principal <= 1000.0';
		entry('loan_repayment_entry', 'actual-principal', 'e2', loanClass, '2026-03-20', {
			amount: Decimal.of('250')
		});
		const parent = required(required(tables.get('loan_catalog_entry'))[0]);
		parent.principal_amount = Decimal.of('1001');
		assert.match(yield* refused('2026-03', 'REGULAR'), /not available/);
		parent.principal_amount = Decimal.of('1000');
		const plan = yield* run('2026-03', 'REGULAR');
		const repayment = required(
			slip(plan, 'e2').adjustments.find((row) => row.family === 'LOAN_REPAYMENT')
		);
		assert.equal(repayment.amount, -250);
		assert.equal(repayment.source_id, fixtureId('actual-principal'));
		assert.ok(
			slip(plan, 'e2').pins.some(
				(pin) => pin.collection === 'loan_repayment_entry' && pin.id === repayment.source_id
			)
		);
		assert.ok(!slip(plan, 'e2').pins.some((pin) => pin.id === parent.id));
	})
);

it.effect(
	'a reversal subtracts, a loan deducts from net, no-pay leave prorates',
	Effect.fnUntraced(function* () {
		reset();
		entry(
			'adhoc_catalog_entry',
			'v',
			'e2',
			catalog('adhoc_catalog', 'bonus', '2026-03'),
			'2026-03-05',
			{ amount: Decimal.of('500') },
			'REVERSAL'
		);
		entry(
			'loan_repayment_entry',
			'l',
			'e2',
			catalog('loan_catalog', 'SALARY_ADVANCE', '2026-03'),
			'2026-03-20',
			{ amount: Decimal.of('300') }
		);
		entry(
			'leave_catalog_entry',
			'n',
			'e3',
			catalog('leave_catalog', 'UNPAID_LEAVE', '2026-03'),
			'2026-03-10',
			{ days: 2 },
			'TIME_OFF'
		);
		const plan = yield* run('2026-03', 'REGULAR');
		const shelly = slip(plan, 'e2');
		assert.equal(shelly.gross, 5000);
		// The reversal cannot take the month's additional wage below zero: CPF stays on 5,500 of ordinary wage; CDAC sees 5,000.
		assert.equal(required(line(plan, 'e2', 'CPF')).employee_amount, 1100);
		assert.equal(shelly.total_deductions, 1100 + 1.5 + 300);
		assert.equal(shelly.net, 5000 - 1401.5);
		const dernese = slip(plan, 'e3');
		assert.equal(dernese.gross, 4363.64); // EA s.20A: 4,800 − 2 × 4,800 / 22 working days
		assert.ok(required(required(tables.get('leave_catalog_entry'))[0]).payslip_id != null);
	})
);

it.effect(
	'statutory rules read other schemes’ dated membership without inferring it from amounts',
	Effect.fnUntraced(function* () {
		reset();
		const cpf = required(
			required(tables.get('statutory_contribution_catalog')).find(
				(row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03')
			)
		);
		cpf.configuration = {
			...record(cpf.configuration),
			warn_when: [
				{ when: 'has(standings.CPF) && standings.CPF == "MEMBER"', message: 'declared member' }
			]
		};
		const fact = (from: string, to: string | null) => ({
			statutory_contribution_id: cpf.id,
			effective_range: { from: PlainDate(from), to: to === null ? null : PlainDate(to) },
			status: { kind: 'MEMBER', elections: {} }
		});
		required(
			required(tables.get('employment_profile')).find((row) => row.id === fixtureId('e2'))
		).facts = {
			employment_statutory_facts: [fact('2026-03-01', null)]
		};
		required(
			required(tables.get('employment_profile')).find((row) => row.id === fixtureId('e3'))
		).facts = {
			employment_statutory_facts: [fact('2026-01-01', '2026-02-28'), fact('2026-04-01', null)]
		};
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(plan.warnings, ['Shelly: declared member']);
	})
);

it.effect(
	'missing statutory facts refuse instead of charging nothing',
	Effect.fnUntraced(function* () {
		reset();
		required(
			required(tables.get('employment_profile')).find((row) => row.id === fixtureId('e2'))
		).date_of_birth = null;
		assert.match(
			yield* refused('2026-03', 'REGULAR'),
			/Shelly: CPF needs the employee’s date of birth/
		);
	})
);

it.effect(
	'approved overtime pays 1.5× the hourly basic rate, on SGD 2,250 for a non-workman above it',
	Effect.fnUntraced(function* () {
		reset();
		// Statutory overtime is Part 4's: a non-workman on $2,600 or less (EA s.35), here exactly $2,600 basic.
		const e3 = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e3'))
		);
		required(records(record(e3.facts).contract_terms)[0]).base_salary = {
			value: 2600,
			currency: 'SGD'
		};
		required(tables.get('roster_entry')).push({
			id: fixtureId('d1'),
			employment_id: nativeId('employment_contract', fixtureId('k-e3')),
			payslip_id: null,
			work_date: PlainDate('2026-03-10'),
			planned_overtime_hours: 4,
			worked_intervals: clocked('2026-03-10', 4)
		});
		const plan = yield* run('2026-03', 'REGULAR');
		const overtime = required(
			slip(plan, 'e3').base.find((row) => row.component_code === 'OVERTIME')
		);
		assert.equal(overtime.amount, 70.8); // 4 × 1.5 × 2,250 × 12 ÷ 2,288
		assert.equal(required(required(tables.get('roster_entry'))[0]).payslip_id, lastSlipId('e3'));
	})
);

it.effect(
	'entry admission pins the class in force, refuses an entry without its amount and locks settled entries',
	Effect.fnUntraced(function* () {
		reset();
		const refusals: string[] = [];
		// a December 2025 bonus row, entered for March 2026, is priced by the January 2026 version's row of the same code
		const december = catalog('adhoc_catalog', 'bonus', '2025-12');
		const [admitted] = yield* transformed(
			'adhoc_catalog_entry',
			[
				{
					catalog_id: december,
					employment_id: nativeId('employment_contract', fixtureId('k-e1')),
					occurred_on: PlainDate('2026-03-05'),
					amount: Decimal.of('100')
				}
			],
			{ refusals }
		);
		assert.ok(admitted);
		assert.ok('company_id' in admitted);
		assert.equal(admitted.catalog_id, catalog('adhoc_catalog', 'bonus', '2026-03'));
		assert.equal(admitted.company_id, COMPANY);
		yield* assertFailure(
			transformed(
				'adhoc_catalog_entry',
				[
					{
						catalog_id: december,
						employment_id: nativeId('employment_contract', fixtureId('k-e1')),
						occurred_on: PlainDate('2026-03-05')
					}
				],
				{ refusals }
			)
		);
		assert.match(required(refusals.at(-1)), /Enter the amount/);
		entry('adhoc_catalog_entry', 'settled-entry', 'e1', december, '2026-03-05', {
			amount: Decimal.of('100')
		});
		yield* run('2026-03', 'REGULAR');
		yield* assertFailure(
			transformed('adhoc_catalog_entry', [{ amount: Decimal.of('1') }], {
				existing: ['settled-entry'],
				refusals
			})
		);
		assert.match(required(refusals.at(-1)), /(settled on a payslip|captured by payroll)/);
		yield* assertFailure(
			transformed('adhoc_catalog_entry', [{ payslip_id: nativeId('payslip', fixtureId('p2')) }], {
				refusals
			})
		);
		assert.match(required(refusals.at(-1)), /Only the payroll run that consumed/);
	})
);

const ruleOf = (value: unknown): Behaviour => {
	if (!Schema.is(Behaviour)(value)) throw new Error('expected a behaviour rule');
	return value;
};

it('behaviours: a trigger plans its rules, reads its where through CEL, and returns act-shaped writes', () => {
	const pack = behavioursOf(required(law('jurisdiction_settings')[0])['behaviours']);
	assert.ok(pack);
	const engine = ruleOf(pack.rules.find((rule) => rule.catalog === 'WORK'));
	const pins = ruleOf(pack.rules.find((rule) => rule.target_collection === 'payroll_run'));
	assert.equal(
		triggerMatches(engine, { kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' }),
		true
	);
	assert.equal(
		triggerMatches(engine, { kind: 'catalog', catalog: 'OTHER', event: 'PAYROLL_CREATE' }),
		false
	);
	assert.deepEqual(
		planBehaviours(
			{ version: 1, rules: [pins] },
			{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
			{}
		),
		[]
	);
	const run = {
		id: fixtureId('r1'),
		pins: [
			{
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				collection: 'claim_catalog_entry',
				id: fixtureId('c1')
			},
			{
				employment_id: nativeId('employment_contract', fixtureId('k-e2')),
				collection: 'roster_entry',
				id: fixtureId('x1')
			}
		]
	};
	const context = { event: { collection: 'payroll_run', action: 'created', row: run } };
	assert.equal(
		planBehaviours(
			{ version: 1, rules: [pins] },
			{ kind: 'row', collection: 'payroll_run', event: 'created' },
			context
		).length,
		1
	);
	assert.equal(
		planBehaviours(
			{ version: 1, rules: [pins] },
			{ kind: 'row', collection: 'payroll_run', event: 'updated' },
			{ event: { row: run } }
		).length,
		0
	);
	assert.deepEqual(resolveWhere({ payroll_run_id: { eq: 'event.row.id' } }, context), {
		payroll_run_id: { eq: fixtureId('r1') }
	});
	const writes = effectWrites(pins, {
		...context,
		slips: [
			{ id: fixtureId('s1'), employment_id: nativeId('employment_contract', fixtureId('k-e1')) }
		]
	});
	assert.deepEqual(writes, [
		{
			callable: 'claim_catalog_entry.update',
			collection: 'claim_catalog_entry',
			operation: 'update',
			data: { target: [fixtureId('c1')], set: { payslip_id: fixtureId('s1') } }
		}
	]);
});

it('behaviours: every seeded rule names at most one trigger and every row rule names its effect', () => {
	for (const settings of law('jurisdiction_settings')) {
		const pack = behavioursOf(settings['behaviours']);
		assert.ok(pack, `settings ${String(settings['id'])} behaviours`);
		for (const rule of pack.rules) {
			// a row rule without a target collection answers every collection the taps fire for
			const trigger = [rule.catalog, rule.target_collection].filter((key) => key != null);
			assert.ok(trigger.length <= 1, `rule ${rule.id} has ${trigger.length} triggers`);
			assert.ok(rule.events.length > 0, `rule ${rule.id} has no events`);
			if (rule.catalog == null)
				assert.equal(typeof rule.effect, 'string', `rule ${rule.id} has no effect`);
		}
	}
});

it.effect(
	'an exit encashment pays through the work catalogue line and pins its leave entry',
	Effect.fnUntraced(function* () {
		reset();
		entry(
			'leave_catalog_entry',
			'enc',
			'e1',
			catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03'),
			'2026-03-31',
			{ days: 5 },
			'ENCASHMENT'
		);
		const plan = yield* run('2026-03', 'REGULAR');
		const kavriel = slip(plan, 'e1');
		// 6,500 + 5 × 6,500/22 working days = 7,977.27, priced by the ENCASHMENT work-catalogue line
		assert.equal(kavriel.gross, 7977.27);
		assert.ok(
			kavriel.base.some((row) => row.component_code === 'ENCASHMENT' && row.amount === 1477.27)
		);
		assert.ok(required(required(tables.get('leave_catalog_entry'))[0]).payslip_id != null);
	})
);

const versionOn = (period: string): string =>
	String(
		required(
			required(tables.get('jurisdiction_settings')).find((settings) => {
				const range = rangeOf(settings.effective_range);
				return (
					settings.voided_at == null &&
					range.from <= `${period}-01` &&
					(range.to == null || range.to >= `${period}-01`)
				);
			})
		).id
	);

const holidayWork = () =>
	required(tables.get('work_catalog')).push({
		id: fixtureId('hw'),
		settings_id: versionOn('2026-03'),
		code: 'HOLIDAY_WORK',
		name: 'Public-holiday work',
		component_code: 'HOLIDAY_WORK',
		eligibility: 'work.holidays.exists(h, h.kind == "PUBLIC_HOLIDAY")',
		quantity: '1.0',
		rate: '2.0 * (terms.base_salary / 26.0)',
		destination: 'PAY',
		direction: 'ADD',
		counts_toward: []
	});

it.effect(
	'uses settled overtime for limits without paying its overflow again in a new calculation',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('employment_contract')).splice(
			2,
			1,
			contractOf(required(people[2]), {
				base_salary: { value: 2000, currency: 'SGD' }
			})
		);
		required(tables.get('roster_entry')).push(
			{
				id: fixtureId('settled-overflow'),
				employment_id: nativeId('employment_contract', fixtureId('k-e3')),
				work_date: PlainDate('2026-03-02'),
				planned_overtime_hours: 12,
				worked_intervals: clocked('2026-03-02', 12),
				payslip_id: nativeId('payslip', fixtureId('paid'))
			},
			{
				id: fixtureId('new-approved-overtime'),
				employment_id: nativeId('employment_contract', fixtureId('k-e3')),
				work_date: PlainDate('2026-03-03'),
				planned_overtime_hours: 3,
				worked_intervals: clocked('2026-03-03', 3),
				payslip_id: null
			}
		);
		const plan = yield* run('2026-03', 'REGULAR');
		assert.equal(shown(plan, 'e3', 'OVERTIME'), 47.2);
		assert.equal(shown(plan, 'e3', 'INCENTIVE'), undefined);
		assert.equal(
			slip(plan, 'e3').pins.some((pin) => pin.id === fixtureId('settled-overflow')),
			false
		);
	})
);

it.effect(
	'keeps rest-day holiday approved and payable overtime in a single intersection for tax allocation',
	Effect.fnUntraced(function* () {
		reset();
		shows('APPROVED_OT', 'hours.month.overtime_hours');
		shows('PAYABLE_OT', 'hours.month.paid_overtime_hours');
		shows(
			'REST_HOLIDAY_OT',
			'hours.month.day_type_holiday_kind.REST.PUBLIC_HOLIDAY.paid_overtime_hours',
			'1.0',
			'has(hours.month.day_type_holiday_kind.REST)'
		);
		required(tables.get('holiday')).push({
			id: fixtureId('holiday-rest-intersection'),
			company_id: COMPANY,
			date: PlainDate('2026-03-08'),
			name: 'Rest-day holiday',
			kind: 'PUBLIC_HOLIDAY',
			published_at: Instant('2026-01-01T00:00:00.000Z'),
			given_to: 'EVERYONE'
		});
		required(tables.get('roster_entry')).push({
			id: fixtureId('approved-rest-holiday'),
			employment_id: nativeId('employment_contract', fixtureId('k-e3')),
			work_date: PlainDate('2026-03-08'),
			// an explicit rest-day approval: three hours in the approved window, all of them overtime
			planned_overtime_hours: 3,
			approved_overtime_intervals: clocked('2026-03-08', 3),
			worked_intervals: clocked('2026-03-08', 3),
			banked_overtime_hours: Decimal.of('1'),
			payslip_id: null
		});
		const plan = yield* run('2026-03', 'REGULAR');
		assert.equal(shown(plan, 'e3', 'APPROVED_OT'), 3);
		assert.equal(shown(plan, 'e3', 'PAYABLE_OT'), 2);
		assert.equal(shown(plan, 'e3', 'REST_HOLIDAY_OT'), 2);
	})
);

it.effect(
	'HOLIDAY_WORK stays off when no published holiday falls on a roster day',
	Effect.fnUntraced(function* () {
		reset();
		holidayWork();
		const plan = yield* run('2026-03', 'REGULAR');
		assert.equal(
			slip(plan, 'e1').base.some((row) => row.component_code === 'HOLIDAY_WORK'),
			false
		);
	})
);

it.effect(
	'roster work on a published public holiday prices HOLIDAY_WORK',
	Effect.fnUntraced(function* () {
		reset();
		holidayWork();
		required(tables.get('holiday')).push({
			id: fixtureId('h1'),
			company_id: COMPANY,
			date: PlainDate('2026-03-10'),
			name: 'Scenario holiday',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2026-01-01T00:00:00.000Z',
			given_to: 'EVERYONE'
		});
		required(tables.get('roster_entry')).push({
			id: fixtureId('r-hol'),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date: PlainDate('2026-03-10'),
			payslip_id: null
		});
		const plan = yield* run('2026-03', 'REGULAR');
		const kavriel = slip(plan, 'e1');
		assert.ok(
			kavriel.base.some((row) => row.component_code === 'HOLIDAY_WORK' && row.amount === 500)
		);
		assert.ok(
			kavriel.pins.some((pin) => pin.collection === 'roster_entry' && pin.id === fixtureId('r-hol'))
		);
		assert.equal(
			slip(plan, 'e2').base.some((row) => row.component_code === 'HOLIDAY_WORK'),
			false
		);
	})
);

it.effect(
	'an unpublished holiday does not price HOLIDAY_WORK',
	Effect.fnUntraced(function* () {
		reset();
		holidayWork();
		required(tables.get('holiday')).push({
			id: fixtureId('h-draft'),
			company_id: COMPANY,
			date: PlainDate('2026-03-10'),
			name: 'Scenario holiday',
			kind: 'PUBLIC_HOLIDAY',
			published_at: null,
			given_to: 'EVERYONE'
		});
		required(tables.get('roster_entry')).push({
			id: fixtureId('r-hol'),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date: PlainDate('2026-03-10'),
			payslip_id: null
		});
		const plan = yield* run('2026-03', 'REGULAR');
		assert.equal(
			slip(plan, 'e1').base.some((row) => row.component_code === 'HOLIDAY_WORK'),
			false
		);
	})
);

it.effect(
	'L-TPL-hr-payroll-076/077 the seeded encash rule returns the create write for the balance over the movements',
	Effect.fnUntraced(function* () {
		reset();
		const pack = behavioursOf(required(law('jurisdiction_settings')[0])['behaviours']);
		assert.ok(pack);
		const rule = ruleOf(pack.rules.find((row) => row.id === 'encash-leave-on-exit'));
		const versionId = String(
			required(
				required(tables.get('jurisdiction_settings')).find((settings) => {
					const range = rangeOf(settings.effective_range);
					return range.from <= '2026-03-01' && (range.to == null || range.to >= '2026-03-01');
				})
			).id
		);
		const annual = required(
			required(tables.get('leave_catalog')).find(
				(row) => row.code === 'ANNUAL_LEAVE' && row.settings_id === versionId
			)
		);
		const leaving = required(
			required(tables.get('leave_catalog')).find(
				(row) => row.code === 'ANNUAL_LEAVE_ON_EXIT' && row.settings_id === versionId
			)
		);
		// The balances cover every class; the rule's own read returns only the encash_on_exit classes.
		const balanced = withBalances({
			company: [required(required(tables.get('entity')).find((row) => row.id === COMPANY))],
			event: {
				collection: 'employment_contract',
				action: 'updated',
				settings_id: annual.settings_id,
				row: {
					id: fixtureId('k-e1'),
					prior_service_months: null,
					effective_range: { from: PlainDate('2019-01-01'), to: PlainDate('2026-03-31') },
					exit_facts: { ground: 'RESIGNATION' }
				}
			},
			catalogues: [annual, leaving],
			movements: [
				{
					catalog_id: annual.id,
					activity: 'TIME_OFF',
					days: 1,
					reference: 'l1',
					occurred_on: PlainDate('2026-02-10'),
					from: PlainDate('2026-02-10'),
					to: PlainDate('2026-02-13')
				}
			]
		});
		const writes = effectWrites(rule, { ...balanced, catalogues: [leaving] });
		// EA s.88A(2): leaving 31 March, 3 completed months of the 8th service year (84-month band, 14 days):
		// 14 × 3/12 = 3.5 → 4 days, less the 1 taken = 3, paid through the leaving-year class
		assert.deepEqual(writes, [
			{
				callable: 'leave_catalog_entry.create',
				collection: 'leave_catalog_entry',
				operation: 'create',
				data: {
					catalog_id: leaving.id,
					employment_id: nativeId('employment_contract', fixtureId('k-e1')),
					occurred_on: PlainDate('2026-03-31'),
					activity: 'ENCASHMENT',
					reference: `exit:${fixtureId('k-e1')}:ANNUAL_LEAVE_ON_EXIT:2026-03-31/`,
					days: 3
				}
			}
		]);
	})
);

it.effect(
	'a part month prorates salary and allowances through their records and records the proration',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('employment_contract')).splice(
			0,
			3,
			contractOf(required(people[1]), {
				effective_range: { from: PlainDate('2026-03-16'), to: null },
				allowances: [{ code: 'FIXED_MONTHLY', amount: { value: 310 } }]
			})
		);
		required(required(tables.get('employment_contract'))[0]).effective_range = {
			from: PlainDate('2026-03-16'),
			to: null
		};
		const plan = yield* run('2026-03', 'REGULAR');
		const shelly = slip(plan, 'e2');
		// EA s.20A: 5,500 and the 310 allowance × 12 of the month's 22 working days (16–31 March)
		assert.equal(required(shelly.base.find((row) => row.component_code === 'BASIC')).amount, 3000);
		assert.equal(
			required(shelly.base.find((row) => row.component_code === 'FIXED_MONTHLY')).amount,
			169.09
		);
		assert.deepEqual(shelly.proration, [
			{
				component_code: 'BASIC',
				from: PlainDate('2026-03-16'),
				to: PlainDate('2026-03-31'),
				days: 16,
				denominator: 31,
				contract_amount: 5500,
				prorated_amount: 3000
			}
		]);
		assert.deepEqual(required(line(plan, 'e2', 'CPF')).parts, { ordinary: 3169.09, additional: 0 });
	})
);

it.effect(
	'a run refuses a version that names no payroll currency',
	Effect.fnUntraced(function* () {
		reset();
		dropPayroll('2026-03', 'currency');
		assert.match(yield* refused('2026-03', 'REGULAR'), /SG names no payroll currency/);
	})
);

/** A diagnostic non-wage figure: EMPLOYER retains the line without moving gross or net or scheme parts. */
const shows = (code: string, quantity: string, rate = '1.0', eligibility = 'true') =>
	required(tables.get('work_catalog')).push({
		id: fixtureId(`w-${code}`),
		settings_id: versionOn('2026-03'),
		code,
		name: code,
		component_code: code,
		eligibility,
		quantity,
		rate,
		destination: 'EMPLOYER',
		direction: 'ADD',
		counts_toward: []
	});
const shown = (plan: Plan, person: string, code: string) =>
	slip(plan, person).base.find((row) => row.component_code === code)?.amount;

/** A Monday-anchored week of five working days, an off day and a rest day, named by e3's terms. */
const weekPattern = () => {
	tables.set('shift_definition', [
		{
			id: fixtureId('sd-day'),
			company_id: COMPANY,
			code: 'D0900',
			variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
		},
		{ id: fixtureId('sd-off'), company_id: COMPANY, code: 'OFF', variant: { day_type: 'OFF' } },
		{ id: fixtureId('sd-rest'), company_id: COMPANY, code: 'REST', variant: { day_type: 'REST' } },
		{
			id: fixtureId('sd-night'),
			company_id: COMPANY,
			code: 'N2200',
			variant: { day_type: 'WORK', start_time: '22:00', end_time: '07:00', break_minutes: 60 }
		}
	]);
	tables.set('shift_pattern', [
		{
			id: fixtureId('sp-week'),
			code: 'CUSTOM_WEEK',
			company_id: COMPANY,
			effective_range: { from: PlainDate('2026-03-02'), to: null },
			pattern: {
				days: [
					...Array.from({ length: 5 }, () => ({
						roster_code_id: nativeId('shift_definition', fixtureId('sd-day'))
					})),
					{ roster_code_id: nativeId('shift_definition', fixtureId('sd-off')) },
					{ roster_code_id: nativeId('shift_definition', fixtureId('sd-rest')) }
				]
			}
		}
	]);
	required(tables.get('employment_contract')).splice(
		2,
		1,
		contractOf(required(people[2]), { shift_pattern_id: fixtureId('sp-week') })
	);
};

it.effect(
	'day types come from the shift codes: working days, and rest-day overtime priced by its own line',
	Effect.fnUntraced(function* () {
		reset();
		weekPattern();
		shows('WORKING_DAYS', 'period.working_days');
		shows(
			'REST_DAY_OT',
			'sum(work.days.filter(d, d.day_type == "REST").map(d, d.overtime_hours))',
			'10.0',
			'work.days.exists(d, d.day_type == "REST" && d.overtime_hours > 0.0)'
		);
		shows(
			'SCHEDULED',
			'sum(work.days.filter(d, d.date == "2026-03-03").map(d, d.scheduled_hours))'
		);
		required(tables.get('roster_entry')).push({
			id: fixtureId('rest-ot'),
			employment_id: nativeId('employment_contract', fixtureId('k-e3')),
			payslip_id: null,
			work_date: PlainDate('2026-03-08'),
			// an explicit rest-day approval: four hours in the approved window, all of them overtime
			planned_overtime_hours: 4,
			approved_overtime_intervals: clocked('2026-03-08', 4),
			worked_intervals: clocked('2026-03-08', 4)
		});
		const plan = yield* run('2026-03', 'REGULAR');
		// 2 March opens the cycle: 22 weekdays from it; 1 March precedes the pattern and names no shift.
		assert.equal(shown(plan, 'e3', 'WORKING_DAYS'), 22);
		assert.equal(shown(plan, 'e3', 'REST_DAY_OT'), 40); // Sunday 8 March is the cycle's rest day
		assert.equal(shown(plan, 'e3', 'SCHEDULED'), 8); // 09:00–18:00 less the hour's break
		assert.equal(shown(plan, 'e1', 'WORKING_DAYS'), undefined); // no pattern, no roster: nothing planned
	})
);

it('work between breaks accumulates short gaps, merges overlaps and resets at the configured break', () => {
	const span = (start: string, end: string | null) => ({
		start: '2026-03-10T' + start,
		end: end == null ? null : '2026-03-10T' + end
	});
	const hours = (i: unknown[], minutes = 30) =>
		evaluateConfigured('max_work_hours_between_breaks(i, minimum)', { i, minimum: minutes });
	assert.equal(hours([span('08:00', '11:00'), span('11:29', '12:29')]), 4);
	assert.equal(hours([span('08:00', '11:00'), span('11:30', '12:30')]), 3);
	assert.equal(
		hours([span('08:00', '10:00'), span('10:10', '11:10'), span('11:20', '11:50')]),
		3.5
	);
	assert.equal(hours([span('10:00', '12:00'), span('08:00', '11:00'), span('08:00', '11:00')]), 4);
	assert.equal(hours([span('08:00', '09:00'), span('09:15', '10:15')], 15), 1);
	assert.equal(hours([span('08:00', null)]), 0);
	assert.equal(hours([]), 0);
	assert.equal(
		hours([
			{ start: '2026-03-10T22:00', end: '2026-03-11T01:00' },
			{ start: '2026-03-11T01:29', end: '2026-03-11T02:29' }
		]),
		4
	);
	assert.throws(() => hours([], -1), /positive/);
	assert.throws(() => hours([span('09:00', '08:00')]), /end.*start/);
});

it.effect(
	'night hours: hours_between over local intervals crossing midnight, in the entity zone',
	Effect.fnUntraced(function* () {
		assert.equal(
			evaluateConfigured('hours_between(i, "22:00", "06:00")', {
				i: [{ start: '2026-03-10T21:00', end: '2026-03-11T07:30' }]
			}),
			8
		);
		assert.equal(
			evaluateConfigured('hours_between(i, "09:00", "18:00")', {
				i: [
					{ start: '2026-03-10T08:00', end: '2026-03-10T12:00' },
					{ start: '2026-03-10T13:00', end: '2026-03-10T20:00' },
					{ start: '2026-03-10T21:00', end: null }
				]
			}),
			8
		);
		reset();
		weekPattern();
		required(required(tables.get('entity'))[0]).time_zone = 'Asia/Singapore';
		shows('NIGHT', 'sum(work.days.map(d, hours_between(d.intervals, "22:00", "06:00")))');
		shows('WORKED', 'sum(work.days.map(d, d.worked_hours))');
		required(tables.get('roster_entry')).push({
			id: fixtureId('night'),
			employment_id: nativeId('employment_contract', fixtureId('k-e3')),
			payslip_id: null,
			work_date: PlainDate('2026-03-10'),
			shift_definition_id: nativeId('shift_definition', fixtureId('sd-night')),
			// 22:00 to 07:00 Singapore time
			worked_intervals: [
				{ start: Instant('2026-03-10T14:00:00.000Z'), end: Instant('2026-03-10T23:00:00.000Z') }
			]
		});
		const plan = yield* run('2026-03', 'REGULAR');
		// the shift's planned hour of break, centred on it (02:00–03:00), is cut out of the one clock pair
		assert.equal(shown(plan, 'e3', 'NIGHT'), 7);
		assert.equal(shown(plan, 'e3', 'WORKED'), 8);
	})
);

it.effect(
	'worked hours net the planned break of a day clocked as one pair, for pay and for roster checks',
	Effect.fnUntraced(function* () {
		reset();
		weekPattern();
		required(required(tables.get('entity'))[0]).time_zone = 'Asia/Singapore';
		shows('WORKED', 'sum(work.days.map(d, d.worked_hours))');
		shows('PIECES', 'double(sum(work.days.map(d, size(d.intervals))))');
		const day = (id: string, date: string, intervals: object[], plannedOvertimeHours = 0) =>
			required(tables.get('roster_entry')).push({
				id: fixtureId(id),
				employment_id: nativeId('employment_contract', fixtureId('k-e3')),
				payslip_id: null,
				work_date: date,
				shift_definition_id: nativeId('shift_definition', fixtureId('sd-day')),
				planned_overtime_hours: plannedOvertimeHours,
				worked_intervals: intervals
			});
		// 09:00–18:00 Singapore time, one pair: 8 hours, split around 13:00–14:00
		day('one', '2026-03-10', [
			{ start: Instant('2026-03-10T01:00:00.000Z'), end: Instant('2026-03-10T10:00:00.000Z') }
		]);
		// A recorded break counts first: 09:00–12:00 and 12:30–18:30, with a planned half hour of overtime. The
		// planned hour's other half is taken from the centre (13:00–13:30), so ordinary time stays 8 hours.
		day(
			'two',
			'2026-03-11',
			[
				{ start: Instant('2026-03-11T01:00:00.000Z'), end: Instant('2026-03-11T04:00:00.000Z') },
				{ start: Instant('2026-03-11T04:30:00.000Z'), end: Instant('2026-03-11T10:30:00.000Z') }
			],
			0.5
		);
		// a morning half day ends before the planned break: nothing is cut, and only its 4 attended hours are credited
		day('half', '2026-03-12', [
			{ start: Instant('2026-03-12T01:00:00.000Z'), end: Instant('2026-03-12T05:00:00.000Z') }
		]);
		const plan = yield* run('2026-03', 'REGULAR');
		// paid hours: actual attendance inside the shift, plus 18:00's approved completed half hour
		assert.equal(shown(plan, 'e3', 'WORKED'), 8 + 8.5 + 4);
		assert.equal(shown(plan, 'e3', 'PIECES'), 2 + 3 + 1);
		tables.set('rule_set', [
			{
				id: fixtureId('rule-LONG_DAY'),
				settings_id: versionOn('2026-03'),
				family: 'VALIDATIONS',
				code: 'LONG_DAY',
				name: 'LONG_DAY',
				rules: {
					site: 'roster',
					kind: 'warn',
					when: 'day.worked_hours > 8.0 || day.intervals.exists(i, hours_between([i], "00:00", "00:00") > 5.0)',
					message: 'long day'
				}
			}
		]);
		assert.equal(shown(plan, 'e3', 'PIECES'), 2 + 3 + 1);
		const findings = yield* provide(
			rosterFindings(COMPANY, [
				{
					ref: 1,
					employment_id: nativeId('employment_contract', fixtureId('k-e3')),
					work_date: PlainDate('2026-03-10'),
					shift_definition_id: nativeId('shift_definition', fixtureId('sd-day')),
					worked_intervals: [
						{ start: Instant('2026-03-10T01:00:00.000Z'), end: Instant('2026-03-10T10:00:00.000Z') }
					],
					banked_overtime_hours: null,
					overtime_consented_at: null,
					leave_code: ''
				}
			])
		);
		assert.deepEqual(
			findings.map((row) => row.code),
			[]
		);
	})
);

it.effect(
	'earned: the previous month’s salary-run slip and the year so far',
	Effect.fnUntraced(function* () {
		reset();
		shows('PREVIOUS_GROSS', 'earned.previous_month.gross', '0.01');
		shows(
			'PREVIOUS_BASIC',
			'has(earned.previous_month.BASIC) ? earned.previous_month.BASIC : 0.0',
			'0.01'
		);
		shows('PREVIOUS_SALARY', 'earned.previous_month.base_salary', '0.01');
		shows('YEAR_GROSS', 'earned.year.gross', '0.01');
		shows(
			'START',
			'employment.start_date == "2019-01-01" && period.covered_days == 31 ? 1.0 : 0.0'
		);
		shows('MONTH_GROSS', 'earned.month.gross', '0.01');
		shows(
			'MONTH_CPF',
			'earned.month.statutory.CPF.employee',
			'0.01',
			'has(earned.month.statutory.CPF)'
		);
		yield* run('2026-01', 'REGULAR');
		yield* run('2026-02', 'REGULAR');
		// A bonus paid off-cycle before the month run is the month's earlier slip.
		entry(
			'adhoc_catalog_entry',
			'b3',
			'e2',
			catalog('adhoc_catalog', 'bonus', '2026-03'),
			'2026-03-05',
			{ amount: Decimal.of('1000') }
		);
		yield* run('2026-03', 'OFF_CYCLE', ['b3']);
		const march = yield* run('2026-03', 'REGULAR');
		assert.equal(shown(march, 'e2', 'MONTH_GROSS'), 10);
		assert.equal(shown(march, 'e2', 'MONTH_CPF'), 2); // 20% of the 1,000 bonus
		assert.equal(shown(march, 'e2', 'PREVIOUS_GROSS'), 55);
		assert.equal(shown(march, 'e2', 'PREVIOUS_BASIC'), 55);
		assert.equal(shown(march, 'e2', 'PREVIOUS_SALARY'), 55);
		assert.equal(shown(march, 'e2', 'YEAR_GROSS'), 110);
		assert.equal(shown(march, 'e2', 'START'), 1);
	})
);

it.effect(
	'leave rows carry their class pay_fraction and the month of their absence event',
	Effect.fnUntraced(function* () {
		reset();
		const annual = catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03');
		required(required(tables.get('leave_catalog')).find((row) => row.id === annual)).pay_fraction =
			'leave.month_index >= 3 ? 0.5 : 1.0';
		shows('UNPAID_PART', 'sum(leave.rows.map(r, r.days * (1.0 - r.pay_fraction)))', '100.0');
		shows('EVENT_MONTH', 'size(leave.rows) > 0 ? first(leave.rows.map(r, r.month_index)) : 0.0');
		// The event began on 12 January (already paid); 12 March opens its third month.
		entry(
			'leave_catalog_entry',
			'jan',
			'e2',
			annual,
			'2026-01-12',
			{
				days: 1,
				from: PlainDate('2026-01-12'),
				facts: { event_id: 'illness-1' },
				payslip_id: fixtureId('paid')
			},
			'TIME_OFF'
		);
		entry(
			'leave_catalog_entry',
			'mar',
			'e2',
			annual,
			'2026-03-12',
			{ days: 2, from: PlainDate('2026-03-12'), facts: { event_id: 'illness-1' } },
			'TIME_OFF'
		);
		const plan = yield* run('2026-03', 'REGULAR');
		assert.equal(shown(plan, 'e2', 'EVENT_MONTH'), 3);
		assert.equal(shown(plan, 'e2', 'UNPAID_PART'), 100); // 2 days × (1 − 0.5)
	})
);

it('raise-obligations prices each remittance from the run’s scheme totals', () => {
	const [settings] = law('jurisdiction_settings').filter(
		(row) => rangeOf(row.effective_range).to == null
	);
	const rows = readdirSync(seed)
		.filter((entry) => entry.startsWith('version_'))
		.flatMap((dir) =>
			readSeedRows(resolve(seed, dir), 'rule_set').filter(
				(row) => row.settings_id === required(settings).id
			)
		);
	const writes = raiseDuties({
		behaviours: required(behavioursOf(required(settings).behaviours)),
		settings_id: required(settings).id,
		rows,
		collection: 'payroll_run',
		event: 'created',
		row: { id: fixtureId('r1'), company_id: fixtureId('c1'), period: '2026-03' },
		run: {
			totals: {
				gross: 10000,
				net: 8000,
				employer_cost: 11700,
				schemes: {
					CPF: { employee: 2000, employer: 1700 },
					CDAC: { employee: 3, employer: 0 },
					SINDA: { employee: 5, employer: 0 }
				}
			}
		}
	});
	const due = (code: string) => writes.find((write) => write.duty_code === code);
	assert.equal(required(due('CPF_MONTHLY_SUBMISSION_AND_PAYMENT')).amount_due, 3700);
	assert.equal(required(due('SHG_DEDUCTION_REMITTANCE')).amount_due, 8);
	assert.equal(
		required(due('CPF_MONTHLY_SUBMISSION_AND_PAYMENT')).occurrence_key,
		`CPF_MONTHLY_SUBMISSION_AND_PAYMENT:${fixtureId('r1')}`
	);
	// No SDL charged this run: no liability is raised for it; the filings still are.
	assert.equal(due('SDL_REMITTANCE'), undefined);
	assert.equal(due('ITEMISED_PAYSLIP'), undefined);
	// The itemised payslip is owed once the slip is paid: three working days after its paid day.
	const paid = (status: string) =>
		raiseDuties({
			behaviours: required(behavioursOf(required(settings).behaviours)),
			settings_id: required(settings).id,
			rows,
			collection: 'payslip',
			event: 'updated',
			row: {
				id: fixtureId('s1'),
				company_id: fixtureId('c1'),
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				status,
				paid_on: '2026-04-02'
			},
			reads: { holidays: [{ date: PlainDate('2026-04-03'), kind: 'PUBLIC_HOLIDAY' }] }
		}).find((write) => write.duty_code === 'ITEMISED_PAYSLIP');
	assert.equal(paid('DRAFT'), undefined);
	assert.equal(required(paid('PAID')).subject_collection, 'payslip');
	assert.equal(required(paid('PAID')).due_on, '2026-04-08');
	assert.equal(
		required(paid('PAID')).occurrence_key,
		`ITEMISED_PAYSLIP:${fixtureId('c1')}:${fixtureId('s1')}`
	);
});

it('regulatory tasks rise on entity, leave and contract events, due on a working day', () => {
	const [settings] = law('jurisdiction_settings').filter(
		(row) => rangeOf(row.effective_range).to == null
	);
	const task = (code: string, trigger: Row, due: string, when?: string): Row => ({
		family: 'TASKS',
		code,
		name: code,
		rules: { description: code, authority: 'Act', trigger, ...(when ? { when } : {}), due }
	});
	const rows = [
		task(
			'EMPLOYER_REGISTRATION',
			{ collection: 'entity', event: 'created' },
			'add_working_days(period.from, 3, holidays, ["SATURDAY", "SUNDAY"])'
		),
		task(
			'MATERNITY_NOTICE',
			{ collection: 'leave_catalog_entry', event: 'created' },
			'next_working_day(add_days(row.occurred_on, 5), holidays, ["SATURDAY", "SUNDAY"])',
			'has(row.facts.event_kind) && row.facts.event_kind == "BIRTH"'
		),
		task(
			'NEW_HIRE_REPORT',
			{ collection: 'employment_contract', event: 'created' },
			'add_days(hired_on, 30)'
		)
	];
	const raise = (collection: string, row: Row, reads: Row = {}) =>
		raiseDuties({
			behaviours: required(behavioursOf(required(settings).behaviours)),
			settings_id: required(settings).id,
			rows,
			collection,
			event: 'created',
			row: { ...row },
			reads
		});
	// The fixture's day is Thursday 1 January 2026: three working days skip the weekend and a published Monday.
	const entity = raise(
		'entity',
		{ id: fixtureId('c9'), facts: {} },
		{ holidays: [{ date: PlainDate('2026-01-05'), kind: 'PUBLIC_HOLIDAY' }] }
	);
	assert.deepEqual(
		entity.map((write) => [write.code, write.subject_collection, write.company_id, write.due_on]),
		[['EMPLOYER_REGISTRATION', 'entity', fixtureId('c9'), '2026-01-07']]
	);
	const leave = (event_kind: string) =>
		raise('leave_catalog_entry', {
			id: fixtureId('l1'),
			company_id: fixtureId('c1'),
			employment_id: nativeId('employment_contract', fixtureId('k1')),
			occurred_on: PlainDate('2026-10-05'),
			facts: { event_kind }
		});
	// Saturday 10 October rolls to Monday 12 October.
	assert.deepEqual(
		leave('BIRTH').map((write) => [write.code, write.due_on]),
		[['MATERNITY_NOTICE', '2026-10-12']]
	);
	assert.deepEqual(leave('ILLNESS'), []);
	const hired = raise('employment_contract', {
		id: fixtureId('k2'),
		company_id: fixtureId('c1'),
		employee_id: nativeId('employment_profile', fixtureId('p1')),
		effective_range: { from: PlainDate('2026-03-02'), to: null }
	});
	assert.deepEqual(
		hired.map((write) => [write.code, write.due_on, write.occurrence_key]),
		[['NEW_HIRE_REPORT', '2026-04-01', `NEW_HIRE_REPORT:${fixtureId('c1')}:${fixtureId('k2')}`]]
	);
	assert.equal(
		evaluateConfigured(
			'add_working_days("2026-10-01", 3, ["2026-10-06"], ["SATURDAY", "SUNDAY"])',
			{}
		),
		'2026-10-07'
	);
	assert.equal(
		evaluateConfigured('next_working_day("2026-10-03", [], ["SATURDAY", "SUNDAY"])', {}),
		'2026-10-05'
	);
	assert.equal(
		evaluateConfigured('add_working_days("2026-10-05", -1, [], ["SATURDAY", "SUNDAY"])', {}),
		'2026-10-02'
	);
	// A Friday–Saturday weekend (Kedah, Kelantan, Terengganu) is the record's: Thursday 1 Oct + 1 is Sunday 4 Oct.
	assert.equal(
		evaluateConfigured('add_working_days("2026-10-01", 1, [], ["FRIDAY", "SATURDAY"])', {}),
		'2026-10-04'
	);
	assert.throws(() =>
		evaluateConfigured('next_working_day("2026-10-03", [], ["SATURDAY", "SUNDAY", "FUNDAY"])', {})
	);
});

it('the exit encashment pays the current leave-year balance, carried days included', () => {
	const pack = behavioursOf(required(law('jurisdiction_settings')[0])['behaviours']);
	const rule = ruleOf(required(pack).rules.find((row) => row.id === 'encash-leave-on-exit'));
	const annual = {
		id: fixtureId('ay'),
		code: 'ANNUAL_LEAVE',
		unit: 'DAY',
		entitlement: {
			overdraw: '0',
			days: '12.0',
			window: 'CALENDAR_YEAR',
			carry_forward: '5.0',
			carry_depth: 1
		}
	};
	const movement = (reference: string, days: number, from: string) => ({
		catalog_id: fixtureId('ay'),
		activity: 'TIME_OFF',
		days,
		from,
		occurred_on: from,
		reference
	});
	const writes = effectWrites(
		rule,
		withBalances({
			event: {
				collection: 'employment_contract',
				action: 'updated',
				settings_id: fixtureId('s'),
				row: {
					id: fixtureId('k-e1'),
					prior_service_months: null,
					effective_range: { from: PlainDate('2020-01-01'), to: PlainDate('2026-06-30') },
					exit_facts: { ground: 'RESIGNATION' }
				}
			},
			catalogues: [annual],
			// 2025 leaves 8 unused (5 carry); 2026 has taken 3 of 12 + 5.
			movements: [movement('a', 4, '2025-04-01'), movement('b', 3, '2026-02-02')]
		})
	);
	assert.equal(writes.length, 1);
	assert.equal(record(required(writes[0]).data).days, 14);
});

/** A `VALIDATIONS` rule-set row of the version governing March 2026. */
const validation = (code: string, rules: Row): Row => ({
	id: fixtureId(`v-${code}`),
	settings_id: versionOn('2026-03'),
	family: 'VALIDATIONS',
	code,
	name: code,
	rules
});

it.effect(
	'payslip validations warn, hold and refuse, and read the slip, its statutory and the headcount',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('rule_set', [
			validation('GROSS_ABOVE', {
				site: 'payslip',
				kind: 'warn',
				when: 'payslip.gross > 6000.0 && statutory.CPF.employee > 0.0',
				message: 'gross above 6,000'
			}),
			validation('PR_CLEARANCE', {
				site: 'payslip',
				kind: 'hold',
				when: 'person.residency_status == "PERMANENT_RESIDENT" && company.headcount == 3.0',
				message: 'awaiting tax clearance'
			})
		]);
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(plan.warnings, [
			'Kavriel: gross above 6,000',
			'Kavriel: awaiting tax clearance'
		]);
		assert.equal(slip(plan, 'e1').hold, 'awaiting tax clearance');
		assert.equal(slip(plan, 'e2').hold, null);
		reset();
		tables.set('rule_set', [
			validation('FLOOR', {
				site: 'payslip',
				kind: 'refuse',
				when: 'terms.base_salary < 5000.0',
				message: 'basic below the floor'
			})
		]);
		assert.match(yield* refused('2026-03', 'REGULAR'), /^Dernese: basic below the floor$/);
		tables.set('rule_set', [validation('BROKEN', { site: 'payslip', when: 'true' })]);
		assert.match(yield* refused('2026-03', 'REGULAR'), /BROKEN: a validation names its site/);
	})
);

it.effect(
	'a statutory warn_when pays the slip and lands in the run warnings',
	Effect.fnUntraced(function* () {
		reset();
		const cpf = required(
			required(tables.get('statutory_contribution_catalog')).find(
				(row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03')
			)
		);
		cpf.configuration = {
			...record(cpf.configuration),
			warn_when: [{ when: 'employee.date_of_birth > "1995-01-01"', message: 'young' }]
		};
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(plan.warnings, ['Dernese: young']);
		assert.ok(required(line(plan, 'e3', 'CPF')).employee_amount > 0);
	})
);

it.effect(
	'contract validations judge every new or changed term against the version governing its start',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('rule_set', [
			validation('MINIMUM_BASE', {
				site: 'contract',
				kind: 'refuse',
				when: 'term.base_salary < 1500.0 && company.headcount >= 1.0',
				message: 'The base salary is below the minimum.'
			})
		]);
		const contract = (salary: number) => ({
			company_id: COMPANY,
			employee_id: nativeId('employment_profile', fixtureId('e3')),
			effective_range: { from: PlainDate('2026-03-01'), to: null },
			facts: {
				contract_terms: [
					{
						base_salary: { value: salary, currency: 'SGD' },
						effective_range: { from: PlainDate('2026-03-01'), to: null },
						allowances: []
					}
				]
			}
		});
		const admit = admitContract;
		const low = yield* admit(contract(1000));
		assert.equal(low._tag, 'Failure');
		assert.equal(
			low._tag === 'Failure' && low.failure.message,
			'The base salary is below the minimum.'
		);
		assert.equal((yield* admit(contract(2000)))._tag, 'Success');
		// A term the write leaves as it was is not judged again.
		assert.equal((yield* admit(contract(1000), contract(1000).facts))._tag, 'Success');
	})
);

it.effect(
	'a sub-monthly period names its part of the calendar month',
	Effect.fnUntraced(function* () {
		const settle = (period: string, frequency: string) =>
			Effect.result(
				settlementPeriod(period, frequency, { ten_day_splits: SEEDED_PAYROLL.ten_day_splits })
			);
		const half = yield* settle('2026-02-2', 'SEMI_MONTHLY');
		assert.ok(half._tag === 'Success');
		assert.deepEqual(half.success, {
			from: PlainDate('2026-02-16'),
			to: PlainDate('2026-02-28'),
			part: 2,
			parts: 2
		});
		const third = yield* settle('2026-03-3', 'TEN_DAY');
		assert.ok(third._tag === 'Success' && third.success.from === '2026-03-21');
		for (const [period, frequency] of [
			['2026-02', 'SEMI_MONTHLY'],
			['2026-02-1', 'MONTHLY'],
			['2026-02-3', 'SEMI_MONTHLY'],
			['2026-02', 'WEEKLY']
		] satisfies readonly (readonly [string, string])[])
			assert.equal((yield* settle(period, frequency))._tag, 'Failure', `${frequency} ${period}`);
	})
);

it.effect(
	'a class reads the employment’s earlier entries of its code: a per-child cap across claims',
	Effect.fnUntraced(function* () {
		reset();
		const version = versionOn('2026-03');
		required(tables.get('claim_catalog')).push({
			id: fixtureId('cc-child'),
			settings_id: version,
			code: 'CHILD_CARE',
			name: 'Child care',
			destination: 'PAY',
			direction: 'ADD',
			eligibility: 'true',
			counts_toward: [],
			bands: [
				{
					when: '',
					amount:
						'min(entry.amount, max(0.0, 500.0 - sum(earlier.rows.filter(r, r.child_id == entry.child_id).map(r, r.amount))))'
				}
			]
		});
		entry('claim_catalog_entry', fixtureId('c1'), 'e2', 'cc-child', '2026-03-05', {
			amount: 300,
			facts: { child_id: 'A' }
		});
		entry('claim_catalog_entry', 'c2', 'e2', 'cc-child', '2026-03-10', {
			amount: 300,
			facts: { child_id: 'A' }
		});
		entry('claim_catalog_entry', 'c3', 'e2', 'cc-child', '2026-03-12', {
			amount: 300,
			facts: { child_id: 'B' }
		});
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(
			slip(plan, 'e2')
				.adjustments.filter((row) => row.component_code === 'CHILD_CARE')
				.map((row) => [row.source_id, row.amount]),
			[
				[fixtureId('c1'), 300],
				[fixtureId('c2'), 200],
				[fixtureId('c3'), 300]
			]
		);
	})
);

it.effect(
	'hours sums the employment’s roster days to date, by window, day type and holiday kind',
	Effect.fnUntraced(function* () {
		reset();
		const day = (id: string, work_date: string, fields: Row) =>
			required(tables.get('roster_entry')).push({
				id: fixtureId(id),
				employment_id: nativeId('employment_contract', fixtureId('k-e2')),
				work_date,
				payslip_id: null,
				...fields
			});
		day('r-dec', '2025-12-20', {
			planned_overtime_hours: 5,
			worked_intervals: clocked('2025-12-20', 5)
		});
		day('r-jan', '2026-01-15', {
			planned_overtime_hours: 4,
			worked_intervals: clocked('2026-01-15', 4),
			payslip_id: fixtureId('paid')
		});
		day('r-feb', '2026-02-10', {
			planned_overtime_hours: 3,
			worked_intervals: clocked('2026-02-10', 3)
		});
		// Saturday 7 March is a rest day of the week pattern; 10 March a published public holiday.
		// Its four hours are approved explicitly: the rest day has no shift to extend.
		day('r-sat', '2026-03-07', {
			planned_overtime_hours: 4,
			approved_overtime_intervals: [
				{ start: Instant('2026-03-07T01:00:00.000Z'), end: Instant('2026-03-07T05:00:00.000Z') }
			],
			worked_intervals: [
				{ start: Instant('2026-03-07T01:00:00.000Z'), end: Instant('2026-03-07T05:00:00.000Z') }
			]
		});
		day('r-hol', '2026-03-10', {
			planned_overtime_hours: 2,
			worked_intervals: clocked('2026-03-10', 2)
		});
		required(tables.get('holiday')).push({
			id: fixtureId('h-mar'),
			company_id: COMPANY,
			date: PlainDate('2026-03-10'),
			name: 'Test Day',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2026-01-01T00:00:00.000Z',
			given_to: 'EVERYONE'
		});
		shows('MONTH_OT', 'hours.month.overtime_hours');
		shows('PREVIOUS_OT', 'hours.previous_month.overtime_hours');
		shows('YEAR_OT', 'hours.year.overtime_hours');
		shows('ROLLING_OT', 'hours.rolling.overtime_hours');
		shows(
			'REST_WORKED',
			'hours.month.day_type.REST.worked_hours',
			'1.0',
			'has(hours.month.day_type.REST)'
		);
		shows(
			'HOLIDAY_OT',
			'hours.month.holiday_kind.PUBLIC_HOLIDAY.overtime_hours',
			'1.0',
			'has(hours.month.holiday_kind.PUBLIC_HOLIDAY)'
		);
		tables.set('rule_set', [
			validation('ANNUAL_OT_CAP', {
				site: 'payslip',
				kind: 'warn',
				when: 'hours.year.overtime_hours > 8.0',
				message: 'annual overtime above 8 h'
			})
		]);
		const cpf = required(
			required(tables.get('statutory_contribution_catalog')).find(
				(row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03')
			)
		);
		cpf.configuration = {
			...record(cpf.configuration),
			warn_when: [{ when: 'hours.rolling.overtime_hours == 13.0', message: 'rolling 13 h' }]
		};
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(
			['MONTH_OT', 'PREVIOUS_OT', 'YEAR_OT', 'ROLLING_OT', 'REST_WORKED', 'HOLIDAY_OT'].map(
				(code) => shown(plan, 'e2', code)
			),
			// Saturday's four rest-day hours are overtime too: a planned rest day has no ordinary hours
			[6, 3, 13, 13, 4, 2]
		);
		assert.deepEqual(plan.warnings, ['Shelly: rolling 13 h', 'Shelly: annual overtime above 8 h']);
	})
);

it.effect(
	'the statutory step reads the working days no-pay leave covers (period.unpaid_working_days)',
	Effect.fnUntraced(function* () {
		reset();
		// Friday 6 to Tuesday 10 March: the weekend between is not a working day.
		entry(
			'leave_catalog_entry',
			'npl',
			'e3',
			catalog('leave_catalog', 'UNPAID_LEAVE', '2026-03'),
			'2026-03-06',
			{ days: 3, from: PlainDate('2026-03-06'), to: PlainDate('2026-03-10') },
			'TIME_OFF'
		);
		const cpf = required(
			required(tables.get('statutory_contribution_catalog')).find(
				(row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03')
			)
		);
		cpf.configuration = {
			...record(cpf.configuration),
			warn_when: [
				{ when: 'period.unpaid_working_days > 0.0', message: 'unpaid days' },
				{ when: 'period.unpaid_working_days == 3.0', message: 'three unpaid working days' }
			]
		};
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(plan.warnings, ['Dernese: unpaid days', 'Dernese: three unpaid working days']);
	})
);

it.effect(
	'a leave row spanning periods is captured by the first and keeps pricing only each period’s working-day share',
	Effect.fnUntraced(function* () {
		reset();
		// Monday 16 March to Friday 24 April: 12 working days in March, 18 in April.
		entry(
			'leave_catalog_entry',
			'long',
			'e3',
			catalog('leave_catalog', 'UNPAID_LEAVE', '2026-03'),
			'2026-03-16',
			{ days: 30, from: PlainDate('2026-03-16'), to: PlainDate('2026-04-24') },
			'TIME_OFF'
		);
		shows('SHARE', 'sum(leave.rows.map(r, r.days))');
		shows('TOTAL', 'sum(leave.rows.map(r, r.total_days))');
		shows('INSIDE', 'sum(leave.rows.map(r, r.period_working_days))');
		shows('UNPAID', 'period.unpaid_working_days');
		const march = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(
			['SHARE', 'TOTAL', 'INSIDE', 'UNPAID'].map((code) => shown(march, 'e3', code)),
			[12, 30, 12, 12]
		);
		assert.equal(slip(march, 'e3').gross, 2181.82); // 4,800 − 12 × 4,800 / 22
		const capturedBy = lastSlipId('e3');
		assert.equal(required(required(tables.get('leave_catalog_entry'))[0]).payslip_id, capturedBy);
		const april = yield* run('2026-04', 'REGULAR');
		assert.deepEqual(
			['SHARE', 'UNPAID'].map((code) => shown(april, 'e3', code)),
			[18, 18]
		);
		assert.equal(slip(april, 'e3').gross, 872.73); // 4,800 − 18 × 4,800 / 22
		assert.equal(required(required(tables.get('leave_catalog_entry'))[0]).payslip_id, capturedBy);
		assert.equal(
			slip(april, 'e3').pins.some((pin) => pin.collection === 'leave_catalog_entry'),
			false
		);
	})
);

it.effect(
	'a holiday the person was rostered on but did not work is marked unworked',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('holiday')).push({
			id: fixtureId('h1'),
			company_id: COMPANY,
			date: PlainDate('2026-03-10'),
			name: 'Scenario holiday',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2026-01-01T00:00:00.000Z',
			given_to: 'EVERYONE'
		});
		required(tables.get('roster_entry')).push(
			{
				id: fixtureId('off'),
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				work_date: PlainDate('2026-03-10'),
				payslip_id: null
			},
			{
				id: fixtureId('on'),
				employment_id: nativeId('employment_contract', fixtureId('k-e2')),
				work_date: PlainDate('2026-03-10'),
				payslip_id: null,
				worksite: 'JURONG',
				facts: { units: 40 },
				worked_intervals: [
					{ start: Instant('2026-03-10T01:00:00.000Z'), end: Instant('2026-03-10T09:00:00.000Z') }
				]
			}
		);
		shows('ROSTERED', 'double(size(work.holidays))');
		shows('WORKED', 'double(size(work.holidays.filter(h, h.worked)))');
		shows('HOURS', 'sum(work.holidays.map(h, h.worked_hours))');
		shows('UNITS', 'sum(work.days.filter(d, has(d.facts.units)).map(d, double(d.facts.units)))');
		shows('SITE', 'work.days.exists(d, d.worked && d.worksite == "JURONG") ? 1.0 : 0.0');
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(
			['ROSTERED', 'WORKED', 'HOURS'].map((code) => shown(plan, 'e1', code)),
			[1, undefined, undefined]
		);
		assert.deepEqual(
			['ROSTERED', 'WORKED', 'HOURS', 'UNITS', 'SITE'].map((code) => shown(plan, 'e2', code)),
			// 09:00–17:00 Singapore time on the 09:00–18:00 shift: attended, credited its 7 actual hours net of the break
			[1, 1, 7, 40, 1]
		);
	})
);

it('the version’s public_holidays table becomes the entity’s holiday rows, once', () => {
	const settings = required(law('jurisdiction_settings').at(-1));
	const behaviours = required(behavioursOf(settings.behaviours));
	const trigger = { kind: 'row', collection: 'entity', event: 'calendar' } satisfies Parameters<
		typeof planBehaviours
	>[1];
	const event = {
		collection: 'entity',
		action: 'calendar',
		row: { id: fixtureId('c1'), region: 'NORTH' },
		settings_id: settings.id,
		company_id: fixtureId('c1')
	};
	// The entity calendar event also plans `raise-tasks` (entity date duties); this is the calendar's own rule.
	const rule = planBehaviours(behaviours, trigger, { event }).find(
		(planned) => planned.id === 'write-public-holidays'
	);
	assert.equal(required(rule).id, 'write-public-holidays');
	const writes = effectWrites(required(rule), {
		event,
		calendar: [
			{
				rules: {
					holidays: [
						{ date: PlainDate('2027-01-01'), name: 'New Year', kind: 'PUBLIC_HOLIDAY' },
						{ date: PlainDate('2027-02-06'), name: 'Lunar New Year' },
						{ date: PlainDate('2027-03-01'), name: 'Southern day', regions: ['SOUTH'] }
					]
				}
			}
		],
		held: [{ date: PlainDate('2027-01-01') }]
	});
	assert.deepEqual(
		writes.map((write) => [write.callable, write.data]),
		[
			[
				'holiday.create',
				{
					company_id: fixtureId('c1'),
					date: PlainDate('2027-02-06'),
					name: 'Lunar New Year',
					kind: 'PUBLIC_HOLIDAY',
					replaces: null,
					given_to: 'EVERYONE'
				}
			]
		]
	);
	assert.equal(effectWrites(required(rule), { event, calendar: [], held: [] }).length, 0);
});

const payRun = (period: string, pay_due_date: string) =>
	provide(buildPayrollRun({ company_id: COMPANY, period, kind: 'REGULAR', pay_due_date }));

it.effect(
	'a scheme governed by the pay date is assessed on the version in force on the pay day',
	Effect.fnUntraced(function* () {
		reset();
		// This version-selection scenario starts employment in December, with no missing earlier-year payroll.
		for (const contract of required(tables.get('employment_contract')))
			contract.effective_range = {
				...rangeOf(contract.effective_range),
				from: PlainDate('2026-12-01')
			};
		const cpfOf = (period: string) =>
			required(
				required(tables.get('statutory_contribution_catalog')).find(
					(row) => row.code === 'CPF' && row.settings_id === versionOn(period)
				)
			);
		shows('PAY_DATE', 'period.pay_date == "2027-01-05" ? 1.0 : 0.0');
		required(required(tables.get('work_catalog')).at(-1)).settings_id = versionOn('2026-12');
		cpfOf('2026-12').configuration = {
			...record(cpfOf('2026-12').configuration),
			governed_by: 'pay_date'
		};
		cpfOf('2027-01').configuration = { rules: [{ employee: '1.0', employer: '2.0' }] };
		const plan = yield* payRun('2026-12', '2027-01-05');
		assert.equal(plan.run.pay_date, '2027-01-05');
		assert.equal(shown(plan, 'e2', 'PAY_DATE'), 1);
		assert.deepEqual(
			[
				required(line(plan, 'e2', 'CPF')).employee_amount,
				required(line(plan, 'e2', 'CPF')).employer_amount
			],
			[1, 2]
		);
		// Paid inside its own period, the period's version prices it.
		assert.equal(
			required(line(yield* payRun('2026-12', '2026-12-31'), 'e2', 'CPF')).employee_amount,
			1100
		);
	})
);

it.effect(
	'a scheme marked assess_without_wage charges a month the person was paid nothing',
	Effect.fnUntraced(function* () {
		const flat = (assess: boolean) => {
			reset();
			entry(
				'leave_catalog_entry',
				'all',
				'e3',
				catalog('leave_catalog', 'UNPAID_LEAVE', '2026-03'),
				'2026-03-02',
				{ days: 22, from: PlainDate('2026-03-02'), to: PlainDate('2026-03-31') },
				'TIME_OFF'
			);
			required(tables.get('statutory_contribution_catalog')).push({
				id: fixtureId('flat'),
				settings_id: versionOn('2026-03'),
				code: 'FLAT',
				name: 'Flat charge',
				configuration: {
					...(assess ? { assess_without_wage: true } : {}),
					rules: [{ employer: 'terms.base_salary * 0.01' }]
				}
			});
			return run('2026-03', 'REGULAR');
		};
		assert.equal(
			(yield* flat(false)).payslips.some((row) => row.employment_id === fixtureId('k-e3')),
			false
		);
		const plan = yield* flat(true);
		assert.equal(slip(plan, 'e3').gross, 0);
		assert.equal(required(line(plan, 'e3', 'FLAT')).employer_amount, 48);
	})
);

it.effect(
	'charged.previous_month and charged.previous_year, earned.months and hours.months',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('roster_entry')).push({
			id: fixtureId('r-dec'),
			employment_id: nativeId('employment_contract', fixtureId('k-e3')),
			work_date: PlainDate('2025-12-10'),
			payslip_id: fixtureId('paid'),
			planned_overtime_hours: 5,
			worked_intervals: clocked('2025-12-10', 5)
		});
		yield* run('2025-12', 'REGULAR');
		shows('PRIOR_GROSS', 'sum(earned.months.map(m, m.gross))', '0.01');
		shows('PRIOR_CPF_BASE', 'sum(earned.months.map(m, m.statutory.CPF.parts.ordinary))', '0.01');
		shows(
			'OT_SINCE_DEC',
			'sum(hours.months.filter(m, m.month >= "2025-12").map(m, m.overtime_hours))'
		);
		const cpf = required(
			required(tables.get('statutory_contribution_catalog')).find(
				(row) => row.code === 'CPF' && row.settings_id === versionOn('2026-01')
			)
		);
		cpf.configuration = {
			...record(cpf.configuration),
			warn_when: [
				{ when: 'charged.previous_month.CPF.employee == 960.0', message: 'December deducted' },
				{ when: 'charged.previous_year.CPF.employee == 960.0', message: 'last year deducted' }
			]
		};
		required(tables.get('work_catalog'))
			.slice(-3)
			.forEach((row) => (row.settings_id = versionOn('2026-01')));
		const january = yield* run('2026-01', 'REGULAR');
		assert.deepEqual(
			['PRIOR_GROSS', 'PRIOR_CPF_BASE', 'OT_SINCE_DEC'].map((code) => shown(january, 'e3', code)),
			[48, 48, 5]
		);
		assert.ok(january.warnings.includes('Dernese: December deducted'));
		assert.ok(january.warnings.includes('Dernese: last year deducted'));
	})
);

it.effect(
	'the statutory step reads the slip’s lines and leave rows; terms list their allowances and dates',
	Effect.fnUntraced(function* () {
		reset();
		shows(
			'TERM_FROM',
			'terms.effective_from == "2019-01-01" && size(terms.allowances) == 0 ? 1.0 : 0.0'
		);
		entry(
			'leave_catalog_entry',
			'al',
			'e2',
			catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03'),
			'2026-03-10',
			{ days: 1, from: PlainDate('2026-03-10') },
			'TIME_OFF'
		);
		const cpf = required(
			required(tables.get('statutory_contribution_catalog')).find(
				(row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03')
			)
		);
		cpf.configuration = {
			...record(cpf.configuration),
			warn_when: [
				{
					when: 'lines.exists(l, l.code == "BASIC" && l.amount == 5500.0) && size(leave.rows) == 1',
					message: 'lines and leave'
				}
			]
		};
		const plan = yield* run('2026-03', 'REGULAR');
		assert.equal(shown(plan, 'e2', 'TERM_FROM'), 1);
		assert.deepEqual(plan.warnings, ['Shelly: lines and leave']);
	})
);

it.effect(
	'an EMPLOYER entry is not paid but counts toward its schemes, and is settled',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('adhoc_catalog')).push({
			id: fixtureId('bik'),
			bands: [],
			settings_id: versionOn('2026-03'),
			code: 'BIK',
			name: 'Benefit in kind',
			destination: 'EMPLOYER',
			direction: 'ADD',
			counts_toward: ['CPF.ADDITIONAL']
		});
		entry('adhoc_catalog_entry', 'b', 'e2', 'bik', '2026-03-05', { amount: Decimal.of('1000') });
		const plan = yield* run('2026-03', 'REGULAR');
		assert.equal(slip(plan, 'e2').gross, 5500);
		assert.equal(required(line(plan, 'e2', 'CPF')).base_amount, 6500);
		assert.equal(slip(plan, 'e2').adjustments.length, 0);
		assert.deepEqual(
			slip(plan, 'e2').company_payments.map((payment) => [payment.source_id, payment.amount]),
			[[fixtureId('b'), 1000]]
		);
		assert.equal(
			required(required(tables.get('adhoc_catalog_entry'))[0]).payslip_id,
			lastSlipId('e2')
		);
	})
);

it.effect(
	'a company-paid claim alone retains a settlement and consumes its source without employee net pay',
	Effect.fnUntraced(function* () {
		reset();
		const contract = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e2'))
		);
		contract.engagement = 'PAYEE';
		const catalog_id = fixtureId('outside-net-only');
		required(tables.get('claim_catalog')).push({
			id: catalog_id,
			settings_id: versionOn('2026-03'),
			code: 'OUTSIDE_NET_ONLY',
			name: 'Company-paid claim',
			destination: 'EMPLOYER',
			direction: 'ADD',
			counts_toward: [],
			bands: [{ when: '', amount: 'entry.amount' }]
		});
		entry('claim_catalog_entry', 'outside-net-only-source', 'e2', catalog_id, '2026-03-05', {
			amount: 40
		});
		const plan = yield* run('2026-03', 'REGULAR');
		const settled = slip(plan, 'e2');
		assert.equal(settled.gross, 0);
		assert.equal(settled.net, 0);
		assert.deepEqual(settled.adjustments, []);
		assert.equal(settled.company_payments[0]?.amount, 40);
		assert.equal(
			required(required(tables.get('claim_catalog_entry'))[0]).payslip_id,
			lastSlipId('e2')
		);
	})
);

it.effect(
	'attendance: a class tallies the scheduled, worked and leave days of its window and the one before',
	Effect.fnUntraced(function* () {
		reset();
		const version = versionOn('2026-03');
		const leaveClass = (code: string, days: string) =>
			required(tables.get('leave_catalog')).push({
				can_encash: true,
				id: fixtureId(`lc-${code}`),
				settings_id: version,
				code,
				name: code,
				entitlement: { overdraw: '0', window: 'CALENDAR_YEAR', days }
			});
		// Each tally as a number the balance shows: 1000 × scheduled + 10 × worked + annual-leave days.
		leaveClass(
			'ATTENDED',
			'double(attendance.window.scheduled) * 1000.0 + double(attendance.window.worked) * 10.0 + (has(attendance.window.leave.ANNUAL_LEAVE) ? double(attendance.window.leave.ANNUAL_LEAVE) : 0.0)'
		);
		leaveClass(
			'LAST_YEAR',
			'double(attendance.previous.scheduled) * 100.0 + double(size(attendance.window.months))'
		);
		// An 80% test where annual leave counts as attended (the grant the record decides).
		leaveClass(
			'EIGHTY',
			'(double(attendance.window.worked) + (has(attendance.window.leave.ANNUAL_LEAVE) ? double(attendance.window.leave.ANNUAL_LEAVE) : 0.0)) / double(attendance.window.scheduled) >= 0.8 ? 10.0 : 0.0'
		);
		const worked = (date: string) =>
			required(tables.get('roster_entry')).push({
				id: fixtureId(`r-${date}`),
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				work_date: date,
				worked_intervals: [
					{ start: Instant(`${date}T01:00:00.000Z`), end: Instant(`${date}T09:00:00.000Z`) }
				]
			});
		worked('2026-03-02');
		worked('2026-03-03');
		worked('2026-03-07'); // a Saturday: rest-day work is not a scheduled day attended
		entry(
			'leave_catalog_entry',
			'al',
			'e1',
			catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03'),
			'2026-03-04',
			{ days: 2, from: PlainDate('2026-03-04'), to: PlainDate('2026-03-05') },
			'TIME_OFF'
		);
		const balances = Effect.fnUntraced(function* (asOf: string) {
			const state = yield* provide(
				leaveState(nativeId('employment_contract', fixtureId('k-e1')), asOf)
			);
			// Only this test's classes: the seeded ones read an `entry` a listing does not carry.
			return leaveBalances({
				...state,
				classes: state.classes.filter((cls) =>
					['ATTENDED', 'LAST_YEAR', 'EIGHTY'].includes(cls.code)
				)
			});
		});
		const shown = (rows: Effect.Success<ReturnType<typeof balances>>, code: string) =>
			rows.find((row) => row.code === code)?.entitlement;
		const march = yield* balances('2026-03-07');
		// 1 January to 7 March 2026: 22 + 20 + 5 weekdays; two attended; two of annual leave.
		assert.equal(shown(march, 'ATTENDED'), 47_022);
		// 2025 held 261 weekdays; this window has reached three months.
		assert.equal(shown(march, 'LAST_YEAR'), 26_103);
		assert.equal(shown(march, 'EIGHTY'), 0);
		// New Year's Day alone: one scheduled day, nothing attended yet.
		assert.equal(
			(yield* balances('2026-01-01')).find((row) => row.code === 'ATTENDED')?.entitlement,
			1000
		);
	})
);

it.effect(
	'a class payable after exit takes entries past the employment and a salary run pays them alone',
	Effect.fnUntraced(function* () {
		reset();
		const e3 = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e3'))
		);
		e3.effective_range = { from: PlainDate('2019-01-01'), to: PlainDate('2026-01-31') };
		required(tables.get('adhoc_catalog')).push({
			id: fixtureId('nc'),
			settings_id: versionOn('2026-03'),
			code: 'NON_COMPETE',
			name: 'Non-compete compensation',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: [],
			payable_after_exit: true,
			// Priced on the terms last in force: 30% of the leaving base salary.
			bands: [{ when: 'true', amount: 'round(0.3 * terms.base_salary, 0.01)' }]
		});
		const [admitted] = yield* transformed('adhoc_catalog_entry', [
			{
				catalog_id: nativeId('adhoc_catalog', fixtureId('nc')),
				employment_id: nativeId('employment_contract', fixtureId('k-e3')),
				occurred_on: PlainDate('2026-03-15'),
				amount: Decimal.of('1')
			}
		]);
		required(tables.get('adhoc_catalog_entry')).push({
			company_id: COMPANY,
			...record(admitted),
			id: fixtureId('nc-1'),
			payslip_id: null
		});
		yield* assertFailure(
			transformed('adhoc_catalog_entry', [
				{
					catalog_id: catalog('adhoc_catalog', 'bonus', '2026-03'),
					employment_id: nativeId('employment_contract', fixtureId('k-e3')),
					occurred_on: PlainDate('2026-03-15'),
					amount: Decimal.of('100')
				}
			]),
			/outside the employment/
		);
		const plan = yield* run('2026-03', 'REGULAR');
		const paid = slip(plan, 'e3');
		assert.deepEqual(paid.base, []);
		assert.deepEqual(
			paid.adjustments.map((line) => [line.component_code, line.amount]),
			[['NON_COMPETE', 1440]]
		);
		assert.equal(paid.gross, 1440);
		assert.equal(
			required(required(tables.get('adhoc_catalog_entry'))[0]).payslip_id,
			lastSlipId('e3')
		);
		// A month with no such entry pays the leaver nothing.
		assert.equal(
			(yield* run('2026-04', 'REGULAR')).payslips.some(
				(row) => row.employment_id === fixtureId('k-e3')
			),
			false
		);
	})
);

it.effect(
	'a post-exit entry of a class payable after exit that pays nothing still keeps its slip and is settled',
	Effect.fnUntraced(function* () {
		reset();
		const e3 = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e3'))
		);
		e3.effective_range = { from: PlainDate('2019-01-01'), to: PlainDate('2026-01-31') };
		required(tables.get('adhoc_catalog')).push({
			id: fixtureId('nc0'),
			settings_id: versionOn('2026-03'),
			code: 'NON_COMPETE_WAIVED',
			name: 'Non-compete compensation (waived)',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: [],
			payable_after_exit: true,
			bands: [{ when: 'true', amount: '0.0' }]
		});
		entry('adhoc_catalog_entry', 'nc0-1', 'e3', 'nc0', '2026-03-15', { amount: Decimal.of('0') });
		const plan = yield* run('2026-03', 'REGULAR');
		const kept = slip(plan, 'e3');
		assert.equal(kept.gross, 0);
		assert.deepEqual(kept.adjustments, []);
		// settled by this slip: the year's statutory export lists the entry
		assert.equal(
			required(required(tables.get('adhoc_catalog_entry'))[0]).payslip_id,
			lastSlipId('e3')
		);
	})
);

it.effect(
	'weekly and daily settlement periods: the Sunday weeks starting in the month, and single days',
	Effect.fnUntraced(function* () {
		const settle = (period: string, frequency: string) =>
			Effect.result(settlementPeriod(period, frequency));
		const week = yield* settle('2026-03-2', 'WEEKLY');
		assert.ok(week._tag === 'Success');
		// March 2026 starts on a Sunday: weeks begin on the 1st, 8th, 15th, 22nd and 29th.
		assert.deepEqual(week.success, {
			from: PlainDate('2026-03-08'),
			to: PlainDate('2026-03-14'),
			part: 2,
			parts: 5
		});
		const last = yield* settle('2026-03-5', 'WEEKLY');
		assert.ok(last._tag === 'Success' && last.success.to === '2026-04-04');
		const day = yield* settle('2026-03-17', 'DAILY');
		assert.ok(day._tag === 'Success');
		assert.deepEqual(day.success, {
			from: PlainDate('2026-03-17'),
			to: PlainDate('2026-03-17'),
			part: 17,
			parts: 31
		});
		for (const [period, frequency] of [
			['2026-04-5', 'WEEKLY'],
			['2026-03', 'DAILY'],
			['2026-02-29', 'DAILY']
		] satisfies readonly (readonly [string, string])[])
			assert.equal((yield* settle(period, frequency))._tag, 'Failure', `${frequency} ${period}`);
		// A weekly entity's run settles its week and names its place in the month.
		reset();
		required(required(tables.get('entity'))[0]).pay_frequency = 'WEEKLY';
		shows('PERIOD_PART', 'double(period.parts) * 10.0 + double(period.part)');
		const plan = yield* run('2026-03-2', 'REGULAR');
		assert.deepEqual(
			[plan.run.salary_from, plan.run.salary_to, plan.run.attendance_from],
			['2026-03-08', '2026-03-14', '2026-03-08']
		);
		assert.equal(shown(plan, 'e1', 'PERIOD_PART'), 52);
	})
);

it.effect(
	'earned.history reaches 24 months: a top-n of the scheme bases charged',
	Effect.fnUntraced(function* () {
		reset();
		yield* run('2025-12', 'REGULAR');
		const version = versionOn('2027-01');
		for (const [code, quantity] of [
			['HISTORY_SPAN', 'double(size(earned.history)) * 10.0 + double(size(earned.months))'],
			['TOP_CPF_BASE', 'sum(top(earned.history.map(m, m.statutory.CPF.base), 6))']
		] satisfies readonly (readonly [string, string])[])
			required(tables.get('work_catalog')).push({
				id: fixtureId(`w-${code}`),
				settings_id: version,
				code,
				name: code,
				component_code: code,
				eligibility: 'true',
				quantity,
				rate: '1.0',
				destination: 'EMPLOYER',
				direction: 'ADD',
				counts_toward: []
			});
		const january = yield* run('2027-01', 'REGULAR');
		// December 2025 is beyond `earned.months` (12 months) and inside `earned.history`.
		assert.equal(shown(january, 'e3', 'HISTORY_SPAN'), 10);
		assert.equal(shown(january, 'e3', 'TOP_CPF_BASE'), 4800);
		assert.deepEqual(evaluateConfigured('top([3.0, 9.0, 1.0, 7.0], 2)', {}), [9, 7]);
	})
);

it.effect(
	'a workplace case names a kind its governing version lists and takes its employment’s company',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('rule_set', [
			{
				id: fixtureId('rule-case_kinds'),
				settings_id: versionOn('2026-03'),
				family: 'PAYROLL',
				code: 'case_kinds',
				name: 'case_kinds',
				rules: { kinds: [{ code: 'FLEXIBLE_WORK_REQUEST', name: 'Flexible work request' }] }
			}
		]);
		const admit = (input: Partial<Parameters<typeof admitCase>[0]>) =>
			provide(
				Effect.result(
					admitCase({
						company_id: null,
						employment_id: nativeId('employment_contract', fixtureId('k-e1')),
						kind: 'FLEXIBLE_WORK_REQUEST',
						opened_on: PlainDate('2026-03-02'),
						closed_on: null,
						...input
					})
				)
			);
		const admitted = yield* admit({});
		assert.ok(admitted._tag === 'Success' && admitted.success === COMPANY);
		for (const input of [
			{ kind: 'DATA_BREACH' },
			{ closed_on: PlainDate('2026-03-01') },
			{ opened_on: PlainDate('2027-03-02') }
		]) {
			const refused = yield* admit(input);
			assert.equal(refused._tag, 'Failure', JSON.stringify(input));
		}
	})
);

it.effect(
	'leave taken under an earlier version’s class of the same code counts after the version changes',
	Effect.fnUntraced(function* () {
		reset();
		// One class code in two versions: SG's January–June 2026 version and its July successor.
		for (const period of ['2026-03', '2026-08'])
			required(tables.get('leave_catalog')).push({
				can_encash: true,
				id: fixtureId(`metered-${period}`),
				settings_id: versionOn(period),
				code: 'METERED_LEAVE',
				name: 'Metered leave',
				entitlement: { overdraw: '0', window: 'CALENDAR_YEAR', days: '10.0' }
			});
		// Two days in March, recorded under the earlier version's row.
		entry(
			'leave_catalog_entry',
			'march',
			'e1',
			'metered-2026-03',
			'2026-03-10',
			{ days: 2, from: PlainDate('2026-03-10'), to: PlainDate('2026-03-11') },
			'TIME_OFF'
		);
		const state = yield* provide(
			leaveState(nativeId('employment_contract', fixtureId('k-e1')), '2026-08-03')
		);
		const balance = required(
			leaveBalances({
				...state,
				classes: state.classes.filter((cls) => cls.code === 'METERED_LEAVE')
			})[0]
		);
		assert.deepEqual([balance.taken, balance.available], [2, 8]);
		// A write under the later version is judged against the same year: nine days exceed the eight left.
		yield* assertFailure(
			transformed('leave_catalog_entry', [
				{
					catalog_id: nativeId('leave_catalog', fixtureId('metered-2026-08')),
					employment_id: nativeId('employment_contract', fixtureId('k-e1')),
					occurred_on: PlainDate('2026-08-03'),
					activity: 'TIME_OFF',
					days: Decimal.of('9'),
					from: PlainDate('2026-08-03'),
					to: PlainDate('2026-08-13')
				}
			]),
			/available 8 day/
		);
	})
);

/** The carry rule the seed states for every carry_uncovered scheme: advance what net lacks, recover what it leaves. */
const SEEDED_CARRY = {
	advance: 'min(carry.short, carry.share)',
	recover: 'min(carry.owed, carry.left)'
};
/** March: e2's 5,000 recovery leaves 500 for 5,500 gross, so CPF's employee share is partly advanced. */
const carriedMarch = (rule: Row) => {
	required(tables.get('statutory_contribution_catalog'))
		.filter((row) => row.code === 'CPF')
		.forEach((row) => {
			row.configuration = { ...record(row.configuration), carry_uncovered: rule };
		});
	required(tables.get('adhoc_catalog')).push({
		id: fixtureId('recover'),
		bands: [],
		settings_id: versionOn('2026-03'),
		code: 'ADVANCE_RECOVERY',
		name: 'Advance recovery',
		destination: 'NET',
		direction: 'SUBTRACT',
		counts_toward: []
	});
	entry('adhoc_catalog_entry', 'adv', 'e2', 'recover', '2026-03-05', {
		amount: Decimal.of('5000')
	});
};
const carried = (plan: Plan, person: string) =>
	slip(plan, person)
		.adjustments.filter((line) => line.family === 'STATUTORY_CARRY')
		.map((line) => [line.component_code, line.amount]);

it.effect(
	'lines H6: the scheme’s carry_uncovered.recover CEL schedules the recovery; without the rule an advance refuses',
	Effect.fnUntraced(function* () {
		reset();
		carriedMarch({ ...SEEDED_CARRY, recover: 'min(carry.owed, carry.left) / 2.0' });
		const march = yield* run('2026-03', 'REGULAR');
		const short = required(required(carried(march, 'e2')[0])[1]);
		assert.ok(typeof short === 'number' && short > 0);
		// Half of what is owed each slip, not all of it at once.
		const half = Math.round((short / 2) * 100) / 100;
		assert.deepEqual(carried(yield* run('2026-04', 'REGULAR'), 'e2'), [['CPF_CARRIED', -half]]);
		// An advance outstanding under a scheme whose row states no carry rule is refused, not recovered by default.
		reset();
		carriedMarch(SEEDED_CARRY);
		yield* run('2026-03', 'REGULAR');
		required(tables.get('statutory_contribution_catalog'))
			.filter((row) => row.code === 'CPF')
			.forEach((row) => {
				const { carry_uncovered: _rule, ...rest } = record(row.configuration);
				row.configuration = rest;
			});
		assert.match(
			yield* refused('2026-04', 'REGULAR'),
			/statutory_contribution_catalog CPF: configuration\.carry_uncovered is not stated/
		);
	})
);

it.effect(
	'a carry_uncovered scheme advances the share net cannot cover and recovers it from the next slip',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('statutory_contribution_catalog'))
			.filter((row) => row.code === 'CPF')
			.forEach((row) => {
				row.configuration = {
					...record(row.configuration),
					carry_uncovered: SEEDED_CARRY,
					// `net_available`: what the slip's priced lines and the schemes assessed before it leave.
					warn_when: [
						{ when: 'net_available == 500.0 - charged.month.CDAC.employee', message: 'net seen' }
					]
				};
			});
		required(tables.get('adhoc_catalog')).push({
			id: fixtureId('recover'),
			bands: [],
			settings_id: versionOn('2026-03'),
			code: 'ADVANCE_RECOVERY',
			name: 'Advance recovery',
			destination: 'NET',
			direction: 'SUBTRACT',
			counts_toward: []
		});
		entry('adhoc_catalog_entry', 'adv', 'e2', 'recover', '2026-03-05', {
			amount: Decimal.of('5000')
		});
		const march = yield* run('2026-03', 'REGULAR');
		const shelly = slip(march, 'e2');
		const employee = (plan: Plan) =>
			slip(plan, 'e2').statutory.reduce((sum, line) => sum + line.employee_amount, 0);
		// 5,500 gross less 5,000 recovered leaves 500 for the employee shares; CPF's uncovered part is advanced.
		const short = Math.round((employee(march) - 500) * 100) / 100;
		assert.ok(short > 0);
		assert.ok(march.warnings.includes('Shelly: net seen'));
		assert.equal(shelly.net, 0);
		assert.deepEqual(
			shelly.adjustments
				.filter((line) => line.family === 'STATUTORY_CARRY')
				.map((line) => [line.component_code, line.amount]),
			[['CPF_CARRIED', short]]
		);
		// CPF is still charged in full for the month: the advance is the employer's, not a smaller share.
		assert.equal(required(line(march, 'e2', 'CPF')).employee_amount, 1100);
		const april = yield* run('2026-04', 'REGULAR');
		assert.deepEqual(
			slip(april, 'e2')
				.adjustments.filter((line) => line.family === 'STATUTORY_CARRY')
				.map((line) => [line.component_code, line.amount]),
			[['CPF_CARRIED', -short]]
		);
		assert.equal(slip(april, 'e2').net, Math.round((5500 - employee(april) - short) * 100) / 100);
		// Recovered once: May carries nothing.
		const may = yield* run('2026-05', 'REGULAR');
		assert.equal(
			slip(may, 'e2').adjustments.filter((line) => line.family === 'STATUTORY_CARRY').length,
			0
		);
	})
);

it.effect(
	'an off-cycle run reads the period’s leave rows at the statutory step, settled or not',
	Effect.fnUntraced(function* () {
		reset();
		entry(
			'leave_catalog_entry',
			'al',
			'e1',
			catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03'),
			'2026-03-10',
			{ days: 1, from: PlainDate('2026-03-10'), to: PlainDate('2026-03-10') },
			'TIME_OFF'
		);
		required(tables.get('statutory_contribution_catalog'))
			.filter((row) => row.code === 'CPF')
			.forEach((row) => {
				row.configuration = {
					...record(row.configuration),
					warn_when: [
						{
							when: 'has(leave.rows) && leave.rows.exists(l, l.code == "ANNUAL_LEAVE")',
							message: 'leave seen'
						}
					]
				};
			});
		// The regular run settles the leave row; a bonus paid off-cycle afterwards still sees it.
		yield* run('2026-03', 'REGULAR');
		entry(
			'adhoc_catalog_entry',
			'bonus-1',
			'e1',
			catalog('adhoc_catalog', 'bonus', '2026-03'),
			'2026-03-20',
			{ amount: Decimal.of('1000') }
		);
		const bonus = yield* run('2026-03', 'OFF_CYCLE', ['bonus-1']);
		assert.deepEqual(bonus.warnings, ['Kavriel: leave seen']);
		// The off-cycle slip pins nothing of the leave it read.
		assert.deepEqual(
			slip(bonus, 'e1').pins.map((pin) => pin.collection),
			['adhoc_catalog_entry']
		);
	})
);

it.effect(
	'banked overtime: hours elected as time off leave overtime pay and credit the attendance root',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('roster_entry')).push({
			id: fixtureId('r-ot'),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date: PlainDate('2026-03-03'),
			planned_overtime_hours: 4,
			worked_intervals: clocked('2026-03-03', 4),
			banked_overtime_hours: 1.5
		});
		shows('PAID_OT', 'work.overtime_hours');
		shows('BANKED_OT', 'sum(work.days.map(d, d.banked_hours))');
		shows('WORKED_OT', 'hours.month.overtime_hours');
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(
			['PAID_OT', 'BANKED_OT', 'WORKED_OT'].map((code) => shown(plan, 'e1', code)),
			[2.5, 1.5, 4]
		);
		required(tables.get('leave_catalog')).push({
			can_encash: true,
			id: fixtureId('lc-toil'),
			settings_id: versionOn('2026-03'),
			code: 'TIME_OFF_IN_LIEU',
			name: 'Time off in lieu',
			entitlement: {
				overdraw: '0',
				window: 'CALENDAR_YEAR',
				days: 'attendance.window.banked_hours / 7.5'
			}
		});
		const state = yield* provide(
			leaveState(nativeId('employment_contract', fixtureId('k-e1')), '2026-03-31')
		);
		const toil = required(
			leaveBalances({
				...state,
				classes: state.classes.filter((cls) => cls.code === 'TIME_OFF_IN_LIEU')
			})[0]
		);
		assert.equal(toil.entitlement, 0.2);
	})
);

it.effect(
	'a work suspension: its days in work.days and the attendance root, its effects its kind’s CEL',
	Effect.fnUntraced(function* () {
		reset();
		// One generic catalogue row: attended, still scheduled, paid 60% of a day's base.
		setSuspensionKinds([
			{
				settings_id: versionOn('2026-03'),
				code: 'CLOSURE',
				name: 'Closure',
				counts_as_attended: 'true',
				scheduled: 'day.day_type == "WORK"',
				pay: '0.6 * terms.base_salary / 26.0'
			},
			{
				settings_id: versionOn('2026-03'),
				code: 'EXCLUDED',
				name: 'Excluded',
				counts_as_attended: 'false',
				scheduled: 'false'
			}
		]);
		const suspension = (id: string, kind: string, from: string, to: string, ids: string[]) => ({
			id: fixtureId(id),
			company_id: COMPANY,
			kind,
			starts_on: PlainDate(from),
			ends_on: PlainDate(to),
			worksite: null,
			employment_ids: ids.map(fixtureId),
			facts: {}
		});
		tables.set('work_suspension', [
			suspension(fixtureId('s1'), 'CLOSURE', '2026-03-04', '2026-03-05', ['k-e2']),
			suspension('s2', 'EXCLUDED', '2026-03-09', '2026-03-09', ['k-e2'])
		]);
		shows(
			'SUSPENDED_PAY',
			'sum(work.days.filter(d, d.suspended != null && d.suspended.counts_as_attended).map(d, d.suspended.pay))'
		);
		const plan = yield* run('2026-03', 'REGULAR');
		// Two closure days at 0.6 × 5,500 / 26 each, a day rounded to the cent.
		assert.equal(shown(plan, 'e2', 'SUSPENDED_PAY'), 2 * 126.92);
		// Only the employments it names: Kavriel works on.
		assert.equal(shown(plan, 'e1', 'SUSPENDED_PAY'), undefined);
		required(tables.get('leave_catalog')).push({
			can_encash: true,
			id: fixtureId('lc-susp'),
			settings_id: versionOn('2026-03'),
			code: 'SUSPENSION_TALLY',
			name: 'Suspension tally',
			entitlement: {
				overdraw: '0',
				window: 'CALENDAR_YEAR',
				days: 'double(attendance.window.suspended.CLOSURE) * 1000.0 + double(attendance.window.scheduled) * 10.0 + double(attendance.window.worked)'
			}
		});
		const state = yield* provide(
			leaveState(nativeId('employment_contract', fixtureId('k-e2')), '2026-03-31')
		);
		// 2 closure days, counted as attended; 64 weekdays to 31 March less the excluded one.
		assert.equal(
			required(
				leaveBalances({
					...state,
					classes: state.classes.filter((cls) => cls.code === 'SUSPENSION_TALLY')
				})[0]
			).entitlement,
			2000 + 63 * 10 + 2
		);
		const admit = (input: Partial<Parameters<typeof admitSuspension>[0]>) =>
			provide(
				Effect.result(
					admitSuspension({
						company_id: COMPANY,
						kind: 'CLOSURE',
						starts_on: PlainDate('2026-03-04'),
						ends_on: PlainDate('2026-03-05'),
						...input
					})
				)
			);
		assert.equal((yield* admit({}))._tag, 'Success');
		assert.equal((yield* admit({ kind: 'STRIKE' }))._tag, 'Failure');
		assert.equal((yield* admit({ ends_on: PlainDate('2026-03-03') }))._tag, 'Failure');
	})
);

it.effect(
	'back-to-back leave rows of one class are one chain: chain_from and the month of the leave',
	Effect.fnUntraced(function* () {
		reset();
		const annualLeave = catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03');
		entry(
			'leave_catalog_entry',
			'first',
			'e1',
			annualLeave,
			'2026-01-15',
			{
				days: 32,
				from: PlainDate('2026-01-15'),
				to: PlainDate('2026-02-28'),
				payslip_id: fixtureId('paid')
			},
			'TIME_OFF'
		);
		entry(
			'leave_catalog_entry',
			'extension',
			'e1',
			annualLeave,
			'2026-03-01',
			{ days: 22, from: PlainDate('2026-03-01'), to: PlainDate('2026-03-31') },
			'TIME_OFF'
		);
		shows('CHAIN_FROM', 'leave.rows.exists(l, l.chain_from == "2026-01-15") ? 1.0 : 0.0');
		shows('LEAVE_MONTH', 'sum(leave.rows.map(l, double(l.month_index)))');
		const plan = yield* run('2026-03', 'REGULAR');
		// The extension continues the leave from 15 January: March is its second month, not its first.
		assert.deepEqual(
			['CHAIN_FROM', 'LEAVE_MONTH'].map((code) => shown(plan, 'e1', code)),
			[1, 2]
		);
	})
);

it.effect(
	'a PAYEE engagement: a non-employee paid through entries alone, outside the headcount',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('employment_profile')).push({
			id: fixtureId('x1'),
			name: 'Consultant',
			facts: {}
		});
		required(tables.get('employment_contract')).push({
			id: fixtureId('k-x1'),
			employee_number: 'consultant',
			contract_number: 1,
			employee_id: nativeId('employment_profile', fixtureId('x1')),
			company_id: COMPANY,
			engagement: 'PAYEE',
			effective_range: { from: PlainDate('2026-01-01'), to: null },
			facts: { contract_terms: [{ effective_range: { from: PlainDate('2026-01-01'), to: null } }] }
		});
		required(tables.get('adhoc_catalog')).push({
			id: fixtureId('fee'),
			bands: [],
			settings_id: versionOn('2026-03'),
			code: 'SERVICE_FEE',
			name: 'Service fee',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: []
		});
		entry('adhoc_catalog_entry', 'fee-1', 'x1', 'fee', '2026-03-10', {
			amount: Decimal.of('2000')
		});
		shows('ENGAGED', 'employment.engagement == "PAYEE" ? 1.0 : 0.0 + double(company.headcount)');
		// The payee's slip: the fee alone, with no salary and no base salary demanded.
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(
			slip(plan, 'x1').adjustments.map((row) => [row.component_code, row.amount]),
			[['SERVICE_FEE', 2000]]
		);
		assert.deepEqual(slip(plan, 'x1').base, []);
		// An employee's slip counts three in the headcount, not four.
		assert.equal(shown(plan, 'e1', 'ENGAGED'), 3);
	})
);

it.effect(
	'a weekly slip’s statutory `wage` is its own week, `month` the month to date',
	Effect.fnUntraced(function* () {
		reset();
		required(required(tables.get('entity'))[0]).pay_frequency = 'WEEKLY';
		const cpf = required(tables.get('statutory_contribution_catalog')).filter(
			(row) => row.code === 'CPF'
		);
		for (const row of cpf)
			row.configuration = {
				...record(row.configuration),
				warn_when: [
					{
						when: 'period.part == 2 && wage.ordinary > 0.0 && month.ordinary > wage.ordinary',
						message: 'own week'
					}
				]
			};
		yield* run('2026-03-1', 'REGULAR');
		const second = yield* run('2026-03-2', 'REGULAR');
		assert.ok(second.warnings.includes('Kavriel: own week'));
	})
);

it.effect(
	'anonymising a former employee waits for the governing version’s record_retention date',
	Effect.fnUntraced(function* () {
		reset();
		const e3 = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e3'))
		);
		e3.effective_range = { from: PlainDate('2019-01-01'), to: PlainDate('2026-03-31') };
		tables.set('rule_set', [
			{
				id: fixtureId('rule-record_retention'),
				settings_id: versionOn('2026-03'),
				family: 'PAYROLL',
				code: 'record_retention',
				name: 'record_retention',
				rules: { until: 'add_years(employment.exit_date, 5)' }
			}
		]);
		const admit = (employee: string, today: string) =>
			provide(
				Effect.result(admitAnonymise(nativeId('employment_profile', fixtureId(employee)), today))
			);
		// Still employed: refused.
		assert.equal((yield* admit('e1', '2040-01-01'))._tag, 'Failure');
		// Ended, but within the five years: refused with the day it becomes possible.
		const early = yield* admit('e3', '2031-03-30');
		assert.ok(early._tag === 'Failure' && /2031-03-31/.test(early.failure.message));
		const due = yield* admit('e3', '2031-03-31');
		assert.ok(due._tag === 'Success' && due.success === '2031-03-31');
		// A version without the rule never allows it.
		tables.set('rule_set', []);
		assert.equal((yield* admit('e3', '2040-01-01'))._tag, 'Failure');
		// The neutral values keep nothing personal.
		const blank = anonymousProfile();
		assert.equal(blank.date_of_birth, null);
		assert.equal(blank.identity_number, null);
		assert.deepEqual([blank.children, blank.facts], [[], {}]);
	})
);

it.effect(
	'earned months carry the days and hours worked and the suspended days of each month',
	Effect.fnUntraced(function* () {
		reset();
		setSuspensionKinds([
			{
				settings_id: versionOn('2026-02'),
				code: 'CLOSURE',
				name: 'Closure',
				authority: 'Act s.1',
				counts_as_attended: 'false',
				scheduled: 'true'
			}
		]);
		tables.set('work_suspension', [
			{
				id: fixtureId('s1'),
				company_id: COMPANY,
				kind: 'CLOSURE',
				starts_on: PlainDate('2026-02-10'),
				ends_on: PlainDate('2026-02-11'),
				worksite: null,
				employment_ids: ['k-e1'].map(fixtureId),
				facts: {}
			}
		]);
		for (const date of ['2026-02-02', '2026-02-03'])
			required(tables.get('roster_entry')).push({
				id: fixtureId(`r-${date}`),
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				work_date: date,
				worked_intervals: [
					{ start: Instant(`${date}T01:00:00.000Z`), end: Instant(`${date}T09:00:00.000Z`) }
				]
			});
		yield* run('2026-02', 'REGULAR');
		shows(
			'FEBRUARY',
			'sum(earned.months.filter(m, m.month == "2026-02").map(m, double(m.worked_days) * 1000.0 + m.worked_hours * 10.0 + double(m.suspended_days)))'
		);
		const march = yield* run('2026-03', 'REGULAR');
		// Two attended days credited their actual seven hours each (09:00–17:00 on the 09:00–18:00 shift, less the
		// break: the clock's shortfall is not paid), two suspended.
		assert.equal(shown(march, 'e1', 'FEBRUARY'), 2142);
	})
);

it('count_within stays O(log n) a call: a rolling test over every item of a long list is fast', () => {
	const list = Array.from({ length: 2000 }, (_, i) => ({
		d: String(addDays('2026-01-01', Math.floor(i / 10))),
		facts: { worksite: 'A', note: 'x'.repeat(40) }
	}));
	const started = performance.now();
	const matched = evaluateConfigured(
		'l.exists(s, count_within(l, "d", s.d, add_days(s.d, 59)) > 600)',
		{ l: list }
	);
	const elapsed = performance.now() - started;
	assert.equal(matched, false);
	// 2,000 calls over 2,000 items: a whole-list check per call would be ~4 million item checks.
	assert.ok(elapsed < 500, `${elapsed} ms`);
});

it('count_within counts a sorted list’s items whose field falls in a range', () => {
	const list = [{ d: '2026-01-01' }, { d: '2026-01-10' }, { d: '2026-02-01' }, { d: '2026-03-01' }];
	assert.equal(
		evaluateConfigured('count_within(l, "d", "2026-01-05", "2026-02-01")', { l: list }),
		2
	);
	assert.equal(
		evaluateConfigured('count_within(l, "d", "2027-01-01", "2027-12-31")', { l: list }),
		0
	);
	assert.equal(
		evaluateConfigured('count_within(l, "d", "2025-01-01", "2026-12-31")', { l: list }),
		4
	);
});

it.effect(
	'banked overtime carries its band on the work day',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('roster_entry')).push({
			id: fixtureId('r-ot'),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date: PlainDate('2026-03-03'),
			planned_overtime_hours: 4,
			worked_intervals: clocked('2026-03-03', 4),
			banked_overtime_hours: 1.5,
			banked_overtime_band: 'FIRST_TWO'
		});
		shows(
			'BANKED_BAND',
			'sum(work.days.filter(d, d.banked_band == "FIRST_TWO").map(d, d.banked_hours))'
		);
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'BANKED_BAND'), 1.5);
	})
);

it.effect(
	'a suspended day names its suspension’s range and the scheduled days elapsed since it began',
	Effect.fnUntraced(function* () {
		reset();
		setSuspensionKinds([
			{
				settings_id: versionOn('2026-03'),
				code: 'CLOSURE',
				name: 'Closure',
				counts_as_attended: 'false',
				scheduled: 'true',
				pay: '1.0'
			}
		]);
		// From Thursday 26 February into March: two February working days, then March.
		tables.set('work_suspension', [
			{
				id: fixtureId('s1'),
				company_id: COMPANY,
				kind: 'CLOSURE',
				starts_on: PlainDate('2026-02-26'),
				ends_on: PlainDate('2026-03-04'),
				worksite: null,
				employment_ids: ['k-e1'].map(fixtureId),
				facts: {}
			}
		]);
		shows(
			'ELAPSED',
			'sum(work.days.filter(d, d.suspended != null && d.suspended.from == "2026-02-26" && d.suspended.to == "2026-03-04").map(d, double(d.suspended.working_days_elapsed)))'
		);
		// Sunday 1 March follows two working days; 2, 3 and 4 March are the 3rd, 4th and 5th.
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'ELAPSED'), 2 + 3 + 4 + 5);
		required(tables.get('leave_catalog')).push({
			can_encash: true,
			id: fixtureId('lc-s'),
			settings_id: versionOn('2026-03'),
			code: 'SUSPENSIONS',
			name: 'Suspensions',
			entitlement: {
				overdraw: '0',
				window: 'CALENDAR_YEAR',
				days: 'double(size(attendance.window.suspensions.filter(s, s.kind == "CLOSURE" && s.from == "2026-02-26" && s.to == "2026-03-04")))'
			}
		});
		const state = yield* provide(
			leaveState(nativeId('employment_contract', fixtureId('k-e1')), '2026-03-31')
		);
		assert.equal(
			required(
				leaveBalances({
					...state,
					classes: state.classes.filter((cls) => cls.code === 'SUSPENSIONS')
				})[0]
			).entitlement,
			1
		);
	})
);

it('the canonical window-end encashment pays a class’s untaken balance on its window’s last day, once', () => {
	const pack = behavioursOf(required(law('jurisdiction_settings')[0])['behaviours']);
	assert.ok(pack);
	const context = (day: string, reference: string | null) => ({
		event: {
			collection: 'calendar',
			action: 'daily',
			settings_id: fixtureId('s1'),
			day,
			row: { id: fixtureId('k-e1') },
			leave_balances: [
				{ code: 'TIME_OFF_IN_LIEU', available: 3.5, window_to: '2026-12-31' },
				{ code: 'ANNUAL_LEAVE', available: 9, window_to: '2026-12-31' }
			]
		},
		catalogues: [{ id: fixtureId('toil'), code: 'TIME_OFF_IN_LIEU' }],
		movements: reference == null ? [] : [{ reference }]
	});
	const writes = (day: string, reference: string | null = null) =>
		planBehaviours(
			pack,
			{ kind: 'row', collection: 'calendar', event: 'daily' },
			context(day, reference)
		)
			.filter((rule) => rule.id === 'encash-leave-at-window-end')
			.flatMap((rule) => effectWrites(rule, context(day, reference)))
			.map((write) => write.data);
	assert.deepEqual(writes('2026-12-31'), [
		{
			catalog_id: fixtureId('toil'),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			occurred_on: PlainDate('2026-12-31'),
			activity: 'ENCASHMENT',
			reference: `window:${fixtureId('k-e1')}:TIME_OFF_IN_LIEU:2026-12-31`,
			days: 3.5
		}
	]);
	assert.deepEqual(writes('2026-12-30'), []);
	assert.deepEqual(
		writes('2026-12-31', `window:${fixtureId('k-e1')}:TIME_OFF_IN_LIEU:2026-12-31`),
		[]
	);
});

it.effect(
	'earned months count leave days by class and suspended days by kind',
	Effect.fnUntraced(function* () {
		reset();
		setSuspensionKinds([
			{
				settings_id: versionOn('2026-02'),
				code: 'CLOSURE',
				name: 'Closure',
				counts_as_attended: 'false',
				scheduled: 'true'
			}
		]);
		tables.set('work_suspension', [
			{
				id: fixtureId('s1'),
				company_id: COMPANY,
				kind: 'CLOSURE',
				starts_on: PlainDate('2026-02-10'),
				ends_on: PlainDate('2026-02-11'),
				worksite: null,
				employment_ids: ['k-e1'].map(fixtureId),
				facts: {}
			}
		]);
		// Thursday 5 to Monday 9 February: three scheduled days of annual leave.
		entry(
			'leave_catalog_entry',
			'al-feb',
			'e1',
			catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-02'),
			'2026-02-05',
			{ days: 3, from: PlainDate('2026-02-05'), to: PlainDate('2026-02-09') },
			'TIME_OFF'
		);
		yield* run('2026-02', 'REGULAR');
		shows(
			'FEB_LEAVE',
			'sum(earned.months.filter(m, m.month == "2026-02").map(m, (has(m.leave_days.ANNUAL_LEAVE) ? double(m.leave_days.ANNUAL_LEAVE) : 0.0) * 10.0 + (has(m.suspended_days_by_kind.CLOSURE) ? double(m.suspended_days_by_kind.CLOSURE) : 0.0)))'
		);
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'FEB_LEAVE'), 32);
	})
);

it.effect(
	'a roster week splits its overtime by day type and holiday, so a cap can leave rest-day work out',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('rule_set', [
			{
				id: fixtureId('rule-WEEKLY_OT_CAP'),
				settings_id: versionOn('2026-03'),
				family: 'VALIDATIONS',
				code: 'WEEKLY_OT_CAP',
				name: 'WEEKLY_OT_CAP',
				rules: {
					site: 'roster',
					kind: 'warn',
					when: 'week.overtime_hours_by_day_type.WORK - week.overtime_hours_by_day_type.HOLIDAY > 3.0',
					message: 'over the weekly cap'
				}
			}
		]);
		required(tables.get('holiday')).push({
			id: fixtureId('h1'),
			company_id: COMPANY,
			date: PlainDate('2026-03-04'),
			name: 'Holiday',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2026-01-01T00:00:00.000Z'
		});
		const day = (ref: number, work_date: string, overtime: number) => ({
			ref,
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date,
			worked_intervals: clocked(work_date, overtime),
			leave_code: ''
		});
		const findings = (drafts: ReturnType<typeof day>[]) =>
			provide(rosterFindings(COMPANY, drafts)).pipe(
				Effect.map((rows) => rows.map((row) => [row.ref, row.code]))
			);
		// 2 h on Monday, 2 h on the Wednesday holiday, 6 h on Saturday's rest day: 2 h of capped overtime.
		assert.deepEqual(
			yield* findings([day(1, '2026-03-02', 2), day(2, '2026-03-04', 2), day(3, '2026-03-07', 6)]),
			[]
		);
		// 4 weekday hours trip it.
		assert.deepEqual(yield* findings([day(1, '2026-03-02', 2), day(2, '2026-03-03', 2)]), [
			[2, 'WEEKLY_OT_CAP']
		]);
	})
);

it.effect(
	'a roster day carries its own overtime consent: a check keyed to the day, not the contract',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('rule_set', [
			{
				id: fixtureId('rule-OT_WITHOUT_CONSENT'),
				settings_id: versionOn('2026-03'),
				family: 'VALIDATIONS',
				code: 'OT_WITHOUT_CONSENT',
				name: 'OT_WITHOUT_CONSENT',
				rules: {
					site: 'roster',
					kind: 'warn',
					when: 'day.overtime_hours > 0.0 && !day.overtime_consented && day.overtime_consented_at == null',
					message: 'overtime without consent'
				}
			}
		]);
		const day = (ref: number, work_date: string, consent: string | null) => ({
			ref,
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date,
			worked_intervals: clocked(work_date, 2),
			overtime_consented_at: consent === null ? null : Instant(consent),
			leave_code: ''
		});
		const findings = yield* provide(
			rosterFindings(COMPANY, [
				day(1, '2026-03-02', null),
				day(2, '2026-03-03', '2026-03-03T00:00:00.000Z')
			])
		);
		assert.deepEqual(
			findings.map((row) => [row.ref, row.code]),
			[[1, 'OT_WITHOUT_CONSENT']]
		);
	})
);

it.effect(
	'a roster week separates holiday overtime by the holiday’s day type and counts its normal holiday hours',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('rule_set', [
			{
				id: fixtureId('rule-HOLIDAY_SPLIT'),
				settings_id: versionOn('2026-03'),
				family: 'VALIDATIONS',
				code: 'HOLIDAY_SPLIT',
				name: 'HOLIDAY_SPLIT',
				rules: {
					site: 'roster',
					kind: 'warn',
					when: '(day.date == "2026-03-04" && week.holiday_worked_hours == 8.0 && week.holiday_or_rest_worked_hours == 8.0) || (day.date == "2026-03-07" && week.overtime_hours_holiday_by_day_type.REST == 3.0 && week.overtime_hours_holiday_by_day_type.WORK == 2.0 && week.holiday_worked_hours == 8.0 && week.holiday_or_rest_worked_hours == 8.0)',
					message: 'split'
				}
			}
		]);
		for (const [id, date] of [
			['h1', '2026-03-04'],
			['h2', '2026-03-07']
		] satisfies readonly (readonly [string, string])[])
			required(tables.get('holiday')).push({
				id: fixtureId(id),
				company_id: COMPANY,
				date,
				name: 'Holiday',
				kind: 'PUBLIC_HOLIDAY',
				published_at: '2026-01-01T00:00:00.000Z'
			});
		// A Wednesday holiday 2 h past its shift, a Saturday (rest-day) holiday worked 3 h, a rest Saturday before 10 h.
		const day = (ref: number, work_date: string, overtime: number) => ({
			ref,
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date,
			worked_intervals: clocked(work_date, overtime),
			leave_code: ''
		});
		const findings = yield* provide(
			rosterFindings(COMPANY, [
				day(0, '2026-02-28', 10),
				day(1, '2026-03-04', 2),
				day(3, '2026-03-06', 2),
				day(2, '2026-03-07', 3)
			])
		);
		// The working holiday's 8 planned hours are its normal hours; rest days have none, all their hours are overtime.
		assert.deepEqual(
			findings.map((row) => [row.ref, row.code]),
			[
				[1, 'HOLIDAY_SPLIT'],
				[2, 'HOLIDAY_SPLIT']
			]
		);
	})
);

it.effect(
	'money rounds to the payroll currency’s minor units, or the version’s payroll.minor_units',
	Effect.fnUntraced(function* () {
		assert.equal(currencyScale('JPY'), 0);
		assert.equal(currencyScale('SGD'), 2);
		reset();
		shows('THIRD', '1.0', '1000.0 / 3.0');
		const sgd = yield* run('2026-03', 'REGULAR');
		assert.equal(shown(sgd, 'e1', 'THIRD'), 333.33);
		// The same record under a version paid in whole units.
		reset();
		const version = required(
			required(tables.get('jurisdiction_settings')).find((row) => row.id === versionOn('2026-03'))
		);
		version.payroll = { ...record(version.payroll), minor_units: 0 };
		shows('THIRD', '1.0', '1000.0 / 3.0');
		const whole = yield* run('2026-03', 'REGULAR');
		assert.equal(shown(whole, 'e1', 'THIRD'), 333);
		assert.ok(
			whole.payslips.every(
				(row) =>
					Number.isInteger(row.net) &&
					row.statutory.every((line) => Number.isInteger(line.employee_amount))
			)
		);
	})
);

it.effect(
	'the year roots start in the version’s payroll.tax_year_start_month',
	Effect.fnUntraced(function* () {
		reset();
		const version = required(
			required(tables.get('jurisdiction_settings')).find((row) => row.id === versionOn('2026-03'))
		);
		version.payroll = { ...record(version.payroll), tax_year_start_month: 4 };
		yield* run('2026-03', 'REGULAR');
		yield* run('2026-04', 'REGULAR');
		shows('YEAR_GROSS', 'earned.year.gross', '1.0', 'period.key == "2026-05"');
		const may = yield* run('2026-05', 'REGULAR');
		// April alone: March belongs to the tax year that ended.
		assert.equal(shown(may, 'e1', 'YEAR_GROSS'), 6500);
	})
);

it.effect(
	'local days and clocks follow the entity zone, else the version’s payroll.timezone',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('roster_entry')).push({
			id: fixtureId('r-am'),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date: PlainDate('2026-03-03'),
			worked_intervals: [
				{ start: Instant('2026-03-03T01:00:00.000Z'), end: Instant('2026-03-03T09:00:00.000Z') }
			]
		});
		shows(
			'OFFICE_HOURS',
			'sum(work.days.filter(d, d.date == "2026-03-03").map(d, hours_between(d.intervals, "09:00", "17:00")))'
		);
		// No entity zone: the SG version's Asia/Singapore puts 01:00–09:00 UTC at 09:00–17:00, less the planned break.
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'OFFICE_HOURS'), 7);
		reset();
		required(required(tables.get('entity'))[0]).time_zone = 'UTC';
		required(tables.get('roster_entry')).push({
			id: fixtureId('r-am'),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date: PlainDate('2026-03-03'),
			worked_intervals: [
				{ start: Instant('2026-03-03T01:00:00.000Z'), end: Instant('2026-03-03T09:00:00.000Z') }
			]
		});
		shows(
			'OFFICE_HOURS',
			'sum(work.days.filter(d, d.date == "2026-03-03").map(d, hours_between(d.intervals, "09:00", "17:00")))'
		);
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'OFFICE_HOURS'), undefined);
	})
);

it.effect(
	'audit roots: a rolling-hours span, a scheme order, validations that read worked days, one can_encash reading',
	Effect.fnUntraced(function* () {
		reset();
		const version = required(
			required(tables.get('jurisdiction_settings')).find((row) => row.id === versionOn('2026-03'))
		);
		version.payroll = { ...record(version.payroll), rolling_hours_months: 2 };
		for (const [date, hours] of [
			['2026-01-10', 3],
			['2026-02-10', 4],
			['2026-03-10', 5]
		] satisfies readonly (readonly [string, number])[])
			required(tables.get('roster_entry')).push({
				id: fixtureId(`r-${date}`),
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				work_date: date,
				payslip_id: date < '2026-03-01' ? fixtureId('paid') : null,
				planned_overtime_hours: hours,
				worked_intervals: clocked(date, hours)
			});
		// Two months rolling: February and March.
		shows('ROLLING_OT', 'hours.rolling.overtime_hours');
		// This class explicitly permits encashment on the slip and in its balance.
		required(tables.get('leave_catalog')).push({
			can_encash: true,
			id: fixtureId('lc-x'),
			settings_id: versionOn('2026-03'),
			code: 'FLAGLESS',
			name: 'Flagless'
		});
		entry(
			'leave_catalog_entry',
			'fx',
			'e1',
			'lc-x',
			'2026-03-11',
			{ days: 1, from: PlainDate('2026-03-11'), to: PlainDate('2026-03-11') },
			'TIME_OFF'
		);
		shows('ENCASHABLE', 'leave.rows.exists(l, l.code == "FLAGLESS" && l.can_encash) ? 1.0 : 0.0');
		// A payslip validation alone reading earned worked days turns the tally on.
		tables.set('rule_set', [
			{
				id: fixtureId('rule-WORKED_SEEN'),
				settings_id: versionOn('2026-03'),
				family: 'VALIDATIONS',
				code: 'WORKED_SEEN',
				name: 'WORKED_SEEN',
				rules: {
					site: 'payslip',
					kind: 'warn',
					when: 'earned.months.exists(m, has(m.worked_days))',
					message: 'worked days seen'
				}
			}
		]);
		yield* run('2026-02', 'REGULAR');
		// Schemes ordered by configuration.order before their codes: CPF first, so net_available is CPF's whole net.
		const cpf = required(tables.get('statutory_contribution_catalog')).filter(
			(row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03')
		);
		for (const row of cpf)
			row.configuration = {
				...record(row.configuration),
				order: 1,
				warn_when: [{ when: 'net_available == 6500.0', message: 'CPF first' }]
			};
		const march = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(
			['ROLLING_OT', 'ENCASHABLE'].map((code) => shown(march, 'e1', code)),
			[9, 1]
		);
		assert.ok(march.warnings.includes('Kavriel: worked days seen'));
		assert.ok(march.warnings.includes('Kavriel: CPF first'));
	})
);

/** Set keys on the version governing a month's `payroll` object. */
const payrollOf = (period: string, patch: Row) => {
	const version = required(
		required(tables.get('jurisdiction_settings')).find((row) => row.id === versionOn(period))
	);
	version.payroll = { ...record(version.payroll), ...patch };
};
const payrollWithout = (period: string, key: string) => {
	const version = required(
		required(tables.get('jurisdiction_settings')).find((row) => row.id === versionOn(period))
	);
	version.payroll = Object.fromEntries(
		Object.entries(record(version.payroll)).filter(([name]) => name !== key)
	);
};

it.effect(
	'audit 13: the run’s pay day is the version’s payroll.pay_date CEL',
	Effect.fnUntraced(function* () {
		reset();
		assert.equal((yield* run('2026-03', 'REGULAR')).run.pay_date, '2026-03-31');
		reset();
		payrollOf('2026-03', { pay_date: 'add_days(period.to, 7)' });
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual([plan.run.pay_date, plan.run.pay_due_date], ['2026-04-07', '2026-04-07']);
	})
);

/** Drop one key from the version governing a month's `payroll` object. */
const dropPayroll = (period: string, key: string) => {
	const version = required(
		required(tables.get('jurisdiction_settings')).find((row) => row.id === versionOn(period))
	);
	version.payroll = Object.fromEntries(
		Object.entries(record(version.payroll)).filter(([held]) => held !== key)
	);
};

it.effect(
	'M13: a run refuses a version that names no payroll.pay_date instead of paying on the period end',
	Effect.fnUntraced(function* () {
		reset();
		dropPayroll('2026-03', 'pay_date');
		assert.match(yield* refused('2026-03', 'REGULAR'), /SG names no payroll\.pay_date/);
	})
);

it.effect(
	'M3: payroll.ten_day_splits cuts the TEN_DAY parts; without it the period refuses',
	Effect.fnUntraced(function* () {
		const window = (period: string, ten_day_splits?: readonly number[]) =>
			payPeriodWindow(period, {
				pay_frequency: 'TEN_DAY',
				...(ten_day_splits === undefined ? {} : { ten_day_splits })
			});
		assert.deepEqual(window('2026-03-2', [10, 20]), { start: '2026-03-11', end: '2026-03-20' });
		assert.deepEqual(window('2026-03-2', [7, 14]), { start: '2026-03-08', end: '2026-03-14' });
		assert.deepEqual(window('2026-03-3', [7, 14]), { start: '2026-03-15', end: '2026-03-31' });
		assert.throws(() => window('2026-03-1'), /payroll\.ten_day_splits/);
		assert.throws(() => window('2026-03-1', [20, 10]), /payroll\.ten_day_splits/);
	})
);

it.effect(
	'audit 14: payroll.week_start and payroll.semi_monthly_split move the period boundaries',
	Effect.fnUntraced(function* () {
		const settle = (
			period: string,
			frequency: string,
			calendar: NonNullable<Parameters<typeof settlementPeriod>[2]>
		) => Effect.result(settlementPeriod(period, frequency, calendar));
		// Monday weeks: March 2026's Mondays are the 2nd, 9th, 16th, 23rd and 30th.
		const monday = yield* settle('2026-03-1', 'WEEKLY', { week_start: 1 });
		assert.ok(monday._tag === 'Success');
		assert.deepEqual(monday.success, {
			from: PlainDate('2026-03-02'),
			to: PlainDate('2026-03-08'),
			part: 1,
			parts: 5
		});
		const late = yield* settle('2026-03-2', 'SEMI_MONTHLY', { semi_monthly_split: 10 });
		assert.ok(late._tag === 'Success' && late.success.from === '2026-03-11');
		// The defaults are the seeded calendar: Sunday weeks, halves at the 15th.
		const plain = yield* settle('2026-03-1', 'WEEKLY', {});
		assert.ok(plain._tag === 'Success' && plain.success.from === '2026-03-01');
	})
);

it.effect(
	'audit 15: payroll.roster_week CALENDAR sums the calendar week from week_start, not the last seven days',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('rule_set', [
			{
				id: fixtureId('rule-WEEK_DAYS'),
				settings_id: versionOn('2026-03'),
				family: 'VALIDATIONS',
				code: 'WEEK_DAYS',
				name: 'WEEK_DAYS',
				rules: { site: 'roster', kind: 'warn', when: 'week.worked_days >= 3', message: 'three' }
			}
		]);
		const day = (ref: number, work_date: string) => ({
			ref,
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date,
			worked_intervals: [
				{ start: Instant(`${work_date}T01:00:00.000Z`), end: Instant(`${work_date}T09:00:00.000Z`) }
			],
			leave_code: ''
		});
		// Saturday, Sunday, Monday: three in the last seven days; one in Monday's calendar week.
		const drafts = [day(1, '2026-03-07'), day(2, '2026-03-08'), day(3, '2026-03-09')];
		const codes = () =>
			provide(rosterFindings(COMPANY, drafts)).pipe(
				Effect.map((rows) => rows.map((row) => row.ref))
			);
		assert.deepEqual(yield* codes(), [3]);
		payrollOf('2026-03', { roster_week: 'CALENDAR', week_start: 1 });
		assert.deepEqual(yield* codes(), []);
	})
);

it.effect(
	'audit 17: a class shares a leave row across periods by calendar days when its share_by says',
	Effect.fnUntraced(function* () {
		reset();
		const annual = catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03');
		// Friday 27 March to Thursday 2 April: 5 working days, 7 calendar; 3 working and 5 calendar in March.
		entry(
			'leave_catalog_entry',
			'span',
			'e1',
			annual,
			'2026-03-27',
			{ days: 5, from: PlainDate('2026-03-27'), to: PlainDate('2026-04-02') },
			'TIME_OFF'
		);
		shows('MARCH_SHARE', 'sum(leave.rows.map(l, l.days))');
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'MARCH_SHARE'), 3);
		required(required(tables.get('leave_catalog')).find((row) => row.id === annual)).share_by =
			'CALENDAR_DAYS';
		required(tables.get('payroll_run')).length = 0;
		required(tables.get('payslip')).length = 0;
		required(required(tables.get('leave_catalog_entry'))[0]).payslip_id = null;
		// 5 days × 5 of 7 calendar days, shown to the cent.
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'MARCH_SHARE'), 3.57);
	})
);

it.effect(
	'audit 18: a prorated line states the divisor its record names (work_catalog.denominator)',
	Effect.fnUntraced(function* () {
		reset();
		const e1 = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
		);
		e1.effective_range = { from: PlainDate('2026-03-16'), to: null };
		const basic = required(
			required(tables.get('work_catalog')).find(
				(row) => row.settings_id === versionOn('2026-03') && row.prorated === true
			)
		);
		const before = slip(yield* run('2026-03', 'REGULAR'), 'e1');
		assert.equal(required(before.proration[0]).denominator, 31);
		reset();
		required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
		).effective_range = {
			from: PlainDate('2026-03-16'),
			to: null
		};
		required(required(tables.get('work_catalog')).find((row) => row.id === basic.id)).denominator =
			'26.0';
		const after = slip(yield* run('2026-03', 'REGULAR'), 'e1');
		assert.equal(required(after.proration[0]).denominator, 26);
		assert.equal(required(after.service_basis[0]).denominator, 26);
	})
);

it.effect(
	'audit 19: payroll.base_salary_required false pays a contract with no monthly base',
	Effect.fnUntraced(function* () {
		reset();
		const term = required(
			records(
				record(
					required(
						required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
					).facts
				).contract_terms
			)[0]
		);
		term.base_salary = { value: 0, currency: 'SGD' };
		assert.match(yield* refused('2026-03', 'REGULAR'), /carries no base salary/);
		payrollOf('2026-03', { base_salary_required: false });
		// A day-rated line pays what the base does not.
		required(tables.get('work_catalog')).push({
			id: fixtureId('w-day'),
			settings_id: versionOn('2026-03'),
			code: 'DAY_RATE',
			name: 'Day rate',
			component_code: 'DAY_RATE',
			eligibility: 'terms.base_salary == 0.0',
			quantity: '22.0',
			rate: '100.0',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: []
		});
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'DAY_RATE'), 2200);
	})
);

it.effect(
	'audit 20: a class with amount_required false takes an entry priced by its bands alone',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('adhoc_catalog')).push({
			id: fixtureId('piece'),
			settings_id: versionOn('2026-03'),
			code: 'PIECE',
			name: 'Piece rate',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: [],
			amount_required: false,
			bands: [{ when: 'true', amount: 'entry.quantity * 2.5' }]
		});
		yield* transformed('adhoc_catalog_entry', [
			{
				catalog_id: nativeId('adhoc_catalog', fixtureId('piece')),
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				occurred_on: PlainDate('2026-03-05'),
				quantity: Decimal.of('40')
			}
		]);
		yield* assertFailure(
			transformed('adhoc_catalog_entry', [
				{
					catalog_id: catalog('adhoc_catalog', 'bonus', '2026-03'),
					employment_id: nativeId('employment_contract', fixtureId('k-e1')),
					occurred_on: PlainDate('2026-03-05')
				}
			]),
			/Enter the amount/
		);
	})
);

it.effect(
	'audit 21: payroll.off_cycle_families lets an off-cycle run settle loan entries',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('loan_catalog')).push({
			id: fixtureId('loan'),
			bands: [],
			settings_id: versionOn('2026-03'),
			code: 'STAFF_LOAN',
			name: 'Staff loan',
			destination: 'NET',
			direction: 'SUBTRACT'
		});
		entry('loan_repayment_entry', 'l1', 'e1', 'loan', '2026-03-05', { amount: Decimal.of('300') });
		entry(
			'adhoc_catalog_entry',
			'b1',
			'e1',
			catalog('adhoc_catalog', 'bonus', '2026-03'),
			'2026-03-05',
			{ amount: Decimal.of('1000') }
		);
		assert.match(yield* refused('2026-03', 'OFF_CYCLE', ['b1', 'l1']), /not an approved, unpaid/);
		payrollOf('2026-03', { off_cycle_families: ['ADHOC', 'CLAIM', 'LOAN_REPAYMENT'] });
		// A final settlement recovers the loan from the bonus it pays.
		const plan = yield* run('2026-03', 'OFF_CYCLE', ['b1', 'l1']);
		assert.deepEqual(
			slip(plan, 'e1')
				.adjustments.map((row) => [row.component_code, row.amount])
				.toSorted(),
			[
				['STAFF_LOAN', -300],
				['bonus', 1000]
			]
		);
	})
);

it.effect(
	'M7: an off-cycle run refuses a version that names no payroll.off_cycle_families',
	Effect.fnUntraced(function* () {
		reset();
		entry(
			'adhoc_catalog_entry',
			'b1',
			'e1',
			catalog('adhoc_catalog', 'bonus', '2026-03'),
			'2026-03-05',
			{ amount: Decimal.of('1000') }
		);
		dropPayroll('2026-03', 'off_cycle_families');
		assert.match(
			yield* refused('2026-03', 'OFF_CYCLE', ['b1']),
			/SG names no payroll\.off_cycle_families/
		);
	})
);

it.effect(
	'audit 22: a scheme reads its subject on configuration.as_of (period_end), not the period start',
	Effect.fnUntraced(function* () {
		reset();
		// Dernese turns 29 on 30 June; a June slip read at the period end sees the new age.
		const cpf = required(tables.get('statutory_contribution_catalog')).filter(
			(row) => row.code === 'CPF' && row.settings_id === versionOn('2026-06')
		);
		for (const row of cpf)
			row.configuration = {
				...record(row.configuration),
				warn_when: [{ when: 'employee.age == 29', message: 'twenty-nine' }]
			};
		required(
			required(tables.get('employment_profile')).find((row) => row.id === fixtureId('e3'))
		).date_of_birth = '1997-06-30';
		assert.ok(!(yield* run('2026-06', 'REGULAR')).warnings.includes('Dernese: twenty-nine'));
		for (const row of cpf)
			row.configuration = { ...record(row.configuration), as_of: 'period_end' };
		required(tables.get('payroll_run')).length = 0;
		required(tables.get('payslip')).length = 0;
		assert.ok((yield* run('2026-06', 'REGULAR')).warnings.includes('Dernese: twenty-nine'));
	})
);

it.effect(
	'audit 23/24: terms.monthly_wage is the version’s payroll.monthly_wage CEL; terms carries every key',
	Effect.fnUntraced(function* () {
		reset();
		const term = required(
			records(
				record(
					required(
						required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
					).facts
				).contract_terms
			)[0]
		);
		term.allowances = [
			{ code: 'TRANSPORT', amount: { value: 200, currency: 'SGD' } },
			{ code: 'MEAL', amount: { value: 100, currency: 'SGD' } }
		];
		term.pay_frequency = 'MONTHLY';
		term.grade = 'G7';
		required(tables.get('allowance_catalog')).push(
			...['TRANSPORT', 'MEAL'].map((code) => ({
				id: fixtureId(`a-${code}`),
				settings_id: versionOn('2026-03'),
				code,
				name: code,
				destination: 'DISPLAY',
				direction: 'ADD',
				counts_toward: [],
				eligibility: 'true',
				amount: 'allowance.amount'
			}))
		);
		shows(
			'WAGE',
			'terms.monthly_wage',
			'1.0',
			'has(terms.grade) && terms.grade == "G7" && terms.pay_frequency == "MONTHLY"'
		);
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'WAGE'), 6800);
		reset();
		const again = required(
			records(
				record(
					required(
						required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
					).facts
				).contract_terms
			)[0]
		);
		again.allowances = [{ code: 'TRANSPORT', amount: { value: 200, currency: 'SGD' } }];
		payrollOf('2026-03', { monthly_wage: 'terms.base_salary' });
		shows('WAGE', 'terms.monthly_wage');
		required(tables.get('allowance_catalog')).push({
			id: fixtureId('a-TRANSPORT'),
			settings_id: versionOn('2026-03'),
			code: 'TRANSPORT',
			name: 'TRANSPORT',
			destination: 'DISPLAY',
			direction: 'ADD',
			counts_toward: [],
			eligibility: 'true',
			amount: 'allowance.amount'
		});
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'WAGE'), 6500);
	})
);

it.effect(
	'allowances captured under another version map to their class in one read for the whole run',
	Effect.fnUntraced(function* () {
		reset();
		const [earlier] = required(tables.get('jurisdiction_settings'));
		assert.ok(earlier);
		required(tables.get('jurisdiction_settings')).push({
			...earlier,
			id: fixtureId('an-earlier-version'),
			code: 'PREVIOUS_ENTITY',
			effective_range: { from: PlainDate('2018-01-01'), to: PlainDate('2018-12-31') },
			cloned_from_id: null
		});
		for (const contract of required(tables.get('employment_contract')))
			for (const term of records(record(contract.facts).contract_terms))
				term.allowances = [
					{ catalogue_id: fixtureId('a-old'), amount: { value: 200, currency: 'SGD' } }
				];
		required(tables.get('allowance_catalog')).push(
			...[
				{ id: fixtureId('a-old'), settings_id: fixtureId('an-earlier-version') },
				{ id: fixtureId('a-TRANSPORT'), settings_id: versionOn('2026-03') }
			].map((row) => ({
				...row,
				code: 'TRANSPORT',
				name: 'TRANSPORT',
				destination: 'PAY',
				direction: 'ADD',
				counts_toward: [],
				eligibility: 'true',
				amount: 'allowance.amount'
			}))
		);
		yield* world(fixtureTables()).withRead((read) =>
			Effect.gen(function* () {
				const native = yield* NativeReads;
				const counted = vi.spyOn(native, 'run');
				yield* Effect.addFinalizer(() => Effect.sync(() => counted.mockRestore()));
				const plan = yield* buildPayrollRun({
					company_id: COMPANY,
					period: '2026-03',
					kind: 'REGULAR'
				}).pipe(Effect.provideService(Reads, readsFrom(read)));
				assert.ok(plan.payslips.length > 1);
				type Predicate = NonNullable<
					Extract<
						Parameters<ShapeOf<typeof NativeReads>['run']>[0][number],
						{ kind: 'read' }
					>['where']
				>;
				const readsId = (predicate: Predicate): boolean => {
					if (predicate.t === 'and' || predicate.t === 'or') return predicate.of.some(readsId);
					if (predicate.t === 'not') return readsId(predicate.of);
					return (predicate.t === 'in' || predicate.t === 'cmp') && predicate.field === 'id';
				};
				const byId = counted.mock.calls
					.flatMap(([batch]) => batch)
					.filter(
						(query) =>
							query.kind === 'read' &&
							query.collection === 'allowance_catalog' &&
							query.where !== undefined &&
							readsId(query.where)
					).length;
				assert.equal(byId, 1);
			})
		);
	})
);

it.effect(
	'audit 37: payroll.negative_net allow keeps a slip whose net is negative',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('adhoc_catalog')).push({
			id: fixtureId('claw'),
			bands: [],
			settings_id: versionOn('2026-03'),
			code: 'CLAWBACK',
			name: 'Clawback',
			destination: 'NET',
			direction: 'SUBTRACT',
			counts_toward: []
		});
		entry('adhoc_catalog_entry', fixtureId('c1'), 'e2', 'claw', '2026-03-05', {
			amount: Decimal.of('9000')
		});
		assert.match(yield* refused('2026-03', 'REGULAR'), /net pay would be negative/);
		// Unstated, the engine assumes neither.
		payrollWithout('2026-03', 'negative_net');
		assert.match(yield* refused('2026-03', 'REGULAR'), /payroll\.negative_net is not stated/);
		payrollOf('2026-03', { negative_net: 'allow' });
		assert.ok(slip(yield* run('2026-03', 'REGULAR'), 'e2').net < 0);
	})
);

it.effect(
	'lines M8: a contract with no base salary refuses when payroll.base_salary_required is unstated',
	Effect.fnUntraced(function* () {
		reset();
		const term = required(
			records(
				record(
					required(
						required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
					).facts
				).contract_terms
			)[0]
		);
		term.base_salary = { value: 0, currency: 'SGD' };
		payrollWithout('2026-03', 'base_salary_required');
		assert.match(
			yield* refused('2026-03', 'REGULAR'),
			/payroll\.base_salary_required is not stated/
		);
	})
);

it.effect(
	'lines M9: a prorated work line without a denominator refuses instead of dividing by calendar days',
	Effect.fnUntraced(function* () {
		reset();
		const basic = required(
			required(tables.get('work_catalog')).find(
				(row) => row.settings_id === versionOn('2026-03') && row.prorated === true
			)
		);
		assert.equal(basic.denominator, 'double(period.days)');
		delete basic.denominator;
		assert.match(
			yield* refused('2026-03', 'REGULAR'),
			new RegExp(`work_catalog ${String(basic.code)}: denominator is not stated`)
		);
	})
);

it.effect(
	'lines M4: a leave row projects its class’s can_encash; a class that states none refuses',
	Effect.fnUntraced(function* () {
		// A fresh March with one annual-leave day and a line counting the encashable leave rows.
		const annualLeave = () => {
			reset();
			entry(
				'leave_catalog_entry',
				'al',
				'e1',
				catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03'),
				'2026-03-10',
				{ days: 1, from: PlainDate('2026-03-10'), to: PlainDate('2026-03-10') },
				'TIME_OFF'
			);
			shows('ENCASHABLE', 'double(size(leave.rows.filter(r, r.can_encash)))');
			return required(
				required(tables.get('leave_catalog')).find(
					(row) => row.settings_id === versionOn('2026-03') && row.code === 'ANNUAL_LEAVE'
				)
			);
		};
		annualLeave().can_encash = true;
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'ENCASHABLE'), 1);
		annualLeave().can_encash = false;
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'ENCASHABLE'), undefined);
		// A row whose class the governing version does not carry: no class states can_encash, so the slip refuses.
		annualLeave();
		required(tables.get('leave_catalog')).push({
			can_encash: true,
			id: fixtureId('lc-retired'),
			settings_id: versionOn('2026-07'),
			code: 'RETIRED_LEAVE',
			name: 'Retired leave',
			entitlement: { overdraw: '0', window: 'CALENDAR_YEAR', days: '10.0' }
		});
		entry(
			'leave_catalog_entry',
			'retired',
			'e1',
			'lc-retired',
			'2026-03-12',
			{ days: 1, from: PlainDate('2026-03-12'), to: PlainDate('2026-03-12') },
			'TIME_OFF'
		);
		assert.match(
			yield* refused('2026-03', 'REGULAR'),
			/leave_catalog RETIRED_LEAVE of SG: can_encash is not stated/
		);
	})
);

it.effect(
	'leave entitlement contexts read the governing version’s tax year',
	Effect.fnUntraced(function* () {
		reset();
		payrollOf('2026-03', { tax_year_start_month: 4 });
		yield* run('2026-03', 'REGULAR');
		required(tables.get('leave_catalog')).push({
			can_encash: true,
			id: fixtureId('lc-y'),
			settings_id: versionOn('2026-04'),
			code: 'YEAR_GROSS',
			name: 'Year gross',
			entitlement: { overdraw: '0', window: 'CALENDAR_YEAR', days: 'earned.year.gross / 100.0' }
		});
		payrollOf('2026-04', { tax_year_start_month: 4 });
		const state = yield* provide(
			leaveState(nativeId('employment_contract', fixtureId('k-e1')), '2026-04-10')
		);
		// April opens a new tax year: March's slip is last year's.
		assert.equal(
			required(
				leaveBalances({
					...state,
					classes: state.classes.filter((cls) => cls.code === 'YEAR_GROSS')
				})[0]
			).entitlement,
			0
		);
	})
);

it.effect(
	'work.week_before: the week’s days before the period, from payroll.week_start, marked in_period false',
	Effect.fnUntraced(function* () {
		reset();
		payrollOf('2026-03', { week_start: 1 });
		for (const date of ['2026-02-26', '2026-02-27'])
			required(tables.get('roster_entry')).push({
				id: fixtureId(`r-${date}`),
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				work_date: date,
				payslip_id: fixtureId('paid-in-february'),
				worked_intervals: [
					{ start: Instant(`${date}T01:00:00.000Z`), end: Instant(`${date}T08:00:00.000Z`) }
				]
			});
		// March 2026 opens on a Sunday: its Monday week began on 23 February. Each day is clocked 09:00–16:00 Singapore
		// time and attended, so it credits its actual 6 hours (09:00–13:00 and 14:00–16:00 around the break).
		shows(
			'WEEK_BEFORE',
			'double(size(work.week_before)) * 100.0 + sum(work.week_before.filter(d, !d.in_period).map(d, d.worked_hours))'
		);
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'WEEK_BEFORE'), 612);
	})
);

it.effect(
	'month to date: hours.month_to_date and work.month_days[] run from the 1st to the period’s end, earlier parts included',
	Effect.fnUntraced(function* () {
		const worked = (date: string) =>
			required(tables.get('roster_entry')).push({
				id: fixtureId(`r-${date}`),
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				work_date: date,
				payslip_id: null,
				worked_intervals: [
					{ start: Instant(`${date}T01:00:00.000Z`), end: Instant(`${date}T08:00:00.000Z`) }
				]
			});
		const semiMonthly = () => {
			reset();
			required(required(tables.get('entity'))[0]).pay_frequency = 'SEMI_MONTHLY';
			worked('2026-03-05');
			worked('2026-03-20');
		};
		// Each day is clocked 09:00–16:00 Singapore time and attended: its actual 6 hours net of the break.
		semiMonthly();
		shows('MONTH_TO_DATE', 'hours.month_to_date.worked_hours * 100.0 + hours.month.worked_hours');
		// The first half reads its own day to date; the calendar month already holds the second half's.
		assert.equal(shown(yield* run('2026-03-1', 'REGULAR'), 'e1', 'MONTH_TO_DATE'), 612);
		semiMonthly();
		shows(
			'MONTH_DAYS',
			'double(size(work.month_days.filter(d, d.worked))) * 10.0 + double(size(work.month_days.filter(d, d.worked && !d.in_period)))'
		);
		// The second half reads both days; the first half's is an earlier part's, not in this period.
		assert.equal(shown(yield* run('2026-03-2', 'REGULAR'), 'e1', 'MONTH_DAYS'), 21);
	})
);

it.effect(
	'period.month_working_days: the whole month’s scheduled working days less holidays, the same in both halves',
	Effect.fnUntraced(function* () {
		const halves = Effect.fnUntraced(function* () {
			reset();
			required(required(tables.get('entity'))[0]).pay_frequency = 'SEMI_MONTHLY';
			// A published holiday on a Wednesday of the second half.
			required(tables.get('holiday')).push({
				id: fixtureId('h-0318'),
				company_id: COMPANY,
				date: PlainDate('2026-03-18'),
				name: 'Test holiday',
				kind: 'PUBLIC_HOLIDAY',
				published_at: Instant('2026-01-01T00:00:00.000Z')
			});
			// and one on a Saturday, a rest day: no working day of the month
			required(tables.get('holiday')).push({
				id: fixtureId('h-0321'),
				company_id: COMPANY,
				date: PlainDate('2026-03-21'),
				name: 'Rest-day holiday',
				kind: 'PUBLIC_HOLIDAY',
				published_at: Instant('2026-01-01T00:00:00.000Z')
			});
			shows(
				'MONTH_WORKING',
				'double(period.month_holiday_work_days) * 10000.0 + double(period.month_working_days) * 100.0 + double(period.working_days)'
			);
			return [
				shown(yield* run('2026-03-1', 'REGULAR'), 'e1', 'MONTH_WORKING'),
				shown(yield* run('2026-03-2', 'REGULAR'), 'e1', 'MONTH_WORKING')
			];
		});
		// March 2026 on a Monday–Friday week: 22 weekdays, one a holiday (the Saturday one falls on no working day). The
		// 1st–15th hold 10 weekdays, the 16th–31st 12; both halves read the month's 21 and its one working-day holiday, so a
		// divisor that counts holidays (SG s.20A) is 21 + 1.
		assert.deepEqual(yield* halves(), [12110, 12112]);
	})
);

it.effect(
	'period.previous_month_working_days: the calendar month before’s planned working days and its working-day holidays',
	Effect.fnUntraced(function* () {
		reset();
		required(required(tables.get('entity'))[0]).pay_frequency = 'SEMI_MONTHLY';
		// February 2026 on a Monday–Friday week: 20 weekdays; a published holiday on Tuesday the 17th
		required(tables.get('holiday')).push({
			id: fixtureId('h-0217'),
			company_id: COMPANY,
			date: PlainDate('2026-02-17'),
			name: 'February holiday',
			kind: 'PUBLIC_HOLIDAY',
			published_at: Instant('2026-01-01T00:00:00.000Z')
		});
		shows(
			'PREVIOUS_WORKING',
			'double(period.previous_month_working_days) * 100.0 + double(period.previous_month_holiday_work_days)'
		);
		// both halves of March read February's 19 working days and its one working-day holiday
		assert.deepEqual(
			[
				shown(yield* run('2026-03-1', 'REGULAR'), 'e1', 'PREVIOUS_WORKING'),
				shown(yield* run('2026-03-2', 'REGULAR'), 'e1', 'PREVIOUS_WORKING')
			],
			[1901, 1901]
		);
	})
);

it.effect(
	'contract validations read the employment’s other terms and the person’s earlier contracts',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('rule_set', [
			validation('ONE_PROBATION', {
				site: 'contract',
				kind: 'refuse',
				when: 'has(term.facts.probation) && term.facts.probation && (employment.terms.exists(t, has(t.facts.probation) && t.facts.probation) || person.contracts.exists(c, has(c.facts.probation) && c.facts.probation))',
				message: 'One probation per employee.'
			}),
			validation('OPEN_ENDED_RIGHT', {
				site: 'contract',
				kind: 'refuse',
				when: 'term.employment_type == "FIXED_TERM" && size(person.contracts.filter(c, c.contract_type == "FIXED_TERM")) >= 2',
				message: 'Two fixed terms already: the next contract is open-ended.'
			})
		]);
		const term = (from: string, extra: Row = {}) => ({
			base_salary: { value: 3000, currency: 'SGD' },
			effective_range: { from, to: null },
			allowances: [],
			...extra
		});
		const earlier = (id: string, from: string, to: string, extra: Row) => ({
			id: fixtureId(id),
			employee_number: id,
			contract_number: id === 'k-a' ? 1 : 2,
			company_id: COMPANY,
			employee_id: nativeId('employment_profile', fixtureId('e3')),
			effective_range: { from: PlainDate(from), to: to === null ? null : PlainDate(to) },
			facts: { contract_terms: [{ ...term(from, extra), effective_range: { from, to } }] }
		});
		tables.set('employment_contract', [
			earlier('k-a', '2024-01-01', '2024-12-31', {
				employment_type: 'FIXED_TERM',
				facts: { probation: true }
			}),
			earlier('k-b', '2025-01-01', '2025-12-31', { employment_type: 'FIXED_TERM', facts: {} })
		]);
		const admit = (terms: Row[]) =>
			admitContract({
				id: fixtureId('k-new'),
				company_id: COMPANY,
				employee_id: nativeId('employment_profile', fixtureId('e3')),
				effective_range: { from: PlainDate('2026-03-01'), to: null },
				facts: { contract_terms: terms }
			});
		const message = Effect.fnUntraced(function* (terms: Row[]) {
			const outcome = yield* admit(terms);
			return outcome._tag === 'Failure' ? outcome.failure.message : null;
		});
		assert.equal(
			yield* message([term('2026-03-01', { employment_type: 'FIXED_TERM', facts: {} })]),
			'Two fixed terms already: the next contract is open-ended.'
		);
		assert.equal(
			yield* message([
				term('2026-03-01', { employment_type: 'PERMANENT', facts: { probation: true } })
			]),
			'One probation per employee.'
		);
		assert.equal(
			yield* message([term('2026-03-01', { employment_type: 'PERMANENT', facts: {} })]),
			null
		);
	})
);

it.effect(
	'hours.months[] and hours.month split worked and overtime hours by day type, holidays under HOLIDAY',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('holiday')).push({
			id: fixtureId('h1'),
			company_id: COMPANY,
			date: PlainDate('2026-02-04'),
			name: 'Holiday',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2026-01-01T00:00:00.000Z'
		});
		const day = (date: string, overtime: number, rest = false) =>
			required(tables.get('roster_entry')).push({
				id: fixtureId(`r-${date}`),
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				work_date: date,
				payslip_id: fixtureId('paid'),
				planned_overtime_hours: overtime,
				// a rest day has no shift to extend: its overtime is approved as an explicit window
				...(rest ? { approved_overtime_intervals: clocked(date, overtime) } : {}),
				worked_intervals: clocked(date, overtime)
			});
		// February: a Tuesday (2 h OT), the Wednesday holiday (1 h), a Saturday rest day (3 h).
		day('2026-02-03', 2);
		day('2026-02-04', 1);
		day('2026-02-07', 3, true);
		shows(
			'FEB_REST',
			'first(hours.months.filter(m, m.month == "2026-02")).day_type.REST.overtime_hours * 100.0 + first(hours.months.filter(m, m.month == "2026-02")).day_type.HOLIDAY.overtime_hours * 10.0 + first(hours.months.filter(m, m.month == "2026-02")).day_type.WORK.worked_hours / 8.0',
			'1.0',
			// Only Kavriel has February days.
			'terms.base_salary == 6500.0'
		);
		// the two working days' paid hours: 8 planned plus 2, and 8 plus 1 — 19 / 8 = 2.375, shown to the cent
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'FEB_REST'), 312.38);
	})
);

it.effect(
	'a leave row’s pay_fraction reads the days taken before it for the same event, and the average earnings',
	Effect.fnUntraced(function* () {
		reset();
		const version = versionOn('2026-03');
		for (const [id, code] of [
			['lc-out', 'ACCIDENT_OUTPATIENT'],
			['lc-hosp', 'ACCIDENT_HOSPITAL']
		] satisfies [string, string][])
			required(tables.get('leave_catalog')).push({
				can_encash: true,
				id: fixtureId(id),
				settings_id: version,
				code,
				name: code,
				// Full pay for the first 3 days of the accident in this class, half after.
				pay_fraction: 'leave.taken_before >= 3.0 ? 0.5 : 1.0'
			});
		const leave = (
			id: string,
			catalogId: string,
			from: string,
			to: string,
			days: number,
			paid = false
		) =>
			entry(
				'leave_catalog_entry',
				id,
				'e1',
				catalogId,
				from,
				{
					days,
					from,
					to,
					facts: { event_id: 'acc-1' },
					...(paid ? { payslip_id: fixtureId('paid') } : {})
				},
				'TIME_OFF'
			);
		leave('o1', 'lc-out', '2026-02-10', '2026-02-12', 3, true);
		leave('h1', 'lc-hosp', '2026-02-16', '2026-02-17', 2, true);
		leave('o2', 'lc-out', '2026-03-03', '2026-03-04', 2);
		const february = yield* run('2026-02', 'REGULAR');
		shows(
			'TAKEN_BEFORE',
			'sum(leave.rows.filter(l, l.code == "ACCIDENT_OUTPATIENT").map(l, l.taken_before * 100.0 + l.taken_before_by_class.ACCIDENT_HOSPITAL * 10.0 + l.pay_fraction))',
			'1.0',
			'size(leave.rows) > 0'
		);
		shows('AVERAGE', 'earned.average.gross', '1.0', 'size(leave.rows) > 0');
		const march = yield* run('2026-03', 'REGULAR');
		assert.equal(shown(march, 'e1', 'TAKEN_BEFORE'), 300 + 20 + 0.5);
		// One earlier month with a slip: its gross is the average.
		assert.equal(shown(march, 'e1', 'AVERAGE'), slip(february, 'e1').gross);
	})
);

it.effect(
	'person.contracts[] lists each earlier contract’s terms, so a first-term probation is seen',
	Effect.fnUntraced(function* () {
		reset();
		tables.set('rule_set', [
			validation('ONE_PROBATION', {
				site: 'contract',
				kind: 'refuse',
				when: 'has(term.facts.probation) && term.facts.probation && person.contracts.exists(c, c.terms.exists(t, has(t.facts.probation) && t.facts.probation && t.from == "2024-01-01" && t.contract_type == "PERMANENT"))',
				message: 'One probation per employee.'
			})
		]);
		const term = (from: string, to: string | null, facts: Row) => ({
			base_salary: { value: 3000, currency: 'SGD' },
			employment_type: 'PERMANENT',
			effective_range: { from: PlainDate(from), to: to === null ? null : PlainDate(to) },
			allowances: [],
			facts
		});
		tables.set('employment_contract', [
			{
				id: fixtureId('k-a'),
				employee_number: 'earlier',
				contract_number: 1,
				company_id: COMPANY,
				employee_id: nativeId('employment_profile', fixtureId('e3')),
				effective_range: { from: PlainDate('2024-01-01'), to: PlainDate('2025-06-30') },
				// Probation in the first term only; the last term carries none.
				facts: {
					contract_terms: [
						term('2024-01-01', '2024-03-31', { probation: true }),
						term('2024-04-01', '2025-06-30', {})
					]
				}
			}
		]);
		const outcome = yield* admitContract({
			id: fixtureId('k-new'),
			company_id: COMPANY,
			employee_id: nativeId('employment_profile', fixtureId('e3')),
			effective_range: { from: PlainDate('2026-03-01'), to: null },
			facts: { contract_terms: [term('2026-03-01', null, { probation: true })] }
		});
		assert.ok(
			outcome._tag === 'Failure' && outcome.failure.message === 'One probation per employee.'
		);
	})
);

/** An ad hoc class of every version, flagged to raise itself on the exit its eligibility names. */
const exitPay = (extra: Row = {}) => {
	for (const settings of required(tables.get('jurisdiction_settings')))
		required(tables.get('adhoc_catalog')).push({
			id: fixtureId(`x-exit-${String(settings.id)}`),
			settings_id: settings.id,
			code: 'EXIT_PAY',
			name: 'Exit pay',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: [],
			eligibility: 'employment.exit_ground == "RETRENCHMENT"',
			bands: [{ when: '', amount: 'max(entry.amount, 1000.0)' }],
			raise_on_exit: true,
			amount_required: false,
			...extra
		});
};
const adjusted = (plan: Plan, person: string) =>
	(findSlip(plan, person)?.adjustments ?? []).map((row) => [
		row.family,
		row.component_code,
		row.amount
	]);
const paidAll = () => {
	for (const row of required(tables.get('payslip'))) row.status = 'PAID';
};

it.effect(
	'a final slip raises the exit pay its classes flag, once per exit; an entry HR made wins',
	Effect.fnUntraced(function* () {
		reset();
		exitPay();
		const k1 = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
		);
		Object.assign(k1, {
			effective_range: { from: PlainDate('2019-01-01'), to: PlainDate('2026-03-15') },
			exit_ground: 'RETRENCHMENT',
			exit_facts: {}
		});
		const march = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(adjusted(march, 'e1'), [['EXIT', 'EXIT_PAY', 1000]]);
		// another ground the class does not name raises nothing
		required(tables.get('payslip')).length = 0;
		required(tables.get('payroll_run')).length = 0;
		k1.exit_ground = 'RESIGNATION';
		assert.deepEqual(adjusted(yield* run('2026-03', 'REGULAR'), 'e1'), []);
		// HR's own entry of the class is paid instead, at its amount
		required(tables.get('payslip')).length = 0;
		required(tables.get('payroll_run')).length = 0;
		k1.exit_ground = 'RETRENCHMENT';
		required(tables.get('adhoc_catalog_entry')).push({
			company_id: COMPANY,
			id: fixtureId('x1'),
			catalog_id: fixtureId(`x-exit-${versionOn('2026-03')}`),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			occurred_on: PlainDate('2026-03-15'),
			amount: Decimal.of('1500'),
			payslip_id: null
		});
		const entered = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(adjusted(entered, 'e1'), [['ADHOC', 'EXIT_PAY', 1500]]);
	})
);

it.effect(
	'an exit undone after its final slip paid: the next run takes back the exit pay and pays the reopened days',
	Effect.fnUntraced(function* () {
		reset();
		exitPay();
		const k1 = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
		);
		Object.assign(k1, {
			effective_range: { from: PlainDate('2019-01-01'), to: PlainDate('2026-03-15') },
			exit_ground: 'RETRENCHMENT',
			exit_facts: {}
		});
		const march = yield* run('2026-03', 'REGULAR');
		const basic = required(
			slip(march, 'e1').base.find((row) => row.component_code === 'BASIC')
		).amount;
		assert.ok(basic < 6500);
		paidAll();
		// the resignation withdrawn: the contract reopens
		Object.assign(k1, {
			effective_range: { from: PlainDate('2019-01-01'), to: null },
			exit_ground: null,
			exit_facts: null
		});
		const april = yield* run('2026-04', 'REGULAR');
		assert.deepEqual(adjusted(april, 'e1'), [
			['EXIT', 'EXIT_PAY', -1000],
			['CORRECTION', 'BASIC', 6500 - basic]
		]);
		assert.equal(
			required(slip(april, 'e1').base.find((row) => row.component_code === 'BASIC')).amount,
			6500
		);
		// corrected once: May carries nothing more
		paidAll();
		assert.deepEqual(adjusted(yield* run('2026-05', 'REGULAR'), 'e1'), []);
	})
);

it.effect(
	'an exit moved earlier after its final slip paid: the leaver’s next slip recovers the overpaid days',
	Effect.fnUntraced(function* () {
		reset();
		const k1 = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
		);
		Object.assign(k1, {
			effective_range: { from: PlainDate('2019-01-01'), to: PlainDate('2026-03-31') },
			exit_ground: 'RESIGNATION',
			exit_facts: {}
		});
		yield* run('2026-03', 'REGULAR');
		paidAll();
		k1.effective_range = { from: PlainDate('2019-01-01'), to: PlainDate('2026-03-15') };
		const april = yield* run('2026-04', 'REGULAR');
		// 16 of March's 31 days at the record's calendar divisor (6,500 × 16 / 31): a leaver is paid nothing to recover
		// it from, so the first run after it flags it instead of a negative slip
		assert.equal(findSlip(april, 'e1'), undefined);
		assert.ok(
			april.warnings.some((row) => /Kavriel: .*overpaid 3354.84 after the exit moved/.test(row))
		);
		paidAll();
		assert.ok(!(yield* run('2026-05', 'REGULAR')).warnings.some((row) => /overpaid/.test(row)));
	})
);

it.effect(
	'the version’s payroll.exit_overpayment decides a leaver’s overpayment: noted, deducted, or refused unstated',
	Effect.fnUntraced(function* () {
		const moved = Effect.fnUntraced(function* (patch: Row) {
			reset();
			const k1 = required(
				required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
			);
			Object.assign(k1, {
				effective_range: { from: PlainDate('2019-01-01'), to: PlainDate('2026-03-31') },
				exit_ground: 'RESIGNATION',
				exit_facts: {}
			});
			yield* run('2026-03', 'REGULAR');
			paidAll();
			k1.effective_range = { from: PlainDate('2019-01-01'), to: PlainDate('2026-03-15') };
			payrollOf('2026-04', patch);
		});
		yield* moved({ exit_overpayment: 'deduct', negative_net: 'allow' });
		assert.deepEqual(adjusted(yield* run('2026-04', 'REGULAR'), 'e1'), [
			['CORRECTION', 'BASIC', -3354.84]
		]);
		yield* moved({});
		payrollWithout('2026-04', 'exit_overpayment');
		assert.match(
			yield* refused('2026-04', 'REGULAR'),
			/jurisdiction_settings\.payroll\.exit_overpayment is not stated/
		);
	})
);

it.effect(
	'the version’s payroll.exit_raise_when decides which slip raises the exit pay of an exit recorded late',
	Effect.fnUntraced(function* () {
		reset();
		exitPay();
		const k1 = required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
		);
		Object.assign(k1, {
			effective_range: { from: PlainDate('2019-01-01'), to: PlainDate('2026-02-15') },
			exit_ground: 'RETRENCHMENT',
			exit_facts: {}
		});
		// the seeded window: an exit more than a month before the period raises nothing
		assert.deepEqual(adjusted(yield* run('2026-04', 'REGULAR'), 'e1'), []);
		required(tables.get('payslip')).length = 0;
		required(tables.get('payroll_run')).length = 0;
		payrollOf('2026-04', { exit_raise_when: 'true' });
		assert.deepEqual(adjusted(yield* run('2026-04', 'REGULAR'), 'e1'), [
			['EXIT', 'EXIT_PAY', 1000]
		]);
		required(tables.get('payslip')).length = 0;
		required(tables.get('payroll_run')).length = 0;
		payrollWithout('2026-04', 'exit_raise_when');
		assert.match(
			yield* refused('2026-04', 'REGULAR'),
			/jurisdiction_settings\.payroll\.exit_raise_when is not stated/
		);
	})
);

it.effect(
	'an entry that prices to nothing is flagged on the run, never silent',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('adhoc_catalog')).push({
			id: fixtureId('zero'),
			settings_id: versionOn('2026-03'),
			code: 'ZERO',
			name: 'Zero',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: [],
			amount_required: false,
			bands: [{ when: '', amount: 'entry.amount' }]
		});
		required(tables.get('adhoc_catalog_entry')).push({
			company_id: COMPANY,
			id: fixtureId('z1'),
			catalog_id: fixtureId('zero'),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			occurred_on: PlainDate('2026-03-10'),
			amount: Decimal.of('0'),
			payslip_id: null
		});
		const plan = yield* run('2026-03', 'REGULAR');
		assert.ok(plan.warnings.some((row) => /Zero 2026-03-10 prices to nothing/.test(row)));
	})
);

it.effect(
	'a claim limit meters its window: BLOCK pays up to it, ALLOW pays all, and either flags the excess',
	Effect.fnUntraced(function* () {
		reset();
		const claim = (on_exceed: string, window?: string) => {
			required(tables.get('claim_catalog')).push({
				id: fixtureId(`cl-${on_exceed}`),
				settings_id: versionOn('2026-03'),
				code: `CL_${on_exceed}`,
				name: `Claim ${on_exceed}`,
				destination: 'NET',
				direction: 'ADD',
				counts_toward: [],
				bands: [
					{
						when: '',
						amount: 'entry.amount',
						limit: { on_exceed, amount: '100.0', ...(window == null ? {} : { window }) }
					}
				]
			});
		};
		claim('BLOCK', 'PERIOD');
		claim('ALLOW');
		const entry = (id: string, catalog_id: string, occurred_on: string, amount: number) =>
			required(tables.get('claim_catalog_entry')).push({
				company_id: COMPANY,
				id: fixtureId(id),
				catalog_id: fixtureId(catalog_id),
				employment_id: nativeId('employment_contract', fixtureId('k-e1')),
				occurred_on: PlainDate(occurred_on),
				amount: Decimal.of(String(amount)),
				payslip_id: null
			});
		// two claims of 70 in one period against a 100 limit for the period; one claim of 150 against 100 a claim
		entry('b1', 'cl-BLOCK', '2026-03-02', 70);
		entry('b2', 'cl-BLOCK', '2026-03-09', 70);
		entry('a1', 'cl-ALLOW', '2026-03-03', 150);
		const plan = yield* run('2026-03', 'REGULAR');
		assert.deepEqual(
			slip(plan, 'e1')
				.adjustments.filter((row) => row.family === 'CLAIM')
				.map((row) => [row.source_id, row.amount]),
			[
				[fixtureId('b1'), 70],
				[fixtureId('b2'), 30],
				[fixtureId('a1'), 150]
			]
		);
		const flagged = plan.warnings.filter((row) => /exceeds its limit/.test(row));
		assert.equal(flagged.length, 2);
		assert.ok(
			flagged.some((row) =>
				/Claim BLOCK 2026-03-09 exceeds its limit by 40; paid up to it/.test(row)
			)
		);
		assert.ok(
			flagged.some((row) =>
				/Claim ALLOW 2026-03-03 exceeds its limit by 50; paid in full/.test(row)
			)
		);
	})
);

it.effect(
	'a run for an earlier period refuses while a later period has a run: the later year-to-date would go stale',
	Effect.fnUntraced(function* () {
		reset();
		yield* run('2026-04', 'REGULAR');
		assert.match(
			yield* refused('2026-03', 'REGULAR'),
			/2026-04 already has a run: delete the runs after 2026-03, latest first, and rebuild them after it/
		);
	})
);

it.effect(
	'a statutory line names the base it charged on: the assessment, not only the wage parts',
	Effect.fnUntraced(function* () {
		reset();
		required(tables.get('statutory_contribution_catalog')).push({
			id: fixtureId('on-contract'),
			settings_id: versionOn('2026-03'),
			code: 'ON_CONTRACT',
			name: 'Contract wage base',
			configuration: {
				assess_without_wage: true,
				// charged on the contract wage, whatever the month's lines paid toward it
				assessment: 'terms.base_salary',
				rules: [{ when: 'true', employer: 'base.assessed * 0.01' }]
			}
		});
		const plan = yield* run('2026-03', 'REGULAR');
		const charged = required(line(plan, 'e3', 'ON_CONTRACT'));
		assert.equal(charged.base_amount, 0);
		assert.equal(charged.charged_base, 4800);
		assert.equal(charged.employer_amount, 48);
	})
);

it.effect(
	'an exit encashment is judged without the exit’s own unpaid encashments, which a moved exit withdraws in the same act',
	Effect.fnUntraced(function* () {
		reset();
		const annual = catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03');
		// the exit as it stood encashed the whole balance; it is still unpaid
		required(tables.get('leave_catalog_entry')).push({
			company_id: COMPANY,
			id: fixtureId('old-exit'),
			catalog_id: annual,
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			occurred_on: PlainDate('2026-03-20'),
			activity: 'ENCASHMENT',
			days: 14,
			reference: `exit:${fixtureId('k-e1')}:ANNUAL_LEAVE:2026-03-20/RESIGNATION`,
			payslip_id: null
		});
		const encash = (reference: string) =>
			transformed('leave_catalog_entry', [
				{
					catalog_id: annual,
					employment_id: nativeId('employment_contract', fixtureId('k-e1')),
					occurred_on: PlainDate('2026-03-31'),
					activity: 'ENCASHMENT',
					days: Decimal.of('10'),
					reference
				}
			]);
		yield* encash(`exit:${fixtureId('k-e1')}:ANNUAL_LEAVE:2026-03-31/RESIGNATION`);
		yield* assertFailure(encash('manual'), /exceeds the available/);
	})
);

it.effect(
	'the balances an employee is offered leave out the classes their eligibility excludes, through the real leave state',
	Effect.fnUntraced(function* () {
		reset();
		// a fixed term's planned end is no departure: the leaving-year class is not offered
		required(
			required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
		).effective_range = {
			from: PlainDate('2019-01-01'),
			to: PlainDate('2030-12-31')
		};
		const state = yield* provide(
			leaveState(nativeId('employment_contract', fixtureId('k-e1')), '2026-03-15')
		);
		const codes = leaveBalances({ ...state, offeredOnly: true }).map((row) => row.code);
		assert.ok(codes.includes('ANNUAL_LEAVE'));
		assert.ok(!codes.includes('ANNUAL_LEAVE_ON_EXIT'), codes.join(','));
		assert.ok(!codes.includes('ANNUAL_LEAVE_PART_TIME'), codes.join(','));
	})
);

/**
 * Every slip of the plans for one person summed: gross, each base line by code (a correction of a paid period's line
 * counted with it), each scheme's two shares.
 */
const settled = (plans: readonly Plan[], person: string) => {
	const cents = (value: number) => Math.round(value * 100) / 100;
	const out: {
		gross: number;
		base: Record<string, number>;
		statutory: Record<string, [number, number]>;
	} = { gross: 0, base: {}, statutory: {} };
	for (const plan of plans)
		for (const held of plan.payslips.filter(
			(row) => row.employment_id === fixtureId(`k-${person}`)
		)) {
			out.gross = cents(out.gross + held.gross);
			for (const line of [
				...held.base,
				...held.adjustments.filter((row) => row.family === 'CORRECTION')
			])
				out.base[line.component_code] = cents(
					Number(out.base[line.component_code] ?? 0) + line.amount
				);
			for (const line of held.statutory) {
				const [ee, er] = out.statutory[line.scheme_code] ?? [0, 0];
				out.statutory[line.scheme_code] = [
					cents(ee + line.employee_amount),
					cents(er + line.employer_amount)
				];
			}
		}
	return out;
};
/** The fixture entity on one frequency, switching on the days listed. */
const paying = (
	pay_frequency: string,
	changes: Parameters<typeof payScheduleRefusal>[0]['pay_frequency_changes'] = []
) => {
	reset();
	Object.assign(required(required(tables.get('entity'))[0]), {
		pay_frequency,
		pay_frequency_changes: changes
	});
};
const runAll = Effect.fnUntraced(function* (periods: readonly string[]) {
	const plans: Plan[] = [];
	for (const period of periods) plans.push(yield* run(period, 'REGULAR'));
	return plans;
});
const sameAs = Effect.fnUntraced(function* (
	switched: readonly Plan[],
	periods: readonly string[],
	label: string
) {
	paying('MONTHLY');
	const monthly = yield* runAll(periods);
	for (const person of ['e1', 'e2', 'e3'])
		assert.deepEqual(settled(switched, person), settled(monthly, person), `${label} ${person}`);
});

it.effect(
	'semi-monthly to monthly mid-month: the first half and the monthly remainder settle exactly one month',
	Effect.fnUntraced(function* () {
		paying('SEMI_MONTHLY', [{ from: PlainDate('2026-03-16'), frequency: 'MONTHLY' }]);
		const halves = yield* runAll(['2026-03-1', '2026-03']);
		// the monthly run covers what the semi-monthly half left: the 16th to the 31st
		assert.deepEqual(
			[required(halves[1]).run.salary_from, required(halves[1]).run.salary_to],
			['2026-03-16', '2026-03-31']
		);
		// the second half no longer exists: the entity pays monthly from the 16th
		yield* assertFailure(run('2026-03-2', 'REGULAR'), /2026-03-2/);
		yield* sameAs(halves, ['2026-03'], 'March');
	})
);

it.effect(
	'monthly to semi-monthly at a month start and mid-month each equal the monthly months',
	Effect.fnUntraced(function* () {
		paying('MONTHLY', [{ from: PlainDate('2026-04-01'), frequency: 'SEMI_MONTHLY' }]);
		yield* sameAs(
			yield* runAll(['2026-03', '2026-04-1', '2026-04-2']),
			['2026-03', '2026-04'],
			'April start'
		);
		paying('MONTHLY', [{ from: PlainDate('2026-03-16'), frequency: 'SEMI_MONTHLY' }]);
		const switched = yield* runAll(['2026-03', '2026-03-2']);
		assert.deepEqual(
			[required(switched[0]).run.salary_from, required(switched[0]).run.salary_to],
			['2026-03-01', '2026-03-15']
		);
		yield* sameAs(switched, ['2026-03'], 'March mid-month');
	})
);

it.effect(
	'switching inside a tax year: monthly, a semi-monthly month and back again equal the monthly year to date',
	() =>
		Effect.gen(function* () {
			const runs = (periods: readonly string[]) =>
				world(fixtureTables()).useRun((history) =>
					Effect.gen(function* () {
						const plans: Plan[] = [];
						for (const period of periods) plans.push(yield* history(COMPANY, period, 'REGULAR'));
						return plans;
					})
				);
			paying('MONTHLY', [
				{ from: PlainDate('2026-02-01'), frequency: 'SEMI_MONTHLY' },
				{ from: PlainDate('2026-03-16'), frequency: 'MONTHLY' }
			]);
			const year = yield* runs([
				'2026-01',
				'2026-02-1',
				'2026-02-2',
				'2026-03-1',
				'2026-03',
				'2026-04'
			]);
			paying('MONTHLY');
			const monthly = yield* runs(['2026-01', '2026-02', '2026-03', '2026-04']);
			for (const person of ['e1', 'e2', 'e3'])
				assert.deepEqual(
					settled(year, person),
					settled(monthly, person),
					`January–April ${person}`
				);
		}).pipe(Effect.provide(workspace({ seed: 'none' })))
);

it.effect(
	'a period over days another frequency pays, or one already paid, is refused',
	Effect.fnUntraced(function* () {
		paying('MONTHLY', [{ from: PlainDate('2026-03-16'), frequency: 'SEMI_MONTHLY' }]);
		yield* assertFailure(run('2026-03-1', 'REGULAR'), /2026-03-1/);
		yield* run('2026-03', 'REGULAR');
		yield* run('2026-03-2', 'REGULAR');
		yield* assertFailure(run('2026-03-2', 'REGULAR'), /already has a salary run/);
	})
);

for (const scenario of [
	'no paid run',
	'rewrite paid frequency',
	'switch behind paid period',
	'switch after paid period',
	'withdraw paid switch',
	'two switches on one day',
	'switch to current frequency',
	'switch to weekly',
	'switch from weekly'
]) {
	it.effect(
		`a pay frequency switch is history: ${scenario}`,
		Effect.fnUntraced(function* () {
			reset();
			const at = Effect.fnUntraced(function* (
				pay_frequency: string,
				changes: readonly { from: string; frequency: string }[] = []
			) {
				const source = new Map(tables);
				source.set(
					'entity',
					required(tables.get('entity')).map((row) => ({
						...row,
						pay_frequency,
						pay_frequency_changes: changes
					}))
				);
				const page = yield* world(fixtureTables(source)).withRead((read) =>
					read('entity', {
						select: { pay_frequency: true, pay_frequency_changes: true },
						all: true
					})
				);
				const [entity] = page.rows;
				assert.ok(entity);
				return entity;
			});
			const switchOn = (from: string, frequency = 'SEMI_MONTHLY') => [{ from, frequency }];
			// no run yet: anything goes
			if (scenario === 'no paid run')
				assert.equal(
					payScheduleRefusal(yield* at('MONTHLY'), yield* at('SEMI_MONTHLY'), null),
					undefined
				);
			// a run paid through 31 March: the frequency it paid at stays, a switch starts after it
			if (scenario === 'rewrite paid frequency')
				assert.match(
					String(payScheduleRefusal(yield* at('MONTHLY'), yield* at('SEMI_MONTHLY'), '2026-03-31')),
					/record a switch/
				);
			if (scenario === 'switch behind paid period')
				assert.match(
					String(
						payScheduleRefusal(
							yield* at('MONTHLY'),
							yield* at('MONTHLY', switchOn('2026-03-16')),
							'2026-03-31'
						)
					),
					/2026-03-31/
				);
			if (scenario === 'switch after paid period')
				assert.equal(
					payScheduleRefusal(
						yield* at('MONTHLY'),
						yield* at('MONTHLY', switchOn('2026-04-01')),
						'2026-03-31'
					),
					undefined
				);
			// a switch already behind the paid day cannot be withdrawn either
			if (scenario === 'withdraw paid switch')
				assert.match(
					String(
						payScheduleRefusal(
							yield* at('MONTHLY', switchOn('2026-03-16')),
							yield* at('MONTHLY'),
							'2026-03-31'
						)
					),
					/2026-03-31/
				);
			// one switch a day, to another frequency, among those that cut the month
			if (scenario === 'two switches on one day')
				assert.match(
					String(
						payScheduleRefusal(
							yield* at('MONTHLY'),
							yield* at('MONTHLY', [
								...switchOn('2026-05-01'),
								...switchOn('2026-05-01', 'MONTHLY')
							]),
							null
						)
					),
					/one switch/
				);
			if (scenario === 'switch to current frequency')
				assert.match(
					String(
						payScheduleRefusal(
							yield* at('MONTHLY'),
							yield* at('MONTHLY', switchOn('2026-05-01', 'MONTHLY')),
							null
						)
					),
					/already pays/
				);
			if (scenario === 'switch to weekly')
				assert.match(
					String(
						payScheduleRefusal(
							yield* at('MONTHLY'),
							yield* at('MONTHLY', switchOn('2026-05-01', 'WEEKLY')),
							null
						)
					),
					/WEEKLY.*straddle/
				);
			// nor away from one
			if (scenario === 'switch from weekly')
				assert.match(
					String(
						payScheduleRefusal(
							yield* at('WEEKLY'),
							yield* at('WEEKLY', switchOn('2026-05-01', 'MONTHLY')),
							null
						)
					),
					/from WEEKLY.*straddle/
				);
		})
	);
}

for (const scenario of ['exit undone', 'exit moved', 'late exit']) {
	it.effect(
		`an exit inside a switched month settles as the one-frequency months do: ${scenario}`,
		Effect.fnUntraced(function* () {
			const exiting = (to: string) =>
				Object.assign(
					required(
						required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
					),
					{
						effective_range: { from: PlainDate('2019-01-01'), to },
						exit_ground: 'RETRENCHMENT',
						exit_facts: {}
					}
				);
			const reopen = () =>
				Object.assign(
					required(
						required(tables.get('employment_contract')).find((row) => row.id === fixtureId('k-e1'))
					),
					{
						effective_range: { from: PlainDate('2019-01-01'), to: null },
						exit_ground: null,
						exit_facts: null
					}
				);
			const story = Effect.fnUntraced(function* (
				periods: readonly (readonly string[])[],
				change: () => void,
				switched: boolean
			) {
				paying(
					'SEMI_MONTHLY',
					switched ? [{ from: PlainDate('2026-03-16'), frequency: 'MONTHLY' }] : []
				);
				exitPay();
				exiting('2026-03-10');
				const plans: Plan[] = [];
				for (const [i, group] of periods.entries()) {
					if (i === 1) change();
					for (const period of group) plans.push(yield* run(period, 'REGULAR'));
					paidAll();
				}
				return settled(plans, 'e1');
			});
			// The one-frequency result: one monthly March run on the facts as they now stand.
			const monthly = Effect.fnUntraced(function* (change: () => void) {
				paying('MONTHLY');
				exitPay();
				exiting('2026-03-10');
				change();
				return settled([yield* run('2026-03', 'REGULAR')], 'e1');
			});
			// undone: the first half paid ten days and the exit pay; the rest of the month pays as if it never was
			if (scenario === 'exit undone')
				assert.deepEqual(
					yield* story([['2026-03-1'], ['2026-03']], reopen, true),
					yield* monthly(reopen),
					'exit undone'
				);
			// moved later, to the 25th: the days 11–25 are owed
			const moved = () => exiting('2026-03-25');
			if (scenario === 'exit moved')
				assert.deepEqual(
					yield* story([['2026-03-1'], ['2026-03']], moved, true),
					yield* monthly(moved),
					'exit moved'
				);
			// After the month settled to date, the exit moved back to the 20th recovers the days 21–31 once, through the
			// month-to-date slip, at what a monthly March recovers.
			const late = Effect.fnUntraced(function* (switched: boolean) {
				paying(
					switched ? 'SEMI_MONTHLY' : 'MONTHLY',
					switched ? [{ from: PlainDate('2026-03-16'), frequency: 'MONTHLY' }] : []
				);
				for (const period of switched ? ['2026-03-1', '2026-03'] : ['2026-03'])
					yield* run(period, 'REGULAR');
				paidAll();
				exiting('2026-03-20');
				const april = yield* run('2026-04', 'REGULAR');
				paidAll();
				const may = yield* run('2026-05', 'REGULAR');
				return [...april.warnings, ...may.warnings].filter((row) =>
					/^Kavriel: .*overpaid/.test(row)
				);
			});
			if (scenario === 'late exit') {
				const once = yield* late(false);
				assert.equal(once.length, 1);
				assert.deepEqual(yield* late(true), once);
			}
		})
	);
}

it.effect(
	'period.switched and the calendar month’s bounds reach the payslip and an entry’s bands',
	Effect.fnUntraced(function* () {
		paying('SEMI_MONTHLY', [{ from: PlainDate('2026-03-16'), frequency: 'MONTHLY' }]);
		shows(
			'SWITCHED',
			'period.switched && period.month_from == "2026-03-01" && period.month_to == "2026-03-31" ? 1.0 : 2.0'
		);
		required(tables.get('adhoc_catalog')).push({
			id: fixtureId('sw'),
			settings_id: versionOn('2026-03'),
			code: 'SWITCH_AWARE',
			name: 'Switch aware',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: [],
			bands: [{ when: 'true', amount: 'period.switched ? 100.0 : 50.0' }]
		});
		entry('adhoc_catalog_entry', 'sw-1', 'e1', 'sw', '2026-03-05', { amount: Decimal.of('1') });
		const half = yield* run('2026-03-1', 'REGULAR');
		assert.equal(shown(half, 'e1', 'SWITCHED'), 1);
		assert.deepEqual(
			slip(half, 'e1').adjustments.map((row) => [row.component_code, row.amount]),
			[['SWITCH_AWARE', 100]]
		);
		// a month paid at one frequency is not switched
		yield* run('2026-03', 'REGULAR');
		assert.equal(shown(yield* run('2026-04', 'REGULAR'), 'e1', 'SWITCHED'), 2);
	})
);

it.effect(
	'a leave class reads the governing version’s PAYROLL rule tables as `rules`: a regional entitlement',
	Effect.fnUntraced(function* () {
		reset();
		required(required(tables.get('entity'))[0]).region = 'NORTH';
		const version = versionOn('2026-03');
		tables.set('rule_set', [
			...(tables.get('rule_set') ?? []),
			{
				id: fixtureId('rs-regions'),
				settings_id: version,
				family: 'PAYROLL',
				code: 'regions',
				name: 'Regional entitlement',
				rules: { by_region: { NORTH: { local_leave_days: 3 } } }
			}
		]);
		required(tables.get('leave_catalog')).push({
			can_encash: true,
			id: fixtureId('lc-local'),
			settings_id: version,
			code: 'LOCAL_LEAVE',
			name: 'Local leave',
			unit: 'DAY',
			entitlement: {
				overdraw: '0',
				window: 'CALENDAR_YEAR',
				days: 'double(rules.regions.by_region[company.region].local_leave_days)'
			}
		});
		const state = yield* provide(
			leaveState(nativeId('employment_contract', fixtureId('k-e1')), '2026-03-15')
		);
		assert.equal(
			leaveBalances({
				...state,
				classes: state.classes.filter((cls) => cls.id === fixtureId('lc-local'))
			}).find((row) => row.code === 'LOCAL_LEAVE')?.entitlement,
			3
		);
	})
);

it.effect(
	'configured history retains roster months beyond the default year',
	Effect.fnUntraced(function* () {
		reset();
		const version = required(
			required(tables.get('jurisdiction_settings')).find((row) => row.id === versionOn('2026-03'))
		);
		version.payroll = { ...record(version.payroll), history_months: 24 };
		required(tables.get('roster_entry')).push({
			id: fixtureId('old-roster'),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date: PlainDate('2024-06-04'),
			payslip_id: fixtureId('paid'),
			planned_overtime_hours: 3,
			worked_intervals: clocked('2024-06-04', 3)
		});
		shows(
			'OLD_HISTORY',
			'first(hours.months.filter(m, m.month == "2024-06")).overtime_hours',
			'1.0',
			'terms.base_salary == 6500.0'
		);
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'OLD_HISTORY'), 3);
	})
);

it.effect(
	'configured rolling window reads beyond the default history',
	Effect.fnUntraced(function* () {
		reset();
		const version = required(
			required(tables.get('jurisdiction_settings')).find((row) => row.id === versionOn('2026-03'))
		);
		version.payroll = { ...record(version.payroll), rolling_hours_months: 24 };
		required(tables.get('roster_entry')).push({
			id: fixtureId('old-roster'),
			employment_id: nativeId('employment_contract', fixtureId('k-e1')),
			work_date: PlainDate('2024-06-04'),
			payslip_id: fixtureId('paid'),
			planned_overtime_hours: 3,
			worked_intervals: clocked('2024-06-04', 3)
		});
		shows('OLD_ROLLING', 'hours.rolling.overtime_hours', '1.0', 'terms.base_salary == 6500.0');
		assert.equal(shown(yield* run('2026-03', 'REGULAR'), 'e1', 'OLD_ROLLING'), 3);
	})
);

it.effect(
	'staffing lookup shares concurrent computation and failures only for the same invocation, entity and day',
	Effect.fnUntraced(function* () {
		reset();
		const other = nativeId('entity', fixtureId('other-staffing-company'));
		const source = new Map(tables);
		const entities = required(tables.get('entity'));
		source.set('entity', [...entities, { ...required(entities[0]), id: other }]);
		yield* world(fixtureTables(source)).withRead((read) =>
			Effect.gen(function* () {
				const computed = vi.spyOn(PayrollAdmission, 'staffingFrom');
				yield* Effect.addFinalizer(() => Effect.sync(() => computed.mockRestore()));
				const versionFor = yield* versionLookup(read);
				const staffing = yield* staffingLookup(versionFor);
				const day = '2026-03-15';
				const [first, second] = yield* Effect.all(
					[staffing(COMPANY, day), staffing(COMPANY, day)],
					{
						concurrency: 'unbounded'
					}
				);
				assert.equal(first, second);
				assert.equal(computed.mock.calls.length, 1);
				assert.equal(yield* staffing(COMPANY, day), first);
				assert.equal(computed.mock.calls.length, 1);
				assert.notEqual(yield* staffing(COMPANY, '2026-03-16'), first);
				assert.equal(computed.mock.calls.length, 2);
				assert.equal((yield* staffing(other, day)).headcount, 0);
				assert.equal(computed.mock.calls.length, 3);
				const separate = yield* staffingLookup(versionFor);
				assert.notEqual(yield* separate(COMPANY, day), first);
				assert.equal(computed.mock.calls.length, 4);
				const failure = new Refusal({ message: 'The staffing input is unavailable.' });
				computed.mockReturnValueOnce(Result.fail(failure));
				const refusing = yield* staffingLookup(versionFor);
				const refused = yield* Effect.all(
					[Effect.flip(refusing(COMPANY, day)), Effect.flip(refusing(COMPANY, day))],
					{ concurrency: 'unbounded' }
				);
				assert.equal(refused[0], failure);
				assert.equal(refused[1], failure);
				assert.equal(computed.mock.calls.length, 5);
			})
		);
	})
);

it.effect(
	'staffing retains every month end of the previous calendar year after employees leave',
	Effect.fnUntraced(function* () {
		reset();
		const contracts = [
			{
				id: fixtureId('ended'),
				employee_number: 'ended',
				contract_number: 1,
				facts: {},
				employee_id: nativeId('employment_profile', fixtureId('p1')),
				company_id: COMPANY,
				effective_range: { from: PlainDate('2026-01-01'), to: PlainDate('2026-06-30') }
			},
			{
				id: fixtureId('current'),
				employee_number: 'current',
				contract_number: 1,
				facts: {},
				employee_id: nativeId('employment_profile', fixtureId('p2')),
				company_id: COMPANY,
				effective_range: { from: PlainDate('2026-07-01'), to: null }
			},
			{
				id: fixtureId('payee'),
				employee_number: 'payee',
				contract_number: 1,
				facts: {},
				employee_id: nativeId('employment_profile', fixtureId('p3')),
				company_id: COMPANY,
				engagement: 'PAYEE',
				effective_range: { from: PlainDate('2026-01-01'), to: null }
			}
		];
		const source = new Map(tables);
		source.set('employment_contract', contracts);
		source.set(
			'employment_profile',
			['p1', 'p2', 'p3'].map((id) => ({ id: fixtureId(id), name: id, facts: {} }))
		);
		const native = yield* world(fixtureTables(source)).withRead((read) =>
			read('employment_contract', { select: CONTRACT, all: true })
		);
		for (const day of ['2027-01-01', '2027-03-15', '2027-12-31']) {
			const held = yield* Effect.fromResult(
				staffingFrom(native.rows, day, SEEDED_PAYROLL.permanent_when)
			);
			assert.equal(held.headcount, 1);
			assert.deepEqual(
				held.previous_year_headcount_months,
				Array.from({ length: 12 }, (_, i) => ({
					month: `2026-${String(i + 1).padStart(2, '0')}`,
					headcount: 1
				}))
			);
			assert.equal(held.headcount_months.length, 12);
		}
		assert.deepEqual(
			(yield* Effect.fromResult(
				staffingFrom([], '2028-03-01', SEEDED_PAYROLL.permanent_when)
			)).previous_year_headcount_months.map((m) => m.headcount),
			Array(12).fill(0)
		);
	})
);

it.effect(
	'a version without payroll.monthly_wage is refused, never summed by the engine',
	Effect.fnUntraced(function* () {
		reset();
		payrollWithout('2026-03', 'monthly_wage');
		assert.match(yield* refused('2026-03', 'REGULAR'), /needs payroll\.monthly_wage/);
	})
);

it.effect(
	'earned.average means the version’s payroll.history_months; a version without it or rolling_hours_months is refused',
	Effect.fnUntraced(function* () {
		const averaged = Effect.fnUntraced(function* (months: number) {
			reset();
			yield* run('2025-12', 'REGULAR');
			payrollOf('2026-03', { history_months: months });
			// one more than the months averaged, so none still shows a line
			shows('AVERAGED_MONTHS', 'double(earned.average.months) + 1.0');
			return shown(yield* run('2026-03', 'REGULAR'), 'e3', 'AVERAGED_MONTHS');
		});
		// December 2025 is inside twelve months of March 2026 and outside two.
		assert.equal(yield* averaged(12), 2);
		assert.equal(yield* averaged(2), 1);
		reset();
		payrollWithout('2026-03', 'history_months');
		assert.match(yield* refused('2026-03', 'REGULAR'), /needs payroll\.history_months/);
		reset();
		payrollWithout('2026-03', 'rolling_hours_months');
		assert.match(yield* refused('2026-03', 'REGULAR'), /payroll\.rolling_hours_months/);
	})
);

it.effect(
	'a suspension kind that leaves an attendance flag blank is refused',
	Effect.fnUntraced(function* () {
		reset();
		setSuspensionKinds([
			{ settings_id: versionOn('2026-03'), code: 'CLOSURE', name: 'Closure', scheduled: 'true' }
		]);
		tables.set('work_suspension', [
			{
				id: fixtureId('s-blank'),
				company_id: COMPANY,
				kind: 'CLOSURE',
				starts_on: PlainDate('2026-03-04'),
				ends_on: PlainDate('2026-03-04'),
				worksite: null,
				employment_ids: [fixtureId('k-e2')],
				facts: {}
			}
		]);
		shows('SUSPENDED_DAYS', 'double(size(work.days.filter(d, d.suspended != null)))');
		assert.match(
			yield* refused('2026-03', 'REGULAR'),
			/suspension_kind CLOSURE needs counts_as_attended/
		);
	})
);
