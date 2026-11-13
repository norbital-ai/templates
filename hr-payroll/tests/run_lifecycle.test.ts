// What a run may and may not do to the runs around it: every case goes through `payroll_run` and reads what it left.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { JobResult, TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Option, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, accountsIn, ledgerRows, pack, uuid, workspace, storedQuery } from './kit.ts';

const TERMS = {
	rate: { amount: 2800, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 48,
	normal_days_per_week: 6,
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const OTHER = idOf('entity', uuid(900));
const SECOND = idOf('employee_contract', uuid(906));
const FIRST = idOf('employee_contract', uuid(6));
const MOVED = idOf('employee_contract', uuid(907));

const base = () => pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], []);
type Seed = ReturnType<typeof base>;
const contractOf = (seed: Seed) => seed.employee_contract?.[0] ?? {};
const profileOf = (seed: Seed) => seed.entity_profile_version?.[0] ?? {};

/** A second person in the same entity. */
const twoPeople = (): Seed => {
	const seed = base();
	return {
		...seed,
		sys_user: [
			...(seed.sys_user ?? []),
			{ id: uuid(903), name: 'Second', email: 'second@example.test', kind: 'staff' }
		],
		employee_profile: [
			...(seed.employee_profile ?? []),
			{ id: uuid(904), user_id: uuid(903), name: 'Second' }
		],
		employee_balance: [
			...(seed.employee_balance ?? []),
			{ id: uuid(905), employee_id: uuid(904), account: {} }
		],
		employee_contract: [
			...(seed.employee_contract ?? []),
			{
				...contractOf(seed),
				id: SECOND,
				employee_id: uuid(904),
				employee_number: 'W2'
			}
		]
	};
};

/** The same person moves to a sister company in the same jurisdiction on the first of March. */
const moved = (): Seed => {
	const seed = base();
	return {
		...seed,
		entity: [
			...(seed.entity ?? []),
			{ id: OTHER, code: 'E2', name: 'Sister', settings_code: 'MY' }
		],
		entity_profile_version: [
			...(seed.entity_profile_version ?? []),
			{ ...profileOf(seed), id: uuid(902), entity_id: OTHER, name: 'Sister' }
		],
		// the sister company's own payroll, on the same schedule
		pay_group: [
			...(seed.pay_group ?? []),
			...(seed.pay_group ?? []).map((row) => ({ ...row, id: uuid(908), entity_id: OTHER }))
		],
		employee_contract: [
			{ ...contractOf(seed), effective_range: { from: '2025-01-01', to: '2026-02-28' } },
			{
				...contractOf(seed),
				id: MOVED,
				entity_id: OTHER,
				pay_group_id: uuid(908),
				effective_range: { from: '2026-03-01', to: null }
			}
		]
	};
};

const run = (t: Kit, entity: string, period: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.flatMap((caller) =>
				caller.act({
					'payroll_run.create': [{ entity_id: idOf('entity', entity), period, kind: 'ON_CYCLE' }]
				})
			)
		)
		.pipe(Effect.andThen(t.run_due()));
const runs = (t: Kit) =>
	storedQuery(t, { payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) => [...got.payroll_run.rows].sort((a, b) => a.period.localeCompare(b.period)))
	);
const drop = (t: Kit, id: string) =>
	Effect.all([t.as(t.admin), current(t, 'payroll_run', idOf('payroll_run', id))]).pipe(
		Effect.flatMap(([caller, target]) => caller.act({ 'payroll_run.delete': [{ target }] }))
	);
/** The year's net pay each person's balance holds. */
const ytdNet = (t: Kit) =>
	storedQuery(t, { employee_balance: { limit: 10 } }).pipe(
		Effect.flatMap((got) =>
			Effect.forEach(got.employee_balance.rows, (row) =>
				accountsIn(t, row.employee_id).pipe(
					Effect.map((accounts) => accounts.pay?.['NET']?.['MY.Y.2026-01-01']?.['total'] ?? 0)
				)
			)
		)
	);
