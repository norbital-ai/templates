import { model, type EffectCtx, type Row } from '@norbital-ai/bolt';
/**
 * A file on a purchase order: the PO itself, the purchaser's supporting documents for an LC, the LC the bank issues,
 * or the supplier's commercial invoice. The file keeps its own name. Filing or replacing the PO itself reads it into
 * its order (`purchase_order_read`). A PO document can be removed; who may remove which is the policies' call.
 */
export default model('po_document', {
	description: 'A file kept on a purchase order.',
	icon: 'lucide:paperclip',
	record_label: 'string(record.kind)',
	fields: {
		po: { kind: 'ref', to: 'purchase_order', inverse: 'documents', on_delete: 'cascade' },
		kind: {
			kind: 'enum',
			values: ['purchase_order', 'supporting', 'issued_lc', 'commercial_invoice', 'other'],
			default: 'supporting'
		},
		file: {
			kind: 'file',
			accept: ['application/pdf', 'image/jpeg', 'image/png'],
			max: '10MiB'
		}
	},
	outputs: {
		default: { fields: 'all', po: { fields: ['po_number'] } }
	},
	create: {
		fields: ['po', 'kind', 'file'],
		effect: function* (changes, ctx) {
			yield* read(
				changes.map(({ after }) => after),
				ctx
			);
		}
	},
	update: {
		fields: ['kind', 'file'],
		effect: function* (changes, ctx) {
			yield* read(
				changes.filter((c) => c.changed('file') || c.changed('kind')).map(({ after }) => after),
				ctx
			);
		}
	},
	delete: {}
});

/** One read per order whose PO document landed, keyed by that document. */
function* read(
	rows: readonly Pick<Row<'po_document'>, 'id' | 'revision' | 'po' | 'kind'>[],
	ctx: EffectCtx<'po_document'>
) {
	const orders = new Map(
		rows
			.filter((r) => r.kind === 'purchase_order')
			.map((r) => [r.po, `read:${r.po}:${r.id}:${r.revision}`])
	);
	for (const [po, key] of orders) yield* ctx.schedule('purchase_order_read', { po: [po] }, { key });
}
