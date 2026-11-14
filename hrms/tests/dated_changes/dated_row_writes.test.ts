// What a write to a person's stints and dated rows is checked for, and what it does under a run: two stints of one
// person never overlap; a terms or parameters row is dated the first of a month or the stint's first day and leaves an
// employment that holds what one needs; a first day moves with its rows; a stint without a payslip is deleted; an unpaid
// run holds its people, a paid one is amended; and a move to another jurisdiction settles the old leave and opens the
// new scope. Public law packs are only the fixture: every expected figure is one the test wrote or the system itself
// produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { verify } from '../../src/lib/integrity.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import { amendments } from '../amendment_kit.ts';
import {
	EMPLOYMENT,
	ENTITY,
	PARAMETERS,
	PAY_GROUP,
	REST,
	TERMS,
	WORK,
	accountsIn,
	current,
	lawAt,
	pack,
	refusal,
	storedQuery,
	storedReader,
	syncAll,
	uuid,
	workspace,
	agreedTerms
} from '../kit.ts';

const NOW = '2026-03-20T02:00:00.000Z';
const RATE = 2800;
const RAISED = 3200;
const AGREED = agreedTerms(RATE, 'MANUAL_LABOUR');
const FIRST = idOf('employment', EMPLOYMENT);
const NEXT = idOf('employment', uuid(907));
const FIRST_TERMS = idOf('contract_terms', TERMS);
const FIRST_PARAMETERS = idOf('statutory_parameters', PARAMETERS);
const OTHER = idOf('entity', uuid(900));
const OTHER_GROUP = idOf('pay_group', uuid(908));
const PATTERN = idOf('shift_pattern', uuid(909));
const PROFILE = idOf('employee_profile', uuid(4));

const base = () =>
	pack('MY', 'Asia/Kuala_Lumpur', { ...AGREED, residency_status: 'CITIZEN' }, {}, [], []);
type Seed = ReturnType<typeof base>;
const groupOf = (seed: Seed) => seed.pay_group?.[0] ?? {};

/** A second company under the law `code` in the time zone `zone`, with its own payroll and no dated value set. */
const withCompany = (seed: Seed, code: string, zone: string): Seed => ({
	...seed,
	entity: [
		...(seed.entity ?? []),
		{ id: OTHER, code: 'E2', name: 'Other', settings_code: code, time_zone: zone }
	],
	entity_change: [
		...(seed.entity_change ?? []),
		{ id: uuid(902), entity_id: OTHER, effective_from: '2025-01-01' }
	],
	pay_group: [...(seed.pay_group ?? []), { ...groupOf(seed), id: OTHER_GROUP, entity_id: OTHER }]
});