const catalog = (seed: Seed, family: string, code: string) => {
	const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
	const row = (seed[family] ?? []).find(
		(candidate) => candidate.code === code && candidate.settings_id === version
	);
	assert.ok(row !== undefined, code);
	return String(row.id);
};
const lines = (slip: { readonly breakdown: unknown } | undefined) =>
	Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown).lines;

/** A record as a write targets it: its id at its current revision. */
const current = <C extends string>(t: Kit, model: C, id: Id<C>) =>
	t.db
		.one(Schema.Struct({ revision: Schema.Int }), {
			text: `SELECT revision FROM ${model} WHERE id = $1`,
			params: [id]
		})
		.pipe(
			Effect.map((found) => {
				assert.ok(Option.isSome(found), `No ${model} ${id}`);
				return { id, revision: found.value.revision };
			})
		);
/** The catalogue key a refused write names; another failure answers its tag. */
const keyOf = (failure: { readonly _tag: string; readonly key?: string | undefined }) =>
	failure.key ?? failure._tag;
describe('deleting a run', () => {
	it.live('a run a later one counted is refused, and newest first clears both', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, ENTITY, '2026-01');
			yield* run(t, ENTITY, '2026-02');
			const [january, february] = yield* runs(t);
			assert.ok(january !== undefined && february !== undefined);
			const held = yield* ytdNet(t);
			assert.equal(
				keyOf(yield* Effect.flip(drop(t, january.id))),
				'errors.payroll_run_counted_later'
			);
			assert.deepEqual(yield* ytdNet(t), held);
			yield* drop(t, february.id);
			yield* t.run_due();
			yield* drop(t, january.id);
			yield* t.run_due();
			assert.equal((yield* runs(t)).length, 0);
			assert.deepEqual(yield* ytdNet(t), [0]);
		}).pipe(Effect.provide(workspace({ seed: base(), now: '2026-03-20T02:00:00.000Z' })))
	);

	it.live('both at once is the same as newest first', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, ENTITY, '2026-01');
			yield* run(t, ENTITY, '2026-02');
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.delete': (yield* runs(t)).map((target) => ({ target }))
			});
			yield* t.run_due();
			assert.deepEqual(yield* ytdNet(t), [0]);
		}).pipe(Effect.provide(workspace({ seed: base(), now: '2026-03-20T02:00:00.000Z' })))
	);

	it.live('a paid later run keeps the earlier one, and is itself locked', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, ENTITY, '2026-01');
			yield* run(t, ENTITY, '2026-02');
			const [january, february] = yield* runs(t);
			assert.ok(january !== undefined && february !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: february, set: { state: 'PAID' } }]
			});
			assert.match(
				String(yield* Effect.flip(drop(t, february.id))),
				/This record is locked and cannot be changed/
			);
			assert.equal(
				keyOf(yield* Effect.flip(drop(t, january.id))),
				'errors.payroll_run_counted_later'
			);
		}).pipe(Effect.provide(workspace({ seed: base(), now: '2026-03-20T02:00:00.000Z' })))
	);

	it.live('a later off-cycle run for someone else counted nothing, so it blocks nothing', () => {
		const seed = twoPeople();
		const bonus = catalog(seed, 'adhoc_catalog', 'BONUS');
		const entryFor = (t: Kit, employment: string, incurred: string) =>
			t.as(t.admin).pipe(
				Effect.flatMap((caller) =>
					caller.act({
						'adhoc_catalog_entry.create': [
							{
								entity_id: ENTITY,
								employment_id: idOf('employee_contract', employment),
								catalog_id: idOf('adhoc_catalog', bonus),
								description: 'Bonus',
								quantity: 500,
								incurred_on: PlainDate(incurred)
							}
						]
					})
				)
			);
		const offCycle = (t: Kit, entry: string) =>
			Effect.all([
				t.as(t.admin),
				current(t, 'adhoc_catalog_entry', idOf('adhoc_catalog_entry', entry))
			])
				.pipe(
					Effect.flatMap(([caller, adhoc]) =>
						caller.act({
							'payroll_run.create': [
								{
									entity_id: ENTITY,
									period: '2026-02',
									kind: 'OFF_CYCLE',
									adhoc: [adhoc]
								}
							]
						})
					)
				)
				.pipe(Effect.andThen(t.run_due()));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entryFor(t, FIRST, '2026-02-10');
			yield* entryFor(t, SECOND, '2026-02-11');
			const entries = (yield* storedQuery(t, { adhoc_catalog_entry: { limit: 2 } }))
				.adhoc_catalog_entry.rows;
			const of = (who: string) => entries.find((row) => row.employment_id === who)?.id;
			yield* offCycle(t, String(of(FIRST)));
			yield* offCycle(t, String(of(SECOND)));
			const [one, two] = (yield* runs(t)).sort((a, b) => a.run_number - b.run_number);
			assert.ok(one !== undefined && two !== undefined);
			yield* drop(t, one.id);
			yield* t.run_due();
			assert.equal((yield* runs(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
	});

	it.live('a person who moved: the sister company’s later run blocks the first', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, ENTITY, '2026-02');
			yield* run(t, OTHER, '2026-03');
			const [first, second] = yield* runs(t);
			assert.ok(first !== undefined && second !== undefined);
			assert.equal(
				keyOf(yield* Effect.flip(drop(t, first.id))),
				'errors.payroll_run_counted_later'
			);
			yield* drop(t, second.id);
			yield* t.run_due();
			yield* drop(t, first.id);
			yield* t.run_due();
			assert.deepEqual(yield* ytdNet(t), [0]);
		}).pipe(Effect.provide(workspace({ seed: moved(), now: '2026-03-20T02:00:00.000Z' })))
	);

	it.live('a delete before the balance took the run leaves the balance alone', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]
			});
			const [only] = yield* runs(t);
			assert.ok(only !== undefined);
			yield* drop(t, only.id);
			yield* t.run_due();
			assert.deepEqual(yield* ytdNet(t), [0]);
		}).pipe(Effect.provide(workspace({ seed: base(), now: '2026-03-20T02:00:00.000Z' })))
	);
});

