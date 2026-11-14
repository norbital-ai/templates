// A company's payrolls. A run pays one pay group: its people, its schedule, its own order of cycles and its own
// capture of the stints it paid. Malaysia's public law is only the fixture; nothing here reads an amount.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { cycleOf, payDateOf } from '../../src/lib/payroll_engine/pay_cycle.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	PAY_GROUP,
	ledgerRows,
	pack,
	uuid,
	workspace,
	storedQuery,
	keyOf,
	current,
	packTerms,
	withSecond,
	withSister,
	endStint
} from '../kit.ts';

const NOW = '2026-03-20T02:00:00.000Z';
const A = idOf('pay_group', PAY_GROUP);
const B = idOf('pay_group', uuid(808));
const FIRST = idOf('employment', uuid(6));
const SECOND = idOf('employment', uuid(906));
const SISTER_GROUP = idOf('pay_group', uuid(908));
const MONTHLY = {
	frequency: 'MONTHLY',
	business_day: 'PREVIOUS',
	non_working_weekdays: [0, 6],
	short_month: 'LAST_DAY',
	pay_cutoff_day: 1,
	pay_days: [25]
};
const SEMI_MONTHLY = {
	frequency: 'SEMI_MONTHLY',
	business_day: 'PREVIOUS',
	non_working_weekdays: [0, 6],
	short_month: 'LAST_DAY',
	pay_cutoff_day: 1,
	pay_days: [15, 31]
};

const base = () => pack('MY', 'Asia/Kuala_Lumpur', packTerms(2800, 'MANUAL_LABOUR'), {}, [], []);
type Seed = ReturnType<typeof base>;
/** One company, two payrolls: the first person is paid in A (Monthly), the second in B (Executives). */
const twoGroups = (schedule: typeof MONTHLY = MONTHLY): Seed => {
	const seed = withSecond(base());
	const [group] = seed.pay_group ?? [];
	assert.ok(group !== undefined);
	return {
		...seed,
		pay_group: [
			{ ...group, payment_schedule: MONTHLY },
			{ ...group, id: B, name: 'Executives', payment_schedule: schedule }
		],
		contract_terms: (seed.contract_terms ?? []).map((row) =>
			row.employment_id === SECOND ? { ...row, pay_group_id: B } : row
		)
	};
};

const run = (t: Kit, group: Id<'pay_group'> | null, period: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.flatMap((caller) =>
				caller.act({
					'payroll_run.create': [
						{
							entity_id: ENTITY,
							...(group === null ? {} : { pay_group_id: group }),
							period,
							kind: 'ON_CYCLE'
						}
					]
				})
			)
		)
		.pipe(Effect.andThen(t.run_due()));
const runs = (t: Kit) =>
	storedQuery(t, { payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) =>
			[...got.payroll_run.rows].sort((a, b) =>
				`${a.period} ${a.pay_group_id}`.localeCompare(`${b.period} ${b.pay_group_id}`)
			)
		)
	);
const slips = (t: Kit) =>
	storedQuery(t, { payslip: { limit: 100 } }).pipe(Effect.map((got) => got.payslip.rows));
/** The stints a group's run of a period paid. */
const paidBy = (t: Kit, group: Id<'pay_group'>, period: string) =>
	Effect.gen(function* () {
		const ran = (yield* runs(t)).find((row) => row.pay_group_id === group && row.period === period);
		assert.ok(ran !== undefined, `${period} did not run`);
		return (yield* slips(t))
			.filter((slip) => slip.payroll_run_id === ran.id)
			.map((slip) => slip.employment_id)
			.sort();
	});
// each of these workspaces has run once, unpaid, when a change is refused under it: the refusal names that run
const HELD = /Run 1 holds this person and is not paid yet/;
const failures = (t: Kit) =>
	storedQuery(t, { obligation: { limit: 500 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.map((row) => row.title).filter((title) => /failed/i.test(title))
		)
	);
/** A change of terms from the first of a month: the group that pays the person, or none (their group taken away). */
const moveTo = (t: Kit, from: string, group: Id<'pay_group'> | null) =>
	t.as(t.admin).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'contract_terms.create': [
					{
						employment_id: FIRST,
						effective_from: from,
						...(group === null ? { clears: ['pay_group_id'] } : { pay_group_id: group })
					}
				]
			})
		)
	);
