import { DateTime, Effect } from 'effect';
import { automation } from '@norbital-ai/bolt';
import { learnLegs, loadPool, settingsOf, targetOf } from '../lib/dispatch.js';
import {
	availableSlots,
	BOOKING_AHEAD,
	legOf,
	lookups,
	normalizeSkill,
	occurrences,
	type Point
} from '../lib/matching.js';

export default automation({
	description:
		'Calculates customer-specific open start times using service skill, provider preference, address travel, and recurrence.',
	input: { ids: { kind: 'ref', to: 'availability_requests', many: true, min_items: 1 } },
	policies: ['dispatch_automation'],
	run: function* ({ ids }, ctx) {
		const { booking_horizon_days } = yield* settingsOf(ctx);
		const { rows } = (yield* ctx.query({
			availability_requests: {
				where: { id: { in: ids }, status: { eq: 'pending' } },
				limit: ids.length + 1
			}
		})).availability_requests;
		for (const r of rows) {
			const service =
				(yield* ctx.query({ services: { where: { id: { eq: r.service } }, limit: 1 } })).services
					.rows[0] ?? null;
			const fail = Effect.fnUntraced(function* (problem: string) {
				return yield* ctx.act({
					'availability_requests.update': [
						{ target: targetOf(r), set: { status: 'failed', problem, checked_at: ctx.now } }
					]
				});
			});
			if (service === null || !service.active) {
				yield* fail('Select an active service.');
				continue;
			}
			if (r.preference === 'preferred' && r.provider === null) {
				yield* fail('Select a preferred provider.');
				continue;
			}
			const known = (yield* ctx.query({
				customers: { where: { phone: { eq: r.phone } }, limit: 1 }
			})).customers.rows[0];
			const savedLocation =
				r.location ?? (known?.address === r.address ? known.location : null) ?? null;
			const hits =
				savedLocation !== null
					? []
					: yield* ctx.geo
							.search(r.address)
							.pipe(Effect.catch((failure) => Effect.logWarning(failure).pipe(Effect.as([]))));
			const location = savedLocation ?? hits[0]?.point ?? null;
			const day = (i: number) =>
				DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(ctx.today), { days: i }));
			const days = Array.from({ length: booking_horizon_days }, (_, i) => day(i));
			const from = DateTime.formatIso(
				DateTime.makeZonedUnsafe(day(0), { timeZone: ctx.tz, adjustForTimeZone: true })
			);
			const last = DateTime.formatIso(
				DateTime.makeZonedUnsafe(day(booking_horizon_days - 1), {
					timeZone: ctx.tz,
					adjustForTimeZone: true
				})
			);
			const end = occurrences(last, r.repeat, BOOKING_AHEAD, ctx.tz).at(-1);
			if (end === undefined) {
				yield* fail('The booking has no scheduled occurrences.');
				continue;
			}
			const pool = yield* loadPool(ctx, from, end, [location]);
			const preferred = r.preference === 'preferred' && r.provider !== null ? [r.provider] : [];
			const selected = pool.providers.find((p) => p.id === r.provider);
			if (r.preference === 'preferred' && selected === undefined) {
				yield* fail('The selected provider is not available.');
				continue;
			}
			const wantSkill = normalizeSkill(service.skill);
			if (selected && !selected.skills.some((s) => normalizeSkill(s) === wantSkill)) {
				yield* fail(`${selected.name} is not qualified for the selected service.`);
				continue;
			}
			const drive = new Map(pool.drive);
			const points = [
				...pool.providers.map((p) => p.home_location),
				...pool.busy.map((a) => a.location)
			].filter((p): p is Point => p !== null);
			const allPoints = [...new Map(points.map((p) => [`${p.lat},${p.lng}`, p])).values()];
			const unique = allPoints.slice(0, 24);
			if (location !== null) {
				const learned = yield* learnLegs(
					ctx,
					[
						{ from: location, to: unique },
						...unique.map((origin) => ({ from: origin, to: [location] }))
					],
					drive
				);
				for (const row of learned) drive.set(row.leg, row.minutes);
			}
			const keyMissing =
				location === null ||
				lookups(pool, [location], ctx.tz).some((key) => !drive.has(key)) ||
				allPoints.length > unique.length ||
				unique.some((p) =>
					[legOf(location, p), legOf(p, location)].some((key) => key !== null && !drive.has(key))
				);
			const starts = availableSlots(
				{ skill: service.skill, minutes: service.duration_minutes, location },
				days,
				{ ...pool, drive },
				ctx.tz,
				ctx.now,
				r.repeat,
				BOOKING_AHEAD,
				preferred
			).flatMap((d) => d.starts);
			const timed = [...drive]
				.filter(([leg]) => !pool.drive?.has(leg))
				.map(([leg, minutes]) => ({ leg, minutes }));
			if (timed.length > 0)
				yield* ctx
					.act(
						{ 'drive_times.create': timed },
						{
							key: `drives:${timed
								.map((row) => row.leg)
								.sort()
								.join('|')}`
						}
					)
					.pipe(
						Effect.catchTags({ ActConflict: () => Effect.void, ActRefused: () => Effect.void })
					);
			yield* ctx.act({
				'availability_requests.update': [
					{
						target: targetOf(r),
						set: { status: 'ready', starts, location, estimated: keyMissing, checked_at: ctx.now }
					}
				]
			});
		}
	}
});
