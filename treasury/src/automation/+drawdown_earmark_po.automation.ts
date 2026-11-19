import { automation, new_id } from '@norbital-ai/bolt';
import { usdPerUnit } from '../lib/treasury.js';

/**
 * Earmark it: an earmark for a purchase order no open line covers yet, filled from the order (supplier, amount and
 * currency, the payment date or its financing request's pay-by date) and linked to it. Treasury picks the bank when
 * it allocates the earmark; an order that needs no financing, or is cancelled, is refused.
 */
export default automation({
	description: 'Earmark a purchase order no line covers yet, linked to it.',
	input: { po: { kind: 'ref', to: 'purchase_order' } },
	policies: ['po_earmarks'],
	run: function* ({ po }, ctx) {
		const { purchase_order, po_financing, facility_form, fx_rate } = yield* ctx.query({
			purchase_order: {
				where: { id: { eq: po } },
				fields: [
					'po_number',
					'po_date',
					'supplier',
					'currency',
					'amount',
					'payment_date',
					'is_cancelled',
					'no_financing'
				],
				limit: 1
			},
			po_financing: {
				where: { purchase_order: { eq: po } },
				fields: ['drawdown'],
				drawdown: { fields: ['status'] }
			},
			facility_form: {
				where: { purchase_order: { eq: po } },
				fields: ['pay_by_date'],
				order_by: { created_at: 'desc' },
				limit: 1
			},
			fx_rate: { fields: ['currency', 'rate_date', 'usd_per_unit'] }
		});
		const order = purchase_order.rows[0];
		if (order === undefined) return yield* ctx.refuse('errors.po_covered');
		if (
			order.is_cancelled ||
			order.no_financing ||
			po_financing.rows.some((f) => f.drawdown?.status !== 'cancelled')
		)
			return yield* ctx.refuse('errors.po_covered');
		if (order.supplier === null || Number(order.amount) <= 0)
			return yield* ctx.refuse('errors.po_incomplete');
		const fx = usdPerUnit(order.currency, order.po_date ?? ctx.today, fx_rate.rows);
		if (fx === null) return yield* ctx.refuse('errors.po_no_fx');
		const line = new_id('drawdown');
		yield* ctx.act({
			'drawdown.create': [
				{
					id: line,
					status: 'earmarked',
					supplier: order.supplier,
					currency: order.currency,
					amount: order.amount,
					fx_rate_to_usd: fx,
					expected_draw_date: order.payment_date ?? facility_form.rows[0]?.pay_by_date ?? null,
					purpose: order.po_number === null ? null : `PO ${order.po_number}`
				}
			],
			'po_financing.create': [{ purchase_order: order.id, drawdown: line }]
		});
	}
});
