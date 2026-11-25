import { automation, type Id } from '@norbital-ai/bolt';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import {
	appointmentsToMove,
	dayOf,
	recommend,
	settingsOf,
	targetOf,
	whatsapp,
	whatsappAccount
} from '../lib/dispatch.js';
import { epochMs, formatInstant } from '../lib/format.js';
import type { Slot } from '../lib/matching.js';

/**
 * Pre-shift check monitor: prompts each provider ahead of their first appointment of the day, and
 * logs time off plus prepares replacement recommendations when they decline or fail to respond in time.
 */
export default automation({
	description:
		'Prompts providers to confirm their day ahead of their first appointment and prepares replacement recommendations if they decline or do not respond.',
	on: [{ cron: '2,12,22,32,42,52 * * * *', rest: '1d' }],
	policies: ['dispatch_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const now = DateTime.makeUnsafe(ctx.now);
		const settings = yield* settingsOf(ctx);
		const { rows: soon } = (yield* ctx.query({
			appointments: {
				where: {
					status: { eq: 'scheduled' },
					provider: { is_null: false },
					shift_check: { eq: 'not_due' },
					slot: {
						overlaps: {
							start: ctx.now,
							end: DateTime.formatIso(
								DateTime.add(now, { minutes: settings.shift_check_lead_minutes })
							)
						}
					}
				},
				fields: ['revision', 'number', 'slot', 'provider'],
				order_by: { number: 'asc' },
				limit: 500,
				provider: { fields: ['user', 'name', 'phone'] }
			}
		})).appointments;
		const first = new Map<
			string,
			{
				appointment: (typeof soon)[number];
				provider: NonNullable<(typeof soon)[number]['provider']>;
			}
		>();
		for (const a of [...soon].sort((x, y) => epochMs(x.slot.start) - epochMs(y.slot.start))) {
			if (a.provider === null || DateTime.isLessThan(DateTime.makeUnsafe(a.slot.start), now))
				continue;
			const key = `${a.provider.id} ${dayOf(a.slot.start, ctx.tz).start}`;
			if (!first.has(key)) first.set(key, { appointment: a, provider: a.provider });
		}
		const ask = [...first.values()];
		if (ask.length > 0) {
			yield* ctx.act(
				{
					'appointments.update': ask.map(({ appointment: a }) => ({
						target: targetOf(a),
						set: { shift_check: 'asked' as const, shift_asked_at: ctx.now }
					}))
				},
				{
					key: `shift-ask:${ask
						.map(({ appointment: a }) => `${a.id}:${a.revision}`)
						.sort()
						.join(',')}`
				}
			);
			yield* ctx.notify(
				ask.flatMap(({ appointment: a, provider }) =>
					provider.user === null
						? []
						: [
								{
									title: 'Confirm your shift',
									to: [{ user: provider.user }],
									description: `Your first appointment today, ${a.number}, starts soon. Open My Day to confirm or report unavailability.`,
									link: { model: 'appointments', id: a.id },
									once: `ask-${a.id}`
								}
							]
				)
			);
			const account = yield* whatsappAccount(ctx);
			if (account !== null)
				for (const { appointment: a, provider } of ask)
					yield* ctx.send(account, {
						to: whatsapp(provider.phone),
						text: `Your first appointment today, ${a.number}, starts at ${formatInstant(a.slot.start, ctx.tz)}. Open My Day to confirm your shift or report unavailability.`
					});
		}
		const { rows: silent } = (yield* ctx.query({
			appointments: {
				where: {
					status: { eq: 'scheduled' },
					provider: { is_null: false },
					shift_check: { eq: 'asked' },
					shift_asked_at: {
						lte: DateTime.formatIso(
							DateTime.subtract(now, { minutes: settings.shift_reply_minutes })
						)
					}
				},
				fields: ['provider', 'slot'],
				limit: 500
			}
		})).appointments;
		const { rows: declined } = (yield* ctx.query({
			appointments: {
				where: {
					status: { eq: 'scheduled' },
					provider: { is_null: false },
					shift_check: { eq: 'declined' }
				},
				fields: ['provider', 'slot'],
				limit: 500
			}
		})).appointments;
		const days = new Map<string, { provider: Id<'providers'>; day: Slot; lapsed: boolean }>();
		for (const [rows, lapsed] of [
			[silent, true],
			[declined, false]
		] as const)
			for (const a of rows) {
				if (a.provider === null) continue;
				const day = dayOf(a.slot.start, ctx.tz);
				const key = `${a.provider} ${day.start}`;
				if (!days.has(key)) days.set(key, { provider: a.provider, day, lapsed });
			}
		if (days.size === 0) return;
		for (const d of days.values()) {
			const { rows } = (yield* ctx.query(
				appointmentsToMove({
					provider: { eq: d.provider },
					status: { eq: 'scheduled' },
					slot: { overlaps: d.day }
				})
			)).appointments;
			const date = DateTime.formatIsoDate(
				DateTime.makeZonedUnsafe(d.day.start, { timeZone: ctx.tz })
			);
			const existing = (yield* ctx.query({
				provider_time_off: {
					where: { provider: { eq: d.provider }, period: { overlaps: { from: date, to: date } } },
					limit: 1
				}
			})).provider_time_off;
			if (existing.rows.length === 0)
				yield* ctx
					.act(
						{
							'provider_time_off.create': [
								{
									provider: d.provider,
									period: { from: date, to: date },
									reason: 'unavailable'
								}
							]
						},
						{ key: `time-off:${d.provider}:${date}` }
					)
					.pipe(Effect.catchTag('ActConflict', () => Effect.void));
			yield* recommend(ctx, rows, d.provider, d.lapsed).pipe(
				Effect.catchTag('ActConflict', () => Effect.void)
			);
		}
	}
});
