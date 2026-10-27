import { team } from '@norbital-ai/bolt';
/** Source access roles: stable handles are membership and approval identities (`seed/seed.ts` maps the bank's ids). */
export default team({
	field_ops_controllers: {
		name: 'Field Operations Controllers',
		parent: null,
		policies: ['field_ops_controller']
	},
	contractors: { name: 'Contractor', parent: null, policies: ['field_ops_contractor'] },
	contractor_controllers: {
		name: 'Contractor (Controller)',
		parent: null,
		policies: ['field_ops_controller']
	}
});
