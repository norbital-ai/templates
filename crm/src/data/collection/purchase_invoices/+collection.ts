import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { missingReason } from '../../../lib/pricing.js';

/**
 * Books an invoice only against a confirmed purchase order and copies the supplier, currency and tax basis down from
 * it (numbered `PI-<year>-<n>`). Confirming needs at least one line; cancelling needs a reason; a confirmed or
 * cancelled invoice is frozen.
 */
const c = collection('purchase_invoices', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: ['purchase_order_id', 'owner_id', 'invoice_reference', 'invoice_date', 'status']
		}
	},
	update: {
		input: { columns: ['owner_id', 'invoice_reference', 'invoice_date', 'status', 'cancel_reason'] }
	}
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'purchase_invoices'>) => {
	const confirming = inputs.flatMap((input, i) =>
		input.status === 'confirmed' ? [ctx.existing[i]!.id] : []
	);
	const [orders, lines] = await Promise.all([
		ctx.db.read('purchase_orders', {
			where: { id: { in: inputs.flatMap((input) => input.purchase_order_id ?? []) } },
			all: true
		}),
		ctx.db.read('purchase_invoice_lines', {
			where: { purchase_invoice_id: { in: confirming } },
			all: true
		})
	]);
	const withLines = new Set(lines.rows.map((l) => l.purchase_invoice_id));
	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		if (stored === undefined) {
			const order = orders.rows.find((o) => o.id === input.purchase_order_id);
			if (!order) ctx.refuse('Referenced purchase order does not exist.');
			if (order.status !== 'confirmed')
				ctx.refuse('Invoices can only be booked against a confirmed purchase order.');
			return {
				...input,
				supplier_id: order.supplier_id,
				supplier_code: order.supplier_code,
				supplier_name: order.supplier_name,
				currency: order.currency,
				tax_inclusive: order.tax_inclusive
			};
		}
		const from = stored.status,
			to = input.status ?? from;
		if (from === to) {
			if (from !== 'draft')
				ctx.refuse(`A ${from} purchase invoice is immutable. Revise by booking a new invoice.`);
			return input;
		}
		if (to === 'confirmed') {
			if (!withLines.has(stored.id))
				ctx.refuse('A purchase invoice must have at least one line before it can be confirmed.');
			return { ...input, ...(stored.confirmed_at == null ? { confirmed_at: ctx.now } : {}) };
		}
		if (missingReason(input.cancel_reason ?? stored.cancel_reason))
			ctx.refuse('A cancellation reason is required.');
		return { ...input, ...(stored.cancelled_at == null ? { cancelled_at: ctx.now } : {}) };
	});
});