describe('a run posts in its own write', () => {
	const enter = (t: Kit, period: string) =>
		t
			.as(t.admin)
			.pipe(
				Effect.flatMap((caller) =>
					caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
				)
			);
	it.live('so the next run enters at once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, '2026-01');
			const [only] = yield* runs(t);
			assert.ok((yield* ledgerRows(t)).some((row) => row.source === `payroll_run:${only?.id}`));
			yield* enter(t, '2026-02');
			assert.equal((yield* runs(t)).length, 2);
		}).pipe(Effect.provide(workspace({ seed: base(), now: '2026-03-20T02:00:00.000Z' })))
	);
	it.live('so it is paid at once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, '2026-01');
			const [only] = yield* runs(t);
			assert.ok(only !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: only, set: { state: 'PAID' } }]
			});
			assert.equal((yield* runs(t))[0]?.state, 'PAID');
		}).pipe(Effect.provide(workspace({ seed: base(), now: '2026-03-20T02:00:00.000Z' })))
	);
	it.live('a posted payslip names its run, and a sync posts it no more', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, ENTITY, '2026-01');
			const [only] = yield* runs(t);
			const rows = yield* ledgerRows(t);
			assert.ok(rows.length > 0);
			assert.ok(rows.every((row) => row.source === `payroll_run:${only?.id}`));
			yield* (yield* t.as(t.admin)).run('ledger', {}, JobResult);
			yield* t.run_due();
			assert.equal(
				(yield* ledgerRows(t)).filter((row) => row.source === `payroll_run:${only?.id}`).length,
				rows.length
			);
		}).pipe(Effect.provide(workspace({ seed: base(), now: '2026-03-20T02:00:00.000Z' })))
	);
});

