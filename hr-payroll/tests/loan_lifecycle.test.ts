// A loan and its repayments are their own record: a run deducts the instalment its attendance holds and seals it, a
// reversal entry refunds a sealed one in the next run, and the ledger never moves. Synthetic: one loan on a catalog row
// of the law in force; no rate or amount of that law is under test.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import {
	buildLoanSchedule,
	FINAL_SETTLEMENT,
	loanRecovery
} from '../src/lib/payroll_engine/loan_schedule.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	ledgerRows,
	pack,
	syncAll,
	uuid,
	workspace
} from './kit.ts';

const NOW = '2026-08-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const LOAN = idOf('loan_catalog_entry', uuid(300));
const FLOOR = 40;
const TERMS = {
	rate: { amount: 3120, unit: 'MONTHLY' },
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const base = pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], [], '2026-08-15');
/** One loan of `principal`, to be repaid August to November. */
const lent = (principal: number): ReturnType<typeof pack> => ({
	...base,
	// no leave row pays out, so an exit here raises no cash-out request for a run to wait on
	leave_catalog: (base.leave_catalog ?? []).map((row) =>
		Object.fromEntries(Object.entries(row).filter(([field]) => field !== 'payout'))
	),
	entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
		...row,
		final_pay_loan_floor_percent: FLOOR
	})),
	loan_catalog_entry: [
		{
			id: LOAN,
			entity_id: ENTITY,
			employment_id: uuid(6),
			catalog_id: catalogRow(base, 'loan_catalog', 'LOAN_RECOVERY_FESTIVE_ADVANCE'),
			quantity: principal,
			repayment_period: { from: '2026-08-01', to: '2026-11-30' }
		}
	]
});
const seed = lent(6000);
type Repayment = Id<'loan_catalog_entry_repayment'>;
const refused = (effect: Effect.Effect<unknown, unknown>) =>
	Effect.flip(effect).pipe(Effect.map(String));
/** An instalment on a date; with `reverses`, the reversal entry of a sealed one. */
const repay = (t: Kit, amount: number, date: string, reverses?: Repayment) =>
	t
		.as(t.admin)
		.act('loan_catalog_entry_repayment.create', [
			{
				entity_id: ENTITY,
				employment_id: CONTRACT,
				loan_id: LOAN,
				amount,
				paid_on: PlainDate(date),
				...(reverses === undefined ? {} : { reverses })
			}
		])
		.pipe(Effect.andThen(t.runDue()));
const change = (t: Kit, target: Repayment, amount: number) =>
	t.as(t.admin).act('loan_catalog_entry_repayment.update', [{ target, set: { amount } }]);
const remove = (t: Kit, target: Repayment) =>
	t.as(t.admin).act('loan_catalog_entry_repayment.delete', [{ target }]);
const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const repayments = (t: Kit) =>
	t
		.storedQuery({ loan_catalog_entry_repayment: { limit: 100 } })
		.pipe(
			Effect.map(({ loan_catalog_entry_repayment }) =>
				loan_catalog_entry_repayment.rows.toSorted((left, right) =>
					String(left.paid_on).localeCompare(String(right.paid_on))
				)
			)
		);
/** The one instalment a run has sealed. */
const taken = (t: Kit) =>
	repayments(t).pipe(
		Effect.map((rows) => {
			const row = rows.find((item) => item.payroll_run_id != null && item.reverses == null);
			if (row === undefined) throw new Error('No sealed instalment');
			return row;
		})
	);
