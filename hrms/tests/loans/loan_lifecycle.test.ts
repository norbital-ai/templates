// A loan and its repayments are their own record: a run deducts the instalment its attendance holds and seals it, one
// a paid run took is corrected where it was recorded, and the ledger never moves. Synthetic: one loan on a catalog row
// of the law in force; no rate or amount of that law is under test.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import {
	buildLoanSchedule,
	FINAL_SETTLEMENT,
	loanRecovery
} from '../../src/lib/payroll_engine/loan_schedule.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { pay, run } from '../amendment_kit.ts';
import {
	ENTITY,
	accountsIn,
	lawAt,
	lawWith,
	ledgerRows,
	pack,
	syncAll,
	uuid,
	workspace,
	storedQuery,
	current,
	decimalNumber,
	packTerms,
	endStint
} from '../kit.ts';

const NOW = '2026-08-20T02:00:00.000Z';
const EMPLOYMENT = idOf('employment', uuid(6));
const LOAN = idOf('loan_catalog_entry', uuid(300));
const FLOOR = 40;
const FESTIVE = 'LOAN_RECOVERY_FESTIVE_ADVANCE';
// no leave row pays out, so an exit here raises no cash-out request for a run to wait on
const base = lawWith(
	pack('MY', 'Asia/Kuala_Lumpur', packTerms(3120, 'MANUAL_LABOUR'), {}, [], []),
	{
		leave_catalog: Object.fromEntries(
			lawAt('MY', '2026-08-15').rows.leave_catalog.map((row) => [
				String(row.code),
				{ payout: null }
			])
		)
	}
);
/** One loan of `principal`, to be repaid August to November. */
const lent = (principal: number): ReturnType<typeof pack> => ({
	...base,
	entity_change: (base.entity_change ?? []).map((row) => ({
		...row,
		final_pay_loan_floor_percent: FLOOR
	})),
	loan_catalog_entry: [
		{
			id: LOAN,
			entity_id: ENTITY,
			employment_id: uuid(6),
			catalog_code: FESTIVE,
			quantity: principal,
			repayment_period: { from: '2026-08-01', to: '2026-11-30' }
		}
	]
});
const seed = lent(6000);
type Repayment = Id<'loan_catalog_entry_repayment'>;
const refused = (effect: Effect.Effect<unknown, unknown>) =>
	Effect.flip(effect).pipe(Effect.map(String));
/** An instalment on a date. */
const repay = (t: Kit, amount: number, date: string) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({
			'loan_catalog_entry_repayment.create': [
				{
					entity_id: ENTITY,
					employment_id: EMPLOYMENT,
					loan_id: LOAN,
					amount: String(amount),
					paid_on: date
				}
			]
		})
	).pipe(Effect.andThen(t.run_due()));
const change = (t: Kit, id: Repayment, amount: number) =>
	Effect.gen(function* () {
		const target = yield* current(t, 'loan_catalog_entry_repayment', id);
		return yield* (yield* t.as(t.admin)).act({
			'loan_catalog_entry_repayment.update': [{ target, set: { amount: String(amount) } }]
		});
	});
const remove = (t: Kit, id: Repayment) =>
	Effect.gen(function* () {
		const target = yield* current(t, 'loan_catalog_entry_repayment', id);
		return yield* (yield* t.as(t.admin)).act({
			'loan_catalog_entry_repayment.delete': [{ target }]
		});
	});
/** The open amendment rows' periods. */
const amended = (t: Kit) =>
	storedQuery(t, {
		pay_amendment: { where: { payroll_run_id: { is_null: true } }, limit: 100 }
	}).pipe(Effect.map(({ pay_amendment }) => pay_amendment.rows.map((row) => row.period)));
const HELD = /Run \d+ holds this person and is not paid yet/;

