import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateRow } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { addDays, Instant as instant } from '@norbital-ai/std/date';
import { utcOf } from '@norbital-ai/std/zone';
import { loadPool, when, observedOf } from '../lib/dispatch.js';
import { proposal } from '../lib/matching.js';

export default automation('helpers_offboard', {
	description:
		'Marks the helper as left after their last day and proposes, for each of their later visits, the helper with the closest skills at the same time or the nearest time anyone is free.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'helpers' }, min: 1 },
		last_day: { kind: 'date' }
	},
	output: { kind: 'object', fields: { proposed: { kind: 'int' }, open: { kind: 'int' } } },
	runAs: 'trigger',
	run: function* ({ last_day, targets }, ctx) {
		const { rows: targetsOf } = yield* ctx.query('helpers', {
			where: { id: { in: targets } },
			all: true
		});
		if (targetsOf.length !== targets.length)
			return yield* new Refusal({
				message: 'The selected record does not exist or is not readable.',
				field: 'targets'
			});
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateRow<'customer_notices'>[] = [];
		const helperUpdates: Extract<ActInput<'helpers.update'>, readonly unknown[]>[number][] = [];
		const visitRevisions = new Map<string, number>();
		let proposed = 0,
			openCount = 0;
		for (const helper of targetsOf) {
			if (helper.status !== 'active')
				return yield* new Refusal({ message: `${helper.name} has already left.` });
			const after = instant(new Date(utcOf(addDays(last_day, 1), 0, ctx.tz)).toISOString());
			const { rows: later } = yield* ctx.query('visits', {
				where: {
					helper: { eq: helper.id },
					status: { eq: 'scheduled' },
					slot: { overlaps: { start: after, end: null } }
				},
				select: {
					revision: true,
					number: true,
					slot: true,
					location: true,
					area: true,
					skill: true,
					booking: { select: { customer: true } }
				},
				all: true
			});
			for (const row of later) visitRevisions.set(row.id, row.revision);
			const starts = later.map((v) => v.slot.start).sort();
			const pool =
				later.length === 0
					? null
					: yield* loadPool(
							ctx,
							starts[0]!,
							starts.at(-1)!,
							later.map((v) => v.location)
						);
			const others = {
				...pool!,
				helpers: (pool?.helpers ?? []).filter((h) => h.id !== helper.id)
			};
			const busy = [...(pool?.busy ?? [])];
			const names = new Map(others.helpers.map((h) => [h.id, h.name]));
			let open = 0;
			for (const v of later) {
				const need = {
					skill: v.skill,
					slot: { start: v.slot.start, end: v.slot.end! },
					location: v.location,
					area: v.area,
					visit: v.id
				};
				const found = proposal(need, helper.skills, { ...others, busy }, ctx.tz);
				if (found === null) open += 1;
				else busy.push({ id: v.id, helper: found.helper, slot: found.slot, location: v.location });
				updates.push({
					target: v.id,
					set: {
						helper: null,
						proposed_helper: found?.helper ?? null,
						proposed_slot: found?.slot ?? null,
						shift_check: 'not_due' as const,
						attention: 'helper_left' as const
					}
				});
				if (found !== null)
					notices.push({
						customer: v.booking.customer,
						visit: v.id,
						subject: `A change to your visit on ${when(v.slot.start, ctx.tz)}`,
						body: `${helper.name} is no longer with us. For visit ${v.number} we propose ${names.get(found.helper)} on ${when(found.slot.start, ctx.tz)}. Reply to this email to accept or to ask for another time.`
					});
			}
			helperUpdates.push({
				target: helper.id,
				set: { status: 'left', left_on: last_day }
			});
			proposed += later.length - open;
			openCount += open;
		}
		yield* ctx.act.many([
			{ callable: 'helpers.update', input: helperUpdates, observed: observedOf(targetsOf) },
			...(updates.length > 0
				? [
						{
							callable: 'visits.update' as const,
							input: updates,
							observed: Object.fromEntries(visitRevisions)
						}
					]
				: []),
			...(notices.length > 0
				? [{ callable: 'customer_notices.create' as const, input: notices }]
				: [])
		]);
		return { proposed, open: openCount };
	}
});
