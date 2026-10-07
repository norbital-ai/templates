import { addDays } from '@norbital-ai/std/date';
import { automation } from '@norbital-ai/bolt';
import { utcOf } from '@norbital-ai/std/zone';
import { loadPool } from '../lib/dispatch.js';
import { openSlots } from '../lib/matching.js';

/** How far ahead the portal offers times. */
const AHEAD = 14;

/**
 * Publishes the portal's times: for each active service and each of the next two weeks, the starts at which some helper
 * with its skill is free, by the same rules a booking is matched with. The customer's address is not known here, so the
 * drive to and from it counts as the unknown-distance allowance; the booking itself is matched again when it is made.
 */
const publish_openings = automation({
	description:
		'Publishes, for each active service and each of the next two weeks, the start times at which a helper with its skill is free — the times the booking portal offers.',
	on: [
		{ cron: '*/15 * * * *' },
		{ created: 'bookings' },
		{ updated: 'visits', fields: ['helper', 'slot', 'status'] },
		{ created: 'helper_time_off' },
		{ updated: 'helpers', fields: ['status', 'skills', 'work_days', 'day_start', 'day_end'] }
	],
	runAs: ['dispatch_automation'],
	concurrency: { max: 1 }
});
export default publish_openings;

publish_openings.run(async (_, ctx) => {
	const days = Array.from({ length: AHEAD }, (_, i) => addDays(ctx.today, i));
	const [services, stored, pool] = await Promise.all([
		ctx.read('services', { where: { active: { eq: true } }, all: true }),
		ctx.read('openings', { all: true }),
		loadPool(
			ctx,
			new Date(utcOf(days[0]!, 0, ctx.tz)).toISOString(),
			new Date(utcOf(days.at(-1)!, 0, ctx.tz)).toISOString()
		)
	]);
	const have = new Map(stored.rows.map((o) => [`${o.service}|${o.day}`, o]));
	const creates = [];
	const updates = [];
	for (const s of services.rows) {
		const able = pool.helpers.filter((h) => h.skills.includes(s.skill));
		for (const day of days) {
			const starts = [
				...new Set(
					able.flatMap(
						(h) =>
							openSlots(
								h,
								{ skill: s.skill, location: null, area: h.home_area, minutes: s.duration_minutes },
								[day],
								pool,
								ctx.tz,
								ctx.now
							)[0]!.starts
					)
				)
			].sort();
			const row = have.get(`${s.id}|${day}`);
			have.delete(`${s.id}|${day}`);
			if (row === undefined) creates.push({ service: s.id, day, starts });
			else if (row.starts.join() !== starts.join())
				updates.push({ target: row.id, set: { starts } });
		}
	}
	// past days, and services no longer offered
	const gone = [...have.values()].map((o) => o.id);
	if (creates.length > 0) await ctx.act('openings.create', creates);
	if (updates.length > 0) await ctx.act('openings.update', updates);
	if (gone.length > 0) await ctx.act('openings.delete', { target: gone });
});