/** The terms rows dated a day. */
const termsFrom = (t: Kit, from: string) =>
	storedQuery(t, { contract_terms: { where: { effective_from: { eq: from } }, limit: 10 } }).pipe(
		Effect.map(({ contract_terms }) => contract_terms.rows)
	);
/** A stint given its last day. */
const end = (t: Kit, stint: Id<'employment'>, to: string) => endStint(t, to, undefined, stint);

describe('a run pays one pay group', () => {
	it.live('only the people in it, and the other group’s same period still runs', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			assert.deepEqual(yield* paidBy(t, A, '2026-02'), [FIRST]);
			assert.equal((yield* slips(t)).length, 1);
			yield* run(t, B, '2026-02');
			assert.deepEqual(yield* paidBy(t, B, '2026-02'), [SECOND]);
			// one payslip a person for the month, and no effect of the second run tripped over the first's
			assert.equal((yield* slips(t)).length, 2);
			assert.deepEqual(yield* failures(t), []);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	it.live('with two groups and none named it is refused, and naming one is the way out', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.equal(
				keyOf(yield* Effect.flip(run(t, null, '2026-02'))),
				'errors.payroll_run_choose_group'
			);
			assert.equal((yield* runs(t)).length, 0);
			yield* run(t, A, '2026-02');
			assert.equal((yield* runs(t))[0]?.pay_group_id, A);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	it.live('a group of another company is refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.equal(
				keyOf(yield* Effect.flip(run(t, SISTER_GROUP, '2026-02'))),
				'errors.payroll_run_group_other_company'
			);
			assert.equal((yield* runs(t)).length, 0);
		}).pipe(Effect.provide(workspace({ seed: withSister(twoGroups()), now: NOW })))
	);

	it.live('the same group and period twice: the second is refused and moves nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			const posted = (yield* ledgerRows(t)).length;
			assert.ok(posted > 0);
			assert.match(String(yield* Effect.flip(run(t, A, '2026-02'))), /already has this/);
			assert.equal((yield* runs(t)).length, 1);
			assert.equal((yield* slips(t)).length, 1);
			assert.equal((yield* ledgerRows(t)).length, posted);
			// the refusal wedged nothing: the other payroll of the month still runs
			yield* run(t, B, '2026-02');
			assert.deepEqual(yield* paidBy(t, B, '2026-02'), [SECOND]);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	it.live('“a later cycle has run” is each group’s own order', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			// B never ran February, so its January is not behind anything
			yield* run(t, B, '2026-01');
			assert.deepEqual(yield* paidBy(t, B, '2026-01'), [SECOND]);
			assert.match(
				String(yield* Effect.flip(run(t, A, '2026-01'))),
				/2026-02 has already run, so 2026-01 cannot run after it/
			);
			assert.equal((yield* runs(t)).length, 2);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);
});

