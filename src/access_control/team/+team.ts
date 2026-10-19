import { team } from '@norbital-ai/bolt';
/** Source access roles: stable handles are membership and approval identities. */
export default team({
	'019f8a30-0000-7000-8000-000000000001': {
		name: 'Project Delivery',
		parent: null,
		policies: ['construction_read', 'construction_project_workspace']
	},
	'019f8a30-0000-7000-8000-000000000002': {
		name: 'Reference Matrix Administrators',
		parent: null,
		policies: ['construction_read', 'construction_settings_reference_matrix']
	},
	'019f8a30-0000-7000-8000-000000000003': {
		name: 'Workforce Administrators',
		parent: null,
		policies: ['construction_read', 'construction_settings_workforce']
	},
	'019f8a30-0000-7000-8000-000000000004': {
		name: 'Construction Administrators',
		parent: null,
		policies: [
			'construction_read',
			'construction_project_workspace',
			'construction_settings_reference_matrix',
			'construction_settings_workforce'
		]
	}
});
