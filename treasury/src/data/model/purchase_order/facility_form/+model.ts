import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';

const FIELDS = [
	'purchase_order',
	'po_number',
	'po_date',
	'ship_date',
	'payment_terms',
	'shipping_terms',
	'customer_po_number',
	'requested_by',
	'buyer',
	'vendor',
	'facility_required',
	'currency',
	'amount',
	'latest_shipment_date',
	'partial_shipment',
	'transhipment',
	'shipment_from',
	'shipment_to',
	'freight',
	'lc_expiry_date',
	'documents_presentation_days',
	'expected_arrival',
	'intended_period_of_sales',
	'projected_sales',
	'purpose',
	'product_description',
	'pay_by_date',
	'remarks'
] as const;

/**
 * A purchase facility requisition: needed for every PO paid by T/T advance or LC. The purchaser attaches the PO, the
 * supplier's proforma, the customer's PO and the planning detail; the reader can fill the form from them; the
 * purchaser checks it, adds what only they know (pay-by date, shipment terms) and prints it with its attachments for
 * signature. An LC form asks for an LC: saving it ticks Pay by LC on its purchase order.
 */
export default model('facility_form', {
	description: 'A purchase facility requisition for a PO paid by T/T advance or LC.',
	icon: 'lucide:file-signature',
	record_label: 'record.po_number',
	fields: {
		purchase_order: {
			kind: 'ref',
			to: 'purchase_order',
			inverse: 'facility_forms',
			optional: true,
			on_delete: 'set_null'
		},
		po_number: { kind: 'text', max: 60 },
		po_date: { kind: 'date', optional: true },
		ship_date: { kind: 'date', optional: true },
		payment_terms: { kind: 'text', optional: true },
		shipping_terms: { kind: 'text', optional: true },
		customer_po_number: { kind: 'text', optional: true },
		requested_by: { kind: 'text', optional: true },
		buyer: { kind: 'text', optional: true },
		vendor: { kind: 'text', optional: true },
		facility_required: { kind: 'enum', values: ['tt', 'lc'], default: 'tt' },
		currency: { kind: 'currency', default: 'USD' },
		amount: { kind: 'decimal', scale: 2, optional: true },
		latest_shipment_date: { kind: 'date', optional: true },
		partial_shipment: { kind: 'bool', default: false },
		transhipment: { kind: 'bool', default: false },
		shipment_from: { kind: 'text', optional: true },
		shipment_to: { kind: 'text', optional: true },
		freight: { kind: 'text', optional: true },
		lc_expiry_date: { kind: 'date', optional: true },
		documents_presentation_days: { kind: 'int', min: 0, optional: true },
		expected_arrival: { kind: 'text', optional: true },
		intended_period_of_sales: { kind: 'text', optional: true },
		projected_sales: { kind: 'text', optional: true },
		purpose: { kind: 'text', optional: true },
		product_description: { kind: 'text', optional: true },
		pay_by_date: { kind: 'date', optional: true },
		remarks: { kind: 'text', optional: true },
		read_note: { kind: 'text', optional: true }
	},
	indexes: { by_po: { text: ['po_number', 'vendor', 'customer_po_number'] } },
	outputs: {
		default: {
			fields: 'all',
			purchase_order: { fields: ['po_number', 'lc_requested'] },
			attachments: { fields: ['kind', 'title', 'file'] }
		}
	},
	create: {
		fields: [...FIELDS],
		attachments: { fields: ['kind', 'title', 'file'] },
		transform: function* (changes, ctx) {
			return { sets: changes.map((c) => c.set), with: yield* askForLc(changes, ctx) };
		}
	},
	update: {
		fields: [...FIELDS, 'read_note'],
		attachments: { fields: ['kind', 'title', 'file'] },
		transform: function* (changes, ctx) {
			return { sets: changes.map((c) => c.set), with: yield* askForLc(changes, ctx) };
		}
	}
});

/** An LC form ticks Pay by LC on its purchase order, so Finance sees it under LCs to open. */
function* askForLc(
	changes: readonly {
		readonly after: {
			readonly facility_required?: 'tt' | 'lc';
			readonly purchase_order?: Id<'purchase_order'> | null;
		};
	}[],
	ctx: WriteCtx<'facility_form'>
) {
	const wanted = [
		...new Set(
			changes.flatMap((c) =>
				c.after.facility_required === 'lc' && c.after.purchase_order != null
					? [c.after.purchase_order]
					: []
			)
		)
	];
	if (wanted.length === 0) return {};
	const { purchase_order } = yield* ctx.query({
		purchase_order: {
			where: { id: { in: wanted }, lc_requested: { eq: false } },
			fields: ['revision']
		}
	});
	if (purchase_order.rows.length === 0) return {};
	return {
		purchase_order: {
			update: purchase_order.rows.map((target) => ({ target, set: { lc_requested: true } }))
		}
	};
}