describe('two schedules in one company', () => {
	it.live('each group runs its own cycles, with its own coverage and pay date', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			// a cycle is a cycle of the group named, not of the company
			assert.match(
				String(yield* Effect.flip(run(t, B, '2026-02'))),
				/2026-02 is not a pay cycle of Executives/
			);
			assert.match(
				String(yield* Effect.flip(run(t, A, '2026-02-1'))),
				/2026-02-1 is not a pay cycle of Monthly/
			);
			yield* run(t, A, '2026-02');
			yield* run(t, B, '2026-02-1');
			yield* run(t, B, '2026-02-2');
			const ran = yield* runs(t);
			assert.deepEqual(
				ran.map((row) => ({
					group: row.pay_group_id,
					period: row.period,
					from: String(row.salary_coverage.from),
					to: String(row.salary_coverage.to),
					pay_date: String(row.pay_date)
				})),
				[
					{ group: A, period: '2026-02', schedule: MONTHLY },
					{ group: B, period: '2026-02-1', schedule: SEMI_MONTHLY },
					{ group: B, period: '2026-02-2', schedule: SEMI_MONTHLY }
				].map(({ group, period, schedule }) => ({
					group,
					period,
					from: cycleOf(schedule, period)?.from,
					to: cycleOf(schedule, period)?.to,
					pay_date: String(payDateOf(schedule, period))
				}))
			);
			assert.deepEqual(yield* paidBy(t, A, '2026-02'), [FIRST]);
			assert.deepEqual(yield* paidBy(t, B, '2026-02-1'), [SECOND]);
			assert.deepEqual(yield* paidBy(t, B, '2026-02-2'), [SECOND]);
			assert.deepEqual(yield* failures(t), []);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(SEMI_MONTHLY), now: NOW })))
	);

	// Break-it: HR changes a payroll's frequency after it has paid a month. The new schedule's cycle keys are new, so
	// neither the one-run-a-period rule nor “a later cycle has run” (`payroll_run` create, `entry.period > row.period`)
	// sees that the month's days are already paid.
	it.live('a group rescheduled after it ran cannot pay the same days again', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			const rescheduled = yield* Effect.result(
				Effect.all([t.as(t.admin), current(t, 'pay_group', A)]).pipe(
					Effect.flatMap(([caller, target]) =>
						caller.act({
							'pay_group.update': [
								{
									target,
									set: {
										payment_schedule: {
											...SEMI_MONTHLY,
											frequency: 'SEMI_MONTHLY',
											business_day: 'PREVIOUS',
											short_month: 'LAST_DAY'
										}
									}
								}
							]
						})
					)
				)
			);
			const again = yield* Effect.result(run(t, A, '2026-02-1'));
			const covering = (yield* runs(t)).filter(
				(row) => row.pay_group_id === A && String(row.salary_coverage.from) === '2026-02-01'
			);
			assert.equal(
				covering.length,
				1,
				`1–15 February was paid again: reschedule ${rescheduled._tag}, second run ${again._tag}`
			);
			assert.equal((yield* slips(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	it.live('a group with a paid run keeps its schedule; its name and pay day still change', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			const [ran] = yield* runs(t);
			assert.ok(ran !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: ran, set: { state: 'PAID' } }]
			});
			yield* t.run_due();
			const refused = yield* Effect.flip(
				Effect.all([t.as(t.admin), current(t, 'pay_group', A)]).pipe(
					Effect.flatMap(([caller, target]) =>
						caller.act({
							'pay_group.update': [
								{
									target,
									set: {
										payment_schedule: {
											...SEMI_MONTHLY,
											frequency: 'SEMI_MONTHLY',
											business_day: 'PREVIOUS',
											short_month: 'LAST_DAY'
										}
									}
								}
							]
						})
					)
				)
			);
			assert.equal(keyOf(refused), 'errors.pay_group_paid_schedule');
			yield* (yield* t.as(t.admin)).act({
				'pay_group.update': [
					{
						target: yield* current(t, 'pay_group', A),
						set: {
							name: 'Monthly staff',
							payment_schedule: {
								...MONTHLY,
								frequency: 'MONTHLY',
								business_day: 'PREVIOUS',
								short_month: 'LAST_DAY',
								pay_days: [28]
							}
						}
					}
				]
			});
			const { pay_group } = yield* storedQuery(t, {
				pay_group: { where: { id: { eq: A } }, limit: 1 }
			});
			assert.equal(pay_group.rows[0]?.name, 'Monthly staff');
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);
});

