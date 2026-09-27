import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Reference matrix entries used as the BIM item master sheet for cost and embodied carbon estimation.',
	icon: 'lucide:table-properties',
	label: 'reference_name',
	fields: {
		reference_name: { kind: 'text' },
		reference_code: { kind: 'text', optional: true, unique: true },
		category: { kind: 'text', optional: true },
		subcategory: { kind: 'text', optional: true },
		unit_of_measure: { kind: 'text', optional: true },
		currency: { kind: 'currency', optional: true },
		rate: { kind: 'money', currency: 'currency', optional: true },
		embodied_carbon_per_unit: { kind: 'decimal', scale: 4, optional: true },
		carbon_unit: { kind: 'text', optional: true },
		specification: { kind: 'text', optional: true },
		bim_guid: { kind: 'text', optional: true },
		data_source: { kind: 'text', optional: true }
	},
	search: { text: ['reference_name'] }
});