describe('a loan and its schedule', () => {
	it.live('are one write: the loan arrives with its instalments', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const instalment = (paid_on: string) => ({
				entity_id: ENTITY,
				employment_id: EMPLOYMENT,
				amount: '500',
				paid_on
			});
			yield* (yield* t.as(t.admin)).act({
				'loan_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: EMPLOYMENT,
						catalog_code: FESTIVE,
						quantity: '1000',
						repayment_period: { from: '2026-09-01', to: '2026-10-31' },
						repayments: [instalment('2026-09-01'), instalment('2026-10-01')]
					}
				]
			});
			const { loan_catalog_entry_repayment } = yield* storedQuery(t, {
				loan_catalog_entry_repayment: { where: { loan_id: { ne: LOAN } }, limit: 10 }
			});
			assert.deepEqual(
				loan_catalog_entry_repayment.rows.map((row) => String(row.paid_on)).toSorted(),
				['2026-09-01', '2026-10-01']
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
const repayments = (t: Kit) =>
	storedQuery(t, { loan_catalog_entry_repayment: { limit: 100 } }).pipe(
		Effect.map(({ loan_catalog_entry_repayment }) =>
			loan_catalog_entry_repayment.rows.toSorted((left, right) =>
				String(left.paid_on).localeCompare(String(right.paid_on))
			)
		)
	);
const slips = (t: Kit) =>
	storedQuery(t, { payslip: { limit: 100 } }).pipe(
		Effect.map(({ payslip }) =>
			payslip.rows.toSorted((left, right) =>
				String(left.period).localeCompare(String(right.period))
			)
		)
	);
/** Every loan line on a payslip, in period order: `[period, direction, amount]`. */
const moved = (t: Kit) =>
	slips(t).pipe(
		Effect.map((rows) =>
			rows.flatMap((slip) =>
				Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown)
					.lines.filter((line) => line.source === 'loan_catalog_entry_repayment')
					.map((line) => [slip.period, line.direction, line.amount])
			)
		)
	);

describe('a loan repayment', () => {
	it.live(
		'an unpaid run took is held under that run; the run paid, it is changed where it was recorded and its period is amended; an open one still moves',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* repay(t, 100, '2026-08-10');
				yield* repay(t, 100, '2026-09-10');
				yield* run(t, '2026-08');
				const first = [['2026-08', 'DEDUCT', 100]];
				assert.deepEqual(yield* moved(t), first);
				const [august, september] = yield* repayments(t);
				assert.ok(august !== undefined && september !== undefined);
				assert.ok(august.payroll_run_id != null);
				assert.equal(september.payroll_run_id, null);
				assert.match(yield* refused(change(t, august.id, 50)), HELD);
				assert.match(yield* refused(remove(t, august.id)), HELD);
				const [only] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
				assert.ok(only !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.update': [{ target: only, set: { state: 'PAID' } }]
				});
				yield* t.run_due();
				// paid, the instalment is corrected itself: August is to be worked out again, and its payslip stands
				yield* change(t, august.id, 50);
				assert.equal(decimalNumber((yield* repayments(t))[0]?.amount), 50);
				assert.deepEqual(yield* amended(t), ['2026-08']);
				assert.deepEqual(yield* moved(t), first);
				// September's is still HR's to change, and its run takes what it now says and the row August left
				yield* change(t, september.id, 250);
				assert.deepEqual(yield* amended(t), ['2026-08']);
				yield* run(t, '2026-09');
				assert.deepEqual(yield* amended(t), []);
				assert.deepEqual((yield* moved(t)).slice(0, 1), first);
				assert.ok(
					(yield* moved(t)).some(
						([period, direction, amount]) =>
							period === '2026-09' && direction === 'DEDUCT' && amount === 250
					)
				);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'a paid run took, deleted: its period is amended once, and the ledger never moves for a loan',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const entitlements = (yield* ledgerRows(t)).filter((row) =>
					['leave', 'claim'].includes(String(row.account))
				).length;
				yield* repay(t, 100, '2026-08-10');
				yield* pay(t, '2026-08');
				const [original] = yield* repayments(t);
				assert.ok(original !== undefined && original.payroll_run_id != null);
				yield* remove(t, original.id);
				assert.deepEqual(yield* repayments(t), []);
				assert.deepEqual(yield* amended(t), ['2026-08']);
				// the paid payslip stands; the next run takes the row
				assert.deepEqual(yield* moved(t), [['2026-08', 'DEDUCT', 100]]);
				yield* run(t, '2026-09');
				assert.deepEqual(yield* amended(t), []);
				assert.deepEqual(yield* moved(t), [
					['2026-08', 'DEDUCT', 100],
					['2026-09', 'ADD', 100]
				]);
				// loans stay out of the ledger: no row is theirs, no leave or claim row was written, no balance family
				const rows = yield* ledgerRows(t);
				assert.deepEqual(
					rows.filter((row) => String(row.source).startsWith('loan_catalog')),
					[]
				);
				assert.equal(
					rows.filter((row) => ['leave', 'claim'].includes(String(row.account))).length,
					entitlements
				);
				assert.deepEqual(
					Object.keys(yield* accountsIn(t)).filter((family) => family.includes('loan')),
					[]
				);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'dated under an unpaid run is refused; the run paid, it is dated in that period and leaves its amendment row',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, '2026-08');
				assert.match(yield* refused(repay(t, 100, '2026-08-10')), HELD);
				assert.deepEqual(yield* repayments(t), []);
				// an open instalment cannot be moved back under it either
				yield* repay(t, 100, '2026-09-10');
				const [open] = yield* repayments(t);
				assert.ok(open !== undefined);
				assert.match(
					yield* refused(
						Effect.flatMap(t.as(t.admin), (caller) =>
							caller.act({
								'loan_catalog_entry_repayment.update': [
									{ target: open, set: { paid_on: '2026-08-10' } }
								]
							})
						)
					),
					HELD
				);
				const [only] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
				assert.ok(only !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.update': [{ target: only, set: { state: 'PAID' } }]
				});
				yield* t.run_due();
				assert.deepEqual(yield* amended(t), []);
				yield* repay(t, 100, '2026-08-10');
				assert.equal((yield* repayments(t)).length, 2);
				assert.deepEqual(yield* amended(t), ['2026-08']);
				// September's run takes its own instalment and the row August left
				yield* run(t, '2026-09');
				assert.deepEqual(yield* amended(t), []);
				assert.ok(
					(yield* moved(t)).some(
						([period, direction, amount]) =>
							period === '2026-09' && direction === 'DEDUCT' && amount === 100
					)
				);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a loan', () => {
	it.live('with a repayment a run has taken cannot be deleted, and stays whole', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* repay(t, 100, '2026-08-10');
			yield* repay(t, 100, '2026-09-10');
			yield* run(t, '2026-08');
			const drop = Effect.gen(function* () {
				return yield* (yield* t.as(t.admin)).act({
					'loan_catalog_entry.delete': [{ target: yield* current(t, 'loan_catalog_entry', LOAN) }]
				});
			});
			assert.match(yield* refused(drop), /still refer|locked/);
			// clearing the open schedule does not free it: what a run took keeps its loan
			const [, open] = yield* repayments(t);
			assert.ok(open !== undefined);
			yield* remove(t, open.id);
			assert.match(yield* refused(drop), /still refer|locked/);
			assert.equal(
				(yield* storedQuery(t, { loan_catalog_entry: { limit: 10 } })).loan_catalog_entry.rows
					.length,
				1
			);
			assert.equal((yield* repayments(t)).length, 1);
			// the principal cannot be cut under what payroll has already taken
			assert.match(
				yield* refused(
					Effect.gen(function* () {
						return yield* (yield* t.as(t.admin)).act({
							'loan_catalog_entry.update': [
								{ target: yield* current(t, 'loan_catalog_entry', LOAN), set: { quantity: '50' } }
							]
						});
					})
				),
				/cannot be less than repayments already included in payroll/
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('never run through payroll is deleted once its open schedule is cleared', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* repay(t, 100, '2026-08-10');
			const drop = Effect.gen(function* () {
				return yield* (yield* t.as(t.admin)).act({
					'loan_catalog_entry.delete': [{ target: yield* current(t, 'loan_catalog_entry', LOAN) }]
				});
			});
			assert.match(yield* refused(drop), /still refer/);
			const [open] = yield* repayments(t);
			assert.ok(open !== undefined);
			yield* remove(t, open.id);
			yield* drop;
			yield* run(t, '2026-08');
			assert.deepEqual(yield* moved(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'recovery that would take net pay below zero refuses the run and says how; reduced, it runs',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* repay(t, 999_999, '2026-08-10');
				assert.match(
					yield* refused(run(t, '2026-08')),
					/loan recovery would leave net pay at -[\d.]+; reduce the final repayment/
				);
				// the refused run left nothing behind
				assert.deepEqual(
					(yield* storedQuery(t, { payroll_run: { limit: 10 } })).payroll_run.rows,
					[]
				);
				const [open] = yield* repayments(t);
				assert.ok(open !== undefined);
				assert.equal(open.payroll_run_id, null);
				// the way out it names: the instalment reduced, the same run goes through
				yield* change(t, open.id, 100);
				yield* run(t, '2026-08');
				assert.deepEqual(yield* moved(t), [['2026-08', 'DEDUCT', 100]]);
				const [slip] = yield* slips(t);
				assert.ok((decimalNumber(slip?.net_pay) ?? 0) > 0);
			}).pipe(Effect.provide(workspace({ seed: lent(1_000_000), now: NOW })))
	);
});

// Ending a stint settles a leaver's loans (`recoverLoans`, src/lib/ui/person/stint_end.svelte): final pay
// repays what `loanRecovery` allows under the entity's floor, the rest goes on a new schedule after the last day, and
// HR gets one task. The page is not reachable from here, so the test sends the same acts in the same order. The exit
// cancelled, the routine that follows it (docs/0007 §4) waives the task and puts an unpaid final settlement back on
// monthly instalments; one a paid run took stands.
describe('a leaver’s loan', () => {
	const LAST = '2026-09-30';
	const ends = (t: Kit, to: string | null) =>
		endStint(t, to, to === null ? 'Ended in error' : 'Resignation').pipe(
			Effect.andThen(t.run_due())
		);
	const task = (plan: { readonly remaining: number }) => ({
		entity_id: ENTITY,
		employee_id: idOf('employee_profile', uuid(4)),
		employment_id: EMPLOYMENT,
		title: `Recover ${plan.remaining} from W1`,
		due_on: '2026-10-01',
		occurrence_key: `LOAN_RECOVERY:${EMPLOYMENT}:exit:${LAST}`
	});
	const tasks = (t: Kit) =>
		storedQuery(t, { obligation: { limit: 200 } }).pipe(
			Effect.map(({ obligation }) =>
				obligation.rows
					.filter((row) => row.occurrence_key.startsWith('LOAN_RECOVERY:'))
					.map((row) => [row.state, String(row.due_on)])
			)
		);
	/** The loan scheduled and one month run, the stint ended, and the page's settlement of what is outstanding. */
	const settled = (t: Kit) =>
		Effect.gen(function* () {
			const admin = yield* t.as(t.admin);
			// the schedule as the loan form builds it, and one month of payroll behind it
			for (const row of buildLoanSchedule({
				principal: 6000,
				from: '2026-08-01',
				to: '2026-11-30',
				repayments: []
			}).create)
				yield* repay(t, row.amount, row.paid_on);
			yield* run(t, '2026-08');
			const [august] = yield* slips(t);
			assert.ok(august !== undefined);
			yield* ends(t, LAST);
			const held = yield* repayments(t);
			const outstanding =
				6000 -
				held
					.filter((row) => row.payroll_run_id != null)
					.reduce((sum, row) => sum + (decimalNumber(row.amount) ?? 0), 0);
			const [change] = (yield* storedQuery(t, { entity_change: { limit: 1 } })).entity_change.rows;
			assert.equal(change?.final_pay_loan_floor_percent, FLOOR);
			const plan = loanRecovery({
				loans: [{ id: LOAN, outstanding }],
				expectedPay: Number(august.net_pay),
				floorPercent: FLOOR,
				decimals: 2
			});
			// the fixture is a partial recovery: pay cannot cover the loan
			assert.ok(plan.proposed > 0 && plan.remaining > 0);
			yield* admin.act({
				'loan_catalog_entry_repayment.delete': held
					.filter((row) => row.payroll_run_id == null)
					.map((row) => ({ target: row }))
			});
			yield* admin.act({
				'loan_catalog_entry_repayment.create': [
					{
						entity_id: ENTITY,
						employment_id: EMPLOYMENT,
						loan_id: LOAN,
						amount: String(plan.proposed),
						paid_on: LAST,
						payment_reference: `${FINAL_SETTLEMENT} (partial)`
					}
				]
			});
			yield* admin.act({
				'loan_catalog_entry.update': [
					{
						target: yield* current(t, 'loan_catalog_entry', LOAN),
						set: {
							repayment_period: { from: '2026-10-01', to: '2026-11-30' }
						}
					}
				]
			});
			for (const row of buildLoanSchedule({
				principal: plan.remaining,
				from: '2026-10-01',
				to: '2026-11-30',
				repayments: []
			}).create)
				yield* repay(t, row.amount, row.paid_on);
			yield* admin.act({ 'obligation.create': [task(plan)] });
			return plan;
		});
	const open = (t: Kit) =>
		repayments(t).pipe(Effect.map((rows) => rows.filter((row) => row.payroll_run_id == null)));
	const cents = (rows: Effect.Success<ReturnType<typeof repayments>>) =>
		Math.round(rows.reduce((sum, row) => sum + (decimalNumber(row.amount) ?? 0), 0) * 100);

	it.live(
		'is recovered up to the floor in the final run; the rest is rescheduled, with one task',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const plan = yield* settled(t);
				// settled twice, the task is still one
				assert.match(
					yield* refused(
						Effect.flatMap(t.as(t.admin), (caller) =>
							caller.act({ 'obligation.create': [task(plan)] })
						)
					),
					/already/
				);
				yield* run(t, '2026-09');
				// the final run takes exactly what the floor allowed, and leaves pay standing
				const [, final] = yield* slips(t);
				assert.deepEqual((yield* moved(t)).at(-1), ['2026-09', 'DEDUCT', plan.proposed]);
				assert.ok((decimalNumber(final?.net_pay) ?? 0) > 0);
				// what is left is open, after the last day, and adds up to the remainder
				const left = yield* open(t);
				assert.ok(left.length > 0 && left.every((row) => String(row.paid_on) > LAST));
				assert.equal(cents(left), Math.round(plan.remaining * 100));
				assert.deepEqual(yield* tasks(t), [['OPEN', '2026-10-01']]);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'whose exit is cancelled before the final run: the task is waived and the unpaid final settlement goes back to monthly instalments, once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* settled(t);
				const taken = (yield* repayments(t)).filter((row) => row.payroll_run_id != null);
				yield* ends(t, null);
				assert.deepEqual(yield* tasks(t), [['WAIVED', '2026-10-01']]);
				// no lump is left for the next run: what no run took is spread over the loan's remaining months
				const spread = yield* open(t);
				assert.deepEqual(
					spread.map((row) => String(row.paid_on)),
					['2026-10-01', '2026-11-01']
				);
				assert.ok(spread.every((row) => row.payment_reference == null));
				assert.equal(cents(spread) + cents(taken), 6000 * 100);
				assert.equal(new Set(spread.map((row) => decimalNumber(row.amount))).size, 1);
				// what a run had taken is as it was, and settling what is due changes nothing
				yield* t.run_due();
				assert.deepEqual(
					(yield* open(t)).map((row) => row.id),
					spread.map((row) => row.id)
				);
				assert.deepEqual(
					(yield* repayments(t)).filter((row) => row.payroll_run_id != null),
					taken
				);
				// the month of the mistaken last day takes no loan line; the next takes its instalment
				yield* run(t, '2026-09');
				yield* run(t, '2026-10');
				assert.deepEqual((yield* moved(t)).slice(1), [
					['2026-10', 'DEDUCT', decimalNumber(spread[0]?.amount)]
				]);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'whose exit is cancelled after a paid final run: the paid settlement stands, the open schedule is untouched and the task is waived',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const plan = yield* settled(t);
				yield* run(t, '2026-09');
				const final = (yield* storedQuery(t, { payroll_run: { limit: 10 } })).payroll_run.rows.find(
					(row) => row.period === '2026-09'
				);
				assert.ok(final !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.update': [{ target: final, set: { state: 'PAID' } }]
				});
				yield* t.run_due();
				const before = yield* repayments(t);
				yield* ends(t, null);
				assert.deepEqual(yield* repayments(t), before);
				assert.deepEqual(yield* moved(t), [
					['2026-08', 'DEDUCT', 1500],
					['2026-09', 'DEDUCT', plan.proposed]
				]);
				assert.equal(cents(yield* open(t)), Math.round(plan.remaining * 100));
				assert.deepEqual(yield* tasks(t), [['WAIVED', '2026-10-01']]);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a loan row with an eligibility rule', () => {
	// synthetic: the row of the law in force is given a rule of this test's own, that a loan is repaid within 2026
	const gated = lawWith(seed, {
		loan_catalog: {
			[FESTIVE]: { eligibility: "return ctx.entry.repayment_period.to <= '2026-12-31';" }
		}
	});
	const lend = (t: Kit, to: string) =>
		Effect.flatMap(t.as(t.admin), (caller) =>
			caller.act({
				'loan_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: EMPLOYMENT,
						catalog_code: FESTIVE,
						quantity: '1000',
						repayment_period: { from: '2026-09-01', to }
					}
				]
			})
		);
	const loans = (t: Kit) =>
		storedQuery(t, { loan_catalog_entry: { limit: 10 } }).pipe(
			Effect.map(({ loan_catalog_entry }) =>
				loan_catalog_entry.rows.map((row) => [row.id, String(row.repayment_period.to)])
			)
		);
	const NO =
		/W1: LOAN_RECOVERY_FESTIVE_ADVANCE.* is not allowed here: its eligibility rule says no/;

	it.live(
		'is refused where the rule says no, naming the person and the row; corrected as the refusal says, it saves, and an edit cannot break the rule either',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const before = yield* loans(t);
				assert.match(yield* refused(lend(t, '2027-03-31')), NO);
				assert.deepEqual(yield* loans(t), before);
				// the way out the refusal names: correct the entry, then save again
				yield* lend(t, '2026-12-31');
				const after = yield* loans(t);
				assert.equal(after.length, before.length + 1);
				assert.match(
					yield* refused(
						Effect.gen(function* () {
							return yield* (yield* t.as(t.admin)).act({
								'loan_catalog_entry.update': [
									{
										target: yield* current(t, 'loan_catalog_entry', LOAN),
										set: {
											repayment_period: {
												from: '2026-08-01',
												to: '2027-01-31'
											}
										}
									}
								]
							});
						})
					),
					NO
				);
				assert.deepEqual(yield* loans(t), after);
			}).pipe(Effect.provide(workspace({ seed: gated, now: NOW })))
	);
});
