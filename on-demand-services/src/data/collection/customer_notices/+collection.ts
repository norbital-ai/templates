import { collection } from '@norbital-ai/bolt';

/**
 * Append-only: a notice is filed once; afterwards only its sends are recorded — WhatsApp by the `deliver_notices` run,
 * the mail by the `customer_mail` channel's events. The customer's email address is taken when the notice is filed.
 */
const notices = collection('customer_notices', {
	read: { fields: 'all' },
	create: { input: { columns: ['customer', 'visit', 'subject', 'body'] } },
	update: {
		input: {
			columns: [
				'whatsapp',
				'delivery',
				'delivery_reason',
				'sent_at',
				'delivered_at',
				'delivery_presumed',
				'opened_at',
				'replied_at',
				'reply_excerpt',
				'auto_replied_at'
			]
		}
	}
});
export default notices;

notices.transform(async (inputs, ctx) => {
	const ids = inputs.flatMap((input, i) =>
		ctx.existing[i] === undefined && input.customer != null ? [input.customer] : []
	);
	if (ids.length === 0) return inputs;
	const { rows } = await ctx.db.read('customers', {
		where: { id: { in: ids } },
		select: { email: true },
		all: true
	});
	const email = new Map(rows.map((c) => [String(c.id), c.email]));
	return inputs.map((input, i) => {
		if (ctx.existing[i] !== undefined || input.customer == null) return input;
		const to = email.get(String(input.customer)) ?? null;
		return { ...input, to_address: to, delivery: to === null ? null : 'queued' };
	});
});
