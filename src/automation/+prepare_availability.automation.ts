import { automation } from '@norbital-ai/bolt';
import { addDays } from '@norbital-ai/std/date';
import { utcOf } from '@norbital-ai/std/zone';
import { loadPool, googleMinutes } from '../lib/dispatch.js';
import {
	availableSlots,
	BOOKING_AHEAD,
	legOf,
	lookups,
	occurrences,
	type Point
} from '../lib/matching.js';

const prepare_availability = automation({
	description:
		'Calculates customer-specific starts after preference, skills, address, travel and recurrence are known.',
	on: { created: 'availability_requests' },
	runAs: ['dispatch_automation']
});
export default prepare_availability;

prepare_availability.run(async ({ ids }, ctx) => {
	const { rows } = await ctx.read('availability_requests', {
		where: { id: { in: ids }, status: { eq: 'pending' } },
		all: true
	});
	for (const r of rows) {
		const service = await ctx.get('services', r.service);
		const fail = async (problem: string) =>
			ctx.act('availability_requests.update', {
				target: r.id,
				set: { status: 'failed', problem, checked_at: ctx.now }
			});
		if (service === null || !service.active) {
			await fail('Pick an active service.');
			continue;
		}
		if (r.preference === 'preferred' && r.helper === null) {
			await fail('Pick a preferred helper.');
			continue;
		}
		const known = (await ctx.read('customers', { where: { phone: { eq: r.phone } }, limit: 1 }))
			.rows[0];
		const savedLocation =
			r.location ?? (known?.address === r.address ? known.location : null) ?? null;
		const hits = savedLocation !== null ? [] : await ctx.geo.search(r.address);
		const location =
			savedLocation !== null
				? savedLocation
				: Array.isArray(hits)
					? (hits[0]?.point ?? null)
					: null;
		const days = Array.from({ length: 14 }, (_, i) => addDays(ctx.today, i));
		const from = new Date(utcOf(days[0]!, 0, ctx.tz)).toISOString();
		const last = new Date(utcOf(days.at(-1)!, 0, ctx.tz)).toISOString();
		const end = occurrences(last, r.repeat, BOOKING_AHEAD, ctx.tz).at(-1)!;
		const pool = await loadPool(ctx, from, end, [location]);
		const preferred = r.preference === 'preferred' && r.helper !== null ? [r.helper] : [];
		const selected = pool.helpers.find((h) => h.id === r.helper);
		if (r.preference === 'preferred' && selected === undefined) {
			await fail('The selected helper is not available.');
			continue;
		}
		if (selected && !selected.skills.includes(service.skill)) {
			await fail(`${selected.name} cannot perform the selected service.`);
			continue;
		}
		// ponytail: bounded route fetches; existing cache/estimates cover larger rosters rather than an unbounded API fan-out.
		const drive = new Map(pool.drive);
		const points = [
			...pool.helpers.map((h) => h.home_location),
			...pool.busy.map((v) => v.location)
		].filter((p): p is Point => p !== null);
		const allPoints = [...new Map(points.map((p) => [`${p.lat},${p.lng}`, p])).values()];
		const unique = allPoints.slice(0, 24);
		if (
			location !== null &&
			unique.some((p) =>
				[legOf(location, p), legOf(p, location)].some((k) => k !== null && !drive.has(k))
			)
		) {
			const outgoing = await googleMinutes(ctx, location, unique, false);
			if (outgoing !== null) {
				for (const [i, point] of unique.entries()) {
					const key = legOf(location, point);
					if (key !== null && !drive.has(key) && outgoing[i] !== null && outgoing[i] !== undefined)
						drive.set(key, outgoing[i]!);
					const incoming = await googleMinutes(ctx, point, [location], false);
					const reverse = legOf(point, location);
					if (incoming !== null && incoming[0] !== null && reverse !== null && !drive.has(reverse))
						drive.set(reverse, incoming[0]!);
				}
			}
		}
		const keyMissing =
			location === null ||
			lookups(pool, [location], ctx.tz).some((key) => !drive.has(key)) ||
			allPoints.length > unique.length ||
			unique.some((p) =>
				[legOf(location, p), legOf(p, location)].some((key) => key !== null && !drive.has(key))
			);
		const starts = availableSlots(
			{ skill: service.skill, minutes: service.duration_minutes, location, area: r.area },
			days,
			{ ...pool, drive },
			ctx.tz,
			ctx.now,
			r.repeat,
			BOOKING_AHEAD,
			preferred
		).flatMap((d) => d.starts);
		// Save successfully timed legs so confirmation uses the same route data. Existing cache rows are immutable.
		const timed = [...drive]
			.filter(([leg]) => !pool.drive?.has(leg))
			.map(([leg, minutes]) => ({ leg, minutes }));
		if (timed.length > 0) await ctx.act('drive_times.create', timed);
		await ctx.act('availability_requests.update', {
			target: r.id,
			set: { status: 'ready', starts, location, estimated: keyMissing, checked_at: ctx.now }
		});
	}
});
