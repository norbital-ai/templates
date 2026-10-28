/**
 * Catalogue entries through the real write path: an entry of each family is created, priced by its class and shown on
 * the payslip of its own period; a loan's repayments are each recovered whole by one payslip; leave is entries
 * against an entitlement the class computes. The classes are the synthetic `XX` version's (`jurisdiction_kit.ts`).
 */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { moneyNumber, runEngine } from '../src/lib/payroll_engine/foundation.ts';
import { leaveBalances } from '../src/lib/payroll_engine/leave.ts';
import { leaveState } from '../src/lib/payroll_engine/payslip/context.ts';
import { CATALOG, COMPANY, employer, employment, runOf, world } from './jurisdiction_kit.ts';

const A = employment('a');
const run = (period: string) => ({ company_id: COMPANY, period, kind: 'REGULAR' as const });

it.effect(
	'each entry shows on the payslip of its period, and a loan is recovered one whole repayment per payslip',
	() =>
		world(
			employer([{ key: 'a', salary: 3000, allowances: [{ code: 'MEAL', amount: 200 }] }])
		).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const adhoc = (catalog_id: typeof CATALOG.BONUS, day: string, amount: string) =>
					hr.act('adhoc_catalog_entry.create', [
						{
							catalog_id,
							employment_id: A,
							occurred_on: PlainDate(day),
							amount: Decimal.of(amount)
						}
					]);
				yield* adhoc(CATALOG.BONUS, '2026-03-10', '500');
				yield* adhoc(CATALOG.DAMAGE, '2026-03-12', '50');
				yield* adhoc(CATALOG.BONUS, '2026-04-02', '400');
				yield* hr.act('claim_catalog_entry.create', [
					{
						catalog_id: CATALOG.MEAL_CLAIM,
						employment_id: A,
						occurred_on: PlainDate('2026-03-11'),
						amount: Decimal.of('20')
					}
				]);
				yield* hr.act('loan_catalog_entry.create', [
					{
						catalog_id: CATALOG.ADVANCE,
						employment_id: A,
						principal_amount: Decimal.of('300'),
						repayment_period: { from: PlainDate('2026-03-31'), to: PlainDate('2026-05-31') },
						repayment_frequency: 'MONTHLY'
					}
				]);
				const repayments = () =>
					hr
						.query({ loan_repayment_entry: {} })
						.pipe(Effect.map((answer) => answer.loan_repayment_entry))
						.pipe(
							Effect.map((page) =>
								page.rows
									.toSorted((a, b) => a.occurred_on.localeCompare(b.occurred_on))
									.map((row) => [row.occurred_on, moneyNumber(row.amount), row.payslip_id])
							)
						);
				assert.deepEqual(yield* repayments(), [
					['2026-03-31', 100, null],
					['2026-04-30', 100, null],
					['2026-05-31', 100, null]
				]);

				yield* hr.act('payroll_run.create', [run('2026-03')]);
				const march = (yield* runOf(hr, '2026-03')).slip('a');
				assert.deepEqual(march.lines, {
					BASIC: 3000,
					MEAL: 200,
					BONUS: 500,
					DAMAGE: -50,
					MEAL_CLAIM: 20,
					ADVANCE: -100
				});
				// gross 3,700 (salary, allowance, bonus); the schemes 370 + 370 + 270; net deductions 150; net addition 20
				assert.equal(march.gross, 3700);
				assert.deepEqual(march.statutory, { FUND: 370, WHT: 370, PIT: 270 });
				assert.equal(march.net, 2560);

				// the run's pins become each settled entry's payslip
				yield* t.runDue();
				const pinned = (yield* hr.query({ adhoc_catalog_entry: {} })).adhoc_catalog_entry.rows
					.toSorted((a, b) => a.occurred_on.localeCompare(b.occurred_on))
					.map((row) => row.payslip_id);
				assert.deepEqual(pinned, [march.id, march.id, null]);
				assert.equal(
					(yield* hr.query({ claim_catalog_entry: {} })).claim_catalog_entry.rows[0]?.payslip_id,
					march.id
				);
				assert.deepEqual(
					(yield* repayments()).map(([, , payslip]) => payslip),
					[march.id, null, null]
				);

				yield* hr.act('payroll_run.create', [run('2026-04')]);
				const april = (yield* runOf(hr, '2026-04')).slip('a');
				assert.deepEqual(april.lines, { BASIC: 3000, MEAL: 200, BONUS: 400, ADVANCE: -100 });
			})
		),
	60_000
);

