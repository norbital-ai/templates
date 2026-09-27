import { collection } from '@norbital-ai/bolt';

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

export default collection('bim_reference_matrix', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
