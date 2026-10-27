import { Instant, PlainDate } from '@norbital-ai/std/date';
import { automation, isMasked, type Id } from '@norbital-ai/bolt';
import * as Effect from 'effect/Effect';
import { dayOf, recommend, settingsOf, visitsToMove, when, whatsapp } from '../lib/dispatch.js';
import { localOf } from '@norbital-ai/std/zone';
import type { Slot } from '../lib/matching.js';
const MINUTE = 60000;
/**
 * The pre-shift check. Two hours before a helper's first visit of the day they are asked to confirm the day. No answer
 * within the hour, or a decline, and the day's visits receive replacement proposals for controller approval; a customer who asked for particular helpers is
 * told. A no-show without a medical certificate earns a warning letter.
 */
export default automation('shift_watch', {
	description:
		'Asks each helper to confirm their day two hours before its first visit, and proposes replacements for controller approval when they decline or do not answer, issuing a warning letter when there is no medical certificate.',
	on: [
		// not `*/5`: a cron run is keyed by its expression alone, so two automations on one expression run once between them
		{ cron: '*/10 * * * *' },
		{ updated: 'visits', where: { shift_check: { eq: 'declined' } }, fields: ['shift_check'] }
	],
	runAs: ['dispatch_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const now = Date.parse(ctx.now);
		const at = (m: number) => Instant(new Date(now + m * MINUTE).toISOString());
		const settings = yield* settingsOf(ctx);
		// ask: the first unconfirmed visit of each helper's day that starts within the lead time
		const { rows: soon } = (yield* ctx.query({
			visits: {
				where: {
					status: { eq: 'scheduled' },
					helper: { isNull: false },
					shift_check: { eq: 'not_due' },
					slot: { overlaps: { start: ctx.now, end: at(settings.shift_check_lead_minutes) } }
				},
				fields: ['number', 'slot', 'helper'],
				orderBy: { number: 'asc' }
			},
			'visits.helper': { fields: ['user', 'name', 'phone'] }
		})).visits;
		const first = new Map<string, (typeof soon)[number]>();
		for (const v of [...soon].sort((a, b) => a.slot.start.localeCompare(b.slot.start))) {
			if (Date.parse(v.slot.start) < now) continue;
			const key = `${v.helper!.id} ${dayOf(v.slot.start, ctx.tz).start}`;
			if (!first.has(key)) first.set(key, v);
		}
		const ask = [...first.values()];
		if (ask.length > 0) {
			yield* ctx.act(
				'visits.update',
				ask.map((v) => ({
					target: v.id,
					set: { shift_check: 'asked' as const, shift_asked_at: ctx.now }
				}))
			);
			yield* ctx.notify(
				ask.flatMap((v) =>
					v.helper!.user === null || isMasked(v.helper!.user)
						? []
						: [
								{
									title: 'Confirm your shift',
									to: [{ user: v.helper!.user }],
									description: `Your first visit today, ${v.number}, starts soon. Confirm you are coming, or tell us you cannot.`,
									link: { model: 'visits', id: v.id },
									once: `ask-${v.id}`
								}
							]
				)
			);
			// the phone too: an inbox notice reaches only a helper who has the app open or push enabled
			for (const v of ask)
				yield* ctx.send('whatsapp', {
					to: whatsapp(v.helper!.phone),
					text: `Your first visit today, ${v.number}, starts at ${when(v.slot.start, ctx.tz)}. Open My Day to confirm you are coming, or tell us you cannot.`
				});
		}
		// no answer in time: treat as not coming
		const { rows: silent } = (yield* ctx.query({
			visits: {
				where: {
					status: { eq: 'scheduled' },
					helper: { isNull: false },
					shift_check: { eq: 'asked' },
					shift_asked_at: { lte: at(-settings.shift_reply_minutes) }
				},
				fields: ['helper', 'slot', 'mc']
			}
		})).visits;
		// declined and still held: every run picks these up, so a decline is handled even if its own trigger was skipped
		const { rows: declined } = (yield* ctx.query({
			visits: {
				where: {
					status: { eq: 'scheduled' },
					helper: { isNull: false },
					shift_check: { eq: 'declined' }
				},
				fields: ['helper', 'slot', 'mc']
			}
		})).visits;
		// one warning and one recovery plan per helper's day
		const days = new Map<
			string,
			{
				helper: Id<'helpers'>;
				visit: Id<'visits'>;
				day: Slot;
				warn: 'no_response' | 'declined_without_mc' | null;
			}
		>();
		for (const [rows, reason] of [
			[silent, 'no_response'],
			[declined, 'declined_without_mc']
		] as const)
			for (const v of rows) {
				const day = dayOf(v.slot.start, ctx.tz);
				const key = `${v.helper} ${day.start}`;
				if (!days.has(key))
					days.set(key, { helper: v.helper!, visit: v.id, day, warn: v.mc ? null : reason });
			}
		if (days.size === 0) return;
		for (const d of days.values()) {
			// a day whose plan lost a revision race is read again next run: its warning is already filed
			if (d.warn !== null) {
				const filed = (yield* ctx.query({
					helper_warnings: {
						where: {
							helper: { eq: d.helper },
							reason: { eq: d.warn },
							visit: { is: { slot: { overlaps: d.day } } }
						},
						limit: 1
					}
				})).helper_warnings;
				if (filed.rows.length === 0)
					yield* ctx.act('helper_warnings.create', [
						{ helper: d.helper, visit: d.visit, reason: d.warn, issued_at: ctx.now }
					]);
			}
			const { rows } = (yield* ctx.query(
				visitsToMove({
					helper: { eq: d.helper },
					status: { eq: 'scheduled' },
					slot: { overlaps: d.day }
				})
			)).visits;
			const date = PlainDate(localOf(Date.parse(d.day.start), ctx.tz).date);
			const existing = (yield* ctx.query({
				helper_time_off: {
					where: { helper: { eq: d.helper }, period: { overlaps: { from: date, to: date } } },
					limit: 1
				}
			})).helper_time_off;
			if (existing.rows.length === 0)
				yield* ctx.act('helper_time_off.create', [
					{
						helper: d.helper,
						period: { from: date, to: date },
						reason: d.warn === null ? 'medical' : 'other'
					}
				]);
			// a visit of the day written since it was read is the newer writer's; a day still held is planned next run
			yield* recommend(ctx, rows, d.helper, d.warn === 'no_response').pipe(
				Effect.catchTag('ActConflict', () => Effect.void)
			);
		}
	}
});
