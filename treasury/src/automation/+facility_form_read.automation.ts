import { automation, type ValueOf } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
import { decimal } from '../lib/calculations.js';
import { facilityFor } from '../lib/purchasing.js';
import { documentSource } from '../lib/documents.js';

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
					fields: ['kind', 'file'],
					order_by: ['kind', { created_at: 'desc' }]
				}
			});
			if (facility_attachment.rows.length === 0)
				return yield* ctx.refuse('errors.form_no_attachments');
			const readings: { kind: string; read: ValueOf<typeof READ> }[] = [];
			for (const attachment of facility_attachment.rows) {
				if (readings.some((r) => r.kind === attachment.kind)) continue;
				const source = yield* documentSource(attachment.file, 'facility_form_read', ctx);
				const read = yield* ctx.ai.sys_2.infer({
					label: `facility form · ${attachment.kind}`,
					system:
						'Read only this document. Copy what is printed; never guess or return bank account numbers.',
					prompt: `This attachment is a ${attachment.kind}. For a purchase_order, extract the supplier PO fields. For a proforma, extract only supplier_payment_terms, currency and total_amount. For a customer_po, extract only customer_po_number and customer. Leave unrelated fields empty. Use the attached page images for scanned text.\n\n${source.text}`,
					files: source.files,
					output: READ
				});
				readings.push({ kind: attachment.kind, read });
			}
			const po = readings.find((r) => r.kind === 'purchase_order')?.read;
			const proforma = readings.find((r) => r.kind === 'proforma')?.read;
			const customer = readings.find((r) => r.kind === 'customer_po')?.read;
			const notes = [
				'Filled empty fields from the latest attachment of each kind; check them against the documents.'
			];
			if (po?.po_number != null && po.po_number !== f.po_number)
				notes.push(
					'The attached PO number differs from this form. Check the PO number before linking it.'
				);
			if (po?.currency != null && po.currency !== f.currency)
				notes.push(
					`The PO currency is ${po.currency}; the form currency is ${f.currency}. Review the currency.`
				);
			if (po?.payment_terms != null && facilityFor(po.payment_terms) !== f.facility_required)
				notes.push('The PO payment terms differ from the selected facility. Review T/T versus LC.');
			const amount = f.amount ?? po?.total_amount;
			if (
				proforma?.total_amount != null &&
				amount != null &&
				!BigDecimal.equals(decimal(proforma.total_amount), decimal(amount))
			)
				notes.push('The proforma total differs from the PO amount.');
			if (proforma?.currency != null && proforma.currency !== (po?.currency ?? f.currency))
				notes.push('The proforma currency differs from the PO currency.');
			const { purchase_order } = yield* ctx.query({
				purchase_order: {
					where: { po_number: { eq: f.po_number } },
					fields: ['po_number'],
					limit: 1
				}
			});
			const blank = <V>(current: V | null, value: V | null | undefined) =>
				(current === null || current === '') && value != null ? value : current;
			yield* ctx.act({
				'facility_form.update': [
					{
						target: f,
						set: {
							po_date: blank(f.po_date, po?.po_date),
							ship_date: blank(f.ship_date, po?.ship_date),
							payment_terms: blank(f.payment_terms, po?.payment_terms),
							shipping_terms: blank(f.shipping_terms, po?.shipping_terms),
							requested_by: blank(f.requested_by, po?.requested_by),
							buyer: blank(f.buyer, po?.buyer),
							vendor: blank(f.vendor, po?.vendor),
							shipment_from: blank(f.shipment_from, po?.vendor_country?.toUpperCase()),
							shipment_to: blank(f.shipment_to, po?.consignee_country?.toUpperCase()),
							amount: blank(f.amount, po?.total_amount),
							remarks: blank(f.remarks, proforma?.supplier_payment_terms),
							customer_po_number: blank(f.customer_po_number, customer?.customer_po_number),
							purpose: blank(
								f.purpose,
								customer?.customer_po_number == null
									? null
									: `For ${customer.customer ?? 'the customer'} PO ${customer.customer_po_number}`
							),
							purchase_order: f.purchase_order ?? purchase_order.rows[0]?.id ?? null,
							read_note: notes.join('\n')
						}
					}
				]
			});
		}
	}
});
