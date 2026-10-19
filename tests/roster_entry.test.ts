/** L-TPL-hr-payroll-051 interval order and payslip freeze. */
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { Result } from 'effect';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { workDay, type RosterInput } from '../src/lib/payroll_engine/payslip/context.ts';
import { cycleBreach } from '../src/lib/payroll_engine/admit.ts';
import {
	refusePinnedRoster,
	refuseWorkedIntervals
} from '../src/lib/payroll_engine/roster_entry.ts';

describe('roster entry', () => {
	it('derives overtime from the clock past the planned shift’s hours: half-hours, banked within it, unplanned pays nothing', () => {
		const shift = { code: 'D', day_type: 'WORK', scheduled_hours: 8, break: null };
		const clock = (end: string) => [
			{ start: Instant('2026-10-16T01:00:00.000Z'), end: Instant(`2026-10-16T${end}:00.000Z`) }
		];
		const day = (
			planned: typeof shift | null,
			worked_intervals: NonNullable<RosterInput['worked_intervals']> | null,
			banked = 0
		) =>
			workDay({
				date: '2026-10-16',
				planned,
				row: { banked_overtime_hours: banked, worked_intervals },
				holiday: undefined,
				zone: 'Asia/Singapore'
			});
		const of = (outcome: ReturnType<typeof day>) => {
			if (Result.isFailure(outcome)) throw outcome.failure;
			const { worked, worked_hours, approved_overtime_hours, overtime_hours } = outcome.success;
			return [worked, worked_hours, approved_overtime_hours, overtime_hours];
		};
		// none recorded, reviewed empty, a short day (still its planned 8 hours), 5 h 40 past the shift less 2 banked
		assert.deepEqual(of(day(shift, null)), [false, 0, 0, 0]);
		assert.deepEqual(of(day(shift, [])), [false, 0, 0, 0]);
		assert.deepEqual(of(day(shift, clock('02:00'))), [true, 8, 0, 0]);
		assert.deepEqual(of(day(shift, clock('14:40'), 2)), [true, 13.5, 5.5, 3.5]);
		// a planned rest day has no ordinary hours: all of it is overtime; no plan at all pays nothing
		assert.deepEqual(of(day({ ...shift, day_type: 'REST', scheduled_hours: 0 }, clock('05:00'))), [
			true,
			4,
			4,
			4
		]);
		assert.deepEqual(of(day(null, clock('14:40'))), [false, 0, 0, 0]);
		assert.ok(Result.isFailure(day(shift, clock('10:00'), 2)));
	});

	it('L-TPL-hr-payroll-051 refuses overlapping or out-of-order intervals and an open interval that is not last', () => {
		assert.equal(
			refuseWorkedIntervals([
				{ start: '2026-01-01T09:00:00.000Z', end: '2026-01-01T12:00:00.000Z' },
				{ start: '2026-01-01T11:00:00.000Z', end: '2026-01-01T13:00:00.000Z' }
			]),
			'Worked intervals must be in time order and cannot overlap.'
		);
		assert.equal(
			refuseWorkedIntervals([
				{ start: '2026-01-01T09:00:00.000Z', end: null },
				{ start: '2026-01-01T13:00:00.000Z', end: '2026-01-01T17:00:00.000Z' }
			]),
			'Only the final worked interval may still be open.'
		);
		assert.equal(
			refuseWorkedIntervals([
				{ start: '2026-01-01T09:00:00.000Z', end: '2026-01-01T12:00:00.000Z' },
				{ start: '2026-01-01T13:00:00.000Z', end: null }
			]),
			null
		);
	});

	it('L-TPL-hr-payroll-051 freezes a day a payslip already consumed', () => {
		assert.equal(refusePinnedRoster({ payslip_id: 'p1' }), 'A settled day cannot be changed.');
		assert.equal(refusePinnedRoster({ payslip_id: null }), null);
	});
	it('keeps each pattern cycle’s work, rest and off days: a swap passes, an extra work day or a dropped rest day refuses', () => {
		const definitions = new Map(
			[
				['w', 'WORK', '09:00'],
				['o', 'OFF', null],
				['r', 'REST', null]
			].map(([id, day_type, start]) => [
				String(id),
				{
					id: String(id),
					code: String(id),
					variant: start == null ? { day_type } : { day_type, start_time: start, end_time: '18:00' }
				}
			])
		);
		// Monday 2 March 2026 opens the cycle: five work days, an off day, a rest day
		const patterns = new Map([
			[
				'p',
				{
					id: 'p',
					effective_range: { from: '2026-03-02', to: null },
					pattern: {
						days: ['w', 'w', 'w', 'w', 'w', 'o', 'r'].map((roster_code_id) => ({ roster_code_id }))
					}
				}
			]
		]);
		const breach = (rostered: Record<string, string>, from = '2026-03-02') => {
			const outcome = cycleBreach({
				contract: {
					effective_range: { from: PlainDate(from), to: null },
					facts: {
						contract_terms: [
							{ effective_range: { from: PlainDate(from), to: null }, shift_pattern_id: 'p' }
						]
					}
				},
				definitions,
				patterns,
				rosteredOn: (date) => rostered[date] ?? null,
				dates: Object.keys(rostered)
			});
			if (Result.isFailure(outcome)) throw outcome.failure;
			return outcome.success;
		};
		// Wednesday off, Saturday worked: a swap inside the cycle
		assert.equal(breach({ '2026-03-04': 'o', '2026-03-07': 'w' }), null);
		assert.match(String(breach({ '2026-03-07': 'w' })), /plans 6 work, 1 rest and 0 off days/);
		assert.match(String(breach({ '2026-03-08': 'w' })), /plans 6 work, 0 rest and 1 off days/);
		// a later cycle is judged on its own days
		assert.match(String(breach({ '2026-03-14': 'w' })), /2026-03-09 to 2026-03-15/);
		// a cycle the employment joins part-way is not judged
		assert.equal(breach({ '2026-03-07': 'w' }, '2026-03-04'), null);
	});
});