describe('order of cycles', () => {
	it.live('a skipped cycle cannot run behind a later one', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, ENTITY, '2026-02');
			assert.match(
				String(yield* Effect.flip(run(t, ENTITY, '2026-01'))),
				/2026-02 has already run/
			);
			assert.match(
				String(yield* Effect.flip(run(t, ENTITY, '2026-02'))),
				/already has this payroll_run/
			);
			assert.equal((yield* runs(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed: base(), now: '2026-03-20T02:00:00.000Z' })))
	);

	it.live('a deleted latest cycle frees its period for a rerun at the same figures', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, ENTITY, '2026-01');
			yield* run(t, ENTITY, '2026-02');
			const [held] = yield* ytdNet(t);
			const [, february] = yield* runs(t);
			assert.ok(february !== undefined);
			yield* drop(t, february.id);
			yield* t.run_due();
			yield* run(t, ENTITY, '2026-02');
			assert.deepEqual(yield* ytdNet(t), [held]);
		}).pipe(Effect.provide(workspace({ seed: base(), now: '2026-03-20T02:00:00.000Z' })))
	);
});

describe('what an off-cycle run may name', () => {
	const seed = base();
	const adhoc = (code: string, quantity: number, entity: string = ENTITY) => ({
		entity_id: idOf('entity', entity),
		employment_id: FIRST,
		catalog_id: idOf('adhoc_catalog', catalog(seed, 'adhoc_catalog', code)),
		description: code,
		quantity,
		incurred_on: PlainDate('2026-02-10')
	});
	/** An off-cycle run paying these entries, each named at the revision it was read. */
	const offCycleOf = (
		t: Kit,
		adhoc: readonly { readonly id: Id<'adhoc_catalog_entry'>; readonly revision: number }[]
	) =>
		t
			.as(t.admin)
			.pipe(
				Effect.flatMap((caller) =>
					caller.act({
						'payroll_run.create': [
							{
								entity_id: ENTITY,
								period: '2026-02',
								kind: 'OFF_CYCLE',
								adhoc
							}
						]
					})
				)
			)
			.pipe(Effect.andThen(t.run_due()));
	const offCycle = (t: Kit, ids: readonly string[]) =>
		Effect.forEach(ids, (id) =>
			current(t, 'adhoc_catalog_entry', idOf('adhoc_catalog_entry', id))
		).pipe(Effect.flatMap((adhoc) => offCycleOf(t, adhoc)));
	const paidOn = (t: Kit) =>
		storedQuery(t, { payslip: { limit: 10 } }).pipe(Effect.map((got) => got.payslip.rows));

	it.live('an entry a run already paid is not paid twice', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.admin)).act({ 'adhoc_catalog_entry.create': [adhoc('BONUS', 500)] });
			const entry = (yield* storedQuery(t, { adhoc_catalog_entry: { limit: 1 } }))
				.adhoc_catalog_entry.rows[0];
			assert.ok(entry !== undefined);
			yield* offCycle(t, [entry.id]);
			assert.match(String(yield* Effect.flip(offCycle(t, [entry.id]))), /already attached/);
			const slips = yield* paidOn(t);
			const paid = slips.flatMap((slip) => lines(slip).filter((line) => line.code === 'BONUS'));
			assert.equal(paid.length, 1);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })))
	);

	it.live('a recurring item is refused, not paid', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
			const recurring = (seed.adhoc_catalog ?? []).find(
				(row) => row.settings_id === version && row.off_cycle_eligible === false
			);
			assert.ok(recurring !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'adhoc_catalog_entry.create': [adhoc(String(recurring.code), 100)]
			});
			const entry = (yield* storedQuery(t, { adhoc_catalog_entry: { limit: 1 } }))
				.adhoc_catalog_entry.rows[0];
			assert.ok(entry !== undefined);
			// refused whole: a run that sealed the entry without paying it would keep it from the on-cycle run for good
			assert.match(String(yield* Effect.flip(offCycle(t, [entry.id]))), /on-cycle/i);
			assert.equal((yield* paidOn(t)).length, 0);
			const [held] = (yield* storedQuery(t, { adhoc_catalog_entry: { limit: 1 } }))
				.adhoc_catalog_entry.rows;
			assert.equal(held?.payroll_run_id ?? null, null);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })))
	);

	it.live('an unknown entry is refused, not an empty run', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			// an id no record has: the run names it at a revision of its own
			const unknown = { id: idOf('adhoc_catalog_entry', uuid(999)), revision: 1 };
			assert.match(String(yield* Effect.flip(offCycleOf(t, [unknown]))), /does not exist/);
			assert.equal((yield* runs(t)).length, 0);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })))
	);
});