const slips = (t: Kit) =>
	t
		.storedQuery({ payslip: { limit: 100 } })
		.pipe(
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
	it.live('a run has taken is locked to edits and deletes; an open one still moves', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* repay(t, 100, '2026-08-10');
			yield* repay(t, 100, '2026-09-10');
			yield* run(t, '2026-08');
			assert.deepEqual(yield* moved(t), [['2026-08', 'DEDUCT', 100]]);
			const [august, september] = yield* repayments(t);
			assert.ok(august !== undefined && september !== undefined);
			assert.ok(august.payroll_run_id != null);
			assert.equal(september.payroll_run_id, null);
			assert.match(yield* refused(change(t, august.id, 50)), /locked/);
			assert.match(yield* refused(remove(t, august.id)), /locked/);
			assert.equal((yield* taken(t)).amount?.toNumber(), 100);
			// September's is still HR's to change, and its run takes what it now says
			yield* change(t, september.id, 250);
			yield* run(t, '2026-09');
			assert.deepEqual(yield* moved(t), [
				['2026-08', 'DEDUCT', 100],
				['2026-09', 'DEDUCT', 250]
			]);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'reversed, is refunded by the next run, once, and the ledger never moves for a loan',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const entitlements = (yield* ledgerRows(t)).filter((row) =>
					['leave', 'claim'].includes(String(row.account))
				).length;
				yield* repay(t, 100, '2026-08-10');
				yield* run(t, '2026-08');
				const original = (yield* taken(t)).id;
				yield* repay(t, 100, '2026-09-07', original);
				// one reversal an instalment: a second is refused
				assert.match(yield* refused(repay(t, 100, '2026-09-08', original)), /already/);
				yield* run(t, '2026-09');
				const refunded = [
					['2026-08', 'DEDUCT', 100],
					['2026-09', 'ADD', 100]
				];
				assert.deepEqual(yield* moved(t), refunded);
				yield* run(t, '2026-10');
				assert.deepEqual(yield* moved(t), refunded);
				// paid, the reversal is sealed like the instalment it undid
				const reversal = (yield* repayments(t)).find((row) => row.reverses === original);
				assert.ok(reversal !== undefined && reversal.payroll_run_id != null);
				assert.match(yield* refused(remove(t, reversal.id)), /locked/);
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

	// section 0: "The next run repays it ...; HR does not pick the period"
	it.live('reversed on the instalment’s own date, is still the next run’s to refund', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* repay(t, 100, '2026-08-10');
			yield* run(t, '2026-08');
			yield* repay(t, 100, '2026-08-10', (yield* taken(t)).id);
			yield* run(t, '2026-09');
			assert.deepEqual(yield* moved(t), [
				['2026-08', 'DEDUCT', 100],
				['2026-09', 'ADD', 100]
			]);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('dated in a period that has run is refused; dated in the next, that run takes it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-08');
			assert.match(
				yield* refused(repay(t, 100, '2026-08-10')),
				/2026-08-10 is in attendance a payroll run has already priced\. Date the instalment in the next period to run/
			);
			assert.deepEqual(yield* repayments(t), []);
			// an open instalment cannot be moved back into it either
			yield* repay(t, 100, '2026-09-10');
			const [open] = yield* repayments(t);
			assert.ok(open !== undefined);
			assert.match(
				yield* refused(
					t
						.as(t.admin)
						.act('loan_catalog_entry_repayment.update', [
							{ target: open.id, set: { paid_on: PlainDate('2026-08-10') } }
						])
				),
				/Date the instalment in the next period to run/
			);
			yield* run(t, '2026-09');
			assert.deepEqual(yield* moved(t), [['2026-09', 'DEDUCT', 100]]);
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
			const drop = t.as(t.admin).act('loan_catalog_entry.delete', [{ target: LOAN }]);
			assert.match(yield* refused(drop), /still refer|locked/);
			// clearing the open schedule does not free it: what a run took keeps its loan
			const [, open] = yield* repayments(t);
			assert.ok(open !== undefined);
			yield* remove(t, open.id);
			assert.match(yield* refused(drop), /still refer|locked/);
			assert.equal(
				(yield* t.storedQuery({ loan_catalog_entry: { limit: 10 } })).loan_catalog_entry.rows
					.length,
				1
			);
			assert.equal((yield* repayments(t)).length, 1);
			// the principal cannot be cut under what payroll has already taken
			assert.match(
				yield* refused(
					t.as(t.admin).act('loan_catalog_entry.update', [{ target: LOAN, set: { quantity: 50 } }])
				),
				/cannot be less than repayments already included in payroll/
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('never run through payroll is deleted once its open schedule is cleared', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* repay(t, 100, '2026-08-10');
			const drop = t.as(t.admin).act('loan_catalog_entry.delete', [{ target: LOAN }]);
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
					(yield* t.storedQuery({ payroll_run: { limit: 10 } })).payroll_run.rows,
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
				assert.ok((slip?.net_pay.toNumber() ?? 0) > 0);
			}).pipe(Effect.provide(workspace({ seed: lent(1_000_000), now: NOW })))
	);
});

