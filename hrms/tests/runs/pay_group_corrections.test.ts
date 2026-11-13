// A pay group after it has paid: a period the old group paid is worked out on that group and carried by the new one,
// and a pay day corrected after a paid run moves only the cycles still to come.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { amendments, carriedFor, pay, rostered, run } from '../amendment_kit.ts';
import { EMPLOYMENT, PAY_GROUP, current, storedQuery, uuid, workspace } from '../kit.ts';

const GROUP_B = uuid(908);

describe('a change of pay group', () => {
	/** The company pays monthly on group A to February, and on a second group from the first of March. */
	const movedGroup = () => {
		const seed = rostered(['2026-02', '2026-03']);
		const [group] = seed.pay_group ?? [];
		assert.ok(group !== undefined);
		return {
			...seed,
			pay_group: [group, { ...group, id: GROUP_B, name: 'Monthly, from March' }],
			// the move is a change of terms from the first of March: one row holding the new group
			contract_terms: [
				...(seed.contract_terms ?? []),
				{
					id: uuid(907),
					employment_id: EMPLOYMENT,
					effective_from: '2026-03-01',
					pay_group_id: GROUP_B
				}
			]
		};
	};
	const overtimeKeyed = (t: Kit, date: string) =>
		Effect.gen(function* () {
			const { roster_entry } = yield* storedQuery(t, {
				roster_entry: {
					where: {
						work_date: { eq: date },
						employment_id: { eq: idOf('employment', EMPLOYMENT) }
					},
					limit: 1
				}
			});
			const [day] = roster_entry.rows;
			assert.ok(day !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'roster_entry.update': [
					{
						target: day,
						set: {
							actual_worked_intervals: [
								{
									start: DateTime.formatIso(DateTime.makeUnsafe(`${date}T00:00:00.000Z`)),
									end: DateTime.formatIso(DateTime.makeUnsafe(`${date}T10:00:00.000Z`))
								}
							],
							planned_overtime_intervals: [
								{
									start: DateTime.formatIso(DateTime.makeUnsafe(`${date}T08:00:00.000Z`)),
									end: DateTime.formatIso(DateTime.makeUnsafe(`${date}T10:00:00.000Z`))
								}
							]
						}
					}
				]
			});
			yield* t.run_due();
		});

	it.live(
		'a period the old group paid is worked out on that group, and the new group carries it',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02', PAY_GROUP);
				yield* overtimeKeyed(t, '2026-02-10');
				const [open] = yield* amendments(t);
				assert.equal(open?.pay_group_id, PAY_GROUP, 'the row names the group that paid the period');
				const march = yield* run(t, '2026-03', GROUP_B);
				assert.ok(((yield* carriedFor(t, '2026-03', '2026-02'))['OVERTIME/EMPLOYEE'] ?? 0) > 0);
				assert.equal((yield* amendments(t))[0]?.payroll_run_id, march.id);
			}).pipe(Effect.provide(workspace({ seed: movedGroup(), now: '2026-03-20T02:00:00.000Z' })))
	);
});

describe('a pay group with a wrong pay day', () => {
	it.live(
		'corrected after a paid run: that run keeps its pay date and coverage, and the next cycle follows the corrected schedule',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-08');
				yield* (yield* t.as(t.admin)).act({
					'pay_group.update': [
						{
							target: yield* current(t, 'pay_group', idOf('pay_group', PAY_GROUP)),
							set: {
								payment_schedule: {
									frequency: 'MONTHLY',
									business_day: 'PREVIOUS',
									non_working_weekdays: [0, 6],
									short_month: 'LAST_DAY',
									pay_cutoff_day: 1,
									pay_days: [28]
								}
							}
						}
					]
				});
				yield* t.run_due();
				const window = (row: Effect.Success<ReturnType<typeof run>>) => [
					String(row.pay_date),
					String(row.salary_coverage.from),
					String(row.salary_coverage.to)
				];
				const { payroll_run } = yield* storedQuery(t, {
					payroll_run: { where: { period: { eq: '2026-08' } }, limit: 1 }
				});
				const [august] = payroll_run.rows;
				assert.ok(august !== undefined);
				assert.deepEqual(window(august), ['2026-08-25', '2026-08-01', '2026-08-31']);
				// no day is paid twice and none is skipped
				assert.deepEqual(window(yield* run(t, '2026-09')), [
					'2026-09-28',
					'2026-09-01',
					'2026-09-30'
				]);
			}).pipe(Effect.provide(workspace({ seed: rostered([]), now: '2026-11-20T02:00:00.000Z' })))
	);
});
