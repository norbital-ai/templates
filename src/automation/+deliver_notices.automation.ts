import { automation } from '@norbital-ai/bolt';
import { whatsapp } from '../lib/dispatch.js';

/**
 * Delivers each customer notice: on WhatsApp to the customer's number (their identity, so always), and by email too when
 * they gave one. Where it went — or why it could not go — is recorded on the notice.
 */
const deliver_notices = automation({
	description:
		'Sends each customer notice on WhatsApp to the customer’s number, and by email when they gave one, and records where it went.',
	on: { created: 'customer_notices' },
	runAs: ['dispatch_automation']
});
export default deliver_notices;

/** A thrown value's message: an `Error`'s own, anything else as text. */
const getErrorMessage = (error: unknown): string =>
	String(error instanceof Error ? error.message : error);

deliver_notices.run(async ({ ids }, ctx) => {
	const { rows } = await ctx.read('customer_notices', {
		where: { id: { in: ids }, delivery: { isNull: true } },
		select: { subject: true, body: true, customer: { select: { phone: true, email: true } } },
		all: true
	});
	const set = [];
	for (const n of rows) {
		const about = { collection: 'customer_notices' as const, id: n.id };
		const went: string[] = [];
		try {
			await ctx.send('whatsapp', {
				to: whatsapp(n.customer.phone),
				text: `${n.subject}\n\n${n.body}`,
				about
			});
			went.push('whatsapp');
		} catch (error) {
			went.push(`whatsapp failed: ${getErrorMessage(error)}`);
		}
		if (n.customer.email !== null)
			try {
				await ctx.send('customer_mail', {
					to: [n.customer.email],
					subject: n.subject,
					text: n.body,
					about
				});
				went.push('email');
			} catch (error) {
				went.push(`email failed: ${getErrorMessage(error)}`);
			}
		set.push({ target: n.id, set: { delivery: went.join('; ') } });
	}
	if (set.length > 0) await ctx.act('customer_notices.update', set);
});
