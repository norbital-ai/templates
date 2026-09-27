import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { missingReason } from '../../../lib/pricing.js';

/**
 * Raises an invoice only against a confirmed quote and copies the account, currency and tax basis down from it
 * (numbered `SI-<year>-<n>`). Issuing needs at least one line; cancelling needs a reason; an issued or cancelled
 * invoice is frozen.
 */
const c = collection('sales_invoices', {
	read: { fields: 'all' },
	create: { input: { columns: ['quote_id', 'owner_id', 'status'] } },
	update: { input: { columns: ['owner_id', 'status', 'cancel_reason'] } }
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'sales_invoices'>) => {
	const issuing = inputs.flatMap((input, i) =>
		input.status === 'issued' ? [ctx.existing[i]!.id] : []
	);
	const [quotes, lines] = await Promise.all([
		ctx.db.read('quotes', {
			where: { id: { in: inputs.flatMap((input) => input.quote_id ?? []) } },
			all: true
		}),
		ctx.db.read('sales_invoice_lines', { where: { sales_invoice_id: { in: issuing } }, all: true })
	]);
	const withLines = new Set(lines.rows.map((l) => l.sales_invoice_id));
	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		if (stored === undefined) {
			const quote = quotes.rows.find((q) => q.id === input.quote_id);
			if (!quote) ctx.refuse('Referenced quote does not exist.');
			if (quote.status !== 'confirmed')
				ctx.refuse('Invoices can only be raised against a confirmed quote.');
			return {
				...input,
				account_id: quote.account_id,
				currency: quote.currency,
				tax_inclusive: quote.tax_inclusive
			};
		}
		const from = stored.status,
			to = input.status ?? from;
		if (from === to) {
			if (from !== 'draft')
				ctx.refuse(`An ${from} sales invoice is immutable. Revise by raising a new invoice.`);
			return input;
		}
		if (to === 'issued') {
			if (!withLines.has(stored.id))
				ctx.refuse('A sales invoice must have at least one line before it can be issued.');
			return { ...input, ...(stored.issued_at == null ? { issued_at: ctx.now } : {}) };
		}
		if (missingReason(input.cancel_reason ?? stored.cancel_reason))
			ctx.refuse('A cancellation reason is required.');
		return { ...input, ...(stored.cancelled_at == null ? { cancelled_at: ctx.now } : {}) };
	});
});