it.effect('a leave entry draws on the entitlement its class computes, and none past it', () =>
	world(employer([{ key: 'a', salary: 3000 }])).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			const request = (from: string, to: string) => ({
				catalog_id: CATALOG.ANNUAL,
				employment_id: A,
				occurred_on: PlainDate(from),
				activity: 'TIME_OFF' as const,
				from: PlainDate(from),
				to: PlainDate(to)
			});
			// the page's balance: the engine's leave state read as the viewer, then the pure balance helper
			const available = () =>
				runEngine(leaveState(A, '2026-03-02'), hr.query, (message) =>
					Effect.fail(new Error(message))
				).pipe(
					Effect.map(
						(state) =>
							leaveBalances({ ...state, offeredOnly: true }).find(
								(row) => row.catalog_id === CATALOG.ANNUAL
							)?.available
					)
				);
			// the class states five days a calendar year
			assert.equal(yield* available(), 5);
			// two three-day requests together pass the five: the batch is refused whole
			const batch = yield* Effect.flip(
				hr.act('leave_catalog_entry.create', [
					request('2026-03-02', '2026-03-04'),
					request('2026-03-09', '2026-03-11')
				])
			);
			assert.match(batch.message, /available 2 day/);
			assert.equal(
				(yield* t.storedQuery({ leave_catalog_entry: {} })).leave_catalog_entry.rows.length,
				0
			);
			// Monday to Friday: five working days
			yield* hr.act('leave_catalog_entry.create', [request('2026-03-02', '2026-03-06')]);
			assert.equal(yield* available(), 0);
			const over = yield* Effect.flip(
				hr.act('leave_catalog_entry.create', [request('2026-03-09', '2026-03-09')])
			);
			assert.match(over.message, /available 0 day/);
			assert.equal(
				(yield* t.storedQuery({ leave_catalog_entry: {} })).leave_catalog_entry.rows.length,
				1
			);
		})
	)
);

it.effect(
	'one batch counts every leave range on its own plan and replaces the supplied day totals',
	() =>
		world(employer([{ key: 'a', salary: 3000 }])).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const outcome = yield* hr.act(
					'leave_catalog_entry.create',
					['2026-03-03', '2026-03-04', '2026-03-05'].map((day) => ({
						catalog_id: CATALOG.ANNUAL,
						employment_id: A,
						occurred_on: PlainDate(day),
						activity: 'TIME_OFF' as const,
						from: PlainDate(day),
						to: PlainDate(day),
						days: 999
					}))
				);
				assert.equal(outcome.kind, 'committed');
				const stored = yield* hr
					.query({
						leave_catalog_entry: {
							fields: ['days']
						}
					})
					.pipe(Effect.map((answer) => answer.leave_catalog_entry));
				assert.deepEqual(
					stored.rows.map((row) => moneyNumber(row.days)),
					[1, 1, 1]
				);
			})
		)
);

it.effect(
	'a controller’s ad hoc pay awaiting review is neither paid nor pinned; once approved, a rebuilt run pays it',
	() =>
		world(employer([{ key: 'a', salary: 3000 }])).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				// the review routes to the HR Manager team: its approver is a member of it
				const hr = t.as(t.member(['hr_manager'], { teams: ['hr_manager'] }));
				const controller = t.as(t.member(['hr_controller']));
				const held = yield* controller.act('adhoc_catalog_entry.create', [
					{
						catalog_id: CATALOG.BONUS,
						employment_id: A,
						occurred_on: PlainDate('2026-03-10'),
						amount: Decimal.of('500')
					}
				]);
				assert.equal(held.kind, 'pendingApproval');
				if (held.kind !== 'pendingApproval') return;

				yield* hr.act('payroll_run.create', [run('2026-03')]);
				const waiting = yield* runOf(hr, '2026-03');
				assert.deepEqual(waiting.slip('a').lines, { BASIC: 3000 });
				assert.ok(!waiting.pins.some((pin) => pin.collection === 'adhoc_catalog_entry'));

				yield* hr.approvals.decide(held.requestId, { decision: 'approve' });
				yield* hr.act('payroll_run.delete', [{ target: waiting.id }]);
				yield* hr.act('payroll_run.create', [run('2026-03')]);
				assert.deepEqual((yield* runOf(hr, '2026-03')).slip('a').lines, {
					BASIC: 3000,
					BONUS: 500
				});
			})
		),
	60_000
);
