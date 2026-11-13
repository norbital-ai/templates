// An exit settles its leave on the payslip that covers the last day. Nothing is keyed and nothing waits for anyone:
// what is left of a row with a payout is paid out unless HR declined it on the stint, and leave taken beyond what
// the last day earned is taken back at the same rate. HR changes its mind where the fact stands (the decision, the
// last day, the exit itself), and a period already paid is carried right by the next run. The Malaysian pack is only
// the fixture; the figures are the pack's own.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { verify } from '../../src/lib/integrity.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { amendments, carriedFor, cents, pay, run, signed, slip } from '../amendment_kit.ts';
import {
	ENTITY,
	PAY_GROUP,
	accountsIn,
	measureOf,
	pack,
	syncAll,
	uuid,
	workspace,
	storedQuery,
	current,
	storedReader,
	keyOf
} from '../kit.ts';

const NOW = '2026-10-20T02:00:00.000Z';
const LEAVE = 'ANNUAL_LEAVE';
const EMPLOYMENT = idOf('employment', uuid(6));
const BALANCE = idOf('employee_balance', uuid(5));
const seed = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: 3120, unit: 'MONTHLY' },
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[]
);
/** What is left of the annual leave the person holds. */
const left = (t: Kit) =>
	accountsIn(t).pipe(
		Effect.map(
			(accounts) =>
				measureOf(accounts, 'leave', LEAVE, 'entitled') -
				measureOf(accounts, 'leave', LEAVE, 'used')
		)
	);
/** The stint as HR ends it, or changes what it said when it ended it. */
const ended = (
	t: Kit,
	set: { readonly to?: string | null; readonly [answer: string]: unknown }
) => {
	const { to, ...answers } = set;
	return Effect.all([t.as(t.admin), current(t, 'employment', EMPLOYMENT)])
		.pipe(
			Effect.flatMap(([caller, target]) =>
				caller.act({
					'employment.update': [
						{
							target,
							set: {
								...(to === undefined
									? {}
									: {
											effective_range: {
												from: '2025-01-01',
												to: to === null ? null : to
											},
											reason: to === null ? 'Termination withdrawn' : 'Resignation'
										}),
								...answers
							}
						}
					]
				})
			)
		)
		.pipe(Effect.andThen(t.run_due()));
};
/** The leave line a payslip carries of its own, signed, and what it posts as days. */
const settled = (t: Kit, period: string) =>
	slip(t, period).pipe(
		Effect.map(({ breakdown }) => ({
			paid: cents(
				breakdown.lines
					.filter((line) => line.code === LEAVE && line.period === undefined)
					.reduce((total, line) => total + signed(line), 0)
			),
			days: (breakdown.cash_out ?? []).map((row) => [row.code, row.amount])
		}))
	);
const nothingKeyed = (t: Kit) =>
	storedQuery(t, { leave_catalog_entry: { limit: 10 }, approval_request: { limit: 10 } }).pipe(
		Effect.map((found) =>
			assert.deepEqual(
				[found.leave_catalog_entry.rows, found.approval_request.rows],
				[[], []],
				'no entry and no request stands for the exit'
			)
		)
	);
/** The person's waiting periods carried by an off-cycle run: the way someone no run pays any more is settled. */
const carriedOffCycle = (t: Kit) =>
	Effect.gen(function* () {
		const open = (yield* amendments(t)).filter((row) => row.payroll_run_id === null);
		return yield* (yield* t.as(t.admin)).act({
			'payroll_run.create': [
				{
					entity_id: ENTITY,
					period: '2026-11',
					kind: 'OFF_CYCLE',
					amendments: open.map(({ id, revision }) => ({ id, revision }))
				}
			]
		});
	});
/**
 * The ledger after every case: each balance figure is the sum of its ledger rows, every source still exists, and no
 * queued work failed. Only the watch for a balance below zero may remain.
 */