const run = (t: Kit, period: string, entity: Id<'entity'> = ENTITY) =>
	t
		.as(t.admin)
		.pipe(
			Effect.flatMap((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: entity, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
const runs = (t: Kit) =>
	storedQuery(t, { payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) => [...got.payroll_run.rows].sort((a, b) => a.period.localeCompare(b.period)))
	);
const runOf = (t: Kit, period: string, entity: Id<'entity'> = ENTITY) =>
	runs(t).pipe(
		Effect.map((rows) => {
			const ran = rows.find((row) => row.period === period && row.entity_id === entity);
			assert.ok(ran !== undefined, `${period} did not run`);
			return ran;
		})
	);
const pay = (t: Kit, id: Id<'payroll_run'>) =>
	Effect.all([t.as(t.admin), current(t, 'payroll_run', id)]).pipe(
		Effect.flatMap(([caller, target]) =>
			caller.act({ 'payroll_run.update': [{ target, set: { state: 'PAID' } }] })
		)
	);
const drop = (t: Kit, id: Id<'payroll_run'>) =>
	Effect.all([t.as(t.admin), current(t, 'payroll_run', id)])
		.pipe(Effect.flatMap(([caller, target]) => caller.act({ 'payroll_run.delete': [{ target }] })))
		.pipe(Effect.andThen(t.run_due()));
/** The payslips of a period's run. */
const slipsOf = (t: Kit, period: string, entity: Id<'entity'> = ENTITY) =>
	Effect.gen(function* () {
		const ran = yield* runOf(t, period, entity);
		const { payslip } = yield* storedQuery(t, { payslip: { limit: 100 } });
		return payslip.rows.filter((slip) => slip.payroll_run_id === ran.id);
	});
const breakdown = (slip: { readonly breakdown: unknown } | undefined) =>
	Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown);
/** The contract salary a payslip opened with. */
const basicOf = (slip: { readonly breakdown: unknown } | undefined) =>
	breakdown(slip).checkpoints.find((point) => point.code === 'BASIC')?.value;
// the first run of a workspace: a write refused under it while it is unpaid is told so by its number
const HELD = /Run 1 holds this person and is not paid yet/;
const failures = (t: Kit) =>
	storedQuery(t, { obligation: { limit: 500 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.map((row) => row.title).filter((title) => /failed/i.test(title))
		)
	);

const stints = (t: Kit) =>
	storedQuery(t, { employment: { limit: 100 } }).pipe(
		Effect.map(({ employment }) => employment.rows)
	);
type Stint = Effect.Success<ReturnType<typeof stints>>[number];
/** The person's open stint. */
const openOf = (t: Kit) =>
	stints(t).pipe(
		Effect.map((rows) => {
			const held = rows.find(
				(row) => row.employee_id === PROFILE && row.effective_range.to === null
			);
			assert.ok(held !== undefined, 'No open stint');
			return held;
		})
	);
const termsRows = (t: Kit) =>
	storedQuery(t, { contract_terms: { limit: 100 } }).pipe(
		Effect.map(({ contract_terms }) => contract_terms.rows)
	);
/**
 * A new stint of the person from `from`, with the same company or another: its first terms and statutory parameters
 * on its first day, in the one write a hire, a rehire and a transfer are.
 */
const hire = (
	t: Kit,
	from: string,
	entity: Id<'entity'> = ENTITY,
	set: {
		readonly agreed?: Partial<typeof AGREED>;
		readonly parameters?: Readonly<Record<string, string>>;
		readonly service?: string;
	} = {}
) =>
	Effect.gen(function* () {
		const before = new Set((yield* stints(t)).map((row) => row.id));
		yield* (yield* t.as(t.admin)).act({
			'employment.create': [
				{
					employee_id: PROFILE,
					entity_id: entity,
					employee_number: 'W1',
					effective_range: { from, to: null },
					...(set.service === undefined ? {} : { service_started_on: set.service }),
					reason: 'A new stint',
					terms: [
						{
							effective_from: from,
							engagement: 'EMPLOYEE',
							pay_group_id: entity === OTHER ? OTHER_GROUP : idOf('pay_group', PAY_GROUP),
							...(set.agreed ?? AGREED)
						}
					],
					parameters: [
						{
							effective_from: from,
							residency_status: 'CITIZEN',
							marital_status: 'SINGLE',
							...(set.parameters === undefined ? {} : { parameters: set.parameters })
						}
					]
				}
			]
		});
		const made = (yield* stints(t)).find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No new stint');
		return made.id;
	});
const end = (t: Kit, held: Stint, to: string) =>
	t.as(t.admin).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'employment.update': [
					{
						target: held,
						set: {
							effective_range: { from: held.effective_range.from, to },
							reason: 'Replaced'
						}
					}
				]
			})
		)
	);
/** What a terms row of these tests may hold. */
type Change = {
	readonly rate?: { readonly amount: number; readonly unit: 'MONTHLY' };
	readonly normal_hours_per_day?: number;
	readonly work_region?: string;
	readonly pay_group_id?: Id<'pay_group'>;
	readonly shift_pattern_id?: Id<'shift_pattern'>;
};
const RAISE: Change = { rate: { amount: RAISED, unit: 'MONTHLY' } };
/** A terms row for the first stint from `from`, holding only what it changes. */
const dated = (t: Kit, from: string, change: Change) =>
	t.as(t.admin).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'contract_terms.create': [{ employment_id: FIRST, effective_from: from, ...change }]
			})
		)
	);
