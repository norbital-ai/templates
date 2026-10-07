import { Instant, PlainDate } from '@norbital-ai/std/date';
import { automation, type Id } from '@norbital-ai/bolt';
import { dayOf, recommend, settingsOf, VISIT, when, whatsapp } from '../lib/dispatch.js';
import { localOf } from '@norbital-ai/std/zone';
import type { Slot } from '../lib/matching.js';

const MINUTE = 60_000;

/**
 * The pre-shift check. Two hours before a helper's first visit of the day they are asked to confirm the day. No answer
 * within the hour, or a decline, and the day's visits receive replacement proposals for controller approval; a customer who asked for particular helpers is
 * told. A no-show without a medical certificate earns a warning letter.
 */
const shift_watch = automation({
	description:
		'Asks each helper to confirm their day two hours before its first visit, and proposes replacements for controller approval when they decline or do not answer, issuing a warning letter when there is no medical certificate.',
	on: [
		// not `*/5`: a cron run is keyed by its expression alone, so two automations on one expression run once between them
		{ cron: '*/10 * * * *' },
		{ updated: 'visits', where: { shift_check: { eq: 'declined' } }, fields: ['shift_check'] }
	],
	runAs: ['dispatch_automation'],
	concurrency: { max: 1 }
});
export default shift_watch;

shift_watch.run(async (_, ctx) => {
	const now = Date.parse(ctx.now);
	const at = (m: number) => Instant(new Date(now + m * MINUTE).toISOString());
	const settings = await settingsOf(ctx);

	// ask: the first unconfirmed visit of each helper's day that starts within the lead time
	const { rows: soon } = await ctx.read('visits', {
		where: {
			status: { eq: 'scheduled' },
			helper: { isNull: false },
			shift_check: { eq: 'not_due' },
			slot: { overlaps: { start: ctx.now, end: at(settings.shift_check_lead_minutes) } }
		},
		select: {
			number: true,
			slot: true,
			helper: { select: { user: true, name: true, phone: true } }
		},
		orderBy: { number: 'asc' },
		all: true
	});
	const first = new Map<string, (typeof soon)[number]>();
	for (const v of [...soon].sort((a, b) => a.slot.start.localeCompare(b.slot.start))) {
		if (Date.parse(v.slot.start) < now) continue;
		const key = `${v.helper!.id} ${dayOf(v.slot.start, ctx.tz).start}`;
		if (!first.has(key)) first.set(key, v);
	}
	const ask = [...first.values()];
	if (ask.length > 0) {
		await ctx.act(
			'visits.update',
			ask.map((v) => ({
				target: v.id,
				set: { shift_check: 'asked' as const, shift_asked_at: ctx.now }
			}))
		);
		await ctx.notify(
			ask.flatMap((v) =>
				v.helper!.user === null
					? []
					: [
							{
								to: { user: v.helper!.user },
								title: 'Confirm your shift',
								body: `Your first visit today, ${v.number}, starts soon. Confirm you are coming, or tell us you cannot.`,
								link: { collection: 'visits', id: v.id },
								once: `ask-${v.id}`
							}
						]
			)
		);
		// the phone too: an inbox notice reaches only a helper who has the app open or push enabled
		for (const v of ask)
			await ctx.send('whatsapp', {
				to: whatsapp(v.helper!.phone),
				text: `Your first visit today, ${v.number}, starts at ${when(v.slot.start, ctx.tz)}. Open My Day to confirm you are coming, or tell us you cannot.`
			});
	}

	// no answer in time: treat as not coming
	const { rows: silent } = await ctx.read('visits', {
		where: {
			status: { eq: 'scheduled' },
			helper: { isNull: false },
			shift_check: { eq: 'asked' },
			shift_asked_at: { lte: at(-settings.shift_reply_minutes) }
		},
		select: { helper: true, slot: true, mc: true },
		all: true
	});
	// declined and still held: every run picks these up, so a decline is handled even if its own trigger was skipped
	const { rows: declined } = await ctx.read('visits', {
		where: {
			status: { eq: 'scheduled' },
			helper: { isNull: false },
			shift_check: { eq: 'declined' }
		},
		select: { helper: true, slot: true, mc: true },
		all: true
	});

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
	const warnings = [...days.values()].filter((d) => d.warn !== null);
	if (warnings.length > 0)
		await ctx.act(
			'helper_warnings.create',
			warnings.map((d) => ({
				helper: d.helper,
				visit: d.visit,
				reason: d.warn!,
				issued_at: ctx.now
			}))
		);
	for (const d of days.values()) {
		const { rows } = await ctx.read('visits', {
			where: { helper: { eq: d.helper }, status: { eq: 'scheduled' }, slot: { overlaps: d.day } },
			select: VISIT,
			all: true
		});
		const date = PlainDate(localOf(Date.parse(d.day.start), ctx.tz).date);
		const existing = await ctx.read('helper_time_off', {
			where: { helper: { eq: d.helper }, period: { overlaps: { from: date, to: date } } },
			limit: 1
		});
		if (existing.rows.length === 0)
			await ctx.act('helper_time_off.create', {
				helper: d.helper,
				period: { from: date, to: date },
				reason: d.warn === null ? 'medical' : 'other'
			});
		if (d.warn === 'no_response')
			await ctx.act(
				'visits.update',
				rows.map((v) => ({ target: v.id, set: { shift_check: 'no_response' as const } }))
			);
		await recommend(ctx, rows, d.helper);
	}
});
