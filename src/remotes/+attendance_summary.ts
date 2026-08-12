import { defineQueryHandler } from '@norbital-ai/pod/authoring';
import { z } from 'zod';
import { shiftDayKey } from '../lib/ui/calendar.js';

const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
	schema: z.object({ company_id: z.string().uuid(), from: calendarDay, to: calendarDay }),
	handler: async (
		{ company_id, from, to }: { company_id: string; from: string; to: string },
		api
	) => {
		const employments = await api.db.query.employments.findMany({
			where: {
				company_id: { eq: company_id },
				norbital_approval_id: { isNull: true }
			},
			columns: { norbital_id: true },
			limit: 5000
		});
		const employmentIds = employments.map((employment) => employment.norbital_id);
		if (employmentIds.length === 0) return [];

		const weeks: Array<{ week: string; end: string }> = [];
		for (let week = from; week <= to; week = shiftDayKey(week, 7)) {
			weeks.push({ week, end: [shiftDayKey(week, 6), to].sort()[0]! });
		}

		return Promise.all(
			weeks.map(async ({ week, end }) => {
				const scope = {
					employment_id: { in: employmentIds },
					work_date: { gte: week, lte: end }
				} as const;
				const [total, incomplete] = await Promise.all([
					api.db.time_entries.count({ where: scope }),
					api.db.time_entries.count({
						where: {
							...scope,
							OR: [
								{ state: { eq: 'OPEN' } },
								{ clock_in: { isNull: true } },
								{ clock_out: { isNull: true } }
							]
						}
					})
				]);
				return { week, exceptionRate: total === 0 ? 0 : incomplete / total };
			})
		);
	}
});
