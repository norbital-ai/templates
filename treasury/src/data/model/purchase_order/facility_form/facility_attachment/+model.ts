import { model, type EffectCtx, type Row } from '@norbital-ai/bolt';
/**
 * A file in a facility form's pack, in the order it follows the form. Attaching or replacing one reads the form's
 * attachments again; the reader names an attachment's kind and title when they are left empty.
 */
export default model('facility_attachment', {
	description: 'A file attached to a facility form.',
	icon: 'lucide:paperclip',
	record_label: 'record.title != null ? record.title : string(record.kind)',
	fields: {
		form: { kind: 'ref', to: 'facility_form', inverse: 'attachments', on_delete: 'cascade' },
		kind: {
			kind: 'enum',
			values: ['proforma', 'purchase_order', 'customer_po', 'planning_detail', 'other'],
			default: 'other'
		},
		title: { kind: 'text', optional: true },
		file: {
			kind: 'file',
			accept: ['application/pdf', 'image/jpeg', 'image/png'],
			max: '10MiB'
		}
	},
	outputs: {
		default: { fields: 'all', form: { fields: ['po_number'] } }
	},
	create: {
		fields: ['form', 'kind', 'title', 'file'],
		effect: function* (changes, ctx) {
			yield* read(
				changes.map(({ after }) => after),
				ctx
			);
		}
	},
	update: {
		fields: ['kind', 'title', 'file'],
		effect: function* (changes, ctx) {
			yield* read(
				changes.filter((c) => c.changed('file')).map(({ after }) => after),
				ctx
			);
		}
	}
});

/** One read per form, keyed by the attachment that triggered it. */
function* read(
	rows: readonly Pick<Row<'facility_attachment'>, 'id' | 'revision' | 'form'>[],
	ctx: EffectCtx<'facility_attachment'>
) {
	const forms = new Map(rows.map((r) => [r.form, `read:${r.form}:${r.id}:${r.revision}`]));
	for (const [form, key] of forms)
		yield* ctx.schedule('facility_form_read', { form: [form] }, { key });
}