/** A raise from the first of a month: one terms row holding the new rate. */
const raise = (t: Kit, from: string) => dated(t, from, RAISE).pipe(Effect.andThen(t.run_due()));

describe('the stints of one person', () => {
	it.live('never overlap: a new one waits until the open one has its last day', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const held = yield* openOf(t);
			assert.match(String(yield* Effect.flip(hire(t, '2026-04-01'))), /overlaps another record/);
			assert.deepEqual(
				(yield* stints(t)).map((row) => row.id),
				[FIRST]
			);
			// the way out: the earlier one gets its last day
			yield* end(t, held, '2026-03-31');
			const next = yield* hire(t, '2026-04-01');
			assert.deepEqual((yield* stints(t)).map((row) => row.id).sort(), [FIRST, next].sort());
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);

	it.live('the overlap is the person’s: an open stint blocks one with a sister company too', () => {
		const seed = base();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const held = yield* openOf(t);
			assert.match(
				String(yield* Effect.flip(hire(t, '2026-04-01', OTHER))),
				/overlaps another record/
			);
			yield* end(t, held, '2026-03-31');
			yield* hire(t, '2026-04-01', OTHER);
			assert.equal((yield* openOf(t)).entity_id, OTHER);
		}).pipe(
			Effect.provide(workspace({ seed: withCompany(seed, 'MY', 'Asia/Kuala_Lumpur'), now: NOW }))
		);
	});

	it.live('refuses service that starts after the stint that records it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* end(t, yield* openOf(t), '2026-01-31');
			const refused = yield* refusal(hire(t, '2026-02-01', ENTITY, { service: '2026-02-02' }));
			assert.equal(refused.key, 'errors.employment_service_after_start');
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);

	it.live('a first day moves with the rows dated on it, in one save', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			// a first day moved past a later terms row would leave that row before the stint
			yield* dated(t, '2026-02-01', RAISE);
			const past = yield* refusal(
				admin.act({
					'employment.update': [
						{
							target: yield* current(t, 'employment', FIRST),
							set: { effective_range: { from: '2026-02-10', to: null } }
						}
					]
				})
			);
			assert.equal(past.key, 'errors.employment_change_date');
			yield* admin.act({
				'employment.update': [
					{
						target: yield* current(t, 'employment', FIRST),
						set: { effective_range: { from: '2025-02-10', to: null } }
					}
				]
			});
			const stored = yield* storedQuery(t, {
				employment: { limit: 10 },
				contract_terms: { where: { id: { eq: FIRST_TERMS } }, limit: 10 },
				statutory_parameters: { limit: 10 }
			});
			assert.deepEqual(
				[
					...stored.employment.rows.map((row) => row.effective_range.from),
					...stored.contract_terms.rows.map((row) => row.effective_from),
					...stored.statutory_parameters.rows.map((row) => row.effective_from)
				].map(String),
				['2025-02-10', '2025-02-10', '2025-02-10']
			);
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);
});

