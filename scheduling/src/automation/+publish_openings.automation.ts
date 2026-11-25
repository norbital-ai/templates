import { DateTime, Effect } from 'effect';
import { automation, type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { loadPool, settingsOf, targetOf } from '../lib/dispatch.js';
import { epochMs } from '../lib/format.js';
import { normalizeSkill, openSlots } from '../lib/matching.js';

/**
 * Publishes anonymous portal openings for every active service across `booking_horizon_days`.
 * Destination is unknown here, so travel uses the fallback allowance; exact travel is rechecked
 * per customer in `prepare_availability` and `portal_intake`.
 */
export default automation({
	description:
		'Publishes available start times for every active service across the configured booking horizon for the public portal.',
	on: [{ cron: '3,18,33,48 * * * *', rest: '1d' }],
	policies: ['dispatch_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const { booking_horizon_days } = yield* settingsOf(ctx);
		const day = (i: number) =>
			DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(ctx.today), { days: i }));
		const days = Array.from({ length: booking_horizon_days }, (_, i) => day(i));
		const [{ services, openings: stored }, pool] = yield* Effect.all(
			[
				ctx.query({
					services: { where: { active: { eq: true } }, limit: 200 },
					openings: { limit: 5000 }
				}),
				loadPool(
					ctx,
					DateTime.formatIso(
						DateTime.makeZonedUnsafe(ctx.today, { timeZone: ctx.tz, adjustForTimeZone: true })
					),
					DateTime.formatIso(
						DateTime.makeZonedUnsafe(day(booking_horizon_days - 1), {
							timeZone: ctx.tz,
							adjustForTimeZone: true
						})
					)
				)
			],
			{ concurrency: 'unbounded' }
		);
		const have = new Map(stored.rows.map((o) => [`${o.service}|${o.day}`, o]));
		const creates: CreateInput<'openings'>[] = [];
		const updates: Extract<ActInput<'openings.update'>, readonly unknown[]>[number][] = [];
		for (const s of services.rows) {
			const wantSkill = normalizeSkill(s.skill);
			const able = pool.providers.filter((p) =>
				p.skills.some((ps) => normalizeSkill(ps) === wantSkill)
			);
			for (const d of days) {
				const starts = [
					...new Set(
						able.flatMap((p) =>
							openSlots(
								p,
								{ skill: s.skill, location: null, minutes: s.duration_minutes },
								[d],
								pool,
								ctx.tz,
								ctx.now
							).flatMap((slot) => slot.starts)
						)
					)
				].sort((a, b) => epochMs(a) - epochMs(b));
				const row = have.get(`${s.id}|${d}`);
				have.delete(`${s.id}|${d}`);
				if (row === undefined) creates.push({ service: s.id, day: d, starts });
				else if (row.starts.join() !== starts.join())
					updates.push({ target: targetOf(row), set: { starts } });
			}
		}
		const gone = [...have.values()].map(targetOf);
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
