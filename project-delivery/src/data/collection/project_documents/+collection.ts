import { collection } from '@norbital-ai/bolt';

/** Every field is the person's to set. */
const columns = [
	'title',
	'kind',
	'status',
	'markdown_body',
	'attachment',
	'project_id',
	'signed_by',
	'signed_on',
	'submitted_on'
] as const;

export default collection('project_documents', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
