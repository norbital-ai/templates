import { team } from '@norbital-ai/bolt';
/** Source access roles: readable handles are membership and approval identities (`seed/seed.ts` maps the bank's ids). */
export default team({
	project_delivery: {
		name: 'Project Delivery',
		parent: null,
		policies: ['construction_read', 'construction_project_workspace']
	},
	reference_matrix_administrators: {
		name: 'Reference Matrix Administrators',
		parent: null,
		policies: ['construction_read', 'construction_settings_reference_matrix']
	},
	workforce_administrators: {
		name: 'Workforce Administrators',
		parent: null,
		policies: ['construction_read', 'construction_settings_workforce']
	},
	construction_administrators: {
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