// The contract page settles a leaver's loans (`recoverLoans`, employee_contract/+representation.svelte): final pay
// repays what `loanRecovery` allows under the entity's floor, the rest goes on a new schedule after the last day, and
// HR gets one task. The page is not reachable from here, so the test sends the same acts in the same order. The exit
// cancelled, the routine that follows it (docs/0007 §4) waives the task and puts an unpaid final settlement back on
// monthly instalments; one a paid run took stands.
describe('a leaver’s loan', () => {
	const LAST = '2026-09-30';
	const ends = (t: Kit, to: string | null) =>
		t
			.as(t.admin)
			.act('employee_contract.update', [
				{
					target: CONTRACT,
					set: {
						effective_range: {
							from: PlainDate('2025-01-01'),
							to: to === null ? null : PlainDate(to)
						},
						reason: to === null ? 'Ended in error' : 'Resignation'
					}
				}
			])
			.pipe(Effect.andThen(t.runDue()));
	const task = (plan: { readonly remaining: number }) => ({
		entity_id: ENTITY,
		employee_id: idOf('employee_profile', uuid(4)),
		employment_id: CONTRACT,
		title: `Recover ${plan.remaining} from W1`,
		due_on: PlainDate('2026-10-01'),
		occurrence_key: `LOAN_RECOVERY:${CONTRACT}:exit:${LAST}`
	});
	const tasks = (t: Kit) =>
		t
			.storedQuery({ obligation: { limit: 200 } })
			.pipe(
				Effect.map(({ obligation }) =>
					obligation.rows
						.filter((row) => row.occurrence_key.startsWith('LOAN_RECOVERY:'))
						.map((row) => [row.state, String(row.due_on)])
				)
			);
	/** The loan scheduled and one month run, the contract ended, and the page's settlement of what is outstanding. */
	const settled = (t: Kit) =>
		Effect.gen(function* () {
			const admin = t.as(t.admin);
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
					.reduce((sum, row) => sum + (row.amount?.toNumber() ?? 0), 0);
			const [version] = (yield* t.storedQuery({ entity_profile_version: { limit: 1 } }))
				.entity_profile_version.rows;
			assert.equal(version?.final_pay_loan_floor_percent, FLOOR);
			const plan = loanRecovery({
				loans: [{ id: LOAN, outstanding }],
				expectedPay: august.net_pay.toNumber(),
				floorPercent: FLOOR,
				decimals: 2
			});
			// the fixture is a partial recovery: pay cannot cover the loan
			assert.ok(plan.proposed > 0 && plan.remaining > 0);
			yield* admin.act(
				'loan_catalog_entry_repayment.delete',
				held.filter((row) => row.payroll_run_id == null).map((row) => ({ target: row.id }))
			);
			yield* admin.act('loan_catalog_entry_repayment.create', [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					loan_id: LOAN,
					amount: plan.proposed,
					paid_on: PlainDate(LAST),
					payment_reference: `${FINAL_SETTLEMENT} (partial)`
				}
			]);
			yield* admin.act('loan_catalog_entry.update', [
				{
					target: LOAN,
					set: {
						repayment_period: { from: PlainDate('2026-10-01'), to: PlainDate('2026-11-30') }
					}
				}
			]);
			for (const row of buildLoanSchedule({
				principal: plan.remaining,
				from: '2026-10-01',
				to: '2026-11-30',
				repayments: []
			}).create)
				yield* repay(t, row.amount, row.paid_on);
			yield* admin.act('obligation.create', [task(plan)]);
			return plan;
		});
	const open = (t: Kit) =>
		repayments(t).pipe(Effect.map((rows) => rows.filter((row) => row.payroll_run_id == null)));
	const cents = (rows: Effect.Success<ReturnType<typeof repayments>>) =>
		Math.round(rows.reduce((sum, row) => sum + (row.amount?.toNumber() ?? 0), 0) * 100);

	it.live(
		'is recovered up to the floor in the final run; the rest is rescheduled, with one task',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const plan = yield* settled(t);
				// settled twice, the task is still one
				assert.match(
					yield* refused(t.as(t.admin).act('obligation.create', [task(plan)])),
					/already/
				);
				yield* run(t, '2026-09');
				// the final run takes exactly what the floor allowed, and leaves pay standing
				const [, final] = yield* slips(t);
				assert.deepEqual((yield* moved(t)).at(-1), ['2026-09', 'DEDUCT', plan.proposed]);
				assert.ok((final?.net_pay.toNumber() ?? 0) > 0);
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
				assert.equal(new Set(spread.map((row) => row.amount?.toNumber())).size, 1);
				// what a run had taken is as it was, and the routine again changes nothing
				yield* t.as(t.admin).start('encashment', { employments: [CONTRACT] });
				yield* t.runDue();
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
					['2026-10', 'DEDUCT', spread[0]?.amount?.toNumber()]
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
				const final = (yield* t.storedQuery({ payroll_run: { limit: 10 } })).payroll_run.rows.find(
					(row) => row.period === '2026-09'
				);
				assert.ok(final !== undefined);
				yield* t
					.as(t.admin)
					.act('payroll_run.update', [{ target: final.id, set: { state: 'PAID' } }]);
				yield* t.runDue();
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
	const FESTIVE = catalogRow(base, 'loan_catalog', 'LOAN_RECOVERY_FESTIVE_ADVANCE');
	const gated: ReturnType<typeof pack> = {
		...seed,
		loan_catalog: (seed.loan_catalog ?? []).map((row) =>
			row.id === FESTIVE
				? { ...row, eligibility: "return ctx.entry.repayment_period.to <= '2026-12-31';" }
				: row
		)
	};
	const lend = (t: Kit, to: string) =>
		t.as(t.admin).act('loan_catalog_entry.create', [
			{
				entity_id: ENTITY,
				employment_id: CONTRACT,
				catalog_id: idOf('loan_catalog', FESTIVE),
				quantity: 1000,
				repayment_period: { from: PlainDate('2026-09-01'), to: PlainDate(to) }
			}
		]);
	const loans = (t: Kit) =>
		t
			.storedQuery({ loan_catalog_entry: { limit: 10 } })
			.pipe(
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
						t.as(t.admin).act('loan_catalog_entry.update', [
							{
								target: LOAN,
								set: {
									repayment_period: { from: PlainDate('2026-08-01'), to: PlainDate('2027-01-31') }
								}
							}
						])
					),
					NO
				);
				assert.deepEqual(yield* loans(t), after);
			}).pipe(Effect.provide(workspace({ seed: gated, now: NOW })))
	);
});
