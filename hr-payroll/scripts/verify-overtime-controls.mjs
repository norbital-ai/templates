/**
 * Overtime controls: planned hours become money, and the clock only confirms the day was worked.
 *
 * The payable hours are the day's planned entries (`deriveDailyOvertime`): the approved overtime
 * within the limits and the incentive hours beyond them, split when the day was written. The
 * version's `bands` price them; the incentive hours are the top of the day and settle on the
 * band's INCENTIVE line at its own award. These checks exercise both halves against the source.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteResource = Effect.acquireRelease(
	Effect.tryPromise(() =>
		createServer({
			root,
			appType: 'custom',
			logLevel: 'silent',
			server: { middlewareMode: true }
		})
	),
	(vite) => Effect.orDie(Effect.tryPromise(() => vite.close()))
);

/** 08:30–17:30 with an hour's scheduled break; attendance is recorded at UTC+8. */
const DAY_SHIFT = {
	id: 'shift-day',
	code: 'D',
	start_time: '08:30',
	end_time: '17:30',
	break_minutes: 60,
	crosses_midnight: false,
	elapsed_minutes: 540,
	paid_minutes: 480
};

const at = (date, time) => `${date}T${time}:00.000+08:00`;
const interval = (start, end) => ({ start: at('2026-03-10', start), end: at('2026-03-10', end) });
const entry = (overrides = {}) => ({
	id: 'work-day',
	work_date: '2026-03-10',
	worked_intervals: [interval('08:30', '17:30')],
	break_minutes: 60,
	...overrides
});
const scheduled = (overrides = {}) => ({
	date: '2026-03-10',
	dayType: 'ORDINARY',
	shift: DAY_SHIFT,
	clampStart: '08:30',
	normalHours: 8,
	...overrides
});

const workRules = () => ({
	proration: { by: 'CALENDAR_DAYS' },
	ordinary_divisor_days: '26',
	overtime_when: '',
	bands: [
		{
			label: '1.5',
			when: 'day_type == "ORDINARY"',
			take_hours: 'hours_beyond_normal',
			price_amount: 'hours * ordinary_hour * 1.5'
		},
		{
			label: '3.0',
			when: 'day_type == "PUBLIC_HOLIDAY"',
			take_hours: 'hours_beyond_normal',
			price_amount: 'hours * ordinary_hour * 3.0'
		}
	],
	limits: [
		{
			key: 'daily_total',
			period: 'DAY',
			measure: 'TOTAL_WORK_HOURS',
			max_hours: 12,
			unit: 'CLOCK_HOURS'
		}
	],
	breaks: [],
	weekly_rest_rule: { max_consecutive_work_days: 6, discharged_by: 'REST' },
	holiday_rest_precedence: 'REST_DAY'
});

const bandDay = (overrides = {}) => ({
	workDayId: 'day-1',
	date: '2026-03-10',
	dayType: 'ORDINARY',
	workedHours: 13,
	normalHours: 9,
	overtimeHours: 4,
	breakMinutes: 60,
	rosterCode: 'D',
	holidayKind: '',
	holidayName: '',
	monthOvertimeHours: 20,
	continuousAttendance: false,
	consecutiveHours: 4,
	...overrides
});

const rates = { ordinaryHour: 25.5, ordinaryDay: 204, dayWage: 204 };

Effect.runPromise(
	Effect.scoped(
		Effect.gen(function* () {
			const vite = yield* viteResource;
			const { priceWorkDay } = yield* Effect.tryPromise(() =>
				vite.ssrLoadModule('/src/lib/payroll/work-bands.ts')
			);
			const { evaluatedLimits } = yield* Effect.tryPromise(() =>
				vite.ssrLoadModule('/src/lib/scheduling/work-limits.ts')
			);
			const { deriveDailyOvertime } = yield* Effect.tryPromise(() =>
				vite.ssrLoadModule('/src/collections/payroll_runs/lib/overtime.ts')
			);
			const { personContext } = yield* Effect.tryPromise(() =>
				vite.ssrLoadModule('/src/collections/payroll_runs/lib/eligibility.ts')
			);

			// The CLOCK_HOURS control evaluates net of the break the shift grants: 12 clock less 1.
			assert.equal(evaluatedLimits(workRules().limits, 60).daily_total, 11);
			assert.equal(evaluatedLimits(workRules().limits, 0).daily_total, 12);

			// Overtime is keyed: a full shift earns nothing, a late clock-out with no approval earns
			// nothing, and the keyed figure is what pays.
			assert.equal(deriveDailyOvertime(entry(), scheduled(), []), null);
			assert.equal(
				deriveDailyOvertime(
					entry({ worked_intervals: [interval('08:30', '20:45')] }),
					scheduled(),
					[]
				),
				null,
				'an unapproved overrun is not payable'
			);
			const late = deriveDailyOvertime(
				entry({
					worked_intervals: [interval('08:30', '20:45')],
					approved_overtime_hours: 3,
					incentive_hours: 2
				}),
				scheduled(),
				[]
			);
			assert.equal(late.hours, 5, 'the planned three hours and two incentive hours');
			assert.equal(late.incentiveHours, 2);
			assert.equal(late.totalWorkHours, 11.25, '12.25 clocked less the recorded hour');
			assert.equal(
				deriveDailyOvertime(
					entry({ worked_intervals: [], approved_overtime_hours: 3, incentive_hours: 2 }),
					scheduled(),
					[]
				),
				null,
				'a day nobody attended pays neither entry'
			);

			// The planned incentive hours are the top of the day, at the band's own award.
			const person = personContext({
				employee: null,
				employment: { service_start: '2020-01-01' },
				terms: null,
				asOf: '2026-06-30'
			});
			const priced = priceWorkDay({
				work: workRules(),
				person,
				day: bandDay({ incentiveHours: 2 }),
				rates
			});
			assert.deepEqual(
				priced.map((row) => [row.line, row.hours, Math.round(row.amount * 100) / 100]),
				[
					['OVERTIME', 2, 76.5],
					['INCENTIVE', 2, 76.5]
				]
			);

			// A public holiday keeps its ×3 on the incentive hours.
			const holiday = priceWorkDay({
				work: workRules(),
				person,
				day: bandDay({
					dayType: 'PUBLIC_HOLIDAY',
					workedHours: 12,
					overtimeHours: 12,
					incentiveHours: 1
				}),
				rates
			});
			assert.deepEqual(
				holiday.map((row) => [row.line, row.hours, Math.round(row.amount * 100) / 100]),
				[
					['OVERTIME', 2, 153],
					['INCENTIVE', 1, 76.5]
				]
			);

			console.log('Overtime controls verified: 10 checks passed.');
		})
	)
);
