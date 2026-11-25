import { automation, type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { DateTime } from 'effect';
import { loadPool, targetOf } from '../lib/dispatch.js';
import { epochMs, formatInstant } from '../lib/format.js';
import { closedSlot, proposal, type Pool } from '../lib/matching.js';

export default automation({
	description:
		'Marks a provider inactive after their last working day and proposes closest-skill replacement providers for each later scheduled appointment.',
	input: {
		targets: { kind: 'rows', of: 'providers' },
		last_day: { kind: 'date' }
	},
	output: { kind: 'object', fields: { proposed: { kind: 'int' }, open: { kind: 'int' } } },
	policies: ['operations'],
	run: function* ({ last_day, targets }, ctx) {
		const updates: Extract<ActInput<'appointments.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		const providerUpdates: Extract<ActInput<'providers.update'>, readonly unknown[]>[number][] = [];
		let proposed = 0;
		let openCount = 0;
		for (const provider of targets) {
			if (provider.status !== 'active')
				return yield* ctx.refuse('errors.provider_already_inactive', {
					values: { name: provider.name }
				});
			const after = DateTime.formatIso(
				DateTime.add(
					DateTime.makeZonedUnsafe(last_day, { timeZone: ctx.tz, adjustForTimeZone: true }),
					{ days: 1 }
				)
			);
			const { rows: later } = (yield* ctx.query({
				appointments: {
					where: {
						provider: { eq: provider.id },
						status: { eq: 'scheduled' },
						slot: { overlaps: { start: after, end: null } }
					},
					fields: ['revision', 'number', 'slot', 'location', 'skill', 'booking'],
					limit: 500,
					booking: { fields: ['customer'] }
				}
			})).appointments;
			const starts = later.map((a) => a.slot.start).sort((a, b) => epochMs(a) - epochMs(b));
			const first = starts.at(0);
			const last = starts.at(-1);
			const pool: Pool =
				first === undefined || last === undefined
					? { providers: [], busy: [], off: [] }
					: yield* loadPool(
							ctx,
							first,
							last,
							later.map((a) => a.location)
						);
			const others = { ...pool, providers: pool.providers.filter((p) => p.id !== provider.id) };
			const busy = [...pool.busy];
			const names = new Map(others.providers.map((p) => [p.id, p.name]));
			let open = 0;
			for (const a of later) {
				const slot = closedSlot(a.slot);
				if (slot === null) continue;
				const need = { skill: a.skill, slot, location: a.location, appointment: a.id };
				const found = proposal(need, provider.skills, { ...others, busy }, ctx.tz);
				if (found === null) open += 1;
				else
					busy.push({ id: a.id, provider: found.provider, slot: found.slot, location: a.location });
				updates.push({
					target: targetOf(a),
					set: {
						provider: null,
						proposed_provider: found?.provider ?? null,
						proposed_slot: found?.slot ?? null,
						shift_check: 'not_due' as const,
						attention: 'provider_inactive' as const
					}
				});
				if (found !== null && a.booking !== null) {
					const originalWhen = formatInstant(a.slot.start, ctx.tz);
					const proposedWhen = formatInstant(found.slot.start, ctx.tz);
					notices.push({
						customer: a.booking.customer,
						appointment: a.id,
						subject: `Proposed update for your appointment on ${originalWhen}`,
						body: `${provider.name} is no longer available. For appointment ${a.number} we propose ${names.get(found.provider) ?? 'a replacement provider'} on ${proposedWhen}. Reply to confirm or request another time.`
					});
				}
			}
			providerUpdates.push({
				target: provider,
				set: { status: 'inactive', inactive_since: last_day }
			});
			proposed += later.length - open;
			openCount += open;
		}
		yield* ctx.act({
			'providers.update': providerUpdates,
			...(updates.length > 0 ? { 'appointments.update': updates } : {}),
			...(notices.length > 0 ? { 'customer_notices.create': notices } : {})
		});
		return { proposed, open: openCount };
	}
});