const ledgerWhole = Effect.gen(function* () {
	const t = yield* TestWorkspace;
	assert.deepEqual((yield* t.run_due()).failed, []);
	assert.deepEqual(
		(yield* verify(storedReader(t), t.clock.now().slice(0, 10)))
			.filter((finding) => finding.invariant !== 'W1')
			.map((finding) => `${finding.invariant} ${finding.message}`),
		[]
	);
});
const at = (effect: Effect.Effect<void, unknown, TestWorkspace>, now = NOW) =>
	effect.pipe(Effect.andThen(ledgerWhole), Effect.provide(workspace({ seed, now })));

describe('the leave an exit settles', () => {
	it.live('what is left is paid out on the last payslip, and the balance ends at nothing', () =>
		at(
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* ended(t, { to: '2026-10-31' });
				// the exit's own sync has prorated the year to the last day: that is what is left to settle
				const days = yield* left(t);
				assert.ok(days > 0);
				yield* nothingKeyed(t);
				yield* pay(t, '2026-10');
				const last = yield* settled(t, '2026-10');
				assert.ok(last.paid > 0);
				assert.deepEqual(last.days, [[LEAVE, days]]);
				assert.equal(yield* left(t), 0);
				yield* nothingKeyed(t);
			})
		)
	);

	it.live('declined by HR on the stint, or a dismissal for misconduct: nothing is paid out', () =>
		at(
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* ended(t, { to: '2026-10-31', encash_leave: false });
				const days = yield* left(t);
				const first = yield* run(t, '2026-10');
				assert.deepEqual(yield* settled(t, '2026-10'), { paid: 0, days: [] });
				assert.equal(yield* left(t), days);
				// the same exit as a dismissal for misconduct, with HR's switch back on
				yield* (yield* t.as(t.admin)).act({ 'payroll_run.delete': [{ target: first }] });
				yield* ended(t, { encash_leave: true, exit_ground: 'MISCONDUCT_DISMISSAL' });
				yield* run(t, '2026-10');
				assert.deepEqual(yield* settled(t, '2026-10'), { paid: 0, days: [] });
			})
		)
	);

	it.live('leave taken beyond what the last day earned is taken back, whatever HR decided', () =>
		at(
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				// HR's hand: what the year gave is cut until one day more was taken than earned
				yield* (yield* t.as(t.member(['hr_controller']))).act({
					'ledger_entry.create': [
						{
							balance_id: BALANCE,
							operation: 'DEDUCT',
							account: 'leave',
							code: LEAVE,
							measure: 'entitled',
							amount: String((yield* left(t)) + 1),
							unit: 'DAY',
							effective_on: '2026-10-02',
							note: 'earned to the last day'
						}
					]
				});
				assert.equal(yield* left(t), -1);
				yield* ended(t, { to: '2026-10-31', encash_leave: false });
				// the last day earns less of the year still
				const over = yield* left(t);
				assert.ok(over <= -1);
				yield* pay(t, '2026-10');
				const last = yield* settled(t, '2026-10');
				assert.ok(last.paid < 0, 'the leave pay is taken back');
				assert.deepEqual(last.days, [[LEAVE, over]]);
				assert.equal(yield* left(t), 0);
			})
		)
	);

	it.live(
		'the decision changed after the last payslip is paid: an off-cycle run carries what is owed',
		() =>
			at(
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* syncAll(t);
					const days = yield* left(t);
					yield* ended(t, { to: '2026-10-31', encash_leave: false });
					yield* pay(t, '2026-10');
					assert.deepEqual(yield* amendments(t), []);
					yield* ended(t, { encash_leave: true });
					assert.deepEqual(
						(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
						[['2026-10', null]]
					);
					yield* carriedOffCycle(t);
					yield* t.run_due();
					const owed = (yield* carriedFor(t, '2026-11', '2026-10'))[`${LEAVE}/EMPLOYEE`];
					assert.ok((owed ?? 0) > 0);
					assert.equal(yield* left(t), 0, `the ${String(days)} days are used now`);
					// and back again: what was paid would have to come back from someone no run pays, so it waits for HR
					const [offCycle] = (yield* storedQuery(t, {
						payroll_run: { where: { kind: { eq: 'OFF_CYCLE' } }, limit: 1 }
					})).payroll_run.rows;
					assert.ok(offCycle !== undefined);
					yield* (yield* t.as(t.admin)).act({
						'payroll_run.update': [{ target: offCycle, set: { state: 'PAID' } }]
					});
					yield* t.run_due();
					yield* ended(t, { encash_leave: false });
					assert.equal(
						keyOf(yield* Effect.flip(carriedOffCycle(t))),
						'errors.payroll_run_carry_takes_back'
					);
				}),
				'2026-11-20T02:00:00.000Z'
			)
	);

	it.live(
		'the exit cancelled after its last payslip is paid: the next run takes the pay-out back and the days return',
		() =>
			at(
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* syncAll(t);
					const days = yield* left(t);
					yield* ended(t, { to: '2026-10-31' });
					yield* pay(t, '2026-10');
					const last = yield* settled(t, '2026-10');
					assert.equal(yield* left(t), 0);
					yield* ended(t, { to: null });
					yield* run(t, '2026-11');
					assert.equal(
						(yield* carriedFor(t, '2026-11', '2026-10'))[`${LEAVE}/EMPLOYEE`],
						-last.paid
					);
					assert.equal(yield* left(t), days);
					// the paid payslip stands as it was
					assert.deepEqual(yield* settled(t, '2026-10'), last);
				}),
				'2026-11-20T02:00:00.000Z'
			)
	);

	it.live(
		'the exit cancelled by a stint from the next day, after the last payslip is paid: the same as cancelling it',
		() =>
			at(
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* syncAll(t);
					const days = yield* left(t);
					yield* ended(t, { to: '2026-10-31' });
					yield* pay(t, '2026-10');
					const last = yield* settled(t, '2026-10');
					assert.ok(last.paid > 0);
					// a stint from the next day continues the employment: the paid month-end is no exit any more
					const [stint] = (yield* storedQuery(t, { employment: { limit: 1 } })).employment.rows;
					assert.ok(stint !== undefined);
					yield* (yield* t.as(t.admin)).act({
						'employment.create': [
							{
								employee_id: stint.employee_id,
								entity_id: stint.entity_id,
								employee_number: stint.employee_number,
								service_started_on: '2025-01-01',
								effective_range: { from: '2026-11-01', to: null },
								reason: 'Rehired the next day',
								terms: [
									{
										effective_from: '2026-11-01',
										engagement: 'EMPLOYEE',
										pay_group_id: idOf('pay_group', PAY_GROUP),
										rate: { amount: 3120, unit: 'MONTHLY' },
										normal_hours_per_day: 8,
										normal_hours_per_week: 40,
										normal_days_per_week: 5,
										statutory_work_category: 'MANUAL_LABOUR',
										work_classification: 'EA_COVERED',
										wage_payment_method: 'BANK',
										allowances: {}
									}
								],
								parameters: [
									{
										effective_from: '2026-11-01',
										residency_status: 'CITIZEN',
										marital_status: 'SINGLE',
										parameters: {}
									}
								]
							}
						]
					});
					yield* t.run_due();
					assert.deepEqual(
						(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
						[['2026-10', null]]
					);
					yield* run(t, '2026-11');
					assert.equal(
						(yield* carriedFor(t, '2026-11', '2026-10'))[`${LEAVE}/EMPLOYEE`],
						-last.paid
					);
					assert.equal(yield* left(t), days);
					assert.deepEqual(yield* settled(t, '2026-10'), last);
				}),
				'2026-11-20T02:00:00.000Z'
			)
	);
});
