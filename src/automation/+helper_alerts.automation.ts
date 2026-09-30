import { automation, type Id } from '@norbital-ai/bolt';
import { when, whatsapp } from '../lib/dispatch.js';

/**
 * Tells a helper on WhatsApp when visits are given to them — booked, reassigned, or accepted from a proposal — one message
 * per helper listing their new visits, so a change of plan reaches their phone and not only the app.
 */
const helper_alerts = automation({
	description:
		'Messages each helper on WhatsApp the visits newly assigned to them, one message per helper.',
	on: [
		{ created: 'visits', where: { helper: { isNull: false } } },
		{ updated: 'visits', fields: ['helper'], where: { helper: { isNull: false } } }
	],
	runAs: ['dispatch_automation']
});
export default helper_alerts;

helper_alerts.run(async ({ ids }, ctx) => {
	if (ids === undefined || ids.length === 0) return;
	const { rows } = await ctx.read('visits', {
		where: {
			id: { in: ids },
			status: { eq: 'scheduled' },
			helper: { isNull: false },
			slot: { overlaps: { start: ctx.now, end: null } }
		},
		select: { number: true, slot: true, address: true, helper: { select: { phone: true } } },
		all: true
	});
	const byHelper = new Map<Id<'helpers'>, { phone: string; lines: string[] }>();
	for (const v of [...rows].sort((a, b) => a.slot.start.localeCompare(b.slot.start))) {
		const h = v.helper!;
		const entry = byHelper.get(h.id) ?? { phone: h.phone, lines: [] };
		entry.lines.push(`• ${v.number}: ${when(v.slot.start, ctx.tz)}, ${v.address}`);
		byHelper.set(h.id, entry);
	}
	for (const [, { phone, lines }] of byHelper)
		await ctx.send('whatsapp', {
			to: whatsapp(phone),
			text: `New visit${lines.length === 1 ? '' : 's'} for you:\n${lines.join('\n')}`
		});
});
