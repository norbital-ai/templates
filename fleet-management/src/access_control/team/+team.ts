import { team } from '@norbital-ai/bolt';

export default team({
	fleet_administrators: {
		name: 'Fleet Administrators',
		parent: null,
		policies: ['fleet_read', 'fleet_operations', 'fleet_configuration']
	},
	fleet_dispatchers: {
		name: 'Fleet Dispatchers',
		parent: null,
		policies: ['fleet_read', 'fleet_operations']
	},
	fleet_viewers: {
		name: 'Fleet Viewers',
		parent: null,
		policies: ['fleet_read']
	}
});
