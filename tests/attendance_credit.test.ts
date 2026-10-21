/** Credit actual intersections, preserving missed leading time, breaks and exact clocks. */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Result, Schema } from 'effect';
import { Instant } from '@norbital-ai/std/date';
import {
	type AttendancePolicy,
	creditAttendance,
	workDay
} from '../src/lib/payroll_engine/payslip/context.ts';
import { plannedShift } from '../src/lib/payroll_engine/shift_pattern.ts';
import { evaluateStrict } from '../src/lib/payroll_engine/expressions.ts';
import { lineage } from './jurisdiction_kit.ts';
import { SEEDED_PAYROLL } from './duties.ts';

const DATE = '2026-03-02';
const at = (clock: string, date = DATE) => `${date}T${clock}+08:00`;
const interval = (start: string, end: string) => ({ start: at(start), end: at(end) });
const SHIFT = plannedShift({
	code: 'D08',
	variant: { day_type: 'WORK', start_time: '08:00', end_time: '17:00', break_minutes: 60 }
});
const credit = (
	intervals: Parameters<typeof creditAttendance>[0]['intervals'],
	approval: number | null = 0
) =>
	creditAttendance({
		date: DATE,
		intervals,
		planned: SHIFT,
		plannedOvertimeHours: approval,
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
const drawnHours = (result: ReturnType<typeof creditAttendance>) =>
	result.segments
		.flatMap((segment) => segment.credited_intervals)
		.reduce((sum, span) => sum + (span.end - span.start) / 3600000, 0);

it('late arrival is not compensated by an unapproved late departure, and monthly BASIC stays catalogue-governed', () => {
	const actual = [interval('09:00:00', '18:00:00')];
	const before = structuredClone(actual);
	const out = credit(actual);
	assert.equal(out.recorded_hours, 8);
	assert.equal(out.normal_hours, 7);
	assert.equal(out.overtime_hours, 0);
	assert.equal(out.target_hours, 8);
	assert.equal(out.percent, 87.5);
	assert.equal(out.segments[0]?.credited_intervals[0]?.start, Date.parse(at('09:00:00')));
	assert.equal(out.segments[0]?.start, Date.parse(at('08:00:00')));
	assert.equal(drawnHours(out), 7);
	assert.deepEqual(actual, before);
	const day = workDay({
		date: DATE,
		planned: SHIFT,
		row: {
			worked_intervals: actual.map((span) => ({
				start: Instant(span.start),
				end: Instant(span.end)
			}))
		},
		holiday: undefined,
		zone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	if (Result.isFailure(day)) throw day.failure;
	assert.equal(day.success.worked_hours, 7);
	assert.equal(day.success.recorded_hours, 8);
	const law = lineage('PH');
	const basic = Schema.decodeUnknownSync(Schema.String)(
		law.byCode(law.versionOn(DATE), 'work_catalog', 'BASIC').quantity
	);
	assert.equal(
		evaluateStrict(basic, {
			terms: { facts: {} },
			period: { paid_days: 31, days: 31 },
			work: { days: [day.success] },
			leave: { rows: [] }
		}),
		1
	);
});

it('keeps the exact leading gap and trims only the rounding tail from credited segments', () => {
	const out = credit([interval('08:10:00', '17:00:00')]);
	assert.equal(out.normal_hours, 7.5);
	assert.equal(out.percent, 93.75);
	assert.equal(out.segments[0]?.credited_intervals[0]?.start, Date.parse(at('08:10:00')));
	assert.equal(out.segments.at(-1)?.credited_intervals.at(-1)?.end, Date.parse(at('16:40:00')));
	assert.equal(drawnHours(out), out.credited_hours);
});

it('interior split gaps satisfy the break duration without consuming lateness or deducting a second break', () => {
	assert.equal(
		credit([interval('08:00:00', '11:00:00'), interval('12:00:00', '17:00:00')]).normal_hours,
		8
	);
	const late = credit([interval('09:00:00', '11:00:00'), interval('12:00:00', '17:00:00')]);
	assert.equal(late.normal_hours, 7);
	assert.equal(late.target_hours, 8);
	assert.equal(late.segments[0]?.credited_intervals[0]?.start, Date.parse(at('09:00:00')));
	const shortBreak = credit([interval('08:00:00', '11:30:00'), interval('12:00:00', '17:00:00')]);
	assert.equal(shortBreak.recorded_hours, 8.5);
	assert.equal(shortBreak.normal_hours, 8);
	assert.equal(shortBreak.overtime_hours, 0);
});

it('centre-overlapping break gaps take priority while excess interior absence stays visible', () => {
	const out = credit([interval('08:00:00', '11:00:00'), interval('14:00:00', '17:00:00')]);
	assert.equal(out.normal_hours, 6);
	assert.equal(out.target_hours, 8);
	assert.equal(out.percent, 75);
	assert.equal(out.segments[0]?.end, Date.parse(at('12:00:00')));
	assert.equal(out.segments[1]?.start, Date.parse(at('13:00:00')));
	assert.equal(drawnHours(out), 6);
});

it('credits only the approved extension, floors its actual shortfall and cannot repay a leading ordinary gap', () => {
	assert.equal(credit([interval('08:00:00', '19:54:00')], 3).overtime_hours, 2.5);
	assert.equal(credit([interval('08:00:00', '21:00:00')], 3).overtime_hours, 3);
	assert.equal(credit([interval('08:00:00', '21:00:00')], 3.2).overtime_hours, 3);
	assert.equal(credit([interval('08:00:00', '21:00:00')], null).overtime_hours, 0);
	const late = credit([interval('09:00:00', '21:00:00')], 3);
	assert.equal(late.normal_hours, 7);
	assert.equal(late.overtime_hours, 3);
	assert.equal(late.credited_hours, 10);
	assert.equal(late.target_hours, 11);
	assert.equal(drawnHours(late), 10);
	assert.equal(credit([interval('07:00:00', '16:00:00')]).normal_hours, 7);
});

it('anchors overnight windows to the work date in the entity zone, preserving seconds and next-day overtime', () => {
	const planned = plannedShift({
		code: 'N20',
		variant: { day_type: 'WORK', start_time: '20:30', end_time: '05:30', break_minutes: 60 }
	});
	const out = creditAttendance({
		date: DATE,
		planned,
		plannedOvertimeHours: 3,
		intervals: [{ start: at('20:30:00'), end: at('08:24:17', '2026-03-03') }],
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	assert.equal(out.normal_hours, 8);
	assert.equal(out.overtime_hours, 2.5);
	assert.equal(out.credited_hours, 10.5);
	assert.equal(out.segments.at(-1)?.start, Date.parse(at('05:30:00', '2026-03-03')));
	assert.ok(out.recorded_hours > 10.9);
	const late = creditAttendance({
		date: DATE,
		planned,
		intervals: [{ start: at('21:30:00'), end: at('06:30:00', '2026-03-03') }],
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	assert.equal(late.normal_hours, 7);
	assert.equal(late.overtime_hours, 0);
});

it('uses the entity zone rather than the timestamp text for the planned window', () => {
	const planned = plannedShift({
		code: 'D08',
		variant: { day_type: 'WORK', start_time: '08:00', end_time: '16:00' }
	});
	const input = {
		date: DATE,
		planned,
		intervals: [{ start: '2026-03-02T00:00:00Z', end: '2026-03-02T08:00:00Z' }],
		policy: SEEDED_PAYROLL.attendance
	};
	assert.equal(creditAttendance({ ...input, timeZone: 'Asia/Singapore' }).normal_hours, 8);
	assert.equal(creditAttendance({ ...input, timeZone: 'Asia/Tokyo' }).normal_hours, 7);
});

it('keeps missing and open attendance neutral, distinct from a reviewed empty day', () => {
	const unknown = credit(null);
	assert.equal(unknown.complete, false);
	assert.equal(unknown.percent, null);
	assert.equal(unknown.credited_hours, 0);
	const open = credit([interval('08:00:00', '10:00:00'), { start: at('11:00:00'), end: null }]);
	assert.equal(open.recorded_hours, 2);
	assert.equal(open.complete, false);
	assert.equal(open.percent, null);
	assert.equal(open.credited_hours, 0);
	assert.equal(credit([]).complete, true);
	assert.equal(credit([]).percent, 0);
});

it('does not invent an overtime start for untimed rest codes, but supports configured timed rest codes', () => {
	const actual = [interval('08:00:00', '20:00:00')];
	const untimed = creditAttendance({
		date: DATE,
		planned: plannedShift({ code: 'REST', variant: { day_type: 'REST' } }),
		intervals: actual,
		plannedOvertimeHours: 3,
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	assert.equal(untimed.anchored, false);
	assert.equal(untimed.percent, null);
	assert.equal(untimed.overtime_hours, 0);
	const timed = creditAttendance({
		date: DATE,
		planned: plannedShift({
			code: 'R08',
			variant: { day_type: 'REST', start_time: '08:00', end_time: '16:00' }
		}),
		intervals: actual,
		plannedOvertimeHours: 3,
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	assert.equal(timed.normal_hours, 8);
	assert.equal(timed.overtime_hours, 3);
});

it('credits documented pre-shift overtime chronologically without using it to fill ordinary lateness', () => {
	const approved = [interval('05:00:00', '08:00:00')];
	const input = {
		date: DATE,
		planned: SHIFT,
		plannedOvertimeHours: 3,
		approvedOvertimeIntervals: approved,
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	};
	const actual = [interval('05:00:00', '17:00:00')];
	const before = structuredClone({ actual, approved });
	const full = creditAttendance({ ...input, intervals: actual });
	assert.equal(full.normal_hours, 8);
	assert.equal(full.overtime_hours, 3);
	assert.equal(full.target_hours, 11);
	assert.equal(full.percent, 100);
	assert.equal(full.segments[0]?.kind, 'OT');
	assert.equal(full.segments[0]?.start, Date.parse(at('05:00:00')));
	assert.equal(full.segments[1]?.offset_hours, 3);
	const late = creditAttendance({
		...input,
		intervals: [interval('05:00:00', '08:00:00'), interval('09:00:00', '17:00:00')]
	});
	assert.equal(late.normal_hours, 7);
	assert.equal(late.overtime_hours, 3);
	assert.equal(late.credited_hours, 10);
	assert.equal(late.target_hours, 11);
	assert.equal(late.segments[1]?.credited_intervals[0]?.start, Date.parse(at('09:00:00')));
	assert.equal(drawnHours(late), 10);
	assert.deepEqual({ actual, approved }, before);
	const day = workDay({
		date: DATE,
		planned: SHIFT,
		row: {
			planned_overtime_hours: 3,
			approved_overtime_intervals: approved.map((span) => ({
				start: Instant(span.start),
				end: Instant(span.end)
			})),
			worked_intervals: actual.map((span) => ({
				start: Instant(span.start),
				end: Instant(span.end)
			}))
		},
		holiday: undefined,
		zone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	if (Result.isFailure(day)) throw day.failure;
	assert.equal(day.success.overtime_hours, 3);
	assert.equal(day.success.worked_hours, 11);
	assert.deepEqual(day.success.overtime_intervals, [
		{ start: `${DATE}T05:00`, end: `${DATE}T08:00` }
	]);
	assert.equal(day.success.intervals[0]?.start, `${DATE}T05:00`);
	const law = lineage('PH');
	const night = Schema.decodeUnknownSync(Schema.String)(
		law.byCode(law.versionOn(DATE), 'work_catalog', 'NIGHT_SHIFT_DIFFERENTIAL').quantity
	);
	assert.equal(evaluateStrict(night, { work: { days: [day.success] } }), 1 * 1.25 * 0.1);
});

it('floors actual documented OT shortfalls and applies the break-adjusted numeric approval cap', () => {
	const input = {
		date: DATE,
		planned: SHIFT,
		plannedOvertimeHours: 3,
		approvedOvertimeIntervals: [interval('05:00:00', '08:00:00')],
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	};
	const short = creditAttendance({ ...input, intervals: [interval('05:06:00', '17:00:00')] });
	assert.equal(short.overtime_hours, 2.5);
	assert.equal(short.overtime_intervals[0]?.start, Date.parse(at('05:06:00')));
	assert.equal(short.overtime_intervals[0]?.end, Date.parse(at('07:36:00')));
	const breakAdjusted = creditAttendance({
		...input,
		plannedOvertimeHours: 2.5,
		approvedOvertimeIntervals: [{ ...interval('05:00:00', '08:00:00'), break_minutes: 30 }],
		intervals: [interval('05:00:00', '17:00:00')]
	});
	assert.equal(breakAdjusted.overtime_hours, 2.5);
	assert.equal(breakAdjusted.normal_hours, 8);
	assert.equal(breakAdjusted.target_hours, 10.5);
	assert.equal(breakAdjusted.percent, 100);
	assert.equal(drawnHours(breakAdjusted), breakAdjusted.credited_hours);
	assert.equal(
		creditAttendance({
			...input,
			plannedOvertimeHours: 0,
			intervals: [interval('05:00:00', '20:00:00')]
		}).overtime_hours,
		0
	);
});

it('unions documented windows, excludes the ordinary frame and caps multiple OT windows once', () => {
	const out = creditAttendance({
		date: DATE,
		planned: SHIFT,
		plannedOvertimeHours: 3,
		approvedOvertimeIntervals: [
			interval('06:00:00', '09:00:00'),
			interval('07:00:00', '08:00:00'),
			interval('16:00:00', '19:00:00')
		],
		intervals: [interval('06:00:00', '19:00:00')],
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	assert.equal(out.normal_hours, 8);
	assert.equal(out.overtime_hours, 3);
	assert.deepEqual(out.overtime_intervals, [
		{ start: Date.parse(at('06:00:00')), end: Date.parse(at('08:00:00')) },
		{ start: Date.parse(at('17:00:00')), end: Date.parse(at('18:00:00')) }
	]);
	assert.equal(drawnHours(out), 11);
	const duringOrdinary = creditAttendance({
		date: DATE,
		planned: SHIFT,
		plannedOvertimeHours: 3,
		approvedOvertimeIntervals: [interval('08:00:00', '17:00:00')],
		intervals: [interval('09:00:00', '17:00:00')],
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	assert.equal(duringOrdinary.normal_hours, 7);
	assert.equal(duringOrdinary.overtime_hours, 0);
});

it('distinguishes explicit empty approval windows from the default after-shift extension', () => {
	const input = {
		date: DATE,
		planned: SHIFT,
		plannedOvertimeHours: 3,
		intervals: [interval('08:00:00', '20:00:00')],
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	};
	assert.equal(creditAttendance(input).overtime_hours, 3);
	assert.equal(creditAttendance({ ...input, approvedOvertimeIntervals: null }).overtime_hours, 3);
	assert.equal(creditAttendance({ ...input, approvedOvertimeIntervals: [] }).overtime_hours, 0);
	assert.equal(
		creditAttendance({
			...input,
			intervals: null,
			approvedOvertimeIntervals: [interval('17:00:00', '20:00:00')]
		}).percent,
		null
	);
});

it('anchors dated pre-shift and next-day OT separately across an overnight shift', () => {
	const planned = plannedShift({
		code: 'N20',
		variant: { day_type: 'WORK', start_time: '20:30', end_time: '05:30', break_minutes: 60 }
	});
	const out = creditAttendance({
		date: DATE,
		planned,
		plannedOvertimeHours: 5,
		approvedOvertimeIntervals: [
			interval('17:30:00', '20:30:00'),
			{ start: at('05:30:00', '2026-03-03'), end: at('07:30:00', '2026-03-03') }
		],
		intervals: [{ start: at('18:00:00'), end: at('07:00:00', '2026-03-03') }],
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	assert.equal(out.normal_hours, 8);
	assert.equal(out.overtime_hours, 4);
	assert.equal(out.target_hours, 13);
	assert.equal(out.segments[0]?.kind, 'OT');
	assert.equal(out.segments.at(-1)?.kind, 'OT');
	assert.equal(out.overtime_intervals[0]?.start, Date.parse(at('18:00:00')));
	assert.equal(out.overtime_intervals.at(-1)?.end, Date.parse(at('07:00:00', '2026-03-03')));
	assert.equal(drawnHours(out), 12);
});

it('nets a documented REST break before the dated catalogue prices its first eight hours and excess OT', () => {
	const planned = plannedShift({ code: 'REST', variant: { day_type: 'REST' } });
	const actual = [interval('08:00:00', '20:00:00')];
	const approved = [{ ...interval('08:00:00', '20:00:00'), break_minutes: 60 }];
	const out = creditAttendance({
		date: DATE,
		planned,
		plannedOvertimeHours: 11,
		approvedOvertimeIntervals: approved,
		intervals: actual,
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	assert.equal(out.anchored, true);
	assert.equal(out.ordinary_anchored, false);
	assert.equal(out.overtime_hours, 11);
	assert.equal(out.target_hours, 11);
	assert.equal(out.percent, 100);
	assert.equal(drawnHours(out), 11);
	const day = workDay({
		date: DATE,
		planned,
		row: {
			planned_overtime_hours: 11,
			approved_overtime_intervals: approved.map((span) => ({
				start: Instant(span.start),
				end: Instant(span.end),
				break_minutes: span.break_minutes
			})),
			worked_intervals: actual.map((span) => ({
				start: Instant(span.start),
				end: Instant(span.end)
			}))
		},
		holiday: undefined,
		zone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	});
	if (Result.isFailure(day)) throw day.failure;
	assert.equal(day.success.recorded_hours, 12);
	assert.equal(day.success.worked_hours, 11);
	assert.equal(day.success.overtime_hours, 11);
	assert.deepEqual(day.success.overtime_intervals, [
		{ start: `${DATE}T08:00`, end: `${DATE}T13:30` },
		{ start: `${DATE}T14:30`, end: `${DATE}T20:00` }
	]);
	const law = lineage('PH');
	const version = law.versionOn(DATE);
	const base = Schema.decodeUnknownSync(Schema.String)(
		law.byCode(version, 'work_catalog', 'REST_DAY_WORK').quantity
	);
	const excess = Schema.decodeUnknownSync(Schema.String)(
		law.byCode(version, 'work_catalog', 'OVERTIME').quantity
	);
	const context = { work: { days: [day.success] }, terms: { facts: {} } };
	assert.equal(evaluateStrict(base, context), 8 * 1.3);
	assert.equal(evaluateStrict(excess, context), 3 * 1.69);
});

it('uses recorded interior gaps for an approved OT break without treating leading absence as the break', () => {
	const input = {
		date: DATE,
		planned: SHIFT,
		plannedOvertimeHours: 2.5,
		approvedOvertimeIntervals: [{ ...interval('05:00:00', '08:00:00'), break_minutes: 30 }],
		timeZone: 'Asia/Manila',
		policy: SEEDED_PAYROLL.attendance
	};
	const split = creditAttendance({
		...input,
		intervals: [interval('05:00:00', '06:00:00'), interval('06:30:00', '17:00:00')]
	});
	assert.equal(split.overtime_hours, 2.5);
	assert.equal(split.target_hours, 10.5);
	assert.equal(split.percent, 100);
	const late = creditAttendance({ ...input, intervals: [interval('05:30:00', '17:00:00')] });
	assert.equal(late.overtime_hours, 2);
	assert.equal(late.overtime_intervals[0]?.start, Date.parse(at('05:30:00')));
	assert.equal(late.target_hours, 10.5);
	assert.equal(drawnHours(late), 10);
});

it('the version’s attendance step and rounding decide credited hours, not the engine', () => {
	// 08:10 to 17:00 less the hour's break: 7h50m of ordinary time.
	const late = [interval('08:10:00', '17:00:00')];
	const credited = (policy: AttendancePolicy) =>
		creditAttendance({
			date: DATE,
			intervals: late,
			planned: SHIFT,
			plannedOvertimeHours: 0,
			timeZone: 'Asia/Manila',
			policy
		}).normal_hours;
	assert.equal(credited(SEEDED_PAYROLL.attendance), 7.5);
	assert.equal(credited({ ...SEEDED_PAYROLL.attendance, step_hours: 0.25 }), 7.75);
	assert.equal(credited({ ...SEEDED_PAYROLL.attendance, rounding: 'HALF_UP' }), 8);
});

it('the version lists the untimed day types credited on recorded hours as overtime', () => {
	const day = (untimed_credit_day_types: readonly string[]) =>
		Result.getOrThrow(
			workDay({
				date: DATE,
				planned: plannedShift({ code: 'REST', variant: { day_type: 'REST' } }),
				row: {
					worked_intervals: [{ start: Instant(at('08:00:00')), end: Instant(at('12:15:00')) }]
				},
				holiday: undefined,
				zone: 'Asia/Manila',
				policy: { ...SEEDED_PAYROLL.attendance, untimed_credit_day_types }
			})
		);
	const seeded = day(SEEDED_PAYROLL.attendance.untimed_credit_day_types);
	assert.equal(seeded.worked, true);
	assert.equal(seeded.worked_hours, 4);
	assert.deepEqual(seeded.overtime_intervals, [{ start: `${DATE}T08:00`, end: `${DATE}T12:00` }]);
	const unlisted = day([]);
	assert.equal(unlisted.worked, false);
	assert.equal(unlisted.worked_hours, 0);
	assert.deepEqual(unlisted.overtime_intervals, []);
});

it('the version decides whether approved overtime without windows runs on after the shift', () => {
	const input = {
		date: DATE,
		planned: SHIFT,
		plannedOvertimeHours: 3,
		intervals: [interval('08:00:00', '20:00:00')],
		approvedOvertimeIntervals: null,
		timeZone: 'Asia/Manila'
	};
	assert.equal(creditAttendance({ ...input, policy: SEEDED_PAYROLL.attendance }).overtime_hours, 3);
	const explicit: AttendancePolicy = { ...SEEDED_PAYROLL.attendance, overtime_window: 'EXPLICIT' };
	assert.equal(creditAttendance({ ...input, policy: explicit }).overtime_hours, 0);
	assert.equal(
		creditAttendance({
			...input,
			approvedOvertimeIntervals: [interval('17:00:00', '20:00:00')],
			policy: explicit
		}).overtime_hours,
		3
	);
});