describe('a dated row is checked when it is written', () => {
	it.live(
		'its date is the first of a month or the stint’s first day; a hire or an exit keeps its real date',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const midMonth = yield* refusal(dated(t, '2026-02-16', RAISE));
				assert.equal(midMonth.key, 'errors.employment_change_date');
				const told = yield* refusal(
					admin.act({
						'statutory_parameters.create': [
							{ employment_id: FIRST, effective_from: '2026-02-16', marital_status: 'MARRIED' }
						]
					})
				);
				assert.equal(told.key, 'errors.employment_change_date');
				yield* end(t, yield* openOf(t), '2026-02-13');
				// nothing is agreed for a day after the last one
				const after = yield* refusal(dated(t, '2026-03-01', RAISE));
				assert.equal(after.key, 'errors.employment_change_date');
				// a rehire's first rows start on its first day, whatever the day
				yield* hire(t, '2026-02-16');
				assert.equal(String((yield* openOf(t)).effective_range.from), '2026-02-16');
			}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);

	it.live('the rows of a stint hold between them what an employment needs', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const cleared = yield* refusal(
				(yield* t.as(t.admin)).act({
					'contract_terms.create': [
						{ employment_id: FIRST, effective_from: '2026-04-01', clears: ['engagement'] }
					]
				})
			);
			assert.equal(cleared.key, 'errors.contract_terms_required');
			yield* end(t, yield* openOf(t), '2026-03-31');
			const { normal_days_per_week: _days, ...short } = AGREED;
			const hired = yield* refusal(hire(t, '2026-04-01', ENTITY, { agreed: short }));
			assert.equal(hired.key, 'errors.contract_terms_required');
			assert.equal((yield* stints(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);

	it.live('its pay group is one of the stint’s own company', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* refusal(dated(t, '2026-04-01', { pay_group_id: OTHER_GROUP }));
			assert.equal(refused.key, 'errors.contract_terms_pay_group_other_company');
		}).pipe(
			Effect.provide(workspace({ seed: withCompany(base(), 'MY', 'Asia/Kuala_Lumpur'), now: NOW }))
		)
	);

	it.live('no shift it schedules outlasts its normal day', () => {
		const seed = base();
		const week = Object.fromEntries(
			['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map((day) => [day, WORK])
		);
		// the pack's work shift is eight hours long
		const patterned: Seed = {
			...seed,
			shift_pattern: [
				{
					id: PATTERN,
					entity_id: ENTITY,
					code: 'WEEK',
					name: 'Week',
					effective_range: { from: '2025-01-01', to: null },
					pattern: { week_start: 'MONDAY', days: { ...week, SATURDAY: REST, SUNDAY: REST } }
				}
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* refusal(
				dated(t, '2026-04-01', { shift_pattern_id: PATTERN, normal_hours_per_day: 7.5 })
			);
			assert.equal(refused.key, 'errors.contract_terms_shift_overlong');
		}).pipe(Effect.provide(workspace({ seed: patterned, now: NOW })));
	});

	it.live('names only a work region its law declares', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* refusal(dated(t, '2026-04-01', { work_region: 'NOWHERE' }));
			assert.equal(refused.key, 'errors.contract_terms_work_region');
			// a key the law declares on the row's date is taken
			const [declared] = Object.keys(objectValue(lawAt('MY', '2026-04-01').settings.work_regions));
			assert.ok(declared !== undefined);
			yield* dated(t, '2026-04-01', { work_region: declared });
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);
});

describe('a person under a run', () => {
	it.live(
		'cannot change under an unpaid run, by the run’s number; deleting the run frees them',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, '2026-02');
				const ran = yield* runOf(t, '2026-02');
				const held = yield* openOf(t);
				assert.match(String(yield* Effect.flip(raise(t, '2026-02-01'))), HELD);
				assert.match(String(yield* Effect.flip(end(t, held, '2026-01-31'))), HELD);
				assert.match(String(yield* Effect.flip(end(t, held, '2026-02-13'))), HELD);
				assert.deepEqual(yield* amendments(t), []);
				assert.equal(basicOf((yield* slipsOf(t, '2026-02'))[0]), RATE);
				yield* drop(t, ran.id);
				yield* raise(t, '2026-02-01');
				yield* run(t, '2026-02');
				const [slip, ...others] = yield* slipsOf(t, '2026-02');
				assert.deepEqual(others, []);
				assert.equal(slip?.employment_id, FIRST);
				assert.equal(basicOf(slip), RAISED);
			}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);

	it.live(
		'once the run is paid the change is written over it: the payslip stands and the next run takes the period up',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, '2026-02');
				const ran = yield* runOf(t, '2026-02');
				yield* pay(t, ran.id);
				yield* t.run_due();
				yield* raise(t, '2026-02-01');
				// the change left one open row for the person's February
				const open = yield* amendments(t);
				assert.deepEqual(
					open.map((row) => [row.employee_id, row.period, row.payroll_run_id]),
					[[PROFILE, '2026-02', null]]
				);
				assert.match(
					String(yield* Effect.flip(drop(t, ran.id))),
					/This record is locked and cannot be changed/
				);
				yield* run(t, '2026-03');
				const [february] = yield* slipsOf(t, '2026-02');
				const [march] = yield* slipsOf(t, '2026-03');
				assert.deepEqual(
					[february?.employment_id, basicOf(february)],
					[FIRST, RATE],
					'the paid payslip is not rewritten'
				);
				assert.deepEqual([march?.employment_id, basicOf(march)], [FIRST, RAISED]);
				assert.deepEqual(
					(yield* amendments(t)).map((row) => row.payroll_run_id),
					[(yield* runOf(t, '2026-03')).id]
				);
			}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);
});

