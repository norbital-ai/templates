import { collection } from '@norbital-ai/bolt';

const columns = [
	'location_name',
	'location_code',
	'project_id',
	'location_type',
	'parent_location_id',
	'grid_reference',
	'description',
	'coordinates',
	'bim_model_element_id'
] as const;

export default collection('site_locations', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