describe('a person’s terms and their pay group', () => {
	it.live('cannot name a group of another company', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(moveTo(t, '2026-04-01', SISTER_GROUP));
			assert.equal(keyOf(refused), 'errors.contract_terms_pay_group_other_company');
			assert.deepEqual(yield* termsFrom(t, '2026-04-01'), []);
		}).pipe(Effect.provide(workspace({ seed: withSister(twoGroups()), now: NOW })))
	);

	it.live('a change may not leave the person in no group; naming one moves them', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.equal(
				keyOf(yield* Effect.flip(moveTo(t, '2026-04-01', null))),
				'errors.contract_terms_choose_pay_group'
			);
			assert.deepEqual(yield* termsFrom(t, '2026-04-01'), []);
			// the way out the refusal names
			yield* moveTo(t, '2026-04-01', B);
			assert.deepEqual(
				(yield* termsFrom(t, '2026-04-01')).map((row) => row.pay_group_id),
				[B]
			);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	it.live('an unpaid run holds its own people: A’s run holds A’s people, not B’s', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			assert.match(String(yield* Effect.flip(end(t, FIRST, '2026-02-13'))), HELD);
			// B has not run February: its person's stint may still end inside it
			yield* end(t, SECOND, '2026-02-13');
			yield* run(t, B, '2026-02');
			assert.deepEqual(yield* paidBy(t, B, '2026-02'), [SECOND]);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	// Break-it: is the person paid twice, or never?
	it.live('moved to B after A ran the month: refused inside it, and paid once a month after', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			// the month A's unpaid run priced cannot move to B under it
			assert.match(String(yield* Effect.flip(moveTo(t, '2026-02-01', B))), HELD);
			assert.deepEqual(yield* termsFrom(t, '2026-02-01'), []);
			yield* run(t, B, '2026-02');
			assert.deepEqual(yield* paidBy(t, B, '2026-02'), [SECOND]);
			// the way out: the move starts the first month neither payroll has paid them
			yield* moveTo(t, '2026-03-01', B);
			yield* t.run_due();
			yield* run(t, B, '2026-03');
			assert.deepEqual(yield* paidBy(t, B, '2026-03'), [FIRST, SECOND].sort());
			const periodOf = new Map((yield* runs(t)).map((row) => [row.id, row.period]));
			const theirs = (yield* slips(t))
				.filter((slip) => slip.employee_id === uuid(4))
				.map((slip) => periodOf.get(slip.payroll_run_id))
				.sort();
			assert.deepEqual(theirs, ['2026-02', '2026-03']);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);
});

describe('an off-cycle run and the pay groups', () => {
	const seed = twoGroups();
	const offCycle = (t: Kit, group: Id<'pay_group'>, entry: Id<'adhoc_catalog_entry'>) =>
		Effect.all([t.as(t.admin), current(t, 'adhoc_catalog_entry', entry)])
			.pipe(
				Effect.flatMap(([caller, adhoc]) =>
					caller.act({
						'payroll_run.create': [
							{
								entity_id: ENTITY,
								pay_group_id: group,
								period: '2026-02',
								kind: 'OFF_CYCLE',
								adhoc: [adhoc]
							}
						]
					})
				)
			)
			.pipe(Effect.andThen(t.run_due()));
	const bonuses = (t: Kit) =>
		slips(t).pipe(
			Effect.map((rows) =>
				rows.flatMap((slip) =>
					Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown)
						.lines.filter((line) => line.code === 'BONUS')
						.map(() => slip.employment_id)
				)
			)
		);

	// Break-it: the entry is of a person the named group does not pay.
	it.live(
		'naming an entry of a person in the other group is refused; their group pays it once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* (yield* t.as(t.admin)).act({
					'adhoc_catalog_entry.create': [
						{
							entity_id: ENTITY,
							employment_id: SECOND,
							catalog_code: 'BONUS',
							description: 'Bonus',
							quantity: '500',
							incurred_on: '2026-02-10'
						}
					]
				});
				const [entry] = (yield* storedQuery(t, { adhoc_catalog_entry: { limit: 1 } }))
					.adhoc_catalog_entry.rows;
				assert.ok(entry !== undefined);
				const refused = yield* Effect.flip(offCycle(t, A, entry.id));
				assert.equal((yield* runs(t)).length, 0);
				const [waiting] = (yield* storedQuery(t, { adhoc_catalog_entry: { limit: 1 } }))
					.adhoc_catalog_entry.rows;
				assert.equal(waiting?.payroll_run_id, null);
				// the way out: the run of the group that pays them
				yield* offCycle(t, B, entry.id);
				assert.deepEqual(yield* bonuses(t), [SECOND]);
				// the person is employed all month, so “not employed in its period … their last day” would send HR nowhere
				assert.match(String(refused), /pay group/i);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })))
	);
});
