import { defineQueryHandler } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { shiftDayKey } from '../lib/ui/calendar.js';
import { attendanceState } from '../lib/attendance.js';

const calendarDay = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

/**
 * Eight bounded weekly attendance counters for the dashboard.
 *
 * The browser used to download up to 500 complete time-entry records and aggregate them itself.
 * That made a chart compete with the paged table for the same large collection, and the arbitrary
 * cap made the final percentages wrong for larger teams. Counts keep the calculation beside the
 * indexed data and return only the eight points the chart renders.
 */
export default defineQueryHandler({
	description:
		'Returns weekly incomplete-attendance rates for one employing entity over a bounded calendar range.',
	schema: Schema.Struct({
		company_id: Schema.String.check(Schema.isUUID()),
		from: calendarDay,
		to: calendarDay
	}),
	handler: ({ company_id, from, to }, api) =>
		Effect.gen(function* () {
			const employmentCount = yield* api.db.employments.count({
				where: {
					company_id: { eq: company_id },
					norbital_approval_id: { isNull: true }
				}
			});
			if (employmentCount === 0) return [];

			const weeks: Array<{ week: string; end: string }> = [];
			for (let week = from; week <= to; week = shiftDayKey(week, 7)) {
				weeks.push({ week, end: [shiftDayKey(week, 6), to].sort()[0]! });
			}

			const entries = yield* api.db.query.time_entries.findMany({
				where: {
					time_entry_employment: {
						company_id: { eq: company_id },
						norbital_approval_id: { isNull: true }
					},
					work_date: { gte: from, lte: to }
				},
				columns: { work_date: true, worked_intervals: true },
				limit: 20_000
			});
			if (entries.length === 20_000) {
				throw new Error(
					'Attendance summary reached its 20,000-row safety limit. Shorten the range.'
				);
			}
			return weeks.map(({ week, end }) => {
				const inWeek = entries.filter((entry) => {
					const date = String(entry.work_date).slice(0, 10);
					return date >= week && date <= end;
				});
				const incomplete = inWeek.filter(
					(entry) => attendanceState(entry.worked_intervals) !== 'COMPLETE'
				).length;
				return { week, exceptionRate: inWeek.length === 0 ? 0 : incomplete / inWeek.length };
			});
		})
});