// Break-it: a raise keyed ahead of its day, and the month it starts is run before that day comes.
describe('a raise dated ahead and a run that got there first', () => {
	const EARLY = '2026-01-20T02:00:00.000Z';
	const reach = (t: Kit, instant: string) =>
		Effect.sync(() => t.clock.set(instant)).pipe(Effect.andThen(t.run_due()));

	it.live('the run prices the month by the row’s date: no day has to come first', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* raise(t, '2026-02-01');
			yield* run(t, '2026-02');
			const [slip, ...others] = yield* slipsOf(t, '2026-02');
			assert.deepEqual(others, []);
			assert.deepEqual([slip?.employment_id, basicOf(slip)], [FIRST, RAISED]);
			// its day comes and makes nothing: no row, no task, and the payslip stands
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.equal((yield* termsRows(t)).length, 2);
			assert.deepEqual(yield* failures(t), []);
			assert.equal(basicOf((yield* slipsOf(t, '2026-02'))[0]), RAISED);
		}).pipe(Effect.provide(workspace({ seed: base(), now: EARLY })))
	);

	it.live('moved to the next month before the run, it starts there', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* raise(t, '2026-02-01');
			const filed = (yield* termsRows(t)).find((row) => row.id !== FIRST_TERMS);
			assert.ok(filed !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'contract_terms.update': [{ target: filed, set: { effective_from: '2026-03-01' } }]
			});
			yield* run(t, '2026-02');
			yield* pay(t, (yield* runOf(t, '2026-02')).id);
			yield* reach(t, '2026-03-01T01:00:00.000Z');
			yield* run(t, '2026-03');
			assert.equal(basicOf((yield* slipsOf(t, '2026-02'))[0]), RATE);
			assert.equal(basicOf((yield* slipsOf(t, '2026-03'))[0]), RAISED);
			assert.deepEqual(yield* amendments(t), []);
			assert.deepEqual(yield* failures(t), []);
		}).pipe(Effect.provide(workspace({ seed: base(), now: EARLY })))
	);
});

// A mistake is corrected where it was recorded: wrong terms on their row, a stint that never was by deleting it.
describe('a mistake in a stint', () => {
	it.live('wrong terms are edited on the row that set them, and the next run pays them', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.admin)).act({
				'contract_terms.update': [
					{
						target: yield* current(t, 'contract_terms', FIRST_TERMS),
						set: { rate: { amount: RAISED, unit: 'MONTHLY' } }
					}
				]
			});
			yield* t.run_due();
			assert.equal((yield* termsRows(t)).length, 1);
			yield* run(t, '2026-02');
			const [slip, ...others] = yield* slipsOf(t, '2026-02');
			assert.deepEqual(others, []);
			assert.deepEqual([slip?.employment_id, basicOf(slip)], [FIRST, RAISED]);
			assert.deepEqual(yield* failures(t), []);
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);

	// Break-it: delete the stint another one follows.
	it.live(
		'a stint without a payslip is deleted, and the one after it stands, pays, and is no exit; a paid one stays',
		() => {
			const seed = base();
			const from = '2026-02-01';
			const chain: Seed = {
				...seed,
				employment: (seed.employment ?? []).flatMap((row) => [
					{ ...row, effective_range: { from: '2025-01-01', to: '2026-01-31' } },
					{ ...row, id: NEXT, effective_range: { from, to: null } }
				]),
				contract_terms: (seed.contract_terms ?? []).flatMap((row) => [
					row,
					{ ...row, id: uuid(914), employment_id: NEXT, effective_from: from }
				]),
				statutory_parameters: (seed.statutory_parameters ?? []).flatMap((row) => [
					row,
					{ ...row, id: uuid(915), employment_id: NEXT, effective_from: from }
				])
			};
			const remove = (t: Kit, id: Id<'employment'>) =>
				Effect.all([t.as(t.admin), current(t, 'employment', id)]).pipe(
					Effect.flatMap(([caller, target]) => caller.act({ 'employment.delete': [{ target }] }))
				);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* remove(t, FIRST);
				yield* t.run_due();
				assert.deepEqual(
					(yield* stints(t)).map((row) => row.id),
					[NEXT]
				);
				// its rows went with it
				assert.deepEqual(
					(yield* termsRows(t)).map((row) => row.employment_id),
					[NEXT]
				);
				const { leave_catalog_entry } = yield* storedQuery(t, {
					leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 }
				});
				assert.deepEqual(leave_catalog_entry.rows, []);
				yield* run(t, '2026-02');
				assert.deepEqual(
					(yield* slipsOf(t, '2026-02')).map((slip) => slip.employment_id),
					[NEXT]
				);
				assert.deepEqual(yield* failures(t), []);
				// the payslip names the stint: it is corrected, never deleted
				assert.equal((yield* Effect.result(remove(t, NEXT)))._tag, 'Failure');
				assert.equal((yield* openOf(t)).id, NEXT);
			}).pipe(Effect.provide(workspace({ seed: chain, now: NOW })));
		}
	);
});

