import { automation } from '@norbital-ai/bolt';
import { facilityFor } from '../lib/purchasing.js';

const READ = {
	kind: 'object',
	fields: {
		po_number: { kind: 'text', optional: true },
		po_date: { kind: 'date', optional: true },
		ship_date: { kind: 'date', optional: true },
		payment_terms: { kind: 'text', optional: true },
		shipping_terms: { kind: 'text', optional: true },
		requested_by: { kind: 'text', optional: true },
		buyer: { kind: 'text', optional: true },
		vendor: { kind: 'text', optional: true },
		vendor_country: { kind: 'text', optional: true },
		consignee_country: { kind: 'text', optional: true },
		currency: { kind: 'currency', optional: true },
		total_amount: { kind: 'decimal', scale: 2, optional: true },
		supplier_payment_terms: { kind: 'text', optional: true },
		customer_po_number: { kind: 'text', optional: true },
		customer: { kind: 'text', optional: true }
	}
} as const;

/**
 * Fills a facility form from its attachments: the PO gives the top table, vendor, amount and where the goods ship
 * from and to; the proforma its payment terms (into the remarks); the customer's PO its number and the purpose. Only
 * empty fields are filled, never the pay-by date. The form links to the purchase order with the same number.
 */
export default automation({
	description:
		'Fill a facility form from its PO, proforma and customer PO; the purchaser checks it.',
	input: { form: { kind: 'rows', of: 'facility_form' } },
	policies: ['facility_forms'],
	run: function* ({ form }, ctx) {
		for (const f of form) {
			const { facility_attachment } = yield* ctx.query({
				facility_attachment: {
					where: {
						form: { eq: f.id },
						kind: { in: ['purchase_order', 'proforma', 'customer_po'] }
					},
					fields: ['file']
				}
			});
			if (facility_attachment.rows.length === 0)
				return yield* ctx.refuse('errors.form_no_attachments');
			const read = yield* ctx.ai.sys_2.infer({
				label: 'facility form',
				system:
					'You read a purchase order, a supplier proforma and a customer purchase order. Copy what is printed; never guess.',
				prompt:
					'Fill the fields. supplier_payment_terms is the proforma’s terms of payment; customer_po_number and customer come from the customer’s purchase order.',
				files: facility_attachment.rows.map((a) => a.file),
				output: READ
			});
			const { purchase_order } = yield* ctx.query({
				purchase_order: {
					where: { po_number: { eq: read.po_number ?? f.po_number } },
					fields: ['po_number'],
					limit: 1
				}
			});
			const blank = <V>(current: V | null, value: V | null | undefined) =>
				current === null && value != null ? value : current;
			yield* ctx.act({
				'facility_form.update': [
					{
						target: f,
						set: {
							po_date: blank(f.po_date, read.po_date),
							ship_date: blank(f.ship_date, read.ship_date),
							payment_terms: blank(f.payment_terms, read.payment_terms),
							shipping_terms: blank(f.shipping_terms, read.shipping_terms),
							requested_by: blank(f.requested_by, read.requested_by),
							buyer: blank(f.buyer, read.buyer),
							vendor: blank(f.vendor, read.vendor),
							shipment_from: blank(f.shipment_from, read.vendor_country?.toUpperCase()),
							shipment_to: blank(f.shipment_to, read.consignee_country?.toUpperCase()),
							amount: blank(f.amount, read.total_amount),
							remarks: blank(f.remarks, read.supplier_payment_terms),
							customer_po_number: blank(f.customer_po_number, read.customer_po_number),
							purpose: blank(
								f.purpose,
								read.customer_po_number == null
									? null
									: `For ${read.customer ?? 'the customer'} PO ${read.customer_po_number}`
							),
							...(read.currency == null ? {} : { currency: read.currency }),
							...(read.payment_terms == null
								? {}
								: { facility_required: facilityFor(read.payment_terms) }),
							purchase_order: f.purchase_order ?? purchase_order.rows[0]?.id ?? null,
							read_note: 'Filled from the attachments; check each field against them before saving.'
						}
					}
				]
			});
		}
	}
});
