import { automation, new_id, type ActInput, type AutomationCtx, type Id } from '@norbital-ai/bolt';
import { CHARGES_INPUT, replaceStage } from '../lib/charges.js';
import { CONVERTIBLE, PRODUCT_CODES } from '../lib/products.js';

/**
 * The call on an LC, import bill or DA bill. Cash: the bill closes with the advice's charges and no interest.
 * Convert: the bill closes and a new financing line takes the amount (or the amount financed, when the advice
 * differs), with the bank's new number, due date and rate; interest runs from the conversion date. The new line keeps
 * the LC and bill numbers, points back at the bill, pays the same invoices and purchase orders, and carries the
 * advice's charges at drawdown.
 */
export default automation({
	description: 'Close an LC, import bill or DA bill: paid in cash, or converted into financing.',
	input: {
		bill: { kind: 'rows', of: 'drawdown' },
		how: { kind: 'enum', values: ['cash', 'convert'] },
		date: { kind: 'date' },
		charges: CHARGES_INPUT,
		new_product: { kind: 'enum', values: PRODUCT_CODES, optional: true },
		new_reference: { kind: 'text', optional: true },
		due_date: { kind: 'date', optional: true },
		interest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		new_amount: { kind: 'decimal', scale: 2, optional: true }
	},
	output: {
		kind: 'object',
		fields: { converted: { kind: 'ref', to: 'drawdown', optional: true } }
	},
	policies: ['treasury'],
	run: function* (input, ctx) {
		const bill = input.bill[0];
		if (bill === undefined || input.bill.length !== 1) return yield* ctx.refuse('errors.one_bill');
		const options = CONVERTIBLE[bill.product];
		if (options === undefined || !['applied', 'active'].includes(bill.status))
			return yield* ctx.refuse('errors.not_a_bill');
		const closing = {
			status: 'settled' as const,
			settlement_date: input.date,
			settled_principal: bill.amount,
			settled_interest: '0',
			is_archived: true
		};
		const { drawdown_charge, invoice, po_financing } = yield* ctx.query({
			drawdown_charge: { where: { drawdown: { eq: bill.id } }, fields: ['stage', 'revision'] },
			invoice: { where: { drawdown: { eq: bill.id } }, fields: ['po', 'revision'] },
			po_financing: { where: { drawdown: { eq: bill.id } }, fields: ['purchase_order'] }
		});
		if (input.how === 'cash') {
			yield* ctx.act({
				'drawdown.update': [
					{
						target: bill,
						set: {
							...closing,
							settled_by: 'cash' as const,
							charges: replaceStage(drawdown_charge.rows, 'settlement', input.charges ?? [])
						}
					}
				]
			});
			return {};
		}
		const product = input.new_product ?? options[0]!;
		if (!options.includes(product)) return yield* ctx.refuse('errors.conversion_product');
		if (input.due_date == null) return yield* ctx.refuse('errors.conversion_due');
		const converted = new_id('drawdown');
		const keepsBill = ['da', 'import_bill', 'tb'].includes(bill.product);
		const byPo = new Map<Id<'purchase_order'>, typeof invoice.rows>();
		for (const i of invoice.rows) byPo.set(i.po, [...(byPo.get(i.po) ?? []), i]);
		const created: ActInput<'drawdown.create'> = [
			{
				id: converted,
				facility: bill.facility,
				supplier: bill.supplier,
				product,
				status: 'active',
				bank_reference: input.new_reference ?? null,
				lc_number: bill.lc_number ?? (bill.product === 'lc' ? bill.bank_reference : null),
				bill_number: bill.bill_number ?? (keepsBill ? bill.bank_reference : null),
				currency: bill.currency,
				amount: input.new_amount ?? bill.amount,
				fx_rate_to_usd: bill.fx_rate_to_usd,
				application_date: input.date,
				released_date: input.date,
				start_date: input.date,
				due_date: input.due_date,
				day_count_basis: bill.day_count_basis,
				charge_rate_pct: bill.charge_rate_pct,
				purpose: bill.purpose,
				converted_from: bill.id,
				...(input.interest_rate_pct == null
					? {}
					: { interest_rate_pct: input.interest_rate_pct, rate_source: 'bank_advice' as const }),
				charges: replaceStage([], 'drawdown', input.charges ?? []).create
			}
		];
		yield* ctx.act({
			'drawdown.update': [
				{
					target: bill,
					set: {
						...closing,
						settled_by: 'converted' as const,
						charges: replaceStage(drawdown_charge.rows, 'settlement', [])
					}
				}
			],
			'drawdown.create': created,
			...(po_financing.rows.length === 0
				? {}
				: {
						'po_financing.create': po_financing.rows.map((link) => ({
							purchase_order: link.purchase_order,
							drawdown: converted
						}))
					}),
			...(byPo.size === 0
				? {}
				: {
						'purchase_order.update': yield* invoicesTo(byPo, converted, ctx)
					})
		});
		return { converted };
	}
});

/** Each PO whose invoices the bill paid now has them paid by the converted line. */
function* invoicesTo(
	byPo: ReadonlyMap<
		Id<'purchase_order'>,
		readonly { readonly id: Id<'invoice'>; readonly revision: number }[]
	>,
	converted: Id<'drawdown'>,
	ctx: AutomationCtx
) {
	const { purchase_order } = yield* ctx.query({
		purchase_order: { where: { id: { in: [...byPo.keys()] } }, fields: ['revision'] }
	});
	return purchase_order.rows.map((target) => ({
		target,
		set: {
			invoices: {
				update: (byPo.get(target.id) ?? []).map((i) => ({
					target: i,
					set: { drawdown: converted }
				}))
			}
		}
	}));
}
