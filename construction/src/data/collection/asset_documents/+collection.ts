import { collection } from '@norbital-ai/bolt';

const columns = [
	'title',
	'document_number',
	'project_id',
	'site_location_id',
	'document_type',
	'asset_tag',
	'asset_category',
	'status',
	'validity_range',
	'document_url',
	'version',
	'tags'
] as const;

export default collection('asset_documents', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
