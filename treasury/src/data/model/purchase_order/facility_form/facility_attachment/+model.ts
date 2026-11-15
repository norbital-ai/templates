import { model } from '@norbital-ai/bolt';
/** A file in a facility form's pack, in the order it follows the form. */
export default model('facility_attachment', {
	description: 'A file attached to a facility form.',
	icon: 'lucide:paperclip',
	record_label: 'record.title',
	fields: {
		form: { kind: 'ref', to: 'facility_form', inverse: 'attachments', on_delete: 'cascade' },
		kind: {
			kind: 'enum',
			values: ['proforma', 'purchase_order', 'customer_po', 'planning_detail', 'other'],
			default: 'other'
		},
		title: { kind: 'text' },
		file: {
			kind: 'file',
			accept: ['application/pdf', 'image/jpeg', 'image/png'],
			max: '10MiB'
		}
	},
	outputs: {
		default: { fields: 'all', form: { fields: ['po_number'] } }
	}
});
