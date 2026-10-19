import { team } from '@norbital-ai/bolt';
/** Source access roles: stable handles are membership and approval identities. */
export default team({
	'team-operations': {
		name: 'Operations',
		parent: null,
		policies: ['operations']
	},
	'team-helpers': {
		name: 'Helpers',
		parent: null,
		policies: ['helper']
	}
});
