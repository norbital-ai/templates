import { Effect } from 'effect';
import { add_days } from '@norbital-ai/std/date';
import { automation, type CreateInput, type ActInput } from '@norbital-ai/bolt';
import { targetOf } from '../lib/dispatch.js';
import { utc_of } from '@norbital-ai/std/zone';
import { loadPool } from '../lib/dispatch.js';
import { openSlots } from '../lib/matching.js';
/** How far ahead the portal offers times. */
const AHEAD = 14;
/**
 * Publishes the portal's times: for each active service and each of the next two weeks, the starts at which some helper
 * with its skill is free, by the same rules a booking is matched with. The customer's address is not known here, so the
 * drive to and from it counts as the unknown-distance allowance; the booking itself is matched again when it is made.
 */
export default automation({
	description:
		'Publishes, for each active service and each of the next two weeks, the start times at which a helper with its skill is free — the times the booking portal offers.',
	// also scheduled by the bookings, visits, helper_time_off and helpers effects
	on: [{ cron: '*/15 * * * *' }],
	policies: ['dispatch_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const days = Array.from({ length: AHEAD }, (_, i) => add_days(ctx.today, i));
		const [{ services, openings: stored }, pool] = yield* Effect.all(
			[
				ctx.query({ services: { where: { active: { eq: true } } }, openings: {} }),
				loadPool(
					ctx,
					new Date(utc_of(ctx.today, 0, ctx.tz)).toISOString(),
					new Date(utc_of(add_days(ctx.today, AHEAD - 1), 0, ctx.tz)).toISOString()
				)
			],
			{ concurrency: 'unbounded' }
		);
		const have = new Map(stored.rows.map((o) => [`${o.service}|${o.day}`, o]));
		const creates: CreateInput<'openings'>[] = [];
		const updates: Extract<ActInput<'openings.update'>, readonly unknown[]>[number][] = [];
		for (const s of services.rows) {
			const able = pool.helpers.filter((h) => h.skills.includes(s.skill));
			for (const day of days) {
				const starts = [
					...new Set(
						able.flatMap((h) =>
							openSlots(
								h,
								{ skill: s.skill, location: null, area: h.home_area, minutes: s.duration_minutes },
								[day],
								pool,
								ctx.tz,
								ctx.now
							).flatMap((slot) => slot.starts)
						)
					)
				].sort();
				const row = have.get(`${s.id}|${day}`);
				have.delete(`${s.id}|${day}`);
				if (row === undefined) creates.push({ service: s.id, day, starts });
				else if (row.starts.join() !== starts.join())
					updates.push({ target: targetOf(row), set: { starts } });
			}
		}
		// past days, and services no longer offered
		const gone = [...have.values()].map(targetOf);
		// a run that lost a race to another publish leaves the times to it: the newer run read the newer schedule
		if (creates.length + updates.length + gone.length > 0)
			yield* ctx
				.act({
					...(creates.length > 0 ? { 'openings.create': creates } : {}),
					...(updates.length > 0 ? { 'openings.update': updates } : {}),
					...(gone.length > 0 ? { 'openings.delete': gone.map((target) => ({ target })) } : {})
				})
				.pipe(Effect.catchTag('ActConflict', () => Effect.void));
	}
});