describe('a company before its first change', () => {
	it.live('runs on the defaults: no change has to cover a period', () => {
		const seed = base();
		const later: Seed = {
			...seed,
			entity_change: (seed.entity_change ?? []).map((row) => ({
				...row,
				effective_from: '2026-02-01'
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-01');
			assert.equal((yield* slipsOf(t, '2026-01')).length, 1);
		}).pipe(Effect.provide(workspace({ seed: later, now: NOW })));
	});
});

// transfer-semantics.md §3.1 and §4. The person moves from the Malaysian company to the Singapore one on 1 November:
// Malaysia's annual leave has a `payout`, so Malaysia's last payslip pays out the days left and Singapore opens its own
// keys.
// Kept on SG: a transfer across jurisdictions needs a second law pack, and its keys a second scope.
describe('a transfer across jurisdictions, in one flow', () => {
	const LATE = '2026-11-20T02:00:00.000Z';
	const OFFICE = {
		...AGREED,
		rate: { amount: 8000, unit: 'MONTHLY' as const },
		statutory_work_category: 'NON_MANUAL'
	};
	const WORKSPACE = new Set([
		'entity',
		'pay_group',
		'entity_change',
		'sys_user',
		'employee_profile',
		'employee_balance',
		'employment',
		'contract_terms',
		'statutory_parameters',
		'dependant',
		'shift_definition',
		'holiday',
		'roster_entry'
	]);
	const my = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{ ...OFFICE, residency_status: 'CITIZEN' },
		{},
		[],
		[]
	);
	const sg = pack('SG', 'Asia/Singapore', { ...OFFICE, residency_status: 'CITIZEN' }, {}, [], []);
	// both laws' public rows, and the Singapore company beside the Malaysian one
	const seed: Seed = withCompany(
		{
			...my,
			...Object.fromEntries(
				Object.entries(sg)
					.filter(([name]) => !WORKSPACE.has(name))
					.map(([name, rows]) => [name, [...(my[name] ?? []), ...rows]])
			)
		},
		'SG',
		'Asia/Singapore'
	);
	const cashOuts = (t: Kit) =>
		storedQuery(t, {
			leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 }
		}).pipe(Effect.map(({ leave_catalog_entry }) => leave_catalog_entry.rows));
	const annualLines = (slips: readonly { readonly breakdown: unknown }[]) =>
		slips.flatMap((slip) => breakdown(slip).lines.filter((line) => line.code === 'ANNUAL_LEAVE'));
	/** What the annual-leave keys of one scope hold of a measure. */
	const annual = (t: Kit, scope: string, measure: string) =>
		accountsIn(t).pipe(
			Effect.map((accounts) =>
				Object.entries(accounts.leave?.['ANNUAL_LEAVE'] ?? {})
					.filter(([period]) => period.startsWith(`${scope}.`))
					.reduce((total, [, measures]) => total + (measures[measure] ?? 0), 0)
			)
		);
	const netYears = (t: Kit) =>
		accountsIn(t).pipe(Effect.map((accounts) => accounts.pay?.['NET'] ?? {}));

	it.live(
		'the old leave is cashed out in the old law’s last run and the new scope opens empty',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				assert.ok((yield* annual(t, 'MY', 'entitled')) > 0);
				const held = yield* openOf(t);
				// the transfer sheet's two writes: the last day with the old company, the stint with the new one
				yield* end(t, held, '2026-10-31');
				const moving = yield* hire(t, '2026-11-01', OTHER, {
					agreed: OFFICE,
					parameters: { race: 'CHINESE' },
					// service the group credits: Singapore's leave needs three months behind it
					...(held.service_started_on == null ? {} : { service: String(held.service_started_on) })
				});
				yield* t.run_due();

				// nothing is keyed: Malaysia's last payslip settles what is left of its year itself
				assert.deepEqual(yield* cashOuts(t), []);
				const days = (yield* annual(t, 'MY', 'entitled')) - (yield* annual(t, 'MY', 'used'));
				assert.ok(days > 0);

				// Malaysia's last run pays those days and uses them up; Singapore's first run pays none of them
				yield* run(t, '2026-10');
				const last = yield* slipsOf(t, '2026-10');
				assert.deepEqual(
					last.map((slip) => slip.employment_id),
					[FIRST]
				);
				assert.deepEqual(
					annualLines(last).map((line) => line.direction),
					['ADD']
				);
				assert.deepEqual(
					// under the old scope's window: the new scope's leave is not the old payslip's to settle
					(breakdown(last[0]).cash_out ?? []).map((row) => [
						row.code,
						row.period.split('.')[0],
						row.amount
					]),
					[['ANNUAL_LEAVE', 'MY', days]]
				);
				// the payslip posts the days as used once the run is paid
				yield* pay(t, (yield* runOf(t, '2026-10')).id);
				yield* t.run_due();
				const used = yield* annual(t, 'MY', 'used');
				assert.equal(yield* annual(t, 'MY', 'entitled'), used);
				const before = yield* netYears(t);
				yield* run(t, '2026-11', OTHER);
				const first = yield* slipsOf(t, '2026-11', OTHER);
				assert.deepEqual(
					first.map((slip) => slip.employment_id),
					[moving]
				);
				assert.deepEqual(annualLines(first), []);

				// the keys carry the scope: Malaysia's year stops where it was, Singapore's starts with this run alone
				const after = yield* netYears(t);
				const scopes = (years: typeof after, scope: string) =>
					Object.entries(years).filter(([period]) => period.startsWith(`${scope}.`));
				assert.deepEqual(scopes(after, 'MY'), scopes(before, 'MY'));
				assert.deepEqual(scopes(before, 'SG'), []);
				assert.ok(scopes(after, 'SG').some(([, measures]) => (measures['total'] ?? 0) > 0));

				// and the leave: Singapore's own entitlement, with nothing used: Malaysia's days stay under Malaysia's keys
				yield* syncAll(t);
				assert.ok((yield* annual(t, 'SG', 'entitled')) > 0);
				assert.equal(yield* annual(t, 'SG', 'used'), 0);
				assert.equal(yield* annual(t, 'MY', 'used'), used);
				assert.deepEqual(yield* cashOuts(t), []);
				assert.deepEqual(yield* failures(t), []);
				assert.deepEqual((yield* t.run_due()).failed, []);
				assert.deepEqual(
					(yield* verify(storedReader(t), LATE.slice(0, 10)))
						.filter((finding) => finding.invariant !== 'W1')
						.map((finding) => `${finding.invariant} ${finding.message}`),
					[]
				);
			}).pipe(Effect.provide(workspace({ seed, now: LATE })))
	);
});
