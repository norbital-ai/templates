import { team } from '@norbital-ai/bolt';

/** Source access roles for main-contractor delivery, commercial/QS, client read-only, and workspace administration. */
export default team({
	project_delivery: {
		name: 'Project Delivery',
		parent: null,
		policies: ['construction_read', 'construction_delivery', 'construction_connections']
	},
	commercial_qs: {
		name: 'Commercial & QS',
		parent: null,
		policies: ['construction_read', 'construction_commercial', 'construction_connections']
	},
	client_consultant: {
		name: 'Client & Consultant',
		parent: null,
		policies: ['construction_read']
	},
	construction_administrators: {
		name: 'Construction Administrators',
		parent: null,
		policies: [
			'construction_read',
			'construction_delivery',
			'construction_commercial',
			'construction_connections'
		]
	}
});
