import { team } from '@norbital-ai/bolt';
/** Source access roles: stable handles are membership and approval identities. */
export default team({
	'019f8a40-0000-7000-8000-000000000001': {
		name: 'Field Operations Controllers',
		parent: null,
		policies: ['field_ops_controller']
	},
	'019f8a40-0000-7000-8000-000000000002': {
		name: 'Contractor',
		parent: null,
		policies: ['field_ops_contractor']
	},
	'019f8a40-0000-7000-8000-000000000003': {
		name: 'Contractor (Controller)',
		parent: null,
		policies: ['field_ops_controller']
	}
});
