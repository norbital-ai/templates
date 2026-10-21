/** L-TPL-hr-payroll-051 interval order and payslip freeze. */
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { Effect, Result, Schema } from 'effect';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { workDay, type RosterInput } from '../src/lib/payroll_engine/payslip/context.ts';
import { cycleRefusal, patternCycles, type Validation } from '../src/lib/payroll_engine/admit.ts';
import { plannedShift } from '../src/lib/payroll_engine/shift_pattern.ts';
import { evaluateStrict } from '../src/lib/payroll_engine/expressions.ts';
import { lineage } from './jurisdiction_kit.ts';
import { SEEDED_PAYROLL } from './duties.ts';
import {
	refuseApprovedOvertimeIntervals,
	refusePinnedRoster,
	refusePlannedOvertime,
	refuseWorkedIntervals,
	restates
} from '../src/lib/payroll_engine/roster_entry.ts';

describe('roster entry', () => {
	it('requires closed ordered approval windows and preserves exact locked instants', () => {
		const windows = [
			{ start: '2026-01-15T00:00:00.000Z', end: '2026-01-15T01:00:00.000Z' },
			{ start: '2026-01-15T10:00:00.000Z', end: '2026-01-15T11:00:00.000Z' }
		];
		assert.equal(refuseApprovedOvertimeIntervals(null), null);
		assert.equal(refuseApprovedOvertimeIntervals([]), null);
		assert.equal(refuseApprovedOvertimeIntervals(windows), null);
		assert.equal(refuseApprovedOvertimeIntervals([{ ...windows[0]!, break_minutes: 15 }]), null);
		for (const pause of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 60, 61, '15'])
			assert.notEqual(
				refuseApprovedOvertimeIntervals([{ ...windows[0]!, break_minutes: pause }]),
				null
			);
		assert.equal(
			refuseApprovedOvertimeIntervals([
				{ start: '2026-01-15T08:00:00+08:00', end: '2026-01-15T01:00:00Z' }
			]),
			null
		);
		for (const invalid of [
			[{ start: windows[0]!.start, end: null }],
			[{ start: windows[0]!.start }],
			[{ start: 'not-an-instant', end: windows[0]!.end }],
			[{ start: windows[0]!.start, end: windows[0]!.start }],
			[{ start: windows[0]!.end, end: windows[0]!.start }],
			[windows[0], { start: '2026-01-15T00:30:00Z', end: '2026-01-15T01:30:00Z' }],
			windows.toReversed()
		])
			assert.notEqual(refuseApprovedOvertimeIntervals(invalid), null);
		const before = { approved_overtime_intervals: windows, payslip_id: 'captured' };
		assert.equal(
			restates(
				{ approved_overtime_intervals: windows.map((row) => ({ ...row, break_minutes: 0 })) },
				before
			),
			true
		);
		assert.equal(
			restates(
				{ approved_overtime_intervals: windows.map((row) => ({ ...row, break_minutes: null })) },
				before
			),
			true
		);
		assert.equal(
			restates(
				{ approved_overtime_intervals: windows.map((row) => ({ ...row, break_minutes: 15 })) },
				before
			),
			false
		);
		assert.equal(
			restates({ approved_overtime_intervals: windows.map((row) => ({ ...row })) }, before),
			true
		);
		assert.equal(
			restates(
				{
					approved_overtime_intervals: [
						{ start: '2026-01-15T08:00:00+08:00', end: '2026-01-15T09:00:00+08:00' },
						{ start: '2026-01-15T18:00:00+08:00', end: '2026-01-15T19:00:00+08:00' }
					]
				},
				before
			),
			true
		);
		for (const changed of [
			null,
			[],
			windows.slice(0, 1),
			windows.toReversed(),
			[windows[0], { ...windows[1], end: '2026-01-15T11:30:00Z' }]
		])
			assert.equal(restates({ approved_overtime_intervals: changed }, before), false);
		assert.equal(
			restates({ approved_overtime_intervals: [] }, { approved_overtime_intervals: null }),
			false
		);
	});

	it('keeps the dated rest-day base premium while capping only approved overtime, including zero approval', () => {
		const law = lineage('PH');
		const version = law.versionOn('2026-03-15');
		const base = Schema.decodeUnknownSync(Schema.String)(
			law.byCode(version, 'work_catalog', 'REST_DAY_WORK').quantity
		);
		const excess = Schema.decodeUnknownSync(Schema.String)(
			law.byCode(version, 'work_catalog', 'OVERTIME').quantity
		);
		const quantities = (approved: number | null) => {
			const outcome = workDay({
				date: '2026-03-15',
				planned: plannedShift({
					code: 'REST-TIMED',
					variant: { day_type: 'REST', start_time: '08:00', end_time: '16:00' }
				}),
				row: {
					planned_overtime_hours: approved,
					worked_intervals: [
						{ start: Instant('2026-03-15T00:00:00Z'), end: Instant('2026-03-15T12:00:00Z') }
					]
				},
				holiday: undefined,
				zone: 'Asia/Manila',
				policy: SEEDED_PAYROLL.attendance
			});
			if (Result.isFailure(outcome)) throw outcome.failure;
			const day = outcome.success;
			assert.equal(day.recorded_hours, 12);
			assert.equal(day.worked_hours, 8 + (approved ?? 0));
			const context = { work: { days: [day] }, terms: { facts: {} } };
			return [evaluateStrict(base, context), evaluateStrict(excess, context)];
		};
		assert.deepEqual(quantities(4), [8 * 1.3, 4 * 1.69]);
		assert.deepEqual(quantities(3), [8 * 1.3, 3 * 1.69]);
		assert.deepEqual(quantities(null), [8 * 1.3, 0]);
	});
	it('an import restates stored decimal plan hours without treating absent hours as an explicit zero', () => {
		const before = { planned_overtime_hours: Decimal.of('3'), payslip_id: 'captured' };
		assert.equal(restates({ planned_overtime_hours: 3 }, before), true);
		assert.equal(restates({ planned_overtime_hours: Decimal.of('3.00') }, before), true);
		assert.equal(restates({ planned_overtime_hours: 2.5 }, before), false);
		assert.equal(
			restates({ planned_overtime_hours: null }, { planned_overtime_hours: Decimal.of('0') }),
			false
		);
		assert.equal(restates({ planned_overtime_hours: 0 }, { planned_overtime_hours: null }), false);
		assert.equal(restates({ payslip_id: null }, before), false);
		assert.equal(restates({ banked_overtime_band: '01' }, { banked_overtime_band: '1' }), false);
	});
	it('caps overtime at its explicit plan then floors completed half-hours', () => {
		const shift = plannedShift({
			code: 'DAY',
			variant: { day_type: 'WORK', start_time: '08:00', end_time: '16:00' }
		});
		const actual = (end: string, approval: number | null = 3) => {
			const result = workDay({
				date: '2026-10-16',
				planned: shift,
				row: {
					planned_overtime_hours: approval,
					worked_intervals: [
						{ start: Instant('2026-10-16T00:00:00Z'), end: Instant(`2026-10-16T${end}Z`) }
					]
				},
				holiday: undefined,
				zone: 'Asia/Singapore',
				policy: SEEDED_PAYROLL.attendance
			});
			if (Result.isFailure(result)) throw result.failure;
			return result.success;
		};
		assert.equal(actual('10:54:00').planned_overtime_hours, 3);
		assert.equal(actual('10:54:00').approved_overtime_hours, 2.5);
		assert.equal(actual('10:59:59').approved_overtime_hours, 2.5);
		assert.equal(actual('11:00:00').approved_overtime_hours, 3);
		assert.equal(actual('12:00:00').approved_overtime_hours, 3);
		assert.equal(actual('12:00:00', 3.2).approved_overtime_hours, 3);
		assert.equal(actual('12:00:00', 0).approved_overtime_hours, 0);
		assert.equal(actual('12:00:00', null).approved_overtime_hours, 0);
		assert.equal(refusePlannedOvertime(3, 'DAY'), null);
		assert.match(refusePlannedOvertime(3, null) ?? '', /shift code/);
		assert.match(refusePlannedOvertime(-0.5, 'DAY') ?? '', /nonnegative/);
		assert.match(refusePlannedOvertime(Number.NaN, 'DAY') ?? '', /nonnegative/);
	});
	it('credits only configured clock windows, with approved half-hour overtime and banked hours within it', () => {
		const shift = plannedShift({
			code: 'D',
			variant: { day_type: 'WORK', start_time: '09:00', end_time: '17:00' }
		});
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
				row: { planned_overtime_hours: 6, banked_overtime_hours: banked, worked_intervals },
				holiday: undefined,
				zone: 'Asia/Singapore',
				policy: SEEDED_PAYROLL.attendance
			});
		const of = (outcome: ReturnType<typeof day>) => {
			if (Result.isFailure(outcome)) throw outcome.failure;
			const { worked, worked_hours, approved_overtime_hours, overtime_hours } = outcome.success;
			return [worked, worked_hours, approved_overtime_hours, overtime_hours];
		};
		// None recorded, reviewed empty, one actual hour of a short day, approved overtime less two banked hours.
		assert.deepEqual(of(day(shift, null)), [false, 0, 0, 0]);
		assert.deepEqual(of(day(shift, [])), [false, 0, 0, 0]);
		assert.deepEqual(of(day(shift, clock('02:00'))), [true, 1, 0, 0]);
		assert.deepEqual(of(day(shift, clock('14:40'), 2)), [true, 13.5, 5.5, 3.5]);
		// An untimed rest code preserves its base premium context but cannot invent an overtime window.
		assert.deepEqual(
			of(day(plannedShift({ code: 'REST', variant: { day_type: 'REST' } }), clock('05:00'))),
			[true, 4, 0, 0]
		);
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
		// The seeded `cycle` validation: a cycle refuses when its WORK, REST or OFF count moves.
		const seeded = lineage('SG')
			.rows('version_6', 'rule_set')
			.find((row) => row['code'] === 'ROSTER_PATTERN_CYCLE');
		const rules = Schema.decodeUnknownSync(
			Schema.Struct({
				site: Schema.Literal('cycle'),
				kind: Schema.Literals(['refuse', 'warn', 'hold']),
				when: Schema.String,
				message: Schema.String
			})
		)(seeded?.['rules']);
		const check: Validation = { ...rules, code: 'ROSTER_PATTERN_CYCLE' };
		const breach = (
			rostered: Record<string, string>,
			from = '2026-03-02',
			checks: readonly Validation[] = [check]
		) => {
			const outcome = patternCycles({
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
			for (const cycle of outcome.success) {
				const refused = Effect.runSync(cycleRefusal(cycle, checks, undefined));
				if (refused != null) return refused;
			}
			return null;
		};
		// Wednesday off, Saturday worked: a swap inside the cycle
		assert.equal(breach({ '2026-03-04': 'o', '2026-03-07': 'w' }), null);
		assert.match(String(breach({ '2026-03-07': 'w' })), /plans 6 work, 1 rest and 0 off days/);
		assert.match(String(breach({ '2026-03-08': 'w' })), /plans 6 work, 0 rest and 1 off days/);
		// a later cycle is judged on its own days
		assert.match(String(breach({ '2026-03-14': 'w' })), /2026-03-09 to 2026-03-15/);
		// a cycle the employment joins part-way is not judged
		assert.equal(breach({ '2026-03-07': 'w' }, '2026-03-04'), null);
		// H8: the row decides: a warn-kind cycle row, or none, lets the extra work day through
		assert.equal(breach({ '2026-03-07': 'w' }, '2026-03-02', [{ ...check, kind: 'warn' }]), null);
		assert.equal(breach({ '2026-03-07': 'w' }, '2026-03-02', []), null);
		// and an entity severity override softens it the same way
		assert.equal(
			Effect.runSync(
				cycleRefusal(
					{
						date: '2026-03-07',
						from: '2026-03-02',
						to: '2026-03-08',
						planned: { WORK: 6, REST: 1, OFF: 0 },
						expected: { WORK: 5, REST: 1, OFF: 1 }
					},
					[check],
					{ default: 'record', rules: { ROSTER_PATTERN_CYCLE: 'warn' } }
				)
			),
			null
		);
	});
});
