import { model } from '@norbital-ai/bolt';

export default model({
	description: 'Handover and asset-linked document records.',
	icon: 'lucide:file-text',
	label: 'title',
	fields: {
		title: { kind: 'text' },
		document_number: { kind: 'text', optional: true, unique: true },
		document_type: {
			kind: 'enum',
			values: ['ifc_model', 'handover_pack', 'o_and_m', 'drawing', 'specification', 'certificate'],
			optional: true
		},
		asset_tag: { kind: 'text', optional: true },
		asset_category: {
			kind: 'enum',
			values: ['bim_model', 'handover', 'operations'],
			optional: true
		},
		status: {
			kind: 'enum',
			values: ['draft', 'in_review', 'issued', 'superseded', 'archived'],
			optional: true
		},
		validity_range: { kind: 'period', of: 'date', optional: true },
		document_url: { kind: 'text', optional: true },
		version: { kind: 'text', optional: true },
		tags: { kind: 'text', many: true, optional: true }
	},
	search: { text: ['title'] }
});
