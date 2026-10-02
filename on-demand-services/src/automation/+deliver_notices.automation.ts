import { automation } from '@norbital-ai/bolt';
import { whatsapp } from '../lib/dispatch.js';

/**
 * Sends each customer notice on WhatsApp to the customer's number (their identity, so always) and records whether it
 * went. The mail, when the customer gave an address, is the `customer_mail` channel's: it sends with the notice.
 */
const deliver_notices = automation({
	description:
		'Sends each customer notice on WhatsApp to the customer’s number and records whether it went.',
	on: { created: 'customer_notices' },
	runAs: ['dispatch_automation']
});
export default deliver_notices;

/** A thrown value's message: an `Error`'s own, anything else as text. */
const getErrorMessage = (error: unknown): string =>
	String(error instanceof Error ? error.message : error);

deliver_notices.run(async ({ ids }, ctx) => {
	const { rows } = await ctx.read('customer_notices', {
		where: { id: { in: ids }, whatsapp: { isNull: true } },
		select: { subject: true, body: true, customer: { select: { phone: true } } },
		all: true
	});
	const set = [];
	for (const n of rows) {
		let went = 'sent';
		try {
			await ctx.send('whatsapp', {
				to: whatsapp(n.customer.phone),
				text: `${n.subject}\n\n${n.body}`,
				about: { collection: 'customer_notices', id: n.id }
			});
		} catch (error) {
			went = `failed: ${getErrorMessage(error)}`;
		}
		set.push({ target: n.id, set: { whatsapp: went } });
	}
	if (set.length > 0) {
		// The mail channel can advance the same notice while WhatsApp records its send.
		// Retry only this status write on a revision conflict, never the external send.
		const recorded = await ctx.act.try('customer_notices.update', set);
		if (recorded.kind === 'conflict') await ctx.act('customer_notices.update', set);
		else if (recorded.kind !== 'committed' && recorded.kind !== 'pendingApproval')
			throw new Error(JSON.stringify(recorded));
	}
});
