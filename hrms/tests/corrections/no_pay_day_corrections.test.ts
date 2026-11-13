// A no-pay day a run priced is corrected on the entry itself: nothing moves under an unpaid run, a write to a paid
// period leaves the month to be worked out again, and the next run carries the difference, once. Malaysia's law pack is
// only the fixture: every expected amount is what the run itself produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { amendments, carriedFor, ownLines, pay, run } from '../amendment_kit.ts';
import { ENTITY, catalogRow, leaveCreate, pack, storedQuery, uuid, workspace } from '../kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const SALARY = 3120;
const seed = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: SALARY, unit: 'MONTHLY' },
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[],
	'2026-06-15'
);
const whole = (date: string) => [
	{ date, part: 'AM' as const },
	{ date, part: 'PM' as const }
];
const entry = (t: Kit) =>
	t.as(t.admin).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'NPL')),
						days: whole('2026-06-10')
					})
				]
			})
		)
	);
const theEntry = (t: Kit) =>
	storedQuery(t, { leave_catalog_entry: { limit: 1 } }).pipe(
		Effect.map(({ leave_catalog_entry }) => {
			const [row] = leave_catalog_entry.rows;
			assert.ok(row !== undefined);
			return row;
		})
	);
const deleted = (t: Kit) =>
	Effect.gen(function* () {
		const target = yield* theEntry(t);
		yield* (yield* t.as(t.admin)).act({ 'leave_catalog_entry.delete': [{ target }] });
		yield* t.run_due();
	});
/** Every amendment row: its paid period, and the run that took it (none while it is open). */
const open = (t: Kit) =>
	amendments(t).pipe(
		Effect.map((rows) => rows.map((row) => [row.period, row.payroll_run_id ?? null]))
	);

describe('a no-pay day corrected', () => {
	it.live(
		'does not move under an unpaid run; once the run is paid, a day added leaves the month to be worked out again',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* entry(t);
				const ran = yield* run(t, '2026-06');
				const held = yield* theEntry(t);
				const add = t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'leave_catalog_entry.update': [
								{
									target: held,
									set: {
										leave_catalog_entry_day: {
											create: [{ incurred_on: '2026-06-11', part: 'AM' }]
										}
									}
								}
							]
						})
					)
				);
				assert.match(
					String(yield* Effect.flip(add)),
					/Run \d+ holds this person and is not paid yet\. Delete it, correct this, and run again\./
				);
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.update': [{ target: ran, set: { state: 'PAID' } }]
				});
				yield* t.run_due();
				assert.deepEqual(yield* open(t), []);
				yield* add;
				assert.deepEqual(yield* open(t), [['2026-06', null]]);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-06-20T02:00:00.000Z' })))
	);

	it.live('deleted before any run prices it, the month pays whole and nothing is amended', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t);
			yield* deleted(t);
			yield* run(t, '2026-06');
			const lines = yield* ownLines(t, '2026-06');
			assert.equal(lines['BASIC/EMPLOYEE'], SALARY);
			assert.equal(lines['NPL/EMPLOYEE'], undefined);
			assert.deepEqual(yield* open(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-06-20T02:00:00.000Z' })))
	);

	it.live('deleted after payment, the next run gives the day back, once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t);
			yield* pay(t, '2026-06');
			const june = (yield* ownLines(t, '2026-06'))['NPL/EMPLOYEE'] ?? 0;
			assert.ok(june < 0, String(june));
			yield* deleted(t);
			// the paid payslip stands, and the month waits to be worked out again
			assert.equal((yield* ownLines(t, '2026-06'))['NPL/EMPLOYEE'], june);
			assert.deepEqual(yield* open(t), [['2026-06', null]]);
			const july = yield* pay(t, '2026-07');
			// July gives back what June took, though the month is a day longer
			assert.equal((yield* carriedFor(t, '2026-07', '2026-06'))['NPL/EMPLOYEE'], -june);
			assert.deepEqual(yield* open(t), [['2026-06', july.id]]);
			yield* run(t, '2026-08');
			assert.deepEqual(yield* carriedFor(t, '2026-08', '2026-06'), {});
			assert.equal((yield* ownLines(t, '2026-08'))['NPL/EMPLOYEE'], undefined);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-07-20T02:00:00.000Z' })))
	);
});
