import { model } from '@norbital-ai/bolt';
const columns = [
	'reference_name',
	'reference_code',
	'project_id',
	'category',
	'subcategory',
	'unit_of_measure',
	'currency',
	'rate',
	'embodied_carbon_per_unit',
	'carbon_unit',
	'specification',
	'bim_guid',
	'data_source'
] as const;
export default model('bim_reference_matrix', {
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
		data_source: { kind: 'text', optional: true },
		project_id: {
			kind: 'ref',
			to: 'projects',
			inverse: 'bim_references',
			optional: true,
			onDelete: 'setNull'
		}
	},
	search: { text: ['reference_name'] },
	read: 'all',
	create: { columns },
	update: { columns }
});
